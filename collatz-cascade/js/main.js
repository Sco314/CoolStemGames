/**
 * Entry point: scene setup, render loop, orchestration.
 */

import * as THREE from 'three';
import { initGraph, layoutStep, updateAnchorPulse, isSettled } from './graph.js';
import { updateAnimations, hasActiveAnimations, addNumber } from './animate.js';
import { initCamera, updateCamera, getCamera } from './camera.js';
import { initUI, updateTooltip } from './ui.js';

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

// ── UI ───────────────────────────────────────────────────
initUI((n) => {
  return addNumber(n);
});

// ── Render loop ──────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05); // cap dt at 50ms
  const now = performance.now();

  // Force-directed layout
  if (!isSettled() || hasActiveAnimations()) {
    layoutStep(dt);
  }

  // Animations (pop-in, merge flare, rescale, pulse)
  updateAnimations(now);
  updateAnchorPulse(now);

  // Camera
  updateCamera();

  // Tooltip (raycaster)
  updateTooltip(getCamera(), scene);

  // Render
  renderer.render(scene, getCamera());
}

animate();
