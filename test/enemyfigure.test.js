import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnemyRenderer } from '../src/render/enemies.js';

test('guards are drawn as armoured soldiers that walk, aim, run, burn and fall', () => {
  const scene = new THREE.Scene();
  const flames = { n: 0, spawn() { this.n++; } };
  const r = new EnemyRenderer(scene, flames);
  const e = { p: [1, 0, 1], yaw: 0, state: 'patrol', moving: true, walkPhase: 0 };
  const world = { enemies: [e] };
  r.update(world, 0);
  const f = r.figures[0];
  let parts = 0;
  f.g.traverse((o) => o.isMesh && parts++);
  assert.ok(parts > 40, `${parts} parts (helmet, visor, armour plates, limbs, rifle...)`);
  // walking: the legs swing opposite ways
  e.walkPhase = Math.PI / 2;
  r.update(world, 0.1);
  assert.ok(f.legL.upper.rotation.x * f.legR.upper.rotation.x < 0, 'legs in opposite phase');
  // the visor shows the mood
  const calm = f.visorMat.emissive.getHex();
  e.state = 'investigate';
  r.update(world, 0.2);
  assert.notEqual(f.visorMat.emissive.getHex(), calm, 'amber when they look into something');
  assert.ok(f.rifle.rotation.x < 0.2, 'rifle raised');
  e.state = 'lure';
  r.update(world, 0.3);
  assert.ok(f.torch.visible && flames.n > 0, 'a burning torch when setting a fire');
  e.dead = true;
  r.update(world, 0.4);
  assert.ok(Math.abs(f.g.rotation.x + Math.PI / 2) < 1e-6, 'lying down');
  assert.equal(f.visorMat.emissiveIntensity, 0, 'visor dark');
});
