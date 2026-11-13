/**
 * Going to another page (the simulation, the soldier rig test, the drone camp) from a scene
 * list. Served side by side (Vite, a folder) it is a plain link. Built for hosting where each
 * page has its own address (scripts/build-rig-artifact.mjs with PAGE_URLS), globalThis.__PAGES
 * maps the page names (sim, rig, camp) to those addresses, and the page opens in a new tab: a
 * hosted page often may not navigate itself.
 *
 *   goPage('camp.html')            the camp
 *   goPage(null, 'catacombs')      the simulation with that scenario
 *   goPage(null)                   the simulation
 */
export function goPage(page, scenario) {
  const key = page ? page.replace(/\.html.*$/, '') : 'sim';
  const hosted = globalThis.__PAGES?.[key];
  if (hosted) {
    const url = scenario ? `${hosted}${hosted.includes('?') ? '&' : '?'}scenario=${encodeURIComponent(scenario)}` : hosted;
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
    return;
  }
  location.href = page ?? (scenario ? `./?scenario=${encodeURIComponent(scenario)}` : './');
}
