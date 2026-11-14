/**
 * The phoenix on the rig stage (no drawing here: see rig/phoenix.js). One phoenix in a small flat
 * simulation world of its own (a field of soil with a stone perch in the middle), moved by the
 * simulation's own phoenix code (ai/phoenix.js: the same flyTo, call, wound, ashes and rebirth the
 * catacombs' phoenix uses). Each act only says where to go and how (a goal, a speed, wings spread
 * or folded); the AI does the flying. Three acts the catacombs do not need are made here from the
 * same parts: the glide (wings spread and still), the dive (a stoop, wings half folded) and the
 * flame burst (its fire flaring: f.flare, which render/phoenix.js draws). The air and the fire are
 * not simulated, so the page stays fast.
 *
 *   const st = createPhoenixStage();
 *   st.play('fly');                 // any of PHOENIX_ACTS
 *   st.step(dt);                    // every frame
 *   st.hitZone('head', 'bullet');   // a hit there (PHOENIX_ZONES): damage, a flash; killed, it burns to ash
 *   st.set({ span: 1.3, heat: 1.5, size: 1, speed: 3.4 });
 *   st.revive();
 */
import { createSimulation } from '../sim/createSimulation.js';
import { initPhoenix, PHOENIX, PHOENIX_ZONES, phoenixZones } from '../ai/phoenix.js';

/** What the phoenix does, as buttons. */
export const PHOENIX_ACTS = {
  perch: 'Perch (watches you)',
  stretch: 'Spread wings',
  call: 'Call',
  takeoff: 'Take off',
  fly: 'Fly',
  hover: 'Hover (waits)',
  glide: 'Glide',
  bank: 'Bank',
  dive: 'Dive (stoop)',
  flare: 'Flame burst',
  land: 'Land on the perch',
  settle: 'Settle on the ground',
  die: 'Burst into flame (dies)',
  rebirth: 'Rise from the ashes',
};
/** Its tunables (the rig's sliders): [min, max, default]. */
export const PHOENIX_PARAMS = {
  span: { label: 'Wing span ×', min: 0.6, max: 1.6, value: 1 },
  heat: { label: 'Flames ×', min: 0.3, max: 2.5, value: 1 },
  size: { label: 'Size ×', min: 0.6, max: 2, value: 1 },
  speed: { label: 'Flight (m/s)', min: 1.5, max: 8, value: PHOENIX.SPEED },
};
/** Damage of a hit (a bullet is the simulation's: sim/wounds.js; a blast at the bird: ai/phoenix.js blast). */
export const PHOENIX_WEAPONS = { bullet: 22, arrow: 30, blast: 140 };
/** The acts on (or onto) something it stands on. */
const SITTING = new Set(['perch', 'stretch', 'call']);

const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function createPhoenixStage() {
  const SIZE = [24, 4, 24];
  const C = [12, 0, 12]; // the middle of its field
  const sim = createSimulation({
    world: { size: SIZE, h: 0.4, ground: 'soil' },
    // its perch: a block of stone, as in its cell
    objects: [{ type: 'wall', params: { length: 0.8, height: 1.2, thickness: 0.8, material: 'concrete' }, x: C[0], z: C[2], rotation: 0 }],
    noFire: true,
  });
  const w = sim.world;
  const ai = sim.phoenixAI;
  const block = blockBox(w);
  const ground = floorY(w, 2, 2, SIZE[1]);
  const perch = [C[0], block[4] + PHOENIX.PERCH_HEIGHT, C[2]];
  const f = { p: perch.slice(), yaw: 0, gate: null, exit: [C[0], ground, C[2] - 9], flight: [] };
  w.phoenixes.push(f);
  initPhoenix(f, w);
  const st = {
    sim,
    world: w,
    ai,
    act: 'perch',
    t: 0, // time in the act
    phase: null,
    center: C,
    perch,
    ground,
    /** The perch block's box in world metres: [x0, y0, z0, x1, y1, z1] (for drawing it). */
    block,
    /** Where you are (the page sets the camera here): it watches you from its perch. */
    viewer: null,
    params: Object.fromEntries(Object.entries(PHOENIX_PARAMS).map(([k, p]) => [k, p.value])),
    get bird() {
      return w.phoenixes[0];
    },
    play(name) {
      if (!PHOENIX_ACTS[name]) return st;
      const b = st.bird;
      if (['ashes', 'reborn'].includes(b.state) && name !== 'die' && name !== 'rebirth') st.revive();
      st.act = name;
      st.t = 0;
      st.phase = null;
      st.cool = 0;
      st.airT = 0;
      b.flare = 0;
      if (name === 'die') kill();
      if (name === 'rebirth') {
        if (b.state !== 'ashes') kill();
        if (b.state === 'ashes') b.t = Math.max(b.t, PHOENIX.ASH_TIME - 0.6); // (straight to the rising)
      }
      return st;
    },
    /** The tunables: { span, heat, size, speed } (any of them). */
    set(p) {
      for (const [k, v] of Object.entries(p)) if (k in PHOENIX_PARAMS && Number.isFinite(+v)) st.params[k] = Math.max(PHOENIX_PARAMS[k].min, Math.min(PHOENIX_PARAMS[k].max, +v));
      apply();
      return st;
    },
    /** A fresh phoenix on its perch. */
    revive() {
      const n = { p: perch.slice(), yaw: st.bird.yaw, gate: null, exit: f.exit, flight: [] };
      w.phoenixes[0] = n;
      initPhoenix(n, w);
      apply();
      st.act = 'perch';
      st.t = 0;
      st.phase = null;
      return st;
    },
    /** A hit by `type` (PHOENIX_WEAPONS) in zone `k` (PHOENIX_ZONES): the damage done. */
    hitZone(k, type = 'bullet') {
      const b = st.bird;
      const Z = PHOENIX_ZONES[k];
      if (!Z || b.health <= 0 || !phoenixZones(b).some((z) => z.k === k)) return 0;
      const dmg = (PHOENIX_WEAPONS[type] ?? PHOENIX_WEAPONS.bullet) * Z.mult;
      ai.wound(b, dmg);
      if (b.state === 'ashes') st.dead();
      return dmg;
    },
    /** Killed (by a hit): it lies in the ash; reborn, it flies back to its perch. */
    dead() {
      st.act = 'die';
      st.t = 0;
      st.phase = null;
    },
    step(dt) {
      w.time += dt;
      st.t += dt;
      tick(st.bird, dt);
      if (w.heaters.length > 20) w.heaters = w.heaters.filter((h) => !(h.temporary && h.until < w.time));
      if (w.events.length > 200) w.events.splice(0, w.events.length - 100);
      return st;
    },
  };

  function apply() {
    const b = st.bird;
    b.span = st.params.span;
    b.heat = st.params.heat;
    b.size = st.params.size;
  }
  function kill() {
    const b = st.bird;
    if (b.health > 0 && ['caged', 'follow', 'wait', 'escape'].includes(b.state)) ai.wound(b, 1e6);
  }

  /** One step: the act says what to do, the AI moves it. */
  function tick(b, dt) {
    b.t += dt;
    b.hurtFlash = Math.max(0, b.hurtFlash - dt);
    b.callT = Math.max(0, (b.callT ?? 0) - dt);
    b.flare = Math.max(0, (b.flare ?? 0) - dt * 1.2);
    if (b.state === 'ashes') ai.ashes(b, w, dt);
    else if (b.state === 'reborn') {
      ai.reborn(b, w, dt);
      // born again: back up onto its perch
      if (b.state !== 'reborn') {
        b.state = 'follow';
        st.act = 'perch';
        st.t = 0;
        st.phase = null;
      }
    } else {
      b.state = onPerch(b) ? 'caged' : 'follow'; // (sitting: its legs down; 'caged' is what the AI and renderer call sitting still)
      (ACTS[st.act] ?? ACTS.perch)(b, dt);
    }
    b.flap += dt * b.flapRate * Math.PI * 2;
  }

  const onPerch = (b) => dist(b.pos, perch) < 0.12 && Math.hypot(...b.vel) < 0.3;
  const alt = (h) => ground + h;
  /** A goal on a circle round the perch, `lead` radians on from where it is. */
  const onCircle = (b, R, lead, h) => {
    const a = Math.atan2(b.pos[2] - C[2], b.pos[0] - C[0]) + lead;
    return [C[0] + Math.cos(a) * R, alt(h), C[2] + Math.sin(a) * R];
  };
  const speed = () => st.params.speed;
  const flyRound = (b, dt, R, h, v = speed(), lead = 0.7) => ai.flyTo(b, w, dt, onCircle(b, R, lead, h), v);
  /** Back onto the perch (or, sitting there, true). */
  function toPerch(b, dt) {
    if (onPerch(b) && st.phase !== 'up') return true;
    if (dist(b.pos, perch) > 1.2) ai.flyTo(b, w, dt, [perch[0], perch[1] + 0.6, perch[2]], speed());
    else ai.flyTo(b, w, dt, perch, 2.2, true);
    if (dist(b.pos, perch) < 0.06) b.vel = [0, 0, 0];
    b.look = null;
    return false;
  }
  /** On its perch: still, its head after you, turning to face you; `wings` spread (0..1) and beating at `rate`. */
  function sit(b, dt, wings = 0, rate = 0) {
    b.pos = [perch[0], perch[1] + Math.max(0, Math.sin(b.flap * 0.5)) * 0.04 * b.wing, perch[2]];
    b.vel = [0, 0, 0];
    const v = st.viewer;
    b.look = v ? v.slice() : [C[0] + Math.sin(w.time * 0.4) * 5, alt(1.7), C[2] + 5];
    const want = Math.atan2(b.look[0] - b.pos[0], b.look[2] - b.pos[2]);
    b.yaw += wrap(want - b.yaw) * Math.min(1, dt * 2.5);
    b.pitch = approach(b.pitch, 0, 3, dt);
    b.bank = approach(b.bank, 0, 3, dt);
    b.wing = approach(b.wing, wings, 4, dt);
    b.flapRate = rate;
  }
  /** Off the perch (or the ground): a crouch, a spring, hard wingbeats up. True once well up. */
  function airborne(b, dt) {
    if (st.up) return true;
    st.phase = 'up';
    st.airT += dt;
    const from = st.from ?? (st.from = b.pos.slice());
    if (st.airT < 0.3) {
      // the crouch: wings opening
      b.wing = approach(b.wing, 1, 6, dt);
      b.flapRate = 0;
      b.pos = [from[0], from[1] - 0.06 * (st.airT / 0.3), from[2]];
      return false;
    }
    const goal = [from[0] + Math.sin(b.yaw) * 2.5, Math.max(from[1], alt(1)) + 1.8, from[2] + Math.cos(b.yaw) * 2.5];
    ai.flyTo(b, w, dt, goal, speed());
    b.flapRate = Math.max(b.flapRate, 3.6); // (hard beats, climbing)
    if (b.pos[1] > goal[1] - 0.6 || st.airT > 3) {
      st.up = true;
      st.from = null;
      st.phase = null;
      return true;
    }
    return false;
  }
  const grounded = () => {
    st.up = false;
    st.airT = 0;
  };

  const ACTS = {
    // on its stone perch: watching you, now and then spreading its wings and beating them, calling
    perch(b, dt) {
      if (!toPerch(b, dt)) return grounded();
      grounded();
      st.stretchT = (st.stretchT ?? 5) - dt;
      if (st.stretchT < 0) {
        st.stretching = 1.6 + Math.random();
        st.stretchT = 6 + Math.random() * 5;
      }
      st.stretching = Math.max(0, (st.stretching ?? 0) - dt);
      sit(b, dt, st.stretching > 0 ? 0.9 : 0, st.stretching > 0 ? 2.4 : 0);
      if (w.time - b.calledAt > 12) ai.call(b);
    },
    // the wings spread wide (as they brush the walls of its cell), beaten, folded, again
    stretch(b, dt) {
      if (!toPerch(b, dt)) return grounded();
      grounded();
      const on = st.t % 4 < 2.6;
      sit(b, dt, on ? 1 : 0, on ? 2.4 : 0);
    },
    // a raptor's scream, the beak open, every couple of seconds
    call(b, dt) {
      if (!toPerch(b, dt)) return grounded();
      grounded();
      sit(b, dt, 0.15, 0);
      if ((st.cool -= dt) <= 0) {
        st.cool = 2.2;
        ai.call(b);
      }
    },
    // a crouch, a spring, hard wingbeats up and away; then round the field
    takeoff(b, dt) {
      if (!airborne(b, dt)) return;
      flyRound(b, dt, 6, 3);
      if ((st.flyT = (st.flyT ?? 0) + dt) > 3) {
        st.flyT = 0;
        st.act = 'fly';
      }
    },
    // round the perch, wings beating
    fly(b, dt) {
      if (airborne(b, dt)) flyRound(b, dt, 6, 3);
    },
    // in one place in the air, beating fast (as at a closed door it cannot open), facing you
    hover(b, dt) {
      if (!airborne(b, dt)) return;
      b.look = st.viewer ? st.viewer.slice() : null;
      ai.flyTo(b, w, dt, [C[0], alt(PHOENIX.FLY_HEIGHT + 1), C[2] + 3], speed());
    },
    // wings spread and still, sailing down round the field; a few beats to climb again
    glide(b, dt) {
      if (!airborne(b, dt)) return;
      st.phase ??= 'glide';
      const h = b.pos[1] - ground;
      if (st.phase === 'glide' && h < 1.8) st.phase = 'climb';
      if (st.phase === 'climb' && h > 4.2) st.phase = 'glide';
      flyRound(b, dt, 8, st.phase === 'glide' ? 1.2 : 4.6, speed() * 1.1, 0.5);
      if (st.phase === 'glide') {
        b.vel[1] = Math.max(b.vel[1], -0.6); // (a shallow glide)
        b.flapRate = 0;
        b.wing = approach(b.wing, 1, 4, dt);
      }
    },
    // a tight turn: it banks hard into it
    bank(b, dt) {
      if (airborne(b, dt)) flyRound(b, dt, 2.6, 3, speed() * 1.2, 1.2);
    },
    // up high, then the stoop: wings half folded, steeply down at a spot on the ground, pulling up
    // at the bottom with its fire flaring (as at what it attacks); and up again
    dive(b, dt) {
      if (!airborne(b, dt)) return;
      st.phase ??= 'climb';
      const target = [C[0] + 4, ground + 0.3, C[2] - 3];
      if (st.phase === 'climb') {
        flyRound(b, dt, 7, 7.5);
        if (b.pos[1] - ground > 7) st.phase = 'stoop';
      } else if (st.phase === 'stoop') {
        ai.flyTo(b, w, dt, target, speed() * 2.6);
        b.wing = approach(b.wing, 0.38, 6, dt);
        b.flapRate = 0;
        const d = [target[0] - b.pos[0], target[1] - b.pos[1], target[2] - b.pos[2]];
        b.pitch = approach(b.pitch, Math.max(-1.3, Math.atan2(d[1], Math.hypot(d[0], d[2]))), 5, dt);
        if (b.pos[1] - ground < 1.8) {
          st.phase = 'pull';
          st.pullT = 0;
          b.flare = 1;
          ai.call(b);
        }
      } else {
        // the pull-out: wings flung open, hard beats, up and on
        st.pullT += dt;
        ai.flyTo(b, w, dt, [b.pos[0] + Math.sin(b.yaw) * 4, alt(3.5), b.pos[2] + Math.cos(b.yaw) * 4], speed() * 1.4);
        b.flapRate = 4;
        if (st.pullT > 1.6) st.phase = 'climb';
      }
    },
    // its fire flaring: wings flung wide and beating, a ring of flame thrown off, every few seconds
    flare(b, dt) {
      const sitting = onPerch(b) && !st.up;
      if (!sitting && !airborne(b, dt)) return;
      if (sitting) sit(b, dt, 1, 3.4);
      else {
        b.look = st.viewer ? st.viewer.slice() : null;
        ai.flyTo(b, w, dt, [C[0], alt(PHOENIX.FLY_HEIGHT + 1.2), C[2] + 2], speed());
        b.flapRate = Math.max(b.flapRate, 4.2);
      }
      if ((st.cool -= dt) <= 0) {
        st.cool = 3;
        b.flare = 1;
        ai.call(b);
      }
    },
    // up and round, then the approach and the landing on its perch; again
    land(b, dt) {
      if (st.phase === 'down') {
        if (toPerch(b, dt)) {
          sit(b, dt, 0, 0);
          if ((st.restT = (st.restT ?? 0) + dt) > 1.5) {
            st.restT = 0;
            st.phase = null;
            grounded();
          }
        }
        return;
      }
      if (!airborne(b, dt)) return;
      flyRound(b, dt, 6, 3);
      if ((st.flyT = (st.flyT ?? 0) + dt) > 4) {
        st.flyT = 0;
        st.phase = 'down';
        st.up = false;
      }
    },
    // down onto the ground in front of its perch and waiting there (as it does with nobody to follow)
    settle(b, dt) {
      const spot = [C[0], ground + PHOENIX.PERCH_HEIGHT, C[2] + 2.5];
      if (onPerch(b) && !st.up && !airborne(b, dt)) return;
      st.up = true;
      if (dist(b.pos, spot) > 1.5) return ai.flyTo(b, w, dt, [spot[0], spot[1] + 1, spot[2]], speed());
      ai.flyTo(b, w, dt, spot, 1.4, true);
      if (dist(b.pos, spot) < 0.1) {
        b.state = 'caged'; // (sitting: its legs down)
        b.look = st.viewer ? st.viewer.slice() : null;
      }
    },
    // dead: the ash (ai/phoenix.js ashes, reborn); nothing to do here
    die() {},
    rebirth() {},
  };

  apply();
  return st;
}

/** The perch: the box of the solid voxels above the ground layer. */
function blockBox(w) {
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

/** The top of the ground at (x, z), searching down from y. */
function floorY(w, x, z, y) {
  for (; y > 0; y -= w.h / 2) {
    const i = w.voxelAt(x, y - w.h / 4, z);
    if (i >= 0 && w.mat[i]) return Math.floor((y - w.h / 4) / w.h) * w.h + w.h;
  }
  return 0;
}
