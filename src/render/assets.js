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
 * Without a connection the scenes still work: the surfaces keep their own colours, the
 * skulls their procedural shape, and a statue shows as its stone voxels.
 */
export const POLYHAVEN = 'https://dl.polyhaven.org/file/ph-assets';

/** A Poly Haven texture (1k jpg): kind 'diff' (colour) or 'nor' (normal map, OpenGL). */
export function polyHavenTexture(id, kind) {
  return `${POLYHAVEN}/Textures/jpg/1k/${id}/${id}_${kind === 'diff' ? 'diff' : 'nor_gl'}_1k.jpg`;
}

const models = new Map();

/** A Poly Haven model (glTF, 1k textures): its scene, loaded once, shared. */
export function loadPolyHavenModel(id) {
  if (!models.has(id))
    models.set(
      id,
      fetch(`https://api.polyhaven.com/files/${id}`)
        .then((r) => r.json())
        .then((files) => {
          const g = files.gltf['1k'].gltf;
          // the glTF names its binary and textures relative to itself; they live elsewhere
          const where = Object.entries(g.include ?? {});
          const manager = new THREE.LoadingManager();
          manager.setURLModifier((url) => where.find(([k]) => url.endsWith(k))?.[1].url ?? url);
          return new GLTFLoader(manager).loadAsync(g.url);
        })
        .then((gltf) => gltf.scene),
    );
  return models.get(id);
}
