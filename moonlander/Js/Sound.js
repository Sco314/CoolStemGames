// Sound.js — v0.1.0
// Audio wrapper. Same idea as tblazevic's sound.js but promoted to an ES
// module. If a file is missing, we log and swap in a no-op so the game still
// runs. Put your .mp3 files in /audio.

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

export function initSound() {
  Sounds.crash   = new Sound('audio/crash.mp3');
  Sounds.rocket  = new Sound('audio/rocket.mp3');
  Sounds.lowFuel = new Sound('audio/alarm.mp3');
  Sounds.comms   = new Sound('audio/morse.mp3');
  Sounds.rocket.loop();
  console.log('✅ Sound initialized');
}
