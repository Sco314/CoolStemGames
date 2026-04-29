// DevSettings.js — v0.1.0
// Runtime-toggleable developer flags surfaced through the in-game admin
// menu. Backed by localStorage so a flip persists across reloads. The
// `Constants.SHOW_TERRAIN_DEBUG` export remains the documented compile-time
// default and is the fallback when no override is stored.
//
// Touch this module instead of restarting with a recompile when you need
// to flip a diagnostic on/off on a machine without DevTools (e.g. a
// locked-down school Chromebook).

import { SHOW_TERRAIN_DEBUG as DEFAULT_SHOW_TERRAIN_DEBUG } from './Constants.js';

const KEY_TERRAIN_DEBUG = 'moonlander.devTerrainDebug';

function readBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private-mode quota errors etc. — ignore, runtime still honours the
       in-memory value via the getter below. */
  }
}

let _showTerrainDebug = readBool(KEY_TERRAIN_DEBUG, DEFAULT_SHOW_TERRAIN_DEBUG);

export function getShowTerrainDebug() {
  return _showTerrainDebug;
}

export function setShowTerrainDebug(value) {
  _showTerrainDebug = !!value;
  writeBool(KEY_TERRAIN_DEBUG, _showTerrainDebug);
}
