/**
 * The character rig page (rig.html): the editor's Rig stage (rig/stage.js) on a page of its own,
 * for the single-file build (scripts/build-rig-artifact.mjs ... rig) and old links. Its URL
 * options are the stage's (?anim= ?zones=1 ?t= ?tab=dragon ...). "Back to the world" opens the
 * simulation.
 */
import { mountRig } from './stage.js';
import { goPage } from '../pages.js';

const root = document.createElement('div');
document.body.appendChild(root);
const rig = mountRig(root, { onExit: () => goPage(null) });
rig.show();
// for the console and screenshot scripts
window.Rig = rig;
window.Dragon = rig.dragon;
rig.ready.then(() => (window.__ready = true));
