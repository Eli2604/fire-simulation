import tree from './tree.js';
import { TREE_KINDS } from './treeKinds.js';

/**
 * Every kind of tree (models/treeKinds.js) as an object of its own for the editor's palette
 * and for scenes: `oakTree`, `willowTree`, `pineTree`, `birchTree`, ... Each is the tree
 * model (models/tree.js) with its kind fixed and the kind's own starting parameters, so it
 * builds, burns and breaks exactly as `{ type: 'tree', params: { species: <kind>, ... } }`
 * with the same parameters does.
 */
const KNOBS = ['height', 'crownRadius', 'trunkRadius', 'foliageDensity', 'foliageMoisture', 'trunkMoisture', 'branches'];

function kindModel(kind) {
  const K = TREE_KINDS[kind];
  const params = {};
  for (const k of KNOBS) params[k] = { ...tree.params[k], value: K.defaults[k] ?? tree.params[k].value };
  params.deadBranches = { value: K.defaults.deadBranches ?? 0, min: 0, max: 12, step: 1, label: 'Dead lower branches (age)' };
  params.seed = { ...tree.params.seed, value: K.defaults.seed ?? 1 };
  return {
    label: K.label,
    about: K.about,
    kind,
    params,
    build: (p, ctx) => tree.build({ ...p, species: kind }, ctx),
  };
}

export const TREE_OBJECTS = Object.fromEntries(Object.keys(TREE_KINDS).map((k) => [`${k}Tree`, kindModel(k)]));

/** A tree object's type for a kind ('pine' -> 'pineTree'). */
export const treeObjectType = (kind) => `${kind}Tree`;
