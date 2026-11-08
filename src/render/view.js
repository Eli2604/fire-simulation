import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VoxelRenderer } from './voxels.js';
import { FlameRenderer } from './flames.js';
import { SmokeRenderer } from './smoke.js';
import { RainRenderer } from './rain.js';
import { SprayRenderer } from './spray.js';
import { DebrisRenderer } from './debris.js';
import { deriveWeather } from '../sim/weather.js';

const SKY_CLEAR = new THREE.Color(0x8fb7dc);
const SKY_GREY = new THREE.Color(0x8d939a);
const SKY_FOG = new THREE.Color(0xb9bec2);

/** Owns the three.js scene and all renderers of the simulation state. */
export class View {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.root = new THREE.Group(); // world coordinates: origin at the grid corner
    this.scene.add(this.root);

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x4a3f30, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 0, 1.6);
    this.root.add(this.fireLight);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x5b5236, roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.root.add(this.ground);

    this.voxels = new VoxelRenderer(this.root);
    this.flames = new FlameRenderer(this.root);
    this.smoke = new SmokeRenderer(this.root);
    this.rain = new RainRenderer(this.root);
    this.spray = new SprayRenderer(this.root);
    this.debris = new DebrisRenderer(this.root);
    this.flashLight = new THREE.PointLight(0xffd7a0, 0, 0, 1.4);
    this.root.add(this.flashLight);
    this.flash = null;
    this.seenEvents = 0;
    this.raycaster = new THREE.Raycaster();
    this.fireLightOn = true;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Point size scale: pixels per metre at distance 1. */
  pointScale() {
    const h = this.renderer.domElement.height;
    return h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  setWorld(world, cameraOffset, keepCamera = false) {
    this.world = world;
    const [sx, sy, sz] = world.size;
    const diag = Math.hypot(sx, sy, sz);
    this.voxels.setWorld(world);
    this.flames.setWorld(world);
    this.smoke.setWorld(world);
    this.spray.setScale(world);
    this.seenEvents = 0;
    this.flash = null;

    this.ground.scale.set(diag * 12, diag * 12, 1);
    this.ground.position.set(sx / 2, world.h * 0.985, sz / 2);

    this.camera.near = Math.max(0.002, world.h * 0.3);
    this.camera.far = diag * 30;
    this.camera.updateProjectionMatrix();
    const target = new THREE.Vector3(sx / 2, sy * 0.22, sz / 2);
    const sameSize = this.lastSize && this.lastSize.every((v, k) => Math.abs(v - world.size[k]) < 1e-6);
    this.lastSize = world.size.slice();
    if (!(keepCamera && sameSize)) this.placeCamera(target, cameraOffset);
    this.controls.maxDistance = diag * 6;
    this.controls.update();
    this.sizeShadows(world, diag);
  }

  placeCamera(target, cameraOffset) {
    const [sx, sy, sz] = this.world.size;
    this.controls.target.copy(target);
    const off = cameraOffset ? new THREE.Vector3(...cameraOffset) : new THREE.Vector3(sx * 0.6, sy * 0.8, sz * 1.1);
    // scenario camera offsets are given in world coordinates relative to the corner
    this.camera.position.copy(cameraOffset ? off : target.clone().add(off));
  }

  sizeShadows(world, diag) {
    const [sx, , sz] = world.size;
    // sun + shadow frustum sized to the world
    const s = this.sun.shadow.camera;
    const r = diag * 0.75;
    s.left = -r;
    s.right = r;
    s.top = r;
    s.bottom = -r;
    s.near = 0.01;
    s.far = diag * 4;
    s.updateProjectionMatrix();
    this.sun.position.set(sx * 0.5 + diag * 0.6, diag * 1.2, sz * 0.5 + diag * 0.4);
    this.sun.target.position.set(sx / 2, 0, sz / 2);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = world.h * 0.5;
    this.diag = diag;
  }

  applyWeather(weather) {
    const D = deriveWeather(weather);
    const grey = Math.min(1, weather.rain / 12 + weather.fog * 0.6);
    const sky = SKY_CLEAR.clone().lerp(SKY_GREY, grey).lerp(SKY_FOG, weather.fog * 0.7);
    this.scene.background = sky;
    const fogDensity = weather.fog > 0 ? (weather.fog * 3.5) / this.diag : 0.02 / this.diag;
    this.scene.fog = new THREE.FogExp2(sky, fogDensity);
    const light = 1 - 0.55 * grey;
    this.sun.intensity = 2.4 * light * (1 - 0.6 * weather.fog);
    this.hemi.intensity = 0.9 + 0.3 * light;
    this.smoke.light = 0.55 + 0.45 * light;
    this.rh = D.rh;
  }

  /** Put the fire light at the centre of the flames, brightness from the heat release. */
  updateFireLight(stats) {
    const w = this.world;
    if (!this.fireLightOn || !w) {
      this.fireLight.intensity = 0;
      return;
    }
    const { flame, anx, any, NA, ah } = w;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let s = 0;
    for (let a = 0; a < NA; a++) {
      const f = flame[a];
      if (f < 0.1) continue;
      const ax = a % anx;
      const ay = ((a - ax) / anx) % any;
      const az = (a - ax - ay * anx) / (anx * any);
      sx += f * ax;
      sy += f * ay;
      sz += f * az;
      s += f;
    }
    if (s === 0) {
      this.fireLight.intensity *= 0.9;
      return;
    }
    this.fireLight.position.set(((sx / s) + 0.5) * ah, ((sy / s) + 1) * ah, ((sz / s) + 0.5) * ah);
    // flicker, and scale so a fire filling ~1/3 of the scene lights it like daylight
    const ref = 1e5 * (this.diag / 10) ** 2;
    const k = Math.min(3, Math.sqrt(stats.hrr / ref + s * 0.002));
    const flick = 0.85 + 0.15 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3);
    this.fireLight.intensity = 6 * k * flick * (this.diag / 3) ** 2;
  }

  render(dt, sim) {
    const stats = sim.stats;
    this.time += dt;
    this.controls.update();
    this.voxels.update(this.time);
    const scale = this.pointScale();
    this.handleEvents();
    this.flames.update(dt, scale);
    this.smoke.update(scale, this.rh ?? 0.5);
    this.rain.update(dt, this.world, sim.weather);
    this.spray.update(dt, scale, sim.spray);
    this.debris.update(this.world);
    this.updateFireLight(stats);
    this.updateFlash(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** New explosion events: a bright flash and a burst of sparks. */
  handleEvents() {
    const w = this.world;
    if (!w) return;
    for (; this.seenEvents < w.events.length; this.seenEvents++) {
      const e = w.events[this.seenEvents];
      if (e.type !== 'explosion') continue;
      this.flash = { t: 0, pos: e.pos, power: Math.min(4, 0.5 + Math.cbrt(e.energy / 1e5)) };
      const n = Math.min(600, 150 + Math.round(e.energy / 2000));
      for (let k = 0; k < n; k++) {
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(Math.random() * 2 - 1) * 0.8;
        const sp = 4 + Math.random() * 14;
        this.flames.spawn(e.pos[0], e.pos[1], e.pos[2], Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp, Math.sin(ph) * Math.sin(th) * sp, 0.6 + Math.random() * 1.6, Math.max(0.01, w.h * 0.25), 1, 1);
      }
    }
  }

  updateFlash(dt) {
    const f = this.flash;
    if (!f) {
      this.flashLight.intensity = 0;
      return;
    }
    f.t += dt;
    const k = Math.max(0, 1 - f.t / 0.8);
    this.flashLight.position.set(...f.pos);
    this.flashLight.intensity = 400 * f.power * k * k * (this.diag / 3) ** 2;
    if (k <= 0) this.flash = null;
  }

  /** Raycast the voxels under a screen point. Returns { voxel, point, normal } or null. */
  pick(clientX, clientY) {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (!this.voxels.mesh) return null;
    const hits = this.raycaster.intersectObject(this.voxels.mesh, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const voxel = this.voxels.voxelOfInstance(hit.instanceId);
    const p = this.root.worldToLocal(hit.point.clone());
    return { voxel, point: [p.x, p.y, p.z], normal: hit.face ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] : [0, 1, 0] };
  }
}
