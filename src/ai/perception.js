/**
 * Perception: what any agent (a soldier, a guard, a dragon, the phoenix, a pilot) sees and hears.
 * Pure logic, no three.js. One place for the rules the squad AI (ai/squad.js), the guards
 * (ai/enemies.js), the dragons (ai/dragon.js) and the phoenix (ai/phoenix.js) sense by.
 *
 * Sight
 *  - Each agent has a profile (senses(agent)): sightRange (m, in clear daylight), fov (degrees,
 *    360: all round, as a team watching its sectors), peripheral (how well something at the edge
 *    of the field of view is noticed, 0..1, against 1 straight ahead), react (s to notice something
 *    plain and close), nightSight (how much of his range is left in the dark, 0..1), hearing (a
 *    factor on the distance a sound carries to him) and hearingPad (m added to it). The editor's
 *    object params and the rig set them per agent (agent.sightRange, agent.fov, agent.hearing...),
 *    and experience (ai/soldier.js SKILL) scales them (SKILL_SENSES).
 *  - Line of sight through the voxels (sightLine): walls and roofs block it, glass and foliage dim
 *    it, smoke builds up an optical depth (as the guards' old test did) and blocks it when thick.
 *  - The eye is where the head is: standing, crouched, prone, and when he peeks (eyeOf: the peek's
 *    rise over a low wall, or the lean out round a corner, from agent.peek); what the others see
 *    of him is that head too (headOf), so a peek both shows him the enemy and shows him to them.
 *  - Detection builds up over time (perceive): plain and close it is a fraction of a second,
 *    far off, at the edge of the view, in the dark, through smoke, half behind cover, keeping
 *    still and camouflaged it takes seconds or never comes. A target seen a moment ago is picked
 *    up again at once. Light (ambientLight, the beams of flashlights: lightAt) helps the one who
 *    looks; a light carried on shows its carrier from far away at night.
 *  - A man under water (target.submerged: his head's depth, m; ai/dive.js) is seen from above only
 *    within submergedRange (the water's visibility, target.waterVis, and his depth) and dimly; a
 *    scuba set's bubbles (target.bubbles) show where he is from BUBBLE_RANGE in daylight.
 *
 * Hearing
 *  - Sounds are events with a loudness at the source (dB at 1 m), a place, a kind and a source:
 *    emitSound(world, { pos, loudness_dB, kind, source }) puts one in world.noises (the list the
 *    AIs listen to). A sound carries as far as it stays above the threshold of hearing, spreading
 *    (-20 log10 d) and absorbed on the way (ALPHA dB/m): rangeFromDb. Noises with only a range
 *    (`loud`, m: the older ones) are the same thing in other words (dbFromRange).
 *  - hears(listener, noise): within his hearing (the range times his hearing factor, plus his
 *    pad), less through walls (each wall between takes WALL_DB off), and where it came from is
 *    uncertain: the further and fainter, the further off his guess (the place to investigate).
 *  - Footsteps (stepNoise): one rule for the soldiers (ai/squad.js footfall, each stride) and the
 *    player (walk/walk.js): the pace (crawl, sneak, walk, run, sprint), the ground (hard rings, soft
 *    deadens, wading splashes), the rattle of what he carries (ai/loadout.js noiseDb) and his care
 *    (stealth): a loaded squad running is heard far further off than a light one crawling.
 *
 * Darkness: another part of the simulation (time of day: the sun and the moon) may give the world
 * its light; ambientLight reads whatever is there (world.lightAt(p), world.light.level,
 * world.lightLevel, world.ambient, world.sun.light) and falls back to the world's `dark` flag.
 */
import { traceVoxels } from './sight.js';
import { EXPERIENCE } from './experience.js';
import { MATERIALS } from '../sim/materials.js';
import { submergedRange, WATER_VIS, BUBBLE_RANGE, UNDER } from './dive.js';

const { hypot, min, max, log10, sqrt, acos } = Math;
const DEG = Math.PI / 180;

/**
 * Each kind's senses (sightRange m in daylight, fov degrees, peripheral 0..1, react s, nightSight
 * 0..1, hearing factor, hearingPad m). The defaults keep what each AI did before (the squads saw
 * as far as the weather let them, the guards 22 m, the dragon 45 m, 13 dozing, the phoenix 9).
 */
export const SENSES = {
  soldier: { sightRange: 400, fov: 360, peripheral: 0.5, react: 0.25, nightSight: 1, hearing: 1, hearingPad: 0, investigate: 250 },
  guard: { sightRange: 22, fov: 360, peripheral: 0.5, react: 0.3, nightSight: 1, hearing: 1, hearingPad: 0, investigate: 120 },
  dragon: { sightRange: 45, fov: 360, peripheral: 0.6, react: 0.15, nightSight: 1, hearing: 1.6, hearingPad: 8, investigate: 600, restRange: 13 },
  phoenix: { sightRange: 9, fov: 360, peripheral: 0.6, react: 0.2, nightSight: 1, hearing: 1, hearingPad: 0, investigate: 0 },
  // a jet's pilot: far, through the canopy, forward; deaf in his helmet over the engine
  pilot: { sightRange: 3000, fov: 220, peripheral: 0.4, react: 0.5, nightSight: 0.4, hearing: 0.05, hearingPad: 0, investigate: 0 },
  player: { sightRange: 400, fov: 120, peripheral: 0.5, react: 0.25, nightSight: 1, hearing: 1, hearingPad: 0, investigate: 0 },
};
/** What experience does to the senses: sight (range), hearing (range), react (time to notice). */
// (from the one experience table, ai/experience.js: react is its 'notice', the time to make a threat out)
export const SKILL_SENSES = Object.fromEntries(Object.entries(EXPERIENCE).map(([k, E]) => [k, { sight: E.sight, hearing: E.hearing, react: E.notice }]));
/** The parameters an agent may carry (the editor's and the rig's), with their meaning. */
export const SENSE_PARAMS = {
  sightRange: 'How far he picks up an enemy in clear sight, in daylight (m)',
  fov: 'Field of view (degrees; 360: all round)',
  hearing: 'Hearing (× how far a sound carries)',
  nightSight: 'Sight left in the dark (0..1)',
};
const KIND_OF = (a) => a.senseKind ?? (a.squad || a.guard ? (a.guard ? 'guard' : 'soldier') : 'soldier');

/** An agent's senses: its kind's defaults, its own params, scaled by its experience. */
export function senses(a = {}, kind = KIND_OF(a)) {
  const base = SENSES[kind] ?? SENSES.soldier;
  const sk = SKILL_SENSES[a.skill] ?? SKILL_SENSES.regular;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    kind,
    sightRange: num(a.sightRange, base.sightRange) * sk.sight,
    fov: num(a.fov, base.fov),
    peripheral: num(a.peripheral, base.peripheral),
    react: num(a.react, base.react) * sk.react,
    nightSight: num(a.nightSight, base.nightSight),
    hearing: num(a.hearing, base.hearing) * sk.hearing,
    hearingPad: num(a.hearingPad, base.hearingPad),
    investigate: num(a.investigateRange, base.investigate),
    restRange: base.restRange,
  };
}

/* ------------------------------------------------------------------ eyes and heads */
/** Eye heights (m above the feet) by the clip he shows. */
const LOW = { crouch: 1, crouchAim: 1, crouchShoot: 1, peekWall: 1, drawTorch: 0, stowTorch: 0, setTripwire: 1, liftCasualty: 1, putDownCasualty: 1, kneelAim: 1, kneelShoot: 1, anchorRope: 1 };
const PRONE = { crawl: 1, proneAim: 1, proneShoot: 1, woundedDown: 1, dragged: 1, peekOver: 1, peekOverAim: 1 };
export const EYE = { stand: 1.6, crouch: 1.05, prone: 0.35 };
/** Where he looks along (unit x, z): his aim point, else his heading (yaw 0 looks along +z). */
export function forwardOf(a) {
  const at = a.lookAt ?? a.aimAt;
  if (at && a.p) {
    const dx = at[0] - a.p[0], dz = at[2] - a.p[2], l = hypot(dx, dz);
    if (l > 0.3) return [dx / l, dz / l];
  }
  const y = a.yaw ?? 0;
  return [Math.sin(y), Math.cos(y)];
}
/**
 * How far into a peek he is (0..1): up over the wall / out round the corner, then back.
 * peek = { kind: 'over' | 'left' | 'right' | 'sliceLeft' | 'sliceRight', t0, dur, rise?, out? }.
 */
export function peekAmount(pk, now) {
  if (!pk) return 0;
  const t = now - pk.t0, d = pk.dur;
  if (t < 0 || t > d) return 0;
  const io = min(0.35, d * 0.25);
  return t < io ? t / io : t > d - io ? (d - t) / io : 1;
}
/**
 * His eye, in the world: by his posture (standing, crouched, prone) and his peek (risen over a
 * low wall; leaning out left or right round a corner, the head ~0.45 m out; slicing the pie, a
 * step further each time). a.head (the player's camera) wins.
 */
export function eyeOf(a, now = a.now ?? 0) {
  if (a.head && !a.squad) return a.head;
  const p = a.p;
  const anim = a.anim;
  let y = PRONE[anim] || a.crawling ? EYE.prone : LOW[anim] ? EYE.crouch : EYE.stand;
  if (a.eyeH != null) y = a.eyeH;
  let x = p[0], z = p[2];
  const pk = a.peek;
  const k = pk ? peekAmount(pk, pk.now ?? now) : 0;
  if (k > 0) {
    const [fx, fz] = forwardOf(a);
    const rx = -fz, rz = fx; // his right (yaw 0: +z ahead, -x to the right)
    if (pk.kind === 'over') y += ((pk.rise ?? 1.5) - y) * k;
    else {
      const side = pk.kind === 'left' || pk.kind === 'sliceLeft' ? -1 : 1;
      const out = (pk.out ?? (pk.kind.startsWith('slice') ? 0.8 : 0.45)) * k;
      x += rx * side * out + fx * 0.12 * k;
      z += rz * side * out + fz * 0.12 * k;
      if (pk.low) y = EYE.crouch;
      else y = max(y, 1.5);
    }
  }
  return [x, p[1] + y, z];
}
/** What the others see of him: his head (where his eye is, a little above it). */
export function headOf(a, now) {
  if (a.head) return a.head;
  const e = eyeOf(a, now);
  return [e[0], e[1] + 0.05, e[2]];
}

/* ------------------------------------------------------------------ light */
/**
 * The ambient light at p (0 black .. 1 daylight), and whether the world said so itself (a time of
 * day) or it is the fallback from world.dark. Indoors (under a roof: opts.indoors(p)) the day is dimmer.
 */
export function ambientLight(w, p, opts = {}) {
  let L = null;
  try {
    if (typeof w?.lightAt === 'function') L = w.lightAt(p);
    else if (Number.isFinite(w?.light?.level)) L = w.light.level;
    else if (Number.isFinite(w?.lightLevel)) L = w.lightLevel;
    else if (Number.isFinite(w?.ambient)) L = w.ambient;
    else if (Number.isFinite(w?.sun?.light)) L = w.sun.light;
  } catch {
    L = null;
  }
  const explicit = Number.isFinite(L);
  if (!explicit) L = w?.dark ? 0.03 : 1;
  if (p && opts.indoors?.(p)) L *= explicit ? 0.35 : w?.dark ? 0.5 : 0.7;
  return { level: max(0, min(1, L)), explicit };
}
/** Is it dark there (night, a vault, below deck)? */
export const isDark = (w, p, opts) => ambientLight(w, p, opts).level < 0.15;
/** How much of the daylight sight is left at a light level L (0..1), for nightSight n. */
export function lightK(L, n = 1) {
  if (L >= 0.3) return 1;
  const k = 0.03 + 0.97 * (max(0, L) / 0.3) ** 0.8;
  return k + (1 - k) * (n >= 1 ? 1 : max(0, n) * 0.5);
}
/** A flashlight's beam: from, dir (unit), range (m it lights usefully), cone (half angle, rad). */
export const BEAM = { range: 40, cone: 0.32, glow: 80, into: 250 };
/**
 * How much the beams light p (0..1) and whether p looks into one of them (a carrier seen from in
 * front of his light). beams: [{ from, dir, range, cone, owner }].
 */
export function lightAt(beams, p, skip) {
  let lit = 0;
  for (const b of beams ?? []) {
    if (b.owner && b.owner === skip) continue;
    const dx = p[0] - b.from[0], dy = p[1] - b.from[1], dz = p[2] - b.from[2];
    const d = hypot(dx, dy, dz);
    const R = b.range ?? BEAM.range;
    if (d > R || d < 1e-3) continue;
    const c = (dx * b.dir[0] + dy * b.dir[1] + dz * b.dir[2]) / d;
    const cone = b.cone ?? BEAM.cone;
    const a = acos(max(-1, min(1, c)));
    if (a > cone) continue;
    const edge = a < cone * 0.6 ? 1 : 1 - (a - cone * 0.6) / (cone * 0.4);
    lit = max(lit, edge * min(1, (R / max(d, 1)) ** 2 / 25 + 0.5 * (1 - d / R)));
  }
  return min(1, lit);
}
/** The beams carried on in the world: soldiers and guards with a light on, the player's. */
export function beamsIn(w, extra = []) {
  const out = extra.slice();
  for (const m of w?.enemies ?? []) if (m.lightOn && !m.dead && m.beam) out.push({ ...m.beam, owner: m });
  if (w?.playerBeam) out.push(w.playerBeam);
  return out;
}

/* ------------------------------------------------------------------ line of sight */
const SEE_THROUGH = new Set(['leaves', 'twigs', 'grass', 'hedge']);
/**
 * Line of sight from a to b through the voxels: { clear, trans (0..1, what smoke, glass and
 * foliage leave of it), glass }. o.airCellAt(x, y, z) for the smoke; o.door(i): a voxel of a door
 * that counts as open; o.foliage / o.glass: how they count (the guards' old test blocked on any
 * solid; the dragon's let glass and leaves through, dimmed).
 */
export function sightLine(w, a, b, o = {}) {
  let tau = 0, pane = false, glass = false;
  const blocked = traceVoxels(w, a, b, (i, len, t) => {
    if (i < 0) return false;
    const m = w.mat[i];
    const M = m ? MATERIALS[m] : null;
    if (M && M.fluidity < 0.95 && !(o.door && o.door(i))) {
      if (o.glass && M.name === 'glass') {
        if (!pane) tau += 0.6;
        pane = glass = true;
      } else if (o.foliage && SEE_THROUGH.has(M.name)) tau += (0.35 * len) / (w.h * 0.6);
      else return true;
    } else pane = false;
    if (o.airCellAt && w.smoke) {
      const c = o.airCellAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      if (c >= 0) tau += ((8700 * w.smoke[c]) / w.ah ** 3) * len;
    }
    return tau > (o.maxTau ?? 2.5);
  });
  return { clear: !blocked, trans: Math.exp(-tau), glass };
}

/* ------------------------------------------------------------------ noticing */
/** How well something at the angle off his view is noticed (0: out of his field of view). */
export function viewFactor(obs, eye, p, prof) {
  if (prof.fov >= 360) return 1;
  const [fx, fz] = forwardOf(obs);
  const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
  const d = hypot(dx, dy, dz) || 1;
  const c = (dx * fx + dz * fz) / d;
  const ang = acos(max(-1, min(1, c))) / DEG;
  const half = prof.fov / 2;
  if (ang > half) return 0;
  const centre = min(30, half);
  return ang <= centre ? 1 : 1 - (1 - prof.peripheral) * ((ang - centre) / max(1e-6, half - centre));
}
/**
 * How fast (per s) he comes to notice a target: q = distance over his effective range, view the
 * view factor, exposure (0..1: how much of it shows; a head over a wall ~0.3), moving (m/s),
 * size (m, a man 1), camo (0..1), trans (0..1: smoke, glass), light (0..1 at the target, when the
 * world gives it), react (his time to notice something plain).
 */
export function noticeRate({ q, view = 1, exposure = 1, moving = 0, size = 1, camo = 0, trans = 1, light = 1, react = 0.25 }) {
  if (!(q < 1) || view <= 0 || exposure <= 0) return 0;
  const distK = 1 / (1 + 12 * q * q);
  const moveK = 1 + min(1.2, max(0, moving) * 0.5);
  return (distK * view * exposure * moveK * sqrt(max(0.05, size)) * (1 - 0.6 * min(1, camo)) * min(1, trans * 1.5) * max(0.1, light)) / react;
}
const keyOf = (t) => t.key ?? t.id ?? (t.head && !t.squad ? 'player' : t);
/**
 * His memory of a target ({ a: how far noticed, seenT, at, t }): by its key, its id, 'player', or
 * the object itself; a target handed over as a new object each time (no id) is the one he had
 * near where it is now. Old ones are forgotten.
 */
function memoryOf(obs, target, at, now) {
  const mem = (obs.aware ??= new Map());
  let k = keyOf(target);
  let s = mem.get(k);
  if (!s && k === target && typeof k === 'object')
    for (const [k2, s2] of mem)
      if (s2.anon && s2.t < now && hypot(s2.at[0] - at[0], s2.at[2] - at[2]) < 2.5) {
        mem.delete(k2);
        mem.set(k, (s = s2));
        break;
      }
  if (!s) {
    if (mem.size > 64) for (const [k2, s2] of mem) if (now - s2.t > 30) mem.delete(k2);
    mem.set(k, (s = { a: 0, seenT: -Infinity, anon: k === target }));
  }
  s.at = at;
  s.t = now;
  return s;
}
/**
 * One step of his noticing a target: { seen, level (0..1), visible, d, eye, at }.
 *  ctx: now (s), range (m: overrides his profile, e.g. the weather's visibility), los(eye, at)
 *       → bool or { clear, trans }, light (0..1 at the target: else from ctx.world), beams,
 *       instant (no build-up: a test of sight only).
 *  The target: p, head (or headOf), moving (m/s), size, camo, exposure, lightOn (carrying a light).
 */
export function perceive(obs, target, dt, ctx = {}) {
  const prof = ctx.prof ?? senses(obs);
  const now = ctx.now ?? 0;
  const eye = ctx.eye ?? eyeOf(obs, now);
  const at = ctx.at ?? headOf(target, now);
  const d = hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
  let range = min(ctx.range ?? Infinity, prof.sightRange);
  // the light where the target is: ambient (when the world says), his own beam, the target's
  let light = 1;
  if (ctx.light != null) light = ctx.light;
  else if (ctx.world) {
    const amb = ambientLight(ctx.world, at, ctx);
    if (amb.explicit || ctx.darkCounts) light = amb.level;
  }
  const beams = ctx.beams ?? [];
  light = max(light, lightAt(beams, at, target));
  let rK = lightK(light, prof.nightSight);
  range *= rK;
  // a light carried on shows its carrier from far off in the dark (looking into it: further)
  if (target.lightOn && light < 0.3) {
    const into = target.beam && lightAt([{ ...target.beam, range: BEAM.into, cone: (target.beam.cone ?? BEAM.cone) * 1.6 }], eye) > 0;
    range = max(range, min(prof.sightRange * 1.5, into ? BEAM.into : BEAM.glow));
    light = max(light, 0.6);
  }
  // under water (ai/dive.js): seen from above only as far as the water lets one see into it, and
  // dimly; a scuba diver's bubbles boiling up show where he is from much further off (in daylight)
  let exposure = target.exposure ?? 1;
  if (target.submerged > UNDER) {
    const sub = submergedRange(target.submerged, target.waterVis ?? WATER_VIS);
    exposure *= 0.5;
    if (target.bubbles && light > 0.3 && BUBBLE_RANGE * rK > sub) {
      range = min(range, BUBBLE_RANGE * rK);
      exposure = 0.3;
    } else range = min(range, sub);
  }
  const view = viewFactor(obs, eye, at, prof);
  let visible = d <= range && view > 0;
  let trans = 1;
  if (visible) {
    const r = ctx.los ? ctx.los(eye, at) : true;
    if (typeof r === 'object') {
      visible = r.clear;
      trans = r.trans ?? 1;
    } else visible = !!r;
  }
  const s = memoryOf(obs, target, at, now);
  if (!visible) {
    s.a = max(0, s.a - dt * 0.25);
    return { seen: false, level: s.a, visible: false, d, eye, at };
  }
  if (ctx.instant) s.a = 1;
  else {
    // seen a moment ago, or where they expect him (the threat they know of, watched): at once
    const recent = now - s.seenT < 3 || (ctx.expect && hypot(ctx.expect[0] - at[0], ctx.expect[2] - at[2]) < 3);
    const rate = noticeRate({ q: d / max(1e-6, range), view, exposure, moving: target.speed ?? (target.moving ? 1.2 : 0), size: target.size ?? 1, camo: target.camo ?? 0, trans, light: max(light, rK), react: prof.react });
    s.a = min(1, s.a + rate * dt * (recent ? 6 : 1));
  }
  const seen = s.a >= 1;
  if (seen) s.seenT = now;
  return { seen, level: s.a, visible: true, d, eye, at };
}
/** Forget what he was noticing (a new life, a reset). */
export const forget = (obs) => obs.aware?.clear();

/* ------------------------------------------------------------------ hearing */
/** The threshold of hearing (dB) and the absorption on the way (dB per m: air, ground, clutter). */
export const THRESHOLD = 25, ALPHA = 0.02;
/** Each wall between takes this off (dB), up to WALL_MAX. */
export const WALL_DB = 12, WALL_MAX = 40;
/** Loudness at 1 m (dB) of the sounds the simulation makes. */
export const LOUDNESS = {
  rifle: 157, carbine: 152, mg: 159, shotgun: 156, pistol: 150, suppressed: 125,
  explosion: 180, grenade: 175, flashbang: 172, rocket: 165, bow: 55,
  footstepCrawl: 30, footstepSneak: 38, footstepWalk: 45, footstepRun: 57, footstepSprint: 61,
  voice: 60, shout: 85, radio: 58, door: 75, glass: 90, impact: 80,
};
/** How far a sound of loudness dB carries (m), to the threshold of hearing. */
export function rangeFromDb(dB) {
  if (!(dB > THRESHOLD)) return 0;
  let lo = 1, hi = 1e6;
  for (let i = 0; i < 60; i++) {
    const m = sqrt(lo * hi);
    if (THRESHOLD + 20 * log10(m) + ALPHA * m < dB) lo = m;
    else hi = m;
  }
  return lo;
}
/** The loudness (dB at 1 m) that carries r m. */
export const dbFromRange = (r) => THRESHOLD + 20 * log10(max(1, r)) + ALPHA * max(1, r);
/** Footsteps' loudness by pace (m/s) and the ground (soft: grass, soil, sand; hard: stone, metal). */
export function footstepDb(speed, surface = 'soil') {
  return stepNoise({ speed, surface }).step;
}
/** The pace of a man moving at speed (m/s): crawl (o.crawl), sneak, walk, run, sprint. */
export function paceOf(speed, crawl = false) {
  if (!(speed > 0.05)) return null;
  if (crawl) return 'crawl';
  return speed > 4.2 ? 'sprint' : speed > 2.2 ? 'run' : speed > 0.9 ? 'walk' : speed > 0.45 ? 'sneak' : 'crawl';
}
const PACE_DB = { crawl: LOUDNESS.footstepCrawl, sneak: LOUDNESS.footstepSneak, walk: LOUDNESS.footstepWalk, run: LOUDNESS.footstepRun, sprint: LOUDNESS.footstepSprint };
/** How much of his gear's rattle each pace shakes out of it (a crawl drags and scrapes it; sneaking he holds it still). */
export const RATTLE_K = { crawl: 0.6, sneak: 0.3, walk: 0.7, run: 1.0, sprint: 1.25 };
/** The ground's share (dB): hard ground rings, soft ground deadens; water splashes (wading). */
export function surfaceDb(surface = 'soil') {
  if (/water|wade|puddle/i.test(surface)) return 5;
  if (/stone|concrete|metal|steel|iron|tile|marble|wood|plank|deck|gravel|glass|asphalt|brick|rock/i.test(surface)) return 6;
  if (/snow|grass|leaves|moss|carpet|turf|sand/i.test(surface)) return -4;
  return 0;
}
/**
 * One footfall's noise (dB at 1 m): { step (the footfall), rattle (his gear), dB (both together),
 * pace }. pace (or from speed m/s and crawl), surface (the ground's material name: 'concrete',
 * 'grass', 'water' wading...), gearDb (ai/loadout.js mobility noiseDb: the rattle of what he
 * carries, more the heavier), stealth (moving with care: a soft foot, his kit held and taped down).
 * A loaded man sprinting is heard much further than a light one walking, a crawler hardly at all.
 */
export function stepNoise({ pace, speed = 0, crawl = false, surface = 'soil', gearDb = 0, stealth = false } = {}) {
  pace ??= paceOf(speed, crawl);
  if (!pace) return { step: 0, rattle: 0, dB: 0, pace: null };
  const step = PACE_DB[pace] + surfaceDb(surface) - (stealth ? 4 : 0);
  const k = RATTLE_K[pace] * (stealth ? 0.5 : 1);
  // the rattle: buckles, magazines, the sling swivel, the kit knocking about (louder the more there is)
  const rattle = gearDb > 0 ? PACE_DB[pace] - 6 + 1.2 * gearDb * k : 0;
  const dB = rattle > 0 ? 10 * log10(10 ** (step / 10) + 10 ** (rattle / 10)) : step;
  return { step, rattle, dB, pace };
}
/**
 * A sound in the world (for the impact and sound modules to call too): { pos, loudness_dB, kind,
 * source }. Goes into world.noises as { p, loud (m it carries), dB, time, kind, source }.
 */
export function emitSound(w, { pos, loudness_dB, kind = 'sound', source = null, loud }) {
  if (!w || !pos) return null;
  const dB = Number.isFinite(loudness_dB) ? loudness_dB : dbFromRange(loud ?? 10);
  const n = { p: pos.slice(), loud: Number.isFinite(loud) ? loud : rangeFromDb(dB), dB, time: w.time ?? 0, kind, source };
  (w.noises ??= []).push(n);
  return n;
}
/**
 * What walls between a and b take off a sound (dB): each solid run along the line a wall (one it
 * would go over, a low wall or a crate, does not count: solid there but not 1.5 m higher).
 * solid(x, y, z) → bool (the world's, or a host's).
 */
export function wallLoss(a, b, solid, step = 0.25) {
  if (!solid) return 0;
  const d = hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (d < step * 2) return 0;
  let walls = 0, inWall = false, thick = 0;
  const n = min(400, Math.ceil(d / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    const s = !!solid(x, y, z) && !!solid(x, y + 1.5, z);
    if (s && !inWall) walls++;
    if (s) thick += d / n;
    inWall = s;
  }
  return min(WALL_MAX, walls * WALL_DB + max(0, thick - 0.3 * walls) * 15);
}
/**
 * Does the listener hear noise n? null, or { p (where he thinks it was), err (m), d, range, level
 * (dB over the threshold) }. The listener: an agent (his senses) at `at` (default his eye).
 *  o: solid (walls between), rand (0..1, for the guess), prof, at, walls (false: ignore them).
 */
export function hears(listener, n, o = {}) {
  const prof = o.prof ?? senses(listener);
  const at = o.at ?? (listener.p ? eyeOf(listener) : listener);
  const R0 = Number.isFinite(n.loud) ? n.loud : rangeFromDb(n.dB ?? 0);
  const d = hypot(n.p[0] - at[0], n.p[1] - at[1], n.p[2] - at[2]);
  let R = R0 * prof.hearing + prof.hearingPad;
  if (d > R) return null;
  if (o.walls !== false && o.solid) {
    const loss = wallLoss(n.p, at, o.solid);
    R *= 10 ** (-loss / 20);
    if (d > R) return null;
  }
  // the further off (and the fainter), the less sure where it was
  const err = min(25, d * (0.04 + 0.12 * (d / max(1, R))) / max(0.3, prof.hearing));
  const rand = o.rand ?? Math.random;
  const ang = rand() * Math.PI * 2, r = err * sqrt(rand());
  return { p: [n.p[0] + Math.cos(ang) * r, n.p[1], n.p[2] + Math.sin(ang) * r], err, d, range: R, level: 20 * log10(R / max(1, d)) };
}
