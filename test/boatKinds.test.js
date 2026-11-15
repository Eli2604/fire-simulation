import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRowBoat, BOAT_PRESETS } from '../src/models/rowBoat.js';
import { MODELS } from '../src/models/index.js';
import { launchBoat, stepBoat, boardSeat, row, rower, sailToward, startMotor, CLOSE_HAULED, MOTOR } from '../src/sim/boats.js';
import { boatSoundParams, boatSfxSound, firingHz, motorSound, sailSound } from '../src/audio/boatSound.js';
import { vehicleOf } from '../src/ai/vehicles.js';

const boat = (kind, p = {}, at = {}) => launchBoat(placeRowBoat({ kind, moored: false, ...p }, [0, 0, 0], 0.1).floats[0], at);
const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const speedOf = (f) => Math.hypot(f.body.vx, f.body.vz);

/** A sailing dinghy, two aboard, held on a heading (radians in x, z) with the wind `speed` from `from` (radians in x, z). */
function sailOn(heading, from, speed, s = 60, o = {}) {
  const f = boat('sail');
  boardSeat(f, { name: 'helm' });
  boardSeat(f, { name: 'crew' });
  let rollMax = 0, v = 0, n = 0;
  for (let t = 0; t < s; t += 0.05) {
    // the helmsman holds the heading (the sheet trimmed for him)
    sailToward(f, [Math.cos(heading) * 5000, Math.sin(heading) * 5000]);
    f.row.turn = Math.max(-1, Math.min(1, 1.5 * wrap(heading + f.body.yaw) + 0.8 * f.body.wy)) * (f.body.vx * Math.cos(f.body.yaw) - f.body.vz * Math.sin(f.body.yaw) < -0.05 ? -1 : 1);
    stepBoat(f, 0.05, { level: 0, wind: { speed, dir: from + Math.PI }, t });
    if (t > s / 2) {
      rollMax = Math.max(rollMax, Math.abs(f.body.roll));
      v += f.body.vx * Math.cos(heading) + f.body.vz * Math.sin(heading);
      n++;
    }
  }
  return { f, vmg: v / n, rollMax, ...o };
}

test('the kinds: a rowing boat, an outboard dinghy, a sailing dinghy, a canoe; each its own seats and its own drive', () => {
  for (const k of ['motorBoat', 'sailBoat', 'canoe']) assert.ok(MODELS[k]?.build, `${k} is a model`);
  assert.equal(MODELS.sailBoat.params.kind.value, 'sail');
  const kinds = { row: 'rower', motor: 'helm', sail: 'helm', canoe: 'paddler' };
  for (const [kind, role] of Object.entries(kinds)) {
    const f = boat(kind);
    assert.equal(f.kind, kind);
    const drive = f.seats.filter((s) => s.drive);
    assert.equal(drive.length, 1, `${kind}: one drives`);
    assert.equal(drive[0].role, role);
    const man = { name: 'x' };
    assert.equal(f.seats[boardSeat(f, man)].role, role, `${kind}: the first aboard takes the ${role}'s seat`);
    assert.equal(rower(f), man);
    // the squads' adapter: its seats, who drives, who may shoot
    const V = vehicleOf(f);
    assert.equal(V.kind, 'boat');
    assert.equal(V.driver(), man);
    assert.ok(V.seats.filter((s) => s.shoot).every((s) => s.role === 'passenger'));
  }
  assert.ok(boat('motor').motor && !boat('row').motor && boat('sail').sail && !boat('canoe').sail);
  assert.equal(BOAT_PRESETS.canoe.transom, 0, 'a canoe: pointed both ends');
  // under its own power: an outboard ~4 m/s, a canoe ~1.3, oars ~1.4
  const m = boat('motor');
  boardSeat(m, { name: 'h' });
  startMotor(m);
  for (let t = 0; t < 2; t += 0.05) stepBoat(m, 0.05, { level: 0 });
  assert.ok(m.motor.running && m.motor.rpm > 600 && m.motor.rpm < 1600, `idling at ${m.motor.rpm.toFixed(0)} rpm`);
  row(m, 1, 0);
  for (let t = 0; t < 25; t += 0.05) stepBoat(m, 0.05, { level: 0 });
  assert.ok(speedOf(m) > 3 && speedOf(m) < 6, `motoring at ${speedOf(m).toFixed(2)} m/s`);
  assert.ok(m.motor.rpm > 4500 && m.motor.rpm <= MOTOR.maxRpm * MOTOR.limit + 1, `${m.motor.rpm.toFixed(0)} rpm`);
  const c = boat('canoe');
  boardSeat(c, { name: 'p' });
  row(c, 1, 0);
  for (let t = 0; t < 30; t += 0.05) stepBoat(c, 0.05, { level: 0 });
  assert.ok(speedOf(c) > 0.8 && speedOf(c) < 2, `paddled at ${speedOf(c).toFixed(2)} m/s`);
  assert.ok(Math.abs(c.body.yaw) < 0.3, 'strokes on both sides: straight');
});

test('the outboard: it races out of the water, cavitates shallow, stalls swamped; the AI motors to a point', () => {
  const f = boat('motor');
  boardSeat(f, { name: 'h' });
  startMotor(f);
  row(f, 1, 0);
  for (let t = 0; t < 8; t += 0.05) stepBoat(f, 0.05, { level: 0 });
  const rpm = f.motor.rpm;
  assert.ok(!f.motor.racing && f.motor.cav < 0.5, 'in the water: no racing');
  // a wave trough under the stern: the prop out of the water (the water 0.6 m lower aft of the transom)
  const env = { level: 0, surface: (x, z) => ((x - f.body.pose.p[0]) * Math.cos(f.body.yaw) - (z - f.body.pose.p[2]) * Math.sin(f.body.yaw) < -2.1 ? -0.6 : 0) };
  for (let t = 0; t < 0.4; t += 0.05) stepBoat(f, 0.05, env);
  assert.ok(f.motor.imm < 0.3, `the prop out: immersion ${f.motor.imm.toFixed(2)}`);
  assert.ok(f.motor.rpm > rpm + 100 && f.motor.racing, `racing: ${rpm.toFixed(0)} → ${f.motor.rpm.toFixed(0)} rpm`);
  assert.ok(f.motor.cav > 0.5, 'ventilating');
  // swamped: it stalls and will not start
  const g = boat('motor');
  boardSeat(g, { name: 'h' });
  startMotor(g);
  for (let t = 0; t < 2; t += 0.05) stepBoat(g, 0.05, { level: 0 });
  assert.ok(g.motor.running);
  g.body.water = g.body.Vcap;
  stepBoat(g, 0.05, { level: 0, bottom: -5 });
  assert.ok(!g.motor.running && g.motor.stalled, `stalled (${g.motor.why})`);
  assert.ok(g.sfx.some((e) => e.kind === 'stall'));
  // the AI at the helm: it starts the motor and motors there (and then the oars if it will not run)
  const a = boat('motor');
  boardSeat(a, { name: 'soldier' });
  a.row.goal = { p: [80, 20], radius: 3 };
  let t = 0;
  for (; t < 60 && a.row.goal; t += 0.05) stepBoat(a, 0.05, { level: 0, t });
  assert.ok(!a.row.goal && Math.hypot(a.body.X - 80, a.body.Z - 20) < 5, `motored there in ${t.toFixed(0)} s`);
  assert.ok(t < 40, 'faster than rowing');
});

test('sailing: a beam reach is fastest, close-hauled slower, no progress straight into the wind; the heel grows with the wind', () => {
  // the wind from +z (from = π/2), 5 m/s
  const from = Math.PI / 2;
  const beam = sailOn(0, from, 5);
  const close = sailOn(from - (CLOSE_HAULED + 0.15), from, 5); // (~58° off the wind)
  const broad = sailOn(-Math.PI / 4, from, 5); // (135° off: a broad reach)
  const run = sailOn(-Math.PI / 2, from, 5); // (dead downwind)
  const upwind = sailOn(from, from, 5, 40);
  assert.ok(beam.vmg > close.vmg && beam.vmg > run.vmg, `beam ${beam.vmg.toFixed(2)}, close ${close.vmg.toFixed(2)}, broad ${broad.vmg.toFixed(2)}, run ${run.vmg.toFixed(2)} m/s`);
  assert.ok(beam.vmg > 1.2 && close.vmg > 0.4, 'it sails');
  assert.ok(upwind.vmg < 0.1, `straight into the wind: ${upwind.vmg.toFixed(2)} m/s`);
  assert.ok(upwind.f.sailState.luff > 0.5, 'the sail luffing');
  // more wind, more heel (beam reach, hiked out)
  const light = sailOn(0, from, 3, 30), fresh = sailOn(0, from, 6, 30);
  assert.ok(fresh.rollMax > light.rollMax + 0.02, `heel ${((light.rollMax * 180) / Math.PI).toFixed(1)}° → ${((fresh.rollMax * 180) / Math.PI).toFixed(1)}°`);
  assert.ok(fresh.f.sailState.hike > light.f.sailState.hike, 'the crew hike out harder');
  // heeled to leeward: the wind from +z blows it over towards −z (roll < 0 tips the mast to port, −z)
  assert.ok(fresh.f.body.roll < 0, `heels to leeward (${fresh.f.body.roll.toFixed(2)})`);
});

test('sailing upwind the helmsman tacks: it gets to a point dead to windward; downwind it gybes', () => {
  const f = boat('sail');
  boardSeat(f, { name: 'helm' });
  boardSeat(f, { name: 'crew' });
  f.row.goal = { p: [60, 0], radius: 4 };
  const tacks = new Set();
  let t = 0;
  for (; t < 300 && f.row.goal; t += 0.05) {
    stepBoat(f, 0.05, { level: 0, wind: { speed: 5, dir: Math.PI }, t }); // (from +x)
    tacks.add(f.row.tack);
  }
  assert.ok(!f.row.goal, `there in ${t.toFixed(0)} s (at ${f.body.X.toFixed(1)}, ${f.body.Z.toFixed(1)})`);
  assert.ok(tacks.has(1) && tacks.has(-1), 'on both tacks');
  // a gybe: the wind from astern swinging across, the boom slams over
  const g = boat('sail');
  boardSeat(g, { name: 'helm' });
  for (let t2 = 0; t2 < 20; t2 += 0.05) {
    sailToward(g, [5000, 0]); // (running before it, the wind veering from one quarter to the other)
    stepBoat(g, 0.05, { level: 0, wind: { speed: 5, dir: t2 < 10 ? 0.3 : -0.3 } });
  }
  assert.ok(g.sfx.some((e) => e.kind === 'gybe'), 'gybed');
});

test('sound: an engine note from the rpm, a sail flogging when it luffs, the hull hissing with speed; slaps, oars, hits', () => {
  // the firing frequency: rpm / 60 × cylinders / 2 (four-stroke), × cylinders (two-stroke)
  assert.equal(firingHz(6000, 2, 4), 100);
  assert.equal(firingHz(6000, 2, 2), 200);
  assert.equal(motorSound(null), null);
  const m = boat('motor');
  boardSeat(m, { name: 'h' });
  const off = boatSoundParams(m);
  assert.equal(off.motor.on, false);
  assert.equal(off.motor.gain, 0);
  startMotor(m);
  for (let t = 0; t < 2; t += 0.05) stepBoat(m, 0.05, { level: 0 });
  const idle = boatSoundParams(m);
  row(m, 1, 0);
  for (let t = 0; t < 10; t += 0.05) stepBoat(m, 0.05, { level: 0 });
  const full = boatSoundParams(m);
  assert.ok(idle.motor.on && idle.motor.fire0 > 10 && idle.motor.fire0 < 30, `idle ${idle.motor.fire0.toFixed(1)} Hz`);
  assert.ok(full.motor.fire0 > 3 * idle.motor.fire0 && full.motor.gain > idle.motor.gain * 1.5 && full.motor.cutoff > idle.motor.cutoff, 'louder, higher, brighter flat out');
  assert.ok(Math.abs(full.motor.fire0 - firingHz(m.motor.rpm, 2, 4)) < 1e-9);
  assert.ok(full.hiss > idle.hiss + 0.1 && full.hissHz0 > idle.hissHz0, 'the hull hisses with speed');
  assert.ok(full.wash > 0.2, 'the prop wash');
  // racing / cavitating: its note brighter, the cavitation's hiss
  const race = motorSound({ ...m.motor, imm: 0.1, cav: 0.9, racing: true, rpm: 5900, n: 1.07 });
  assert.ok(race.cav > 0.5 && race.cutoff > full.motor.cutoff && race.racing);
  // the Doppler shift: coming at you higher, going away lower
  const ahead = [m.body.X + 50 * Math.cos(m.body.yaw), 0, m.body.Z - 50 * Math.sin(m.body.yaw)];
  const behind = [m.body.X - 50 * Math.cos(m.body.yaw), 0, m.body.Z + 50 * Math.sin(m.body.yaw)];
  const A = boatSoundParams(m, { pos: ahead }), B = boatSoundParams(m, { pos: behind });
  assert.ok(A.doppler > 1 && B.doppler < 1 && A.motor.fire > B.motor.fire, `Doppler ${A.doppler.toFixed(3)} / ${B.doppler.toFixed(3)}`);
  assert.ok(A.level < 0.2 && boatSoundParams(m, { pos: [m.body.X + 3, 0, m.body.Z] }).level > A.level * 5, 'fainter far off');
  // the sail: luffing it flogs, drawing it does not; the rigging hums in a breeze (Aeolian: 0.2·U/d)
  const s = sailSound({ U: 8, luff: 1, fill: 0 }), d = sailSound({ U: 8, luff: 0, fill: 1 });
  assert.ok(s.flap > 0.8 && d.flap === 0 && d.rush > 0.2, 'flogging when luffing');
  assert.ok(Math.abs(s.humHz - 400) < 1e-9 && s.hum > 0);
  // a sailing dinghy on a beam reach, its sheet let fly: the sail luffs and flogs, quieter drawing
  const reach = sailOn(0, Math.PI / 2, 6, 20).f;
  const drawing = boatSoundParams(reach).sail;
  reach.row.autoTrim = false;
  reach.row.sheet = 1;
  for (let t = 0; t < 2; t += 0.05) {
    reach.row.turn = Math.max(-1, Math.min(1, 1.5 * wrap(reach.body.yaw) + 0.8 * reach.body.wy));
    stepBoat(reach, 0.05, { level: 0, wind: { speed: 6, dir: -Math.PI / 2 } });
  }
  const flogging = boatSoundParams(reach).sail;
  assert.ok(flogging.flap > 0.3 && flogging.flap > drawing.flap + 0.3, `sheet let fly: it flogs (${drawing.flap.toFixed(2)} → ${flogging.flap.toFixed(2)})`);
  // a rowing boat: the strokes heard (catch and release), the line creaks taut
  const r = boat('row', { moored: true });
  boardSeat(r, { name: 'r' });
  row(r, 1, 0);
  for (let t = 0; t < 12; t += 0.05) stepBoat(r, 0.05, { level: 0 });
  assert.ok(r.sfx.some((e) => e.kind === 'catch') && r.sfx.some((e) => e.kind === 'release'), 'the oars');
  // one-shots: a bow slap louder the harder it comes down; a round through the hull an impact
  const soft = boatSfxSound({ kind: 'slap', v: 0.4 }, 250), hard = boatSfxSound({ kind: 'slap', v: 2 }, 250);
  assert.ok(hard.gain > soft.gain && hard.layers[0].freq > soft.layers[0].freq);
  assert.ok(boatSfxSound({ kind: 'hit' }).impact.materials.includes('wood'));
  for (const k of ['catch', 'release', 'gybe', 'start', 'stall']) assert.ok(boatSfxSound({ kind: k, v: 0.6 }).layers.length > 0, k);
});

test('drawn by kind: the boom swings and the sail fills, the outboard tilts up when off and turns with the tiller, the paddle sweeps', async () => {
  const { buildRowBoatMesh } = await import('../src/render/rowBoatMesh.js');
  const s = boat('sail');
  boardSeat(s, { name: 'h' });
  const ms = buildRowBoatMesh(s.params);
  assert.ok(ms.rig.sail && ms.rig.boom);
  for (let t = 0; t < 5; t += 0.05) {
    sailToward(s, [5000, 0]);
    stepBoat(s, 0.05, { level: 0, wind: { speed: 5, dir: -Math.PI / 2 } });
    ms.setRig(s, 0.05);
  }
  assert.ok(Math.abs(ms.rig.boom.rotation.y - s.sailState.boom) < 1e-9 && Math.abs(s.sailState.boom) > 0.3, 'the boom out');
  const pos = ms.rig.sail.geometry.attributes.position.array;
  assert.ok(Math.max(...Array.from(pos).filter((_, i) => i % 3 === 2).map(Math.abs)) > 0.05, 'the sail cambered');
  const m = boat('motor');
  boardSeat(m, { name: 'h' });
  const mm = buildRowBoatMesh(m.params);
  for (let k = 0; k < 20; k++) mm.setRig(m, 0.05);
  const tiltOff = mm.rig.motor.parent.rotation.z;
  startMotor(m);
  row(m, 0.5, 1);
  for (let t = 0; t < 3; t += 0.05) {
    stepBoat(m, 0.05, { level: 0 });
    mm.setRig(m, 0.05);
  }
  assert.ok(tiltOff < -0.8 && Math.abs(mm.rig.motor.parent.rotation.z) < 0.1, 'tilted up off, down running');
  assert.ok(mm.rig.motor.rotation.y > 0.3, 'turned with the tiller');
  const c = boat('canoe');
  boardSeat(c, { name: 'p' });
  const mc = buildRowBoatMesh(c.params);
  row(c, 1, 0);
  const sweeps = new Set();
  for (let t = 0; t < 3; t += 0.05) {
    stepBoat(c, 0.05, { level: 0 });
    mc.setRig(c, 0.05);
    sweeps.add(Math.sign(mc.rig.paddle.position.z));
  }
  assert.ok(mc.rig.paddle.visible && sweeps.has(1) && sweeps.has(-1), 'the paddle on both sides in turn');
});
