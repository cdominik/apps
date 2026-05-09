/**
 * @file config.js
 * @description
 *   All tuning constants, simulation parameters, and colour palettes
 *   for the Levitation Lab.
 *
 * Exposes globals: TUNING, TUNING_DEFAULT, CFG, LASER_OMEGA,
 *                  PAL_DARK, PAL_LIGHT, PAL
 * Reads globals:   (none — this module has no dependencies)
 */
(() => {
  'use strict';

  // ============================================================
  // SECTION: TUNING & CONFIG
  // ============================================================
  const TUNING = {
    viewport: {
      slideDur:       2.0,   // s — time for the viewport panel to slide fully into view
      warmUpDur:      0.45,  // s — warm-up animation duration after the panel slides in
      crossfadeDur:   0.4,   // s — duration of the crossfade between viewport modes
      ruleEvalHz:     5,     // Hz — how often per second the display rules are re-evaluated
      switchDebounce: 1.0,   // s — minimum time between automatic viewport switches
      sizeCm:         120,   // cm — physical size hint used to compute pixel scale
      screenAspect:   4 / 3, // ratio — width-to-height aspect ratio of the viewport screen
      gapToWingPx:    8,     // px — gap between the viewport panel and the wing structure
      assetDir:       '',    // path prefix for asset files (images, maps)
    },
    splash: {
      enabled:     true,  // bool — master switch; set false to skip the splash screen entirely
      autoDismiss: 0,     // s — 0 = wait for tap; >0 = auto-dismiss after this many seconds
      onceOnly:    true,  // bool — if true, show only on first visit (persisted in localStorage)
    },
    drum: {
      slipRate:   0.7,               // fraction — particles slip against the wall at this fraction of drum velocity
      omegaDecay: 1.0 / 30.0,        // rad/s² — exponential decay rate of drum angular velocity
      swipeGain:  0.003,             // rad/s per px — swipe pixel distance to angular velocity conversion
      omegaMax:   2 * Math.PI * 1.5, // rad/s — maximum drum speed (1.5 rev/s)
    },
    highlight: {
      cx:     50, // drum-units — x-centre of the levitation highlight zone
      cy:     0,  // drum-units — y-centre of the levitation highlight zone
      radius: 50, // drum-units — radius of the levitation highlight zone
    },
    particle: {
      settleFloor: 2.0,        // drum-units — floor height above drum bottom where particles settle
      sizeRefVt:   30,         // cm/s — reference terminal velocity for particle size normalisation
      sizeMin:     0.55,       // drum-units — minimum rendered particle radius
      sizeMax:     1.8,        // drum-units — maximum rendered particle radius
      collisionR:  0.5,        // drum-units — collision radius for particle-particle interaction
      invincible:  false,      // bool — if true, particles cannot be lost from the drum
      showVtProjection: false, // bool — if true, show the Vt projection indicator on each particle
    },
    aggregate: {
      minLevitated:    30,    // count — minimum levitated particles to allow aggregate formation
      mergeCount:      10,    // count — particles consumed per aggregate merge event
      initialHoldRevs: 3,     // rev — drum revolutions a particle must stay levitated before the first aggregate
      subseqHoldRevs:  1,     // rev — hold revolutions required for each subsequent aggregate
      sizeMult:        10,    // multiplier — visual radius of aggregate relative to one particle
      mergeDur:        0.6,   // s — duration of the aggregate merge animation
      minSpread:       0.20,  // fraction — minimum angular spread of levitated particles to trigger aggregate
      vtFactor:        1.2,   // multiplier — Vt threshold multiplier during aggregate levitation check
      flashOrbit:      false, // bool — if true, flash the orbit ring when an aggregate forms
    },
    egg: {
      nCrit:      7,    // count — aggregates required to trigger pebble (golden-ball) formation
      holdTarget: 3,    // rev — hold revolutions before the first pebble merge
      holdSubseq: 3,    // rev — hold revolutions before each subsequent pebble merge
      maxBalls:   30,   // count — maximum golden pebbles allowed simultaneously
      mergeDur:   0.6,  // s — duration of the pebble merge animation
      minSpread:  0.30, // fraction — minimum angular spread of aggregates to allow pebble formation
    },
    ball: {
      gravity:      200,  // drum-units/s² — gravitational acceleration applied to golden balls
      radius:       2.5,  // drum-units — physical radius of each golden ball
      wallE:        0.85, // coefficient — restitution against drum wall (energy retained on bounce)
      wallFriction: 0.92, // coefficient — tangential velocity fraction retained after wall contact
      contactDrag:  0.7,  // coefficient — velocity damping while two balls are in contact
      ballE:        0.90, // coefficient — restitution in ball-ball collisions
      settleVel:    0.6,  // drum-units/s — speed below which a ball is considered settled
    },
    globe: {
      nCrit:         3,      // count — pebbles required to trigger globe (planet) formation
      radius:        12.5,   // drum-units — physical radius of each globe (5× pebble radius)
      mergeDur:      1.2,    // s — duration of the globe merge animation
      hoverY:        -50,    // drum-units — y hover position (0 = axis, −100 = bottom wall)
      rotationSpeed: 0.8,    // rad/s — self-rotation speed while globe is hovering
      repulsion:     15000,  // drum-units³/s² — repulsion force constant between globes
      limit:         7,      // count — maximum number of simultaneous globes
    },
    audio: {
      masterGain: 0.6,   // 0-1 — overall audio output volume
      millBlade:  0.085, // 0-1 — gain of the mill blade noise component
      millHiss:   0.10,  // 0-1 — gain of the mill hiss noise component
      millGrind:  0.85,  // 0-1 — gain of the mill grind noise component
      millThud:   0.20,  // 0-1 — gain of the mill thud impact component
      millBody:   0.035, // 0-1 — gain of the mill body resonance component
    },
    lidar: {
      backplateDim:   0.35,  // 0-1 — alpha multiplier for drum backplate in lidar mode
      highlightDim:   0.55,  // 0-1 — alpha multiplier for highlight zone in lidar mode
      stuckAlpha:     0.45,  // 0-1 — opacity of stuck (non-levitated) particles in lidar mode
      levitatedAlpha: 0.85,  // 0-1 — opacity of levitated particles in lidar mode
      flashDurMul:    1.6,   // multiplier — scales flash duration for lidar mode
      laserFanHalf:   0.040, // rad — half-angle of the laser fan beam
      laserAlphaMul:  1.5,   // multiplier — opacity boost applied to the laser beam drawing
    },
    trails: {
      durationS:  1.0,  // s — how long a trail segment persists before fading out
      maxN:       300,  // count — maximum trail segments stored per particle
      lineWidth:  1.5,  // px — stroke width of trail lines
      headAlpha:  0.85, // 0-1 — opacity at the newest (head) point of each trail
      tailAlpha:  0.0,  // 0-1 — opacity at the oldest (tail) point of each trail
    },
  };
  // Create a permanent backup of initial tuning values for restoration
  const TUNING_DEFAULT = JSON.parse(JSON.stringify(TUNING));

  const CFG = {
    R_DRUM: 100, R_AXIS: 5, DEPTH: 20, // drum-units — inner drum radius; axis hub radius; drum extrusion depth
    N_P: 3, V_T: 30, DT_INJECT: 1.0,   // count; cm/s; s — particles per inject event; terminal velocity; auto-inject interval
    VT_SPREAD: 0.10,                   // fraction — random ±spread applied to each particle's terminal velocity
    RELEASE_Y: 110, RELEASE_X_MIN: 0, RELEASE_X_MAX: 100, // drum-units — y position and x range where released particles appear
    BRAKE_DAMP: 1.2,                   // coefficient — extra velocity damping applied while the drum is braking
    MAX_DT: 0.033,                     // s — maximum allowed physics timestep (caps simulation at ~30 fps)
  };

  const LASER_OMEGA = 2 * Math.PI / 1.2;  // rad/s — laser sweep angular velocity: one full revolution in 1.2 s

  // ============================================================
  // SECTION: PALETTE
  // ============================================================
  const PAL_DARK = {
    name: 'dark',
    labBgSide: '#1c1c22',
    labRivet: true,
    gridStroke: 'rgba(255,255,255,0.03)',
    wingStops: [
      [0.00, '#1a1a22'],
      [0.05, '#3a3a42'],
      [0.20, '#4a4a52'],
      [0.50, '#2e2e34'],
      [0.85, '#1a1a22'],
      [1.00, '#0e0e14'],
    ],
    wingTopLine: 'rgba(255,255,255,0.22)',
    wingBotLine: 'rgba(0,0,0,0.9)',
    bandInner: '#6a6a72',
    bandMid1: '#3a3a42',
    bandMid2: '#55555c',
    bandOuter: '#202028',
    bandInnerLine: 'rgba(0,0,0,0.8)',
    bandOuterLine: 'rgba(200,200,210,0.35)',
    backplateInner: '#0e0e14',
    backplateMid:   '#080810',
    backplateOuter: '#030306',
    highlightFill:  '#22222a',
  };
  const PAL_LIGHT = {
    name: 'light',
    labBgSide: '#bab5a8',
    labRivet: true,
    gridStroke: 'rgba(60,50,30,0.05)',
    wingStops: [
      [0.00, '#9a968a'],
      [0.05, '#cfc9bc'],
      [0.20, '#d8d2c4'],
      [0.50, '#b0aa9c'],
      [0.85, '#888274'],
      [1.00, '#6a6558'],
    ],
    wingTopLine: 'rgba(255,255,255,0.55)',
    wingBotLine: 'rgba(0,0,0,0.35)',
    bandInner: '#b8b8c0',
    bandMid1: '#8a8a92',
    bandMid2: '#a0a0a8',
    bandOuter: '#5a5a62',
    bandInnerLine: 'rgba(30,30,40,0.7)',
    bandOuterLine: 'rgba(255,255,255,0.55)',
    backplateInner: '#0e0e14',
    backplateMid:   '#080810',
    backplateOuter: '#030306',
    highlightFill:  '#16161e',
  };

  window.TUNING        = TUNING;
  window.TUNING_DEFAULT = TUNING_DEFAULT;
  window.CFG           = CFG;
  window.LASER_OMEGA   = LASER_OMEGA;
  window.PAL_DARK      = PAL_DARK;
  window.PAL_LIGHT     = PAL_LIGHT;
  window.PAL           = PAL_DARK;
})();
