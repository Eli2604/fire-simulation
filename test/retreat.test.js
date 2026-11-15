import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { assess, choose, STRATEGIES } from '../src/ai/strategy.js';
import { decideCasualty, doorwaysOn, RT_T, WIRE_E } from '../src/ai/retreat.js';

/** A flat range (solid below 0) with boxes [x0, z0, x1, z1, top]; sight is blocked by them. */
function range(boxes) {
  const solid = (x, y, z) => y < 0 || boxes.some(([x0, z0, x1, z1, top]) => x >= x0 && x < x1 && z >= z0 && z < z1 && y >= 0 && y < top);
  const floor = (x, z, from) => {
    for (let y = from; y > from - 3.5; y -= 0.05) if (solid(x, y - 0.025, z)) return Math.round(y / 0.05) * 0.05;
    return null;
  };
  const lineOfSight = (a, b) => {
    const A = [a[0], (a[1] ?? 0) + 1.5, a[2]], B = [b[0], (b[1] ?? 0) + 1.2, b[2]];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    for (let s = 0.2; s < L - 0.2; s += 0.2) {
      const t = s / L;
      if (solid(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)) return false;
    }
    return true;
  };
  return { solid, floor, lineOfSight };
}
const ROLES = [['CMD', -2, 0], ['R1', -0.7, 0.4], ['MG', 0.7, 0.2], ['R2', 2, 0.5]];
/** The team at z ~0, the enemy at (0, -14), the rally point back at (0, 13); o: host extras. */
function scene(boxes, o = {}, skill = 'regular') {
  const { solid, floor, lineOfSight } = range(boxes);
  const ms = ROLES.map(([r, x, z]) => ({ p: [x, 0, z], yaw: Math.PI, squad: r, unit: 'Alpha', health: 100, mag: 30, mags: 5, skill }));
  const foes = o.foes ?? [{ p: [0, 0, -14] }];
  const log = [], shots = new Map(), booms = [];
  const sq = new SquadAI({
    unit: 'Alpha', members: () => ms, solid, lineOfSight, seed: 3,
    floor: (x, z, who) => floor(x, z, (who ? who.p[1] : 0) + 1.2) ?? 0,
    bounds: [-16, -16, 16, 16], threat: [0, 0, -14], hostiles: () => foes,
    radio: (m, text) => log.push(text), shout: (m, t) => log.push(`${m.squad}: ${t}`),
    fire: (m) => shots.set(m, (shots.get(m) ?? 0) + 1),
    explode: (p, E, x) => booms.push({ p, E, ...x }),
    retreat: { order: true, rally: [0, 0, 13], ...(o.retreat ?? {}) },
    ...(o.host ?? {}),
  });
  return { sq, ms, log, shots, booms, foes, lineOfSight };
}
const near = (a, b, r) => Math.hypot(a[0] - b[0], a[2] - b[2]) < r;
// low walls (cover) across the way back, staggered
const COVER = [[-4, 4, -1.5, 4.4, 1], [1.5, 4, 4, 4.4, 1], [-3, 8.5, -0.5, 8.9, 1], [0.5, 8.5, 3, 8.9, 1]];

test('under pressure the leader picks the retreat: pinned down, heavy casualties, or ordered', () => {
  const foes = [0, 1, 2, 3].map((i) => ({ p: [-3 + 2 * i, 0, -14] }));
  // pinned down: two of them hit just now, as many enemies as men
  const A = scene([], { foes, retreat: { order: false } });
  for (let t = 0; t < 2; t += 0.05) A.sq.step(0.05);
  A.sq.rebuildNav();
  assert.notEqual(choose(A.sq, assess(A.sq)).kind, 'retreat', 'nothing wrong yet');
  A.ms[0].lastHitT = A.ms[2].lastHitT = A.sq.time;
  assert.deepEqual(choose(A.sq, assess(A.sq)), { kind: 'retreat', why: 'pinned down' });
  // a man down, three enemies to the three left standing
  const B = scene([], { foes: foes.slice(0, 3), retreat: { order: false } });
  for (let t = 0; t < 2; t += 0.05) B.sq.step(0.05);
  B.ms[1].health = 30;
  assert.equal(choose(B.sq, assess(B.sq)).why, 'heavy casualties');
  // auto off: no
  B.sq.host.retreat = { order: false, auto: false };
  assert.notEqual(choose(B.sq, assess(B.sq)).kind, 'retreat');
  // in the run of things: it switches to it, says so on the radio
  const C = scene([], { foes, retreat: { order: false } });
  for (let t = 0; t < 3; t += 0.05) {
    C.ms[0].lastHitT = C.ms[3].lastHitT = C.sq.time;
    C.sq.step(0.05);
  }
  assert.equal(C.sq.strategy?.kind, 'retreat');
  assert.ok(C.log.some((l) => /pinned down, retreat, peel back/.test(l)), C.log.join(' | '));
  assert.ok(STRATEGIES.retreat);
});

test('peeling back: one man moves at a time while another covers (and fires); all end at the rally point', () => {
  const { sq, ms, log, shots } = scene(COVER);
  let moves = 0, maxMovers = 0, uncovered = 0, firedWhileMoving = 0, backAim = 0;
  const before = new Map();
  for (let t = 0; t < 120 && sq.strategy?.phase !== 'done'; t += 0.05) {
    for (const m of ms) before.set(m, shots.get(m) ?? 0);
    sq.step(0.05);
    const movers = ms.filter((m) => m.rt?.role === 'move');
    const cover = ms.filter((m) => !m.dead && (m.rt?.role === 'cover' || m.rt?.role === 'rally') && !m.moving);
    if (movers.length) {
      moves++;
      if (!cover.length) uncovered++;
      if (cover.some((m) => (shots.get(m) ?? 0) > before.get(m))) firedWhileMoving++;
      if (movers.some((m) => m.anim === 'aimWalkBack')) backAim++;
    }
    maxMovers = Math.max(maxMovers, movers.length);
  }
  assert.equal(sq.strategy?.kind, 'retreat');
  assert.equal(sq.strategy.phase, 'done', `done (${ms.map((m) => m.rt?.role)})`);
  assert.ok(moves > 50, 'they moved');
  assert.equal(maxMovers, 1, 'one at a time');
  assert.equal(uncovered, 0, 'never without cover');
  assert.ok(firedWhileMoving > 5, `the coverers fired while a man moved (${firedWhileMoving})`);
  assert.ok(backAim > 10, 'backing off with the weapon up');
  for (const m of ms) assert.ok(near(m.p, [0, 0, 13], 4), `${m.squad} at the rally point (${m.p.map((v) => v.toFixed(1))})`);
  assert.ok(log.some((l) => /Moving!/.test(l)) && log.some((l) => /Covering!/.test(l)) && log.some((l) => /Set!/.test(l)));
  assert.ok(log.some((l) => /at the rally point, contact broken/.test(l)));
  // they peeled more than once each (bounds, not one run)
  assert.ok(log.filter((l) => /Moving!/.test(l)).length > ms.length, 'several bounds');
});

test('a man down, carried: the carrier slings his weapon, drops his pack, lifts him, carries him back; both arrive', () => {
  const { sq, ms, log } = scene(COVER, { retreat: { casualties: 'carry' } });
  const cas = ms[1];
  cas.health = 25;
  const anims = new Set(), casAnims = new Set();
  let carrier = null, rode = 0, apart = 0, carrierFired = false;
  for (let t = 0; t < 160 && sq.strategy?.phase !== 'done'; t += 0.05) {
    sq.step(0.05);
    const J = sq.strategy?.rt?.jobs[0];
    if (J) {
      carrier = J.carrier;
      anims.add(carrier.anim);
      casAnims.add(cas.anim);
      if (J.phase === 'carry') {
        rode++;
        if (!near(cas.p, carrier.p, 0.01)) apart++;
        assert.ok(carrier.slung && carrier.canFire === false, 'his weapon slung, he cannot shoot');
        assert.ok(carrier.speed <= 0.9, 'slowly');
      }
    }
  }
  void carrierFired;
  assert.ok(carrier && carrier !== cas && carrier.squad !== 'MG', 'a rifleman carries him');
  for (const a of ['holsterRifle', 'dropPack', 'liftCasualty', 'fireCarry', 'putDownCasualty', 'drawRifle']) assert.ok(anims.has(a), `carrier: ${a} (${[...anims]})`);
  for (const a of ['lifted', 'carried', 'setDown']) assert.ok(casAnims.has(a), `casualty: ${a}`);
  assert.ok(rode > 100 && apart === 0, 'he rode on the carrier');
  assert.ok(carrier.packOff);
  assert.equal(sq.strategy.phase, 'done');
  assert.ok(near(cas.p, [0, 0, 13], 4) && near(carrier.p, [0, 0, 13], 4), 'both back');
  assert.ok(cas.safe && !carrier.slung && carrier.canFire !== false, 'put down, weapon up again');
  assert.ok(log.some((l) => /I'm carrying him, cover me/.test(l)), log.join(' | '));
});

test('a man down, left behind: he stays and keeps firing; the others peel away', () => {
  const { sq, ms, log, shots } = scene(COVER, { retreat: { casualties: 'leave' } });
  const cas = ms[0];
  cas.health = 30;
  const at = cas.p.slice();
  for (let t = 0; t < 120 && sq.strategy?.phase !== 'done'; t += 0.05) sq.step(0.05);
  assert.equal(sq.strategy.phase, 'done');
  assert.equal(cas.rt.role, 'left');
  assert.ok(near(cas.p, at, 0.3), 'stays where he lies');
  assert.ok((shots.get(cas) ?? 0) > 10, `kept firing (${shots.get(cas)})`);
  assert.ok(['proneAim', 'proneShoot', 'reload'].includes(cas.anim), cas.anim);
  for (const m of ms.slice(1)) assert.ok(near(m.p, [0, 0, 13], 4), `${m.squad} back`);
  assert.ok(log.some((l) => /leave me, go, I'll cover you/.test(l)), log.join(' | '));
  // still at it after they are gone
  const n = shots.get(cas);
  for (let t = 0; t < 8; t += 0.05) sq.step(0.05);
  assert.ok(shots.get(cas) > n, 'as long as he can');
});

test('carry or leave: by experience, the enemy\'s distance, how badly hurt, how many left', () => {
  const { sq, ms } = scene([], { retreat: { order: false } });
  for (let t = 0; t < 0.3; t += 0.05) sq.step(0.05);
  const cas = ms[1];
  const fit = ms.filter((m) => m !== cas);
  // helpless, the enemy far, veterans: carry him
  cas.health = 30;
  cas.mag = cas.mags = cas.secMag = cas.secMags = 0;
  fit.forEach((m) => (m.skill = 'veteran'));
  assert.equal(decideCasualty(sq, cas, fit).how, 'carry');
  // he can still shoot, the enemy right on him, recruits: leave him to cover them
  cas.mag = 30;
  fit.forEach((m) => (m.skill = 'recruit'));
  sq.seen = [{ p: [cas.p[0], 0, cas.p[2] - 5] }];
  assert.equal(decideCasualty(sq, cas, fit).how, 'leave');
  // one man left standing: no one to cover a carry
  sq.seen = [];
  assert.equal(decideCasualty(sq, cas, fit.slice(0, 1)).how, 'leave');
});

test('the tripwire: the last man through the door wires it; the enemy coming through sets it off, the squad does not', () => {
  // a wall across at z 4 with a doorway (x -0.5..0.5) in it; the rally point behind it
  const WALL = [[-16, 4, -0.5, 4.3, 2.4], [0.5, 4, 16, 4.3, 2.4]];
  const { sq, ms, foes, booms, log } = scene(WALL);
  let trapAt = null, othersThrough = false;
  for (let t = 0; t < 150 && sq.strategy?.phase !== 'done'; t += 0.05) {
    sq.step(0.05);
    if (!trapAt && sq.traps?.length) {
      trapAt = sq.time;
      const setter = sq.traps[0].setBy;
      othersThrough = ms.filter((m) => m !== setter).every((m) => m.p[2] > 4.3);
    }
  }
  assert.equal(sq.strategy.phase, 'done');
  assert.equal(sq.traps?.length, 1, 'one wire');
  const tr = sq.traps[0];
  assert.ok(othersThrough, 'set by the last man through');
  assert.ok(Math.abs(tr.c[0]) < 0.6 && Math.abs(tr.c[2] - 4.15) < 0.8, `in the doorway (${tr.c.map((v) => v.toFixed(2))})`);
  assert.ok(Math.abs(tr.a[1] - 0.15) < 0.05, 'at ankle height');
  assert.ok(tr.armed && tr.stage === 'wire');
  assert.ok(log.some((l) => /wiring the door/.test(l)) && log.some((l) => /wire is in/.test(l)), log.join(' | '));
  assert.ok(ms.every((m) => near(m.p, [0, 0, 13], 4)), 'all back');
  // one of the squad walks back through it: nothing
  const m = ms[2];
  for (let z = m.p[2]; z > 1; z -= 0.1) {
    m.p = [0, 0, z];
    sq.step(0.02);
  }
  assert.equal(booms.length, 0, 'not by their own');
  // the enemy comes through: it goes off at the charge
  for (let z = 0; z < 7; z += 0.1) {
    foes[0].p = [0.1, 0, z];
    sq.step(0.02);
    if (booms.length) break;
  }
  assert.equal(booms.length, 1, 'off');
  assert.equal(booms[0].name, 'tripwire');
  assert.equal(booms[0].E, WIRE_E);
  assert.ok(near(booms[0].p, tr.charge, 0.01) && tr.fired && tr.firedBy === foes[0]);
  assert.ok(foes[0].p[2] > 3.8 && foes[0].p[2] < 4.6, 'where the wire is');
});

test('doorways on a way: the gap in a wall, not the open ground', () => {
  const WALL = [[-16, 4, -0.5, 4.3, 2.4], [0.5, 4, 16, 4.3, 2.4]];
  const { sq } = scene(WALL);
  sq.step(0.05);
  sq.rebuildNav();
  const g = doorwaysOn(sq, [0, 0, 0], [[0, 0, 8]]);
  assert.equal(g.length, 1);
  assert.ok(Math.abs(g[0].c[0]) < 0.3 && Math.abs(g[0].c[2] - 4.15) < 0.5 && g[0].w < 1.5);
  assert.equal(doorwaysOn(sq, [5, 0, -8], [[5, 0, 2]]).length, 0);
  assert.ok(RT_T.wire > 3);
});
