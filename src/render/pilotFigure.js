import * as THREE from 'three';

/**
 * A jet pilot: a soldier in a flight suit, helmet with visor, life vest and harness, with joints
 * (shoulders, elbows, hips, knees, the whole body) posed and blended by name: seated in the
 * cockpit, ejecting, tumbling away from the seat, hanging in the harness, pulling a toggle to steer
 * left or right, flaring with both, the parachute landing fall (a roll), standing, walking, afloat
 * in the life vest. With it the seat and the parachute (canopy, risers and toggle lines), which
 * inflates (setInflate). Light enough for a flight of eight. Frame: facing +x, up +y, origin at
 * the seat of the pants (the pelvis).
 *
 *   const f = new PilotFigure();
 *   f.setPose('steerLeft'); f.setInflate(1); f.update(dt);
 */
const D = Math.PI / 180;
/** Joint angles per pose: shoulders [raise sideways, swing forward], elbows, hips (forward), knees, body [roll, pitch]. */
export const PILOT_POSES = {
  seated: { sh: [10, 40], el: 50, hip: 85, knee: 85, body: [0, 0] },
  eject: { sh: [5, 20], el: 70, hip: 95, knee: 100, body: [0, -5] },
  tumble: { sh: [70, 30], el: 20, hip: 40, knee: 30, body: [0, 0] },
  hang: { sh: [25, 165], el: 25, hip: 15, knee: 15, body: [0, 0] },
  steerLeft: { shL: [20, 60], shR: [25, 165], elL: 60, elR: 25, hip: 15, knee: 15, body: [-12, 0] },
  steerRight: { shL: [25, 165], shR: [20, 60], elL: 25, elR: 60, hip: 15, knee: 15, body: [12, 0] },
  flare: { sh: [15, 15], el: 40, hip: 35, knee: 40, body: [0, -8] },
  plf: { sh: [40, 70], el: 80, hip: 70, knee: 90, body: [80, 25] },
  stand: { sh: [8, 0], el: 10, hip: 0, knee: 0, body: [0, 0] },
  walk: { sh: [8, 0], el: 20, hip: 0, knee: 10, body: [0, 4], walk: true },
  crouch: { sh: [10, 30], el: 60, hip: 80, knee: 120, body: [0, 15] },
  float: { sh: [60, 20], el: 20, hip: 30, knee: 20, body: [0, -55] },
};

export class PilotFigure {
  constructor({ suit = 0x5d6b4a, seat = true } = {}) {
    const g = (this.group = new THREE.Group());
    this.body = new THREE.Group();
    g.add(this.body);
    const suitM = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7 });
    const helmetM = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.35 });
    const visorM = new THREE.MeshStandardMaterial({ color: 0x302010, metalness: 0.8, roughness: 0.15 });
    const vestM = new THREE.MeshStandardMaterial({ color: 0xe6c21a, roughness: 0.6 });
    const add = (geo, mat, parent, pos) => {
      const m = new THREE.Mesh(geo, mat);
      if (pos) m.position.set(...pos);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // torso, harness, vest, head
    add(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), suitM, this.body, [0, 0.33, 0]);
    add(new THREE.BoxGeometry(0.26, 0.5, 0.36), dark, this.body, [0.02, 0.34, 0]).scale.set(1, 1, 1.02); // harness / survival vest
    this.vest = add(new THREE.TorusGeometry(0.17, 0.06, 8, 16).rotateX(Math.PI / 2), vestM, this.body, [0.02, 0.62, 0]);
    const head = (this.head = new THREE.Group());
    head.position.set(0, 0.74, 0);
    this.body.add(head);
    add(new THREE.SphereGeometry(0.15, 14, 10), helmetM, head, [0, 0.1, 0]);
    add(new THREE.SphereGeometry(0.13, 12, 8, -Math.PI / 2.6, Math.PI / 1.3, Math.PI / 3, Math.PI / 3), visorM, head, [0.03, 0.08, 0]);
    // arms and legs: a joint group each, the limb hanging down from it
    const limb = (parent, pos, upper, lower, r, mat) => {
      const j = new THREE.Group();
      j.position.set(...pos);
      parent.add(j);
      add(new THREE.CapsuleGeometry(r, upper - 2 * r, 3, 8), mat, j, [0, -upper / 2, 0]);
      const k = new THREE.Group();
      k.position.y = -upper;
      j.add(k);
      add(new THREE.CapsuleGeometry(r * 0.9, lower - 2 * r, 3, 8), mat, k, [0, -lower / 2, 0]);
      return { j, k };
    };
    this.armL = limb(this.body, [0, 0.58, -0.22], 0.3, 0.3, 0.055, suitM);
    this.armR = limb(this.body, [0, 0.58, 0.22], 0.3, 0.3, 0.055, suitM);
    this.legL = limb(this.body, [0, 0.04, -0.1], 0.44, 0.44, 0.07, suitM);
    this.legR = limb(this.body, [0, 0.04, 0.1], 0.44, 0.44, 0.07, suitM);
    for (const l of [this.legL, this.legR]) add(new THREE.BoxGeometry(0.24, 0.09, 0.1), dark, l.k, [0.06, -0.47, 0]); // boots
    // the ejection seat
    this.seat = new THREE.Group();
    add(new THREE.BoxGeometry(0.5, 0.08, 0.5), dark, this.seat, [0.05, -0.06, 0]);
    add(new THREE.BoxGeometry(0.1, 0.95, 0.5), dark, this.seat, [-0.22, 0.42, 0]);
    add(new THREE.BoxGeometry(0.16, 0.25, 0.4), new THREE.MeshStandardMaterial({ color: 0x3a3f1c }), this.seat, [-0.24, 0.98, 0]);
    this.seat.visible = seat;
    g.add(this.seat);
    // the parachute: canopy (inflating), risers to the shoulders, toggle lines to the hands
    this.chute = new THREE.Group();
    this.dome = add(new THREE.SphereGeometry(3.4, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2.8), new THREE.MeshStandardMaterial({ color: 0xf07a1e, roughness: 0.8, side: THREE.DoubleSide }), this.chute, [0, 3.3, 0]);
    this.dome.scale.set(1, 0.55, 1);
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      pts.push(0, 0.62, Math.sign(Math.sin(a)) * 0.2, Math.cos(a) * 2.9, 5.0, Math.sin(a) * 2.9);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.risers = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2a2a }));
    this.chute.add(this.risers);
    this.chute.visible = false;
    g.add(this.chute);
    this.inflate = 0;
    this.cur = { ...this.flat(PILOT_POSES.seated) };
    this.want = this.cur;
    this.pose = 'seated';
    this.t = 0;
  }

  flat(P) {
    return {
      shL: P.shL ?? P.sh, shR: P.shR ?? P.sh, elL: P.elL ?? P.el, elR: P.elR ?? P.el,
      hip: P.hip, knee: P.knee, body: P.body, walk: P.walk ? 1 : 0,
    };
  }

  setPose(name) {
    if (!PILOT_POSES[name] || name === this.pose) return;
    this.pose = name;
    this.want = this.flat(PILOT_POSES[name]);
  }

  /** The canopy filling: 0 packed … 1 open. */
  setInflate(x) {
    this.inflate = x;
    this.chute.visible = x > 0.01;
    const s = 0.15 + 0.85 * x;
    this.dome.scale.set(s, 0.55 * (0.4 + 0.6 * x), s);
    this.dome.position.y = 1.5 + 1.8 * x;
    this.risers.scale.set(s, 0.4 + 0.6 * x, s);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, dt * 7);
    const c = this.cur;
    const w = this.want;
    const lerp2 = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    this.cur = {
      shL: lerp2(c.shL, w.shL), shR: lerp2(c.shR, w.shR), elL: c.elL + (w.elL - c.elL) * k, elR: c.elR + (w.elR - c.elR) * k,
      hip: c.hip + (w.hip - c.hip) * k, knee: c.knee + (w.knee - c.knee) * k, body: lerp2(c.body, w.body), walk: c.walk + (w.walk - c.walk) * k,
    };
    const p = this.cur;
    const sw = p.walk * Math.sin(this.t * 7) * 30;
    this.armL.j.rotation.set(p.shL[0] * D, 0, (p.shL[1] - sw) * D);
    this.armR.j.rotation.set(-p.shR[0] * D, 0, (p.shR[1] + sw) * D);
    this.armL.k.rotation.z = p.elL * D;
    this.armR.k.rotation.z = p.elR * D;
    this.legL.j.rotation.z = (p.hip + sw) * D;
    this.legR.j.rotation.z = (p.hip - sw) * D;
    this.legL.k.rotation.z = -(p.knee + Math.max(0, -sw)) * D;
    this.legR.k.rotation.z = -(p.knee + Math.max(0, sw)) * D;
    // tumbling away from the seat: the whole body turns over
    const tumble = this.pose === 'tumble' ? this.t * 4 : 0;
    this.body.rotation.set(p.body[0] * D, 0, p.body[1] * D + tumble);
    this.vest.scale.setScalar(this.pose === 'float' ? 1.6 : 0.8);
  }
}
