import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUNS, freeRecoil, recoilSpec, recoilAt, peakClimb, recoveryTime, stepClimb, pullTime } from '../src/ai/recoil.js';
import { aimPoint, recoilOf } from '../src/ai/soldier.js';

test('recoil from the physics: cartridge and weapon mass', () => {
  const E = (k) => freeRecoil(k).energy;
  assert.ok(E('rifle') > 4 && E('rifle') < 8, `5.56 rifle ${E('rifle').toFixed(1)} J`);
  assert.ok(E('mg') > E('rifle') && E('rifle') > E('carbine'));
  assert.ok(recoilSpec('pistol').rise > recoilSpec('rifle').rise, 'a light pistol held out climbs more');
  for (const k of Object.keys(GUNS)) assert.ok(GUNS[k].modes.includes(recoilSpec(k).mode));
  assert.equal(recoilSpec('pistol', { mode: 'auto' }).mode, 'single', 'no auto on a pistol');
});

test('more recoil: a bigger kick and muzzle rise, a longer recovery', () => {
  const lo = recoilSpec('rifle', { mode: 'single' }), hi = recoilSpec('rifle', { mode: 'single', recoil: 2 });
  assert.ok(hi.kick > lo.kick * 1.3 && hi.rise > lo.rise * 1.3);
  assert.ok(peakClimb(hi).climb > peakClimb(lo).climb * 1.3);
  assert.ok(recoveryTime(hi) > recoveryTime(lo) * 1.1, `${recoveryTime(lo).toFixed(2)} -> ${recoveryTime(hi).toFixed(2)} s`);
  assert.ok(pullTime(hi) > pullTime(lo));
  // a better shot brings it down sooner
  assert.ok(recoveryTime(lo, 0.7) < recoveryTime(lo, 1.4));
  assert.equal(recoilSpec('rifle', { recoil: 0 }).rise, 0, 'the override can take it away');
});

test('auto fire accumulates the climb; a burst less, a single round least', () => {
  const pk = (mode) => peakClimb(recoilSpec('rifle', { mode })).climb;
  assert.ok(pk('auto') > pk('burst') && pk('burst') > pk('single'), `${pk('single').toFixed(3)} < ${pk('burst').toFixed(3)} < ${pk('auto').toFixed(3)}`);
  const R = recoilSpec('rifle', { mode: 'auto' });
  // at the last round the muzzle is higher than one round's rise: it piled up
  assert.ok(recoilAt(R, (R.rounds - 1) * R.gap + 0.03).climb > 2 * R.rise);
  // the man firing: the climb carried round to round, pulled down in between
  const m = { squad: 'R1' };
  for (let i = 0; i < R.rounds; i++) {
    stepClimb(m, R, R.gap, false);
    stepClimb(m, R, 0, true);
  }
  assert.ok(m.climb > 2 * R.rise);
  stepClimb(m, R, 3, false);
  assert.ok(m.climb < 0.01, 'recovered');
  // and the aim suffers while it climbs: rounds go wider and high
  const spread = (c) => {
    const pts = Array.from({ length: 400 }, (_, i) => aimPoint({ p: [0, 0, 0], climb: c }, [0, 0, 20], mulberry(i + 1)));
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return { sd: Math.sqrt(pts.reduce((a, p) => a + (p[0] ** 2), 0) / pts.length), my };
  };
  const s0 = spread(0), s1 = spread(0.1);
  assert.ok(s1.sd > s0.sd * 2 && s1.my > s0.my + 0.5);
});

test('the soldier\'s weapon: its recoil, his fire mode and the override from the scene', async () => {
  assert.equal(recoilOf({ squad: 'R1' }).mode, 'burst');
  assert.equal(recoilOf({ squad: 'MG', primary: 'mg' }).mode, 'auto');
  assert.equal(recoilOf({ squad: 'R1', fireMode: 'single' }).rounds, 1);
  assert.ok(recoilOf({ squad: 'R1', recoil: 2 }).rise > recoilOf({ squad: 'R1' }).rise);
  const { MODELS } = await import('../src/models/index.js');
  const b = MODELS.squad.build({ ...Object.fromEntries(Object.entries(MODELS.squad.params).map(([k, v]) => [k, v.value])), recoil: 1.5, fireMode: 'auto' });
  assert.ok(b.enemies.every((e) => e.recoil === 1.5 && e.fireMode === 'auto'));
  // the firing clips follow it: a stronger recoil climbs the rifle further
  const { shootClips } = await import('../src/operator/rig.js');
  const peak = (R) => {
    const [dur, fn] = shootClips(R).shoot;
    let c = 0;
    for (let t = 0; t <= dur; t += 0.01) c = Math.max(c, fn(t).climb);
    return c;
  };
  assert.ok(peak(recoilSpec('rifle', { recoil: 2 })) > 1.5 * peak(recoilSpec('rifle')));
  assert.ok(peak(recoilSpec('rifle', { mode: 'auto' })) > peak(recoilSpec('rifle', { mode: 'single' })) * 2);
});

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
