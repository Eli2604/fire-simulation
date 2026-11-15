/**
 * Shared rigid-body physics (src/physics). See README "Rigid-body physics (src/physics)" and the
 * top of each module. Plain ES modules, no three.js: runs headless in Node and in the browser.
 *
 *   import { PhysicsWorld, Box, Sphere, Capsule, VoxelGridCollider } from './physics/index.js';
 *   const world = new PhysicsWorld({ collider: VoxelGridCollider.fromWorld(simWorld) });
 *   const crate = world.createBody({ shape: new Box(0.3, 0.3, 0.3), position: [5, 2, 5], material: 'wood', density: 500 });
 *   world.onImpact((e) => playImpact(e.materials, e.speed, e.energy, e.point));
 *   world.step(dt);                        // fixed steps inside
 *   crate.interpolated(world.alpha);       // { position, quaternion } to draw
 */
export { PhysicsWorld } from './world.js';
export { Body } from './body.js';
export { Sphere, Box, Capsule, ConvexHull, Compound, VoxelSet, cylinderHull } from './shapes.js';
export { BallJoint, HingeJoint, FixedJoint, DistanceJoint, SliderJoint } from './joints.js';
export { VoxelGridCollider, rayGrid } from './voxelCollider.js';
export { surfaceOf, combine } from './materials.js';
export { buoyancy, waterLevelOfWorld } from './forces.js';
export { RaycastVehicle, RotorForce, HullBuoyancy } from './vehicles.js';
export * as m from './math.js';
