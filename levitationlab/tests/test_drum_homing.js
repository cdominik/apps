// Headless regression test for the drum return-to-home motion in
// js/physics.js (updateDrum homing branch + startDrumHoming).
//
// Extracts the real source, then sweeps start angles and spin speeds and
// verifies that every motion ends at rest exactly on a home angle
// (multiple of 2π), never reverses a spinning drum, and keeps the
// deceleration gentle. Fails (exit 1) on any violation.
//
// Run:  node tests/test_drum_homing.js
'use strict';
const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  process.argv[2] || path.join(__dirname, '..', 'js', 'physics.js'), 'utf8');
const a = SRC.indexOf('function updateDrum');
const b = SRC.indexOf('SECTION: PHYSICS — PARTICLES');
if (a < 0 || b < 0) { console.error('slice markers not found'); process.exit(1); }
const code = SRC.slice(a, b);

const TUNING = { drum: { slipRate: 0.7, omegaDecay: 1 / 30, omegaMax: 2 * Math.PI * 1.5 } };
const LASER_OMEGA = 0.5;
const state = { omega: 0, omegaTarget: 0, drumAngle: 0, laserAngle: 0, drumHoming: null };

// eslint-disable-next-line no-eval
const { updateDrum, startDrumHoming } =
  eval(code + '\n;({ updateDrum, startDrumHoming });');

const TWO_PI = 2 * Math.PI;
const dt = (TWO_PI / TUNING.drum.omegaMax) / 100; // base DT substep
let fails = 0, cases = 0;

for (const th0 of [0, 0.4, 1.7, Math.PI, 4.5, 6.2, -2.3, 37.7]) {
  for (const w0 of [0, 0.1, -0.2, 0.5, -1.0, 3.0, -5.0, 9.42]) {
    cases++;
    state.drumAngle = th0; state.omega = w0; state.omegaTarget = w0;
    state.drumHoming = null;
    startDrumHoming();

    let prevOm = state.omega, maxAcc = 0, t = 0, reversed = false;
    while (state.drumHoming && t < 20) {
      updateDrum(dt); t += dt;
      maxAcc = Math.max(maxAcc, Math.abs(state.omega - prevOm) / dt);
      if (Math.abs(w0) > 0.3 && state.omega * w0 < -1e-9) reversed = true;
      prevOm = state.omega;
    }
    const res     = ((state.drumAngle % TWO_PI) + TWO_PI) % TWO_PI;
    const home    = Math.min(res, TWO_PI - res) < 1e-6;
    const stopped = Math.abs(state.omega) < 1e-9;

    if (!(home && stopped && !reversed && maxAcc < 2.5)) {
      fails++;
      console.log(`FAIL th0=${th0} w0=${w0}: home=${home} stopped=${stopped} ` +
                  `reversed=${reversed} maxAcc=${maxAcc.toFixed(2)} t=${t.toFixed(1)}`);
    }
  }
}
console.log(fails ? `${fails}/${cases} cases FAIL` : `all ${cases} cases pass`);
process.exit(fails ? 1 : 0);
