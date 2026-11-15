/**
 * Settings of rigged things in the editor's properties (editor/editor.js calls these after the
 * model's params, which it puts in folders by their `group`):
 *
 *  - A squad (models/squad.js): a "Load & speed" readout (each man's role, rank, experience, the
 *    weight he carries and his walk / run / sprint speed, stamina, climbing, swimming; the team's
 *    slowest man) and a "Men" folder with a folder per soldier: his role, experience, rank,
 *    fitness, discipline and every item of his loadout (ai/loadout.js KIT_FIELDS). A field shows
 *    what he has now (the role's, the team's settings); changing it stores it for him only
 *    (p.men[i]: { role, skill, rank, fitness, discipline, kit: { ... } }); "Reset" drops his own.
 *  - Guards (models/enemy.js, a loadout of their own): the same readout for one of them.
 *
 * Everything is a change of the scene (undo, redo, saved with it); a change of the team's makeup
 * (a role, the number of men) rebuilds the panel.
 */
import { squadMen } from '../models/squad.js';
import { guardKit } from '../models/enemy.js';
import { ROLES, ROLE_KEYS, KIT_FIELDS, PRIMARY, SIDEARM, PACK, ARMOUR, RADIO, MEDKIT, BREATHER, loadSummary } from '../ai/loadout.js';
import { LEVELS, LEVEL_LABELS, RANKS, RANK_ABBR, describeLevel } from '../ai/experience.js';

const OPTION_LABELS = { primary: PRIMARY, sidearm: SIDEARM, pack: PACK, armour: ARMOUR, radio: RADIO, medkit: MEDKIT, breather: BREATHER };
/** lil-gui options as { label: value } (the catalogue's labels). */
const optionsOf = (key) => {
  const T = OPTION_LABELS[key];
  return T ? Object.fromEntries(Object.entries(T).map(([k, v]) => [v.label, k])) : KIT_FIELDS[key].options;
};

/** Which folders were open (by key): the properties are made again after every change, they stay as they were. */
const OPEN = new Map();
/** Open or close a folder as it was last (else as open says), and remember it from now on. */
export function remember(folder, key, open = false) {
  if (OPEN.has(key) ? OPEN.get(key) : open) folder.open();
  else folder.close();
  folder.onOpenClose((g) => g === folder && OPEN.set(key, !g._closed));
  return folder;
}

/** A read-only line in a folder (a disabled text field), and a setter for it. */
function readout(folder, name, text) {
  const o = { v: text };
  const c = folder.add(o, 'v').name(name).disable();
  return (t) => c.setValue(t);
}

/** The squad's folders: Load & speed, and Men (one per soldier). */
export function squadFolders(gui, ob, change, rebuild) {
  const p = ob.params;
  const men = () => squadMen(p);
  const fl = remember(gui.addFolder('Load & speed (what each carries, how fast he goes)'), 'squad:load', true);
  const lines = [];
  const team = () => {
    const ms = men();
    const slow = ms.reduce((a, m) => (m.mob.run < a.mob.run ? m : a), ms[0]);
    return `${ms.length} men, ${ms.reduce((s, m) => s + m.mass, 0).toFixed(0)} kg of kit in all; the slowest: ${ROLES[slow.role].label} (${slow.mass.toFixed(1)} kg, run ${slow.mob.run.toFixed(2)} m/s)`;
  };
  const setTeam = readout(fl, 'Team', team());
  men().forEach((m, i) => lines.push(readout(fl, `${i + 1}. ${ROLES[m.role].label}`, m.summary)));
  const refresh = () => {
    setTeam(team());
    men().forEach((m, i) => lines[i]?.(m.summary));
  };
  const fm = remember(gui.addFolder('Men (each soldier: role, experience, rank, loadout)'), 'squad:men');
  const own = (i) => p.men?.[i] ?? {};
  const put = (i, key, v, inKit) => {
    p.men = Array.isArray(p.men) ? p.men : [];
    while (p.men.length <= i) p.men.push({});
    const e = p.men[i];
    if (inKit) (e.kit ??= {})[key] = v;
    else e[key] = v;
  };
  men().forEach((m, i) => {
    const f = fm.addFolder(`${i + 1}. ${ROLES[m.role].label} · ${RANK_ABBR[m.rank] ?? m.rank} · ${LEVEL_LABELS[m.skill]} · ${m.mass.toFixed(1)} kg`);
    remember(f, `squad:man:${i}`);
    const cur = () => men()[i] ?? m;
    const info = readout(f, 'Load', m.summary);
    const after = (structural) => () => {
      change();
      if (structural) rebuild();
      else {
        info(cur().summary);
        refresh();
      }
    };
    const proxy = {};
    const field = (key, get, set) => Object.defineProperty(proxy, key, { get, set, enumerable: true });
    field('role', () => cur().role, (v) => put(i, 'role', v));
    f.add(proxy, 'role', Object.fromEntries(ROLE_KEYS.map((r) => [ROLES[r].label, r]))).name('Role').onFinishChange(after(true));
    field('skill', () => cur().skill, (v) => put(i, 'skill', v));
    f.add(proxy, 'skill', Object.fromEntries(LEVELS.map((l) => [LEVEL_LABELS[l], l]))).name(`Experience (${describeLevel(m.skill)})`).onFinishChange(after(true));
    field('rank', () => cur().rank, (v) => put(i, 'rank', v));
    f.add(proxy, 'rank', RANKS).name('Rank').onFinishChange(after(true));
    field('fitness', () => cur().fitness, (v) => put(i, 'fitness', v));
    f.add(proxy, 'fitness', 0, 1, 0.05).name('Fitness').onFinishChange(after(false));
    field('discipline', () => cur().discipline, (v) => put(i, 'discipline', v));
    f.add(proxy, 'discipline', 0, 1, 0.05).name('Discipline').onFinishChange(after(false));
    for (const [key, F] of Object.entries(KIT_FIELDS)) {
      field(key, () => cur().kit[key], (v) => put(i, key, v, true));
      const c = F.options ? f.add(proxy, key, optionsOf(key)) : F.bool ? f.add(proxy, key) : f.add(proxy, key, F.min, F.max, F.step);
      c.name(F.label).onFinishChange(after(key === 'primary'));
    }
    f.add({ reset: () => (p.men?.[i] && (p.men[i] = {}), change(), rebuild()) }, 'reset').name('Reset to the team’s');
  });
  return refresh;
}

/** Guards with a loadout of their own (models/enemy.js): what one carries and how fast he goes. */
export function guardFolders(gui, ob) {
  const p = ob.params;
  if (p.loadout !== 'custom') return () => {};
  const f = remember(gui.addFolder('Load & speed (each guard)'), 'enemy:load', true);
  const set = readout(f, 'Each', loadSummary(guardKit(p), p.fitness ?? 0.5));
  return () => set(loadSummary(guardKit(p), p.fitness ?? 0.5));
}

