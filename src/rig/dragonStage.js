/**
 * The dragon on the rig test page (no drawing here: see rig/dragon.js). One dragon in a small
 * flat simulation world of its own (a field of soil with a wall to climb), moved and posed by the
 * simulation's own dragon code (ai/dragon.js: the same groundMove, takeoff, airMove, land, breath,
 * bite, stamp, roar, dead, animate and pose the island's dragon uses). Each act below only says
 * what to do next, the way its behaviours do (a goal, a speed, a target to look at, a time to
 * breathe); the AI does the moving. The air and the fire are not simulated (only the wounds:
 * bleeding, drops, stains), so the page stays fast.
 *
 *   const st = createDragonStage();
 *   st.play('fly');            // any of DRAGON_ACTS
 *   st.step(dt);               // every frame
 *   st.hitZone('neck', 'arrow');  // a hit there: damage, bleeding, a stain
 *   st.revive();
 */
import { createSimulation } from '../sim/createSimulation.js';
import { stepWounds } from '../sim/wounds.js';
import { initDragon, pose, groundAt, PLAN, dragonZones, dragonWoundPoint } from '../ai/dragon.js';

/** What the dragon really does, as buttons. */
export const DRAGON_ACTS = {
  rest: 'Rest',
  walk: 'Walk',
  run: 'Run / charge',
  sniff: 'Sniff',
  roar: 'Roar',
  breathe: 'Breathe fire',
  bite: 'Bite',
  stamp: 'Rear & stamp',
  climb: 'Climb wall',
  takeoff: 'Take off',
  fly: 'Fly',
  glide: 'Glide',
  bank: 'Bank',
  land: 'Land',
  die: 'Die',
  fall: 'Shot down',
};
/** The acts that need it on the ground (in the air, it lands first). */
const GROUND = new Set(['rest', 'walk', 'run', 'sniff', 'roar', 'breathe', 'bite', 'stamp', 'climb']);

const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);

export function createDragonStage({ colours = 'bronze', length = 9 } = {}) {
  const SIZE = [52, 6, 48];
  const sim = createSimulation({
    world: { size: SIZE, h: 0.4, ground: 'soil' },
    objects: [
      { type: 'dragon', params: { colours, length }, x: 20, z: 24, rotation: 90 },
      // a wall to climb over (as it climbs the church roof on the island)
      { type: 'wall', params: { length: 10, height: 2.2, thickness: 1.2, material: 'concrete' }, x: 39, z: 24, rotation: 90 },
    ],
    noFire: true,
  });
  const w = sim.world;
  const ai = sim.dragonAI;
  const C = [22, 0, 24]; // the middle of its field
  const spawnAt = { p: w.dragons[0].p.slice(), yaw: w.dragons[0].yaw };
  const st = {
    sim,
    world: w,
    ai,
    act: 'rest',
    t: 0, // time in the act
    phase: null,
    center: C,
    get dragon() {
      return w.dragons[0];
    },
    /** The wall's box in world metres: [x0, y0, z0, x1, y1, z1] (for drawing it). */
    wall: wallBox(w),
    play(name) {
      if (!DRAGON_ACTS[name]) return st;
      const d = st.dragon;
      if (d.health <= 0 && name !== 'die') st.revive();
      st.act = name;
      st.t = 0;
      st.phase = null;
      st.cool = 0;
      st.airT = 0;
      st.spot = st.landSpot = null;
      if (name === 'die') st.dragon.health = 0;
      return st;
    },
    /** A fresh dragon where it started (its blood stays on the ground). */
    revive() {
      const old = st.dragon;
      w.dragons[0] = { p: spawnAt.p.slice(), yaw: spawnAt.yaw, length: old.length, colours: old.colours, health: old.maxHealth };
      initDragon(w.dragons[0], w);
      st.dragon.timer = 1e9;
      st.act = 'rest';
      st.t = 0;
      st.phase = null;
      return st;
    },
    /** Wash the blood off the ground. */
    clean() {
      w.decals.length = 0;
      w.drops.length = 0;
      w.decalVersion = (w.decalVersion ?? 0) + 1;
      return st;
    },
    /** A hit by `type` in zone key (or the zone hit `hz` from dragonHitZone / dragonRayHit, at p along dir). */
    hitZone(key, type = 'arrow', hz = null, dir = null) {
      const d = st.dragon;
      if (!d.spine) return 0;
      if (!hz) {
        const Z = dragonZones(d, w).find((z) => z.k === key);
        if (!Z) return 0;
        // somewhere along it, on the side facing up and out
        const s = { k: key, u: 0.3 + Math.random() * 0.4, a: (Math.random() - 0.5) * 2.2 };
        const at = dragonWoundPoint(d, s, w);
        const i = Math.max(1, Math.round(s.u * (Z.pts.length - 1)));
        hz = { k: key, zone: Z.z, Z, i, t: 0.5, u: s.u, q: Z.pts[i].p, p: at.p };
        dir ??= at.n.map((v) => -v);
      }
      const p = hz.p ?? hz.q;
      return ai.strike(d, hz, type, p, dir ?? [p[0] - hz.q[0], p[1] - hz.q[1], p[2] - hz.q[2]]);
    },
    step(dt) {
      w.time += dt;
      const d = st.dragon;
      d.time = (d.time ?? 0) + dt;
      st.t += dt;
      ai.bleed(d, w, dt);
      d.hurtFlash = Math.max(0, d.hurtFlash - dt);
      if (d.health <= 0) {
        ai.dead(d, w, dt);
        pose(d, w, dt);
      } else {
        d.fuel = 1; // (an endless fire gland, for the page)
        d.breathCool -= dt;
        d.biteCool -= dt;
        d.blink = Math.max(0, d.blink - dt);
        if (Math.random() < dt * 0.25) d.blink = 0.18;
        d.timer = 1e9; // (it never goes out on its own here)
        d.state = st.act === 'rest' ? 'rest' : 'roam';
        d.alert = st.act === 'rest' ? Math.max(0, (d.alert ?? 0) - dt * 0.3) : 1;
        d.look = d.breathT > 0 || d.windT > 0 ? d.aim ?? null : null;
        if (GROUND.has(st.act) && d.mode !== 'ground') landFirst(d, dt);
        else ACTS[st.act]?.(d, dt);
        ai.breath(d, w, dt);
        ai.animate(d, dt);
        ai.updateTrail(d);
        pose(d, w, dt);
      }
      stepWounds(sim, dt); // drops falling, landing as stains
      // the jet's and the splashes' heaters run out (the air is not simulated here)
      if (w.heaters.length > 40) w.heaters = w.heaters.filter((h) => !(h.temporary && h.until < w.time));
      if (w.noises.length > 300) w.noises.splice(0, w.noises.length - 150);
      if (w.events.length > 200) w.events.splice(0, w.events.length - 100);
      return st;
    },
  };

  /** Ahead of it, on the ground: [x, y, z] `a` m in front of the chest at height `y` above the ground. */
  const ahead = (d, a, y = 0) => {
    const x = d.chest[0] + Math.sin(d.yaw) * a;
    const z = d.chest[2] + Math.cos(d.yaw) * a;
    return [x, groundAt(w, x, z, d.chest[1] + 2).y + y, z];
  };
  /** A goal on a circle round the middle of the field, `lead` radians on from where it is. */
  const onCircle = (d, R, lead, dir = 1) => {
    const a = Math.atan2(d.p[2] - C[2], d.p[0] - C[0]) + lead * dir;
    return [C[0] + Math.cos(a) * R, 0, C[2] + Math.sin(a) * R];
  };
  const flyRound = (d, dt, R, alt, speed, lead = 0.6) => ai.airMove(d, w, dt, onCircle(d, R, lead), groundAt(w, C[0], C[2]).y + alt, speed);
  /** In the air for an act on the ground: it comes down where it is heading. */
  function landFirst(d, dt) {
    st.landSpot ??= ai.landingSpot(d, w, onCircle(d, 7, 0.9), 4) ?? [C[0], groundAt(w, C[0], C[2]).y, C[2]];
    if (ai.land(d, w, dt, st.landSpot)) st.landSpot = null;
  }
  /** Off the ground first (a run-up, a leap), for an act in the air. */
  const airborne = (d, dt) => {
    if (d.mode === 'air') return true;
    ai.takeoff(d, w, dt);
    return false;
  };

  const ACTS = {
    // lying in its lair: belly and chin on the ground, looking about, the tongue flicking
    rest(d, dt) {
      ai.rest(d, w, dt);
    },
    // a crawl round the field, legs sprawled, the body swinging
    walk(d, dt) {
      ai.groundMove(d, w, dt, onCircle(d, 8, 0.5), 1.6 * Math.sqrt(d.k));
      if (Math.random() < dt * 0.6) d.tongueT = 0.6;
    },
    // charging (as it comes for its prey)
    run(d, dt) {
      ai.groundMove(d, w, dt, onCircle(d, 9, 0.6), 5.5 * Math.sqrt(d.k));
    },
    // stop, look at the ground ahead and taste the air
    sniff(d, dt) {
      ai.groundMove(d, w, dt, null, 0);
      d.look = ahead(d, 2.4 * d.k, 0.6 * d.k);
      if (Math.random() < dt * 2.5) d.tongueT = 0.6;
    },
    roar(d, dt) {
      ai.groundMove(d, w, dt, null, 0);
      d.look = ahead(d, 6 * d.k, 4 * d.k);
      if ((st.cool -= dt) <= 0) {
        st.cool = 3.2;
        d.lastRoar = -99;
        ai.roar(d, w);
      }
    },
    // the throat glows, the jaws open (wind-up), then the jet (its fuel never runs out here)
    breathe(d, dt) {
      ai.groundMove(d, w, dt, null, 0);
      if (d.breathT <= 0 && d.windT <= 0) {
        d.breathCool = Math.min(d.breathCool, 1.2);
        if (d.breathCool <= 0) ai.startBreath(d, ahead(d, 8 * d.k, 0.4), 0.6);
        else d.look = ahead(d, 8 * d.k, 0.4);
      }
    },
    // the lunge and snap of the jaws (at nothing: the prey is just out of reach)
    bite(d, dt) {
      ai.groundMove(d, w, dt, null, 0);
      const center = ahead(d, 4.8 * d.k, PLAN.clear * d.k);
      if (d.biteT > 0) return ai.bite(d, w, dt, { kind: 'none' }, center);
      d.look = center;
      if ((st.cool -= dt) <= 0) {
        st.cool = 1.6;
        d.biteT = 0.5;
        d.lunge = 1;
      }
    },
    // rearing up on its hind legs, coming down with its whole weight (as on a roof it besieges)
    stamp(d, dt) {
      ai.groundMove(d, w, dt, null, 0);
      const center = ahead(d, 2.5 * d.k, 0.9);
      if (d.stampT > 0) return ai.stamp(d, w, dt, center);
      d.look = center;
      if ((st.cool -= dt) <= 0) {
        st.cool = 1.4;
        d.stampT = 1.25;
        d.stampAt = center;
      }
    },
    // up and over the wall, the way a lizard runs up a wall, and back
    climb(d, dt) {
      const A = [st.wall[0] - 7, 0, (st.wall[2] + st.wall[5]) / 2];
      const B = [st.wall[3] + 6, 0, A[2]];
      st.phase ??= Math.abs(d.p[0] - B[0]) < Math.abs(d.p[0] - A[0]) ? 'back' : 'over';
      const goal = st.phase === 'over' ? B : A;
      ai.groundMove(d, w, dt, goal, (d.cling > 0 ? 1.4 : 2.0) * Math.sqrt(d.k), { climb: true });
      if (Math.hypot(goal[0] - d.p[0], goal[2] - d.p[2]) < 1.3 * d.k) st.phase = st.phase === 'over' ? 'back' : 'over';
    },
    // a crouch, a run-up and a leap, hard wingbeats, and climbing away
    takeoff(d, dt) {
      if (!airborne(d, dt)) return;
      flyRound(d, dt, 12, 10, 10, 0.5);
      if ((st.airT = (st.airT ?? 0) + dt) > 6) {
        st.act = 'fly';
        st.airT = 0;
      }
    },
    // round the field like a bird of prey, flapping to keep its height
    fly(d, dt) {
      if (airborne(d, dt)) flyRound(d, dt, 14, 10, 9, 0.5);
    },
    // wings spread and still, sailing on its speed
    glide(d, dt) {
      if (!airborne(d, dt)) return;
      flyRound(d, dt, 14, 9, 9, 0.45);
      d.flapAmp = approach(d.flapAmp, 0.05, 4, dt);
    },
    // a tight turn: it banks hard into it (tan bank = v·ω/g)
    bank(d, dt) {
      if (airborne(d, dt)) flyRound(d, dt, 6, 9, 11, 1.0);
    },
    // up and out, then back: the glide in, the flare with deep wingbeats, all four feet down
    land(d, dt) {
      st.phase ??= d.mode === 'air' ? 'down' : 'up';
      if (st.phase === 'down') {
        st.spot ??= ai.landingSpot(d, w, C, 3) ?? [C[0], groundAt(w, C[0], C[2]).y, C[2]];
        if (d.mode === 'ground') return ai.groundMove(d, w, dt, null, 0);
        ai.land(d, w, dt, st.spot);
        return;
      }
      st.phase = 'up';
      if (!airborne(d, dt)) return;
      flyRound(d, dt, 13, 9, 11, 0.5);
      if ((st.airT = (st.airT ?? 0) + dt) > 5) {
        st.airT = 0;
        st.phase = 'down';
        st.spot = null;
      }
    },
    // in the air: it takes a few beats to get up, then it is killed and falls
    fall(d, dt) {
      if (!airborne(d, dt)) return;
      flyRound(d, dt, 12, 10, 11);
      if ((st.airT = (st.airT ?? 0) + dt) > 4) {
        st.airT = 0;
        d.health = 0;
      }
    },
  };
  st.dragon.timer = 1e9;
  return st;
}

/** The wall in the field: the box of the solid voxels above the ground layer. */
function wallBox(w) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let z = 0; z < w.nz; z++)
    for (let y = 1; y < w.ny; y++)
      for (let x = 0; x < w.nx; x++) {
        if (!w.mat[w.idx(x, y, z)]) continue;
        b[0] = Math.min(b[0], x * w.h);
        b[1] = Math.min(b[1], y * w.h);
        b[2] = Math.min(b[2], z * w.h);
        b[3] = Math.max(b[3], (x + 1) * w.h);
        b[4] = Math.max(b[4], (y + 1) * w.h);
        b[5] = Math.max(b[5], (z + 1) * w.h);
      }
  return b;
}
