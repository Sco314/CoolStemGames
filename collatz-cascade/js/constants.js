// ── Colors ────────────────────────────────────────────────
// Stopping-time ramp: cool (shallow) → warm (deep)
// Perceptually smooth, avoids raw HSL rainbow
export const COLOR_RAMP = [
  [0.41, 0.05, 0.74],  // deep violet
  [0.17, 0.38, 0.87],  // blue
  [0.10, 0.60, 0.56],  // teal
  [0.26, 0.67, 0.18],  // green
  [0.90, 0.78, 0.10],  // yellow
  [0.91, 0.49, 0.12],  // orange
  [0.83, 0.13, 0.13],  // red
];

export const ANCHOR_COLOR = [0.83, 0.64, 0.29];   // warm gold for node "1"
export const BG_COLOR = 0x0a0f1e;

// ── Node sizing ──────────────────────────────────────────
export const NODE_BASE_RADIUS = 0.35;
export const NODE_SCALE_LOG_BASE = 1.15;  // log-scale factor for value
export const NODE_MIN_RADIUS = 0.25;
export const NODE_MAX_RADIUS = 1.8;
export const ANCHOR_RADIUS = 0.55;        // node "1" slightly larger

// ── Edges ────────────────────────────────────────────────
export const EDGE_OPACITY = 0.35;

// ── Layout (force-directed) ──────────────────────────────
export const REPULSION_STRENGTH = 2.8;
export const SPRING_LENGTH = 3.0;
export const SPRING_STIFFNESS = 0.04;
export const GRAVITY_STRENGTH = 0.002;
export const LAYOUT_DAMPING = 0.88;       // velocity damping per frame
export const LAYOUT_MIN_VELOCITY = 0.001; // threshold to "settle"

// ── Animation timing ─────────────────────────────────────
export const NODE_POP_DURATION = 200;      // ms per node pop-in
export const MAX_SEQUENCE_DRAW_TIME = 1500; // ms total for longest sequences
export const MERGE_FLARE_DURATION = 500;   // ms
export const COLOR_RESCALE_DURATION = 500;  // ms
export const PATH_PULSE_DURATION = 800;     // ms for "already exists" pulse
export const CAMERA_FLY_DURATION = 1000;    // ms

// ── Emissive ─────────────────────────────────────────────
export const CLIMBER_EMISSIVE = 0.35;      // odd nodes (3n+1) glow brighter
export const FALLER_EMISSIVE = 0.05;       // even nodes (n/2) matte

// ── Anchor pulse ─────────────────────────────────────────
export const ANCHOR_PULSE_PERIOD = 3500;   // ms per breath cycle
export const ANCHOR_PULSE_MIN = 0.15;
export const ANCHOR_PULSE_MAX = 0.45;

// ── Limits ───────────────────────────────────────────────
export const INPUT_MAX = 1_000_000;
export const RECENT_MAX = 15;

// ── Camera ───────────────────────────────────────────────
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 500;
export const CAMERA_FOV = 55;
export const CAMERA_INITIAL_DISTANCE = 18;
export const CAMERA_MIN_DISTANCE = 4;
export const CAMERA_MAX_DISTANCE = 200;
