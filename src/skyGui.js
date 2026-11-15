import { SKY_SETTINGS } from './sim/weather.js';
import { SKY_DEFAULTS, dayOf, dateLabel, hhmm, seasonOfDay, skyState, sunTimes } from './sim/sky.js';

/**
 * The sky's clock in a weather folder (outdoors): the date, the time of day, the place on the
 * Earth, fixed or running, and read-outs of the sun and the moon. The same settings in Play's
 * weather and Edit world's (SKY_SETTINGS, sim/weather.js).
 *   W        the settings (the scene's or the place's weather)
 *   change   called after a change (Play: as it changes; Edit world: when it is let go)
 *   finish   true: on letting go (onFinishChange), else live (onChange)
 *   now      the weather of the moment (a running clock), for the read-outs
 */
export function skyFolder(parent, W, { change, finish = false, now = () => W } = {}) {
  const f = parent.addFolder('Sky: date, time of day, sun and moon');
  for (const s of SKY_SETTINGS) if (s.key !== 'day' && W[s.key] == null) W[s.key] = SKY_DEFAULTS[s.key];
  // (the date: the one set, else the season's day; setting it may set the season)
  const P = {
    get day() {
      return dayOf(W);
    },
    set day(v) {
      W.day = Math.round(v);
      if (W.seasonFollowsDate) W.season = seasonOfDay(W.day, W.latitude);
    },
  };
  const ctl = {};
  const label = (s) => (s.key === 'day' ? `Date: ${dateLabel(dayOf(W), W.year)} (day ${dayOf(W)})` : s.key === 'time' ? `Time of day: ${hhmm(W.time)}` : s.label);
  for (const s of SKY_SETTINGS) {
    let c;
    if (s.kind === 'bool') c = f.add(W, s.key);
    else if (s.options) c = f.add(W, s.key, Object.fromEntries(Object.entries(s.options).map(([k, v]) => [v, k])));
    else c = f.add(s.key === 'day' ? P : W, s.key, s.min, s.max, s.step);
    c.name(label(s));
    const on = (v) => {
      if (s.key === 'seasonFollowsDate' && v) P.day = dayOf(W);
      c.name(label(s));
      if (s.key === 'clock') ctl.timeSpeed?.show(W.clock === 'running');
      change?.(s.key);
      update();
    };
    if (finish) c.onFinishChange(on);
    else c.onChange(on);
    // (the label follows the slider as it moves)
    if (finish && (s.key === 'day' || s.key === 'time')) c.onChange(() => c.name(label(s)));
    ctl[s.key] = c;
  }
  ctl.timeSpeed.show(W.clock === 'running');
  const out = { now: '', sun: '', moon: '' };
  const ro = {
    now: f.add(out, 'now').name('Now').disable(),
    sun: f.add(out, 'sun').name('Sun').disable(),
    moon: f.add(out, 'moon').name('Moon').disable(),
  };
  let timesKey = '';
  let times = null;
  function update() {
    const w = now() ?? W;
    if (!Number.isFinite(w.time)) return;
    const S = skyState(w);
    // (sunrise and sunset change only with the day)
    const key = `${dayOf(w)}|${w.year}|${w.latitude}|${w.longitude}|${w.utcOffset}`;
    if (key !== timesKey) {
      timesKey = key;
      times = sunTimes(w);
    }
    const rise = times.sunrise == null ? (S.sun.elevation > 0 ? 'up all day' : 'down all day') : `${hhmm(times.sunrise)}–${hhmm(times.sunset)}`;
    out.now = `${dateLabel(dayOf(w), w.year)} ${w.year}, ${hhmm(w.time)}${W.clock === 'running' ? ' (running)' : ''}`;
    out.sun = `${S.sun.elevation.toFixed(1)}° up, ${Math.round(S.sun.azimuth)}° az · ${rise} · ${S.phase}`;
    out.moon = `${Math.round(S.moon.illumination * 100)} % ${S.moon.name.toLowerCase()}, ${S.moon.elevation > 0 ? `up ${S.moon.elevation.toFixed(0)}°` : 'down'}`;
    for (const c of Object.values(ro)) c.updateDisplay();
  }
  update();
  return { folder: f, update, controllers: ctl };
}
