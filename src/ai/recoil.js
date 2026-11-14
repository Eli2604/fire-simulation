/**
 * Recoil: what firing a weapon does to the man holding it. Pure logic (no three.js): the squad AI
 * (ai/soldier.js: the climb spoils the aim of the next rounds) and the operator rig (operator/rig.js:
 * the firing clips are baked from it) use the same numbers.
 *
 *  - Physically based: the free recoil impulse of one round is the bullet's momentum plus the
 *    powder gases' (I = m_b·v + m_c·v_gas, v_gas ≈ 1500 m/s); the weapon of mass M takes it as
 *    the free recoil energy E = I² / 2M. The kick back into the shoulder and the muzzle rise of
 *    each shot grow as √(E / E_rifle) (the rifle's baseline: 0.028 m, 0.075 rad); a weapon held
 *    out in the hands (a pistol) rises more for its lever. A user override (`recoil`, a factor,
 *    1 = physical) scales it.
 *  - Recovery: the time the climb takes to come down (the shooter's control pulls the muzzle back
 *    on target): longer for more recoil, shorter for a better shot (`control`: ai/soldier.js
 *    SKILL, an elite 0.7 … a recruit 1.4).
 *  - Fire modes: single, burst (three rounds), auto, at the weapon's rate of fire. Rounds that
 *    come faster than the recovery pile up: the climb accumulates in a burst or a long string.
 *  - A pump action (the shotgun): after each round the pump is worked (pump, s) before the next;
 *    the firing clip includes the stroke.
 */

const V_GAS = 1500;
/** Bullet (kg), muzzle velocity (m/s), powder charge (kg), weapon mass (kg), rate of fire (rounds/min), fire modes. */
export const GUNS = {
  rifle: { label: '5.56 mm rifle', bullet: 0.004, v: 940, charge: 0.0017, mass: 3.4, rpm: 750, modes: ['single', 'burst', 'auto'], mode: 'burst' },
  mg: { label: '7.62 mm machine gun', bullet: 0.0095, v: 840, charge: 0.0029, mass: 11, rpm: 650, modes: ['burst', 'auto'], mode: 'auto' },
  carbine: { label: '9 mm carbine', bullet: 0.008, v: 400, charge: 0.0004, mass: 2.7, rpm: 900, modes: ['single', 'burst', 'auto'], mode: 'burst' },
  pistol: { label: '9 mm pistol', bullet: 0.008, v: 360, charge: 0.0004, mass: 0.9, rpm: 0, modes: ['single'], mode: 'single', hands: true },
  // a pump-action 12 gauge: 32 g of buckshot (the 'bullet'), one round a pull, then the pump
  // worked back and forward (pump, s) before the next
  shotgun: { label: '12 gauge pump shotgun', bullet: 0.032, v: 400, charge: 0.0025, mass: 3.6, rpm: 0, modes: ['single'], mode: 'single', pump: 0.45 },
};
export const FIRE_MODES = { single: 'Single', burst: 'Burst (3)', auto: 'Auto' };
/** Rounds a trigger pull fires in each mode (auto: a string as long as the weapon's own burst). */
const ROUNDS = { single: 1, burst: 3 };

/** One round's free recoil: impulse (N·s) and energy (J) in a weapon of its mass. */
export function freeRecoil(kind) {
  const g = GUNS[kind] ?? GUNS.rifle;
  const impulse = g.bullet * g.v + g.charge * V_GAS;
  return { impulse, energy: (impulse * impulse) / (2 * g.mass) };
}
const E_RIFLE = freeRecoil('rifle').energy;

/**
 * The recoil of a weapon: { kind, energy, impulse, kick (m back), rise (rad of muzzle per shot),
 * recovery (s), rpm, mode, rounds (a trigger pull), gap (s between rounds), scale }.
 * o.recoil: the override factor (1: as the physics says); o.mode: the fire mode; o.rounds: the
 * rounds of an automatic string.
 */
export function recoilSpec(kind = 'rifle', o = {}) {
  const g = GUNS[kind] ?? GUNS.rifle;
  const { impulse, energy } = freeRecoil(kind);
  const scale = Math.max(0, Number.isFinite(+o.recoil) && o.recoil !== null && o.recoil !== '' ? +o.recoil : 1);
  const k = Math.sqrt(energy / E_RIFLE) * scale;
  const mode = g.modes.includes(o.mode) ? o.mode : g.mode;
  const rounds = mode === 'auto' ? Math.max(4, o.rounds ?? (kind === 'mg' ? 9 : 6)) : ROUNDS[mode];
  return {
    kind,
    energy,
    impulse,
    kick: 0.028 * k,
    rise: 0.075 * k * (g.hands ? 1.5 : 1),
    recovery: (0.12 + 0.025 * energy) * Math.sqrt(Math.max(0.2, scale)),
    rpm: g.rpm,
    mode,
    rounds,
    gap: g.rpm > 0 ? 60 / g.rpm : 0.35 + (g.pump ?? 0),
    pump: g.pump ?? 0,
    scale,
  };
}

/** When the rounds of one trigger pull go (s from the first). */
export const shotTimes = (R) => Array.from({ length: R.rounds }, (_, i) => i * R.gap);
/** How long one trigger pull lasts, the recovery (and a pump action's stroke) after it included (the firing clip's length). */
export const pullTime = (R) => (R.rounds - 1) * R.gap + R.recovery + (R.pump ?? 0) + 0.08;
/** When the pump is worked in a pull (s from the first round): [start, end], or null (no pump). */
export function pumpTimes(R) {
  if (!R.pump) return null;
  const t0 = (R.rounds - 1) * R.gap + R.recovery * 0.55;
  return [t0, t0 + R.pump];
}

/**
 * Through a trigger pull: at time t (s), the kick (0 … ~1.5, 1 = one round's full kick, back into
 * the shoulder; sharp, gone in a third of the recovery) and the climb (rad of muzzle: each round
 * adds its rise; the shooter's control brings it down over the recovery, scaled by control).
 */
export function recoilAt(R, t, control = 1) {
  let kick = 0, climb = 0;
  const tau = R.recovery * control;
  for (const ts of shotTimes(R)) {
    const x = t - ts;
    if (x < 0) break;
    kick += Math.exp(-x / (0.3 * R.recovery));
    climb += R.rise * (1 - Math.exp(-x / 0.025)) * Math.exp(-x / tau);
  }
  return { kick: Math.min(1.6, kick) * (R.kick / 0.028), climb };
}

/** The highest the muzzle climbs in one pull (rad), and when. */
export function peakClimb(R, control = 1) {
  let best = 0, at = 0;
  const T = pullTime(R);
  for (let t = 0; t <= T; t += 0.005) {
    const c = recoilAt(R, t, control).climb;
    if (c > best) (best = c), (at = t);
  }
  return { climb: best, t: at };
}
/** How long after the last round the climb takes to fall below a tenth of its peak (s). */
export function recoveryTime(R, control = 1) {
  const { climb } = peakClimb(R, control);
  const last = (R.rounds - 1) * R.gap;
  for (let t = last; t < last + 5; t += 0.005) if (recoilAt(R, t, control).climb < climb * 0.1 && t > last + 0.03) return t - last;
  return 5;
}

/**
 * A man firing: his climb carried from round to round (m.climb, rad), each round's rise added and
 * the recovery pulling it down in between. Returns the climb when this round goes off.
 */
export function stepClimb(m, R, dt, fired, control = 1) {
  m.climb = (m.climb ?? 0) * Math.exp(-dt / Math.max(0.02, R.recovery * control));
  const now = m.climb;
  if (fired) m.climb += R.rise;
  return now;
}
