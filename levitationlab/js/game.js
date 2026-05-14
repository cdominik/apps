/**
 * @file game.js
 * @description
 *   Game Mode (8 progressive levels with win/fail sheets) and Challenge Mode
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
    structureWaitSince: null,  // sim time when all particles injected, for timeout

    wonTimeout: null,
    levels: [
      {
        name: 'First Contact',
        params: { NP: 3, VT: 20, SPREAD: 0, DT: 1, trails: false, laser: false },
        goal: { minLevitated: 1, holdSeconds: 3 },
        failText: 'The particle hit the wall. Spin the drum more carefully.',
        describe: function() {
          return 'A few particles fall through the gas. Spin the drum and see what happens.';
        }
      },
      {
        name: 'Finding the Sweet Spot',
        params: { NP: 3, VT: 30, SPREAD: 0, DT: 1, trails: true, laser: false },
        goal: { minLevitated: 2, holdSeconds: 5 },
        failText: 'Not enough particles stayed levitated. Try adjusting the drum speed.',
        describe: function() {
          return 'Heavier particles settle faster. Find the drum speed that keeps ' +
                 this.goal.minLevitated + ' of them orbiting for ' + this.goal.holdSeconds + ' seconds.';
        }
      },
      {
        name: 'Reading the Orbits',
        params: { NP: 5, VT: 50, SPREAD: 0, DT: 1, trails: true, laser: false },
        goal: { minLevitated: 2, holdSeconds: 5 },
        failText: 'These heavier particles need a different drum speed than before. Watch the trails.',
        describe: function() {
          return 'Much heavier particles this time. Watch how the trails change. ' +
                 'The drum speed that worked before may not work now.';
        }
      },
      {
        name: 'A Spread of Sizes',
        params: { NP: 15, VT: 30, SPREAD: 0.15, DT: 2, trails: true, laser: false },
        goal: { minLevitated: 4, holdSeconds: 5 },
        failText: 'With a spread of sizes, no single drum speed suits everyone. Find the best compromise.',
        describe: function() {
          return 'Real dust is never uniform. This batch has a spread of settling speeds. ' +
                 'Levitate ' + this.goal.minLevitated + ' particles — not all of them will cooperate.';
        }
      },
      {
        name: 'Flying Blind',
        params: { NP: 20, VT: 30, SPREAD: 0.15, DT: 2, trails: false, laser: true },
        goal: { minLevitated: 6, holdSeconds: 8 },
        failText: 'Hard to see what is happening, isn\'t it? Let the laser sweeps guide you.',
        describe: function() {
          return 'The lab lights are off. A laser sweeps the drum once per revolution. ' +
                 'Navigate by the flashes.';
        }
      },
      {
        name: 'Crowded Skies',
        params: { NP: 50, VT: 30, SPREAD: 0.15, DT: 3, trails: false, laser: false },
        goal: { minLevitated: 10, holdSeconds: 10 },
        failText: 'Too many particles were lost. Keep the drum spinning steadily.',
        describe: function() {
          return 'More particles, same spread. Hold ' + this.goal.minLevitated +
                 ' levitated for ' + this.goal.holdSeconds + ' seconds. Watch what happens when they collide.';
        }
      },
      {
        name: 'Encouraging Collisions',
        params: { NP: 100, VT: 30, SPREAD: 0.20, DT: 3, trails: false, laser: false },
        goal: { minAggregates: 1, timeoutRevs: 40 },
        failText: 'Nothing formed in time. Keep more particles levitated — collisions need a crowd.',
        describe: function() {
          return 'A wider spread of settling speeds means particles orbit at different radii ' +
                 'and cross each other\'s paths more often. Keep them levitated and wait.';
        }
      },
      {
        name: 'More Energetic Encounters',
        params: { NP: 300, VT: 30, SPREAD: 0.30, DT: 3, trails: true, laser: false },
        goal: { minPebbles: 1, timeoutRevs: 100 },
        failText: 'Nothing grew large enough in time. Fill the drum and keep it spinning.',
        describe: function() {
          return 'A still wider spread means faster relative velocities at each collision. ' +
                 'Fill the drum, spin it up, and see what the increased energy does.';
        }
      }
    ],
  };

  function cancelWonTimeout() {
    if (GAME.wonTimeout) { clearTimeout(GAME.wonTimeout); GAME.wonTimeout = null; }
  }
  function setGameBtnLabel(label) {
    const el = btnGameMode.querySelector('.cap-label');
    if (el) el.textContent = label;
  }

  const elTitlePlate = document.getElementById('titlePlate');
  const btnGameMode  = document.getElementById('btnGameMode');
  const gameSheet    = document.getElementById('gameSheet');
  const sheetTitle   = document.getElementById('sheetTitle');
  const sheetDesc    = document.getElementById('sheetDesc');
  const sheetBtn     = document.getElementById('sheetBtn');
  const sheetBtn2    = document.getElementById('sheetBtn2');
  let sheetAction    = null;
  let sheetAction2   = null;

  sheetBtn2.addEventListener('click', () => {
    if (sheetAction2) sheetAction2();
  });

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

    if (!window.omegaDecayOff) {
      TUNING.drum.omegaDecay = (level.params.omegaDecay != null)
        ? level.params.omegaDecay
        : GAME._savedOmegaDecay;
    }

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
  function showSheet(title, desc, btnText, actionFn, btn2Text, action2Fn) {
    sheetTitle.textContent = title;
    sheetDesc.textContent = desc;
    sheetBtn.textContent = btnText;
    sheetAction = actionFn;
    gameSheet.hidden = false;

    if (btn2Text && action2Fn) {
      sheetBtn2.textContent = btn2Text;
      sheetAction2 = action2Fn;
      sheetBtn2.hidden = false;
    } else {
      sheetBtn2.hidden = true;
      sheetAction2 = null;
    }
  }

  sheetBtn.addEventListener('click', () => {
    if (sheetAction) sheetAction();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || gameSheet.hidden) return;
    sheetBtn.click();
  });

  /**
   * Transitions GAME to idle phase: unlocks selectors, applies the current
   * level's parameters, and shows the level-start sheet.
   */
  function enterIdle() {
    cancelWonTimeout();
    GAME.phase = 'idle';
    setGameBtnLabel('Game');
    GAME.goalHoldSince = null;
    GAME.structureWaitSince = null;
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
      cancelWonTimeout();
      setGameBtnLabel('Game');
      lockSelectors(false);
      GAME.phase = 'idle';
      GAME.goalHoldSince = null;
      GAME.structureWaitSince = null;
      gameSheet.hidden = true;
      if (GAME._savedVtFactor != null) {
        TUNING.aggregate.vtFactor = GAME._savedVtFactor;
        GAME._savedVtFactor = null;
      }
      if (GAME._savedOmegaDecay != null) {
        TUNING.drum.omegaDecay = GAME._savedOmegaDecay;
        GAME._savedOmegaDecay = null;
      }
      initLevel();
    }
  }

  /**
   * Begins a game run: locks selectors, releases particles, and fires the
   * mill start sound.
   */
  function startGameRun() {
    cancelWonTimeout();
    GAME.phase = 'playing';
    setGameBtnLabel('Game');
    GAME.goalHoldSince = null;
    GAME.structureWaitSince = null;
    setGameBtnLabel('Game Menu');
    lockSelectors(true);
    if (window.setOmegaDecay) { setOmegaDecay(false); }
    document.getElementById('btnOmegaCtl').classList.add('disabled');    startRelease();
    
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
    cancelWonTimeout();
    GAME.phase = outcome;
    GAME.goalHoldSince = null;
    GAME.structureWaitSince = null;
    lockSelectors(false);
    document.getElementById('btnOmegaCtl').classList.remove('disabled');
    state.running = false;
    btnStart.classList.remove('on');

    state.omega = 0;
    state.omegaTarget = 0;
    gameSheet.hidden = true;

    if (outcome === 'won') {
      const isLastLevel = GAME.levelIdx === GAME.levels.length - 1;

      if (isLastLevel) {
        showSheet(
          'The Lab is Yours',
          'You have seen particles levitate, cluster, and grow. ' +
          'This is how far the real lab experiment can reach. ' + 
          'But the game has more to show. ' +
          'What happens when pebbles keep accumulating? ' +
          'The lab is yours now — no targets, no timer. ' +
          'Just keep the drum spinning, keep the velocity spread high.',
          'Enter the Lab',
          () => {
            applyLevelParams(currentLevel()); // sets NP=300, SPREAD=0.30 etc.
            enterGameMode(false);             // exits game mode, unlocks selectors
          }
        );
      } else {
        showSheet('Level Complete', currentLevel().name + ' cleared.', 'Next Level', () => {
          GAME.levelIdx = (GAME.levelIdx + 1) % GAME.levels.length;
          enterIdle();
        });
      }
    } else if (outcome === 'lost') {
      const failText = currentLevel().failText || 'Not enough particles levitated.';
      showSheet('Failed', failText, 'Retry', () => {
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

    // --- WIN: pebble goal ---
    if (lv.goal.minPebbles !== undefined) {
      if (state.eggBallCount >= lv.goal.minPebbles && !GAME.wonTimeout) {
        GAME.wonTimeout = setTimeout(() => { GAME.wonTimeout = null; endGameRun('won'); }, 5000);
      }
    }

    // --- WIN: aggregate goal ---
    if (lv.goal.minAggregates !== undefined) {
      if (state.aggCount >= lv.goal.minAggregates && !GAME.wonTimeout) {
        GAME.wonTimeout = setTimeout(() => { GAME.wonTimeout = null; endGameRun('won'); }, 5000);
      }
    }

    // --- TIMEOUT: structure-forming levels ---
    if (lv.goal.minAggregates !== undefined || lv.goal.minPebbles !== undefined) {
      const allInjected = state.toInject.length === 0;

      // Start the timeout clock once all particles are in
      if (allInjected && GAME.structureWaitSince === null) {
        GAME.structureWaitSince = state.t;
      }

      if (GAME.structureWaitSince !== null) {
        const absOm = Math.abs(state.omega);
        const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
        const revolutions = isFinite(T) ? (state.t - GAME.structureWaitSince) / T : 0;
        const timeoutRevs = lv.goal.timeoutRevs !== undefined ? lv.goal.timeoutRevs : 40;
        const wallElapsed = state.t - GAME.structureWaitSince;
        const wallTimeout = timeoutRevs * 3; // s — scales with rev target; assumes ≥1 rev per 3s

        if (revolutions >= timeoutRevs || wallElapsed >= wallTimeout) {
          endGameRun('lost');
          return;
        }
      }

      // Also fail immediately if all particles are gone and nothing formed
      const absOm = Math.abs(state.omega);
      const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
      let floating = 0;
      for (const p of state.particles) {
        if (!p.alive || p.stuck) continue;
        floating++;
      }
      if (state.toInject.length === 0 && floating === 0 &&
          state.aggCount === 0 && state.eggBallCount === 0) {
        endGameRun('lost');
        return;
      }

      // Don't fall through to levitation logic for structure levels
      return;
    }

    // --- WIN/FAIL: levitation goal ---
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    let lev = 0, floating = 0;

    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck) continue;
      floating++;
      if (isFinite(T) && p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= T) lev++;
    }

    if (lv.goal.minLevitated !== undefined && lv.goal.minLevitated > 0) {
      if (lev >= lv.goal.minLevitated) {
        if (GAME.goalHoldSince === null) GAME.goalHoldSince = state.t;
        if (state.t - GAME.goalHoldSince >= lv.goal.holdSeconds) {
          endGameRun('won');
          return;
        }
      } else {
        GAME.goalHoldSince = null;
        const allInjected = state.toInject.length === 0;
        if (allInjected && floating < lv.goal.minLevitated) {
          endGameRun('lost');
        }
      }
    }
  }

  btnGameMode.addEventListener('click', () => {
    if (GAME.on && GAME.phase === 'playing') {
      showSheet(
        'Game Menu',
        `Level ${GAME.levelIdx + 1}: ${currentLevel().name}`,
        'Restart Level',
        () => { gameSheet.hidden = true; enterIdle(); },
        'Exit Game',
        () => { enterGameMode(false); }
      );
    } else {
      enterGameMode(!GAME.on);
    }
  });
  btnGameMode.classList.remove('disabled');

  // ============================================================
  // SECTION: CHALLENGE MODE
  // ============================================================

  /**
   * Loads highscores from localStorage, tolerating missing/blocked storage
   * and corrupted JSON. Returns an empty array on any failure.
   *
   * @returns {Array} Array of highscore entries, or [] if unavailable.
   */
  function loadHighscores() {
    try {
      const raw = localStorage.getItem('levitation_highscores');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[game] Could not load highscores:', e);
      return [];
    }
  }

  const CHALLENGE = {
    on: false,
    phase: 'idle',
    startTime: 0,
    scores: loadHighscores()
  };

  const btnChallenge   = document.getElementById('btnChallenge');
  function setChallengeBtnLabel(label) {
    const el = btnChallenge.querySelector('.cap-label');
    if (!el) return;
    el.textContent = (label === 'Challenge' && window.REGIME === 'portrait') ? 'Score' : label;
  }
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
   * 'levitation_highscores'. Silently ignores storage failures
   * (blocked storage, quota exceeded).
   */
  function saveHighscores() {
    try {
      localStorage.setItem('levitation_highscores', JSON.stringify(CHALLENGE.scores));
    } catch (e) {
      console.warn('[game] Could not save highscores:', e);
    }
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
      gameSheet.hidden = true;
      // Apply challenge defaults from CFG, then let URL params override
      setSettingByValue('NP',     CHALLENGE_CFG.N_P);
      setSettingByValue('VT',     CHALLENGE_CFG.V_T);
      setSettingByValue('SPREAD', CHALLENGE_CFG.VT_SPREAD);
      setSettingByValue('DT',     CHALLENGE_CFG.DT_INJECT);
      showChallengeIntro();
    } else {
      CHALLENGE.phase = 'idle';
      gameSheet.hidden = true;
      setChallengeBtnLabel('Challenge');
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
  chalNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      chalSubmitBtn.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || challengeSheet.hidden) return;
    if (!chalStartBtn.hidden)        { chalStartBtn.click();  return; }
    if (!chalBoardArea.hidden)       { chalNextBtn.click();   return; }
  });

  /**
   * Counts particles that have completed 3 full orbits in the highlight zone.
   * Used both by updateChallenge() and the Challenge Menu early-exit path.
   *
   * @returns {number} Number of secured particles.
   */
  function countSecured() {
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    let secured = 0;
    for (const p of state.particles) {
      if (!p.alive || p.stuck) continue;
      if (isFinite(T) && p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= 3 * T) {
        secured++;
      }
    }
    return secured;
  }

  /**
   * Begins a challenge run: locks selectors, releases particles, records the
   * start time, and fires the mill start sound.
   */
  function startChallengeRun() {
    CHALLENGE.phase = 'playing';
    setChallengeBtnLabel('Challenge Menu');
    lockSelectors(true);
    if (window.setOmegaDecay) setOmegaDecay(false);
    document.getElementById('btnOmegaCtl').classList.add('disabled');
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
   *
   * @param {number} secured - Number of particles secured for three full orbits.
   */
  function endChallengeRun(secured) {
    CHALLENGE.phase = 'scoring';
    gameSheet.hidden = true;
    setChallengeBtnLabel('Challenge');
    lockSelectors(false);
    document.getElementById('btnOmegaCtl').classList.remove('disabled');
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
    if (state.aggCount > 0)    reportParts.push(`${state.aggCount} aggregates`);
    if (state.eggBallCount > 0) reportParts.push(`${state.eggBallCount} pebbles`);
    if (state.globes.length > 0) reportParts.push(`${state.globes.length} planets`);

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

  btnChallenge.addEventListener('click', () => {
    if (CHALLENGE.on && (CHALLENGE.phase === 'playing' || CHALLENGE.phase === 'scoring')) {
      const secured = countSecured();
      showSheet(
        'Challenge Menu',
        `${secured} particle${secured !== 1 ? 's' : ''} secured so far.`,
        'End Run',
        () => { endChallengeRun(secured); },
        'Exit Challenge',
        () => { enterChallengeMode(false); }
      );
    } else {
      enterChallengeMode(!CHALLENGE.on);
    }
  });

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
    for (const p of state.particles) {
      if (!p.alive || p.stuck) continue;
      floating++;
    }
    const secured = countSecured();

    const allInjected = state.toInject.length === 0;
    const timeSinceStart = state.t - CHALLENGE.startTime;
    const TIME_LIMIT = CHALLENGE_CFG.TIME_LIMIT + CFG.DT_INJECT;

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
  window.setSettingByValue   = setSettingByValue;
  window.showChallengeIntro  = showChallengeIntro;
  window.setChallengeBtnLabel = setChallengeBtnLabel;
})();
