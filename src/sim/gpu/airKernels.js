/**
 * WGSL compute kernels of the air model: sim/air.js stepAir and blurRadiation, cell by cell,
 * on the buffer layout of sim/gpu/airLayout.js. One invocation per air cell.
 *
 * Kept line for line with the CPU code (same discretisation, same constants, same boundary
 * handling) and with the JS emulation in sim/gpu/airEmulation.js, which the tests compare with
 * the CPU solver. A change to the air model's math needs the same change in all three:
 * test/gpuAir.test.js fails until it has been made.
 *
 *   velocity   air.js step 1 (buoyancy, entrainment, ceiling jet, wind, turbulence, faces)
 *   advect     step 2 (semi-Lagrangian, trilinear, open boundaries bring ambient air)
 *   mixHeat    steps 3 + 4 + 5 fused (each only touches its own cell after the advection):
 *              mixing through open faces, weather decay, implicit heat exchange with the
 *              solids, sources, burning gas and flame presence
 *   radiation  blurRadiation: separable box blur (two passes per axis), gain, black-body cap
 */

export const WORKGROUP = 64;

const HEADER = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, nz: u32, na: u32,
  sxy: u32, flags: u32, radR: u32, pad0: u32,
  oTx: u32, oTx2: u32, oTy: u32, oTz: u32,
  oTz2: u32, oWx: u32, oWz: u32, oBuoy: u32,
  tamb: f32, ah: f32, inv: f32, dt: f32,
  windTurb: f32, turbAmp: f32, o2b: f32, alpha: f32,
  fireMix: f32, relaxT: f32, smokeKeep: f32, steamKeep: f32,
  fgasKeep: f32, suppKeep: f32, flameRefJ: f32, ah3: f32,
  radGain: f32, radInv: f32, pad1: f32, pad2: f32,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> fields: array<f32>;
@group(0) @binding(2) var<storage, read_write> tmp: array<f32>;
@group(0) @binding(3) var<storage, read> geom: array<f32>;
@group(0) @binding(4) var<storage, read> src: array<f32>;
@group(0) @binding(5) var<storage, read_write> rad: array<f32>;
@group(0) @binding(6) var<storage, read> tables: array<f32>;

// fields
const F_T = 0u; const F_S = 1u; const F_R = 2u; const F_G = 3u; const F_B = 4u;
const F_W = 5u; const F_FG = 6u; const F_X = 7u; const F_O = 8u; const F_FLAME = 9u;
const F_VX = 10u; const F_VY = 11u; const F_VZ = 12u;
const N_ADV = 9u;
// geom
const G_OCC = 0u; const G_PX = 1u; const G_PY = 2u; const G_PZ = 3u;
const G_CAPPED = 4u; const G_SHELTER = 5u; const G_AWAKE = 6u; const G_SUCK = 7u;
// src
const S_G = 0u; const S_GT = 1u; const S_Q = 2u; const S_FACC = 3u; const S_RAD = 4u;
const FLAG_AWAKE = 1u; const FLAG_SUCK = 2u;

// sim/air.js
const CP_AIR = 1005.0;
const MAX_AIR_T = 1250.0;
const CEILING_JET = 0.006;
const ENTRAIN = 0.0005;
const FILL = 0.004;
const MAX_IRRADIANCE = 200e3;

fn cell(gid: vec3u, nwg: vec3u) -> u32 { return gid.x + gid.y * nwg.x * ${WORKGROUP}u; }
fn fv(k: u32, a: u32) -> f32 { return fields[k * P.na + a]; }
fn gv(k: u32, a: u32) -> f32 { return geom[k * P.na + a]; }
fn asleep(a: u32) -> bool { return (P.flags & FLAG_AWAKE) != 0u && geom[G_AWAKE * P.na + a] == 0.0; }
`;

const VELOCITY = /* wgsl */ `
@compute @workgroup_size(${WORKGROUP})
fn velocity(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let a = cell(gid, nwg);
  let NA = P.na;
  if (a >= NA) { return; }
  if (asleep(a)) {
    fields[F_VX * NA + a] = 0.0;
    fields[F_VY * NA + a] = 0.0;
    fields[F_VZ * NA + a] = 0.0;
    return;
  }
  let ax = a % P.nx;
  let ay = (a / P.nx) % P.ny;
  let az = a / P.sxy;
  let T = fields[a];
  let dT = T - P.tamb;
  let pY = gv(G_PY, a);
  let capped = gv(G_CAPPED, a) != 0.0;
  let notTop = ay + 1u < P.ny;
  // in a stratified layer under a ceiling, gas only rises if it is hotter than the gas above it
  var dTb = dT;
  if (capped && notTop && pY > 0.5) { dTb = T - max(P.tamb, fields[a + P.nx]); }
  var up = 0.0;
  if (dTb > 0.0) { up = tables[P.oBuoy + ay] * sqrt(dTb / (T + 273.15)); }
  if (up > 6.0) { up = 6.0; }
  let open = 1.0 - gv(G_OCC, a);
  let o2 = open * open;
  let fl = fv(F_FLAME, a);
  let tb = P.turbAmp * (1.0 + fl * 2.0);
  // entrainment
  var xp = T; if (ax + 1u < P.nx) { xp = fields[a + 1u]; }
  var xm = T; if (ax > 0u) { xm = fields[a - 1u]; }
  var zp = T; if (az + 1u < P.nz) { zp = fields[a + P.sxy]; }
  var zm = T; if (az > 0u) { zm = fields[a - P.sxy]; }
  let gx = xp - xm;
  let gz = zp - zm;
  var ex = ENTRAIN * gx;
  var ez = ENTRAIN * gz;
  // ceiling jet
  if (dT > 20.0 && notTop && pY < 0.5) {
    ex = -CEILING_JET * gx;
    ez = -CEILING_JET * gz;
  }
  if (ex > 1.5) { ex = 1.5; } else if (ex < -1.5) { ex = -1.5; }
  if (ez > 1.5) { ez = 1.5; } else if (ez < -1.5) { ez = -1.5; }
  let sw = gv(G_SHELTER, a);
  let tbw = (P.turbAmp - P.windTurb * (1.0 - sw)) * (1.0 + fl * 2.0);
  let txv = tables[P.oTx + ax];
  let tx2v = tables[P.oTx2 + ax];
  let tyv = tables[P.oTy + ay];
  let tzv = tables[P.oTz + az];
  let tz2v = tables[P.oTz2 + az];
  var u = (tables[P.oWx + ay] * sw + ex + tbw * (txv * tzv * 0.6 + tyv * 0.4)) * o2;
  if (u > 0.0) { if (ax > 0u) { u = u * gv(G_PX, a - 1u); } } else { u = u * gv(G_PX, a); }
  var q = (tables[P.oWz + ay] * sw + ez + tbw * (tz2v * tx2v * 0.6 - tyv * 0.4)) * o2;
  if (q > 0.0) { if (az > 0u) { q = q * gv(G_PZ, a - P.sxy); } } else { q = q * gv(G_PZ, a); }
  var v = (up + tb * 0.5 * tx2v * tyv) * open;
  if (v > 0.0) { if (ay > 0u) { v = v * gv(G_PY, a - P.nx); } } else { v = v * pY; }
  if (v > 0.0 && notTop && pY < 0.25) { v = v * (pY * 4.0); }
  if (capped && notTop && pY > 0.5) {
    let above = fields[a + P.nx] - T;
    if (above > 2.0) {
      var d = FILL * above;
      if (d > 0.12) { d = 0.12; }
      v = v - d;
    }
  }
  if (ay == 0u && v < 0.0) { v = 0.0; }
  if ((P.flags & FLAG_SUCK) != 0u) {
    let s = G_SUCK * NA + a * 3u;
    u = u + geom[s];
    v = v + geom[s + 1u];
    q = q + geom[s + 2u];
  }
  fields[F_VX * NA + a] = u;
  fields[F_VY * NA + a] = v;
  fields[F_VZ * NA + a] = q;
}
`;

const ADVECT = /* wgsl */ `
@compute @workgroup_size(${WORKGROUP})
fn advect(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let a = cell(gid, nwg);
  let NA = P.na;
  if (a >= NA) { return; }
  if (asleep(a)) {
    for (var k = 0u; k < N_ADV; k++) { tmp[k * NA + a] = fields[k * NA + a]; }
    return;
  }
  let ax = a % P.nx;
  let ay = (a / P.nx) % P.ny;
  let az = a / P.sxy;
  var px = f32(ax) - fv(F_VX, a) * P.inv;
  var py = f32(ay) - fv(F_VY, a) * P.inv;
  var pz = f32(az) - fv(F_VZ, a) * P.inv;
  let fnx = f32(P.nx);
  let fny = f32(P.ny);
  let fnz = f32(P.nz);
  if (px < -0.5 || pz < -0.5 || px > fnx - 0.5 || pz > fnz - 0.5 || py > fny - 0.5) {
    tmp[F_T * NA + a] = P.tamb;
    for (var k = 1u; k < F_O; k++) { tmp[k * NA + a] = 0.0; }
    tmp[F_O * NA + a] = P.o2b; // fresh air from outside the domain (none in space)
    return;
  }
  if (px < 0.0) { px = 0.0; } else if (px > fnx - 1.0) { px = fnx - 1.0; }
  if (py < 0.0) { py = 0.0; } else if (py > fny - 1.0) { py = fny - 1.0; }
  if (pz < 0.0) { pz = 0.0; } else if (pz > fnz - 1.0) { pz = fnz - 1.0; }
  let x0 = u32(px);
  let y0 = u32(py);
  let z0 = u32(pz);
  let dx = select(0u, 1u, x0 + 1u < P.nx);
  let dy = select(0u, P.nx, y0 + 1u < P.ny);
  let dz = select(0u, P.sxy, z0 + 1u < P.nz);
  let fx = px - f32(x0);
  let fy = py - f32(y0);
  let fz = pz - f32(z0);
  let i0 = x0 + P.nx * y0 + P.sxy * z0;
  let i1 = i0 + dx;
  let i2 = i0 + dy;
  let i3 = i2 + dx;
  let i4 = i0 + dz;
  let i5 = i4 + dx;
  let i6 = i4 + dy;
  let i7 = i6 + dx;
  let gx = 1.0 - fx;
  let gy = 1.0 - fy;
  let gz = 1.0 - fz;
  let w0 = gx * gy * gz;
  let w1 = fx * gy * gz;
  let w2 = gx * fy * gz;
  let w3 = fx * fy * gz;
  let w4 = gx * gy * fz;
  let w5 = fx * gy * fz;
  let w6 = gx * fy * fz;
  let w7 = fx * fy * fz;
  for (var k = 0u; k < N_ADV; k++) {
    let o = k * NA;
    tmp[o + a] = fields[o + i0] * w0 + fields[o + i1] * w1 + fields[o + i2] * w2 + fields[o + i3] * w3
      + fields[o + i4] * w4 + fields[o + i5] * w5 + fields[o + i6] * w6 + fields[o + i7] * w7;
  }
}
`;

const MIX_HEAT = /* wgsl */ `
struct Faces { xm: i32, xp: i32, ym: i32, yp: i32, zm: i32, zp: i32, p0: f32, p1: f32, p2: f32, p3: f32, p4: f32, p5: f32 }

fn nb(k: u32, i: i32, b: f32) -> f32 {
  if (i < 0) { return b; }
  return tmp[k * P.na + u32(i)];
}

// air.js lap(): mixing with the six neighbours through the open part of each face
fn lap(k: u32, a: u32, f: Faces, b: f32, kk: f32) -> f32 {
  let c = tmp[k * P.na + a];
  let sum = (nb(k, f.xm, b) - c) * f.p0 + (nb(k, f.xp, b) - c) * f.p1 + (nb(k, f.ym, b) - c) * f.p2
    + (nb(k, f.yp, b) - c) * f.p3 + (nb(k, f.zm, b) - c) * f.p4 + (nb(k, f.zp, b) - c) * f.p5;
  return c + kk * sum;
}

@compute @workgroup_size(${WORKGROUP})
fn mixHeat(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let a = cell(gid, nwg);
  let NA = P.na;
  if (a >= NA) { return; }
  let sleeping = asleep(a);
  let occ = gv(G_OCC, a);
  if (!sleeping) {
    let ax = a % P.nx;
    let ay = (a / P.nx) % P.ny;
    let az = a / P.sxy;
    let ia = i32(a);
    var f: Faces;
    // neighbour indices; open boundaries mix with ambient (-1), the ground is closed
    f.xm = select(-1, ia - 1, ax > 0u);
    f.xp = select(-1, ia + 1, ax + 1u < P.nx);
    f.ym = select(ia, ia - i32(P.nx), ay > 0u);
    f.yp = select(-1, ia + i32(P.nx), ay + 1u < P.ny);
    f.zm = select(-1, ia - i32(P.sxy), az > 0u);
    f.zp = select(-1, ia + i32(P.sxy), az + 1u < P.nz);
    // mixing only through open faces
    f.p0 = 1.0; if (ax > 0u) { f.p0 = gv(G_PX, a - 1u); }
    f.p1 = gv(G_PX, a);
    f.p2 = 1.0; if (ay > 0u) { f.p2 = gv(G_PY, a - P.nx); }
    f.p3 = gv(G_PY, a);
    f.p4 = 1.0; if (az > 0u) { f.p4 = gv(G_PZ, a - P.sxy); }
    f.p5 = gv(G_PZ, a);
    let k = P.alpha * (1.0 - occ * 0.8);
    let dTk = tmp[F_T * NA + a] - P.tamb;
    var T = lap(F_T, a, f, P.tamb, k);
    T = T + (P.tamb - T) * P.relaxT;
    fields[F_T * NA + a] = T;
    var sm = lap(F_S, a, f, 0.0, k) * P.smokeKeep;
    var sr = lap(F_R, a, f, 0.0, k) * P.smokeKeep;
    var sg = lap(F_G, a, f, 0.0, k) * P.smokeKeep;
    var sb = lap(F_B, a, f, 0.0, k) * P.smokeKeep;
    var st = lap(F_W, a, f, 0.0, k) * P.steamKeep;
    // a fire is turbulent: its flames and hot gas stir fresh air in from all around
    var kf = k;
    if (dTk > 0.0) {
      let fl = fv(F_FLAME, a);
      var m = 1.0;
      if (fl <= 0.5) {
        var hot = dTk / 600.0;
        if (dTk > 300.0) { hot = 0.5; }
        m = fl * 2.0 + hot;
      }
      kf = kf + P.fireMix * m;
      if (kf > 0.16) { kf = 0.16; }
    }
    fields[F_O * NA + a] = lap(F_O, a, f, P.o2b, kf);
    let sp = lap(F_X, a, f, 0.0, k) * P.suppKeep;
    fields[F_X * NA + a] = sp;
    var inhib = 1.0;
    if (sp > 0.0) { inhib = exp(-6.0 * sp * P.dt); }
    var fg = lap(F_FG, a, f, 0.0, k) * P.fgasKeep * inhib;
    if (fg < 1e-3) { fg = 0.0; } // the last trace of burning gas is gone
    if (sm < 1e-12) { sm = 0.0; sr = 0.0; sg = 0.0; sb = 0.0; }
    if (st < 1e-12) { st = 0.0; }
    fields[F_S * NA + a] = sm;
    fields[F_R * NA + a] = sr;
    fields[F_G * NA + a] = sg;
    fields[F_B * NA + a] = sb;
    fields[F_W * NA + a] = st;
    fields[F_FG * NA + a] = fg;
  }
  // heat exchange with the solids (implicit), sources, flame presence
  let G = src[S_G * NA + a];
  let Q = src[S_Q * NA + a];
  let facc = src[S_FACC * NA + a];
  if (sleeping && Q == 0.0 && G == 0.0 && facc == 0.0) { return; }
  let T = fields[F_T * NA + a];
  let rho = 353.0 / (T + 273.15);
  let Ca = rho * CP_AIR * P.ah3 * (1.0 - 0.9 * occ);
  var Tn = (Ca * T + P.dt * (src[S_GT * NA + a] + Q)) / (Ca + P.dt * G);
  if (Tn > MAX_AIR_T) { Tn = MAX_AIR_T; }
  else if (Tn < P.tamb - 30.0 && Tn < T) { Tn = min(T, P.tamb - 30.0); }
  fields[F_T * NA + a] = Tn;
  let g = fields[F_FG * NA + a] + facc * P.dt;
  fields[F_FG * NA + a] = g;
  var fl = sqrt(g / P.flameRefJ);
  let hot = (Tn - 450.0) / 500.0;
  if (hot > fl) { fl = hot; }
  let sp = fields[F_X * NA + a];
  if (sp > 0.0) { fl = fl * (1.0 - min(1.0, sp)); }
  fields[F_FLAME * NA + a] = clamp(fl, 0.0, 1.0);
}
`;

const RADIATION = /* wgsl */ `
struct Blur { axis: u32, srcIdx: u32, dstIdx: u32, mode: u32 }
@group(1) @binding(0) var<uniform> BP: Blur;

// mode 0: the field from this step's sources; 1: box blur of radius radR along an axis
// (zero outside the grid); 2: gain and the black-body cap
@compute @workgroup_size(${WORKGROUP})
fn radiation(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let a = cell(gid, nwg);
  let NA = P.na;
  if (a >= NA) { return; }
  if (BP.mode == 0u) {
    rad[a] = src[S_RAD * NA + a];
    return;
  }
  if (BP.mode == 2u) {
    let v = rad[a] * P.radGain;
    rad[a] = min(v, MAX_IRRADIANCE);
    return;
  }
  var c: u32; var n: u32; var stride: u32;
  if (BP.axis == 0u) { c = a % P.nx; n = P.nx; stride = 1u; }
  else if (BP.axis == 1u) { c = (a / P.nx) % P.ny; n = P.ny; stride = P.nx; }
  else { c = a / P.sxy; n = P.nz; stride = P.sxy; }
  let r = i32(P.radR);
  let base = BP.srcIdx * NA + a;
  var sum = 0.0;
  for (var t = -r; t <= r; t++) {
    let p = i32(c) + t;
    if (p < 0 || p >= i32(n)) { continue; }
    sum = sum + rad[u32(i32(base) + t * i32(stride))];
  }
  rad[BP.dstIdx * NA + a] = sum * P.radInv;
}
`;

/** The WGSL module with all four entry points: velocity, advect, mixHeat, radiation. */
export const AIR_WGSL = HEADER + VELOCITY + ADVECT + MIX_HEAT + RADIATION;

/**
 * The radiation blur as a list of dispatches { axis, from, to, mode }: the field from the
 * sources, two box passes per axis (x, y, z, x, y, z ping-ponging between RAD 0 and 1, ending
 * in 0), the gain. (air.js blurRadiation: the same passes, copying back after each z.)
 */
export const RAD_PASSES = [
  { axis: 0, from: 0, to: 0, mode: 0 },
  { axis: 0, from: 0, to: 1, mode: 1 },
  { axis: 1, from: 1, to: 0, mode: 1 },
  { axis: 2, from: 0, to: 1, mode: 1 },
  { axis: 0, from: 1, to: 0, mode: 1 },
  { axis: 1, from: 0, to: 1, mode: 1 },
  { axis: 2, from: 1, to: 0, mode: 1 },
  { axis: 0, from: 0, to: 0, mode: 2 },
];

/** Workgroups to dispatch for n cells (2D past the 65535 limit; the kernels flatten it again). */
export function dispatchSize(n, max = 65535) {
  const groups = Math.ceil(n / WORKGROUP);
  const x = Math.min(groups, max);
  return [x, Math.ceil(groups / x)];
}
