// modes/TransitionMode.js — v0.1.0
// A temporary mode that sits between LanderMode and WalkMode. Owns no scene
// of its own — it borrows the scene of the mode being left, interpolates a
// camera from the "from" camera's pose to the "to" camera's pose, and on
// completion calls a callback to swap in the real destination mode.
//
// Why a dedicated mode rather than a coroutine inside Main.js?
//   - Keeps Main.js's loop uniform (every mode gets update(dt)/render()).
//   - The transition is its own place to add polish later: DOF sweep,
//     letterbox bars, a subtle zoom, music crossfade, etc.
//
// Implementation note on ortho→perspective blending:
// You can't literally "morph" an OrthographicCamera into a PerspectiveCamera —
// they use different projection matrices. The trick here is:
//   1. Use the "from" mode's camera as-is for the first half of the transition,
//      but move it through space toward the destination pose.
//   2. At the midpoint (e.g., t=0.5), swap to the destination perspective
//      camera, already positioned to match roughly where the ortho was
//      looking, and continue interpolating it to its final pose.
// The swap is barely perceptible if you pick a visually similar frame and
// have the scene already dark/rotated enough. For a first pass, just fade to
// black at the swap and back up — visually it reads as a smooth cut.

import * as THREE from 'three';
import { TRANSITION_DURATION_S, MODE } from '../Constants.js';
import { GameState, notify } from '../GameState.js';
import { setCenterMessage } from '../HUD.js';

let elapsed = 0;
let fromCamera = null;
let toCamera   = null;
let fromScene  = null;       // we keep rendering this during the transition
let onComplete = null;

// Captured start and end poses (we won't mutate the real cameras mid-transition
// except to animate fromCamera during the first half).
let startPos = new THREE.Vector3();
let endPos   = new THREE.Vector3();
let startQuat = new THREE.Quaternion();
let endQuat   = new THREE.Quaternion();

export const TransitionMode = {
  /**
   * @param {object} context  { renderer, canvas }
   * @param {object} opts     {
   *   fromMode, toMode,          // Mode objects (not constructors — already-entered)
   *   onComplete                 // called when transition is done
   * }
   *
   * Note: toMode must already have been `.enter()`-ed by Main.js BEFORE the
   * transition so that its camera and scene are available. Main.js coordinates
   * this; see its goToMode() implementation.
   */
  enter(context, opts) {
    console.log('▶ TransitionMode.enter');
    elapsed = 0;
    fromCamera = opts.fromCamera;
    toCamera   = opts.toCamera;
    fromScene  = opts.fromScene;
    onComplete = opts.onComplete || (() => {});

    // Snapshot start pose (from the "from" camera) and end pose (from the "to"
    // camera's desired resting position, which its mode's enter() set up).
    startPos.copy(fromCamera.position);
    startQuat.copy(fromCamera.quaternion);
    endPos.copy(toCamera.position);
    endQuat.copy(toCamera.quaternion);

    GameState.previousMode = GameState.mode;
    GameState.mode = MODE.TRANSITION;
    notify('mode');
    setCenterMessage('');
  },

  exit() {
    console.log('◀ TransitionMode.exit');
    fromCamera = toCamera = fromScene = null;
    onComplete = null;
  },

  update(dt) {
    elapsed += dt;
    const t = Math.min(1, elapsed / TRANSITION_DURATION_S);
    const eased = easeInOutCubic(t);

    // Animate the camera we're currently rendering.
    // For the first half we animate fromCamera in place. At t >= 0.5 we'll
    // be rendering with toCamera and interpolate it the rest of the way.
    if (t < 0.5) {
      fromCamera.position.lerpVectors(startPos, endPos, eased);
      // Slerp ortho camera quaternion — for ortho it's cosmetic (rotation of
      // the frame) but doesn't hurt.
      fromCamera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
    } else {
      toCamera.position.lerpVectors(startPos, endPos, eased);
      toCamera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
    }

    if (t >= 1) {
      onComplete();
    }
  },

  render(renderer) {
    const t = elapsed / TRANSITION_DURATION_S;
    if (t < 0.5) {
      // Still visually in the "from" scene.
      renderer.render(fromScene, fromCamera);
    } else {
      // Swap: render the destination scene with the destination camera.
      // Main.js handed us opts.toScene through getCamera/getScene indirection —
      // we fetch it via toCamera's parent scene. To keep it simple, require
      // the caller to provide toScene on the camera itself (see Main.js).
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
