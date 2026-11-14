/**
 * What the rig can show (its Object drop-down), what each object does, and which rig object a
 * scene object opens (editor.js: "Rig the …" and R in Edit world). No three.js here: the tests
 * use it as it is.
 */
import { MELEE, REACT, PAIR_D } from '../ai/melee.js';

/** The rig's objects, in the drop-down's order. */
export const RIG_OBJECTS = [
  { kind: 'soldier', label: 'Soldier' },
  { kind: 'squad', label: 'Squad (fire team)' },
  { kind: 'dragon', label: 'Dragon' },
  { kind: 'phoenix', label: 'Phoenix' },
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
export const RIG_TYPES = { squad: 'squad', enemy: 'soldier', dragon: 'dragon', car: 'car', jet: 'jet', boat: 'boat', jetFlight: 'jetFlight', catacombs: 'phoenix' };

/** What the rig should show for a scene object ({ type, params }), or null if it has no rig. */
export function rigTargetFor(o) {
  const kind = o && RIG_TYPES[o.type];
  if (!kind) return null;
  const p = o.params ?? {};
  if (kind === 'soldier') return { kind, loadout: p.flameTrooper ? 'torch' : 'rifle' };
  if (kind === 'squad') return { kind, unit: p.unit, flameTrooper: !!p.flameTrooper, droneOperator: !!p.droneOperator };
  if (VEHICLES.includes(kind) || VEHICLE_GROUPS[kind]) return { kind, params: { ...p } };
  // the catacombs' phoenix (models/catacombs.js `phoenix`, on unless switched off)
  if (kind === 'phoenix') return p.phoenix === false ? null : { kind };
  return { kind };
}

/** The editor's button for it. */
export const RIG_BUTTON = {
  soldier: '🦴 Rig the soldier (animations, gear, hit zones)',
  squad: '🦴 Rig the squad (formation, members, hit zones)',
  dragon: '🦴 Rig the dragon (acts, wings, hit zones)',
  phoenix: '🦴 Rig the phoenix (acts, flame wings, hit zones, rebirth)',
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
  // what stands in for a roll with a weapon that rules rolling out (ai/weapons.js: the flame gun's tanks)
  sidestepLeft: { label: 'Side step (left, crouched)', from: 'fire' },
  sidestepRight: { label: 'Side step (right, crouched)', from: 'fire' },
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

/* ---------- hand-to-hand acts (soldier and squad): boxing and judo (ai/melee.js) ---------- */
/**
 * The hand-to-hand acts on the rig stage: a strike with a sparring partner d m in front of him
 * who takes it (react, at the strike's hit time 'at'); a throw or the clinch with the partner in
 * the other half of the pair (partner: '<move>_d'); a block or a slip against the partner's punch
 * (partner: his strike); the rest (the guard, being hit, down, getting up) on his own.
 */
export const MELEE_ACTS = (() => {
  const A = { guard: { label: 'Guard (boxing)' }, fistsUp: { label: 'Fists up' } };
  for (const [k, M] of Object.entries(MELEE)) {
    const d = M.reach ? (M.kind === 'strike' ? (M.reach[0] + M.reach[1]) / 2 : PAIR_D) : 0.8;
    if (M.kind === 'strike') A[k] = { label: M.label, d, react: M.zone === 'head' ? 'hitHead' : 'hitBody', at: M.hit };
    else if (M.kind === 'defend') A[k] = { label: M.label, d, partner: k === 'block' ? 'cross' : 'jab' };
    else A[k] = { label: M.label, d, partner: k + '_d' };
  }
  for (const [k, R] of Object.entries(REACT)) A[k] = { label: R.label };
  A.downed = { label: 'Down (on his back)' };
  return A;
})();
/** The obstacle height for an act: h (or its default) kept within the act's range. */
export function parkourHeight(act, h) {
  const a = PARKOUR_ACTS[act];
  if (!a) return null;
  return Math.max(a.min, Math.min(a.max, Number.isFinite(+h) && h !== null && h !== '' ? +h : a.h));
}
