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
   * Updated with a 10-second viewing delay upon reaching the globe limit.
   */
  function loop() {
    try {
      const now = performance.now() / 1000;
      let dt = now - lastT;
      lastT = now;

      // --- STABILIZED 5X SLOW MOTION LOGIC ---
      const isMerging = !!(state.eggMerging || state.aggMerging || state.globeMerging);
      const applySlowMo = (typeof slowMoArmed !== 'undefined' && slowMoArmed && isMerging);

      if (applySlowMo) {
        dt /= 5;
      }

      if (dt > CFG.MAX_DT) dt = CFG.MAX_DT;
      
      // Warp speed
      dt *= state.simSpeed;
      const sub = Math.max(1, Math.ceil(dt / 0.01));
      const h = dt / sub;
      
      for (let i = 0; i < sub; i++) updateDrum(h);
      if (state.running) { 
        for (let i = 0; i < sub; i++) step(h); 
        for (let i = 0; i < sub; i++) updateEgg(h);
        for (let i = 0; i < sub; i++) updateAggregates(h);
      }
      
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
      // Delay the "End of Game" overlay to allow viewing the final system
      if (state.globes.length >= TUNING.globe.limit && gameSheet.hidden) {
          // Stop physics updates so planets hover in place
          state.running = false; 

          // Trigger sequence only once
          if (!state._endingSequenceTriggered) {
              state._endingSequenceTriggered = true;

              setTimeout(() => {
                  showSheet(
                      "LIMIT OF SIMULATION SPACE REACHED", 
                      "Many planets, and you are still playing? Time to go do something else!", 
                      "Reset Lab", 
                      () => { 
                          gameSheet.hidden = true;
                          state._endingSequenceTriggered = false; 
                          // Using the Reset button logic to clean the lab
                          document.getElementById('btnReset').click(); 
                      }
                  );
              }, 10000); // 10 second delay
          }
      }
    } catch (e) {
      console.error('[loop]', e);
    }
    requestAnimationFrame(loop);
  }
  loop();
  })();
