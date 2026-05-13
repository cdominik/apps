/**
 * @file main.js
 * @description
 *   Animation loop entry point. Drives the fixed-timestep physics sub-steps,
 *   slow-motion logic, rendering, HUD updates, and game/challenge tick.
 *   Kicks off the loop with the initial requestAnimationFrame call.
 *
 * Exposes globals: cancelEndingSequence
 * Reads globals:   CFG, TUNING, TUNING_DEFAULT, state,
 *                  slowMoArmed, updateDrum, step, updateEgg,
 *                  updateAggregates, updateGlobe, updateMotorSound,
 *                  recordTrails, pollAggregateCounter,
 *                  updateViewport, draw, drawGlobes,
 *                  updateHUD, updateGame, updateChallenge,
 *                  showSheet, gameSheet, TUNING_DEFAULT
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
  let _lastStrobeRev = 0;
  let _strobeShouldDraw = true;
  
  /**
   * Returns true once per drum revolution, used to gate stroboscopic rendering.
   * Falls through to true when drum is nearly stopped so screen never freezes.
   */
  function _strobeGate() {
    if (!window.strobeOn) return true;
    if (Math.abs(state.omega) < 0.08) return true; // drum nearly stopped — render freely
    const rev = Math.floor(Math.abs(state.drumAngle) / (2 * Math.PI));
    if (rev !== _lastStrobeRev) {
      _lastStrobeRev = rev;
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
      }
      if (state.running && !state.paused) { 
        for (let i = 0; i < sub; i++) step(h); 
        for (let i = 0; i < sub; i++) updateEgg(h);
        for (let i = 0; i < sub; i++) updateAggregates(h);
      }
      if (!state.paused) updateMotorSound();
      
      // Auto-omega: track the current distribution every frame
      if (window.autoOmegaOn) {
        state.omegaTarget = computeAutoOmega();
      }
      recordTrails();
      pollAggregateCounter();
      updateViewport(dt);
      _strobeShouldDraw = _strobeGate();
      if (_strobeShouldDraw) draw();
      updateGlobe(dt); 
      updateSolar();
      if (_strobeShouldDraw) drawGlobes();
      updateHUD();
      updateGame();
      updateChallenge();

      // --- UNIVERSAL SUCCESS CHECK ---
      // Delay the "End of Game" overlay to allow viewing the final system
      if (state.globes.length >= TUNING.globe.limit && gameSheet.hidden && state.solar.phase === 'none') {

          // Stop physics updates so planets hover in place
          state.running = false; 

          // Trigger sequence only once
          if (!state._endingSequenceTriggered) {
              state._endingSequenceTriggered = true;

              endingTimeout = setTimeout(() => {
                endingTimeout = null;
                showSheet(
                    "LIMIT OF SIMULATION SPACE REACHED",
                    "Many planets, and you are still playing? Time to go do something else!",
                    "Reset Lab",
                    () => {
                        gameSheet.hidden = true;
                        state._endingSequenceTriggered = false;
                        document.getElementById('btnReset').click();
                    }
                );
            }, 10000);
          }
      }
    } catch (e) {
      console.error('[loop]', e);
    }
    requestAnimationFrame(loop);
  }
  loop();
  window.cancelEndingSequence = () => {
    if (endingTimeout) { clearTimeout(endingTimeout); endingTimeout = null; }
    state._endingSequenceTriggered = false;
  };
})();
