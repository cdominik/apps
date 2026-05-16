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
  /**
   * Reads simulation state and updates the period, floating, levitated, and
   * captured counters in the HUD; reveals the aggregate and pebble gauges on
   * their first non-zero appearance.
   */
  function updateGauge() {
    const T = state.period();
    elPeriod.textContent = isFinite(T) ? T.toFixed(2) : '∞';
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
  
    elFloating.textContent = floating;
    elCaptured.textContent = state.lostCount;
    elRemaining.textContent = levitated;
  
    // --- CONDITIONAL DISPLAY OVERRIDE ---
    const label = state.distLabels[state.distMode];
    const winVT = SEL_WIN.VT;
    const winSpread = SEL_WIN.SPREAD;
  
    if (label) {
      // A custom label exists, apply the Expert Orange override
      winVT.textContent = label;
      winVT.style.color = "#ff8c30";
      winVT.style.fontSize = "10px";
      
      winSpread.textContent = label;
      winSpread.style.color = "#ff8c30";
      winSpread.style.fontSize = "10px";
    } else {
      // No custom label (default mode), restore Standard SETTINGS
      const sVT = SETTINGS.VT;
      const sSpread = SETTINGS.SPREAD;
      
      winVT.textContent = sVT.label(sVT.values[sVT.idx]);
      winVT.style.color = ""; 
      winVT.style.fontSize = ""; 
  
      winSpread.textContent = sSpread.label(sSpread.values[sSpread.idx]);
      winSpread.style.color = "";
      winSpread.style.fontSize = "";
    }

    // Dynamic Aggregate Gauge
    const activeAggs = state.aggCount;
    if (activeAggs > 0) {
      if (gaugeAgg.style.display === 'none') {
        gaugeAgg.style.display = 'flex';
        soundGoldenChime();
      }
      elAggCount.textContent = activeAggs;
    } else {
      elAggCount.textContent = 0;
    }
  
    // Dynamic Pebble Gauge
    if (state.eggBallCount > 0) {
      if (gaugePebble.style.display === 'none') {
        gaugePebble.style.display = 'flex';
        soundGoldenChime();
      }
    }
    if (gaugePebble.style.display !== 'none') {
      elPebbleCount.textContent = state.eggBallCount;
    }
    if (gaugePebble.style.display !== 'none') {
      elPebbleCount.textContent = state.eggBallCount;
    }

    // Challenge countdown — visible only during an active challenge run.
    // Limit expression MUST match updateChallenge() so it honors ?time
    // and never drifts: (override || CHALLENGE_CFG.TIME_LIMIT) + DT_INJECT.
    if (typeof CHALLENGE !== 'undefined' && CHALLENGE.on &&
        CHALLENGE.phase === 'playing') {
      const baseLimit = (typeof state.challengeTimeOverride === 'number' &&
                         isFinite(state.challengeTimeOverride) &&
                         state.challengeTimeOverride > 0)
        ? state.challengeTimeOverride
        : CHALLENGE_CFG.TIME_LIMIT;
      const limit   = baseLimit + CFG.DT_INJECT;
      const elapsed = state.t - CHALLENGE.startTime;
      const left    = Math.max(0, Math.ceil(limit - elapsed));
      if (gaugeTime.style.display === 'none') gaugeTime.style.display = 'flex';
      elChalTimeLeft.textContent = left;
    } else if (gaugeTime.style.display !== 'none') {
      gaugeTime.style.display = 'none';
    }

    // Tray arming beep
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
