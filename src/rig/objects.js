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
  { kind: 'boat', label: 'Boat' },
];
export const RIG_KINDS = RIG_OBJECTS.map((o) => o.kind);
/** The vehicles (rig/vehicles.js draws and moves them). */
export const VEHICLES = ['car', 'jet', 'boat'];

/** What each vehicle does, as buttons (rig/vehicles.js plays them). */
export const VEHICLE_ACTS = {
  car: { idle: 'Idle', drive: 'Drive', steer: 'Steer', doors: 'Doors open', burning: 'Burning' },
  jet: { idle: 'Idle', taxi: 'Taxi', gearUp: 'Gear up', gearDown: 'Gear down', flaps: 'Flaps', afterburner: 'Afterburner', bank: 'Banking' },
  boat: { idle: 'Idle bob', cruise: 'Cruise', turn: 'Turn', rough: 'Rough sea' },
};

/** The kind asked for, or 'soldier' (what the rig shows when it does not know the kind). */
export function rigKind(what) {
  return RIG_KINDS.includes(what?.kind) ? what.kind : 'soldier';
}

/** Scene object types (models/index.js) the rig can open, and as what. */
export const RIG_TYPES = { squad: 'squad', enemy: 'soldier', dragon: 'dragon', car: 'car', jet: 'jet', boat: 'boat' };

/** What the rig should show for a scene object ({ type, params }), or null if it has no rig. */
export function rigTargetFor(o) {
  const kind = o && RIG_TYPES[o.type];
  if (!kind) return null;
  const p = o.params ?? {};
  if (kind === 'soldier') return { kind, loadout: p.flameTrooper ? 'torch' : 'rifle' };
  if (kind === 'squad') return { kind, unit: p.unit, flameTrooper: !!p.flameTrooper, droneOperator: !!p.droneOperator };
  if (VEHICLES.includes(kind)) return { kind, params: { ...p } };
  return { kind };
}

/** The editor's button for it. */
export const RIG_BUTTON = {
  soldier: '🦴 Rig the soldier (animations, gear, hit zones)',
  squad: '🦴 Rig the squad (formation, members, hit zones)',
  dragon: '🦴 Rig the dragon (acts, wings, hit zones)',
  car: '🦴 Rig the car (drive, doors, hit parts)',
  jet: '🦴 Rig the jet (gear, flaps, afterburner, hit parts)',
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
/** The obstacle height for an act: h (or its default) kept within the act's range. */
export function parkourHeight(act, h) {
  const a = PARKOUR_ACTS[act];
  if (!a) return null;
  return Math.max(a.min, Math.min(a.max, Number.isFinite(+h) && h !== null && h !== '' ? +h : a.h));
}
