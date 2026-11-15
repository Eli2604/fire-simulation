/**
 * People in a car's way as bodies (physics/vehicleCore.js's shared world; sim/cars.js): a man near a
 * moving car is an upright capsule (0.3 m round, 1.8 m tall) of his weight (85 kg), held where he
 * stands (carried there each step like the boats and the helicopter: vehicleCore.trackPose, gravity
 * off, no turning) and meeting the cars only (GROUP.PERSON). A car that runs into him is a contact:
 * it gives up his share of its momentum (as the old code's m / (m + 85)) and he is shoved; how hard
 * it hit (the closing speed) is what the world layer does with him (sim/cars.js: knocked down and
 * hurt through sim/impact.js above 2 m/s, you hit; pushed aside below). Not every man is a body:
 * only those within reach of a moving car this frame (the rest cost nothing).
 *
 *   peopleNear(PW, people, cars, dt)   the bodies of the people near the moving cars (made, placed,
 *                                      the others taken out of the world) → [{ e, B }]
 *   personOf(B)                        the person a body stands for (or null)
 *   shoved(P)                          after the step: how far the contacts moved him [dx, dz]
 */
import { Capsule } from './shapes.js';
import { Body } from './body.js';
import { vehicleFilter } from './vehicleCore.js';

export const PERSON = { r: 0.3, height: 1.8, mass: 85 };

const keyOf = (e) => (e.player ? 'player' : e);

function bodyFor(e) {
  const B = new Body({ shape: Capsule.y(PERSON.r, PERSON.height / 2 - PERSON.r), position: [e.p[0], e.p[1] + PERSON.height / 2, e.p[2]], mass: PERSON.mass, material: 'fabric', gravityScale: 0, linearDamping: 0, angularDamping: 0, lockRotation: true, canSleep: false, collideWorld: false });
  B.buoyant = false;
  B.restitution = 0.05;
  B.rollingResistance = 0;
  B.ccd = false;
  B.userData = { person: e, impacts: [], onImpact: (ev, self, other) => B.userData.impacts.push({ e: ev, other }) };
  vehicleFilter(B, 'person');
  return B;
}

/** The bodies of the people near the moving cars this step (made, placed where they stand). → [{ e, B, at }] */
export function peopleNear(PW, people, cars, dt) {
  const M = (PW._people ??= new Map());
  const out = [];
  const moving = cars.filter((c) => {
    const B = c.core?.body;
    return B && !B.sleeping && Math.hypot(B.vel[0], B.vel[2]) > 0.05;
  });
  const seen = new Set();
  if (moving.length)
    for (const e of people) {
      if (!e?.p || e.dead) continue;
      if (e.player && cars.some((c) => c.seats?.some((s) => s.who?.player))) continue; // (you drive one)
      const near = moving.some((c) => {
        if (e.aboard === c.id || c.seats?.some((s) => s.who === e)) return false;
        const reach = Math.hypot(c.spec.L, c.spec.W) / 2 + PERSON.r + Math.hypot(c.vx, c.vz) * dt * 2 + 0.5;
        return Math.hypot(e.p[0] - c.x, e.p[2] - c.z) < reach && Math.abs(e.p[1] - c.y) < c.spec.H + 1;
      });
      if (!near) continue;
      const k = keyOf(e);
      seen.add(k);
      let B = M.get(k);
      if (!B) M.set(k, (B = bodyFor(e)));
      B.userData.person = e;
      B.userData.impacts.length = 0;
      if (B.world !== PW) PW.addBody(B);
      const at = [e.p[0], e.p[1] + PERSON.height / 2, e.p[2]];
      B.setPose(at, [0, 0, 0, 1]);
      B.vel[0] = B.vel[1] = B.vel[2] = 0;
      B.angVel[0] = B.angVel[1] = B.angVel[2] = 0;
      if (B.sleeping) B.wake();
      out.push({ e, B, at });
    }
  for (const [k, B] of M)
    if (!seen.has(k)) {
      if (B.world) B.world.removeBody(B);
      M.delete(k);
    }
  return out;
}

export const personOf = (B) => B?.userData?.person ?? null;

/** How far the step's contacts moved him (horizontally): [dx, dz]. */
export function shoved(P) {
  const p = P.B.pos;
  return [p[0] - P.at[0], p[2] - P.at[2]];
}
