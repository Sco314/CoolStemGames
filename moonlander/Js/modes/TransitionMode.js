// modes/TransitionMode.js — v0.2.0
// A temporary mode that sits between LanderMode and WalkMode. Owns no scene
// of its own — it borrows the scene of the mode being left, interpolates a
// camera from the "from" camera's pose to the "to" camera's pose, and on
// completion calls a callback to swap in the real destination mode.
//
// Why a dedicated mode rather than a coroutine inside Main.js?
//   - Keeps Main.js's loop uniform (every mode gets update(dt)/render()).
//   - The transition is its own place to add polish: DOF sweep, letterbox
//     bars, a subtle zoom, music crossfade, etc.
//
// Phase 5 polish:
//   - Letterbox bars slide in via a body.in-transition class.
//   - Fullscreen fade-through-black peaks at t=0.5 (triangle wave), hiding
//     the ortho→perspective projection swap completely.
//   - Audio crossfade: rocket hum fades out, wind ambience fades in on
//     lander→walk; reversed on walk→lander.
//
// Implementation note on ortho→perspective blending:
// You can't literally "morph" an OrthographicCamera into a PerspectiveCamera —
// they use different projection matrices. We move the "from" camera through
// the first half, render the destination camera during the second half, and
// rely on the fade-to-black at the midpoint to hide the cut.

import * as THREE from 'three';
import {
  TRANSITION_DURATION_S,
  TRANSITION_ROCKET_VOL, TRANSITION_WIND_VOL,
  MODE
} from '../Constants.js';
import { GameState, notify } from '../GameState.js';
import { setCenterMessage } from '../HUD.js';
import { Sounds } from '../Sound.js';

let elapsed = 0;
let fromCamera = null;
let toCamera   = null;
let fromScene  = null;       // we keep rendering this during the transition
let onComplete = null;
let direction  = 'lander-to-walk';   // or 'walk-to-lander'

let fadeEl = null;           // cached DOM refs
let bodyEl = null;

// Captured start and end poses (we won't mutate the real cameras mid-transition
// except to animate fromCamera during the first half).
const startPos = new THREE.Vector3();
const endPos   = new THREE.Vector3();
const startQuat = new THREE.Quaternion();
const endQuat   = new THREE.Quaternion();

export const TransitionMode = {
  /**
   * @param {object} context  { renderer, canvas }
   * @param {object} opts     {
   *   fromCamera, fromScene, toCamera,
   *   direction: 'lander-to-walk' | 'walk-to-lander',
   *   onComplete
   * }
   *
   * Note: toMode must already have been `.enter()`-ed by Main.js BEFORE the
   * transition so that its camera and scene are available. Main.js coordinates
   * this; see its goToMode() implementation.
   */
  enter(context, opts) {
    console.log('▶ TransitionMode.enter', opts.direction || '');
    elapsed = 0;
    fromCamera = opts.fromCamera;
    toCamera   = opts.toCamera;
    fromScene  = opts.fromScene;
    direction  = opts.direction || 'lander-to-walk';
    onComplete = opts.onComplete || (() => {});

    startPos.copy(fromCamera.position);
    startQuat.copy(fromCamera.quaternion);
    endPos.copy(toCamera.position);
    endQuat.copy(toCamera.quaternion);

    // Letterbox + fade chrome — bars slide in via CSS, opacity driven per frame.
    fadeEl = fadeEl || document.getElementById('fade-overlay');
    bodyEl = bodyEl || document.body;
    bodyEl.classList.add('in-transition');
    if (fadeEl) fadeEl.style.opacity = '0';

    // Make sure the rocket hum isn't lingering from gameplay; we want to
    // control it explicitly for the crossfade.
    Sounds.rocket?.stop();
    if (direction === 'lander-to-walk') {
      Sounds.wind?.play();
      Sounds.wind?.setVolume(0);
    }

    GameState.previousMode = GameState.mode;
    GameState.mode = MODE.TRANSITION;
    notify('mode');
    setCenterMessage('');
  },

  exit() {
    console.log('◀ TransitionMode.exit');
    // Tear down chrome. The destination mode is now active; let its enter()
    // finish deciding what sound bed to keep running.
    if (bodyEl) bodyEl.classList.remove('in-transition');
    if (fadeEl) fadeEl.style.opacity = '0';

    // Reset the rocket bed to full volume so the next thrust in LanderMode
    // isn't quiet (the crossfade leaves it partial). Wind volume is left at
    // its end-of-crossfade value — 0 after walk→lander, TRANSITION_WIND_VOL
    // after lander→walk (WalkMode.startDisembark refreshes it anyway).
    Sounds.rocket?.setVolume(1);

    fromCamera = toCamera = fromScene = null;
    onComplete = null;
  },

  update(dt) {
    elapsed += dt;
    const t = Math.min(1, elapsed / TRANSITION_DURATION_S);
    const eased = easeInOutCubic(t);

    // Camera interpolation. First half animates the ortho/from camera; second
    // half animates the perspective/to camera. Fade-to-black hides the swap.
    if (t < 0.5) {
      fromCamera.position.lerpVectors(startPos, endPos, eased);
      fromCamera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
    } else {
      toCamera.position.lerpVectors(startPos, endPos, eased);
      toCamera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
    }

    // Triangle-wave fade: 0 at t=0 and t=1, peaks at 1 at t=0.5.
    const fade = 1 - Math.abs(t * 2 - 1);
    if (fadeEl) fadeEl.style.opacity = String(fade);

    // Audio crossfade. Rocket fades from its entry volume to 0 across the
    // whole transition; wind does the reverse (or inverted for walk→lander).
    updateAudioCrossfade(t);

    if (t >= 1) {
      onComplete();
    }
  },

  render(renderer) {
    const t = elapsed / TRANSITION_DURATION_S;
    if (t < 0.5) {
      renderer.render(fromScene, fromCamera);
    } else {
      // Destination scene and camera were wired in by Main.js on the camera's
      // userData.
      renderer.render(toCamera.userData.scene, toCamera);
    }
  },

  getCamera() {
    const t = elapsed / TRANSITION_DURATION_S;
    return t < 0.5 ? fromCamera : toCamera;
  }
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
}

function updateAudioCrossfade(t) {
  if (direction === 'lander-to-walk') {
    Sounds.rocket?.setVolume(TRANSITION_ROCKET_VOL * (1 - t));
    Sounds.wind?.setVolume(TRANSITION_WIND_VOL * t);
  } else {
    // walk→lander: wind tapers, rocket hum sneaks in for the re-entry vibe.
    Sounds.wind?.setVolume(TRANSITION_WIND_VOL * (1 - t));
    Sounds.rocket?.setVolume(TRANSITION_ROCKET_VOL * t);
  }
}
