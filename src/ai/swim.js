/**
 * Soldiers in the water: wading, swimming, treading water, struggling under a load, ditching gear
 * to stay up, going under and drowning. Pure logic (no three.js), used by the squad AI (ai/squad.js
 * move: every man each step) and by the player's walk (walk/walk.js: the same load rule).
 *
 *  - Depth (of water standing over the ground where he is): under WADE he walks as on land; up to
 *    SWIM_DEPTH he wades (slower, splashing: louder footsteps); deeper he swims, head out, the
 *    weapon slung on his back (no firing), his gear soaked and his weapon wet.
 *  - What he carries decides how (ai/loadout.js mobility().swim, from the total load and his
 *    fitness): 'swims' (light: a pace from his load, tiring a little faster than a walk);
 *    'struggles' (heavy: slow, his wind going fast); 'sinks' (too heavy to stay up at all).
 *  - Struggling or sinking he decides to ditch gear to survive (after a moment's hesitation: his
 *    reaction, ai/experience.js; struggling he tries to make it first while his wind lasts): one
 *    item at a time, the heaviest that helps first (the rucksack, the heavy armour, the manpack
 *    radio, the medic's bag, the breaching kit, the machine gun or the flame gun, the plates, the
 *    helmet, spare ammunition), until he swims; each one logged (m.ditched, ctx.log). With both
 *    arms hit (or m.noDitch) he cannot get out of it.
 *  - Spent (no wind left) or sinking he goes under: he holds his breath (BREATH_S at rest, less
 *    working hard), then drowns (DROWN_HP a second, as the player's underwater breathing in
 *    walk/walk.js), unless he got rid of enough in time and comes up again.
 *  - Out again, the water has to come out of his weapon before it fires (DRAIN_T, a quick
 *    function check: m.weaponWet), and his kit stays soaked a while (m.gearWet).
 */
import { applyKit, kitMass, mobility, PRIMARY } from './loadout.js';
import { experienceOf } from './experience.js';

/** Water deeper than this (m) he wades; deeper than SWIM_DEPTH (m) he swims (his chest under, feet off). */
export const WADE = 0.3, SWIM_DEPTH = 1.25;
/** His head at the surface: his feet this far (m) under it treading water (the eye ~0.15 m out). */
export const FLOAT_Y = 1.45;
/** Swimming (lying along the surface, the rig's swim clip): his feet this far under it. */
export const SWIM_Y = 0.5;
/** A breath held (s, at rest; working hard it goes faster), and the damage a second once it is gone. */
export const BREATH_S = 40, DROWN_HP = 18;
/** Clearing the water out of a weapon after a swim (s). */
export const DRAIN_T = 1.2;
/** The clips in the water (operator/rig.js WATER). */
export const WATER_ANIMS = { swim: 1, treadWater: 1, swimStruggle: 1, drown: 1 };

/** The pace of wading (× his walking pace) at a depth (m). */
export const wadeK = (depth) => (depth < WADE ? 1 : Math.max(0.35, 1 - 0.5 * Math.min(depth, SWIM_DEPTH) / SWIM_DEPTH - 0.1));

/** What a load does in the water: { cls ('swims' | 'struggles' | 'sinks'), speed (m/s swimming), drain (stamina a second) }. */
export function swimAbility(load, fitness = 0.5) {
  const F = 0.75 + 0.5 * (Number.isFinite(fitness) ? Math.max(0, Math.min(1, fitness)) : 0.5);
  const cls = mobility(load, { fitness }).swim;
  // a light man's pace in his clothes: ~0.9 m/s with nothing, slower with every kilo
  const light = Math.max(0.25, 0.95 * (1 - load / (32 * F)));
  if (cls === 'swims') return { cls, speed: light, drain: (0.004 + 0.0006 * load) / F };
  if (cls === 'struggles') return { cls, speed: 0.22, drain: (0.02 + 0.0015 * load) / F };
  return { cls, speed: 0.05, drain: 0.12 / F };
}
/** His load (kg) as it is now (after anything ditched). */
export const loadOf = (m) => (Number.isFinite(m.loadKg) ? m.loadKg : kitMass(m.kit ?? {}).total);

/**
 * What he would ditch next to stay afloat, in order: [label, apply(kit, m)] (the first that is
 * still on him). The rucksack and the heaviest things first; his rifle and pistol last of all.
 */
const DITCH = [
  ['rucksack', (k) => k.pack === 'rucksack' && ((k.pack = 'none'), true)],
  ['heavy armour', (k) => k.armour === 'heavy' && ((k.armour = 'none'), true)],
  ['manpack radio', (k) => k.radio === 'manpack' && ((k.radio = 'none'), true)],
  ["medic's bag", (k) => k.medkit === 'bag' && ((k.medkit = 'ifak'), true)],
  ['breaching kit', (k) => k.breach && !((k.breach = false))],
  ['flame gun', (k, m) => k.primary === 'flamer' && ((k.primary = 'none'), (m.mag = m.mags = 0), true)],
  ['machine gun', (k, m) => k.primary === 'mg' && ((k.primary = 'none'), (m.mag = m.mags = 0), true)],
  ['plate carrier', (k) => k.armour === 'plates' && ((k.armour = 'none'), true)],
  ['assault pack', (k) => k.pack === 'assault' && ((k.pack = 'none'), true)],
  ['drone kit', (k) => k.drone && !((k.drone = false))],
  ['rope', (k) => k.rope && !((k.rope = false))],
  ['spare ammunition', (k, m) => k.mags > 1 && !!PRIMARY[k.primary]?.mag && ((k.mags = 1), (m.mags = Math.min(m.mags ?? 1, 1)), true)],
  ['grenades', (k) => k.frag + k.smoke + k.flash > 0 && ((k.frag = k.smoke = k.flash = 0), true)],
  ['helmet', (k) => k.helmet && !((k.helmet = false))],
  ['soft vest', (k) => k.armour === 'soft' && ((k.armour = 'none'), true)],
  ['water', (k) => k.water > 0 && ((k.water = 0), true)],
  ['marksman rifle', (k, m) => k.primary === 'marksman' && ((k.primary = 'none'), (m.mag = m.mags = 0), true)],
  ['rifle', (k, m) => k.primary !== 'none' && ((k.primary = 'none'), (m.mag = m.mags = 0), true)],
];

/**
 * Ditch one piece of gear to stay afloat (the next in DITCH that is on him): his kit, load and
 * mobility recomputed (ai/loadout.js applyKit), noted in m.ditched. Returns its label, or null
 * (nothing left to ditch).
 */
export function ditchGear(m) {
  if (!m.kit) applyKit(m);
  const k = { ...m.kit };
  for (const [label, fn] of DITCH) {
    if (!fn(k, m)) continue;
    m.kit = k;
    const given = m.kitGiven;
    // (his pace and carry follow what he has left; one who had no kit of his own keeps the AI's pace)
    const keep = { carry: m.carry, paceK: m.paceK, fallK: m.fallK };
    m.carry = undefined;
    applyKit(m);
    if (!given) Object.assign(m, keep, { kitGiven: false });
    (m.ditched ??= []).push(label);
    if (label === 'rucksack' || label === 'assault pack') m.packDitched = true;
    return label;
  }
  return null;
}

/**
 * One step of a man in the water. w: { depth (m of water over the ground where he is), surface
 * (its height), floor (the ground's) }. ctx: { now (s), moving (he is swimming somewhere), log(m,
 * text), drown(m, hp) (the damage, else his health here), name(m) }. Returns null when he is not
 * swimming (shallow: wading or dry; m.wading set), else { y (his feet), speed (m/s he may swim),
 * anim, under (his head under) }.
 */
export function stepSwim(m, dt, w, ctx = {}) {
  const now = ctx.now ?? 0;
  const depth = w?.depth ?? 0;
  m.wading = depth > WADE && depth <= SWIM_DEPTH;
  if (depth <= SWIM_DEPTH) {
    if (m.swimming) leaveWater(m, now);
    m.swimming = false;
    m.under = false;
    m.breath = Math.min(BREATH_S, (m.breath ?? BREATH_S) + dt * 4);
    return null;
  }
  if (!m.swimming) {
    m.swimming = true;
    m.swimSince = now;
    m.sinkDepth = 0;
  }
  m.weaponWet = true;
  m.gearWet = now;
  const load = loadOf(m);
  const S = swimAbility(load, m.fitness);
  m.swim = S.cls;
  m.stamina ??= 1;
  // his wind: swimming tires (struggling under a load, fast); treading water costs less
  m.stamina = Math.max(0, m.stamina - S.drain * (ctx.moving ? 1 : 0.6) * dt);
  const spent = m.stamina <= 0;
  // too heavy, or spent: he cannot keep his head up
  m.under = S.cls === 'sinks' || (spent && S.cls !== 'swims');
  // he decides to ditch gear: sinking at once (after his reaction), struggling once his wind starts to go
  // (both arms hit, or tangled: m.noDitch, he cannot get the straps off)
  const canDitch = !(m.wounds?.armL && m.wounds?.armR) && !m.noDitch;
  if (S.cls !== 'swims' && !m.dead && canDitch) {
    const E = experienceOf(m);
    const wait = (S.cls === 'sinks' ? 0.8 : m.stamina > 0.6 ? 6 : 1.2) * E.react;
    m.ditchT = (m.ditchT ?? 0) + dt;
    if (m.ditchT >= wait) {
      m.ditchT = 0;
      const what = ditchGear(m);
      if (what) {
        const who = ctx.name?.(m) ?? 'a soldier';
        ctx.log?.(m, `${who} ditches his ${what} to stay afloat (${loadOf(m).toFixed(1)} kg left: ${m.swim})`);
      }
    }
  } else m.ditchT = 0;
  // under: down with the load (sinking ~0.4 m/s), else up to the surface again
  m.sinkDepth = m.under ? Math.min(Math.max(0, depth - FLOAT_Y), (m.sinkDepth ?? 0) + 0.4 * dt) : Math.max(0, (m.sinkDepth ?? 0) - 0.8 * dt);
  const headUnder = m.sinkDepth > 0.12;
  // his breath: held under water (faster working hard), back again with his head out
  if (headUnder) m.breath = (m.breath ?? BREATH_S) - dt * (1 + (m.under ? 0.8 : 0));
  else m.breath = Math.min(BREATH_S, (m.breath ?? BREATH_S) + dt * 3);
  let drowning = false;
  if (m.breath <= 0 && !m.dead) {
    drowning = true;
    const hp = DROWN_HP * dt;
    if (ctx.drown) ctx.drown(m, hp);
    else {
      m.health = (m.health ?? 100) - hp;
      if (m.health <= 0) m.dead = true;
    }
    if (m.dead && !m.drowned) {
      m.drowned = true;
      ctx.log?.(m, `${ctx.name?.(m) ?? 'a soldier'} drowned`);
    }
  }
  m.drowning = drowning;
  const speed = m.under ? 0.05 : S.cls === 'swims' ? S.speed * (spent ? 0.5 : 1) : S.speed;
  const anim = drowning || (headUnder && m.under) ? 'drown' : S.cls !== 'swims' || spent ? 'swimStruggle' : ctx.moving ? 'swim' : 'treadWater';
  // (swimming he lies along the surface, the clip's body ~0.4 m over his feet: lifted to it, smoothly)
  m.swimLift = (m.swimLift ?? 0) + ((anim === 'swim' ? 1 : 0) - (m.swimLift ?? 0)) * Math.min(1, dt * 3);
  const y = Math.max(w.floor ?? -Infinity, w.surface - FLOAT_Y + m.swimLift * (FLOAT_Y - SWIM_Y) - m.sinkDepth);
  return { y, speed, anim, under: headUnder };
}

/** Out of the water: the weapon has to be cleared before it fires (DRAIN_T). */
function leaveWater(m, now) {
  m.under = false;
  m.sinkDepth = 0;
  m.ditchT = 0;
  if (m.weaponWet) m.drainUntil = now + DRAIN_T;
}
/** Is his weapon still being cleared of water (after a swim)? */
export const draining = (m, now) => m.weaponWet && now < (m.drainUntil ?? -Infinity);

/** A primary that is heavy in the water (the machine gun, the flame gun's tanks). */
export const heavyPrimary = (kit) => (PRIMARY[kit?.primary]?.kg ?? 0) > 8;

/**
 * What a cell of water costs a man on a route (× a dry cell's cost added): wading a little more,
 * swimming much more (only where it saves a long way round), the more the worse he swims;
 * Infinity: not for him (none here: even a man who would sink may have to, rarely; he will ditch).
 */
export function waterCost(depth, cls = 'swims') {
  if (!(depth > WADE)) return 0;
  if (depth <= SWIM_DEPTH) return 1.2 * (depth / SWIM_DEPTH);
  return cls === 'swims' ? 7 : cls === 'struggles' ? 25 : 90;
}

/**
 * The player's gear (walk/walk.js), as a soldier's (an object ditchGear and swimAbility take):
 * the scene's loadout for him (kit), else a firefighter's: the rifle with three spare magazines,
 * two frag grenades, a helmet, a handheld radio, the knife and the hand torch; the breathing set
 * counted about neutral in the water. A fit man (fitness 0.8): that much he swims with.
 */
export const PLAYER_KIT = Object.freeze({ primary: 'rifle', mags: 3, sidearm: 'none', sideMags: 0, frag: 2, smoke: 0, flash: 0, pack: 'none', armour: 'none', helmet: true, nvg: false, radio: 'handheld', rope: false, medkit: 'none', drone: false, breach: false, knife: true, torch: true, water: 0 });
export function playerGear(kit, fitness = 0.8) {
  const g = { kit: { ...PLAYER_KIT, ...(kit ?? {}) }, fitness, squad: 'R1' };
  applyKit(g);
  g.kitGiven = true;
  return g;
}
