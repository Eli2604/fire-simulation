/**
 * Impacts: one body hitting another (a kick, a punch, a throw, a landing, a dragon coming down
 * from the sky, a stomp, a tail swipe, a jet crashing, a door slamming, a fragment hitting a
 * wall). From the masses, the closing speed and the two materials it works out the physics
 * (impulse, energy, contact time, force) and what it does: damage and a stagger or a knockdown
 * for whoever is hit, a knock-back, things crushed, a ground shockwave for a big one (a dust
 * ring, loose things jumping, people near it staggering, the camera shaking), and its sound
 * (audio/physics.js impactSound: loud by the energy, bright by the hardness, ringing by the
 * materials). No three.js and no Math.random in the physics: the tests use it as it is.
 *
 * API
 *
 *   import { impact, computeImpact, actImpactArgs, ACT_FORCE } from './sim/impact.js';
 *
 *   const r = impact(simOrWorld, {
 *     pos: [x, y, z],              // the contact point (m)
 *     normal: [0, 1, 0],           // the struck surface's normal (default: against the velocity)
 *     mass: 12,                    // the striker's effective mass (kg): a foot ~0.12 × body, a fist
 *                                  //   ~0.05 ×, a landing body 1 × (PART_MASS)
 *     velocity: [vx, vy, vz],      // or a speed (m/s): the striker's, relative to the target
 *     massB: 80,                   // the target's mass (default: target.mass, a person 80 kg, the
 *                                  //   ground ∞)
 *     materials: ['flesh', 'flesh'], // striker, struck (sim/materials.js mechanics(): steel,
 *                                  //   wood, stone, soil, grass, water, glass, flesh, scales, ...)
 *     scale: 1,                    // Force ×: multiplies the closing speed (impulse and force ×,
 *                                  //   energy ×²); times source.forceScale and world.forceScale
 *     contactTime: 0.012,          // optional (s): else Hertz contact of the two materials; a roll
 *                                  //   spreads a landing over ~0.3 s (less force, less harm)
 *     radius: 0.05, size: 0.5,     // the contact radius and the struck body's size (m: its sound)
 *     source, target,              // the objects (a guard, a dragon, a loose drum): target is hurt,
 *                                  //   knocked back, staggered; source.forceScale applies
 *     zone: 'torso',               // where on a person (head ×2.5, limbs ×0.6)
 *     kind: 'strike',              // 'strike' | 'landing' | 'fall' | 'throw' | 'crash' | 'stomp' | ...
 *     noiseKind: 'impact',         // the w.noises kind the AIs hear it as ('dragon': its own, ignored by it)
 *     effects: { damage, knock, shockwave, crush, sound }, // each default true (false: leave it to the caller)
 *   });
 *   // r: { speed, mu, e, impulse (N·s), energy (J), dissipated (J), contactTime (s), force (N, mean),
 *   //      peakForce, damage (HP), knock: 'none'|'stagger'|'knockdown', dv (m/s), shock: { radius } | null,
 *   //      sound: { db, gain, ... }, event }
 *
 *   computeImpact(o)       the same physics, nothing applied (the rig's force readout)
 *   actImpactArgs(decl, { bodyMass, scale, speed, pos, ... })  an act's impact keyframe as impact() args
 *
 * Acts declare their contacts as keyframes (rig/objects.js ACT_IMPACTS):
 *   impacts: [{ t: 0.42, part: 'footR', material: 'flesh', target: 'opponent', targetMaterial: 'flesh', v: 11 }]
 * t: when, as a fraction of the act (0..1); part: the bone / contact (its mass from PART_MASS, its
 * speed measured from the animation where the stage can, else v); target: 'opponent' | 'ground' |
 * 'object' | 'wall'. The world events: { type: 'impact', pos, energy, force, impulse, materials,
 * mass, speed, size, db, loudness_dB, knock, damage, name } and, for a big one, { type: 'shockwave',
 * pos, radius, energy, loudness_dB } (audio/sound.js plays them; walk/walk.js shakes the camera:
 * shakeAt()). loudness_dB (= db, also r.sound.db) is the physical loudness at the source: the
 * radiated sound energy in dB re 1 pJ (10·log10 of the impact energy × the materials' acoustic
 * efficiency), for AI hearing to take up (e.g. emitSound(world, { pos, loudness_dB, kind, source })).
 * The audio/physics.js levels (fireRoar, jetEngine, gunshot, explosion, ...) give `db` the same way.
 */
import { mechanics, MATERIALS } from './materials.js';
import { contact, impactSound } from '../audio/physics.js';
import { crush } from './crush.js';
import { emitSound } from '../ai/perception.js';

/** The struck sound's level for hearing (ai/perception.js: dB at 1 m, a punch ~80, a shot ~157) from its
 *  radiated energy level (dB re 1 pJ): calibrated so a punch lands at perception's impact level. */
export const HEARING_OFFSET_DB = -35;

/** A person's mass with kit (kg). */
export const PERSON_KG = 85;
/** Effective striking mass of a body part, as a fraction of the body's mass. */
export const PART_MASS = {
  fist: 0.05, handR: 0.05, handL: 0.05, elbow: 0.07, knee: 0.1, foot: 0.12, footR: 0.12, footL: 0.12, shin: 0.12, shinR: 0.12, shinL: 0.12,
  head: 0.07, shoulder: 0.35, body: 1, hips: 1, back: 1, feet: 1,
  jaw: 0.05, claw: 0.25, talons: 0.2, tail: 0.12, wing: 0.08, chest: 0.6,
  weapon: 0.06, rifle: 0.06, door: 1, hull: 1, wheels: 1,
};
/** Where a blow lands on a person: how much harm it does there. */
export const ZONE_HARM = { head: 2.5, neck: 2, torso: 1, chest: 1, belly: 1.2, armL: 0.6, armR: 0.6, legL: 0.6, legR: 0.6, legs: 0.6 };
/** The change of speed (m/s) a person takes from a blow that staggers him, that knocks him down. */
export const KNOCK = { stagger: 0.6, knockdown: 1.5 };
/** A shockwave through the ground from this much energy (J) on: its radius ~ SHOCK.k · E^⅓ m. */
export const SHOCK = { min: 4e3, k: 0.25 };

const len = (a) => Math.hypot(a[0], a[1], a[2]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isPerson = (x) => !!x && typeof x === 'object' && Array.isArray(x.p ?? x.d?.p) && (x.health !== undefined || x.hp !== undefined || x.squad !== undefined || x.state !== undefined) && x.kind === undefined;
const posOf = (x) => x?.p ?? x?.d?.p ?? x?.pos ?? null;

/**
 * The physics of an impact (nothing applied). See the file's head for o.
 */
export function computeImpact(o) {
  const src = o.source ?? null;
  const tgt = o.target ?? null;
  const scale = (o.scale ?? 1) * (src?.forceScale ?? 1) * (o.worldScale ?? 1);
  const m1 = Math.max(0.01, o.mass ?? src?.mass ?? 1);
  const m2 = o.massB ?? (tgt && tgt !== 'ground' ? tgt.mass ?? (isPerson(tgt) ? PERSON_KG : Infinity) : o.targetIsPerson ? PERSON_KG : Infinity);
  const mu = Number.isFinite(m2) ? (m1 * m2) / (m1 + m2) : m1;
  // the closing speed along the normal (a landing: the vertical part; a blow: all of it)
  const v = o.velocity ?? 0;
  let speed;
  let dir;
  if (Array.isArray(v)) {
    const s = len(v) || 1e-9;
    dir = [v[0] / s, v[1] / s, v[2] / s];
    const n = o.normal;
    speed = n ? Math.abs(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) : s;
  } else {
    speed = Math.abs(v);
    dir = o.normal ? o.normal.map((c) => -c) : [0, -1, 0];
  }
  speed *= scale;
  const [a, b] = o.materials ?? ['flesh', 'soil'];
  const ct = contact(a, b, { mass: mu, speed, radius: o.radius ?? 0.05 });
  const e = o.restitution ?? ct.e;
  const impulse = mu * (1 + e) * speed;
  const energy = 0.5 * mu * speed * speed;
  const dissipated = energy * (1 - e * e);
  const tc = o.contactTime ?? ct.tc;
  const force = impulse / Math.max(1e-5, tc);
  const dv = Number.isFinite(m2) ? impulse / m2 : 0;
  // what it does to a person: blunt trauma, from the energy taken (log: tissue gives), less when
  // the blow is spread over a longer time (a roll, a soft landing), by where it lands
  const person = isPerson(tgt) || o.targetIsPerson;
  let damage = 0;
  if (person || o.kind === 'landing' || o.kind === 'fall') {
    const zone = ZONE_HARM[o.zone] ?? 1;
    const spread = clamp(Math.sqrt(0.05 / Math.max(0.005, tc)), 0.3, 1.5);
    const armour = o.zone === 'torso' && tgt?.armour ? 0.6 : 1;
    // (on its own feet a body takes a landing in its legs: harmless up to ~6.5 m/s, a fall up to ~4)
    const tol = o.kind === 'landing' ? 0.5 * mu * 6.5 ** 2 : o.kind === 'fall' ? 0.5 * mu * 4 ** 2 : 40;
    damage = dissipated > tol ? 18 * Math.log2(1 + (dissipated - tol) / 400) * zone * spread * armour : 0;
  }
  const knock = person && o.kind === 'throw' ? 'knockdown' : person ? (dv >= KNOCK.knockdown ? 'knockdown' : dv >= KNOCK.stagger ? 'stagger' : 'none') : 'none';
  const ground = !tgt || tgt === 'ground' || o.kind === 'landing' || o.kind === 'crash' || o.kind === 'stomp' || o.kind === 'fall';
  const shock = ground && energy >= SHOCK.min ? { radius: SHOCK.k * Math.cbrt(energy) } : null;
  const sound = impactSound({ materials: [a, b], energy: dissipated + 0.1 * energy, mass: mu, speed, radius: o.radius ?? 0.05, size: o.size ?? (Number.isFinite(m2) ? Math.cbrt(m2 / mechanics(b).density) * 1.5 : 1), sizeA: o.sizeA ?? Math.cbrt(m1 / mechanics(a).density) * 1.5, footprint: o.footprint });
  return { speed, mu, e, impulse, energy, dissipated, contactTime: tc, force, peakForce: force * (Math.PI / 2), dv, dir, damage, knock, shock, scale, sound, materials: [a, b], mass: m1, massB: m2 };
}

/** How hard the camera shakes (0..~0.6) at distance d from a shockwave / impact event. */
export function shakeAt(ev, d) {
  const E = ev.energy ?? 0;
  if (E < 500) return 0;
  const R = ev.radius ?? SHOCK.k * Math.cbrt(E);
  const amp = clamp(Math.log10(E / 500) * 0.12, 0, 0.6);
  return amp * Math.max(0, 1 - d / (3 * R)) ** 2;
}

/**
 * An impact in the world: computes it (computeImpact) and applies what it does. `simOrWorld`: the
 * Simulation (damage through sim.ai, crushing voxels) or a bare world ({ time, events, enemies,
 * loose, ... }: the rig stages, the tests). Returns the result of computeImpact with `event`.
 */
export function impact(simOrWorld, o) {
  const sim = simOrWorld?.world ? simOrWorld : null;
  const w = sim ? sim.world : simOrWorld ?? {};
  const fx = { damage: true, knock: true, shockwave: true, crush: true, sound: true, ...(o.effects ?? {}) };
  const r = computeImpact({ ...o, worldScale: (o.worldScale ?? 1) * (w.forceScale ?? 1) });
  const time = w.time ?? 0;
  const pos = (o.pos ?? posOf(o.target) ?? [0, 0, 0]).slice();
  const tgt = o.target && o.target !== 'ground' ? o.target : null;
  // the one hit
  if (tgt && isPerson(tgt)) {
    if (fx.damage && r.damage > 0) hurt(sim, w, tgt, r.damage, o.zone);
    if (fx.knock && r.knock !== 'none') knockBack(w, tgt, r, time);
  } else if (tgt && fx.knock && Array.isArray(tgt.p) && tgt.kind && Number.isFinite(r.massB)) launchLoose(w, tgt, r.dir.map((c) => c * r.dv), time);
  // crushing what is built (a voxel world)
  if (fx.crush && sim?.forSphere && !tgt && r.dissipated > 2e3) (o.crushFn ?? crush)(sim, pos, clamp(0.15 * Math.cbrt(r.dissipated / 1000), 0.2, 4), clamp(r.dissipated / 3e4, 0.1, 3), o.from ?? [pos[0], pos[1] + 2, pos[2]]);
  // the shockwave through the ground
  if (r.shock && fx.shockwave) shockwave(sim, w, pos, r.energy, r.shock.radius, o);
  const name = o.name ?? `${o.source?.name ?? o.kind ?? 'impact'}`;
  const ev = { type: 'impact', pos, time, energy: r.energy, dissipated: r.dissipated, force: r.force, impulse: r.impulse, contactTime: r.contactTime, materials: r.materials, mass: r.mu, speed: r.speed, radius: o.radius ?? 0.05, size: o.size, footprint: o.footprint, db: r.sound.db, loudness_dB: r.sound.db, knock: r.knock, damage: r.damage, shock: r.shock?.radius ?? 0, kind: o.kind ?? 'strike', name, silent: !fx.sound };
  if (w.events) {
    w.events.push(ev);
    if (r.shock && fx.shockwave) w.events.push({ type: 'shockwave', pos, time, radius: r.shock.radius, energy: r.energy, loudness_dB: r.sound.db, name });
  }
  if (r.energy > 30) emitSound(w, { pos, loudness_dB: r.sound.db + HEARING_OFFSET_DB, kind: o.noiseKind ?? (r.shock ? 'shockwave' : 'impact'), source: o.source ?? null });
  r.event = ev;
  return r;
}

function hurt(sim, w, e, dmg, zone) {
  if (sim?.ai?.damage && w.enemies?.includes(e)) sim.ai.damage(e, dmg);
  else if (typeof e.damage === 'function') e.damage(dmg, zone);
  else if (e.health !== undefined) {
    if (e.dead) return;
    e.health -= dmg;
    if (e.health <= 0) {
      e.health = 0;
      e.dead = true;
      w.events?.push({ type: 'enemyDown', pos: (e.p ?? e.d.p).slice(), time: w.time ?? 0, name: 'enemy' });
    }
  }
}

/** A person hit hard: staggers (a moment) or goes down (seconds), knocked back along the blow. */
function knockBack(w, e, r, time) {
  const down = r.knock === 'knockdown';
  const until = time + (down ? 2.5 + Math.min(2, r.dv - KNOCK.knockdown) : 0.5 + 0.6 * Math.min(1, r.dv));
  const m = e.d ?? e;
  m.stunnedUntil = Math.max(m.stunnedUntil ?? 0, until);
  if (down) m.knockedDown = until;
  else m.staggered = until;
  m.knock = { v: r.dir.map((c) => c * r.dv), until, down };
  w.events?.push({ type: down ? 'knockdown' : 'stagger', pos: (m.p ?? [0, 0, 0]).slice(), time, name: m.name ?? 'someone' });
}

/** A loose object (w.loose: a drum, a crate) sent flying (ai/dragonAir.js stepThrown lands it). */
function launchLoose(w, o, v, time) {
  if (o.held || len(v) < 0.5) return;
  // with rigid bodies (physics/simPhysics.js) it tumbles and lands as one
  if (w.rigid && !(o.flying && !o.rigid)) {
    w.rigid.knockLoose(o, v);
    return;
  }
  if (o.flying) {
    for (let c = 0; c < 3; c++) o.v[c] += v[c];
    return;
  }
  w.thrown ??= [];
  const vel = [v[0], Math.max(v[1], 1.5 + 0.3 * len(v)), v[2]];
  o.flying = true;
  o.v = vel;
  w.thrown.push({ kind: 'object', ref: o, p: o.p.slice(), v: vel.slice(), t: 0, spin: [v[2] * 0.8, 0.5, -v[0] * 0.8], hop: true, since: time });
}

/**
 * A big impact on the ground: a ring of dust and clods kicked up, people near it staggered (close
 * in, knocked down), loose things jumping; walk/walk.js shakes the camera (shakeAt).
 */
export function shockwave(sim, w, pos, E, R, o = {}) {
  const time = w.time ?? 0;
  const hit = o.target && o.target !== 'ground' ? o.target : null;
  const src = o.source ?? null;
  for (const e of w.enemies ?? []) {
    const m = e.d ?? e;
    if (e === hit || e === src || m.dead || m.held) continue;
    const p = m.p;
    const d = Math.hypot(p[0] - pos[0], (p[1] - pos[1]) * 2, p[2] - pos[2]);
    if (d >= R) continue;
    const s = (1 - d / R) ** 2;
    const dv = 3.2 * s;
    const away = [p[0] - pos[0], 0, p[2] - pos[2]];
    const l = Math.hypot(away[0], away[2]) || 1;
    knockBack(w, e, { knock: dv >= KNOCK.knockdown ? 'knockdown' : 'stagger', dv, dir: [away[0] / l, 0.3, away[2] / l] }, time);
  }
  for (const x of w.loose ?? []) {
    if (x === hit || x.held || x.gone) continue;
    const d = Math.hypot(x.p[0] - pos[0], x.p[2] - pos[2]);
    if (d >= R) continue;
    const s = (1 - d / R) ** 2;
    const k = 3.5 * s * clamp((E / 1e5) ** (1 / 6), 0.5, 2.5);
    const l = d || 1;
    launchLoose(w, x, [((x.p[0] - pos[0]) / l) * k * 0.5, k, ((x.p[2] - pos[2]) / l) * k * 0.5], time);
  }
  // the dust ring and clods: flakes of the ground (render/debris.js draws them; they settle)
  if (Array.isArray(w.debris) && w.mat && w.idx && sim) {
    const h = w.h;
    const gi = groundVoxel(w, pos);
    if (gi >= 0) {
      const n = Math.min(80, Math.round(6 + R * 5));
      const tint = w.tint ? [w.tint[gi * 3], w.tint[gi * 3 + 1], w.tint[gi * 3 + 2]] : [120, 100, 80];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (sim.rand ? sim.rand() : 0.5) * 0.4;
        const r0 = R * 0.15 + (sim.rand ? sim.rand() : 0.5) * R * 0.2;
        const up = 1.5 + Math.sqrt(R) * (0.8 + (sim.rand ? sim.rand() : 0.5));
        w.debris.push({ p: [pos[0] + Math.cos(a) * r0, pos[1] + h * 0.6, pos[2] + Math.sin(a) * r0], v: [Math.cos(a) * up * 0.9, up, Math.sin(a) * up * 0.9], mat: w.mat[gi], temp: w.temp?.[gi] ?? 15, skin: w.skin?.[gi] ?? 15, fuel: 0, moist: 0, melt: 0, char: 0, flags: 0, dens: 1, owner: 0, tint, age: 0, flake: true, dust: true, silent: true });
      }
    }
  }
}

/** The material at / under p (a name for mechanics()): what a foot, a body, a wreck comes down on. */
export function groundMaterial(w, p, water = 0) {
  if (water > 0.3) return 'water';
  if (!w?.mat || !w.idx) return 'soil';
  const i = groundVoxel(w, p);
  if (i < 0) return 'soil';
  const name = MATERIALS[w.mat[i]]?.name ?? 'soil';
  return MATERIALS[w.mat[i]]?.fluidity >= 0.95 ? 'water' : name;
}

function groundVoxel(w, p) {
  const h = w.h;
  const x = Math.floor(p[0] / h), z = Math.floor(p[2] / h);
  if (x < 0 || z < 0 || x >= w.nx || z >= w.nz) return -1;
  for (let y = Math.min(w.ny - 1, Math.floor(p[1] / h) + 1); y >= 0; y--) {
    const i = w.idx(x, y, z);
    if (w.mat[i]) return i;
  }
  return -1;
}

/**
 * A person landing (ai/parkour.js drops and vaults, ai/evade.js rolls, the walk-through's own):
 * from `height` m (v = √(2gh)) or at `speed`; `roll`: spread over a roll (~0.35 s: less force, a
 * softer sound). The harm is left to the caller (damage: false) unless o.damage.
 */
export function bodyLanding(simOrWorld, who, o = {}) {
  const w = simOrWorld?.world ?? simOrWorld;
  const p = who.p ?? who.d?.p;
  if (!p || !w) return null;
  const speed = o.speed ?? Math.sqrt(2 * 9.81 * Math.max(0, o.height ?? 0.5));
  if (speed < 1.5) return null;
  return impact(simOrWorld, { pos: p.slice(), normal: [0, 1, 0], mass: o.mass ?? who.mass ?? PERSON_KG, velocity: [0, -speed, 0], materials: ['flesh', groundMaterial(w, p)], radius: o.roll ? 0.3 : 0.12, contactTime: o.roll ? 0.35 : 0.09, source: who, target: 'ground', kind: 'landing', name: o.name ?? 'a landing', effects: { damage: !!o.damage, crush: false } });
}

/* ---------------- acts: their impact keyframes ---------------- */

/** Force × per act and per object (the rig stage's sliders; impact() multiplies them in). */
export const ACT_FORCE = {};
/** The Force × of an act of kind (the act's own × the object's). */
export const actForce = (kind, act) => (ACT_FORCE[`${kind}:${act}`] ?? 1) * (ACT_FORCE[kind] ?? 1);

/**
 * An act's impact keyframe (rig/objects.js ACT_IMPACTS) as impact() args. ctx: { bodyMass (kg),
 * speed (m/s: the measured contact speed; else decl.v), dir (unit: the part's motion), pos,
 * scale (Force ×), target, kind }.
 */
export function actImpactArgs(decl, ctx = {}) {
  const body = ctx.bodyMass ?? PERSON_KG;
  const mass = decl.mass ?? body * (PART_MASS[decl.part] ?? 0.1);
  const speed = ctx.speed ?? decl.v ?? 3;
  const ground = (decl.target ?? 'ground') === 'ground';
  return {
    pos: ctx.pos ?? [0, 0, 0],
    normal: ground ? [0, 1, 0] : undefined,
    velocity: ctx.dir ? ctx.dir.map((c) => c * speed) : ground ? [0, -speed, 0] : speed,
    mass,
    massB: ground ? Infinity : decl.massB ?? ctx.targetMass,
    materials: [decl.material ?? 'flesh', decl.targetMaterial ?? (ground ? 'soil' : 'flesh')],
    contactTime: decl.contactTime,
    radius: decl.radius ?? (ground ? 0.12 : 0.05),
    footprint: decl.footprint,
    size: decl.size,
    scale: ctx.scale ?? 1,
    zone: decl.zone,
    kind: decl.kind ?? (ground ? 'landing' : 'strike'),
    target: ground ? 'ground' : ctx.target ?? null,
    targetIsPerson: !ground && (decl.target === 'opponent'),
    name: decl.label ?? decl.part,
  };
}
