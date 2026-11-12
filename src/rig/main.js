/**
 * The soldier rig test page (rig.html): the sculpted operator on a range of its own. Every clip,
 * the hit areas (shown, resized, with damage multipliers), the detachable gear (rifle, helmet,
 * pack as rigid bodies), an FPS readout, and the squad AI (ai/squad.js) on a range you edit
 * (walls, crates, the threat), with two teams that talk on the radio. Hand grenades fly, bounce
 * and go off here with a local blast (in the simulation's Squad scenario they are the real ones).
 * The Dragon tab (rig/dragon.js) shows the simulation's dragon instead: its acts, hit zones and
 * bleeding; the soldiers' range is hidden and paused while it is open.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OperatorFigure, loadOperatorAssets, PhysicsWorld, ZONES, showZones, placeZone, LABELS, MOVING, ONCE } from '../operator/rig.js';
import { SquadViz } from '../operator/squadviz.js';
import { SquadAI } from '../ai/squad.js';
import { driveFromAI } from '../operator/drive.js';
import { radioSay, setRadioSound, shoutSay, flashBang } from '../audio/radio.js';
import { WEAPONS } from '../sim/wounds.js';
import { SCENARIOS } from '../scenarios.js';
import { DragonRig } from './dragon.js';
import { goPage } from '../pages.js';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const toast = (m) => {
  const t = $('toast');
  t.textContent = m;
  t.style.opacity = 1;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.style.opacity = 0), 1600);
};

/* ================= renderer & range ================= */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
{
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#0f4c99');
  gr.addColorStop(0.6, '#2f78c2');
  gr.addColorStop(1, '#a9c9e4');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog('#b9cfe2', 30, 90);
const skyTex = scene.background;
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 v;void main(){vec3 sky=mix(vec3(.55,.75,.95),vec3(.08,.3,.7),clamp(v.y,0.,1.));vec3 gr=vec3(.42,.34,.24);vec3 c=v.y>0.?sky:gr;float s=pow(max(dot(v,normalize(vec3(-.5,.7,.6))),0.),400.)*40.;gl_FragColor=vec4(c+s,1.);}',
  })));
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.02).texture;
}
const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 250);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI * 0.495;
camera.position.set(12, 14, 19);
controls.target.set(0, 0, 0);
scene.add(new THREE.HemisphereLight('#cfe3ff', '#9a8260', 0.55));
const sun = new THREE.DirectionalLight('#fff0d4', 2.2);
sun.position.set(-8, 12, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);
const rimL = new THREE.DirectionalLight('#a8ccff', 0.7);
rimL.position.set(5, 4, -6);
scene.add(rimL);
{
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const id = g.createImageData(512, 512);
  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 512 * 512; i++) {
    const n = 0.86 + r() * 0.14;
    id.data.set([178 * n, 150 * n, 112 * n, 255], i * 4);
  }
  g.putImageData(id, 0, 0);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = r() < 0.5 ? '#8f7552' : '#e2cfa8';
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 20 + r() * 70, 8 + r() * 30, r() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  gm.rotation.x = -Math.PI / 2;
  gm.receiveShadow = true;
  scene.add(gm);
}

/* ================= walls and crates ================= */
const WORLD = { obstacles: [], start: new THREE.Vector3(0, 0, 10), threat: [0, 0, -11] };
const wallTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8ab95';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(70,60,45,.35)';
  g.lineWidth = 2;
  for (let y = 0; y < 256; y += 42) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
    for (let x = ((y / 42) % 2) * 40; x < 256; x += 80) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 42);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const crateMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6a43';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(40,25,10,.35)';
  for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 256, 3);
  g.strokeStyle = '#5b4229';
  g.lineWidth = 16;
  g.strokeRect(8, 8, 240, 240);
  g.beginPath();
  g.moveTo(16, 16);
  g.lineTo(240, 240);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
})();
let wallRot = 0;
function addObstacle(type, x, z, rot) {
  const W = type === 'wall' ? (rot ? 0.3 : 3) : 1.1, D = type === 'wall' ? (rot ? 3 : 0.3) : 1.1, H = type === 'wall' ? 1.25 : 1.1;
  let mat = crateMat;
  if (type === 'wall') {
    const map = wallTex.clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(W, D) / 1.5, 1);
    mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
  m.position.set(x, H / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  const ob = { type, x, z, rot, mesh: m, box: new THREE.Box3().setFromObject(m) };
  m.userData.ob = ob;
  WORLD.obstacles.push(ob);
  return ob;
}
[['wall', -3.5, 5.5, 0], ['crate', 2.6, 6.2, 0], ['crate', 3.7, 6.2, 0], ['wall', 4.6, 1.5, 1], ['crate', -1.2, 1.6, 0], ['wall', -5, -1.5, 1], ['wall', -1.5, -3.6, 0], ['crate', 3.2, -4.2, 0],
  ['wall', 5.4, -7.4, 0], ['crate', -3.6, -7.8, 0], ['crate', 0.6, -8.6, 0]].forEach((o) => addObstacle(...o));
// a low mound behind the walls: the gunner's high ground
const MOUND = { x: 6, z: 7.5, r: 3.6, h: 1.5 };
const moundAt = (x, z) => {
  const d = Math.hypot(x - MOUND.x, z - MOUND.z) / MOUND.r;
  return d >= 1 ? 0 : MOUND.h * 0.5 * (1 + Math.cos(Math.PI * d));
};
// a two-floor structure west of the walls: an open ground floor under a deck 3 m up, a staircase
// along its east side, glass rails (they stop you, not your sight)
const DECK = { x0: -13, x1: -5.8, z0: -4, z1: 2, h: 3 };
const STAIRS = { x0: -7, x1: -5.8, z0: 2, z1: 8 }; // from the ground at z1 up to the deck at z0
const stairY = (z) => (DECK.h * (STAIRS.z1 - z)) / (STAIRS.z1 - STAIRS.z0);
const onStairs = (x, z) => x >= STAIRS.x0 && x <= STAIRS.x1 && z >= STAIRS.z0 && z <= STAIRS.z1;
const onDeck = (x, z) => x >= DECK.x0 && x <= DECK.x1 && z >= DECK.z0 && z <= DECK.z1;
/** The floor under (x, z) for someone at height `from`: the deck, the stairs, or the ground. */
const floorAt = (x, z, from = 0) => {
  if (onStairs(x, z)) {
    const ys = stairY(z);
    if (from > ys - 1.2) return ys; // on the flight (below it: walking under the stairs)
  }
  if (onDeck(x, z) && from > DECK.h / 2) return DECK.h;
  return moundAt(x, z);
};
{
  const g = new THREE.CircleGeometry(MOUND.r, 48, 0, Math.PI * 2);
  g.rotateX(-Math.PI / 2);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setY(i, moundAt(pa.getX(i) + MOUND.x, pa.getZ(i) + MOUND.z) + 0.01);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#a99070', roughness: 1 }));
  m.position.set(MOUND.x, 0, MOUND.z);
  m.receiveShadow = true;
  scene.add(m);
}
/* ---------- the two-floor structure: deck, pillars, staircase, glass rails ---------- */
const STRUCT = { meshes: [], boxes: [], glass: [] };
{
  const concrete = new THREE.MeshStandardMaterial({ color: '#9c9890', roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: '#3d4247', roughness: 0.35, metalness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#d6eef2', roughness: 0.04, metalness: 0, transmission: 0.92, thickness: 0.02, ior: 1.5, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const box = (w, h, d, x, y, z, mat, solidToo = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = mat !== glass;
    m.receiveShadow = true;
    scene.add(m);
    STRUCT.meshes.push(m);
    if (solidToo) STRUCT.boxes.push(new THREE.Box3().setFromObject(m));
    return m;
  };
  const { x0, x1, z0, z1, h } = DECK;
  // the deck slab and its four pillars
  box(x1 - x0, 0.25, z1 - z0, (x0 + x1) / 2, h - 0.125, (z0 + z1) / 2, concrete);
  for (const [px, pz] of [[x0 + 0.3, z0 + 0.3], [x1 - 0.3, z0 + 0.3], [x0 + 0.3, z1 - 0.3], [x1 - 0.3, z1 - 0.3]]) box(0.35, h - 0.25, 0.35, px, (h - 0.25) / 2, pz, concrete);
  // the steps (20 x 0.3 m, 0.15 m rise) on a concrete flight
  const n = 20, run = (STAIRS.z1 - STAIRS.z0) / n, sw = STAIRS.x1 - STAIRS.x0, sx = (STAIRS.x0 + STAIRS.x1) / 2;
  for (let i = 0; i < n; i++) {
    const z = STAIRS.z1 - (i + 0.5) * run, top = ((i + 1) * h) / n;
    box(sw, 0.06, run + 0.02, sx, top - 0.03, z, concrete, false);
    box(sw, h / n, 0.04, sx, top - h / n / 2, z + run / 2, concrete, false);
  }
  const flight = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.2, Math.hypot(STAIRS.z1 - STAIRS.z0, h)), concrete);
  flight.position.set(sx, h / 2 - 0.16, (STAIRS.z0 + STAIRS.z1) / 2);
  flight.rotation.x = Math.atan2(h, STAIRS.z1 - STAIRS.z0);
  flight.castShadow = flight.receiveShadow = true;
  scene.add(flight);
  STRUCT.meshes.push(flight);
  // glass rails: panels 1 m high with a steel handrail on top
  const RAIL = 1.0;
  const rail = (ax, az, bx, bz, ya, yb) => {
    const L = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, cy = (ya + yb) / 2;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(L, RAIL), glass);
    pane.position.set(cx, cy + RAIL / 2, cz);
    pane.rotation.order = 'YXZ';
    pane.rotation.y = Math.atan2(bz - az, -(bx - ax)) + Math.PI;
    pane.rotation.z = Math.atan2(yb - ya, L) * (bx - ax !== 0 ? Math.sign(bx - ax) : 1) * (bx - ax !== 0 ? 1 : 0);
    if (bx === ax) pane.rotation.x = 0;
    scene.add(pane);
    STRUCT.meshes.push(pane);
    // a sloping pane (the stairs): shear it into a parallelogram along the flight
    if (ya !== yb) {
      pane.rotation.set(0, Math.PI / 2, 0);
      const g = pane.geometry, p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + ((p.getX(i) / L) * (yb - ya)) * (az < bz ? -1 : 1));
      p.needsUpdate = true;
      g.computeBoundingSphere();
    }
    const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(L, yb - ya), 8), steel);
    hr.position.set(cx, cy + RAIL + 0.02, cz);
    hr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx - ax, yb - ya, bz - az).normalize());
    scene.add(hr);
    STRUCT.meshes.push(hr);
    for (const [px, pz, py] of [[ax, az, ya], [bx, bz, yb]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, RAIL, 8), steel);
      post.position.set(px, py + RAIL / 2, pz);
      scene.add(post);
      STRUCT.meshes.push(post);
    }
    STRUCT.glass.push({ ax, az, bx, bz, ya, yb });
  };
  rail(x0, z0, x1, z0, h, h); // north
  rail(x0, z0, x0, z1, h, h); // west
  rail(x1, z0, x1, z1, h, h); // east
  rail(x0, z1, STAIRS.x0, z1, h, h); // south, up to the head of the stairs
  rail(STAIRS.x0, STAIRS.z0, STAIRS.x0, STAIRS.z1, h, 0); // both sides of the flight
  rail(STAIRS.x1, STAIRS.z0, STAIRS.x1, STAIRS.z1, h, 0);
}
/** Is (x, y, z) inside a glass rail (within 0.1 m of its line, between the floor and the handrail)? */
const inRail = (x, y, z) =>
  STRUCT.glass.some(({ ax, az, bx, bz, ya, yb }) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    if (t < 0 || t > 1) return false;
    if (Math.hypot(ax + dx * t - x, az + dz * t - z) > 0.12) return false;
    const fy = ya + (yb - ya) * t;
    return y > fy && y < fy + 1.0;
  });
/** The flight of stairs itself (a slab under the steps): low headroom under its lower half. */
const inFlight = (x, y, z) => onStairs(x, z) && y < stairY(z) && y > stairY(z) - 0.35;
const solidSeen = (x, y, z) =>
  WORLD.obstacles.some(({ box: b }) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && y > b.min.y && y < b.max.y) ||
  STRUCT.boxes.some((b) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && y > b.min.y && y < b.max.y) ||
  inFlight(x, y, z);
/** Solid to walk into: walls, crates, the structure, the glass rails (which do not block sight). */
const solid = (x, y, z) => solidSeen(x, y, z) || inRail(x, y, z);
/** A way between the floors: by the staircase (for the squad AI's floor-by-floor moves). */
function path3d(a, b) {
  const up = b[1] > a[1] + 1.5, down = a[1] > b[1] + 1.5;
  if (!up && !down) return [b.slice()];
  const sx = (STAIRS.x0 + STAIRS.x1) / 2, foot = [sx, 0, STAIRS.z1 + 0.6], head = [sx, DECK.h, STAIRS.z0 - 0.6];
  const flight = [];
  for (let z = STAIRS.z1; z >= STAIRS.z0 - 0.01; z -= 0.5) flight.push([sx, stairY(z), z]);
  const deckPts = (p) => [0.25, 0.5, 0.75, 1].map((k) => [head[0] + (p[0] - head[0]) * k, DECK.h, head[2] + (p[2] - head[2]) * k]);
  if (up) return [foot, ...flight, head, ...deckPts(b)];
  return [head, ...flight.reverse(), foot, b.slice()];
}
const physics = new PhysicsWorld({ ground: (x, z) => floorAt(x, z), boxes: () => WORLD.obstacles });
/** Line of sight at eye height, blocked by walls, crates and the deck (not by the glass). */
function lineOfSight(a, b) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2], b[1] - a[1]) / 0.3);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (solidSeen(a[0] + (b[0] - a[0]) * t, 1.0 + (a[1] + (b[1] - a[1]) * t), a[2] + (b[2] - a[2]) * t)) return false;
  }
  return true;
}
/* ---------- conditions: fog and night ---------- */
const COND = { fog: false, night: false };
function visibility() {
  return COND.fog ? 22 : 60;
}
function applyConditions() {
  scene.fog = new THREE.Fog(COND.night ? '#0b1220' : COND.fog ? '#c8ccd0' : '#b9cfe2', COND.fog ? 4 : 30, COND.fog ? 30 : 90);
  sun.intensity = COND.night ? 0.05 : COND.fog ? 0.9 : 2.2;
  scene.environmentIntensity = COND.night ? 0.05 : 1;
  scene.children.forEach((o) => o.isHemisphereLight && (o.intensity = COND.night ? 0.06 : 0.55));
  renderer.setClearColor(COND.night ? '#0b1220' : '#b9cfe2');
  scene.background = COND.night || COND.fog ? new THREE.Color(COND.night ? '#0b1220' : '#c8ccd0') : skyTex;
}
/* ---------- noises (made with the Noise tool, by shots, by blasts) ---------- */
const NOISES = [];
let noiseClock = 0;
function makeNoise(p, loud = 30, squad, ring = !squad && loud < 45) {
  NOISES.push({ p: [p[0], p[1] ?? 0, p[2]], loud, time: noiseClock, squad });
  if (NOISES.length > 60) NOISES.shift();
  if (!ring) return;
  const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: '#f1ead8', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  r.rotation.x = -Math.PI / 2;
  r.position.set(p[0], 0.06, p[2]);
  r.userData.t = 0;
  r.userData.max = Math.min(loud, 12);
  scene.add(r);
  RIPPLES.push(r);
}
const RIPPLES = [];

/* ================= soldiers ================= */
let A = null;
let showPaths = true, dropOnDeath = true, radioOn = true, bravoOn = true;
class Enemy {
  constructor(o) {
    this.name = o.name;
    this.hp = 100;
    this.loadout = o.loadout ?? 'rifle';
    this.fig = new OperatorFigure(A, { loadout: this.loadout });
    this.fig.group.userData.enemy = this;
    this.fig.zones.forEach((m) => (m.userData.enemy = this));
    scene.add(this.fig.group);
    // the member the squad AI moves (and the patrol below when it is off)
    this.d = { p: o.position.slice(), yaw: o.facing ?? 0, squad: o.squad, unit: o.unit, loadout: this.loadout === 'torch' ? 'torch' : undefined, dead: false, armour: o.armour ?? true, skill: o.skill ?? { CMD: 'veteran', R2: 'recruit' }[o.squad] ?? 'regular' };
    this.fig.onRelease = (p) => {
      if (!(SQ.on && this.d.squad)) throwGrenade(p.toArray(), aimVel(p.toArray(), WORLD.threat));
    };
    // the flash-bang flies at the threat and goes off (here a flash only; the simulation does the rest)
    this.fig.onFlashRelease = (p) => {
      if (!(SQ.on && this.d.squad)) throwGrenade(p.toArray(), aimVel(p.toArray(), WORLD.threat), true);
    };
    applyGear(this.fig);
    this.fig.onFinished = (name) => {
      if (name === 'pickup' && !SQ.on) this.fig.reequip(['rifle']);
    };
  }
  get state() {
    return this.fig.shown;
  }
  play(name) {
    if (this.d.dead) return this;
    this.patrol = null;
    if (MOVING[name]) return this.startPatrol(name);
    if (name === 'deployDrone') {
      this.fig.droneTarget = V(WORLD.threat);
      if (!this.fig.deployDrone()) toast(this.fig.droneFly ? 'His drone is already up' : 'He needs his backpack on to deploy the drone');
      return this;
    }
    this.fig.play(name, { restart: !!ONCE[name] });
    return this;
  }
  startPatrol(mode) {
    const c = (this.home ??= this.d.p.slice());
    this.patrol = { i: 0, mode, pts: [0, 1, 2, 3].map((k) => [c[0] + Math.cos((k * Math.PI) / 2 + 0.4) * 2.6, 0, c[2] + Math.sin((k * Math.PI) / 2 + 0.4) * 2.6]) };
    this.fig.play(mode);
    return this;
  }
  damage(n, zone) {
    if (this.d.dead) return this;
    this.hp = Math.max(0, Math.round(this.hp - n));
    this.fig.hitFlash();
    if (this.hp <= 0) {
      this.d.dead = true;
      this.patrol = null;
      this.fig.play('die', { fade: 0.12 });
      if (dropOnDeath) this.dropT = 0.35;
    } else if (!(SQ.on && this.d.squad)) this.fig.play('hit', { fade: 0.06 });
    else this.fig.hitFlash();
    if (zone === 'head' && this.hp > 0) this.detach('helmet');
    onChange();
    return this;
  }
  detach(name, imp) {
    if (!this.fig.detach(name, physics, scene, imp)) return this;
    // without the rifle: draw the carbine from the back, or (none left) go and get the rifle
    if (name === 'rifle' && !this.d.dead && !this.fig.drawSecondary()) this.d.unarmed = true;
    return this;
  }
  /** Swap between the rifle and the flame gun (a new figure, in the same place). */
  setLoadout(l) {
    const old = this.fig;
    this.loadout = l;
    this.fig = new OperatorFigure(A, { loadout: l });
    this.fig.group.userData.enemy = this;
    this.fig.zones.forEach((m) => (m.userData.enemy = this));
    this.fig.onRelease = old.onRelease;
    this.fig.onFlashRelease = old.onFlashRelease;
    this.fig.onFinished = old.onFinished;
    applyGear(this.fig);
    scene.add(this.fig.group);
    old.dispose();
    this.d.loadout = l === 'torch' ? 'torch' : undefined;
    return this;
  }
  reequip() {
    this.fig.reequip();
    this.d.unarmed = false;
    return this;
  }
  dispose() {
    this.fig.dispose();
  }
  update(dt) {
    const d = this.d, f = this.fig, g = f.group;
    if (SQ.on && d.squad) {
      // the squad AI moves it: show what it says
      driveFromAI(f, d, (this.aiState ??= {})); // operator/drive.js
      f.droneGoal = d.droneGoal ? V(d.droneGoal) : null;
    } else if (this.patrol && !d.dead && MOVING[f.state] && f.shown === f.state) {
      const tgt = this.patrol.pts[this.patrol.i];
      const dx = tgt[0] - d.p[0], dz = tgt[2] - d.p[2], dist = Math.hypot(dx, dz);
      if (dist < 0.3) this.patrol.i = (this.patrol.i + 1) % 4;
      else {
        let dy = Math.atan2(dx, dz) - d.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        d.yaw += Math.max(-6 * dt, Math.min(6 * dt, dy));
        const sp = MOVING[f.state] * Math.max(0, Math.cos(dy)) ** 2;
        d.p[0] += Math.sin(d.yaw) * sp * dt;
        d.p[2] += Math.cos(d.yaw) * sp * dt;
      }
      f.setAim(null);
    } else f.setAim(null);
    if (!(SQ.on && d.squad)) d.p[1] = floorAt(d.p[0], d.p[2], d.p[1]);
    g.position.set(d.p[0], d.p[1], d.p[2]);
    g.rotation.y = d.yaw;
    f.setGear({ thermal: !!d.thermal, light: !!d.light });
    f.update(dt);
    if (this.dropT != null && (this.dropT -= dt) <= 0) {
      this.dropT = null;
      this.detach('rifle');
    }
  }
}

/* ================= grenades and blasts (local) ================= */
const nades = [];
const blasts = [];
function aimVel(from, to) {
  const d = Math.hypot(to[0] - from[0], to[2] - from[2]), T = Math.max(0.9, Math.min(1.6, d / 12));
  return [(to[0] - from[0]) / T, (to[1] - from[1] + 4.905 * T * T) / T, (to[2] - from[2]) / T];
}
function throwGrenade(from, vel, kind = 'frag') {
  const isFlash = kind === 'flash' || kind === true;
  const m = new THREE.Group();
  if (isFlash) m.add(A.flashbang.clone());
  else m.add(new THREE.Mesh(A.grenade, A.grenadeMat), new THREE.Mesh(A.grenadeFuse, A.black));
  m.position.set(...from);
  m.castShadow = true;
  scene.add(m);
  nades.push({ m, v: V(vel), fuse: isFlash ? 1.5 : 2.5, flash: isFlash });
}
/** A flashbang: a blinding flash and a bang, no blast; hostiles who have it in view are stunned a few seconds. */
function flash(p) {
  makeNoise([p.x, 0, p.z], 70, undefined, true);
  flashBang();
  const light = new THREE.PointLight('#fff8ee', 4000, 30, 1.5);
  light.position.copy(p).add(new THREE.Vector3(0, 0.4, 0));
  scene.add(light);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.position.copy(light.position);
  s.scale.setScalar(3);
  scene.add(s);
  blasts.push({ light, parts: [], t: 0, flash: s });
  for (const h of HOSTILES) {
    const d = Math.hypot(h.d.p[0] - p.x, h.d.p[2] - p.z);
    if (!h.d.dead && d < 10 && lineOfSight([p.x, 0, p.z], h.d.p)) h.d.stunnedUntil = noiseClock + 5 * (1 - d / 12);
  }
}
const puffTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function explode(p) {
  makeNoise([p.x, 0, p.z], 60, undefined, true);
  // a grenade: ~0.18 kg of explosive; lethal close, wounding further out (as in the simulation)
  const R = 0.4 * Math.cbrt(8e5 / 1000);
  const light = new THREE.PointLight('#ffb060', 60, 18, 2);
  light.position.copy(p).add(new THREE.Vector3(0, 0.5, 0));
  scene.add(light);
  const parts = [];
  for (let i = 0; i < 26; i++) {
    const fire = i < 10;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: fire ? '#ffb347' : '#6d655a', transparent: true, opacity: fire ? 1 : 0.75, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4));
    s.userData.v = new THREE.Vector3((Math.random() - 0.5) * (fire ? 6 : 3), (fire ? 3 : 1.5) + Math.random() * 3, (Math.random() - 0.5) * (fire ? 6 : 3));
    s.userData.fire = fire;
    s.scale.setScalar(0.4);
    scene.add(s);
    parts.push(s);
  }
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: '#1d1a16', transparent: true, opacity: 0.55, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(p.x, 0.02, p.z);
  scene.add(scorch);
  blasts.push({ light, parts, t: 0 });
  // soldiers: hurt by distance; a close blast knocks the helmet off
  for (const e of Enemies.list) {
    const d = Math.hypot(p.x - e.d.p[0], p.y - (e.d.p[1] + 1), p.z - e.d.p[2]);
    if (d < R * 1.5) {
      const dmg = 160 * (1 - d / (R * 1.5));
      if (dmg > 50 && !e.fig.parts.helmet.userData.pivot) e.detach('helmet', new THREE.Vector3(e.d.p[0] - p.x, 2, e.d.p[2] - p.z).normalize().multiplyScalar(4));
      e.damage(dmg);
    }
  }
  // loose gear is thrown
  for (const b of physics.bodies) {
    const off = b.o.position.clone().sub(p);
    const d = off.length();
    if (d < R * 2) {
      b.asleep = false;
      b.v.add(off.normalize().multiplyScalar(8 * (1 - d / (R * 2))).add(new THREE.Vector3(0, 3, 0)));
    }
  }
}
function stepGrenades(dt) {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    n.fuse -= dt;
    if (!n.rest) {
      n.v.y -= 9.81 * dt;
      n.m.position.addScaledVector(n.v, dt);
      n.m.rotation.x += dt * 8;
      if (n.m.position.y < 0.04) {
        n.m.position.y = 0.04;
        n.v.y *= -0.3;
        n.v.x *= 0.5;
        n.v.z *= 0.5;
        if (Math.abs(n.v.y) < 0.6) n.rest = true;
      }
      const P = n.m.position;
      for (const ob of WORLD.obstacles) {
        const b = ob.box;
        if (P.x > b.min.x && P.x < b.max.x && P.z > b.min.z && P.z < b.max.z && P.y < b.max.y) {
          P.y = b.max.y + 0.04;
          n.v.multiplyScalar(0.3);
        }
      }
    }
    if (n.fuse <= 0) {
      (n.flash ? flash : explode)(n.m.position.clone());
      scene.remove(n.m);
      nades.splice(i, 1);
    }
  }
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    b.t += dt;
    b.light.intensity = b.flash ? (b.t < 0.15 ? 4000 : 0) : Math.max(0, 60 * (1 - b.t / 0.35));
    if (b.flash) {
      b.flash.material.opacity = Math.max(0, 1 - b.t / 0.25);
      b.flash.scale.setScalar(3 + b.t * 10);
    }
    for (const s of b.parts) {
      s.position.addScaledVector(s.userData.v, dt);
      s.userData.v.multiplyScalar(s.userData.fire ? 0.9 : 0.97);
      s.userData.v.y += dt * 0.6;
      s.scale.setScalar(0.4 + b.t * (s.userData.fire ? 5 : 2.4));
      s.material.opacity = Math.max(0, (s.userData.fire ? 1 - b.t / 0.6 : 0.75 * (1 - b.t / 4)));
    }
    if (b.t > 4) {
      scene.remove(b.light, ...b.parts);
      if (b.flash) scene.remove(b.flash);
      blasts.splice(i, 1);
    }
  }
}

/* ================= squads ================= */
const Enemies = { list: [], squads: [], zones: ZONES, world: WORLD };
window.Enemies = Enemies;
const SQ = { on: true };
const viz = new SquadViz(scene);
/** The height the team mostly stands at (the deck or the ground): the level its grid is built on. */
function teamLevel(unit) {
  const al = Enemies.list.map((e) => e.d).filter((d) => d.unit === unit && !d.dead);
  return al.length ? al.reduce((a, d) => a + d.p[1], 0) / al.length : 0;
}
function host(unit) {
  return {
    unit,
    members: () => Enemies.list.map((e) => e.d),
    solid,
    // the floor under him (the deck, the stairs or the ground); for the grid: the team's level
    floor: (x, z, m) => floorAt(x, z, m ? m.p[1] : teamLevel(unit)),
    path3d,
    indoors: (p) => onDeck(p[0], p[2]) || onStairs(p[0], p[2]),
    hostiles: () => HOSTILES.map((h) => h.d),
    noises: () => NOISES,
    lineOfSight,
    visibility,
    dark: () => COND.night,
    bounds: [-16, -16, 16, 16],
    threat: WORLD.threat,
    peers: () => Enemies.squads,
    // a round at target (already scattered by his expertise, ai/soldier.js): a hit if it lands on
    // a hostile's body (less of him shows behind cover); damage by the weapon
    fire: (m, target, weapon = 'rifle') => {
      makeNoise(m.p, 45, m.unit);
      const h = HOSTILES.filter((x) => !x.d.dead).sort((a, b) => Math.hypot(a.d.p[0] - target[0], a.d.p[2] - target[2]) - Math.hypot(b.d.p[0] - target[0], b.d.p[2] - target[2]))[0];
      const miss = h ? Math.hypot(h.d.p[0] - target[0], h.d.p[2] - target[2], (h.d.p[1] + 1.0 - target[1]) * 0.5) : Infinity;
      if (h && miss < (h.d.covered ? 0.18 : 0.38) && lineOfSight(m.p, h.d.p)) h.damage(35 * (WEAPONS[weapon]?.dmg ?? 1));
      Enemies.list.find((e) => e.d === m)?.fig.muzzle(0.05);
    },
    grenade: (m, from, vel) => throwGrenade(from, vel),
    flashbang: (m, from, vel) => throwGrenade(from, vel, 'flash'),
    stab: (m, h) => HOSTILES.find((x) => x.d === h)?.damage(45),
    shout: (m, text) => {
      if (radioOn) shoutSay(text);
      $('squadStatus').textContent = 'Shout: ' + text;
    },
    now: () => noiseClock,
    droneLaunch: (m, T) => {
      const e = Enemies.list.find((x) => x.d === m);
      if (e) e.fig.droneTarget = V(T);
    },
    rifleAt: (m) => {
      const e = Enemies.list.find((x) => x.d === m);
      const b = e?.fig.parts.rifle.userData.body;
      return b && b.asleep ? e.fig.partAt('rifle').toArray() : null;
    },
    pickup: (m) => Enemies.list.find((x) => x.d === m)?.fig.reequip(['rifle']),
    radio: (m, text, kind) => {
      if (radioOn) radioSay(text, { reply: kind === 'reply' });
      $('squadStatus').textContent = 'Radio: ' + text;
    },
  };
}
function spawn(o) {
  const e = new Enemy(Object.assign({ name: 'Enemy ' + (Enemies.list.length + 1) }, o));
  Enemies.list.push(e);
  return e;
}
Enemies.spawn = (o = {}) => spawn(Object.assign({ position: [0, 0, 0] }, o, { position: o.position ?? [0, 0, 0] }));
function startSquads() {
  Enemies.list.forEach((e) => e.dispose());
  Enemies.list.length = 0;
  const S = WORLD.start, T = V(WORLD.threat);
  const team = (unit, origin, roles) => {
    const fwd = T.clone().sub(origin).setY(0).normalize(), side = new THREE.Vector3(fwd.z, 0, -fwd.x), yaw = Math.atan2(fwd.x, fwd.z);
    roles.forEach(([r, sx, b, loadout]) => {
      const p = origin.clone().addScaledVector(side, sx).addScaledVector(fwd, -b);
      spawn({ name: `${unit} ${r}${loadout === 'torch' ? ' (flame)' : ''}`, position: [p.x, 0, p.z], facing: yaw, squad: r, unit, loadout });
    });
  };
  team('Alpha', S, [['CMD', -1, 0], ['MG', 1, 0.2], ['R1', -1.4, 1.6], ['R2', 1.4, 1.8], ['UAV', 0, 3.4]]);
  if (bravoOn) team('Bravo', S.clone().add(new THREE.Vector3(-9, 0, 0)), [['CMD', -0.8, 0], ['MG', 0.8, 0.3], ['R2', 0, 1.6, 'torch']]);
  Enemies.squads = [...new Set(Enemies.list.map((e) => e.d.unit))].map((u) => new SquadAI(host(u)));
  for (const s of Enemies.squads) {
    s.on = SQ.on;
    s.threat = null; // no contact yet: they listen and look
  }
  HOSTILES.forEach((h) => h.dispose());
  HOSTILES.length = 0;
  for (const [x, z, x2, z2] of [[-2, -10, 4, -9], [5, -12, -1, -13], [-6, -11, -6, -6]]) spawnHostile([x, 0, z], [x2, 0, z2]);
  setTimeout(() => makeNoise([1, 0, -9], 40), 2500);
  select(Enemies.list[0]);
}
function setAI(v) {
  SQ.on = v;
  for (const s of Enemies.squads) s.on = v;
  const b = $('aiStart');
  b.textContent = v ? 'Stop squad AI' : 'Start squad AI';
  b.classList.toggle('on', v);
}
/* ---------- hostiles: patrol, notice the team, take cover and fire back ---------- */
const HOSTILES = [];
class Hostile {
  constructor(p, p2) {
    this.fig = new OperatorFigure(A, { zones: false });
    this.fig.autoFlash = false;
    scene.add(this.fig.group);
    this.d = { p: p.slice(), yaw: Math.PI, hp: 100, dead: false };
    this.route = [p.slice(), p2.slice()];
    this.i = 1;
    this.state = 'patrol';
    this.cd = 0;
    this.tag = textTag('HOSTILE', '#d4553b');
    scene.add(this.tag);
  }
  damage(n) {
    if (this.d.dead) return;
    this.d.hp -= n;
    this.fig.hitFlash();
    this.state = 'alert';
    if (this.d.hp <= 0) {
      this.d.dead = true;
      this.fig.play('die', { fade: 0.12 });
      this.tag.visible = false;
    } else this.fig.play('hit', { fade: 0.06 });
  }
  dispose() {
    this.fig.dispose();
    scene.remove(this.tag);
  }
  update(dt) {
    const d = this.d, f = this.fig;
    // blinded by a flashbang: he staggers, does nothing else
    if (!d.dead && (d.stunnedUntil ?? 0) > noiseClock) {
      f.play('hit');
      return;
    }
    if (!d.dead) {
      const squad = Enemies.list.filter((e) => !e.d.dead);
      const range = COND.night ? 12 : visibility();
      const near = squad.filter((e) => Math.hypot(e.d.p[0] - d.p[0], e.d.p[2] - d.p[2]) < range && lineOfSight(d.p, e.d.p));
      const heard = NOISES.some((n) => n.squad && noiseClock - n.time < 1 && Math.hypot(n.p[0] - d.p[0], n.p[2] - d.p[2]) < n.loud);
      if (near.length || heard) this.state = 'alert';
      if (this.state === 'patrol') {
        const t = this.route[this.i];
        const dx = t[0] - d.p[0], dz = t[2] - d.p[2], l = Math.hypot(dx, dz);
        if (l < 0.3) this.i = 1 - this.i;
        else {
          d.yaw = Math.atan2(dx, dz);
          d.p[0] += (dx / l) * 1.1 * dt;
          d.p[2] += (dz / l) * 1.1 * dt;
        }
        f.play('walk');
      } else {
        // crouched behind what he has, firing bursts at the nearest he can see
        d.covered = true;
        const tgt = near.sort((a, b) => Math.hypot(a.d.p[0] - d.p[0], a.d.p[2] - d.p[2]) - Math.hypot(b.d.p[0] - d.p[0], b.d.p[2] - d.p[2]))[0];
        if (tgt) d.yaw = Math.atan2(tgt.d.p[0] - d.p[0], tgt.d.p[2] - d.p[2]);
        this.cd -= dt;
        if (tgt && this.cd <= 0) {
          this.cd = 2 + Math.random() * 1.5;
          f.play('crouchShoot', { restart: true, fade: 0.1 });
          for (let k = 0; k < 3; k++) setTimeout(() => !d.dead && f.muzzle(0.05), k * 120);
          makeNoise(d.p, 45);
          if (Math.random() < 0.18) tgt.damage(30);
        } else if (this.cd < 1.5) f.play('crouchAim');
      }
    }
    d.p[1] = floorAt(d.p[0], d.p[2], d.p[1]);
    f.group.position.set(d.p[0], d.p[1], d.p[2]);
    f.group.rotation.y = d.yaw;
    f.update(dt);
    this.tag.position.set(d.p[0], d.p[1] + 2.3, d.p[2]);
    if (d.marked && !this.marked) {
      this.marked = true;
      scene.remove(this.tag);
      this.tag = textTag('HOSTILE · MARKED', '#ff3b2f');
      scene.add(this.tag);
    }
  }
}
function textTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,22,18,.82)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = color;
  g.fillRect(0, 58, 256, 6);
  g.font = '700 34px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f1ead8';
  g.fillText(text, 128, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }));
  s.scale.set(0.9, 0.22, 1);
  return s;
}
function spawnHostile(p, p2) {
  // his beat: 3 m along; up on the deck it stays on the deck
  const along = p[1] > 1.5 && onDeck(p[0], p[2]) ? (p[0] + 3 < DECK.x1 - 0.5 ? 3 : -3) : 3;
  const h = new Hostile(p, p2 ?? [p[0] + along, p[1], p[2]]);
  HOSTILES.push(h);
  return h;
}
Enemies.hostiles = HOSTILES;
function setThreat(p) {
  WORLD.threat = [p.x, 0, p.z];
  for (const s of Enemies.squads) s.setThreat(WORLD.threat);
}

/* ================= UI ================= */
let selected = null, allMode = false, fireMode = false, tool = 'select';
const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 40), new THREE.MeshBasicMaterial({ color: '#f1ead8', transparent: true, opacity: 0.8, depthWrite: false }));
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.02;
scene.add(ring);
function select(e) {
  selected = e;
  onChange();
}
function onChange() {
  const e = selected;
  if (!e) return;
  $('selName').textContent = e.name;
  $('selState').textContent = (e.d.dead ? 'down' : LABELS[e.fig.shown] || e.fig.shown) + (e.fig.armed ? '' : ' · unarmed') + ' · ' + e.hp + ' HP';
  const hp = $('selHp');
  hp.style.width = e.hp + '%';
  hp.style.background = e.hp > 50 ? 'var(--ok)' : e.hp > 25 ? 'var(--accent)' : 'var(--hurt)';
  document.querySelectorAll('#anims button').forEach((b) => b.classList.toggle('on', !e.d.dead && b.dataset.a === e.fig.shown));
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('section[data-pane]').forEach((s) => (s.hidden = s.dataset.pane !== b.dataset.tab));
}));
// every scene of the project, one click away
{
  const sel = document.createElement('select');
  sel.id = 'sceneSel';
  sel.setAttribute('aria-label', 'All scenes');
  sel.innerHTML = '<option value="">All scenes…</option>' + Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  sel.onchange = () => sel.value && goPage(SCENARIOS[sel.value].page, SCENARIOS[sel.value].page ? null : sel.value); // (pages.js)
  $('stats').after(sel);
}
const animBox = $('anims');
Object.keys(LABELS).forEach((k) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = LABELS[k];
  b.dataset.a = k;
  if (k === 'hit' || k === 'die') b.classList.add('warn');
  b.onclick = () => {
    setAI(false);
    for (const e of allMode ? Enemies.list : [selected]) {
      if (!e) continue;
      if (k === 'hit') e.damage(e.hp > 25 ? 25 : 0);
      else if (k === 'die') e.damage(e.hp);
      else e.play(k);
    }
    onChange();
  };
  animBox.appendChild(b);
});
const tg = (id, fn) => {
  const b = $(id);
  b.onclick = () => {
    const v = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(v));
    fn(v);
  };
  return b;
};
tg('tgAll', (v) => (allMode = v));
const f1 = tg('tgFire', (v) => {
  fireMode = v;
  $('tgFire2').setAttribute('aria-pressed', String(v));
  if (v) setTool('select');
});
tg('tgFire2', (v) => {
  fireMode = v;
  f1.setAttribute('aria-pressed', String(v));
  if (v) setTool('select');
});
tg('tgPaths', (v) => (viz.show = showPaths = v));
tg('tgZones', (v) => showZones(v));
tg('tgDrop', (v) => (dropOnDeath = v));
tg('tgRadio', (v) => setRadioSound((radioOn = v)));
tg('tgFog', (v) => ((COND.fog = v), applyConditions()));
tg('tgNight', (v) => ((COND.night = v), applyConditions()));
$('btnSilence').onclick = () => Enemies.squads[0]?.radioSilence(30);
tg('tgBravo', (v) => {
  bravoOn = v;
  setAI(true);
  startSquads();
});
$('aiStart').onclick = () => {
  if (SQ.on) setAI(false);
  else {
    setAI(true);
    startSquads();
  }
};
$('aiRestart').onclick = () => {
  setAI(true);
  startSquads();
};
function setTool(t) {
  tool = t;
  document.querySelectorAll('#tools button[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === t));
}
document.querySelectorAll('#tools button[data-tool]').forEach((b) => (b.onclick = () => {
  setTool(b.dataset.tool);
  toast({ select: 'Click a soldier to select it', wall: 'Click the ground to place a wall', crate: 'Click the ground to place a crate', erase: 'Click a wall or crate to remove it', noise: 'Click the ground to make a noise there', hostile: 'Click the ground to place a hostile', investigate: 'Click where the commander should send two men to look' }[tool]);
}));
$('rotBtn').onclick = (ev) => {
  wallRot = wallRot ? 0 : 1;
  ev.target.textContent = 'Wall ' + (wallRot ? '90°' : '0°');
};
document.querySelectorAll('[data-det]').forEach((b) => (b.onclick = () => selected?.detach(b.dataset.det)));
$('reequip').onclick = () => selected?.reequip();
$('swapLoad').onclick = () => selected && (selected.setLoadout(selected.loadout === 'torch' ? 'rifle' : 'torch'), onChange());
/* ---------- weapon in hand, armour, reload speed, look up / down ---------- */
const GEAR = { armour: true, reload: 1, look: 0 };
/** The team-wide settings on a (new) figure. */
function applyGear(f) {
  f.setArmour(GEAR.armour);
  f.setClipSpeed('reload', GEAR.reload);
  f.setLook(GEAR.look);
}
const gearTargets = () => (allMode ? Enemies.list : [selected]).filter((e) => e && !e.d.dead);
{
  const box = document.createElement('div');
  box.innerHTML = `<div class="lab">Weapon in hand</div>
    <div class="grid" id="weapons"><button type="button" data-w="rifle">Rifle</button><button type="button" data-w="secondary">Carbine</button><button type="button" data-w="knife">Knife</button></div>
    <div class="row"><button id="tgArmour" type="button" aria-pressed="true">Armour</button></div>
    <label class="sl"><span>Reload ×</span><input type="range" id="reloadS" min="0.7" max="1.5" step="0.05" value="1"><output id="reloadO">×1.00</output></label>
    <label class="sl"><span>Look</span><input type="range" id="lookS" min="-1.1" max="1.1" step="0.05" value="0"><output id="lookO">0°</output></label>
    <p class="hint">Switching puts the weapon in his hands away (the rifle onto his back, the carbine over the shoulder, the knife into its sheath on the right thigh), then draws the other. Without armour he fights in his shirt. A veteran reloads faster. Look bends the head and upper body, the rifle with them, over any clip.</p>`;
  document.querySelector('section[data-pane="gear"] p.hint').before(box);
}
document.querySelectorAll('#weapons button').forEach((b) => (b.onclick = () => {
  for (const e of gearTargets()) {
    const s = e.fig.switchWeapon(b.dataset.w);
    toast(s ? `${b.textContent} in ${s.toFixed(1)} s` : `${e.name}: already in hand, or gone`);
  }
}));
tg('tgArmour', (v) => {
  GEAR.armour = v;
  for (const e of [...Enemies.list, ...HOSTILES]) e.fig.setArmour(v);
});
$('reloadS').oninput = () => {
  GEAR.reload = +$('reloadS').value;
  $('reloadO').textContent = '×' + GEAR.reload.toFixed(2);
  for (const e of Enemies.list) e.fig.setClipSpeed('reload', GEAR.reload);
};
$('lookS').oninput = () => {
  const v = +$('lookS').value;
  $('lookO').textContent = Math.round((v * 180) / Math.PI) + '°';
  for (const e of gearTargets()) e.fig.setLook(v);
};
function setRange(id, v) {
  $(id).value = v;
  $(id).oninput();
}
// hit-area editor
const zSel = $('zoneSel');
ZONES.forEach((z, i) => {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = z.label;
  zSel.appendChild(o);
});
const zR = $('zR'), zL = $('zL'), zM = $('zM');
function zoneUI() {
  const z = ZONES[+zSel.value];
  zR.value = z.r;
  zL.value = z.len;
  zM.value = z.mult;
  $('zRo').textContent = (+z.r).toFixed(3);
  $('zLo').textContent = (+z.len).toFixed(2);
  $('zMo').textContent = '×' + (+z.mult).toFixed(1);
}
function zoneApply() {
  const z = ZONES[+zSel.value];
  z.r = +zR.value;
  z.len = +zL.value;
  z.mult = +zM.value;
  zoneUI();
  for (const e of Enemies.list) for (const m of e.fig.zones) if (m.userData.zone === z) placeZone(m, z);
}
zSel.onchange = zoneUI;
[zR, zL, zM].forEach((s) => (s.oninput = zoneApply));
zoneUI();
// clicks: a soldier always comes first (select, damage), then the editing tools
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), gPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let down = null;
renderer.domElement.addEventListener('pointerdown', (ev) => (down = [ev.clientX, ev.clientY]));
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(Enemies.list.filter((e) => !e.d.dead).flatMap((e) => e.fig.zones), false);
  if (hits.length && (tool === 'select' || fireMode)) {
    const { enemy, zone } = hits[0].object.userData;
    select(enemy);
    if (fireMode) {
      const dmg = 25 * zone.mult;
      enemy.damage(dmg, zone.k);
      $('lastHit').textContent = `Last hit: ${zone.label} ×${zone.mult.toFixed(1)} = ${Math.round(dmg)} damage on ${enemy.name}.`;
      toast(`${zone.label} · ${Math.round(dmg)} dmg`);
    }
    return;
  }
  if (tool === 'select') return;
  if (tool === 'erase') {
    const h = ray.intersectObjects(WORLD.obstacles.map((o) => o.mesh), false);
    if (!h.length) return;
    const ob = h[0].object.userData.ob;
    scene.remove(ob.mesh);
    WORLD.obstacles.splice(WORLD.obstacles.indexOf(ob), 1);
    for (const s of Enemies.squads) s.replan();
    return;
  }
  // a point on the ground, or up on the deck / the stairs if that is what was clicked
  const up = ray.intersectObjects(STRUCT.meshes, false)[0];
  const p = up && up.point.y > 0.3 && (onDeck(up.point.x, up.point.z) || onStairs(up.point.x, up.point.z)) ? up.point.clone() : ray.ray.intersectPlane(gPlane, new THREE.Vector3());
  if (!p) return;
  p.x = Math.round(p.x * 2) / 2;
  p.z = Math.round(p.z * 2) / 2;
  p.y = floorAt(p.x, p.z, p.y + 0.3);
  if (Math.abs(p.x) > 16 || Math.abs(p.z) > 16) return toast('Place inside the 32 m range');
  if (tool === 'noise') {
    makeNoise([p.x, p.y, p.z], 35);
    toast('A noise: the nearest team sends men to look');
    return;
  }
  if (tool === 'hostile') {
    spawnHostile([p.x, p.y, p.z]);
    toast('A hostile: he patrols until he sees or hears the team');
    return;
  }
  if (tool === 'investigate') {
    Enemies.squads[0]?.investigate([p.x, p.y, p.z], 'location');
    setTool('select');
    return;
  }
  addObstacle(tool, p.x, p.z, tool === 'wall' ? wallRot : 0);
  for (const s of Enemies.squads) s.replan();
});

/* ================= the dragon (its own tab: rig/dragon.js) ================= */
const dragonRig = (window.Dragon = new DragonRig({ scene, camera, controls, renderer, toast, $, qs }));

/* ================= build, then run ================= */
function setProg(n, p) {
  const el = $('pb-' + n);
  if (!el) return;
  const v = Math.round(p * 100) + '%';
  el.textContent = v;
  $('bb-' + n).style.width = v;
}
const BAR = { person: 'body', carrier: 'body', pack: 'body', legs: 'legs', face: 'head', helmet: 'head', hands: 'rifle', gun: 'rifle', mag: 'rifle' };
const prog = {};
loadOperatorAssets({ lod: qs.get('lod') || 'game', sync: !!qs.get('sync'), onProgress: (n, p) => {
  prog[n] = p;
  const groups = {};
  for (const [k, b] of Object.entries(BAR)) (groups[b] ??= []).push(prog[k] ?? 0);
  for (const [b, v] of Object.entries(groups)) setProg(b, v.reduce((a, x) => a + x, 0) / v.length);
} }).then((assets) => {
  A = assets;
  const mk = new THREE.Group();
  if (qs.get('anim')) {
    setAI(false);
    spawn({ position: [0, 0, 6], facing: 0.3 });
    spawn({ position: [-1.6, 0, 6.6], facing: 0.3 });
    for (const e of Enemies.list) e.play(qs.get('anim'));
    select(Enemies.list[0]);
  } else startSquads();
  if (qs.get('det')) for (const p of qs.get('det').split(',')) Enemies.list[0]?.detach(p);
  if (qs.get('load')) for (const e of Enemies.list) e.setLoadout(qs.get('load'));
  if (qs.get('anim2')) for (const e of Enemies.list) e.play(qs.get('anim2'));
  // ?weapon=knife|secondary|rifle  ?armour=0  ?look=<rad>  ?reload=<speed>
  if (qs.get('armour') === '0') $('tgArmour').click();
  if (qs.get('reload')) setRange('reloadS', qs.get('reload'));
  if (qs.get('look')) setRange('lookS', qs.get('look'));
  if (qs.get('weapon')) for (const e of Enemies.list) e.fig.switchWeapon(qs.get('weapon'));
  // ?play=stab&at=2.2: a clip later on (after a switch), for stills with ?t=
  if (qs.get('play')) LATER.push({ at: +(qs.get('at') ?? 2), fn: () => Enemies.list.forEach((e) => e.play(qs.get('play'))) });
  if (qs.get('zones') === '1') $('tgZones').click();
  $('build').hidden = true;
  $('stats').textContent = `Skinned sculpt · ${Math.round(A.tris / 1000)}k tris · 21 bones · ${Object.keys(LABELS).length} clips`;
  scene.add(mk);
  window.__ready = true;
});

/* ================= loop + FPS ================= */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 52 : 36;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
if (qs.get('nopanel')) {
  document.querySelector('.panel').hidden = true;
  $('fps').hidden = true;
}
if (qs.get('cam')) {
  const c = qs.get('cam').split(',').map(Number);
  camera.position.set(c[0], c[1], c[2]);
  controls.target.set(c[3], c[4], c[5]);
}
const fpsN = $('fpsN'), fpsD = $('fpsD'), fpsT = $('fpsT'), fpsG = $('fpsG').getContext('2d');
const hist = [];
let acc = 0, frames = 0, lastShown = performance.now();
const clock = new THREE.Clock();
let fixedT = qs.get('t') ? +qs.get('t') : null, frozen = false, now = 0;
const LATER = [];
function tick(dt) {
  now += dt;
  for (let i = LATER.length - 1; i >= 0; i--) if (now >= LATER[i].at) LATER.splice(i, 1)[0].fn();
  noiseClock += dt;
  for (const s of Enemies.squads) {
    s.time ??= 0;
    s.step(dt);
  }
  for (const h of HOSTILES) h.update(dt);
  for (let i = RIPPLES.length - 1; i >= 0; i--) {
    const r = RIPPLES[i];
    r.userData.t += dt;
    r.scale.setScalar(0.5 + r.userData.max * r.userData.t);
    r.material.opacity = Math.max(0, 0.8 - r.userData.t * 0.8);
    if (r.userData.t > 1) {
      scene.remove(r);
      RIPPLES.splice(i, 1);
    }
  }
  for (const e of Enemies.list) e.update(dt);
  physics.step(dt);
  stepGrenades(dt);
  viz.update(Enemies.list.map((e) => e.d), SQ.on ? Enemies.squads.filter((s) => s.threat).map((s) => s.threat) : [], now);
}
renderer.setAnimationLoop(() => {
  let dt = Math.min(clock.getDelta(), 0.05);
  const t0 = performance.now();
  if (fixedT != null && window.__ready) {
    for (let i = 0; i < Math.ceil(fixedT / 0.033); i++) tick(0.033);
    fixedT = null;
    frozen = true;
  }
  if (frozen) dt = 0;
  if (A && !dragonRig.active) tick(dt);
  if (selected) {
    ring.position.set(selected.d.p[0], 0.02, selected.d.p[2]);
    ring.visible = !selected.d.dead;
  }
  if (Enemies.list.length && Math.random() < 0.08) onChange();
  dragonRig.update(dt);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const tn = performance.now();
  acc += tn - t0;
  if (tn - lastShown > 500) {
    const fps = (frames * 1000) / (tn - lastShown);
    const n = Math.round(fps);
    fpsN.textContent = n;
    fpsN.className = n >= 50 ? 'g' : n >= 30 ? 'y' : 'r';
    fpsD.textContent = (1000 / fps).toFixed(1) + ' ms frame · ' + (acc / frames).toFixed(1) + ' ms cpu';
    fpsT.textContent = (renderer.info.render.triangles / 1e6).toFixed(2) + 'M tris · ' + renderer.info.render.calls + ' calls';
    hist.push(fps);
    if (hist.length > 40) hist.shift();
    fpsG.clearRect(0, 0, 150, 28);
    fpsG.strokeStyle = 'rgba(201,185,148,.3)';
    fpsG.beginPath();
    fpsG.moveTo(0, 28 - 60 * 0.4);
    fpsG.lineTo(150, 28 - 60 * 0.4);
    fpsG.stroke();
    fpsG.strokeStyle = '#c9b994';
    fpsG.beginPath();
    hist.forEach((v, i) => {
      const x = (i * 150) / 39, y = 28 - Math.min(70, v) * 0.4;
      i ? fpsG.lineTo(x, y) : fpsG.moveTo(x, y);
    });
    fpsG.stroke();
    frames = 0;
    acc = 0;
    lastShown = tn;
  }
});
