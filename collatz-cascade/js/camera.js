/**
 * Camera controller: orbit, auto-framing, and fly-to.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR,
  CAMERA_INITIAL_DISTANCE, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE,
  CAMERA_FLY_DURATION,
} from './constants.js';
import { getBounds } from './graph.js';

let camera, controls, renderer;
let flyAnim = null; // active fly-to animation

export function getCamera() { return camera; }
export function getControls() { return controls; }

let canvasEl = null;

function getCanvasSize() {
  if (!canvasEl) return { w: window.innerWidth, h: window.innerHeight };
  const rect = canvasEl.getBoundingClientRect();
  return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
}

export function initCamera(canvas) {
  canvasEl = canvas;
  const { w, h } = getCanvasSize();

  camera = new THREE.PerspectiveCamera(CAMERA_FOV, w / h, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 2, CAMERA_INITIAL_DISTANCE);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);   // false: don't set CSS, let CSS positioning handle it
  renderer.setClearColor(0x0a0f1e, 1);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = CAMERA_MIN_DISTANCE;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.enablePan = true;
  controls.autoRotate = false;
  controls.target.set(0, 0, 0);

  window.addEventListener('resize', onResize);
  // Also observe canvas size changes (Safari chrome show/hide)
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onResize).observe(canvas);
  }

  return renderer;
}

function onResize() {
  const { w, h } = getCanvasSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

export function updateCamera() {
  if (flyAnim) {
    const done = flyAnim.update(performance.now());
    if (done) flyAnim = null;
  }
  controls.update();
}

/**
 * Smoothly zoom out to fit the entire graph if new nodes extend beyond view.
 */
export function autoFrame() {
  const { center, radius } = getBounds();
  const fov = camera.fov * Math.PI / 180;
  const desiredDist = radius / Math.sin(fov / 2) * 1.8;
  flyTo(center, Math.max(desiredDist, CAMERA_INITIAL_DISTANCE));
}

/**
 * Fly the camera to look at a target position from a given distance.
 */
export function flyTo(target, distance) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endTarget = target.clone();

  // Compute end position: same direction from target as current, but at new distance
  const dir = camera.position.clone().sub(controls.target).normalize();
  const endPos = endTarget.clone().add(dir.multiplyScalar(distance || camera.position.distanceTo(controls.target)));

  let startTime = -1;

  flyAnim = {
    update(now) {
      if (startTime < 0) startTime = now;
      const t = Math.min(1, (now - startTime) / CAMERA_FLY_DURATION);
      const eased = t * t * (3 - 2 * t); // smoothstep

      camera.position.lerpVectors(startPos, endPos, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);

      if (t >= 1) {
        camera.position.copy(endPos);
        controls.target.copy(endTarget);
        return true;
      }
      return false;
    }
  };
}

/**
 * Fly to a specific node value's position.
 */
export function flyToNode(nodePosition) {
  const dist = camera.position.distanceTo(controls.target);
  flyTo(nodePosition, Math.max(dist * 0.5, CAMERA_MIN_DISTANCE + 2));
}

/**
 * Reset camera to default position.
 */
export function recenter() {
  const { center, radius } = getBounds();
  const fov = camera.fov * Math.PI / 180;
  const dist = Math.max(radius / Math.sin(fov / 2) * 1.2, CAMERA_INITIAL_DISTANCE);
  flyTo(center, dist);
}
