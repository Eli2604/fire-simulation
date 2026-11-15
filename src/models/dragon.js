/**
 * Where a dragon has its lair (it is a creature, not voxels: see ai/dragon.js and
 * render/dragon.js). It lies there to rest, and comes back there to heal.
 *  length      nose to tail; wings, strength and fire scale with it
 *  colours     the fish-scale skin: a dark back, sides and a pale belly
 *  start       lying in its lair, or already in the air
 *  route       its round, waypoints in the zone's metres: "x,z action; x,z action; ..."
 *              actions: rest (lie down a while), climb (crawl up and over what is
 *              there: a wall, a roof, a steep hilltop), sniff (stop and taste the air),
 *              fly (fly there and land), fight (fly at the nearest other dragon and fight it in
 *              the air: ai/dragonAir.js). Empty: it rests in its lair and now and
 *              then flies round and lands somewhere to crawl about.
 */
/** What its age does: health ×, scales (of a wound taken off). */
const AGE = { young: { health: 0.6, armour: 0 }, adult: { health: 1, armour: 0 }, ancient: { health: 1.6, armour: 0.2 } };
export default {
  label: 'Dragon (lair)',
  params: {
    length: { value: 9, min: 4, max: 14, step: 0.5, label: 'Length nose to tail (m)' },
    colours: { value: 'bronze', options: ['bronze', 'tarpon', 'koi'], label: 'Scales' },
    health: { value: 600, min: 100, max: 3000, step: 50, label: 'Health' },
    start: { value: 'rest', options: ['rest', 'fly'], label: 'At the start' },
    route: { value: '', label: 'Route: "x,z action; ..." (rest, climb, sniff, fly, fight)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
    // its senses (ai/perception.js)
    sightRange: { value: 45, min: 5, max: 400, step: 1, label: 'Sight: how far it picks up someone in clear sight (m; dozing: 13 m of 45)' },
    fov: { value: 360, min: 30, max: 360, step: 5, label: 'Field of view (degrees; 360: all round)' },
    hearing: { value: 1.6, min: 0, max: 5, step: 0.1, label: 'Hearing (× how far a sound carries)' },
    // its impacts (sim/impact.js: landings, stamps, crashes): the closing speed ×, so force ×, energy ײ
    force: { value: 1, min: 0, max: 5, step: 0.05, label: 'Force × (landings, stamps: shockwave, sound)' },
    // its nature (ai/dragon.js): age scales its health and scales, the fire gland, how fiercely it fights
    age: { value: 'adult', options: ['young', 'adult', 'ancient'], label: 'Age (young: ×0.6 health, thin scales; ancient: ×1.6 health, thick scales)', group: 'Nature' },
    fireCapacity: { value: 1, min: 0.3, max: 3, step: 0.1, label: 'Fire breath capacity (× how long its jets last; refills slower when bigger)', group: 'Nature' },
    aggression: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Aggression (how long it fights on before it flees: 0.5 at a quarter of its health)', group: 'Nature' },
    scaleArmour: { value: 0, min: 0, max: 0.8, step: 0.05, label: 'Armour scales (of each wound they take off; added to its age)', group: 'Nature' },
  },
  build(p) {
    return { prims: [], dragons: [{ p: [0, 0, 0], yaw: 0, length: p.length, colours: p.colours, health: Math.round((p.health ?? 600) * (AGE[p.age]?.health ?? 1)), scaleArmour: Math.min(0.9, (p.scaleArmour ?? 0) + (AGE[p.age]?.armour ?? 0)), fireCapacity: p.fireCapacity ?? 1, aggression: p.aggression ?? 0.5, age: p.age ?? 'adult', startState: p.start, route: p.route, seed: p.seed, sightRange: p.sightRange, fov: p.fov, hearing: p.hearing, forceScale: p.force ?? 1 }] };
  },
};
