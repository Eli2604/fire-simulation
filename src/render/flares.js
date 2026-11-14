import * as THREE from 'three';

/**
 * Flares and missiles of a jet flight (ai/flight.js: flight.flares, flight.missiles) drawn: each
 * flare a white-hot ball with a glow round it and the smoke trail it leaves as it falls away; each
 * missile a slim body with its motor's flame and its trail. Used by the simulation's flights
 * (render/flights.js) and the rig's jet flight (rig/vehicles.js). Positions are in the parent's
 * frame (what the flight's own coordinates are drawn in).
 *
 *   const fx = new FlareFx(parent);
 *   fx.update(ai.flares, ai.missiles, time);   // every frame
 *   fx.dispose();
 */
const BALL = new THREE.SphereGeometry(0.35, 10, 8);
const GLOW = new THREE.SphereGeometry(1, 12, 8);
const BODY = new THREE.CylinderGeometry(0.11, 0.11, 2.6, 6).rotateZ(Math.PI / 2);
const N = 40; // trail points

export class FlareFx {
  constructor(parent) {
    this.parent = parent;
    this.items = new Map(); // flare / missile object → its meshes
    this.ballMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    this.smokeMat = new THREE.LineBasicMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0.75 });
    this.bodyMat = new THREE.MeshBasicMaterial({ color: 0xf0f0ea });
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    this._v = new THREE.Vector3();
  }

  make(kind) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    geo.setDrawRange(0, 0);
    const trail = new THREE.Line(geo, this.smokeMat);
    trail.frustumCulled = false;
    let head, glow;
    if (kind === 'flare') {
      head = new THREE.Mesh(BALL, this.ballMat);
      glow = new THREE.Mesh(GLOW, this.glowMat);
      head.add(glow);
    } else {
      head = new THREE.Mesh(BODY, this.bodyMat);
      glow = new THREE.Mesh(GLOW, this.flameMat);
      glow.position.x = -1.6;
      glow.scale.set(0.9, 0.35, 0.35);
      head.add(glow);
    }
    g.add(head, trail);
    this.parent.add(g);
    return { g, head, glow, trail };
  }

  update(flares = [], missiles = [], time = 0) {
    const live = new Set();
    const draw = (o, kind) => {
      live.add(o);
      let it = this.items.get(o);
      if (!it) this.items.set(o, (it = this.make(kind)));
      it.head.position.set(o.p[0], o.p[1], o.p[2]);
      if (kind === 'flare') {
        // burning down: bright, flickering, smaller towards the end
        const k = Math.max(0.15, 1 - (o.t ?? 0) / 4.5);
        it.glow.scale.setScalar((1.6 + 0.5 * Math.sin(time * 40 + o.id)) * k + 0.4);
        it.head.scale.setScalar(0.6 + 0.6 * k);
      } else {
        it.head.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this._v.set(o.v[0], o.v[1], o.v[2]).normalize());
        it.glow.scale.x = 0.8 + 0.4 * Math.random();
      }
      const tr = o.trail ?? [];
      const a = it.trail.geometry.attributes.position;
      const n = Math.min(N, tr.length);
      for (let i = 0; i < n; i++) a.array.set(tr[tr.length - n + i], i * 3);
      a.needsUpdate = true;
      it.trail.geometry.setDrawRange(0, n);
    };
    for (const f of flares) draw(f, 'flare');
    for (const m of missiles) draw(m, 'missile');
    for (const [o, it] of this.items) {
      if (live.has(o)) continue;
      this.parent.remove(it.g);
      it.trail.geometry.dispose();
      this.items.delete(o);
    }
  }

  dispose() {
    for (const it of this.items.values()) {
      this.parent.remove(it.g);
      it.trail.geometry.dispose();
    }
    this.items.clear();
    for (const m of [this.ballMat, this.glowMat, this.smokeMat, this.bodyMat, this.flameMat]) m.dispose();
  }
}
