// Constants.js — v0.1.0
// Tunable parameters. Keep this file boring: no logic, just numbers.
// Grouped to match tblazevic's constants.js layout so anyone familiar with
// that project can find their way around.

// ---------- World dimensions (world units, NOT pixels) ----------
// We keep the same 800x450 "game area" idea but now it's world units in 3D space.
// z=0 is the lander plane. x is horizontal, y is vertical (up).
export const GAME_WIDTH  = 800;
export const GAME_HEIGHT = 450;
export const HALF_WIDTH  = GAME_WIDTH  / 2;
export const HALF_HEIGHT = GAME_HEIGHT / 2;

// ---------- Lander physics (tblazevic values, unchanged) ----------
export const LANDER_SCALE          = 8;
export const GRAVITY               = 1.62;          // Moon gravity m/s²
export const THRUSTER_ACCEL_MAX    = 4;
export const THRUSTER_JERK         = 4;             // Jerk = d(accel)/dt — gives smooth lift-off feel
export const ACCEL_FALLOFF_MULT    = 2;
export const ANGULAR_VELOCITY      = 90 * (Math.PI / 180);
export const HORIZONTAL_DRAG_COEF  = 0.04;

// ---------- Collision shapes (3-circle approximation) ----------
// The lander is approximated by three circles: one at the body center, and one
// at each foot. The foot circles are offset from the lander origin so they
// rotate with the craft; see LanderMode.buildLander().
export const MAIN_COLLIDER_SCALE   = LANDER_SCALE / 2;
export const SMALL_COLLIDER_SCALE  = LANDER_SCALE / 8;
export const FOOT_COLLIDER_OFFSET_X = LANDER_SCALE * 0.45;  // outward from center
export const FOOT_COLLIDER_OFFSET_Y = -LANDER_SCALE * 0.45; // below center

// If the lander x is within this fraction of the lander scale of either
// landing-pad edge, the landing is rejected as "TOO CLOSE TO EDGE".
export const LANDING_EDGE_MARGIN_FRAC = 0.38;

// ---------- Fuel / scoring ----------
export const STARTING_FUEL          = 1000;
export const FUEL_CONSUMPTION_MIN   = 4;
export const FUEL_CONSUMPTION_MAX   = 14;
export const FUEL_ALERT_THRESHOLD   = 300;
export const LANDING_ANGLE_TOLERANCE    = 6.7 * (Math.PI / 180);
export const LANDING_VELOCITY_TOLERANCE = 5.0;
export const SCORE_PER_LANDING = 100;

// ---------- Bonus pad multipliers ----------
// Weighted random outcomes rolled per flat pad at buildTerrain() time.
// Higher weight = more common. Most pads stay at 1x.
export const PAD_MULTIPLIER_WEIGHTS = [
  { value: 1, weight: 70 },
  { value: 2, weight: 18 },
  { value: 3, weight: 8 },
  { value: 5, weight: 4 }
];

// ---------- Camera / mode-switch ----------
// In 2D mode we use an OrthographicCamera sized to the game area.
// In 3D walk mode we use a PerspectiveCamera with a third-person chase rig.
export const ORTHO_NEAR = 0.1;
export const ORTHO_FAR  = 1000;
export const PERSP_FOV  = 60;
export const PERSP_NEAR = 0.1;
export const PERSP_FAR  = 2000;

// Cinematic transition between lander landing and walk mode
export const TRANSITION_DURATION_S = 2.5;  // length of the camera pull-back
export const POST_LAND_PAUSE_S     = 1.0;  // beat of stillness after touchdown
// Max volumes for the two audio beds that crossfade across the transition.
// Individual SFX still call play() at their normal volume.
export const TRANSITION_ROCKET_VOL = 0.45;
export const TRANSITION_WIND_VOL   = 0.55;

// Scripted disembark (lander → walk) and embark (walk → lander) animations
// that bracket the camera transition. Input is locked for the duration.
export const DISEMBARK_DURATION_S  = 1.5;
export const DISEMBARK_STEP_UNITS  = 7.0;   // how far the astronaut walks out
export const EMBARK_DURATION_S     = 1.2;

// ---------- Walk mode ----------
export const WALK_SPEED              = 18;   // units per second
export const WALK_TURN_SPEED         = 2.2;  // radians per second (keyboard turning)
export const WALK_CAMERA_DISTANCE    = 20;   // how far behind the astronaut
export const WALK_CAMERA_HEIGHT      = 10;   // how high above
export const WALK_INTERACT_RADIUS    = 8;    // how close to a fuel tank to interact
export const WALK_PLAY_RADIUS        = 180;  // hard cap on astronaut x/z movement
export const WALK_MOUSE_SENSITIVITY  = 0.0025;
export const WALK_PITCH_MIN          = -0.45; // camera below-and-behind (looking up)
export const WALK_PITCH_MAX          =  1.15; // camera high-and-behind (looking down)
export const WALK_GROUND_AMPLITUDE   = 3.0;   // peak height variation of moon surface
export const WALK_CRATER_COUNT       = 20;

// ---------- Particle tunables (ported subset — expand as needed) ----------
export const CONE_PS_MAX_PARTICLES     = 1100;
export const CONE_PS_PER_SEC_MIN       = 250;
export const CONE_PS_PER_SEC_MAX       = 350;
export const CONE_PS_LIFETIME_MIN      = 0.3;
export const CONE_PS_LIFETIME_MAX      = 0.8;
// Geometry / kinematics of the thruster cone
export const CONE_PS_HALF_ANGLE        = 0.30;   // radians off the thrust axis
export const CONE_PS_SPAWN_WIDTH       = LANDER_SCALE * 0.35; // rectangular spawn
export const CONE_PS_SPAWN_OFFSET      = LANDER_SCALE * 0.5;  // distance from lander origin along -fwd
export const CONE_PS_SPEED_MIN         = 80;
export const CONE_PS_SPEED_MAX         = 140;
export const CONE_PS_DRAG              = 1.4;    // exponential velocity falloff
export const CONE_PS_GRAVITY_FACTOR    = 0.35;   // particles fall a bit
// Visual lerp endpoints (yellow → red, fade out, slight grow)
export const CONE_PS_COLOR_START       = 0xfff2a8;
export const CONE_PS_COLOR_END         = 0xff3a14;
export const CONE_PS_OPACITY_START     = 0.95;
export const CONE_PS_OPACITY_END       = 0.0;
export const CONE_PS_SCALE_START       = 1.4;
export const CONE_PS_SCALE_END         = 0.4;
export const CONE_PS_PARTICLE_SIZE     = 1.6;    // base plane edge length

export const EXPLOSION_PS_MAX_PARTICLES = 350;
export const EXPLOSION_PS_LIFETIME_MIN  = 0.8;
export const EXPLOSION_PS_LIFETIME_MAX  = 5;
export const EXPLOSION_PS_SPEED_MIN     = 40;
export const EXPLOSION_PS_SPEED_MAX     = 160;
export const EXPLOSION_PS_DRAG          = 0.8;
export const EXPLOSION_PS_GRAVITY_FACTOR = 0.8;
export const EXPLOSION_PS_COLOR_START   = 0xffd07a;
export const EXPLOSION_PS_COLOR_END     = 0x401004;
export const EXPLOSION_PS_OPACITY_START = 1.0;
export const EXPLOSION_PS_OPACITY_END   = 0.0;
export const EXPLOSION_PS_SCALE_START   = 2.4;
export const EXPLOSION_PS_SCALE_END     = 0.6;
export const EXPLOSION_PS_PARTICLE_SIZE = 2.0;

// ---------- Camera zoom near ground ----------
// When altitude drops below this threshold, the ortho camera zooms in and
// follows the lander for a tense final-approach view.
export const CAMERA_ZOOM_ALTITUDE = 100;
export const CAMERA_ZOOM_FACTOR   = 4;

// ---------- Audio timers ----------
export const FUEL_ALERT_INTERVAL_MS = 4000;        // beep cadence while low-fuel alert is active
export const COMMS_INTERVAL_MIN_MS  = 20000;       // morse chatter cadence
export const COMMS_INTERVAL_MAX_MS  = 40000;

// ---------- Walk-mode interactables (Phase 4) ----------
// Each interactable type has a tuning record consumed by WalkMode to build
// the mesh and decide how to apply the interaction. The numeric payloads
// (fuel units, score, etc.) live here so the balance is easy to tune without
// touching WalkMode code.
export const INTERACTABLE_TYPES = Object.freeze({
  fuel: {
    label:  'FUEL DRUM',
    prompt: 'PRESS E FOR FUEL',
    color:  0xffb020,
    amount: 200       // units of fuel added on pickup
  },
  repair: {
    label:  'SUPPLY CRATE',
    prompt: 'PRESS E FOR REPAIR KIT',
    color:  0xd0d0d5,
    amount: 1         // repair kits added
  },
  sample: {
    label:  'SCIENCE SAMPLE',
    prompt: 'PRESS E TO COLLECT SAMPLE',
    color:  0x5ec3ff,
    score:  50
  },
  damaged: {
    label:        'DAMAGED EQUIPMENT',
    promptReady:  'PRESS E TO REPAIR',
    promptBlocked:'NEED A REPAIR KIT',
    color:        0xaa3030,
    costKits:     1,
    score:        500
  }
});

// Landing-site → spawn list. Keys are terrain segment indices; values are
// [type, localX, localZ] tuples placed relative to the walk scene origin
// (where the parked lander sits). Unknown landing sites fall back to
// DEFAULT_LOOT so every walk scene has something to do.
export const LANDING_SITE_LOOT = {
  5:  [['fuel',   10, 10], ['sample', 15,   0]],
  12: [['sample',-15, 10], ['sample',  0, -20], ['repair', 20,  5]],
  18: [['repair',  5,  5], ['sample', 20,  20], ['sample',-10, 15], ['damaged', 0, -15]],
  25: [['fuel', -10,-10], ['fuel',   10, -10], ['sample',  0, 18]],
  33: [['damaged', 0, 20], ['repair', 12,  5], ['repair',-12,  5]]
};
export const DEFAULT_LOOT = [
  ['fuel',   20, 10],
  ['sample',-15, 12],
  ['repair', 10,-14]
];

// ---------- Mission objectives (Phase 4) ----------
// The predicate is evaluated against GameState after every notify(); the HUD
// pulls the current done/not-done state from GameState.objectives.
export const OBJECTIVES = [
  {
    id: 'collect-samples',
    label: 'Collect 3 science samples',
    predicate: s => s.supplies.scienceSamples >= 3
  },
  {
    id: 'refuel-80',
    label: 'Refuel to 80% capacity',
    predicate: s => s.fuel.current >= s.fuel.capacity * 0.8
  },
  {
    id: 'repair-probe',
    label: 'Recover a damaged probe',
    predicate: s => s.flags.probeRepaired === true
  }
];

// ---------- Mode identifiers ----------
// Use strings so console logs and save files are human-readable.
export const MODE = Object.freeze({
  BOOT:       'BOOT',
  LANDER:     'LANDER',      // 2D-style side view, orthographic
  TRANSITION: 'TRANSITION',  // cinematic camera move
  WALK:       'WALK',        // 3D third-person
  PAUSED:     'PAUSED',
  GAME_OVER:  'GAME_OVER'
});
