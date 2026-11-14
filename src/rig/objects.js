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
  jet: { idle: 'Idle', taxi: 'Taxi', gearUp: 'Gear up', gearDown: 'Gear down', flaps: 'Flaps', afterburner: 'Afterburner', bank: 'Banking', eject: 'Eject', hit: 'Hit (part)', burning: 'Burning', critical: 'Critical: falls', crash: 'Crash & explode' },
  // the flight (ai/flight.js): the leader's orders, each formation, and a hit on the lead (the next takes over)
  jetFlight: { formUp: 'Form up', echelonLeft: 'Echelon left', echelonRight: 'Echelon right', vic: 'Vic (V)', lineAbreast: 'Line abreast', fingerFour: 'Finger-four', trail: 'Trail', flank: 'Split & flank', engage: 'Engage', break: 'Break', rejoin: 'Rejoin', orbit: 'Orbit', rtb: 'RTB', hitLead: 'Hit the lead' },
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
