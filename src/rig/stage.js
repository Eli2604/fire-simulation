/**
 * The character stage of the editor (its Rig mode; rig.html mounts it on its own): the sculpted
 * operator on an empty field. Every clip, the loadouts (rifle, flame gun) and the weapon in hand,
 * armour, reload speed and look, the hit areas (shown, resized, with damage multipliers: the
 * operator/rig.js ZONES table itself, so edits apply in the simulation too), damage on click, the
 * detachable gear (rifle, helmet, pack as rigid bodies) and re-equipping, hand grenades and
 * flash-bangs with a local blast, an FPS readout, and the Dragon tab (rig/dragon.js: the
 * simulation's dragon, its acts, wing damage and hit zones: ai/dragon.js DRAGON_ZONES itself).
 *
 * The soldiers' range (walls, crates, the deck, squads and their AI, hostiles) lives in the voxel
 * world now: this stage only shows the characters.
 *
 *   const rig = mountRig(el, { onExit: () => editor.setMode('play') });
 *   rig.show();                                      // renders (its own canvas) until hide()
 *   rig.select({ kind: 'soldier', loadout: 'torch' }); // or { kind: 'dragon' }
 *   rig.hide(); rig.dispose();
 *
 * Everything it puts in the page sits inside `el` (class "rigst"; its elements are found by
 * data-id inside it, its CSS is scoped to .rigst), so it does not clash with the page around it.
 * URL options (opts.params, default location.search): ?anim= ?anim2= ?play=&at= ?det= ?load=
 * ?weapon= ?armour=0 ?reload= ?look= ?zones=1 ?t= ?cam= ?nopanel=1 ?lod= ?sync=1 ?tab=anim|hit|gear|dragon,
 * and the dragon's (?dragon=1 ?dact= ?dzones=1 ?dhits= ?dsteps= ?dspeed= ?dfollow=1: rig/dragon.js).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OperatorFigure, loadOperatorAssets, PhysicsWorld, ZONES, showZones, placeZone, LABELS, MOVING, ONCE } from '../operator/rig.js';
import { flashBang } from '../audio/radio.js';
import { DragonRig } from './dragon.js';
import { ensureStageFonts } from '../stageFonts.js';

/* Layout: full-bleed field; tabbed control panel docked left; FPS readout top-right; build progress centered */
const CSS = `
.rigst{
  --sky:#2a6db5; --panel:rgba(24,27,21,.88); --line:rgba(201,185,148,.32);
  --sand:#c9b994; --ink:#f1ead8; --muted:#b4ab95; --accent:#d9a441; --hurt:#d4553b; --ok:#8fb36a;
  --display:"Barlow Condensed","Arial Narrow",sans-serif; --body:"Barlow",system-ui,sans-serif; --mono:"JetBrains Mono",ui-monospace,monospace;
  color-scheme:dark;position:fixed;inset:0;z-index:30;overflow:hidden;background:var(--sky);color:var(--ink);font-family:var(--body);font-size:16px;line-height:normal;text-align:left}
.rigst[hidden],.rigst [hidden]{display:none!important}
.rigst .stage{position:absolute;inset:0}
.rigst .stage canvas{display:block;width:100%;height:100%;touch-action:none}
.rigst .panel{position:absolute;left:max(16px,env(safe-area-inset-left,0px));top:calc(16px + env(safe-area-inset-top,0px));
  width:min(330px,calc(100vw - 32px));max-height:calc(100% - 32px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));overflow:auto;
  background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:14px 16px;backdrop-filter:blur(6px);display:grid;gap:12px;align-content:start}
.rigst .panel h1{margin:0;font-family:var(--display);font-weight:700;font-size:21px;letter-spacing:.06em;text-transform:uppercase;color:var(--sand)}
.rigst .lab{font-family:var(--display);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-variant-numeric:tabular-nums}
.rigst .sel{display:grid;gap:6px}
.rigst .selrow{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-family:var(--display);letter-spacing:.06em;text-transform:uppercase}
.rigst .selrow b{font-size:17px}
.rigst .selrow span{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.rigst .hp{height:5px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden}
.rigst .hp i{display:block;height:100%;width:100%;background:var(--ok);transition:width .2s}
.rigst .tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;border-bottom:1px solid var(--line);padding-bottom:8px}
.rigst .tabs button{padding:6px 4px;font-size:13px}
.rigst .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.rigst .grid button{padding:6px 4px;font-size:13px}
.rigst .row{display:flex;flex-wrap:wrap;gap:6px}
.rigst section{display:grid;gap:10px}
.rigst button{font-family:var(--display);font-weight:500;font-size:14px;letter-spacing:.06em;text-transform:uppercase;margin:0;
  background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:7px 9px;cursor:pointer}
.rigst button:hover{border-color:var(--sand)}
.rigst button[aria-pressed="true"],.rigst button.on{background:var(--sand);color:#1d1f18;border-color:var(--sand)}
.rigst button.warn{border-color:rgba(212,85,59,.6)}
.rigst button.back{justify-self:start;padding:5px 9px;font-size:13px}
.rigst button:focus-visible,.rigst select:focus-visible,.rigst input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rigst p.hint{margin:0;font-size:13px;line-height:1.45;color:var(--muted)}
.rigst label.sl{display:grid;grid-template-columns:76px 1fr 44px;gap:8px;align-items:center;font-size:13px;color:var(--muted)}
.rigst label.sl output{font-family:var(--mono);font-size:12px;color:var(--ink);text-align:right}
.rigst select{font-family:var(--body);font-size:14px;background:#1d1f18;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:6px}
.rigst input[type=range]{width:100%;accent-color:var(--sand)}
.rigst pre{margin:0;font-family:var(--mono);font-size:11.5px;line-height:1.5;background:rgba(0,0,0,.25);padding:10px;border-radius:3px;overflow-x:auto}
.rigst .fps{position:absolute;right:max(16px,env(safe-area-inset-right,0px));top:calc(16px + env(safe-area-inset-top,0px));background:var(--panel);border:1px solid var(--line);
  border-radius:4px;padding:8px 12px;font-family:var(--mono);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;min-width:150px}
.rigst .fps b{font-family:var(--display);font-size:24px;letter-spacing:.04em}
.rigst .fps .g{color:var(--ok)}.rigst .fps .y{color:var(--accent)}.rigst .fps .r{color:var(--hurt)}
.rigst .fps canvas{display:block;width:100%;height:28px;margin-top:4px}
.rigst .build{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);display:grid;gap:8px;width:min(300px,calc(100vw - 32px));
  background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:14px 16px}
.rigst .build .bar{height:4px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden}
.rigst .build .bar i{display:block;height:100%;width:0;background:var(--sand)}
.rigst .build .l{display:flex;justify-content:space-between}
.rigst .toast{position:absolute;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);
  border-radius:4px;padding:8px 14px;font-family:var(--display);letter-spacing:.06em;text-transform:uppercase;font-size:14px;opacity:0;transition:opacity .25s;pointer-events:none}
@media (max-width:640px){.rigst .panel{top:auto;bottom:calc(16px + env(safe-area-inset-bottom,0px));max-height:48%}.rigst .fps{min-width:0}}
`;

const HTML = `
<div class="stage" data-id="stage"></div>
<div class="build" data-id="build" role="status" aria-live="polite">
  <div class="l lab"><span>Sculpting torso &amp; kit</span><span data-id="pb-body">0%</span></div><div class="bar"><i data-id="bb-body"></i></div>
  <div class="l lab"><span>Sculpting legs</span><span data-id="pb-legs">0%</span></div><div class="bar"><i data-id="bb-legs"></i></div>
  <div class="l lab"><span>Sculpting head &amp; helmet</span><span data-id="pb-head">0%</span></div><div class="bar"><i data-id="bb-head"></i></div>
  <div class="l lab"><span>Sculpting carbine &amp; hands</span><span data-id="pb-rifle">0%</span></div><div class="bar"><i data-id="bb-rifle"></i></div>
</div>
<div class="fps" data-id="fps" aria-label="Performance"><b data-id="fpsN" class="g">--</b> fps<div data-id="fpsD">-- ms</div><div data-id="fpsT">--</div><canvas data-id="fpsG" width="150" height="28"></canvas></div>
<div class="toast" data-id="toast" role="status" aria-live="polite"></div>

<aside class="panel" data-id="panel" aria-label="Character controls">
  <button type="button" class="back" data-id="back" hidden>← Back to the world</button>
  <div class="lab" data-id="stats">Skinned sculpt · 21 bones</div>
  <h1>Character Rig</h1>
  <div class="sel">
    <div class="selrow"><b data-id="selName">Soldier 1</b><span data-id="selState">idle · 100 HP</span></div>
    <div class="hp"><i data-id="selHp"></i></div>
  </div>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" data-tab="anim" class="on">Animate</button>
    <button type="button" role="tab" data-tab="hit">Hit areas</button>
    <button type="button" role="tab" data-tab="gear">Gear</button>
    <button type="button" role="tab" data-tab="dragon">Dragon</button>
  </div>

  <section data-pane="anim">
    <div class="grid" data-id="anims"></div>
    <div class="row">
      <button data-id="tgAll" type="button" aria-pressed="false">Apply to all</button>
      <button data-id="tgFire" type="button" aria-pressed="false">Damage on click</button>
    </div>
    <p class="hint">Click a soldier to select him. Grenade and flash-bang throws land 9 m in front of him; Radio keys the chest radio. Moving clips (walk, run, aim-walk, crawl, swim) send him round a small loop. Once-only clips (reload, jump, signals, hit) return to the previous state. Squads, cover and hostiles are in the world now.</p>
    <details><summary class="lab">Code API</summary>
<pre>const rig = mountRig(el, { onExit });
rig.show();
rig.select({ kind:'soldier', loadout:'torch' });
const s = rig.soldiers[0];
s.play('reload');      // any clip
s.damage(25, 'head');  // zone multiplier
s.detach('helmet');    // a physics body
s.fig.parts.rifle / .helmet / .pack / .mag</pre></details>
  </section>

  <section data-pane="hit" hidden>
    <div class="row"><button data-id="tgZones" type="button" aria-pressed="false">Show hit areas</button><button data-id="tgFire2" type="button" aria-pressed="false">Damage on click</button></div>
    <label class="sl"><span>Zone</span><select data-id="zoneSel" style="grid-column:2/4"></select></label>
    <label class="sl"><span>Radius</span><input type="range" data-id="zR" min="0.03" max="0.35" step="0.005"><output data-id="zRo"></output></label>
    <label class="sl"><span>Length</span><input type="range" data-id="zL" min="0.5" max="1.8" step="0.01"><output data-id="zLo"></output></label>
    <label class="sl"><span>Damage ×</span><input type="range" data-id="zM" min="0.1" max="5" step="0.1"><output data-id="zMo"></output></label>
    <p class="hint" data-id="lastHit">Changes apply to every soldier, in the world too (the simulation uses this table). Clicks register on these cylinders: a headshot (×4) kills in one hit.</p>
  </section>

  <section data-pane="gear" hidden>
    <div class="lab">Selected soldier's separate objects</div>
    <div class="grid">
      <button type="button" data-det="rifle">Drop rifle</button>
      <button type="button" data-det="helmet">Knock helmet</button>
      <button type="button" data-det="pack">Drop pack</button>
    </div>
    <div class="row"><button data-id="reequip" type="button">Re-equip</button><button data-id="swapLoad" type="button">Rifle ⇄ flame gun</button><button data-id="tgDrop" type="button" aria-pressed="true">Drop rifle on death</button></div>
    <div class="lab">Weapon in hand</div>
    <div class="grid" data-id="weapons"><button type="button" data-w="rifle">Rifle</button><button type="button" data-w="secondary">Carbine</button><button type="button" data-w="knife">Knife</button></div>
    <div class="row"><button data-id="tgArmour" type="button" aria-pressed="true">Armour</button></div>
    <label class="sl"><span>Reload ×</span><input type="range" data-id="reloadS" min="0.7" max="1.5" step="0.05" value="1"><output data-id="reloadO">×1.00</output></label>
    <label class="sl"><span>Look</span><input type="range" data-id="lookS" min="-1.1" max="1.1" step="0.05" value="0"><output data-id="lookO">0°</output></label>
    <p class="hint">Switching puts the weapon in his hands away (the rifle onto his back, the carbine over the shoulder, the knife into its sheath on the right thigh), then draws the other. Without armour he fights in his shirt. Look bends the head and upper body, the rifle with them, over any clip.</p>
    <p class="hint">The person, rifle (with magazine), helmet and backpack are separate, closed objects on their own bones (without the helmet you see his hair). Drop the rifle and he draws the compact carbine from his back. The flame trooper fires only standing. Detached, each becomes a rigid body with gravity, bounce and friction that collides with the ground.</p>
  </section>

  <section data-pane="dragon" hidden>
    <div class="sel">
      <div class="selrow"><b>Dragon</b><span data-id="dState">rest · 600 HP</span></div>
      <div class="hp"><i data-id="dHp"></i></div>
    </div>
    <div class="grid" data-id="dAnims"></div>
    <label class="sl"><span>Speed</span><input type="range" data-id="dSpeed" min="0" max="2" step="0.05" value="1"><output data-id="dSpeedO"></output></label>
    <div class="row"><button data-id="tgDZones" type="button" aria-pressed="false">Show hit areas</button><button data-id="tgDFire" type="button" aria-pressed="false">Damage on click</button><button data-id="tgDFollow" type="button" aria-pressed="false">Follow</button></div>
    <label class="sl"><span>Weapon</span><select data-id="dWeapon" style="grid-column:2/4"><option value="arrow">Arrow (30)</option><option value="bullet">Bullet (22)</option><option value="rocket">Rocket (350)</option></select></label>
    <label class="sl"><span>Zone</span><select data-id="dZoneSel" style="grid-column:2/4"></select></label>
    <label class="sl"><span>Radius</span><input type="range" data-id="dzR" min="0.5" max="2" step="0.05"><output data-id="dzRo"></output></label>
    <label class="sl"><span>Length</span><input type="range" data-id="dzL" min="0.5" max="1.6" step="0.02"><output data-id="dzLo"></output></label>
    <label class="sl"><span>Damage ×</span><input type="range" data-id="dzM" min="0.1" max="5" step="0.1"><output data-id="dzMo"></output></label>
    <div class="row"><button data-id="dRevive" type="button">Revive</button><button data-id="dClean" type="button">Wash the blood away</button></div>
    <p class="hint" data-id="dLastHit">The simulation's own dragon (ai/dragon.js moves and poses it; render/dragon.js draws it). Its hit zones follow the pose; the same zones decide where arrows, bullets and rockets land in the simulation. A wound bleeds: health drains, blood drips where it goes (a trail of drops, in flight too), sprays onto the ground behind the hit and stains its scales. Click it to see a zone; with Damage on click, to hit it there.</p>
  </section>
</aside>
`;

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * Builds the character stage inside `root` (hidden until show()).
 * @param {HTMLElement} root  an element of the page's own (the stage fills the window)
 * @param {{ params?: URLSearchParams, onExit?: () => void }} [opts]
 */
export function mountRig(root, opts = {}) {
  const qs = opts.params ?? new URLSearchParams(location.search);
  ensureStageFonts();
  root.classList.add('rigst');
  root.hidden = true;
  root.innerHTML = `<style>${CSS}</style>${HTML}`;
  const $ = (id) => root.querySelector(`[data-id="${id}"]`);
  const $$ = (sel) => root.querySelectorAll(sel);
  const toast = (m) => {
    const t = $('toast');
    t.textContent = m;
    t.style.opacity = 1;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => (t.style.opacity = 0), 1600);
  };
  if (opts.onExit) {
    $('back').hidden = false;
    $('back').onclick = () => opts.onExit();
  }

  /* ================= renderer & field ================= */
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
  camera.position.set(4.4, 2.5, 6.6);
  controls.target.set(-0.7, 0.95, 0.3);
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#9a8260', 0.55));
  const sun = new THREE.DirectionalLight('#fff0d4', 2.2);
  sun.position.set(-8, 12, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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
    // (rig/dragon.js keeps this 200 m plane in view: it is "the ground")
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    gm.rotation.x = -Math.PI / 2;
    gm.receiveShadow = true;
    scene.add(gm);
  }
  // loose gear (rifle, helmet, pack) falls onto the flat ground
  const physics = new PhysicsWorld({ ground: () => 0 });

  /* ================= soldiers ================= */
  let A = null;
  let dropOnDeath = true;
  const soldiers = [];
  const GEAR = { armour: true, reload: 1, look: 0 };
  /** The settings on a (new) figure. */
  function applyGear(f) {
    f.setArmour(GEAR.armour);
    f.setClipSpeed('reload', GEAR.reload);
    f.setLook(GEAR.look);
  }
  /** Where his grenades (and his drone) go: 9 m in front of him. */
  const aheadOf = (e) => [e.d.p[0] + Math.sin(e.d.yaw) * 9, 0, e.d.p[2] + Math.cos(e.d.yaw) * 9];
  class Soldier {
    constructor(o) {
      this.name = o.name;
      this.hp = 100;
      this.loadout = o.loadout ?? 'rifle';
      this.home = o.position.slice();
      this.d = { p: o.position.slice(), yaw: o.facing ?? 0, dead: false };
      this.makeFigure();
    }
    makeFigure() {
      const old = this.fig;
      const f = (this.fig = new OperatorFigure(A, { loadout: this.loadout }));
      f.group.userData.enemy = this;
      f.zones.forEach((m) => (m.userData.enemy = this));
      f.onRelease = (p) => throwGrenade(p.toArray(), aimVel(p.toArray(), aheadOf(this)));
      f.onFlashRelease = (p) => throwGrenade(p.toArray(), aimVel(p.toArray(), aheadOf(this)), 'flash');
      f.onFinished = (name) => name === 'pickup' && f.reequip(['rifle']);
      applyGear(f);
      scene.add(f.group);
      old?.dispose();
    }
    get state() {
      return this.fig.shown;
    }
    play(name) {
      if (this.d.dead) return this;
      this.patrol = null;
      if (MOVING[name]) return this.startPatrol(name);
      if (name === 'deployDrone') {
        this.fig.droneTarget = V(aheadOf(this));
        if (!this.fig.deployDrone()) toast(this.fig.droneFly ? 'His drone is already up' : 'He needs his backpack on to deploy the drone');
        return this;
      }
      this.fig.play(name, { restart: !!ONCE[name] });
      return this;
    }
    startPatrol(mode) {
      const c = this.home;
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
      } else this.fig.play('hit', { fade: 0.06 });
      if (zone === 'head' && this.hp > 0) this.detach('helmet');
      onChange();
      return this;
    }
    detach(name, imp) {
      if (!this.fig.detach(name, physics, scene, imp)) return this;
      // without the rifle: draw the carbine from the back
      if (name === 'rifle' && !this.d.dead) this.fig.drawSecondary();
      return this;
    }
    /** Another loadout (rifle, flame gun): a new figure in the same place. */
    setLoadout(l) {
      this.loadout = l;
      this.makeFigure();
      return this;
    }
    /** Back on his feet at home, whole, with this loadout. */
    reset(loadout = this.loadout) {
      Object.assign(this, { hp: 100, loadout, patrol: null, dropT: null });
      Object.assign(this.d, { p: this.home.slice(), dead: false });
      this.makeFigure();
      return this;
    }
    reequip() {
      this.fig.reequip();
      return this;
    }
    dispose() {
      this.fig.dispose();
    }
    update(dt) {
      const d = this.d, f = this.fig, g = f.group;
      if (this.patrol && !d.dead && MOVING[f.state] && f.shown === f.state) {
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
      }
      f.setAim(null);
      d.p[1] = 0;
      g.position.set(d.p[0], d.p[1], d.p[2]);
      g.rotation.y = d.yaw;
      f.update(dt);
      if (this.dropT != null && (this.dropT -= dt) <= 0) {
        this.dropT = null;
        this.detach('rifle');
      }
    }
  }
  function spawn(o) {
    const e = new Soldier(Object.assign({ name: 'Soldier ' + (soldiers.length + 1) }, o));
    soldiers.push(e);
    return e;
  }

  /* ================= grenades and blasts (local) ================= */
  const nades = [];
  const blasts = [];
  function aimVel(from, to) {
    const d = Math.hypot(to[0] - from[0], to[2] - from[2]), T = Math.max(0.9, Math.min(1.6, d / 12));
    return [(to[0] - from[0]) / T, (to[1] - from[1] + 4.905 * T * T) / T, (to[2] - from[2]) / T];
  }
  function throwGrenade(from, vel, kind = 'frag') {
    const isFlash = kind === 'flash';
    const m = new THREE.Group();
    if (isFlash) m.add(A.flashbang.clone());
    else m.add(new THREE.Mesh(A.grenade, A.grenadeMat), new THREE.Mesh(A.grenadeFuse, A.black));
    m.position.set(...from);
    scene.add(m);
    nades.push({ m, v: V(vel), fuse: isFlash ? 1.5 : 2.5, flash: isFlash });
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
  /** A flash-bang: a blinding flash and a bang, no blast. */
  function flash(p) {
    flashBang();
    const light = new THREE.PointLight('#fff8ee', 4000, 30, 1.5);
    light.position.copy(p).add(new THREE.Vector3(0, 0.4, 0));
    scene.add(light);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(light.position);
    s.scale.setScalar(3);
    scene.add(s);
    blasts.push({ light, parts: [], t: 0, flash: s });
  }
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
    blasts.push({ light, parts, t: 0, scorch });
    // soldiers: hurt by distance; a close blast knocks the helmet off
    for (const e of soldiers) {
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
        s.material.opacity = Math.max(0, s.userData.fire ? 1 - b.t / 0.6 : 0.75 * (1 - b.t / 4));
      }
      if (b.scorch) b.scorch.material.opacity = 0.55 * Math.min(1, Math.max(0, (20 - b.t) / 4));
      if (b.t > (b.scorch ? 20 : 4)) {
        scene.remove(b.light, ...b.parts);
        if (b.flash) scene.remove(b.flash);
        if (b.scorch) scene.remove(b.scorch);
        blasts.splice(i, 1);
      } else if (b.t > 4 && b.parts.length) {
        scene.remove(b.light, ...b.parts);
        b.parts = [];
      }
    }
  }

  /* ================= UI ================= */
  let selected = null, allMode = false, fireMode = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 40), new THREE.MeshBasicMaterial({ color: '#f1ead8', transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
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
    $('anims').querySelectorAll('button').forEach((b) => b.classList.toggle('on', !e.d.dead && b.dataset.a === e.fig.shown));
  }
  function openTab(t) {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
    $$('section[data-pane]').forEach((s) => (s.hidden = s.dataset.pane !== t));
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
  /** The tab as if clicked (the Dragon tab starts and stops the dragon's stage: rig/dragon.js). */
  const clickTab = (t) => root.querySelector(`.tabs button[data-tab="${t}"]`)?.click();
  const animBox = $('anims');
  Object.keys(LABELS).forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = LABELS[k];
    b.dataset.a = k;
    if (k === 'hit' || k === 'die') b.classList.add('warn');
    b.onclick = () => {
      for (const e of allMode ? soldiers : [selected]) {
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
  });
  tg('tgFire2', (v) => {
    fireMode = v;
    f1.setAttribute('aria-pressed', String(v));
  });
  tg('tgZones', (v) => showZones(v));
  tg('tgDrop', (v) => (dropOnDeath = v));
  $$('[data-det]').forEach((b) => (b.onclick = () => selected?.detach(b.dataset.det)));
  $('reequip').onclick = () => selected?.reequip();
  $('swapLoad').onclick = () => selected && (selected.setLoadout(selected.loadout === 'torch' ? 'rifle' : 'torch'), onChange());
  /* ---------- weapon in hand, armour, reload speed, look up / down ---------- */
  const gearTargets = () => (allMode ? soldiers : [selected]).filter((e) => e && !e.d.dead);
  $('weapons').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    for (const e of gearTargets()) {
      const s = e.fig.switchWeapon(b.dataset.w);
      toast(s ? `${b.textContent} in ${s.toFixed(1)} s` : `${e.name}: already in hand, or gone`);
    }
  }));
  tg('tgArmour', (v) => {
    GEAR.armour = v;
    for (const e of soldiers) e.fig.setArmour(v);
  });
  $('reloadS').oninput = () => {
    GEAR.reload = +$('reloadS').value;
    $('reloadO').textContent = '×' + GEAR.reload.toFixed(2);
    for (const e of soldiers) e.fig.setClipSpeed('reload', GEAR.reload);
  };
  $('lookS').oninput = () => {
    const v = +$('lookS').value;
    GEAR.look = v;
    $('lookO').textContent = Math.round((v * 180) / Math.PI) + '°';
    for (const e of gearTargets()) e.fig.setLook(v);
  };
  function setRange(id, v) {
    $(id).value = v;
    $(id).oninput();
  }
  // hit-area editor: operator/rig.js ZONES itself (the simulation's table)
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
    for (const e of soldiers) for (const m of e.fig.zones) if (m.userData.zone === z) placeZone(m, z);
  }
  zSel.onchange = zoneUI;
  [zR, zL, zM].forEach((s) => (s.oninput = zoneApply));
  zoneUI();
  // clicks on a soldier: select him (and with Damage on click, hit him in that zone)
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => (down = [ev.clientX, ev.clientY]));
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(soldiers.filter((e) => !e.d.dead).flatMap((e) => e.fig.zones), false);
    if (!hits.length) return;
    const { enemy, zone } = hits[0].object.userData;
    select(enemy);
    if (fireMode) {
      const dmg = 25 * zone.mult;
      enemy.damage(dmg, zone.k);
      $('lastHit').textContent = `Last hit: ${zone.label} ×${zone.mult.toFixed(1)} = ${Math.round(dmg)} damage on ${enemy.name}.`;
      toast(`${zone.label} · ${Math.round(dmg)} dmg`);
    }
  });

  /* ================= the dragon (its own tab: rig/dragon.js) ================= */
  const dragonRig = new DragonRig({ scene, camera, controls, renderer, toast, $, qs, root });

  /* ================= select (from the editor) ================= */
  let pending = null;
  /**
   * What to show: { kind: 'soldier', loadout?: 'rifle' | 'torch', name? } (the Animate tab, the
   * first soldier with that loadout, whole again) or { kind: 'dragon' } (the Dragon tab).
   */
  function selectWhat(what = {}) {
    if (what.kind === 'dragon') return clickTab('dragon');
    clickTab('anim');
    if (!A) return void (pending = what);
    const e = soldiers[0];
    if (!e) return;
    if ((what.loadout && what.loadout !== e.loadout) || e.d.dead) e.reset(what.loadout ?? e.loadout);
    if (what.name) e.name = what.name;
    select(e);
  }

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
  const LATER = [];
  let disposed = false, ready = false;
  const readyP = loadOperatorAssets({ lod: qs.get('lod') || 'game', sync: !!qs.get('sync'), onProgress: (n, p) => {
    prog[n] = p;
    const groups = {};
    for (const [k, b] of Object.entries(BAR)) (groups[b] ??= []).push(prog[k] ?? 0);
    for (const [b, v] of Object.entries(groups)) setProg(b, v.reduce((a, x) => a + x, 0) / v.length);
  } }).then((assets) => {
    if (disposed) return;
    A = assets;
    spawn({ position: [0, 0, 0], facing: 0.3 });
    spawn({ position: [-1.6, 0, 0.6], facing: 0.3 });
    select(soldiers[0]);
    if (qs.get('anim')) for (const e of soldiers) e.play(qs.get('anim'));
    if (qs.get('det')) for (const p of qs.get('det').split(',')) soldiers[0]?.detach(p);
    if (qs.get('load')) for (const e of soldiers) e.setLoadout(qs.get('load'));
    if (qs.get('anim2')) for (const e of soldiers) e.play(qs.get('anim2'));
    // ?weapon=knife|secondary|rifle  ?armour=0  ?look=<rad>  ?reload=<speed>
    if (qs.get('armour') === '0') $('tgArmour').click();
    if (qs.get('reload')) setRange('reloadS', qs.get('reload'));
    if (qs.get('look')) setRange('lookS', qs.get('look'));
    if (qs.get('weapon')) for (const e of soldiers) e.fig.switchWeapon(qs.get('weapon'));
    // ?play=stab&at=2.2: a clip later on (after a switch), for stills with ?t=
    if (qs.get('play')) LATER.push({ at: +(qs.get('at') ?? 2), fn: () => soldiers.forEach((e) => e.play(qs.get('play'))) });
    if (qs.get('zones') === '1') $('tgZones').click();
    $('build').hidden = true;
    $('stats').textContent = `Skinned sculpt · ${Math.round(A.tris / 1000)}k tris · 21 bones · ${Object.keys(LABELS).length} clips`;
    if (pending) selectWhat(pending);
    pending = null;
    ready = true;
  });
  // ?tab=anim|hit|gear|dragon (the dragon's own options: rig/dragon.js)
  if (['anim', 'hit', 'gear'].includes(qs.get('tab'))) clickTab(qs.get('tab'));

  /* ================= loop + FPS ================= */
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 52 : 36;
    camera.updateProjectionMatrix();
  }
  if (qs.get('nopanel')) {
    $('panel').hidden = true;
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
    for (let i = LATER.length - 1; i >= 0; i--) if (now >= LATER[i].at) LATER.splice(i, 1)[0].fn();
    for (const e of soldiers) e.update(dt);
    physics.step(dt);
    stepGrenades(dt);
  }
  function frame() {
    let dt = Math.min(clock.getDelta(), 0.05);
    const t0 = performance.now();
    if (fixedT != null && ready) {
      for (let i = 0; i < Math.ceil(fixedT / 0.033); i++) tick(0.033);
      fixedT = null;
      frozen = true;
    }
    if (frozen) dt = 0;
    if (A && !dragonRig.active) tick(dt);
    if (selected) {
      ring.position.set(selected.d.p[0], 0.02, selected.d.p[2]);
      ring.visible = !selected.d.dead && !dragonRig.active;
    }
    if (soldiers.length && Math.random() < 0.08) onChange();
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
  }

  /* ================= show / hide / dispose ================= */
  let shown = false;
  function show() {
    if (shown || disposed) return;
    shown = true;
    root.hidden = false;
    addEventListener('resize', resize);
    resize();
    clock.getDelta();
    lastShown = performance.now();
    frames = 0;
    acc = 0;
    renderer.setAnimationLoop(frame);
  }
  function hide() {
    if (!shown) return;
    shown = false;
    renderer.setAnimationLoop(null);
    removeEventListener('resize', resize);
    root.hidden = true;
  }
  function dispose() {
    hide();
    disposed = true;
    clearTimeout(toast.h);
    for (const e of soldiers) e.dispose();
    soldiers.length = 0;
    controls.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.innerHTML = '';
    root.classList.remove('rigst');
  }

  return {
    show,
    hide,
    select: selectWhat,
    dispose,
    /** Resolves once the soldiers are sculpted and on the field. */
    ready: readyP,
    get shown() {
      return shown;
    },
    soldiers,
    dragon: dragonRig,
  };
}
