import * as THREE from 'three';

/** Simple figures for the enemies: walking, carrying a torch when they set a fire, burning, lying when down. */
export class EnemyRenderer {
  constructor(scene, flames) {
    this.scene = scene;
    this.flames = flames;
    this.figures = [];
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 }),
      head: new THREE.MeshStandardMaterial({ color: 0xc89a7a, roughness: 0.8 }),
      legs: new THREE.MeshStandardMaterial({ color: 0x1d2128, roughness: 0.9 }),
      torch: new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 }),
    };
  }

  figure() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), this.mats.body);
    body.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), this.mats.head);
    head.position.y = 1.6;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.84, 0.18), this.mats.legs);
    const legR = legL.clone();
    legL.geometry = legL.geometry.clone().translate(0, -0.42, 0);
    legR.geometry = legL.geometry;
    legL.position.set(-0.1, 0.84, 0);
    legR.position.set(0.1, 0.84, 0);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.12).translate(0, -0.3, 0), this.mats.body);
    const armR = armL.clone();
    armL.position.set(-0.27, 1.42, 0);
    armR.position.set(0.27, 1.42, 0);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.45), this.mats.torch);
    torch.position.set(0, -0.62, 0.12);
    torch.rotation.x = 0.6;
    armR.add(torch);
    for (const m of [body, head, legL, legR, armL, armR]) m.castShadow = true;
    g.add(body, head, legL, legR, armL, armR);
    this.scene.add(g);
    return { g, legL, legR, armL, armR, torch };
  }

  update(world, time) {
    const list = world?.enemies ?? [];
    while (this.figures.length < list.length) this.figures.push(this.figure());
    this.figures.forEach((f, k) => {
      const e = list[k];
      f.g.visible = !!e;
      if (!e) return;
      f.g.position.set(e.p[0], e.p[1], e.p[2]);
      f.g.rotation.set(0, e.yaw ?? 0, 0);
      if (e.dead) {
        f.g.rotation.x = -Math.PI / 2; // lying down
        f.g.position.y = e.p[1] + 0.15;
        return;
      }
      const ph = e.walkPhase ?? 0;
      const sw = e.moving ? Math.sin(ph) * 0.6 : 0;
      f.legL.rotation.x = sw;
      f.legR.rotation.x = -sw;
      f.armL.rotation.x = -sw * 0.8;
      f.armR.rotation.x = e.state === 'lure' ? -1.2 : sw * 0.8;
      f.torch.visible = e.state === 'lure';
      if (e.state === 'lure' && this.flames) {
        const p = new THREE.Vector3();
        f.torch.getWorldPosition(p);
        this.flames.spawn(p.x, p.y + 0.2, p.z, 0, 0.8, 0, 0.25, 0.12, 0, 0.8);
      }
      if (e.onFire > 0 && this.flames)
        for (let k2 = 0; k2 < 4; k2++) this.flames.spawn(e.p[0] + (Math.random() - 0.5) * 0.5, e.p[1] + Math.random() * 1.7, e.p[2] + (Math.random() - 0.5) * 0.5, 0, 1, 0, 0.3, 0.25, 0, 0.8);
    });
    void time;
  }
}
