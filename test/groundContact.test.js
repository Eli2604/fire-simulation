import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { newCar, stepCarList } from '../src/sim/cars.js';
import { startEngine, pedals } from '../src/sim/carPhysics.js';
import { surfaceProps, surfaceGrip, rutAt, wheelOn, surfaceAt, groundTop } from '../src/sim/groundContact.js';
import { stepFloats } from '../src/sim/buoyancy.js';
import { boardSeat, row } from '../src/sim/boats.js';
import { initIce } from '../src/sim/ice.js';
import { MAT } from '../src/sim/materials.js';

/** A flat world of one ground material (h 0.2 m, 60 × 10 m), its voxels' moisture set if given. */
function ground(material, { moist, size = [60, 4, 10], weather = {} } = {}) {
  const sim = createSimulation({ world: { size, h: 0.2, ground: material }, weather: { ambient: 15, windSpeed: 0, ...weather }, objects: [], noFire: true });
  const w = sim.world;
  if (moist != null) for (let i = 0; i < w.N; i++) if (w.mat[i]) w.moist[i] = moist;
  return { sim, w };
}
/** A car on it at (x, z) heading +x, you at the wheel, the engine running. */
function carOn(sim, x = 5, z = 5, params = {}) {
  const c = newCar(params, { x, y: 0.2, z });
  c.player = true;
  startEngine(c);
  const ctx = { world: sim.world, sim };
  drive(c, ctx, 1.5, () => ({ throttle: 0, brake: 1, steer: 0 }));
  return { c, ctx };
}
function drive(c, ctx, T, fn, dt = 1 / 30) {
  for (let t = 0; t < T; t += dt) {
    c.input = fn(c, t);
    ctx.world.time += dt;
    stepCarList([c], dt, ctx);
  }
}
const floor = (c) => ({ ...pedals(c, 1, 0), steer: 0 });

test('grip: dry asphalt > rock > gravel > wet grass > mud > snow > ice (peak and sliding); wet, frozen, a film of water at speed lose grip', () => {
  const order = [['asphalt'], ['rock'], ['gravel'], ['grass', { wet: 1 }], ['mud'], ['snow'], ['ice']].map(([k, s]) => ({ k, ...surfaceProps(k, s) }));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i].muPeak < order[i - 1].muPeak, `${order[i - 1].k} ${order[i - 1].muPeak.toFixed(2)} > ${order[i].k} ${order[i].muPeak.toFixed(2)}`);
    assert.ok(order[i].muSlide < order[i].muPeak, `${order[i].k}: sliding below peak`);
  }
  assert.ok(order[0].muPeak >= 0.95 && order.at(-1).muPeak <= 0.12, 'asphalt ~1, ice ~0.1');
  assert.ok(surfaceProps('grass', { wet: 1 }).muPeak < surfaceProps('grass', { wet: 0 }).muPeak - 0.15, 'wet grass is slippery');
  assert.ok(surfaceProps('asphalt', { wet: 1 }).muPeak < 0.8, 'wet asphalt');
  assert.ok(surfaceProps('mud', { soak: 1 }).muPeak < surfaceProps('mud').muPeak, 'soaked mud worse');
  assert.ok(surfaceProps('soil', { frozen: true }).bek === undefined, 'frozen soil does not give');
  assert.ok(surfaceProps('asphalt', { water: 0.01, speed: 28 }).muPeak < 0.4, 'aquaplaning on a film of water at 100 km/h');
  // soft ground sinks (Bekker) and resists: deeper and harder in soaked mud than on dry soil; none on rock
  const W = 3200;
  const on = (k, s = {}) => wheelOn({ ...surfaceProps(k, s), rut: 0, give: 0.4 }, W);
  assert.equal(on('rock').z, 0);
  assert.ok(on('soil').z < 0.03 && on('soil').rr < 0.03, `dry soil: ${on('soil').z.toFixed(3)} m, rr ${on('soil').rr.toFixed(3)}`);
  assert.ok(on('mud', { soak: 1 }).z > 0.15 && on('mud', { soak: 1 }).rr > 0.08, `soaked mud: ${on('mud', { soak: 1 }).z.toFixed(3)} m, rr ${on('mud', { soak: 1 }).rr.toFixed(3)}`);
  assert.ok(on('sand').z > on('soil').z && on('sand').rr > on('soil').rr, 'dry sand: softer than soil');
  // in the world: the voxels' material and moisture decide (the surfaceGrip any wheel can ask)
  const dry = surfaceGrip(ground('soil', { moist: 0.05 }).w, 20, 5), wet = surfaceGrip(ground('soil', { moist: 0.34 }).w, 20, 5);
  assert.ok(dry.surface === 'soil' && wet.mu < dry.mu - 0.15 && wet.sink >= dry.sink, `soil dry μ ${dry.mu.toFixed(2)}, wet ${wet.mu.toFixed(2)}`);
  const rk = surfaceGrip(ground('hillRock').w, 20, 5);
  assert.ok(rk.surface === 'rock' && rk.sink === 0 && Math.abs(rk.y - 0.2) < 1e-9);
  // a spinning wheel grips with the sliding μ
  assert.ok(surfaceGrip(ground('soil', { moist: 0.05 }).w, 20, 5, { slip: 2 }).mu < dry.mu);
});

test('a car on mud: the wheels spin (patinate), it slows, throws mud; on dry soil it gets away', () => {
  const soil = ground('soil', { moist: 0.05 });
  const A = carOn(soil.sim);
  drive(A.c, A.ctx, 6, floor);
  const mud = ground('mud');
  const B = carOn(mud.sim);
  let spin = 0, spray = 0, slip = 0;
  drive(B.c, B.ctx, 6, (c) => {
    spin = Math.max(spin, c.ground?.spin ?? 0);
    slip = Math.max(slip, Math.abs(c.slipR));
    spray = Math.max(spray, mud.w.groundMarks?.spray.length ?? 0);
    return floor(c);
  });
  const dA = A.c.x - 5, dB = B.c.x - 5;
  assert.ok(dA > 30, `on soil: ${dA.toFixed(1)} m in 6 s`);
  assert.ok(dB < dA * 0.5, `on mud: ${dB.toFixed(1)} m (soil ${dA.toFixed(1)})`);
  assert.ok(slip > 3 && spin > 5, `the rear wheels spin: κ ${slip.toFixed(1)}, ${spin.toFixed(1)} m/s of slip`);
  assert.ok(B.c.ground.surface === 'mud' && B.c.ground.mu < 0.35);
  assert.ok(spray > 20, `mud thrown: ${spray} bits`);
  assert.ok(B.c.spinR > (B.c.odo / B.c.spec.wheelR) * 2, 'the wheels drawn turning faster than the car goes');
  // heard: the churn of the spinning wheels
  return import('../src/audio/carSound.js').then(({ carSoundParams }) => {
    const P = carSoundParams(B.c);
    assert.ok(P.spin > 0.3 && P.scrub > 0.3, `churning: spin ${P.spin.toFixed(2)}, scrub ${P.scrub.toFixed(2)}`);
  });
});

test('ruts: the wheels leave them in mud, deeper with each pass; the car sits in them; nothing beside the track', () => {
  const { sim, w } = ground('mud', { moist: 0.4 });
  // (four-wheel drive: each wheel has its own grip (sim/carPhysics.js), and a rear-driven car's
  // wheels spinning in the slurry of their own ruts get it only so far on the third pass)
  const { c, ctx } = carOn(sim, 5, 5, { drivetrain: 'awd' });
  const track = (k) => c.spec.track / 2 * k;
  const at = (x) => rutAt(w, x, 5 + track(1));
  const depths = [];
  for (let pass = 0; pass < 3; pass++) {
    Object.assign(c, { x: 5, z: 5, yaw: 0, vx: 0, vz: 0, wz: 0, omega: 0 });
    for (const wl of c.gc?.wheels ?? []) wl.px = wl.pz = NaN;
    drive(c, ctx, 14, (c) => (c.x > 22 ? { throttle: 0, brake: 1, steer: 0 } : { ...pedals(c, Math.max(0, Math.min(0.5, (3 - c.u) * 0.4)), 0), steer: 0 }));
    assert.ok(c.x > 20, `pass ${pass + 1} got through (${c.x.toFixed(1)})`);
    let d = 0;
    for (let x = 12; x < 16; x += 0.1) d += at(x);
    depths.push(d / 40);
  }
  assert.ok(depths[0] > 0.015, `a rut after one pass: ${(depths[0] * 100).toFixed(1)} cm`);
  assert.ok(depths[2] > depths[0] * 1.2, `deeper with passes: ${depths.map((d) => (d * 100).toFixed(1)).join(' → ')} cm`);
  assert.ok(rutAt(w, 14, 5) < 0.005 && rutAt(w, 14, 5 + track(1) + 0.6) < 0.005, 'none between or beside the wheels');
  // a wheel in the rut sits down in it and rolls harder (the rut's slurry, its walls)
  const g = groundTop(w, 14, 5 + track(1), 3);
  const S = surfaceAt(w, g, 14, 5 + track(1));
  const T = wheelOn(S, 3200);
  const S0 = surfaceAt(w, groundTop(w, 14, 9, 3), 14, 9);
  const T0 = wheelOn(S0, 3200);
  assert.ok(T.depth > T0.depth && T.rr > T0.rr, `in the rut: ${(T.depth * 100).toFixed(1)} cm, rr ${T.rr.toFixed(3)} vs ${(T0.depth * 100).toFixed(1)} cm, ${T0.rr.toFixed(3)}`);
  // its berm and the decal drawn
  assert.ok([...w.groundMarks.cells.values()].some((r) => r.berm > 0.003), 'mud pushed up beside the ruts');
  return import('../src/render/groundMarks.js').then(async ({ GroundMarksRenderer }) => {
    const THREE = await import('three');
    const R = new GroundMarksRenderer(new THREE.Group());
    R.setWorld(w);
    R.update();
    assert.ok(R.marks.count > 50, `ruts drawn: ${R.marks.count}`);
  });
});

test('snow: the tyres pack it down (tracks: less depth, denser under the wheels); grip is low', () => {
  const sim = createSimulation({ world: { size: [40, 4, 10], h: 0.2, ground: 'soil' }, weather: { ambient: -6, windSpeed: 0, snowCover: 0.25, sunshine: 0 }, objects: [], noFire: true });
  const w = sim.world;
  assert.ok(w.snow, 'snow lying');
  const S = w.snow;
  const { c, ctx } = carOn(sim);
  const g0 = surfaceGrip(w, 20, 5);
  assert.ok(g0.surface === 'snow' && g0.mu < 0.25 && g0.snow > 0.2, `on snow: μ ${g0.mu.toFixed(2)}, ${g0.snow.toFixed(2)} m`);
  drive(c, ctx, 8, (c) => ({ ...pedals(c, Math.max(0, Math.min(0.6, (4 - c.u) * 0.4)), 0), steer: 0 }));
  assert.ok(c.x > 15, `it drove through (${c.x.toFixed(1)})`);
  assert.equal(c.ground.surface, 'snow');
  const zt = 5 + c.spec.track / 2;
  const under = S.depthAt(12, zt), beside = S.depthAt(12, zt + 0.9);
  assert.ok(under < beside * 0.75, `tracks: ${(under * 100).toFixed(1)} cm under the wheels, ${(beside * 100).toFixed(1)} beside`);
  assert.ok(S.rho[S.cell(12, zt)] > S.rho[S.cell(12, zt + 0.9)] * 1.3, 'packed denser');
  assert.ok(c.y < 0.2 + beside, 'it rides down in the snow');
});

test('stuck: in deep soaked mud the car sinks onto its belly, the wheels spin, it does not get out (high-centred)', () => {
  const { sim, w } = ground('mud', { moist: 0.86 });
  const { c, ctx } = carOn(sim);
  let spun = 0;
  drive(c, ctx, 8, (c) => {
    spun = Math.max(spun, c.ground?.spin ?? 0);
    return floor(c);
  });
  assert.ok(c.x - 5 < 1.5, `went ${(c.x - 5).toFixed(2)} m`);
  assert.ok(c.ground.stuck, 'stuck');
  assert.ok(c.ground.sink > c.gc.clearance || c.ground.belly > 0.3, `sunk ${(c.ground.sink * 100).toFixed(0)} cm (clearance ${(c.gc.clearance * 100).toFixed(0)}), belly ${c.ground.belly.toFixed(2)}`);
  assert.ok(spun > 5, `the wheels spun (${spun.toFixed(1)} m/s)`);
  assert.ok(rutAt(w, 5 - c.spec.wheelX, 5 + c.spec.track / 2) > 0.1, 'dug itself in');
  // the same car on firm ground drives off
  const firm = ground('soil', { moist: 0.05 });
  const F = carOn(firm.sim);
  drive(F.c, F.ctx, 3, floor);
  assert.ok(F.c.x - 5 > 5 && !F.c.ground.stuck);
});

test('ice: the car slides — it brakes over a far longer way, it slides on in a turn', () => {
  // a frozen pond: water over the soil, 25 cm of ice on it
  const mk = (ice) => {
    const { sim, w } = ground('soil', { moist: 0.05, weather: ice ? { ambient: -8 } : {} });
    if (ice) {
      for (let x = 0; x < w.nx; x++) for (let z = 0; z < w.nz; z++) w.setVoxel(w.idx(x, 1, z), MAT.water, { liquid: true, temp: 1 });
      w.rebuildLists();
      w.updateDerived?.();
      initIce(w, 0.25);
    }
    return { sim, w };
  };
  const icy = mk(true);
  const gi = surfaceGrip(icy.w, 20, 5);
  assert.ok(gi.surface === 'ice' && gi.mu <= 0.1 && Math.abs(gi.y - 0.4) < 0.05, `on the ice: ${gi.surface} μ ${gi.mu.toFixed(2)} at ${gi.y.toFixed(2)} m`);
  const stop = ({ sim }) => {
    const { c, ctx } = carOn(sim);
    c.y = 0.4;
    Object.assign(c, { vx: 10, u: 10 });
    c.mode = 'N';
    c.gear = 0;
    const x0 = c.x;
    let alpha = 0;
    drive(c, ctx, 12, (c, t) => {
      if (t < 1) alpha = Math.abs(c.yaw); // (how far it turned while the wheel was over)
      return t < 1 ? { throttle: 0, brake: 0, steer: 0.7 } : { throttle: 0, brake: 1, steer: 0 };
    });
    return { d: Math.hypot(c.x - x0, c.z - 5), alpha };
  };
  const onIce = stop(icy), onSoil = stop(mk(false));
  assert.ok(onIce.d > onSoil.d * 2.5, `stopping: ${onIce.d.toFixed(1)} m on ice, ${onSoil.d.toFixed(1)} m on soil`);
  assert.ok(onIce.alpha < onSoil.alpha * 0.6, `the wheel over, it slides on rather than turn: ${onIce.alpha.toFixed(2)} rad on ice, ${onSoil.alpha.toFixed(2)} on soil`);
});

test('a boat run onto a sand shoal grounds: its keel ploughs a furrow, it stops; afloat it leaves a wake', () => {
  const sim = createSimulation({ world: { size: [30, 3, 8], h: 0.1, ground: 'beachSand' }, objects: [{ type: 'rowBoat', params: { crew: 0, moored: false }, x: 5, z: 4, y: 0.9 }], noFire: true, weather: { windSpeed: 0 } });
  const w = sim.world;
  const f = w.floats[0];
  const own = new Set(f.own);
  // the bed: flat 0.1 m, then a bank up to a shoal 10 cm under the water (level 1.0 m)
  const bed = (x) => Math.min(0.9, 0.1 + Math.max(0, x - 12) * 0.2);
  for (let x = 0; x < w.nx; x++)
    for (let z = 0; z < w.nz; z++) {
      const top = Math.round(bed((x + 0.5) * w.h) / w.h);
      for (let y = 1; y < 12; y++) {
        const i = w.idx(x, y, z);
        if (own.has(i)) continue;
        if (y < top) w.setVoxel(i, MAT.beachSand, { anchored: true, moisture: 0.24 });
        else if (y < 10 && !w.mat[i]) w.mat[i] = MAT.water;
      }
    }
  w.rebuildLists();
  stepFloats(sim, 0.05);
  boardSeat(f, { name: 'rower', mass: 80 });
  row(f, 1, 0);
  let touchX = null, wake = 0;
  for (let k = 0; k < 600; k++) {
    w.time += 0.05;
    stepFloats(sim, 0.05);
    wake = Math.max(wake, w.groundMarks?.wake.length ?? 0);
    if (f.groundTouch && touchX === null) touchX = f.body.X;
  }
  assert.ok(wake > 10, `a wake behind it while it rowed (${wake} patches)`);
  assert.ok(touchX !== null && touchX > 12, `it touched the bank at ${touchX?.toFixed(1)}`);
  const v = Math.hypot(f.body.vx, f.body.vz);
  assert.ok(f.body.X - touchX < 3 && v < 0.15, `stopped ${(f.body.X - touchX).toFixed(2)} m on, at ${v.toFixed(2)} m/s, still rowing`);
  assert.ok(f.water.level > 0.95 && !f.body.sunk, 'still afloat on the pond, its level kept');
  let cells = 0;
  for (let x = touchX - 1; x < f.body.X + 3; x += 0.1) if (rutAt(w, x, 4) > 0.005 || rutAt(w, x, 4.1) > 0.005) cells++;
  assert.ok(cells >= 5, `a furrow in the sand (${cells} cells)`);
});

test('grass: the wheels flatten the tall blades and, spinning on wet grass, tear the turf to soil', () => {
  const { sim, w } = ground('soil', { weather: { rain: 6 } });
  // turf on the soil, tall grass standing on it
  for (let x = 0; x < w.nx; x++)
    for (let z = 0; z < w.nz; z++) {
      w.setVoxel(w.idx(x, 1, z), MAT.grass, { anchored: true, moisture: 0.9 });
      w.setVoxel(w.idx(x, 2, z), MAT.grass, { moisture: 0.9 });
    }
  w.rebuildLists();
  const { c, ctx } = carOn(sim);
  c.y = 0.4;
  w.groundMarks.rainWet = 1; // (it has been raining)
  const g = surfaceGrip(w, 20, 5);
  assert.ok(g.surface === 'grass' && g.mu < 0.42 && Math.abs(g.y - 0.4) < 0.03, `wet turf: μ ${g.mu.toFixed(2)} at ${g.y.toFixed(2)} m (under the blades)`);
  drive(c, ctx, 4, floor);
  const zt = 5 + c.spec.track / 2;
  let flat = 0, torn = 0;
  for (let x = 6; x < Math.min(c.x, 20); x += w.h) {
    const cx = Math.floor(x / w.h), cz = Math.floor(zt / w.h);
    if (!w.mat[w.idx(cx, 2, cz)]) flat++;
  }
  const cx0 = Math.floor((5 - c.spec.wheelX) / w.h);
  for (let dx = -2; dx <= 3; dx++) for (let dz = -1; dz <= 1; dz++) if (w.mat[w.idx(cx0 + dx, 1, Math.floor(zt / w.h) + dz)] === MAT.soil) torn++;
  assert.ok(flat > 10, `blades flattened along the track (${flat})`);
  assert.ok(torn > 0, `the turf torn to soil where the wheels spun at the start (${torn})`);
  assert.equal(w.mat[w.idx(Math.floor(14 / w.h), 2, Math.floor(8.5 / w.h))], MAT.grass, 'the grass off the track still stands');
});
