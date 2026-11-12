/**
 * A military camp with a drone operations desk (camp.html).
 *
 * The drones fly by the group logic of the drones repo (vendor/drones, a git submodule): leader
 * election and handover, formation, low-energy radio, cooperative localisation, and its
 * electronic warfare: jammers that cut the radio link to the central (here, the camp) and/or
 * satellite navigation. This page only draws that simulation and gives the camp around it.
 *
 * The drone operator (the sculpted operator, operator/rig.js) walks from the gate to his desk in
 * the command tent and sits down at six monitors, one per drone (its live camera, and a status
 * strip: leader, battery, GNSS, link), and a big tactical map: where each drone last reported
 * from (greyed when the link is lost), the route, the jammers and the jamming the swarm found.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OperatorFigure, loadOperatorAssets } from '../operator/rig.js';
import { Simulation } from '../../vendor/drones/src/core/sim.js';
import { SCENARIOS } from '../scenarios.js';
import { goPage } from '../pages.js';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const N = 6;
const CFG = {
  seed: 11,
  swarm: { count: N, formation: 'v', spacing: 22 },
  terrain: { preset: 'hills' },
  nav: { gnss: true },
  jammers: { custom: [{ x: -260, z: 300, type: 'gnss', r: 300 }, { x: 330, z: -260, type: 'comms', r: 300 }] },
};
let sim = new Simulation(CFG);
const O = { ...sim.cfg.origin };
let H0 = sim.terrain.heightAt(O.x, O.z);
/** Drone-simulation coordinates to the scene (the camp at the origin, its ground at y = 0). */
const toScene = (p, out = new THREE.Vector3()) => out.set(p.x - O.x, p.y - H0, p.z - O.z);

/* ================= renderer, sky, light ================= */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fbfdc');
scene.fog = new THREE.Fog('#b4c9db', 200, 2600);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight('#d6e6ff', '#7a6a4e', 0.7));
const sun = new THREE.DirectionalLight('#fff0d4', 2.0);
sun.position.set(-40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
scene.add(sun);
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: '#8fb0d0', side: THREE.BackSide })));
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.02).texture;
}

/* ================= terrain (the drones' terrain, flattened under the camp) ================= */
const CAMP_R = 26;
function groundAt(x, z) {
  // scene coordinates; the camp is levelled
  const h = sim.terrain.heightAt(x + O.x, z + O.z) - H0;
  const d = Math.hypot(x, z);
  return d < CAMP_R ? 0 : d < CAMP_R + 30 ? h * ((d - CAMP_R) / 30) : h;
}
let terrainMesh;
function buildTerrain() {
  if (terrainMesh) scene.remove(terrainMesh);
  const S = sim.cfg.terrain.size;
  const g = new THREE.PlaneGeometry(S, S, 200, 200);
  g.rotateX(-Math.PI / 2);
  const pa = g.attributes.position, col = [];
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i) + (sim.terrain.cx ?? 0) - O.x, z = pa.getZ(i) - O.z;
    const y = groundAt(x, z);
    pa.setXYZ(i, x, y, z);
    const k = Math.min(1, Math.max(0, (y + H0) / 220));
    col.push(0.42 + 0.2 * k, 0.4 + 0.12 * k, 0.28 + 0.1 * k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  terrainMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}
buildTerrain();

/* ================= the camp ================= */
const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const M = { canvas: mat('#5d6748'), hesco: mat('#b49c74'), wood: mat('#7b5f3c'), metal: mat('#4b4f52', 0.5), desk: mat('#3f4347', 0.6), screen: mat('#0b0e12', 0.3), bag: mat('#a28c66') };
function box(w, h, d, m, x, y, z, ry = 0, parent = scene) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}
function tent(x, z, w, d, ry, open = false) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  const h = 2.2;
  box(w, h, 0.05, M.canvas, 0, h / 2, -d / 2, 0, g);
  if (!open) box(w, h, 0.05, M.canvas, 0, h / 2, d / 2, 0, g);
  box(0.05, h, d, M.canvas, -w / 2, h / 2, 0, 0, g);
  box(0.05, h, d, M.canvas, w / 2, h / 2, 0, 0, g);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.58, w * 0.58, d, 3, 1, false, 0, Math.PI * 2), M.canvas);
  roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  roof.scale.set(1, 1, 0.42);
  roof.position.y = h + 0.3;
  roof.castShadow = true;
  g.add(roof);
  scene.add(g);
  return g;
}
// perimeter of HESCO bastions with a gate to the south
for (let a = 0; a < Math.PI * 2; a += 0.075) {
  if (Math.abs(a - Math.PI * 1.5) < 0.12) continue;
  box(1.05, 1.3, 1.05, M.hesco, Math.cos(a) * CAMP_R * 0.85, 0.65, Math.sin(a) * CAMP_R * 0.85, -a);
}
tent(-9, 8, 5, 8, 0.1);
tent(-10, -4, 5, 8, -0.1);
tent(10, 9, 4, 6, 0.4);
// the command tent, open to the east, with the operations desk
const ops = tent(4, 2, 6, 5, Math.PI / 2, true);
for (let i = 0; i < 9; i++) box(0.6, 0.3, 0.35, M.bag, -14 + (i % 3) * 0.62, 0.15 + Math.floor(i / 3) * 0.3, -12, 0.2);
// the desk (scene space): in front of the operator's chair, screens on it
const DESK = { x: 4, z: 3.1, yaw: Math.PI }; // the operator faces -z ... set below
const desk = new THREE.Group();
desk.position.set(4, 0, 3.6);
scene.add(desk);
box(2.2, 0.05, 0.75, M.desk, 0, 0.75, 0, 0, desk);
for (const x of [-1.05, 1.05]) box(0.05, 0.75, 0.7, M.metal, x, 0.375, 0, 0, desk);
box(0.45, 0.02, 0.15, M.metal, 0.1, 0.785, -0.05, 0, desk); // keyboard
box(0.07, 0.02, 0.1, M.metal, -0.35, 0.785, -0.05, 0, desk); // mouse
// the chair
const chair = new THREE.Group();
chair.position.set(4, 0, 2.95);
scene.add(chair);
box(0.48, 0.06, 0.46, M.metal, 0, 0.45, 0, 0, chair);
box(0.46, 0.5, 0.05, M.metal, 0, 0.72, -0.24, 0, chair);
box(0.06, 0.45, 0.06, M.metal, 0, 0.22, 0, 0, chair);
void DESK;

/* ================= monitors: one per drone, and the tactical map ================= */
const camRT = [];
const strips = [];
const noise = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const d = g.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 200;
    d.data.set([v, v, v, 255], i);
  }
  g.putImageData(d, 0, 0);
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.fillRect(0, 50, 128, 28);
  g.fillStyle = '#ff5a4a';
  g.font = 'bold 15px monospace';
  g.textAlign = 'center';
  g.fillText('LINK LOST', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
for (let i = 0; i < N; i++) {
  const col = i % 3, row = Math.floor(i / 3);
  const x = -0.62 + col * 0.62, y = 1.3 - row * 0.4;
  const rt = new THREE.WebGLRenderTarget(320, 200);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  box(0.6, 0.38, 0.04, M.metal, x, y, 0.22, 0, desk);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.32), new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: false }));
  screen.position.set(x, y + 0.01, 0.195);
  screen.rotation.y = Math.PI;
  desk.add(screen);
  const sc = document.createElement('canvas');
  sc.width = 256;
  sc.height = 28;
  const st = new THREE.CanvasTexture(sc);
  st.colorSpace = THREE.SRGBColorSpace;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.06), new THREE.MeshBasicMaterial({ map: st, toneMapped: false }));
  strip.position.set(x, y - 0.17, 0.194);
  strip.rotation.y = Math.PI;
  desk.add(strip);
  const cam = new THREE.PerspectiveCamera(62, 1.6, 0.5, 3000);
  camRT.push({ rt, cam, screen });
  strips.push({ c: sc, g: sc.getContext('2d'), t: st });
}
// the big map, on a stand beside the desk
const mapC = document.createElement('canvas');
mapC.width = mapC.height = 512;
const mapG = mapC.getContext('2d');
const mapT = new THREE.CanvasTexture(mapC);
mapT.colorSpace = THREE.SRGBColorSpace;
box(1.1, 1.1, 0.04, M.metal, 1.75, 1.35, 0.3, -0.5, desk);
const mapScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.04), new THREE.MeshBasicMaterial({ map: mapT, toneMapped: false }));
mapScreen.position.set(1.74, 1.35, 0.27);
mapScreen.rotation.y = Math.PI - 0.5;
desk.add(mapScreen);
box(0.08, 0.8, 0.08, M.metal, 1.75, 0.4, 0.3, 0, desk);
// the terrain behind the map, drawn once
const relief = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const S = sim.cfg.terrain.size;
  const img = g.createImageData(512, 512);
  for (let j = 0; j < 512; j++)
    for (let i = 0; i < 512; i++) {
      const x = (i / 512 - 0.5) * S, z = (j / 512 - 0.5) * S;
      const h = sim.terrain.heightAt(x, z), hx = sim.terrain.heightAt(x + 6, z);
      const v = 40 + Math.min(80, h * 0.25) + (h - hx) * 3;
      img.data.set([v * 0.55, v * 0.62, v * 0.5, 255], (j * 512 + i) * 4);
    }
  g.putImageData(img, 0, 0);
  return c;
})();
const lastKnown = new Map();
function drawMap() {
  const g = mapG, S = sim.cfg.terrain.size;
  const P = (x, z) => [((x / S) + 0.5) * 512, ((z / S) + 0.5) * 512];
  g.drawImage(relief, 0, 0);
  g.lineWidth = 2;
  // jammers (truth, dashed) and what the swarm found (solid)
  for (const j of sim.jammers) {
    const [x, y] = P(j.x, j.z);
    g.setLineDash([6, 5]);
    g.strokeStyle = j.type === 'gnss' ? '#32d6ff' : '#c27bff';
    g.beginPath();
    g.arc(x, y, (j.r / S) * 512, 0, 7);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = g.strokeStyle;
    g.font = 'bold 12px monospace';
    g.fillText(`J${j.id} ${j.type === 'gnss' ? 'GNSS' : 'RADIO'}`, x - 26, y + 4);
  }
  const L = sim.leader;
  if (L) {
    for (const z of L.jamZones.values()) {
      const [x, y] = P(z.x, z.z);
      g.fillStyle = 'rgba(255,90,74,.18)';
      g.beginPath();
      g.arc(x, y, (z.r / S) * 512, 0, 7);
      g.fill();
    }
    const wp = L.plan?.waypoints ?? L.plan?.path ?? [];
    if (wp.length) {
      g.strokeStyle = '#ffd34a';
      g.beginPath();
      wp.forEach((w, k) => {
        const [x, y] = P(w.x, w.z);
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
  }
  // the central (the camp) and the destination
  const [cx, cy] = P(sim.central.x, sim.central.z);
  g.fillStyle = '#8fe08f';
  g.fillRect(cx - 6, cy - 6, 12, 12);
  g.fillText('CAMP', cx + 9, cy + 4);
  const [dx, dy] = P(sim.cfg.destination.x, sim.cfg.destination.z);
  g.strokeStyle = '#fff';
  g.strokeRect(dx - 7, dy - 7, 14, 14);
  // the drones: where they last reported from (the central only knows what reaches it)
  for (const d of sim.drones) {
    if (d.c2Ok && d.status !== 'crashed') lastKnown.set(d.id, { x: d.loc.est.x, z: d.loc.est.z, t: sim.t });
    const k = lastKnown.get(d.id) ?? { x: d.truePos.x, z: d.truePos.z, t: 0 };
    const [x, y] = P(k.x, k.z);
    const live = d.c2Ok && d.flying();
    g.fillStyle = d.status === 'crashed' ? '#ff5a4a' : live ? (d.isLeader ? '#ffd34a' : '#f1ead8') : '#7d8288';
    g.beginPath();
    g.arc(x, y, d.isLeader ? 6 : 4.5, 0, 7);
    g.fill();
    g.fillText(`D${d.id}${live ? '' : d.status === 'crashed' ? ' X' : ` ${Math.round(sim.t - k.t)}s`}`, x + 7, y - 5);
  }
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(0, 0, 512, 24);
  g.fillStyle = '#f1ead8';
  g.font = 'bold 14px monospace';
  const inC = sim.drones.filter((d) => d.flying() && d.c2Ok).length, fl = sim.drones.filter((d) => d.flying()).length;
  g.fillText(`T+${sim.t.toFixed(0)}s  LINK ${inC}/${fl}  LEADER ${L ? 'D' + L.id : '-'}  ${sim.phase.toUpperCase()}`, 8, 17);
  mapT.needsUpdate = true;
}
function drawStrip(i) {
  const d = sim.drones[i], s = strips[i], g = s.g;
  g.fillStyle = '#101418';
  g.fillRect(0, 0, 256, 28);
  g.font = 'bold 15px monospace';
  g.fillStyle = d.isLeader ? '#ffd34a' : '#f1ead8';
  const ok = (v) => (v ? '✓' : '✗');
  const txt = d.status === 'crashed' ? `D${i} DOWN` : `D${i}${d.isLeader ? ' LEAD' : ''} ${Math.round(d.batteryFrac() * 100)}% GNSS${ok(d.gnssOk)} C2${ok(d.c2Ok)}`;
  g.fillText(txt, 6, 19);
  s.t.needsUpdate = true;
}

/* ================= drones, jammers ================= */
let A = null;
const droneObjs = [];
function buildDrones() {
  droneObjs.forEach((o) => scene.remove(o.g));
  droneObjs.length = 0;
  for (const d of sim.drones) {
    const g = A ? A.drone.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), M.metal);
    g.scale.setScalar(2.2);
    const tag = makeTag(`D${d.id}`);
    tag.position.y = 0.6;
    g.add(tag);
    scene.add(g);
    droneObjs.push({ g, tag, props: g.children.filter((c) => c.geometry?.parameters?.width === 0.13) });
  }
}
function makeTag(text) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 36;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(16,20,24,.8)';
  g.fillRect(0, 0, 96, 36);
  g.fillStyle = '#f1ead8';
  g.font = 'bold 22px monospace';
  g.textAlign = 'center';
  g.fillText(text, 48, 26);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, sizeAttenuation: false }));
  s.scale.set(0.05, 0.019, 1);
  return s;
}
let jamGroup;
function buildJammers() {
  if (jamGroup) scene.remove(jamGroup);
  jamGroup = new THREE.Group();
  for (const j of sim.jammers) {
    const p = toScene({ x: j.x, y: sim.terrain.heightAt(j.x, j.z), z: j.z });
    const color = j.type === 'gnss' ? 0x32d6ff : j.type === 'comms' ? 0xb36bff : 0xe05cff;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 22, 8), M.metal);
    mast.position.set(p.x, p.y + 11, p.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(j.r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    dome.position.copy(p);
    jamGroup.add(mast, dome);
  }
  scene.add(jamGroup);
}
buildJammers();

/* ================= the operator ================= */
let op = null;
const WALK = [[0, -22], [1, -10], [5.6, -2], [5.6, 2.2], [4, 2.55]];
let wi = 0;
function updateOperator(dt) {
  if (!op) return;
  const g = op.group;
  if (wi < WALK.length) {
    const [tx, tz] = WALK[wi];
    const dx = tx - g.position.x, dz = tz - g.position.z, l = Math.hypot(dx, dz);
    if (l < 0.12) wi++;
    else {
      g.rotation.y = Math.atan2(dx, dz);
      const s = Math.min(l, 1.35 * dt);
      g.position.x += (dx / l) * s;
      g.position.z += (dz / l) * s;
      op.play('walk');
    }
    if (wi === WALK.length) {
      // at his desk: sit facing the screens
      g.position.set(chair.position.x, 0, chair.position.z - 0.05);
      g.rotation.y = 0;
      op.play('deskSit', { fade: 0.6 });
      seated = true;
    }
  }
  op.update(dt);
}
let seated = false;

/* ================= panel ================= */
const events = $('events');
let speed = 1, view = 'desk', follow = 0;
function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'camp') {
    camera.position.set(28, 22, -30);
    controls.target.set(2, 0, 0);
  } else if (v === 'desk') {
    camera.position.set(4.9, 1.75, 1.7);
    controls.target.set(3.95, 1.15, 3.8);
  }
}
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => {
  speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
}));
$('btnFollow').onclick = () => {
  view = 'drone';
  follow = (follow + 1) % N;
  $('btnFollow').textContent = `Follow D${follow}`;
};
$('btnJammer').onclick = () => {
  placing = !placing;
  $('btnJammer').classList.toggle('on', placing);
  $('hint').textContent = placing ? 'Click the terrain to place a jammer (radio + GNSS, 300 m)' : '';
};
$('btnRestart').onclick = () => restart();
{
  const sel = $('sceneSel');
  sel.innerHTML = '<option value="">All scenes…</option>' + Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  sel.onchange = () => sel.value && goPage(SCENARIOS[sel.value].page, SCENARIOS[sel.value].page ? null : sel.value); // (pages.js)
}
let placing = false;
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!placing) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const h = ray.intersectObject(terrainMesh)[0];
  if (!h) return;
  sim.addJammer(h.point.x + O.x, h.point.z + O.z, 'both', 300, true);
  buildJammers();
  placing = false;
  $('btnJammer').classList.remove('on');
  $('hint').textContent = '';
});
function restart() {
  sim = new Simulation(CFG);
  lastKnown.clear();
  buildDrones();
  buildJammers();
  sim.on(logEvent);
}
sim.on(logEvent);
function logEvent(type, e) {
  if (type !== 'event') return;
  if (!['ew', 'leader', 'mission', 'failure', 'threat'].includes(e.type)) return;
  const li = document.createElement('li');
  li.textContent = `T+${e.t.toFixed(0)}s ${e.text}`;
  li.className = e.type;
  events.prepend(li);
  while (events.children.length > 9) events.lastChild.remove();
}

/* ================= loop ================= */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
setView(qs.get('view') || 'desk');
const clock = new THREE.Clock();
let acc = 0, mapT0 = 0, rr = 0, fixed = qs.get('t') ? +qs.get('t') : null;
const v = new THREE.Vector3();
function tick(dt) {
  // the drones' own simulation, in its fixed steps; it starts once he sits down
  if (seated || qs.get('t')) {
    acc += dt * speed;
    const sdt = sim.cfg.dt;
    let n = 0;
    while (acc >= sdt && n++ < 40) {
      sim.step(sdt);
      acc -= sdt;
    }
  }
  updateOperator(dt);
  sim.drones.forEach((d, i) => {
    const o = droneObjs[i];
    if (!o) return;
    toScene(d.truePos, o.g.position);
    o.g.position.y = Math.max(o.g.position.y, groundAt(o.g.position.x, o.g.position.z) + 0.05);
    const sp = Math.hypot(d.trueVel.x, d.trueVel.z);
    if (sp > 0.5) o.g.rotation.y = Math.atan2(d.trueVel.x, d.trueVel.z);
    o.g.rotation.x = Math.min(0.3, sp * 0.02);
    for (const p of o.props) p.rotation.y += d.flying() ? dt * 60 : 0;
    // its camera, looking ahead and down
    const c = camRT[i]?.cam;
    if (c) {
      c.position.copy(o.g.position).add(v.set(0, -0.3, 0));
      c.rotation.set(-0.45, o.g.rotation.y + Math.PI, 0, 'YXZ');
    }
  });
}
renderer.setAnimationLoop(() => {
  let dt = Math.min(clock.getDelta(), 0.05);
  if (fixed != null && A) {
    for (let k = 0; k < Math.ceil(fixed / 0.05); k++) tick(0.05);
    fixed = null;
    window.__frozen = true;
  }
  if (window.__frozen) dt = 0;
  tick(dt);
  // the monitors: two drone cameras a frame (round robin); the map and strips 3 times a second
  for (let k = 0; k < 2; k++) {
    const i = rr++ % N;
    const d = sim.drones[i], m = camRT[i];
    if (!d.c2Ok || !d.flying()) m.screen.material.map = noise;
    else {
      m.screen.material.map = m.rt.texture;
      // (the monitors themselves stay out of the drone cameras: no texture feedback loop)
      droneObjs[i].g.visible = false;
      for (const q of camRT) q.screen.visible = false;
      renderer.setRenderTarget(m.rt);
      renderer.render(scene, m.cam);
      renderer.setRenderTarget(null);
      for (const q of camRT) q.screen.visible = true;
      droneObjs[i].g.visible = true;
    }
  }
  mapT0 -= dt;
  if (mapT0 <= 0 || window.__frozen) {
    mapT0 = 0.33;
    drawMap();
    for (let i = 0; i < N; i++) drawStrip(i);
  }
  if (view === 'drone') {
    const o = droneObjs[follow];
    if (o) {
      controls.target.copy(o.g.position);
      camera.position.copy(o.g.position).add(v.set(-25, 12, 25));
    }
  }
  $('clock').textContent = `T+${sim.t.toFixed(0)} s · ${sim.drones.filter((d) => d.flying()).length}/${N} flying · link ${sim.drones.filter((d) => d.flying() && d.c2Ok).length}`;
  controls.update();
  renderer.render(scene, camera);
});

/* ================= build the operator ================= */
buildDrones();
loadOperatorAssets({ lod: 'game', sync: !!qs.get('sync') }).then((assets) => {
  A = assets;
  buildDrones();
  op = new OperatorFigure(A, { zones: false });
  op.group.position.set(WALK[0][0], 0, WALK[0][1]);
  scene.add(op.group);
  if (qs.get('t')) {
    wi = WALK.length - 1;
    op.group.position.set(WALK[wi][0], 0, WALK[wi][1] - 0.2);
  }
  $('build').hidden = true;
  window.__ready = true;
});
