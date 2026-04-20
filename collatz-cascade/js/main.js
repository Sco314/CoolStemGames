/**
 * Entry point: scene setup, render loop, orchestration.
 */

import * as THREE from 'three';
import { initGraph, layoutStep, updateAnchorPulse, isSettled, getGroup } from './graph.js';
import { updateAnimations, hasActiveAnimations, addNumber } from './animate.js';
import { initCamera, updateCamera, getCamera, getControls, trackAutoFrame } from './camera.js';
import { initUI, updateTooltip } from './ui.js';
import { initNumberLine, updateOrbRun, isOrbRunActive } from './numberline.js';
import { initTimeSeries, updateTimeSeries, isTimeSeriesActive } from './timeseries.js';
import { initSpiral, updateSpiral, isSpiralActive } from './spiral.js';
import { initFlatChart, updateFlatChart, isFlatChartActive } from './flatchart.js';

// ── Block iOS Safari's page-level pinch-zoom gestures ───
// touch-action: none should handle this, but iOS fires legacy
// 'gesturestart'/'gesturechange'/'gestureend' events that ignore
// touch-action. Cancel them unless they're on the canvas (where
// OrbitControls handles pinch to zoom the camera).
function blockPageGesture(e) {
  if (!e.target || e.target.id !== 'scene') {
    e.preventDefault();
  }
}
document.addEventListener('gesturestart', blockPageGesture, { passive: false });
document.addEventListener('gesturechange', blockPageGesture, { passive: false });
document.addEventListener('gestureend', blockPageGesture, { passive: false });
// Block double-tap-to-zoom at the document level
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && e.target && e.target.id !== 'scene') {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });

// ── Scene setup ──────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = initCamera(canvas);

const scene = new THREE.Scene();

// Lighting
const ambient = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambient);

const hemisphere = new THREE.HemisphereLight(0x1ea7fd, 0x0a0f1e, 0.3);
scene.add(hemisphere);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(8, 12, 5);
scene.add(dirLight);

// Initialize all scenes
initGraph(scene);
initNumberLine(scene);
initTimeSeries(scene);
initSpiral(scene);
initFlatChart(scene);

// ── UI ───────────────────────────────────────────────────
initUI((n) => {
  return addNumber(n);
});

// ── Render loop ──────────────────────────────────────────
const clock = new THREE.Clock();
const camera = getCamera();
const controls = getControls();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (isOrbRunActive()) {
    // Number line mode: update playback and follow camera
    const camTarget = updateOrbRun(dt);
    if (camTarget) {
      const lerp = Math.max(0.04, Math.min(0.3, camTarget.lerp ?? 0.12));
      camera.position.lerp(camTarget.position, lerp);
      controls.target.lerp(camTarget.lookAt, lerp);
    }
    controls.update();
  } else if (isTimeSeriesActive()) {
    // Time series: just advance draw-in animation, user controls camera
    updateTimeSeries(dt);
    controls.update();
  } else if (isSpiralActive()) {
    updateSpiral(dt);
    controls.update();
  } else if (isFlatChartActive()) {
    updateFlatChart(dt);
    controls.update();
  } else {
    // Graph modes
    if (!isSettled() || hasActiveAnimations()) {
      layoutStep(dt);
      // Continuously track the graph's center and extents so nodes
      // can't grow off-screen. Very gentle — doesn't fight user orbit.
      trackAutoFrame(0.015);
    }
    updateAnimations(now);
    updateAnchorPulse(now);
    updateCamera();
    updateTooltip(camera, scene);
  }

  renderer.render(scene, camera);
}

animate();
