// AssetCache.js — v0.1.0
// Session-lifetime cache for textures that multiple modes need (e.g. the
// lander sprite used in both LanderMode and WalkMode). Each URL is loaded
// once via THREE.TextureLoader; subsequent callers get the same Texture
// instance so we don't pay a GPU upload twice.
//
// Textures handed out here MUST NOT be disposed by mode exit logic — the
// cache owns them for the session.

import * as THREE from 'three';

const _cache = new Map();

/**
 * Return a shared, session-lifetime Texture for `url`. The caller can
 * configure filters on the returned texture (e.g. NearestFilter) — that
 * change is shared by every user, which is what we want for pixel art.
 */
export function getSharedTexture(url) {
  let tex = _cache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    _cache.set(url, tex);
  }
  return tex;
}
