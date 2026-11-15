import { ONCE, MOVING, RELOAD_TIME, PARKOUR, ROLL, PEEK } from './rig.js';
import { recoilOf, skillOf } from '../ai/soldier.js';

/**
 * Show on a figure (operator/rig.js OperatorFigure) what the squad AI (ai/squad.js,
 * ai/soldier.js) says a member is doing: his clip (one-shots restarted when the AI starts
 * one again, loops cross-faded), walking speed, aim, the weapon in his hands (switching
 * with the put-away and draw animations), reload speed by expertise, armour.
 * Used by the simulation's renderer (render/enemies.js) and the character rig (rig/stage.js).
 * st keeps what was shown last ({ animT, weapon, armour }).
 */
const SWITCHES = new Set(['drawKnife', 'drawRifle', 'sheathKnife', 'drawSecondary', 'holsterRifle', 'holsterSecondary', 'fistsUp']);
const FIG_WEAPON = { rifle: 'rifle', secondary: 'secondary', knife: 'knife', fists: 'fists' };

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
  // his primary (a rifle, a shotgun, a pistol, the gunner's MG: ai/soldier.js kit): its mesh, and
  // the clips held its way (ai/weapons.js, operator/rig.js WEAPON_STYLE)
  if (f.setPrimary && d.primary) f.setPrimary(d.primary);
  // his weapon's recoil (ai/recoil.js): the firing clips baked for it, his control of it
  if (f.setRecoil && d.weapon !== 'knife' && d.weapon !== 'torch' && d.weapon !== 'fists') f.setRecoil(recoilOf(d), skillOf(d).control);
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
      // (a reload at his pace: the weapon's own reload clip, a shotgun's shells or a pistol's magazine, stretched to it)
      else if (name === 'reload' && d.animDur) f.play('reload', { restart: true, fade: 0.15, speed: (f.actions?.reload?.getClip().duration ?? RELOAD_TIME ?? 2.8) / d.animDur });
      // a parkour move or a roll (ai/evade.js): its clip at the pace the AI carries him along it (a wounded man's slow vault)
      else if (PARKOUR[name] || ROLL[name] || name === 'pickup' || name === 'pickupOne') f.play(name, { restart: true, fade: 0.12, speed: d.animDur ? f.A.clips[name].duration / d.animDur : 1 });
      // a peek (ai/peek.js): its clip stretched to how long he shows himself (shorter for the experienced)
      else if (PEEK[name]) f.play(name, { restart: true, fade: 0.12, speed: d.animDur ? f.A.clips[name].duration / d.animDur : 1 });
      else f.play(name, { restart: true, fade: 0.15 });
    } else if (!ONCE[name]) f.play(name);
    if (MOVING[f.state] && !ONCE[f.shown]) f.setSpeed(d.moving ? Math.max(0.5, Math.min(1.8, (d.speed ?? 1) / MOVING[f.state])) : 0.001);
  }
  f.setAim(d.aimAt);
  // his light (ai/flashlight.js): the hand torch in the left hand (drawn, put away), on or off
  if (f.setTorch) {
    if (d.flashlight === false) f.hasTorch = false;
    f.setTorch(!!d.torchOut || d.torchAct?.k === 'stow', !!d.lightOn && d.lightSrc === 'hand', d.torchGrip);
  }
}
