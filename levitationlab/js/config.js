/**
 * @file config.js
 * @description
 *   All tuning constants, simulation parameters, and colour palettes
 *   for the Levitation Lab.
 *
 * Exposes globals: TUNING, TUNING_DEFAULT, CFG, CHALLENGE_CFG,
 *                  LASER_OMEGA, PAL_DARK, PAL_LIGHT, PAL
 * Reads globals:   (none — this module has no dependencies)
 */
(() => {
  'use strict';

  // ============================================================
  // SECTION: TUNING
  // Physics, animation, and gameplay constants. All values are
  // backed up into TUNING_DEFAULT for restoration after overrides.
  // ============================================================

  const TUNING = {

    // --- Viewport panel (microscope / chart slide-in) ---
    viewport: {
      slideDur:       2.0,   // s     — time for the panel to slide fully into view
      warmUpDur:      0.45,  // s     — warm-up animation duration after sliding in
      crossfadeDur:   0.4,   // s     — crossfade duration between viewport modes
      ruleEvalHz:     5,     // Hz    — how often per second display rules are re-evaluated
      switchDebounce: 1.0,   // s     — minimum time between automatic viewport switches
      sizeCm:         120,   // cm    — physical size hint used to compute pixel scale
      screenAspect:   4 / 3, // ratio — width-to-height aspect ratio of the viewport screen
      gapToWingPx:    8,     // px    — gap between the viewport panel and the wing structure
      assetDir:       '',    //        path prefix for asset files (images, maps)
    },

    // --- Splash screen ---
    splash: {
      enabled:     true, // bool — master switch; set false to skip entirely
      autoDismiss: 0,    // s    — 0 = wait for tap; >0 = auto-dismiss after this many seconds
    },

    // --- Drum rotation ---
    drum: {
      slipRate:   0.7,          // fraction   — particles slip at this fraction of drum velocity
      omegaDecay: 1.0 / 30.0,  // rad/s²     — exponential decay rate of drum angular velocity
      swipeGain:  0.003,        // rad/s/px   — swipe pixel distance to angular velocity conversion

      // Game design ceiling — NOT the physical lab rate.
      // The real experiment runs at ~1 RPM (0.105 rad/s); that would make
      // levitation feedback far too slow for a player. 1.5 rev/s gives
      // immediate, satisfying response. This value also sets the orbit
      // integration timestep via DT_SUBSTEP in main.js.
      omegaMax: 2 * Math.PI * 1.5, // rad/s — maximum drum speed (1.5 rev/s)
    },

    // --- Levitation highlight zone ---
    highlight: {
      cx:     50, // drum-units — x-centre
      cy:     0,  // drum-units — y-centre
      radius: 50, // drum-units — radius
    },

    // --- Particles ---
    particle: {
      settleFloor:      2.0,   // drum-units — floor height above drum bottom where particles settle
      sizeRefVt:        30,    // cm/s       — reference terminal velocity for size normalisation
      sizeMin:          0.55,  // drum-units — minimum rendered particle radius
      sizeMax:          1.8,   // drum-units — maximum rendered particle radius
      collisionR:       0.5,   // drum-units — collision radius for particle-particle interaction
      invincible:       false, // bool       — if true, particles cannot be lost from the drum
      showVtProjection: false, // bool       — if true, show the Vt projection indicator
    },

    // --- Aggregate formation ---
    aggregate: {
      minLevitated:    30,    // count      — minimum levitated particles to allow aggregate formation
      mergeCount:      10,    // count      — particles consumed per aggregate merge event
      initialHoldRevs: 3,     // rev        — revolutions levitated before the first aggregate
      subseqHoldRevs:  1,     // rev        — revolutions required for each subsequent aggregate
      sizeMult:        10,    // multiplier — visual radius of aggregate relative to one particle
      mergeDur:        0.6,   // s          — duration of the aggregate merge animation
      minSpread:       0.20,  // fraction   — minimum vt spread required to trigger aggregate formation
      vtFactor:        1.2,   // multiplier — Vt threshold multiplier during aggregate levitation check
      vtGrowFactor:    1.05,  // multiplier — Vt kick per growth merge step
      brownian:        2.0,   // cm/s — random velocity kick applied each frame
      restoreK:        0.5,   // 1/s  — spring constant toward natural orbit centre

      flashOrbit:      false, // bool       — if true, flash the orbit ring when an aggregate forms
      growFlashDur:    2.5,   // time       - seconds the new orbit ring stays visible after merge

    },

    // --- Pebble (golden ball) formation ---
    egg: {
      nCrit:      7,    // count    — aggregates required to trigger pebble formation
      holdTarget: 3,    // rev      — hold revolutions before the first pebble merge
      holdSubseq: 3,    // rev      — hold revolutions before each subsequent pebble merge
      maxBalls:   30,   // count    — maximum golden pebbles allowed simultaneously
      mergeDur:   0.6,  // s        — duration of the pebble merge animation
      minSpread:  0.30, // fraction — minimum vt spread required to allow pebble formation
    },

    // --- Golden ball physics ---
    ball: {
      gravity:      200,  // drum-units/s² — gravitational acceleration applied to golden balls
      radius:       2.5,  // drum-units    — physical radius of each golden ball
      wallE:        0.85, // coefficient   — restitution against drum wall
      wallFriction: 0.92, // coefficient   — tangential velocity fraction retained after wall contact
      contactDrag:  0.7,  // coefficient   — velocity damping while two balls are in contact
      ballE:        0.90, // coefficient   — restitution in ball-ball collisions
      settleVel:    0.6,  // drum-units/s  — speed below which a ball is considered settled
    },

    // --- Globe (planet) formation ---
    globe: {
      nCrit:         3,      // count      — pebbles required to trigger globe formation
      radius:        12.5,   // drum-units — physical radius of each globe (5× pebble radius)
      mergeDur:      1.2,    // s          — duration of the globe merge animation
      hoverY:        -50,    // drum-units — y hover position (0 = axis, −100 = bottom wall)
      rotationSpeed: 0.8,    // rad/s      — self-rotation speed while hovering
      repulsion:     15000,  // drum-units³/s² — repulsion force constant between globes
      limit:         7,      // count      — maximum number of simultaneous globes
    },

    // --- Audio levels ---
    audio: {
      masterGain: 0.6,   // 0-1 — overall output volume
      millBlade:  0.085, // 0-1 — blade noise component
      millHiss:   0.10,  // 0-1 — hiss noise component
      millGrind:  0.85,  // 0-1 — grind noise component
      millThud:   0.20,  // 0-1 — thud impact component
      millBody:   0.035, // 0-1 — body resonance component
      aggMerge:   0.4,   // 0-1 - aggregate merge sound
    },

    // --- Lidar (laser scan) mode ---
    lidar: {
      backplateDim:   0.35,  // 0-1        — alpha multiplier for drum backplate in lidar mode
      highlightDim:   0.55,  // 0-1        — alpha multiplier for highlight zone in lidar mode
      stuckAlpha:     0.45,  // 0-1        — opacity of stuck particles in lidar mode
      levitatedAlpha: 0.85,  // 0-1        — opacity of levitated particles in lidar mode
      flashDurMul:    1.6,   // multiplier — scales flash duration in lidar mode
      laserFanHalf:   0.040, // rad        — half-angle of the laser fan beam
      laserAlphaMul:  1.5,   // multiplier — opacity boost applied to the laser beam
    },

    // --- Particle trails ---
    trails: {
      durationS:  1.0,  // s    — how long a trail segment persists before fading out
      maxN:       300,  // count — maximum trail segments stored per particle
      lineWidth:  1.5,  // px   — stroke width of trail lines
      headAlpha:  0.85, // 0-1  — opacity at the newest (head) point of each trail
      tailAlpha:  0.0,  // 0-1  — opacity at the oldest (tail) point of each trail
    },
    // --- Solar system ---
    solar: {
      inclCos:   0.3,                    // cos(60°) orbital tilt
      baseRadii: [11,17,24,31,37,42,50], // orbital radii per globe (drum-units)
      omegaBase: 3.006,                  // 2π/8 · 6^0.75 — Keplerian speed base
      showDur:   1.0,                    // s — new globe held at full size
      transDur:  3.0,                    // s — orbit transition animation
      orbitSize: 3.0,                    // visual radius when in orbit (drum-units)
      sizeMults: [1.0, 1.0, 1.0, 1.5, 0.8, 0.8, 0.8], // vary planet sizes
      maxR:      80.0,                   // max safe orbit radius from system centre
      persp:     0.10,                   // perspective size variation (±fraction)
      sunR:      3.5,                    // sun visual radius (drum-units)
    },
  };

  // Permanent backup of initial tuning values for restoration after overrides.
  const TUNING_DEFAULT = JSON.parse(JSON.stringify(TUNING));


  // ============================================================
  // SECTION: CFG
  // Core simulation dimensions and runtime defaults.
  // ============================================================

  const CFG = {
    // Drum geometry (drum-units)
    R_DRUM: 100, // inner drum radius
    R_AXIS: 5,   // axis hub radius
    DEPTH:  20,  // drum extrusion depth

    // Injection defaults
    N_P:       3,    // count  — particles per inject event
    V_T:       30,   // cm/s   — terminal velocity
    VT_SPREAD: 0.10, // fraction — random ±spread applied to each particle's terminal velocity
    DT_INJECT: 1.0,  // s      — injection interval

    // Release zone (drum-units)
    RELEASE_Y:     110, // y position where released particles appear
    RELEASE_X_MIN: 0,   // x range minimum
    RELEASE_X_MAX: 100, // x range maximum

    // Physics
    BRAKE_DAMP: 1.2,  // coefficient — extra velocity damping applied while the drum is braking

    // Maximum physics timestep before simSpeed scaling.
    // Must remain above DT_SUBSTEP (computed in main.js from omegaMax)
    // to avoid the substep count growing unboundedly at high simSpeed.
    MAX_DT: 0.033, // s
  };


  // ============================================================
  // SECTION: CHALLENGE DEFAULTS
  // Default parameters applied when entering Challenge Mode.
  // URL parameters (?np, ?vt, ?spread, ?dt) override selectively
  // on top of these values — see ui.js for the override logic.
  // ============================================================

  const CHALLENGE_CFG = {
    N_P:        300,  // count    — particles injected per challenge run
    V_T:        30,   // cm/s     — terminal velocity
    VT_SPREAD:  0.30, // fraction — spread wide enough to reach aggregate/pebble territory
    DT_INJECT:  3,    // s        — injection window
    TIME_LIMIT: 60,   // s        — hard ceiling after all particles are injected
  };


  // ============================================================
  // SECTION: LASER
  // ============================================================

  // One full revolution in 1.2 s — fast enough to scan the drum
  // several times per orbital period at typical play speeds.
  const LASER_OMEGA = 2 * Math.PI / 1.2; // rad/s


  // ============================================================
  // SECTION: PALETTES
  // Two built-in colour schemes: dark (default) and light.
  // PAL is initialised to PAL_DARK and switched by the theme toggle.
  // ============================================================

  const PAL_DARK = {
    name:      'dark',
    labBgSide: '#1c1c22',
    labRivet:  true,
    gridStroke: 'rgba(255,255,255,0.03)',
    wingStops: [
      [0.00, '#1a1a22'],
      [0.05, '#3a3a42'],
      [0.20, '#4a4a52'],
      [0.50, '#2e2e34'],
      [0.85, '#1a1a22'],
      [1.00, '#0e0e14'],
    ],
    wingTopLine:    'rgba(255,255,255,0.22)',
    wingBotLine:    'rgba(0,0,0,0.9)',
    bandInner:      '#6a6a72',
    bandMid1:       '#3a3a42',
    bandMid2:       '#55555c',
    bandOuter:      '#202028',
    bandInnerLine:  'rgba(0,0,0,0.8)',
    bandOuterLine:  'rgba(200,200,210,0.35)',
    backplateInner: '#0e0e14',
    backplateMid:   '#080810',
    backplateOuter: '#030306',
    highlightFill:  '#22222a',
  };

  const PAL_LIGHT = {
    name:      'light',
    labBgSide: '#bab5a8',
    labRivet:  true,
    gridStroke: 'rgba(60,50,30,0.05)',
    wingStops: [
      [0.00, '#9a968a'],
      [0.05, '#cfc9bc'],
      [0.20, '#d8d2c4'],
      [0.50, '#b0aa9c'],
      [0.85, '#888274'],
      [1.00, '#6a6558'],
    ],
    wingTopLine:    'rgba(255,255,255,0.55)',
    wingBotLine:    'rgba(0,0,0,0.35)',
    bandInner:      '#b8b8c0',
    bandMid1:       '#8a8a92',
    bandMid2:       '#a0a0a8',
    bandOuter:      '#5a5a62',
    bandInnerLine:  'rgba(30,30,40,0.7)',
    bandOuterLine:  'rgba(255,255,255,0.55)',
    backplateInner: '#0e0e14',
    backplateMid:   '#080810',
    backplateOuter: '#030306',
    highlightFill:  '#16161e',
  };


  // ============================================================
  // EXPORTS
  // ============================================================

  window.TUNING         = TUNING;
  window.TUNING_DEFAULT = TUNING_DEFAULT;
  window.CFG            = CFG;
  window.CHALLENGE_CFG  = CHALLENGE_CFG;
  window.LASER_OMEGA    = LASER_OMEGA;
  window.PAL_DARK       = PAL_DARK;
  window.PAL_LIGHT      = PAL_LIGHT;
  window.PAL            = PAL_DARK;
})();
