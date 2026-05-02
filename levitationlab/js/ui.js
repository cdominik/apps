/**
 * @file ui.js
 * @description
 *   All user-interface wiring: pointer/swipe input, omega controls, main
 *   button handlers, splash screen, expert panel buttons (HUD master, process
 *   toggles, system controls), and the expert door URL-flag logic.
 *   Also owns the Expert Analysis Controller (hudMasterOn, heatmap mode).
 *
 * Exposes globals: slowMoArmed (window), resetExpertUI (window),
 *                  bumpOmega, wirePressHold
 * Reads globals:   TUNING, TUNING_DEFAULT, CFG, PAL, state, heatmap,
 *                  SETTINGS, SEL_WIN, applyInitialSettings,
 *                  GAME, CHALLENGE, VIEWPORT,
 *                  initLevel, startRelease, scheduleInjections,
 *                  ensureAudio, soundMillStart, soundSnap, soundTink,
 *                  layout, buildOmegaControls, draw,
 *                  cv, W, H, ctxOv, CX, CY, SCALE, REGIME,
 *                  enterGameMode, enterChallengeMode, lockSelectors,
 *                  updateHUD, updateAnalysisInstrument (internal)
 */
(() => {
  'use strict';

  // SECTION: FEATURE FLAGS
  // ============================================================
  let isExpertURL = false;
  let isDesignerURL = false;

  // ============================================================
  // SECTION: EXPERT ANALYSIS CONTROLLER
  // ============================================================
  const ANALYSIS_MODES = ['vectors', 'dispersion', 'density', 'product'];
  let currentAnalysisIdx = 0;
  let hudMasterOn = false;

  /**
   * Syncs the expert HUD master button state and activates the selected analysis mode.
   * isActivation=true resets the accumulation buffers (only on fresh HUD power-on).
   */
  function updateAnalysisInstrument(isActivation = false) {
    const btnPrev = document.getElementById('btnModePrev');
    const btnNext = document.getElementById('btnModeNext');
    const btnMaster = document.getElementById('btnHudMaster');

    if (!btnPrev || !btnNext || !btnMaster) return;

    state.showVectors = false;

    btnPrev.classList.toggle('disabled', !hudMasterOn);
    btnNext.classList.toggle('disabled', !hudMasterOn);
    btnMaster.classList.toggle('on', hudMasterOn);

    if (!hudMasterOn) {
        heatmap.enabled = false;
        ctxOv.clearRect(0, 0, W, H);
        return;
    }

    // Keep heatmap collecting for all three maps whenever HUD is on.
    // Only wipe the buffers when the HUD is freshly powered on.
    heatmap.enabled = true;
    if (isActivation) {
      heatmap.ready = false;
      heatmap.accN.fill(0);
      heatmap.accV.fill(0);
      heatmap.accV2.fill(0);
      heatmap.angleProgress = 0;
      heatmap.tickCount = 0;
    }

    const mode = ANALYSIS_MODES[currentAnalysisIdx];
    if (mode === 'vectors') {
      state.showVectors = true;
    } else {
      heatmap.mode = mode;
    }
  }
  window.resetExpertUI = function() {
    hudMasterOn = false;
    updateAnalysisInstrument();
  };

  // ============================================================
  // ============================================================
  // SECTION: INPUT — POINTER & SWIPE
  // ============================================================
  /**
   * Converts window pointer coordinates to drum simulation coordinates.
   *
   * @param {number} clientX - Horizontal pointer position in window pixels
   * @param {number} clientY - Vertical pointer position in window pixels
   * @returns {{x: number, y: number}} Simulation-space coordinates
   */
  function getLocalCoords(clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    return { x: (clientX - rect.left - CX) / SCALE, y: (CY - (clientY - rect.top)) / SCALE };
  }
  /**
   * Returns true if pixel coords (x, y) fall within the drum or surrounding steel band.
   *
   * @param {number} x - Simulation-space x coordinate
   * @param {number} y - Simulation-space y coordinate
   * @returns {boolean} True when the point is inside the drum or band radius
   */
  function insideDrumOrBand(x, y) {
    const rMax = CFG.R_DRUM * 1.34;
    return x * x + y * y <= rMax * rMax;
  }
  /**
   * Handles pointer-down: begins a swipe or stores the pointer for multi-touch.
   *
   * @param {number} id - Pointer identifier from the PointerEvent
   * @param {number} clientX - Horizontal pointer position in window pixels
   * @param {number} clientY - Vertical pointer position in window pixels
   */
  function onDown(id, clientX, clientY) {
    const c = getLocalCoords(clientX, clientY);
    if (!insideDrumOrBand(c.x, c.y)) return;
    state.pointers.set(id, { x: c.x, y: c.y, lastT: performance.now() / 1000 });
    state.holding = true;
  }
  /**
   * Handles pointer-move: updates swipe velocity for tracked pointers.
   *
   * @param {number} id - Pointer identifier from the PointerEvent
   * @param {number} clientX - Horizontal pointer position in window pixels
   * @param {number} clientY - Vertical pointer position in window pixels
   */
  function onMove(id, clientX, clientY) {
    const p = state.pointers.get(id);
    if (!p) return;
    const c = getLocalCoords(clientX, clientY);
    const now = performance.now() / 1000;
    const dx = c.x - p.x, dy = c.y - p.y;
    const mx = (p.x + c.x) * 0.5, my = (p.y + c.y) * 0.5;
    const r = Math.hypot(mx, my);
    if (r > 5) {
      const tx = -my / r, ty = mx / r;
      const tang = dx * tx + dy * ty;
      state.omegaTarget += tang * TUNING.drum.swipeGain / Math.max(0.3, r / CFG.R_DRUM);
      const OMAX = TUNING.drum.omegaMax;
      if (state.omegaTarget > OMAX) state.omegaTarget = OMAX;
      if (state.omegaTarget < -OMAX) state.omegaTarget = -OMAX;
    }
    p.x = c.x; p.y = c.y; p.lastT = now;
  }
  /**
   * Handles pointer-up/cancel: finalises the swipe and removes the pointer.
   *
   * @param {number} id - Pointer identifier from the PointerEvent
   */
  function onUp(id) { state.pointers.delete(id); if (state.pointers.size === 0) state.holding = false; }
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); onDown(e.pointerId, e.clientX, e.clientY); });
  cv.addEventListener('pointermove', e => { if (state.pointers.has(e.pointerId)) onMove(e.pointerId, e.clientX, e.clientY); });
  cv.addEventListener('pointerup', e => onUp(e.pointerId));
  cv.addEventListener('pointercancel', e => onUp(e.pointerId));
  cv.addEventListener('pointerleave', e => onUp(e.pointerId));
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // ============================================================
  // SECTION: INPUT — OMEGA CONTROLS
  // ============================================================
  /**
   * Nudges omegaTarget by one step in the given direction, clamped to omegaMax.
   *
   * @param {number} sign - Direction of the nudge: +1 for faster, -1 for slower
   */
  function bumpOmega(sign) {
    state.omegaTarget += sign * TUNING.drum.omegaStep;
    const OMAX = TUNING.drum.omegaMax;
    if (state.omegaTarget >  OMAX) state.omegaTarget =  OMAX;
    if (state.omegaTarget < -OMAX) state.omegaTarget = -OMAX;
  }
  /**
   * Wires a button for immediate click plus auto-repeat on long press.
   *
   * @param {HTMLElement} btn - Button element to wire
   * @param {Function} fn - Callback invoked on each click and during auto-repeat
   */
  function wirePressHold(btn, fn) {
    let timer = null, iv = null;
    const start = (e) => { e.preventDefault(); fn(); timer = setTimeout(() => { iv = setInterval(fn, 90); }, 350); };
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } if (iv) { clearInterval(iv); iv = null; } };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
  }
  window.bumpOmega    = bumpOmega;
  window.wirePressHold = wirePressHold;

  // ============================================================
  // SECTION: BUTTON WIRING — MAIN
  // ============================================================
  const btnStart = document.getElementById('btnStart');
  const btnReset = document.getElementById('btnReset');
  const btnLaser = document.getElementById('btnLaser');
  const btnOmegaCtl = document.getElementById('btnOmegaCtl');
  const btnSound = document.getElementById('btnSound');
  const btnTrails = document.getElementById('btnTrails');

  btnStart.addEventListener('click', () => {
    startRelease();
    btnStart.classList.add('on');
    ensureAudio();
    const dur = (CFG.N_P <= 1) ? 0 : CFG.DT_INJECT;
    soundMillStart(dur);

    if (btnStart.injectTimeout) clearTimeout(btnStart.injectTimeout);
    btnStart.injectTimeout = setTimeout(() => {
      btnStart.classList.remove('on');
    }, Math.max(250, dur * 1000));
  });

  btnReset.addEventListener('click', () => {
    // 1. Clear the HUD and Heatmap
    if (heatmap.enabled) {
      heatmap.data.fill(0);
      heatmap.accN.fill(0);
      heatmap.accV.fill(0);
      heatmap.accV2.fill(0);
      heatmap.ready = false;
    }
    ctxOv.clearRect(0, 0, W, H);
    
    // 2. Clear basic simulation state
    initLevel(); 

    // 3. THE PLANETARY HUNK: Reset your Solar System
    state.globes = [];         // Removes the planets from the screen
    state.globeMerging = null; // Stops any pebbles currently flying to merge
    state.eggBallCount = 0;    // Resets the pebble "fuel" counter
    state.running = false;     // Freezes simulation until you hit "Inject" again
    
    // 4. Mode and UI cleanup
    if (GAME.on) enterGameMode(false); 
    if (CHALLENGE.on) enterChallengeMode(false);
    
    btnStart.classList.remove('on');
    btnReset.classList.add('flash');
    setTimeout(() => btnReset.classList.remove('flash'), 200);
    
    // Hide the special planet-related gauges
    gaugeAgg.style.display = 'none';
    gaugePebble.style.display = 'none';
    
    // Crucial: hide the "System Complete" sheet so you can play again
    gameSheet.hidden = true; 
  });

  btnLaser.addEventListener('click', () => {
    state.laserOn = !state.laserOn;
    btnLaser.classList.toggle('on', state.laserOn);
  });
  const omegaCtlEl = document.getElementById('omegaCtl');
  omegaCtlEl.classList.add('disabled');
  let omegaCtlOn = false;

  const ORIGINAL_OMEGA_DECAY = TUNING.drum.omegaDecay;
  let cheatNoDecay = false;
  let cheatHoldTimer = null;
  let cheatHoldFired = false;
  const CHEAT_HOLD_MS = 2000;

  /**
   * Activates or deactivates the no-decay cheat and syncs both cheat button visuals.
   *
   * @param {boolean} on - True to enable no-decay cheat, false to restore normal decay
   */
  function applyCheat(on) {
    cheatNoDecay = on;
    TUNING.drum.omegaDecay = on ? 0 : ORIGINAL_OMEGA_DECAY;
    
    // Synchronize both buttons to use the orange "cheat" state
    const btnOmega = document.getElementById('btnOmegaCtl');
    const btnSys = document.getElementById('btnSysNoDecay');
    
    if (btnOmega) btnOmega.classList.toggle('cheat', on);
    if (btnSys) btnSys.classList.toggle('cheat', on);
  }

  btnOmegaCtl.addEventListener('pointerdown', (e) => {
    cheatHoldFired = false;
    if (cheatHoldTimer) { clearTimeout(cheatHoldTimer); cheatHoldTimer = null; }
    cheatHoldTimer = setTimeout(() => {
      cheatHoldFired = true;
      cheatHoldTimer = null;
      applyCheat(!cheatNoDecay);
    }, CHEAT_HOLD_MS);
  });
  const cancelCheatHold = () => {
    if (cheatHoldTimer) { clearTimeout(cheatHoldTimer); cheatHoldTimer = null; }
  };
  btnOmegaCtl.addEventListener('pointerup', cancelCheatHold);
  btnOmegaCtl.addEventListener('pointerleave', cancelCheatHold);
  btnOmegaCtl.addEventListener('pointercancel', cancelCheatHold);

  btnOmegaCtl.addEventListener('click', (e) => {
    if (cheatHoldFired) {
      cheatHoldFired = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    omegaCtlOn = !omegaCtlOn;
    btnOmegaCtl.classList.toggle('on', omegaCtlOn);
    omegaCtlEl.classList.toggle('disabled', !omegaCtlOn);
  });
  btnSound.classList.add('on');
  btnSound.addEventListener('click', () => {
    AUDIO.enabled = !AUDIO.enabled;
    btnSound.classList.toggle('on', AUDIO.enabled);
    if (AUDIO.master) {
      const t = AUDIO.ctx.currentTime;
      AUDIO.master.gain.setTargetAtTime(AUDIO.enabled ? TUNING.audio.masterGain : 0.0, t, 0.05);
    }
  });

  btnTrails.addEventListener('click', () => {
    state.trailsOn = !state.trailsOn;
    btnTrails.classList.toggle('on', state.trailsOn);
  });

  const btnTheme = document.getElementById('btnTheme');
  function applyTheme(name) {
    if (name === 'light') {
      document.body.classList.add('theme-light');
      window.PAL = PAL_LIGHT;
      btnTheme.classList.add('on');
    } else {
      document.body.classList.remove('theme-light');
      window.PAL = PAL_DARK;
      btnTheme.classList.remove('on');
    }
  }
  btnTheme.addEventListener('click', () => {
    applyTheme(PAL.name === 'dark' ? 'light' : 'dark');
  });

  const btnManual = document.getElementById('btnManual');
  const manualOverlay = document.getElementById('manualOverlay');
  const manualClose = document.getElementById('manualClose');
  function openManual() { manualOverlay.hidden = false; }
  function closeManual() { manualOverlay.hidden = true; }
  btnManual.addEventListener('click', openManual);
  manualClose.addEventListener('click', closeManual);
  manualOverlay.addEventListener('click', (e) => {
    if (e.target === manualOverlay) closeManual();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !manualOverlay.hidden) closeManual();
  });

  // Initial layout and level setup — must run after all button wiring is complete
  window.addEventListener('resize', layout);
  layout();
  initLevel();

  // ============================================================
  // SECTION: SPLASH SCREEN
  // ============================================================
  (function initSplash() {
    if (!TUNING.splash || !TUNING.splash.enabled) return;

    if (TUNING.splash.onceOnly) {
      try {
        if (localStorage.getItem('levitation_splash_seen') === '1') return;
        localStorage.setItem('levitation_splash_seen', '1');
      } catch (e) { /* localStorage may be blocked; show splash anyway */ }
    }

    const overlay = document.getElementById('splashOverlay');
    const btn = document.getElementById('splashBtn');
    if (!overlay || !btn) return;

    overlay.hidden = false;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      overlay.classList.add('fading');
      setTimeout(() => { overlay.hidden = true; }, 500);
    };

    overlay.addEventListener('click', dismiss);
    btn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });

    if (TUNING.splash.autoDismiss > 0) {
      setTimeout(dismiss, TUNING.splash.autoDismiss * 1000);
    }
  })();
  // ============================================================
  // END SPLASH SCREEN
  // ============================================================

  // ============================================================

  // SECTION: EXPERT PANEL — HUD BUTTONS
  // ============================================================
  document.getElementById('btnHudMaster').addEventListener('click', () => {
    hudMasterOn = !hudMasterOn;
    updateAnalysisInstrument(hudMasterOn); // true = fresh activation, triggers buffer reset
  });

  document.getElementById('btnModeNext').addEventListener('click', () => {
    if (!hudMasterOn) return;
    currentAnalysisIdx = (currentAnalysisIdx + 1) % ANALYSIS_MODES.length;
    updateAnalysisInstrument();
  });

  document.getElementById('btnModePrev').addEventListener('click', () => {
    if (!hudMasterOn) return;
    currentAnalysisIdx = (currentAnalysisIdx - 1 + ANALYSIS_MODES.length) % ANALYSIS_MODES.length;
    updateAnalysisInstrument();
  });

  document.getElementById('btnVtProj').addEventListener('click', function() {
    TUNING.particle.showVtProjection = !TUNING.particle.showVtProjection;
    this.classList.toggle('on', TUNING.particle.showVtProjection);
  });

  document.getElementById('btnFlashOrbit').addEventListener('click', function() {
    TUNING.aggregate.flashOrbit = !TUNING.aggregate.flashOrbit;
    this.classList.toggle('on', TUNING.aggregate.flashOrbit);
  });

  // ============================================================
  // SECTION: EXPERT PANEL — PROCESSES
  // ============================================================
  /**
   * Wires an expert process toggle button with on/off callback.
   *
   * @param {string} id - DOM element id of the button to wire
   * @param {string} activeClass - CSS class toggled to indicate the active state
   * @param {Function} onToggle - Callback invoked with the new active boolean on each toggle
   * @param {number} [requiredClicks=1] - Number of clicks required to activate (guards against accidental use)
   */
  function wireProcessButton(id, colorClass, onActivate, requiredClicks = 1) {
    const btn = document.getElementById(id);
    if (!btn) return;

    let clickCount = 0;
    let clickTimer = null;

    btn.addEventListener('click', function() {
      // DESIGNER LOCKDOWN: Check for ?designer parameter before allowing interaction
      if (id === 'btnProcFast' && !isDesignerURL) return;

      const isCurrentlyActive = this.classList.contains(colorClass || 'on');

      // NEW LOGIC: If button is ON, bypass the 7-click requirement to turn it OFF
      if (requiredClicks > 1 && !isCurrentlyActive) {
        clickCount++;
        if (clickTimer) clearTimeout(clickTimer);

        clickTimer = setTimeout(() => {
          clickCount = 0;
        }, 500);

        if (clickCount < requiredClicks) {
          btn.classList.add('flash');
          setTimeout(() => btn.classList.remove('flash'), 100);
          return; 
        }
        
        clickCount = 0;
        clearTimeout(clickTimer);
      }

      // Standard toggle behavior
      const isActive = this.classList.toggle(colorClass || 'on');
      onActivate(isActive);
    });
  }

  // PROCESSES 1. Nano-Coating (Green light when ON)
  wireProcessButton('btnProcInvinc', 'on', (active) => {
    TUNING.particle.invincible = active;
  });

  // PROCESSES 2. Aggregate formation OFF (Red light when active)
  wireProcessButton('btnProcNoAgg', 'warn', (active) => {
    TUNING.aggregate.minLevitated = active ? 999999 : TUNING_DEFAULT.aggregate.minLevitated;
  });

  // PROCESSES 3. Pebble formation OFF (Red light when active)
  wireProcessButton('btnProcNoPeb', 'warn', (active) => {
    TUNING.egg.nCrit = active ? 999999 : TUNING_DEFAULT.egg.nCrit;
  });

  // PROCESSES 4. Pure Velocity Average
  wireProcessButton('btnProcPureV', 'on', (active) => {
    // Revert vtFactor to 1.0 (pure average) or back to default multiplier[cite: 2]
    TUNING.aggregate.vtFactor = active ? 1.0 : TUNING_DEFAULT.aggregate.vtFactor;
  });


  // PROCESSES 5. Dynamic Slow Motion (Armed state)
  let slowMoArmed = false; window.slowMoArmed = false;
  wireProcessButton('btnProcSlowMo', 'on', (active) => {
    slowMoArmed = active; window.slowMoArmed = active;
    // Ensure we restore physics if turned off mid-merge
    if (!active) {
      CFG.MAX_DT = 0.033;
      TUNING.egg.mergeDur = TUNING_DEFAULT.egg.mergeDur;
      TUNING.aggregate.mergeDur = TUNING_DEFAULT.aggregate.mergeDur;
      TUNING.globe.mergeDur = TUNING_DEFAULT.globe.mergeDur;
    }
  });

  // PROCESSES 6. Fast Chain (Accelerated Synthesis)
  wireProcessButton('btnProcFast', 'on', (active) => {
    if (active) {
      // Aggregate synthesis acceleration
      TUNING.aggregate.mergeCount = 2;   
      TUNING.aggregate.initialHoldRevs = 0; 
      TUNING.aggregate.subseqHoldRevs = 0;

      // Pebble synthesis (egg system) acceleration
      TUNING.egg.nCrit = 2;              // Only 2 aggregates for a pebble
      TUNING.egg.holdTarget = 2;         // First pebble forms after 2 rotations
      TUNING.egg.holdSubseq = 1;         // Subsequent pebbles form every 1 rotation

      // Planet synthesis acceleration
      TUNING.globe.nCrit = 2;            
    } else {
      // Restore all from backup[cite: 2]
      TUNING.aggregate.mergeCount = TUNING_DEFAULT.aggregate.mergeCount;
      TUNING.aggregate.initialHoldRevs = TUNING_DEFAULT.aggregate.initialHoldRevs;
      TUNING.aggregate.subseqHoldRevs = TUNING_DEFAULT.aggregate.subseqHoldRevs;

      TUNING.egg.nCrit = TUNING_DEFAULT.egg.nCrit;
      TUNING.egg.holdTarget = TUNING_DEFAULT.egg.holdTarget; 
      TUNING.egg.holdSubseq = TUNING_DEFAULT.egg.holdSubseq; 

      TUNING.globe.nCrit = TUNING_DEFAULT.globe.nCrit;
    }
  },7);
   
  // ============================================================
  // SECTION: EXPERT PANEL — SYSTEM
  // ============================================================
  const btnSysNoDecay = document.getElementById('btnSysNoDecay');
  if (btnSysNoDecay) {
    btnSysNoDecay.addEventListener('click', () => {
      applyCheat(!cheatNoDecay);
    });
  }

  // SYSTEM 2. Ghost renderer
  document.getElementById('btnFlowGhost').addEventListener('click', function() {
    TUNING.particle.showFlowGhosts = !TUNING.particle.showFlowGhosts;
    this.classList.toggle('on', TUNING.particle.showFlowGhosts);
    
    // If turning off, clear all targets
    if (!TUNING.particle.showFlowGhosts) {
      state.particles.forEach(p => p.isDiagnosticTarget = false);
    }
  });

  // SYSTEM 4-6. Simulation speed

    const speedGears = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
    let currentGearIdx = 2; // Default to 1.0x
  
    /**
     * Applies the current speed gear to state.simSpeed and updates the speed display label.
     */
    function updateSpeedUI() {
      const speed = speedGears[currentGearIdx];
      state.simSpeed = speed;
      
      // Use single-character Unicode fractions for better fit
      let label;
      if (speed === 0.5) label = "½x";
      else if (speed === 0.25) label = "¼x";
      else label = speed + 'x';

      document.getElementById('speedDisp').textContent = label;
      
      // Visual feedback: Glow the middle button if not at standard 1x
      document.getElementById('btnSpeedReset').classList.toggle('on', speed !== 1.0);
    }
  
    document.getElementById('btnSpeedUp').addEventListener('click', () => {
      if (currentGearIdx < speedGears.length - 1) {
        currentGearIdx++;
        updateSpeedUI();
      }
    });
    document.getElementById('btnSpeedDown').addEventListener('click', () => {
      if (currentGearIdx > 0) {
        currentGearIdx--;
        updateSpeedUI();
      }
    });
    document.getElementById('btnSpeedReset').addEventListener('click', () => {
      currentGearIdx = 2; // Snap back to 1.0x
      updateSpeedUI();
    });


  cv.addEventListener('mousedown', function(e) {
    if (!TUNING.particle.showFlowGhosts) return;

    const coords = getLocalCoords(e.clientX, e.clientY);
    let closestDist = Infinity;
    let selected = null;
  
    state.particles.forEach(p => {
      if (!p.alive || p.stuck) return;
      const dx = p.x - coords.x;
      const dy = p.y - coords.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < closestDist) {
        closestDist = d2;
        selected = p;
      }
    });
  
    state.particles.forEach(p => p.isDiagnosticTarget = false);
    if (selected) { 
      selected.isDiagnosticTarget = true;
      // Note: No distance check here ensures "nearest particle" behavior
    }
  });
    
  // ============================================================
  // SECTION: EXPERT DOOR & URL FLAGS
  // ============================================================
  const expertContainer = document.getElementById('expertContainer');
  const titlePlateLink = document.getElementById('titlePlate');
  const uP = new URLSearchParams(window.location.search);
  isExpertURL = uP.has('expert');
  isDesignerURL = uP.has('designer');

  // Unified access: Either ?expert or ?designer automatically opens the door
  if ((isExpertURL || isDesignerURL) && expertContainer) {
    expertContainer.classList.add('open');
    if (isExpertURL) applyCheat(true);
    applyCheat(true);
  }

  // ?verify — rapid full-test mode: floods the drum quickly with high spread and no decay
  if (uP.has('verify')) {
    SETTINGS.NP.idx     = SETTINGS.NP.values.indexOf(3000);
    SETTINGS.VT.idx     = SETTINGS.VT.values.indexOf(30);
    SETTINGS.SPREAD.idx = SETTINGS.SPREAD.values.indexOf(0.30);
    SETTINGS.DT.idx     = SETTINGS.DT.values.indexOf(2);
    applyInitialSettings();
    applyCheat(true);
  }

  // Visual lockdown for the Designer-only button
  const btnFast = document.getElementById('btnProcFast');
  if (btnFast && !isDesignerURL) {
    btnFast.classList.add('disabled');
    btnFast.title = "Access restricted to lab designers.";
  }

  let tapCount = 0;
  let tapTimer = null;

  if (titlePlateLink && expertContainer) {
    titlePlateLink.addEventListener('click', (e) => {
      e.preventDefault(); 
      tapCount++;
      
      if (tapTimer) clearTimeout(tapTimer);
      
      if (tapCount >= 3) {
        tapCount = 0;
        // Toggle the door state
        const isOpening = !expertContainer.classList.contains('open');
        if (isOpening) {
          expertContainer.classList.add('open');
          soundSnap(); // Mechanical unlock
        } else {
          expertContainer.classList.remove('open');
          soundTink(); // Soft lock
        }
      } else {
        tapTimer = setTimeout(() => { 
          // If only one click, still allow the link to open in new tab
          if (tapCount === 1 && titlePlateLink.href) {
            window.open(titlePlateLink.href, titlePlateLink.target || '_self');
          }
          tapCount = 0; 
        }, 400);
      }
    });
  }


})();
