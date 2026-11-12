import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MATERIALS } from '../src/sim/materials.js';
import { iceBears } from '../src/sim/ice.js';
import { explode } from '../src/sim/explosions.js';
import { groundAt } from '../src/ai/dragon.js';

const M = (n) => MATERIALS.findIndex((m) => m.name === n);

/** A field with a pond: water 1.2 m deep in a basin (x 6..14, z 6..14), at `T` °C. */
function pond(T = -10, weather = {}) {
  const sim = createSimulation({
    world: { size: [20, 4, 20], h: 0.4, ground: 'soil' },
    objects: [],
    noFire: true,
    weather: { ambient: T, sunshine: 0, rain: 0, windSpeed: 2, ...weather },
  });
  const w = sim.world;
  const h = w.h;
  for (let x = 0; x < w.nx; x++)
    for (let z = 0; z < w.nz; z++)
      for (let y = 1; y <= 3; y++) {
        const inside = x >= 6 / h && x < 14 / h && z >= 6 / h && z < 14 / h;
        const i = w.idx(x, y, z);
        w.mat[i] = inside ? M('water') : M('soil');
        w.dens[i] = 1;
        w.temp[i] = w.skin[i] = inside ? 1 : T;
      }
  w.listDirty = true;
  w.structureDirty = true;
  w.geomVersion++;
  w.rebuildLists?.();
  w.recomputeColumns?.();
  return sim;
}

const run = (sim, t, dt = 0.25) => {
  const end = sim.world.time + t;
  while (sim.world.time < end) sim.step(dt);
};

test('Gold: ~5 cm of ice bears a firefighter (only just), 10 cm safely, a dragon needs ~30 cm', () => {
  assert.ok(iceBears(0.05) > 90 && iceBears(0.05) < 130);
  assert.ok(iceBears(0.1) > 350);
  assert.ok(iceBears(0.3) > 3000 && iceBears(0.25) < 3000);
});

test('in a frost the pond freezes over: a skin first, then thicker, about as fast as real ice grows', () => {
  const sim = pond(-10, { iceSpeed: 60 });
  run(sim, 60); // an hour at -10 °C
  const w = sim.world;
  assert.ok(w.ice, 'there is ice');
  const ice = w.ice.at(w, 10, 10);
  assert.ok(ice, 'the middle of the pond froze');
  // (~2-8 mm in the first hour: open water loses ~200 W/m² to cold air and the sky)
  assert.ok(ice.thick > 0.0015 && ice.thick < 0.012, `${(ice.thick * 1000).toFixed(1)} mm after an hour`);
  const bank = w.ice.at(w, 6.2, 10);
  assert.ok(bank.thick >= ice.thick, 'the banks freeze first');
  run(sim, 60 * 5);
  const six = w.ice.at(w, 10, 10).thick;
  run(sim, 60 * 18); // a day
  const day = w.ice.at(w, 10, 10).thick;
  // (Lebedev: ~1.3·FDD^0.58 cm: ~5 cm for 10 degree-days)
  assert.ok(day > 0.03 && day < 0.12, `${(day * 100).toFixed(1)} cm after a day`);
  // (thin, it grows about steadily: the air takes the heat slower than the ice lets it through)
  assert.ok(day > six * 2, `still growing (${(six * 100).toFixed(1)} cm at 6 h)`);
});

test('walking on it: thick ice holds, thin ice creaks and gives, too thin breaks at once', () => {
  for (const [d, want] of [[0.15, 'holds'], [0.02, 'breaks']]) {
    const sim = pond(-5, { iceCover: d });
    sim.step(0.1);
    const w = sim.world;
    assert.equal(w.ice.load(w, 10, 10, 110, 0.1, true), want, `${d * 100} cm`);
  }
  const sim = pond(-5, { iceCover: 0.055 });
  sim.step(0.1);
  const w = sim.world;
  let r = 'holds';
  let creaked = false;
  for (let t = 0; t < 20 && r !== 'breaks'; t += 0.1) {
    r = w.ice.load(w, 10, 10, 110, 0.1, false); // (standing still on it: walking, it would give at once)
    if (r === 'creaks') creaked = true;
  }
  assert.ok(creaked, 'it creaks first');
  assert.equal(r, 'breaks', 'then it gives');
  assert.equal(w.ice.at(w, 10, 10), null, 'a hole: open water');
  assert.ok(w.events.some((e) => e.type === 'iceBreak'));
});

test('the guards cross where it bears them well; the dragon only on thick ice, else it breaks through', () => {
  const thin = pond(-5, { iceCover: 0.05 });
  thin.step(0.1);
  const thick = pond(-5, { iceCover: 0.35 });
  thick.step(0.1);
  const mid = pond(-5, { iceCover: 0.12 });
  mid.step(0.1);
  // the guards: a floor over the pond (its surface at 1.6 m)
  assert.equal(thin.ai.floorAt(10, 10, 2.5) > 1.5, false, '5 cm: no way over for them');
  assert.ok(mid.ai.floorAt(10, 10, 2.5) > 1.5, '12 cm: they walk on it');
  // the dragon
  assert.ok(groundAt(mid.world, 10, 10).y < 1, '12 cm does not bear a dragon: its ground is the bottom');
  assert.ok(Math.abs(groundAt(thick.world, 10, 10).y - 1.6) < 0.01, '35 cm bears it');
});

test('it melts in a thaw in the sun, and a blast breaks it', () => {
  const sim = pond(6, { iceCover: 0.05, sunshine: 1, iceSpeed: 600 });
  run(sim, 120);
  const w = sim.world;
  const left = w.ice?.at(w, 10, 10)?.thick ?? 0;
  assert.ok(left < 0.03, `melting (${(left * 100).toFixed(1)} cm left after ~20 h)`);
  const s2 = pond(-5, { iceCover: 0.1 });
  s2.step(0.1);
  explode(s2, [10, 1.8, 10], 8e5);
  s2.step(0.1);
  assert.equal(s2.world.ice.at(s2.world, 10, 10), null, 'a hole where the grenade went off');
  assert.ok(s2.world.ice.at(s2.world, 7, 7), 'ice further off');
});
