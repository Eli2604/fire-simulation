/**
 * Drawn patrols: a path (waypoints walked in order) and an area (a polygon patrolled within), drawn
 * in the editor (editor/patrolPanel.js) for a squad (models/squad.js), a guard post (models/enemy.js)
 * or a soldier squad on patrol (models/campPatrol.js), and walked by the guard AI (ai/enemies.js).
 *
 * They are the guards' existing patrol (e.area: { mode, corners } in the world, turned and moved
 * with the object by the voxelizer) with more to it, not a second mechanism:
 *  - a path is a 'route' (corners: its waypoints) with an order (loop: round and round, the
 *    old rounds; pingpong: there and back; once: to the end, where they stay) and per waypoint
 *    stops: a pause there (s), looking round while they wait, a stance (crouched), and the pace of
 *    the leg to it (walk, patrol: the weapon at the ready, a little slower; run);
 *  - an area is an 'area' with poly (corners: any polygon, not just the old rectangle): the
 *    leader goes to random spots inside it, or sweeps it systematically (rows across it, there
 *    and back, a few metres apart);
 *  - either may have a zone (the area, for a path that has one too) and a leash (m): in a
 *    fight (the squad AI has them: ai/squad.js) a man who gets further than the leash outside
 *    the zone breaks off and runs back into it, and they do not go after a threat that far out;
 *    they still fire at what they see on the way (the guard AI's own fire).
 * Old saved routes (the enemy model's rectangle round, campPatrol's circle, a dragon's "x,z act"
 * text) load and walk as before: no order is a loop, no stops is no pause.
 *
 * In the scene the path and the area are text params, in the object's own frame (they move and
 * turn with it), like a dragon's route:
 *   patrolPath  "x,z opts; x,z opts; …"  opts: 4s (a pause), look, crouch, walk | patrol | run
 *   patrolArea  "x,z; x,z; x,z; …"       a polygon's corners
 * so they are saved, loaded and undone with the scene, and can be typed in the properties too.
 *
 * Pure logic (no three.js): the editor's helpers (insert / delete / move a point, the nearest
 * segment, point in polygon, rectangle and circle presets) are here as well.
 */

/** The params a patrolling model adds (spread into its params). */
export const PATROL_PARAMS = {
  patrolPath: { value: '', label: 'Drawn patrol path: "x,z opts; …" (opts: 4s pause, look, crouch, walk/patrol/run). Draw it in the view: Patrol below' },
  patrolOrder: { value: 'loop', options: ['loop', 'back and forth', 'one way'], label: 'Path order (loop: round; back and forth; one way: they stay at the end)' },
  patrolArea: { value: '', label: 'Drawn patrol area: "x,z; x,z; …" (a polygon)' },
  areaSweep: { value: 'random', options: ['random', 'sweep'], label: 'In the area: random spots, or a systematic sweep (rows across it)' },
  leash: { value: 15, min: 0, max: 100, step: 1, label: 'Leash (m): in a fight they go no further than this outside the area / path (0: no leash)' },
};
export const ORDERS = { loop: 'loop', 'back and forth': 'pingpong', 'one way': 'once', pingpong: 'pingpong', once: 'once' };
export const PACES = ['walk', 'patrol', 'run'];
/** The pace's speed (× the guard's walk) and the clip it is drawn with (render/enemies.js). */
export const PACE = { walk: { k: 1, anim: 'walk' }, patrol: { k: 0.8, anim: 'aimWalk' }, run: { k: 2, anim: 'run' } };

const r2 = (v) => +(+v).toFixed(2);

/* ---------------- text <-> points ---------------- */

/** "10,5 4s look; 20,5 run" → [{ p: [x, z], pause, look, stance, speed }] (bad entries skipped). */
export function parsePath(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const part of text.split(/[;\n]/)) {
    const m = part.trim().match(/^(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*(.*)$/);
    if (!m) continue;
    const x = Number(m[1]);
    const z = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const w = { p: [x, z] };
    for (const t of m[3].toLowerCase().split(/[\s,]+/).filter(Boolean)) {
      const s = t.match(/^(?:(?:pause|wait)=?)?([\d.]+)s?$/);
      if (s && Number.isFinite(+s[1])) w.pause = +s[1];
      else if (t === 'look') w.look = true;
      else if (t === 'crouch') w.stance = 'crouch';
      else if (PACES.includes(t)) w.speed = t;
      // (anything else, a dragon's acts: ignored)
    }
    out.push(w);
  }
  return out;
}
/** Waypoints back to text (only the options set). */
export function formatPath(W) {
  return W.map((w) => [`${r2(w.p[0])},${r2(w.p[1])}`, w.pause > 0 ? `${r2(w.pause)}s` : '', w.look ? 'look' : '', w.stance === 'crouch' ? 'crouch' : '', w.speed && w.speed !== 'walk' ? w.speed : ''].filter(Boolean).join(' ')).join('; ');
}
/** "x,z; x,z; …" (or "x z; …") → [[x, z], …]; fewer than 3 corners: none. */
export function parsePoly(text) {
  const P = parsePath(text).map((w) => w.p);
  return P.length >= 3 ? P : [];
}
export const formatPoly = (P) => P.map(([x, z]) => `${r2(x)},${r2(z)}`).join('; ');

/* ---------------- geometry ---------------- */

/** Is (x, z) inside the polygon P ([[x, z], …]; even-odd)? */
export function pointInPolygon(P, x, z) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i];
    const [xj, zj] = P[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** From (x, z) to the segment a-b: the distance and where along it (t 0..1). */
export function segDist(a, b, x, z) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
  return { d: Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z), t };
}
/** The segment of the polyline P nearest (x, z) (closed: the last back to the first too): { i (from P[i] to the next), d, t } or null. */
export function nearestSegment(P, x, z, closed = false) {
  let best = null;
  const n = closed ? P.length : P.length - 1;
  for (let i = 0; i < n; i++) {
    const s = segDist(P[i], P[(i + 1) % P.length], x, z);
    if (!best || s.d < best.d) best = { i, d: s.d, t: s.t };
  }
  return best;
}
/** How far (x, z) is outside the polygon (0 inside). */
export function outsidePoly(P, x, z) {
  if (pointInPolygon(P, x, z)) return 0;
  return nearestSegment(P, x, z, true)?.d ?? Infinity;
}
/** A rectangle (w × d, centred on cx, cz) and a circle (radius r, n corners) as polygons. */
export const rectPoly = (cx, cz, w, d) => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]].map((q) => q.map(r2));
export const circlePoly = (cx, cz, r, n = 16) => Array.from({ length: n }, (_, k) => [r2(cx + Math.cos((k / n) * 2 * Math.PI) * r), r2(cz + Math.sin((k / n) * 2 * Math.PI) * r)]);

/* ---------------- editing (the editor's; a new list each time) ---------------- */

/** Insert item q before index i (i = length: at the end). */
export const insertPoint = (P, i, q) => [...P.slice(0, i), q, ...P.slice(i)];
export const deletePoint = (P, i) => P.filter((_, k) => k !== i);
/** Point i moved to (x, z) (a waypoint keeps its options). */
export const movePoint = (P, i, x, z) => P.map((q, k) => (k !== i ? q : Array.isArray(q) ? [r2(x), r2(z)] : { ...q, p: [r2(x), r2(z)] }));
/**
 * Where a click at (x, z) adds a point: on a segment (within tol m) it goes in there (between
 * its ends); otherwise at the end of the path (an area: into its nearest edge, so the polygon
 * grows there and does not cross itself). Returns the index it goes in at.
 */
export function insertIndex(P, x, z, closed = false, tol = 0.8) {
  if (P.length < 2) return P.length;
  const s = nearestSegment(P, x, z, closed);
  if (s && s.d <= tol) return s.i + 1;
  return closed && P.length >= 3 ? s.i + 1 : P.length;
}

/* ---------------- the model side: params → the guards' area ---------------- */

/**
 * The patrol drawn in a model's params as the guards' area (in the model's frame, y the level),
 * or null (nothing drawn: the model's own patrol). A path wins over the area for the walking;
 * the area is then its zone (the leash).
 */
export function drawnPatrol(p, level = p.level ?? 0) {
  const W = parsePath(p.patrolPath);
  const A = parsePoly(p.patrolArea);
  const leash = Number.isFinite(+p.leash) && +p.leash > 0 ? +p.leash : 0;
  const at = ([x, z]) => [x, level, z];
  if (W.length) {
    return {
      mode: 'route',
      corners: W.map((w) => at(w.p)),
      order: ORDERS[p.patrolOrder] ?? 'loop',
      stops: W.map(({ pause, look, stance, speed }) => ({ pause: pause ?? 0, look: !!look, stance: stance ?? 'stand', speed: speed ?? 'walk' })),
      ...(A.length ? { zone: A.map(at) } : {}),
      leash,
    };
  }
  if (A.length) return { mode: 'area', poly: true, corners: A.map(at), sweep: p.areaSweep === 'sweep' ? 'sweep' : 'random', leash };
  return null;
}

/* ---------------- the guard AI's side ---------------- */

const xz = (c) => [c[0], c[2]];
/** The polygon a man is kept in (x-z), or null: the zone, an area's corners. */
export function zoneOf(a) {
  if (!a) return null;
  if (a.zone) return a.zone.map(xz);
  if (a.poly) return a.corners.map(xz);
  return null;
}
/** How far p is outside the patrol (its zone, or else the path: the distance to it), 0 inside. */
export function outside(a, p) {
  const Z = zoneOf(a);
  if (Z) return outsidePoly(Z, p[0], p[2]);
  if (a?.mode === 'route' && a.corners.length) {
    const P = a.corners.map(xz);
    if (P.length === 1) return Math.hypot(p[0] - P[0][0], p[2] - P[0][1]);
    return nearestSegment(P, p[0], p[2], (a.order ?? 'loop') === 'loop')?.d ?? 0;
  }
  return 0;
}
/** Is p inside the drawn area (its zone)? (null: not a drawn one: the guard AI's own test.) */
export function insideZone(a, p) {
  const Z = zoneOf(a);
  return Z ? pointInPolygon(Z, p[0], p[2]) : null;
}

/** The next waypoint of a route for e (e.leg: the one he is going to; e.legDir: back and forth). */
export function nextLeg(e, a) {
  const n = a.corners.length;
  const k = e.leg ?? 0;
  if (n < 2) return 0;
  const order = a.order ?? 'loop';
  if (order === 'pingpong') {
    let dir = e.legDir ?? 1;
    let j = k + dir;
    if (j >= n || j < 0) {
      dir = -dir;
      j = k + dir;
    }
    e.legDir = dir;
    return Math.max(0, Math.min(n - 1, j));
  }
  if (order === 'once') return Math.max(0, Math.min(n - 1, k + 1));
  return (((k + 1) % n) + n) % n;
}

/** A random spot in the polygon (rejection in its box; the middle if that fails). */
export function randomInPoly(P, rnd = Math.random) {
  const xs = P.map((q) => q[0]);
  const zs = P.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let k = 0; k < 60; k++) {
    const x = x0 + (x1 - x0) * rnd();
    const z = z0 + (z1 - z0) * rnd();
    if (pointInPolygon(P, x, z)) return [x, z];
  }
  return [P.reduce((s, q) => s + q[0], 0) / P.length, P.reduce((s, q) => s + q[1], 0) / P.length];
}
/**
 * A systematic sweep of the polygon: rows across it (along its longer side) `gap` m apart, half
 * a gap in from its edges, walked there and back (boustrophedon): the points inside, in order.
 */
export function sweepPoints(P, gap = 6) {
  const xs = P.map((q) => q[0]);
  const zs = P.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const alongX = x1 - x0 >= z1 - z0;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const rows = Math.max(1, Math.round((b1 - b0) / gap));
  const out = [];
  for (let r = 0; r < rows; r++) {
    const b = b0 + ((r + 0.5) * (b1 - b0)) / rows;
    const n = Math.max(1, Math.round((a1 - a0) / gap));
    const row = [];
    for (let s = 0; s <= n; s++) {
      const a = a0 + gap / 2 + ((a1 - a0 - gap) * s) / n;
      const [x, z] = alongX ? [a, b] : [b, a];
      if (pointInPolygon(P, x, z)) row.push([x, z]);
    }
    if (r % 2) row.reverse();
    out.push(...row);
  }
  return out.length ? out : [randomInPoly(P, () => 0.5)];
}
/** The next spot to go to in a drawn area (random, or the next of the sweep). */
export function areaGoal(e, a, rnd = Math.random) {
  const P = a.corners.map(xz);
  const y = a.corners[0][1];
  if (a.sweep === 'sweep') {
    a.sweepPts ??= sweepPoints(P);
    e.sweepI = ((e.sweepI ?? -1) + 1) % a.sweepPts.length;
    const [x, z] = a.sweepPts[e.sweepI];
    return [x, y, z];
  }
  const [x, z] = randomInPoly(P, rnd);
  return [x, y, z];
}

/**
 * At a waypoint of the route: does e stay a while (true)? A pause there (looking round if the
 * waypoint says so: his yaw swings ±60°), and the end of a one-way path (for good). Writes
 * e.holdStance for the renderer (crouch, or aim while looking round).
 */
export function holdAt(e, a, now) {
  const n = a.corners.length;
  const st = a.stops?.[e.leg];
  const end = (a.order === 'once' && e.leg === n - 1) || n === 1;
  if (st?.pause > 0 || end) {
    if (e.holdLeg !== e.leg) {
      e.holdLeg = e.leg;
      e.holdT0 = now;
      e.holdYaw = e.yaw ?? 0;
    }
    if (end || now < e.holdT0 + st.pause) {
      if (st?.look) e.yaw = e.holdYaw + Math.sin((now - e.holdT0) * 0.9) * 1.05;
      e.holdStance = st?.stance === 'crouch' ? 'crouch' : st?.look ? 'aim' : null;
      return true;
    }
  }
  e.holdLeg = null;
  e.holdStance = null;
  return false;
}

/**
 * The pace on patrol (writes e.pace for the renderer) and its speed factor: the leg's (the
 * waypoint he is going to); a follower goes at his leader's; running back on the leash.
 */
export function paceOf(e) {
  let pace = 'walk';
  if (e.leashBack) pace = 'run';
  else if (e.follow) pace = e.follow.pace ?? 'walk';
  else if (e.area?.mode === 'route') pace = e.area.stops?.[e.leg]?.speed ?? 'walk';
  e.pace = e.area?.stops || e.leashBack || e.follow?.pace ? pace : null; // (an old patrol: as it was drawn)
  return PACE[pace]?.k ?? 1;
}

/**
 * The leash, for a guard whose team is in a fight (target: the threat or the place they were
 * sent to look at): does he stay out of it (true) and keep to his patrol? He breaks off when he
 * is further than the leash outside the zone (and runs back: e.leashBack, until he is in it
 * again), and does not join in after a target further out than that.
 */
export function leashHolds(e, target) {
  const a = e.area;
  if (!a?.leash) return false;
  const out = outside(a, e.p);
  if (out > a.leash) e.leashBack = true;
  else if (e.leashBack && out <= 0.5) e.leashBack = false;
  if (e.leashBack) return true;
  return !!target && outside(a, target) > a.leash;
}
