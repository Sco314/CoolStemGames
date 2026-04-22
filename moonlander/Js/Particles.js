// Particles.js — v0.1.0 (STUB)
// Placeholder for the two particle systems from tblazevic: a thruster cone
// attached to the lander, and a one-shot explosion on crash. The class shapes
// match tblazevic's original so when you port the real logic over, Main.js
// and LanderMode.js don't need to change.
//
// Port plan (do this in a follow-up patch, not here):
//   1. Copy the Particle class (plane mesh pool with lifetime/velocity/drag).
//   2. Copy ParticleSystemCone — initial offset within a width, random
//      velocity inside a cone angle, color/scale/opacity lerp over lifetime.
//   3. Copy ParticleSystemExplosion — one-shot emission, random radial
//      direction, slower falloff.
// The only change needed is making them ES modules and pulling tunables from
// Constants.js instead of global lets.

import * as THREE from 'three';

export class ParticleSystemCone {
  constructor(scene, targetObject /*, ...tunables */) {
    this.emitting = false;
    this.targetObject = targetObject;
    // TODO: build particle pool
    console.log('ℹ️ ParticleSystemCone stub constructed (no particles emitted yet)');
  }
  update(dt) { /* TODO */ }
  dispose() { /* TODO: dispose pool geometries/materials */ }
}

export class ParticleSystemExplosion {
  constructor(scene, targetObject /*, ...tunables */) {
    this.targetObject = targetObject;
    console.log('ℹ️ ParticleSystemExplosion stub constructed');
  }
  emit() { console.log('💥 (stub) explosion emit'); }
  update(dt) { /* TODO */ }
  dispose() { /* TODO */ }
}
