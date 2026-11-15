import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeSpace, spaceParams, occlusion, impulseResponse, measureRt60, castRay, sendLevel, bandFilters, filterInPlace, AcousticProbe, C_SOUND, describeSpace } from '../src/audio/acoustics.js';
import { MAT } from '../src/sim/materials.js';

/** A bare voxel grid (what the acoustics read of sim/world.js: h, nx/ny/nz, mat, flags, dens). */
function grid(size, h = 0.25) {
  const nx = Math.round(size[0] / h), ny = Math.round(size[1] / h), nz = Math.round(size[2] / h);
  const N = nx * ny * nz;
  const w = { h, nx, ny, nz, mat: new Uint8Array(N), flags: new Uint8Array(N), dens: new Float32Array(N).fill(1) };
  w.box = (x0, y0, z0, x1, y1, z1, m) => {
    const id = typeof m === 'string' ? MAT[m] : m;
    for (let z = Math.floor(z0 / h); z < Math.ceil(z1 / h); z++)
      for (let y = Math.floor(y0 / h); y < Math.ceil(y1 / h); y++)
        for (let x = Math.floor(x0 / h); x < Math.ceil(x1 / h); x++)
          if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) w.mat[x + nx * (y + ny * z)] = id;
  };
  return w;
}

/** A closed room [x0..x1]×[0..H]×[z0..z1] (inside) with walls/floor/ceiling of `walls`, floor of `floor`. */
function room(w, x0, z0, x1, z1, H, walls, floor = walls, t = 0.5) {
  w.box(x0 - t, 0, z0 - t, x1 + t, t, z1 + t, floor); // floor slab (0..t), inside starts at y = t
  w.box(x0 - t, t + H, z0 - t, x1 + t, 2 * t + H, z1 + t, walls); // ceiling
  w.box(x0 - t, t, z0 - t, x0, t + H, z1 + t, walls);
  w.box(x1, t, z0 - t, x1 + t, t + H, z1 + t, walls);
  w.box(x0, t, z0 - t, x1, t + H, z0, walls);
  w.box(x0, t, z1, x1, t + H, z1 + t, walls);
}

const P = (w, p, o = {}) => spaceParams(probeSpace(w, p, { rays: 256, ...o }));

function stoneRoom() {
  const w = grid([10, 6, 10]);
  room(w, 2, 2, 8, 8, 3.5, 'concrete'); // 6 × 3.5 × 6 m inside = 126 m³
  return { w, p: [5.1, 2.2, 4.9] };
}
function curtainRoom() {
  const w = grid([10, 6, 10]);
  room(w, 2, 2, 8, 8, 3.5, 'concrete');
  // heavy curtains on all four walls, a carpet (fabric) on the floor, acoustic tiles above
  w.box(2, 0.5, 2, 8, 4, 2.25, 'fabric');
  w.box(2, 0.5, 7.75, 8, 4, 8, 'fabric');
  w.box(2, 0.5, 2, 2.25, 4, 8, 'fabric');
  w.box(7.75, 0.5, 2, 8, 4, 8, 'fabric');
  w.box(2, 0.5, 2, 8, 0.75, 8, 'fabric');
  w.box(2, 3.75, 2, 8, 4, 8, 'ceilingTile');
  return { w, p: [5.1, 2.2, 4.9] };
}
function openField() {
  const w = grid([40, 10, 40], 0.5);
  w.box(0, 0, 0, 40, 0.5, 40, 'grass');
  w.box(0, 0, 0, 40, 0.25, 40, 'soil');
  return { w, p: [20.1, 2.2, 19.9] };
}
function forest() {
  const { w } = openField();
  // trunks every ~3 m, crowns of leaves above
  for (let x = 2; x < 40; x += 3)
    for (let z = 2; z < 40; z += 3) {
      if (Math.abs(x - 20) < 1.5 && Math.abs(z - 20) < 1.5) continue;
      const jx = ((x * 7 + z * 3) % 5) * 0.2, jz = ((x * 3 + z * 11) % 5) * 0.2;
      w.box(x + jx, 0.5, z + jz, x + jx + 0.5, 5, z + jz + 0.5, 'oak');
      w.box(x + jx - 1.5, 4, z + jz - 1.5, x + jx + 2, 7.5, z + jz + 2, 'leaves');
    }
  return { w, p: [20.1, 2.2, 19.9] };
}
function catacomb() {
  const w = grid([6, 5, 40]);
  // a stone tunnel 2 m wide, 2.5 m high, 36 m long, closed at both ends
  w.box(0, 0, 0, 6, 5, 40, 'stone');
  w.box(2, 1, 2, 4, 3.5, 38, 0);
  return { w, p: [3.05, 2.2, 20.1] };
}

test('probe: a closed concrete room — enclosed, its volume, a long reverb', () => {
  const { w, p } = stoneRoom();
  const S = P(w, p);
  assert.ok(S.openness < 0.01, `openness ${S.openness}`);
  assert.ok(S.volume > 126 * 0.7 && S.volume < 126 * 1.35, `volume ${S.volume.toFixed(0)} m³ (126)`);
  // Sabine for the bare room: 0.161·126/(156·0.02) ≈ 6.5 s at mid; air absorption shortens the highs
  assert.ok(S.rtMid > 2.5, `RT60 mid ${S.rtMid.toFixed(2)} s`);
  assert.ok(S.rt60[3] < S.rt60[1], `highs decay sooner (air): ${S.rt60.map((r) => r.toFixed(2))}`);
  assert.ok(S.mfp > 2 && S.mfp < 4.5, `mean free path ${S.mfp.toFixed(2)} m (4V/S = 3.2)`);
  assert.ok(S.wet > 0.5, `reverberant ${S.wet.toFixed(2)}`);
});

test('probe: RT60 ordering — stone room ≫ curtained room ≫ open field; the catacomb rings, the forest diffuses', () => {
  const stone = P(stoneRoom().w, stoneRoom().p);
  const cur = curtainRoom();
  const curtain = P(cur.w, cur.p);
  const of = openField();
  const field = P(of.w, of.p);
  const fo = forest();
  const wood = P(fo.w, fo.p);
  const cat = catacomb();
  const tunnel = P(cat.w, cat.p);
  const rts = { stone: stone.rtMid, curtain: curtain.rtMid, field: field.rtMid, forest: wood.rtMid, tunnel: tunnel.rtMid };
  const msg = JSON.stringify(rts, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v));
  assert.ok(stone.rtMid > 4 * curtain.rtMid, msg);
  assert.ok(curtain.rtMid > 0.1 && curtain.rtMid < 0.8, msg);
  assert.ok(field.rtMid < 0.5 * curtain.rtMid && field.rtMid < 0.08, msg);
  assert.ok(tunnel.rtMid > 1.5 && tunnel.rtMid > 3 * curtain.rtMid, msg);
  assert.ok(wood.rtMid < 0.3 * stone.rtMid && wood.rtMid < tunnel.rtMid && wood.rtMid > 3 * field.rtMid, msg);
  // openness: the field half open (the sky), the forest less, the rooms closed
  assert.ok(field.openness > 0.4 && field.openness < 0.6, `field open ${field.openness}`);
  assert.ok(wood.openness < field.openness, `forest open ${wood.openness}`);
  // volumes: the tunnel 2 × 2.5 × 36 = 180 m³ (seen from inside: a long thin star)
  assert.ok(tunnel.volume > 90 && tunnel.volume < 300, `tunnel ${tunnel.volume.toFixed(0)} m³`);
  // the reverberant level: a lot in stone, little in the open
  assert.ok(field.wet < 0.05 && stone.wet >= curtain.wet && stone.wet * stone.rtMid > 10 * curtain.wet * curtain.rtMid, `wet ${field.wet} ${curtain.wet} ${stone.wet}`);
  // clutter / diffusion: trees and curtains diffuse, bare concrete little
  assert.ok(wood.clutter > 0.35 && wood.diffusion > stone.diffusion, `forest clutter ${wood.clutter} diff ${wood.diffusion} vs ${stone.diffusion}`);
  assert.ok(describeSpace(stone).includes('RT60') && describeSpace(field).includes('open air'));
});

test('echo: one big concrete wall 30 m away in an open field → an echo at 2d/c', () => {
  const { w, p } = openField();
  // the wall: 40 m wide, 10 m high, its face at z = 35 (the listener at z ≈ 19.9 → 15.1 m)
  w.box(0, 0, 35, 40, 10, 36, 'concrete');
  const S = P(w, p);
  const d = 35 - p[2];
  assert.ok(S.echoes.length >= 1, `echoes: ${JSON.stringify(S.echoes)}`);
  const e = S.echoes[0];
  assert.ok(Math.abs(e.delay - (2 * d) / C_SOUND) < 0.004, `delay ${(e.delay * 1000).toFixed(1)} ms vs ${((2 * d) / C_SOUND * 1000).toFixed(1)} ms`);
  assert.ok(e.dir[2] > 0.9, `from the wall's side ${e.dir}`);
  assert.ok(e.gain > 0.01, `audible ${e.gain}`);
  // the floor is an early reflection (2 × 1.7 m), not an echo
  assert.ok(S.early.some((r) => r.dir[1] < -0.9 && Math.abs(r.delay - (2 * (p[1] - 0.5)) / C_SOUND) < 0.002), JSON.stringify(S.early.map((r) => [r.delay, r.dir])));
  // further away → later; a cliff 60 m off (a big world)
  const w2 = grid([90, 30, 80], 0.5);
  w2.box(0, 0, 0, 90, 0.5, 80, 'grass');
  w2.box(0, 0, 75, 90, 30, 76, 'hillRock');
  const S2 = P(w2, [45, 2, 10]);
  const e2 = S2.echoes.find((x) => x.dir[2] > 0.9);
  assert.ok(e2 && Math.abs(e2.delay - (2 * 65) / C_SOUND) < 0.006, `cliff echo ${e2?.delay}`);
});

test('ray: the sea is a water plane outside the ship, the ground below the grid', () => {
  const w = grid([10, 10, 10], 0.5);
  w.sea = { level: 3, box: [0, 0, 0, 0] };
  const hit = castRay(w, [5, 6, 5], [0, -1, 0]);
  assert.equal(hit.id, MAT.water);
  assert.ok(Math.abs(hit.t - 3) < 1e-6);
  // a ship: inside its box no water plane (below deck is the hull's air)
  w.sea = { level: 3, box: [0, 0, 10, 10], ship: {} };
  const h2 = castRay(w, [5, 6, 5], [0, -1, 0]);
  assert.notEqual(h2.id, MAT.water);
  assert.ok(Math.abs(h2.t - 6) < 1e-6, `ground at ${h2.t}`);
  // from above the grid (a helicopter's camera) down onto it
  const w3 = grid([10, 10, 10], 0.5);
  w3.box(0, 0, 0, 10, 1, 10, 'concrete');
  const h3 = castRay(w3, [5, 30, 5], [0, -1, 0]);
  assert.ok(h3 && Math.abs(h3.t - 29) < 1e-6 && h3.n[1] === 1, JSON.stringify(h3));
});

test('occlusion: a wall between attenuates and dulls; open line of sight does not', () => {
  const w = grid([20, 6, 20]);
  w.box(0, 0, 0, 20, 0.5, 20, 'concrete');
  const a = [5, 1.5, 10], b = [15, 1.5, 10];
  const free = occlusion(w, a, b);
  assert.equal(free.gain, 1);
  assert.equal(free.cutoff, 20000);
  w.box(9.75, 0, 0, 10.25, 6, 20, 'brick');
  const wall = occlusion(w, a, b);
  assert.ok(wall.gain < 0.3 && wall.walls === 1, JSON.stringify(wall));
  assert.ok(wall.cutoff < 3000, `dull: ${wall.cutoff}`);
  // a second wall: less again
  w.box(12, 0, 0, 12.5, 6, 20, 'brick');
  const two = occlusion(w, a, b);
  assert.ok(two.gain < wall.gain && two.walls === 2, JSON.stringify(two));
  // a hedge of leaves: a little only
  const w2 = grid([20, 6, 20]);
  w2.box(9, 0, 0, 11, 6, 20, 'leaves');
  const hedge = occlusion(w2, a, b);
  assert.ok(hedge.gain > 0.8 && hedge.gain < 1 && hedge.cutoff < 20000, JSON.stringify(hedge));
  // a sound on the wall itself is not occluded by that wall
  const onWall = occlusion(w, a, [9.8, 1.5, 10]);
  assert.equal(onWall.walls, 0);
});

test('send: more reverberant the further the source', () => {
  assert.equal(sendLevel(1), 1);
  assert.ok(sendLevel(10) > sendLevel(4) && sendLevel(4) > sendLevel(2));
  assert.ok(sendLevel(1000) <= 5);
});

test('impulse response: decays at the asked RT60, per band, with the early taps and the asked energy', () => {
  const sr = 16000;
  for (const rt of [0.4, 1.2]) {
    const ir = impulseResponse({ rt60: [rt, rt, rt, rt], predelay: 0.01, diffusion: 0.8, wet: 1 }, sr, 3);
    const m = measureRt60(ir.left, sr);
    assert.ok(Math.abs(m - rt) / rt < 0.15, `RT60 ${rt} → measured ${m.toFixed(3)}`);
    let e = 0;
    for (let i = 0; i < ir.length; i++) e += (ir.left[i] ** 2 + ir.right[i] ** 2) / 2;
    assert.ok(Math.abs(e - 1) < 1e-3, `energy ${e}`);
  }
  // long lows, short highs: the low band measured on its own decays slower than the high band
  const ir = impulseResponse({ rt60: [2, 1.5, 0.5, 0.3], predelay: 0.005, diffusion: 0.8, wet: 1 }, sr, 5);
  const band = (b) => {
    const x = Float32Array.from(ir.left);
    for (const co of bandFilters(b, sr)) filterInPlace(x, x.length, co);
    return measureRt60(x, sr);
  };
  const lo = band(0), hi = band(3);
  assert.ok(lo > 1.4 && lo < 2.6, `low band ${lo}`);
  assert.ok(hi < 0.5, `high band ${hi}`);
  // early reflections are taps at their delays, panned
  const ir2 = impulseResponse({ rt60: [0.3, 0.3, 0.3, 0.3], predelay: 0.05, diffusion: 0, wet: 0.01, early: [{ delay: 0.02, gain: 0.5, pan: -1 }] }, sr, 2);
  const i = Math.round(0.02 * sr);
  assert.ok(Math.abs(ir2.left[i] - 0.5 * Math.SQRT2) < 1e-3 && Math.abs(ir2.right[i]) < 1e-3, `${ir2.left[i]} ${ir2.right[i]}`);
});

test('amortised probe: sweeps over frames give the same space as the one-shot probe', () => {
  const { w, p } = stoneRoom();
  const pr = new AcousticProbe({ rays: 96, perFrame: 10 });
  let res = null, frames = 0;
  while (!res) {
    res = pr.step(w, p);
    frames++;
  }
  assert.equal(frames, 10);
  assert.ok(res.openness < 0.02 && res.volume > 80 && res.volume < 170, JSON.stringify({ o: res.openness, v: res.volume }));
});
