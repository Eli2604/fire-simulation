/**
 * Objects made of objects (no three.js, no DOM: the voxelizer, the editor, main.js and the tests
 * share it).
 *
 * Any scene object may carry `children`: objects again, each placed in its parent's frame:
 *
 *   { type: 'carrier', x: 106, z: 26, rotation: 0, params: { … }, children: [
 *       { type: 'jet', x: 39, z: -6, y: 11, rotation: 0, params: { … } },   // on the deck
 *       { type: 'group', x: 2, z: 22, children: [ … ] },                      // a group of its own
 *       { type: 'place', key: 'below', name: 'Below deck', indoor: true,     // a place (a zone)
 *         world: { size, h, ground }, view: { … }, x: 0, y: 6.7, z: 0,
 *         objects: [ { type: 'carrierBelow', … }, { type: 'place', key: 'lower', … } ] },
 *   ] }
 *
 * A child's x, z (metres) and numeric y (metres above its parent's origin) are in its parent's
 * frame, measured from where the parent's record puts it (x, z) and the height the voxelizer put
 * the parent's origin at; its rotation / tiltX / tiltZ (degrees) turn it in the parent's frame
 * (R = R_parent · R_child). y 'auto': it sits on whatever is under it in the world. So a child
 * moves and turns with its parent, and stays an object of its own (its params, its voxels with
 * an owner index of its own, its animations, selectable in the editor).
 *
 * Objects are numbered (the voxels' `owner`, world.origins, the editor's selection) depth first,
 * a parent before its children: a scene without children numbers them as before.
 *
 * A child of type 'place' is not voxelised into the world it is in: it is a place (a zone) of
 * its own, with its own world (size, voxels), view, weather, and its own `objects` (which may
 * hold places again: below deck, the lower decks under it). liftPlaces() makes each one a zone
 * of the scene (scene.zones[key] is the place itself, so editing the zone edits the object), with
 * a schematic `box` where it lies in the world (the overview's box) and `within`: the place it is
 * in (a portal `to: '..'` leads there).
 */

export const PLACE = 'place';
export const isPlace = (o) => o?.type === PLACE;

/** The objects inside an object: a place's are its `objects`, any other's its `children`. */
export const kidsOf = (o) => (isPlace(o) ? o.objects : o?.children) ?? [];

/**
 * The objects of one world (a scene's or a zone's `objects`), numbered as the voxelizer numbers
 * them: depth first, a parent before its children; places (and what is in them) are left out,
 * they are worlds of their own. Each entry:
 *   { node, path: [i, j, …], depth, parent (index, -1 at the top), list (the array it is in),
 *     at (its index there), end (one past its last descendant) }
 */
export function flattenObjects(objects = []) {
  const out = [];
  const walk = (list, depth, parent, path) => {
    list.forEach((node, at) => {
      if (!node || isPlace(node)) return;
      const i = out.length;
      const e = { node, path: [...path, at], depth, parent, list, at, end: i + 1 };
      out.push(e);
      if (node.children?.length) walk(node.children, depth + 1, i, e.path);
      e.end = out.length;
    });
  };
  walk(objects, 0, -1, []);
  return out;
}

/** Every object of a tree, places and what is in them too (fn(node, depth, parentNode)). */
export function eachNode(objects, fn, depth = 0, parent = null) {
  for (const n of objects ?? []) {
    if (!n) continue;
    fn(n, depth, parent);
    eachNode(kidsOf(n), fn, depth + 1, n);
  }
}

/* ---------------- poses ---------------- */

/**
 * The row-major 3x3 rotation of a scene object: `rotation` about the vertical, then (in the
 * model's frame) `tiltX` about x and `tiltZ` about z, all in degrees. As three.js turns an
 * Object3D with Euler(tiltX, rotation, tiltZ, 'YXZ'): R = Ry * Rx * Rz.
 */
export function rotationMatrix(rotation = 0, tiltX = 0, tiltZ = 0) {
  const d = Math.PI / 180;
  const cy = Math.cos((rotation ?? 0) * d), sy = Math.sin((rotation ?? 0) * d);
  const cx = Math.cos((tiltX ?? 0) * d), sx = Math.sin((tiltX ?? 0) * d);
  const cz = Math.cos((tiltZ ?? 0) * d), sz = Math.sin((tiltZ ?? 0) * d);
  // Rx * Rz
  const a = [cz, -sz, 0, cx * sz, cx * cz, -sx, sx * sz, sx * cz, cx];
  // Ry * (Rx * Rz)
  return [cy * a[0] + sy * a[6], cy * a[1] + sy * a[7], cy * a[2] + sy * a[8], a[3], a[4], a[5], -sy * a[0] + cy * a[6], -sy * a[1] + cy * a[7], -sy * a[2] + cy * a[8]];
}

const DEG = Math.PI / 180;
const mul = (A, B) => {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return C;
};
const transpose = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const apply = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const clean = (d) => {
  const r = Math.round(d * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * A rotation matrix (rotationMatrix's: R = Ry · Rx · Rz) back to { rotation, tiltX, tiltZ }
 * (degrees; rotation in [0, 360), the tilts in (-180, 180]).
 */
export function matrixToEuler(R) {
  const sx = Math.max(-1, Math.min(1, -R[5]));
  const tx = Math.asin(sx);
  let ry, rz;
  if (Math.abs(sx) < 0.999999) {
    ry = Math.atan2(R[2], R[8]);
    rz = Math.atan2(R[3], R[4]);
  } else {
    // (tilted straight up or down: the turn and the z tilt are one; all of it in the turn)
    ry = Math.atan2(-R[6], R[0]);
    rz = 0;
  }
  return { rotation: clean((((ry / DEG) % 360) + 360) % 360) % 360, tiltX: clean(tx / DEG), tiltZ: clean(rz / DEG) };
}

/**
 * Where an object of a world is: { x, z (as its record has them), oy (its origin's height, as
 * the voxelizer put it), R }. `originY`: that height when known (world.origins), else as the
 * voxelizer would put it for a numeric or missing y (h + y); 'auto' is taken as h.
 */
export function poseOf(rec, { h = 0, originY, size } = {}) {
  return {
    x: rec.x ?? (size ? size[0] / 2 : 0),
    z: rec.z ?? (size ? size[2] / 2 : 0),
    oy: originY ?? h + (typeof rec.y === 'number' ? rec.y : 0),
    R: rotationMatrix(rec.rotation, rec.tiltX, rec.tiltZ),
  };
}

const hasTilt = (o) => !!(o.tiltX || o.tiltZ);

/**
 * A child's record in its world (what the voxelizer places): its x, z, y and turn and tilts,
 * from its parent's pose (poseOf) and its own (in the parent's frame). h: the voxel size (a
 * numeric y is above the ground layer, one voxel). The children stay with the parent's record.
 */
export function childRecord(parent, child, h) {
  const { children: _, ...rec } = child;
  const ly = typeof child.y === 'number' ? child.y : 0;
  const [dx, dy, dz] = apply(parent.R, [child.x ?? 0, ly, child.z ?? 0]);
  rec.x = parent.x + dx;
  rec.z = parent.z + dz;
  if (child.y !== 'auto') rec.y = parent.oy + dy - h;
  // the turn: the parent's and its own (straight sums while nothing is tilted, as they are exact)
  const parentTilted = Math.abs(parent.R[4] - 1) > 1e-12;
  if (!parentTilted && !hasTilt(child)) {
    const yaw = clean(Math.atan2(parent.R[2], parent.R[8]) / DEG);
    // (an unturned parent leaves the child's turn exactly as written)
    if (yaw) rec.rotation = clean((((yaw + (child.rotation ?? 0)) % 360) + 360) % 360);
    delete rec.tiltX;
    delete rec.tiltZ;
  } else {
    const e = matrixToEuler(mul(parent.R, rotationMatrix(child.rotation, child.tiltX, child.tiltZ)));
    rec.rotation = e.rotation;
    if (e.tiltX) rec.tiltX = e.tiltX;
    else delete rec.tiltX;
    if (e.tiltZ) rec.tiltZ = e.tiltZ;
    else delete rec.tiltZ;
  }
  return rec;
}

/**
 * The other way: fields in the world (x, z, the origin's height `oy`, rotation, tiltX, tiltZ:
 * where the editor's gizmo left a child) as fields in its parent's frame { x, z, y, rotation,
 * tiltX?, tiltZ? } (y: metres above the parent's origin). r: rounding (decimals).
 */
export function toLocal(parent, world, r = 2) {
  const Rt = transpose(parent.R);
  const [lx, ly, lz] = apply(Rt, [world.x - parent.x, world.oy - parent.oy, world.z - parent.z]);
  const k = 10 ** r;
  const rd = (v) => clean(Math.round(v * k) / k);
  const e = matrixToEuler(mul(Rt, rotationMatrix(world.rotation, world.tiltX, world.tiltZ)));
  return { x: rd(lx), y: rd(ly), z: rd(lz), rotation: Math.round(e.rotation) % 360, tiltX: Math.round(e.tiltX) || undefined, tiltZ: Math.round(e.tiltZ) || undefined };
}

/**
 * Every object of one world with its record in that world (the children's from their parents'),
 * numbered as flattenObjects numbers them. `placed(i, rec)` gives back the height the origin of
 * object i went to (the voxelizer's), so that its children sit on it; without it each origin is
 * taken at h + y. Returns the entries with `rec` and `pose` added.
 */
export function resolveTree(objects, { h, size, placed } = {}) {
  const entries = flattenObjects(objects);
  for (const [i, e] of entries.entries()) {
    e.rec = e.parent < 0 ? e.node : childRecord(entries[e.parent].pose, e.node, h);
    const originY = placed?.(i, e.rec);
    e.pose = poseOf(e.rec, { h, originY, size });
  }
  return entries;
}

/* ---------------- places ---------------- */

/** Every place in a world's objects (deep: also in places in places), with where it lies in that world. */
function placesIn(objects, frame, h, size) {
  const found = [];
  const walk = (list, parentPose) => {
    for (const n of list ?? []) {
      if (!n) continue;
      if (isPlace(n)) {
        found.push({ node: n, at: placeAt(n, parentPose, frame) });
        continue;
      }
      const rec = parentPose ? childRecord(parentPose, n, h) : n;
      if (n.children?.length) walk(n.children, poseOf(rec, { h, size }));
    }
  };
  walk(objects, null);
  return found;
}

/** The world point (min corner of its box) of a place: its floor centre is at its x, y, z in its parent's frame. */
function placeAt(n, parentPose, frame) {
  if (!frame) return null;
  const l = [n.x ?? 0, n.y ?? 0, n.z ?? 0];
  const p = parentPose ? [parentPose.x, parentPose.oy, parentPose.z].map((v, k) => v + apply(parentPose.R, l)[k]) : l;
  const [sx, , sz] = n.world?.size ?? [0, 0, 0];
  return [frame[0] + p[0] - sx / 2, frame[1] + p[1], frame[2] + p[2] - sz / 2].map((v) => clean(v));
}

/** Does any world of the scene hold a place? */
export function hasPlaces(scene) {
  const lists = scene.zones ? Object.values(scene.zones).map((z) => z.objects) : [scene.objects];
  let any = false;
  for (const l of lists) eachNode(l, (n) => (any ||= isPlace(n)));
  return any;
}

/**
 * The places held by the scene's objects as zones of the scene (in place; returns the scene).
 * scene.zones[key] is the place object itself, put right after the zone it is in; its `box` is
 * where it lies in the world (when the zone it is in lies somewhere: an `origin` or a `box`) and
 * `within` the key of that zone. Zones that were places before and are no longer in any object
 * (deleted, or copies from a JSON round trip) are dropped, so it can be run again at any time.
 * A scene of one world with a place in it becomes a world of places: its world is the zone
 * 'main' at [0, 0, 0] (scene.world and scene.objects move into it).
 */
export function liftPlaces(scene) {
  if (!scene) return scene;
  if (!scene.zones) {
    if (!hasPlaces(scene)) return scene;
    const main = { name: scene.name ?? 'Main', world: scene.world, objects: scene.objects ?? [], view: scene.view, origin: [0, 0, 0] };
    for (const k of ['indoor', 'exposure', 'walkStart']) if (scene[k] !== undefined) main[k] = scene[k];
    scene.zones = { main };
    scene.startZone ??= 'main';
    scene.zone ??= 'main';
    scene.places = true;
    // (its world and objects are the zone's now: main.js takes the current zone's again)
    delete scene.world;
    delete scene.objects;
  }
  const out = {};
  const lift = (key, zd) => {
    out[key] = zd;
    const frame = zd.origin ?? zd.box ?? null;
    for (const { node, at } of placesIn(zd.objects, frame, zd.world?.h ?? 0, zd.world?.size)) {
      let k = node.key || 'place';
      // (two places of one name: the second gets another; the editor renames on adding: uniquifyPlaces)
      while (out[k] && out[k] !== node) k = `${k}_`;
      node.key = k;
      node.within = key;
      if (at) node.box = at;
      else delete node.box;
      delete node.origin; // (inside another place: it is not in the open sea)
      lift(k, node);
    }
  };
  for (const [key, zd] of Object.entries(scene.zones)) if (!isPlace(zd) && zd) lift(key, zd);
  scene.zones = out;
  if (scene.zone && !out[scene.zone]) scene.zone = scene.startZone && out[scene.startZone] ? scene.startZone : Object.keys(out)[0];
  if (scene.startZone && !out[scene.startZone]) scene.startZone = Object.keys(out)[0];
  return scene;
}

/** The keys of every zone and every place of a scene (taken names). */
export function placeKeys(scene) {
  const keys = new Set(Object.keys(scene.zones ?? {}));
  const lists = scene.zones ? Object.values(scene.zones).map((z) => z.objects) : [scene.objects];
  for (const l of lists) eachNode(l, (n) => isPlace(n) && n.key && keys.add(n.key));
  return keys;
}

/**
 * Give the places in an object (a new one, or a copy) names not yet taken, and point what led to
 * them (string params in the object, its hatch to 'below', a ladder down to 'lower') to the new
 * names. Returns the renames { old: new }.
 */
export function uniquifyPlaces(obj, taken) {
  const renames = {};
  const used = new Set(taken);
  eachNode([obj], (n) => {
    if (!isPlace(n)) return;
    const k0 = n.key || 'place';
    let k = k0;
    for (let i = 2; used.has(k); i++) k = `${k0}${i}`;
    used.add(k);
    if (k !== n.key) renames[n.key ?? k0] = k;
    n.key = k;
  });
  if (Object.keys(renames).length)
    eachNode([obj], (n) => {
      for (const [p, v] of Object.entries(n.params ?? {})) if (typeof v === 'string' && renames[v]) n.params[p] = renames[v];
    });
  return renames;
}

/** A place where it is not one yet: a room of its own (8 × 3 × 6 m, 10 cm voxels, indoors). */
export function newPlace(key = 'room', o = {}) {
  return { type: PLACE, key, name: o.name ?? 'A room', indoor: true, world: { size: [8, 3, 6], h: 0.1, ground: 'concrete' }, view: { camera: [4, 5, -6], walk: true }, x: 0, y: 0, z: 0, objects: [], ...o };
}

/* ---------------- the models ---------------- */

/** A group: no voxels of its own, only what is in it (moved and turned as one). */
export const group = {
  label: 'Group (objects moved as one)',
  params: {},
  build: () => ({ prims: [] }),
};

/**
 * A place (a zone of its own) inside an object or a world: built as a world of its own when you
 * go there; nothing of it in the world it is in. (Its world, view and name are fields of the
 * object, not params.)
 */
export const place = {
  label: 'Place (a room of its own: a zone inside this one)',
  params: {},
  build: () => ({ prims: [] }),
  create: (o) => newPlace('room', o),
};
