import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VoxelRenderer } from './voxels.js';
import { FlameRenderer } from './flames.js';
import { SmokeRenderer } from './smoke.js';
import { RainRenderer } from './rain.js';
import { SprayRenderer } from './spray.js';
import { DebrisRenderer } from './debris.js';
import { SurfaceRenderer } from './surface.js';
import { VolumeRenderer } from './volume.js';
import { MarkerRenderer } from './markers.js';
import { PuddleRenderer } from './puddles.js';
import { TorchRenderer } from './torches.js';
import { OssuaryRenderer } from './ossuary.js';
import { VehicleRenderer } from './vehicles.js';
import { PropsRenderer } from './props.js';
import { DoorRenderer } from './doors.js';
import { TreeRenderer } from './trees.js';
import { BloodRenderer } from './blood.js';
import { EnemyRenderer } from './enemies.js';
import { DragonRenderer } from './dragon.js';
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
    // lights for wall torches and similar small flames (the nearest few get one)
    this.torchLights = [];
    for (let k = 0; k < 6; k++) {
      const l = new THREE.PointLight(0xffd2a0, 0, 10, 1.7);
      this.root.add(l);
      this.torchLights.push(l);
    }
    this.dark = false;
    this.aoOn = true; // ambient occlusion
    this.torchShadows = true;

    // pushed back in depth so it never fights with the ground surface of the grid (flicker)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x5b5236, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.root.add(this.ground);

    this.voxels = new VoxelRenderer(this.root);
    this.torches = new TorchRenderer(this.root); // wall torches as objects
    this.ossuary = new OssuaryRenderer(this.root); // walls built of skulls and bones
    this.vehicles = new VehicleRenderer(this.root); // the parked jet
    this.props = new PropsRenderer(this.root); // masts, radars, deck detail
    this.doors = new DoorRenderer(this.root); // doors drawn as doors
    this.trees = new TreeRenderer(this.root); // trees: bark and leaves
    this.blood = new BloodRenderer(this.root); // blood, bullet holes, shots
    this._camLocal = new THREE.Vector3();
    // flames and the extinguisher jet are drawn in a separate overlay pass (after the volumetric smoke)
    this.overlay = new THREE.Scene();
    this.flames = new FlameRenderer(this.overlay);
    this.smoke = new SmokeRenderer(this.root);
    this.rain = new RainRenderer(this.root);
    this.spray = new SprayRenderer(this.overlay);
    this.debris = new DebrisRenderer(this.root);
    this.surface = new SurfaceRenderer(this.root);
    this.volume = new VolumeRenderer(this.renderer);
    this.markers = new MarkerRenderer(this.root);
    this.markers.flames = this.flames;
    this.puddles = new PuddleRenderer(this.root);
    this.enemies = new EnemyRenderer(this.root, this.flames);
    this.dragons = new DragonRenderer(this.root, this.flames);
    this.surfaceMode = 'voxels'; // or 'smooth'
    this.smokeMode = 'particles'; // or 'volumetric'
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
    this.composer?.setSize(w, h);
  }

  /**
   * Ambient occlusion (GTAO, screen space): the light that reaches a crevice, a corner,
   * the gaps between stacked bones is less than on an open face. Rendered through a
   * composer (scene -> AO -> tone mapping); its depth buffer lets the flames and sparks
   * of the overlay pass still hide behind walls.
   */
  ensureComposer() {
    if (this.composer) return;
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const composer = new EffectComposer(r);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, distanceFallOff: 1, scale: 1.4, samples: 16 });
    ao.blendIntensity = 0.85;
    // flames, glows and other see-through billboards are no surfaces: keep them out of the AO
    ao.overrideVisibility = function () {
      const cache = this._visibilityCache;
      this.scene.traverse((o) => {
        cache.set(o, o.visible);
        if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO) o.visible = false;
      });
    };
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    composer.setSize(size.x, size.y);
    this.composer = composer;
    this.ao = ao;
  }

  /** Point size scale: pixels per metre at distance 1. */
  pointScale() {
    const h = this.renderer.domElement.height;
    return h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  setWorld(world, cameraOffset, keepCamera = false, markers = []) {
    this.world = world;
    this.markers.setMarkers(markers, world);
    const [sx, sy, sz] = world.size;
    const diag = Math.hypot(sx, sy, sz);
    this.voxels.setWorld(world);
    this.torches.setWorld(world);
    this.ossuary.setWorld(world);
    this.vehicles.setWorld(world);
    this.props.sunLight = this.sun; // stained glass: where its light falls, and how bright
    this.props.sunDir = new THREE.Vector3(...(this.sunDir ?? [0.6, 1.2, 0.4])).normalize();
    this.props.setWorld(world);
    this.doors.setWorld(world);
    this.trees.setWorld(world);
    this.blood.setWorld(world);
    this.flames.setWorld(world);
    this.smoke.setWorld(world);
    this.spray.setScale(world);
    this.surface.setWorld(world);
    this.puddles.setWorld(world);
    this.volume.setWorld(world);
    this.seenEvents = 0;
    this.flash = null;

    // a ship floats in the sea: a water surface around the hull instead of the ground
    if (this.sea) {
      this.root.remove(this.sea);
      this.sea.geometry.dispose();
      this.sea = null;
    }
    this.ground.visible = !world.sea && !world.vacuum;
    if (world.sea) {
      const R = diag * 12;
      const shape = new THREE.Shape([new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R), new THREE.Vector2(R, R), new THREE.Vector2(-R, R)]);
      const [x0, z0, x1, z1] = world.sea.box;
      if (x1 - x0 > 0.01 && z1 - z0 > 0.01) shape.holes.push(new THREE.Path([new THREE.Vector2(x0, -z0), new THREE.Vector2(x0, -z1), new THREE.Vector2(x1, -z1), new THREE.Vector2(x1, -z0)]));
      this.sea = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({ color: 0x1d4e6e, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
      );
      this.sea.rotation.x = -Math.PI / 2;
      this.sea.position.y = world.sea.level;
      this.sea.receiveShadow = true;
      this.root.add(this.sea);
    }
    this.ground.scale.set(diag * 12, diag * 12, 1);
    this.ground.position.set(sx / 2, world.h * 0.9, sz / 2);

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
    // the direction the sunlight comes from: the scene's own (view.sun), or a high sun from the south-east
    const sd = new THREE.Vector3(...(this.sunDir ?? [0.6, 1.2, 0.4])).normalize();
    this.sun.position.set(sx * 0.5 + sd.x * diag * 1.4, sd.y * diag * 1.4, sz * 0.5 + sd.z * diag * 1.4);
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
    // underground / indoor scenes: hardly any daylight
    const light = (1 - 0.55 * grey) * (this.dark ? 0.06 : 1);
    if (this.dark) {
      this.scene.background = new THREE.Color(0x050505);
      this.scene.fog = new THREE.FogExp2(0x050505, 0.02 / this.diag);
    }
    this.skyBase = this.scene.background.clone();
    this.fogBase = this.scene.fog.density;
    this.spaceT = 0;
    if (this.space) this.setSpaceBlend(1);
    else if (this.stars) this.stars.visible = false;
    this.sun.intensity = 2.4 * light * (1 - 0.6 * weather.fog);
    this.hemi.intensity = this.dark ? 0.32 : 0.9 + 0.3 * light;
    this.smoke.light = 0.55 + 0.45 * light;
    this.rh = D.rh;
  }

  /** The sea against a ship that settles, lists and trims (water aboard): its level and tilt. */
  updateSea() {
    const s = this.world?.sea;
    if (!this.sea || !s) return;
    const cx = (s.box[0] + s.box[2]) / 2;
    const cz = (s.box[1] + s.box[3]) / 2;
    const sx = s.slopeX ?? 0;
    const sz = s.slopeZ ?? 0;
    // the plane through (cx, level, cz) with slopes sx along x and sz along z
    const n = (this._seaN ??= new THREE.Vector3()).set(-sx, 1, -sz).normalize();
    const tilt = (this._seaQ ??= new THREE.Quaternion()).setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const flat = (this._seaFlat ??= new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    this.sea.quaternion.copy(tilt).multiply(flat);
    // its origin (x = 0, z = 0) lies on that plane
    this.sea.position.set(0, s.level - sx * cx - sz * cz, 0);
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
    // wall torches have lights of their own: their flames do not count towards the fire's light
    const torches = w.heaters.filter((h) => h.light).map((h) => h.pos);
    for (let a = 0; a < NA; a++) {
      const f = flame[a];
      if (f < 0.1) continue;
      const ax = a % anx;
      const ay = ((a - ax) / anx) % any;
      const az = (a - ax - ay * anx) / (anx * any);
      if (torches.length) {
        const px = (ax + 0.5) * ah;
        const py = (ay + 0.5) * ah;
        const pz = (az + 0.5) * ah;
        if (torches.some((t) => Math.abs(t[0] - px) < 0.8 && Math.abs(t[2] - pz) < 0.8 && py > t[1] - 0.6 && py < t[1] + 1.2)) continue;
      }
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
    const torchW = w.heaters.reduce((q, h) => q + (h.light && h.on ? h.power : 0), 0);
    const k = Math.min(3, Math.sqrt(Math.max(0, stats.hrr - torchW) / ref + s * 0.002));
    const flick = 0.85 + 0.15 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3);
    this.fireLight.intensity = 6 * k * flick * (this.diag / 3) ** 2;
  }

  /**
   * Blend towards space (t = 0 on the ground … 1 above the atmosphere): the sky
   * goes black, the haze thins out, the stars come out, and the view reaches
   * much further (the ground far below, the spaceship far above).
   */
  setSpaceBlend(t) {
    t = Math.max(0, Math.min(1, t));
    if (!this.stars) {
      const n = 2500;
      const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * r * 9000, u * 9000, Math.sin(a) * r * 9000], k * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -1;
      this.scene.add(this.stars);
    }
    if (Math.abs(t - (this.spaceT ?? 0)) < 1e-3 && this.stars.visible === t > 0) {
      this.stars.position.copy(this.camera.position);
      return;
    }
    this.spaceT = t;
    this.stars.visible = t > 0.02;
    this.stars.material.opacity = t;
    this.stars.position.copy(this.camera.position);
    if (this.skyBase) this.scene.background = this.skyBase.clone().lerp(new THREE.Color(0x000004), t);
    if (this.scene.fog) {
      this.scene.fog.color.copy(this.scene.background);
      this.scene.fog.density = (this.fogBase ?? 0.001) * (1 - t) ** 3;
    }
    const far = t > 0 ? 20000 : (this.diag ?? 50) * 30;
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    // no sky light up there: hard sunlight, dark shadows (a little fill so you can see inside)
    this.hemi.intensity = (this.dark ? 0.12 : 1.1) * (1 - 0.6 * t);
  }

  render(dt, sim) {
    const stats = sim.stats;
    this.time += dt;
    if (this.controls.enabled) this.controls.update();
    this.markers.update(this.time, this.world);
    const smooth = this.surfaceMode === 'smooth';
    const volumetric = this.smokeMode === 'volumetric';
    if (this.voxels.mesh) this.voxels.mesh.visible = !smooth;
    this.updateSea();
    // underground the torches and the lamp cast the shadows; the whole voxel world going into
    // their six-sided shadow maps would cost far too much (and its walls block the light anyway)
    if (this.voxels.mesh) this.voxels.mesh.castShadow = !(this.dark && this.torchShadows);
    if (!smooth) this.voxels.update(this.time);
    if (smooth !== this.surface.visible) this.surface.setVisible(smooth);
    this.surface.mode = this.voxels.mode;
    this.surface.update(this.time);
    const scale = this.pointScale();
    this.handleEvents();
    this.smoke.points && (this.smoke.points.visible = this.smoke.enabled && !volumetric);
    this.flames.intensity = volumetric ? 0.8 : 1;
    this.flames.update(dt, scale);
    if (!volumetric) this.smoke.update(scale, this.rh ?? 0.5);
    this.rain.update(dt, this.world, sim.weather);
    // the extinguisher / hose and every sprinkler that has gone off
    const sprays = [sim.spray];
    for (const s of this.world.sprinklers) if (s.active) sprays.push({ agent: 'sprinkler', nozzle: s.p, target: [s.p[0], s.p[1] - 2.4, s.p[2]], tank: { remaining: 1 } });
    this.spray.update(dt, scale, sprays);
    this.debris.update(this.world);
    this.puddles.update();
    this.enemies.update(this.world, this.time);
    this.dragons.update(this.world, this.time, dt);
    this.updateFireLight(stats);
    this.updateTorchLights();
    this.torches.update(this.time);
    this.vehicles.update(this.time);
    this.props.update(dt);
    this.doors.update(dt);
    this.trees.update(this.time);
    this.blood.update(this.time);
    this.ossuary.update(this.time, this.root.worldToLocal(this._camLocal.copy(this.camera.position)));
    this.updateFlash(dt);
    const r = this.renderer;
    const useVolume = volumetric && this.smoke.enabled;
    let aoDepth = null;
    if (useVolume) {
      this.volume.showSteam = this.smoke.showSteam;
      this.volume.density = this.smoke.density;
      this.volume.render(this.scene, this.camera, this);
    } else if (this.aoOn) {
      this.ensureComposer();
      this.composer.render();
      aoDepth = this.ao.depthTexture;
    } else r.render(this.scene, this.camera);
    // overlay: flames, sparks, spray. After the volume (or AO) pass the screen has no depth
    // buffer, so the particles test against the scene depth texture themselves.
    const depth = useVolume ? this.volume.target.depthTexture : aoDepth;
    const res = r.getDrawingBufferSize(this._res ?? (this._res = new THREE.Vector2()));
    for (const m of [this.flames.material, this.spray.material]) {
      m.uniforms.uUseDepth.value = depth ? 1 : 0;
      m.uniforms.uDepth.value = depth;
      m.uniforms.uRes.value.copy(res);
    }
    r.autoClear = false;
    r.render(this.overlay, this.camera);
    r.autoClear = true;
  }

  /** The nearest burning torches each light their surroundings, flickering. */
  updateTorchLights() {
    const w = this.world;
    const cam = this.camera.position;
    const src = w.heaters.filter((h) => h.light && h.on).map((h) => ({ h, d: Math.hypot(h.pos[0] - cam.x, h.pos[1] - cam.y, h.pos[2] - cam.z) }));
    src.sort((a, b) => a.d - b.d);
    this.torchLights.forEach((l, k) => {
      const s = src[k];
      if (!s) {
        l.intensity = 0;
        return;
      }
      const o2 = w.o2[this.flames.world ? Math.max(0, Math.min(w.NA - 1, w.airIdx(Math.floor(s.h.pos[0] / w.ah), Math.floor((s.h.pos[1] + 0.2) / w.ah), Math.floor(s.h.pos[2] / w.ah)))) : 0] ?? 0.232;
      const f = Math.max(0, Math.min(1, (o2 - 0.135) / 0.097)); // a torch dims and dies as the oxygen goes
      l.position.set(s.h.pos[0], s.h.pos[1] + 0.25, s.h.pos[2]);
      // the nearest two cast shadows (bones, skulls, people in the light of a torch)
      const shadow = this.torchShadows && k < 2;
      if (l.castShadow !== shadow) {
        l.castShadow = shadow;
        l.shadow.mapSize.set(512, 512);
        l.shadow.camera.near = 0.05;
        l.shadow.camera.far = 7;
        l.shadow.bias = -0.003;
        l.shadow.normalBias = 0.02;
        l.shadow.radius = 3;
      }
      l.intensity = 6.5 * f * (0.8 + 0.2 * Math.sin(this.time * 13 + k) * Math.sin(this.time * 7.7 + k * 2));
    });
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
    if (this.surfaceMode === 'smooth') return this.surface.pick(this.raycaster);
    if (!this.voxels.mesh) return null;
    const hits = this.raycaster.intersectObject(this.voxels.mesh, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const voxel = this.voxels.voxelOfInstance(hit.instanceId);
    const p = this.root.worldToLocal(hit.point.clone());
    return { voxel, point: [p.x, p.y, p.z], normal: hit.face ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] : [0, 1, 0] };
  }
}
