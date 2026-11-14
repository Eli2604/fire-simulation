import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { feasible } from '../src/ai/casualty.js';
import { CASUALTY_ACTS } from '../src/rig/objects.js';

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
/** The team behind a wall (z 8), the threat at (0, -10), rifleman one out in the open ahead, badly hit. */
function scene() {
  const { solid, floor, lineOfSight } = range([[-6, 7.8, 6, 8.2, 2]]);
  const ms = [['CMD', -2, 10], ['MG', 0, 10], ['R2', 2, 10], ['R1', 3, 2]].map(([r, x, z]) => ({ p: [x, 0, z], yaw: Math.PI, squad: r, unit: 'Alpha', health: 100, mag: 30, mags: 5 }));
  const log = [];
  const sq = new SquadAI({ unit: 'Alpha', members: () => ms, solid, lineOfSight, floor: (x, z, who) => floor(x, z, (who ? who.p[1] : 0) + 1.2) ?? 0, bounds: [-16, -16, 16, 16], threat: [0, 0, -10], radio: (m, text) => log.push(text), shout: (m, t) => log.push('shout: ' + t) });
  sq.useStrategy = false;
  const cas = ms[3];
  return { sq, ms, log, cas, lineOfSight };
}

test('a man down: the rescue on the radio in order, the cover with sight of the enemy, dragged to where it cannot see him', () => {
  const { sq, ms, log, cas, lineOfSight } = scene();
  for (let t = 0; t < 1; t += 0.05) sq.step(0.05);
  cas.health = 20;
  let coverSees = false, dragged = false, rescuer = null;
  for (let t = 0; t < 60 && !(sq.rescues?.length); t += 0.05) {
    sq.step(0.05);
    const R = sq.rescue;
    if (R) rescuer = R.rescuer;
    if (R?.coverer && !R.coverer.path && R.phase !== 'call') coverSees ||= lineOfSight(R.coverer.p, sq.threat);
    if (R?.phase === 'drag') {
      dragged = true;
      // the casualty in the rescuer's hands: DRAG_OFF ahead of him, the rescuer facing him
      const d = Math.hypot(cas.p[0] - R.rescuer.p[0], cas.p[2] - R.rescuer.p[2]);
      assert.ok(Math.abs(d - 1.05) < 0.05, `held at the collar (${d.toFixed(2)} m)`);
      assert.equal(cas.anim, 'dragged');
      assert.equal(R.rescuer.anim, 'dragCasualty');
    }
  }
  assert.ok(cas.down && log.includes('shout: Man down!'));
  assert.equal(sq.rescues?.[0]?.phase, 'done', 'rescued');
  assert.ok(dragged);
  assert.ok(coverSees, 'the coverer could see the enemy');
  assert.ok(rescuer && rescuer.squad !== 'MG', 'not the gunner: he covers');
  // in order
  const at = (re) => log.findIndex((l) => re.test(l));
  const seq = [/I'll get rifleman one, cover me!/, /covering!/, /copy, get him out/, /got him!/, /he's safe/, /back in the fight/].map(at);
  assert.ok(seq.every((i) => i >= 0), log.join(' | '));
  assert.ok(seq.every((i, k) => !k || i > seq[k - 1]), `in order: ${seq.join(',')}`);
  // he lies where the enemy cannot see him, treated
  assert.ok(cas.safe && cas.treated && !lineOfSight(sq.threat, cas.p), `out of its line of fire at ${cas.p.map((v) => v.toFixed(1))}`);
  assert.ok(cas.bleed == null || cas.bleed <= 0.3);
  void ms;
});

test('under heavy fire the rescue waits; once the fire slackens it goes ahead', () => {
  const { sq, ms, log, cas } = scene();
  for (let t = 0; t < 1; t += 0.05) sq.step(0.05);
  cas.health = 20;
  const al = ms.filter((m) => !m.dead);
  // two more of them hit just now
  ms[0].lastHitT = sq.time;
  ms[2].lastHitT = sq.time;
  assert.equal(feasible(sq, cas, al).ok, false);
  for (let t = 0; t < 3; t += 0.05) {
    ms[0].lastHitT = ms[2].lastHitT = sq.time; // (still coming in)
    sq.step(0.05);
  }
  assert.ok(!sq.rescue && sq.rescueDeferred > 0, 'deferred');
  assert.ok(log.some((l) => /too much fire to get to him/.test(l)), log.join(' | '));
  for (let t = 0; t < 10 && !sq.rescue; t += 0.05) sq.step(0.05);
  assert.ok(sq.rescue, 'goes ahead when it slackens');
});

test('the rig has the casualty acts', () => {
  assert.equal(CASUALTY_ACTS.woundedDown.label, 'Wounded down');
  assert.equal(CASUALTY_ACTS.dragCasualty.label, 'Drag casualty (rescuer + casualty)');
  assert.equal(CASUALTY_ACTS.firstAid.label, 'First aid');
  assert.equal(CASUALTY_ACTS.coverFire.label, 'Cover fire');
});
