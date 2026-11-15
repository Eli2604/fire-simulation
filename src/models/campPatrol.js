/**
 * A soldier squad on patrol: a fire team (commander, gunner, riflemen) walking a round about a
 * point, in file (ai/enemies.js: one leads, the others follow ~3.5 m apart on his track), corner
 * after corner of a polygon (`corners` points on a circle of `radius`). They are fire teams in
 * every other way (ai/squad.js: roles, call sign, expertise, armour, radio, cover, bounding
 * overwatch, parkour only once alerted): once the team sees you, hears something or is sent to
 * look, the squad AI has them, and they go back to their round when it is over. Soldiers, not
 * guards: they do not slip off to light fires.
 * A path drawn in the editor's view (ai/patrol.js) takes the place of the round; an area drawn
 * as well is where they keep to (the leash).
 */
import { PATROL_PARAMS, drawnPatrol } from '../ai/patrol.js';
export default {
  label: 'Soldier squad on patrol (a round)',
  params: {
    count: { value: 4, min: 2, max: 8, step: 1, label: 'Soldiers' },
    radius: { value: 12.5, min: 3, max: 40, step: 0.5, label: 'Round: radius (m)' },
    corners: { value: 8, min: 3, max: 16, step: 1, label: 'Round: corners' },
    clockwise: { value: true, label: 'Clockwise (seen from above)' },
    unit: { value: 'Kilo', options: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Kilo', 'Lima'], label: 'Team call sign' },
    skill: { value: 'mixed', options: ['mixed', 'recruit', 'regular', 'veteran', 'elite'], label: 'Expertise (mixed: a veteran commander, regulars, a recruit)' },
    armour: { value: true, label: 'Body armour (plates) and helmets' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Ground height (m)' },
    recoil: { value: 1, min: 0, max: 3, step: 0.05, label: 'Weapon recoil (× the physical)' },
    ...PATROL_PARAMS,
  },
  build(p) {
    const n = Math.max(3, Math.round(p.corners));
    const s = p.clockwise ? 1 : -1;
    // (x east, z south: seen from above, clockwise is +angle in x-z)
    const drawn = drawnPatrol(p);
    // (a drawn path: its waypoints are the round; a drawn area only: random spots in it, from its first corner)
    const corners = drawn?.corners ?? Array.from({ length: n }, (_, k) => {
      const t = s * (k / n) * Math.PI * 2;
      return [Math.cos(t) * p.radius, p.level, Math.sin(t) * p.radius];
    });
    const skillOf = (k) => (p.skill !== 'mixed' ? p.skill : k === 0 ? 'veteran' : k === p.count - 1 && p.count > 2 ? 'recruit' : 'regular');
    // they start in file at the first corner, the leader at the front, the others behind him
    // along the leg they came by
    const t0 = corners[0];
    const t1 = corners[corners.length - 1];
    const dl = Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) || 1;
    return {
      prims: [],
      enemies: Array.from({ length: p.count }, (_, k) => ({
        p: [t0[0] + ((t1[0] - t0[0]) / dl) * 3.5 * k, p.level, t0[2] + ((t1[2] - t0[2]) / dl) * 3.5 * k],
        area: drawn ?? { mode: 'route', corners },
        routeStart: 0,
        soldier: true,
        unit: p.unit,
        skill: skillOf(k),
        armour: p.armour !== false,
        recoil: p.recoil ?? 1,
      })),
    };
  },
};
