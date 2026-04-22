// Sound.js — v0.2.0
// Audio wrapper. Same idea as tblazevic's sound.js but promoted to an ES
// module. If a file is missing, we log and swap in a no-op so the game still
// runs.
//
// Files live in /audio. The defaults are .wav placeholders so the game has
// audible feedback out of the box; drop in your own .mp3 versions and update
// the paths in initSound() to upgrade quality.

import { GameState } from './GameState.js';
import {
  FUEL_ALERT_INTERVAL_MS,
  COMMS_INTERVAL_MIN_MS, COMMS_INTERVAL_MAX_MS,
  MODE
} from './Constants.js';

class Sound {
  constructor(src) {
    this.el = document.createElement('audio');
    this.el.src = src;
    this.el.preload = 'auto';
    this.el.style.display = 'none';
    this.el.addEventListener('error', () => {
      console.warn(`⚠️ Sound file not found: ${src} — falling back to no-op`);
      this.play = this.stop = () => {};
    });
    document.body.appendChild(this.el);
  }
  play() {
    // Browsers block autoplay until first user gesture; we swallow the
    // rejection so a blocked play doesn't take down the frame.
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }
  stop() { this.el.pause(); }
  loop() {
    // tblazevic-style seamless loop using timeupdate instead of HTMLAudio.loop
    // because the latter has gaps on some browsers.
    this.el.addEventListener('timeupdate', () => {
      const buffer = 0.42;
      if (this.el.currentTime > this.el.duration - buffer) {
        this.el.currentTime = 0;
        this.play();
      }
    });
  }
}

export const Sounds = {
  crash:    null,
  rocket:   null,
  lowFuel:  null,
  comms:    null
};

let _timersStarted = false;

export function initSound() {
  Sounds.crash   = new Sound('audio/crash.wav');
  Sounds.rocket  = new Sound('audio/rocket.wav');
  Sounds.lowFuel = new Sound('audio/alarm.wav');
  Sounds.comms   = new Sound('audio/morse.wav');
  Sounds.rocket.loop();

  // Most browsers won't actually play audio until the user has interacted with
  // the page. Defer the alert/comms chains until first input so they don't
  // burn through their first few invocations as silent rejections.
  const start = () => {
    if (_timersStarted) return;
    _timersStarted = true;
    fuelAlert();
    playComms();
  };
  window.addEventListener('keydown', start, { once: true });
  window.addEventListener('pointerdown', start, { once: true });

  console.log('✅ Sound initialized');
}

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
