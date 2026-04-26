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
// LANDER_SCALE: 8 → 16 → 24 → 32 over successive playtests. Every dependent
// value (colliders, foot offsets, particle spawn, parked-lander sprite) is
// expressed as a multiple of LANDER_SCALE so the scale change propagates,
// and the foot-offset / edge-margin fractions below are re-tightened with
// each bump so the larger craft still fits the 15-unit narrowest pads.
export const LANDER_SCALE          = 32;
export const GRAVITY               = 1.62;          // Moon gravity m/s²
export const THRUSTER_ACCEL_MAX    = 4;
export const THRUSTER_JERK         = 4;             // Jerk = d(accel)/dt — gives smooth lift-off feel
export const ACCEL_FALLOFF_MULT    = 2;
export const ANGULAR_VELOCITY      = 90 * (Math.PI / 180);
export const HORIZONTAL_DRAG_COEF  = 0.04;

// ---------- Collision shapes (3-circle approximation) ----------
// The lander is approximated by three circles: one at the body center, and one
// at each foot. The foot circles are offset from the lander origin so they
// rotate with the craft; see LanderMode.buildLander(). Foot-offset / edge-
// margin fractions tightened with the scale bump so feet span 9.6 units and
// the effective landing footprint is 13.4 units — fits the narrowest 15-unit
// pads with room to spare.
export const MAIN_COLLIDER_SCALE   = LANDER_SCALE / 2;
export const SMALL_COLLIDER_SCALE  = LANDER_SCALE / 8;
export const FOOT_COLLIDER_OFFSET_X = LANDER_SCALE * 0.15;  // feet closer to center
export const FOOT_COLLIDER_OFFSET_Y = -LANDER_SCALE * 0.45; // below center

// If the lander x is within this fraction of the lander scale of either
// landing-pad edge, the landing is rejected as "TOO CLOSE TO EDGE".
// At scale 32: feet span 9.6 + edge margin 3.84 = 13.44 units — fits the
// 15-unit narrowest pad with 1.5 units of slack on each side.
export const LANDING_EDGE_MARGIN_FRAC = 0.06;

// ---------- Fuel / scoring ----------
export const STARTING_FUEL          = 1000;
export const FUEL_CONSUMPTION_MIN   = 4;
export const FUEL_CONSUMPTION_MAX   = 14;
export const FUEL_ALERT_THRESHOLD   = 300;
// Angle tolerance was 6.7° (tblazevic). Bumped to 9° so a slightly-tilted
// first approach still counts as a landing; Progression tightens it later.
export const LANDING_ANGLE_TOLERANCE    = 9.0 * (Math.PI / 180);
// Velocity tolerance was 5.0 (tblazevic). Bumped to 8.0 for the first run —
// Progression.js steps it back down toward the classic tblazevic number as
// the player levels up.
export const LANDING_VELOCITY_TOLERANCE = 8.0;
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
// DISEMBARK_STEP_UNITS bumped 7→16 because the larger parked-lander sprite
// at LANDER_SCALE 32 was filling the frame on the first walk-mode frame —
// walking the astronaut out further before handing over control gets the
// player past the silhouette.
export const DISEMBARK_DURATION_S  = 1.8;
export const DISEMBARK_STEP_UNITS  = 16.0;
export const EMBARK_DURATION_S     = 1.4;

// ---------- Walk mode ----------
export const WALK_SPEED              = 18;   // units per second
export const WALK_TURN_SPEED         = 2.2;  // radians per second (keyboard turning)
export const WALK_CAMERA_DISTANCE    = 20;   // how far behind the astronaut
export const WALK_CAMERA_HEIGHT      = 10;   // how high above
export const WALK_INTERACT_RADIUS    = 8;    // how close to a fuel tank to interact
// Bumped 180→320 to give the tiled NASA Apollo-11 terrain room to breathe.
// Procedural sin-displaced ground still covers everything; STL tiles sit on
// top as visual cladding.
export const WALK_PLAY_RADIUS        = 320;
export const WALK_MOUSE_SENSITIVITY  = 0.0025;
export const WALK_PITCH_MIN          = -0.45;
export const WALK_PITCH_MAX          =  1.15;
export const WALK_GROUND_AMPLITUDE   = 3.0;
export const WALK_CRATER_COUNT       = 24;

// ---------- Particle tunables (ported subset — expand as needed) ----------
// These are the "high-end" budgets. Particles.js scales them via Device.js
// so Chromebooks and low-memory phones get a smaller pool and lower emit rate.
export const CONE_PS_MAX_PARTICLES     = 700;    // was 1100 — trimmed for memory safety
export const CONE_PS_PER_SEC_MIN       = 200;
export const CONE_PS_PER_SEC_MAX       = 280;
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

export const EXPLOSION_PS_MAX_PARTICLES = 220;   // was 350 — trimmed for memory safety
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

// ---------- Collision visuals (impact-feedback bundle) ----------
// Differentiated visual feedback for the four collision flavors:
//   1. Soft landing → small dust puff at each foot
//   2. Crash       → velocity-scaled explosion + camera shake
//   3. Glancing terrain scrape → spark burst + small HP loss + bounce
//   4. Hard terrain hit → existing crash path
//
// All particle bursts reuse the EXPLOSION_PS pool via the emit(opts)
// overload in Particles.js. The IMPACT_VELOCITY_* anchors map a measured
// impact speed to a 0..1 scale used to lerp explosion size + shake amplitude.

// Impact-speed anchors (sqrt(velX² + velY²)). Speeds at or below SOFT
// produce minimal visual; at or above HARD the visuals saturate.
export const IMPACT_VELOCITY_SOFT = 10;
export const IMPACT_VELOCITY_HARD = 60;

// Soft-landing dust puff: gray, mostly horizontal, short-lived. Emitted
// twice (once per foot). Light-gray colors so it reads as moondust on
// the dark sky and not as fire.
export const DUST_PUFF_COUNT        = 18;
export const DUST_PUFF_COLOR_START  = 0xc8c0b0;
export const DUST_PUFF_COLOR_END    = 0x80766a;
export const DUST_PUFF_SPEED_MIN    = 10;
export const DUST_PUFF_SPEED_MAX    = 35;
export const DUST_PUFF_LIFETIME_MIN = 0.3;
export const DUST_PUFF_LIFETIME_MAX = 0.9;
export const DUST_PUFF_GRAVITY      = 0.2;

// Crash explosion scaling. count/speedMax/lifetimeMax all lerp from
// _MIN at IMPACT_VELOCITY_SOFT to _MAX at IMPACT_VELOCITY_HARD.
export const CRASH_EXPLOSION_COUNT_MIN = 100;
export const CRASH_EXPLOSION_COUNT_MAX = 320;
export const CRASH_EXPLOSION_SPEED_MAX_MIN = 80;
export const CRASH_EXPLOSION_SPEED_MAX_MAX = 220;
export const CRASH_EXPLOSION_LIFETIME_MAX_MIN = 2.5;
export const CRASH_EXPLOSION_LIFETIME_MAX_MAX = 5.0;

// Camera shake on crash. The amplitude is in world units (ortho camera
// frustum is 800×450 game units, so 6 ≈ 1.3% of width — visible but not
// disorienting). Linear decay over CRASH_SHAKE_DURATION seconds.
export const CRASH_SHAKE_BASE     = 6;     // amplitude at IMPACT_VELOCITY_SOFT
export const CRASH_SHAKE_PEAK_MUL = 2.5;   // amplitude at IMPACT_VELOCITY_HARD = base × this
export const CRASH_SHAKE_DURATION = 0.5;   // seconds

// Glancing terrain scrape — split out from outright crash so brushing a
// ridge sideways no longer instantly ends the run. The classifier compares
// the lander's velocity along the terrain segment normal: low-normal
// component means a graze, high means a real impact.
export const SCRAPE_VELOCITY_THRESHOLD = 25;  // m/s along segment normal
export const SCRAPE_DAMAGE_HP          = 5;
export const SCRAPE_BOUNCE             = 25;  // impulse along normal on graze
export const SCRAPE_PARTICLE_COUNT     = 18;
export const SCRAPE_COLOR_START        = 0xfff8a8;
export const SCRAPE_COLOR_END          = 0xff8030;
export const SCRAPE_SPEED_MIN          = 30;
export const SCRAPE_SPEED_MAX          = 110;
export const SCRAPE_LIFETIME_MIN       = 0.15;
export const SCRAPE_LIFETIME_MAX       = 0.45;
export const SCRAPE_GRAVITY            = 0.4;
export const SCRAPE_COOLDOWN_S         = 0.4;  // ignore further scrapes within this window

// ---------- Camera zoom near ground ----------
// When altitude drops below this threshold, the ortho camera zooms in and
// follows the lander for a tense final-approach view.
export const CAMERA_ZOOM_ALTITUDE = 100;
export const CAMERA_ZOOM_FACTOR   = 4;

// ---------- Audio timers ----------
export const FUEL_ALERT_INTERVAL_MS = 4000;        // beep cadence while low-fuel alert is active
export const COMMS_INTERVAL_MIN_MS  = 20000;       // morse chatter cadence
export const COMMS_INTERVAL_MAX_MS  = 40000;

// ---------- Mission Control text messages (Batch 2 #5) ----------
// Longer-form narrative beats keyed by event id. HUD.showMissionMessage()
// reads from this table; gameplay code fires by id at key moments. Each
// entry: { title, body }. The displayed time defaults to ~7 s but can be
// overridden per-call.
export const MISSION_MESSAGES = {
  firstLanding: {
    title: 'CAPCOM',
    body:  'Eagle, you are go. Welcome to the surface, commander. Stand by for surface ops.'
  },
  firstApollo: {
    title: 'MISSION CONTROL',
    body:  'Confirm Apollo artifact retrieval. Outstanding. Bring everything home.'
  },
  habitatReached: {
    title: 'CAPCOM',
    body:  'Habitat module is on emergency power but the medical bay is up. Top off your suit before heading out.'
  },
  fuelStowed: {
    title: 'MISSION CONTROL',
    body:  'Fuel transfer logged. Tanks read nominal. Cleared for the next ascent.'
  },
  partStowed: {
    title: 'MISSION CONTROL',
    body:  'Hull-repair part installed. Structural integrity restored. Nice work, commander.'
  },
  hullCritical: {
    title: 'CAPCOM',
    body:  'Warning — hull integrity below 25%. Recommend a repair part before any further descent attempts.'
  },
  achievementGeneric: {
    title: 'MISSION CONTROL',
    body:  'Achievement logged. The team back home is cheering for you.'
  },
  lowFuelReturn: {
    title: 'CAPCOM',
    body:  'Fuel below 30%. Recommend you return to the lander and stow whatever you have before another descent.'
  }
};

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
  },
  part: {
    label:  'REPAIR PART',
    prompt: 'PRESS E TO PICK UP REPAIR PART',
    color:  0x66ff88,
    hp:     25      // applied to GameState.lander.hp on stow at the lander
  },
  healthpack: {
    label:  'HEALTH PACK',
    prompt: 'PRESS E TO PICK UP HEALTH PACK',
    color:  0xff66aa,
    hp:     25      // applied immediately to GameState.astronaut.hp on pickup
  }
});

// Beginner pads — wide flat terrain segments advertised in 2D lander mode
// with a fuel-drum sprite floating above them. Identified by the pad's
// center-x in WORLD coordinates (after the TerrainData shift by HALF_WIDTH),
// so editing the terrain polyline doesn't require renumbering anywhere.
// A small tolerance handles sub-unit rounding. These pads roll multiplier=1
// (no bonus label) but guarantee a fuel drum appears next to the astronaut
// on disembark as a tangible reward for a clean landing.
export const BEGINNER_PAD_CENTERS = [
  -370,   // left bay:    15,12 → 45,12
  -215,   // middle mesa: 170,100 → 200,100
   125    // right plateau: 510,80 → 540,80
];
export const BEGINNER_PAD_TOLERANCE = 2;  // world units

// Minimum pad width (world units) for a flat segment to count as a real
// landing pad. Tiny sub-10-unit flats in the polyline (visual detail, not
// landable) are filtered out so they don't get multiplier labels.
export const MIN_PAD_WIDTH = 10;

// Apollo landing sites placed in walk mode at fixed positions. Each entry
// also drops a `part` (repair-part) interactable next to its landmark when
// the site is the current level's destination. Add 14/15/16/17 here and
// they'll auto-rotate by level (level→index mapping below).
export const APOLLO_SITES = [
  {
    id: 'apollo-11',
    name: 'APOLLO 11 (TRANQUILITY BASE)',
    walkPos: [110, -70],
    artifactScore: 300,
    comms: 'APOLLO 11 ARTIFACT COLLECTED — TRANQUILITY BASE'
  },
  {
    id: 'apollo-12',
    name: 'APOLLO 12 (OCEAN OF STORMS)',
    walkPos: [-90, -90],
    artifactScore: 350,
    comms: 'APOLLO 12 ARTIFACT COLLECTED — OCEAN OF STORMS'
  },
  {
    id: 'apollo-14',
    name: 'APOLLO 14 (FRA MAURO)',
    walkPos: [120, 90],
    artifactScore: 400,
    comms: 'APOLLO 14 ARTIFACT COLLECTED — FRA MAURO HIGHLANDS'
  },
  {
    id: 'apollo-15',
    name: 'APOLLO 15 (HADLEY-APENNINE)',
    walkPos: [-130, 100],
    artifactScore: 450,
    comms: 'APOLLO 15 ARTIFACT COLLECTED — HADLEY-APENNINE'
  },
  {
    id: 'apollo-16',
    name: 'APOLLO 16 (DESCARTES HIGHLANDS)',
    walkPos: [80, -140],
    artifactScore: 500,
    comms: 'APOLLO 16 ARTIFACT COLLECTED — DESCARTES HIGHLANDS'
  },
  {
    id: 'apollo-17',
    name: 'APOLLO 17 (TAURUS-LITTROW)',
    walkPos: [-150, -50],
    artifactScore: 550,
    comms: 'APOLLO 17 ARTIFACT COLLECTED — TAURUS-LITTROW VALLEY'
  }
];

/**
 * Maps GameState.level → APOLLO_SITES index for the "current Apollo
 * destination" the walk scene advertises (breadcrumb trail + repair-part
 * pickup). Out-of-range levels wrap, so once 14/15/16/17 are added the
 * loop keeps rotating destinations.
 */
export function apolloSiteForLevel(level) {
  if (APOLLO_SITES.length === 0) return null;
  return APOLLO_SITES[level % APOLLO_SITES.length];
}

// ---------- NASA 3D Resources model paths (Phase 8) ----------
// Files live under moonlander/assets/nasa_models/. Source repo:
//   https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models
// Code paths for each load are wrapped in try/catch + low-end skip, so
// missing files degrade gracefully to procedural primitives.
export const MODEL_PATHS = Object.freeze({
  apolloLM:     'assets/nasa_models/Apollo Lunar Module.glb',
  spacesuit:    'assets/nasa_models/Mercury Spacesuit.glb',
  habitat:      'assets/nasa_models/Habitat Demonstration Unit.glb',
  atlas6:       'assets/nasa_models/Atlas 6 (Friendship 7).glb',
  apollo11Site: 'assets/nasa_models/Apollo 11 - Landing Site.stl'
});

/**
 * Batch 5 #23: Per-Apollo terrain STL path for a given level. Returns
 * `assets/nasa_models/Apollo NN - Landing Site.stl` derived from the
 * site id. Caller is expected to attempt the path with `loadSTL` and
 * fall back to `MODEL_PATHS.apollo11Site` on a 404 — the only STL we
 * actually ship is Apollo 11. When NASA-3D-Resources STLs for 12/14/15
 * /16/17 are dropped into `assets/nasa_models/` matching this pattern,
 * each level swaps automatically with no further code change.
 */
export function apolloSiteStlPath(level) {
  const site = apolloSiteForLevel(level);
  if (!site) return null;
  // 'apollo-12' → '12'
  const num = (site.id || '').replace(/^apollo-/, '');
  if (!num) return null;
  return `assets/nasa_models/Apollo ${num} - Landing Site.stl`;
}

// Visible terrain tiles laid out in a 2×2 grid centered on the play area.
// Each tile is one mesh instance sharing the cached STL geometry; their xz
// positions in WORLD coords. The base sin-displaced plane sits underneath
// so the corners between tiles still have ground.
export const TERRAIN_TILE_POSITIONS = [
  [-150, -150], [150, -150],
  [-150,  150], [150,  150]
];
export const TERRAIN_TILE_SIZE = 240;   // target horizontal extent in world units
export const TERRAIN_TILE_SINK = 8;     // bury this many units below ground

// Curated set of items placed in level-1 walk mode (GameState.level === 0)
// at fixed [type, x, z] positions. The user asked for first-level continuity
// so a new player always has the same layout to learn from. Pad-kind extras
// (beginner pad → fuel drum near spawn, bonus pad → sample) still apply on
// top, so the same level can have variable bonus loot at the start spot.
// Higher levels (level >= 1) skip this set and rely solely on pad-kind loot
// + landmarks to keep variety.
export const LEVEL1_FIXED_LOOT = [
  ['fuel',    -22,  18],
  ['fuel',     34, -28],
  ['repair',   18,  40],
  ['sample',   -8, -36],
  ['sample',   45,  20],
  ['damaged',  -40, -10]
];

// Standalone landmark interactables placed in walk mode (not Apollo sites).
// Each spawns once per walk session, talks via the existing 'apollo'-style
// interactable contract (artifactScore + comms blip).
export const LANDMARKS = [
  {
    id: 'habitat-a',
    kind: 'habitat',
    model: 'habitat',
    walkPos: [-30, 60],
    score: 150,
    comms: 'HABITAT MODULE A — LIFE SUPPORT NOMINAL',
    name: 'HABITAT MODULE A',
    targetHeight: 5.5
  },
  {
    id: 'habitat-b',
    kind: 'habitat',
    model: 'habitat',
    walkPos: [-12, 60],
    score: 150,
    comms: 'HABITAT MODULE B — STORES READY',
    name: 'HABITAT MODULE B',
    targetHeight: 5.5
  },
  {
    id: 'atlas-6',
    kind: 'atlas',
    model: 'atlas6',
    walkPos: [80, 80],
    score: 250,
    comms: 'FRIENDSHIP 7 — MERCURY-ATLAS 6 LAUNCH VEHICLE',
    name: 'ATLAS 6 (FRIENDSHIP 7)',
    targetHeight: 14
  }
];

// ---------- Return-to-lander signposting ----------
// A tall yellow pillar planted at the parked-lander world position so the
// player can spot home from anywhere in the play area. Constants are
// inlined-pillar style (matches the destination-beacon in WalkMode.buildTrailMarkers).
export const LANDER_BEACON_COLOR    = 0xffee88;
export const LANDER_BEACON_HEIGHT   = 24;     // tall — visible past loot beacons
export const LANDER_BEACON_RADIUS   = 0.35;
export const LANDER_BEACON_OPACITY  = 0.7;

// "Cargo waiting in pack" reminder cadence — shown when the astronaut has
// items in `GameState.carrying` and is far from the lander. Spam-guarded
// by both a minimum gap between blips AND a minimum distance.
export const CARGO_REMINDER_INTERVAL_S = 30;
export const CARGO_REMINDER_MIN_DIST   = 30;

// Below this fuel-fraction the walk-mode CAPCOM panel fires once per walk
// session (cleared on WalkMode.enter via flags.lowFuelReturnFired).
export const LOW_FUEL_RETURN_FRAC = 0.3;

// ---------- Mission objectives (Phase 4) ----------
// Career objectives — apply to every run, every level. The predicate is
// evaluated against GameState after every notify(); the HUD pulls the
// current done/not-done state from GameState.objectives.
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

// Per-level mission objectives, keyed by APOLLO_SITES.id. WalkMode merges
// these with the career list so each Apollo destination has its own mini
// brief. Predicates use existing GameState fields + the new flags
// (apolloVisited, habitatVisited) and the partsStowed counter.
export const LEVEL_OBJECTIVES = {
  'apollo-11': [
    { id: 'visit-apollo-11', label: 'Visit Tranquility Base',
      predicate: s => s.flags.apolloVisited?.['apollo-11'] === true },
    { id: 'collect-2-samples', label: 'Collect 2 science samples',
      predicate: s => s.supplies.scienceSamples >= 2 }
  ],
  'apollo-12': [
    { id: 'visit-apollo-12', label: 'Visit Ocean of Storms',
      predicate: s => s.flags.apolloVisited?.['apollo-12'] === true },
    { id: 'stow-1-part', label: 'Stow a repair part at the lander',
      predicate: s => (s.stats.partsStowed | 0) >= 1 }
  ],
  'apollo-14': [
    { id: 'visit-apollo-14', label: 'Visit Fra Mauro Highlands',
      predicate: s => s.flags.apolloVisited?.['apollo-14'] === true },
    { id: 'heal-at-habitat', label: 'Heal at a habitat',
      predicate: s => s.flags.habitatVisited === true }
  ],
  'apollo-15': [
    { id: 'visit-apollo-15', label: 'Visit Hadley-Apennine',
      predicate: s => s.flags.apolloVisited?.['apollo-15'] === true },
    { id: 'stats-5-samples', label: 'Bank 5 science samples (career)',
      predicate: s => (s.stats.totalSamples | 0) >= 5 }
  ],
  'apollo-16': [
    { id: 'visit-apollo-16', label: 'Visit Descartes Highlands',
      predicate: s => s.flags.apolloVisited?.['apollo-16'] === true },
    { id: 'stow-3-parts', label: 'Stow 3 repair parts (career)',
      predicate: s => (s.stats.partsStowed | 0) >= 3 }
  ],
  'apollo-17': [
    { id: 'visit-apollo-17', label: 'Visit Taurus-Littrow Valley',
      predicate: s => s.flags.apolloVisited?.['apollo-17'] === true },
    { id: 'full-systems', label: 'Be at full hull AND full health',
      predicate: s => s.lander.hp === s.lander.maxHp &&
                      s.astronaut.hp === s.astronaut.maxHp }
  ]
};

// ---------- Progression (Phase 6) ----------
// Each successful landing bumps GameState.level. Progression.js reads these
// bases and scales effective gameplay values accordingly. Tuned so level 0
// is forgiving for first-time players and the classic tblazevic tolerances
// are approached by ~level 10.
export const DIFFICULTY_GRAVITY_PER_LEVEL       = 0.07;  // fractional gravity growth per level
export const DIFFICULTY_TOLERANCE_FLOOR         = 3.0;   // velocity-tolerance floor (was 2.0)
export const DIFFICULTY_TOLERANCE_STEP          = 0.3;   // steeper drop per level (was 0.2)
export const DIFFICULTY_EDGE_MARGIN_STEP        = 0.02;
export const DIFFICULTY_EDGE_MARGIN_CAP         = 0.44;  // slightly lower cap (was 0.48)
export const DIFFICULTY_SPAWN_VEL_BASE          = 60;
export const DIFFICULTY_SPAWN_VEL_STEP          = 8;
export const DIFFICULTY_FUEL_GAIN_STEP          = 15;
export const DIFFICULTY_FUEL_GAIN_FLOOR_FRAC    = 0.4;

// ---------- Achievements (Phase 6) ----------
// Definitions only — unlock logic lives in GameState.unlockAchievement()
// called from the gameplay modes.
export const ACHIEVEMENTS = [
  { id: 'first-landing',    title: 'FIRST LANDING',    description: 'Made it home safely.' },
  { id: 'perfect-landing',  title: 'PERFECT LANDING',  description: 'Feather touch on a bonus pad.' },
  { id: 'hot-swap-refuel',  title: 'HOT SWAP',         description: 'Refueled from a dangerously low tank.' },
  { id: 'sample-collector', title: 'SAMPLE COLLECTOR', description: 'Banked 10 science samples.' },
  { id: 'probe-rescuer',    title: 'PROBE RESCUER',    description: 'Fixed 3 damaged probes.' },
  { id: 'marathon',         title: 'MARATHON',         description: '10 successful landings in one run.' },
  { id: 'alien-visit',      title: 'CLOSE ENCOUNTER',  description: 'Met something on the surface that wasn’t in the briefing.' }
];

// ---------- Alien encounter (Batch 4 #12) ----------
// Walk-mode roaming hostile that occasionally fades in, drifts toward the
// astronaut, and swipes a single carried item before fading out. Tuned to
// feel surprising (not constant), so spawn is gated by level + dice roll
// each WalkMode.enter().
export const ALIEN_MIN_LEVEL          = 2;     // earliest level to spawn (0-indexed)
export const ALIEN_SPAWN_CHANCE       = 0.45;  // per qualifying walk session
export const ALIEN_WALK_SPEED         = 6.0;   // units/sec (astronaut speed = 18ish)
export const ALIEN_STEAL_RADIUS       = 3.5;   // distance at which a steal triggers
export const ALIEN_DETECTION_RADIUS   = 60;    // only chase when astronaut is in range
export const ALIEN_FADE_DURATION_S    = 1.4;   // fade in + fade out length
export const ALIEN_LIFETIME_S         = 60;    // safety despawn even without steal

// High-score board — how many entries we keep, the top-N leaderboard.
export const HIGH_SCORE_SLOTS = 10;

// Perfect-landing thresholds (every condition must hold).
export const PERFECT_FUEL_FRAC      = 0.95;   // >= 95% of capacity remaining
export const PERFECT_VELOCITY_MAX   = 0.5;    // speed squared threshold in m/s
export const PERFECT_CENTER_FRAC    = 0.12;   // within 12% of pad half-width of center
export const PERFECT_ANGLE_MAX      = 1.5 * (Math.PI / 180);

// Hot-swap achievement: land with fuel below this, refuel up past this.
export const HOT_SWAP_LOW_FUEL      = 100;
export const HOT_SWAP_HIGH_FUEL     = 800;

// ---------- Lander damage + repair (Phase 8 PR B) ----------
// The lander tracks an HP pool separate from fuel. Every crash takes a
// chunk; HP <= 0 means the craft is wrecked and the run ends. Repair
// parts collected at Apollo sites and stowed at the lander restore HP.
export const LANDER_MAX_HP        = 100;
export const LANDER_CRASH_DAMAGE  = 25;     // hp lost per crash
export const LANDER_REPAIR_PER_PART = 25;   // hp restored per repair part stowed

// ---------- Astronaut HP (Batch 1) ----------
// Walk-mode-only HP pool. No automatic damage source yet — habitats heal
// you, health packs at Apollo sites top you up. Future batches add
// drains (O₂ consumption, alien attacks). HP=0 doesn't end the run yet;
// it just stops you from picking things up until you heal.
export const ASTRO_MAX_HP         = 100;
export const HABITAT_HEAL_AMOUNT  = 20;     // hp restored per habitat visit (one-shot per habitat)
export const HEALTH_PACK_AMOUNT   = 25;     // hp restored per health-pack pickup

// ---------- Mode identifiers ----------
// Use strings so console logs and save files are human-readable.
export const MODE = Object.freeze({
  BOOT:       'BOOT',
  MENU:       'MENU',        // main menu / high-score board
  LANDER:     'LANDER',      // 2D-style side view, orthographic
  TRANSITION: 'TRANSITION',  // cinematic camera move
  WALK:       'WALK',        // 3D third-person
  PAUSED:     'PAUSED',
  GAME_OVER:  'GAME_OVER'
});
