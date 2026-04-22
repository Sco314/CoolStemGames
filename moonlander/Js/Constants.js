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

// ---------- Walk mode ----------
export const WALK_SPEED              = 18;   // units per second
export const WALK_TURN_SPEED         = 2.2;  // radians per second (keyboard turning)
export const WALK_CAMERA_DISTANCE    = 20;   // how far behind the astronaut
export const WALK_CAMERA_HEIGHT      = 10;   // how high above
export const WALK_INTERACT_RADIUS    = 8;    // how close to a fuel tank to interact

// ---------- Particle tunables (ported subset — expand as needed) ----------
export const CONE_PS_MAX_PARTICLES     = 1100;
export const CONE_PS_PER_SEC_MIN       = 250;
export const CONE_PS_PER_SEC_MAX       = 350;
export const CONE_PS_LIFETIME_MIN      = 0.3;
export const CONE_PS_LIFETIME_MAX      = 0.8;

export const EXPLOSION_PS_MAX_PARTICLES = 350;
export const EXPLOSION_PS_LIFETIME_MIN  = 0.8;
export const EXPLOSION_PS_LIFETIME_MAX  = 5;

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
