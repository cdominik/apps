/**
 * @file game.js
 * @description
 *   Game Mode (7 progressive levels with win/fail sheets) and Challenge Mode
 *   (timed levitation run with a persistent leaderboard). Also fires the
 *   initial layout() and initLevel() calls that start the simulation.
 *
 * Exposes globals: GAME, CHALLENGE, enterGameMode, enterChallengeMode,
 *                  updateGame, updateChallenge, showSheet, lockSelectors
 * Reads globals:   TUNING, TUNING_DEFAULT, CFG, state,
 *                  SETTINGS, SEL_WIN, initLevel, startRelease,
 *                  ensureAudio, soundMillStart, layout,
 *                  hideVideoElement
 */
(() => {
  'use strict';

  // Button refs reused from DOM (also declared in BUTTON WIRING — MAIN in the IIFE)
  const btnStart    = document.getElementById('btnStart');
  const btnReset    = document.getElementById('btnReset');
  const btnLaser    = document.getElementById('btnLaser');
  const btnTrails   = document.getElementById('btnTrails');

  // ============================================================
  // SECTION: GAME MODE
  // ============================================================
  const GAME = {
    on: false,
    levelIdx: 0,
    phase: 'idle',
    goalHoldSince: null,

    levels: [
      {
        name: 'First levitation',
        params: { NP: 3, VT: 20, SPREAD: 0, DT: 1, trails: false, laser: false },
        goal: { minLevitated: 1, holdSeconds: 3 },
        describe: function() { return 'Levitate ' + this.goal.minLevitated + ' for ' + this.goal.holdSeconds + 's'; }
      },
      {
        name: 'The Feedback Loop',
        params: { NP: 3, VT: 30, SPREAD: 0, DT: 1, trails: true, laser: false },
        goal: { minLevitated: 2, holdSeconds: 5 },
        describe: function() { return 'Levitate ' + this.goal.minLevitated + ' for ' + this.goal.holdSeconds + 's'; }
      },
      {
        name: 'High-Mass Handling',
        params: { NP: 3, VT: 50, SPREAD: 0, DT: 1, trails: true, laser: false },
        goal: { minLevitated: 2, holdSeconds: 5 },
        describe: function() { return 'Handle faster particles (v_t=50) for ' + this.goal.holdSeconds + 's'; }
      },
      {
        name: 'A Mixed Batch',
        params: { NP: 10, VT: 30, SPREAD: 0.05, DT: 2, trails: false, laser: false },
        goal: { minLevitated: 4, holdSeconds: 5 },
        describe: function() { return 'Handle a 5% speed spread and levitate ' + this.goal.minLevitated + ' particles.'; }
      },
      {
        name: 'Lidar Navigation',
        params: { NP: 30, VT: 30, SPREAD: 0.10, DT: 2, trails: false, laser: true },
        goal: { minLevitated: 10, holdSeconds: 10 },
        describe: function() { return 'Navigate in the dark using the laser scan.'; }
      },
      {
        name: 'Aggregate Synthesis',
        params: { NP: 50, VT: 30, SPREAD: 0.20, DT: 3, trails: true, laser: false },
        goal: { minLevitated: 1, holdSeconds: 0, minAggregates: 1 },
        describe: function() { return 'Increase collisions to form your first aggregate.'; }
      },
      {
        name: 'Pebble Synthesis',
        params: { NP: 300, VT: 30, SPREAD: 0.30, DT: 5, trails: true, laser: false },
        goal: { minLevitated: 0, holdSeconds: 0, minPebbles: 1 },
        describe: function() { return 'Form a Pebble by merging multiple aggregates.'; }
      }
    ]
  };

  const elTitlePlate = document.getElementById('titlePlate');
  const btnGameMode  = document.getElementById('btnGameMode');
  const gameSheet    = document.getElementById('gameSheet');
  const sheetTitle   = document.getElementById('sheetTitle');
  const sheetDesc    = document.getElementById('sheetDesc');
  const sheetBtn     = document.getElementById('sheetBtn');
  let sheetAction    = null;

  /**
   * Sets a SETTINGS selector to a specific value, inserting it into the
   * values array (sorted) if it is not already present.
   *
   * @param {string} key   - SETTINGS key (e.g. 'NP', 'VT', 'SPREAD', 'DT').
   * @param {number} value - The exact value to select.
   */
  function setSettingByValue(key, value) {
    const s = SETTINGS[key];
    let idx = s.values.indexOf(value);
    if (idx < 0) {
      s.values = s.values.concat([value]).sort((a, b) => a - b);
      idx = s.values.indexOf(value);
    }
    s.idx = idx;
    s.apply(value);
    SEL_WIN[key].textContent = s.label(value);
  }

  /**
   * Applies a game level's parameter object to CFG, TUNING, and the
   * trail/laser button states.
   *
   * @param {Object} level - A GAME.levels entry with a `params` sub-object.
   */
  function applyLevelParams(level) {
    setSettingByValue('NP', level.params.NP);
    setSettingByValue('VT', level.params.VT);
    setSettingByValue('SPREAD', level.params.SPREAD);
    setSettingByValue('DT', level.params.DT);

    state.trailsOn = !!level.params.trails;
    btnTrails.classList.toggle('on', state.trailsOn);

    state.laserOn = !!level.params.laser;
    btnLaser.classList.toggle('on', state.laserOn);

    TUNING.drum.omegaDecay = (level.params.omegaDecay != null)
      ? level.params.omegaDecay
      : (GAME._savedOmegaDecay != null ? GAME._savedOmegaDecay : 1.0 / 30.0);

    TUNING.aggregate.vtFactor = (level.params.vtFactor != null)
      ? level.params.vtFactor
      : (GAME._savedVtFactor != null ? GAME._savedVtFactor : 1.0);
  }

  /**
   * Toggles the `locked` CSS class on all `.sel` elements.
   *
   * @param {boolean} lock - True to lock (add class), false to unlock (remove class).
   */
  function lockSelectors(lock) {
    document.querySelectorAll('.sel').forEach(el => el.classList.toggle('locked', lock));
  }

  /**
   * Returns the current GAME level object.
   *
   * @returns {Object} The GAME.levels entry at the current levelIdx.
   */
  function currentLevel() { return GAME.levels[GAME.levelIdx]; }

  /**
   * Populates and shows the game overlay sheet.
   *
   * @param {string}   title    - Sheet heading text.
   * @param {string}   desc     - Sheet body/description text.
   * @param {string}   btnText  - Label for the sheet's action button.
   * @param {Function} actionFn - Callback invoked when the action button is clicked.
   */
  function showSheet(title, desc, btnText, actionFn) {
    sheetTitle.textContent = title;
    sheetDesc.textContent = desc;
    sheetBtn.textContent = btnText;
    sheetAction = actionFn;
    gameSheet.hidden = false;
  }

  sheetBtn.addEventListener('click', () => {
    if (sheetAction) sheetAction();
  });

  /**
   * Transitions GAME to idle phase: unlocks selectors, applies the current
   * level's parameters, and shows the level-start sheet.
   */
  function enterIdle() {
    GAME.phase = 'idle';
    GAME.goalHoldSince = null;
    lockSelectors(false);
    const lv = currentLevel();
    applyLevelParams(lv);
    showSheet(`Level ${GAME.levelIdx + 1}: ${lv.name}`, lv.describe(), 'Start', () => {
      gameSheet.hidden = true;
      startGameRun();
    });
  }

  /**
   * Enables or disables Game Mode. On entry, saves current TUNING overrides
   * and starts level 1 idle; on exit, restores saved TUNING and resets state.
   *
   * @param {boolean} on - True to enable Game Mode, false to disable.
   */
  function enterGameMode(on, startLevel) {
    GAME.on = on;
    btnGameMode.classList.toggle('on', on);
    if (on && typeof CHALLENGE !== 'undefined' && CHALLENGE.on) enterChallengeMode(false);
    if (elTitlePlate) elTitlePlate.hidden = on || (typeof CHALLENGE !== 'undefined' && CHALLENGE.on);

    if (on) {
      GAME._savedVtFactor   = TUNING.aggregate.vtFactor;
      GAME._savedOmegaDecay = TUNING.drum.omegaDecay;
      GAME.levelIdx = (Number.isInteger(startLevel) && startLevel >= 0 && startLevel < GAME.levels.length)
        ? startLevel
        : 0;
      enterIdle();
    } else {
      lockSelectors(false);
      GAME.phase = 'idle';
      GAME.goalHoldSince = null;
      gameSheet.hidden = true;
      if (GAME._savedVtFactor != null) {
        TUNING.aggregate.vtFactor = GAME._savedVtFactor;
      }
      if (GAME._savedOmegaDecay != null) {
          GAME._savedOmegaDecay = TUNING.drum.omegaDecay;
      }
      initLevel();
    }
  }

  /**
   * Begins a game run: locks selectors, releases particles, and fires the
   * mill start sound.
   */
  function startGameRun() {
    GAME.phase = 'playing';
    GAME.goalHoldSince = null;
    lockSelectors(true);
    startRelease();

    state.omega = 0;
    state.omegaTarget = 0;

    btnStart.classList.add('on');
    ensureAudio();
    const dur = (CFG.N_P <= 1) ? 0 : CFG.DT_INJECT;
    soundMillStart(dur);

    if (btnStart.injectTimeout) clearTimeout(btnStart.injectTimeout);
    btnStart.injectTimeout = setTimeout(() => {
      btnStart.classList.remove('on');
    }, Math.max(250, dur * 1000));
  }

  /**
   * Ends a game run and shows the appropriate outcome sheet.
   *
   * @param {string} outcome - 'won', 'lost', or 'aborted'.
   */
  function endGameRun(outcome) {
    GAME.phase = outcome;
    GAME.goalHoldSince = null;
    lockSelectors(false);
    state.running = false;
    btnStart.classList.remove('on');

    state.omega = 0;
    state.omegaTarget = 0;

    if (outcome === 'won') {
      showSheet('Level Complete', currentLevel().name + ' cleared.', 'Next Level', () => {
        GAME.levelIdx = (GAME.levelIdx + 1) % GAME.levels.length;
        enterIdle();
      });
    } else if (outcome === 'lost') {
      showSheet('Failed', 'Not enough particles levitated.', 'Retry', () => {
        enterIdle();
      });
    }
  }

  /**
   * Called every frame; checks win/fail conditions for the active game level
   * and calls endGameRun() when a condition is met.
   */
  function updateGame() {
    if (!GAME.on || GAME.phase !== 'playing') return;
    const lv = currentLevel();

    if (lv.goal.minPebbles !== undefined) {
      if (state.eggBallCount >= lv.goal.minPebbles) {
        endGameRun('won');
        return;
      }
    }

    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    let lev = 0, floating = 0;

    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck) continue;
      floating++;
      if (isFinite(T) && p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= T) lev++;
    }

    if (lev >= lv.goal.minLevitated) {
      if (GAME.goalHoldSince === null) GAME.goalHoldSince = state.t;
      if (state.t - GAME.goalHoldSince >= lv.goal.holdSeconds) {
        endGameRun('won');
        return;
      }
    } else {
      GAME.goalHoldSince = null;
      const allInjected = state.toInject.length === 0;
      if (allInjected && floating < lv.goal.minLevitated && lv.goal.minPebbles === undefined) {
        endGameRun('lost');
      }
    }
  }

  btnGameMode.addEventListener('click', () => enterGameMode(!GAME.on));
  btnGameMode.classList.remove('disabled');

  // ============================================================
  // SECTION: CHALLENGE MODE
  // ============================================================
  const CHALLENGE = {
    on: false,
    phase: 'idle',
    startTime: 0,
    scores: JSON.parse(localStorage.getItem('levitation_highscores') || '[]')
  };

  const btnChallenge   = document.getElementById('btnChallenge');
  const challengeSheet = document.getElementById('challengeSheet');
  const chalTitle      = document.getElementById('chalTitle');
  const chalDesc       = document.getElementById('chalDesc');
  const chalStartBtn   = document.getElementById('chalStartBtn');
  const chalInputArea  = document.getElementById('chalInputArea');
  const chalNameInput  = document.getElementById('chalNameInput');
  const chalSubmitBtn  = document.getElementById('chalSubmitBtn');
  const chalFinalScore = document.getElementById('chalFinalScore');
  const chalBoardArea  = document.getElementById('chalBoardArea');
  const chalTableBody  = document.querySelector('#chalTable tbody');
  const chalNextBtn    = document.getElementById('chalNextBtn');

  /**
   * Persists CHALLENGE.scores to localStorage under the key
   * 'levitation_highscores'.
   */
  function saveHighscores() {
    localStorage.setItem('levitation_highscores', JSON.stringify(CHALLENGE.scores));
  }

  /**
   * Renders the top-7 highscores into the leaderboard table, sorted by
   * descending score.
   */
  function renderHighscores() {
    chalTableBody.innerHTML = '';
    CHALLENGE.scores.sort((a, b) => b.score - a.score);
    const top = CHALLENGE.scores.slice(0, 7);
    top.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${idx + 1}</td><td>${entry.name}</td><td class="score-col">${entry.score}</td>`;
      chalTableBody.appendChild(tr);
    });
  }

  /**
   * Enables or disables Challenge Mode. On entry shows the challenge intro
   * sheet; on exit hides the sheet, unlocks selectors, and resets the level.
   *
   * @param {boolean} on - True to enable Challenge Mode, false to disable.
   */
  function enterChallengeMode(on) {
    CHALLENGE.on = on;
    btnChallenge.classList.toggle('on', on);

    if (on && GAME.on) enterGameMode(false);
    if (elTitlePlate) elTitlePlate.hidden = on || GAME.on;

    if (on) {
      CHALLENGE.phase = 'idle';
      showChallengeIntro();
    } else {
      CHALLENGE.phase = 'idle';
      challengeSheet.hidden = true;
      lockSelectors(false);
      hideVideoElement();
      initLevel();
    }
  }

  const chalExitBtn  = document.getElementById('chalExitBtn');
  const chalClearBtn = document.getElementById('chalClearBtn');

  if (chalExitBtn) {
    chalExitBtn.addEventListener('click', () => { enterChallengeMode(false); });
  }

  if (chalClearBtn) {
    chalClearBtn.addEventListener('click', () => {
      if (confirm("Permanently clear all highscores?")) {
        CHALLENGE.scores = [];
        saveHighscores();
        renderHighscores();
      }
    });
  }

  /**
   * Shows the challenge intro sheet with the current particle-count setup and
   * hides the name-entry and leaderboard areas.
   */
  function showChallengeIntro() {
    chalTitle.textContent = "Outreach Challenge";
    chalDesc.textContent = `Levitate as many particles as possible for 3 full orbits. Current Setup: ${CFG.N_P} particles.`;
    chalInputArea.hidden = true;
    chalBoardArea.hidden = true;
    chalStartBtn.hidden = false;
    challengeSheet.hidden = false;
  }

  chalStartBtn.addEventListener('click', () => {
    challengeSheet.hidden = true;
    startChallengeRun();
  });

  /**
   * Begins a challenge run: locks selectors, releases particles, records the
   * start time, and fires the mill start sound.
   */
  function startChallengeRun() {
    CHALLENGE.phase = 'playing';
    lockSelectors(true);
    startRelease();

    state.omega = 0;
    state.omegaTarget = 0;
    CHALLENGE.startTime = state.t;

    btnStart.classList.add('on');
    ensureAudio();
    const dur = (CFG.N_P <= 1) ? 0 : CFG.DT_INJECT;
    soundMillStart(dur);

    if (btnStart.injectTimeout) clearTimeout(btnStart.injectTimeout);
    btnStart.injectTimeout = setTimeout(() => {
      btnStart.classList.remove('on');
    }, Math.max(250, dur * 1000));
  }

  /**
   * Ends a challenge run with weighted scoring and dynamic reporting.
   * * @param {number} secured - Number of particles secured for three full orbits.
   */
  function endChallengeRun(secured) {
    CHALLENGE.phase = 'scoring';
    lockSelectors(false);
    state.running = false;
    btnStart.classList.remove('on');
    state.omega = 0;
    state.omegaTarget = 0;

    // 1. CALCULATE WEIGHTED SCORE
    const particleScore = secured;
    const aggregateScore = state.aggCount * 10;
    const pebbleScore = state.eggBallCount * 100;
    const planetScore = state.globes.length * 1000;
    const totalScore = particleScore + aggregateScore + pebbleScore + planetScore;

    // 2. CONSTRUCT DYNAMIC REPORT STRING
    let reportParts = [`${secured} particles`];
    
    if (state.aggCount > 0) {
        reportParts.push(`${state.aggCount} aggregates`);
    }
    if (state.eggBallCount > 0) {
        reportParts.push(`${state.eggBallCount} pebbles`);
    }
    if (state.globes.length > 0) {
        reportParts.push(`${state.globes.length} planets`);
    }

    // 3. UPDATE THE UI
    chalTitle.textContent = "Challenge Complete!";
    chalDesc.textContent = "Final Composition: " + reportParts.join(", ");
    chalFinalScore.textContent = totalScore;
    
    chalStartBtn.hidden = true;
    chalBoardArea.hidden = true;
    chalInputArea.hidden = false;
    chalNameInput.value = '';
    challengeSheet.hidden = false;
    setTimeout(() => chalNameInput.focus(), 100);
  }
  chalSubmitBtn.addEventListener('click', () => {
    const name = chalNameInput.value.trim() || 'Anonymous';
    const score = parseInt(chalFinalScore.textContent, 10) || 0;
    CHALLENGE.scores.push({ name, score, np: CFG.N_P, date: new Date().toISOString() });
    saveHighscores();

    chalInputArea.hidden = true;
    chalDesc.textContent = "Highscores";
    renderHighscores();
    chalBoardArea.hidden = false;
  });

  chalNextBtn.addEventListener('click', () => { showChallengeIntro(); });

  btnChallenge.addEventListener('click', () => enterChallengeMode(!CHALLENGE.on));

  /**
   * Called every frame; checks end conditions for the active challenge run
   * (all particles secured, all floating, or time limit exceeded) and calls
   * endChallengeRun() when one is met.
   */
  function updateChallenge() {
    if (!CHALLENGE.on || CHALLENGE.phase !== 'playing') return;

    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);

    let floating = 0;
    let secured = 0;

    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck) continue;
      floating++;
      if (isFinite(T) && p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= 3 * T) {
        secured++;
      }
    }

    const allInjected = state.toInject.length === 0;
    const timeSinceStart = state.t - CHALLENGE.startTime;
    const TIME_LIMIT = 60 + CFG.DT_INJECT;

    if (allInjected) {
      if (floating === 0 || (floating > 0 && floating === secured) || timeSinceStart > TIME_LIMIT) {
        endChallengeRun(secured);
      }
    }
  }

  btnReset.addEventListener('click', () => {
    if (GAME.on && GAME.phase === 'playing') endGameRun('aborted');
    if (CHALLENGE.on && CHALLENGE.phase === 'playing') endChallengeRun(0);
  });

  window.GAME                = GAME;
  window.CHALLENGE           = CHALLENGE;
  window.enterGameMode       = enterGameMode;
  window.enterChallengeMode  = enterChallengeMode;
  window.updateGame          = updateGame;
  window.updateChallenge     = updateChallenge;
  window.showSheet           = showSheet;
  window.lockSelectors       = lockSelectors;
    window.setSettingByValue = setSettingByValue;
})();
