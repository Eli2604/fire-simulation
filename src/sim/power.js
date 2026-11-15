import { SUN_PEAK } from './weather.js';

/**
 * Electric power off the grid: a wind turbine and a solar park feeding a camp (models/windTurbine.js,
 * models/solarPark.js, models/droneCamp.js). Plain numbers, no three.js: the renderer reads the
 * state it leaves on the world (render/campPower.js).
 *
 *  - Wind turbine (world.generators, kind 'wind'): the wind at the hub from the weather's wind at
 *    2 m by the power law (shear exponent 1/7). Below cut-in it idles (the blades turn slowly or
 *    not at all); from cut-in to rated the power is ½ρAv³·Cp (Cp ≈ 0.42, drivetrain ~0.92),
 *    capped at its rating; at cut-out (a storm) the blades are feathered and the rotor braked to a
 *    stop, and it starts again only once the wind is back below a lower restart speed
 *    (hysteresis, as real turbines do). The rotor runs at a tip-speed ratio of ~6.5 up to its
 *    rated speed, with inertia (it spins up and down over seconds). It yaws into the wind at a
 *    few degrees a second; while it is turned off the wind it loses power as cos³ of the error.
 *    Its nacelle a voxel (`check`): blown off or burnt out, it makes nothing.
 *  - Solar park (kind 'solar'): every panel facing its normal, the sun's beam on it (cos of the
 *    angle of incidence) plus the sky's diffuse light (by its tilt), from the weather's sunlight
 *    on level ground (sim/weather.js: the season's sun through the clouds, rain, fog) and how
 *    high the sun is. Hot cells lose 0.4 %/K; the inverter ~96 %. A panel whose voxel is gone
 *    (a blast, a fire) gives nothing; the inverter container gone, nothing at all. A battery in
 *    the container evens it out (charged from the surplus, ~95 % in, 5 kW at most either way).
 *  - Grids (world.power[name]): what the generators of a grid make against what its loads take
 *    (world.loads: a camp's operations, its lights). Short of power, the lights go first, then
 *    the operations (monitors, radios): dark.
 *
 * The sun: a time-of-day sky (sim/sky.js) may give its direction; read defensively (sunNow):
 * otherwise a midday sun of the season, a little east of south.
 */

const RHO = 1.225; // kg/m³ air
const SHEAR = 1 / 7; // wind profile power law
const TSR = 6.5; // tip-speed ratio in the power-optimal range
const CP = 0.42;
const DRIVE = 0.92; // gearbox, generator, converter
const BAT_RATE = 5000; // W the battery gives or takes at most
const BAT_IN = 0.95; // charging efficiency

/** The wind at hub height from the wind at 2 m (the weather's), by the power law. */
export function hubWind(v2, hub) {
  return Math.max(0, v2) * Math.pow(Math.max(2, hub) / 2, SHEAR);
}

/** A turbine's electric power (W) in a steady wind v at the hub (m/s), facing it. */
export function turbinePower(v, g) {
  if (v < g.cutIn || v >= g.cutOut) return 0;
  const A = Math.PI * g.R * g.R;
  return Math.min(g.rated, 0.5 * RHO * A * CP * DRIVE * v * v * v);
}

/** The rotor's rated speed (rad/s): the tip-speed ratio at the rated wind. */
export function ratedOmega(g) {
  return (TSR * g.ratedWind) / g.R;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One step of a wind turbine: yaw, the cut-out state, the rotor speed and angle, its output.
 * weather: { windSpeed (m/s at 2 m), windDir (degrees, the way it blows towards) }.
 */
export function stepTurbine(g, weather, dt, intact = true) {
  const v = hubWind(weather.windSpeed ?? 0, g.hub);
  g.wind = v;
  // the rotor faces the wind: it looks the way the wind comes from (yaw: the direction the
  // rotor faces, radians in the x-z plane, 0 = +x)
  const want = Math.atan2(-Math.sin(((weather.windDir ?? 0) * Math.PI) / 180), -Math.cos(((weather.windDir ?? 0) * Math.PI) / 180));
  g.yaw ??= want;
  const err = wrap(want - g.yaw);
  const turn = ((g.yawRate ?? 6) * Math.PI) / 180 * dt;
  if (v > 0.5 && intact) g.yaw = wrap(g.yaw + Math.max(-turn, Math.min(turn, err)));
  const left = wrap(want - g.yaw);
  // cut out above cut-out; back on below the restart speed
  if (!intact) g.state = 'broken';
  else if (v >= g.cutOut) g.state = 'cutOut';
  else if (g.state === 'cutOut' && v > g.restart) g.state = 'cutOut';
  else g.state = v >= g.cutIn ? 'running' : 'idle';
  const facing = Math.max(0, Math.cos(left));
  // the speed it goes towards: the tip-speed ratio up to rated; idling it barely turns; feathered
  // and braked it stops
  const wr = ratedOmega(g);
  let target = 0;
  if (g.state === 'running') target = Math.min(wr, (TSR * v * facing) / g.R);
  else if (g.state === 'idle') target = v > 1.5 ? (0.6 * v * facing) / g.R : 0; // (feathered: a slow turn)
  const tau = g.state === 'cutOut' || g.state === 'broken' ? 3 : 5;
  g.omega = (g.omega ?? 0) + (target - (g.omega ?? 0)) * Math.min(1, dt / tau);
  if (g.omega < 1e-3 && target === 0) g.omega = 0;
  g.angle = ((g.angle ?? 0) + g.omega * dt) % (Math.PI * 2);
  // the power: of the wind across the rotor (cos³ of the yaw error), as far as it has spun up
  const spun = wr > 0 ? Math.min(1, g.omega / Math.min(wr, (TSR * Math.max(v, g.cutIn)) / g.R)) : 0;
  g.output = g.state === 'running' ? turbinePower(v * facing, g) * Math.min(1, spun * spun) : 0;
  return g.output;
}

/**
 * Where the sun is (a unit vector towards it, y up) and whether that is known. A time-of-day sky
 * (sim/sky.js, another branch) may put it on the simulation, the world or the weather; otherwise
 * a midday sun of the season from a little east of south (+z is south, +x east in these worlds).
 */
export function sunNow(sim) {
  const W = sim?.weather ?? {};
  const cands = [sim?.sky?.sunDir, sim?.sky?.sun?.dir, sim?.sky?.sun, sim?.sunDir, sim?.world?.sunDir, W.sunDir];
  for (const c of cands) {
    const v = Array.isArray(c) ? c : c && typeof c === 'object' && 'x' in c ? [c.x, c.y, c.z] : null;
    if (v && v.length === 3 && v.every(Number.isFinite)) {
      const l = Math.hypot(...v);
      if (l > 1e-6) return { dir: v.map((x) => x / l), known: true };
    }
  }
  // an hour of the day (0..24) in the weather: a sun on its arc (a mid latitude, ~52° N)
  const hour = [W.timeOfDay, W.hour, W.time].find((x) => typeof x === 'number' && Number.isFinite(x));
  const decl = { spring: 0, summer: 23.4, autumn: 0, winter: -23.4 }[W.season] ?? 10;
  const lat = 52;
  const d = Math.PI / 180;
  if (hour !== undefined) {
    const H = (hour - 12) * 15 * d; // hour angle
    const sinE = Math.sin(lat * d) * Math.sin(decl * d) + Math.cos(lat * d) * Math.cos(decl * d) * Math.cos(H);
    const e = Math.asin(Math.max(-1, Math.min(1, sinE)));
    // azimuth from the south, west positive
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat * d) - Math.tan(decl * d) * Math.cos(lat * d));
    // south +z, east +x (west -x)
    return { dir: [-Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az)], known: true };
  }
  const e = (90 - lat + decl) * d;
  const az = -20 * d; // a little east of south (late morning)
  return { dir: [-Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az)], known: false };
}

/** How high the season's midday sun stands (rad): what the weather's sunlight is for. */
function noonElevation(season) {
  const decl = { spring: 0, summer: 23.4, autumn: 0, winter: -23.4 }[season] ?? 10;
  return ((90 - 52 + decl) * Math.PI) / 180;
}

/**
 * The sunlight on a panel (W/m²) facing `n` (unit), the sun towards `sun` (unit), `ghi` the
 * light on level ground at the season's midday (the weather's), `clear` 0..1 how much of it is
 * the direct beam (the sunshine setting), `season` for how high its midday sun stands.
 */
export function panelIrradiance(n, sun, ghi, clear = 1, season = 'summer') {
  const e = Math.asin(Math.max(-1, Math.min(1, sun[1])));
  if (e <= 0.01) return 0; // the sun down
  // the light on level ground now: the midday's, by how high the sun is (air mass)
  const k = Math.pow(Math.sin(e), 1.15) / Math.pow(Math.sin(noonElevation(season)), 1.15);
  const g = ghi * Math.min(1.25, k);
  const diffuseShare = Math.min(1, 0.15 + 0.75 * (1 - Math.max(0, Math.min(1, clear))));
  const beamH = g * (1 - diffuseShare);
  const dni = beamH / Math.max(0.09, Math.sin(e)); // (the beam across its own path)
  const cosI = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
  const sky = g * diffuseShare * (1 + n[1]) / 2; // the sky the panel sees (isotropic)
  return dni * cosI + sky;
}

/** A solar park's output (W): its panels' share of the light, warm cells losing, the inverter. */
export function solarOutput(s, sun, D, weather) {
  const G = panelIrradiance(s.n, sun, D.solar ?? 0, weather.sunshine ?? 1, weather.season);
  // the cells over the air: ~25 K above it in full sun, less in the wind
  const cell = (weather.ambient ?? 15) + (G / 800) * 25 / (1 + 0.15 * (weather.windSpeed ?? 0));
  const temp = 1 - 0.004 * (cell - 25);
  return Math.max(0, s.peak * (s.alive ?? s.panels) * (G / 1000) * temp * 0.96);
}

const isSolid = (w, p) => {
  if (!p) return true;
  const i = w.voxelAt(p[0], p[1], p[2]);
  return i >= 0 && w.mat[i] !== 0;
};

/** The grid named `name` of a world (made on first use). */
export function gridOf(w, name) {
  w.power ??= {};
  return (w.power[name] ??= { name, gen: 0, wind: 0, solar: 0, load: 0, demand: 0, soc: 0, capacity: 0, ops: true, lights: true, short: false });
}

/**
 * The generators and loads of a world, one step (the simulation calls it with the heat and air
 * steps; the weather is the live one). Leaves on each generator its output, on each grid what it
 * makes and takes, its battery, and whether the camp's operations and lights have power.
 */
export function stepPower(sim, dt, D) {
  const w = sim.world;
  const gens = w.generators;
  if (!gens?.length && !w.loads?.length) return;
  const W = sim.weather ?? {};
  const sun = sunNow(sim);
  const night = sun.dir[1] < 0.05;
  for (const grid of Object.values(w.power ?? {})) grid.gen = grid.wind = grid.solar = grid.load = grid.demand = grid.opsDemand = grid.lightsDemand = 0;
  for (const g of gens ?? []) {
    const grid = gridOf(w, g.grid ?? 'camp');
    // (a part blown off or burnt away: the nacelle, the inverter)
    const intact = isSolid(w, g.check);
    if (g.kind === 'wind') {
      stepTurbine(g, W, dt, intact);
      grid.wind += g.output;
    } else if (g.kind === 'solar') {
      if (g.panelChecks && ((g.checkT = (g.checkT ?? 0) - dt) <= 0)) {
        g.checkT = 1; // (the panels counted again once a second)
        g.alive = g.panelChecks.filter((p) => isSolid(w, p)).length;
        g.dead = g.panelChecks.map((p) => !isSolid(w, p));
      }
      g.output = intact ? solarOutput(g, sun.dir, D ?? {}, W) : 0;
      g.state = intact ? (g.output > 1 ? 'producing' : 'idle') : 'broken';
      grid.solar += g.output;
      // the battery in its container
      if (g.battery > 0 && !g.batteryIn) {
        g.batteryIn = true;
        grid.capacity += g.battery * 3.6e6;
        grid.soc += (g.charge ?? 1) * g.battery * 3.6e6;
      }
      // (the container gone: its battery with it)
      if (!intact && g.batteryIn && !g.batteryLost) {
        g.batteryLost = true;
        const share = g.battery * 3.6e6;
        grid.soc = Math.max(0, grid.soc - (share / Math.max(grid.capacity, 1)) * grid.soc);
        grid.capacity = Math.max(0, grid.capacity - share);
      }
    }
    grid.gen += g.output ?? 0;
  }
  for (const L of w.loads ?? []) {
    const grid = gridOf(w, L.grid ?? 'camp');
    L.wantLights = night ? L.lights : 0;
    grid.demand += L.ops + L.wantLights;
    grid.opsDemand = (grid.opsDemand ?? 0) + L.ops;
    grid.lightsDemand = (grid.lightsDemand ?? 0) + L.wantLights;
  }
  for (const grid of Object.values(w.power ?? {})) {
    const bat = grid.capacity > 0 ? Math.min(BAT_RATE, grid.soc / Math.max(dt, 1e-3)) : 0;
    const avail = grid.gen + bat;
    const ops = grid.opsDemand ?? 0;
    const lights = grid.lightsDemand ?? 0;
    // short of power the lights go first, then the operations
    grid.ops = ops <= 0 || avail >= ops * 0.999;
    grid.lights = grid.ops && (lights <= 0 || avail >= (ops + lights) * 0.999);
    grid.load = (grid.ops ? ops : 0) + (grid.lights ? lights : 0);
    const net = grid.gen - grid.load; // W: + into the battery, - out of it
    if (grid.capacity > 0) grid.soc = Math.max(0, Math.min(grid.capacity, grid.soc + (net > 0 ? Math.min(net, BAT_RATE) * BAT_IN : Math.max(net, -BAT_RATE)) * dt));
    grid.short = grid.demand > 0 && !(grid.ops && grid.lights);
    grid.night = night;
  }
  for (const L of w.loads ?? []) {
    const grid = gridOf(w, L.grid ?? 'camp');
    L.powered = grid.ops;
    L.lit = grid.lights && night;
  }
}
