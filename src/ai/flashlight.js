/**
 * Flashlights: a light on the weapon, or a hand torch from the belt. Pure logic (no three.js),
 * for the squad and guard AIs (ai/squad.js), the player (walk/walk.js), the rig (operator/rig.js
 * draws the torch in the left hand and the weapon light's glow; render/flashlights.js lights them).
 *
 *  - Weapon light: an attachment on the weapon (a rail light under or beside the barrel). The rifle,
 *    the carbine and the shotgun have one by default, the pistol may (m.weaponLight: true / false
 *    for his weapons, or { rifle: false, pistol: true, ... } per weapon). Switched on, it lights
 *    along the muzzle, where he aims.
 *  - Hand torch: carried in a pouch on the left of the belt (m.flashlight, default true). He can
 *    use it only with a hand free: the knife, the pistol (held one-handed, the torch in the other
 *    hand under the wrist: the Harries technique; or out to the side, high: the FBI hold) or bare
 *    hands. With a two-handed weapon and no light on it he cannot, unless he switches weapons.
 *    Drawing it from the belt and putting it back take a moment (TORCH_T) with the free hand.
 *  - The light goes where he looks or aims (beamOf). Others see it (ai/perception.js: a carrier
 *    with a light on shows from far off in the dark), and it lights what he looks at (better
 *    sight at night).
 */
import { HANDLING, handKind } from './weapons.js';
import { BEAM, eyeOf, forwardOf } from './perception.js';

/** Which weapons carry a light unless told otherwise. */
export const LIGHT_MOUNT = { rifle: true, carbine: true, shotgun: true, pistol: false, mg: false, torch: false };
/** Drawing the hand torch from the belt and putting it back (s, at speed 1). */
export const TORCH_T = { draw: 0.7, stow: 0.6 };
/** The hand torch's grip with a pistol: Harries (wrists back to back) or FBI (out to the side, high). */
export const TORCH_GRIPS = ['harries', 'fbi'];

/** The handling kind in his hands (ai/weapons.js), the player's tool counted. */
const kindOf = (m) => (typeof m === 'string' ? m : handKind(m));
/** Does the weapon (a kind, or the one in his hands) carry a light? */
export function hasWeaponLight(m, kind = kindOf(m)) {
  const w = typeof m === 'object' ? m.weaponLight : undefined;
  if (w && typeof w === 'object' && kind in w) return !!w[kind];
  if (typeof w === 'boolean') return w && !!HANDLING[kind]?.gun && kind !== 'torch';
  return !!LIGHT_MOUNT[kind];
}
/** Is a hand free (the knife, the pistol, bare hands, nothing)? */
export function handFree(m) {
  const k = kindOf(m);
  return (HANDLING[k]?.hands ?? 2) < 2;
}
/** Does he carry a hand torch (on his belt, or out)? */
export const hasTorch = (m) => m.flashlight !== false;
/** Can he use the hand torch now (one on him, a hand free)? */
export const canUseTorch = (m) => hasTorch(m) && handFree(m);
/**
 * The light he would use now: 'weapon' (on the weapon in his hands), 'hand' (the torch, a hand
 * free) or null, and why not.
 */
export function lightSource(m) {
  const k = kindOf(m);
  if (hasWeaponLight(m, k)) return { src: 'weapon', why: '' };
  if (canUseTorch(m)) return { src: 'hand', why: '' };
  if (!hasTorch(m)) return { src: null, why: 'No light on the weapon and no torch' };
  return { src: null, why: `Both hands on the ${HANDLING[k]?.label?.toLowerCase() ?? k}: no light on it; switch to a pistol, the knife or bare hands for the torch` };
}
/**
 * One step of his light: want it on or off. Draws the hand torch from the belt first (and puts it
 * back when he takes a two-handed weapon), so m.torchOut is the torch in his hand, m.torchAct the
 * draw or the stow under way ({ k: 'draw' | 'stow', t }), m.lightOn whether it shines, m.lightSrc
 * from where. Returns an act to show ('drawTorch', 'stowTorch') when one starts.
 */
export function stepLight(m, want, dt, speed = 1) {
  let started = null;
  const s = lightSource(m);
  // the torch in his hand but no hand for it any more (a rifle drawn): back on the belt
  if (m.torchOut && !handFree(m) && m.torchAct?.k !== 'stow') {
    m.torchAct = { k: 'stow', t: 0 };
    started = 'stowTorch';
  }
  if (m.torchAct) {
    m.torchAct.t += dt * speed;
    const T = TORCH_T[m.torchAct.k];
    if (m.torchAct.t >= T) {
      m.torchOut = m.torchAct.k === 'draw';
      m.torchAct = null;
    }
  }
  if (want && s.src === 'hand' && !m.torchOut && !m.torchAct) {
    m.torchAct = { k: 'draw', t: 0 };
    started = 'drawTorch';
  }
  m.lightSrc = want ? (s.src === 'hand' ? (m.torchOut ? 'hand' : null) : s.src) : null;
  m.lightOn = !!m.lightSrc;
  m.lightWhy = want && !s.src ? s.why : '';
  m.beam = m.lightOn ? beamOf(m) : null;
  return started;
}
/** Put the torch away (he wants both hands), or take it out without switching it on. */
export function stowTorch(m) {
  if (m.torchOut && !m.torchAct) m.torchAct = { k: 'stow', t: 0 };
  m.lightOn = false;
  m.lightSrc = null;
  return 'stowTorch';
}
/**
 * The beam: from his weapon's muzzle (a weapon light) or his left hand (the torch) to where he
 * looks or aims: { from, dir, range, cone, src }.
 */
export function beamOf(m, now) {
  const eye = m.head && !m.squad ? m.head : eyeOf(m, now);
  const [fx, fz] = forwardOf(m);
  let dir;
  const at = m.lookAt ?? m.aimAt;
  if (m.lookDir) dir = m.lookDir.slice();
  else if (at) {
    const dx = at[0] - eye[0], dy = (at[1] + 1.2) - eye[1], dz = at[2] - eye[2], l = Math.hypot(dx, dy, dz) || 1;
    dir = [dx / l, dy / l, dz / l];
  } else dir = [fx, -0.08, fz];
  const l = Math.hypot(...dir) || 1;
  dir = dir.map((v) => v / l);
  const rx = -fz, rz = fx;
  const hand = m.lightSrc === 'hand';
  // the weapon light under the muzzle, a little to his right; the torch in his left hand
  const off = hand ? [-0.2, -0.25, 0.35] : [0.08, -0.15, 0.55];
  const from = [eye[0] + rx * off[0] + fx * off[2], eye[1] + off[1], eye[2] + rz * off[0] + fz * off[2]];
  return { from, dir, range: BEAM.range * (hand ? 0.85 : 1), cone: BEAM.cone * (hand ? 1.15 : 1), src: hand ? 'hand' : 'weapon' };
}
