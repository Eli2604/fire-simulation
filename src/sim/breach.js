import { MAT } from './materials.js';
import { inHull } from './vacuum.js';

/**
 * A hull breach: one mechanism, two media, the sign reversed.
 *
 *  - A ship holed below the waterline (sim/water.js): the sea outside is at the higher pressure
 *    (ρ g Δh); it comes IN through the hole as a jet (√(2gΔh), Torricelli) and spreads into
 *    the compartment (`w.inflows`: position, inward direction, speed).
 *  - A spaceship holed (sim/vacuum.js): the cabin air inside is at the higher pressure (101 kPa
 *    against nothing); it goes OUT through the hole as a choked jet, the air in the whole
 *    compartment converging on it (`w.blow`: the velocity field per air cell, m/s).
 *
 * Whatever is loose in the compartment feels the moving medium the same way: the drag
 * ½·ρ·Cd·A·|u−v|·(u−v) against its weight and its friction on the floor (μ·m·g; a living soldier
 * holds on harder than a body lies; secured things and the voxel furniture bolted down do not
 * move). In the sea case that pushes things away from the hole, deeper into the ship (and the
 * flood water floats what floats); in the vacuum case it pulls them to the hole and out:
 *
 *  - something smaller than the hole goes through it and keeps drifting in space (no air, no
 *    gravity out there: the ship's gravity is artificial) – crates, soldiers, bodies;
 *  - something bigger than the hole is pressed into it and plugs it: the leak almost stops
 *    while it holds (sim/vacuum.js takes its area off the hole), until the pressure on it
 *    (p·A, tonnes) crushes or squeezes it through, or the compartment has nothing left.
 *
 * Fragments (debris) are carried by the same flow (sim/vessels.js stepDebris: breachFlowAt).
 */
const P0 = 101325;
const CD = 1.0;
const JET_L = 4; // how far a jet from the sea reaches into the ship (m)
// kind: mass (kg), smallest cross-section it can pass a hole with (m²), how long it holds a
// hole against full pressure (N·s), buoyancy (its weight in water displaced / its weight)
const KINDS = {
  crate: { mass: 12, section: 0.36, strength: 4.5e4, buoy: 2.5 }, // (a supply crate, light)
  drum: { mass: 180, section: 0.28, strength: 1.6e5, buoy: 1.2 },
  cylinder: { mass: 35, section: 0.08, strength: 3e5, buoy: 0.5 },
  dummy: { mass: 70, section: 0.12, strength: 6e4, buoy: 1.5 },
  body: { mass: 90, section: 0.12, strength: 6e4, buoy: 1.05 },
};

/**
 * The velocity (m/s, into out) of the medium moving through a breach at p, and its density
 * (kg/m³): the cabin air streaming to a hole in space (0 out in space itself), the sea's jet
 * coming in through a hole below the waterline (1025), still flood water (1000), still air.
 */
export function breachFlowAt(sim, p, out = [0, 0, 0]) {
  const w = sim.world;
  out[0] = out[1] = out[2] = 0;
  if (w.vacuum) {
    const a = sim.airCellAt(p[0], p[1], p[2]);
    if (a < 0) return 0; // space
    if (!w.press) return 1.2;
    const C = w.comps?.[w.comp?.[a] ?? -1];
    if (w.blow) {
      out[0] = w.blow[a * 3];
      out[1] = w.blow[a * 3 + 1];
      out[2] = w.blow[a * 3 + 2];
    }
    return 1.2 * (C ? C.Pm ?? C.P1 ?? w.press[a] : w.press[a]);
  }
  let rho = 1.2;
  const h = w.h;
  const x = Math.floor(p[0] / h);
  const y = Math.floor(p[1] / h);
  const z = Math.floor(p[2] / h);
  if (x >= 0 && y >= 0 && z >= 0 && x < w.nx && y < w.ny && z < w.nz && w.mat[w.idx(x, y, z)] === MAT.water) rho = 1000;
  if (!w.inflows?.length) return rho;
  let best = 0;
  for (const f of w.inflows) {
    const rx = p[0] - f.p[0];
    const ry = p[1] - f.p[1];
    const rz = p[2] - f.p[2];
    const along = rx * f.dir[0] + ry * f.dir[1] + rz * f.dir[2];
    if (along < -0.3 || along > JET_L) continue;
    const lat = Math.hypot(rx - f.dir[0] * along, ry - f.dir[1] * along, rz - f.dir[2] * along);
    const wide = 0.8 + Math.max(0, along) * 0.35;
    if (lat > wide) continue;
    const s = f.speed * (1 - Math.max(0, along) / JET_L) * Math.sqrt(1 - lat / wide);
    if (s <= best) continue;
    best = s;
    out[0] = f.dir[0] * s;
    out[1] = f.dir[1] * s;
    out[2] = f.dir[2] * s;
    rho = 1025;
  }
  return rho;
}

/** A solid voxel at p (flood water is not: things float and are pushed through it). */
function solidAt(w, px, py, pz) {
  const h = w.h;
  const x = Math.floor(px / h);
  const y = Math.floor(py / h);
  const z = Math.floor(pz / h);
  if (x < 0 || y < 0 || z < 0 || x >= w.nx || y >= w.ny || z >= w.nz) return !w.vacuum && y < 0;
  const m = w.mat[w.idx(x, y, z)];
  return m !== 0 && m !== MAT.water;
}

function waterAt(w, px, py, pz) {
  const h = w.h;
  const x = Math.floor(px / h);
  const y = Math.floor(py / h);
  const z = Math.floor(pz / h);
  if (x < 0 || y < 0 || z < 0 || x >= w.nx || y >= w.ny || z >= w.nz) return false;
  return w.mat[w.idx(x, y, z)] === MAT.water;
}

const U = [0, 0, 0];
const PULL = [0, 0, 0];

/**
 * Right up against a hole in a pressure hull the flow is not what holds a thing there: the
 * pressure is. What covers (part of) the hole has the cabin pressure behind it and nothing in
 * front: p·A pulls it on (N, into PULL).
 */
function holePull(w, c, B) {
  PULL[0] = PULL[1] = PULL[2] = 0;
  if (!w.vacuum || !w.holes?.length) return PULL;
  for (const H of w.holes) {
    const C = w.comps?.[H.comp];
    if (!(C?.P1 > 0.02)) continue;
    const dx = c[0] - H.c[0];
    const dy = c[1] - H.c[1];
    const dz = c[2] - H.c[2];
    const along = -(dx * H.n[0] + dy * H.n[1] + dz * H.n[2]); // (how far in from the hole)
    const ext = Math.abs(H.n[1]) > 0.7 ? B.half : B.r;
    if (along < 0 || along > ext + 0.45) continue;
    const lat = Math.hypot(dx + H.n[0] * along, dy + H.n[1] * along, dz + H.n[2] * along);
    const rh = 0.5 * Math.sqrt(H.area);
    if (lat > rh + B.r) continue;
    const cover = Math.min(B.section, H.area) * Math.min(1, (rh + B.r - lat) / (2 * rh || 1));
    const F = C.Pm * P0 * cover;
    for (let k = 0; k < 3; k++) PULL[k] += H.n[k] * F;
  }
  return PULL;
}

/**
 * One step of a loose thing in a breach's flow. B: { c (its middle), v, r, half, mass, A,
 * mu, section, strength, buoy }; x: the thing itself (its breach state: swept, plug (a hole's
 * index while the holes stay as they are), ghost (going through a hole: its centre and normal),
 * drift). Returns an event name when something happened ('plugged', 'blownOut', 'ejected').
 */
function stepBody(sim, x, B, dt) {
  const w = sim.world;
  const { c, v } = B;
  if (x.drift) {
    // out in space: on it goes, tumbling, nothing to slow it down
    for (let k = 0; k < 3; k++) c[k] += v[k] * dt;
    const far = Math.hypot(c[0] - w.size[0] / 2, c[1] - w.size[1] / 2, c[2] - w.size[2] / 2);
    if (far > 600) x.gone = true;
    return null;
  }
  const holes = w.holes ?? [];
  if (x.plug != null) {
    const H = holes[x.plug];
    const C = H && w.comps?.[H.comp];
    if (!H || !C) {
      x.plug = null;
      x.swept = true;
    } else {
      // pressed into the hole by the cabin pressure behind it, until that crushes it through
      const F = C.P1 * P0 * Math.min(B.section, H.area);
      x.plugDmg = (x.plugDmg ?? 0) + (F / B.strength) * dt;
      v[0] = v[1] = v[2] = 0;
      if (x.plugDmg < 1) return null;
      x.plug = null;
      x.ghost = { n: H.n.slice(), c: H.c.slice() };
      x.swept = true;
      const sp = 10 + 30 * C.P1;
      for (let k = 0; k < 3; k++) v[k] = H.n[k] * sp;
      return 'blownOut';
    }
  }
  let rho = breachFlowAt(sim, c, U);
  const inside = !w.vacuum || inHull(w, c);
  const g = inside ? 9.81 : 0;
  const m = B.mass;
  const drag = (k) => 0.5 * rho * CD * B.A * Math.hypot(U[0] - v[0], U[1] - v[1], U[2] - v[2]) * (U[k] - v[k]);
  const onFloor = () => solidAt(w, c[0], c[1] - B.half - 0.05, c[2]);
  const wetBottom = B.buoy > 1 && waterAt(w, c[0], c[1] - B.half + 0.05, c[2]);
  let pull = holePull(w, c, B);
  if (!x.swept) {
    if (x.secured) return null;
    const fh = Math.hypot(drag(0) + pull[0], drag(2) + pull[2]);
    const grip = B.mu * m * g;
    if (!(fh > grip || drag(1) + pull[1] > m * g || wetBottom || !onFloor())) return null;
    x.swept = true;
  }
  let event = null;
  const n = Math.min(40, Math.max(1, Math.ceil((Math.hypot(...v) * dt) / (0.4 * w.h)), Math.ceil(dt / 0.01)));
  const sdt = dt / n;
  for (let s = 0; s < n; s++) {
    if (s > 0) {
      rho = breachFlowAt(sim, c, U);
      pull = holePull(w, c, B);
    }
    const floor = onFloor();
    const a = [(drag(0) + pull[0]) / m, (drag(1) + pull[1]) / m - g, (drag(2) + pull[2]) / m];
    // floating: the water it displaces (where its middle and its bottom are in the water)
    if (B.buoy > 0 && rho >= 1000) {
      const sub = (waterAt(w, c[0], c[1], c[2]) ? 0.5 : 0) + (waterAt(w, c[0], c[1] - B.half * 0.8, c[2]) ? 0.5 : 0);
      a[1] += g * B.buoy * sub;
    }
    for (let k = 0; k < 3; k++) v[k] += a[k] * sdt;
    if (floor && x.ghost == null) {
      // sliding: friction against the floor
      const vh = Math.hypot(v[0], v[2]);
      if (vh > 0) {
        const f = Math.min(vh, 0.4 * g * sdt) / vh;
        v[0] -= v[0] * f;
        v[2] -= v[2] * f;
      }
      if (v[1] < 0) v[1] = 0;
    }
    if (x.ghost != null) {
      // going through the hole: straight out along it
      const H = x.ghost;
      // (through in a moment; if it is not out by then, it was not a way out after all)
      x.ghostT = (x.ghostT ?? 0) + sdt;
      if (x.ghostT > 1) {
        x.ghost = null;
        x.ghostT = 0;
        continue;
      }
      if (H) {
        const sp = Math.max(6, v[0] * H.n[0] + v[1] * H.n[1] + v[2] * H.n[2]);
        for (let k = 0; k < 3; k++) v[k] = H.n[k] * sp;
      }
      for (let k = 0; k < 3; k++) c[k] += v[k] * sdt;
    } else {
      for (let k = 0; k < 3; k++) {
        const d = v[k] * sdt;
        if (!d) continue;
        const sgn = Math.sign(d);
        const ext = k === 1 ? B.half : B.r;
        const p = c.slice();
        p[k] += d + sgn * ext;
        let hit = solidAt(w, p[0], p[1], p[2]);
        if (!hit && k !== 1) hit = solidAt(w, p[0], p[1] - B.half * 0.7, p[2]);
        if (hit) {
          if (k === 1 && sgn < 0 && Math.abs(v[1]) > 8) x.impact = Math.max(x.impact ?? 0, Math.abs(v[1]));
          if (k !== 1 && Math.abs(v[k]) > 8) x.impact = Math.max(x.impact ?? 0, Math.abs(v[k]));
          v[k] *= k === 1 ? 0 : -0.2;
        } else c[k] += d;
      }
    }
    if (w.vacuum) {
      if (!inHull(w, c)) {
        // out through the hole: in space now
        x.drift = true;
        x.ghost = null;
        x.ghostT = 0;
        x.swept = false;
        const H = x.lastHole;
        if (H) {
          const out = v[0] * H.n[0] + v[1] * H.n[1] + v[2] * H.n[2];
          if (out < 3) for (let k = 0; k < 3; k++) v[k] += H.n[k] * (3 - out);
        }
        x.spin = [(sim.rand() - 0.5) * 3, (sim.rand() - 0.5) * 2, (sim.rand() - 0.5) * 3];
        return 'ejected';
      }
      if (x.ghost == null) {
        // at a hole: through it if it fits, stuck in it if it does not
        for (const H of holes) {
          const C = w.comps[H.comp];
          const dx = c[0] - H.c[0];
          const dy = c[1] - H.c[1];
          const dz = c[2] - H.c[2];
          const reach = Math.max(B.r, B.half) + 0.45 + 0.5 * Math.sqrt(H.area);
          if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
          // (moving towards it, or held on by the pressure)
          if (v[0] * H.n[0] + v[1] * H.n[1] + v[2] * H.n[2] <= 0.5 && pull[0] * H.n[0] + pull[1] * H.n[1] + pull[2] * H.n[2] <= 0) continue;
          x.lastHole = { n: H.n.slice(), c: H.c.slice() };
          if (B.section > H.area * 1.05) {
            if (!(C?.P1 > 0.02)) continue;
            x.plug = H.id;
            x.plugDmg = x.plugDmg ?? 0;
            v[0] = v[1] = v[2] = 0; // (where it is: against the hole)
            return 'plugged';
          }
          x.ghost = x.lastHole;
          break;
        }
      }
    }
  }
  // come to rest: on the floor, slow, and the flow no longer moves it
  if (onFloor() && Math.hypot(...v) < 0.15 && x.ghost == null) {
    const fh = Math.hypot(drag(0) + pull[0], drag(2) + pull[2]);
    const afloat = B.buoy > 1 && waterAt(w, c[0], c[1] - B.half + 0.05, c[2]);
    if (fh <= B.mu * m * g && !afloat) {
      x.swept = false;
      v[0] = v[1] = v[2] = 0;
      const h = w.h;
      c[1] = (Math.floor((c[1] - B.half - 0.05) / h) + 1) * h + B.half;
    }
  }
  return event;
}

/** Loose things, soldiers and bodies in the flow of a breach (each motion step). */
export function stepBreach(sim, dt) {
  const w = sim.world;
  if (!(dt > 0)) return;
  const sea = !!w.sea?.ship; // (a ship afloat: an island's sea has no hull to breach)
  if (!((w.vacuum && w.blow) || sea)) return;
  for (const H of w.holes ?? []) H.plugArea = 0;
  // the loose objects
  for (const o of w.loose ?? []) {
    if (o.gone || o.held || (o.flying && !o.swept && !o.drift)) continue;
    const K = KINDS[o.kind] ?? KINDS.crate;
    const B = { c: o.p, v: o.v, r: o.r ?? 0.3, half: o.half ?? 0.3, mass: o.mass ?? K.mass, A: 4 * (o.r ?? 0.3) * (o.half ?? 0.3), mu: 0.4, section: K.section, strength: K.strength, buoy: o.burst ? 0 : K.buoy };
    if (!o.swept && !o.drift && o.plug == null && !w.inflows?.length && !(w.vacuum && w.decompressing) && !sea) continue;
    const ev = stepBody(sim, o, B, dt);
    o.flying = !!(o.swept || o.drift || o.plug != null);
    if (o.flying) {
      const sp = o.drift ? o.spin ?? [0, 1, 0] : [o.v[2] * 0.6, 1.5, -o.v[0] * 0.6];
      for (let k = 0; k < 3; k++) o.rot[k] += sp[k] * dt * (o.swept && Math.hypot(...o.v) < 1 ? 0.1 : 1);
    }
    if (o.impact && o.impact > 9 && o.kind === 'crate') o.broken = true;
    o.impact = 0;
    if (ev) w.events.push({ type: ev, pos: o.p.slice(), time: w.time, name: `a ${o.kind}` });
    if (ev === 'blownOut' && o.kind === 'crate') o.broken = true;
  }
  // the soldiers, living (they hold on) and dead
  for (const e of w.enemies ?? []) {
    if (e.devoured || (e.held && !e.breachHeld)) continue;
    // in a vented compartment: no pressure (their suits give them air, not pressure)
    if (w.vacuum && !e.dead) {
      const a = sim.airCellAt(e.p[0], e.p[1] + 1.2, e.p[2]);
      const P = a >= 0 ? w.press?.[a] ?? 1 : 0;
      if (P < 0.35) {
        const dmg = (0.35 - P) * 25 * dt;
        if (sim.ai?.damage) sim.ai.damage(e, dmg);
        else if ((e.health = (e.health ?? 100) - dmg) <= 0) e.dead = true;
      }
    }
    const lift = e.breachHeld ? 0 : 0.5; // (his middle, standing: the feet are at p)
    const B = { c: [e.p[0], e.p[1] + lift, e.p[2]], v: (e.bv ??= [0, 0, 0]), r: 0.3, half: 0.5, mass: 90, A: e.dead ? 0.9 : 0.7, mu: e.dead ? 0.4 : 1.1, section: KINDS.body.section, strength: KINDS.body.strength, buoy: 0 };
    if (!e.swept && !e.drift && e.plug == null) {
      const a = sim.airCellAt(...B.c);
      const moving = w.vacuum ? a >= 0 && w.blow && (w.blow[a * 3] || w.blow[a * 3 + 1] || w.blow[a * 3 + 2]) : w.inflows?.length;
      if (!moving) continue;
    }
    const ev = stepBody(sim, e, B, dt);
    const moved = e.swept || e.drift || e.plug != null;
    if (moved) {
      e.stunnedUntil = Math.max(e.stunnedUntil ?? 0, w.time + 1.5);
      e.moving = e.aiming = false;
    }
    // tumbling through the air (drawn like a body carried crosswise); the sea's jet only shoves him
    const tumble = moved && w.vacuum;
    if (tumble) {
      e.held = e.breachHeld = true;
      e.p = B.c.slice();
      const sp = e.spin ?? [0, 2, 3];
      e.heldYaw = (e.heldYaw ?? e.yaw ?? 0) + sp[1] * dt;
      e.heldPitch = (e.heldPitch ?? 0) + sp[2] * dt;
      if (e.drift && !e.dead) {
        e.vacT = (e.vacT ?? 0) + dt;
        if (e.vacT > 8) e.dead = true; // (no pressure, no air of his own for long)
      }
    } else {
      if (e.breachHeld) {
        e.held = e.breachHeld = false;
        e.p = [B.c[0], B.c[1] - B.half, B.c[2]];
      } else e.p = [B.c[0], B.c[1] - lift, B.c[2]];
    }
    if (e.impact > 0) {
      const dmg = Math.max(0, e.impact - 8) * 12;
      if (dmg > 0) {
        if (sim.ai?.damage) sim.ai.damage(e, dmg);
        else if ((e.health = (e.health ?? 100) - dmg) <= 0) e.dead = true;
      }
      e.impact = 0;
    }
    if (ev) w.events.push({ type: ev, pos: B.c.slice(), time: w.time, name: e.dead ? 'a body' : 'a soldier' });
  }
  // what is stuck in a hole takes its area away from the leak (sim/vacuum.js)
  for (const x of [...(w.loose ?? []), ...(w.enemies ?? [])]) {
    if (x.plug == null || x.gone) continue;
    const H = w.holes?.[x.plug];
    if (!H) continue;
    const K = x.kind ? KINDS[x.kind] ?? KINDS.crate : KINDS.body;
    H.plugArea = Math.min(H.area, H.plugArea + 0.95 * Math.min(K.section, H.area));
  }
}
