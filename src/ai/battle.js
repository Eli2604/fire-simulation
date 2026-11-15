/**
 * The battle's own step, once per simulation step after the helicopters (ai/helicopter.js HeliAI;
 * a test calls it itself): the cars and boats a scene gives a crew (their `crewMen` param: soldiers
 * of their `side` put in their seats, the first at the wheel; a car's `driveToX` / `driveToZ`: where
 * its driver takes it), the guns mounted on cars and boats (ai/mountedGuns.js), the ordnance in the
 * air (sim/ordnance.js: rounds, rockets, missiles, flares), the cars set burning by it (their men
 * out, their tanks bursting).
 *
 *   stepBattle(ctx, dt)   ctx: sim/ordnance.js battleCtx(world, sim?)
 *   manVehicles(ctx)      the crews in (once each)
 */
import { stepOrdnance, stepVehicleFires, battleCtx } from '../sim/ordnance.js';
import { stepMountedGuns } from './mountedGuns.js';
import { boardCar } from '../sim/cars.js';
import { carToWorld } from '../sim/carPhysics.js';
import { boardSeat, seatWorld } from '../sim/boats.js';
import { driveTo } from './carDriver.js';
import { vehicleKind } from './vehicleSides.js';

export function stepBattle(ctx, dt) {
  manVehicles(ctx);
  stepMountedGuns(ctx, dt);
  stepOrdnance(ctx, dt);
  stepVehicleFires(ctx, dt);
}

const SIDE = { friendly: 'blue', enemy: 'red' };

/** The crews the scene asks for, in their seats (once): soldiers of the vehicle's side, held there. */
export function manVehicles(ctx) {
  const w = ctx.world;
  for (const v of [...(w.cars ?? []), ...(w.floats ?? [])]) {
    if (v.manned) continue;
    const n = Math.min(4, v.crewMen ?? v.params?.crewMen ?? 0);
    const side0 = v.side ?? v.params?.side;
    const side = SIDE[side0] ?? side0;
    if (!n || !side || side === 'auto' || side === 'neutral') {
      v.manned = true;
      continue;
    }
    const kind = vehicleKind(v);
    if (kind === 'boat' && !v.seats) continue; // (afloat once stepped: sim/boats.js initBoat)
    v.manned = true;
    for (let i = 0; i < n; i++) {
      const m = {
        p: [0, 0, 0], home: [0, 0, 0], health: 100, state: 'patrol', yaw: 0, side, unit: `${v.label ?? kind} crew`,
        loadout: 'rifle', skill: i === n - 1 ? 'veteran' : 'regular', armour: true, helmet: true,
        guardCtl: true, // (in his seat: neither the guard AI nor a squad moves him)
        name: `${v.label ?? kind} ${i === 0 ? 'driver' : i === n - 1 && (v.mountedGun ?? v.params?.mountedGun) ? 'gunner' : `crew ${i + 1}`}`,
      };
      if (kind === 'car') {
        // the driver, then the back (the gunner's seat last), then the front passenger
        const order = [0, 3, 2, 1];
        if (boardCar(v, m, order[i]) < 0) continue;
        const s = v.seats.find((q) => q.who === m);
        m.p = carToWorld(v, [s.at[0], s.at[1] - 0.45, s.at[2]]);
        m.inCar = v;
        m.anim = s.drive ? 'carDrive' : 'carSit';
      } else {
        if (boardSeat(v, m) < 0) continue;
        m.p = seatWorld(v, m.boatSeat).p;
      }
      m.home = m.p.slice();
      (w.enemies ??= []).push(m);
    }
    const to = [v.params?.driveToX, v.params?.driveToZ];
    if (kind === 'car' && to.every((x) => typeof x === 'number' && x !== 0)) driveTo(v, [to[0], ctx.ground(to[0], to[1]), to[1]], { speed: 7, radius: 6 });
  }
}

export { battleCtx };
