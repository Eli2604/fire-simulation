/**
 * How a team moves as a team (the squad AI's movement, ai/squad.js): formations in the open,
 * a file through narrow places, splitting at a junction, entering a room behind a flashbang,
 * and clearing a building floor by floor. Pure logic, no three.js.
 *
 *  - The ground: analyse() measures on the squad's grid how wide the free space is at each
 *    cell (the shorter of the free runs across it, east-west and north-south). Narrow
 *    (≤ 1.6 m): a corridor, a gap; a doorway is a narrow cell next to a wide area; rooms are
 *    the wide areas between doorways.
 *  - Formations (the commander decides, and signals each change by hand): in the open, far
 *    from the threat, the team moves as one in a formation that fits its number: two side
 *    by side, three in a wedge (a triangle), four in a diamond on the move and a square at a
 *    halt, five or more in a wedge. Each man has his sector (the point man ahead, the flanks
 *    left and right, the rear man behind) and watches it as they go. Where it gets narrow
 *    they line up in file (sectors alternating left and right, the last man to the rear).
 *    Near the threat, or under fire, he signals back to bounding overwatch.
 *  - Moving in a file in a corridor and reaching a T (a junction with a branch either way),
 *    the commander may split the team: he takes his half one way and appoints the gunner as
 *    acting commander of the other half, which takes the other branch. They meet at the
 *    objective and join up again (or as soon as there is contact).
 *  - Through a doorway into a room they do not know is clear: they stack up beside the door,
 *    one throws a flashbang in, they wait for the bang and go in right after it.
 *  - A building: to get to something on another floor, the team works its way up (or down)
 *    by the stairs (host.path3d), clearing each floor it reaches room by room (a flashbang at
 *    each door, "room clear"), then calls the floor clear and moves on.
 *
 * Groups: sq.groups is a list of { men, leader, type, route, ri, anchor, heading, goal, then }
 * moved here each step; members in a group get their path from it. Otherwise the squad AI
 * moves them as before (bounding, investigating).
 */

import { TIMES } from './soldier.js';

const NARROW = 1.6; // m: narrower than this, a file
const DOOR = 1.3; // m: a doorway (or a gap a door would be in)
const WIDE = 2.4; // m: a room-like space
const GAP = 3.2; // m between men in a formation
const FILE_GAP = 2.2; // m between men in a file
const FORM_SPEED = 1.15; // m/s: the formation's walk

// Slots: [right, forward, sector (degrees from the heading)]; filled in the order of ORDER
const SLOTS = {
  pair: [[-1.6, 0, -90], [1.6, 0, 90]],
  wedge: [[0, GAP, 0], [-GAP, 0, -110], [GAP, 0, 110], [-2 * GAP, -GAP, -150], [2 * GAP, -GAP, 150], [0, -GAP, 180]],
  diamond: [[0, GAP, 0], [-GAP, 0, -90], [GAP, 0, 90], [0, -GAP, 180], [0, 0, 0]],
  square: [[-GAP / 2, GAP / 2, -45], [GAP / 2, GAP / 2, 45], [-GAP / 2, -GAP / 2, -135], [GAP / 2, -GAP / 2, 135], [0, 0, 0]],
};
const ORDER = ['R1', 'CMD', 'R2', 'MG', 'UAV'];
const NAMES = { pair: 'PAIR', wedge: 'WEDGE', diamond: 'DIAMOND', square: 'SQUARE', file: 'FILE' };

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const cen = (list) => {
  const c = [0, 0, 0];
  for (const m of list) for (let k = 0; k < 3; k++) c[k] += m.p[k] / list.length;
  return c;
};

/* ------------------------------------------------------------------ the ground */

/** Width of the free space at every cell, doorways and rooms (after sq.rebuildNav()). */
export function analyse(sq) {
  const { nx, nz, cs, blocked } = sq;
  const raw = sq.solidCell;
  const N = nx * nz;
  const rx = new Uint16Array(N), rz = new Uint16Array(N);
  for (let j = 0; j < nz; j++) {
    let i = 0;
    while (i < nx) {
      if (raw[j * nx + i]) {
        i++;
        continue;
      }
      let e = i;
      while (e < nx && !raw[j * nx + e]) e++;
      for (let a = i; a < e; a++) rx[j * nx + a] = e - i;
      i = e;
    }
  }
  for (let i = 0; i < nx; i++) {
    let j = 0;
    while (j < nz) {
      if (raw[j * nx + i]) {
        j++;
        continue;
      }
      let e = j;
      while (e < nz && !raw[e * nx + i]) e++;
      for (let b = j; b < e; b++) rz[b * nx + i] = e - j;
      j = e;
    }
  }
  // free cells across, wall to wall (+ the margin the wall sampling takes off: ~0.5 m)
  const width = new Float32Array(N);
  for (let k = 0; k < N; k++) width[k] = blocked[k] ? 0 : Math.min(rx[k], rz[k]) * cs + 0.5;
  sq.width = width;
  // rooms: enclosed wide areas (not the open ground: not too big, not running off the grid)
  const roomOf = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const list = [];
  for (let k0 = 0; k0 < N; k0++) {
    if (seen[k0] || !(width[k0] >= WIDE)) continue;
    const q = [k0];
    seen[k0] = 1;
    let edge = false, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % nx, j = (k / nx) | 0;
      if (i < 2 || j < 2 || i >= nx - 2 || j >= nz - 2) edge = true;
      x0 = Math.min(x0, i), x1 = Math.max(x1, i), z0 = Math.min(z0, j), z1 = Math.max(z1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = b * nx + a;
        if (seen[kk] || !(width[kk] >= WIDE * 0.75)) continue;
        seen[kk] = 1;
        q.push(kk);
      }
    }
    const area = q.length * cs * cs;
    if (edge || area < 4 || area > 160 || (x1 - x0) * cs > 16 || (z1 - z0) * cs > 16) continue;
    const id = list.length;
    const c = [0, 0, 0];
    for (const k of q) {
      roomOf[k] = id;
      const p = sq.cellPos(k);
      for (let a = 0; a < 3; a++) c[a] += p[a] / q.length;
    }
    const ck = sq.nearestFree(c[0], c[2]);
    const cc = ck >= 0 ? sq.cellPos(ck) : c;
    // its doorway: a free cell next to it that is not in it
    let door = null;
    for (const k of q) {
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const kk = (j + dj) * nx + i + di;
        if (kk >= 0 && kk < N && !blocked[kk] && roomOf[kk] !== id && !(width[kk] >= WIDE * 0.75)) door = sq.cellPos(kk);
      }
      if (door) break;
    }
    list.push({ id, key: `${Math.round(cc[0])},${Math.round(cc[2])},${Math.round(cc[1])}`, c: cc, n: q.length, door });
  }
  sq.roomOf = roomOf;
  sq.rooms = list;
}

export const widthAt = (sq, p) => {
  const k = sq.cellOf?.(p[0], p[2]) ?? -1;
  return k >= 0 && sq.width ? sq.width[k] : 99;
};

/** The room at p (or null). */
export function roomAt(sq, p) {
  const k = sq.cellOf?.(p[0], p[2]) ?? -1;
  return k >= 0 && sq.roomOf?.[k] >= 0 ? sq.rooms[sq.roomOf[k]] : null;
}

/** Is the ground round p open (wide, little cover near)? */
export function openGround(sq, p) {
  if (widthAt(sq, p) < 6) return false;
  const near = (sq.covers ?? []).filter((c) => d2(c.p, p) < 9).length;
  return near <= 2;
}

/** The rooms on this floor: enclosed wide areas, each { key, c: centre, n, door }. */
export function rooms(sq) {
  return sq.rooms ?? [];
}

/** A junction (a T or a crossing) at p: three or more ways out, each a passage. */
export function junctionAt(sq, p) {
  if (!sq.solidCell) return null;
  const R = 1.8, n = 24;
  const free = [];
  for (let a = 0; a < n; a++) {
    const t = (a / n) * Math.PI * 2;
    const k = sq.cellOf(p[0] + Math.sin(t) * R, p[2] + Math.cos(t) * R);
    free.push(k >= 0 && !sq.solidCell[k]);
  }
  // runs of free directions round the ring
  const arcs = [];
  for (let a = 0; a < n; a++)
    if (free[a] && !free[(a + n - 1) % n]) {
      let b = a;
      while (free[(b + 1) % n] && (b + 1) % n !== a) b++;
      arcs.push(((a + (b >= a ? b : b + n)) / 2 / n) * Math.PI * 2);
    }
  // passages, not open ground: most of the ring is wall
  return arcs.length >= 3 && free.filter(Boolean).length <= n * 0.5 ? arcs : null;
}

/* ------------------------------------------------------------------ groups and formations */

function slotsFor(type, n) {
  if (type === 'square' && n > 5) type = 'wedge';
  return SLOTS[type].slice(0, n).concat(Array.from({ length: Math.max(0, n - SLOTS[type].length) }, (_, i) => [0, -GAP * (i + 1), 180]));
}

/** The formation for n men: moving or at a halt. */
export function formationFor(n, halted) {
  if (n <= 1) return 'file';
  if (n === 2) return 'pair';
  if (n === 3) return 'wedge';
  if (n === 4) return halted ? 'square' : 'diamond';
  return halted && n === 5 ? 'square' : 'wedge';
}

/**
 * Start a group moving to goal along route (world points, possibly over stairs). `then` is
 * called when the anchor gets there. The commander signals the formation.
 */
export function moveGroup(sq, men, goal, { route, leader, type, then, quiet } = {}) {
  const al = men.filter((m) => !m.dead);
  if (!al.length) return null;
  const c = cen(al);
  const pts = route ?? sq.route(c, goal);
  const g = { men: al, leader: leader ?? al.find((m) => m.squad === 'CMD') ?? al[0], type: null, route: [c, ...pts], ri: 1, anchor: c.slice(), heading: 0, goal: goal.slice(), then, trail: [c.slice()], quiet };
  g.heading = Math.atan2(pts[0]?.[0] - c[0] || 0, pts[0]?.[2] - c[2] || 1);
  for (const m of al) {
    m.group = g;
    m.path = null;
    m.coverCell = -1;
  }
  sq.groups = (sq.groups ?? []).filter((o) => !o.men.some((m) => al.includes(m))).concat(g);
  setType(sq, g, type ?? pickType(sq, g), quiet);
  return g;
}

export function endGroup(sq, g) {
  sq.groups = (sq.groups ?? []).filter((o) => o !== g);
  for (const m of g.men) {
    if (m.group === g) m.group = null;
    m.formSlot = null;
  }
}

function pickType(sq, g) {
  const al = g.men.filter((m) => !m.dead);
  const p = g.anchor;
  const k = Math.min(g.ri, g.route.length - 1);
  // stairs within the next few metres (the height changes): a file
  let stairs = false;
  for (let i = k, along = 0, q = p; i < g.route.length && along < 4; i++) {
    along += d2(q, g.route[i]);
    q = g.route[i];
    if (Math.abs(q[1] - p[1]) > 0.5) stairs = true;
  }
  if (stairs || widthAt(sq, p) < Math.max(NARROW, al.length > 2 ? 2.4 * GAP : GAP)) return 'file';
  return formationFor(al.length, false);
}

/** The commander's call: a new formation, by hand signal. */
function setType(sq, g, type, quiet) {
  if (g.type === type) return;
  g.type = type;
  const order = [...g.men].sort((a, b) => (ORDER.indexOf(a.squad) + 9) % 14 - (ORDER.indexOf(b.squad) + 9) % 14);
  g.order = type === 'file' ? fileOrder(g) : order;
  if (!quiet && g.leader && !g.leader.dead) {
    g.leader.signal = { text: NAMES[type] ?? type.toUpperCase(), until: sq.time + 2 };
    if (!sq.busy(g.leader)) sq.setAnim(g.leader, 'signalMove');
    sq.formCalls = (sq.formCalls ?? 0) + 1;
  }
}

/** In a file: the point man first, the commander second, the gunner last (the rear). */
function fileOrder(g) {
  const rank = { R1: 0, CMD: 1, R2: 2, UAV: 3, MG: 4 };
  return [...g.men].sort((a, b) => (rank[a.squad] ?? 2) - (rank[b.squad] ?? 2));
}

/** A point `back` metres behind the anchor along where it has been (for a file). */
function behind(g, back) {
  const tr = g.trail;
  let d = 0, prev = g.anchor;
  for (let k = tr.length - 1; k >= 0; k--) {
    const s = d2(prev, tr[k]);
    if (d + s >= back) {
      const f = (back - d) / (s || 1);
      return [prev[0] + (tr[k][0] - prev[0]) * f, prev[1] + (tr[k][1] - prev[1]) * f, prev[2] + (tr[k][2] - prev[2]) * f];
    }
    d += s;
    prev = tr[k];
  }
  return prev.slice();
}

/** Each step: the anchors move on; each man is given his place and his sector. */
export function stepGroups(sq, dt) {
  for (const g of [...(sq.groups ?? [])]) {
    const al = g.men.filter((m) => !m.dead);
    if (!al.length) {
      endGroup(sq, g);
      continue;
    }
    if (g.leader?.dead) g.leader = al.find((m) => m.squad === 'CMD') ?? al[0];
    // wait for a breach (flashbang) at a door
    if (sq.breach && al.some((m) => sq.breach.men.includes(m))) {
      breachStep(sq, g, dt);
      continue;
    }
    // the anchor walks on, but not away from the men (they move as one)
    const lag = Math.max(...al.map((m) => (m.formSlot ? d2(m.p, m.formSlot) : 0)));
    const tgt = g.route[Math.min(g.ri, g.route.length - 1)];
    const dd = Math.hypot(tgt[0] - g.anchor[0], tgt[2] - g.anchor[2]);
    if (dd < 0.3) {
      if (g.ri < g.route.length - 1) g.ri++;
      else if (!g.arrived && lag < 2.5) {
        g.arrived = true;
        if (g.type !== 'file') setType(sq, g, formationFor(al.length, true), g.quiet);
        const then = g.then;
        g.then = null;
        then?.(g);
        if (!sq.groups?.includes(g)) continue;
      }
    } else if (lag < 2.8) {
      const s = Math.min(dd, FORM_SPEED * dt);
      g.heading = Math.atan2(tgt[0] - g.anchor[0], tgt[2] - g.anchor[2]);
      g.anchor = [g.anchor[0] + ((tgt[0] - g.anchor[0]) / dd) * s, g.anchor[1] + ((tgt[1] - g.anchor[1]) / dd) * s, g.anchor[2] + ((tgt[2] - g.anchor[2]) / dd) * s];
      if (d2(g.trail[g.trail.length - 1], g.anchor) > 0.3) {
        g.trail.push(g.anchor.slice());
        if (g.trail.length > 200) g.trail.shift();
      }
    }
    // the commander's eye on the ground: a file where it narrows, the formation where it opens
    g.checkT = (g.checkT ?? 0) - dt;
    if (g.checkT <= 0 && !g.arrived) {
      g.checkT = 0.8;
      setType(sq, g, pickType(sq, g), g.quiet);
      // a doorway ahead into a room: breach it
      doorAhead(sq, g);
      // a T in the corridor: split?
      if (g.type === 'file' && !sq.split && !g.sub) maybeSplit(sq, g);
    }
    // places and sectors
    const ch = Math.cos(g.heading), sh = Math.sin(g.heading);
    g.order.filter((m) => !m.dead).forEach((m, i, list) => {
      let p, sector;
      if (g.type === 'file') {
        p = behind(g, i * FILE_GAP);
        sector = i === list.length - 1 && list.length > 1 ? 180 : i === 0 ? 0 : i % 2 ? -75 : 75;
      } else {
        const sl = slotsFor(g.type, list.length)[i];
        p = [g.anchor[0] + sl[0] * ch + sl[1] * sh, g.anchor[1], g.anchor[2] - sl[0] * sh + sl[1] * ch];
        sector = sl[2];
        const k = sq.nearestFree(p[0], p[2]);
        if (k >= 0) {
          const q = sq.cellPos(k);
          p = [q[0], p[1], q[2]];
        }
      }
      m.formSlot = p;
      const a = g.heading + (sector * Math.PI) / 180;
      m.aimAt = [m.p[0] + Math.sin(a) * 12, m.p[1], m.p[2] + Math.cos(a) * 12];
      m.sector = sector;
      if (sq.busy(m)) return;
      const off = d2(m.p, p);
      if (off > 0.35) {
        m.path = [p];
        m.pathI = 0;
        m.moveMode = off > 3.5 ? 'run' : 'aimWalk';
        m.then = null;
      } else {
        m.path = null;
        sq.face(m, m.aimAt, dt, 3);
        if (!sq.busy(m)) sq.setAnim(m, g.arrived ? 'crouchAim' : 'aim');
      }
    });
  }
}

/* ------------------------------------------------------------------ doors and flashbangs */

/**
 * Along a route from p over pts: the first point where it enters a room not yet cleared (from
 * outside it, within ~reach m): { room, p } or null. The room he is in counts as cleared.
 */
function entering(sq, p0, pts, reach) {
  if (!sq.roomOf) return null;
  const cleared = (sq.cleared ??= new Set());
  const r0 = roomAt(sq, p0);
  if (r0) cleared.add(r0.key);
  let along = 0, prev = p0, prevRoom = r0;
  for (const b of pts) {
    const l = d2(prev, b);
    for (let s = sq.cs; s <= l; s += sq.cs) {
      if (along + s > reach) return null;
      const p = [prev[0] + ((b[0] - prev[0]) * s) / l, prev[1], prev[2] + ((b[2] - prev[2]) * s) / l];
      const r = roomAt(sq, p);
      if (r && r !== prevRoom && !cleared.has(r.key)) return { room: r, p: [prev[0] + ((b[0] - prev[0]) * (s - sq.cs)) / l, prev[1], prev[2] + ((b[2] - prev[2]) * (s - sq.cs)) / l] };
      prevRoom = r;
    }
    along += l;
    prev = b;
  }
  return null;
}

/** A bounding man about to go into a room (his path goes into it): { room, p } or null. */
export function doorOnPath(sq, m) {
  if (!m.path) return null;
  return entering(sq, m.p, m.path.slice(m.pathI ?? 0), 2.6);
}

/** The route goes into a room within ~3 m: stack up and breach it (once per room). */
function doorAhead(sq, g) {
  if (g.noBreach) return;
  const E = entering(sq, g.anchor, g.route.slice(g.ri), 3.2);
  if (E) startBreach(sq, g, E.room, E.p);
}

export function startBreach(sq, g, room, doorP) {
  const al = g.men.filter((m) => !m.dead);
  const thrower = al.filter((m) => m.squad !== 'MG' && (m.flashbangs ?? 2) > 0).sort((a, b) => d2(a.p, doorP) - d2(b.p, doorP))[0];
  (sq.cleared ??= new Set()).add(room.key);
  if (!thrower) return;
  // into the room: its middle (or ~3 m past the door)
  const dir = [room.c[0] - doorP[0], room.c[2] - doorP[2]], l = Math.hypot(...dir) || 1;
  const into = l > 1 ? room.c.slice() : [doorP[0] + (dir[0] / l) * 3, doorP[1], doorP[2] + (dir[1] / l) * 3];
  // the stack: beside the door, on this side (what they were doing waits)
  const side = [-dir[1] / l, dir[0] / l];
  al.forEach((m, i) => {
    m.preBreach = m.group ? null : { path: m.path, pathI: m.pathI, then: m.then, mode: m.moveMode };
    const s = (i % 2 ? 1 : -1) * 0.9, b = 0.9 + Math.floor(i / 2) * 0.8;
    const p = [doorP[0] - (dir[0] / l) * b + side[0] * s, doorP[1], doorP[2] - (dir[1] / l) * b + side[1] * s];
    const kk = sq.nearestFree(p[0], p[2]);
    m.stackAt = kk >= 0 ? sq.cellPos(kk) : p;
  });
  sq.breach = { men: al, door: doorP, into, thrower, t: sq.time, thrown: false, goAt: Infinity, g };
}

export function breachStep(sq, g, dt) {
  const B = sq.breach;
  const al = B.men.filter((m) => !m.dead);
  // everyone to his place in the stack, facing the door
  let set = true;
  for (const m of al) {
    if (sq.busy(m)) continue;
    if (d2(m.p, m.stackAt) > 0.4 && sq.time < B.goAt) {
      m.path = [m.stackAt];
      m.pathI = 0;
      m.moveMode = 'aimWalk';
      set = false;
    } else if (sq.time < B.goAt) {
      m.path = null;
      sq.face(m, B.door, dt, 4);
      sq.setAnim(m, 'crouchAim');
      m.aimAt = B.door;
    }
  }
  if (!B.thrown && (set || sq.time - B.t > 6)) {
    // the flashbang in; the bang ~1.5 s later; in right after it
    const m = B.thrower;
    B.thrown = true;
    m.flashbangs = (m.flashbangs ?? 2) - 1;
    sq.face(m, B.into, 1, 10);
    sq.setAnim(m, 'throwFlash');
    m.throwAt = sq.time + TIMES.flashRelease;
    m.throwTarget = B.into;
    m.throwKind = 'flash';
    m.signal = { text: 'FLASHBANG', until: sq.time + 1.8 };
    sq.host.shout?.(m, 'Flashbang out!');
    B.goAt = sq.time + TIMES.flashRelease + 1.5 + 0.4;
  }
  if (sq.time >= B.goAt) {
    sq.breach = null;
    const lead = g.leader && !g.leader.dead ? g.leader : al[0];
    if (lead) {
      lead.signal = { text: 'GO GO GO', until: sq.time + 1.5 };
      sq.host.shout?.(lead, 'Go, go, go!');
    }
    for (const m of al) {
      m.stackAt = null;
      // in: on with what they were doing
      if (m.preBreach) {
        Object.assign(m, { path: m.preBreach.path, pathI: m.preBreach.pathI ?? 0, then: m.preBreach.then, moveMode: 'aimWalk' });
        m.preBreach = null;
      }
    }
  }
}

/* ------------------------------------------------------------------ splitting at a T */

function maybeSplit(sq, g) {
  const al = g.men.filter((m) => !m.dead);
  if (al.length < 4 || g.quiet === 'noSplit') return;
  // a junction within the next few metres of the route
  const J = junctionAt(sq, g.anchor); // at the T itself (the point man is there)
  if (!J || d2(g.anchor, g.goal) < 8) return;
  // the other branch: the route again with the first one's cells beyond the junction made dear
  const here = g.anchor;
  const pathA = g.route.slice(g.ri);
  const save = sq.cost.slice();
  for (const p of pathA) {
    if (d2(p, here) < 1.5) continue;
    const k = sq.cellOf(p[0], p[2]);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (k + dj * sq.nx + di >= 0) sq.cost[k + dj * sq.nx + di] = 40;
  }
  const pathB = sq.route(here, g.goal);
  sq.cost = save;
  const len = (pts) => pts.reduce((a, p, i) => a + (i ? d2(pts[i - 1], p) : d2(here, p)), 0);
  const la = len(pathA), lb = len(pathB);
  // B really is another way (it leaves the junction elsewhere) and not much longer
  const firstA = pathA.find((p) => d2(p, here) > 2), firstB = pathB.find((p) => d2(p, here) > 2);
  if (!firstA || !firstB || d2(firstA, firstB) < 1.8 || lb > la * 2.2 + 8) return;
  const teamB = al.filter((m) => m.squad === 'MG' || m.squad === 'R2');
  const teamA = al.filter((m) => !teamB.includes(m));
  if (!teamB.length || !teamA.length) return;
  const acting = teamB.find((m) => m.squad === 'MG') ?? teamB[0];
  const cmd = g.leader;
  const goal = g.goal, then = g.then;
  endGroup(sq, g);
  sq.split = { at: here.slice(), goal: goal.slice(), acting, t: sq.time };
  acting.acting = true;
  // (facing along the heading h, his right is (-cos h, sin h) in x, z)
  const word = (p) => ((p[0] - here[0]) * -Math.cos(g.heading) + (p[2] - here[2]) * Math.sin(g.heading) > 0 ? 'right' : 'left');
  const gA = moveGroup(sq, teamA, goal, { route: pathA, leader: cmd, type: 'file', quiet: true });
  const gB = moveGroup(sq, teamB, goal, { route: pathB, leader: acting, type: 'file', quiet: true });
  gA.sub = gB.sub = true;
  const rejoin = () => {
    if (!sq.split) return;
    if (gA.arrived && gB.arrived) joinUp(sq, then);
  };
  gA.then = rejoin;
  gB.then = rejoin;
  if (cmd && !cmd.dead) {
    cmd.signal = { text: `SPLIT · ${acting.squad} LEADS ${word(firstB).toUpperCase()}`, until: sq.time + 2.5 };
    sq.setAnim(cmd, 'signalMove');
    if (sq.time >= sq.silentUntil) sq.say(cmd, `${sq.unit}, splitting, ${sq.name(acting)} you have ${teamB.length > 1 ? 'rifleman two' : 'yourself'}, take the ${word(firstB)}, we go ${word(firstA)}, meet at the objective`, 'order');
  }
}

/** Both halves at the objective, or contact: one team again. */
export function joinUp(sq, then) {
  const S = sq.split;
  if (!S) return;
  sq.split = null;
  const men = [];
  for (const g of [...(sq.groups ?? [])])
    if (g.sub) {
      men.push(...g.men);
      endGroup(sq, g);
    }
  if (S.acting) S.acting.acting = false;
  const cmd = men.find((m) => m.squad === 'CMD' && !m.dead) ?? men.find((m) => !m.dead);
  if (cmd) {
    cmd.signal = { text: 'JOIN UP', until: sq.time + 2 };
    sq.setAnim(cmd, 'signalHalt');
  }
  then?.({ men, arrived: true });
}

/* ------------------------------------------------------------------ floor by floor */

/**
 * Get the team to p on another floor, clearing each floor on the way: path3d (host) up the
 * stairs; on each new floor the rooms near the stairs, a flashbang at each door; then on.
 */
export function clearTo(sq, p, why, done) {
  const H = sq.host;
  const al = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  if (!al.length || !H.path3d) return false;
  const c = cen(al);
  const path = H.path3d(c, p);
  if (!path?.length) return false;
  // the floors along it: where the height settles
  const floors = [];
  let last = c[1];
  for (let i = 0; i < path.length; i++) {
    const y = path[i][1];
    const flat = i + 3 < path.length && path.slice(i, i + 4).every((q) => Math.abs(q[1] - y) < 0.25);
    if (flat && Math.abs(y - last) > 2) {
      floors.push({ y, at: i });
      last = y;
    }
  }
  sq.clearing = { p: p.slice(), why, path, floors, fi: 0, done, stage: 'travel' };
  const cmd = sq.radioMan();
  if (cmd) sq.say(cmd, `${sq.unit}, ${why} ${p[1] > c[1] ? 'upstairs' : 'downstairs'}, we clear it floor by floor`, 'order');
  nextFloor(sq);
  return true;
}

function nextFloor(sq) {
  const C = sq.clearing;
  if (!C) return;
  const al = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  const F = C.floors[C.fi];
  const from = C.fi ? C.floors[C.fi - 1].at : 0;
  const to = F ? Math.min(C.path.length - 1, F.at + 3) : C.path.length - 1;
  const route = C.path.slice(from, to + 1);
  C.stage = 'travel';
  moveGroup(sq, al, route[route.length - 1], {
    route,
    type: 'file',
    quiet: true,
    then: () => {
      // on the new floor: the grid of this floor, its rooms
      sq.navAge = Infinity;
      sq.rebuildNav();
      sq.navAge = 0;
      C.stage = 'rooms';
      C.rooms = rooms(sq)
        .filter((r) => d2(r.c, cen(al)) < 22 && r !== roomAt(sq, cen(al)))
        .sort((a, b) => d2(a.c, cen(al)) - d2(b.c, cen(al)))
        .slice(0, 4);
      C.ri = 0;
      clearRoom(sq);
    },
  });
}

function clearRoom(sq) {
  const C = sq.clearing;
  if (!C) return;
  const al = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  const R = C.rooms[C.ri];
  if (!R) {
    // this floor done
    const cmd = sq.radioMan();
    const n = C.fi + 1;
    C.fi++;
    if (C.fi < C.floors.length) {
      if (cmd) sq.say(cmd, `${sq.unit}, floor ${n} clear, moving ${C.floors[C.fi].y > C.floors[C.fi - 1].y ? 'up' : 'down'}`, 'intel');
      nextFloor(sq);
    } else {
      if (cmd) sq.say(cmd, `${sq.unit}, floor ${n} clear`, 'intel');
      for (const g of [...(sq.groups ?? [])]) endGroup(sq, g);
      const done = C.done;
      sq.clearing = null;
      done?.();
    }
    return;
  }
  // to the room's door (the breach is triggered on the way in), in, a look round
  const route = sq.route(cen(al), R.c);
  moveGroup(sq, al, R.c, {
    route,
    quiet: true,
    then: () => {
      const cmd = sq.radioMan();
      if (cmd) {
        cmd.signal = { text: 'ROOM CLEAR', until: sq.time + 1.8 };
        sq.host.shout?.(cmd, 'Clear!');
      }
      C.ri++;
      C.wait = sq.time + 1.5;
    },
  });
}

/** Each step while clearing: the next room after a short look round. */
export function stepClearing(sq) {
  const C = sq.clearing;
  if (!C || C.wait == null || sq.time < C.wait) return;
  C.wait = null;
  clearRoom(sq);
}
