import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeRowBoat } from '../src/models/rowBoat.js';
import { launchBoat, stepBoat, boardSeat, seatWorld, row, startMotor, OARS, HIKE } from '../src/sim/boats.js';
import { seatPose, crewOf, placeCrew, boatmen, SIT_DROP } from '../src/sim/boatCrew.js';
import { operatorClips, OperatorFigure, solve, pose0, weaponKit, boatClipPose, LABELS, ROW_DRIVE } from '../src/operator/rig.js';
import { BoatCrewRenderer, SEATED_EYE } from '../src/render/boatCrew.js';
import { vehicleOf } from '../src/ai/vehicles.js';

const boat = (kind, p = {}) => launchBoat(placeRowBoat({ kind, moored: false, ...p }, [0, 0, 0], 0.1).floats[0]);
const run = (f, s, env = {}) => {
  for (let t = 0; t < s; t += 0.05) stepBoat(f, 0.05, { level: 0, t, ...env });
};
const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The operator's assets as stand-ins (no sculpting in Node), as test/gear.test.js has them. */
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

test('seats: each one in his seat (his feet on the boards under it), the rower facing aft, the rest forward', () => {
  const f = boat('row');
  const r = { name: 'rower' }, p = { name: 'passenger' };
  boardSeat(f, r);
  const k = boardSeat(f, p);
  placeCrew(f);
  for (const [m, i] of [[r, 0], [p, k]]) {
    const s = seatWorld(f, i);
    const up = f.body.pose.R;
    const want = [s.p[0] - up[1] * SIT_DROP, s.p[1] - up[4] * SIT_DROP, s.p[2] - up[7] * SIT_DROP];
    assert.ok(dist(m.p, want) < 0.08, `${m.name}: under his seat (${dist(m.p, want).toFixed(3)} m off)`);
    assert.ok(m.boatSeated && m.frame && m.frame.u[1] > 0.99);
  }
  assert.equal(r.seatYaw, Math.PI, 'the rower faces aft');
  assert.equal(p.seatYaw, 0, 'a passenger forward');
  // a figure's yaw: yaw 0 looks along +z; the boat's bow (cos yaw, −sin yaw)
  const fw = [Math.sin(p.yaw), Math.cos(p.yaw)], bow = [Math.cos(f.body.yaw), -Math.sin(f.body.yaw)];
  assert.ok(fw[0] * bow[0] + fw[1] * bow[1] > 0.99, 'the passenger looks to the bow');
  assert.equal(p.anim, 'boatSit');
  assert.equal(r.anim, 'boatSit', 'oars shipped: sitting');
  // a man aiming over the side, one firing
  p.aimAt = [5, 0, 5];
  placeCrew(f);
  assert.equal(p.anim, 'sitAim');
  p.vehFiring = true;
  placeCrew(f);
  assert.equal(p.anim, 'sitShoot');
});

test('the rower pulls in step with the oars: his clip at the stroke\'s phase, the catch with his hands out to the stern, the finish at his chest', () => {
  const f = boat('row');
  const r = { name: 'rower' };
  boardSeat(f, r);
  row(f, 1, 0);
  const seen = [];
  for (let t = 0; t < 4; t += 0.05) {
    stepBoat(f, 0.05, { level: 0, t });
    placeCrew(f);
    assert.equal(r.anim, 'boatRow');
    seen.push([r.animPhase, f.row.oars[0].phase]);
  }
  for (const [a, b] of seen) assert.ok(Math.abs(a - b) < 1e-9, 'the oar\'s phase');
  assert.ok(new Set(seen.map(([a]) => Math.round(a * 10))).size >= 8, 'through the whole stroke');
  // the clip: hands out at the catch, in at the finish (figure space: +z ahead of him)
  const c = boatClipPose('boatRow', 0.0), fin = boatClipPose('boatRow', ROW_DRIVE);
  assert.ok(c.lTW[2] > 0.5 && fin.lTW[2] < 0.1, `hands ${c.lTW[2].toFixed(2)} → ${fin.lTW[2].toFixed(2)}`);
  assert.ok(c.spine[0] > 0.2 && fin.spine[0] < -0.1, 'leaning forward to the catch, back at the finish');
  assert.equal(OARS.drive, ROW_DRIVE);
  // backing water: the stroke the other way round
  row(f, -1, 0);
  run(f, 2.2);
  placeCrew(f);
  assert.equal(f.row.oars[0].dir, -1);
  for (const k of ['boatRow', 'boatPaddle', 'boatHelm', 'boatHike', 'boatSit', 'sitAim', 'sitShoot']) assert.ok(operatorClips()[k] && LABELS[k], k);
});

test('the helmsman\'s hand goes with the tiller; the paddlers paddle on their sides; the sailing crew hike out and that rights it', () => {
  // an outboard: the handle swings to port as the tiller goes to starboard
  const m = boat('motor');
  const h = { name: 'helm' };
  boardSeat(m, h);
  startMotor(m);
  run(m, 2);
  row(m, 0.5, 1);
  run(m, 1);
  placeCrew(m);
  assert.equal(h.anim, 'boatHelm');
  assert.ok(h.animPhase > 0.6, `hand over to his left: ${h.animPhase.toFixed(2)}`);
  row(m, 0.5, -1);
  run(m, 1);
  placeCrew(m);
  assert.ok(h.animPhase < 0.4, `and to his right: ${h.animPhase.toFixed(2)}`);
  // a canoe: the stern paddler on one side, the bow paddler on the other
  const c = boat('canoe');
  const sp = { name: 'stern' }, bp = { name: 'bow' };
  boardSeat(c, sp);
  boardSeat(c, bp);
  row(c, 1, 0);
  run(c, 0.6);
  placeCrew(c);
  assert.equal(sp.anim, 'boatPaddle');
  assert.equal(bp.anim, 'boatPaddle');
  assert.ok(sp.animPhase < 0.5 !== bp.animPhase < 0.5, 'on opposite sides');
  // a sailing dinghy beam on to a fresh breeze: the crew go out to windward; held in, it heels more
  const sail = (reach) => {
    const s = boat('sail');
    const helm = { name: 'helm' }, crew = { name: 'crew' };
    boardSeat(s, helm);
    boardSeat(s, crew);
    const keep = HIKE.reach;
    HIKE.reach = reach;
    HIKE.helm = reach ? 0.3 : 0;
    let roll = 0;
    try {
      // (sailing along x, the wind from +z: heeled to −z, port; the crew go out to starboard)
      for (let t = 0; t < 30; t += 0.05) {
        s.row.autoTrim = true;
        s.row.turn = Math.max(-1, Math.min(1, 1.5 * wrap(s.body.yaw) + 0.8 * s.body.wy));
        stepBoat(s, 0.05, { level: 0, t, wind: { speed: 7, dir: -Math.PI / 2 } });
        // (the most it heels, coming up to speed: held in, it then rounds up into the wind)
        if (t < 12) roll = Math.max(roll, Math.abs(s.body.roll));
      }
    } finally {
      HIKE.reach = keep;
      HIKE.helm = 0.3;
    }
    placeCrew(s);
    return { s, crew, roll };
  };
  const out = sail(0.55), sat = sail(0);
  assert.ok(out.s.sailState.hike > 0.2, `hiking ${out.s.sailState.hike.toFixed(2)}`);
  assert.equal(out.s.sailState.hikeSide, 1, 'out over the windward side (starboard)');
  const L = out.s.body.loads.find((q) => q.who === out.crew);
  assert.ok(L.p[2] > L.base[2] + 0.1, `his weight out ${(L.p[2] - L.base[2]).toFixed(2)} m`);
  assert.ok(out.roll < sat.roll - 0.03, `heel ${((out.roll * 180) / Math.PI).toFixed(1)}° hiked vs ${((sat.roll * 180) / Math.PI).toFixed(1)}° sitting in`);
  assert.equal(out.crew.anim, 'boatHike');
  assert.ok(out.crew.animPhase < 0.5, 'leaning out over his right (starboard) side');
  // his figure with his weight: out towards the gunwale
  const P = seatPose(out.s, out.s.seats.findIndex((q) => q.who === out.crew));
  assert.ok(P.at[2] > out.s.seats.find((q) => q.who === out.crew).z + 0.1);
});

test('drawn: boatmen for the crew param, you only when the camera is not at your eyes, the rower\'s clip held at the stroke', () => {
  const f = boat('row', { crew: 2 });
  assert.equal(boatmen(f).length, 2, 'two boatmen');
  const me = { player: true, name: 'you' };
  boardSeat(f, me);
  row(f, 1, 0);
  run(f, 0.7);
  const all = crewOf(f);
  // (one of them sat on the rowing thwart: you have his place)
  assert.equal(all.length, 2);
  const parent = new THREE.Group();
  const R = new BoatCrewRenderer(parent, { assets: assets() });
  const world = { enemies: [] };
  const P = all.find((c) => c.who === me);
  // the camera at your eyes: you are not drawn
  const cam = new THREE.Object3D();
  cam.position.set(P.p[0], P.p[1] + SIT_DROP + SEATED_EYE, P.p[2]);
  cam.updateMatrixWorld();
  R.update(world, [f], 1 / 30, cam);
  assert.equal(R.figures.size, 1, 'the boatman');
  // from outside: you too, in your seat, rowing in step with the oars
  cam.position.set(P.p[0] + 8, P.p[1] + 3, P.p[2]);
  cam.updateMatrixWorld();
  R.update(world, [f], 1 / 30, cam);
  assert.equal(R.figures.size, 2);
  const mine = [...R.figures.values()].find((it) => it.who === me).fig;
  assert.equal(mine.shown, 'boatRow');
  assert.ok(Math.abs(mine.current.time / mine.current.getClip().duration - f.row.oars[0].phase) < 0.02, 'at the oar\'s phase');
  assert.ok(dist(mine.group.position.toArray(), P.p) < 1e-6, 'in the seat');
  // facing aft: his +z towards the stern
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(mine.group.quaternion);
  assert.ok(fwd.x < -0.95, 'facing aft (the bow is +x)');
  // the boatmen sit, unarmed
  const bm = [...R.figures.values()].filter((it) => !it.who);
  assert.ok(bm.every((it) => it.fig.shown === 'boatSit' && it.fig.loadout === 'unarmed'));
  // a soldier of the world's (render/enemies.js draws him) is not drawn here
  const sold = { name: 'soldier', squad: 'A' };
  boardSeat(f, sold);
  world.enemies.push(sold);
  R.update(world, [f], 1 / 30, cam);
  assert.ok(![...R.figures.values()].some((it) => it.who === sold));
  R.clear();
  assert.equal(parent.children.length, 0);
});

test('the squad\'s boat adapter seats its men with the boat\'s poses, in step with the stroke, tilted with it', () => {
  const f = boat('row');
  const V = vehicleOf(f);
  const a = { squad: 'A', p: [0, 0, 0] }, b = { squad: 'B', p: [0, 0, 0] };
  assert.ok(V.board(a, 0) && V.board(b, V.free?.()[0]?.i ?? 1));
  V.place();
  assert.equal(a.anim, 'boatSit');
  assert.ok(a.frame && a.seatYaw === Math.PI);
  row(f, 1, 0);
  run(f, 0.5);
  V.place();
  assert.equal(a.anim, 'boatRow');
  assert.equal(a.animPhase, f.row.oars[0].phase);
  V.leave(a);
  assert.ok(!a.boatSeated && a.animPhase == null && !a.frame);
});
