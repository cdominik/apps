/**
 * @file state.js
 * @description
 *   Runtime simulation state (particles, aggregates, golden balls, globes,
 *   heatmap accumulators) and image asset arrays.
 *
 * Exposes globals: state, heatmap, aggregateImages, globeMaps
 * Reads globals:   (none — this module has no dependencies)
 */
(() => {
  'use strict';

  // ============================================================
  // SECTION: STATE
  // ============================================================
  const state = {
    running: false, particles: [], toInject: [],
    t: 0, omega: 0, omegaTarget: 0, drumAngle: 0,
    laserAngle: 0, laserOn: false,
    trailsOn: false,
    pointers: new Map(), holding: false,
    puffs: [],
    lostCount: 0,
    eggHoldRevs: 0,
    eggBallCount: 0,
    eggMerging: null,
    goldenBalls: [],
    globes: [],
    globeMerging: null,
    aggregates: [],
    aggGrowMerging: null,
    aggHoldRevs: 0,
    aggCount: 0,
    aggMerging: null,
    showVectors: false,
    simSpeed: 1.0,
    orbitSample: [],
    lastOrbitUpdate: 0,
    distMode: 'default',
    distLabels: {
      'default': null,      // Null tells HUD to use standard SETTINGS labels
      'bi': 'BiDisp',
      'power': 'PowLaw'
    },
    distParams: {
      bi: { 
        vt1: 10, s1: 0.00, 
        vt2: 40, s2: 0.00, 
        ratio: 1.0 
      },
      power: { vtMin: 5, vtMax: 50, index: -3.5 }
    },
    solar: {
      phase:       'none', // none|showing|transitioning|orbiting|spindown|final_move|final_view
      wallT:       0,      // real wall-time accumulator (independent of simSpeed)
      _lastT:      0,      // last performance.now() sample
      phaseStart:  0,      // wallT when current phase started
      orbits:      [],     // per-globe: {r, theta, omega, startX, startY, inOrbit}
      pendingIdx:  -1,     // index of globe currently being shown full-size
      centerX:     0,      // system centre x (drum-units)
      centerY:     -50,    // system centre y; rises to 0 in final_move
      scale:       1.0,    // current system scale
      startScale:  1.0,    // scale at start of current transition
      targetScale: 1.0,    // scale target for current transition
      sunAlpha:    0,      // sun/orbit-ring opacity (0–1)
      probes:        [],
      probesLaunched: false,
    },
  };

  const heatmap = {
    enabled: false,
    mode: 'dispersion', // Default mode
    resolution: 50,
    data: [],       // Stores finalized sigma (Dispersion)
    densData: [],   // Stores finalized density
    prodData: [],   // Stores finalized product
    accN: [],
    accV: [],
    accV2: [],
    lastAngle: 0,
    angleProgress: 0,
    tickCount: 0,
    maxSigma: 0,
    maxDensity: 0,
    maxProduct: 0,
    opacity: 0.5,
    ready: false,
  };

  // Initialize the grid arrays
  const gridSize = heatmap.resolution * heatmap.resolution;
  heatmap.data     = new Float32Array(gridSize);
  heatmap.densData = new Float32Array(gridSize);
  heatmap.prodData = new Float32Array(gridSize);
  heatmap.accN     = new Int32Array(gridSize);
  heatmap.accV     = new Float32Array(gridSize);
  heatmap.accV2    = new Float32Array(gridSize);

  // ============================================================
  // SECTION: ASSET LOADING
  // ============================================================
// Replace the current aggregate image loop:
  const aggregateImages = [];
  for (let i = 1; i <= 10; i++) {
      const img = new Image();
      img.src = `assets/aggregates/agg${i * 10}.png`;
      aggregateImages.push(img);
  }
  // Initialize 7 maps
  const globeMaps = [];
  for (let i = 0; i <= 6; i++) {
    const img = new Image();
    img.src = `assets/maps/map${i}.jpg`;
    globeMaps.push(img);
  }

  window.state           = state;
  window.heatmap         = heatmap;
  window.aggregateImages = aggregateImages;
  window.globeMaps       = globeMaps;
})();
