/**
 * A cup of tea (models/teaCup.js) as one lump of heat: the tea and the porcelain round it.
 *
 * What it loses (W), to the air in the cell round it (the evaporation's heat goes with the
 * vapour):
 *  - convection from its side and its open top: natural (a hot cup in still air,
 *    h ≈ 1.4·(ΔT/L)^¼ ≈ 8 W/m²K) or forced by the wind (h ≈ 3.9·√(v/D)), whichever is more;
 *  - radiation (ε ≈ 0.93) to what is round it at the air's temperature;
 *  - evaporation from the tea's surface, which is most of it while the tea is hot: by the
 *    heat/mass-transfer analogy (Lewis), h_m = h / (ρ·c_p·Le^⅔), driven by the vapour
 *    density at the surface (saturated at the tea's temperature) over that in the air.
 * What it gains: the infrared of a fire nearby; air hotter than it.
 *
 * 250 ml at 85 °C in 15 °C still air loses ~2 K a minute at first and is ~60 °C after a
 * quarter of an hour; at −4 °C with a breeze it cools faster. At 0 °C it stops cooling
 * while it freezes (334 kJ/kg), then the ice cools on. The vapour it gives off
 * (`cup.vapour`, kg/s) is the steam you see (render/tea.js): it condenses in the cold air.
 *
 * Where the table under it burns away it falls; it breaks if it falls far or a blast hits
 * it. The tea is then spilt.
 */
export const TEA = {
  r: 0.038, // inner radius (m)
  H: 0.085, // cup height (m)
  cupC: 260, // J/K: ~0.3 kg of porcelain
  cW: 4186, // J/(kg·K) water
  cI: 2100, // ice
  latent: 334e3, // J/kg to freeze
  eps: 0.93,
};
const SIGMA = 5.67e-8;

/** Saturation vapour density (kg/m³) at T °C (Magnus; over ice below 0). */
export function satVapour(T) {
  const e = T >= 0 ? 611.2 * Math.exp((17.67 * T) / (T + 243.5)) : 611.2 * Math.exp((22.46 * T) / (T + 272.62));
  return e / (461.5 * (T + 273.15));
}

/**
 * Heat flows of a cup (W, positive: lost) at tea temperature T in air Ta with relative
 * humidity RH, wind v (m/s) and fire radiation q (W/m²). { conv, rad, evap, vapour (kg/s) }.
 */
export function cupLosses(cup, Ta, RH, v, q = 0) {
  const { r, H, eps } = TEA;
  const D = 2 * (r + 0.004);
  const Atop = Math.PI * r * r;
  const Aside = Math.PI * D * H;
  const T = cup.T;
  const dT = T - Ta;
  const nat = (L) => 1.4 * Math.pow(Math.abs(dT) / L, 0.25);
  const forced = 3.9 * Math.sqrt(Math.max(0, v) / D);
  const comb = (a, b) => Math.cbrt(a * a * a + b * b * b);
  const hs = comb(nat(H), forced);
  const ht = comb(nat(D), forced * 0.8);
  const conv = (hs * Aside + ht * Atop) * dT;
  const rad = eps * SIGMA * (Math.pow(T + 273.15, 4) - Math.pow(Ta + 273.15, 4)) * (Aside + Atop) - 0.9 * q * (Aside * 0.5 + Atop * 0.3);
  // evaporation from the surface (none from ice worth counting at these rates: sublimation
  // is driven the same way, it is just very slow in the cold)
  const hm = ht / (1.2 * 1005 * 0.9);
  const vapour = Math.max(0, hm * Atop * (satVapour(T) - RH * satVapour(Ta)));
  const evap = vapour * (2.501e6 - 2370 * Math.max(0, T));
  return { conv, rad, evap, vapour };
}

/**
 * Advance one cup by dt (s) in air Ta etc. Changes cup.T, cup.m (liquid), cup.ice (kg
 * frozen); sets cup.vapour. Returns the heat it gave the air (J).
 */
export function stepCup(cup, dt, Ta, RH, v, q = 0) {
  if (cup.broken || cup.m + (cup.ice ?? 0) <= 0) {
    cup.vapour = 0;
    return 0;
  }
  cup.ice ??= 0;
  // (substeps: a fire's heat can make it change fast)
  const n = Math.max(1, Math.ceil(dt / 5));
  const h = dt / n;
  let toAir = 0;
  for (let k = 0; k < n; k++) {
    const L = cupLosses(cup, Ta, RH, v, q);
    let Q = (L.conv + L.rad + L.evap) * h; // J lost this substep
    toAir += (L.conv + L.rad) * h;
    // the vapour leaves the liquid
    const dm = Math.min(cup.m, L.vapour * h);
    cup.m -= dm;
    cup.vapour = L.vapour;
    // freezing / thawing at 0 °C: the latent heat first
    if (Q > 0 && cup.T <= 0 && cup.m > 0) {
      const f = Math.min(cup.m, Q / TEA.latent);
      cup.m -= f;
      cup.ice += f;
      Q -= f * TEA.latent;
      cup.T = 0;
    } else if (Q < 0 && cup.T >= 0 && cup.ice > 0) {
      const f = Math.min(cup.ice, -Q / TEA.latent);
      cup.ice -= f;
      cup.m += f;
      Q += f * TEA.latent;
      cup.T = 0;
    }
    const C = TEA.cupC + cup.m * TEA.cW + cup.ice * TEA.cI;
    let T = cup.T - Q / C;
    // (liquid tea does not cool below freezing, nor ice warm above it, without the latent heat)
    if (cup.m > 0 && cup.T >= 0 && T < 0) T = 0;
    if (cup.ice > 0 && cup.T <= 0 && T > 0) T = 0;
    // (it boils at 100 °C: what more it gets goes into vapour)
    if (T > 100) {
      const boil = Math.min(cup.m, ((T - 100) * C) / 2.257e6);
      cup.m -= boil;
      cup.vapour += boil / h;
      T = 100;
    }
    cup.T = T;
  }
  return toAir;
}

/** All the cups in the scene: their air, their heat, what holds them up. */
export function stepCups(sim, dt, D) {
  const w = sim.world;
  if (!w.cups?.length) return;
  for (w.cupEvents ??= w.events.length; w.cupEvents < w.events.length; w.cupEvents++) {
    const e = w.events[w.cupEvents];
    if (e.type !== 'explosion') continue;
    for (const c of w.cups) if (!c.broken && Math.hypot(c.p[0] - e.pos[0], c.p[1] - e.pos[1], c.p[2] - e.pos[2]) < Math.max(1.5, (e.radius ?? 1) * 1.2)) smash(c);
  }
  for (const c of w.cups) {
    if (c.broken) continue;
    // what it stands on: gone (burnt, blown away), it falls to what is under that
    const below = w.voxelAt(c.p[0], c.p[1] - w.h * 0.5, c.p[2]);
    if (below < 0 || !w.mat[below]) {
      let y = c.p[1] - w.h;
      while (y > 0) {
        const i = w.voxelAt(c.p[0], y - w.h * 0.5, c.p[2]);
        if (i >= 0 && w.mat[i]) break;
        y -= w.h;
      }
      const drop = c.p[1] - Math.max(0, y);
      c.p[1] = Math.max(0, y);
      if (drop > 0.4) smash(c);
      if (c.broken) continue;
    }
    const a = sim.airCellAt(c.p[0], c.p[1] + 0.05, c.p[2]);
    if (a < 0) continue;
    const Ta = w.airT[a];
    const v = Math.hypot(w.vx[a], w.vz[a], w.vy?.[a] ?? 0);
    const q = w.radField?.[a] ?? 0;
    const E = stepCup(c, dt, Ta, D.rh, v, q);
    if (dt > 0) w.airQ[a] += E / dt;
  }
}

function smash(c) {
  c.broken = true;
  c.m = 0;
  c.ice = 0;
  c.vapour = 0;
}
