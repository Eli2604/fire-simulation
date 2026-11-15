/**
 * A helicopter (ai/helicopter.js flies it; render/helis.js draws it with render/heliMesh.js): a
 * Black Hawk-sized machine with a pilot, a co-pilot and soldiers in the back. This object is its
 * landing zone; it starts `from` an offset (in the air at its altitude, or on the ground with the
 * rotor still) and flies its mission there: 'insert' (hover over the zone, the troops fast-rope
 * down two cables, cut, climb away and circle with the door guns), 'land' (land, the troops jump
 * out, off again), 'overwatch' (circle the zone with the doors open), 'hover'. The men are the
 * simulation's soldiers (w.enemies, ai/squad.js once they are down). Not voxels: it flies.
 * Its hit parts are models/vehicleZones.js VEHICLE_ZONES.helicopter (the rig shows and edits them).
 * Side (ai/sides.js): 'enemy' (red: its crew and troops are the simulation's soldiers, its guns at
 * you and whatever else of yours they identify) or 'friendly' (blue: yours; its guns at the red
 * soldiers, dragons and helicopters they identify). Armed (its armament, ai/heliArms.js) it carries a
 * chin gun, rocket pods, missiles and flares; on a 'hunt' it patrols its zone and attacks the
 * hostile helicopters, vehicles, boats and soldiers its crew identify (ai/heliCombat.js), home
 * when its ammunition is gone. Either can be flown: walk up while it is on
 * the ground and press E at the cockpit (walk/heliFlight.js); an enemy crew get out and fight.
 */
export default {
  label: 'Helicopter (crew, troops, door guns)',
  params: {
    side: { value: 'enemy', options: ['enemy', 'friendly'], label: 'Side (enemy: brings their soldiers; friendly: yours)' },
    mission: { value: 'insert', options: ['insert', 'land', 'overwatch', 'hover', 'hunt'], label: 'Mission (hunt: patrol the zone and attack what is hostile: ai/heliCombat.js)' },
    soldiers: { value: 6, min: 0, max: 8, step: 1, label: 'Soldiers in the back' },
    doorGuns: { value: 'both', options: ['both', 'left', 'right', 'none'], label: 'Door guns (manned from the back)' },
    start: { value: 'air', options: ['air', 'ground'], label: 'Starts (in the air / on the ground, rotor still)' },
    fromX: { value: -260, min: -2000, max: 2000, step: 10, label: 'Comes from X (m)' },
    fromZ: { value: 0, min: -2000, max: 2000, step: 10, label: 'Comes from Z (m)' },
    altitude: { value: 40, min: 15, max: 400, step: 5, label: 'Altitude (m over the zone)' },
    cruise: { value: 45, min: 15, max: 75, step: 1, label: 'Cruise speed (m/s)' },
    hoverAlt: { value: 12, min: 4, max: 25, step: 0.5, label: 'Fast-rope hover height (m)' },
    ropeLength: { value: 20, min: 6, max: 30, step: 1, label: 'Rope length (m)' },
    orbitRadius: { value: 70, min: 30, max: 400, step: 5, label: 'Orbit radius (m)' },
    callsign: { value: 'Hawk', options: ['Hawk', 'Raven', 'Dustoff', 'Viper'], label: 'Call sign' },
    color: { value: '#4a5240', color: true, label: 'Paint' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Seed' },
    armament: { value: 'none', options: ['none', 'gunship', 'attack', 'escort'], label: 'Armament beside the door guns (gunship: 30 mm chin gun, 38 rockets; attack: gun, 19 rockets, 8 anti-tank and 2 air-to-air missiles; escort: 20 mm, 14 rockets, 2 air-to-air)', group: 'Weapons' },
    attackStyle: { value: 'standoff', options: ['standoff', 'gunRun'], label: 'With the gun only: from a standoff, masked, popping up / gun runs', group: 'Weapons' },
    engageR: { value: 2600, min: 300, max: 5000, step: 50, label: 'Goes for what it identifies within (m)', group: 'Weapons' },
    startAfter: { value: 0, min: 0, max: 600, step: 5, label: 'Comes after (s: not there until then)', group: 'Weapons' },
    autoStart: { value: true, label: 'On the ground: starts its mission by itself (off: parked, rotor still, until flown)' },
    // load and crew (ai/helicopter.js heliMass: its weight sets how fast it climbs and turns)
    fuel: { value: 1, min: 0.1, max: 1, step: 0.05, label: 'Fuel load (of full: 1360 kg; lighter climbs and accelerates quicker, less to burn when hit)', group: 'Load & crew' },
    armour: { value: 'standard', options: ['none', 'standard', 'armoured'], label: 'Armour (cockpit and cabin; armoured: +450 kg)', group: 'Load & crew' },
    pilotSkill: { value: 'veteran', options: ['recruit', 'regular', 'veteran', 'elite'], label: 'Pilot experience', group: 'Load & crew' },
    troopSkill: { value: 'regular', options: ['recruit', 'regular', 'veteran', 'elite'], label: 'Experience of the soldiers in the back', group: 'Load & crew' },
  },
  build(p) {
    const from = [p.fromX, 0, p.fromZ];
    return {
      prims: [],
      helis: [{
        p: from, lz: [0, 0, 0], side: p.side ?? 'enemy', yaw: Math.atan2(-from[0], -from[2]) || 0, mission: p.mission, soldiers: p.soldiers, doorGuns: p.doorGuns,
        airborne: p.start !== 'ground', altitude: p.altitude, cruise: p.cruise, hoverAlt: p.hoverAlt, ropeLength: p.ropeLength,
        orbitRadius: p.orbitRadius, callsign: p.callsign, color: p.color, seed: p.seed, ...(p.autoStart === false ? { autoStart: false } : {}),
        fuel: p.fuel ?? 1, armour: p.armour ?? 'standard', pilotSkill: p.pilotSkill, troopSkill: p.troopSkill,
        ...(p.armament && p.armament !== 'none' ? { armament: p.armament, attackStyle: p.attackStyle, engageR: p.engageR } : {}),
        ...(p.startAfter > 0 ? { startAfter: p.startAfter } : {}),
      }],
    };
  },
};
