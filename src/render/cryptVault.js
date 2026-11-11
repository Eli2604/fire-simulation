import * as THREE from 'three';
import { MAT } from '../sim/materials.js';
import { addPatterns, PATTERN_OF_MAT } from './patterns.js';

/**
 * The vault of the underground church (models/cryptChapel.js) drawn smooth: at its 0.2 m
 * voxels a curved ceiling is a staircase. This is the surface the voxels are cut to: the
 * nave's elliptical barrel vault from the tops of its walls to the crown, the apse's
 * half-round wall and its half dome, in dressed stone (the ashlar pattern: coursed
 * blocks, lit by the torches and candles with their relief).
 *
 * pr: { W (half width), L (half length), spring, rise (the vault), apseR, apseSpring }.
 */
export function buildCryptVault(pr) {
  const g = new THREE.Group();
  const { W, L, spring, rise, apseR, apseSpring } = pr;
  const pos = [];
  const idx = [];
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  // the barrel: across x, along z
  const NX = 48;
  const NZ = Math.max(2, Math.round(L * 2));
  const yv = (x) => spring + rise * Math.sqrt(Math.max(0, 1 - (x / W) ** 2));
  for (let j = 0; j <= NZ; j++) {
    const z = -L + (2 * L * j) / NZ;
    for (let i = 0; i <= NX; i++) {
      // closer together near the walls, where the curve is steep
      const t = -1 + (2 * i) / NX;
      const x = W * Math.sin((t * Math.PI) / 2);
      pos.push(x, yv(x), z);
    }
  }
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      quad(a, a + 1, a + NX + 2, a + NX + 1);
    }
  // the apse: a half-round wall, then a half dome (the +z half of a sphere)
  const r = apseR;
  const NA = 32;
  const NY = 6;
  const base = pos.length / 3;
  for (let j = 0; j <= NY; j++) {
    const y = (apseSpring * j) / NY;
    for (let i = 0; i <= NA; i++) {
      const a = (Math.PI * i) / NA;
      pos.push(Math.cos(a) * r, y, L + Math.sin(a) * r);
    }
  }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NA; i++) {
      const a = base + j * (NA + 1) + i;
      quad(a, a + NA + 1, a + NA + 2, a + 1);
    }
  const dome = pos.length / 3;
  const NE = 10;
  for (let j = 0; j <= NE; j++) {
    const e = ((Math.PI / 2) * j) / NE; // elevation
    for (let i = 0; i <= NA; i++) {
      const a = (Math.PI * i) / NA;
      pos.push(Math.cos(a) * Math.cos(e) * r, apseSpring + Math.sin(e) * r, L + Math.sin(a) * Math.cos(e) * r);
    }
  }
  for (let j = 0; j < NE; j++)
    for (let i = 0; i < NA; i++) {
      const a = dome + j * (NA + 1) + i;
      quad(a, a + NA + 1, a + NA + 2, a + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // the normals face into the church (the stone pattern's relief depends on it)
  const P = geo.getAttribute('position');
  const N = geo.getAttribute('normal');
  for (let k = 0; k < P.count; k++) {
    const x = P.getX(k);
    const y = P.getY(k);
    const z = P.getZ(k);
    const inward = k < base ? [-x, spring - y, 0] : k < dome ? [-x, 0, L - z] : [-x, apseSpring - y, L - z];
    if (N.getX(k) * inward[0] + N.getY(k) * inward[1] + N.getZ(k) * inward[2] < 0) N.setXYZ(k, -N.getX(k), -N.getY(k), -N.getZ(k));
  }
  // the dressed-stone pattern, as on the voxels
  geo.setAttribute('aPat', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(PATTERN_OF_MAT[MAT.ashlar]), 1));
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.57, 0.46), roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => addPatterns(sh, false);
  mat.customProgramCacheKey = () => 'crypt-vault-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.noShadow = false;
  g.add(mesh);
  return g;
}
