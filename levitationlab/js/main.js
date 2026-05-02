/**
 * @file main.js
 * @description
 *   Animation loop entry point. Drives the fixed-timestep physics sub-steps,
 *   slow-motion logic, rendering, HUD updates, and game/challenge tick.
 *   Kicks off the loop with the initial requestAnimationFrame call.
 *
 * Exposes globals: (none)
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

  // ============================================================
  // SECTION: MAIN LOOP
  // ============================================================
  let lastT = performance.now() / 1000;
  /**
   * Runs one animation frame: advances physics sub-steps, renders, ticks HUD
   * and game logic, then schedules itself for the next frame.
   */
  function loop() {
    try {
      const now = performance.now() / 1000;
        let dt = now - lastT
      lastT = now;

      // --- STABILIZED 5X SLOW MOTION LOGIC ---
      // Check if ANY merge is happening
      const isMerging = !!(state.eggMerging || state.aggMerging || state.globeMerging);
      const applySlowMo = (typeof slowMoArmed !== 'undefined' && slowMoArmed && isMerging);

      if (applySlowMo) {
        // 1. Slow down the global physics heartbeat by 5x
        dt /= 5; 
        
        // 2. Ensure animation durations stay at standard lab-spec[cite: 2]
        // Standard durations naturally take 5x longer because the clock (dt) is 5x slower
        TUNING.egg.mergeDur = TUNING_DEFAULT.egg.mergeDur;
        TUNING.aggregate.mergeDur = TUNING_DEFAULT.aggregate.mergeDur;
        TUNING.globe.mergeDur = TUNING_DEFAULT.globe.mergeDur;
      } else {
        // Restore standard speeds[cite: 2]
        TUNING.egg.mergeDur = TUNING_DEFAULT.egg.mergeDur;
        TUNING.aggregate.mergeDur = TUNING_DEFAULT.aggregate.mergeDur;
        TUNING.globe.mergeDur = TUNING_DEFAULT.globe.mergeDur;
      }

      if (dt > CFG.MAX_DT) dt = CFG.MAX_DT;
      // Warp speed
      dt *= state.simSpeed;
      const sub = Math.max(1, Math.ceil(dt / 0.01));
      const h = dt / sub;
      
      for (let i = 0; i < sub; i++) updateDrum(h);
      if (state.running) { for (let i = 0; i < sub; i++) step(h); }
      for (let i = 0; i < sub; i++) updateEgg(h);
      for (let i = 0; i < sub; i++) updateAggregates(h);
      
      updateMotorSound();
      recordTrails();
      pollAggregateCounter();
      updateViewport(dt);
      draw();
      updateGlobe(dt); 
      drawGlobes();    
      updateHUD();
      updateGame();
      updateChallenge();

      // --- UNIVERSAL SUCCESS CHECK ---
      if (state.globes.length >= TUNING.globe.limit && gameSheet.hidden) {
          state.running = false; 
          setTimeout(() => {
              showSheet(
                  "LIMIT OF SIMULATION SPACE REACHED", 
                  "Many planets, and you are still playing? Time to go do something else!", 
                  "Reset Lab", 
                  () => { 
                      gameSheet.hidden = true;
                      btnReset.click(); 
                  }
              );
          }, 1000);
      }
    } catch (e) {
      console.error('[loop]', e);
    }
    requestAnimationFrame(loop);
  }

  // Kick off the animation loop
  requestAnimationFrame(loop);
})();
