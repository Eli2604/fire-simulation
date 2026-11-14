import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { MAT, MATERIALS } from '../src/sim/materials.js';
import { shadeVoxel } from '../src/render/voxels.js';
import { blackbody } from '../src/render/colors.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { defaultWeather } from '../src/sim/weather.js';

/** Colour and glow (linear RGB) of a lone voxel of `name`, at `temp`, having been at `tmax`. */
function shade(name, temp, tmax = temp, char = 0) {
  const w = new World({ size: [0.4, 0.4, 0.4], h: 0.1, ambient: 20 });
  const i = w.idx(1, 1, 1);
  w.setVoxel(i, MAT[name], { temp, variation: 0 });
  w.tmax[i] = Math.min(255, tmax / 4); // (world.tmax: 4 °C steps)
  w.char[i] = char;
  const col = [0, 0, 0];
  const glow = [0, 0, 0];
  shadeVoxel(w, i, 0, 'realistic', col, glow, 0);
  return { col, glow };
}
const sum = (c) => c[0] + c[1] + c[2];
const near = (a, b, eps = 1e-6) => a.every((v, k) => Math.abs(v - b[k]) < eps);

test('incandescence: none below ~500 °C, dull red, then orange, yellow, white', () => {
  const c = [0, 0, 0];
  assert.equal(sum(blackbody(480, c)), 0);
  blackbody(620, c);
  assert.ok(c[0] > 0.2 && c[1] < c[0] * 0.1 && c[2] === 0, 'dull red');
  const red = c[0];
  blackbody(1000, c);
  assert.ok(c[0] > red && c[1] > c[0] * 0.3 && c[2] < c[1], 'orange');
  blackbody(2000, c);
  assert.ok(c[2] > c[0] * 0.7, 'white hot');
});

test('aluminium and copper glow far less than steel at the same temperature', () => {
  const steel = shade('steel', 640).glow;
  const alu = shade('aluminium', 640).glow;
  const cu = shade('copper', 640).glow;
  assert.ok(steel[0] > 0.2, `steel glows at 640 °C (${steel[0]})`);
  assert.ok(alu[0] < steel[0] * 0.45, `aluminium ${alu[0]} vs steel ${steel[0]}`);
  assert.ok(cu[0] < steel[0] && cu[0] > alu[0], 'copper between the two');
  // an oxide layer (char on a metal) makes it glow more
  assert.ok(shade('steel', 640, 640, 1).glow[0] > steel[0]);
});

test('steel takes temper colours: straw, brown, purple, blue, grey', () => {
  const base = shade('steel', 20).col;
  const straw = shade('steel', 20, 222).col;
  const purple = shade('steel', 20, 285).col;
  const blue = shade('steel', 20, 300).col;
  const grey = shade('steel', 20, 380).col;
  assert.ok(straw[0] > straw[2] * 1.5 && straw[1] > straw[2], `straw is yellowish ${straw}`);
  assert.ok(purple[2] > purple[1] && purple[0] > purple[1], `purple ${purple}`);
  assert.ok(blue[2] > blue[0] * 1.5, `blue ${blue}`);
  assert.ok(Math.abs(grey[0] - grey[2]) < 0.1, `grey ${grey}`);
  assert.ok(!near(base, blue, 0.01));
  // below ~190 °C nothing shows
  assert.ok(near(shade('steel', 20, 150).col, base));
});

test('copper tarnishes, wood scorches, before they oxidise / char', () => {
  const cu = shade('copper', 20).col;
  const cuHot = shade('copper', 20, 235).col;
  assert.ok(cuHot[2] > cu[2] * 2 && cuHot[0] < cu[0], `copper interference colour ${cuHot} from ${cu}`);
  const wood = shade('wood', 20).col;
  const scorched = shade('wood', 20, 220).col;
  assert.ok(sum(scorched) < sum(wood) * 0.7 && scorched[0] > scorched[2] * 1.5, `scorched wood is brown ${scorched}`);
  // glass, a liquid: no lasting tint
  assert.ok(near(shade('glass', 20, 400).col, shade('glass', 20).col));
});

test('the tint stays after cooling, the glow does not', () => {
  const hot = shade('steel', 800, 800);
  assert.ok(hot.glow[0] > 0.5);
  const cooled = shade('steel', 20, 800);
  assert.equal(sum(cooled.glow), 0);
  assert.ok(near(cooled.col, hot.col), 'the colour of the surface is the same, only the glow went');
  assert.ok(!near(cooled.col, shade('steel', 20).col, 0.01));
});

test('the hottest temperature a surface reached is kept with it when it moves', () => {
  const w = new World({ size: [0.4, 0.4, 0.4], h: 0.1, ambient: 20 });
  const i = w.idx(1, 1, 1);
  const j = w.idx(1, 2, 1);
  w.setVoxel(i, MAT.steel, { temp: 300 });
  assert.equal(w.tmax[i] * 4, 300);
  w.temp[i] = 50;
  w.moveVoxel(i, j);
  assert.equal(w.tmax[j] * 4, 300);
});

test('a steel bar over a burner: temper bands then a glowing hot spot; the bands stay when it cools', () => {
  const scene = {
    world: { size: [0.6, 0.4, 0.2], h: 0.02 },
    weather: { ...defaultWeather(), ambient: 20, windSpeed: 0 },
    objects: [{ type: 'metalBar', params: { material: 'steel', length: 0.5, thickness: 0.03, burnerPower: 6000 }, x: 0.3, z: 0.1 }],
  };
  const sim = createSimulation(scene);
  const w = sim.world;
  const bar = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (MATERIALS[w.mat[i]].name === 'steel' && w.coords(i)[1] * w.h > 0.2) bar.push(i);
  }
  assert.ok(bar.length > 20);
  const col = [0, 0, 0];
  const glow = [0, 0, 0];
  const run = (s) => {
    const end = w.time + s;
    while (w.time < end) sim.step(sim.dt);
  };
  run(300);
  // the hot spot over the burner glows
  let hot = bar[0];
  for (const i of bar) if (Math.max(w.temp[i], w.skin[i]) > Math.max(w.temp[hot], w.skin[hot])) hot = i;
  const Thot = Math.max(w.temp[hot], w.skin[hot]);
  assert.ok(Thot > 600, `hot spot ${Thot.toFixed(0)} °C`);
  shadeVoxel(w, hot, 0, 'realistic', col, glow, 0);
  assert.ok(glow[0] > 0.2 && glow[0] > glow[1] * 3, `glows red ${glow}`);
  // further along the bar, a band of surface was taken into the temper colours (and not to scale)
  const band = bar.filter((i) => w.tmax[i] * 4 > 230 && w.tmax[i] * 4 < 330);
  assert.ok(band.length > 0, 'temper colour band');
  // the burner off: it cools, the glow goes, the colours stay (the heat still spreading
  // along the bar may move a band on a little, but nothing goes back to bare steel)
  for (const ht of w.heaters) ht.on = false;
  run(400);
  shadeVoxel(w, hot, 0, 'realistic', col, glow, 0);
  assert.ok(Math.max(w.temp[hot], w.skin[hot]) < 450);
  assert.equal(sum(glow), 0);
  const bare = [0, 0, 0];
  for (const i of band) {
    shadeVoxel(w, i, 0, 'realistic', col, glow, 0);
    const [tm, ch] = [w.tmax[i], w.char[i]];
    w.tmax[i] = 5;
    w.char[i] = 0;
    shadeVoxel(w, i, 0, 'realistic', bare, glow, 0);
    w.tmax[i] = tm;
    w.char[i] = ch;
    assert.ok(!near(col, bare, 0.03), `still tinted ${col} vs bare ${bare}`);
  }
});
