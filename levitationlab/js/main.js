/**
 * @file main.js
 * @description
 *   Animation loop entry point. Drives the fixed-timestep physics sub-steps,
 *   slow-motion logic, rendering, HUD updates, and game/challenge tick.
 *   Kicks off the loop with the initial requestAnimationFrame call.
 *
 * Exposes globals: cancelEndingSequence
 * Reads globals:   CFG, TUNING, TUNING_DEFAULT, state,
 *                  slowMoArmed, updateDrum, updateTray, step, updateEgg,
 *                  updateAggregates, updateGlobe, updateSolar,
 *                  computeAutoOmega, updateMotorSound,
 *                  recordTrails, pollAggregateCounter,
 *                  updateViewport, draw, drawGlobes,
 *                  updateGauge, updateGame, updateChallenge,
 *                  showSheet, gameSheet
 */
(() => {
  'use strict';
  const gameSheet = document.getElementById('gameSheet');

  // ============================================================
  // SECTION: MAIN LOOP
  // ============================================================
  let lastT = performance.now() / 1000;
  let endingTimeout = null;

  // Strobe state — tracks last completed revolution index
  window.strobeOn = false;
  window._lastStrobeRev = 0;
  let _strobeShouldDraw = true;
  
  /**
   * Returns true once per drum revolution, used to gate stroboscopic rendering.
   * Falls through to true when drum is nearly stopped so screen never freezes.
   */
  function _strobeGate() {
    if (!window.strobeOn) return true;
    if (Math.abs(state.omega) < 0.08) return true;
    const rev = Math.floor(Math.abs(state.drumAngle) / (2 * Math.PI));
    if (rev !== window._lastStrobeRev) {
      window._lastStrobeRev = rev;
      return true;
    }
    return false;
  }
  /**
   * Runs one animation frame: advances physics sub-steps, renders, ticks HUD
   * and game logic, then schedules itself for the next frame.
   * Updated with a 10-second viewing delay upon reaching the globe limit.
   */
  function loop() {
    try {
      const now = performance.now() / 1000;
      let dt = now - lastT;
      lastT = now;

      // --- STABILIZED 5X SLOW MOTION LOGIC ---
      const isMerging = !!(state.eggMerging || state.aggMerging || state.globeMerging || state.aggGrowMerging);
      const applySlowMo = (typeof slowMoArmed !== 'undefined' && slowMoArmed && isMerging);

      if (applySlowMo) {
        dt /= 5;
      }

      if (dt > CFG.MAX_DT) dt = CFG.MAX_DT;
      
      // Warp speed
      dt *= state.simSpeed;
      // DT_SUBSTEP derived from omegaMax, which is a game-speed parameter,
      // not the physical lab rate — see config.js TUNING.drum.omegaMax.
      const DT_SUBSTEP = (2 * Math.PI / TUNING.drum.omegaMax) / 100;
      const sub = Math.max(1, Math.ceil(dt / DT_SUBSTEP));
      const h = dt / sub;

      if (!state.paused) {
        for (let i = 0; i < sub; i++) updateDrum(h);
        updateTray();   // advance armed → inserting → inserted each frame
      }
      if (state.running && !state.paused) { 
        for (let i = 0; i < sub; i++) step(h); 
        for (let i = 0; i < sub; i++) updateEgg(h);
        for (let i = 0; i < sub; i++) updateAggregates(h);
      }
      if (!state.paused) updateMotorSound();
      
      // Auto-omega: track the current distribution every frame
      // --- OMEGA CONTROL MODE ---
      const _wallNow = performance.now() / 1000;
      if (window.omegaCtlMode === 1) {
        // Auto: live tracking
        state.omegaTarget = computeAutoOmega();

      } else if (window.omegaCtlMode === 2) {
        const ls = window.launchState;
        if (ls === 'waiting') {
          const hasParticles = state.particles.length > 0 || state.toInject.length > 0;
          if (hasParticles && state.toInject.length === 0) {
            // Particles already in drum before launch armed — skip straight to spinup
            window.launchOmegaTgt = computeAutoOmega();
            window.launchState    = 'spinup';
          } else if (state.toInject.length > 0 && window.launchT0 === null) {
            window.launchTWait = window._computeOptimalWait();
            window.launchT0    = state.t;
            window.launchState = 'countdown';
          }
        } else if (ls === 'countdown') {
          if (state.t >= window.launchTWait) {
            window.launchOmegaTgt = computeAutoOmega();
            window.launchState    = 'spinup';
          }
        } else if (ls === 'spinup') {
          // Commit to this omega — do not track further
          state.omegaTarget  = window.launchOmegaTgt;
          // Spin-up is complete once omega is close enough to target
          if (Math.abs(state.omega - window.launchOmegaTgt) < window.launchOmegaTgt * 0.05) {
            setOmegaDecay(true);       // activate Ω lock — button turns on
            window.launchState = 'done';
          }
        }
        // 'done': fully hands-off, Ω lock is in control, nothing to do here
      }
      if (window.ghostModeOn) _ghostEnsureTarget();
      recordTrails();
      pollAggregateCounter();
      updateViewport(dt);
      _strobeShouldDraw = _strobeGate();
      if (_strobeShouldDraw) draw();
      updateGlobe(dt); 
      updateSolar();
      if (_strobeShouldDraw) drawGlobes();
      const _solarFinal = state.solar.phase === 'final_move' ||
            state.solar.phase === 'final_view';
      if (!_solarFinal && window.drawHints) drawHints();
      if (!_solarFinal && window.drawTimeline) window.drawTimeline();

      updateGauge();
      updateGame();
      updateChallenge();
      if (window.takeSnapshot) window.takeSnapshot();
      if (window.updateHints && Math.floor(state.t * 4) !== Math.floor((state.t - dt) * 4)) updateHints(); // cooled to a 4 Hz update.

      // --- UNIVERSAL SUCCESS CHECK ---
      // Delay the "End of Game" overlay to allow viewing the final system
      
    } catch (e) {
      console.error('[loop]', e);
    }
    requestAnimationFrame(loop);
  }
  loop();

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.applyGrowthStage === 'function') {
      window.applyGrowthStage(0);
    } else {
      console.error('applyGrowthStage not found. Check if ui.js is loaded.');
    }
  });

  window.cancelEndingSequence = () => {
    if (endingTimeout) { clearTimeout(endingTimeout); endingTimeout = null; }
    state._endingSequenceTriggered = false;
  };
})();
