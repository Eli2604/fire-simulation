/** A bare battle world for the tests: helicopters, cars and boats on flat ground / the sea, no voxels. */
import { Helicopter, worldContacts } from '../src/ai/helicopter.js';
import { stepBattle, battleCtx } from '../src/ai/battle.js';
import { newCar, boardCar, stepCarList } from '../src/sim/cars.js';
import { placeRowBoat } from '../src/models/rowBoat.js';
import { launchBoat, stepBoat, boardSeat } from '../src/sim/boats.js';

export function battleWorld(o = {}) {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [], helis: [], cars: [], floats: [], tracers: [], ordnance: [], playerHits: [], ...(o.sea ? { sea: { level: 0 } } : {}) };
  const ctx = battleCtx(world, null, { seed: o.seed ?? 99, ground: o.ground ?? (() => 0) });
  const sim = { world, solid: (x, y) => y < 0 };
  const B = {
    world, ctx, sim,
    heli(p) {
      const host = { world, sim, addCrew: (e) => world.enemies.push(e), contacts: () => worldContacts({ world }), battle: ctx, ground: o.ground ?? (() => 0) };
      const h = new Helicopter({ seed: 3, ...p }, host);
      world.helis.push({ ai: h });
      return h;
    },
    man(side, extra = {}) {
      const m = { p: [0, 0, 0], health: 100, side, name: `${side} man`, squad: 'R1', ...extra };
      world.enemies.push(m);
      return m;
    },
    car(params = {}, at = {}, crew = []) {
      const c = newCar({ length: 4.4, width: 1.9, height: 1.9, fuelLiters: 60, ...params }, { id: `car${world.cars.length}`, ...at });
      c.physics = 'legacy';
      world.cars.push(c);
      crew.forEach((m, i) => boardCar(c, m, i));
      return c;
    },
    boat(params = {}, at = {}, crew = []) {
      const f = launchBoat(placeRowBoat({ moored: false, kind: 'motor', motor: 'outboard', ...params }, [0, 0, 0], 0.1).floats[0], at);
      f.physics = 'legacy';
      if (params.side) f.side = params.side;
      if (params.mountedGun) f.mountedGun = params.mountedGun;
      world.floats.push(f);
      crew.forEach((m) => boardSeat(f, m));
      return f;
    },
    run(s, dt = 0.05, until = null) {
      for (let t = 0; t < s; t += dt) {
        world.time += dt;
        for (const { ai } of world.helis) ai.step(dt);
        stepBattle(ctx, dt);
        for (const f of world.floats) stepBoat(f, dt, { level: 0 });
        if (world.cars.length) stepCarList(world.cars, dt, { world: null });
        if (until?.()) return true;
      }
      return false;
    },
  };
  return B;
}
