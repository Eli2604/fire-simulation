/**
 * A smith at work (models/smithy.js): he forges a sword at his charcoal forge, quenches it in the
 * slack tub, tempers and grinds it and puts it in his shop. All of it is the voxel physics:
 *
 * THE FORGE is a fire pot full of forge charcoal voxels (materials.js forgeCoal) burning in the
 * room's air: their glow, the hot gas and the smoke going up the hood and the chimney are the
 * simulation's own (sim/simulation.js combustion, sim/air.js). The bellows blow through the
 * tuyere into the bottom of the bed: each stroke stores ~12 g of air that leaves over ~0.6 s
 * (up to ~15 g/s; the chimney's draught alone draws ~2.5 g/s). That air goes into the air model
 * here (blowTuyere): fresh oxygen into the air cells over the bed and the jet's speed up through
 * them (v = ṁ / (ρ·A_jet)). Forge charcoal burns as fast as air reaches it: its burn rate and
 * the glow of its surface rise with the speed of the air past it (draught / draughtHeat), and it
 * burns only as long as there is oxygen. So with the draught alone the bed holds ~950–1050 °C,
 * on the bellows it climbs towards 1300–1400 °C. The charcoal burns away (to a little ash); the
 * smith tops the pot up from the bin.
 *
 * THE BLADE is a body of steel voxels (sim/movingBody.js): a tang and a blade ~0.72 m long, two
 * voxels wide at its base and one towards the point. Each voxel stands for the steel of its
 * piece of the blade (its density factor: the real cross-section over the voxel's, so a voxel at
 * the point holds a tenth of what one at the base does): the voxel physics conducts heat along
 * it, heats it in the fire (radiation, the hot gas, contact with the glowing charcoal), cools it
 * in the room (radiation, convection) and on the anvil (contact conduction into the anvil's steel
 * voxels). The thin point heats first and cools first. A voxel is 4 cm across but its piece of
 * blade is 3–6 mm thick: so each voxel exchanges heat over its real faces (World.setThin, from
 * swordVoxels' area: its flats width × length, its edges thickness × length), not the voxel's, and
 * against the anvil across a contact conductance (CONTACT: the hammered spot pressed flat on the
 * face, ~3 kW/m²K; the rest held a hair above it, radiation and air across the gap). So it cools
 * from forging heat to working heat in ~20–30 s in the air and ~12–15 s hammered on the anvil, as a
 * real blade of that thickness does (not in ~5 s as 4 cm cubes would). The body goes where the
 * smith's tongs take it (fire, anvil, trough, grindstone, rack), restamped into the grid at the tongs' pose
 * with all its state: its heat goes with it. Its voxels are drawn as a thin blade (render/
 * smithy.js, F_HIDDEN), glowing by each voxel's temperature.
 *
 * THE QUENCH: in the trough the blade lies among water voxels (it pushes the water aside; the
 * water comes back when it is lifted out). Each steel face against water gives its heat to that
 * water voxel at the boiling heat-transfer coefficient (quenchH: a vapour blanket while the steel
 * is over ~450 °C, then violent nucleate boiling, plain convection under 100 °C), on the steel's
 * real surface on that side. Part of it boils water at the steel (more the warmer the water: in
 * cold water most of the bubbles condense again): that steam leaves at the surface of the trough
 * into the air model over it (drawn as steam, heard as the hiss), the water mass is debited; the
 * rest warms the water voxel, and the trough's water mixes (natural convection, faster while the
 * smith works the blade about in it).
 *
 * HARDNESS (each voxel on its own, from its own temperature): above ~780 °C the steel is
 * austenite; how fast it then cools through 800 → 500 °C (t8/5) decides what it becomes:
 * quenched in a few seconds it is martensite (~64 HRC, brittle), cooled in air over tens of
 * seconds soft pearlite (~18 HRC). f = 1 / (1 + (t8/5 / 4 s)⁴). Tempering (reheated to
 * 200–330 °C) trades hardness for toughness: HRC = 18 + 47 f − 0.09 f (T_temper − 150). The
 * blade's hardness is the mean over its voxels; its edge (the thin point third) and its base are
 * told apart.
 *
 * THE SMITH works in a cycle: the blank into the fire, the bellows until it is at forging heat
 * (yellow-orange), to the anvil with the tongs to hammer it until it is down to working heat (dull
 * cherry), back into the fire; shaped, once more to cherry red and into the slack tub; tempered
 * over the fire to its temper colour, ground, and up on the rack in the shop to cool: once cold it
 * joins the finished weapons on display (drawn only). He tops up the charcoal when the pot runs
 * low. The hammer blows are impacts (sim/impact.js style events, heard by audio/smithSound.js:
 * the anvil's ring, the blade's dull hot thud or bright cold ring, scale spattering off).
 *
 * The bellows can be worked by anyone standing at the lever (E in the walk-through: useSmithy()).
 */
import { O2_AIR, F_ANCHOR, F_HIDDEN, F_BURNING } from './world.js';
import { MAT, MATERIALS } from './materials.js';
import { makeMovingBody, restamp, needsRestamp } from './movingBody.js';

const LV = 2.257e6; // J/kg, water
const SIGMA = 5.670374e-8;
const CW = 4186;
const RHO_AIR = 1.2;

export const FORGE = {
  draught: 0.0025, // kg/s of air through the tuyere by the chimney's draught alone
  stroke: 0.012, // kg of air per stroke of the bellows
  blastMax: 0.015, // kg/s the bellows can blow through the tuyere
  jet: 0.004, // m²: the tuyere's jet where it comes up into the bed (~7 cm across)
  restock: 0.85, // he tops the pot up when this share of its charcoal voxels is left (the heart burns out first)
};

export const HEATS = {
  forging: 1000, // °C: forging heat (yellow-orange) over the part of the blade in the fire
  working: 760, // °C: below this he stops hammering (dull cherry)
  hardening: 830, // °C: heated to this to quench (cherry, just above the steel's Ac3)
  austenite: 780, // °C: above this the steel is austenite (hardenable)
  pumpForge: 1250, // he keeps the bed at least this hot while he forges
  pumpHarden: 1050,
  cold: 60, // °C: the quenched blade is cold; a blade on the rack this cool joins the display
  burning: 1250, // °C: steel this hot starts to burn (sparkles, scale): he takes it out of the fire
};

/**
 * What he makes (the sword is the one he forges here: its voxels; the others stock the shop).
 * heats: how many heats a journeyman takes to shape it from its blank (drawing out the point, the
 * bevels, the distal taper, straightening); a heat is ~12–15 s and ~15–18 blows on this thin blade.
 */
export const WEAPONS = [
  { kind: 'sword', label: 'sword', heats: 8, temper: 290 },
  { kind: 'axe', label: 'axe', heats: 6, temper: 250 },
  { kind: 'spear', label: 'spear', heats: 5, temper: 270 },
  { kind: 'dagger', label: 'dagger', heats: 4, temper: 240 },
];

/**
 * The sword blank as voxels at voxel size h: [{ x, z (body frame, m), dens, part ('tang' |
 * 'blade'), s (0 at the base .. 1 at the point), width (m of steel across this voxel), thick (m) }].
 * The body frame: x along the blade (0 at the tang's end, the point at +x), y through its flat,
 * z across it.
 */
export function swordVoxels(h) {
  const out = [];
  const nTang = Math.max(2, Math.round(0.12 / h));
  const nBlade = Math.max(6, Math.round(0.72 / h));
  const wide = Math.max(1, Math.round((0.4 * nBlade)));
  for (let k = 0; k < nTang; k++) out.push({ x: k * h, z: 0, part: 'tang', s: 0, width: Math.min(h, 0.025), thick: 0.007 });
  for (let j = 0; j < nBlade; j++) {
    const s = (j + 0.5) / nBlade;
    const W = 0.055 - 0.043 * s ** 1.6; // m: 5.5 cm at the base to ~1.2 cm at the point
    // (as forged, before the grinding takes the bevels down: 6.5 mm at the base to 3 mm at the point)
    const t = 0.0065 - 0.0035 * s;
    const nw = j < wide && W > h * 1.05 ? 2 : 1;
    for (let q = 0; q < nw; q++) out.push({ x: (nTang + j) * h, z: q * h, part: 'blade', s, width: W / nw, thick: t });
  }
  for (const v of out) {
    v.dens = Math.min(1, (v.width * v.thick) / (h * h));
    // its real faces over the voxel's (World.setThin), in the body frame: its end (width ×
    // thickness), its flats (width × length) and its edges (thickness × length)
    v.area = [Math.min(1, (v.width * v.thick) / (h * h)), v.width / h, v.thick / h];
  }
  return out;
}

/**
 * The blade's heat exchange over its real geometry (World.setThin: convection, radiation and
 * contact over its real faces, not the voxel's): the contact conductance of its faces against
 * what it lies on (W/m²K). On the anvil only the section under the hammer is pressed flat on the
 * face (hot steel with its scale on steel: ~1–5 kW/m²K); the rest of what lies over the face is
 * held a hair off it by the smith's tongs (a gap of a mm or so: radiation and air across it).
 */
export const CONTACT = {
  press: 3000, // W/m²K: pressed flat on the anvil's face under the hammer
  gap: 120, // W/m²K: over the face, not pressed (εσ(T⁴−T_anvil⁴)/ΔT ≈ 100 at forging heat, + air across ~2 mm)
  rest: 500, // W/m²K: lying loosely on anything else (the charcoal, the rack)
  spot: 1, // voxels pressed at a time (the hammer's face covers ~4 cm of the blade)
  blowsPerSpot: 3, // blows on a spot before he moves the blade along under the hammer
};

const WORK = 0.35; // the blade's working length: from this share of it to the point (in the fire's heart)
const WALK = 1.0; // m/s
const BLOW = 0.6; // s between hammer blows
// a heat's work in blows at full forging heat (from forging heat down to working heat, ~12–15 s on
// the thin blade, he strikes ~15–18 blows, the cooler the steel the less each moves it): with
// WEAPONS[].heats heats at a journeyman's skill the blade is shaped
const HEAT_BLOWS = 9.5;
const STROKE = 1.1; // s a stroke of the bellows
const SHOP_SLOTS = 14;

/** Specific heat of steel (J/(kg·K)), rising with temperature (a mean over the magnetic peak). */
export const steelCp = (T) => Math.min(760, 450 + 0.3 * Math.max(0, T));

/** Martensite fraction from the time (s) it took to cool from 800 to 500 °C. */
export const martensite = (t85) => 1 / (1 + (Math.max(0, t85) / 4) ** 4);

/** Rockwell C hardness from a martensite fraction and the temper it had. */
export function hardnessOf(b) {
  const f = b.martensite ?? 0;
  const tempered = Math.max(0, (b.temperMax ?? 0) - 150);
  return 18 + 47 * f - 0.09 * f * tempered;
}

/** The temper colour a steel surface shows after being at T °C. */
export function temperColour(T) {
  if (T < 200) return 'bright';
  if (T < 240) return 'straw';
  if (T < 265) return 'bronze';
  if (T < 285) return 'purple';
  if (T < 310) return 'blue';
  if (T < 340) return 'grey-blue';
  return 'grey';
}

/** The glow colour a smith reads off hot steel. */
export function heatColour(T) {
  if (T < 480) return 'black';
  if (T < 580) return 'faint red';
  if (T < 680) return 'blood red';
  if (T < 780) return 'dull cherry';
  if (T < 880) return 'cherry';
  if (T < 980) return 'orange';
  if (T < 1100) return 'yellow-orange';
  if (T < 1250) return 'yellow';
  return 'white';
}

/** Boiling heat-transfer coefficient (W/m²K) of steel at T in water. */
export function quenchH(T) {
  if (T > 450) return 2500; // vapour blanket (film boiling; the smith works the blade about to break it up)
  if (T > 100) return 12000; // nucleate boiling
  return 1500;
}

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A smithy record (built by models/smithy.js) placed in the world: its points in world coordinates. */
export function placeSmithy(s, toWorld, rot, owner, Ta = 20) {
  const st = {};
  for (const [k, v] of Object.entries(s.stations)) st[k] = Object.fromEntries(Object.entries(v).map(([n, q]) => [n, toWorld(...q)]));
  const box = (b) => {
    const a = toWorld(...b.min);
    const c = toWorld(...b.max);
    return { min: a.map((v, k) => Math.min(v, c[k])), max: a.map((v, k) => Math.max(v, c[k])) };
  };
  const dir = (p, d) => {
    const a = toWorld(...p);
    const b = toWorld(p[0] + d[0], p[1] + d[1], p[2] + d[2]);
    return norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  };
  const poses = {};
  for (const [k, q] of Object.entries(s.poses ?? {})) poses[k] = { p: toWorld(...q.p), dir: dir(q.p, q.dir), up: dir(q.p, q.up ?? [0, 1, 0]) };
  const S = {
    owner,
    heading: rot,
    fire: toWorld(...s.fire),
    stations: st,
    poses,
    pot: s.pot ? { ...box(s.pot), groove: box(s.pot.groove), tuyere: toWorld(...(s.pot.tuyere ?? s.fire)), heart: s.pot.heart ?? 0.2 } : null,
    waypoints: s.waypoints ? Object.fromEntries(Object.entries(s.waypoints).map(([k, q]) => [k, toWorld(...q)])) : null,
    bellowsBox: toWorld(...s.bellowsBox.p),
    trough: box(s.trough),
    slots: s.rackSlots.map((r) => ({ ...r, p: toWorld(...r.p) })),
    init: { coal: s.coal, fireTemp: s.fireTemp, smith: s.smith, weapons: s.weapons, pace: s.pace, skill: s.skill },
  };
  return initSmithy(S, Ta);
}

/** The state of a smithy at the start (forge, smith, shop). */
export function initSmithy(S, Ta = 20) {
  const I = S.init ?? {};
  S.forge = { T: Ta, coal: 0, coal0: 0, blast: 0, air: FORGE.draught, jet: 0, burn: 0, combustion: 0, strokes: 0, voxels: 0, burning: 0, heartQ: 0, o2: O2_AIR, faces: [] };
  S.weapons = [];
  S.made = 0;
  S.sold = 0;
  S.time = 0;
  S.sparks = 0;
  for (let k = 0; k < (I.weapons ?? 0); k++) shelve(S, { kind: WEAPONS[k % WEAPONS.length].kind, hardness: 55 + (k % 3), temper: WEAPONS[k % WEAPONS.length].temper, made: -1 });
  const st = S.stations;
  S.pace = I.pace ?? 1;
  S.skill = I.skill ?? 0.5;
  S.smith = I.smith === false ? null : { p: st.forge.p.slice(), yaw: yawTo(st.forge.p, st.forge.face), state: 'start', t: 0, path: null, then: null, pose: 'stand', phase: 0, blows: 0 };
  S.blade = null;
  S.cooling = []; // finished blades (their voxels) cooling on the rack
  S.water = { voxels: null, T: Ta, steam: 0, heat: 0, steamRate: 0, mass: 0 };
  S.ready = true;
  return S;
}

function yawTo(a, b) {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

function shelve(S, wpn) {
  const used = new Set(S.weapons.map((x) => x.slot));
  let slot = -1;
  for (let k = 0; k < S.slots.length && k < SHOP_SLOTS; k++)
    if (!used.has(k)) {
      slot = k;
      break;
    }
  if (slot < 0) {
    // full: the oldest has been sold
    const old = S.weapons.shift();
    S.sold++;
    slot = old.slot;
  }
  S.weapons.push({ ...wpn, slot });
}

/** A new sword blank (its voxels are made in the world: makeBlade). */
export function newBlade(S, Ta) {
  const W = WEAPONS[0];
  return { kind: W.kind, label: W.label, heats: W.heats, temperTarget: W.temper, T: Ta, Tmax: Ta, tip: Ta, base: Ta, Tpeak: Ta, progress: 0, heat: 0, stage: 'forge', place: 'stock', quenched: false, martensite: 0, temperMax: 0, hardness: 18, body: null };
}

// ------------------------------------------------------------------ the blade's pose

const snapAxis = (v) => {
  const a = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
  const o = [0, 0, 0];
  o[k] = Math.sign(v[k]) || 1;
  return o;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A pose { p, R } from the tang end's centre and the way the point goes (axes snapped: the voxels map one to one). */
export function poseOf(p, dir, up, h) {
  const X = snapAxis(dir);
  let Y = snapAxis(up);
  if (Math.abs(X[0] * Y[0] + X[1] * Y[1] + X[2] * Y[2]) > 0.5) Y = Math.abs(X[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
  const Z = cross(X, Y);
  const c = (v) => (Math.floor(v / h) + 0.5) * h;
  return { p: [c(p[0]), c(p[1]), c(p[2])], R: [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]] };
}

/** Where the blade is to be: at a station (the model's poses), or in the tongs in front of the smith. */
export function bladePose(S, place, h) {
  const q = S.poses?.[place];
  if (q) return poseOf(q.p, q.dir, q.up, h);
  const sm = S.smith;
  const p = sm ? sm.p : S.stations.forge.p;
  const yaw = sm ? sm.yaw : 0;
  // (yaw snapped to the axes: the voxels go over one to one)
  const f = snapAxis([Math.sin(yaw), 0, Math.cos(yaw)]);
  return poseOf([p[0] + f[0] * 0.3, p[1] + 0.94, p[2] + f[2] * 0.3], f, [0, 1, 0], h);
}

/** The blade's voxels made in the world at its stock pose (null when something is in the way). */
function makeBlade(w, S, b) {
  const h = w.h;
  const spec = swordVoxels(h);
  const pose = bladePose(S, 'stock', h);
  const R = pose.R;
  const cells = [];
  for (const v of spec) {
    const x = pose.p[0] + R[0] * v.x + R[2] * v.z;
    const y = pose.p[1] + R[3] * v.x + R[5] * v.z;
    const z = pose.p[2] + R[6] * v.x + R[8] * v.z;
    const c = w.voxelAt(x, y, z);
    if (c < 0 || w.mat[c]) return null;
    cells.push(c);
  }
  const sd = w.structureDirty;
  cells.forEach((c, k) => w.setVoxel(c, MAT.steel, { temp: w.ambient, density: spec[k].dens, anchored: true, hidden: true, color: [0.2, 0.19, 0.19], variation: 0.02 }));
  w.structureDirty = sd;
  const local = new Map(cells.map((c, k) => [c, [spec[k].x, 0, spec[k].z]]));
  const B = makeMovingBody(w, cells, (i) => local.get(i), { pose, tags: (k) => (spec[k].part === 'tang' ? 1 : 2) });
  b.spec = spec;
  b.body = B;
  b.poseAt = 'stock';
  b.restampT = -1;
  const n = spec.length;
  b.vox = { aus: new Uint8Array(n), t800: new Float32Array(n).fill(-1), mart: new Float32Array(n), armed: new Uint8Array(n), temperMax: new Float32Array(n), T: new Float32Array(n).fill(w.ambient) };
  return B;
}

/** Voxel k's temperature (in the grid, or as held off it). */
function voxT(w, B, k) {
  const c = B.at[k];
  return c >= 0 && w.mat[c] === B.s.mat[k] ? w.temp[c] : B.s.temp[k];
}

/** Move the blade's voxels where it is to be (not every frame while it is carried). */
function placeBody(w, S, b, force = false) {
  const B = b.body;
  if (!B) return;
  const pose = bladePose(S, b.place, w.h);
  const station = !!S.poses?.[b.place];
  const moved = b.poseAt !== b.place;
  if (!moved && !force && !needsRestamp(B, pose, w.h, 0.5)) return;
  if (!moved && !station && w.time - b.restampT < 0.25) return; // (in the tongs: a few times a second)
  for (const c of B.cells) w.clearThin(c); // (its real geometry goes with it: bladeThin)
  const fromWater = b.poseAt === 'water';
  restamp(w, B, pose, {
    displace: (m) => m === MAT.water,
    ...(fromWater ? { refill: { mat: MAT.water, below: S.trough.max[1] + 0.001, temp: S.water.T } } : {}),
  });
  if (fromWater) S.water.voxels = null; // (the water voxels are where they are now)
  b.poseAt = b.place;
  b.restampT = w.time;
}

/** The world axis (0 x, 1 y, 2 z) that body axis a lies along at rotation R. */
function worldAxis(R, a) {
  let best = 0;
  for (let r = 1; r < 3; r++) if (Math.abs(R[3 * r + a]) > Math.abs(R[3 * best + a])) best = r;
  return best;
}

/**
 * The blade's voxels as the thin blade they are for heat exchange (World.setThin): each voxel's
 * real faces at its pose, and its contact with what it lies on (CONTACT). On the anvil while he
 * hammers, the section under the hammer is pressed flat on the face; he moves the blade along
 * under the hammer every few blows (b.blows). → the world point of the hammered spot (or null).
 */
function bladeThin(w, S, b, hammering) {
  const B = b.body;
  if (!B) return null;
  const R = B.pose.R;
  const wa = [worldAxis(R, 0), worldAxis(R, 1), worldAxis(R, 2)];
  const h = w.h;
  // the voxels lying over the anvil's face (on a solid that is not the blade), base to point
  let pressed = null;
  let spotAt = null;
  if (hammering) {
    const on = [];
    for (let k = 0; k < B.n; k++) {
      const c = B.at[k];
      if (c < 0 || w.mat[c] !== B.s.mat[k] || b.spec[k].part !== 'blade') continue;
      const below = c - w.nx;
      if (below >= 0 && w.mat[below] && !B.cells.has(below)) on.push(k);
    }
    if (on.length) {
      // (the working length first: the part he heats and works)
      const work = on.filter((k) => b.spec[k].s >= WORK);
      const list = work.length ? work : on;
      // he works along it and back: one spot per few blows
      const n = Math.max(1, Math.ceil(list.length / CONTACT.spot));
      const step = Math.floor((b.blows ?? 0) / CONTACT.blowsPerSpot) % (2 * n);
      const at = step < n ? step : 2 * n - 1 - step;
      pressed = new Set(list.slice(at * CONTACT.spot, at * CONTACT.spot + CONTACT.spot));
      const k0 = list[at * CONTACT.spot];
      const c = B.at[k0];
      const [x, y, z] = w.coords(c);
      spotAt = [(x + 0.5) * h, y * h, (z + 0.5) * h];
    }
  }
  const f = [1, 1, 1];
  for (let k = 0; k < B.n; k++) {
    const c = B.at[k];
    if (c < 0 || w.mat[c] !== B.s.mat[k]) continue;
    const a = b.spec[k].area;
    f[wa[0]] = a[0];
    f[wa[1]] = a[1];
    f[wa[2]] = a[2];
    const hc = b.place !== 'anvil' ? CONTACT.rest : pressed?.has(k) ? CONTACT.press : CONTACT.gap;
    w.setThin(c, f[0], f[1], f[2], hc);
  }
  return spotAt;
}

// ------------------------------------------------------------------ the forge in the air model

/** The pot's cells (charcoal and the groove) and the air cells over the bed (found once). */
function potCells(w, S) {
  if (S.potList) return S.potList;
  const h = w.h;
  const { min, max, groove } = S.pot;
  const cells = [];
  const grooveCells = new Set();
  const air = new Set();
  const inG = (x, y, z) => x >= groove.min[0] && x <= groove.max[0] && y >= groove.min[1] && y <= groove.max[1] && z >= groove.min[2] && z <= groove.max[2];
  for (let x = Math.floor(min[0] / h); x <= Math.floor(max[0] / h); x++)
    for (let y = Math.floor(min[1] / h); y <= Math.floor(max[1] / h); y++)
      for (let z = Math.floor(min[2] / h); z <= Math.floor(max[2] / h); z++) {
        if (!w.inBounds(x, y, z)) continue;
        const i = w.idx(x, y, z);
        const c = w.center(x, y, z);
        if (inG(...c)) grooveCells.add(i);
        else cells.push(i);
      }
  // the air the tuyere's blast comes up through: the cells over the heart of the bed
  const yTop = Math.floor(max[1] / h);
  const tu = S.pot.tuyere;
  const heart = (x, z) => Math.hypot((x + 0.5) * h - tu[0], (z + 0.5) * h - tu[2]) <= S.pot.heart;
  for (const i of [...cells, ...grooveCells]) {
    const [x, y, z] = w.coords(i);
    if (y >= yTop - 1 && heart(x, z)) for (const dy of [0, 1, 2]) if (y + dy < w.ny) air.add(w.airIndexOfVoxel(x, y + dy, z));
  }
  const heartCells = cells.filter((i) => {
    const [x, , z] = w.coords(i);
    return heart(x, z);
  });
  S.potList = { cells, groove: grooveCells, air: [...air], heart: new Set(air), heartCells };
  return S.potList;
}

/** Air through the tuyere this instant (kg/s); the bellows' store blowing out over dt. */
function airFlow(F, dt) {
  // (the stroke's air leaves the bellows over ~0.6 s, as fast as the tuyere lets it)
  const rate = Math.min(FORGE.blastMax, F.blast / 0.6);
  const used = Math.min(F.blast, rate * dt);
  F.blast -= used;
  return FORGE.draught + used / Math.max(dt, 1e-9);
}

/**
 * The tuyere's air into the air model: the jet's speed up through the bed and the cells over it
 * (the forge charcoal burns faster and hotter in it), and its fresh air (its oxygen) into the gas
 * at the glowing surfaces it comes up past (the air cells in front of the charcoal: readForge).
 */
function blowTuyere(w, S, mAir, dt) {
  const { air } = potCells(w, S);
  if (!air.length) return;
  const v = mAir / (RHO_AIR * FORGE.jet);
  // (the blown air's speed through the heart: what the forge charcoal burns by, simulation.js)
  if (!w.forcedAir || w.forcedAir.length !== w.NA) w.forcedAir = new Float32Array(w.NA);
  for (const a of air) {
    if (w.vy[a] < v) w.vy[a] = v;
    w.forcedAir[a] = v;
    if (w.airAwake) w.airAwake[a] = 1;
  }
  // the gas at the heart's glowing surfaces is the jet's air less what of its oxygen they burn
  // (13.1 MJ of heat per kg of oxygen): the more air, the more oxygen is left to burn faster
  const fed = S.forge.faces ?? [];
  const used = Math.min(1, S.forge.heartQ / 13.1e6 / Math.max(1e-9, mAir * O2_AIR));
  const o2 = O2_AIR * (1 - used);
  for (const a of fed) if (w.o2[a] < o2) w.o2[a] = o2;
  S.forge.jet = v;
  S.forge.o2 = o2;
}

/**
 * The tuyere's air through the bed: a bed of lump charcoal is porous, so in the heart of the fire
 * the blast reaches the charcoal inside it too, not only its top (the voxel physics burns a
 * voxel's open faces only). Each buried charcoal voxel in the heart burns as the forge charcoal
 * does on a face in that blast (materials.js forgeCoal: its rate and its glow rising with the
 * jet's speed) and in the oxygen left in the jet; most of its heat keeps it glowing, the rest goes
 * up with the gas into the air over the bed. Burnt out, it is ash. → W released.
 */
function burnBed(w, S, dt) {
  const { heartCells, air } = potCells(w, S);
  const coal = MAT.forgeCoal;
  const M = MATERIALS[coal];
  const F = S.forge;
  const v = F.jet ?? 0;
  const ox = Math.min(1, (F.o2 ?? O2_AIR) / O2_AIR);
  const cap = Math.min(M.maxBlastTemp, M.maxBurnTemp + M.draughtHeat * v);
  const A = w.h * w.h;
  const V = A * w.h;
  let Q = 0;
  const ash = [];
  for (const i of heartCells) {
    if (w.mat[i] !== coal || w.expo[i] > 0 || w.temp[i] < M.ignitionTemp) continue;
    const m0 = M.density * w.dens[i] * V * (1 - M.residue);
    const tf = Math.min(1.2, 0.6 + (w.temp[i] - M.ignitionTemp) / 500);
    const dm = Math.min(w.fuel[i] * m0, M.burnRate * A * tf * (1 + M.draught * v) * ox * dt);
    const E = dm * M.heatOfCombustion;
    w.fuel[i] -= dm / m0;
    const C = M.density * w.dens[i] * V * M.specificHeat * Math.max(0.05, M.residue + (1 - M.residue) * w.fuel[i]);
    const keep = Math.min(E * M.selfHeating, Math.max(0, (cap - w.temp[i]) * C));
    w.temp[i] += keep / C;
    w.skin[i] = w.temp[i];
    w.hrr[i] = E / dt;
    Q += E;
    // the rest up with the gas (into the air over the heart)
    const rest = (E - keep) / air.length;
    for (const a of air) w.airT[a] += rest / (1.2 * w.ah ** 3 * Math.max(0.1, 1 - w.occ[a]) * 1005);
    if (w.fuel[i] <= 1e-6) ash.push(i);
  }
  for (const i of ash) {
    const sd = w.structureDirty;
    w.setVoxel(i, MAT.ash, { temp: w.temp[i] });
    w.structureDirty = sd;
  }
  return Q / dt;
}

/** The fire as its voxels have it: the charcoal left, how hot the glowing bed is, what it burns. */
function readForge(w, S) {
  const F = S.forge;
  const { cells } = potCells(w, S);
  const coal = MAT.forgeCoal;
  const M = MATERIALS[coal];
  const V = w.h ** 3;
  let kg = 0, n = 0, nb = 0, Tb = 0, q = 0, Tall = 0, qh = 0;
  const faces = new Set();
  for (const i of cells) {
    if (w.mat[i] !== coal) continue;
    n++;
    const inHeart = w.expo[i] > 0 && S.potList.heart.has(w.faceAir[i]);
    if (inHeart) {
      faces.add(w.faceAir[i]);
      qh += w.hrr[i];
    }
    kg += M.density * w.dens[i] * V * (M.residue + (1 - M.residue) * w.fuel[i]);
    Tall += w.skin[i];
    if (w.flags[i] & F_BURNING || w.hrr[i] > 0) {
      nb++;
      Tb += w.skin[i];
      q += w.hrr[i];
    }
  }
  F.faces = [...faces];
  F.heartQ = qh + (F.inBed ?? 0);
  F.coal = kg;
  if (!F.coal0) F.coal0 = kg;
  F.voxels = n;
  if (!F.voxels0) F.voxels0 = n;
  F.burning = nb;
  F.T = nb ? Tb / nb : n ? Tall / n : w.ambient;
  F.combustion = q;
  F.burn = q / M.heatOfCombustion;
}

/** The smith tops up the pot: fresh charcoal where it has burnt away (not in the blade's groove). */
function restock(w, S) {
  const { cells } = potCells(w, S);
  let n = 0;
  const sd = w.structureDirty;
  for (const i of cells) {
    const m = w.mat[i];
    if (m && m !== MAT.ash) continue;
    if (m === MAT.ash) w.clearVoxel(i);
    w.setVoxel(i, MAT.forgeCoal, { temp: w.ambient + 10, anchored: true, color: [0.08, 0.075, 0.07], variation: 0.25 });
    n++;
  }
  w.structureDirty = sd;
  return n;
}

// ------------------------------------------------------------------ the quench

/** The trough's water voxels (found once, then while they are there). */
function troughWater(w, S) {
  if (S.water.voxels) return (S.water.voxels = S.water.voxels.filter((i) => w.mat[i] === MAT.water));
  const out = [];
  const h = w.h;
  const { min, max } = S.trough;
  for (let x = Math.floor(min[0] / h); x <= Math.floor(max[0] / h); x++)
    for (let y = Math.floor(min[1] / h); y <= Math.floor(max[1] / h); y++)
      for (let z = Math.floor(min[2] / h); z <= Math.floor(max[2] / h); z++) {
        if (!w.inBounds(x, y, z)) continue;
        const i = w.idx(x, y, z);
        if (w.mat[i] === MAT.water) out.push(i);
      }
  S.water.voxels = out;
  return out;
}

/** The air cell over the water surface of the trough column of voxel i (where its steam comes out). */
function surfaceAir(w, i) {
  let [x, y, z] = w.coords(i);
  while (y + 1 < w.ny && w.mat[w.idx(x, y + 1, z)] === MAT.water) y++;
  return w.airIndexOfVoxel(x, Math.min(w.ny - 1, y + 1), z);
}

const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Heat from the blade's steel voxels into the water voxels they touch (see the top): → { J, kg }
 * this step (the heat given, the steam boiled off).
 */
function quench(w, S, b, dt) {
  const B = b.body;
  const R = B.pose.R;
  const h = w.h;
  const V = h ** 3;
  const Y = [R[1], R[4], R[7]]; // the blade's flat faces look this way
  const Xb = [R[0], R[3], R[6]]; // along it
  let J = 0, kg = 0;
  for (let k = 0; k < B.n; k++) {
    const c = B.at[k];
    if (c < 0 || w.mat[c] !== MAT.steel) continue;
    const v = b.spec[k];
    const [x, y, z] = w.coords(c);
    for (const d of NB) {
      const X = x + d[0], Yy = y + d[1], Z = z + d[2];
      if (!w.inBounds(X, Yy, Z)) continue;
      const j = w.idx(X, Yy, Z);
      if (w.mat[j] !== MAT.water) continue;
      const Tb = w.temp[c];
      const Tw = w.temp[j];
      if (Tb <= Tw) continue;
      // the steel's real surface on that side: its flat (width × length), its edge (thickness ×
      // length), its end (width × thickness)
      const dotY = Math.abs(d[0] * Y[0] + d[1] * Y[1] + d[2] * Y[2]);
      const dotX = Math.abs(d[0] * Xb[0] + d[1] * Xb[1] + d[2] * Xb[2]);
      const A = dotY > 0.5 ? v.width * h : dotX > 0.5 ? v.width * v.thick : v.thick * h;
      const G = quenchH(Tb) * A;
      const Cb = 7850 * w.dens[c] * V * steelCp(Tb);
      const Cw = 1000 * Math.max(0.05, w.fuel[j]) * V * CW;
      const E = ((Tb - Tw) * G * dt) / (1 + G * dt * (1 / Cb + 1 / Cw));
      w.temp[c] -= E / Cb;
      w.skin[c] = w.temp[c];
      // boiling at the steel: in cold water most bubbles condense again (that heat stays in the
      // water), near the boil they reach the surface as steam
      const beta = Tb > 100 ? 0.06 + 0.94 * Math.min(1, Math.max(0, (Tw - 55) / 45)) : 0;
      const m = Math.min((beta * E) / (LV + CW * Math.max(0, 100 - Tw)), w.fuel[j] * 1000 * V * 0.5);
      const Ew = E - m * (LV + CW * Math.max(0, 100 - Tw));
      w.temp[j] += Ew / Cw;
      w.skin[j] = w.temp[j];
      if (m > 0) {
        w.fuel[j] -= m / (1000 * V);
        w.steam[surfaceAir(w, j)] += m;
        kg += m;
      }
      J += E;
    }
  }
  return { J, kg };
}

/**
 * In the fire: the glowing charcoal round the blade (the voxels it lies against) radiates into it
 * across the gaps between the lumps (a bed of charcoal is porous: the steel sees the glow on all
 * sides, εσ(T_coal⁴ − T_steel⁴) on its real surface on that side), beside what the voxel physics
 * gives it on its open faces (the hot gas, the flames, the radiation in the air cells). → W into
 * the blade.
 */
function bedRadiation(w, b, dt) {
  const B = b.body;
  const R = B.pose.R;
  const h = w.h;
  const V = h ** 3;
  const Y = [R[1], R[4], R[7]];
  const Xb = [R[0], R[3], R[6]];
  const coal = MAT.forgeCoal;
  const Cc = MATERIALS[coal].density * MATERIALS[coal].specificHeat * V;
  let P = 0;
  for (let k = 0; k < B.n; k++) {
    const c = B.at[k];
    if (c < 0 || w.mat[c] !== MAT.steel) continue;
    const v = b.spec[k];
    const [x, y, z] = w.coords(c);
    for (const d of NB) {
      const X = x + d[0], Yy = y + d[1], Z = z + d[2];
      if (!w.inBounds(X, Yy, Z)) continue;
      const j = w.idx(X, Yy, Z);
      if (w.mat[j] !== coal) continue;
      const Tc = w.skin[j];
      const Tb = w.temp[c];
      const dotY = Math.abs(d[0] * Y[0] + d[1] * Y[1] + d[2] * Y[2]);
      const dotX = Math.abs(d[0] * Xb[0] + d[1] * Xb[1] + d[2] * Xb[2]);
      const A = dotY > 0.5 ? v.width * h : dotX > 0.5 ? v.width * v.thick : Math.max(v.thick, 0.3 * h) * h;
      const Tk = Tc + 273.15, Sk = Tb + 273.15;
      const q = 0.7 * SIGMA * A * (Tk ** 4 - Sk ** 4);
      const G = 4 * 0.7 * SIGMA * A * Math.max(Tk, Sk) ** 3;
      const Cb = 7850 * w.dens[c] * V * steelCp(Tb);
      const Cj = Cc * Math.max(0.05, w.dens[j]);
      const E = (q * dt) / (1 + G * dt * (1 / Cb + 1 / Cj));
      w.temp[c] += E / Cb;
      w.skin[c] = w.temp[c];
      w.skin[j] -= E / Cj;
      w.temp[j] -= (0.3 * E) / Cj;
      P += E / dt;
    }
  }
  return P;
}

/**
 * The slack tub is tight: what its water wets of its soaked staves stays in them. (sim/water.js
 * wets every solid a water voxel touches, and what a voxel cannot soak up runs off into puddles
 * on the floor: from a tub standing full for minutes that grew into a flood that reached the
 * hearth and the fire pot. The run-off from the tub's columns is dropped.)
 */
function keepTubTight(w, S) {
  if (!w.runoff) return;
  const h = w.h;
  const { min, max } = S.trough;
  const x0 = Math.max(0, Math.floor(min[0] / h) - 2), x1 = Math.min(w.nx - 1, Math.floor(max[0] / h) + 2);
  const z0 = Math.max(0, Math.floor(min[2] / h) - 2), z1 = Math.min(w.nz - 1, Math.floor(max[2] / h) + 2);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) w.runoff[x + w.nx * z] = 0;
}

/** The trough's water mixing (natural convection; faster while the blade is worked in it). */
function mixTrough(w, water, dt, tau) {
  if (water.length < 2) return 0;
  let s = 0;
  for (const i of water) s += w.temp[i];
  const mean = s / water.length;
  const f = 1 - Math.exp(-dt / tau);
  for (const i of water) {
    w.temp[i] += (mean - w.temp[i]) * f;
    w.skin[i] = w.temp[i];
  }
  return mean;
}

// ------------------------------------------------------------------ the steel's structure

/** Each voxel's austenite → martensite / pearlite and its temper, from its own temperature. */
function metallurgy(w, S, b) {
  const B = b.body;
  const X = b.vox;
  let n = 0, sum = 0, mx = -Infinity, tipS = 0, tipN = 0, baseS = 0, baseN = 0, mart = 0, tmp = 0, hard = 0, edgeH = 0, edgeN = 0;
  for (let k = 0; k < B.n; k++) {
    if (!B.s.mat[k]) continue;
    const T0 = X.T[k];
    const T = voxT(w, B, k);
    X.T[k] = T;
    if (T >= HEATS.austenite) {
      X.aus[k] = 1;
      X.temperMax[k] = 0;
      X.armed[k] = 0;
    }
    if (X.aus[k] && T0 >= 800 && T < 800) X.t800[k] = S.time;
    if (X.aus[k] && X.t800[k] >= 0 && T0 >= 500 && T < 500) {
      X.mart[k] = martensite(S.time - X.t800[k]);
      X.aus[k] = 0;
      X.t800[k] = -1;
    }
    if (!X.aus[k] && X.mart[k] > 0) {
      if (T < 150) X.armed[k] = 1;
      if (X.armed[k] && T > X.temperMax[k]) X.temperMax[k] = T;
    }
    const v = b.spec[k];
    if (v.part !== 'blade') continue;
    if (T > mx) mx = T;
    if (v.s > 0.85) {
      tipS += T;
      tipN++;
    }
    if (v.s < 0.2) {
      baseS += T;
      baseN++;
    }
    // (the working length: the part he heats in the fire and works; the base by the tang is
    // reported apart)
    if (v.s < WORK) continue;
    n++;
    sum += T;
    const hk = hardnessOf({ martensite: X.mart[k], temperMax: X.temperMax[k] });
    mart += X.mart[k];
    tmp += X.temperMax[k];
    hard += hk;
    if (v.s > 0.6) {
      edgeH += hk;
      edgeN++;
    }
  }
  if (!n) return;
  b.T = sum / n;
  b.Tpeak = mx;
  b.tip = tipN ? tipS / tipN : b.T;
  b.base = baseN ? baseS / baseN : b.T;
  if (b.T > b.Tmax) b.Tmax = b.T;
  b.martensite = mart / n;
  b.temperMax = tmp / n;
  b.hardness = hard / n;
  b.edgeHardness = edgeN ? edgeH / edgeN : b.hardness;
}

// ------------------------------------------------------------------ the smith

function go(S, where, then) {
  const sm = S.smith;
  const st = S.stations[where];
  const target = st.p;
  const inShop = (p) => side(S, p) > 0;
  const path = [];
  // through the partition doorway when going between the rooms (a workshop of two rooms)
  if (S.waypoints && S.stations.door && inShop(sm.p) !== inShop(target)) {
    const W = S.waypoints;
    if (inShop(sm.p)) path.push(W.shop, S.stations.door.p, W.workshop);
    else path.push(W.workshop, S.stations.door.p, W.shop);
  }
  path.push(target);
  sm.path = path.map((q) => q.slice());
  sm.dest = where;
  sm.then = then;
  sm.state = 'walk';
  sm.t = 0;
}

/** Which side of the partition (>0: the shop), along the line forge -> shop door. */
function side(S, p) {
  const a = S.stations.door.p;
  const f = S.stations.forge.p;
  const dx = a[0] - f[0];
  const dz = a[2] - f[2];
  return (p[0] - a[0]) * dx + (p[2] - a[2]) * dz;
}

function face(S, where) {
  const sm = S.smith;
  const st = S.stations[where];
  sm.yaw = yawTo(st.p, st.face ?? st.p);
}

function setState(sm, state) {
  sm.state = state;
  sm.t = 0;
}

/**
 * The smith's work over dt (s). env: { Ta, time, event(e), restock() → voxels of charcoal put in }.
 * He reads the blade's state (S.blade: T over its blade, its point, its peak) and the fire's
 * (S.forge) as the voxels have them.
 */
export function stepSmith(S, dt, env) {
  const sm = S.smith;
  if (!sm) return;
  const F = S.forge;
  const ev = (type, extra = {}) => env.event?.({ type, time: env.time ?? S.time, ...extra });
  sm.t += dt * (S.pace ?? 1); // (his work pace: the scene's setting, models/smithy.js)
  const b = S.blade;
  switch (sm.state) {
    case 'start': {
      // a new blank lies on the anvil: he picks it up
      if (!S.blade) S.blade = newBlade(S, env.Ta);
      go(S, 'anvil', 'pick');
      break;
    }
    case 'pick': {
      sm.pose = 'tongs';
      if (sm.t > 0.8 && b) {
        b.place = 'tongs';
        go(S, 'forge', 'load');
      }
      break;
    }
    case 'walk': {
      sm.pose = 'walk';
      let left = WALK * dt;
      while (left > 0 && sm.path.length) {
        const q = sm.path[0];
        const dx = q[0] - sm.p[0];
        const dz = q[2] - sm.p[2];
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) {
          sm.path.shift();
          continue;
        }
        sm.yaw = Math.atan2(dx, dz);
        const s = Math.min(d, left);
        sm.p[0] += (dx / d) * s;
        sm.p[2] += (dz / d) * s;
        sm.p[1] = q[1];
        left -= s;
        if (s >= d) sm.path.shift();
      }
      sm.phase += dt * 1.8;
      if (!sm.path.length) {
        face(S, sm.dest);
        setState(sm, sm.then);
      }
      break;
    }
    case 'load': {
      // the blank (or the blade) into the fire with the tongs
      sm.pose = 'tongs';
      // shaped and still hot enough to harden: let it come down to cherry red, then quench it
      if (b?.stage === 'harden' && b.T >= HEATS.hardening && b.heat > 0 && b.place !== 'fire') {
        if (b.T <= HEATS.hardening + 60) go(S, 'trough', 'quench');
        break;
      }
      if (sm.t > 1.2) {
        if (b) {
          b.place = 'fire';
          b.inFire = 0;
        }
        go(S, 'bellows', 'heat');
      }
      break;
    }
    case 'heat': {
      // at the bellows lever until it is hot enough (topping up the charcoal when it is low)
      if (F.voxels0 > 0 && F.voxels < F.voxels0 * FORGE.restock && !S.stoked) {
        go(S, 'coal', 'stoke');
        break;
      }
      if (b) b.inFire = (b.inFire ?? 0) + dt;
      const harden = b?.stage === 'harden';
      const want = harden ? HEATS.hardening : HEATS.forging;
      const keep = harden ? HEATS.pumpHarden : HEATS.pumpForge;
      // hot enough (or as hot as this fire will make it after a long wait; or the point is
      // getting white hot: he takes it out before it burns)
      const enough = (harden ? HEATS.austenite : HEATS.working) + 40;
      if (b && (b.T >= want || ((b.inFire > 240 || b.Tpeak > HEATS.burning) && b.T >= enough))) {
        go(S, 'forge', 'take');
        break;
      }
      // pump while the bed is cooler than it should be (or the blast is spent)
      const pumping = F.T < keep || F.blast < FORGE.stroke * 0.5;
      sm.pose = pumping ? 'pump' : 'stand';
      if (pumping) {
        const prev = sm.phase;
        sm.phase += dt / STROKE;
        if (Math.floor(sm.phase) > Math.floor(prev)) {
          pumpBellows(S, 1);
          ev('bellows', { pos: S.bellowsBox.slice(), quiet: true, air: F.air });
        }
      }
      break;
    }
    case 'stoke': {
      sm.pose = 'tongs';
      if (sm.t > 2) {
        const n = env.restock?.() ?? 0;
        S.stoked = true;
        ev('stoke', { pos: S.fire.slice(), quiet: true, voxels: n });
        go(S, 'bellows', 'heat');
      }
      break;
    }
    case 'take': {
      sm.pose = 'tongs';
      if (sm.t > 0.8) {
        S.stoked = false;
        b.place = 'tongs';
        b.heatFrom = b.T;
        if (b.stage === 'harden') go(S, 'trough', 'quench');
        else go(S, 'anvil', 'hammer');
      }
      break;
    }
    case 'hammer': {
      sm.pose = 'hammer';
      b.place = 'anvil';
      if (b.heatAt == null) {
        // (this heat on the anvil: its blows and how long it lasts)
        b.heatAt = S.time;
        b.heatBlows = 0;
      }
      const prev = sm.phase;
      sm.phase += (dt * (S.pace ?? 1)) / BLOW;
      if (Math.floor(sm.phase) > Math.floor(prev)) {
        sm.blows++;
        const top = S.stations.anvil.top;
        // every fourth beat a light tap on the bare face (keeping the rhythm, the hammer bouncing)
        const tap = sm.blows % 4 === 0;
        if (tap) {
          ev('impact', { kind: 'hammer', bare: true, pos: top.slice(), materials: ['steel', 'steel'], temps: [env.Ta, S.anvilT ?? env.Ta], mass: 1.4, speed: 2.5, energy: 0.5 * 1.4 * 2.5 ** 2, radius: 0.012, size: 0.44, sizeA: 0.1, name: 'anvil', quiet: true });
        } else {
          // a blow: the hotter the steel, the more it moves
          const soft = Math.min(1.25, Math.max(0.05, (b.T - 650) / (HEATS.forging - 650)));
          // (a skilled smith moves more steel a blow: models/smithy.js smithSkill, 0.5 a journeyman)
          b.progress = Math.min(1, b.progress + (soft / (b.heats * HEAT_BLOWS)) * (0.5 + (S.skill ?? 0.5)));
          b.blows = (b.blows ?? 0) + 1;
          b.heatBlows++;
          const at = S.hammerAt ?? top;
          const speed = 7;
          ev('impact', { kind: 'hammer', bare: false, pos: at.slice(), materials: ['steel', 'steel'], temps: [env.Ta, b.T], bladeT: b.T, blade: { length: 0.84, thickness: 0.005, width: 0.045 }, mass: 1.4, speed, energy: 0.5 * 1.4 * speed * speed, radius: 0.015, size: 0.44, sizeA: 0.1, name: 'anvil', quiet: true });
          // scale flying off the hot steel: sparks (more, the hotter it is)
          if (b.T > 700) S.sparks += 1;
          ev('anvilBlow', { pos: at.slice(), T: b.T, quiet: true });
        }
      }
      if (b.progress >= 1 || b.T < HEATS.working) {
        if (b.progress >= 1) b.stage = 'harden';
        b.heat++;
        (b.heatLog ??= []).push({ blows: b.heatBlows, seconds: S.time - b.heatAt, from: b.heatFrom ?? b.T, to: b.T });
        b.heatAt = null;
        b.place = 'tongs';
        go(S, 'forge', 'load');
      }
      break;
    }
    case 'quench': {
      sm.pose = 'quench';
      if (b.place !== 'water') {
        b.place = 'water';
        b.quenchFrom = b.T;
        ev('quench', { pos: S.stations.trough.water.slice(), T: b.T, name: `the ${b.label}`, quiet: false });
      }
      if ((b.Tpeak < HEATS.cold && sm.t > 2) || sm.t > 90) {
        b.quenched = true;
        b.place = 'tongs';
        b.asQuenched = b.hardness;
        ev('quenched', { pos: S.stations.trough.water.slice(), name: `the ${b.label}`, hardness: b.hardness, quiet: true });
        go(S, 'forge', 'temper');
      }
      break;
    }
    case 'temper': {
      // held over the fire until it shows its temper colour
      sm.pose = 'tongs';
      b.place = 'temper';
      if (b.T >= b.temperTarget || sm.t > 120) {
        b.place = 'tongs';
        go(S, 'grinder', 'grind');
      }
      break;
    }
    case 'grind': {
      sm.pose = 'grind';
      b.place = 'grind';
      const prev = sm.phase;
      sm.phase += dt / 0.4;
      if (Math.floor(sm.phase) > Math.floor(prev)) ev('grind', { pos: S.stations.grinder.wheel.slice(), quiet: true });
      if (sm.t > 10) {
        b.place = 'tongs';
        go(S, 'rack', 'shelve');
      }
      break;
    }
    case 'shelve': {
      sm.pose = 'tongs';
      if (b.place !== 'rack' && sm.t > 0.5) b.place = 'rack';
      if (sm.t > 1.5) {
        // up on the rack to cool; it joins the display when cold (finishCooling)
        S.cooling.push(b);
        S.made++;
        ev('weaponDone', { pos: S.stations.rack.face.slice(), name: `a ${b.label}`, hardness: b.hardness, quiet: false });
        S.blade = null;
        setState(sm, 'start');
      }
      break;
    }
  }
}

/** Strokes of the bellows: air into the blast store (it blows through the tuyere over the next seconds). */
export function pumpBellows(S, strokes = 1) {
  if (!S.ready) return;
  S.forge.blast = Math.min(S.forge.blast + FORGE.stroke * strokes, FORGE.stroke * 6);
  S.forge.strokes += strokes;
  S.lastPump = S.time;
}

// ------------------------------------------------------------------ in the world

/** The blades on the rack: once cold (or their place is wanted) they join the display (drawn only). */
function finishCooling(w, S, need) {
  for (let k = 0; k < S.cooling.length; k++) {
    const b = S.cooling[k];
    metallurgy(w, S, b);
    if (b.Tpeak < HEATS.cold || need) {
      const B = b.body;
      for (let q = 0; q < B.n; q++) {
        const c = B.at[q];
        if (c >= 0 && w.mat[c] === B.s.mat[q]) w.clearVoxel(c);
        B.s.mat[q] = 0;
        B.at[q] = -1;
      }
      B.cells.clear();
      shelve(S, { kind: b.kind, hardness: b.hardness, temper: b.temperMax, made: S.time });
      S.cooling.splice(k--, 1);
      need = false;
    }
  }
}

/** Step every smithy of the world (sim/simulation.js). */
export function stepSmithies(sim, dt) {
  const w = sim.world;
  if (!w.smithies?.length || dt <= 0) return;
  for (const S of w.smithies) {
    if (!S.ready) initSmithy(S, w.ambient);
    S.time += dt;
    const room = sim.airCellAt(S.stations.forge.p[0], S.stations.forge.p[1] + 1.2, S.stations.forge.p[2]);
    const Ta = room >= 0 ? w.airT[room] : w.ambient;
    const F = S.forge;
    // the forge: the tuyere's air into the air model, the fire read off its voxels
    if (S.pot) {
      F.inBed = burnBed(w, S, dt);
      readForge(w, S);
      F.air = airFlow(F, dt);
      blowTuyere(w, S, F.air, dt);
    }
    // the anvil's face (for the sound: how warm the steel is)
    const av = S.stations.anvil?.top ? w.voxelAt(S.stations.anvil.top[0], S.stations.anvil.top[1] - w.h, S.stations.anvil.top[2]) : -1;
    if (av >= 0 && w.mat[av]) S.anvilT = w.temp[av];
    // the finished blades cooling on the rack: cold, they join the display; one still there when
    // the next is put up goes to the display as it is
    const b = S.blade;
    finishCooling(w, S, b?.place === 'rack' && S.cooling.length > 0);
    for (const c of S.cooling) bladeThin(w, S, c, false);
    // the blade: made, moved with the tongs, quenched, its steel's structure
    if (b && !b.body) makeBlade(w, S, b);
    const water = troughWater(w, S);
    keepTubTight(w, S);
    let q = { J: 0, kg: 0 };
    if (b?.body) {
      placeBody(w, S, b);
      // its real geometry for heat exchange; on the anvil the hammered spot pressed flat
      // (with no smith: b.hammering, the blows at his rhythm)
      const hammering = b.place === 'anvil' && (S.smith ? S.smith.state === 'hammer' : !!b.hammering);
      if (hammering && !S.smith) b.blows = (b.blows ?? 0) + (dt * 0.75) / BLOW;
      S.hammerAt = bladeThin(w, S, b, hammering);
      if (b.place === 'water') q = quench(w, S, b, dt);
      b.fromBed = b.place === 'fire' ? bedRadiation(w, b, dt) : 0;
      metallurgy(w, S, b);
    }
    // the slack tub
    const Tw = mixTrough(w, water, dt, b?.place === 'water' ? 3 : 25);
    S.water.T = water.length ? Tw : Ta;
    S.water.mass = water.reduce((s, i) => s + w.fuel[i], 0) * 1000 * w.h ** 3;
    S.water.heat += q.J;
    S.water.steam += q.kg;
    const k = Math.min(1, dt / 0.5);
    S.water.steamRate += (q.kg / dt - S.water.steamRate) * k;
    if (S.smith)
      stepSmith(S, dt, {
        Ta,
        time: w.time,
        event: (e) => w.events.push(e),
        restock: () => (S.pot ? restock(w, S) : 0),
      });
  }
}

/** A smithy advanced on its own (no world: the smith's cycle with the blade's state as given). */
export function advanceSmithy(S, dt, env) {
  if (!S.ready) initSmithy(S, env.Ta);
  S.time += dt;
  stepSmith(S, dt, env);
}

/**
 * Using the smithy (E in the walk-through) at p: at the bellows lever, a few strokes of the
 * bellows. Returns what to say, or null when there is nothing of a smithy within reach.
 */
export function useSmithy(sim, p) {
  for (const S of sim.world.smithies ?? []) {
    if (!S.ready) continue;
    const L = S.stations.bellows.lever;
    if (Math.hypot(L[0] - p[0], L[2] - p[2]) < 1.6) {
      pumpBellows(S, 3);
      sim.world.events.push({ type: 'bellows', pos: S.bellowsBox.slice(), time: sim.world.time, quiet: true, player: true, air: FORGE.blastMax });
      S.playerPump = sim.world.time;
      const F = S.forge;
      return `You work the bellows: the fire roars up (charcoal glowing at ${F.T.toFixed(0)} °C, ${heatColour(F.T)})`;
    }
  }
  return null;
}

/** What the inspector says about a smithy (sim/inspectThings.js). */
export function describeSmithy(S) {
  if (!S?.ready) return null;
  const F = S.forge;
  const rows = [
    `Forge: ${F.burning} of ${F.voxels} charcoal voxels glowing, ${F.T.toFixed(0)} °C (${heatColour(F.T)}), ${F.coal.toFixed(1)} kg charcoal left`,
    `Air through the tuyere ${(F.air * 1000).toFixed(1)} g/s (${F.jet.toFixed(1)} m/s up through the bed)${F.blast > 0.001 ? ', bellows blowing' : ', draught only'}; burning ${(F.burn * 1000).toFixed(2)} g/s: ${(F.combustion / 1000).toFixed(1)} kW`,
    `Slack tub: ${S.water.T.toFixed(1)} °C, ${S.water.mass.toFixed(0)} kg of water; ${(S.water.steam * 1000).toFixed(0)} g boiled off so far${S.water.steamRate > 1e-5 ? ` (${(S.water.steamRate * 1000).toFixed(1)} g/s now)` : ''}`,
  ];
  const b = S.blade;
  if (b) {
    const where = { fire: 'in the fire', anvil: 'on the anvil', water: 'quenching', temper: 'tempering over the fire', grind: 'at the grindstone', tongs: 'in the tongs', stock: 'on the anvil (a blank)', rack: 'on the rack' }[b.place] ?? b.place;
    rows.push(`Working: a ${b.label} (${b.body?.n ?? 0} steel voxels), ${where}: ${b.T.toFixed(0)} °C over its working length (${b.T > 480 ? heatColour(b.T) : temperColour(b.temperMax || b.T)}), point ${b.tip.toFixed(0)} °C, base ${b.base.toFixed(0)} °C; shaped ${(b.progress * 100).toFixed(0)} % after ${b.heat} heat${b.heat === 1 ? '' : 's'}`);
    rows.push(`Its steel: ${b.martensite > 0.5 ? `hardened (martensite ${(b.martensite * 100).toFixed(0)} %)` : 'soft (pearlite)'}, ${b.hardness?.toFixed(0) ?? 18} HRC (edge ${(b.edgeHardness ?? b.hardness ?? 18).toFixed(0)})${b.temperMax > 150 ? `, tempered at ${b.temperMax.toFixed(0)} °C (${temperColour(b.temperMax)})` : b.quenched ? ' – as quenched: hard and brittle' : ''}`);
  }
  for (const c of S.cooling) rows.push(`On the rack, cooling: a ${c.label}, ${c.T.toFixed(0)} °C, ${c.hardness.toFixed(0)} HRC`);
  rows.push(`Shop: ${S.weapons.length} weapon${S.weapons.length === 1 ? '' : 's'} on display, ${S.made} made${S.sold ? `, ${S.sold} sold` : ''}`);
  const sm = S.smith;
  if (sm) rows.push(`The smith: ${{ walk: 'walking', heat: sm.pose === 'pump' ? 'working the bellows' : 'watching the fire', hammer: 'hammering', quench: 'quenching', temper: 'tempering', grind: 'grinding', shelve: 'putting it on the rack', stoke: 'topping up the charcoal', load: 'putting it in the fire', take: 'taking it out of the fire', pick: 'picking up a blank', start: 'starting a new piece' }[sm.state] ?? sm.state}`);
  return { title: "Smith's forge", sub: 'forge, smith and shop', rows };
}
