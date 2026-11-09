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
 *                  updateAggregates, refreshAggFormGate, updateGlobe, updateSolar,
 *                  computeAutoOmega, _computeOptimalLaunch, showToast,
 *                  updateMotorSound,
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
      // Adaptive physics substep. The orbit integration error scales with
      // (omega*h)^2, so target the same omega*h the fixed step had at
      // omegaMax and relax h when the drum turns slower. Caps: at most 4x
      // the base step (wall-crossing detection for fast settlers), and the
      // base step whenever golden pebbles are loose (their ball physics
      // needs the fine step to resolve collisions).
      const DT_BASE = (2 * Math.PI / TUNING.drum.omegaMax) / 100;
      const omRef = Math.max(Math.abs(state.omega), Math.abs(state.omegaTarget), 1e-9);
      let maxH = DT_BASE * Math.min(4, TUNING.drum.omegaMax / omRef);
      if (state.goldenBalls.length > 0) maxH = DT_BASE;
      const sub = Math.max(1, Math.ceil(dt / maxH));
      const h = dt / sub;

      if (!state.paused) {
        for (let i = 0; i < sub; i++) updateDrum(h);
        updateTray();   // advance armed → inserting → inserted each frame
      }
      if (state.running && !state.paused) { 
        refreshAggFormGate();   // per-frame spread check, not per substep
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
          // While the drum is still returning to its start position, hold
          // off planning — the plan depends on the resting drum angle.
          if (hasParticles && window.launchT0 === null && !state.drumHoming) {
            // Plan the launch over the queue plus anything already falling:
            // optimal spin-up moment AND target omega (see _computeOptimalLaunch).
            const plan = window._computeOptimalLaunch();
            window.launchTWait    = plan.tCmd;
            window.launchOmegaTgt = plan.omega;
            window.launchT0       = state.t;
            window.launchState    = 'countdown';
            if (window.showToast) {
              showToast(`Launch plan: Ω = ${plan.omega.toFixed(2)} rad/s in ` +
                        `${Math.max(0, plan.tCmd - state.t).toFixed(1)} s — ` +
                        `${plan.count} captures predicted`, 3000);
            }
          }
        } else if (ls === 'countdown') {
          if (state.t >= window.launchTWait) {
            // launchOmegaTgt was planned at arm time
            window.launchState = 'spinup';
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
