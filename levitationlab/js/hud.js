/**
 * @file hud.js
 * @description
 *   Heads-up display: period, floating/levitated/captured counters, aggregate
 *   and pebble gauges. Also owns the parameter selectors (NP, VT, SPREAD, DT)
 *   including their click wiring and initial application.
 *
 * Exposes globals: updateHUD, SETTINGS, SEL_WIN, cycleSetting,
 *                  applyInitialSettings
 * Reads globals:   CFG, state, soundChime, soundGoldenChime
 */
(() => {
  'use strict';

  // ============================================================
  // SECTION: HUD
  // ============================================================
  const elPeriod = document.getElementById('period');
  const elFloating = document.getElementById('floating');
  const elCaptured = document.getElementById('captured');
  const elRemaining = document.getElementById('remaining');
  const elAggCount = document.getElementById('aggCount');
  const elPebbleCount = document.getElementById('pebbleCount');
  const gaugeAgg = document.getElementById('gaugeAgg');
  const gaugePebble = document.getElementById('gaugePebble');
  /**
   * Reads simulation state and updates the period, floating, levitated, and
   * captured counters in the HUD; reveals the aggregate and pebble gauges on
   * their first non-zero appearance.
   */
  function updateHUD() {
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    elPeriod.textContent = isFinite(T) ? T.toFixed(2) : '∞';
    let floating = 0, levitated = 0;
  
    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck) { p.wasLevitated = false; continue; }
      if (p.merging) continue;
  
      floating++;
      const nowLev = isFinite(T) && p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= T;
  
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
    // Only show "CUSTOM" if we are NOT in the standard Gaussian mode
    const isCustom = state.distMode && state.distMode !== 'default';
    const winVT = SEL_WIN.VT;
    const winSpread = SEL_WIN.SPREAD;
  
    if (isCustom) {
      winVT.textContent = "CUSTOM";
      winVT.style.color = "#ff8c30"; // Expert orange
      winVT.style.fontSize = "10px";
      
      winSpread.textContent = "CUSTOM";
      winSpread.style.color = "#ff8c30";
      winSpread.style.fontSize = "10px";
    } else {
      // Restore default labels from SETTINGS[cite: 4]
      const sVT = SETTINGS.VT;
      const sSpread = SETTINGS.SPREAD;
      
      winVT.textContent = sVT.label(sVT.values[sVT.idx]);
      winVT.style.color = ""; // Reverts to CSS green
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
      elPebbleCount.textContent = state.eggBallCount;
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
  document.querySelectorAll('.sel').forEach(sel => {
    const key = sel.getAttribute('data-key');
    sel.querySelectorAll('.chev').forEach(ch => {
      const dir = parseInt(ch.getAttribute('data-dir'), 10);
      ch.addEventListener('click', (e) => { e.preventDefault(); cycleSetting(key, dir); });
    });
    const win = sel.querySelector('.win');
    if (win) win.addEventListener('click', (e) => { e.preventDefault(); cycleSetting(key, +1); });
  });
  applyInitialSettings();

  window.updateHUD          = updateHUD;
  window.SETTINGS           = SETTINGS;
  window.SEL_WIN            = SEL_WIN;
  window.cycleSetting       = cycleSetting;
  window.applyInitialSettings = applyInitialSettings;
})();
