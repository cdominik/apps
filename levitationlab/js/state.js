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
    aggHoldRevs: 0,
    aggCount: 0,
    aggMerging: null,
    showVectors: false,
    simSpeed: 1.0,
  };

  const heatmap = {
    enabled: false,
    mode: 'dispersion', // Default mode
    resolution: 30,
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
  const aggregateImages = [];
  for (let i = 0; i < 5; i++) {
    const img = new Image();
    img.src = `assets/aggregates/agg${i}.png`;
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
