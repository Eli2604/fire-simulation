import * as THREE from 'three';
import { loadOperatorAssets, OperatorFigure } from '../operator/rig.js';
import { crewOf, SIT_DROP } from '../sim/boatCrew.js';

/**
 * The people in the boats that nobody else draws (render/floats.js owns this): you, when the
 * camera is not at your eyes (a third-person or someone else's view: walk/boatRow.js V, a
 * cinematic camera), anyone seated by other code (the rig, a test), and the boat's `crew` param
 * people (ballast until now) as boatmen: unarmed, no armour. The squad AI's men aboard are the
 * soldiers' renderer's (render/enemies.js: world.enemies), posed the same way (sim/boatCrew.js
 * placeCrew), so they are not drawn here twice.
 *
 * Each is the operator figure (operator/rig.js) in his seat (sim/boatCrew.js seatPose: his feet on
 * the floorboards, tilted with the boat's roll and pitch), playing his seat's clip (boatRow,
 * boatPaddle, boatHelm, boatHike, boatSit, sitAim) at the phase the boat gives it: the rower's
 * stroke in step with the oars, the hand on the tiller, the lean of the hike.
 *
 *   const c = new BoatCrewRenderer(parent, { assets })  // assets: operator/rig.js's (else loaded in the browser)
 *   c.update(world, floats, dt, camera)                  // every frame; floats: the boats drawn
 *   c.drop(f), c.clear()
 *   c.figures                                            // Map key → { fig, f, who, seen }
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _fv = new THREE.Vector3(), _uv = new THREE.Vector3(), _rv = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
/** His eyes over his seat's top (seated). */
export const SEATED_EYE = 0.78;

export class BoatCrewRenderer {
  constructor(parent, { assets = null } = {}) {
    this.parent = parent;
    this.A = assets;
    this.figures = new Map();
    this.ids = new WeakMap();
    this.nid = 0;
  }

  /** The operator's assets: given, or loaded once in the browser (null until then: nobody drawn). */
  assets() {
    if (this.A) return this.A;
    if (!this.loading && typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      this.loading = true;
      loadOperatorAssets({ lod: 'game' }).then((a) => (this.A = a), () => {});
    }
    return null;
  }

  keyOf(f, c, k) {
    if (c.who) {
      if (!this.ids.has(c.who)) this.ids.set(c.who, ++this.nid);
      return 'w' + this.ids.get(c.who);
    }
    if (!this.ids.has(f)) this.ids.set(f, ++this.nid);
    return `b${this.ids.get(f)}:${k}`;
  }

  update(world, floats, dt = 0, camera = null) {
    const enemies = new Set(world?.enemies ?? []);
    const want = [];
    for (const f of floats) {
      if (!f.body || !f.seats) continue;
      crewOf(f).forEach((c, k) => {
        if (c.who && enemies.has(c.who)) return; // (render/enemies.js draws him)
        if (c.who?.player && camera) {
          // you: not when the camera is at your eyes
          const e = [c.p[0] + c.frame.u[0] * (SIT_DROP + SEATED_EYE), c.p[1] + c.frame.u[1] * (SIT_DROP + SEATED_EYE), c.p[2] + c.frame.u[2] * (SIT_DROP + SEATED_EYE)];
          const cp = camera.getWorldPosition ? camera.getWorldPosition(new THREE.Vector3()) : camera.position;
          if (Math.hypot(cp.x - e[0], cp.y - e[1], cp.z - e[2]) < 0.6) return;
        }
        want.push([f, c, this.keyOf(f, c, k)]);
      });
    }
    const A = want.length ? this.assets() : this.A;
    for (const it of this.figures.values()) it.seen = false;
    if (!A) return;
    for (const [f, c, key] of want) {
      let it = this.figures.get(key);
      if (!it) {
        const boatman = !c.who;
        const fig = new OperatorFigure(A, { zones: false, loadout: boatman ? 'unarmed' : 'rifle' });
        fig.autoFlash = false;
        if (boatman) fig.setArmour?.(false);
        this.parent.add(fig.group);
        it = { fig, f, who: c.who, key };
        this.figures.set(key, it);
      }
      it.seen = true;
      this.pose(it.fig, c, dt);
    }
    for (const [key, it] of this.figures)
      if (!it.seen) {
        this.parent.remove(it.fig.group);
        it.fig.dispose?.();
        this.figures.delete(key);
      }
  }

  /** The figure in his seat, tilted with the boat, his clip at the boat's phase. */
  pose(fig, c, dt) {
    const g = fig.group;
    g.position.set(c.p[0], c.p[1], c.p[2]);
    _m.makeBasis(_fv.set(...c.frame.f), _uv.set(...c.frame.u), _rv.set(...c.frame.r));
    // (a figure looks along +z at yaw 0: his heading in the boat seatYaw, + π/2)
    g.quaternion.setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(_Y, c.seatYaw + Math.PI / 2));
    if (fig.shown !== c.anim) fig.play(c.anim, { fade: 0.3 });
    fig.setPhase(c.phase);
    fig.update(dt);
  }

  /** A boat's people gone (it burnt, it sank out of sight). */
  drop(f) {
    for (const [key, it] of this.figures)
      if (it.f === f) {
        this.parent.remove(it.fig.group);
        it.fig.dispose?.();
        this.figures.delete(key);
      }
  }

  clear() {
    for (const it of this.figures.values()) {
      this.parent.remove(it.fig.group);
      it.fig.dispose?.();
    }
    this.figures.clear();
  }
}
