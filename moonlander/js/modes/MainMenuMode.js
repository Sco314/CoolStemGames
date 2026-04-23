// modes/MainMenuMode.js — v0.1.0
// The boot mode. Shows a starfield behind the main-menu DOM overlay. Leaves
// all button wiring to HUD.js — this file just owns the scene lifecycle.
//
// Main.js calls HUD.showMainMenu() when entering this mode; the Start button
// callback tells Main.js to go to LanderMode. Settings button opens the
// settings overlay on top.

import * as THREE from 'three';
import {
  HALF_WIDTH, HALF_HEIGHT, ORTHO_NEAR, ORTHO_FAR, MODE
} from '../Constants.js';
import { GameState, notify } from '../GameState.js';

let scene = null;
let camera = null;
let stars = null;
let disposables = [];

export const MainMenuMode = {
  enter(/* context, callbacks */) {
    console.log('▶ MainMenuMode.enter');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060e);

    camera = new THREE.OrthographicCamera(
      -HALF_WIDTH, HALF_WIDTH, HALF_HEIGHT, -HALF_HEIGHT, ORTHO_NEAR, ORTHO_FAR
    );
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);

    buildStarfield();

    GameState.mode = MODE.MENU;
    notify('mode');
  },

  exit() {
    console.log('◀ MainMenuMode.exit');
    for (const d of disposables) {
      if (d.geometry) d.geometry.dispose();
      if (d.material) d.material.dispose();
    }
    disposables = [];
    scene = null;
    camera = null;
    stars = null;
  },

  update(dt) {
    if (stars) stars.rotation.z += dt * 0.02;
  },

  render(renderer) {
    renderer.render(scene, camera);
  },

  getCamera() { return camera; },
  getScene()  { return scene; }
};

function buildStarfield() {
  const count = 300;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * HALF_WIDTH * 2.2;
    positions[i * 3 + 1] = (Math.random() - 0.5) * HALF_HEIGHT * 2.2;
    positions[i * 3 + 2] = 0;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false });
  stars = new THREE.Points(geom, mat);
  scene.add(stars);
  disposables.push({ geometry: geom, material: mat });
}
