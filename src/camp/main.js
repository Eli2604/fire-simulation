/**
 * The drone operations camp page (camp.html): the editor's camp stage (camp/stage.js) on a page
 * of its own, for the single-file build (scripts/build-rig-artifact.mjs ... camp) and old links.
 * "Back to the world" opens the simulation.
 */
import { mountCamp } from './stage.js';
import { goPage } from '../pages.js';

const root = document.createElement('div');
document.body.appendChild(root);
const camp = mountCamp(root, { onExit: () => goPage(null) });
camp.show();
window.Camp = camp;
camp.ready.then(() => (window.__ready = true));
