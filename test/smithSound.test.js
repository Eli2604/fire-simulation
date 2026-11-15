// The smithy's sounds from its physics (audio/smithSound.js, audio/physics.js): the hammer on hot
// and cold steel, the bare anvil's ring, the quench's hiss, the bellows' whoosh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hammerBlow, brightness, quenchSizzle, bellowsWhoosh } from '../src/audio/smithSound.js';
import { atTemperature, contact, impactSound } from '../src/audio/physics.js';

test('a blow on a blade at forging heat is duller, lower and quieter than on a cold one', () => {
  const hot = hammerBlow({ bladeT: 1100 });
  const cold = hammerBlow({ bladeT: 20 });
  assert.ok(hot.bladeF1 < cold.bladeF1 * 0.85, `the hot blade's modes lower: ${hot.bladeF1.toFixed(0)} vs ${cold.bladeF1.toFixed(0)} Hz`);
  assert.ok(hot.contact.tc > cold.contact.tc * 1.3, `a longer, plastic contact: ${(hot.contact.tc * 1e3).toFixed(2)} vs ${(cold.contact.tc * 1e3).toFixed(2)} ms`);
  assert.ok(brightness(hot) < brightness(cold) * 0.8, `duller: ${brightness(hot).toFixed(0)} vs ${brightness(cold).toFixed(0)} Hz`);
  assert.ok(hot.db < cold.db, 'most of a hot blow goes into shaping the steel');
  const ringHot = Math.max(...hot.partials.filter((p) => p.f < 1000).map((p) => p.tau));
  const ringCold = Math.max(...cold.partials.filter((p) => p.f < 1000).map((p) => p.tau));
  assert.ok(ringHot < ringCold / 5, `the hot blade thuds (${ringHot.toFixed(2)} s), the cold one rings (${ringCold.toFixed(2)} s)`);
  assert.ok(hot.scale && hot.scale.n > 5, 'scale spatters off the hot blade');
  assert.equal(cold.scale, null);
  // in between: cooling under the hammer it rings brighter and brighter
  assert.ok(brightness(hammerBlow({ bladeT: 800 })) > brightness(hot));
});

test('Hertz contact: the harder (stiffer) the two, the shorter the contact', () => {
  const steelSteel = contact('steel', 'steel', { mass: 1.4, speed: 7, radius: 0.015 });
  const steelWood = contact('steel', 'oak', { mass: 1.4, speed: 7, radius: 0.015 });
  const steelHot = contact('steel', atTemperature('steel', 1100), { mass: 1.4, speed: 7, radius: 0.015 });
  assert.ok(steelSteel.tc < steelWood.tc, `cold steel on steel ${steelSteel.tc} s, on oak ${steelWood.tc} s`);
  assert.ok(steelSteel.tc < steelHot.tc / 2, `on steel at forging heat (yielding) ${steelHot.tc} s`);
  assert.ok(steelSteel.cutoff > steelHot.cutoff && steelSteel.cutoff > steelWood.cutoff, 'the shorter the contact, the brighter');
  assert.ok(atTemperature('steel', 1100).E < atTemperature('steel', 20).E);
  assert.ok(atTemperature('steel', 1100).eta > 20 * atTemperature('steel', 20).eta);
  // (the generic impact takes the temperatures too)
  assert.ok(impactSound({ materials: ['steel', 'steel'], temps: [20, 1100], mass: 1.4, speed: 7 }).contact.tc > impactSound({ materials: ['steel', 'steel'], mass: 1.4, speed: 7 }).contact.tc);
});

test('louder the harder he strikes', () => {
  const soft = hammerBlow({ bladeT: 900, speed: 4 });
  const hard = hammerBlow({ bladeT: 900, speed: 9 });
  assert.ok(hard.db > soft.db + 5, `${hard.db.toFixed(1)} vs ${soft.db.toFixed(1)} dB`);
  assert.ok(hard.gain > soft.gain);
});

test('the anvil rings longer struck bare than with a hot work piece on its face', () => {
  const bare = hammerBlow({ bare: true, speed: 2.5 });
  const onWork = hammerBlow({ bladeT: 1000 });
  assert.ok(bare.anvilTau > 2 * onWork.anvilTau, `${bare.anvilTau.toFixed(2)} s bare vs ${onWork.anvilTau.toFixed(2)} s`);
  assert.ok(bare.anvilTau > 0.3, 'the classic anvil ring');
  assert.ok(bare.partials[0].f > 800, `its ring is high: ${bare.partials[0].f.toFixed(0)} Hz`);
  assert.equal(bare.bladeF1, 0);
});

test('the quench hisses by the steam the water gives off; the bellows whoosh by the air', () => {
  assert.equal(quenchSizzle(0, 800).gain, 0);
  const a = quenchSizzle(0.002, 800);
  const b = quenchSizzle(0.02, 300);
  assert.ok(b.gain > a.gain, 'more steam, louder');
  assert.ok(b.crackle > a.crackle, 'nucleate boiling crackles');
  const draught = bellowsWhoosh(0.0025);
  const blast = bellowsWhoosh(0.0175);
  assert.ok(blast.gain > draught.gain && blast.peak > draught.peak && blast.cutoff > draught.cutoff);
});
