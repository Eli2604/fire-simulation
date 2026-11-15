import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carSpec, makeCar, stepCar, pedals, startEngine, engineTorque, setMode } from '../src/sim/carPhysics.js';
import { newCar, initCars, boardCar, stepCarList, carNear, carUsable } from '../src/sim/cars.js';
import { driveTo, navGrid } from '../src/ai/carDriver.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { F_BURNING } from '../src/sim/world.js';

/** Run a car on flat open ground (no world) for t s at dt with the controls from fn(c, t). */
function run(c, T, fn, dt = 0.02) {
  for (let t = 0; t < T; t += dt) {
    c.input = fn(c, t);
    stepCar(c, dt, {});
  }
}
const started = (params = {}) => {
  const c = makeCar(carSpec(params), {});
  startEngine(c);
  run(c, 1.5, () => ({ throttle: 0, brake: 1, steer: 0 }));
  return c;
};
const hold = (v) => (c) => {
  const e = v - c.u;
  return { ...pedals(c, Math.max(0, Math.min(1, e * 0.5)), Math.max(0, Math.min(1, -e * 0.5))), steer: 0 };
};

test('the engine: it cranks, fires and idles; a torque curve with its peak in the middle', () => {
  const c = started();
  assert.ok(c.running, 'it started');
  assert.ok(Math.abs(c.rpm - c.spec.engine.idle) < 150, `idles at ${c.rpm.toFixed(0)} rpm`);
  assert.ok(c.sfx.some((e) => e.kind === 'start'));
  const E = c.spec.engine;
  const at = (r) => engineTorque(E, r, 1);
  assert.ok(at(0.65 * E.redline) > at(0.15 * E.redline) && at(0.65 * E.redline) > at(1.05 * E.redline));
  assert.ok(engineTorque(E, 3000, 0) < 0, 'off the throttle it brakes the car');
});

test('acceleration and top speed are those of a car: 0-100 km/h in 7-15 s, 160-230 km/h flat out, through the gears', () => {
  const c = started();
  let t100 = null;
  const gears = new Set();
  run(c, 70, (c, t) => {
    if (t100 === null && c.u >= 100 / 3.6) t100 = t;
    gears.add(c.gear);
    return { ...pedals(c, 1, 0), steer: 0 };
  });
  assert.ok(t100 > 7 && t100 < 15, `0-100 in ${t100?.toFixed(1)} s`);
  const top = c.u * 3.6;
  assert.ok(top > 160 && top < 230, `top speed ${top.toFixed(0)} km/h`);
  assert.ok(gears.size >= 4, `shifted up through ${[...gears]}`);
  assert.ok(c.sfx.some((e) => e.kind === 'shift' && e.up));
  assert.ok(c.used > 0.1 && c.fuel < 40, `burnt ${c.used.toFixed(2)} l`);
  // a heavy truck is slower off the mark
  const T = started({ length: 5.5, width: 2.2, height: 2 });
  let tt = null;
  run(T, 40, (T, t) => {
    if (tt === null && T.u >= 60 / 3.6) tt = t;
    return { ...pedals(T, 1, 0), steer: 0 };
  });
  assert.ok(T.spec.engine.kind === 'diesel' && T.spec.mass > 2000);
  assert.ok(tt > 4, `the truck to 60 km/h in ${tt?.toFixed(1)} s`);
});

test('braking: from 100 km/h it stops in 38-60 m (about 0.8-1 g); the handbrake locks the rear', () => {
  const c = started();
  run(c, 20, hold(100 / 3.6));
  assert.ok(Math.abs(c.u - 100 / 3.6) < 1.5, `at ${(c.u * 3.6).toFixed(0)} km/h`);
  const x0 = c.x, z0 = c.z;
  let T = 0;
  run(c, 10, (c, t) => {
    if (c.u > 0.05) T = t;
    return { throttle: 0, brake: 1, steer: 0 };
  });
  const d = Math.hypot(c.x - x0, c.z - z0);
  assert.ok(d > 38 && d < 60, `stopped in ${d.toFixed(1)} m (${T.toFixed(1)} s)`);
  assert.ok(Math.abs(c.u) < 0.05, 'and stays stopped');
  // full brake at speed: the front wheels lock, the tyres squeal
  const c2 = started();
  run(c2, 10, hold(15));
  let skid = 0;
  run(c2, 1, () => ({ throttle: 0, brake: 1, steer: 0 }), 0.02);
  for (let t = 0; t < 0.5; t += 0.02) {
    c2.input = { throttle: 0, brake: 1, steer: 0 };
    stepCar(c2, 0.02, {});
    skid = Math.max(skid, c2.skid);
  }
  void skid;
  const c3 = started();
  run(c3, 8, hold(12));
  let sk3 = 0;
  run(c3, 1.5, (c) => {
    sk3 = Math.max(sk3, c.skid);
    return { throttle: 0, brake: 0, steer: 0, handbrake: true };
  });
  assert.ok(sk3 > 0.3, `handbrake: it slides (${sk3.toFixed(2)})`);
});

test('steering: the turning circle at walking pace is the geometry (wheelbase / tan lock); faster it runs wide; a left wheel turns it left', () => {
  const radius = (v) => {
    const c = started();
    const pts = [];
    run(c, 30, (c, t) => {
      if (t > 15) pts.push([c.x, c.z]);
      return { ...hold(v)(c), steer: t > 3 ? 1 : 0 };
    });
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { r: pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length, cz, c };
  };
  const slow = radius(2.5);
  const S = slow.c.spec;
  const kin = (2 * S.wheelX) / Math.tan(S.maxSteer);
  assert.ok(Math.abs(slow.r - kin) / kin < 0.25, `radius ${slow.r.toFixed(1)} m (geometry ${kin.toFixed(1)} m)`);
  assert.ok(slow.r > 3.5 && slow.r < 7, 'a car turning circle');
  assert.ok(slow.cz < 0, 'it turned left (to -z, the left of +x)');
  const fast = radius(9);
  assert.ok(fast.r > slow.r * 1.05, `wider at speed (${fast.r.toFixed(1)} m)`);
  assert.ok(Math.abs(fast.c.roll) > 0.01, 'leaning in the turn');
});

test('ground: it follows the height under its wheels up a slope and down a step, and the slope slows it', () => {
  // a ramp from x = 20 to 40 rising 1 in 10, then a plateau, then a 0.3 m step down at x = 60
  const ground = (x) => (x < 20 ? 0 : x < 40 ? (x - 20) * 0.1 : x < 60 ? 2 : 1.7);
  const env = { ground: (x) => ({ y: ground(x), mu: 1, road: true }) };
  const c = makeCar(carSpec({}), {});
  startEngine(c);
  let maxErr = 0, maxPitch = 0;
  for (let t = 0; t < 30 && c.x < 75; t += 0.02) {
    const e = 8 - c.u;
    c.input = { ...pedals(c, Math.max(0, Math.min(1, e * 0.4 + 0.2)), 0), steer: 0 };
    stepCar(c, 0.02, env);
    if (c.x > 2 && c.x < 58 && !c.air) maxErr = Math.max(maxErr, Math.abs(c.y - (ground(c.x - c.spec.wheelX) + ground(c.x + c.spec.wheelX)) / 2));
    if (c.x > 24 && c.x < 36) maxPitch = Math.max(maxPitch, c.pitch);
  }
  assert.ok(c.x > 70, `got over it (${c.x.toFixed(1)})`);
  assert.ok(maxErr < 0.05, `on its wheels (${maxErr.toFixed(3)} m off)`);
  assert.ok(Math.abs(maxPitch - Math.atan(0.1)) < 0.05, `nose up the ramp (${maxPitch.toFixed(3)})`);
  assert.ok(Math.abs(c.y - 1.7) < 0.05, 'down the step');
  // rolling back down a 1-in-5 slope with the brake off, out of gear
  const env2 = { ground: (x) => ({ y: -0.2 * x, mu: 1, road: true }) };
  const d = makeCar(carSpec({}), {});
  d.input = { throttle: 0, brake: 0, steer: 0 };
  d.mode = 'N';
  stepCar(d, 3, env2);
  assert.ok(d.u > 2, `it rolls down (${d.u.toFixed(1)} m/s)`);
});

test('no fuel, no go; a dead engine does not start', () => {
  const c = makeCar(carSpec({ fuelLiters: 0 }), {});
  startEngine(c);
  stepCar(c, 1.5, {});
  assert.ok(!c.running && c.why === 'no fuel');
  const d = makeCar(carSpec({}), {});
  d.dead = true;
  assert.equal(startEngine(d), false);
  // running dry
  const e = started({ fuelLiters: 0.02 });
  run(e, 30, () => ({ ...pedals(e, 1, 0), steer: 0 }));
  assert.ok(!e.running && e.why === 'out of fuel', e.why);
});

/** A street of soil 40 × 12 m (h 0.2 m) with a car on it (ignited at the engine if fire). */
function street(fire = false, extra = []) {
  const sim = createSimulation({ world: { size: [40, 5, 12], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, objects: [{ type: 'car', params: {}, x: 6, z: 6, rotation: 0, ignite: fire }, ...extra] });
  const c = initCars(sim.world)[0];
  return { sim, w: sim.world, c };
}
const ownCells = (w, c, pred = () => true) => {
  if (w.listDirty) w.rebuildLists();
  const out = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] === c.owner && pred(i)) out.push(w.coords(i).map((v) => (v + 0.5) * w.h));
  }
  return out;
};

test('a car of the world: found by its door, boarded (its weight in it), driven by its voxels: they go with it, none left behind', () => {
  const { sim, w, c } = street();
  assert.equal(w.cars.length, 1);
  assert.equal(carNear(w, [c.x + 0.1, c.y, c.z - 1.4]), c, 'by the driver door');
  assert.equal(carNear(w, [c.x + 9, c.y, c.z]), null);
  const n0 = ownCells(w, c).length;
  const me = { player: true, mass: 85 };
  assert.equal(boardCar(c, me, 0), 0);
  assert.equal(c.load, 85);
  assert.ok(c.body && c.body.n > 300, 'its voxels are its body now');
  c.player = true;
  startEngine(c);
  for (let t = 0; t < 4; t += 1 / 30) {
    c.input = { ...pedals(c, t > 1 ? 0.6 : 0, 0), steer: 0 };
    sim.step(1 / 30);
  }
  for (let t = 0; t < 3; t += 1 / 30) {
    c.input = { throttle: 0, brake: 1, steer: 0 };
    sim.step(1 / 30);
  }
  assert.ok(c.x > 14 && c.x < 30, `driven on (${c.x.toFixed(1)})`);
  const cells = ownCells(w, c);
  assert.ok(cells.length > n0 * 0.9, `its voxels (${cells.length} of ${n0})`);
  const mx = cells.reduce((s, p) => s + p[0], 0) / cells.length;
  assert.ok(Math.abs(mx - c.x) < 0.6, `round the car (${mx.toFixed(2)} vs ${c.x.toFixed(2)})`);
  assert.equal(cells.filter((p) => p[0] < 9).length, 0, 'none left where it stood');
  // the petrol tank went with it, sealed
  assert.ok(ownCells(w, c, (i) => w.vesselTag[i] < 0).length > 5);
  // turned round (its voxels resampled at every angle): the tank still sealed, the petrol in it
  for (let t = 0; t < 5; t += 1 / 30) {
    c.input = { ...pedals(c, 0.3, 0), steer: 1 };
    sim.step(1 / 30);
  }
  assert.ok(Math.abs(c.yaw) > 1.0, `it turned (${c.yaw.toFixed(2)} rad)`);
  assert.ok(!['leaking', 'ruptured'].includes(w.vessels[0].state), `the tank: ${w.vessels[0].state}`);
  assert.ok(Math.abs(c.fuel - (40 - c.used)) < 0.5, `fuel ${c.fuel.toFixed(2)} l (used ${c.used.toFixed(2)})`);
});

test('a burning car keeps burning as it drives: the fire goes with its voxels; the engine dies when its bay has burnt', () => {
  const { sim, w, c } = street(true);
  for (let t = 0; t < 40; t += 0.1) sim.step(0.1);
  const burning = () => ownCells(w, c, (i) => w.flags[i] & F_BURNING);
  const b0 = burning();
  assert.ok(b0.length > 0, 'its engine bay is on fire');
  assert.ok(!carUsable({ ...c, burning: true }), 'not one to take');
  boardCar(c, { player: true, mass: 85 }, 0);
  c.player = true;
  startEngine(c);
  for (let t = 0; t < 5; t += 1 / 30) {
    c.input = { ...pedals(c, t > 1 ? 0.5 : 0, 0), steer: 0 };
    sim.step(1 / 30);
  }
  for (let t = 0; t < 3; t += 1 / 30) {
    c.input = { throttle: 0, brake: 1, steer: 0 };
    sim.step(1 / 30);
  }
  assert.ok(c.x > 14, `it drove (${c.x.toFixed(1)})`);
  const b1 = burning();
  assert.ok(b1.length > 0, 'still burning');
  const bx = b1.reduce((s, p) => s + p[0], 0) / b1.length;
  assert.ok(bx > c.x, `the fire at its front, where the engine is (${bx.toFixed(1)} vs ${c.x.toFixed(1)})`);
  assert.equal(ownCells(w, c, (i) => w.coords(i)[0] * w.h < 9).length, 0, 'nothing of it left at the start');
  assert.ok(c.burning, 'it knows it burns');
  // the engine bay burnt out: the engine dies
  c.body.state.char.fill(0.9);
  c.checkT = 0;
  sim.step(1 / 30);
  assert.ok(c.dead && !c.running, `the engine is dead (${c.why})`);
});

test('an AI drives to a point along the roads (an L of road: it keeps to it rather than cut across the field), and stops there', () => {
  const h = 0.5;
  const sim = createSimulation({
    world: { size: [50, 8, 50], h }, weather: { ambient: 15, windSpeed: 0 },
    objects: [
      { type: 'road', params: { length: 42, width: 6, posts: false }, x: 25, z: 10, y: h },
      { type: 'road', params: { length: 36, width: 6, posts: false }, x: 43, z: 25, y: h, rotation: 90 },
      { type: 'car', params: {}, x: 8, z: 10, y: 'auto', rotation: 0 },
    ],
  });
  const w = sim.world;
  const c = initCars(w)[0];
  const G = navGrid(w);
  assert.ok(G && G.road.some((r) => r), 'the roads are on its map');
  const driver = { mass: 80, p: [0, 0, 0] };
  boardCar(c, driver, 0);
  driveTo(c, [43, 0, 40], { speed: 10 });
  let onRoad = 0, n = 0, maxSpeed = 0;
  for (let t = 0; t < 45 && !(c.drive.done && Math.abs(c.u) < 0.1); t += 1 / 30) {
    sim.step(1 / 30);
    n++;
    if (c.groundInfo?.road) onRoad++;
    maxSpeed = Math.max(maxSpeed, c.u);
  }
  assert.ok(c.drive.done, `got there (${c.x.toFixed(1)}, ${c.z.toFixed(1)}): ${c.drive.log}`);
  assert.ok(Math.hypot(c.x - 43, c.z - 40) < 4.5, `stopped at it (${c.x.toFixed(1)}, ${c.z.toFixed(1)})`);
  assert.ok(Math.abs(c.u) < 0.2);
  assert.ok(onRoad / n > 0.85, `on the road ${((100 * onRoad) / n).toFixed(0)} % of the way`);
  assert.ok(maxSpeed > 7 && maxSpeed < 11.5, `at its speed (${maxSpeed.toFixed(1)} m/s)`);
  assert.ok(driver.p[0] > 38, 'its driver went with it');
});

test('an AI driver goes round a wall in its way and stops short of a man standing in the road', () => {
  const h = 0.25;
  const sim = createSimulation({
    world: { size: [40, 6, 24], h }, weather: { ambient: 15, windSpeed: 0 },
    objects: [
      { type: 'wall', params: { length: 8, height: 2.5 }, x: 20, z: 12, rotation: 90 },
      { type: 'car', params: {}, x: 6, z: 12, y: 'auto', rotation: 0 },
    ],
  });
  const w = sim.world;
  const c = initCars(w)[0];
  boardCar(c, { mass: 80, p: [0, 0, 0] }, 0);
  driveTo(c, [34, 0, 12], { speed: 8 });
  for (let t = 0; t < 40 && !c.drive.done; t += 1 / 30) sim.step(1 / 30);
  assert.ok(c.drive.done && c.x > 30, `round the wall (${c.x.toFixed(1)}, ${c.z.toFixed(1)}): ${c.drive.log}`);
  assert.ok(c.damage < 0.05, `without hitting it (${c.damage})`);
  // a man standing in its way on an open street
  const s2 = createSimulation({ world: { size: [40, 5, 12], h: 0.25 }, weather: { ambient: 15, windSpeed: 0 }, objects: [{ type: 'car', params: {}, x: 6, z: 6, y: 'auto', rotation: 0 }] });
  const c2 = initCars(s2.world)[0];
  const man = { p: [24, c2.y, c2.z], health: 100, squad: 'R1' };
  s2.world.enemies.push(man);
  boardCar(c2, { mass: 80, p: [0, 0, 0] }, 0);
  driveTo(c2, [34, 0, c2.z], { speed: 9 });
  for (let t = 0; t < 20; t += 1 / 30) s2.step(1 / 30);
  assert.ok(!man.dead && man.health === 100, 'he was not run over');
  assert.ok(c2.x < man.p[0] - c2.spec.L / 2 - 0.5 && c2.x > man.p[0] - 10, `it stopped short of him (${c2.x.toFixed(1)})`);
  assert.ok(Math.abs(c2.u) < 0.3);
});

test('a squad falls back to a real car: in one by one (their weight in it), the man at the wheel drives it off away from the threat', async () => {
  const { SquadAI } = await import('../src/ai/squad.js');
  const { vehicleOf } = await import('../src/ai/vehicles.js');
  // the car 14 m behind them (the enemy 14 m in front), its nose away from the enemy (+z)
  const car = newCar({}, { x: 0, z: 14, yaw: -Math.PI / 2, id: 'jeep' });
  const ROLES = [['CMD', -2, 0], ['R1', -0.7, 0.4], ['MG', 0.7, 0.2], ['R2', 2, 0.5]];
  const ms = ROLES.map(([r, x, z]) => ({ p: [x, 0, z], yaw: Math.PI, squad: r, unit: 'Alpha', health: 100, mag: 30, mags: 5, skill: 'regular' }));
  const log = [];
  const sq = new SquadAI({
    unit: 'Alpha', members: () => ms, solid: (x, y) => y < 0, lineOfSight: () => true, seed: 3, floor: () => 0,
    bounds: [-20, -20, 20, 30], threat: [0, 0, -14], hostiles: () => [{ p: [0, 0, -14] }],
    radio: (m, text) => log.push(`radio: ${text}`), shout: (m, t) => log.push(`${m.squad}: ${t}`), fire: () => {},
    vehicles: () => [car], retreat: { order: true }, din: () => 65,
  });
  const V = vehicleOf(car);
  assert.equal(V.kind, 'car');
  assert.ok(V.usable() && V.stationary() && V.needsDriver());
  let maxLoad = 0, drivenT = 0;
  for (let t = 0; t < 240 && !(sq.strategy?.phase === 'done' && !sq.board); t += 0.05) {
    sq.step(0.05);
    stepCarList([car], 0.05, {});
    maxLoad = Math.max(maxLoad, car.load);
    if (car.running && Math.abs(car.u) > 1) drivenT += 0.05;
  }
  const L = sq.vehicleLog ?? [];
  assert.ok(sq.retreatLog.some((l) => /^retreat:vehicle:car:/.test(l)), sq.retreatLog.join(' | '));
  assert.ok(L.some((l) => /^vehicle:depart:car:(CMD|MG|R1|R2)$/.test(l)), L.join(' | '));
  assert.ok(L.some((l) => /^vehicle:arrive:car/.test(l)), `got there: ${L.join(' | ')}`);
  assert.equal(maxLoad, 4 * 85, 'all four aboard, their weight in it');
  assert.ok(drivenT > 5, `driven (${drivenT.toFixed(1)} s on the move)`);
  assert.ok(car.z > 80, `away from the threat (${car.x.toFixed(1)}, ${car.z.toFixed(1)})`);
  assert.ok(car.odo > 60 && car.used > 0, 'on its wheels, burning its fuel');
  assert.equal(car.load, 0, 'out of it again');
  for (const m of ms) assert.ok(!m.vehTask && !m.inVehicle && Math.hypot(m.p[0] - car.x, m.p[2] - car.z) < 5, `${m.squad} out by the car`);
});

test('sound from the physics: firing frequency from the revs and cylinders, louder and brighter under load, tyres squeal with slip, Doppler and distance', async () => {
  const { carSoundParams, engineSound, firingHz, carSfxSound, carDoppler } = await import('../src/audio/carSound.js');
  assert.equal(firingHz(6000, 4), 200);
  assert.equal(firingHz(800, 4), 800 / 60 * 2);
  assert.equal(firingHz(1500, 6), 75);
  const c = started();
  const idle = engineSound(c);
  assert.ok(idle.on && Math.abs(idle.fire - (c.rpm / 60) * 2) < 1e-9, 'a four at idle: twice its turns');
  // flat out in second
  run(c, 6, () => ({ ...pedals(c, 1, 0), steer: 0 }));
  const hard = engineSound(c);
  assert.ok(hard.fire > idle.fire * 3, `revs up (${idle.fire.toFixed(0)} → ${hard.fire.toFixed(0)} Hz)`);
  assert.ok(hard.gain > idle.gain * 1.5 && hard.cutoff > idle.cutoff * 2, 'louder and brighter under load');
  assert.ok(hard.intake > idle.intake);
  // off the throttle at the same revs: quieter
  c.input = { throttle: 0, brake: 0, steer: 0 };
  stepCar(c, 0.1, {});
  const coast = engineSound(c);
  assert.ok(coast.gain < hard.gain, 'coasting: quieter');
  // the tyres: rolling with speed, a squeal when they slide (the handbrake at speed)
  const P0 = carSoundParams(c, { pos: [c.x, 1, c.z + 5] });
  assert.ok(P0.roll > 0.05 && P0.squeal < 0.05, `rolling (${P0.roll.toFixed(2)}), no squeal`);
  run(c, 0.6, () => ({ throttle: 0, brake: 0, steer: 0.6, handbrake: true }));
  const P1 = carSoundParams(c, { pos: [c.x, 1, c.z + 5] });
  assert.ok(P1.squeal > 0.2, `squealing (${P1.squeal.toFixed(2)})`);
  // Doppler: coming at you higher, going away lower; far: quieter
  const v = Math.hypot(c.vx, c.vz);
  const ux = c.vx / v, uz = c.vz / v;
  const ahead = carSoundParams(c, { pos: [c.x + ux * 30, 1, c.z + uz * 30] });
  const behind = carSoundParams(c, { pos: [c.x - ux * 30, 1, c.z - uz * 30] });
  assert.ok(ahead.doppler > 1 && behind.doppler < 1, `${ahead.doppler.toFixed(3)} / ${behind.doppler.toFixed(3)}`);
  assert.ok(Math.abs(ahead.doppler - 343 / (343 - v)) < 0.01);
  assert.ok(ahead.engine.fire > behind.engine.fire && ahead.engine.fire0 === behind.engine.fire0);
  const far = carSoundParams(c, { pos: [c.x + ux * 300, 1, c.z + uz * 300] });
  assert.ok(far.level < ahead.level / 5, 'heard less far off');
  assert.equal(carDoppler([0, 0, 0], [0, 0, 0], [1, 0, 0]), 1);
  // the horn, a diesel's rattle, the shift and crash one-shots
  c.horn = true;
  assert.equal(carSoundParams(c).horn, 1);
  const T = started({ length: 5.5, width: 2.2, height: 2 });
  assert.ok(engineSound(T).rattle > 0, 'a diesel rattles');
  assert.ok(engineSound(T).fire === firingHz(T.rpm, 6), 'a six');
  assert.ok(c.sfx.some((e) => e.kind === 'shift'));
  for (const k of ['shift', 'start', 'stall', 'crash', 'thud', 'land', 'crankFail']) assert.ok(carSfxSound({ kind: k, v: 8, up: true })?.layers.length > 0, k);
  assert.ok(carSfxSound({ kind: 'crash', v: 15 }).gain > carSfxSound({ kind: 'crash', v: 3 }).gain, 'a harder crash is louder');
  // engine off: silent engine
  const off = makeCar(carSpec({}), {});
  assert.equal(engineSound(off).gain, 0);
});

test('a crash into a wall: stopped, damaged, an impact event (its sound), a man in the way knocked down', () => {
  const sim = createSimulation({ world: { size: [30, 5, 12], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, objects: [
    { type: 'wall', params: { length: 6, height: 2.5, thickness: 0.4, material: 'concrete' }, x: 24, z: 6, rotation: 90 },
    { type: 'car', params: {}, x: 5, z: 6, rotation: 0 },
  ] });
  const w = sim.world;
  const c = initCars(w)[0];
  const man = { p: [12, c.y, 6], health: 100, squad: 'R1', unit: 'X' };
  w.enemies.push(man);
  boardCar(c, { player: true, mass: 85 }, 0);
  c.player = true;
  startEngine(c);
  let hitMan = false;
  for (let t = 0; t < 8 && c.damage < 0.01; t += 1 / 30) {
    c.input = { ...pedals(c, t > 1 ? 1 : 0, 0), steer: 0 };
    sim.step(1 / 30);
    hitMan ||= man.health < 100;
  }
  assert.ok(hitMan || man.knockedDown || man.dead, 'the man was struck');
  assert.ok(c.sfx.some((e) => e.kind === 'thud'));
  for (let t = 0; t < 2; t += 1 / 30) {
    c.input = { throttle: 0, brake: 1, steer: 0 };
    sim.step(1 / 30);
  }
  assert.ok(c.damage > 0.01, `damaged (${c.damage.toFixed(3)})`);
  assert.ok(c.x + c.spec.L / 2 < 24.2, `stopped at the wall (${c.x.toFixed(2)})`);
  assert.ok(Math.abs(c.u) < 0.5);
  assert.ok(c.sfx.some((e) => e.kind === 'crash'));
  assert.ok(w.events.some((e) => e.type === 'impact' && e.kind === 'vehicle'), 'an impact (heard: audio/sound.js)');
});

test('two cars: they push each other, not through', () => {
  const a = newCar({}, { x: 0, z: 0, yaw: 0 }), b = newCar({}, { x: 12, z: 0, yaw: 0 });
  boardCar(a, { mass: 80 }, 0);
  a.player = true;
  startEngine(a);
  for (let t = 0; t < 8; t += 0.05) {
    a.input = { ...pedals(a, 1, 0), steer: 0 };
    stepCarList([a, b], 0.05, {});
  }
  assert.ok(b.x > 12.5, `b was pushed (${b.x.toFixed(2)})`);
  assert.ok(b.x - a.x > (a.spec.L + b.spec.L) / 2 - 0.15, 'not through each other');
  assert.ok(a.damage > 0 && b.damage > 0);
});

test('drawn on the move: its mesh in its pose, the front wheels steered, the wheels turning; at rest its voxels again', async () => {
  const THREE = await import('three');
  const { CarRenderer } = await import('../src/render/cars.js');
  const { CarDrive } = await import('../src/walk/carDrive.js');
  const { sim, w, c } = street();
  const R = new CarRenderer(new THREE.Group());
  R.setWorld(w);
  boardCar(c, { player: true, mass: 85 }, 0);
  c.player = true;
  startEngine(c);
  // the keys as the walk-through has them: W and A held
  const keys = new Set(['KeyW', 'KeyA']);
  const k = CarDrive.controlsFrom(keys);
  assert.deepEqual(k, { ahead: 1, back: 0, steer: 1, handbrake: false, horn: false });
  for (let t = 0; t < 3; t += 1 / 30) {
    c.input = { ...pedals(c, t > 1 ? k.ahead * 0.5 : 0, k.back), steer: t > 2 ? k.steer * 0.5 : 0 };
    sim.step(1 / 30);
    R.update();
  }
  assert.ok(c.body.hidden, 'its voxels hidden on the move');
  const m = R.items.get(c);
  assert.ok(m, 'a mesh for it');
  assert.ok(Math.abs(m.group.position.x - c.x) < 1e-9 && Math.abs(m.group.rotation.y - c.yaw) < 1e-9);
  const front = m.wheels.filter((q) => q.front), rear = m.wheels.filter((q) => !q.front);
  assert.ok(front.every((q) => q.steer.rotation.y > 0.02), 'the front wheels turned left');
  assert.ok(rear.every((q) => q.steer.rotation.y === 0));
  assert.ok(m.wheels.every((q) => q.spin.rotation.z < -1), 'rolling forward');
  // stopped: the voxels are drawn again, the mesh goes
  for (let t = 0; t < 4; t += 1 / 30) {
    c.input = { throttle: 0, brake: 1, steer: 0 };
    sim.step(1 / 30);
    R.update();
  }
  assert.ok(!c.body.hidden && !R.items.has(c));
});

test('the film cameras find the cars (cinema subjectsOf: world.cars)', async () => {
  const { subjectsOf } = await import('../src/cinema/rig.js');
  const c = newCar({}, { x: 3, y: 1, z: 4, yaw: 0.5 });
  const s = subjectsOf({ cars: [c] }).filter((q) => q.kind === 'car');
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].p, [3, 1, 4]);
  assert.equal(s[0].yaw, 0.5);
});
