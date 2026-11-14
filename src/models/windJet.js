/**
 * A wind jet: a fan or a blower (sim/stirrers.js): a cone of moving air from its nozzle along the
 * object's +X (turn it with the rotation, aim it up or down with the pitch), spreading and slowing
 * as it goes. It drives smoke and flames before it. Drawn as streaks along the cone.
 */
export default {
  label: 'Wind jet (fan/blower)',
  params: {
    speed: { value: 12, min: 1, max: 60, step: 0.5, label: 'Air speed at the nozzle (m/s)' },
    nozzle: { value: 0.4, min: 0.05, max: 3, step: 0.05, label: 'Nozzle radius (m)' },
    spread: { value: 10, min: 2, max: 35, step: 1, label: 'Spread (° half angle)' },
    range: { value: 12, min: 1, max: 60, step: 0.5, label: 'Reach (m)' },
    pitch: { value: 0, min: -80, max: 80, step: 1, label: 'Aimed up (°)' },
    height: { value: 1, min: 0, max: 20, step: 0.1, label: 'Nozzle height (m)' },
  },
  build(p) {
    const a = (p.pitch * Math.PI) / 180;
    return {
      prims: [],
      stirrers: [{ kind: 'jet', p: [0, p.height, 0], dir: [Math.cos(a), Math.sin(a), 0], speed: p.speed, nozzle: p.nozzle, spread: p.spread, range: p.range }],
    };
  },
};
