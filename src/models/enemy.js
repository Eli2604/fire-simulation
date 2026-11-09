/**
 * Where enemies start (they are characters, not voxels) and the area they patrol:
 *  wander   stroll around their starting point (12 m)
 *  area     random spots inside a rectangle (patrol width x depth, offset from
 *           the group's position)
 *  route    walk the rectangle's corners in turn, like a guard round
 * After investigating a noise or luring you, they go back to their area.
 */
export default {
  label: 'Enemies',
  params: {
    count: { value: 3, min: 1, max: 12, step: 1, label: 'Number' },
    spread: { value: 4, min: 0.5, max: 20, step: 0.5, label: 'Spread (m)' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
    patrol: { value: 'wander', options: ['wander', 'area', 'route'], label: 'Patrol' },
    patrolWidth: { value: 8, min: 1, max: 60, step: 0.5, label: 'Patrol area along X (m)' },
    patrolDepth: { value: 8, min: 1, max: 60, step: 0.5, label: 'Patrol area along Z (m)' },
    patrolOffsetX: { value: 0, min: -30, max: 30, step: 0.5, label: 'Patrol area offset X (m)' },
    patrolOffsetZ: { value: 0, min: -30, max: 30, step: 0.5, label: 'Patrol area offset Z (m)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { rng }) {
    const enemies = [];
    const hw = p.patrolWidth / 2;
    const hd = p.patrolDepth / 2;
    const ox = p.patrolOffsetX;
    const oz = p.patrolOffsetZ;
    const area = p.patrol === 'wander' ? null : { mode: p.patrol, corners: [[ox - hw, p.level, oz - hd], [ox + hw, p.level, oz - hd], [ox + hw, p.level, oz + hd], [ox - hw, p.level, oz + hd]] };
    for (let k = 0; k < p.count; k++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * p.spread;
      enemies.push({ p: [Math.cos(a) * r, p.level, Math.sin(a) * r], area, routeStart: k });
    }
    return { prims: [], enemies };
  },
};
