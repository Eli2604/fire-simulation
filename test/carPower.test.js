import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { carSpec, makeCar, stepCar, pedals, startEngine, steeringWheelAngle, lockToLock, wheelPhase, WHEEL_PHASE_RANGE, motorTorqueMax, hasEnergy } from '../src/sim/carPhysics.js';
import { newCar, initCars, boardCar, placeAboard, stepCarList, ensureBody, checkState } from '../src/sim/cars.js';
import { World } from '../src/sim/world.js';
import { MAT } from '../src/sim/materials.js';
import { stepBatteries, packState, cellsOf, crushCells, onsetOf, FRESH } from '../src/sim/batteries.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { shoot } from '../src/sim/wounds.js';
import { operatorClips, solve, pose0, weaponKit, carClipPose, wheelHands, CAR_WHEEL, LABELS } from '../src/operator/rig.js';

/** Run a car on flat open ground (no world) for T s with the controls from fn(c, t). */
function run(c, T, fn, env = {}, dt = 0.02) {
  for (let t = 0; t < T; t += dt) {
    c.input = fn(c, t);
    stepCar(c, dt, env);
  }
}
const started = (params = {}, env = {}) => {
  const c = makeCar(carSpec(params), {});
  startEngine(c);
  run(c, 1.5, () => ({ throttle: 0, brake: 1, steer: 0 }), env);
  return c;
};
const ground = (mu) => ({ ground: () => ({ y: 0, mu, road: mu > 0.6 }) });

/* ------------------------------------------------------------------ drivetrains */

test('drivetrains: 4×4 puts twice the power down on mud; FWD pushes wide under power, RWD steps its tail out', () => {
  assert.equal(carSpec({}).drive.kind, 'rwd', 'a car: rear-wheel drive');
  assert.equal(carSpec({ length: 4.4, width: 1.9, height: 1.9 }).drive.kind, 'awd', 'a jeep: permanent 4×4');
  assert.equal(carSpec({ length: 5.5, width: 2.2, height: 2 }).drive.kind, 'awd', 'a truck: 4×4');
  assert.equal(carSpec({ drivetrain: 'fwd' }).drive.front, 1);
  // traction: 5 s flat out from rest on mud (μ 0.35)
  const mud = ground(0.35);
  const v5 = {};
  for (const d of ['rwd', 'fwd', 'awd', '4x4']) {
    const c = started({ drivetrain: d, esp: false }, mud);
    run(c, 5, (c) => ({ ...pedals(c, 1, 0), steer: 0 }), mud);
    v5[d] = c.u;
    // the driven wheels spin, the others roll
    if (d === 'rwd') assert.ok(c.omegaR * 0.33 > c.u + 1 && Math.abs(c.omegaF * 0.33 - c.u) < 0.3, `RWD: the rear spins (${(c.omegaR * 0.33).toFixed(1)} m/s at ${c.u.toFixed(1)})`);
    if (d === 'fwd') assert.ok(c.omegaF * 0.33 > c.u + 1 && Math.abs(c.omegaR * 0.33 - c.u) < 0.3, 'FWD: the front spins');
    if (d === '4x4') assert.equal(c.omegaF, c.omegaR, 'the centre locked: one speed');
    assert.deepEqual(c.wheels.map((q) => q.omega), [c.omegaF, c.omegaF, c.omegaR, c.omegaR], 'each wheel its axle\'s (sim/groundContact.js)');
  }
  assert.ok(v5['4x4'] > 1.6 * v5.rwd && v5['4x4'] > 1.6 * v5.fwd && v5.awd > 1.6 * v5.rwd, `on mud after 5 s: ${Object.entries(v5).map(([k, v]) => `${k} ${(v * 3.6).toFixed(0)}`).join(', ')} km/h`);
  // handling: round a wet bend (μ 0.5) at 25 km/h, then flat out for 1.5 s (no stability control)
  const wet = ground(0.5);
  const bend = (d) => {
    const c = started({ drivetrain: d, esp: false }, wet);
    run(c, 12, (c) => ({ ...pedals(c, Math.max(0, Math.min(0.3, 0.1 + (7 - c.u) * 0.15)), 0), steer: 0.5 }), wet);
    const k0 = c.wz / c.u, b0 = Math.atan2(c.v, c.u), o0 = c.odo;
    let course = Math.atan2(c.vz, c.vx), turn = 0;
    run(c, 1.5, (c) => {
      const q = Math.atan2(c.vz, c.vx);
      turn += Math.atan2(Math.sin(q - course), Math.cos(q - course));
      course = q;
      return { ...pedals(c, 1, 0), steer: 0.5 };
    }, wet);
    return { k0, k: Math.abs(turn) / (c.odo - o0), dBeta: Math.atan2(c.v, c.u) - b0, yaw: c.wz };
  };
  const R = bend('rwd'), F = bend('fwd');
  assert.ok(F.k < 0.8 * F.k0, `FWD: power through the steered wheels, it runs wide (curvature ${F.k0.toFixed(3)} → ${F.k.toFixed(3)})`);
  assert.ok(R.dBeta > 0.08 && R.dBeta > F.dBeta + 0.05, `RWD: the tail steps out (sideslip +${R.dBeta.toFixed(3)} rad vs FWD +${F.dBeta.toFixed(3)})`);
  assert.ok(R.yaw > 1.2 * F.yaw, `RWD turns in harder (yaw rate ${R.yaw.toFixed(2)} vs ${F.yaw.toFixed(2)} rad/s)`);
});

/* ------------------------------------------------------------------ electric, hybrid */

test('an EV: torque from 0 rpm then constant power, one gear, quick; regenerative braking charges it; flat, it stops', () => {
  const e = started({ powertrain: 'electric' });
  const Mo = e.spec.motor;
  assert.ok(e.running && !e.spec.engine && e.spec.tank === 0 && e.spec.battery.kWh === 60, 'ready: no engine, no tank, a 60 kWh pack');
  assert.ok(e.sfx.some((s) => s.kind === 'ready') && !e.sfx.some((s) => s.kind === 'start'), 'no starter');
  assert.equal(motorTorqueMax(Mo, 10), Mo.tmax, 'full torque from standstill');
  assert.ok(Math.abs(motorTorqueMax(Mo, 1200) * 1200 - Mo.pmax) < 1, 'constant power at speed');
  let t100 = null, T0 = 0;
  run(e, 20, (c, t) => {
    if (t < 0.1) T0 = Math.max(T0, c.motorT);
    if (t100 === null && c.u > 100 / 3.6) t100 = t;
    return { ...pedals(c, 1, 0), steer: 0 };
  });
  assert.ok(T0 > 0.95 * Mo.tmax, `pulls its full ${Mo.tmax.toFixed(0)} N m at once (${T0.toFixed(0)})`);
  assert.ok(t100 > 4 && t100 < 9, `0-100 km/h in ${t100?.toFixed(1)} s`);
  assert.equal(e.gear, 1);
  assert.ok(!e.sfx.some((s) => s.kind === 'shift'), 'no gear changes');
  assert.ok(e.kWhUsed > 0.3 && e.soc < 0.8 && e.range > 50, `used ${e.kWhUsed.toFixed(2)} kWh, ${Math.round(e.range)} km left`);
  // braking from 100: the motor takes it as a generator, the pack charges
  const soc0 = e.soc;
  let fric = 1;
  run(e, 4, (c) => {
    fric = Math.min(fric, 1 - (c.regenF ?? 0) / (0.3 * 1.05 * c.spec.mass * 9.81));
    return { throttle: 0, brake: 0.3, steer: 0 };
  });
  assert.ok(e.soc > soc0 && e.kWhRegen > 0.05, `regenerated ${e.kWhRegen.toFixed(3)} kWh`);
  assert.ok(fric < 0.75, 'at speed the motor takes what its power allows, the friction brakes the rest');
  const g = started({ powertrain: 'electric' });
  run(g, 8, (c) => ({ ...pedals(c, Math.max(0, Math.min(1, (11 - c.u) * 0.5)), 0), steer: 0 }));
  run(g, 1, (c) => ({ throttle: 0, brake: 0.2, steer: 0 }));
  assert.ok(g.regenF > 0.95 * 0.2 * 1.05 * g.spec.mass * 9.81, 'a light stop in town: all regeneration');
  // lifting off: it slows a little more than a coasting engine car
  const q = started({ powertrain: 'electric' });
  run(q, 15, (c) => ({ ...pedals(c, Math.max(0, Math.min(1, (20 - c.u) * 0.5)), 0), steer: 0 }));
  const u0 = q.u;
  run(q, 2, () => ({ throttle: 0, brake: 0, steer: 0 }));
  assert.ok((u0 - q.u) / 2 > 0.4, `lift-off regeneration: ${((u0 - q.u) / 2).toFixed(2)} m/s²`);
  // flat: it stops, and will not start
  const f = started({ powertrain: 'electric', charge: 0.0003 });
  run(f, 5, (c) => ({ ...pedals(c, 1, 0), steer: 0 }));
  assert.ok(!f.running && f.why === 'battery flat' && !hasEnergy(f), f.why);
});

test('a hybrid: away on the battery, the engine starts by itself under load and stops when the charge is back', () => {
  const h = started({ powertrain: 'hybrid', charge: 0.62 });
  assert.ok(h.spec.engine && h.spec.motor && h.spec.battery.kWh === 1.5 && h.spec.tank <= 35, 'a small pack and a small tank');
  assert.ok(!h.ice.on, 'parked: the engine off');
  // gently up to 25 km/h: on electric
  run(h, 8, (c) => ({ ...pedals(c, Math.max(0, Math.min(0.2, (7 - c.u) * 0.2)), 0), steer: 0 }));
  assert.ok(h.u > 5 && !h.ice.on && !h.sfx.some((s) => s.kind === 'iceStart'), 'electric at low speed');
  const fuel0 = h.fuel;
  // flat out: it starts (no starter: the generator spins it up), first making power for the motor, then on the wheels
  const modes = new Set();
  run(h, 10, (c) => {
    modes.add(c.ice.mode);
    return { ...pedals(c, 1, 0), steer: 0 };
  });
  assert.ok(h.sfx.some((s) => s.kind === 'iceStart'), 'the engine started');
  assert.ok(modes.has('series') && modes.has('parallel'), `series, then parallel: ${[...modes]}`);
  assert.ok(h.fuel < fuel0, 'it burns fuel');
  // slow down and stop: the charge comes back (regeneration, the generator), the engine stops
  run(h, 25, (c) => (c.u > 0.5 ? { throttle: 0, brake: 0.25, steer: 0 } : { throttle: 0, brake: 1, steer: 0 }));
  assert.ok(h.sfx.some((s) => s.kind === 'iceStop') && !h.ice.on, `stopped by itself (charge ${(h.soc * 100).toFixed(0)}%)`);
  // low charge, standing: it starts to charge
  const l = started({ powertrain: 'hybrid', charge: 0.2 });
  run(l, 3, () => ({ throttle: 0, brake: 1, steer: 0 }));
  assert.ok(l.ice.on && l.ice.mode === 'series', 'charging at a standstill');
  const s0 = l.soc;
  run(l, 10, () => ({ throttle: 0, brake: 1, steer: 0 }));
  assert.ok(l.soc > s0, 'the charge rising');
});

test('sound by powertrain: an EV whines (its motor\'s electrical orders), switches, warns pedestrians, fires nothing; a hybrid\'s engine heard only when it runs', async () => {
  const { carSoundParams, engineSound, motorSound, carSfxSound, WHINE_ORDER, AVAS_SPEED } = await import('../src/audio/carSound.js');
  const p = started();
  assert.ok(engineSound(p).fire > 0 && motorSound(p).whine === 0, 'petrol: firing, no whine');
  const e = started({ powertrain: 'electric' });
  run(e, 2, (c) => ({ ...pedals(c, 0.4, 0), steer: 0 }));
  const slow = carSoundParams(e, { pos: [e.x, 1, e.z + 5] });
  assert.equal(slow.engine.gain, 0, 'no engine');
  assert.equal(slow.engine.fire0, 0);
  const M = motorSound(e);
  assert.ok(Math.abs(M.elecHz - (e.motorRpm / 60) * e.spec.motor.polePairs) < 1e-9 && Math.abs(M.whineHz - M.elecHz * WHINE_ORDER) < 1e-9, 'the whine: rpm / 60 × pole pairs × its order');
  assert.ok(M.whine > 0 && M.inverter > 0 && M.inverterHz > 2000, 'whine and the inverter\'s tone');
  assert.ok(e.u < AVAS_SPEED && slow.motor.avas > 0, 'below 30 km/h: the pedestrian warning');
  run(e, 12, (c) => ({ ...pedals(c, 1, 0), steer: 0 }));
  const fast = carSoundParams(e, { pos: [e.x, 1, e.z + 5] });
  assert.ok(fast.motor.avas === 0 && fast.motor.whineHz0 > 3 * M.whineHz, `the whine rising with the revs (${M.whineHz.toFixed(0)} → ${fast.motor.whineHz0.toFixed(0)} Hz), AVAS off`);
  assert.ok(fast.roll + fast.wind > fast.motor.whine, 'at speed the tyres and the wind are what you hear');
  // a hybrid: silent engine until it starts, then firing; its start and stop heard
  const h = started({ powertrain: 'hybrid', charge: 0.7 });
  assert.equal(engineSound(h).gain, 0);
  run(h, 3, (c) => ({ ...pedals(c, 1, 0), steer: 0 }));
  assert.ok(h.ice.on && engineSound(h).on, 'its engine heard');
  for (const k of ['iceStart', 'iceStop', 'ready', 'key']) assert.ok(carSfxSound({ kind: k })?.layers.length > 0, k);
});

/* ------------------------------------------------------------------ the battery: thermal runaway */

/** A block of cells (nx × nz, one high) in a bare world. */
function pack(nx = 8, nz = 5, h = 0.15) {
  const w = new World({ size: [3, 1.2, 2], h });
  const cells = [];
  for (let x = 2; x < 2 + nx; x++)
    for (let z = 2; z < 2 + nz; z++) {
      const i = w.idx(x, 2, z);
      w.setVoxel(i, MAT.liion, { density: 0.45, owner: 1 });
      cells.push(i);
    }
  w.rebuildLists();
  return { w, cells, sim: { world: w, stats: {} } };
}

test('battery: one cell in runaway sets off the next, cell by cell through the pack; with no air at all; HF and gas let out', () => {
  const { w, cells, sim } = pack();
  assert.equal(cellsOf(w).length, cells.length);
  const kWh = packState(w).energy / 3.6e6;
  // no air round it: runaway needs none (the cathode gives the oxygen)
  w.o2.fill(0);
  w.crack[cells[0]] = 0.6; // (a shorted cell)
  let first = null, all = null, flames = 0;
  for (let t = 0; t < 3600 && all === null; t += 1) {
    stepBatteries(sim, 1);
    w.time += 1;
    const s = packState(w);
    if (first === null && s.active + s.spent > 1) first = t;
    if (s.fresh === 0 && s.active === 0) all = t;
    for (let a = 0; a < w.NA; a++) flames += w.flameAcc[a];
    w.flameAcc.fill(0);
    w.airQ.fill(0);
  }
  assert.ok(first > 20, `the next cell after ${first} s`);
  assert.ok(all !== null && all > first + 60, `the whole pack (${cells.length} cells, ${kWh.toFixed(1)} kWh) gone in ${all} s`);
  const s = packState(w);
  assert.ok(s.maxT > 500, `the cells at ${s.maxT.toFixed(0)} °C`);
  assert.equal(flames, 0, 'no oxygen: the vented gas does not burn there...');
  assert.ok(s.hf > kWh * 1000 * 60e-6 && s.gas > s.hf * 3, `...but goes as gas: ${s.hf.toFixed(2)} kg HF of ${s.gas.toFixed(2)} kg`);
  assert.ok(w.smoke.reduce((a, b) => a + b, 0) > 0.1, 'thick smoke');
  assert.ok(w.events.some((e) => e.type === 'runaway') && w.events.some((e) => e.type === 'toxicGas'));
  // with air the vent gas burns: a jet flame
  const B = pack(3, 2);
  B.w.crack[B.cells[0]] = 0.6;
  stepBatteries(B.sim, 1);
  let f = 0;
  for (let a = 0; a < B.w.NA; a++) f += B.w.flameAcc[a];
  assert.ok(f > 1e4, `vent flames ${(f / 1e3).toFixed(0)} kW`);
});

test('battery: damage sets cells off (crushed, shot through), and a damaged cell cooled down goes again hours later', () => {
  assert.ok(onsetOf(0) > 150 && onsetOf(0.6) < 20, 'onset falls with damage');
  const A = pack(4, 3);
  const n = crushCells(A.w, A.w.center(...A.w.coords(A.cells[0])), 0.3, 1);
  assert.ok(n >= 1 && A.w.crack[A.cells[0]] > 0.9);
  stepBatteries(A.sim, 1);
  assert.ok(A.w.fuel[A.cells[0]] < FRESH, 'crushed: it goes at once');
  // re-ignition: cells heat-damaged in a fire, cooled down to 20 °C
  const B = pack(3, 2);
  for (const i of B.cells) {
    B.w.crack[i] = 0.25;
    B.w.temp[i] = 20;
  }
  let t = 0;
  for (; t < 8 * 3600 && packState(B.w).fresh === B.cells.length; t += 10) stepBatteries(B.sim, 10);
  assert.ok(t > 3600 && t < 8 * 3600, `went again after ${(t / 3600).toFixed(1)} h`);
});

/** An EV in a small world (its pack under the floor), its fire starting in the battery. */
function evFire(o = {}) {
  const sim = createSimulation({ world: { size: [9, 3, 6], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, objects: [{ type: 'car', params: { powertrain: 'electric', igniteAt: 'battery', ...o.params }, x: 4.5, z: 3, rotation: 0, ignite: o.ignite ?? true }] });
  return { sim, w: sim.world, c: initCars(sim.world)[0] };
}

test('an EV\'s pack fire is hard to put out: a bucketful does not stop a cell going, nor the spread; thousands of litres keep it in check', () => {
  const runFor = (water) => {
    const { sim, w, c } = evFire();
    assert.ok(packState(w).n > 30 && packState(w).energy / 3.6e6 > 50, 'a 60 kWh pack');
    assert.equal(w.vessels.length, 0, 'no fuel tank');
    let goingAfterDouse = false;
    for (let t = 0; t < 660; t += 0.5) {
      water(sim, c, t);
      sim.step(0.5);
      if (t > 22 && t < 30 && packState(w).active > 0) goingAfterDouse = true;
    }
    return { s: packState(w), goingAfterDouse };
  };
  // 20 litres at once while the first cell is going (enough for a car seat on fire)
  const bucket = runFor((sim, c, t) => t === 20 && sim.douse([c.x, c.y + 0.3, c.z], 1.6, 20));
  assert.ok(bucket.goingAfterDouse, 'the cell went on after the water');
  assert.ok(bucket.s.spent > bucket.s.n * 0.3, `spread on: ${bucket.s.spent} of ${bucket.s.n} cells gone in 11 min`);
  // 5 l/s from 20 s on (3 000 l): the rest of the pack kept under its onset
  const hose = runFor((sim, c, t) => t >= 20 && sim.douse([c.x, c.y + 0.3, c.z], 1.6, 2.5));
  assert.ok(hose.s.fresh > hose.s.n * 0.8, `held: ${hose.s.fresh} of ${hose.s.n} cells left`);
});

test('a round through an EV\'s floor pan into its pack sets cells off; the pack burnt, the car is dead', () => {
  const { sim, w, c } = evFire({ ignite: false });
  const L = c.spec.L;
  assert.ok(c.spec.powertrain === 'electric' && packState(w).fresh === packState(w).n);
  // from beside it, low, straight at the pack under the floor
  const y = w.h * 1.5 + 0.06;
  const r = shoot(sim, [c.x - 0.1 * L, y, c.z - 2.5], [0, 0, 1]);
  assert.ok(r?.cells > 0, 'the round went into the cells');
  for (let t = 0; t < 5; t += 0.5) sim.step(0.5);
  assert.ok(packState(w).active + packState(w).spent > 0, 'a cell in runaway');
  // a car whose pack is gone: dead
  boardCar(c, { player: true, mass: 85 }, 0);
  for (const i of cellsOf(w)) w.fuel[i] = 0;
  c.body = null;
  stepCarList([c], 0.02, { world: w, sim });
  c.checkT = 0;
  ensureBody(w, c);
  checkState(w, c);
  assert.ok(c.dead && c.soc === 0, c.why);
});

/* ------------------------------------------------------------------ the steering wheel, the driver */

test('the steering wheel turns with the road wheels × the ratio (~15:1, ~2.7 turns lock to lock); the driver\'s hands go round with it', async () => {
  const c = started();
  const S = c.spec;
  const turns = lockToLock(S);
  assert.ok(turns > 2.5 && turns < 3, `${turns.toFixed(2)} turns lock to lock`);
  assert.ok(lockToLock(carSpec({ length: 5.5, width: 2.2, height: 2 })) > 2.5, 'a truck too');
  run(c, 2, () => ({ throttle: 0, brake: 1, steer: 1 }));
  assert.ok(Math.abs(c.wheelAngle - S.maxSteer * 15) < 0.01 && Math.abs(steeringWheelAngle(c) - c.wheelAngle) < 1e-9, `full left: ${(c.wheelAngle / (2 * Math.PI)).toFixed(2)} turns`);
  run(c, 1, () => ({ throttle: 0, brake: 1, steer: -0.5 }));
  assert.ok(Math.abs(c.wheelAngle + S.maxSteer * 15 * 0.5) < 0.01, 'half right');
  assert.ok(Math.abs(wheelPhase(0) - 0.5) < 1e-9 && wheelPhase(WHEEL_PHASE_RANGE) === 1);
  // the hands: at 9 and 3 straight ahead; turned left (anticlockwise as he sees it) the left hand goes down, the right up
  const p0 = carClipPose('carDrive', wheelPhase(0)), pl = carClipPose('carDrive', wheelPhase(1));
  assert.ok(p0.lTW[0] > 0.15 && p0.rTW[0] < -0.15 && Math.abs(p0.lTW[1] - p0.rTW[1]) < 1e-9, 'at 9 and 3');
  assert.ok(pl.lTW[1] < p0.lTW[1] - 0.1 && pl.rTW[1] > p0.rTW[1] + 0.1, 'round with the rim');
  assert.ok(operatorClips().carDrive && operatorClips().carSit && LABELS.carDrive);
  // an AI driver in his seat: the drive clip at the wheel's phase; a passenger seated
  const k = newCar({}, { x: 0, y: 0, z: 0 });
  const d = { name: 'driver' }, q = { name: 'passenger' };
  boardCar(k, d, 'drive');
  boardCar(k, q);
  k.steer = 0.3;
  k.wheelAngle = steeringWheelAngle(k);
  placeAboard(k);
  assert.equal(d.anim, 'carDrive');
  assert.ok(Math.abs(d.animPhase - wheelPhase(k.wheelAngle)) < 1e-9);
  assert.equal(q.anim, 'carSit');
  assert.equal(q.animPhase, null);
});

/** The operator's assets as stand-ins (no sculpting in Node), as test/boatCrew.test.js has them. */
function assets() {
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  const g = () => {
    const o = new THREE.Group();
    o.add(new THREE.Mesh(geo(), mat));
    return o;
  };
  return Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null, drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(),
    torchGun: g(), torchTanks: g(), nozzle: new THREE.Vector3(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips: operatorClips(),
  }, weaponKit());
}

test('drawn: the steering wheel in the cab turned to its angle, you at it (from outside), your hands on its rim', async () => {
  const { CarRenderer } = await import('../src/render/cars.js');
  const c = newCar({}, { x: 3, y: 0.2, z: 4, yaw: 0.4 });
  const me = { player: true, mass: 85 }, mate = { name: 'mate', mass: 80 };
  boardCar(c, me, 'drive');
  boardCar(c, mate);
  const w = { cars: [c], enemies: [] };
  const parent = new THREE.Group();
  const R = new CarRenderer(parent, { assets: assets() });
  R.setWorld(w);
  const cam = new THREE.Object3D();
  cam.position.set(c.x - 8, 3, c.z);
  cam.updateMatrixWorld();
  for (const th of [0, 1.2, -0.9]) {
    c.wheelAngle = th;
    R.update(1 / 30, cam);
    parent.updateMatrixWorld(true);
    const sw = R.wheels.get(c);
    assert.ok(sw && Math.abs(sw.spin.rotation.z - th) < 1e-9, 'the wheel turned');
    assert.equal(R.figures.size, 2, 'you and your mate');
    const mine = [...R.figures.values()].find((it) => it.who === me).fig;
    assert.equal(mine.shown, 'carDrive');
    const other = [...R.figures.values()].find((it) => it.who === mate).fig;
    assert.equal(other.shown, 'carSit');
    // his left hand's target (figure space) is the rim's 9 o'clock carried round by the wheel
    const hand = mine.group.localToWorld(new THREE.Vector3(...wheelHands(th).l));
    const rim = sw.spin.localToWorld(new THREE.Vector3(-CAR_WHEEL.r, 0, 0));
    assert.ok(hand.distanceTo(rim) < 0.02, `hand on the rim at ${th} rad (${(hand.distanceTo(rim) * 100).toFixed(1)} cm off)`);
  }
  R.clear();
  assert.equal(parent.children[0].children.length, 0);
});
