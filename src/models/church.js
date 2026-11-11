/**
 * A gothic church under construction: a single-aisle nave of three rib-vaulted bays with
 * transept arms on the middle bay (the crossing), a polygonal apse, and a west tower.
 *
 * Finished: the nave, the north (left) transept arm and the apse, with stained-glass
 * windows in bar tracery (two lancets and an oculus, a rose in the north gable, tall
 * lancets round the apse), a slate roof, buttresses with pinnacles, a carved west portal,
 * pews, an altar and an inlaid marble rosette in the floor of the crossing.
 *
 * Under construction: the tower and the south (right) transept arm. Their masonry stops
 * at ragged, stepped tops; their inner structure is complete and in plain view: the
 * timber frame of the tower (posts, floors, braces, the bell frame and the skeleton of
 * the spire), the roof trusses of the south arm, the wooden centering for its vault ribs,
 * iron tie rods and the iron armatures of windows still waiting for their glass. Pole
 * scaffolding with plank decks, putlogs and ladders stands round both, with a treadwheel
 * crane. The south arm is boarded off from the crossing.
 *
 * Simulated as voxels: stone walls (limestone), slate roof, floor, the timber and
 * scaffolding (hidden voxels, drawn as beams and boards), the glass (hidden voxels, drawn
 * as stained glass: it cracks with heat and breaks to arrows and blasts), pews and the
 * west door. Drawn only (render/church.js): tracery, vaults, ribs, pinnacles, the light
 * of the sun through the glass.
 *
 * Local frame: x east (altar), z south, y up, origin on the floor at the crossing centre.
 */
export default {
  label: 'Gothic church (under construction)',
  params: {
    wallHeight: { value: 8, min: 6, max: 10, step: 0.4, label: 'Wall height (m)' },
    seed: { value: 3, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h, rng }) {
    // voxel faces: x/z at (k + 0.5) h from the origin (it sits on a voxel centre), y at k h
    const S = (v) => (Math.round(v / h - 0.5) + 0.5) * h;
    const Y = (v) => Math.max(h, Math.round(v / h) * h);
    const T = S(3.8) - S(3.0); // wall thickness (0.8 m)
    const hw = S(3.0); // nave: inner half width
    const hwo = hw + T;
    const xW = S(-5.0); // nave inside, west end
    const xE = S(5.0); // nave inside, east end (the apse chord)
    const xc = S(1.8); // the crossing: -xc..xc (also the inside of the transept arms)
    const xco = xc + T;
    const zA = S(5.8); // transept arm, inside to the end wall
    const zAo = zA + T;
    const WH = Y(p.wallHeight);
    const FD = -Math.round(2 / h) * h; // foundations go ~2 m into the ground (slopes)
    const tw0 = S(-9.4); // tower outside, west face
    const tw1 = xW - T; // tower inside, east (the nave's west wall)
    const tz = S(2.2); // tower outside half width
    const tzi = tz - T;
    const ys = Y(4.8); // vault springing
    const yc = WH - 0.1; // vault crowns
    const roofRise = (hwo + 0.4) * 1.05;
    const apseR = hw; // apse: inner circumradius (half octagon round (xE, 0))
    const apseRo = hwo;

    const prims = [];
    const stone = { material: 'ashlar', color: [0.78, 0.73, 0.63], variation: 0.06 };
    const slate = { material: 'tiles', color: [0.25, 0.27, 0.31], variation: 0.08 };
    const box = (x0, y0, z0, x1, y1, z1, o) => prims.push({ shape: 'box', min: [x0, y0, z0], max: [x1, y1, z1], ...o });
    const carve = (x0, y0, z0, x1, y1, z1) => box(x0, y0, z0, x1, y1, z1, { mode: 'carve' });
    const oct = (R, cx = xE) => [-90, -45, 0, 45, 90].map((a) => [cx + R * Math.cos((a * Math.PI) / 180), R * Math.sin((a * Math.PI) / 180)]);

    // ---------------- drawn detail, filled in as the voxels are laid out ----------------
    const spec = {
      h, WH, hw, hwo, xW, xE, xc, xco, zA, zAo, tw0, tw1, tz, tzi, ys, yc, roofRise, apseR, apseRo, T,
      windows: [], // stained glass (or the bare iron armature where the glass is still to come)
      openings: [], // arches through walls: stone infill above a pointed arch
      vaults: [], // { kind: 'bay' | 'apse', ... }
      beams: [], // timber, iron: { a, b, s: [w, d], mat, part, roll? }
      boards: [], // planks: { c, u, v, w, l, t, mat, part }
      ribs: [], // wooden centering (curves): { pts, part }
      parts: {}, // part name -> list of anchor points (local) of its simulated voxels
      pinnacles: [],
      cornices: [],
      room: [], // the finished interior as boxes [x0, y0, z0, x1, y1, z1] (sunlight is clipped to it)
      pews: [],
      seed: p.seed,
    };
    const anchor = (part, pt) => (spec.parts[part] ??= []).push(pt);
    /** A timber or iron member. vox: it is simulated (hidden voxels along it). */
    const beam = (a, b, s, mat, part, vox = true) => {
      spec.beams.push({ a, b, s, mat, part });
      if (!vox) return;
      prims.push({ shape: 'cylinder', a, b, r: Math.max(s[0], s[1]) / 2, material: mat === 'iron' ? 'steel' : 'wood', density: mat === 'iron' ? 0.3 : 0.6, hidden: true, anchored: true, mode: 'fill' });
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / h));
      for (let k = 0; k <= n; k++) anchor(part, a.map((v, i) => v + ((b[i] - v) * k) / n));
    };
    /** A plank deck or board panel: centre, along (u) and across (v) axes. */
    const deck = (c, u, v, l, w, part, vox = true, t = 0.05) => {
      spec.boards.push({ c, u, v, l, w, t, part });
      if (!vox) return;
      const ex = [0, 1, 2].map((i) => Math.abs(u[i]) * l / 2 + Math.abs(v[i]) * w / 2);
      box(c[0] - ex[0], c[1] - h, c[2] - ex[2], c[0] + ex[0], c[1], c[2] + ex[2], { material: 'wood', density: 0.35, hidden: true, anchored: true, mode: 'fill' });
      for (let a = -0.5; a <= 0.5; a += 0.25) for (let b = -0.5; b <= 0.5; b += 0.5) anchor(part, [0, 1, 2].map((i) => c[i] + u[i] * l * a + v[i] * w * b - (i === 1 ? h / 2 : 0)));
    };

    // ---------------- floor and foundations ----------------
    // a stone floor through the whole church (it replaces the turf)
    box(tw0, -h, -tz, xE, 0, tz, stone);
    box(-xco, -h, -zAo, xco, 0, zAo, stone);
    box(xW - T, -h, -hwo, xE, 0, hwo, stone);
    prims.push({ shape: 'prism', poly: oct(apseRo), y0: -h, y1: 0, ...stone });

    // ---------------- walls of the finished parts ----------------
    box(xW - T, FD, -hwo, xE, WH, hwo, stone); // nave block
    prims.push({ shape: 'prism', poly: oct(apseRo), y0: FD, y1: WH, ...stone }); // apse
    box(-xco, FD, -zAo, xco, WH, -hwo, stone); // north arm
    // inside
    carve(xW, 0, -hw, xE, WH + h, hw);
    prims.push({ shape: 'prism', poly: oct(apseR), y0: 0, y1: WH + h, mode: 'carve' });
    carve(-xc, 0, -zA, xc, WH + h, -hwo);
    // the crossing arches into both arms (the south one is boarded off)
    const archTop = Y(7.2);
    carve(-xc, 0, -hwo, xc, archTop, -hw);
    carve(-xc, 0, hw, xc, archTop, hwo);
    for (const s of [-1, 1]) spec.openings.push({ o: [0, 0, s * (hw + T / 2)], u: [1, 0, 0], n: [0, 0, s], w: 2 * xc, h: archTop, spring: Y(4.4), d: T, kind: 'arch' });

    // ---------------- the south arm: unfinished masonry (stepped, ragged tops) ----------------
    const ragged = (x0, z0, x1, z1, hA, hB) => {
      // a wall built up in courses, stepping down from hA to hB along its length
      const alongX = x1 - x0 > z1 - z0;
      const L = alongX ? x1 - x0 : z1 - z0;
      const n = Math.max(1, Math.round(L / (2 * h)));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const top = Y(hA + (hB - hA) * t + (rng() - 0.5) * 0.9);
        const a = (alongX ? x0 : z0) + (L * k) / n;
        const b = (alongX ? x0 : z0) + (L * (k + 1)) / n;
        if (alongX) box(a, FD, z0, b, top, z1, stone);
        else box(x0, FD, a, x1, top, b, stone);
        // the top course is still being laid: a few blocks sit loose on it
        if (rng() < 0.4) box(alongX ? a : x0, top, alongX ? z0 : a, alongX ? a + h * 2 : x1, top + h, alongX ? z1 : a + h * 2, { ...stone, color: [0.8, 0.76, 0.66] });
      }
    };
    ragged(xc, hwo, xco, zAo, 6.4, 4.2); // east wall
    ragged(-xco, hwo, -xc, zAo, 7.0, 4.8); // west wall
    ragged(-xco, zA, xco, zAo, 2.8, 4.0); // south end wall
    carve(-xc, 0, hwo, xc, WH + 4, zA);

    // ---------------- the tower: unfinished ----------------
    ragged(tw0, -tz, tw0 + T, tz, 10.4, 9.2); // west face
    ragged(tw0 + T, -tz, tw1, -tzi, 9.6, 8.4); // north
    ragged(tw0 + T, tzi, tw1, tz, 8.8, 9.6); // south
    carve(tw0 + T, 0, -tzi, tw1, 20, tzi);
    // west portal (a door) and the tower arch into the nave
    const pw = S(1.0);
    const ph = Y(3.2);
    carve(tw0, 0, -pw, tw0 + T, ph, pw);
    box(tw0 + T / 2, 0, -pw, tw0 + T, ph, pw, { material: 'wood', density: 0.6, color: [0.36, 0.24, 0.14], door: 'west portal' });
    spec.portal = { o: [tw0, 0, 0], w: 2 * pw, h: ph, apex: Y(5.0) };
    carve(tw1, 0, -pw, xW, Y(4.0), pw);
    spec.openings.push({ o: [xW - T / 2, 0, 0], u: [0, 0, 1], n: [-1, 0, 0], w: 2 * pw, h: Y(4.0), spring: Y(2.8), d: T, kind: 'arch' });
    // slit windows lighting the tower stair
    for (const s of [-1, 1]) carve(S(-7.4), Y(4.4), s > 0 ? tzi : -tz, S(-7.0), Y(6.0), s > 0 ? tz : -tzi);

    // ---------------- windows ----------------
    const win = (o, n, w, y0, kind, extra = {}) => {
      // opening through the wall, glass (hidden voxels) in the outer half of it
      const u = [n[2], 0, -n[0]]; // along the wall: (u, up, n) is right handed
      const top = y0 + (extra.height ?? 5.4);
      const W2 = w / 2;
      const ax = Math.abs(n[0]) > 0.5;
      const glass = extra.glass !== false;
      const win = { o, u, n, w, y0, top, kind, d: T, glass, seed: spec.windows.length * 7 + p.seed, ...extra };
      spec.windows.push(win);
      const part = `window${spec.windows.length}`;
      win.part = part;
      if (extra.poly) {
        // an opening in a wall that is not axis aligned (the apse): carved as a prism
        const P = (a, b) => [o[0] + u[0] * a + n[0] * b, o[2] + u[2] * a + n[2] * b];
        prims.push({ shape: 'prism', poly: [P(-W2, -T), P(W2, -T), P(W2, T), P(-W2, T)], y0, y1: top, mode: 'carve' });
        if (glass) prims.push({ shape: 'prism', poly: [P(-W2 + 0.05, 0), P(W2 - 0.05, 0), P(W2 - 0.05, h * 0.9), P(-W2 + 0.05, h * 0.9)], y0, y1: top, material: 'glass', hidden: true, anchored: true });
      } else if (ax) {
        carve(o[0] - T, y0, o[2] - W2, o[0] + T, top, o[2] + W2);
        if (glass) box(o[0] + (n[0] > 0 ? 0 : -h), y0, o[2] - W2, o[0] + (n[0] > 0 ? h : 0), top, o[2] + W2, { material: 'glass', hidden: true, anchored: true });
      } else {
        carve(o[0] - W2, y0, o[2] - T, o[0] + W2, top, o[2] + T);
        if (glass) box(o[0] - W2, y0, o[2] + (n[2] > 0 ? 0 : -h), o[0] + W2, top, o[2] + (n[2] > 0 ? h : 0), { material: 'glass', hidden: true, anchored: true });
      }
      if (glass) for (let a = -0.35; a <= 0.36; a += 0.35) for (let b = 0.1; b < 0.95; b += 0.2) anchor(part, [o[0] + u[0] * w * a + n[0] * h * 0.5, y0 + (top - y0) * b * 0.8, o[2] + u[2] * w * a + n[2] * h * 0.5]);
      return win;
    };
    const wy0 = Y(2.0);
    for (const s of [-1, 1]) {
      // nave: the west and east bays, both sides
      for (const bx of [(xW - xc) / 2, (xc + xE) / 2]) win([bx, 0, s * (hw + T / 2)], [0, 0, s], 2.0, wy0, 'two', { height: Y(7.4) - wy0 });
      // transept arms, east and west walls (the south arm's are still open: armature only)
      for (const sx of [-1, 1]) win([sx * (xc + T / 2), 0, (s * (hwo + zA)) / 2], [sx, 0, 0], 1.2, wy0, 'one', { height: Y(7.2) - wy0, glass: s < 0 });
    }
    // the apse: a tall lancet in each face of the half octagon
    for (const a of [-67.5, -22.5, 22.5, 67.5]) {
      const r = (a * Math.PI) / 180;
      const ap = ((apseR + apseRo) / 2) * Math.cos(Math.PI / 8);
      win([xE + ap * Math.cos(r), 0, ap * Math.sin(r)], [Math.cos(r), 0, Math.sin(r)], 1.2, Y(1.6), 'one', { height: Y(7.2) - Y(1.6), poly: true });
    }
    // rose windows in the transept gables (the south one: only its iron frame so far)
    for (const s of [-1, 1]) {
      const rc = [0, Y(5.6), s * (zA + T / 2)];
      const R = 1.3;
      if (s < 0) {
        prims.push({ shape: 'cylinder', a: [0, rc[1], s * (zA - 0.2)], b: [0, rc[1], s * (zAo + 0.2)], r: R, mode: 'carve' });
        prims.push({ shape: 'cylinder', a: [0, rc[1], s * (zA + T / 2)], b: [0, rc[1], s * zAo], r: R - 0.05, material: 'glass', hidden: true, anchored: true });
      }
      const w = { o: [0, rc[1] - R, rc[2]], u: [s, 0, 0], n: [0, 0, s], w: 2 * R, y0: rc[1] - R, top: rc[1] + R, kind: 'rose', d: T, glass: s < 0, seed: 40 + s, part: `rose${s}` };
      spec.windows.push(w);
      if (s < 0) for (let k = 0; k < 8; k++) anchor(w.part, [Math.cos(k) * R * 0.6, rc[1] + Math.sin(k) * R * 0.6, s * (zAo - h / 2)]);
    }

    // ---------------- roofs (slate) and gables ----------------
    prims.push({ shape: 'gable', x0: xW - T, x1: xE, y0: WH, half: hwo + 0.4, rise: roofRise, shell: h * 1.05, ...slate });
    // the apse roof: a half pyramid over the half octagon, built up in courses
    const nL = Math.ceil(roofRise / h);
    for (let k = 0; k < nL; k++) {
      const y = WH + k * h;
      const R = (apseRo + 0.4) * (1 - (k * h) / roofRise);
      if (R < h * 0.5) break;
      const Ri = R - h * 1.6;
      prims.push({ shape: 'prism', poly: oct(R), hole: Ri > 0 ? oct(Ri) : null, y0: y, y1: y + h, ...slate });
    }
    const aRise = (xco + 0.4) * 1.05;
    prims.push({ shape: 'gable', along: 'z', x0: -zAo - 0.4, x1: -hw, y0: WH, half: xco + 0.4, rise: aRise, shell: h * 1.05, ...slate, mode: 'fill' });
    prims.push({ shape: 'gable', along: 'z', x0: -zAo, x1: -zA, y0: WH, half: xco, rise: aRise * (xco / (xco + 0.4)), ...stone, mode: 'fill' });
    // the west gable of the nave, behind the tower
    prims.push({ shape: 'gable', x0: xW - T, x1: xW, y0: WH, half: hwo, rise: roofRise * (hwo / (hwo + 0.4)), ...stone, mode: 'fill' });

    // ---------------- buttresses and pinnacles ----------------
    const buttress = (x, z, dx, dz) => {
      // stepped: deep at the foot, shallower in two offsets; a pinnacle on top
      const steps = [[0, Y(3.2), 1.2], [Y(3.2), Y(5.6), 0.8], [Y(5.6), WH - h, 0.4]];
      for (const [a, b, d] of steps) {
        const x0 = dx ? (dx > 0 ? x : x - d) : x - 0.4;
        const x1 = dx ? (dx > 0 ? x + d : x) : x + 0.4;
        const z0 = dz ? (dz > 0 ? z : z - d) : z - 0.4;
        const z1 = dz ? (dz > 0 ? z + d : z) : z + 0.4;
        box(S(x0), a === 0 ? FD : a, S(z0), S(x1), b, S(z1), stone);
      }
      spec.pinnacles.push([x + dx * 0.2, WH - h, z + dz * 0.2]);
    };
    for (const s of [-1, 1]) {
      buttress(xE - 0.4, s * hwo, 0, s); // where the apse meets the nave
      buttress(xW - T + 0.4, s * hwo, 0, s); // west corners (beside the tower)
    }
    buttress(-xco + 0.4, -zAo, 0, -1);
    buttress(xco - 0.4, -zAo, 0, -1);
    for (const a of [-45, 0, 45]) {
      const r = (a * Math.PI) / 180;
      const c = [xE + apseRo * Math.cos(r), apseRo * Math.sin(r)];
      // a diagonal buttress: built as a short prism along the vertex direction
      const n = [Math.cos(r), Math.sin(r)];
      const t = [-n[1], n[0]];
      for (const [y0, y1, d] of [[FD, Y(3.2), 1.3], [Y(3.2), Y(5.6), 0.9], [Y(5.6), WH - h, 0.5]]) {
        const P = (a2, b2) => [c[0] + t[0] * a2 + n[0] * b2, c[1] + t[1] * a2 + n[1] * b2];
        prims.push({ shape: 'prism', poly: [P(-0.4, -0.5), P(0.4, -0.5), P(0.4, d), P(-0.4, d)], y0, y1, ...stone });
      }
      spec.pinnacles.push([c[0] + n[0] * 0.25, WH - h, c[1] + n[1] * 0.25]);
    }
    // the cornice under the eaves of the finished parts (drawn)
    spec.cornices.push({ a: [xW - T, WH, -hwo], b: [-xco, WH, -hwo] }, { a: [xco, WH, -hwo], b: [xE, WH, -hwo] }, { a: [xW - T, WH, hwo], b: [-xco, WH, hwo] }, { a: [xco, WH, hwo], b: [xE, WH, hwo] });
    spec.cornices.push({ a: [-xco, WH, -zAo], b: [-xco, WH, -hwo] }, { a: [xco, WH, -zAo], b: [xco, WH, -hwo] });
    const ov = oct(apseRo);
    for (let k = 0; k < 4; k++) spec.cornices.push({ a: [ov[k][0], WH, ov[k][1]], b: [ov[k + 1][0], WH, ov[k + 1][1]] });

    // ---------------- vaults (drawn) and the finished interior ----------------
    spec.vaults.push(
      { kind: 'bay', x0: xW, x1: -xc, z0: -hw, z1: hw },
      { kind: 'bay', x0: -xc, x1: xc, z0: -hw, z1: hw, boss: true },
      { kind: 'bay', x0: xc, x1: xE, z0: -hw, z1: hw },
      { kind: 'bay', x0: -xc, x1: xc, z0: -zA, z1: -hw, along: 'z' },
      { kind: 'apse', cx: xE, R: apseR },
    );
    spec.room.push([xW, 0, -hw, xE + apseR, WH, hw], [-xc, 0, -zA, xc, WH, -hw]);
    spec.archTop = archTop;
    spec.symbol = { c: [0, 0.006, 0], r: Math.min(xc, hw) * 0.92 };

    // pews in the west bay, the altar in the apse
    for (let k = 0; k < 3; k++) {
      const x = xW + 0.6 + k * 0.95;
      for (const s of [-1, 1]) {
        const z0 = s * 0.7;
        const z1 = s * (hw - 0.35);
        spec.pews.push({ x, z0: Math.min(z0, z1), z1: Math.max(z0, z1), part: `pew${k}${s}` });
        box(x - 0.2, 0, Math.min(z0, z1), x + 0.2, Y(0.8), Math.max(z0, z1), { material: 'wood', density: 0.4, hidden: true, anchored: true, mode: 'fill' });
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += 0.4) anchor(`pew${k}${s}`, [x, 0.2, z]);
      }
    }
    const ax0 = S(xE + 0.6);
    box(ax0, 0, S(-1.0), ax0 + 2 * h, Y(1.2), S(1.0), { ...stone, hidden: true, anchored: true });
    spec.altar = { c: [ax0 + h, 0, 0], w: 2 * h, l: 2 * S(1.0), hgt: Y(1.2), part: 'altar' };
    anchor('altar', [spec.altar.c[0], 0.6, 0]);

    // ---------------- the inner structure of the unfinished parts ----------------
    const oak = 'oak';
    const P = 0.24; // post / beam section
    // south arm: posts in the corners, wall plates, three roof trusses, ridge and purlins
    const zs0 = hwo + 0.15;
    const zs1 = zA - 0.15;
    for (const sx of [-1, 1]) for (const z of [zs0, zs1]) beam([sx * (xc - 0.15), 0, z], [sx * (xc - 0.15), WH, z], [P, P], oak, `sframe${sx}${z > 4 ? 1 : 0}`);
    for (const sx of [-1, 1]) beam([sx * (xc - 0.15), WH + 0.12, hwo], [sx * (xc - 0.15), WH + 0.12, zAo + 0.3], [0.26, 0.22], oak, 'splate');
    const trussZ = [hwo + 0.3, (hwo + zAo) / 2, zAo - 0.1];
    const sHalf = xco + 0.4;
    const sRise = sHalf * 1.05;
    trussZ.forEach((z, k) => {
      const part = `struss${k}`;
      const apex = [0, WH + 0.24 + sRise * ((xco + 0.2) / sHalf), z];
      beam([-xco - 0.2, WH + 0.12, z], [xco + 0.2, WH + 0.12, z], [0.24, 0.3], oak, part); // tie beam
      for (const s of [-1, 1]) {
        beam([s * (xco + 0.2), WH + 0.24, z], apex, [0.22, 0.26], oak, part); // principal rafter
        beam([0, WH + 0.3, z], [s * (xco * 0.48), WH + 0.24 + sRise * 0.5, z], [0.14, 0.16], oak, part, false); // struts
        // iron straps at the feet of the rafters
        spec.beams.push({ a: [s * (xco + 0.05), WH + 0.12, z - 0.13], b: [s * (xco - 0.35), WH + 0.12, z - 0.13], s: [0.06, 0.012], mat: 'iron', part });
      }
      beam([0, WH + 0.24, z], apex, [0.2, 0.2], oak, part); // king post
      spec.beams.push({ a: [-0.11, WH + 0.2, z - 0.105], b: [0.11, WH + 0.2, z - 0.105], s: [0.05, 0.015], mat: 'iron', part });
      spec.beams.push({ a: [-0.11, WH + 0.2, z + 0.105], b: [0.11, WH + 0.2, z + 0.105], s: [0.05, 0.015], mat: 'iron', part });
    });
    const ridgeY = WH + 0.24 + sRise * ((xco + 0.2) / sHalf);
    beam([0, ridgeY, 1.3], [0, ridgeY, zAo + 0.4], [0.18, 0.24], oak, 'sridge');
    for (const s of [-1, 1]) {
      beam([s * (xco + 0.2) * 0.5, WH + 0.24 + (ridgeY - WH - 0.24) * 0.5 + 0.12, hw - 0.4], [s * (xco + 0.2) * 0.5, WH + 0.24 + (ridgeY - WH - 0.24) * 0.5 + 0.12, zAo + 0.4], [0.16, 0.2], oak, 'sridge');
      // common rafters, every half metre (not yet battened or slated)
      for (let z = hwo + 0.6; z < zAo + 0.2; z += 0.5) spec.beams.push({ a: [s * (xco + 0.45), WH + 0.2, z], b: [0, ridgeY + 0.12, z], s: [0.08, 0.12], mat: oak, part: 'sridge' });
    }
    // iron tie rods at the springing of the future vault, anchored outside with S-irons
    for (const z of [hwo + 0.4, zA - 0.4]) {
      spec.beams.push({ a: [-xco - 0.05, ys, z], b: [xco + 0.05, ys, z], s: [0.035, 0.035], mat: 'iron', part: 'sridge', round: true });
      for (const s of [-1, 1]) spec.beams.push({ a: [s * (xco + 0.04), ys - 0.35, z], b: [s * (xco + 0.04), ys + 0.35, z], s: [0.03, 0.06], mat: 'iron', part: 'sridge' });
    }
    // the wooden centering for the vault ribs (diagonals, transverse, wall ribs), on props
    spec.centering = { x0: -xc, x1: xc, z0: hw, z1: zA, part: 'scenter' };
    for (const [x, z] of [[-xc * 0.5, (hw + zA) / 2 - 0.5], [xc * 0.5, (hw + zA) / 2 - 0.5], [-xc * 0.5, (hw + zA) / 2 + 0.5], [xc * 0.5, (hw + zA) / 2 + 0.5]]) beam([x, 0, z], [x, ys + 0.5, z], [0.14, 0.14], oak, 'scenter');
    beam([0, 0, (hw + zA) / 2], [0, yc - 0.15, (hw + zA) / 2], [0.16, 0.16], oak, 'scenter');
    // the boarding that closes the arch to the crossing
    spec.partition = { z: hw + 0.12, w: 2 * xc, h: archTop, spring: Y(4.4), part: 'partition' };
    box(-xc, 0, hw, xc, archTop, hw + h, { material: 'wood', density: 0.3, hidden: true, anchored: true, mode: 'fill' });
    for (let x = -xc + 0.3; x < xc; x += 0.6) for (let y = 0.4; y < archTop; y += 1.2) anchor('partition', [x, y, hw + h / 2]);

    // tower: the inner timber frame, up through and above the masonry, and the spire skeleton
    const tcx = (tw0 + T + tw1) / 2;
    const tq = tzi - 0.2;
    const tqx = (tw1 - tw0 - T) / 2 - 0.2;
    const lv = [Y(4.0), Y(8.0), Y(11.6), Y(14.4)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam([tcx + sx * tqx, 0, sz * tq], [tcx + sx * tqx, lv[3], sz * tq], [0.26, 0.26], oak, `tpost${sx}${sz}`);
    lv.forEach((y, k) => {
      const part = `tlevel${k}`;
      for (const sz of [-1, 1]) beam([tcx - tqx - 0.15, y, sz * tq], [tcx + tqx + 0.15, y, sz * tq], [0.24, 0.26], oak, part);
      for (const sx of [-1, 1]) beam([tcx + sx * tqx, y + 0.02, -tq - 0.15], [tcx + sx * tqx, y + 0.02, tq + 0.15], [0.24, 0.26], oak, part);
      if (k < 3) {
        // a floor of joists and boards
        for (let z = -tq + 0.4; z < tq; z += 0.55) spec.beams.push({ a: [tcx - tqx, y + 0.12, z], b: [tcx + tqx, y + 0.12, z], s: [0.12, 0.16], mat: oak, part });
        deck([tcx, y + 0.24, 0], [1, 0, 0], [0, 0, 1], 2 * tqx, 2 * tq * (k === 2 ? 0.45 : 1), part, false);
        // X braces between this level and the next, on all four faces
        const y1 = lv[k + 1];
        for (const sz of [-1, 1]) {
          beam([tcx - tqx, y + 0.1, sz * tq], [tcx + tqx, y1 - 0.1, sz * tq], [0.14, 0.16], oak, part, k >= 1);
          beam([tcx + tqx, y + 0.1, sz * tq], [tcx - tqx, y1 - 0.1, sz * tq], [0.14, 0.16], oak, part, k >= 1);
        }
        for (const sx of [-1, 1]) {
          beam([tcx + sx * tqx, y + 0.1, -tq], [tcx + sx * tqx, y1 - 0.1, tq], [0.14, 0.16], oak, part, k >= 1);
          beam([tcx + sx * tqx, y + 0.1, tq], [tcx + sx * tqx, y1 - 0.1, -tq], [0.14, 0.16], oak, part, k >= 1);
        }
      }
      // iron bands round the posts at each level
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) spec.beams.push({ a: [tcx + sx * tqx, y - 0.3, sz * tq], b: [tcx + sx * tqx, y - 0.22, sz * tq], s: [0.3, 0.3], mat: 'iron', part });
    });
    // the bell in its frame
    spec.bell = { p: [tcx, lv[2] - 0.1, 0], r: 0.55, part: 'tlevel2' };
    beam([tcx, lv[2] + 0.15, -tq], [tcx, lv[2] + 0.15, tq], [0.22, 0.22], oak, 'tlevel2'); // headstock
    // the spire skeleton: hips to a central mast, a collar ring halfway
    const apexY = lv[3] + Y(2.2);
    beam([tcx, lv[3], 0], [tcx, apexY, 0], [0.22, 0.22], oak, 'tspire');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam([tcx + sx * (tqx + 0.1), lv[3] + 0.1, sz * (tq + 0.1)], [tcx, apexY, 0], [0.18, 0.18], oak, 'tspire');
    const cy = lv[3] + (apexY - lv[3]) * 0.45;
    const cr = 0.55;
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) beam([tcx + a[0] * (tqx + 0.1) * cr, cy, a[1] * (tq + 0.1) * cr], [tcx + b[0] * (tqx + 0.1) * cr, cy, b[1] * (tq + 0.1) * cr], [0.14, 0.14], oak, 'tspire');
    spec.cross = { p: [tcx, apexY, 0] };
    // the crane: a jib on the top of the frame reaching out north, its rope down to a block
    // hanging in tongs, and on to the treadwheel on the ground that winds it
    const jz = -(tz + 2.6);
    beam([tcx, lv[3] + 0.2, tq], [tcx, lv[3] + 0.2, jz - 0.2], [0.2, 0.24], oak, 'crane');
    beam([tcx, apexY - 0.6, 0], [tcx, lv[3] + 0.3, jz + 0.2], [0.12, 0.12], oak, 'crane', false);
    spec.crane = { jib: [tcx, lv[3] + 0.2, jz], load: [tcx, Y(6.0), jz], wheel: [tcx, 0, jz - 1.8], part: 'crane' };

    // ---------------- scaffolding ----------------
    /** Pole scaffolding round three or four sides of a footprint. */
    const scaffold = (x0, z0, x1, z1, sides, top, name, gap = null) => {
      const off = 1.05;
      const lifts = [];
      for (let y = 2.0; y <= top + 0.01; y += 2.0) lifts.push(Y(y));
      for (const side of sides) {
        // side: 'n' | 's' | 'e' | 'w'
        const alongX = side === 'n' || side === 's';
        const a0 = (alongX ? x0 : z0) - off;
        const a1 = (alongX ? x1 : z1) + off;
        const fixed = side === 'n' ? z0 - off : side === 's' ? z1 + off : side === 'w' ? x0 - off : x1 + off;
        const wallLine = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1;
        const out = side === 'n' || side === 'w' ? -1 : 1;
        const at = (a, y, d = 0) => (alongX ? [a, y, fixed + d] : [fixed + d, y, a]);
        const n = Math.max(2, Math.round((a1 - a0) / 1.9));
        const poles = [];
        const poleParts = [];
        for (let k = 0; k <= n; k++) {
          const a = a0 + ((a1 - a0) * k) / n;
          if (gap && side === gap.side && Math.abs(a - gap.c) < gap.w) continue;
          poles.push(a);
          poleParts.push(`${name}${side}p${k}`);
          beam(at(a, 0, 0), at(a, top + 1.0, 0), [0.13, 0.13], 'pole', `${name}${side}p${k}`, true);
          spec.beams.push({ a: at(a, -2.2, 0), b: at(a, 0, 0), s: [0.13, 0.13], mat: 'pole', part: `${name}${side}p${k}` }); // down into the ground
        }
        lifts.forEach((y, li) => {
          // planks only on the lifts being worked from (every other one, and the top);
          // the bare lifts are just ledgers and putlogs, and go with a pole when it burns
          const decked = li % 2 === 1 || li === lifts.length - 1;
          const part = decked ? `${name}${side}l${li}` : poleParts[Math.floor(poleParts.length / 2)];
          const pa = poles[0];
          const pb = poles[poles.length - 1];
          if (gap && side === gap.side && y < gap.top) {
            // over the door: the deck only starts above it
            return;
          }
          spec.beams.push({ a: at(pa - 0.2, y - 0.05, 0), b: at(pb + 0.2, y - 0.05, 0), s: [0.1, 0.1], mat: 'pole', part }); // ledger
          for (const a of poles) spec.beams.push({ a: at(a, y - 0.12, 0.15 * out), b: at(a, y - 0.12, wallLine - out * 0.25 - fixed), s: [0.09, 0.09], mat: 'pole', part }); // putlogs into the wall
          const mid = (pa + pb) / 2;
          const c = at(mid, y, -out * (off / 2));
          if (decked) {
            deck(c, alongX ? [1, 0, 0] : [0, 0, 1], alongX ? [0, 0, 1] : [1, 0, 0], pb - pa + 0.3, off - 0.15, part);
            spec.beams.push({ a: at(pa - 0.1, y + 0.95, 0), b: at(pb + 0.1, y + 0.95, 0), s: [0.07, 0.07], mat: 'pole', part }); // guard rail
          }
          // braces on the outer face, and a ladder at alternate ends
          if (li > 0) {
            const yb = lifts[li - 1];
            spec.beams.push({ a: at(pa, yb, 0.08 * out), b: at(pa + (pb - pa) * 0.5, y, 0.08 * out), s: [0.08, 0.08], mat: 'pole', part });
            spec.beams.push({ a: at(pb, yb, 0.08 * out), b: at(pa + (pb - pa) * 0.5, y, 0.08 * out), s: [0.08, 0.08], mat: 'pole', part });
          }
          const la = li % 2 ? pa + 0.5 : pb - 0.5;
          spec.ladders ??= [];
          spec.ladders.push({ a: at(la, li ? lifts[li - 1] : 0, -out * 0.45), b: at(la, y + 1.0, -out * 0.45), dir: alongX ? [1, 0, 0] : [0, 0, 1], part });
        });
      }
    };
    scaffold(tw0, -tz, tw1 - 1.15, tz, ['n', 'w', 's'], 12.0, 'stw', { side: 'w', c: 0, w: 1.3, top: Y(5.4) });
    scaffold(-xco, hwo + 1.55, xco - 1.05, zAo, ['w', 's'], 8.0, 'ssa'); // (the east side is too close to the catacomb stairs)

    // ---------------- the building site ----------------
    // dressed blocks stacked by the south arm, a pile of beams, the mortar trough
    const blk = { ...stone, color: [0.82, 0.78, 0.68] };
    box(S(-4.2), 0, S(-7.4), S(-3.0), Y(0.8), S(-6.2), blk);
    box(S(-4.2), Y(0.8), S(-7.4), S(-3.4), Y(1.2), S(-6.6), blk);
    box(S(-4.6), 0, S(-5.4), S(-3.0), Y(0.4), S(-4.6), { material: 'oak', color: [0.5, 0.36, 0.22], density: 0.6 });
    box(S(-4.2), Y(0.4), S(-5.4), S(-3.4), Y(0.8), S(-5.0), { material: 'oak', color: [0.48, 0.34, 0.2], density: 0.6 });

    return { prims, props: [{ type: 'church', p: [0, 0, 0], spec }] };
  },
};
