/**
 * Kinds of tree. A kind is a set of parameters for the procedural tree generator
 * (models/tree.js): how the trunk tapers and where the crown starts, whether a leader runs to
 * the top (excurrent: conifers, birch, poplar) or the trunk breaks up into limbs (decurrent:
 * oak, maple, fruit trees), how many branches each order carries and at what angle, the
 * divergence between successive branches round the axis (phyllotaxis, 137.5° the golden
 * angle), whorls (conifers), gravitropism (+ branches turn up, - they droop: willow whips,
 * birch twigs), the crown's shape, the foliage (leaves or needles, how dense, how wet), the
 * wood (which decides how the tree burns: see sim/materials.js, `charFail` how charred a
 * branch is when it snaps) and dead branches low on the trunk (age; fuel ladder).
 *
 * The branch structure itself is generated per seed. oak, willow and pine have their own
 * hand-shaped forms (`form`), as they always had; the other kinds use the general one
 * ('branching' or 'palm').
 *
 * Woods: the kinds share the four tree woods by how they burn and break.
 *  oak     dense hardwood, limbs mostly burn where they are      (oak, maple, plane, apple)
 *  willow  soft, brittle: charred branches snap and fall burning (willow, birch, poplar)
 *  pine    resinous softwood, hot and sooty; needles carry a crown fire (pine, spruce, fir)
 *  bark    a palm's fibrous stem (its dead fronds hang as a skirt: deadWood)
 *
 * `render`: which of the drawn tree families (render/trees.js: bark, leaf cards, season)
 * it is drawn as. `defaults`: the kind's object's starting parameters (models/treeObjects.js).
 */
export const TREE_KINDS = {
  oak: {
    label: 'Oak',
    about: 'Thick trunk forking into heavy limbs, a broad crown of leaf clusters. Dense hardwood: its limbs mostly burn where they are.',
    form: 'oak', wood: 'oak', leaves: 'leaves', leafColor: [0.22, 0.4, 0.13], render: 'oak',
    defaults: { height: 8, crownRadius: 3, trunkRadius: 0.22, branches: 6, deadBranches: 0, seed: 1 },
  },
  willow: {
    label: 'Weeping willow',
    about: 'Short trunk, limbs arching out, long whips hanging almost to the ground. Soft brittle wood: charred branches snap and drop, burning.',
    form: 'willow', wood: 'willow', leaves: 'leaves', leafColor: [0.45, 0.58, 0.22], render: 'willow',
    defaults: { height: 7, crownRadius: 2.6, trunkRadius: 0.22, branches: 6, deadBranches: 0, seed: 2 },
  },
  pine: {
    label: 'Pine',
    about: 'Straight trunk, whorls of branches, dead dry branches low on the trunk (a ladder for a grass fire) and resinous needles that carry a crown fire.',
    form: 'pine', wood: 'pine', leaves: 'needles', leafColor: [0.12, 0.3, 0.13], render: 'pine',
    defaults: { height: 9, crownRadius: 2.2, trunkRadius: 0.22, branches: 6, deadBranches: 4, seed: 3 },
  },
  birch: {
    label: 'Birch',
    about: 'A slender leader with a narrow, airy crown of fine drooping twigs and small light leaves. Soft wood: burnt branches fall.',
    form: 'branching', excurrent: true, crownBase: 0.3, taper: 0.3, laterals: 2.4, divergence: 137.5, branchAngle: 50,
    kids: 2, orders: 2, lengthRatio: 0.55, radiusRatio: 0.55, gravitropism: -0.35, shape: 'ovoid', leafSize: 0.32,
    wood: 'willow', leaves: 'leaves', leafColor: [0.4, 0.58, 0.2], render: 'willow',
    defaults: { height: 10, crownRadius: 2.2, trunkRadius: 0.14, branches: 7, deadBranches: 0, foliageDensity: 0.45, seed: 1 },
  },
  maple: {
    label: 'Maple',
    about: 'A short bole breaking up into upswept limbs, a dense round crown. Hardwood: its limbs hold while they burn.',
    form: 'branching', excurrent: false, crownBase: 0.3, taper: 0.8, divergence: 137.5, branchAngle: 38,
    kids: 2, orders: 3, lengthRatio: 0.66, radiusRatio: 0.62, gravitropism: 0.12, shape: 'round', leafSize: 0.5,
    wood: 'oak', leaves: 'leaves', leafColor: [0.2, 0.43, 0.13], render: 'oak',
    defaults: { height: 10, crownRadius: 3.4, trunkRadius: 0.24, branches: 5, deadBranches: 0, foliageDensity: 0.65, seed: 1 },
  },
  plane: {
    label: 'Plane tree',
    about: 'A tall, broad street and park tree: a stout trunk, wide spreading limbs, a high domed crown. Hardwood.',
    form: 'branching', excurrent: false, crownBase: 0.35, taper: 0.8, divergence: 137.5, branchAngle: 42,
    kids: 2, orders: 3, lengthRatio: 0.68, radiusRatio: 0.62, gravitropism: 0.05, shape: 'round', leafSize: 0.55,
    wood: 'oak', leaves: 'leaves', leafColor: [0.25, 0.44, 0.15], render: 'oak',
    defaults: { height: 13, crownRadius: 4.2, trunkRadius: 0.32, branches: 5, deadBranches: 0, foliageDensity: 0.6, seed: 1 },
  },
  poplar: {
    label: 'Lombardy poplar',
    about: 'A tall narrow column: a leader with short steep branches all the way up. Soft wood: burnt branches fall.',
    form: 'branching', excurrent: true, crownBase: 0.08, taper: 0.3, laterals: 3, divergence: 137.5, branchAngle: 22,
    kids: 2, orders: 2, lengthRatio: 0.5, radiusRatio: 0.55, gravitropism: 0.5, shape: 'column', leafSize: 0.42,
    wood: 'willow', leaves: 'leaves', leafColor: [0.26, 0.47, 0.16], render: 'willow',
    defaults: { height: 13, crownRadius: 1.3, trunkRadius: 0.2, branches: 8, deadBranches: 0, foliageDensity: 0.6, seed: 1 },
  },
  spruce: {
    label: 'Spruce',
    about: 'A narrow cone of drooping whorled branches down nearly to the ground, dense needles: a fuel ladder from the grass to the crown.',
    form: 'branching', excurrent: true, whorl: 5, whorlGap: 0.5, crownBase: 0.06, taper: 0.25, divergence: 72, branchAngle: 95,
    kids: 2, orders: 2, lengthRatio: 0.4, radiusRatio: 0.5, gravitropism: -0.25, shape: 'cone', leafSize: 0.3, needlesAlong: true,
    wood: 'pine', leaves: 'needles', leafColor: [0.1, 0.27, 0.15], render: 'pine',
    defaults: { height: 11, crownRadius: 2.1, trunkRadius: 0.2, branches: 6, deadBranches: 3, foliageMoisture: 0.9, seed: 1 },
  },
  fir: {
    label: 'Fir',
    about: 'A symmetric cone of level whorled branches with flat sprays of needles. Resinous: it burns as a torch.',
    form: 'branching', excurrent: true, whorl: 4, whorlGap: 0.55, crownBase: 0.12, taper: 0.28, divergence: 90, branchAngle: 85,
    kids: 2, orders: 2, lengthRatio: 0.45, radiusRatio: 0.5, gravitropism: 0, shape: 'cone', leafSize: 0.32, needlesAlong: true,
    wood: 'pine', leaves: 'needles', leafColor: [0.09, 0.25, 0.12], render: 'pine',
    defaults: { height: 10, crownRadius: 2, trunkRadius: 0.2, branches: 6, deadBranches: 2, foliageMoisture: 0.9, seed: 1 },
  },
  apple: {
    label: 'Apple (fruit tree)',
    about: 'A small orchard tree: a low trunk, a few wide limbs, a round open crown. Dense hardwood.',
    form: 'branching', excurrent: false, crownBase: 0.28, taper: 0.8, divergence: 137.5, branchAngle: 55,
    kids: 2, orders: 3, lengthRatio: 0.65, radiusRatio: 0.6, gravitropism: -0.05, shape: 'round', leafSize: 0.42,
    wood: 'oak', leaves: 'leaves', leafColor: [0.24, 0.45, 0.14], render: 'oak',
    defaults: { height: 4.5, crownRadius: 2.2, trunkRadius: 0.13, branches: 4, deadBranches: 0, foliageDensity: 0.6, seed: 1 },
  },
  palm: {
    label: 'Palm',
    about: 'A slender, slightly leaning stem with a crown of arching fronds and a skirt of dead dry fronds under it, which catch easily.',
    form: 'palm', wood: 'bark', leaves: 'leaves', leafColor: [0.3, 0.5, 0.16], render: 'willow',
    defaults: { height: 8, crownRadius: 3, trunkRadius: 0.17, branches: 12, deadBranches: 6, foliageDensity: 0.7, seed: 1 },
  },
};

/** A species / kind name as a kind (older scenes said 'deciduous' / 'conifer'; unknown: oak). */
export function treeKind(name) {
  if (name === 'conifer') return 'pine';
  if (name === 'deciduous') return 'oak';
  return TREE_KINDS[name] ? name : 'oak';
}
