/**
 * Soldiers under water: a breath-hold dive (duck under, swim a stretch, come up for air), and
 * diving kit (mask and fins, a closed-circuit oxygen rebreather, a small open-circuit scuba set, a
 * dry bag, lead) carried in the backpack and put on at the water's edge. Pure logic (no three.js):
 * ai/swim.js stepSwim swims the dive each step, ai/squad.js decides when to dive and to gear up,
 * ai/perception.js hides a man under water (and gives away his bubbles), walk/walk.js uses the
 * same breath and gas rules for the player.
 *
 *  - Breath hold (breathHoldCap): 30–90 s from his fitness and his training (experience), less
 *    winded (stamina) or wounded; used up faster the harder he works (diveAbility().effort).
 *  - Under water (diveAbility): his pace (a breaststroke and frog kick, ~0.75 m/s light; with fins
 *    ~1.1 m/s for less effort), his effort and his wind from the load the water feels (waterLoad:
 *    the dry load less what the kit floats off: a worn breathing set, fins, a pack towed in a dry
 *    bag) and his buoyancy (buoyancy: kg, + floats: his lungs, squeezed deeper; steel and plates
 *    sink him; lead too) — heavy he goes down faster and has to work to come up.
 *  - Breathing gas (stepGas): the rebreather's oxygen (~300 l, 1–2.5 l a minute whatever the
 *    depth: some 2–4 h, no bubbles; deeper than O2_DEPTH the oxygen turns toxic: oxTox builds and
 *    at 1 he convulses and loses the mouthpiece), the scuba tank's air (~1400 l, 18–40 l a minute
 *    at the surface × the ambient pressure, 1 + depth/10 bar: deeper, faster; bubbles every breath).
 *  - Seen from above the surface (submergedRange): only as far as the water lets one see into it
 *    (its visibility, WATER_VIS m, and his depth); open-circuit bubbles show where he is from far
 *    off (BUBBLE_RANGE) and burble (BUBBLE_DB).
 *  - Gearing up (gearUpTime, finishGearUp): the kit out of the pack and on (a minute or more), the
 *    weapon sealed in the dry bag and the pack towed in it, else the pack left at the edge.
 */
import { BREATHER, DIVE_FLAT, LEAD, PRIMARY, SIDEARM, GRENADE_KG, applyKit, diveStowage, kitMass, fullKit } from './loadout.js';
import { experienceOf } from './experience.js';

/** m: how far one sees in the water (a river, a harbour 2–6; a clear sea 15–25). */
export const WATER_VIS = 4;
/** m: open-circuit bubbles boiling up at the surface, seen from this far in daylight. */
export const BUBBLE_RANGE = 40;
/** dB at 1 m: the burble of the bubbles at the surface, each breath out. */
export const BUBBLE_DB = 52;
/** m: pure oxygen reaches ppO₂ 1.6 bar here (the limit for a working dive). */
export const O2_DEPTH = 6;
/** m of water he can swim under in (head under, his body clear of the bottom). */
export const DIVE_MIN = 1.6;
/** m: his head this far under counts as submerged. */
export const UNDER = 0.25;
/** His training as a free diver, by experience (0..1). */
const EXP_DIVE = { recruit: 0.1, regular: 0.35, veteran: 0.6, elite: 0.9 };
const c01 = (v, d = 0.5) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** Has he a breathing set on (worn, with gas left, its mouthpiece in)? */
export function hasSet(m) {
  const k = m.kit ?? {};
  if (!k.diveWorn || !k.breather || k.breather === 'none') return false;
  const g = gasOf(m);
  return !!g && !g.lost && g.litres > 0;
}

/**
 * How long he can hold his breath swimming under water (s): 30 s for an unfit recruit to 90 s for a
 * fit, trained man; winded (stamina) down to half; wounded (his health, his wounds, bleeding) less.
 */
export function breathHoldCap(m) {
  const fit = c01(m.fitness);
  const xp = EXP_DIVE[m.skill] ?? EXP_DIVE.regular;
  let s = 30 + 60 * (0.55 * fit + 0.45 * xp);
  s *= 0.5 + 0.5 * c01(m.stamina, 1);
  s *= 0.45 + 0.55 * c01((m.health ?? 100) / 100, 1);
  const n = Object.values(m.wounds ?? {}).reduce((a, v) => a + (Number(v) || 0), 0);
  s /= 1 + 0.15 * n;
  if (m.bleed > 0) s *= 0.8;
  return Math.max(8, s);
}

/** The towed pack: worn diving kit with a dry bag and a pack to tow in it. */
export const towing = (k) => !!(k?.diveWorn && k.drybag && k.pack && k.pack !== 'none');

/**
 * The load (kg) the water feels: his dry load (m.loadKg) less what floats off — a breathing set
 * worn (about neutral), fins, the weapon sealed in the dry bag and the pack towed in it. Without
 * diving kit worn: his dry load (ai/swim.js's rule as it was).
 */
export function waterLoad(m) {
  const k = m.kit ?? {};
  const L = Number.isFinite(m.loadKg) ? m.loadKg : kitMass(k).total;
  if (!k.diveWorn) return L;
  let credit = 0;
  if (k.breather === 'rebreather') credit += BREATHER.rebreather.kg - 0.5;
  if (k.breather === 'scuba') credit += BREATHER.scuba.kg - 1.5;
  if (k.fins) credit += DIVE_FLAT.fins.kg - 0.3;
  if (k.drybag) credit += 0.6 * (PRIMARY[k.primary]?.kg ?? 0) + DIVE_FLAT.drybag.kg;
  if (towing(k)) credit += 0.85 * ({ assault: 4, rucksack: 18 }[k.pack] ?? 0);
  return Math.max(0, L - credit);
}

/**
 * His buoyancy in the water (kg, + floats, − sinks) at a depth (m): his body with a breath in
 * (~+2.5 kg at the surface, the lungs squeezed deeper), what he carries by what each thing is
 * (steel and ceramic sink; a soaked pack's contents a little; a pack towed in a dry bag floats),
 * the scuba tank lighter as its air goes, the lead.
 */
export function buoyancy(m, depth = 0) {
  const k = m.kit ?? {};
  let b = 0.6 + 1.9 / (1 + Math.max(0, depth) / 10);
  const P = PRIMARY[k.primary] ?? PRIMARY.none;
  b -= 0.8 * P.kg * (k.drybag && k.diveWorn ? 0.25 : 1);
  if (P.mag) b -= 0.7 * (k.mags + 1) * P.mag.kg;
  const S = SIDEARM[k.sidearm] ?? SIDEARM.none;
  b -= 0.8 * S.kg + (S.mag ? 0.7 * (k.sideMags + 1) * S.mag.kg : 0);
  for (const g of ['frag', 'smoke', 'flash']) b -= 0.7 * (k[g] ?? 0) * GRENADE_KG[g];
  b -= { none: 0, soft: 0.45, plates: 5.4, heavy: 7.4 }[k.armour] ?? 0;
  if (k.helmet) b -= 0.6;
  if (k.nvg) b -= 0.3;
  b -= { none: 0, handheld: 0.3, manpack: 2.5 }[k.radio] ?? 0;
  b -= { none: 0, ifak: 0.1, bag: 1.5 }[k.medkit] ?? 0;
  if (k.rope) b -= 1;
  if (k.drone) b -= 2;
  if (k.breach) b -= 6;
  if (k.knife) b -= 0.25;
  if (k.torch) b -= 0.1;
  b -= 0.05 * (k.water ?? 0);
  b += towing(k) ? 1 : -({ none: 0, assault: 0.5, rucksack: 4.5 }[k.pack] ?? 0);
  if (k.breather === 'rebreather') b -= 0.5;
  if (k.breather === 'scuba') {
    const g = k.diveWorn ? gasOf(m) : null;
    b += -1.5 + 2.2 * (g ? 1 - g.litres / g.full : 0);
  }
  if (k.fins) b -= 0.3;
  b -= k.weights ?? 0;
  return b;
}

/**
 * Under water: { speed (m/s), effort (1: a man in his clothes swimming a breaststroke under),
 * drain (stamina a second), buoy (kg), fins }. From his load as the water feels it, his buoyancy
 * (either way he works to hold his depth), the drag of what he wears or tows, his fitness.
 */
export function diveAbility(m, depth = 0) {
  const k = m.kit ?? {};
  const F = 0.75 + 0.5 * c01(m.fitness);
  const fins = !!(k.diveWorn && k.fins);
  const L = waterLoad(m);
  const B = buoyancy(m, depth);
  let drag = 1;
  if (k.diveWorn && k.breather === 'scuba') drag *= 0.92;
  if (k.diveWorn && k.breather === 'rebreather') drag *= 0.95;
  if (k.pack === 'rucksack') drag *= towing(k) ? 0.78 : 0.8;
  else if (k.pack === 'assault') drag *= towing(k) ? 0.9 : 0.92;
  const base = fins ? 1.1 : 0.75;
  const speed = Math.max(0.15, base * Math.sqrt(F) * Math.max(0.35, 1 - L / (45 * F)) * drag * (1 - Math.min(0.4, Math.abs(B) / 15)));
  const effort = ((fins ? 0.6 : 1) * (1 + Math.abs(B) / 6) * (1 + L / 40)) / drag;
  return { speed, effort, drain: (0.0035 * effort) / F, buoy: B, fins };
}

/** How fast a held breath goes (× a second at rest): working harder, faster. */
export const breathRate = (effort, moving) => (moving ? 0.55 + 0.45 * effort : 0.55);

/** The depth (m, of his head) he swims at: shallow on a held breath, deeper on a set (a rebreather no deeper than its oxygen allows). */
export function diveDepthFor(m, waterDepth) {
  const k = m.kit ?? {};
  const want = hasSet(m) ? (k.breather === 'rebreather' ? Math.min(4, O2_DEPTH - 1.5) : 4) : 1.6;
  return Math.max(0.6, Math.min(want, waterDepth - 0.6));
}

/** His breathing set's gas: { kind, litres, full, lost } (made the first time it is worn). */
export function gasOf(m) {
  const k = m.kit ?? {};
  if (!k.diveWorn || !k.breather || k.breather === 'none') return null;
  if (!m.diveGas || m.diveGas.kind !== k.breather) {
    const full = k.breather === 'rebreather' ? BREATHER.rebreather.o2 : BREATHER.scuba.air;
    m.diveGas = { kind: k.breather, litres: full, full, lost: false };
  }
  return m.diveGas;
}

/**
 * One step breathing from his set at a depth (m), working (0 still .. ~1.5 hard): the gas used
 * (the rebreather's oxygen by his work alone; the scuba's air × the ambient pressure), oxygen
 * toxicity below O2_DEPTH on the rebreather. Returns { breathing, bubbles, event: 'convulsion' |
 * 'empty' | null, lpm (litres a minute) }.
 */
export function stepGas(m, dt, depth, work = 0.5) {
  const g = gasOf(m);
  if (!g || g.lost || g.litres <= 0) return { breathing: false, bubbles: false, event: null, lpm: 0 };
  const d = Math.max(0, depth);
  let lpm, event = null;
  if (g.kind === 'rebreather') {
    lpm = 1 + 1.2 * work;
    const ppO2 = 1 + d / 10;
    if (ppO2 > 1.6) m.oxTox = (m.oxTox ?? 0) + (ppO2 - 1.6) * 0.03 * dt;
    else m.oxTox = Math.max(0, (m.oxTox ?? 0) - 0.002 * dt);
    if (m.oxTox >= 1) {
      g.lost = true;
      event = 'convulsion';
    }
  } else lpm = (18 + 22 * work) * (1 + d / 10);
  g.litres = Math.max(0, g.litres - (lpm / 60) * dt);
  if (g.litres <= 0 && !event) event = 'empty';
  return { breathing: !g.lost && g.litres > 0, bubbles: g.kind === 'scuba' && !g.lost, event, lpm };
}

/**
 * How far off (m) a man with his head `depth` m under can be made out from above the surface,
 * in water one sees `vis` m through (glare and refraction take the rest): Infinity at the surface.
 */
export function submergedRange(depth, vis = WATER_VIS) {
  if (!(depth > UNDER)) return Infinity;
  return Math.max(0, (vis * 2.2) / (1 + depth));
}

/** Is there diving kit packed (not worn) in his pack to put on at the edge? */
export function packedDiveKit(m) {
  const k = m.kit ?? {};
  return diveStowage(k).packed;
}

/** How long it takes him to get the diving kit out of the pack and on (s), checks included; an old hand is quicker. */
export function gearUpTime(m) {
  const k = m.kit ?? {};
  const E = experienceOf(m);
  const T = (k.fins ? DIVE_FLAT.fins.gearT : 0) + (BREATHER[k.breather]?.gearT ?? 0) + (k.drybag ? DIVE_FLAT.drybag.gearT : 0) + (k.weights ?? 0) * LEAD.gearT;
  return T * (E.reload ?? 1);
}

/** What his diving kit is called ("rebreather, mask and fins"). */
export function diveKitName(k) {
  const parts = [];
  if (k.breather === 'rebreather') parts.push('rebreather');
  if (k.breather === 'scuba') parts.push('scuba set');
  if (k.fins) parts.push('mask and fins');
  if (k.drybag) parts.push('dry bag');
  if (k.weights > 0) parts.push(`${k.weights} kg of lead`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? 'diving kit';
}

/**
 * Geared up: the kit worn (his kit, load and mobility recomputed), the weapon in the dry bag and
 * the pack towed in it; without a dry bag the pack is left where he is. Returns { towed, left }.
 */
export function finishGearUp(m) {
  const k = { ...(m.kit ?? {}), diveWorn: true };
  let left = null;
  if (k.pack !== 'none' && !k.drybag) {
    left = k.pack;
    k.pack = 'none';
    m.packLeft = { kind: left, p: m.p?.slice() };
  }
  rekit(m, k);
  m.diveGas = null;
  gasOf(m);
  if (k.drybag) m.weaponBagged = true;
  return { towed: towing(m.kit) ? m.kit.pack : null, left };
}

/** His kit replaced, recomputed (ai/loadout.js applyKit); one who had no kit of his own keeps the AI's pace. */
export function rekit(m, k) {
  m.kit = k;
  const given = m.kitGiven;
  const keep = { carry: m.carry, paceK: m.paceK, fallK: m.fallK };
  m.carry = undefined;
  applyKit(m);
  if (!given) Object.assign(m, keep, { kitGiven: false });
  return m;
}

/**
 * Should he go under (while swimming)? o: { underFire, stealthy }. A reason, or null: under fire
 * (to break the enemy's sight of him), on his breathing set (what he geared up for), unseen (a
 * quiet approach with fins on, or when told to: m.diveStealth). Not one who would sink.
 */
export function diveReason(m, o = {}) {
  if (m.dead || !m.swimming || m.swim === 'sinks' || m.noDive) return null;
  const k = m.kit ?? {};
  if (hasSet(m)) return 'on his breathing set';
  if (o.underFire && (m.breath ?? 99) > 10) return 'under fire';
  if (o.stealthy && ((k.diveWorn && k.fins) || m.diveStealth)) return 'unseen';
  return null;
}

/** A one-line readout of what a kit does in the water, diving (the rig's Loadout panel, the editor). */
export function diveSummary(kit, fitness = 0.5, skill = 'regular') {
  const k = fullKit(undefined, kit);
  const worn = { ...k, diveWorn: true };
  const m = { kit: worn, fitness, skill, loadKg: kitMass(worn).total };
  const D = diveAbility(m, 2);
  const st = diveStowage(k);
  let s = `Diving: breath hold ~${Math.round(breathHoldCap({ fitness, skill }))} s; under water ${D.speed.toFixed(2)} m/s${D.fins ? ' (fins)' : ''}, buoyancy ${D.buoy >= 0 ? '+' : ''}${D.buoy.toFixed(1)} kg`;
  if (k.breather === 'rebreather') s += `; rebreather ~${(BREATHER.rebreather.o2 / 1.6 / 60).toFixed(1)} h of O₂, no deeper than ${O2_DEPTH} m, no bubbles`;
  if (k.breather === 'scuba') s += `; scuba ~${Math.round(BREATHER.scuba.air / (31 * 1.3))} min of air at 3 m (less deeper), bubbles`;
  if (st.bulk > 0) s += `; the kit ${st.bulk} l: ${k.diveWorn ? (st.fits ? 'worn' : `worn (no room in the pack: ${st.room} l)`) : `packed (${st.room} l of room), put on at the edge in ~${Math.round(gearUpTime({ kit: k, skill }))} s`}`;
  return s + '.';
}
