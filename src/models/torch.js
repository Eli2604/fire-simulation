/**
 * A wall torch's head, as its detail patch has it (sim/patches.js; in the scene a torch is
 * drawn, render/torches.js, and simulated as its flame): rags wound round the end of a stick
 * and soaked in pitch. It burns as a candle does, many wicks at once: the rag strands draw
 * the pitch the flame melts and burn it at their ends, the pitch runs and drips where the
 * flame melts more than they draw. In its own frame: the head's top at `top` (m above the
 * box's floor), its axis leaning out from the wall (+x) by `tilt` degrees from the vertical.
 */
export default {
  label: 'Torch head (pitch and rags)',
  params: {
    headRadius: { value: 0.045, min: 0.02, max: 0.08, step: 0.005, label: 'Head radius (m)' },
    headLength: { value: 0.13, min: 0.05, max: 0.25, step: 0.01, label: 'Head length (m)' },
    tilt: { value: 24, min: 0, max: 60, step: 1, label: 'Lean from the vertical (°)' },
    top: { value: 0.2, min: 0.05, max: 1, step: 0.01, label: 'Top of the head (m)' },
    handle: { value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Handle in the box (m)' },
    strands: { value: 0.015, min: 0.006, max: 0.04, step: 0.001, label: 'Rag strands, spacing (m)' },
  },
  build(p, { h }) {
    const t = (p.tilt * Math.PI) / 180;
    const a = [Math.sin(t), Math.cos(t), 0]; // along the head, up
    const e1 = [Math.cos(t), -Math.sin(t), 0]; // across it
    const e2 = [0, 0, 1];
    const T = [0, p.top, 0];
    const at = (s, u = 0, v = 0) => [T[0] + a[0] * s + e1[0] * u + e2[0] * v, T[1] + a[1] * s + e1[1] * u + e2[1] * v, T[2] + a[2] * s + e1[2] * u + e2[2] * v];
    const L = p.headLength;
    const prims = [];
    // the handle under the head (drawn by the scene: hidden here)
    if (p.handle > 0) prims.push({ shape: 'capsule', a: at(-L - p.handle), b: at(-L + 0.01), r: 0.022, material: 'wood', color: [0.3, 0.2, 0.12], hidden: true, anchored: true });
    prims.push({ shape: 'cylinder', a: at(-L), b: at(0), r: p.headRadius, material: 'pitch', variation: 0.15, anchored: true });
    // rag strands through the head along its axis, their ends standing out of the top
    const s = Math.max(p.strands, h * 1.5);
    const R = p.headRadius - h * 0.5;
    for (let u = -R; u <= R + 1e-9; u += s)
      for (let v = -R; v <= R + 1e-9; v += s) {
        if (u * u + v * v > R * R) continue;
        prims.push({ shape: 'cylinder', a: at(-L + 0.015, u, v), b: at(0.012, u, v), r: 0.0005, material: 'wick', anchored: true });
      }
    return { prims, ignite: { p: at(0.006), radius: p.headRadius + h, materials: ['wick'] } };
  },
};
