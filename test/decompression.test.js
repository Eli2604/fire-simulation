import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { explode } from '../src/sim/explosions.js';
import { toggleDoor } from '../src/sim/doors.js';
import { pressureAt, inHull } from '../src/sim/vacuum.js';

// The hull breach, both ways (sim/breach.js): a spaceship's air goes out and takes loose
// things with it; a ship's hull holed below the waterline lets the sea in, which pushes them in.

const run = (sim, t) => {
  while (sim.world.time < t - 1e-9) sim.step(sim.dt);
};

function ship(params = {}, guards = false) {
  const scene = cloneScene(SCENARIOS.carrier);
  const z = scene.zones.spaceship;
  z.objects = z.objects.slice(0, guards ? 2 : 1);
  z.objects[0].params = { fireAfter: 0, ...params };
  return createSimulation({ ...scene, zone: 'spaceship' });
}
const door = (w, name) => w.doors.findIndex((d) => d.name === name);
const crate = (w, p, extra = {}) => {
  const o = { kind: 'crate', p, v: [0, 0, 0], rot: [0, 0, 0], r: 0.3, half: 0.3, held: false, flying: false, ...extra };
  w.loose.push(o);
  return o;
};
// points in the spaceship zone (world coordinates of the zone)
const CORRIDOR = [17.5, 2, 6.5];
const BRIDGE = [31, 2, 6.5];
const AIRLOCK = [20, 2, 9.2];

test('spaceship breach: loose things and a body are pulled to the hole and out; they drift on in space; what is strapped down stays', () => {
  const sim = ship({ autoSeal: false }, true);
  const w = sim.world;
  // in the airlock, a metre from its outer door: a crate, a crate strapped down, a body
  const loose = crate(w, [20, 1.35, 9.7]);
  const strapped = crate(w, [21.1, 1.35, 9.2], { secured: true });
  const body = w.enemies[0];
  body.dead = true;
  body.p = [19.8, 1.0, 10.1];
  toggleDoor(sim, door(w, 'airlock (inner)'), true);
  run(sim, 1);
  toggleDoor(sim, door(w, 'airlock (outer)'), true); // the airlock is open to space
  run(sim, 3);
  assert.ok(w.events.some((e) => e.type === 'decompression'), 'decompression');
  assert.ok(loose.drift, 'the crate went out through the door');
  assert.ok(!inHull(w, loose.p) && loose.p[2] > 11, `out in space (${loose.p.map((v) => v.toFixed(1))})`);
  assert.ok(body.drift && body.p[2] > 11, `the body went out too (${body.p.map((v) => v.toFixed(1))})`);
  assert.ok(w.events.some((e) => e.type === 'ejected'));
  const z0 = loose.p[2];
  const y0 = loose.p[1];
  run(sim, 5);
  assert.ok(loose.p[2] > z0 + 3, 'it drifts on, nothing slows it down');
  assert.ok(Math.abs(loose.p[1] - y0) < 0.5, 'no gravity out there (the ship has its own)');
  assert.ok(Math.hypot(strapped.p[0] - 21.1, strapped.p[2] - 9.2) < 0.01 && !strapped.drift, 'the strapped-down crate stays');
});

test('spaceship breach: the interior doors close themselves; a closed door holds the pressure difference, then lets it level', () => {
  const sim = ship(); // (doors close themselves)
  const w = sim.world;
  toggleDoor(sim, door(w, 'airlock (inner)'), true);
  run(sim, 1);
  toggleDoor(sim, door(w, 'airlock (outer)'), true);
  run(sim, 4);
  assert.ok(!w.doors[door(w, 'airlock (inner)')].open, 'the inner airlock door slammed shut');
  assert.ok(w.events.some((e) => e.type === 'doorClose' && e.slam));
  const pa = pressureAt(sim, AIRLOCK);
  const pc = pressureAt(sim, CORRIDOR);
  assert.ok(pa < 0.01, `the airlock is empty (${pa.toFixed(3)})`);
  assert.ok(pc > 0.05 && pc < 0.9, `the corridor kept what it had when its door shut (${pc.toFixed(2)})`);
  run(sim, 8);
  assert.ok(Math.abs(pressureAt(sim, CORRIDOR) - pc) < 0.01, 'the sealed door holds');
  assert.ok(pressureAt(sim, BRIDGE) > 0.99, 'the bridge (door shut all along) has all its air');
  // the bridge door against the difference: it will not open; its valve levels the two sides first
  const bd = door(w, 'bridge');
  const vol = (p) => w.comps[w.comp[sim.airCellAt(...p)]].V;
  const Vc = vol(CORRIDOR);
  const Vb = vol(BRIDGE);
  assert.equal(toggleDoor(sim, bd, true), false, 'held shut by the pressure difference');
  assert.ok(w.events.some((e) => e.type === 'doorHeld'));
  run(sim, 30);
  assert.ok(w.doors[bd].open, 'once level, it opens');
  const pb = pressureAt(sim, BRIDGE);
  const pc2 = pressureAt(sim, CORRIDOR);
  const mean = (pc * Vc + 1 * Vb) / (Vc + Vb);
  assert.ok(Math.abs(pb - pc2) < 0.02, `level on both sides (${pb.toFixed(3)} / ${pc2.toFixed(3)})`);
  assert.ok(Math.abs(pb - mean) < 0.06, `the air shared out by volume (${pb.toFixed(3)}, expected ${mean.toFixed(3)})`);
});

test('spaceship breach: something too big for the hole plugs it for a while, until the pressure pushes it through', () => {
  const sim = ship({ autoSeal: false });
  const w = sim.world;
  run(sim, 0.4);
  // a hole of 0.4 x 0.4 m in the airlock's outer wall, beside its door
  const h = w.h;
  for (let x = 18.8; x < 19.2 - 1e-6; x += h)
    for (let y = 1.2; y < 1.6 - 1e-6; y += h)
      for (let z = 10.4; z < 11.4 - 1e-6; z += h) {
        const i = w.idx(Math.floor((x + 1e-6) / h), Math.floor((y + 1e-6) / h), Math.floor((z + 1e-6) / h));
        if (w.mat[i]) w.clearVoxel(i);
      }
  const box = crate(w, [19.0, 1.35, 10.25]);
  run(sim, 1.2);
  assert.ok(w.holes.some((H) => H.area > 0.1 && H.area < 0.3), `a small hole (${w.holes.map((H) => H.area.toFixed(2))})`);
  assert.ok(box.plug != null, 'the crate is stuck in the hole');
  assert.ok(w.events.some((e) => e.type === 'plugged'));
  const p0 = pressureAt(sim, AIRLOCK);
  run(sim, 2.7);
  const p1 = pressureAt(sim, AIRLOCK);
  assert.ok(p1 > p0 * 0.85 && p1 > 0.7, `the leak almost stops while it holds (${p0.toFixed(2)} → ${p1.toFixed(2)})`);
  run(sim, 8);
  assert.ok(box.drift && box.broken, 'crushed and pushed through');
  assert.ok(pressureAt(sim, AIRLOCK) < 0.2, `then the air goes (${pressureAt(sim, AIRLOCK).toFixed(2)})`);
});

test('spaceship breach: the air streams to the hole, cools as it expands, the vapour condenses', () => {
  const sim = ship({ autoSeal: false });
  const w = sim.world;
  toggleDoor(sim, door(w, 'airlock (inner)'), true);
  run(sim, 1);
  const t0 = w.airT[sim.airCellAt(...CORRIDOR)];
  toggleDoor(sim, door(w, 'airlock (outer)'), true);
  run(sim, 1.4);
  // the corridor's air towards the airlock door (x = 20, z > 6.5), faster close to it
  const u = (p) => {
    const a = sim.airCellAt(...p);
    return [w.blow[a * 3], w.blow[a * 3 + 1], w.blow[a * 3 + 2]];
  };
  const near = u([18.5, 2, 6.8]);
  const far = u([12, 2, 6.5]);
  assert.ok(near[0] > 1 && far[0] > 0.3, `towards the door (${near.map((v) => v.toFixed(1))} / ${far.map((v) => v.toFixed(1))})`);
  assert.ok(Math.hypot(...near) > Math.hypot(...far), 'faster near it');
  const door1 = u([20, 2, 10.6]);
  assert.ok(door1[2] > 30, `a jet out of the door (${door1[2].toFixed(0)} m/s)`);
  assert.ok(w.airT[sim.airCellAt(...CORRIDOR)] < t0 - 10, `the air cools (${t0.toFixed(0)} → ${w.airT[sim.airCellAt(...CORRIDOR)].toFixed(0)} °C)`);
  let fog = 0;
  for (let a = 0; a < w.NA; a++) if (w.steam[a] > 0) fog++;
  assert.ok(fog > 20, `a fog of condensed vapour (${fog} cells)`);
});

test('ship holed below the waterline: the sea pushes loose things in, away from the hole', () => {
  const sim = createSimulation({
    world: { size: [14, 7.2, 8.4], h: 0.2, ground: 'none' },
    weather: { ambient: 14 },
    objects: [{ type: 'shipSection', params: { length: 12, beam: 6, burstAfter: 9999 }, x: 7, z: 4.2 }],
  });
  const w = sim.world;
  sim.step(sim.dt);
  const box = w.loose.find((o) => o.kind === 'crate');
  assert.ok(box, 'stores in the cross corridor');
  const z0 = box.p[2];
  // the aft cross corridor, hull side (z small), below the waterline
  explode(sim, [7 - 3, 0.2 + 0.7 + 1.0, w.sea.box[1] + 0.4], 8e5);
  run(sim, 3);
  assert.ok(w.inflows.length > 0, 'the sea comes in');
  assert.ok(box.p[2] > z0 + 1, `pushed in, away from the hole (z ${z0.toFixed(2)} → ${box.p[2].toFixed(2)})`);
  assert.ok(!box.drift, 'and it stays in the ship');
});
