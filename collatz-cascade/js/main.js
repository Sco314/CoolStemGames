/**
 * Entry point: scene setup, render loop, orchestration.
 */

import * as THREE from 'three';
import { initGraph, layoutStep, updateAnchorPulse, isSettled, getGroup, getMode } from './graph.js';
import { updateAnimations, hasActiveAnimations, addNumber } from './animate.js';
import { initCamera, updateCamera, getCamera, getControls } from './camera.js';
import { initUI, updateTooltip } from './ui.js';
import { initNumberLine, updateNumberLine, isNumberLineActive } from './numberline.js';

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

// Initialize graph (creates gold "1" anchor)
initGraph(scene);

// Initialize number line
initNumberLine(scene);

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

  if (isNumberLineActive()) {
    // Number line mode: update playback and follow camera
    const camTarget = updateNumberLine(dt);
    if (camTarget) {
      // Smoothly follow the operator ball
      camera.position.lerp(camTarget.position, 0.06);
      controls.target.lerp(camTarget.lookAt, 0.06);
    }
    controls.update();
  } else {
    // Graph modes
    if (!isSettled() || hasActiveAnimations()) {
      layoutStep(dt);
    }
    updateAnimations(now);
    updateAnchorPulse(now);
    updateCamera();
    updateTooltip(camera, scene);
  }

  renderer.render(scene, camera);
}

animate();
