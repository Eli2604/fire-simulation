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
import { IceRenderer } from './ice.js';
import { TorchRenderer } from './torches.js';
import { OssuaryRenderer } from './ossuary.js';
import { VehicleRenderer } from './vehicles.js';
import { PropsRenderer } from './props.js';
import { DoorRenderer } from './doors.js';
import { TreeRenderer } from './trees.js';
import { BloodRenderer } from './blood.js';
import { Ocean } from './ocean.js';
import { ArchipelagoRenderer } from './archipelago.js';
import { VolcanoRenderer } from './volcano.js';
import { EnemyRenderer } from './enemies.js';
import { DragonRenderer } from './dragon.js';
import { PhoenixRenderer } from './phoenix.js';
import { PatchRenderer } from './patches.js';
import { SnowRenderer } from './snow.js';
import { BreathRenderer } from './breath.js';
import { MATERIALS } from '../sim/materials.js';
import { SNOW_COVER } from './archipelago.js';
import { deriveWeather } from '../sim/weather.js';

const SKY_CLEAR = new THREE.Color(0x8fb7dc);
const SKY_GREY = new THREE.Color(0x8d939a);
const SKY_FOG = new THREE.Color(0xb9bec2);
const SKY_STORM = new THREE.Color(0x3b434c);

/** Owns the three.js scene and all renderers of the simulation state. */
export class View {
  constructor(canvas) {
    this.ocean = new Ocean();
    this.archSpec = null; // the island group round the zone (set by main.js), and the zone's place in it
    this.zoneOrigin = null;
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
    for (let k = 0; k < 8; k++) {
      const l = new THREE.PointLight(0xffd2a0, 0, 10, 1.7);
      this.root.add(l);
      this.torchLights.push(l);
    }
    this.dark = false;
    this.aoOn = true; // ambient occlusion
    // adaptive quality: slow frames (no graphics card: rendering in software) step the
    // resolution, ambient occlusion and shadows down, fast ones step them back up
    this.adaptive = true;
    this.quality = { level: 0, t0: 0, frames: 0, slowFor: 0, fastFor: 0, base: Math.min(window.devicePixelRatio || 1, 2) };
    {
      const gl = this.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      this.softwareGpu = /swiftshader|llvmpipe|software|basic render/i.test(name);
      if (this.softwareGpu) this.setQuality(1); // start a step down: there is no graphics card
    }
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
    this.volcanoes = new VolcanoRenderer(this.root); // volcanoes: basalt cones, glowing craters
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
    this.patches = new PatchRenderer(this.root); // fine detail close up: candles (sim/patches.js)
    this.puddles = new PuddleRenderer(this.root);
    this.ice = new IceRenderer(this.root); // ice on the water (sim/ice.js)
    this.snow = new SnowRenderer(this.root); // snow lying (sim/snow.js)
    this.breath = new BreathRenderer(this.root); // breath that shows in the cold
    this.enemies = new EnemyRenderer(this.root, this.flames);
    this.dragons = new DragonRenderer(this.root, this.flames);
    this.phoenixes = new PhoenixRenderer(this.root, this.flames);
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
    this.volcanoes.setWorld(world);
    this.blood.setWorld(world);
    this.flames.setWorld(world);
    this.patches.clear();
    this.breath.clear();
    this.snow.setWorld(world);
    this.smoke.setWorld(world);
    this.spray.setScale(world);
    this.surface.setWorld(world);
    this.puddles.setWorld(world);
    this.ice.setWorld(world);
    this.volume.setWorld(world);
    this.seenEvents = 0;
    this.flash = null;

    // a ship floats in the sea: a water surface around the hull instead of the ground
    if (this.sea) {
      this.root.remove(this.sea);
      this.ocean.dispose();
      this.sea = null;
    }
    this.ground.visible = !world.sea && !world.vacuum;
    if (world.sea) {
      // waves from the weather, colour from the depth to the bottom, surf on the shore and the hull (render/ocean.js)
      // (it reaches beyond the island group round it, to the horizon)
      this.ocean.extent = this.archSpec && this.zoneOrigin ? this.archSpec.extent ?? 2600 : 0;
      this.sea = this.ocean.build(world, diag);
      this.sea.rotation.x = -Math.PI / 2;
      this.sea.position.y = world.sea.level;
      this.root.add(this.sea);
    }
    // the island group round it: the sea floor and the other islands (render/archipelago.js)
    this.archipelago ??= new ArchipelagoRenderer(this.root);
    this.ocean.setBathy(this.archipelago.set(world.sea && !world.vacuum ? this.archSpec : null, this.zoneOrigin, world));
    this.ground.scale.set(diag * 12, diag * 12, 1);
    this.ground.position.set(sx / 2, world.h * 0.9, sz / 2);

    this.camera.near = Math.max(0.002, world.h * 0.3);
    // far enough for the island group and the sea beyond it
    this.farBase = Math.max(diag * 30, (this.ocean.extent ?? 0) * 2.6);
    this.camera.far = this.farBase;
    this.camera.updateProjectionMatrix();
    const target = new THREE.Vector3(sx / 2, sy * 0.22, sz / 2);
    const sameSize = this.lastSize && this.lastSize.every((v, k) => Math.abs(v - world.size[k]) < 1e-6);
    this.lastSize = world.size.slice();
    if (!(keepCamera && sameSize)) this.placeCamera(target, cameraOffset);
    this.controls.maxDistance = diag * 6;
    this.controls.update();
    this.sizeShadows(world, diag);
  }

  /**
   * Who breathes here (the guards, you in the walk-through), and the air at their mouths:
   * in the cold their breath shows (render/breath.js).
   */
  updateBreath(dt, sim, scale) {
    const w = this.world;
    const B = this.breath;
    B.light = Math.min(1, 0.35 + (this.dark ? 0.5 : this.sun.intensity * 0.4));
    if (w.vacuum) return B.update(dt, this.time, scale, [], () => null);
    const mouths = [];
    for (const e of w.enemies) {
      if (e.dead || e.yaw == null) continue;
      const dir = [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
      const run = ['flee', 'chase', 'charge', 'lure', 'retreat'].includes(e.state);
      mouths.push({ id: e, p: [e.p[0] + dir[0] * 0.12, e.p[1] + 1.58, e.p[2] + dir[2] * 0.12], dir, rate: run ? 0.55 : 0.28 });
    }
    const pl = sim.ai?.player;
    if (pl?.head && !w.playerHeld) {
      const cam = this.cameraLocal();
      // in the walk-through the camera is your eyes: your breath shows just under them
      if (Math.hypot(cam[0] - pl.head[0], cam[1] - pl.head[1], cam[2] - pl.head[2]) < 0.6) {
        const f = this.camera.getWorldDirection(new THREE.Vector3()).add(this.camera.position);
        const l = this.root.worldToLocal(f);
        const dir = [l.x - cam[0], 0, l.z - cam[2]];
        const n = Math.hypot(dir[0], dir[2]) || 1;
        dir[0] /= n;
        dir[2] /= n;
        const moving = Math.hypot(pl.v?.[0] ?? 0, pl.v?.[2] ?? 0) > 3;
        mouths.push({ id: pl, p: [cam[0] + dir[0] * 0.14, cam[1] - 0.1, cam[2] + dir[2] * 0.14], dir, rate: moving ? 0.5 : 0.25 });
      }
    }
    const rh = this.rh ?? 0.6;
    const air = (p) => {
      const i = w.voxelAt(p[0], p[1], p[2]);
      if (i >= 0 && w.mat[i] && MATERIALS[w.mat[i]].fluidity >= 0.95) return null; // under water
      if (w.sea && !w.vacuum && p[1] < w.sea.level) {
        const [x0, z0, x1, z1] = w.sea.box ?? [0, 0, 0, 0];
        if (!(p[0] > x0 && p[0] < x1 && p[2] > z0 && p[2] < z1)) return null;
      }
      const ax = Math.max(0, Math.min(w.anx - 1, Math.floor(p[0] / w.ah)));
      const ay = Math.max(0, Math.min(w.any - 1, Math.floor(p[1] / w.ah)));
      const az = Math.max(0, Math.min(w.anz - 1, Math.floor(p[2] / w.ah)));
      const a = w.airIdx(ax, ay, az);
      if ((w.o2?.[a] ?? 0.23) < 0.05) return null;
      return { T: w.airT[a], RH: rh, wind: [w.vx[a], w.vy?.[a] ?? 0, w.vz[a]] };
    };
    B.update(dt, this.time, scale, mouths, air);
  }

  /** The camera's position in the world's own coordinates ([x, y, z]). */
  cameraLocal() {
    const c = this.root.worldToLocal(this._camLocal.copy(this.camera.position));
    return [c.x, c.y, c.z];
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
    // a storm: a gale with rain under a low, dark sky (lightning flashes in render())
    const storm = Math.min(1, Math.max(0, (weather.windSpeed - 11) / 11)) * Math.min(1, 0.4 + weather.rain / 15);
    this.storm = storm;
    const grey = Math.min(1, weather.rain / 12 + weather.fog * 0.6 + storm);
    const sky = SKY_CLEAR.clone().lerp(SKY_GREY, grey).lerp(SKY_FOG, weather.fog * 0.7).lerp(SKY_STORM, storm * 0.85);
    this.scene.background = sky;
    const fogDensity = weather.fog > 0 ? (weather.fog * 3.5) / this.diag : 0.02 / this.diag;
    this.scene.fog = new THREE.FogExp2(sky, fogDensity);
    // underground / indoor scenes: hardly any daylight
    const light = (1 - 0.55 * grey) * (1 - 0.45 * storm) * (this.dark ? 0.06 : 1);
    if (this.dark) {
      this.scene.background = new THREE.Color(0x050505);
      this.scene.fog = new THREE.FogExp2(0x050505, 0.02 / this.diag);
    }
    this.skyBase = this.scene.background.clone();
    this.fogBase = this.scene.fog.density;
    this.spaceT = 0;
    if (this.space) this.setSpaceBlend(1);
    else if (this.stars) this.stars.visible = false;
    this.sun.intensity = 2.4 * light * (1 - 0.6 * weather.fog) * (0.3 + 0.7 * Math.max(0, Math.min(1, weather.sunshine ?? 1)));
    this.hemi.intensity = this.dark ? 0.32 : 0.9 + 0.3 * light;
    this.smoke.light = 0.55 + 0.45 * light;
    this.rh = D.rh;
    this.ocean.setWeather(weather, this.scene.background, grey);
    this.trees.setWind(D.windX, D.windZ); // the grass bends in it
    // the season: the leaves and the grass, a lower and weaker sun in winter
    this.season = weather.season ?? 'summer';
    this.trees.setSeason(this.season, this.snowCover ?? 0);
    // the air at its dew point (saturated: mist, fog, just after rain, a damp still night):
    // dew on the grass and the leaves; below freezing, hoar frost. (They are wetted by it in the
    // simulation too: dead fuels take up water towards what the damp air holds.)
    const sat = Math.max(0, Math.min(1, (D.rh - 0.9) / 0.08));
    const cold = weather.ambient <= 0.5;
    this.trees.setDew(cold ? 0 : sat, cold ? Math.max(sat, weather.ambient < -2 && D.rh > 0.8 ? 0.5 : 0) : 0);
    const sunK = { spring: 0.95, summer: 1, autumn: 0.85, winter: 0.7 }[this.season] ?? 1;
    this.sun.intensity *= sunK;
  }

  /** Snow on the ground: the islands round the scene, the crowns of the trees, the light it throws back. */
  updateSnowCover() {
    const c = this.snow.cover();
    SNOW_COVER.uSnowCover.value = c;
    if (Math.abs(c - (this.snowCover ?? 0)) > 0.04 || (c === 0 && this.snowCover > 0)) {
      this.snowCover = c;
      this.trees.setSeason(this.season ?? 'summer', c);
      // snow throws the light back up: a bright ground for the sky light
      this.hemi.groundColor.set(0x4a3f30).lerp(new THREE.Color(0xd8dde4), c * 0.8);
    }
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

  /** In a storm, now and then lightning: the sky and everything under it flash white. */
  lightning(dt) {
    if (!(this.storm > 0.35) || this.dark || this.space || !this.skyBase) {
      if (this.bolt) this.endBolt();
      return;
    }
    if (!this.bolt && Math.random() < dt * 0.06 * this.storm) this.bolt = { t: 0, len: 0.12 + Math.random() * 0.25, hemi: this.hemi.intensity };
    const b = this.bolt;
    if (!b) return;
    b.t += dt;
    // a double flicker
    const on = b.t < b.len && (b.t < b.len * 0.35 || b.t > b.len * 0.6);
    this.hemi.intensity = b.hemi + (on ? 5 : 0);
    this.scene.background = on ? this.skyBase.clone().lerp(new THREE.Color(0xdfe6f2), 0.7) : this.skyBase;
    if (b.t > b.len) this.endBolt();
  }

  endBolt() {
    if (!this.bolt) return;
    this.hemi.intensity = this.bolt.hemi;
    this.scene.background = this.skyBase;
    this.bolt = null;
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
    // out in daylight a fire (an eruption) lights its surroundings orange, it does not outshine
    // the sun: at most about twice the daylight a third of the scene away
    if (!this.dark) this.fireLight.intensity = Math.min(this.fireLight.intensity, 2 * Math.max(0.2, this.sun.intensity) * (this.diag / 3) ** 1.6 * flick);
    // underground / indoors: a big fire lights the space up strongly, but not white (a blast's
    // fireball and the flames it starts would otherwise wash the whole place out)
    else this.fireLight.intensity = Math.min(this.fireLight.intensity, 14 * flick);
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
    const far = t > 0 ? 20000 : this.farBase ?? (this.diag ?? 50) * 30;
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    // no sky light up there: hard sunlight, dark shadows (a little fill so you can see inside)
    this.hemi.intensity = (this.dark ? 0.12 : 1.1) * (1 - 0.6 * t);
  }

  /**
   * Quality level 0 (full) .. 3: 1 = 75 % resolution, no ambient occlusion; 2 = half
   * resolution, no shadows; 3 = a third of the resolution.
   */
  setQuality(level) {
    const q = this.quality;
    q.level = Math.max(0, Math.min(3, level));
    const scale = [1, 0.75, 0.5, 0.35][q.level];
    const r = q.base * scale;
    this.renderer.setPixelRatio(r);
    const c = this.renderer.domElement;
    const w = c.clientWidth || c.width;
    const h = c.clientHeight || c.height;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio?.(r);
      this.composer.setSize?.(w, h);
    }
    const shadows = q.level < 2;
    this.sun.castShadow = shadows;
    this.qualityNoShadows = !shadows;
  }

  /** Watch the frame time and step the quality down (or back up). */
  governQuality() {
    if (!this.adaptive) return;
    const q = this.quality;
    const now = performance.now();
    if (!q.t0) q.t0 = now;
    q.frames++;
    const span = now - q.t0;
    if (span < 1500) return;
    const ms = span / q.frames;
    q.t0 = now;
    q.frames = 0;
    // slow: under ~18 frames a second for a few seconds; fast: over ~45 for longer
    if (ms > 55) {
      q.slowFor++;
      q.fastFor = 0;
    } else if (ms < 22) {
      q.fastFor++;
      q.slowFor = 0;
    } else q.slowFor = q.fastFor = 0;
    if (q.slowFor >= 2 && q.level < 3) {
      this.setQuality(q.level + 1);
      q.slowFor = 0;
    } else if (q.fastFor >= 5 && q.level > (this.softwareGpu ? 1 : 0)) {
      this.setQuality(q.level - 1);
      q.fastFor = 0;
    }
  }

  render(dt, sim) {
    const stats = sim.stats;
    this.governQuality();
    this.time += dt;
    if (this.controls.enabled) this.controls.update();
    this.markers.update(this.time, this.world);
    const smooth = this.surfaceMode === 'smooth';
    const volumetric = this.smokeMode === 'volumetric';
    if (this.voxels.mesh) this.voxels.mesh.visible = !smooth;
    this.updateSea();
    if (this.sea) this.ocean.update(this.time);
    if (this.sea) this.ocean.updateIce(this.world?.ice);
    this.lightning(dt);
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
    this.ice.update();
    this.enemies.update(this.world, this.time);
    this.dragons.update(this.world, this.time, dt);
    this.phoenixes.update(this.world, this.time, dt);
    this.patches.update(this.time, sim.patches, this.voxels.mode, dt, scale);
    this.flames.skip = this.patches.coarseSkip;
    this.snow.update(this.time);
    this.updateSnowCover();
    this.updateBreath(dt, sim, scale);
    this.updateFireLight(stats);
    this.updateTorchLights();
    this.torches.update(this.time);
    this.vehicles.update(this.time);
    this.props.update(dt);
    this.doors.update(dt);
    this.trees.update(this.time, this.cameraLocal());
    this.volcanoes.update(this.time);
    this.blood.update(this.time);
    this.ossuary.update(this.time, this.root.worldToLocal(this._camLocal.copy(this.camera.position)));
    this.updateFlash(dt);
    this.updateBolts();
    const r = this.renderer;
    const useVolume = volumetric && this.smoke.enabled;
    let aoDepth = null;
    if (useVolume) {
      this.volume.showSteam = this.smoke.showSteam;
      this.volume.density = this.smoke.density;
      this.volume.render(this.scene, this.camera, this);
    } else if (this.aoOn && this.quality.level < 1) {
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
    const [cx, cy, cz] = this.cameraLocal();
    // candles standing together (an altar's, a candelabra's) are one light: a point light a
    // hand's width over a white cloth burns it white (the inverse square), where the dozen
    // flames together light it as a soft glow from over them
    const lit = w.heaters.filter((h) => h.light && h.on);
    const groups = [];
    for (const h of lit) {
      if (h.kind !== 'candle') {
        groups.push({ h, pos: h.pos, n: 1 });
        continue;
      }
      const p = h.patchLive && h.flamePos ? h.flamePos : h.pos;
      const k = Math.min(2, Math.max(0.3, (h.power || 70) / 70));
      let g = groups.find((q) => q.candle && Math.hypot(q.c[0] / q.n - p[0], q.c[1] / q.n - p[1], q.c[2] / q.n - p[2]) < 0.7);
      if (!g) groups.push((g = { h, candle: true, c: [0, 0, 0], n: 0, k: 0 }));
      for (let i = 0; i < 3; i++) g.c[i] += p[i];
      g.n++;
      g.k += k;
    }
    for (const g of groups) if (g.candle) g.pos = [g.c[0] / g.n, g.c[1] / g.n + 0.04 + Math.min(0.3, 0.12 * Math.sqrt(g.n)), g.c[2] / g.n];
    const src = groups.map((g) => ({ ...g, d: Math.hypot(g.pos[0] - cx, g.pos[1] - cy, g.pos[2] - cz) }));
    src.sort((a, b) => a.d - b.d);
    this.torchLights.forEach((l, k) => {
      const s = src[k];
      if (!s) {
        l.intensity = 0;
        return;
      }
      const o2 = w.o2[this.flames.world ? Math.max(0, Math.min(w.NA - 1, w.airIdx(Math.floor(s.h.pos[0] / w.ah), Math.floor((s.h.pos[1] + 0.2) / w.ah), Math.floor(s.h.pos[2] / w.ah)))) : 0] ?? 0.232;
      const f = Math.max(0, Math.min(1, (o2 - 0.135) / 0.097)); // a torch dims and dies as the oxygen goes
      l.position.set(s.pos[0], s.pos[1] + (s.candle ? 0 : 0.25), s.pos[2]);
      // the nearest two cast shadows (bones, skulls, people in the light of a torch)
      const shadow = this.torchShadows && !this.qualityNoShadows && k < 2;
      if (l.castShadow !== shadow) {
        l.castShadow = shadow;
        l.shadow.mapSize.set(512, 512);
        l.shadow.camera.near = 0.05;
        l.shadow.camera.far = 7;
        l.shadow.bias = -0.003;
        l.shadow.normalBias = 0.02;
        l.shadow.radius = 3;
      }
      // (a candle: a warm pool of light round it, steadier than a torch)
      // a candle gives about a twentieth of a torch's light (its heat release, ~70 W against
      // ~1.5 kW); a dozen of them on an altar together, each at a torch's share, burnt it white
      l.intensity = s.candle ? 0.33 * s.k * f * (0.95 + 0.05 * Math.sin(this.time * 9 + k)) : 6.5 * f * (0.8 + 0.2 * Math.sin(this.time * 13 + k) * Math.sin(this.time * 7.7 + k * 2));
    });
  }

  /** New explosion events: a bright flash and a burst of sparks. */
  handleEvents() {
    const w = this.world;
    if (!w) return;
    for (; this.seenEvents < w.events.length; this.seenEvents++) {
      const e = w.events[this.seenEvents];
      if (e.type === 'lightning') {
        this.addBolt(e.pos);
        continue;
      }
      if (e.type !== 'explosion' || e.name === 'lightning') continue;
      // no white flash where there is no fireball (an eruption: rock and ash, lit by the lava)
      if (e.flash !== false) this.flash = { t: 0, pos: e.pos, power: Math.min(4, 0.5 + Math.cbrt(e.energy / 1e5)) };
      const n = Math.min(600, 150 + Math.round(e.energy / 2000));
      for (let k = 0; k < n; k++) {
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(Math.random() * 2 - 1) * 0.8;
        const sp = 4 + Math.random() * 14;
        this.flames.spawn(e.pos[0], e.pos[1], e.pos[2], Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp, Math.sin(ph) * Math.sin(th) * sp, 0.6 + Math.random() * 1.6, Math.max(0.01, w.h * 0.25), 1, 1);
      }
    }
  }

  /**
   * A lightning bolt (sim/lightning.js): a jagged, branching channel from the clouds down to
   * where it struck, blue-white, flickering two or three times over a quarter of a second; the
   * sky lights up with it and its light falls on the ground round it.
   */
  addBolt(p) {
    const pts = [];
    const top = [p[0] + (Math.random() - 0.5) * 60, p[1] + 180, p[2] + (Math.random() - 0.5) * 60];
    const main = [];
    // a stepped leader's path: short straight runs that kink every few metres, wandering
    const n = 70;
    let off = [0, 0];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      if (k > 0 && k < n) off = [off[0] * 0.9 + (Math.random() - 0.5) * 7, off[1] * 0.9 + (Math.random() - 0.5) * 7];
      const q = [top[0] + (p[0] - top[0]) * u + off[0] * Math.min(1, (1 - u) * 6), top[1] + (p[1] - top[1]) * u, top[2] + (p[2] - top[2]) * u + off[1] * Math.min(1, (1 - u) * 6)];
      main.push(q);
    }
    // (a glowing channel: a thin white core and a wide faint glow round it; GL lines are one pixel)
    const group = new THREE.Group();
    const core = new THREE.MeshBasicMaterial({ color: 0xf4f7ff, transparent: true, opacity: 1, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.22, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const seg = (list, r) => {
      const curve = new THREE.CatmullRomCurve3(list.map((q) => new THREE.Vector3(...q)), false, 'catmullrom', 0.0);
      const n = list.length * 2;
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, n, r, 5, false), core));
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, n, r * 3, 6, false), glow));
      void pts;
    };
    seg(main, 0.18);
    // its branches: forks off the channel that die out in the air
    for (let b = 0; b < 4; b++) {
      const k0 = 8 + Math.floor(Math.random() * 45);
      let q = main[k0].slice();
      const dir = [(Math.random() - 0.5) * 2, -1 - Math.random(), (Math.random() - 0.5) * 2];
      const br = [q];
      for (let k = 0; k < 8; k++) {
        q = [q[0] + dir[0] * 3 + (Math.random() - 0.5) * 3, q[1] + dir[1] * 3, q[2] + dir[2] * 3 + (Math.random() - 0.5) * 3];
        br.push(q);
      }
      seg(br, 0.08);
    }
    for (const m of group.children) m.frustumCulled = false;
    group.renderOrder = 4;
    this.root.add(group);
    (this.bolts ??= []).push({ line: group, t0: performance.now(), p });
    // its light on the ground round it (a moment, bright, not a blast's fireball)
    this.flash = { t: 0, pos: [p[0], p[1] + 25, p[2]], power: 0.35 };
  }

  updateBolts() {
    if (!this.bolts?.length) {
      if (this.skyLit) {
        this.scene.background = this.skyBase?.clone() ?? this.scene.background;
        this.skyLit = false;
      }
      return;
    }
    const now = performance.now();
    let lit = 0;
    this.bolts = this.bolts.filter((b) => {
      // (boltHold: held on its first stroke, for a still)
      const t = this.boltHold ? 0.01 : (now - b.t0) / 1000;
      if (t > 0.45) {
        this.root.remove(b.line);
        b.line.traverse((o) => o.geometry?.dispose());
        return false;
      }
      // the return strokes: on, off, on again
      const on = t < 0.08 || (t > 0.13 && t < 0.2) || (t > 0.28 && t < 0.33);
      b.line.visible = on;
      if (on) lit = Math.max(lit, 1 - t / 0.45);
      return true;
    });
    if (this.skyBase && !this.dark) {
      this.scene.background = this.skyBase.clone().lerp(new THREE.Color(0xdde6ff), lit * 0.45);
      this.skyLit = true;
    }
  }

  updateFlash(dt) {
    const f = this.flash;
    if (!f) {
      this.flashLight.intensity = 0;
      return;
    }
    // (on the clock, not frame time: while a blast is being worked out the frames are slow,
    // and the flash would last for seconds)
    f.t0 ??= performance.now();
    f.t = (performance.now() - f.t0) / 1000;
    const k = Math.max(0, 1 - f.t / 0.8);
    this.flashLight.position.set(...f.pos);
    this.flashLight.intensity = 400 * f.power * k * k * (this.diag / 3) ** 2;
    if (this.dark) this.flashLight.intensity = Math.min(this.flashLight.intensity, 120 * k * k); // (a flash in a vault: bright, not white-out)
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
