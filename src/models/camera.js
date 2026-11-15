/**
 * A film camera standing in the world, for an in-game movie (src/cinema/): nothing of the world
 * (no voxels), drawn in Edit world as a camera with its view (editor/cinemaPanel.js), not in Play.
 *
 * Its pose is where it stands and looks (turn: pan, tilt X: tilt, down +; tilt Z: roll); its move
 * (cinema/rig.js) takes it from there: keyframes (the object's `keys`, relative to where it
 * stands), a dolly, a truck, a crane, an orbit, following or tracking a subject. Its lens
 * (cinema/lens.js): a focal length on a sensor, anamorphic or fisheye, the aperture and focus
 * (depth of field), the shutter (motion blur), ISO and exposure, white balance; and the picture's
 * effects (render/cinePost.js): grain, vignette, chromatic aberration, distortion, bloom and
 * streaks, a colour grade (cinema/look.js), a letterbox, handheld shake, a dutch angle.
 *
 * What it aims at and follows (cinema/aim.js), fields of the object besides its params:
 *   follow     the id of what its position follows (follow, track, orbit): a subject of the
 *              world ('car:jeep:1', 'dragon:koi:1'…) or a named object ('obj:House 1');
 *              none: the subject by kind (params.subject, subjectIndex)
 *   lookAt     the id of what it looks at (Looks: subject); none: what it follows
 *   lookOffset where on it ([x, y, z] m in its frame, from its aim point)
 *   aimPoint   the point it looks at (Looks: point), [x, y, z] in the world
 *   aimDist    how far ahead its aim handle sits (Looks: forward)
 *   path       its path (move: path; cinema/path.js): { points: [{ p, t, ease }], closed, on }
 *              (on: attached to a subject or object, its points in that one's frame)
 *   pathFrom   the name of another camera whose path it travels (several cameras, one path)
 *
 * The movie (a place's `movie`: cinema/timeline.js) cuts between cameras by their names.
 */
import { SENSORS, LENSES, FRAMES } from '../cinema/lens.js';
import { GRADES } from '../cinema/look.js';
import { MOVES, SUBJECTS } from '../cinema/rig.js';
import { EASE_NAMES } from '../cinema/keyframes.js';
import { FRAMING_NAMES } from '../cinema/aim.js';
import { PATH_ENDS, PATH_TIMINGS } from '../cinema/path.js';

const lens = (spec) => ({ ...spec, group: 'Lens' });
const focus = (spec) => ({ ...spec, group: 'Focus & exposure' });
const fx = (spec) => ({ ...spec, group: 'Effects' });
const move = (spec) => ({ ...spec, group: 'Move' });
const aim = (spec) => ({ ...spec, group: 'Aim' });

export default {
  label: 'Film camera',
  about: 'A camera for an in-game movie: a lens, focus and effects, a move (keyframes, dolly, crane, orbit, follow); cut together in the Movie panel',
  // (no fire, no voxels: the editor leaves out 'Burning at start'; its params in folders)
  inert: true,
  paramGroups: ['Aim', 'Move', 'Lens', 'Focus & exposure', 'Effects'],
  params: {
    name: { value: 'Cam A', label: 'Name (shots use it)' },
    lens: lens({ value: '35 mm', options: Object.keys(LENSES), label: 'Lens' }),
    focal: lens({ value: 35, min: 4, max: 400, step: 1, label: 'Focal length (mm)' }),
    sensor: lens({ value: 'Super 35', options: Object.keys(SENSORS), label: 'Sensor' }),
    letterbox: lens({ value: 'lens', options: ['lens', ...Object.keys(FRAMES)], label: 'Frame (letterbox; lens: anamorphic 2.39)' }),
    dof: focus({ value: true, label: 'Depth of field' }),
    fstop: focus({ value: 2.8, min: 1, max: 22, step: 0.1, label: 'Aperture (f-stop)' }),
    focus: focus({ value: 6, min: 0.2, max: 300, step: 0.1, label: 'Focus distance (m)' }),
    focusMode: focus({ value: 'manual', options: ['manual', 'target', 'subject'], label: 'Focus on (manual, aim point, subject)' }),
    autoExposure: focus({ value: true, label: 'Auto exposure' }),
    iso: focus({ value: 800, min: 100, max: 12800, step: 100, label: 'ISO' }),
    shutter: focus({ value: 180, min: 0, max: 360, step: 5, label: 'Shutter angle (°; motion blur)' }),
    fps: focus({ value: 24, min: 12, max: 120, step: 1, label: 'Frame rate (shutter time)' }),
    exposure: focus({ value: 0, min: -4, max: 4, step: 0.1, label: 'Exposure (EV)' }),
    whiteBalance: focus({ value: 6500, min: 2000, max: 12000, step: 100, label: 'White balance (K)' }),
    tint: focus({ value: 0, min: -1, max: 1, step: 0.05, label: 'Tint (green − / magenta +)' }),
    grade: fx({ value: 'Neutral', options: Object.keys(GRADES), label: 'Colour grade' }),
    gradeAmount: fx({ value: 1, min: 0, max: 1, step: 0.05, label: 'Grade amount' }),
    grain: fx({ value: 0.15, min: 0, max: 1, step: 0.01, label: 'Film grain' }),
    vignette: fx({ value: 0.3, min: 0, max: 1, step: 0.01, label: 'Vignette' }),
    chromatic: fx({ value: 0.1, min: 0, max: 1, step: 0.01, label: 'Chromatic aberration' }),
    distortion: fx({ value: 0, min: -0.3, max: 0.6, step: 0.01, label: 'Lens distortion (+ barrel, on the lens’s own)' }),
    bloom: fx({ value: 0.4, min: 0, max: 2, step: 0.05, label: 'Bloom / glare' }),
    streaks: fx({ value: 0, min: 0, max: 1, step: 0.05, label: 'Streaks (anamorphic flare)' }),
    shake: fx({ value: 0, min: 0, max: 1, step: 0.01, label: 'Handheld shake' }),
    // what it looks at (editor/cinemaPanel.js: pan / tilt, the aim handle, Aim at…): its own
    // direction, its aim point, or a target (the object's lookAt: a subject or a named object)
    look: aim({ value: 'forward', options: ['forward', 'point', 'subject'], label: 'Looks (forward: its own pan / tilt; point: its aim point; subject: what it looks at)' }),
    roll: aim({ value: 0, min: -45, max: 45, step: 0.5, label: 'Roll / dutch angle (°)' }),
    framing: aim({ value: 'centre', options: FRAMING_NAMES, label: 'Framing: where what it looks at sits in the frame (thirds)' }),
    frameX: aim({ value: 0, min: -0.95, max: 0.95, step: 0.01, label: 'Custom framing across (−1 left … 1 right)' }),
    frameY: aim({ value: 0, min: -0.95, max: 0.95, step: 0.01, label: 'Custom framing up (−1 bottom … 1 top)' }),
    lookLag: aim({ value: 0.15, min: 0, max: 3, step: 0.05, label: 'Look smoothing (s; 0: locked on)' }),
    move: move({ value: 'static', options: MOVES, label: 'Move' }),
    subject: move({ value: 'none', options: SUBJECTS, label: 'Subject by kind (when none is picked)' }),
    subjectIndex: move({ value: 1, min: 1, max: 12, step: 1, label: 'Which one (1: the first)' }),
    travel: move({ value: 5, min: -50, max: 50, step: 0.1, label: 'Dolly / truck / crane travel (m)' }),
    duration: move({ value: 6, min: 0.5, max: 60, step: 0.5, label: 'Move duration (s)' }),
    moveEase: move({ value: 'easeInOut', options: EASE_NAMES, label: 'Move easing' }),
    radius: move({ value: 8, min: 0.5, max: 200, step: 0.5, label: 'Orbit radius / follow distance (m)' }),
    height: move({ value: 2, min: -20, max: 100, step: 0.1, label: 'Orbit / follow height (m)' }),
    speed: move({ value: 20, min: -180, max: 180, step: 1, label: 'Orbit speed (°/s)' }),
    side: move({ value: 0, min: -50, max: 50, step: 0.1, label: 'Follow offset sideways (m; right +) / track ahead' }),
    lag: move({ value: 0.4, min: 0, max: 3, step: 0.05, label: 'Follow lag (s)' }),
    pathTiming: move({ value: 'speed', options: PATH_TIMINGS, label: 'Path: timing (an even speed, or a time at each point)' }),
    pathSpeed: move({ value: 5, min: 0.1, max: 120, step: 0.1, label: 'Path: speed (m/s; per point: where a point has no time)' }),
    pathEnd: move({ value: 'loop', options: PATH_ENDS, label: 'Path: at its end (stop, round again, back and forth)' }),
    pathStart: move({ value: 0, min: 0, max: 2000, step: 0.5, label: 'Path: start this far along it (m)' }),
    pathDelay: move({ value: 0, min: -60, max: 60, step: 0.1, label: 'Path: start later (s)' }),
    pathLookAhead: move({ value: 0, min: 0, max: 50, step: 0.5, label: 'Path: look this far ahead along it (m; 0: along its tangent)' }),
    pathBank: move({ value: 0, min: 0, max: 1, step: 0.05, label: 'Path: banking into the curves' }),
    path: move({ value: 'spline', options: ['spline', 'linear'], label: 'Keyframe path (smooth spline / straight)' }),
    keyEffects: move({ value: false, label: 'Keys record the effects too' }),
  },
  /** A new camera: at eye height, with no keys yet. */
  create(o) {
    return { ...o, y: (typeof o.y === 'number' ? o.y : 0) + 1.6, keys: [] };
  },
  build() {
    return { prims: [] };
  },
};
