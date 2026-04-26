// Sound.js — v0.3.0
// Audio wrapper. Same idea as tblazevic's sound.js but promoted to an ES
// module. If a file is missing, we log and swap in a no-op so the game still
// runs.
//
// Files live in /audio. Each Sound is constructed with a candidate list —
// MP3 first, WAV fallback — so dropping a higher-quality .mp3 into the
// directory upgrades quality automatically. If the .mp3 is absent the
// element's `error` event triggers the next candidate; if all candidates
// fail we silently swap play/stop/setVolume for no-ops.

import { GameState } from './GameState.js';
import {
  FUEL_ALERT_INTERVAL_MS,
  COMMS_INTERVAL_MIN_MS, COMMS_INTERVAL_MAX_MS,
  MODE
} from './Constants.js';

class Sound {
  /**
   * @param {string|string[]} srcOrList One URL, or a candidate list tried in
   *   order. The first source that loads wins; if every source 404s we
   *   silently fall back to no-op so the game still runs.
   */
  constructor(srcOrList) {
    const sources = Array.isArray(srcOrList) ? srcOrList.slice() : [srcOrList];
    this._sources = sources;
    this.el = document.createElement('audio');
    this.el.preload = 'auto';
    this.el.style.display = 'none';
    this._baseVolume = 1;
    _instances.add(this);

    let idx = 0;
    const tryNext = () => {
      if (idx < sources.length) {
        this.el.src = sources[idx++];
      } else {
        console.warn(`⚠️ Sound: no candidate loaded from [${sources.join(', ')}] — silencing`);
        this.play = this.stop = () => {};
        this.setVolume = () => {};
      }
    };
    this.el.addEventListener('error', tryNext);
    tryNext();
    document.body.appendChild(this.el);
  }
  play() {
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }
  stop() { this.el.pause(); }
  setVolume(v) {
    if (v < 0) v = 0; else if (v > 1) v = 1;
    this._baseVolume = v;
    this.el.volume = _muted ? 0 : (v * _masterVolume);
  }
  loop() {
    this.el.addEventListener('timeupdate', () => {
      const buffer = 0.42;
      if (this.el.currentTime > this.el.duration - buffer) {
        this.el.currentTime = 0;
        this.play();
      }
    });
  }
}

// Registry so setMasterVolume() / setMuted() can retune every live Sound
// without callers needing to know the list.
const _instances = new Set();
let _masterVolume = 1;
let _muted = false;

function _applyAll() {
  for (const s of _instances) {
    s.el.volume = _muted ? 0 : (s._baseVolume * _masterVolume);
  }
}

/** Scale all Sound element volumes by a global master multiplier. */
export function setMasterVolume(mv) {
  if (mv < 0) mv = 0; else if (mv > 1) mv = 1;
  _masterVolume = mv;
  _applyAll();
}

export function getMasterVolume() { return _masterVolume; }

/** Hard mute/unmute gate, independent of master volume. */
export function setMuted(m) {
  _muted = !!m;
  _applyAll();
}

export function isMuted() { return _muted; }

export const Sounds = {
  crash:    null,
  rocket:   null,
  lowFuel:  null,
  comms:    null,
  wind:     null,
  music:    null
};

let _timersStarted = false;
// Music gets its own multiplier so the player can mute the soundtrack
// without losing SFX (or vice versa). Persisted in GameState.settings.
let _musicVolume = 0.4;

export function initSound() {
  // MP3 first, WAV fallback. Drop .mp3 versions into /audio to upgrade.
  Sounds.crash   = new Sound(['audio/crash.mp3',  'audio/crash.wav']);
  Sounds.rocket  = new Sound(['audio/rocket.mp3', 'audio/rocket.wav']);
  Sounds.lowFuel = new Sound(['audio/alarm.mp3',  'audio/alarm.wav']);
  Sounds.comms   = new Sound(['audio/morse.mp3',  'audio/morse.wav']);
  Sounds.wind    = new Sound(['audio/wind.mp3',   'audio/wind.wav']);
  // Music is optional — only .mp3 is listed (no synthesized WAV in repo). If
  // the file is absent, the candidate list silently falls through to no-op
  // and the rest of the audio path keeps working.
  Sounds.music   = new Sound(['audio/music.mp3']);
  Sounds.rocket.loop();
  Sounds.wind.loop();
  Sounds.music.loop();
  // Wind is continuous ambience; it stays "playing" at volume 0 until the
  // TransitionMode / WalkMode crossfade it up.
  Sounds.wind.setVolume(0);
  // Music sits at its own slider volume (master still applies on top). It
  // doesn't actually start until the first user gesture (autoplay policy).
  Sounds.music.setVolume(_musicVolume);

  // Most browsers won't actually play audio until the user has interacted with
  // the page. Defer the alert/comms chains until first input so they don't
  // burn through their first few invocations as silent rejections.
  const start = () => {
    if (_timersStarted) return;
    _timersStarted = true;
    fuelAlert();
    playComms();
    // Kick the music loop now that we have a user gesture to satisfy
    // autoplay policy. The Sound class falls back to no-op silently if
    // the .mp3 isn't present.
    Sounds.music?.play();
  };
  window.addEventListener('keydown', start, { once: true });
  window.addEventListener('pointerdown', start, { once: true });

  console.log('✅ Sound initialized');
}

/** Music slider, independent of master volume. 0..1. */
export function setMusicVolume(v) {
  if (v < 0) v = 0; else if (v > 1) v = 1;
  _musicVolume = v;
  Sounds.music?.setVolume(v);
}

export function getMusicVolume() { return _musicVolume; }

// ----- Timer-chained players (ported from tblazevic) -----

/**
 * Beep every FUEL_ALERT_INTERVAL_MS while the low-fuel alert flag is set.
 * Self-rescheduling — runs forever once started, but only plays sound when
 * the alert is currently active.
 */
function fuelAlert() {
  if (GameState.isAlerted && GameState.mode === MODE.LANDER) {
    Sounds.lowFuel?.play();
  }
  setTimeout(fuelAlert, FUEL_ALERT_INTERVAL_MS);
}

/**
 * Play the morse comms blip every 20–40 seconds while the player is in an
 * active gameplay mode. Same self-rescheduling pattern.
 */
function playComms() {
  if (GameState.mode === MODE.LANDER || GameState.mode === MODE.WALK) {
    Sounds.comms?.play();
  }
  const next = COMMS_INTERVAL_MIN_MS +
               Math.random() * (COMMS_INTERVAL_MAX_MS - COMMS_INTERVAL_MIN_MS);
  setTimeout(playComms, next);
}
