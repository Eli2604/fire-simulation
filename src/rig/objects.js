/**
 * What the rig can show (its Object drop-down), what each object does, and which rig object a
 * scene object opens (editor.js: "Rig the …" and R in Edit world). No three.js here: the tests
 * use it as it is.
 */

/** The rig's objects, in the drop-down's order. */
export const RIG_OBJECTS = [
  { kind: 'soldier', label: 'Soldier' },
  { kind: 'squad', label: 'Squad (fire team)' },
  { kind: 'dragon', label: 'Dragon' },
  { kind: 'car', label: 'Car' },
  { kind: 'jet', label: 'Jet' },
  { kind: 'jetFlight', label: 'Jet flight (formation)' },
  { kind: 'pilot', label: 'Pilot (ejection seat, parachute)' },
  { kind: 'boat', label: 'Boat' },
];
export const RIG_KINDS = RIG_OBJECTS.map((o) => o.kind);
/** The vehicles (rig/vehicles.js draws and moves them). */
export const VEHICLES = ['car', 'jet', 'boat'];
/** Groups of vehicles (rig/vehicles.js too: several of them, an AI flying them), and what each member is. */
export const VEHICLE_GROUPS = { jetFlight: 'jet' };
/** What the vehicle stage (rig/vehicles.js) shows: the vehicles, their groups, and the jet's pilot. */
export const VEHICLE_STAGE = [...VEHICLES, ...Object.keys(VEHICLE_GROUPS), 'pilot'];

/** What each vehicle does, as buttons (rig/vehicles.js plays them). */
export const VEHICLE_ACTS = {
  car: { idle: 'Idle', drive: 'Drive', steer: 'Steer', doors: 'Doors open', burning: 'Burning' },
  jet: { idle: 'Idle', taxi: 'Taxi', gearUp: 'Gear up', gearDown: 'Gear down', flaps: 'Flaps', afterburner: 'Afterburner', bank: 'Banking', eject: 'Eject', hit: 'Hit (part)', burning: 'Burning', critical: 'Critical: falls', crash: 'Crash & explode', evadeBreak: 'Evade: break turn', evadeRoll: 'Evade: barrel roll + flares' },
  // the flight (ai/flight.js): the leader's orders, each formation, and a hit on the lead (the next takes over)
  // (evade: a rocket in from the right, a hard break turn into it; a missile from behind, a barrel roll with flares: ai/flight.js)
  jetFlight: { formUp: 'Form up', echelonLeft: 'Echelon left', echelonRight: 'Echelon right', vic: 'Vic (V)', lineAbreast: 'Line abreast', fingerFour: 'Finger-four', trail: 'Trail', flank: 'Split & flank', engage: 'Engage', break: 'Break', rejoin: 'Rejoin', orbit: 'Orbit', rtb: 'RTB', hitLead: 'Hit the lead', evadeBreak: 'Evade: break turn', evadeRoll: 'Evade: barrel roll + flares' },
  // the jet's pilot (sim/ejection.js, render/pilotFigure.js): in his seat, out on it, under the canopy, down
  pilot: { seated: 'Seated (pilot)', eject: 'Eject', steerLeft: 'Parachute: steer left', steerRight: 'Parachute: steer right', flare: 'Parachute: flare', plf: 'Land (PLF)', splashdown: 'Splashdown' },
  boat: { idle: 'Idle bob', cruise: 'Cruise', turn: 'Turn', rough: 'Rough sea' },
};

/** The kind asked for, or 'soldier' (what the rig shows when it does not know the kind). */
export function rigKind(what) {
  return RIG_KINDS.includes(what?.kind) ? what.kind : 'soldier';
}

/** Scene object types (models/index.js) the rig can open, and as what. */
export const RIG_TYPES = { squad: 'squad', enemy: 'soldier', dragon: 'dragon', car: 'car', jet: 'jet', boat: 'boat', jetFlight: 'jetFlight' };

/** What the rig should show for a scene object ({ type, params }), or null if it has no rig. */
export function rigTargetFor(o) {
  const kind = o && RIG_TYPES[o.type];
  if (!kind) return null;
  const p = o.params ?? {};
  if (kind === 'soldier') return { kind, loadout: p.flameTrooper ? 'torch' : 'rifle' };
  if (kind === 'squad') return { kind, unit: p.unit, flameTrooper: !!p.flameTrooper, droneOperator: !!p.droneOperator };
  if (VEHICLES.includes(kind) || VEHICLE_GROUPS[kind]) return { kind, params: { ...p } };
  return { kind };
}

/** The editor's button for it. */
export const RIG_BUTTON = {
  soldier: '🦴 Rig the soldier (animations, gear, hit zones)',
  squad: '🦴 Rig the squad (formation, members, hit zones)',
  dragon: '🦴 Rig the dragon (acts, wings, hit zones)',
  car: '🦴 Rig the car (drive, doors, hit parts)',
  jet: '🦴 Rig the jet (gear, flaps, afterburner, hit parts, crash)',
  jetFlight: '🦴 Rig the jet flight (formations, orders, hit parts)',
  pilot: '🦴 Rig the pilot (seat, ejection, parachute, landing)',
  boat: '🦴 Rig the boat (sea, cruise, hit parts)',
};

/* ---------- parkour acts (soldier and squad): each over a prop of its own, of adjustable height ---------- */
/**
 * The soldier's parkour acts on the rig stage (operator/rig.js clips, ai/parkour.js moves): its
 * label, the prop it is shown with ('wall' to vault, 'ledge' to get up onto, 'drop' to come down
 * off, 'cover' to slide in behind) and the prop's height range (m) and default (the stage's
 * Obstacle slider stays within the range of the act).
 */
export const PARKOUR_ACTS = {
  vaultSpeed: { label: 'Vault (speed)', prop: 'wall', h: 0.9, min: 0.75, max: 1.15 },
  vaultSide: { label: 'Vault (side)', prop: 'wall', h: 0.95, min: 0.75, max: 1.15 },
  vaultStep: { label: 'Vault (step-over)', prop: 'wall', h: 0.6, min: 0.45, max: 0.75 },
  climbJump: { label: 'Climb up (jump)', prop: 'ledge', h: 1.8, min: 1.15, max: 2.3 },
  mantle: { label: 'Mantle', prop: 'ledge', h: 1.3, min: 0.75, max: 1.5 },
  dropDown: { label: 'Drop down', prop: 'drop', h: 1.4, min: 0.6, max: 2.0 },
  dropRoll: { label: 'Drop down (roll)', prop: 'drop', h: 2.6, min: 2.0, max: 3.3 },
  slideCover: { label: 'Slide into cover', prop: 'cover', h: 0.9, min: 0.6, max: 1.1 },
};
/* ---------- evade acts (soldier and squad): combat rolls on open ground (ai/evade.js) ---------- */
/**
 * The soldier's rolls on the rig stage (operator/rig.js clips, ai/evade.js root paths): its label
 * and what it is shown getting out of (a grenade rolling up, a line of fire, a dragon's dive): the
 * stage carries him along the roll's root path and starts it over after a pause.
 */
export const EVADE_ACTS = {
  rollLeft: { label: 'Roll (left)', from: 'fire' },
  rollRight: { label: 'Roll (right)', from: 'fire' },
  rollForward: { label: 'Roll (forward)', from: 'dragon' },
  diveProne: { label: 'Dive roll to prone', from: 'grenade' },
};

/* ---------- casualty acts (soldier and squad): a man down and getting him out (ai/casualty.js) ---------- */
/**
 * The casualty acts on the rig stage: 'partner' is the second figure the act needs (the casualty
 * the rescuer drags along by the collar, the man he treats); the stage puts him there.
 */
export const CASUALTY_ACTS = {
  woundedDown: { label: 'Wounded down' },
  dragCasualty: { label: 'Drag casualty (rescuer + casualty)', partner: 'dragged' },
  firstAid: { label: 'First aid', partner: 'woundedDown' },
  coverFire: { label: 'Cover fire' },
};

/** The obstacle height for an act: h (or its default) kept within the act's range. */
export function parkourHeight(act, h) {
  const a = PARKOUR_ACTS[act];
  if (!a) return null;
  return Math.max(a.min, Math.min(a.max, Number.isFinite(+h) && h !== null && h !== '' ? +h : a.h));
}

/* ---------- impacts: every act with a contact declares it (sim/impact.js computes the force) ---------- */
/**
 * What each object weighs (kg): the body mass its parts' striking masses are fractions of
 * (sim/impact.js PART_MASS).
 */
export const BODY_MASS = { soldier: 85, squad: 85, dragon: 3000, phoenix: 12, jet: 10000, jetFlight: 10000, car: 1300, pilot: 95, boat: 1500 };
/**
 * The contacts of each act, as impact keyframes: { t, part, material, target, targetMaterial, v,
 * mass?, contactTime?, zone?, kind?, label?, fromHeight?, sim?, trigger? }.
 *  t            when, as a fraction of the act (0..1)
 *  part         the body part / contact (a bone where the stage can measure its speed: handR,
 *               footR, ...; else body, feet, shoulder, jaw, tail, hull, door)
 *  material     what strikes (sim/materials.js mechanics(): flesh, scales, steel, ...)
 *  target       'opponent' (the nearest other figure within reach), 'ground', 'wall', 'object'
 *  v            the contact speed (m/s) when the stage cannot measure it from the animation
 *  fromHeight   a landing: v = √(2 g h) from the act's obstacle height (the Obstacle slider)
 *  sim          the simulation's own code makes it (ai/dragon.js impactOf): the stage reads its events
 *  trigger      not at a time but when it happens: 'ground' (the object comes down on the ground),
 *               'doorsShut' (a door swinging shut)
 * The stage (rig/stage.js) plays them with a Force × per act and per object (sim/impact.js
 * ACT_FORCE) and shows the force. Other acts add theirs with declareImpacts().
 */
export const ACT_IMPACTS = {
  soldier: {
    jump: [{ t: 0.72, part: 'feet', target: 'ground', v: 3, label: 'landing' }],
    vaultSpeed: [{ t: 0.82, part: 'feet', target: 'ground', v: 3.1, label: 'landing' }],
    vaultSide: [{ t: 0.82, part: 'feet', target: 'ground', v: 3.1, label: 'landing' }],
    vaultStep: [{ t: 0.8, part: 'feet', target: 'ground', v: 2.4, label: 'landing' }],
    dropDown: [{ t: 0.62, part: 'feet', target: 'ground', fromHeight: true, label: 'landing' }],
    dropRoll: [{ t: 0.42, part: 'feet', target: 'ground', fromHeight: true, contactTime: 0.35, label: 'landing roll' }],
    rollLeft: [{ t: 0.35, part: 'shoulder', target: 'ground', v: 2.4, contactTime: 0.3, label: 'roll' }],
    rollRight: [{ t: 0.35, part: 'shoulder', target: 'ground', v: 2.4, contactTime: 0.3, label: 'roll' }],
    rollForward: [{ t: 0.35, part: 'shoulder', target: 'ground', v: 2.6, contactTime: 0.3, label: 'roll' }],
    diveProne: [{ t: 0.45, part: 'body', target: 'ground', v: 3.2, contactTime: 0.22, label: 'dive' }],
    die: [{ t: 0.55, part: 'body', target: 'ground', v: 4.4, contactTime: 0.12, kind: 'fall', label: 'body falls' }],
    woundedDown: [{ t: 0.5, part: 'body', target: 'ground', v: 3.8, contactTime: 0.15, kind: 'fall', label: 'falls wounded' }],
    stab: [{ t: 0.42, part: 'weapon', material: 'steel', target: 'opponent', v: 6, mass: 3, zone: 'torso', label: 'knife' }],
    // unarmed combat (operator/rig.js clips of these names: punches, kicks, throws)
    punch: [{ t: 0.45, part: 'handR', target: 'opponent', v: 8, zone: 'head', label: 'punch' }],
    jab: [{ t: 0.4, part: 'handL', target: 'opponent', v: 7, zone: 'head', label: 'jab' }],
    cross: [{ t: 0.45, part: 'handR', target: 'opponent', v: 9, zone: 'head', label: 'cross' }],
    hook: [{ t: 0.5, part: 'handR', target: 'opponent', v: 9, zone: 'head', label: 'hook' }],
    elbow: [{ t: 0.45, part: 'elbow', target: 'opponent', v: 7, zone: 'head', label: 'elbow' }],
    knee: [{ t: 0.5, part: 'knee', target: 'opponent', v: 6, zone: 'torso', label: 'knee' }],
    kick: [{ t: 0.45, part: 'footR', target: 'opponent', v: 11, zone: 'torso', label: 'kick' }],
    frontKick: [{ t: 0.45, part: 'footR', target: 'opponent', v: 10, zone: 'torso', label: 'front kick' }],
    roundhouse: [{ t: 0.5, part: 'shinR', target: 'opponent', v: 12, zone: 'torso', label: 'roundhouse' }],
    judoThrow: [{ t: 0.7, part: 'body', target: 'opponent', v: 5.5, mass: 85, massB: Infinity, targetMaterial: 'soil', kind: 'throw', label: 'thrown down' }],
    hipThrow: [{ t: 0.7, part: 'body', target: 'opponent', v: 5.5, mass: 85, massB: Infinity, targetMaterial: 'soil', kind: 'throw', label: 'thrown down' }],
  },
  dragon: {
    land: [{ part: 'feet', material: 'scales', target: 'ground', sim: true, label: 'landing' }],
    wingHurt: [{ part: 'feet', material: 'scales', target: 'ground', sim: true, label: 'landing' }],
    stamp: [{ part: 'feet', material: 'scales', target: 'ground', sim: true, label: 'stamp' }],
    fall: [{ part: 'body', material: 'scales', target: 'ground', sim: true, label: 'falls' }],
    wingGone: [{ part: 'body', material: 'scales', target: 'ground', sim: true, label: 'crash' }],
    snatch: [{ part: 'body', target: 'ground', sim: true, label: 'thrown, lands' }],
    bite: [{ t: 0.6, part: 'jaw', material: 'bone', target: 'opponent', v: 6, label: 'bite' }],
    run: [{ part: 'feet', material: 'scales', target: 'ground', sim: true, label: 'footfall' }],
  },
  phoenix: {
    land: [{ t: 0.85, part: 'talons', material: 'feathers', target: 'ground', v: 2.5, label: 'landing' }],
  },
  jet: {
    crash: [{ trigger: 'ground', part: 'hull', material: 'aluminium', target: 'ground', targetMaterial: 'soil', radius: 1.5, footprint: 6, size: 8, kind: 'crash', label: 'impact' }],
    critical: [{ trigger: 'ground', part: 'hull', material: 'aluminium', target: 'ground', targetMaterial: 'soil', radius: 1.5, footprint: 6, size: 8, kind: 'crash', label: 'impact' }],
    gearDown: [{ trigger: 'ground', part: 'wheels', material: 'rubber', target: 'ground', targetMaterial: 'concrete', label: 'touchdown' }],
  },
  car: {
    doors: [{ trigger: 'doorsShut', part: 'door', material: 'steel', target: 'object', targetMaterial: 'steel', mass: 30, massB: 1300, size: 1.2, sizeA: 1, label: 'door slams' }],
  },
  pilot: {
    plf: [{ t: 0.3, part: 'feet', target: 'ground', v: 5, contactTime: 0.3, label: 'parachute landing fall' }],
    splashdown: [{ t: 0.2, part: 'body', target: 'ground', targetMaterial: 'water', v: 5, label: 'splashdown' }],
  },
};
/** The impact keyframes of an act of kind ('squad' plays the soldier's), or []. */
export function impactsOf(kind, act) {
  const k = kind === 'squad' ? 'soldier' : kind === 'jetFlight' ? 'jet' : kind;
  return ACT_IMPACTS[k]?.[act] ?? [];
}
/** Declare (replace) the impact keyframes of an act: declareImpacts('soldier', 'kick', [{ t: 0.45, part: 'footR', target: 'opponent', v: 11 }]). */
export function declareImpacts(kind, act, list) {
  (ACT_IMPACTS[kind] ??= {})[act] = list;
  return list;
}
