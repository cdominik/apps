/**
 * @file ui.js
 * @description
 *   All user-interface wiring: pointer/swipe input, omega controls, main
 *   button handlers, splash screen, expert panel buttons (HUD master, process
 *   toggles, system controls), and the expert door URL-flag logic.
 *   Also owns the Expert Analysis Controller (hudMasterOn, heatmap mode).
 *
 * Exposes globals: slowMoArmed (window), resetExpertUI (window),
 *                  setOmegaDecay (window), setOmegaCtlMode (window),
 *                  _resetLaunchState (window), _computeOptimalWait (window),
 *                  _ghostClear (window), _ghostEnsureTarget (window),
 *                  resetSimSpeed (window)
 * Reads globals:   TUNING, TUNING_DEFAULT, CFG, PAL, PAL_DARK, PAL_LIGHT,
 *                  AUDIO, state, heatmap,
 *                  SETTINGS, SEL_WIN, applyInitialSettings,
 *                  GAME, CHALLENGE, VIEWPORT,
 *                  initLevel, startRelease, scheduleInjections,
 *                  ensureAudio, soundMillStart, soundSnap, soundTink,
 *                  soundExpertDoorKnock, layout, draw,
 *                  cv, W, H, ctxOv, CX, CY, SCALE, REGIME,
 *                  enterGameMode, enterChallengeMode, lockSelectors,
 *                  updateGauge, updateAnalysisInstrument (internal)
 */
(() => {
  'use strict';

  // SECTION: FEATURE FLAGS
  // ============================================================
  let isExpertURL = false;

  // SECTION: Utility functions
  function showToast(message, durationMs = 2000) {
  let toast = document.getElementById('uiToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'uiToast';
    toast.style.cssText = `
      position: fixed;
      background: rgba(8, 8, 12, 0.95);
      color: #ffcc55;
      border: 1px solid #5a4418;
      padding: 8px 16px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      transition: opacity 0.3s ease-in-out;
      white-space: nowrap;
      transform: translate(-50%, -50%);
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.left  = CX + 'px';
  toast.style.top   = CY + 'px';
  toast.style.opacity = '1';

  if (toast._hideTimer) clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
  }, durationMs);
}
  
  // ============================================================
  // SECTION: EXPERT ANALYSIS CONTROLLER
  // ============================================================
  const ANALYSIS_MODES = ['vectors', 'ghost', 'orbits', 'density', 'dispersion', 'product'];
  let currentAnalysisIdx = 0;
  window.hudMasterOn = false;

  /**
   * Syncs the expert HUD master button state and activates the selected analysis mode.
   * isActivation=true resets the accumulation buffers (only on fresh HUD power-on).
   */
  function updateAnalysisInstrument(isActivation = false) {
    const btnPrev   = document.getElementById('btnModePrev');
    const btnNext   = document.getElementById('btnModeNext');
    const btnMaster = document.getElementById('btnHudMaster');
    if (!btnPrev || !btnNext || !btnMaster) return;

    state.showVectors  = false;
    window.ghostModeOn = false;
    state.orbitSample  = [];
    ctxOv.clearRect(0, 0, W, H);

    btnPrev.classList.toggle('disabled', !window.hudMasterOn);
    btnNext.classList.toggle('disabled', !window.hudMasterOn);
    btnMaster.classList.toggle('on', window.hudMasterOn);

    if (!hudMasterOn) {
      heatmap.enabled = false;
      _ghostClear();
      ctxOv.clearRect(0, 0, W, H);
      return;
    }

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
      heatmap.mode = 'none';
    } else if (mode === 'ghost') {
      window.ghostModeOn = true;
      heatmap.mode = 'none';
      _ghostEnsureTarget();
    } else {
      heatmap.mode = mode;
    }
  }

  function _ghostClear() {
    state.particles.forEach(p => p.isDiagnosticTarget = false);
  }

  function _ghostEnsureTarget() {
    const cur = state.particles.find(p => p.isDiagnosticTarget && p.alive && !p.stuck);
    if (cur) return;

    const levitated = state.particles.filter(p =>
      p.alive && !p.stuck && !p.merging && p.insideOnce && state.isLevitated(p)
    );

    let next = null;
    if (levitated.length > 0) {
      next = levitated[Math.floor(Math.random() * levitated.length)];
    } else {
      const floating = state.particles.filter(p =>
        p.alive && !p.stuck && !p.merging && p.insideOnce
      );
      if (floating.length > 0) next = floating[Math.floor(Math.random() * floating.length)];
    }

    _ghostClear();
    if (next) next.isDiagnosticTarget = true;
  }

  window.resetExpertUI = function() {
    hudMasterOn = false;
    window.ghostModeOn = false;
    _ghostClear();
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
    if (state.paused) {
      if (window.handleTimelineClick) window.handleTimelineClick(clientX, clientY);
      return;
    }
    const c = getLocalCoords(clientX, clientY);
    
    // Strict circular check: distance from center must be within the outer band
    const r = Math.hypot(c.x, c.y);
    const outerRadius = CFG.R_DRUM * 1.1; 
    
    if (r > outerRadius) return; 
    if (window.omegaMode === 1) return; // LOCKED: ignore click
    // Tray deploying/deployed → collection is terminal until Reset; ignore swipes.
    if (state.tray.phase === 'inserting' || state.tray.phase === 'inserted') {
      showToast('Lab locked — press Reset to start a new run');
      return;
    }
    state.pointers.set(id, { x: c.x, y: c.y, lastT: performance.now() / 1000 });
    state.holding = true;
    cv.style.cursor = 'grabbing';
  }

  function onMove(id, clientX, clientY) {
    const p = state.pointers.get(id);
    const c = getLocalCoords(clientX, clientY);
    
    const r = Math.hypot(c.x, c.y);
    const outerRadius = CFG.R_DRUM * 1.1; 
    const inCircle = r <= outerRadius;

    if (p) {
      if (window.omegaMode === 1) {
        // Locked mid-drag
        state.pointers.delete(id);
        state.holding = state.pointers.size > 0;
        cv.style.cursor = inCircle ? 'not-allowed' : 'default';
        return;
      }

      if (state.tray.phase === 'inserting' || state.tray.phase === 'inserted') {
        // Tray locked the lab mid-drag — drop the pointer like the Ω-lock path.
        state.pointers.delete(id);
        state.holding = state.pointers.size > 0;
        cv.style.cursor = inCircle ? 'not-allowed' : 'default';
        return;
      }
      
      // Keep 'grabbing' cursor active while dragging
      cv.style.cursor = 'grabbing';

      const now = performance.now() / 1000;
      const dx = c.x - p.x, dy = c.y - p.y;
      const mx = (p.x + c.x) * 0.5, my = (p.y + c.y) * 0.5;
      const rm = Math.hypot(mx, my);
      if (rm > 5) {
        const tx = -my / rm, ty = mx / rm;
        const tang = dx * tx + dy * ty;
        state.omegaTarget += tang * TUNING.drum.swipeGain / Math.max(0.3, rm / CFG.R_DRUM);
        const OMAX = TUNING.drum.omegaMax;
        if (state.omegaTarget > OMAX) state.omegaTarget = OMAX;
        if (state.omegaTarget < -OMAX) state.omegaTarget = -OMAX;
      }
      p.x = c.x; p.y = c.y; p.lastT = now;
    } else {
      // Update hover state dynamically based on boundary and lock state
      if (inCircle) {
        cv.style.cursor = (window.omegaMode === 1) ? 'not-allowed' : 'grab';
      } else {
        cv.style.cursor = 'default';
      }
    }
  }

  function onUp(id, e) {
    state.pointers.delete(id);
    if (state.pointers.size === 0) {
      state.holding = false;
      if (e && e.clientX !== undefined) {
        const c = getLocalCoords(e.clientX, e.clientY);
        const r = Math.hypot(c.x, c.y);
        const outerRadius = CFG.R_DRUM * 1.1; 
        if (r <= outerRadius) {
          cv.style.cursor = (window.omegaMode === 1) ? 'not-allowed' : 'grab';
        } else {
          cv.style.cursor = 'default';
        }
      } else {
        cv.style.cursor = 'default';
      }
    }
  }

  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); onDown(e.pointerId, e.clientX, e.clientY); });
  cv.addEventListener('pointermove', e => onMove(e.pointerId, e.clientX, e.clientY));
  cv.addEventListener('pointerup', e => onUp(e.pointerId, e));
  cv.addEventListener('pointercancel', e => onUp(e.pointerId, e));
  cv.addEventListener('pointerleave', e => onUp(e.pointerId, e));
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('touchmove', e => {
    // Allow native touch scrolling inside scrollable overlay boxes and
    // sheet content. Suppress everywhere else (drum rubber-banding).
    if (e.target.closest('.manual-box, .splash-box, .sheet-content')) return;
    e.preventDefault();
  }, { passive: false });

  // ============================================================
  // SECTION: INPUT — OMEGA CONTROLS
  // ============================================================

  document.getElementById('omegaCtl').addEventListener('pointerdown', (e) => {
    // Only trigger if they clicked the actual green arrow path
    if (e.target.tagName.toLowerCase() === 'path') {
      let hint = document.getElementById('swipeHintToast');
      
      // Create the floating hint div if it doesn't exist yet
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'swipeHintToast';
        hint.style.position = 'absolute';
        hint.style.background = 'rgba(8, 8, 12, 0.95)';
        hint.style.color = '#ffcc55';
        hint.style.border = '1px solid #5a4418';
        hint.style.padding = '8px 12px';
        hint.style.borderRadius = '4px';
        hint.style.fontFamily = "'Courier New', monospace";
        hint.style.fontSize = '13px';
        hint.style.fontWeight = 'bold';
        hint.style.pointerEvents = 'none'; // Let clicks pass through it
        hint.style.zIndex = '1000';
        hint.style.transition = 'opacity 0.2s ease-in-out';
        hint.style.boxShadow = '0 4px 10px rgba(0,0,0,0.8)';
        hint.style.whiteSpace = 'nowrap';
        document.body.appendChild(hint);
      }
      
      hint.textContent = "Swipe the drum to rotate";
      
      // Position slightly offset to the bottom right of the cursor/finger
      hint.style.left = (e.clientX + 15) + 'px';
      hint.style.top = (e.clientY + 15) + 'px';
      
      // Reset opacity and force reflow to restart the fade-in animation
      hint.style.opacity = '0';
      void hint.offsetWidth; 
      hint.style.opacity = '1';

      // Auto-hide after 2 seconds
      if (hint.hideTimer) clearTimeout(hint.hideTimer);
      hint.hideTimer = setTimeout(() => { hint.style.opacity = '0'; }, 2000);
    }
  });

  // ============================================================
  // SECTION: BUTTON WIRING — MAIN
  // ============================================================
  const btnStart = document.getElementById('btnStart');
  const btnReset = document.getElementById('btnReset');
  const btnLaser = document.getElementById('btnLaser');
  const btnOmegaCtl = document.getElementById('btnOmegaCtl');
  const btnSound = document.getElementById('btnSound');
  const btnTrails = document.getElementById('btnTrails');
  const gaugeAgg    = document.getElementById('gaugeAgg');
  const gaugePebble = document.getElementById('gaugePebble');
  const gameSheet   = document.getElementById('gameSheet');

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
    if (window.omegaCtlMode === 2) {
      _resetLaunchState();
    } else if (window.omegaCtlMode === 1) {
      // keep mode 1 active across resets
    }
    ctxOv.clearRect(0, 0, W, H);
    
    // 2. Clear basic simulation state
    initLevel(); 

    // 3. THE PLANETARY HUNK: Reset your Solar System
    state.globes = [];         // Removes the planets from the screen

    // Reset solar system
    const sol = state.solar;
    sol.phase = 'none'; sol.wallT = 0; sol._lastT = 0; sol.phaseStart = 0;
    sol.orbits = []; sol.pendingIdx = -1;
    sol.centerX = 0; sol.centerY = -50;
    sol.scale = 1.0; sol.startScale = 1.0; sol.targetScale = 1.0;
    sol.sunAlpha       = 0;
    sol.probes         = [];
    sol.probesLaunched = false;
    state.globeMerging = null;
    state.eggBallCount = 0;    // Resets the pebble "fuel" counter
    state.running = false;     // Freezes simulation until you hit "Inject" again
    
    // 4. Mode and UI cleanup
    if (window.cancelEndingSequence) window.cancelEndingSequence();
    if (GAME.on) enterGameMode(false); 
    if (CHALLENGE.on) enterChallengeMode(false);
    
    btnStart.classList.remove('on');
    if (btnCollect) {
      btnCollect.classList.remove('on', 'cheat');
      btnCollect.disabled = false;
    }
    if (window.zoomOn) document.getElementById('btnProcFast').click();
    btnReset.classList.add('flash');
    setTimeout(() => btnReset.classList.remove('flash'), 200);
    
    // Hide the special planet-related gauges
    gaugeAgg.style.display = 'none';
    gaugePebble.style.display = 'none';
    
    // Crucial: hide the "System Complete" sheet so you can play again
    gameSheet.hidden = true;
    if (window.resetTimeline) window.resetTimeline();
  });

  btnLaser.addEventListener('click', () => {
    state.laserOn = !state.laserOn;
    btnLaser.classList.toggle('on', state.laserOn);
  });

  const omegaCtlEl = document.getElementById('omegaCtl');
  const ORIGINAL_OMEGA_DECAY = TUNING.drum.omegaDecay;
  window.omegaDecayOff = false;

  function setOmegaDecay(off) {
    window.omegaDecayOff = off;
    TUNING.drum.omegaDecay = off ? 0 : ORIGINAL_OMEGA_DECAY;
    btnOmegaCtl.classList.toggle('on', off);
    if (omegaCtlEl) omegaCtlEl.classList.toggle('disabled', !off);
  }

  btnOmegaCtl.addEventListener('click', () => {
    if (btnOmegaCtl.classList.contains('disabled') && !window.omegaDecayOff) return;
    setOmegaDecay(!window.omegaDecayOff);
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

  document.getElementById('btnPause')?.addEventListener('click', () => {
    if (window.togglePause) window.togglePause();
  });

  
  const btnManual = document.getElementById('btnManual');
  const manualOverlay = document.getElementById('manualOverlay');
  const manualClose = document.getElementById('manualClose');
  function openManual() {
    const expertSection = document.getElementById('manualExpertSection');
    const expertContainer = document.getElementById('expertContainer');
    if (expertSection && expertContainer) {
      expertSection.hidden = !expertContainer.classList.contains('open');
    }
    manualOverlay.hidden = false;
  }
  function closeManual() { manualOverlay.hidden = true; }
  btnManual.addEventListener('click', openManual);
  manualClose.addEventListener('click', closeManual);
  manualOverlay.addEventListener('click', (e) => {
    if (e.target === manualOverlay) closeManual();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !manualOverlay.hidden) closeManual();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (window.togglePause) window.togglePause();
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

    // Skip if a URL flag is dropping us straight into a mode
    const sp = new URLSearchParams(window.location.search);
    if (sp.has('game') || sp.has('challenge')) return;
    try {
      if (localStorage.getItem('levitation_skip_splash') === '1') return;
    } catch (e) { /* localStorage blocked, proceed to show */ }

    const overlay = document.getElementById('splashOverlay');
    const btn = document.getElementById('splashBtn');
    const skipCheck = document.getElementById('splashSkipCheck');
    if (!overlay || !btn) return;

    overlay.hidden = false;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      
      // Save the user's preference if they checked the box
      if (skipCheck && skipCheck.checked) {
        try {
          localStorage.setItem('levitation_skip_splash', '1');
        } catch (e) { /* ignore */ }
      }
      
      overlay.classList.add('fading');
      setTimeout(() => { overlay.hidden = true; }, 500);
    };

    overlay.addEventListener('click', (e) => {
      // Prevent dismissing if they are just trying to click the checkbox or label
      if (e.target === skipCheck || e.target.tagName === 'LABEL') return;
      dismiss();
    });
    btn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !overlay.hidden) dismiss();
    });

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
  // HUD 1. Vt orbit center projection
  document.getElementById('btnVtProj').addEventListener('click', function() {
    TUNING.particle.showVtProjection = (TUNING.particle.showVtProjection + 1) % 3;
    const mode = TUNING.particle.showVtProjection;
    this.classList.toggle('cheat', mode === 1); // amber — predicted (it's an estimate)
    this.classList.toggle('on',    mode === 2); // green  — live (real data)
  });

  // HUD 2. Aggregate orbit flash
  document.getElementById('btnFlashOrbit').addEventListener('click', function() {
    TUNING.aggregate.flashOrbit = !TUNING.aggregate.flashOrbit;
    this.classList.toggle('on', TUNING.aggregate.flashOrbit);
  });

  // HUD 3. Aggregate encounter projections
  window.encountersOn = false;
  document.getElementById('btnAggEncounters').addEventListener('click', function() {
    window.encountersOn = !window.encountersOn;
    this.classList.toggle('on', window.encountersOn);
    if (!window.encountersOn) { window.resetEncounterCache(); ctxOv.clearRect(0, 0, W, H); }
  });

  // HUD 4. v_t distribution — KDE of levitated particles + aggregate histogram
  window.vtDistOn = false;
  document.getElementById('btnVtDist').addEventListener('click', function() {
    window.vtDistOn = !window.vtDistOn;
    this.classList.toggle('on', window.vtDistOn);
    if (!window.vtDistOn) ctxOv.clearRect(0, 0, W, H);
  });

  // HUD 5. Aggregate size distribution histogram
  window.aggHistOn = false;
  document.getElementById('btnAggHist').addEventListener('click', function() {
    window.aggHistOn = !window.aggHistOn;
    this.classList.toggle('on', window.aggHistOn);
    if (!window.aggHistOn) ctxOv.clearRect(0, 0, W, H);
  });

  // HUD 6. Solid screen with dimmer

 (function wireSolidMap() {
    const btn = document.getElementById('btnSysSolidMap');
    if (!btn) return;

    const LONG_PRESS_MS = 400;

    let savedOpacity = 0.9;
    let backdropOn   = false;
    let pressTimer   = null;
    let didLongPress = false;
    let sliderEl     = null;

    let _outsideListener = null;

    // --- SLIDER POPUP ---
    function showSlider() {
      didLongPress = true;
      if (!backdropOn) {
        backdropOn = true;
        btn.classList.add('on');
        heatmap.opacity = savedOpacity;
      }
      if (sliderEl) return;

      const r = btn.getBoundingClientRect();

      sliderEl = document.createElement('div');
      sliderEl.style.cssText = `
        position: fixed;
        left: ${r.left - 10}px;
        top: ${r.top - 60}px;
        background: rgba(8,8,12,0.95);
        border: 1px solid #5a4418;
        border-radius: 6px;
        padding: 10px 14px;
        z-index: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.8);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        font-family: 'Courier New', monospace;
        font-size: 10px;
        color: #d8c18a;
        white-space: nowrap;
      `;

      const label = document.createElement('div');
      label.textContent = 'backdrop opacity';
      sliderEl.appendChild(label);

      const input = document.createElement('input');
      input.type = 'range';
      input.min  = '0.0';
      input.max  = '1.0';
      input.step = '0.01';
      input.value = String(savedOpacity);
      input.style.cssText = `
        width: 120px;
        accent-color: #d9b76a;
        cursor: pointer;
      `;

      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        savedOpacity    = v;
        heatmap.opacity = backdropOn ? v : 0.0;
        valLabel.textContent = Math.round(v * 100) + '%';
      });

      const valLabel = document.createElement('div');
      valLabel.textContent = Math.round(savedOpacity * 100) + '%';
      valLabel.style.color = '#ffcc55';

      sliderEl.appendChild(input);
      sliderEl.appendChild(valLabel);
      document.body.appendChild(sliderEl);

      // Dismiss only when clicking outside the slider
      setTimeout(() => {
        _outsideListener = (e) => {
          if (sliderEl && !sliderEl.contains(e.target)) dismissSlider();
        };
        document.addEventListener('pointerdown', _outsideListener, { capture: true });
      }, 50);
    }

    function dismissSlider() {
      if (sliderEl) { sliderEl.remove(); sliderEl = null; }
      if (_outsideListener) {
        document.removeEventListener('pointerdown', _outsideListener, { capture: true });
        _outsideListener = null;
      }
    }

    btn.addEventListener('pointerdown', () => {
      didLongPress = false;
      pressTimer = setTimeout(showSlider, LONG_PRESS_MS);
    });

    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };

    btn.addEventListener('pointerup', () => {
      cancelPress();
      if (!didLongPress) {
        // Short press: toggle on/off
        backdropOn = !backdropOn;
        btn.classList.toggle('on', backdropOn);
        heatmap.opacity = backdropOn ? savedOpacity : 0.0;
      }
    });

    btn.addEventListener('pointerleave',  cancelPress);
    btn.addEventListener('pointercancel', cancelPress);
  })();

  // HUD 7-9. HUD activation and gear shift
  document.getElementById('btnHudMaster').addEventListener('click', () => {
    window.hudMasterOn = !window.hudMasterOn;
    updateAnalysisInstrument(window.hudMasterOn); // true = fresh activation, triggers buffer reset
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


  // ============================================================
  // SECTION: EXPERT PANEL — PROCESSES
  // ============================================================
  /**
   * Wires an expert process toggle button with on/off callback.
   *
   * @param {string}   id             - DOM element id of the button to wire
   * @param {string}   colorClass     - CSS class toggled to indicate the active state
   * @param {Function} onActivate     - Callback invoked with the new active boolean on each toggle
   * @param {number}   [requiredClicks=1] - Number of clicks required to activate (guards against accidental use)
   */
  function wireProcessButton(id, colorClass, onActivate, requiredClicks = 1) {
    const btn = document.getElementById(id);
    if (!btn) return;

    let clickCount = 0;
    let clickTimer = null;

    btn.addEventListener('click', function() {

      const isCurrentlyActive = this.classList.contains(colorClass || 'on');

      // If button is ON, bypass the 7-click requirement to turn it OFF
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

  // PROCESSES 2. Broom — sweep non-levitated particles
  const btnProcPeb = document.getElementById('btnProcPeb');
  if (btnProcPeb) {
    btnProcPeb.addEventListener('click', function() {
      const btn = this;

      // Drum stopped → "levitated" is undefined; don't sweep anything.
      if (!isFinite(state.period())) return;

      // Remove non-levitated particles
      state.particles = state.particles.filter(p => {
        if (!p.alive) return false;
        if (p.stuck) return false;
        return state.isLevitated(p);
      });

      // Flash twice then return to passive
      btn.classList.add('flash');
      setTimeout(() => {
        btn.classList.remove('flash');
        setTimeout(() => {
          btn.classList.add('flash');
          setTimeout(() => btn.classList.remove('flash'), 150);
        }, 200);
      }, 150);
    });
  }

  // PROCESSES 3. Slice duplication
  document.getElementById('btnProcDouble').addEventListener('click', function() {
    if (!isFinite(state.period())) {
      this.classList.add('flash');
      setTimeout(() => this.classList.remove('flash'), 200);
      return; // can't compute orbits without rotation
    }
    // ADD THIS GUARD:
    const totalParticles = state.particles.length + state.aggregates.length;
    const CAP = 10000;
    if (totalParticles > CAP) {
      this.classList.add('warn');
      setTimeout(() => this.classList.remove('warn'), 400);
      showToast('Too many particles — doubling aborted');
      return;
    }
    
    const levParticles = state.particles.filter(p =>
      p.alive && !p.stuck && !p.merging && p.insideOnce && state.isLevitated(p)
    );
    const levAggs = state.aggregates.filter(a =>
      a.alive && !a.stuck && !a.merging && state.isLevitated(a)
    );
    
    // Helper: rotate a point 90° forward in its circular orbit
    function rotateInOrbit(x, y, vt) {
      const xc  = vt / state.omega;       // orbit centre on x-axis
      const dx  = x - xc, dy = y;
      const r   = Math.hypot(dx, dy);
      const phi = Math.atan2(dy, dx);
      const nx  = xc + r * Math.cos(phi + Math.PI / 2);
      const ny  =      r * Math.sin(phi + Math.PI / 2);
      return { nx, ny };
    }
    
    const newParticles = levParticles.map(p => {
      const { nx, ny } = rotateInOrbit(p.x, p.y, p.vt);
      return {
        x: nx, y: ny,
        vx: -state.omega * ny,
        vy:  state.omega * nx - p.vt,
        vt: p.vt,
        stuck: false, stuckAngle: 0,
        alive: true,
        inHighlightSince: p.inHighlightSince,
        flashEndsAt: -1,
        insideOnce: true,
        wasLevitated: true,
        imgIdx: p.imgIdx,
        trail: [],
        merging: false,
      };
    });
    
    const newAggs = levAggs.map(a => {
      const { nx, ny } = rotateInOrbit(a.x, a.y, a.vt);
      return {
        x: nx, y: ny,
        vx: -state.omega * ny,
        vy:  state.omega * nx - a.vt,
        vt: a.vt,
        r: a.r,
        count: a.count,
        rot: a.rot + Math.PI / 2,
        rotSpeed: a.rotSpeed,
        stuck: false,
        alive: true,
        inHighlightSince: a.inHighlightSince,
        merging: false,
        imgIdx: a.imgIdx,
        orbitFlashEndsAt: state.t + 2.0,
      };
    });
    
    state.particles.push(...newParticles);
    state.aggregates.push(...newAggs);
    state.aggCount += newAggs.length;
    
    this.classList.add('flash');
    setTimeout(() => this.classList.remove('flash'), 200);
  });
  
  // PROCESSES 4. Stokes kick
  window.stokesKickOn = false;
  wireProcessButton('btnProcPureV', 'on', (active) => {
    window.stokesKickOn = active;
  });
  
  // PROCESSES 5. Aggregate formation (Green = ON, Red = OFF)
  const btnProcAgg = document.getElementById('btnProcAgg');
  if (btnProcAgg) {
    btnProcAgg.addEventListener('click', function() {
      const isCurrentlyOn = this.classList.contains('on');
      if (isCurrentlyOn) {
        // Turn OFF
        this.classList.remove('on');
        this.classList.add('warn');
        TUNING.aggregate.minLevitated = 999999;
      } else {
        // Turn ON
        this.classList.remove('warn');
        this.classList.add('on');
        TUNING.aggregate.minLevitated = TUNING_DEFAULT.aggregate.minLevitated;
      }
    });
  }

  // PROCESSES 6. Formation mode — three states: pebble / grow / off
  let growthMode = 0; // 0=pebble, 1=grow, 2=off
  window.aggGrowthOn = false;
  
  function applyGrowthMode(mode) {
    growthMode = mode;
    const btn = document.getElementById('btnProcGrowth');
    if (!btn) return;
  
    btn.classList.remove('on', 'cheat', 'warn');
    window.aggGrowthOn = false;
  
    if (mode === 0) {
      // PEBBLE — normal formation
      btn.classList.add('on');
      TUNING.egg.nCrit = TUNING_DEFAULT.egg.nCrit;
    } else if (mode === 1) {
      // GROW — aggregate-aggregate collisions, pebble at count=100
      btn.classList.add('cheat');
      TUNING.egg.nCrit = 999999;
      window.aggGrowthOn = true;
    } else {
      // OFF — no formation of any kind
      btn.classList.add('warn');
      TUNING.egg.nCrit = 999999;
    }
  }
  
  const btnProcGrowth = document.getElementById('btnProcGrowth');
  if (btnProcGrowth) {
    btnProcGrowth.addEventListener('click', () => {
      applyGrowthMode((growthMode + 1) % 3);
    });
  }
  
  // ============================================================
  // SECTION: EXPERT PANEL — SYSTEM
  // ============================================================

  // SYSTEM 1. DISTRIBUTION OVERLAY LOGIC
  const btnDistMenu = document.getElementById('btnDistMenu');
  const distOverlay = document.getElementById('distOverlay');
  const distClose   = document.getElementById('distClose');
  const distForm    = document.getElementById('distForm');

  btnDistMenu.addEventListener('click', () => { distOverlay.hidden = false; });
  distClose.addEventListener('click', () => { distOverlay.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !distOverlay.hidden) distOverlay.hidden = true;
  });  
  
  // Close on clicking the backdrop
  distForm.addEventListener('change', () => {
    const formData = new FormData(distForm);
    state.distMode = formData.get('distMode');
  
    // Helper to safely get values
    const safeVal = (id, fallback) => {
      const el = document.getElementById(id);
      return el ? parseFloat(el.value) : fallback;
    };
  
    // Sync Bi-Monodisperse
    state.distParams.bi.vt1 = safeVal('biVt1', 10);
    state.distParams.bi.s1  = safeVal('biS1', 0);
    state.distParams.bi.vt2 = safeVal('biVt2', 40);
    state.distParams.bi.s2  = safeVal('biS2', 0);
    state.distParams.bi.ratio = safeVal('biRatio', 1.0);
  
    // Sync Powerlaw
    state.distParams.power.vtMin = safeVal('powMin', 5);
    state.distParams.power.vtMax = safeVal('powMax', 50);
    state.distParams.power.index = safeVal('powIndex', -3.5);
  
    // FIX THE BUTTON LIGHTING HERE
    const menuBtn = document.getElementById('btnDistMenu');
    if (menuBtn) {
      menuBtn.classList.toggle('on', state.distMode !== 'default');
    }
  
    updateGauge(); 
  });

  // SYSTEM 2. Omega control — three states: off / auto / launch
  // 0 = off, 1 = auto (live tracking), 2 = launch (wait, spin up, then track)
  window.autoOmegaOn  = false; // kept for compatibility with physics.js
  window.omegaCtlMode = 0;

  // Launch sub-states: 'waiting' | 'countdown' | 'spinup' | 'tracking'
  window.launchState    = 'waiting';
  window.launchT0       = null;  // wall time when injection was detected
  window.launchTWait    = 0;     // computed wait duration in seconds
  window.launchSpinT0   = null;  // wall time when spin-up started
  window.launchSpinDur  = 0;     // spin-up ramp duration in seconds
  window.launchOmegaTgt = 0;     // target omega for spin-up

  const btnSysAutoOmega = document.getElementById('btnSysAutoOmega');

  function setOmegaCtlMode(mode) {
    window.omegaCtlMode = mode;
    window.autoOmegaOn  = (mode === 1);

    if (btnSysAutoOmega) {
      btnSysAutoOmega.classList.remove('on', 'cheat');
      if (mode === 1) btnSysAutoOmega.classList.add('on');
      if (mode === 2) btnSysAutoOmega.classList.add('cheat');
    }

    if (mode === 2) {
      _resetLaunchState();
    } else {
      window.launchState = 'waiting';
    }
  }

  function _resetLaunchState() {
    window.launchState   = 'waiting';
    window.launchT0      = null;
    window.launchSpinT0  = null;
    const isEmpty = state.particles.length === 0 && state.toInject.length === 0;
    if (isEmpty) state.omegaTarget = 0;
  }

  function _computeOptimalWait() {
    // Find the time of peak flux at y=0: mode of KDE of arrival times.
    const arrivals = state.toInject.map(p => p.t + CFG.RELEASE_Y / p.vt);
    if (arrivals.length === 0) return 0;
    const n    = arrivals.length;
    const mean = arrivals.reduce((a, b) => a + b, 0) / n;
    const sig  = Math.sqrt(Math.max(0.01, arrivals.reduce((s, v) => s + (v - mean) ** 2, 0) / n));
    const bw   = 1.06 * sig * Math.pow(n, -0.2);
    const tMin = Math.min(...arrivals);
    const tMax = Math.max(...arrivals);
    let bestT = mean, bestK = -1;
    for (let i = 0; i <= 60; i++) {
      const t = tMin + (i / 60) * (tMax - tMin);
      let k = 0;
      for (const a of arrivals) { const z = (t - a) / bw; k += Math.exp(-0.5 * z * z); }
      if (k > bestK) { bestK = k; bestT = t; }
    }
    return Math.max(0, bestT - 1.0 / TUNING.drum.slipRate);
  }

  if (btnSysAutoOmega) {
    btnSysAutoOmega.addEventListener('click', () => {
      // Tray deploying/deployed → collection is terminal until Reset.
      // Block omega-control changes so auto/launch can't re-spin the drum
      // into the desynced on-tray state.
      if (state.tray.phase === 'inserting' || state.tray.phase === 'inserted') {
        showToast('Lab locked — press Reset to start a new run');
        return;
      }
      setOmegaCtlMode((window.omegaCtlMode + 1) % 3);
    });
  }
  
  window.setOmegaCtlMode  = setOmegaCtlMode;
  window._resetLaunchState = _resetLaunchState;

  // SYSTEM 3. COLLECTION TRAY
  const btnCollect = document.getElementById('btnCollect');

  if (btnCollect) {
    btnCollect.addEventListener('click', () => {
      const tray = state.tray;

      // Second press while armed → disarm
      if (tray.phase === 'armed') {
        tray.phase = 'idle';
        return;
      }

      // Only arm from idle; drum must be spinning
      if (tray.phase !== 'idle') return;
      if (Math.abs(state.omega) < 0.1) {
        btnCollect.classList.add('flash');
        setTimeout(() => btnCollect.classList.remove('flash'), 220);
        return;
      }

      // Compute next time the slot marker crosses 12 o'clock on screen.
      // Canvas angle of slot = slotAngle − drumAngle.
      // 12 o'clock on screen = −π/2  (sin = −1 → topmost pixel).
      const slotCanvas = tray.slotAngle - state.drumAngle;
      const target     = -Math.PI / 2;
      let delta = ((slotCanvas - target) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (delta < 0.2) delta += 2 * Math.PI;        // too close — wait one full turn
      if (state.omega < 0) delta = delta - 2 * Math.PI; // reverse drum direction

      tray.triggerAtAngle = state.drumAngle + delta;
      tray.phase          = 'armed';
      ensureAudio();
    });

    // Sync button appearance to tray phase every HUD tick
    const _origUpdateGauge = window.updateGauge;
    window.updateGauge = function () {
      _origUpdateGauge();
      const ph = state.tray.phase;
      btnCollect.classList.toggle('on',    ph === 'armed');
      btnCollect.classList.toggle('cheat', ph === 'inserting');
      btnCollect.disabled = (ph === 'inserting' || ph === 'inserted');
    };
  }


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

  // Cycles: normal → modern → pfeiffer → normal
  const STYLE_CYCLE = ['normal', 'modern', 'pfeiffer'];
  let currentStyleIdx = 0;

  function applyThemeStyle(name) {
    document.body.classList.remove('theme-modern', 'theme-pfeiffer');
    btnTheme.classList.remove('cheat');
    if (name === 'modern') {
      document.body.classList.add('theme-modern');
      btnTheme.classList.add('cheat');
    } else if (name === 'pfeiffer') {
      document.body.classList.add('theme-modern', 'theme-pfeiffer');
      btnTheme.classList.add('cheat');
    }
  }

  // Short press: toggle lights. Long press: cycle visual theme.
  let _themePressTimer = null;
  let _themeLongFired  = false;

  btnTheme.addEventListener('pointerdown', () => {
    _themeLongFired  = false;
    _themePressTimer = setTimeout(() => {
      _themeLongFired = true;
      currentStyleIdx = (currentStyleIdx + 1) % STYLE_CYCLE.length;
      applyThemeStyle(STYLE_CYCLE[currentStyleIdx]);
    }, 600);
  });

  const _cancelThemePress = () => {
    if (_themePressTimer) { clearTimeout(_themePressTimer); _themePressTimer = null; }
  };

  btnTheme.addEventListener('pointerup', () => {
    _cancelThemePress();
    if (!_themeLongFired) applyTheme(PAL.name === 'dark' ? 'light' : 'dark');
  });

  btnTheme.addEventListener('pointerleave',  _cancelThemePress);
  btnTheme.addEventListener('pointercancel', _cancelThemePress);


  // SYSTEM 4-6. Simulation speed

  const speedGears   = [0.015625, 0.03125, 0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
  let currentGearIdx = 6; // Default to 1.0x
  
  /**
   * Applies the current speed gear to state.simSpeed and updates the speed display label.
   */
  function updateSpeedUI() {
    const speed = speedGears[currentGearIdx];
    state.simSpeed = speed;
    const label = speed < 1.0 ? '/' + Math.round(1 / speed) : speed + 'x';
    
    const dispEl = document.getElementById('speedDisp');
    dispEl.textContent = label;
    dispEl.style.letterSpacing = speed < 1.0 ? '-1px' : '0px';
    
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
  function resetSimSpeed() {
    currentGearIdx = 6; // Snap back to 1.0x
    updateSpeedUI();
  }
  document.getElementById('btnSpeedReset').addEventListener('click', resetSimSpeed);
  window.resetSimSpeed = resetSimSpeed;
  
  // SYSTEM 7-9. Other Speed adjustments
  
  // SYSTEM 7. Stroboscopic rendering — paint once per drum revolution
  wireProcessButton('btnSysStrobe', 'on', (active) => {
    window.strobeOn = active;
    window._lastStrobeRev = Math.floor(Math.abs(state.drumAngle) / (2 * Math.PI));
  });

// SYSTEM 8. Slow Motion (short press) + Fast Chain (long press)
  let slowMoArmed = false; window.slowMoArmed = false;
  let fastChainActive = false;
  let slowMoPressTimer = null;
  let slowMoLongFired = false;

  const btnSlowMo = document.getElementById('btnProcSlowMo');

  btnSlowMo.addEventListener('pointerdown', () => {
    slowMoLongFired = false;
    slowMoPressTimer = setTimeout(() => {
      slowMoLongFired = true;
      fastChainActive = !fastChainActive;
      btnSlowMo.classList.toggle('cheat', fastChainActive);
      if (fastChainActive) {
        TUNING.aggregate.mergeCount      = 2;
        TUNING.aggregate.initialHoldRevs = 0;
        TUNING.aggregate.subseqHoldRevs  = 0;
        TUNING.egg.nCrit                 = 2;
        TUNING.egg.holdTarget            = 1;
        TUNING.egg.holdSubseq            = 1;
        TUNING.globe.nCrit               = 2;
      } else {
        TUNING.aggregate.mergeCount      = TUNING_DEFAULT.aggregate.mergeCount;
        TUNING.aggregate.initialHoldRevs = TUNING_DEFAULT.aggregate.initialHoldRevs;
        TUNING.aggregate.subseqHoldRevs  = TUNING_DEFAULT.aggregate.subseqHoldRevs;
        TUNING.egg.nCrit                 = TUNING_DEFAULT.egg.nCrit;
        TUNING.egg.holdTarget            = TUNING_DEFAULT.egg.holdTarget;
        TUNING.egg.holdSubseq            = TUNING_DEFAULT.egg.holdSubseq;
        TUNING.globe.nCrit               = TUNING_DEFAULT.globe.nCrit;
      }
    }, 2000);
  });

  const cancelSlowMoPress = () => {
    if (slowMoPressTimer) { clearTimeout(slowMoPressTimer); slowMoPressTimer = null; }
  };

  btnSlowMo.addEventListener('pointerup', () => {
    cancelSlowMoPress();
    if (slowMoLongFired) { slowMoLongFired = false; return; }
    // Short press: toggle slow-mo
    slowMoArmed = !slowMoArmed;
    window.slowMoArmed = slowMoArmed;
    btnSlowMo.classList.toggle('on', slowMoArmed);
    if (!slowMoArmed) {
      CFG.MAX_DT = 0.033;
      TUNING.egg.mergeDur       = TUNING_DEFAULT.egg.mergeDur;
      TUNING.aggregate.mergeDur = TUNING_DEFAULT.aggregate.mergeDur;
      TUNING.globe.mergeDur     = TUNING_DEFAULT.globe.mergeDur;
    }
  });

  btnSlowMo.addEventListener('pointerleave',  cancelSlowMoPress);
  btnSlowMo.addEventListener('pointercancel', cancelSlowMoPress);

  // SYSTEM 9. Zoom mode — levitation zone fills drum area
  window.zoomOn = false;
  wireProcessButton('btnProcFast', 'on', (active) => {
    window.zoomOn = active;
  });

  cv.addEventListener('mousedown', function(e) {
    if (!window.ghostModeOn) return;
    const coords = getLocalCoords(e.clientX, e.clientY);
    let closestDist = Infinity, selected = null;
    state.particles.forEach(p => {
      if (!p.alive || !p.insideOnce || p.stuck) return;
      const dx = p.x - coords.x, dy = p.y - coords.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < closestDist) { closestDist = d2; selected = p; }
    });
    _ghostClear();
    if (selected) selected.isDiagnosticTarget = true;
  });
  
  // ============================================================
  // SECTION: EXPERT DOOR & URL FLAGS
  // ============================================================
  // URL flags (all optional, all checked here):
  //   ?expert       Open the expert door (public-facing).
  //                 do not document for users — Fast Chain ruins the discovery arc).
  //   ?verify       Developer test mode: 3000 particles, vt=30, spread=30%, dt=2,
  //                 omega decay disabled. For rapid full-system smoke tests.
  //   ?game[=N]     Drop straight into Game Mode (optionally at level N, 1-indexed),
  //                 splash suppressed. Out-of-range or non-numeric N falls back to 1.
  //   ?challenge    Drop straight into Challenge Mode using current settings,
  //                 splash suppressed.
  //   ?modern       Apply the clinical lab visual theme.
  //   ?pfeiffer     Apply the Pfeiffer (red) variant of the modern theme.
  //
  // Flags can be combined (e.g. ?expert&game=3, ?modern&challenge).
  // Splash suppression for ?game and ?challenge happens inside initSplash by
  // reading the URL directly — see the SPLASH SCREEN section above.
  const expertContainer = document.getElementById('expertContainer');
  const titlePlateLink = document.getElementById('titlePlate');
 
  const uP = new URLSearchParams(window.location.search);
  isExpertURL = uP.has('expert');
  
  // Honour URL theme flags at startup
  if (uP.has('pfeiffer')) {
    currentStyleIdx = 2;
    applyThemeStyle('pfeiffer');
  } else if (uP.has('modern')) {
    currentStyleIdx = 1;
    applyThemeStyle('modern');
  }
  
  const expertDoor = document.getElementById('expertDoor');

  // 1. PHYSICAL DOOR INTERACTION (Sound & Rattle)
  if (expertDoor && expertContainer) {
    expertDoor.addEventListener('click', (e) => {
      // Only rattle/sound if the door is currently closed
      if (!expertContainer.classList.contains('open')) {
        e.preventDefault();
        e.stopPropagation(); // Prevents this click from reaching the Title Plate secret

        // Play the heavy cavernous sound defined in audio.js
        if (window.soundExpertDoorKnock) {
          window.soundExpertDoorKnock();
        }

        // Trigger visual rattle
        expertDoor.classList.remove('rattle'); 
        void expertDoor.offsetWidth; // Magic line to force animation reset
        expertDoor.classList.add('rattle');
      }
    });
  }

  // Unified access: ?expert automatically opens the door
  if (isExpertURL && expertContainer) {
    expertContainer.classList.add('open');
    setOmegaDecay(true);
  }

  // ?verify — rapid full-test mode: floods the drum quickly with high spread and no decay
  if (uP.has('verify')) {
    SETTINGS.NP.idx     = SETTINGS.NP.values.indexOf(3000);
    SETTINGS.VT.idx     = SETTINGS.VT.values.indexOf(30);
    SETTINGS.SPREAD.idx = SETTINGS.SPREAD.values.indexOf(0.30);
    SETTINGS.DT.idx     = SETTINGS.DT.values.indexOf(2);
    applyInitialSettings();
    setOmegaDecay(true);
  }

  // ?game[=N] — drop straight into Game Mode, optionally at level N (1-indexed)
  if (uP.has('game')) {
    let startLevel = 0;
    const raw = uP.get('game');
    if (raw !== null && raw !== '') {
      const lvl = parseInt(raw, 10);
      if (Number.isFinite(lvl) && lvl >= 1 && lvl <= GAME.levels.length) {
        startLevel = lvl - 1;
      }
    }
    setTimeout(() => { enterGameMode(true, startLevel); }, 0);
  }

  // ?challenge — drop straight into Challenge Mode using challenge defaults.
  // Optional URL overrides: np, vt, spread, dt (applied after defaults).
  if (uP.has('challenge')) {
    setTimeout(() => {
      enterChallengeMode(true);
      // ?challenge is the canonical comparable run: force CHALLENGE_CFG
      // defaults (entry no longer does this), then apply selective URL
      // overrides on top, exactly as documented in the manual.
      if (window.applyChallengeDefaults) window.applyChallengeDefaults();
      if (uP.has('np'))     setSettingByValue('NP',     parseInt(uP.get('np'), 10));
      if (uP.has('vt'))     setSettingByValue('VT',     parseFloat(uP.get('vt')));
      if (uP.has('spread')) setSettingByValue('SPREAD', parseFloat(uP.get('spread')));
      if (uP.has('dt'))     setSettingByValue('DT',     parseFloat(uP.get('dt')));
      if (uP.has('time')) {
        const tv = parseFloat(uP.get('time'));
        state.challengeTimeOverride = (isFinite(tv) && tv > 0) ? tv : null;
      }
      showChallengeIntro(); // refresh sheet with final parameter values
    }, 0);
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
  window._ghostClear        = _ghostClear;
  window._ghostEnsureTarget = _ghostEnsureTarget;
  window._zoomRestore       = _zoomRestore;
  window.setOmegaDecay      = setOmegaDecay;
  window.setOmegaCtlMode    = setOmegaCtlMode;
  window._resetLaunchState  = _resetLaunchState;
  window._computeOptimalWait = _computeOptimalWait;
})();

