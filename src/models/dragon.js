/**
 * Where a dragon has its lair (it is a creature, not voxels: see ai/dragon.js and
 * render/dragon.js). It lies there to rest, and comes back there to heal.
 *  length      nose to tail; wings, strength and fire scale with it
 *  colours     the fish-scale skin: a dark back, sides and a pale belly
 *  start       lying in its lair, or already in the air
 *  route       its round, waypoints in the zone's metres: "x,z action; x,z action; ..."
 *              actions: rest (lie down a while), climb (crawl up and over what is
 *              there: a wall, a roof, a steep hilltop), sniff (stop and taste the air),
 *              fly (fly there and land). Empty: it rests in its lair and now and
 *              then flies round and lands somewhere to crawl about.
 */
export default {
  label: 'Dragon (lair)',
  params: {
    length: { value: 9, min: 4, max: 14, step: 0.5, label: 'Length nose to tail (m)' },
    colours: { value: 'bronze', options: ['bronze', 'tarpon', 'koi'], label: 'Scales' },
    health: { value: 600, min: 100, max: 3000, step: 50, label: 'Health' },
    start: { value: 'rest', options: ['rest', 'fly'], label: 'At the start' },
    route: { value: '', label: 'Route: "x,z action; ..." (rest, climb, sniff, fly)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p) {
    return { prims: [], dragons: [{ p: [0, 0, 0], yaw: 0, length: p.length, colours: p.colours, health: p.health, startState: p.start, route: p.route }] };
  },
};
