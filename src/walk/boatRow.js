import { boardSeat, leaveSeat, seatWorld, rower, row, castOff, makeFast, boatAt } from '../sim/boats.js';
import { toWorld } from '../sim/buoyancy.js';
import { MAT } from '../sim/materials.js';

/**
 * Rowing a boat yourself (a rowing boat afloat: models/rowBoat.js, sim/boats.js). Walk up to one
 * and press E (a boat that takes you somewhere, the island's at its pier: Shift+E, E takes you
 * there): you step in and sit at the oars (the rower's thwart; taken: another seat, a passenger).
 * The simulation keeps stepping the boat (sim/buoyancy.js stepFloats → sim/boats.js): this gives
 * the rower's orders (row), sits you on the thwart in its pose and shows how it is doing.
 *
 * Controls
 *   W / S        pull / back water (both oars)
 *   A / D        to port / to starboard: the other oar pulls, this one backs (with W: a wide turn)
 *   mouse        look round (you face the bow: a sculler would look over his shoulder)
 *   C            cast off / make fast (to the shore or a pier within reach of the bow)
 *   E            step ashore (land within reach of its side); Shift+E: over the side, into the water
 *
 * Limitations: it is the boat's own mesh that you sit in (no voxels move with it); once it has
 * left its berth its voxels are taken out of the grid, so it no longer burns (fire has nothing to
 * burn) and only shots and blasts hole it; water in a pond's voxels shows inside its hull.
 */
export class BoatRow {
  constructor(walk, sim, f) {
    this.walk = walk;
    this.view = walk.view;
    this.sim = sim;
    this.f = f;
    this.me = { player: true, name: 'you', mass: 85 };
    this.seat = boardSeat(f, this.me);
    this.look = [0, -0.15]; // yaw (from the bow), pitch
    this.hud = document.createElement('div');
    this.hud.className = 'flightHud';
    Object.assign(this.hud.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      font: '13px/1.4 ui-monospace, monospace', color: '#d8ecff', background: 'rgba(0,12,30,0.55)', border: '1px solid #468',
      borderRadius: '6px', pointerEvents: 'none', zIndex: 30, whiteSpace: 'pre',
    });
    document.body.appendChild(this.hud);
  }

  /** The boat nearest you (within reach, afloat): the float, or null. */
  static near(w, p) {
    return boatAt(w, p, 1.6);
  }

  mouse(dx, dy) {
    this.look[0] = Math.max(-2.6, Math.min(2.6, this.look[0] - dx * 0.003));
    this.look[1] = Math.max(-1.2, Math.min(1.0, this.look[1] - dy * 0.003));
  }

  /** The rower's orders from the keys (pure: the tests could drive it the same way). */
  static ordersFrom(keys) {
    const k = (c) => (keys.has(c) ? 1 : 0);
    return { pull: k('KeyW') - k('KeyS'), turn: k('KeyD') - k('KeyA') };
  }

  update(dt, keys) {
    if (this.done) return;
    const f = this.f;
    this.fireRequested = this.flaresRequested = false;
    if (rower(f) === this.me) {
      const o = BoatRow.ordersFrom(keys);
      row(f, o.pull, o.turn);
    }
    if (f.body.sunk || f.body.swamped) {
      this.sunkT = (this.sunkT ?? 0) + dt;
      if (this.sunkT > 2) return this.end(f.body.sunk ? 'It went down under you: you swim for it' : 'Swamped: you go over the side', this.sidePoint());
    }
    this.draw();
  }

  /** You on the thwart, in its pose; the instruments. */
  draw() {
    const f = this.f;
    const b = f.body;
    const s = seatWorld(f, this.seat);
    const up = b.pose.R;
    const eye = 0.78;
    const cam = this.view.camera;
    cam.position.set(s.p[0] + up[1] * eye, s.p[1] + up[4] * eye, s.p[2] + up[7] * eye);
    cam.up.set(0, 1, 0);
    cam.rotation.set(this.look[1], b.yaw - Math.PI / 2 + this.look[0], -b.roll * 0.5, 'YXZ');
    cam.updateMatrixWorld();
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    const ahead = b.vx * c - b.vz * sn;
    const st = f.mooring ? (f.mooring.taut ? 'moored (line taut)' : 'moored') : 'adrift';
    const holes = f.shotHoles?.length ?? 0;
    this.hud.textContent =
      `BOAT  ${ahead >= 0 ? 'ahead' : 'astern'} ${Math.abs(ahead).toFixed(1)} m/s   heading ${Math.round((((-b.yaw * 180) / Math.PI) % 360 + 360) % 360)}°   ${st}\n` +
      (rower(f) === this.me ? 'W/S pull / back water   A/D port / starboard   C ' + (f.mooring ? 'cast off' : 'make fast') : 'a passenger (someone else has the oars)') +
      '   E step ashore' +
      (b.water > 0.002 ? `\n⚠ WATER ABOARD ${(b.water * 1000).toFixed(0)} l${holes ? ` (${holes} holes)` : ''}  freeboard ${Math.max(0, b.freeboard ?? 0).toFixed(2)} m` : holes ? `\n${holes} holes in the hull, above the water` : '');
  }

  /** C: untie, or tie up to what is solid within reach of the bow. */
  castOff() {
    const f = this.f;
    if (f.mooring) {
      castOff(f);
      return this.walk.say('Cast off: you are adrift', 2);
    }
    const b = f.body;
    const bow = toWorld(b, [b.hull.x1 - 0.1, b.hull.sheer(b.hull.x1 - 0.1), 0]);
    const land = this.landNear(bow, 1.8);
    if (!land) return this.walk.say('Nothing to tie up to within reach of the bow', 2);
    makeFast(f, land);
    this.walk.say('Made fast', 2);
  }

  /** Solid ground (not water) at the water's level or a little over it within r m of p: its top, or null. */
  landNear(p, r) {
    const w = this.sim.world;
    const lvl = this.f.water?.level ?? p[1];
    let best = null, bd = Infinity;
    for (let d = 0.4; d <= r; d += 0.3)
      for (let a = 0; a < 16; a++) {
        const x = p[0] + Math.cos((a / 16) * Math.PI * 2) * d, z = p[2] + Math.sin((a / 16) * Math.PI * 2) * d;
        for (let y = lvl + 1.6; y > lvl - 0.3; y -= w.h) {
          const i = w.voxelAt(x, y, z);
          if (i < 0) break;
          const m = w.mat[i];
          if (!m) continue;
          if (m !== MAT.water && (this.f.detached || !this.f.own?.includes(i)) && d < bd) {
            bd = d;
            best = [x, Math.floor(y / w.h) * w.h + w.h, z];
          }
          break;
        }
      }
    return best;
  }

  /** Beside it, at the water. */
  sidePoint() {
    const b = this.f.body;
    return toWorld(b, [0, b.hull.sheer(0), b.hull.B / 2 + 0.5]);
  }

  /** X: no ejection seat in a rowing boat. */
  eject() {
    this.walk.say('Shift+E to go over the side', 2);
  }

  /** E: ashore if there is land by its side; Shift+E (or nothing near): over the side. */
  tryExit(overSide = false) {
    const b = this.f.body;
    if (!overSide) {
      const land = this.landNear(toWorld(b, [0, b.hull.sheer(0), 0]), b.hull.B / 2 + 2.2);
      if (!land) return this.walk.say('No land within reach: row in to the shore (Shift+E: over the side)', 3);
      return this.end(null, land);
    }
    this.end('Over the side, into the water', this.sidePoint());
  }

  end(msg, at) {
    this.dispose();
    this.walk.endFlight(msg, [at[0], at[1], at[2]]);
  }

  dispose() {
    if (this.done) return;
    this.done = true;
    this.hud.remove();
    leaveSeat(this.f, this.me);
  }
}
