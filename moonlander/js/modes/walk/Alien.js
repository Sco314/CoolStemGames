// modes/walk/Alien.js — Batch 4 #12
// A purely procedural critter that occasionally appears in walk mode,
// chases the astronaut at a slow drift, and on contact removes one
// carried item before fading out. No external assets — built from a
// cone (body) + sphere (head) + small spheres (eyes) so the game stays
// asset-clean.
//
// Lifecycle: build() once per WalkMode.enter() (gated by chance + level),
// update(dt, astronautPos) every frame, dispose() on exit.
//
// State machine:
//   spawning  — fading in at a random perimeter point
//   chasing   — moving toward the astronaut
//   stealing  — flash + remove an item from GameState.carrying
//   leaving   — fading out (after steal OR lifetime expiry)
//   gone      — inert, ready for dispose

import * as THREE from 'three';
import { GameState, update as updateState, unlockAchievement } from '../../GameState.js';
import { showComms, showAchievementToast, showMissionMessage } from '../../HUD.js';
import { Sounds } from '../../Sound.js';
import {
  ALIEN_WALK_SPEED, ALIEN_STEAL_RADIUS, ALIEN_DETECTION_RADIUS,
  ALIEN_FADE_DURATION_S, ALIEN_LIFETIME_S
} from '../../Constants.js';

const _scratchVec = new THREE.Vector3();

export class Alien {
  /**
   * @param {THREE.Scene} scene
   * @param {(x:number, z:number) => number} groundHeight  height sampler
   * @param {number} playRadius  bound for spawn distance from origin
   */
  constructor(scene, groundHeight, playRadius) {
    this.scene = scene;
    this.groundHeight = groundHeight;
    this.state = 'spawning';
    this.lifetime = 0;
    this.fade = 0;

    // Procedural body — a slim teal cone with a glassy dome head and two
    // glowing magenta eye dots. Reads as "creature" without being on the
    // nose. Materials kept transparent so we can fade.
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshLambertMaterial({
      color: 0x44d6c0, transparent: true, opacity: 0
    });
    const bodyGeo = new THREE.ConeGeometry(0.9, 2.6, 12);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.3;
    this.group.add(body);

    const headMat = new THREE.MeshLambertMaterial({
      color: 0xa8f5e8, transparent: true, opacity: 0
    });
    const headGeo = new THREE.SphereGeometry(0.8, 16, 12);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.7;
    this.group.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xff66ee, transparent: true, opacity: 0
    });
    const eyeGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.3, 2.85, 0.65);
    eyeR.position.set( 0.3, 2.85, 0.65);
    this.group.add(eyeL, eyeR);

    this._materials = [bodyMat, headMat, eyeMat];
    this._eyeMat = eyeMat;

    // Spawn at a random point on the perimeter so the player notices it
    // walking in from the edge of vision instead of materializing on top
    // of them.
    const a = Math.random() * Math.PI * 2;
    const r = playRadius * (0.55 + Math.random() * 0.25);
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r;
    this.group.position.set(sx, this.groundHeight(sx, sz), sz);

    scene.add(this.group);
    console.log('👽 alien spawned at', sx.toFixed(1), sz.toFixed(1));
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} astronautPos
   */
  update(dt, astronautPos) {
    if (this.state === 'gone') return;
    this.lifetime += dt;

    // Advance fade based on state.
    if (this.state === 'spawning') {
      this.fade = Math.min(1, this.fade + dt / ALIEN_FADE_DURATION_S);
      if (this.fade >= 1) this.state = 'chasing';
    } else if (this.state === 'leaving') {
      this.fade = Math.max(0, this.fade - dt / ALIEN_FADE_DURATION_S);
      if (this.fade <= 0) {
        this.state = 'gone';
        this.group.visible = false;
        return;
      }
    }
    for (const m of this._materials) m.opacity = this.fade * (m === this._eyeMat ? 1 : 0.92);

    // Eye pulse for life.
    const pulse = 0.6 + 0.4 * Math.sin(this.lifetime * 4);
    this._eyeMat.color.setRGB(1, pulse * 0.4, pulse);

    // Movement / behavior.
    if (this.state === 'chasing') {
      const dx = astronautPos.x - this.group.position.x;
      const dz = astronautPos.z - this.group.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < ALIEN_DETECTION_RADIUS) {
        // Drift toward the astronaut.
        const inv = 1 / Math.max(0.0001, dist);
        this.group.position.x += dx * inv * ALIEN_WALK_SPEED * dt;
        this.group.position.z += dz * inv * ALIEN_WALK_SPEED * dt;
        // Face the astronaut.
        this.group.rotation.y = Math.atan2(dx, dz);
      }
      this.group.position.y = this.groundHeight(this.group.position.x, this.group.position.z);

      // Steal trigger.
      if (dist < ALIEN_STEAL_RADIUS && (GameState.carrying?.length || 0) > 0) {
        this._steal();
      }

      // Lifetime safety despawn (player kept distance).
      if (this.lifetime >= ALIEN_LIFETIME_S) {
        this.state = 'leaving';
        showComms('THE THING HAS LOST INTEREST');
      }
    }
  }

  _steal() {
    const stolen = GameState.carrying[0]?.type || 'cargo';
    updateState(s => {
      s.carrying.shift();   // first-in, first-stolen
    }, 'alien-steal');
    showComms(`THE THING SNATCHED YOUR ${stolen.toUpperCase()}`);
    Sounds.comms?.play();
    // First encounter unlocks an achievement; gate the unlock so it only
    // fires once per save.
    GameState.flags = GameState.flags || {};
    if (!GameState.flags.alienVisited) {
      GameState.flags.alienVisited = true;
      const ach = unlockAchievement('alien-visit');
      if (ach) showAchievementToast(ach);
      // Mission-control gets a one-line reaction the first time so the
      // player knows it wasn't a bug.
      showMissionMessage(null, {
        title: 'CAPCOM',
        body:  'Houston… we are not alone. Whatever it was took something out of your pack and ran. Tag it and move on, commander.',
        ttl:   8000
      });
    }
    this.state = 'leaving';
  }

  isGone() { return this.state === 'gone'; }

  dispose() {
    this.scene.remove(this.group);
    for (const child of this.group.children) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
  }
}
