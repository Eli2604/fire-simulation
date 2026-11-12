import { ONCE, MOVING, RELOAD_TIME } from './rig.js';

/**
 * Show on a figure (operator/rig.js OperatorFigure) what the squad AI (ai/squad.js,
 * ai/soldier.js) says a member is doing: his clip (one-shots restarted when the AI starts
 * one again, loops cross-faded), walking speed, aim, the weapon in his hands (switching
 * with the put-away and draw animations), reload speed by expertise, armour.
 * Used by the simulation's renderer (render/enemies.js) and the rig page (rig/main.js).
 * st keeps what was shown last ({ animT, weapon, armour }).
 */
const SWITCHES = new Set(['drawKnife', 'drawRifle', 'sheathKnife', 'drawSecondary', 'holsterRifle', 'holsterSecondary']);
const FIG_WEAPON = { rifle: 'rifle', secondary: 'secondary', knife: 'knife' };

export function driveFromAI(f, d, st) {
  if (d.dead) {
    f.play('die');
    return;
  }
  // armour on or off (the plate carrier)
  const arm = d.armour !== false && d.armour !== undefined ? true : d.kitted ? false : true;
  if (st.armour !== arm) {
    st.armour = arm;
    f.setArmour?.(arm);
  }
  // the weapon: a switch the AI started, or catching up with what he has
  const want = d.switching?.to ?? d.weapon;
  if (want && FIG_WEAPON[want] && st.weapon !== want && f.switchWeapon) {
    st.weapon = want;
    const cur = f.weapon === 'primary' ? 'rifle' : f.weapon;
    if (cur !== want) f.switchWeapon(FIG_WEAPON[want]);
    st.animT = d.animT; // (that was the switch's animation)
  }
  if (ONCE[f.shown] && f.current?.isRunning() && !(ONCE[d.anim] && d.animT !== st.animT)) {
    // let a draw, a throw, a reload or a radio call finish
  } else {
    const name = d.anim ?? 'crouchAim';
    if (ONCE[name] && d.animT !== st.animT) {
      st.animT = d.animT;
      if (SWITCHES.has(name)) {
        // switchWeapon above plays these
      } else if (name === 'deployDrone') f.deployDrone();
      else if (name === 'reload' && d.animDur) f.play('reload', { restart: true, fade: 0.15, speed: (RELOAD_TIME ?? 2.8) / d.animDur });
      else f.play(name, { restart: true, fade: 0.15 });
    } else if (!ONCE[name]) f.play(name);
    if (MOVING[f.state]) f.setSpeed(d.moving ? Math.max(0.5, Math.min(1.8, (d.speed ?? 1) / MOVING[f.state])) : 0.001);
  }
  f.setAim(d.aimAt);
}
