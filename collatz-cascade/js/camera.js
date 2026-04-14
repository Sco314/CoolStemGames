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

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Cap at 1.5x on mobile to reduce memory pressure (was 2x)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x0a0f1e, 1);

  // Handle WebGL context loss gracefully (iOS Safari kills contexts under
  // memory pressure; without handling, the page appears frozen/crashes).
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('WebGL context lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('WebGL context restored');
  });

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = CAMERA_MIN_DISTANCE;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.enablePan = true;
  controls.autoRotate = false;
  controls.target.set(0, 0, 0);

  window.addEventListener('resize', debouncedResize);
  // iOS Safari: visualViewport fires more reliably when chrome hides/shows
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', debouncedResize);
  }

  return renderer;
}

let resizeTimer = null;
function debouncedResize() {
  if (resizeTimer) return;
  resizeTimer = requestAnimationFrame(() => {
    resizeTimer = null;
    onResize();
  });
}

function onResize() {
  const { w, h } = getCanvasSize();
  const W = Math.floor(w), H = Math.floor(h);
  if (W < 1 || H < 1) return;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H, false);
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
export function autoFrame(smooth = true) {
  const { center, radius } = getBounds();
  const vFov = camera.fov * Math.PI / 180;
  const aspect = camera.aspect || 1;
  // Distance so the graph fits in both axes of the frustum
  const distByH = radius / Math.tan(vFov / 2);
  const distByW = radius / (Math.tan(vFov / 2) * Math.max(aspect, 0.3));
  const desiredDist = Math.max(distByH, distByW) * 1.5;
  const target = Math.max(desiredDist, CAMERA_INITIAL_DISTANCE);
  if (smooth) {
    flyTo(center, target);
  } else {
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(target));
    controls.target.copy(center);
  }
}

// Softly pull the camera toward auto-framed position each frame.
// Call this in the render loop so the graph stays centered as it grows.
export function trackAutoFrame(lerpFactor = 0.02) {
  const { center, radius } = getBounds();
  const vFov = camera.fov * Math.PI / 180;
  const aspect = camera.aspect || 1;
  const distByH = radius / Math.tan(vFov / 2);
  const distByW = radius / (Math.tan(vFov / 2) * Math.max(aspect, 0.3));
  const desiredDist = Math.max(Math.max(distByH, distByW) * 1.5, CAMERA_INITIAL_DISTANCE);

  // Smoothly move controls.target toward center
  controls.target.lerp(center, lerpFactor);

  // Only push camera back if current distance is too small; don't zoom in automatically
  const currentDist = camera.position.distanceTo(controls.target);
  if (currentDist < desiredDist * 0.95) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    const targetPos = controls.target.clone().add(dir.multiplyScalar(desiredDist));
    camera.position.lerp(targetPos, lerpFactor);
  }
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
