import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { Helicopter } from '../src/ai/helicopter.js';
import { vehicleOf, findVehicles, freeSeats, assignSeats, worldVehicles } from '../src/ai/vehicles.js';
import { vehicleForRetreat } from '../src/ai/squadVehicle.js';

/** A flat range (solid below 0), no walls: sight everywhere. */
const solid = (x, y) => y < 0;
const lineOfSight = () => true;
const ROLES = [['CMD', -2, 0], ['R1', -0.7, 0.4], ['MG', 0.7, 0.2], ['R2', 2, 0.5]];
const near = (a, b, r) => Math.hypot(a[0] - b[0], a[2] - b[2]) < r;

/** A team (unit, at), the enemy at (0, -14) for the first; all: the shared men; log: radio and shouts. */
function team(o = {}) {
  const unit = o.unit ?? 'Alpha', at = o.at ?? [0, 0, 0];
  const all = o.all ?? [];
  const ms = ROLES.map(([r, x, z]) => ({ p: [at[0] + x, 0, at[2] + z], yaw: Math.PI, squad: r, unit, health: 100, mag: 30, mags: 5, skill: 'regular' }));
  all.push(...ms);
  const foes = o.foes ?? [{ p: [0, 0, -14] }];
  const log = o.log ?? [];
  const shots = new Map();
  const sq = new SquadAI({
    unit, members: () => all, solid, lineOfSight, seed: o.seed ?? 3,
    floor: () => 0,
    bounds: o.bounds ?? [-20, -20, 20, 30], threat: o.threat === undefined ? [0, 0, -14] : o.threat, hostiles: () => foes,
    radio: (m, text) => log.push(`${unit} radio: ${text}`),
    shout: (m, t) => log.push(`${unit} ${m.squad}: ${t}`),
    fire: (m) => shots.set(m, (shots.get(m) ?? 0) + 1),
    vehicles: () => o.vehicles ?? [],
    retreat: { order: false, ...(o.retreat ?? {}) },
    ...(o.host ?? {}),
  });
  return { sq, ms, log, foes, all, shots };
}
const veh = (sq) => sq.vehicleLog ?? [];
const at = (L, re) => L.findIndex((l) => re.test(l));

test('the adapter: a helicopter, a boat and a car, their seats, who drives, boarding and leaving', () => {
  const h = new Helicopter({ p: [0, 0, 0], airborne: false, autoStart: false, soldiers: 6 }, { world: { time: 0, events: [], noises: [], enemies: [], ropes: [] } });
  h.crew = h.crew.filter((e) => e.role === 'pilot' || e.role === 'copilot');
  const H = vehicleOf(h);
  assert.equal(H.kind, 'helicopter');
  assert.equal(vehicleOf(h), H, 'one adapter per vehicle');
  assert.ok(H.usable() && H.stationary());
  assert.equal(freeSeats(H).length, 6, 'the back is empty: two door guns and four on the benches');
  assert.ok(freeSeats(H).some((s) => s.shoot && s.role === 'gunner'));
  assert.equal(H.driver()?.role, 'pilot', 'its own pilot flies it');
  assert.equal(H.needsDriver(), false);
  const man = { p: [5, 0, 5], squad: 'R1', unit: 'Alpha', health: 100 };
  H.board(man, freeSeats(H)[0].i);
  assert.ok(H.holds(man) && man.guardCtl && freeSeats(H).length === 5);
  H.leave(man);
  assert.ok(!H.holds(man) && !man.guardCtl && freeSeats(H).length === 6);

  const boat = { kind: 'boat', p: [10, 0, 0], yaw: 0, params: { length: 4.3, beam: 1.45, thwarts: 3 } };
  const B = vehicleOf(boat);
  assert.equal(B.kind, 'boat');
  assert.equal(B.seats.filter((s) => s.drive).length, 1, 'one rower');
  assert.ok(B.needsDriver() && !B.driver());
  assert.ok(B.seats.filter((s) => s.shoot).length >= 4, 'an open boat: they can fire over the side');
  const men = [0, 1, 2].map((i) => ({ p: [0, 0, i], squad: ['CMD', 'R1', 'R2'][i] }));
  const S = assignSeats(B, men);
  assert.equal(B.seats[S.get(men[1])].drive, true, 'the man before the last rows');
  assert.ok(B.seats[S.get(men[0])].shoot, 'the first in can shoot');
  B.board(men[1], S.get(men[1]));
  assert.equal(B.driver(), men[1]);
  B.go([30, 0, 0]);
  for (let t = 0; t < 30 && B.moving(); t += 0.1) B.step(0.1);
  assert.ok(B.arrived() && near(boat.p, [30, 0, 0], 3), `rowed there (${boat.p})`);
  assert.ok(near(men[1].p, boat.p, 2), 'the rower went with it');

  const car = { type: 'car', p: [0, 0, 20], yaw: 0 };
  const C = vehicleOf(car);
  assert.equal(C.kind, 'car');
  assert.equal(C.seats.length, 4);
  assert.ok(!C.seats.some((s) => s.shoot), 'a closed car: no one fires out of it');
  assert.equal(assignSeats(C, [1, 2, 3, 4, 5].map((i) => ({ p: [0, 0, i] }))), null, 'five do not fit');
  // a world's vehicles
  assert.equal(worldVehicles({ helis: [{ ai: h }], floats: [boat], vehicles: [car, { type: 'jet' }] }).length, 3);
  const { sq } = team({ vehicles: [h, boat] });
  assert.deepEqual(findVehicles(sq).map((v) => v.kind), ['helicopter', 'boat']);
});

test('retreat to a boat: peel back to it, the wounded man lifted in first, one by one under guard and cover from inside, then rowed off', () => {
  const boat = { kind: 'boat', p: [0, 0, 14], yaw: 0, params: { length: 4.3, beam: 1.45, thwarts: 3 } };
  const { sq, ms, log } = team({ vehicles: [boat], retreat: { order: true, casualties: 'carry' }, host: { din: () => 65 } });
  const cas = ms[1];
  cas.health = 25;
  let guarded = 0, unguarded = 0, maxIn = 0, boarding = 0;
  for (let t = 0; t < 260 && !(sq.strategy?.phase === 'done' && !sq.board); t += 0.05) {
    sq.step(0.05);
    const B = sq.board;
    if (B && (B.phase === 'board' || B.phase === 'last') && B.cur) {
      boarding++;
      // one at a time: only the man (or the lifter and the man he lifts) at the door
      maxIn = Math.max(maxIn, ms.filter((m) => ['board', 'carry', 'fetch'].includes(m.vehTask?.kind)).length);
      // the others outside, not yet in: at their posts round it, or none left
      const outside = ms.filter((m) => !m.dead && !m.down && !m.inVehicle && !B.cur.men.includes(m) && m.vehTask?.kind !== 'post');
      if (outside.length) outside.some((m) => near(m.p, B.slots.get(m) ?? m.p, 1.5)) ? guarded++ : unguarded++;
    }
  }
  const L = veh(sq);
  assert.ok(sq.retreatLog.some((l) => /^retreat:vehicle:boat:/.test(l)), sq.retreatLog.join(' | '));
  assert.ok(log.some((l) => /To the boat!/.test(l)), 'the leader names the boat');
  // the order of things
  const iSig = at(L, /^vehicle:signal:boat/), iB1 = at(L, /^vehicle:board:/), iLast = at(L, /^vehicle:last:/), iDep = at(L, /^vehicle:depart:boat/), iArr = at(L, /^vehicle:arrive:boat/);
  assert.ok(iSig >= 0 && iSig < iB1 && iB1 < iLast && iLast < iDep && iDep < iArr, L.join(' | '));
  assert.ok(log.some((l) => /Mount up! Into the boat! Wounded first!/.test(l)), log.join(' | '));
  assert.ok(L.filter((l) => /^vehicle:ack:/.test(l)).length >= 2, 'acknowledged');
  // the wounded man first, lifted in
  assert.equal(L[iB1], `vehicle:board:${cas.squad}:${sq.lastBoard.V.seats[sq.lastBoard.seats.get(cas)].label}`);
  assert.ok(L.includes(`vehicle:wounded:${cas.squad}`));
  assert.equal(sq.lastBoard.V.seats[sq.lastBoard.seats.get(cas)].shoot, false, 'he lies where he need not fight');
  // one at a time, the rest guarding
  assert.equal(L.filter((l) => /^vehicle:board:/.test(l)).length, 4, 'all four aboard');
  assert.ok(maxIn <= 2, `one at a time (${maxIn})`);
  assert.ok(boarding > 20 && guarded > unguarded * 4, `guards at their posts (${guarded} / ${unguarded})`);
  // covered from inside before the last man got in
  const iCov = at(L, /^vehicle:cover:/);
  assert.ok(iCov >= 0 && iCov < iLast, 'the first in fired over the side for the last');
  assert.ok(sq.lastBoard.shots > 0);
  // a rower among them, and off it went, away from the enemy
  assert.ok(/^vehicle:depart:boat:(CMD|MG|R1|R2)$/.test(L[iDep]), L[iDep]);
  assert.ok(boat.p[2] > 50, `rowed away from the threat (${boat.p.map((v) => v.toFixed(1))})`);
  assert.equal(sq.strategy.phase, 'done');
  assert.ok(!sq.retreating);
  for (const m of ms) assert.ok(!m.vehTask && !m.inVehicle && near(m.p, boat.p, 4), `${m.squad} ashore by the boat (${m.p.map((v) => v.toFixed(1))})`);
  assert.ok(log.some((l) => /clear of the contact by boat/.test(l)), log.join(' | '));
});

test('a retreat with no vehicle that takes them all falls back on foot, and says why not', () => {
  const car = { type: 'car', p: [0, 0, 12], yaw: 0 };
  const { sq } = team({ vehicles: [car], retreat: { order: true } });
  const ms5 = [...sq.members(), { p: [0, 0, 1], squad: 'R1', unit: 'Alpha', health: 100 }];
  assert.equal(vehicleForRetreat(sq, ms5, [0, 0, -14]), null);
  assert.ok(sq.vehicleLog.some((l) => /retreat:vehicle:skip:car:4 seats for 5/.test(l)), sq.vehicleLog.join(' | '));
  // towards the threat: not that one
  const { sq: s2 } = team({ vehicles: [{ type: 'car', p: [0, 0, -12], yaw: 0 }] });
  assert.equal(vehicleForRetreat(s2, s2.members(), [0, 0, -14]), null);
  assert.ok(s2.vehicleLog.some((l) => /towards the threat/.test(l)));
  // never, by the params
  assert.equal(vehicleForRetreat(s2, s2.members(), [0, 0, -14], { vehicle: false }), null);
});

test('backup by helicopter: the signaller calls them in, one by one into their seats, the signaller last, the pilot flies them to the team that called', () => {
  const all = [], log = [];
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const h = new Helicopter({ p: [6, 0, 104], yaw: 0, airborne: false, autoStart: false, soldiers: 6, seed: 3 }, { world, ground: () => 0 });
  h.crew = h.crew.filter((e) => e.role === 'pilot' || e.role === 'copilot');
  const A = team({ all, log, retreat: { order: true }, host: { din: () => 65 } });
  const Bv = team({ all, log, unit: 'Bravo', at: [0, 0, 100], foes: [], threat: null, bounds: [-30, -30, 40, 130], vehicles: [h] });
  const sqs = [A.sq, Bv.sq];
  for (const s of sqs) s.host.peers = () => sqs;
  let maxIn = 0, guardedSteps = 0;
  const stepAll = () => {
    world.time += 0.05;
    for (const s of sqs) s.step(0.05);
    h.step(0.05);
    const B = Bv.sq.board;
    if (B && (B.phase === 'board' || B.phase === 'last')) {
      maxIn = Math.max(maxIn, Bv.ms.filter((m) => m.vehTask?.kind === 'board').length);
      const waiting = Bv.ms.filter((m) => !m.inVehicle && m.vehTask?.kind !== 'board');
      if (waiting.length && waiting.every((m) => near(m.p, B.slots.get(m), 1.2))) guardedSteps++;
    }
  };
  for (let k = 0; k < 2400 && !Bv.sq.lastBoard; k++) stepAll();
  const L = veh(Bv.sq);
  assert.equal(Bv.sq.retreatCalls?.[0]?.react, 'mount', JSON.stringify(Bv.sq.retreatCalls?.map((c) => c.react)));
  assert.ok(log.some((l) => /Bravo radio: Bravo, copy Alpha, mounting up in the helicopter, coming to you/.test(l)), log.join(' | '));
  assert.ok(L.includes('vehicle:backup:Alpha:helicopter'));
  // signal, acknowledgements, everyone to his post, one by one, the signaller last, off
  const cmd = Bv.ms.find((m) => m.squad === 'CMD');
  const boards = L.filter((l) => /^vehicle:board:/.test(l));
  const iSig = at(L, /^vehicle:signal:helicopter/), iGa = at(L, /^vehicle:gather/), iB1 = at(L, /^vehicle:board:/), iLast = at(L, /^vehicle:last:CMD/), iDep = at(L, /^vehicle:depart:helicopter/);
  assert.ok(iSig >= 0 && iSig < iGa && iGa < iB1 && iB1 < iLast && iLast < iDep, L.join(' | '));
  assert.ok(log.some((l) => /Bravo CMD: Mount up! Into the helicopter!/.test(l)), log.join(' | '));
  assert.equal(L.filter((l) => /^vehicle:ack:/.test(l)).length, 3, 'the three others acknowledge');
  assert.equal(boards.length, 4);
  assert.ok(boards[3].startsWith('vehicle:board:CMD:'), `the signaller last (${boards})`);
  assert.equal(maxIn, 1, 'one at a time');
  assert.ok(guardedSteps > 20, `the rest waited at their posts (${guardedSteps})`);
  assert.ok(Bv.sq.vehicleLog.some((l) => /^vehicle:board:\w+:Door gunner/.test(l)), 'the first in on the door guns');
  assert.ok(/^vehicle:depart:helicopter:pilot$/.test(L[iDep]), `its own pilot flies it (${L[iDep]})`);
  assert.ok(log.some((l) => /Bravo radio: Bravo, mounted up, moving to Alpha/.test(l)));
  // landed by Alpha (behind it, away from its enemy), out, and moving up to cover them
  assert.ok(L.some((l) => /^vehicle:arrive:helicopter/.test(l)), L.join(' | '));
  assert.ok(h.p[2] < 60 && h.p[2] > 10, `landed by Alpha (${h.p.map((v) => v.toFixed(1))})`);
  for (const m of Bv.ms) assert.ok(m.aboard == null && !m.vehTask && near(m.p, [0, 0, 30], 12), `${m.squad} out by Alpha (${m.p.map((v) => v.toFixed(1))})`);
  assert.ok(Bv.sq.threat && Bv.sq.supporting?.unit === 'Alpha', 'they go to work');
  assert.ok(log.some((l) => /Bravo radio: Bravo, on the ground, moving up to Alpha/.test(l)));
});

test('retreat into a real boat (world.floats, sim/boats.js): its own seats and their weight, the rower rows it away afloat', async () => {
  const { placeRowBoat } = await import('../src/models/rowBoat.js');
  const { launchBoat, stepBoat, rower } = await import('../src/sim/boats.js');
  const world = { floats: [] };
  // a rowing boat afloat 14 m behind them (the enemy 14 m in front), cast off, its bow away from the enemy
  const f = launchBoat(placeRowBoat({ moored: false }, [0, 0, 0], 0.1).floats[0], { x: 0, z: 14, yaw: -Math.PI / 2 });
  world.floats.push(f);
  const { sq, ms, log } = team({ vehicles: [f], retreat: { order: true }, host: { din: () => 65, world } });
  const V = vehicleOf(f);
  assert.equal(V.kind, 'boat');
  assert.equal(V.seats.filter((s) => s.drive).length, 1);
  const M0 = f.body.M;
  let maxAboard = 0, rowedT = 0, deepest = 0;
  for (let t = 0; t < 300 && !(sq.strategy?.phase === 'done' && !sq.board); t += 0.05) {
    sq.step(0.05);
    // the world steps the boat: afloat, rowed by whoever is at its oars
    stepBoat(f, 0.05, { level: 0, t });
    const aboard = f.seats.filter((s) => s.who).length;
    maxAboard = Math.max(maxAboard, aboard);
    if (aboard === 4) deepest = Math.max(deepest, f.body.M - M0);
    if (f.row.oars.some((o) => o.dir !== 0)) rowedT += 0.05;
  }
  const L = veh(sq);
  assert.ok(sq.retreatLog.some((l) => /^retreat:vehicle:boat:/.test(l)), sq.retreatLog.join(' | '));
  assert.ok(at(L, /^vehicle:depart:boat:(CMD|MG|R1|R2)$/) >= 0, L.join(' | '));
  assert.equal(maxAboard, 4, 'all four in its seats');
  assert.ok(Math.abs(deepest - 4 * 80) < 1e-6, `their weight aboard (${deepest} kg)`);
  assert.ok(rowedT > 10, `rowed (${rowedT.toFixed(0)} s at the oars)`);
  assert.ok(at(L, /^vehicle:arrive:boat/) >= 0, `got there: ${L.join(' | ')}`);
  assert.ok(f.body.Z > 50, `rowed away from the threat (${f.body.X.toFixed(1)}, ${f.body.Z.toFixed(1)})`);
  assert.ok(!f.body.sunk && f.body.water < 0.01, 'afloat and dry');
  assert.equal(rower(f), null, 'out of it');
  assert.equal(f.body.M, M0, 'and their weight with them');
  for (const m of ms) assert.ok(!m.vehTask && !m.inVehicle && near(m.p, f.body.pose.p, 4), `${m.squad} out by the boat`);
  assert.ok(log.some((l) => /clear of the contact by boat/.test(l)), log.join(' | '));
});
