import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { GATE_AT } from '../src/campIsland.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { initCars, boardCar, stepCars } from '../src/sim/cars.js';
import { setMode, startEngine } from '../src/sim/carPhysics.js';
import { driveTo, navGrid, planPath } from '../src/ai/carDriver.js';
import { initGates, stepGates, requestGate, gateSide, gatePassable, smashGate } from '../src/sim/gates.js';
import { CarDrive } from '../src/walk/carDrive.js';

const LONG = { timeout: 10 * 60 * 1000 };

/** The camp island (the military base, its gate, its vehicle park), the jeep and the gate. */
function camp() {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'camp' });
  const w = sim.world;
  const cars = initCars(w);
  const [g] = initGates(w);
  return { sim, w, cars, jeep: cars[0], g };
}
/** The gates and the cars only (the fire, the air, the men's AI not stepped: quicker), T s or until fn(). */
function run(sim, T, until = () => false, dt = 1 / 30) {
  const w = sim.world;
  let t = 0;
  for (; t < T && !until(t); t += dt) {
    stepGates(sim, dt);
    stepCars(sim, dt);
    w.time += dt;
  }
  return t;
}
const radios = (w, from = 0) => w.events.slice(from).filter((e) => e.type === 'radio').map((e) => e.name);
const ordered = (log, keys) => {
  let i = -1;
  for (const k of keys) {
    const j = log.findIndex((s, n) => n > i && s.startsWith(k));
    if (j < 0) return `${k} missing after #${i}: ${log.join(' | ')}`;
    i = j;
  }
  return null;
};

test('the gate: a barrier run as a thing (its door, its arm, the road through it), passable-with-request on the route grid', LONG, () => {
  const { w, jeep, g } = camp();
  assert.equal(w.gates.length, 1);
  assert.equal(g.state, 'closed');
  assert.equal(g.unit, 'Lima');
  assert.equal(g.side, 'red', "the sentries' side");
  assert.ok(Math.abs(g.center[0] - GATE_AT[0]) < 0.6 && Math.abs(g.center[2] - GATE_AT[1]) < 0.6);
  assert.ok(g.n[0] > 0.99, 'out of the base: +x');
  assert.ok(gateSide(g, [jeep.x, 0, jeep.z]) < 0, 'the vehicle park inside');
  assert.equal(jeep.side, 'red', "the base's jeep");
  // the route grid: the arm is not a wall on it; a closed gate costs, so a way out goes through it
  const G = navGrid(w);
  assert.ok(G.gate.some((v) => v), 'gate cells');
  const out = [GATE_AT[0] + 4.5, 0, GATE_AT[1] + 14];
  const path = planPath(G, [jeep.x, jeep.y, jeep.z], out, { gates: w.gates });
  assert.ok(path && Math.hypot(path.at(-1)[0] - out[0], path.at(-1)[2] - out[2]) < 2, 'a way out');
  assert.ok(path.some((p) => p[0] > GATE_AT[0] + 1) && path.some((p) => p[0] < GATE_AT[0] - 1), 'through the gate');
  // avoided (refused): no way out at all
  const none = planPath(G, [jeep.x, jeep.y, jeep.z], out, { gates: w.gates, avoid: new Set([0]) });
  assert.ok(!none || Math.hypot(none.at(-1)[0] - out[0], none.at(-1)[2] - out[2]) > 3, 'walled in without it');
});

test('an AI jeep in the vehicle park drives out through the gate: stops short, radios base, a sentry raises it, through, "close the gate", it closes', LONG, () => {
  const { sim, w, jeep, g } = camp();
  const driver = { mass: 80, p: [0, 0, 0], unit: 'Kilo', squad: 'CMD' };
  boardCar(jeep, driver, 0);
  const target = [GATE_AT[0] + 4.5, 0, GATE_AT[1] + 14];
  const steps = [];
  driveTo(jeep, target, { speed: 8, callsign: 'Kilo', log: (s) => steps.push(s) });
  const ev0 = w.events.length;
  const sentries = w.enemies.filter((e) => e.unit === 'Lima');
  const s0 = sentries.map((m) => m.p.slice());
  let minBefore = Infinity, waitedAt = null, sentryMoved = 0;
  run(sim, 70, () => {
    const s = gateSide(g, [jeep.x, 0, jeep.z]);
    if (g.state === 'closed' && jeep.drive.log.includes('gate:request') && s < 0) {
      minBefore = Math.min(minBefore, -s);
      if (Math.abs(jeep.u) < 0.2 && jeep.drive.log.includes('gate:wait')) waitedAt ??= -s;
    }
    sentryMoved = Math.max(sentryMoved, ...sentries.map((m, k) => Math.hypot(m.p[0] - s0[k][0], m.p[2] - s0[k][2])));
    return jeep.drive.done && g.state === 'closed' && jeep.drive.log.includes('gate:through');
  });
  const D = jeep.drive;
  assert.ok(D.done && !D.failed, `got there: ${D.log.join(' | ')}`);
  assert.ok(gateSide(g, [jeep.x, 0, jeep.z]) > jeep.spec.L / 2, `outside the gate (${jeep.x.toFixed(1)}, ${jeep.z.toFixed(1)})`);
  assert.equal(ordered(D.log, ['gate:request', 'gate:granted', 'gate:wait', 'gate:open', 'gate:through']), null);
  assert.ok(steps.includes('gate:request') && steps.includes('gate:through:Kilo'), `told its squad: ${steps}`);
  // stopped short of the closed arm, waited there
  assert.ok(waitedAt != null && waitedAt > jeep.spec.L / 2 + 1 && waitedAt < jeep.spec.L / 2 + 6, `waited ${waitedAt?.toFixed(1)} m from the arm`);
  assert.ok(minBefore > jeep.spec.L / 2 + 0.5, 'never at the arm while it was down');
  // the gate's own log: the request, granted, a sentry to the control, up, through, down again
  assert.equal(ordered(g.log, ['gate:request:Kilo', 'gate:granted:Kilo', 'gate:sentry:', 'gate:opening:sentry', 'gate:open', 'gate:through:Kilo', 'gate:closing', 'gate:closed', 'gate:sentry:back']), null);
  assert.ok(sentryMoved > 2, `a sentry walked to the control (${sentryMoved.toFixed(1)} m)`);
  assert.ok(!sentries.some((m) => m.gateTask), 'and is his squad\'s again');
  // on the radio
  const R = radios(w, ev0);
  for (const say of ['Base, Kilo, at the gate, request gate open, over.', 'Kilo, Base, roger, opening the gate.', 'Kilo, Base, gate is open, come through.', 'Base, Kilo, through, close the gate, over.', 'Kilo, Base, roger, closing the gate.']) assert.ok(R.includes(say), `"${say}" in ${R.join(' / ')}`);
  // closed: its voxels back across the road
  const d = w.doors[g.door];
  assert.ok(!d.open && d.voxels.every((i) => w.doorTag[i] === g.door + 1 && w.mat[i]), 'the arm back in the grid');
  assert.ok(jeep.damage < 0.05, `no harm done (${jeep.damage})`);
});

test('refused (lockdown): the driver waits by the closed gate and calls again (no other way out); in an emergency it rams it', LONG, () => {
  const { sim, w, jeep, g } = camp();
  g.lockdown = true;
  boardCar(jeep, { mass: 80, p: [0, 0, 0], unit: 'Kilo', squad: 'CMD' }, 0);
  const target = [GATE_AT[0] + 4.5, 0, GATE_AT[1] + 14];
  driveTo(jeep, target, { speed: 8, callsign: 'Kilo' });
  run(sim, 32);
  const D = jeep.drive;
  assert.equal(ordered(D.log, ['gate:request', 'gate:denied', 'gate:no-other-way', 'gate:request:again']), null);
  assert.ok(g.log.some((s) => s === 'gate:denied:Kilo:lockdown'));
  assert.ok(radios(w).some((s) => /negative, the base is in lockdown/.test(s)));
  assert.equal(g.state, 'closed');
  assert.ok(gateSide(g, [jeep.x, 0, jeep.z]) < -jeep.spec.L / 2 - 1, 'still inside, short of the arm');
  assert.ok(Math.abs(jeep.u) < 0.3 && !D.done, 'waiting');
  // the same, falling back under fire: through the arm
  driveTo(jeep, target, { speed: 8, callsign: 'Kilo', urgent: true });
  run(sim, 40, () => jeep.drive.done);
  assert.equal(ordered(jeep.drive.log, ['gate:request', 'gate:denied', 'gate:ram', 'gate:rammed']), null);
  assert.equal(g.state, 'broken');
  assert.ok(g.log.some((s) => s.startsWith('gate:broken:rammed')));
  assert.ok(radios(w).some((s) => /ramming the gate/.test(s)));
  assert.ok(jeep.drive.done && gateSide(g, [jeep.x, 0, jeep.z]) > 0, `through (${jeep.drive.log.join(' | ')})`);
  assert.ok(w.events.some((e) => e.type === 'gateBroken'));
  // broken: open for good, no call needed
  assert.ok(gatePassable(g));
  assert.equal(requestGate(w, g, { car: jeep, callsign: 'Kilo' }).answer, null);
  run(sim, 2);
  assert.equal(g.queue.at(-1)?.answer ?? 'granted', 'granted');
});

test('refused at one gate, the driver takes another way round (a gap further along the wall); unmanned, no answer', LONG, () => {
  const h = 0.5;
  // a wall across the field at x = 30: the gate (a guard post, no sentries: the base raises it remotely) at z = 20, a gap at z 48..56
  const sim = createSimulation({
    world: { size: [60, 8, 60], h }, weather: { ambient: 15, windSpeed: 0 },
    objects: [
      { type: 'road', params: { length: 56, width: 6, posts: false }, x: 30, z: 20, y: h },
      { type: 'guardPost', params: { roadWidth: 6, unit: 'none', lockdown: true }, x: 30, z: 20, y: h },
      { type: 'blastWall', params: { length: 16.5 }, x: 30, z: 8.25, y: h, rotation: 90 },
      { type: 'blastWall', params: { length: 24.5 }, x: 30, z: 35.75, y: h, rotation: 90 },
      { type: 'car', params: {}, x: 8, z: 20, y: 'auto', rotation: 0 },
    ],
  });
  const w = sim.world;
  const c = initCars(w)[0];
  const [g] = initGates(w);
  assert.ok(g && g.remote && !g.unit);
  boardCar(c, { mass: 80, p: [0, 0, 0], unit: 'Alpha', squad: 'CMD' }, 0);
  driveTo(c, [50, 0, 20], { speed: 8, callsign: 'Alpha' });
  run(sim, 90, () => c.drive.done);
  const D = c.drive;
  assert.equal(ordered(D.log, ['gate:request', 'gate:denied', 'gate:reroute']), null);
  assert.ok(radios(w).some((s) => /taking another way/.test(s)));
  assert.ok(D.done && Math.hypot(c.x - 50, c.z - 20) < 4, `there the long way (${c.x.toFixed(1)}, ${c.z.toFixed(1)}): ${D.log.join(' | ')}`);
  assert.equal(g.state, 'closed', 'the gate stayed shut');
  // no one to answer (no sentry, no remote): silence; it says so
  g.lockdown = false;
  g.remote = false;
  const r = requestGate(w, g, { car: c, callsign: 'Alpha', side: 'red' });
  run(sim, 10);
  assert.equal(r.answer, 'none');
  assert.ok(g.log.includes('gate:no-answer:Alpha'));
  assert.equal(g.state, 'closed');
});

test('you at the wheel: the closed barrier stops the car; G radios base, it goes up, you drive through, it comes down behind you', LONG, () => {
  // a base's gate on its own (a guard post in a wall, two sentries, Lima, by the booth) and a jeep of
  // theirs on the road inside it, its nose to the barrier
  const h = 0.5;
  const sim = createSimulation({
    world: { size: [50, 8, 30], h }, weather: { ambient: 15, windSpeed: 0 },
    objects: [
      { type: 'road', params: { length: 46, width: 6, posts: false }, x: 25, z: 15, y: h },
      { type: 'guardPost', params: { roadWidth: 6 }, x: 30, z: 15, y: h },
      { type: 'blastWall', params: { length: 11.5 }, x: 30, z: 5.75, y: h, rotation: 90 },
      { type: 'blastWall', params: { length: 11.5 }, x: 30, z: 24.25, y: h, rotation: 90 },
      { type: 'campPatrol', params: { count: 2, radius: 1.5, corners: 4, unit: 'Lima' }, x: 24, z: 9.4, y: h },
      { type: 'car', params: { length: 4.4, width: 1.9, height: 1.9, bodyColor: '#4b5320', fuelLiters: 60 }, x: 14, z: 15.25, y: 'auto', rotation: 0 },
    ],
  });
  const w = sim.world;
  const jeep = initCars(w)[0];
  const [g] = initGates(w);
  assert.equal(jeep.side, g.side, "the base's jeep");
  boardCar(jeep, { player: true, mass: 85 }, 0);
  jeep.player = true;
  startEngine(jeep);
  // straight at the arm (the road's line), at a crawl
  const aim = (c, v) => {
    const want = Math.atan2(-(g.center[2] + 0 - c.z), g.center[0] + 20 - c.x);
    let e = want - c.yaw;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    const dv = v - c.u;
    setMode(c, 'D');
    if (v <= 0) return { throttle: 0, brake: 1, steer: 0, handbrake: false };
    return { throttle: Math.max(0, Math.min(1, 0.25 + dv * 0.5)), brake: dv < -0.5 ? Math.min(1, -dv * 0.5) : 0, steer: Math.max(-1, Math.min(1, e * 3)), handbrake: false };
  };
  const drive = (T, v, until) => {
    let t = 0;
    for (; t < T && !until?.(); t += 1 / 30) {
      jeep.input = aim(jeep, v);
      stepGates(sim, 1 / 30);
      stepCars(sim, 1 / 30);
      w.time += 1 / 30;
    }
    return t;
  };
  drive(12, 3);
  const front = jeep.x + jeep.spec.L / 2 * Math.cos(jeep.yaw);
  assert.equal(g.state, 'closed');
  assert.ok(front < g.box.min[0] + 0.3 && front > g.box.min[0] - 1, `stopped at the barrier (front ${front.toFixed(2)}, arm at ${g.box.min[0]})`);
  assert.ok(Math.abs(jeep.u) < 0.5, 'held there');
  assert.ok(gateSide(g, [jeep.x, 0, jeep.z]) < 0, 'not through it');
  // G: the radio (as walk/carDrive.js does it)
  const said = [];
  const me = { sim, c: jeep, walk: { say: (s) => said.push(s) }, seenEvents: w.events.length };
  CarDrive.prototype.radioGate.call(me);
  assert.ok(me.gateReq && me.gateReq.player);
  drive(12, 0, () => g.state === 'open');
  CarDrive.prototype.radioLines.call(me);
  assert.equal(me.gateReq.answer, 'granted');
  assert.equal(g.state, 'open');
  assert.ok(said.some((s) => /request gate open/.test(s)) && said.some((s) => /roger, opening the gate/.test(s)), said.join(' / '));
  assert.ok(/^Jeep/.test(me.gateReq.callsign), me.gateReq.callsign);
  // through it, and it comes down behind you (no call needed: they see you through)
  drive(15, 3, () => g.state === 'closed' && gateSide(g, [jeep.x, 0, jeep.z]) > 4);
  assert.ok(gateSide(g, [jeep.x, 0, jeep.z]) > jeep.spec.L / 2, `through (${jeep.x.toFixed(1)})`);
  run(sim, 6, () => g.state === 'closed');
  assert.equal(g.state, 'closed', g.log.join(' | '));
  assert.equal(ordered(g.log, ['gate:request:Jeep', 'gate:granted', 'gate:opening', 'gate:open', 'gate:through', 'gate:closing', 'gate:closed']), null);
});

test('a hostile vehicle at the gate: refused, the sentries react (their teams put on to it); a smashed arm is open for good', LONG, () => {
  const { sim, w, cars, g } = camp();
  // the squads made (one frame of the whole simulation): the base's teams
  for (let k = 0; k < 3; k++) sim.step(0.05);
  assert.ok(sim.squads?.some((s) => s.unit === 'Lima'));
  const truck = cars[1];
  boardCar(truck, { mass: 80, p: [0, 0, 0], unit: 'Bravo', squad: 'CMD', side: 'blue' }, 0);
  const r = requestGate(w, g, { car: truck, callsign: 'Bravo' });
  run(sim, 3);
  assert.equal(r.answer, 'denied');
  assert.ok(r.hostile && g.log.some((s) => s.startsWith('gate:hostile')));
  assert.ok(radios(w).some((s) => /Unidentified vehicle at the gate/.test(s)));
  const lima = sim.squads.find((s) => s.unit === 'Lima');
  assert.ok(lima.threat && Math.hypot(lima.threat[0] - truck.x, lima.threat[2] - truck.z) < 1, 'the sentries on to it');
  assert.equal(g.state, 'closed');
  // a car not theirs, you at its wheel: refused too
  const street = { ...truck, id: 'car-x', side: undefined, player: true, seats: [{ drive: true, who: { player: true } }] };
  const r2 = requestGate(w, g, { car: street, player: true, callsign: 'Car' });
  run(sim, 3);
  assert.equal(r2.answer, 'denied');
  // blown away while down: broken (passable, the route grid redone there)
  navGrid(w);
  smashGate(w, g);
  assert.equal(g.state, 'broken');
  assert.ok(w.navDirty.length > 0);
  navGrid(w);
  assert.equal(w.navDirty.length, 0, 'the grid redone where it fell');
});

test('the arm drawn as it swings (render/gates.js): out of the grid and turned up while it goes up; down again, its voxels', async () => {
  const THREE = await import('three');
  const { GateRenderer } = await import('../src/render/gates.js');
  const g = { ready: true, state: 'opening', t: 0.5, pivot: [10, 1, 7], tip: [10, 1, 1] };
  const R = new GateRenderer(new THREE.Group());
  R.setWorld({ gates: [g] });
  R.update();
  const m = R.items.get(g);
  assert.ok(m && m.group.children.length >= 2, 'its red and white segments');
  // its +x along the arm (towards the tip: -z), turned up by half its swing
  const dir = new THREE.Vector3(1, 0, 0).applyEuler(m.group.rotation);
  assert.ok(dir.z < -0.4 && dir.y > 0.4, `along the road's width, raised (${dir.toArray().map((v) => v.toFixed(2))})`);
  g.t = 1;
  g.state = 'open';
  R.update();
  assert.ok(new THREE.Vector3(1, 0, 0).applyEuler(m.group.rotation).y > 0.95, 'up');
  g.state = 'closed';
  g.t = 0;
  R.update();
  assert.ok(!R.items.has(g), 'down: its voxels are drawn');
});
