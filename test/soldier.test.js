import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { kit, aimPoint, SKILL, ARMS } from '../src/ai/soldier.js';
import { armourStops, WEAPONS } from '../src/sim/wounds.js';

/** An open field, one team, hostiles where we put them. */
function field({ hostiles = [], skill = 'regular', host = {} } = {}) {
  const members = [];
  for (const [squad, x, z] of [['CMD', -1, 10], ['MG', 1, 10.2], ['R1', -1.4, 11.6], ['R2', 1.4, 11.8]]) members.push({ p: [x, 0, z], yaw: Math.PI, squad, unit: 'Alpha', skill, health: 100 });
  const log = { shots: [], radio: [], shouts: [], grenades: [], stabs: [] };
  const s = new SquadAI({
    unit: 'Alpha', members: () => members, solid: () => false, floor: () => 0, bounds: [-30, -30, 30, 30],
    hostiles: () => hostiles, lineOfSight: () => true, visibility: () => 60,
    fire: (m, target, kind) => log.shots.push({ m, target, kind }),
    grenade: (m, from, vel) => log.grenades.push({ m, from, vel }),
    radio: (m, text, kind) => log.radio.push({ m, text, kind }),
    shout: (m, text) => log.shouts.push({ m, text }),
    stab: (m, h) => log.stabs.push({ m, h }),
    ...host,
  });
  return { s, members, log };
}
const run = (s, t, dt = 0.05) => {
  for (let k = 0; k < t / dt; k++) s.step(dt);
};

test('expertise: an elite shooter groups tighter than a recruit; a veteran reloads faster', () => {
  const spread = (skill) => {
    const m = { p: [0, 0, 0], skill };
    kit(m);
    let s = 0;
    for (let k = 0; k < 400; k++) {
      const a = aimPoint(m, [0, 0, 20]);
      s += Math.hypot(a[0], a[2] - 20);
    }
    return s / 400;
  };
  assert.ok(spread('elite') < spread('regular') && spread('regular') < spread('recruit'));
  assert.ok(SKILL.veteran.reload < SKILL.regular.reload && SKILL.recruit.reload > 1);
});

test('limited ammunition: magazines run dry, they reload, then the secondary', () => {
  const H = { p: [0, 0, -8], dead: false };
  const { s, members, log } = field({ hostiles: [H] });
  const r1 = members.find((m) => m.squad === 'R1');
  run(s, 1);
  assert.equal(r1.mag, ARMS.rifle.size);
  r1.mag = 1;
  r1.mags = 1;
  let reloaded = false;
  for (let k = 0; k < 600 && !(r1.weapon === 'secondary'); k++) {
    s.step(0.05);
    if (r1.anim === 'reload') reloaded = true;
    if (r1.mags === 0 && r1.mag === 30 && !r1.reloadUntil) r1.mag = 0; // fire off the last magazine fast
  }
  assert.ok(reloaded, 'reloaded with the animation');
  assert.equal(r1.weapon, 'secondary', 'on the secondary when the rifle is dry');
  assert.ok(log.radio.some((r) => /last magazine/.test(r.text)) && log.radio.some((r) => /on my secondary/.test(r.text)));
  const fromR1 = log.shots.filter((x) => x.m === r1);
  assert.ok(fromR1.some((x) => x.kind === 'carbine') || r1.secMag === 20, 'the secondary fires carbine rounds');
  assert.ok(log.shots.filter((x) => x.m.squad === 'MG').every((x) => x.kind === 'mg'));
});

test('close combat: an enemy within reach, the rifle goes away, the knife comes out and stabs', () => {
  const H = { p: [-1.4, 0, 10.2], dead: false };
  const { s, members, log } = field({ hostiles: [H] });
  const r1 = members.find((m) => m.squad === 'R1');
  let drew = false;
  for (let k = 0; k < 120; k++) {
    s.step(0.05);
    if (r1.anim === 'drawKnife') drew = true;
  }
  assert.ok(drew, 'the knife drawn (animation)');
  assert.equal(r1.weapon, 'knife');
  assert.ok(log.stabs.some((x) => x.m === r1 && x.h === H), 'stabbed');
  // the enemy gone: back to the rifle
  H.dead = true;
  run(s, 3);
  assert.equal(r1.weapon, 'rifle', 'the knife away again');
});

test('a man badly hit is called in by the nearest of his team; heavy fire from one side: a grenade, shouted', () => {
  const hostiles = [{ p: [0, 0, -4] }, { p: [2, 0, -3] }, { p: [-1.5, 0, -5] }];
  const { s, members, log } = field({ hostiles });
  run(s, 2);
  const r2 = members.find((m) => m.squad === 'R2');
  r2.health = 30;
  r2.bleed = 3;
  run(s, 6);
  const call = log.radio.find((r) => r.kind === 'casualty');
  assert.ok(call && /rifleman two is hit bad/.test(call.text) && call.m !== r2, `called in by another: ${call?.text}`);
  assert.ok(log.shouts.some((x) => /Medic/.test(x.text)));
  assert.ok(log.grenades.length >= 1, 'a grenade at the cluster');
  assert.ok(log.shouts.some((x) => /Frag out/.test(x.text)), 'shouted');
  const g = log.grenades[0];
  assert.ok(g.vel[2] < 0, 'thrown towards them');
});

test('armour: plates stop most rifle rounds and every knife; the helmet turns some rounds', () => {
  let r = 0;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const n = (e, zone, kind) => {
    let k = 0;
    for (let i = 0; i < 2000; i++) if (armourStops(e, zone, kind, rand)) k++;
    return k / 2000;
  };
  const armoured = { armour: true, helmet: true };
  assert.ok(Math.abs(n(armoured, 'torso', 'rifle') - (1 - WEAPONS.rifle.pen)) < 0.05);
  assert.ok(n(armoured, 'torso', 'mg') < n(armoured, 'torso', 'rifle'), 'the heavier round gets through more often');
  assert.equal(n(armoured, 'torso', 'knife'), 1);
  assert.ok(n(armoured, 'head', 'rifle') > 0.15 && n(armoured, 'head', 'rifle') < 0.45);
  assert.equal(n({}, 'torso', 'rifle'), 0, 'no armour: nothing stops it');
  assert.equal(n({ helmet: true, helmetOff: true }, 'head', 'rifle'), 0, 'the helmet knocked off');
});
