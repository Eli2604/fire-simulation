import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCarrierHull, carrierHullEnds, HULL_SNOW } from '../src/render/hull.js';
import { makeArchipelago } from '../src/models/archipelago.js';
import { SCENARIOS } from '../src/scenarios.js';
import { carrierDeck } from '../src/models/carrier.js';

const defaults = (M) => Object.fromEntries(Object.entries(M.params ?? {}).map(([k, v]) => [k, v.value]));

test('carrier hull: closed at the stern by a flat transom facing aft, from the bottom up to the deck', () => {
  const g = buildCarrierHull({ hx: 105, hz: 24, D: 11, draft: 4 });
  const hull = g.children[0];
  const P = hull.geometry.getAttribute('position');
  const I = hull.geometry.getIndex();
  let xs = Infinity;
  for (let k = 0; k < P.count; k++) xs = Math.min(xs, P.getX(k));
  // the triangles at the stern: their area, which way they face, how high they reach
  let area = 0;
  let aft = 0;
  let yLo = Infinity;
  let yHi = -Infinity;
  for (let t = 0; t < I.count; t += 3) {
    const v = [0, 1, 2].map((q) => [P.getX(I.getX(t + q)), P.getY(I.getX(t + q)), P.getZ(I.getX(t + q))]);
    if (!v.every((p) => Math.abs(p[0] - xs) < 1e-4)) continue;
    // (in the y-z plane: its area, and the sign gives the side it faces)
    const a = ((v[1][1] - v[0][1]) * (v[2][2] - v[0][2]) - (v[2][1] - v[0][1]) * (v[1][2] - v[0][2])) / 2;
    area += Math.abs(a);
    if (a < 0) aft += Math.abs(a);
    for (const p of v) {
      yLo = Math.min(yLo, p[1]);
      yHi = Math.max(yHi, p[1]);
    }
  }
  // the hull's cross section there: ~0.9 of the beam wide, from the run (1.6 m up) to the deck
  const expect = 2 * 24 * 0.85 * (11 - 0.6 - 1.6);
  assert.ok(area > expect * 0.75 && area < expect * 1.15, `transom ${area.toFixed(0)} m² (≈${expect.toFixed(0)})`);
  assert.ok(aft > area * 0.99, 'its face turned aft');
  assert.ok(yLo < 2 && yHi > 10, `from ${yLo.toFixed(1)} up to ${yHi.toFixed(1)} m`);
  // the sea's foam and lee (render/ocean.js) end where the drawn hull does: no band of foam
  // out on the open water astern of it
  const e = carrierHullEnds({ hx: 105, hz: 24 });
  assert.ok(Math.abs(e.xStern - xs) < 1e-6 && Math.abs(e.xStem - g.userData.waterline[2]) < 1e-6);
});

test('carrier deck: the deck-edge safety nets run along the deck, not off the stern', () => {
  const L = 210;
  const B = 48;
  const m = carrierDeck.build({ ...defaults(carrierDeck), length: L, beam: B, deckHeight: 11, draft: 4, helipads: 0, boatTo: '' }, { h: 0.5, rng: Math.random });
  const nets = m.props.filter((q) => q.type === 'net');
  assert.equal(nets.length, 2);
  for (const n of nets) {
    // drawn from p along its own +x (turned by its heading): both ends on the deck's edge
    const dir = Math.cos(n.heading ?? 0);
    const ends = [n.p[0], n.p[0] + dir * n.len];
    for (const x of ends) assert.ok(x >= -L / 2 - 0.01 && x <= L / 2 + 0.01, `a net reaches x = ${x}`);
    assert.ok(Math.abs(Math.abs(n.p[2]) - B / 2) < 0.01, 'on the deck edge');
  }
  // the snow on the drawn deck follows the slice's (set by the view)
  assert.equal(HULL_SNOW.uHullSnow.value, 0);
});

test('archipelago: a sandy bank under the anchored carrier, the deep floor beyond', () => {
  const A = makeArchipelago(SCENARIOS.carrier.archipelago);
  // the ship's middle (the deck zone's origin + the middle of its slice), the keel ~4 m down
  const o = SCENARIOS.carrier.zones.deck.origin;
  const y = A.heightAt(o[0] + 106, o[2] + 26);
  assert.ok(y < -9 && y > -16, `${y.toFixed(1)} m under the ship`);
  assert.ok(A.heightAt(o[0] - 250, o[2] + 26) < -40, 'deep water further off');
});
