import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Ready-made assets loaded from where they are published, not kept in this repository
 * (the repository stays small): CC0 photo textures and models from Poly Haven
 * (polyhaven.com; its file API says where each file of a model is), the Khronos glTF
 * samples on GitHub. Both serve them to browsers anywhere (CORS). Only what is made
 * from them here is kept: a reduced skull (render/models/skull.bin), the solid shape of
 * the statue as voxel cells (models/data/).
 *
 * A copy next to the page comes first: ph/index.json and the files it lists, made by
 * scripts/mirror-assets.mjs (a hosted page may not reach Poly Haven; the copy is
 * published with it). Without either the scenes still work: the surfaces keep their own
 * colours, the skulls their procedural shape, and a statue shows as its stone voxels.
 */
export const POLYHAVEN = 'https://dl.polyhaven.org/file/ph-assets';

/** A Poly Haven texture (1k jpg): kind 'diff' (colour) or 'nor' (normal map, OpenGL). */
export function polyHavenTexture(id, kind) {
  return `${POLYHAVEN}/Textures/jpg/1k/${id}/${id}_${kind === 'diff' ? 'diff' : 'nor_gl'}_1k.jpg`;
}

/** The copy next to the page, if there is one: { base, models: [ids], textures: [ids] } or null. */
let mirror = null;
function localCopy() {
  if (!mirror) {
    let base;
    try {
      base = new URL('ph/', location.href);
    } catch {
      return (mirror = Promise.resolve(null));
    }
    mirror = fetch(new URL('index.json', base))
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => (m && Array.isArray(m.models) ? { ...m, base } : null))
      .catch(() => null);
  }
  return mirror;
}

/** Where to load a Poly Haven texture from: the copy next to the page, else Poly Haven. */
export async function textureUrl(id, kind) {
  const m = await localCopy();
  if (m?.textures?.includes(id)) return new URL(`tex/${id}_${kind === 'diff' ? 'diff' : 'nor'}.jpg`, m.base).href;
  return polyHavenTexture(id, kind);
}

const models = new Map();

function fromPolyHaven(id) {
  return fetch(`https://api.polyhaven.com/files/${id}`)
    .then((r) => r.json())
    .then((files) => {
      const g = files.gltf['1k'].gltf;
      // the glTF names its binary and textures relative to itself; they live elsewhere
      const where = Object.entries(g.include ?? {});
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => where.find(([k]) => url.endsWith(k))?.[1].url ?? url);
      return new GLTFLoader(manager).loadAsync(g.url);
    });
}

/** A Poly Haven model (glTF, 1k textures): its scene, loaded once, shared. */
export function loadPolyHavenModel(id) {
  if (!models.has(id))
    models.set(
      id,
      localCopy()
        .then((m) =>
          m?.models.includes(id)
            ? new GLTFLoader().loadAsync(new URL(`${id}/${id}.gltf`, m.base).href).catch(() => fromPolyHaven(id))
            : fromPolyHaven(id),
        )
        .then((gltf) => gltf.scene),
    );
  return models.get(id);
}
