/**
 * What the squad AI is doing, drawn on the ground and over their heads: each soldier's planned
 * route (dashed ribbon) and trail (solid), the cover he is going to (a ring), his role tag, the
 * hand signal or radio call he is giving (a speech bubble), and each team's threat marker.
 */
import * as THREE from 'three';

export const ROLE_COLOR = { CMD: '#e7c35a', MG: '#e0604a', R1: '#5aa9e6', R2: '#7cc46a' };

function quadGeo(max) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 12), 3));
  const ix = new Uint16Array(max * 6);
  for (let q = 0; q < max; q++) ix.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 2, 4 * q + 1, 4 * q + 3], q * 6);
  g.setIndex(new THREE.BufferAttribute(ix, 1));
  g.setDrawRange(0, 0);
  g.userData.max = max;
  return g;
}
/** A flat ribbon along pts ([x, y, z] or [x, z]) at height y + lift; dashed or solid. */
function fillRibbon(g, pts, w, dash, lift = 0.05) {
  const a = g.attributes.position, max = g.userData.max;
  const s = [];
  const P = pts.map((p) => (p.length === 2 ? [p[0], null, p[1]] : p));
  for (let i = 1; i < P.length; i++) {
    const p0 = P[i - 1], p1 = P[i];
    const L = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), n = Math.max(1, Math.ceil(L / 0.08));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const y0 = p0[1] ?? p1[1] ?? 0, y1 = p1[1] ?? y0;
      s.push([p0[0] + ((p1[0] - p0[0]) * k) / n, y0 + ((y1 - y0) * k) / n, p0[2] + ((p1[2] - p0[2]) * k) / n]);
    }
  }
  let q = 0, acc = 0;
  for (let i = 1; i < s.length && q < max; i++) {
    const [x0, y0, z0] = s[i - 1], [x1, y1, z1] = s[i];
    const L = Math.hypot(x1 - x0, z1 - z0);
    acc += L;
    if (L < 1e-5 || (dash && acc % 0.5 > 0.32)) continue;
    const nx = (-(z1 - z0) / L) * w, nz = ((x1 - x0) / L) * w;
    a.setXYZ(4 * q, x0 + nx, y0 + lift, z0 + nz);
    a.setXYZ(4 * q + 1, x0 - nx, y0 + lift, z0 - nz);
    a.setXYZ(4 * q + 2, x1 + nx, y1 + lift, z1 + nz);
    a.setXYZ(4 * q + 3, x1 - nx, y1 + lift, z1 - nz);
    q++;
  }
  a.needsUpdate = true;
  g.setDrawRange(0, q * 6);
  g.computeBoundingSphere();
}
export function textSprite(text, color, w = 0.5, h = 0.17) {
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  const font = '700 38px "Barlow Condensed", "Arial Narrow", sans-serif';
  g0.font = font;
  const W = Math.max(120, Math.ceil(g0.measureText(text).width) + 36);
  c.width = W;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,22,18,.82)';
  g.fillRect(0, 0, W, 64);
  g.fillStyle = color;
  g.fillRect(0, 58, W, 6);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f1ead8';
  g.fillText(text, W / 2, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }));
  s.scale.set((w * W) / 192, h, 1);
  return s;
}

export class SquadViz {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.items = new Map();
    this.threats = [];
    this.show = true;
  }
  item(m) {
    let it = this.items.get(m);
    if (it) return it;
    const color = new THREE.Color(ROLE_COLOR[m.squad] ?? '#fff');
    const mat = (op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false, side: THREE.DoubleSide });
    it = {
      path: new THREE.Mesh(quadGeo(900), mat(0.95)),
      trail: new THREE.Mesh(quadGeo(1600), mat(0.4)),
      ring: new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), mat(0.9)),
      tag: textSprite((m.unit ? m.unit[0] + '·' : '') + m.squad, ROLE_COLOR[m.squad] ?? '#fff', 0.42, 0.14),
      bubble: null, signal: null, until: 0,
    };
    it.ring.rotation.x = -Math.PI / 2;
    for (const o of [it.path, it.trail, it.ring, it.tag]) {
      o.frustumCulled = false;
      this.root.add(o);
    }
    this.items.set(m, it);
    return it;
  }
  /** members: the squad people; threats: [[x,y,z], ...]; now: seconds (render clock). */
  update(members, threats, now) {
    this.root.visible = this.show;
    const live = new Set();
    for (const m of members) {
      if (!m.squad) continue;
      live.add(m);
      const it = this.item(m);
      const pts = m.path && !m.dead ? [m.p, ...m.path.slice(m.pathI ?? 0)] : [];
      if (pts.length > 1) fillRibbon(it.path.geometry, pts, 0.045, true);
      it.path.visible = pts.length > 1;
      if (m.trail?.length > 1 && (m.trail.length !== it.trailN || m.trail[m.trail.length - 1] !== it.trailLast)) {
        it.trailN = m.trail.length;
        it.trailLast = m.trail[m.trail.length - 1];
        fillRibbon(it.trail.geometry, m.trail.map((q) => [q[0], m.p[1], q[1]]), 0.03, false);
      }
      it.ring.visible = !!m.cover && !!m.path && !m.dead;
      if (m.cover) it.ring.position.set(m.cover[0], m.cover[1] + 0.04, m.cover[2]);
      it.tag.visible = !m.dead;
      it.tag.position.set(m.p[0], m.p[1] + 2.32, m.p[2]);
      if (m.signal && m.signal !== it.signal) {
        it.signal = m.signal;
        if (it.bubble) this.root.remove(it.bubble);
        it.bubble = textSprite(m.signal.text, '#f1ead8', 0.9, 0.24);
        this.root.add(it.bubble);
        it.until = now + 2.8;
      }
      if (it.bubble) {
        it.bubble.position.set(m.p[0], m.p[1] + 2.62, m.p[2]);
        if (now > it.until) {
          this.root.remove(it.bubble);
          it.bubble = null;
        }
      }
    }
    for (const [m, it] of this.items)
      if (!live.has(m)) {
        for (const o of [it.path, it.trail, it.ring, it.tag, it.bubble]) if (o) this.root.remove(o);
        this.items.delete(m);
      }
    // threat markers
    while (this.threats.length < threats.length) {
      const g = new THREE.Group();
      const r = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), new THREE.MeshBasicMaterial({ color: '#d4553b', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.04;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 10), new THREE.MeshStandardMaterial({ color: '#d4553b', emissive: '#5a160c' }));
      pole.position.y = 1.1;
      const t = textSprite('THREAT', '#d4553b', 0.8, 0.27);
      t.position.y = 2.5;
      g.add(r, pole, t);
      this.root.add(g);
      this.threats.push(g);
    }
    this.threats.forEach((g, i) => {
      g.visible = i < threats.length;
      if (threats[i]) g.position.set(threats[i][0], threats[i][1], threats[i][2]);
    });
  }
  dispose() {
    this.scene.remove(this.root);
  }
}
