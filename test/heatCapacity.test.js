// Temperature-dependent specific heat (sim/materials.js CP, cpAt, enthalpyAt, heatTo, cpCorrect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT, MATERIALS, CP, cpAt, enthalpyAt, heatTo, cpCorrect } from '../src/sim/materials.js';

const mean = (id, a, b) => (enthalpyAt(id, b) - enthalpyAt(id, a)) / (b - a);

test('steel: ~460 J/kgK cold, its magnetic peak near 750 °C, ~620–660 on average over 760–1050 °C', () => {
  const s = MAT.steel;
  assert.ok(Math.abs(cpAt(s, 20) - 460) < 15);
  let peakT = 0;
  for (let T = 600; T <= 900; T += 1) if (cpAt(s, T) > cpAt(s, peakT)) peakT = T;
  assert.ok(peakT >= 730 && peakT <= 780 && cpAt(s, peakT) > 1200, `peak ${cpAt(s, peakT).toFixed(0)} at ${peakT} °C`);
  const m = mean(s, 760, 1050);
  assert.ok(m > 600 && m < 670, `mean over 760–1050 °C: ${m.toFixed(0)}`);
  // its variants are the same steel
  assert.equal(cpAt(MAT.steelProfile, 750), cpAt(s, 750));
  assert.equal(cpAt(MAT.deckSteel, 300), cpAt(s, 300));
});

test('aluminium, copper, glass, concrete and wood rise with temperature; others keep their constant', () => {
  for (const name of ['aluminium', 'copper', 'glass', 'concrete', 'wood', 'oak']) {
    const id = MAT[name];
    assert.ok(cpAt(id, 300) > cpAt(id, 20), name);
  }
  // wood: its old constant is about its mean over the heating to ignition
  const wm = mean(MAT.wood, 20, 300);
  assert.ok(Math.abs(wm - MATERIALS[MAT.wood].specificHeat) < 150, `wood mean 20–300 °C ${wm.toFixed(0)}`);
  for (const name of ['water', 'soil', 'brick', 'rubber']) {
    const id = MAT[name];
    assert.equal(CP[id], null, name);
    assert.equal(cpAt(id, 500), MATERIALS[id].specificHeat);
    assert.equal(heatTo(id, 20, 1000), 20 + 1000 / MATERIALS[id].specificHeat);
  }
});

test('energy and temperature convert through the enthalpy exactly: heat in and out comes back to the start', () => {
  for (const name of ['steel', 'aluminium', 'wood', 'glass']) {
    const id = MAT[name];
    const cw = name === 'wood' ? 0.12 * 4186 : 0;
    let T = 20;
    let rnd = 1;
    const steps = [];
    for (let k = 0; k < 2000; k++) {
      rnd = (rnd * 16807) % 2147483647;
      const dh = ((rnd / 2147483647) - 0.4) * 4000;
      steps.push(dh);
      T = heatTo(id, T, dh, cw);
    }
    const sum = steps.reduce((a, b) => a + b, 0);
    const got = enthalpyAt(id, T) + cw * T - (enthalpyAt(id, 20) + cw * 20);
    assert.ok(Math.abs(got - sum) < 1e-6 * Math.abs(sum) + 1e-3, `${name}: ${got} vs ${sum}`);
    T = heatTo(id, T, -sum, cw);
    assert.ok(Math.abs(T - 20) < 1e-6, `${name} back to 20 °C: ${T}`);
  }
  // a step taken with c at its start: the same energy, through h(T)
  const s = MAT.steel;
  const c0 = cpAt(s, 700);
  const T1 = cpCorrect(s, 700, 760, c0);
  assert.ok(T1 < 760, 'across the peak the same heat brings it less far');
  assert.ok(Math.abs(enthalpyAt(s, T1) - enthalpyAt(s, 700) - c0 * 60) < 1e-6);
  // 1050 → 760 °C gives up the mean c × 290 K
  assert.ok(Math.abs(heatTo(s, 1050, -mean(s, 760, 1050) * 290) - 760) < 1e-6);
});
