// Headless regression test for the launch planner in js/physics.js.
//
// Extracts computeAutoOmega + the OPTIMAL LAUNCH PLANNER section verbatim
// from the source (so it always tests the real code), runs it against a
// mocked game state for several vt distributions, and compares against the
// legacy KDE strategy. Fails (exit 1) if a plan's shadow prediction is not
// reproducible or if the planner underperforms the legacy heuristic.
//
// Run:  node tests/test_launch_planner.js
'use strict';
const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  process.argv[2] || path.join(__dirname, '..', 'js', 'physics.js'), 'utf8');
const a = SRC.indexOf('function computeAutoOmega');
const b = SRC.indexOf('SECTION: PHYSICS — COLLECTION TRAY');
if (a < 0 || b < 0) { console.error('slice markers not found'); process.exit(1); }
const code = SRC.slice(a, b);

// --- mocks -------------------------------------------------------------
const CFG = {
  R_DRUM: 100, RELEASE_Y: 110, RELEASE_X_MIN: 0, RELEASE_X_MAX: 100,
  EXT_X_MIN: -2, EXT_X_MAX: 98, EXT_Y_TOP: 113.5,
  V_T: 30, VT_SPREAD: 0.10, N_P: 300, DT_INJECT: 3, NOZZLE_FOCUS: 18,
};
const TUNING = {
  highlight: { cx: 50, cy: 0, radius: 50 },
  particle:  { collisionR: 0.5, settleFloor: 2.0 },
  drum:      { slipRate: 0.7, omegaDecay: 1 / 30, omegaMax: 2 * Math.PI * 1.5 },
  aggregate: { minLevitated: 30, spreadThresh: 0.50 },
};
const state = {
  t: 0, omega: 0, drumAngle: 0, particles: [], toInject: [],
  distMode: 'default', distParams: {
    bi:    { vt1: 20, s1: 0.1, vt2: 55, s2: 0.1, ratio: 1 },
    power: { vtMin: 10, vtMax: 80, index: -1 },
  },
};

// eslint-disable-next-line no-eval
const { computeAutoOmega, _shadowLaunch, _computeOptimalLaunch } =
  eval(code + '\n;({ computeAutoOmega, _shadowLaunch, _computeOptimalLaunch });');

// --- queue generation (mirrors scheduleInjections) ----------------------
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const NOZZLE_SLOT_W = 18;
const nozzleCentreX = k => 5 + (k + 0.5) * NOZZLE_SLOT_W;

function makeQueue(N, dist) {
  const q = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * CFG.DT_INJECT;
    const x = nozzleCentreX(i % 5) + (Math.random() - 0.5) * CFG.NOZZLE_FOCUS;
    let vt;
    if (dist === 'power') {
      const { vtMin: v0, vtMax: v1, index: qq } = state.distParams.power;
      const u = Math.random();
      vt = Math.abs(qq + 1) < 1e-6
        ? v0 * Math.pow(v1 / v0, u)
        : Math.pow(u * (Math.pow(v1, qq + 1) - Math.pow(v0, qq + 1)) + Math.pow(v0, qq + 1), 1 / (qq + 1));
    } else if (dist === 'bi') {
      const p = state.distParams.bi;
      vt = Math.random() < p.ratio / (1 + p.ratio)
        ? p.vt1 * (1 + p.s1 * randn()) : p.vt2 * (1 + p.s2 * randn());
    } else {
      vt = CFG.V_T * (1 + CFG.VT_SPREAD * randn());
    }
    if (vt < TUNING.particle.settleFloor) vt = TUNING.particle.settleFloor;
    q.push({ t, x, vt });
  }
  q.sort((p, r) => p.t - r.t);
  return q;
}

// --- legacy strategy (pre-planner, for comparison) -----------------------
function oldComputeOptimalWait() {
  const arrivals = state.toInject.map(p => p.t + CFG.RELEASE_Y / p.vt);
  if (arrivals.length === 0) return 0;
  const n    = arrivals.length;
  const mean = arrivals.reduce((s, v) => s + v, 0) / n;
  const sig  = Math.sqrt(Math.max(0.01, arrivals.reduce((s, v) => s + (v - mean) ** 2, 0) / n));
  const bw   = 1.06 * sig * Math.pow(n, -0.2);
  const tMin = Math.min(...arrivals), tMax = Math.max(...arrivals);
  let bestT = mean, bestK = -1;
  for (let i = 0; i <= 60; i++) {
    const t = tMin + (i / 60) * (tMax - tMin);
    let k = 0;
    for (const v of arrivals) { const z = (t - v) / bw; k += Math.exp(-0.5 * z * z); }
    if (k > bestK) { bestK = k; bestT = t; }
  }
  return Math.max(0, bestT - 1.0 / TUNING.drum.slipRate);
}

// --- run scenarios -------------------------------------------------------
const scenarios = [
  ['default gaussian 10% spread', 'default', () => { CFG.VT_SPREAD = 0.10; }],
  ['gaussian 30% spread',         'default', () => { CFG.VT_SPREAD = 0.30; }],
  ['bimodal 20/55',               'bi',      () => {}],
  ['power law q=-1, 10..80',      'power',   () => {}],
];

const TRIALS = 5, N = 300;
let failures = 0;
for (const [name, dist, setup] of scenarios) {
  setup();
  state.distMode = dist;
  let oldC = 0, newC = 0, planMs = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    state.toInject = makeQueue(N, dist);
    state.particles = []; state.t = 0; state.omega = 0; state.drumAngle = 0;

    const oldRes = _shadowLaunch(computeAutoOmega(), oldComputeOptimalWait());

    const t0 = Date.now();
    const plan = _computeOptimalLaunch();
    planMs += Date.now() - t0;

    // The returned prediction must be reproducible with the same plan.
    const check = _shadowLaunch(plan.omega, plan.tCmd);
    if (check.count !== plan.count) {
      console.error(`  !! prediction mismatch: plan=${plan.count} check=${check.count}`);
      failures++;
    }
    oldC += oldRes.count;
    newC += plan.count;
  }
  const ok = newC >= oldC;  // planner must not underperform the legacy heuristic
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: legacy=${(oldC / TRIALS).toFixed(1)} ` +
              `planner=${(newC / TRIALS).toFixed(1)} captured (plan ~${(planMs / TRIALS).toFixed(0)} ms)`);
}
console.log(failures ? `\n${failures} FAILURES` : '\nall scenarios pass');
process.exit(failures ? 1 : 0);
