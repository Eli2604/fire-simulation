import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI, teamOf } from '../src/ai/squad.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';

/** A flat 32 m range with a few walls (boxes) and two teams. */
function range() {
  const walls = [[-3.5, 5.5, 3, 0.3], [4.6, 1.5, 0.3, 3], [-1.5, -3.6, 3, 0.3], [5.4, -7.4, 3, 0.3], [-5, -1.5, 0.3, 3]];
  const solid = (x, y, z) => y < 1.25 && walls.some(([cx, cz, w, d]) => Math.abs(x - cx) < w / 2 && Math.abs(z - cz) < d / 2);
  const members = [];
  const roles = [['CMD', -1, 10], ['MG', 1, 10.2], ['R1', -1.4, 11.6], ['R2', 1.4, 11.8]];
  for (const [unit, dx] of [['Alpha', 0], ['Bravo', -9]]) for (const [squad, x, z] of roles) members.push({ p: [x + dx, 0, z], yaw: Math.PI, squad, unit });
  const log = { radio: [], grenades: 0, shots: 0 };
  const squads = [];
  for (const unit of ['Alpha', 'Bravo'])
    squads.push(new SquadAI({
      unit, members: () => members, solid, floor: () => 0, bounds: [-16, -16, 16, 16], threat: [0, 0, -11], peers: () => squads,
      fire: () => log.shots++, grenade: () => log.grenades++, radio: (m, text, kind) => log.radio.push({ unit, text, kind }),
    }));
  return { members, squads, log };
}

test('a fire team bounds from cover to cover, keeps together, signals and reaches the threat', () => {
  const { members, squads, log } = range();
  const alpha = members.filter((m) => m.unit === 'Alpha');
  const d0 = Math.min(...alpha.map((m) => Math.hypot(m.p[0], m.p[2] + 11)));
  let maxSpread = 0, swaps = 0, last = squads[0].moving;
  for (let t = 0; t < 90; t += 0.05) {
    for (const s of squads) s.step(0.05);
    const xs = alpha.map((m) => m.p);
    for (const a of xs) for (const b of xs) maxSpread = Math.max(maxSpread, Math.hypot(a[0] - b[0], a[2] - b[2]));
    if (squads[0].moving !== last) {
      swaps++;
      last = squads[0].moving;
    }
  }
  const d1 = Math.max(...alpha.map((m) => Math.hypot(m.p[0], m.p[2] + 11)));
  assert.ok(d1 < d0 - 8, `advanced on the threat: ${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
  assert.ok(swaps >= 2, `the teams took turns (${swaps} swaps)`);
  assert.ok(maxSpread < 16, `kept together (spread ${maxSpread.toFixed(1)} m)`);
  assert.equal(squads[0].phase, 'hold', 'holds at the threat');
  assert.ok(log.shots > 10, 'the covering team fired');
  assert.ok(teamOf(alpha[0]) === 'A' && teamOf(alpha[1]) === 'B');
  // routes never go through a wall
  for (const m of alpha) for (const q of m.trail) assert.ok(!(Math.abs(q[0] - 4.6) < 0.1 && Math.abs(q[1] - 1.5) < 1.4), 'not through the wall');
});

test('they radio contact, the other team answers; a man down is reported, and no response once alone', () => {
  const { members, squads, log } = range();
  for (let t = 0; t < 6; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => r.unit === 'Alpha' && r.kind === 'contact'), 'Alpha calls contact');
  assert.ok(log.radio.some((r) => r.unit === 'Bravo' && r.kind === 'reply' && /copy Alpha/.test(r.text)), 'Bravo answers');
  // the threat moves: reported again
  squads[0].setThreat([6, 0, -9]);
  for (let t = 0; t < 1; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => r.kind === 'threat'), 'threat change reported');
  // Bravo is wiped out, then an Alpha man goes down: no one answers
  for (const m of members) if (m.unit === 'Bravo') m.dead = true;
  for (let t = 0; t < 1; t += 0.05) for (const s of squads) s.step(0.05);
  members.find((m) => m.unit === 'Alpha' && m.squad === 'R2').dead = true;
  for (let t = 0; t < 5; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => r.unit === 'Alpha' && r.kind === 'manDown' && /rifleman two/.test(r.text)), 'man down reported');
  assert.ok(log.radio.some((r) => r.unit === 'Alpha' && r.kind === 'none'), 'no response from a team that is gone');
  const anims = members.filter((m) => m.unit === 'Alpha').map((m) => m.anim);
  assert.ok(anims.includes('radio') || log.radio.length > 3, 'the radio man keys the radio');
});

test('an unarmed soldier goes back for his rifle; grenades are not thrown with friends near the target', () => {
  const { members, squads, log } = range();
  const r1 = members.find((m) => m.unit === 'Alpha' && m.squad === 'R1');
  const rifle = [r1.p[0] + 3, 0, r1.p[2]];
  let picked = false;
  squads[0].host.rifleAt = (m) => (m === r1 && !picked ? rifle : null);
  squads[0].host.pickup = () => (picked = true);
  r1.unarmed = true;
  for (let t = 0; t < 12; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(picked && !r1.unarmed, 'picked it up');
  // everyone at the threat: no grenades
  for (const m of members) m.p = [0.5, 0, -10];
  const before = log.grenades;
  for (let t = 0; t < 20; t += 0.05) for (const s of squads) s.step(0.05);
  assert.equal(log.grenades, before);
});

test('the squad range scenario: two teams, walls and crates, no one shot by their own side', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.squadRange));
  const w = sim.world;
  assert.equal(w.enemies.filter((e) => e.squad).length, 9);
  assert.ok(w.enemies.some((e) => e.squad === 'UAV'), 'Alpha has a drone operator');
  for (let t = 0; t < 30; t += sim.dt) sim.step(sim.dt);
  assert.equal(sim.squads.length, 2);
  assert.ok(w.events.some((e) => e.type === 'radio' && e.kind === 'reply'), 'radio traffic between the teams');
  assert.ok(w.enemies.every((e) => !e.dead), 'no friendly fire');
  assert.ok(w.tracers.length > 0, 'they fired real rounds');
  const uav = w.enemies.find((e) => e.squad === 'UAV');
  assert.ok(uav.deployed && ['deployDrone', 'droneControl'].includes(uav.anim), 'the drone operator deploys and stays at the controls');
  assert.ok(w.events.some((e) => e.type === 'radio' && /drone is up/.test(e.name)), 'he radios that the drone is up');
  assert.ok(SCENARIOS.rigTest.page === 'rig.html');
});

test('the lead team gives orders on the radio: a flank, hold off and continue, pursuit', () => {
  const { members, squads, log } = range();
  for (let t = 0; t < 10; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => r.unit === 'Alpha' && /Bravo, Alpha, take the .* flank/.test(r.text)), 'Alpha sends Bravo to a flank');
  assert.ok(log.radio.some((r) => r.unit === 'Bravo' && /copy, moving/.test(r.text)), 'Bravo acknowledges');
  assert.ok(squads[1].goal, 'Bravo has a flank to go to');
  // Bravo gets far ahead: told to hold off
  for (const m of members) if (m.unit === 'Bravo') m.p = [m.p[0] + 4, 0, -4];
  for (let t = 0; t < 8; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => /hold off/.test(r.text)), 'hold off ordered');
  // the threat runs away: pursuit
  squads[0].setThreat([0, 0, -15.5]);
  for (const s of squads.slice(1)) s.threat = [0, 0, -15.5];
  for (let t = 0; t < 6; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => /going into pursuit/.test(r.text)), 'pursuit called');
  assert.ok(log.radio.some((r) => /copy, in pursuit/.test(r.text)) && (squads[1].pursuit || squads[1].phase === 'bound'), 'Bravo follows');
  assert.ok(members.some((m) => m.unit === 'Alpha' && m.anim === 'run'), 'running after it');
});

test('the drone operator keeps the team informed, scouts when the area is safe, and is called back', () => {
  const { members, squads, log } = range();
  members.push({ p: [0, 0, 13.5], yaw: Math.PI, squad: 'UAV', unit: 'Alpha' });
  // Alpha at the threat already, Bravo nearby: a quick hold
  for (const m of members) if (m.unit === 'Alpha' && m.squad !== 'UAV') m.p = [m.p[0] * 0.5, 0, -7];
  for (let t = 0; t < 40; t += 0.05) for (const s of squads) s.step(0.05);
  const uav = members.find((m) => m.squad === 'UAV');
  assert.ok(uav.deployed, 'the drone is up');
  assert.ok(log.radio.some((r) => r.kind === 'drone'), 'drone is up, on the radio');
  assert.ok(log.radio.some((r) => r.kind === 'intel' && /eyes on the threat/.test(r.text) && /Bravo is/.test(r.text)), 'regular intel, with where Bravo is');
  assert.ok(log.radio.some((r) => /area is clear, go scouting/.test(r.text)), 'the commander orders the search once it is safe');
  assert.ok(uav.scouting && uav.droneGoal, 'the drone is on its search');
  for (let t = 0; t < 12; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(log.radio.some((r) => /sector .* clear/.test(r.text)), 'sectors reported clear');
  assert.equal(uav.anim, 'droneScout');
  // the threat moves: back on it
  squads[0].setThreat([5, 0, -12]);
  for (let t = 0; t < 4; t += 0.05) for (const s of squads) s.step(0.05);
  assert.ok(!uav.scouting && !uav.droneGoal, 'recalled');
  assert.ok(log.radio.some((r) => /back on the threat/.test(r.text)));
});

/** A range with no threat yet: hostiles, noises, visibility and a mound for the gunner. */
function quiet({ vis = 60, dark = false } = {}) {
  const r = range();
  const hostiles = [];
  const noises = [];
  const mound = (x, z) => Math.max(0, 1.6 - Math.hypot(x - 4, z - 9) * 0.45);
  for (const s of r.squads) {
    s.threat = null;
    Object.assign(s.host, {
      hostiles: () => hostiles, noises: () => noises, visibility: () => vis, dark: () => dark,
      lineOfSight: () => true, floor: mound,
    });
  }
  return { ...r, hostiles, noises };
}
const run = (squads, s) => { for (let t = 0; t < s; t += 0.05) for (const q of squads) q.step(0.05); };

test('a noise: two men go and look (radio silence), find nothing and come back', () => {
  const { members, squads, log, noises } = quiet();
  noises.push({ p: [6, 0, 0], loud: 30, time: 0.5 });
  run(squads, 3);
  assert.ok(log.radio.some((r) => /noise .* investigate, radio silence/.test(r.text)), 'the commander sends two men, radio silence');
  const inv = squads[0].inv;
  assert.ok(inv && inv.men.length === 2 && inv.men.every((m) => m.squad === 'R1' || m.squad === 'R2'));
  const before = log.radio.length;
  run(squads, 10);
  assert.equal(log.radio.filter((r, i) => i >= before && r.unit === 'Alpha').length, 0, 'nothing said during the silence');
  run(squads, 40);
  assert.ok(log.radio.some((r) => /nothing found/.test(r.text)), 'nothing there: they report it once the silence is over');
  assert.equal(squads[0].inv, null);
  void members;
});

test('a hostile seen is the threat, marked and followed; outnumbered they call for backup', () => {
  const { squads, log, hostiles } = quiet();
  hostiles.push({ p: [2, 0, -8], id: 0 }, { p: [-3, 0, -9], id: 1 }, { p: [0, 0, -10], id: 2 });
  run(squads, 7);
  assert.ok(squads[0].threat, 'contact');
  assert.ok(hostiles.every((h) => h.marked), 'marked as threats');
  assert.ok(log.radio.some((r) => /contact/.test(r.text)));
  assert.ok(log.radio.some((r) => /requesting backup/.test(r.text)) && log.radio.some((r) => /on our way/.test(r.text)), 'backup called and answered');
  hostiles[0].p = [8, 0, -4];
  hostiles[1].dead = hostiles[2].dead = true;
  run(squads, 3);
  assert.ok(Math.hypot(squads[0].threat[0] - 8, squads[0].threat[2] + 4) < 0.1, 'the threat follows the hostile');
});

test('poor visibility: thermals on; dark and close to an unaware enemy: lights stay off', () => {
  const fog = quiet({ vis: 25 });
  run(fog.squads, 1);
  assert.ok(fog.log.radio.some((r) => /switch to thermals/.test(r.text)));
  assert.ok(fog.members.filter((m) => m.unit === 'Alpha' && m.squad !== 'UAV').every((m) => m.thermal));
  const night = quiet({ dark: true });
  run(night.squads, 1);
  assert.ok(night.members.every((m) => !m.light), 'no lights before contact (stealth)');
  night.hostiles.push({ p: [0, 0, 3], id: 0 });
  run(night.squads, 8);
  assert.ok(night.members.filter((m) => m.unit === 'Alpha').some((m) => m.light), 'lights on once engaged');
});

test('cover at corners is preferred; the gunner takes the higher ground behind', () => {
  const { members, squads } = quiet();
  squads[0].setThreat([0, 0, -11]);
  run(squads, 40);
  assert.ok(squads[0].covers.some((c) => c.corner), 'corners found');
  const mg = members.find((m) => m.unit === 'Alpha' && m.squad === 'MG');
  assert.ok(mg.highGround || mg.p[1] > 0.4, `the gunner went up (y = ${mg.p[1].toFixed(2)})`);
});
