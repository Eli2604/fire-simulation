/**
 * The soldier rig test page (rig.html): the sculpted operator on a range of its own. Every clip,
 * the hit areas (shown, resized, with damage multipliers), the detachable gear (rifle, helmet,
 * pack as rigid bodies), an FPS readout, and the squad AI (ai/squad.js) on a range you edit
 * (walls, crates, the threat), with two teams that talk on the radio. Hand grenades fly, bounce
 * and go off here with a local blast (in the simulation's Squad scenario they are the real ones).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OperatorFigure, loadOperatorAssets, PhysicsWorld, ZONES, showZones, placeZone, LABELS, MOVING, ONCE } from '../operator/rig.js';
import { SquadViz } from '../operator/squadviz.js';
import { SquadAI } from '../ai/squad.js';
import { radioSay, setRadioSound } from '../audio/radio.js';
import { SCENARIOS } from '../scenarios.js';

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
const solid = (x, y, z) => WORLD.obstacles.some(({ box: b }) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && y > b.min.y && y < b.max.y);
const physics = new PhysicsWorld({ ground: () => 0, boxes: () => WORLD.obstacles });

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
    this.d = { p: o.position.slice(), yaw: o.facing ?? 0, squad: o.squad, unit: o.unit, loadout: this.loadout === 'torch' ? 'torch' : undefined, dead: false };
    this.fig.onRelease = (p) => {
      if (!(SQ.on && this.d.squad)) throwGrenade(p.toArray(), aimVel(p.toArray(), WORLD.threat));
    };
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
    this.fig.onFinished = old.onFinished;
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
      if (d.dead) f.play('die');
      else if (ONCE[f.shown] && f.current?.isRunning() && !(ONCE[d.anim] && d.animT !== this.animT)) {
        // let a draw, a throw or a radio call finish
      } else {
        const name = d.anim ?? 'crouchAim';
        if (ONCE[name] && d.animT !== this.animT) {
          this.animT = d.animT;
          if (name === 'deployDrone') f.deployDrone();
          else f.play(name, { restart: true, fade: 0.15 });
        } else if (!ONCE[name]) f.play(name);
        if (MOVING[f.state]) f.setSpeed(d.moving ? Math.max(0.5, Math.min(1.8, d.speed / MOVING[f.state])) : 0.001);
      }
      f.setAim(d.aimAt);
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
    g.position.set(d.p[0], d.p[1], d.p[2]);
    g.rotation.y = d.yaw;
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
function throwGrenade(from, vel) {
  const m = new THREE.Group();
  m.add(new THREE.Mesh(A.grenade, A.grenadeMat), new THREE.Mesh(A.grenadeFuse, A.black));
  m.position.set(...from);
  m.castShadow = true;
  scene.add(m);
  nades.push({ m, v: V(vel), fuse: 2.5 });
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
      explode(n.m.position.clone());
      scene.remove(n.m);
      nades.splice(i, 1);
    }
  }
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    b.t += dt;
    b.light.intensity = Math.max(0, 60 * (1 - b.t / 0.35));
    for (const s of b.parts) {
      s.position.addScaledVector(s.userData.v, dt);
      s.userData.v.multiplyScalar(s.userData.fire ? 0.9 : 0.97);
      s.userData.v.y += dt * 0.6;
      s.scale.setScalar(0.4 + b.t * (s.userData.fire ? 5 : 2.4));
      s.material.opacity = Math.max(0, (s.userData.fire ? 1 - b.t / 0.6 : 0.75 * (1 - b.t / 4)));
    }
    if (b.t > 4) {
      scene.remove(b.light, ...b.parts);
      blasts.splice(i, 1);
    }
  }
}

/* ================= squads ================= */
const Enemies = { list: [], squads: [], zones: ZONES, world: WORLD };
window.Enemies = Enemies;
const SQ = { on: true };
const viz = new SquadViz(scene);
function host(unit) {
  return {
    unit,
    members: () => Enemies.list.map((e) => e.d),
    solid,
    floor: () => 0,
    bounds: [-16, -16, 16, 16],
    threat: WORLD.threat,
    peers: () => Enemies.squads,
    fire: () => {},
    grenade: (m, from, vel) => throwGrenade(from, vel),
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
  for (const s of Enemies.squads) s.on = SQ.on;
  select(Enemies.list[0]);
}
function setAI(v) {
  SQ.on = v;
  for (const s of Enemies.squads) s.on = v;
  const b = $('aiStart');
  b.textContent = v ? 'Stop squad AI' : 'Start squad AI';
  b.classList.toggle('on', v);
}
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
  sel.innerHTML = '<option value="">All scenes…</option>' + Object.entries(SCENARIOS).filter(([, s]) => !s.page).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  sel.onchange = () => sel.value && (location.href = 'index.html?scenario=' + sel.value);
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
  toast({ select: 'Click a soldier to select it', wall: 'Click the ground to place a wall', crate: 'Click the ground to place a crate', erase: 'Click a wall or crate to remove it', threat: 'Click the ground to move the threat' }[tool]);
}));
$('rotBtn').onclick = (ev) => {
  wallRot = wallRot ? 0 : 1;
  ev.target.textContent = 'Wall ' + (wallRot ? '90°' : '0°');
};
document.querySelectorAll('[data-det]').forEach((b) => (b.onclick = () => selected?.detach(b.dataset.det)));
$('reequip').onclick = () => selected?.reequip();
$('swapLoad').onclick = () => selected && (selected.setLoadout(selected.loadout === 'torch' ? 'rifle' : 'torch'), onChange());
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
  const p = ray.ray.intersectPlane(gPlane, new THREE.Vector3());
  if (!p) return;
  p.x = Math.round(p.x * 2) / 2;
  p.z = Math.round(p.z * 2) / 2;
  if (Math.abs(p.x) > 16 || Math.abs(p.z) > 16) return toast('Place inside the 32 m range');
  if (tool === 'threat') {
    setThreat(p);
    setTool('select');
    toast('Threat moved: the teams call it in');
    return;
  }
  addObstacle(tool, p.x, p.z, tool === 'wall' ? wallRot : 0);
  for (const s of Enemies.squads) s.replan();
});

/* ================= build, then run ================= */
function setProg(n, p) {
  const el = $('pb-' + n);
  if (!el) return;
  const v = Math.round(p * 100) + '%';
  el.textContent = v;
  $('bb-' + n).style.width = v;
}
const BAR = { person: 'body', pack: 'body', legs: 'legs', face: 'head', helmet: 'head', hands: 'rifle', gun: 'rifle', mag: 'rifle' };
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
function tick(dt) {
  now += dt;
  for (const s of Enemies.squads) s.step(dt);
  for (const e of Enemies.list) e.update(dt);
  physics.step(dt);
  stepGrenades(dt);
  viz.update(Enemies.list.map((e) => e.d), SQ.on && Enemies.squads.length ? [WORLD.threat] : [], now);
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
  if (A) tick(dt);
  if (selected) {
    ring.position.set(selected.d.p[0], 0.02, selected.d.p[2]);
    ring.visible = !selected.d.dead;
  }
  if (Enemies.list.length && Math.random() < 0.08) onChange();
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
