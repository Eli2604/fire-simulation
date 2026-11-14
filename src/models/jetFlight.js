import { FORMATIONS } from '../ai/flight.js';

/**
 * A flight of jets (ai/flight.js): two to eight fighters in formation round a leader, who gives
 * the orders on the radio (form up, formation changes, split and flank, engage, break, rejoin,
 * orbit, RTB). They start airborne, in formation, on a left-hand orbit round this object's place
 * at the altitude given; the target is a point offset from it. Drawn with the jet's own mesh
 * (render/jetMesh.js, render/flights.js); not voxels (they fly far out of any zone).
 */
export default {
  label: 'Jet flight (formation)',
  params: {
    count: { value: 4, min: 2, max: 8, step: 1, label: 'Jets' },
    formation: { value: 'fingerFour', options: Object.keys(FORMATIONS), label: 'Formation' },
    spacing: { value: 30, min: 12, max: 120, step: 1, label: 'Spacing (m)' },
    altitude: { value: 150, min: 30, max: 1200, step: 5, label: 'Altitude (m)' },
    speed: { value: 80, min: 30, max: 160, step: 1, label: 'Cruise speed (m/s)' },
    orbitRadius: { value: 600, min: 100, max: 3000, step: 10, label: 'Orbit radius (m)' },
    leader: { value: 0, min: 0, max: 7, step: 1, label: 'Leader (jet number - 1)' },
    rockets: { value: 4, min: 0, max: 16, step: 1, label: 'Rockets per jet' },
    callsign: { value: 'Viper', options: ['Viper', 'Cobra', 'Falcon', 'Hawk'], label: 'Call sign' },
    targetX: { value: 1400, min: -4000, max: 4000, step: 10, label: 'Target offset X (m)' },
    targetZ: { value: -500, min: -4000, max: 4000, step: 10, label: 'Target offset Z (m)' },
    auto: { value: true, label: 'Leader gives orders by himself' },
    color: { value: '#6f7b86', color: true, label: 'Paint' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Seed' },
  },
  build(p) {
    return {
      prims: [],
      flights: [{
        count: p.count, formation: p.formation, spacing: p.spacing, altitude: p.altitude, speed: p.speed,
        orbitRadius: p.orbitRadius, leader: Math.min(p.leader, p.count - 1), rockets: p.rockets, callsign: p.callsign,
        auto: p.auto, color: p.color, seed: p.seed, p: [0, 0, 0], target: [p.targetX, 0, p.targetZ], home: [0, 0, 0],
      }],
    };
  },
};
