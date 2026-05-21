/**
 * @file gauge.js
 * @description
 *   Heads-up display: period, floating/levitated/captured counters, aggregate
 *   and pebble gauges. Also owns the parameter selectors (NP, VT, SPREAD, DT)
 *   including their click wiring and initial application.
 *
* Exposes globals: GAME, CHALLENGE, enterGameMode, enterChallengeMode,
 *                  updateGame, updateChallenge, showSheet, lockSelectors,
 *                  setSettingByValue, showChallengeIntro, setChallengeBtnLabel
 * Reads globals:   TUNING, TUNING_DEFAULT, CFG, CHALLENGE_CFG, state,
 *                  SETTINGS, SEL_WIN, initLevel, startRelease,
 *                  ensureAudio, soundMillStart, layout,
 *                  hideVideoElement
  */
(() => {
  'use strict';

  // ============================================================
  // SECTION: GAUGES
  // ============================================================
  const elPeriod = document.getElementById('period');
  const elFloating = document.getElementById('floating');
  const elCaptured = document.getElementById('captured');
  const elRemaining = document.getElementById('remaining');
  const elAggCount = document.getElementById('aggCount');
  const elPebbleCount = document.getElementById('pebbleCount');
  const gaugeAgg = document.getElementById('gaugeAgg');
  const gaugePebble = document.getElementById('gaugePebble');
  const gaugeTime = document.getElementById('gaugeTime');
  const elChalTimeLeft = document.getElementById('chalTimeLeft');

  // NEW: UI Cache for dirty-checking DOM updates
  const uiCache = {
    periodStr: null,
    floating: null,
    captured: null,
    remaining: null,
    aggCount: null,
    pebbleCount: null,
    chalTimeLeft: null,
    aggVisible: false,
    pebbleVisible: false,
    timeVisible: false,
    distLabelMode: null // Tracks if standard or custom labels are applied
  };

  /**
   * Reads simulation state and updates the period, floating, levitated, and
   * captured counters in the HUD; reveals the aggregate and pebble gauges on
   * their first non-zero appearance.
   */
  function updateGauge() {
    // --- PERIOD ---
    const T = state.period();
    const periodStr = isFinite(T) ? parseFloat(T.toPrecision(3)) : '∞';
    if (periodStr !== uiCache.periodStr) {
      elPeriod.textContent = periodStr;
      uiCache.periodStr = periodStr;
    }
  
    // --- LEVITATION LOGIC (unchanged to preserve chime sounds) ---
    let floating = 0, levitated = 0;
    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck || p.onTray) { p.wasLevitated = false; continue; }
      if (p.merging) continue;
  
      floating++;
      const nowLev = state.isLevitated(p);
  
      if (nowLev) {
        levitated++;
        if (!p.wasLevitated) {
          soundChime();
          p.wasLevitated = true;
        }
      } else if (p.wasLevitated) {
        p.wasLevitated = false;
      }
    }
  
    // --- BASIC COUNTERS ---
    if (floating !== uiCache.floating) {
      elFloating.textContent = floating;
      uiCache.floating = floating;
    }
    if (state.lostCount !== uiCache.captured) {
      elCaptured.textContent = state.lostCount;
      uiCache.captured = state.lostCount;
    }
    if (levitated !== uiCache.remaining) {
      elRemaining.textContent = levitated;
      uiCache.remaining = levitated;
    }
  
    // --- CONDITIONAL DISPLAY OVERRIDE (Expert Orange) ---
    // FIX 1: Safely check if distLabels exists to prevent the crash
    const label = state.distLabels ? state.distLabels[state.distMode] : undefined;
    const winVT = SEL_WIN.VT;
    const winSpread = SEL_WIN.SPREAD;
  
    if (label) {
      if (uiCache.distLabelMode !== state.distMode) {
        winVT.textContent = label;
        winVT.style.color = "#ff8c30";
        winVT.style.fontSize = "10px";
        
        winSpread.textContent = label;
        winSpread.style.color = "#ff8c30";
        winSpread.style.fontSize = "10px";
        uiCache.distLabelMode = state.distMode;
      }
    } else {
      if (uiCache.distLabelMode !== 'default') {
        const sVT = SETTINGS.VT;
        const sSpread = SETTINGS.SPREAD;
        
        winVT.textContent = sVT.label(sVT.values[sVT.idx]);
        winVT.style.color = ""; 
        winVT.style.fontSize = ""; 
    
        winSpread.textContent = sSpread.label(sSpread.values[sSpread.idx]);
        winSpread.style.color = "";
        winSpread.style.fontSize = "";
        uiCache.distLabelMode = 'default';
      }
    }

    // --- AGGREGATE GAUGE ---
    const activeAggs = state.aggCount;
    if (activeAggs > 0) {
      if (!uiCache.aggVisible) {
        gaugeAgg.style.display = 'flex';
        soundGoldenChime();
        uiCache.aggVisible = true;
      }
      if (activeAggs !== uiCache.aggCount) {
        elAggCount.textContent = activeAggs;
        uiCache.aggCount = activeAggs;
      }
    } else {
      // FIX 2: Properly hide the gauge when count returns to 0 (e.g., on reset)
      if (uiCache.aggVisible) {
        gaugeAgg.style.display = 'none';
        uiCache.aggVisible = false;
      }
      if (uiCache.aggCount !== 0) {
        elAggCount.textContent = 0;
        uiCache.aggCount = 0;
      }
    }
  
    // --- PEBBLE GAUGE ---
    if (state.eggBallCount > 0) {
      if (!uiCache.pebbleVisible) {
        gaugePebble.style.display = 'flex';
        soundGoldenChime();
        uiCache.pebbleVisible = true;
      }
      if (state.eggBallCount !== uiCache.pebbleCount) {
        elPebbleCount.textContent = state.eggBallCount;
        uiCache.pebbleCount = state.eggBallCount;
      }
    } else {
      // FIX 2: Properly hide the gauge when count returns to 0
      if (uiCache.pebbleVisible) {
        gaugePebble.style.display = 'none';
        uiCache.pebbleVisible = false;
      }
      if (uiCache.pebbleCount !== 0) {
        elPebbleCount.textContent = 0;
        uiCache.pebbleCount = 0;
      }
    }

    // --- TRAY ARMING BEEP ---
    const BEEP_INTERVAL = 1.0;
    if (state.tray.phase === 'armed' || state.tray.phase === 'inserting') {
      if (!updateGauge._lastBeep ||
          (state.t - updateGauge._lastBeep) >= BEEP_INTERVAL) {
        updateGauge._lastBeep = state.t;
        soundTrayBeep();
      }
    } else {
      updateGauge._lastBeep = null;
    }
  }

  // ============================================================
  // SECTION: SETTINGS SELECTORS
  // ============================================================
  const SETTINGS = {
    NP:     { values: [1, 2, 3, 10, 30, 100, 300, 1000, 3000, 10000], idx: 2, apply: (v) => { CFG.N_P = v; }, label: (v) => String(v) },
    VT:     { values: [2,5,10, 20, 30, 40, 50], idx: 2, apply: (v) => { CFG.V_T = v; }, label: (v) => String(v) },
    SPREAD: { values: [0, 0.01, 0.02, 0.05, 0.10, 0.20, 0.30, 0.50], idx: 3, apply: (v) => { CFG.VT_SPREAD = v; }, label: (v) => Math.round(v * 100) + '%' },
    DT:     { values: [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], idx: 2, apply: (v) => { CFG.DT_INJECT = v; }, label: (v) => (v + ' s') },
  };
  const SEL_WIN = {
    NP: document.getElementById('winNP'),
    VT: document.getElementById('winVT'),
    SPREAD: document.getElementById('winSpread'),
    DT: document.getElementById('winDT'),
  };
  /**
   * Advances a parameter selector one step and applies the new value.
   *
   * @param {string} key - SETTINGS key (e.g. 'NP', 'VT', 'SPREAD', 'DT').
   * @param {number} dir - Step direction: +1 for forward, -1 for backward.
   */
  function cycleSetting(key, dir) {
    const s = SETTINGS[key];
    // Clamp the index between 0 and the highest available array index
    s.idx = Math.max(0, Math.min(s.values.length - 1, s.idx + dir));
    const v = s.values[s.idx];
    s.apply(v);
    SEL_WIN[key].textContent = s.label(v);
  }
  /**
   * Iterates all SETTINGS keys, applies each current value to CFG, and
   * updates the corresponding display window to match.
   */
  function applyInitialSettings() {
    for (const key of Object.keys(SETTINGS)) {
      const s = SETTINGS[key];
      const v = s.values[s.idx];
      s.apply(v);
      SEL_WIN[key].textContent = s.label(v);
    }
  }
  // Update the window click listeners to handle shortcuts
  document.querySelectorAll('.sel').forEach(sel => {
    const key = sel.getAttribute('data-key');
    const win = sel.querySelector('.win');
    
    if (win) {
      win.addEventListener('click', (e) => {
        e.preventDefault();
        
        // If a custom distribution is active and the user clicks VT or SPREAD
        const isCustom = state.distMode !== 'default';
        const isTargetKey = (key === 'VT' || key === 'SPREAD');

        if (isCustom && isTargetKey) {
          // SHORTCUT: Open the distribution overlay
          document.getElementById('distOverlay').hidden = false;
        } else {
          // DEFAULT: Cycle the setting normally
          cycleSetting(key, +1);
        }
      });
    }
    
    // Keep chevron behavior standard (optional: you could make them open the menu too)
    sel.querySelectorAll('.chev').forEach(ch => {
      const dir = parseInt(ch.getAttribute('data-dir'), 10);
      ch.addEventListener('click', (e) => { 
        e.preventDefault(); 
        cycleSetting(key, dir); 
      });
    });
  });
  applyInitialSettings();

  window.updateGauge        = updateGauge;
  window.SETTINGS           = SETTINGS;
  window.SEL_WIN            = SEL_WIN;
  window.cycleSetting       = cycleSetting;
  window.applyInitialSettings = applyInitialSettings;
})();
