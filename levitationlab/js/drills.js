/**
 * @file drills.js
 * @description
 *   Drill Mode — a library of specific lab situations and the techniques
 *   that get out of them. Unlike the Game's progressive levels, drills are
 *   freely browsable: pick one, it constructs the drum state directly, you
 *   practice the recovery, and a debrief explains the physics.
 *
 *   Each DRILLS.list entry:
 *     name      — short title
 *     brief     — situation + goal, shown before starting
 *     stage     — growth stage applied for the drill (default 0)
 *     lockOmega — false: leave the Ω lock off (default: engaged)
 *     setup()   — builds the drum state (particles/aggregates/omega);
 *                 may stash scratch values on `this`
 *     check()   — called each frame while playing; returns 'won', 'lost',
 *                 or null (keep playing)
 *     failText, debrief — sheet texts; a string, or a function returning
 *                 one (for dynamic content)
 *
 * Exposes globals: DRILLS, enterDrillMode, updateDrills
 * Reads globals:   CFG, TUNING, state, GAME, CHALLENGE,
 *                  initLevel, spawnAggregate, aggImageIndex, randn,
 *                  showSheet, setOmegaCtlMode, setOmegaDecay,
 *                  applyGrowthStage, enterGameMode, enterChallengeMode,
 *                  _computeOptimalLaunch
 */
(() => {
  'use strict';

  const btnDrills = document.getElementById('btnDrills');

  // ── HELPERS ───────────────────────────────────────────────────────────────

  /** Resolve a drill text field that may be a string or a function. */
  function _txt(v, drill) {
    return typeof v === 'function' ? v.call(drill) : v;
  }

  /** Direct particle spawn for drill setups (same fields step() creates). */
  function dropParticle(x, y, vt) {
    state.particles.push({
      x, y, vx: 0, vy: 0,
      stuck: false, stuckAngle: 0,
      alive: true,
      inHighlightSince: null, flashEndsAt: -1,
      insideOnce: true,
      vt,
      imgIdx: 0,
    });
  }

  /** Alive, free-floating particles (optionally filtered). */
  function aliveFloating(filter) {
    let n = 0;
    for (const p of state.particles) {
      if (!p.alive || p.stuck || p.merging || p.onTray) continue;
      if (filter && !filter(p)) continue;
      n++;
    }
    return n;
  }

  /** Levitated particles (optionally filtered). */
  function countLev(filter) {
    let n = 0;
    for (const p of state.particles) {
      if (!p.alive || p.stuck || p.merging || p.onTray) continue;
      if (filter && !filter(p)) continue;
      if (state.isLevitated(p)) n++;
    }
    return n;
  }

  /** Win/lose check shared by the two-aggregate merge drills. */
  function mergedPairCheck() {
    const aggs = state.aggregates.filter(a => a.alive && !a.onTray);
    // Merged into one (20 monomers) → success.
    if (aggs.length === 1 && !aggs[0].stuck && aggs[0].count >= 20) return 'won';
    if (aggs.length < 2 || aggs.some(a => a.stuck)) return 'lost';
    return null;
  }

  // ── DRILL LIBRARY ─────────────────────────────────────────────────────────

  const DRILLS = {
    on: false,
    idx: 0,
    phase: 'idle',        // idle | playing | done
    winHoldSince: null,   // sim time the win condition has held since
    list: [

      {
        name: 'Tight Orbits',
        brief:
          'Five aggregates circle deep inside the levitation zone — but on ' +
          'tiny orbits, so they never meet. Widen every orbit to radius 15 ' +
          'or more without losing a single aggregate. ' +
          'Hint: orbits are frozen in at each change of drum speed.',
        failText:
          'An aggregate was lost. Big speed jumps make big orbits — ' +
          'sometimes bigger than the drum. Try gentler steps.',
        debrief:
          'Each change of drum speed moves every orbit centre (at v_t/Ω), ' +
          'while the aggregate itself stays put — so its orbit radius jumps ' +
          'to the distance from the new centre. Speed up, let it swing, ' +
          'slow back down: repeated cycles pump the orbits wider. ' +
          'The same trick in reverse (timed right) can shrink orbits.',
        omega: 0.7,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          // One aggregate per vt, parked almost exactly on its orbit
          // centre (vt/OM, 0) — a tiny 2-unit orbit each.
          const vts = [21, 28, 35, 42, 49];
          for (const vt of vts) {
            spawnAggregate(vt / OM + 2, 0, vt, 1.0, null);
          }
          state.aggCount = vts.length;
        },
        check() {
          const aggs = state.aggregates.filter(a => a.alive && !a.merging && !a.onTray);
          if (aggs.length < 5 || aggs.some(a => a.stuck)) return 'lost';
          const om = state.omega;
          if (Math.abs(om) < 0.05) return null;   // at rest, orbits are undefined
          let minR = Infinity;
          for (const a of aggs) {
            const c = a.vt / om;
            const r = Math.hypot(a.x - c, a.y);
            if (r < minR) minR = r;
          }
          return minR >= 15 ? 'won' : null;
        },
      },

      {
        name: 'Orbits Apart',
        stage: 1,   // grow mode: contact merges, turbulence drifts phases
        brief:
          'Two aggregates with different Stokes numbers: the heavy one ' +
          'sweeps a wide orbit that stays entirely clear of the light ' +
          'one’s small circle, so they can never meet. Make them collide ' +
          'and merge. Hint: a change of drum speed moves each orbit centre ' +
          'by an amount proportional to its v_t.',
        failText:
          'An aggregate was lost to the wall. The wide orbit has little ' +
          'room to spare — small speed steps keep it inside the drum.',
        debrief:
          'Both aggregates circle at the same Ω, so their relative ' +
          'geometry is fixed: without crossing orbits they can never meet, ' +
          'however long you wait. Each speed change shifts the orbit ' +
          'centres by v_t/Ω — different amounts for different Stokes ' +
          'numbers — and re-freezes the radii. A few well-chosen changes ' +
          'bring the orbits across each other; gas turbulence then drifts ' +
          'the phases until contact.',
        omega: 0.7,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          // Light aggregate: 3-unit orbit around (35, 0).
          spawnAggregate(38, 0, 24.5, 1.0, null);
          // Heavy aggregate: 37-unit orbit around (55, 0) — its path stays
          // 14 units clear of the light orbit (contact distance is 10),
          // and 3 units clear of the wall at its outer turning point.
          // Spawned at the inner turning point.
          spawnAggregate(18, 0, 38.5, 1.0, null);
          state.aggCount = 2;
        },
        check: mergedPairCheck,
      },

      {
        name: 'Catch the Fall',
        brief:
          'Thirty particles are about to fall from the nozzles into a ' +
          'resting drum. Spin up at the right moment and catch at least 15 ' +
          'in the levitation zone. Too early strands the slow settlers near ' +
          'the ceiling; too late loses the fast ones to the floor.',
        failText() {
          return 'Fewer than 15 can still be caught. For comparison: the ' +
                 'autostart planner would have captured ' +
                 (this._autopilot != null ? this._autopilot : 'about 20') +
                 '. Try again.';
        },
        debrief() {
          return 'One spin-up moment cannot suit everyone: each particle ' +
                 'has its own capture window, set by its fall time and its ' +
                 'orbit centre at v_t/Ω. You caught the overlap. The ' +
                 'autostart planner predicted ' +
                 (this._autopilot != null ? this._autopilot : 'a similar number of') +
                 ' captures for its optimal moment and speed.';
        },
        setup() {
          state.omega = 0;
          state.omegaTarget = 0;
          for (let i = 0; i < 30; i++) {
            state.toInject.push({
              t:  state.t + 0.5 + (i / 29) * 2.5,
              x:  5 + ((i % 5) + 0.5) * 18 + (Math.random() - 0.5) * 10,
              vt: Math.max(5, 30 * (1 + 0.20 * randn())),
            });
          }
          state.toInject.sort((a, b) => a.t - b.t);
          // What would the autostart achieve here? Shown in the debrief.
          const plan = window._computeOptimalLaunch ? _computeOptimalLaunch() : null;
          this._autopilot = plan ? plan.count : null;
        },
        check() {
          if (countLev() >= 15) return 'won';
          // Lost once not enough potential catches remain.
          return (state.toInject.length + aliveFloating() < 15) ? 'lost' : null;
        },
      },

      {
        name: 'Over-Spun',
        brief:
          'Someone left the drum racing: four aggregates were flung onto ' +
          'wide orbits around centres crowded near the axis — none of them ' +
          'levitates. Slow the drum down and park all four inside the ' +
          'levitation zone. Careless big steps re-freeze the orbits even ' +
          'wider.',
        failText:
          'An aggregate hit the wall. Each slowdown re-freezes the orbit ' +
          'at the distance from the NEW centre — step down when an ' +
          'aggregate sits close to where its centre is about to move.',
        debrief:
          'Slowing down moves every centre outward to v_t/Ω — by more ' +
          'for heavier aggregates. The radius re-freezes at each change, ' +
          'so small, well-timed downward steps walk the orbits into the ' +
          'zone. It is the Tight Orbits pump in reverse: the same timing ' +
          'that widens orbits can shrink them.',
        omega: 3.0,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          const vts = [21, 28, 35, 42];
          let k = 0;
          for (const vt of vts) {
            const c  = vt / OM;                      // 7 .. 14, near the axis
            const ph = (k++ * Math.PI) / 2 + 0.7;    // spread the phases
            spawnAggregate(c + 30 * Math.cos(ph), 30 * Math.sin(ph), vt, 1.0, null);
          }
          state.aggCount = vts.length;
        },
        check() {
          const aggs = state.aggregates.filter(a => a.alive && !a.merging && !a.onTray);
          if (aggs.length < 4 || aggs.some(a => a.stuck)) return 'lost';
          let lev = 0;
          for (const a of aggs) if (state.isLevitated(a)) lev++;
          return lev >= 4 ? 'won' : null;
        },
      },

      {
        name: 'The Compromise',
        brief:
          'A bimodal population: the heavy grains levitate nicely, but the ' +
          'drum is tuned for them alone — the light mode circles uselessly ' +
          'outside the zone. Find the compromise speed that holds at least ' +
          '10 of each mode levitated at the same time.',
        failText:
          'Too few particles remain to satisfy both modes. The compromise ' +
          'lies between the two perfect speeds — change course gently.',
        debrief:
          'No single speed is ideal for both modes: the orbit centres sit ' +
          'at v_t/Ω, so the best compromise puts the two modes symmetric ' +
          'about the zone centre — Ω = (v_light + v_heavy)/100. That is ' +
          'exactly the formula the auto-omega controller uses.',
        omega: 1.1,   // heavy mode (vt 55) perfectly centred: c = 50
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          for (let i = 0; i < 15; i++) {
            // Heavy mode: tight orbits around (50, 0) — levitated.
            const vtH = 55 * (1 + 0.05 * randn());
            const phH = Math.random() * 2 * Math.PI;
            dropParticle(vtH / OM + 4 * Math.cos(phH), 4 * Math.sin(phH), vtH);
            // Light mode: wide orbits around (18, 0), dipping out of the zone.
            const vtL = 20 * (1 + 0.05 * randn());
            const phL = Math.random() * 2 * Math.PI;
            dropParticle(vtL / OM + 24 * Math.cos(phL), 24 * Math.sin(phL), vtL);
          }
        },
        check() {
          const light = p => p.vt < 35;
          const heavy = p => p.vt >= 35;
          if (aliveFloating(light) < 10 || aliveFloating(heavy) < 10) return 'lost';
          return (countLev(light) >= 10 && countLev(heavy) >= 10) ? 'won' : null;
        },
      },

      {
        name: 'Plate Spinning',
        lockOmega: false,   // the whole point: the drum decays on its own
        brief:
          'Twenty grains levitate — but the Ω lock is off and the drive ' +
          'is idle, so the drum slowly spins down and every orbit centre ' +
          'creeps outward. Keep at least 15 levitated for 60 seconds with ' +
          'corrective swipes.',
        failText:
          'The population thinned below 15. Small regular corrections beat ' +
          'rare big ones — every big change re-freezes all the orbits anew.',
        debrief:
          'Without the Ω lock the drum decays on a 30-second timescale, ' +
          'and the orbit centres at v_t/Ω migrate outward as it slows. ' +
          'Maintenance is a rhythm: nudge the speed back up before the ' +
          'outermost orbits touch the zone edge.',
        omega: 0.75,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          for (let i = 0; i < 20; i++) {
            const vt = Math.max(5, 30 * (1 + 0.20 * randn()));
            const ph = Math.random() * 2 * Math.PI;
            dropParticle(vt / OM + 6 * Math.cos(ph), 6 * Math.sin(ph), vt);
          }
          this._t0 = state.t;
        },
        check() {
          if (aliveFloating() < 15) return 'lost';
          if (state.t - this._t0 >= 60) {
            return countLev() >= 15 ? 'won' : 'lost';
          }
          return null;
        },
      },

      {
        name: 'Phase-Locked',
        stage: 1,
        brief:
          'Two aggregates on orbits that clearly cross — yet they never ' +
          'meet: both circle at the same Ω, locked 20 units apart like ' +
          'horses on a carousel. Break the lock and make them merge.',
        failText:
          'Lost to the wall — the nudge was too strong. A small change of ' +
          'speed, timed off the x-axis, is enough to re-phase the pair.',
        debrief:
          'Crossing orbits are necessary but not sufficient: at equal Ω ' +
          'the relative geometry rotates rigidly, so the gap never closes ' +
          'on its own. A change of speed re-freezes both orbits with a new ' +
          'relative phase — a gentle nudge or two, and the crossing points ' +
          'finally coincide with both aggregates at once.',
        omega: 0.7,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          // Equal radii, equal phase: the pair co-rotates with a constant
          // 20-unit gap although the orbits themselves cross.
          spawnAggregate(28 / OM + 18, 0, 28, 1.0, null);  // centre (40, 0)
          spawnAggregate(42 / OM + 18, 0, 42, 1.0, null);  // centre (60, 0)
          state.aggCount = 2;
        },
        check: mergedPairCheck,
      },

      {
        name: 'The Harvest',
        brief:
          'Five aggregates levitate on tidy orbits. Harvest at least ' +
          'three: arm the collection tray and let it sweep them up as the ' +
          'drum winds down. No more than two may be lost on the way.',
        failText:
          'Fewer than three aggregates landed on the tray. Watch where the ' +
          'orbits sit when the tray starts to insert — the spin-down ' +
          're-maps them one last time.',
        debrief:
          'The tray inserts over 270° of rotation while the drum ' +
          'decelerates to rest, and anything that settles onto the blade ' +
          'is caught. Parking the orbits low and central before arming ' +
          'gives the blade the best sweep.',
        omega: 0.7,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          const vts = [21, 28, 35, 42, 49];
          let k = 0;
          for (const vt of vts) {
            const ph = (k++ * 2 * Math.PI) / 5;
            spawnAggregate(vt / OM + 8 * Math.cos(ph), 8 * Math.sin(ph), vt, 1.0, null);
          }
          state.aggCount = vts.length;
          this._insertedAt = null;
        },
        check() {
          const onTray = state.aggregates.filter(a => a.alive && a.onTray).length;
          if (state.tray.phase === 'inserted') {
            // Give late settlers a few seconds to land on the blade.
            if (this._insertedAt === null) this._insertedAt = state.t;
            if (state.t - this._insertedAt >= 6) {
              return onTray >= 3 ? 'won' : 'lost';
            }
            return null;
          }
          const viable = state.aggregates.filter(a => a.alive && !a.stuck).length;
          return viable < 3 ? 'lost' : null;
        },
      },

      {
        name: 'Bounce Ladder',
        stage: 2,
        brief:
          'Four heavyweight aggregates (50 monomers each) bounce off each ' +
          'other — every bounce kicks their v_t up 5%, and a pebble only ' +
          'forms when both partners of a contact exceed the threshold. ' +
          'Ride the ladder: keep them colliding, and keep raising the drum ' +
          'speed as the climbing v_t pushes the orbits outward. Goal: one ' +
          'pebble.',
        failText:
          'Too much material lost — the remaining aggregates can no longer ' +
          'reach 100 monomers in one contact. Raise Ω in step with the ' +
          'climbing v_t.',
        debrief:
          'The bounce ladder is the stage-2 feedback loop: each bounce ' +
          'raises v_t, which moves the orbit centre outward at v_t/Ω — so ' +
          'the drum must spin faster and faster to hold the growing ' +
          'orbits. Once two partners both clear 1.5× the mean injected ' +
          'v_t, their next contact compacts them into a pebble.',
        omega: 0.75,
        setup() {
          const OM = this.omega;
          state.omega = OM;
          state.omegaTarget = OM;
          state.injectedMeanVt = 30;   // pebble threshold: 1.5 × 30 = 45
          const vts = [30, 31.5, 33, 34.5];
          let k = 0;
          for (const vt of vts) {
            const ph = (k++ * Math.PI) / 2;
            spawnAggregate(vt / OM + 10 * Math.cos(ph), 10 * Math.sin(ph), vt, 1.0, null);
            const agg  = state.aggregates[state.aggregates.length - 1];
            agg.count  = 50;                      // heavyweight: pairs reach 100
            agg.r     *= Math.cbrt(50 / 10);      // mass-consistent radius
            agg.imgIdx = aggImageIndex(50);
          }
          state.aggCount = vts.length;
        },
        check() {
          if (state.eggBallCount >= 1) return 'won';
          const aggs = state.aggregates.filter(a => a.alive && !a.stuck && !a.onTray);
          let mass = 0;
          for (const a of aggs) mass += a.count;
          return (aggs.length < 2 || mass < 100) ? 'lost' : null;
        },
      },

    ],
  };

  // ── MODE MACHINERY ────────────────────────────────────────────────────────

  function current() { return DRILLS.list[DRILLS.idx]; }

  function setDrillBtnLabel(label) {
    const el = btnDrills && btnDrills.querySelector('.cap-label');
    if (el) el.textContent = label;
  }

  /** Clears the lab and builds the current drill's situation. */
  function startDrillRun() {
    DRILLS.phase = 'playing';
    DRILLS.winHoldSince = null;

    initLevel();
    state.globes = [];
    if (state.solar) state.solar.phase = 'none';
    state.drumHoming = null;

    // Manual drum control is the point of a drill: plain swipe mode. The
    // omega lock and growth stage are per-drill (defaults: lock engaged so
    // the situation holds still between swipes; stage 0, no interactions).
    const d = current();
    if (window.setOmegaCtlMode) setOmegaCtlMode(0);
    if (window.setOmegaDecay)   setOmegaDecay(d.lockOmega !== false);
    if (window.applyGrowthStage) applyGrowthStage(d.stage != null ? d.stage : 0);

    d.setup();
    state.running = true;
  }

  function showDrillIntro() {
    const d = current();
    showSheet(
      'Drill: ' + d.name,
      _txt(d.brief, d),
      'Start Drill', () => { gameSheetHide(); startDrillRun(); },
      'Exit', () => enterDrillMode(false)
    );
    // The drill picker lives only on the intro sheet.
    if (drillSelect) {
      drillSelect.hidden = false;
      drillSelect.value  = String(DRILLS.idx);
    }
  }

  function gameSheetHide() {
    const sheet = document.getElementById('gameSheet');
    if (sheet) sheet.hidden = true;
    if (drillSelect) drillSelect.hidden = true;
  }

  function enterDrillMode(on) {
    DRILLS.on = on;
    if (btnDrills) btnDrills.classList.toggle('on', on);

    if (on) {
      if (typeof GAME !== 'undefined' && GAME.on) enterGameMode(false);
      if (typeof CHALLENGE !== 'undefined' && CHALLENGE.on) enterChallengeMode(false);
      // Remember settings the drill setup overrides.
      DRILLS._savedStage   = window.aggGrowthStage || 0;
      DRILLS._savedLockOff = !!window.omegaDecayOff;
      DRILLS.phase = 'idle';
      setDrillBtnLabel('Exit Drill');
      showDrillIntro();
    } else {
      DRILLS.phase = 'idle';
      setDrillBtnLabel('Drills');
      gameSheetHide();
      if (window.applyGrowthStage && DRILLS._savedStage != null) {
        applyGrowthStage(DRILLS._savedStage);
      }
      if (window.setOmegaDecay && DRILLS._savedLockOff != null) {
        setOmegaDecay(DRILLS._savedLockOff);
      }
      initLevel();
    }
  }

  /** Called every frame from main.js; evaluates the active drill. */
  function updateDrills() {
    if (!DRILLS.on || DRILLS.phase !== 'playing') return;
    const d = current();
    const result = d.check();

    if (result === 'lost') {
      DRILLS.phase = 'done';
      state.running = false;
      showSheet('Drill Failed', _txt(d.failText, d),
        'Retry', () => { gameSheetHide(); startDrillRun(); },
        'Exit',  () => enterDrillMode(false));
      return;
    }

    if (result === 'won') {
      // Require the condition to hold briefly so a transient during a
      // swipe doesn't end the drill.
      if (DRILLS.winHoldSince === null) DRILLS.winHoldSince = state.t;
      if (state.t - DRILLS.winHoldSince >= 2.0) {
        DRILLS.phase = 'done';
        showSheet('Drill Complete', _txt(d.debrief, d),
          'Again', () => { gameSheetHide(); startDrillRun(); },
          'Exit',  () => enterDrillMode(false));
      }
    } else {
      DRILLS.winHoldSince = null;
    }
  }

  if (btnDrills) {
    btnDrills.addEventListener('click', () => enterDrillMode(!DRILLS.on));
  }

  // Drill picker: jump straight to any drill from the intro sheet.
  const drillSelect = document.getElementById('drillSelect');
  if (drillSelect) {
    DRILLS.list.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = (i + 1) + '. ' + d.name;
      drillSelect.appendChild(opt);
    });
    drillSelect.addEventListener('change', () => {
      DRILLS.idx = parseInt(drillSelect.value, 10) || 0;
      showDrillIntro();
    });
  }

  // The Drills button stays hidden until the expert door is first opened:
  // drills assume hands-on drum-control skills, and the door is the lab's
  // marker for "I know what I'm doing". The door can be opened at any time,
  // so nothing is gated behind playthrough. Once revealed, the button stays
  // for the session even if the door is closed again.
  const _expertEl = document.getElementById('expertContainer');
  function _revealWithExpertDoor() {
    if (_expertEl.classList.contains('open')) {
      btnDrills.hidden = false;
      _doorWatch.disconnect();
    }
  }
  const _doorWatch = new MutationObserver(_revealWithExpertDoor);
  if (btnDrills && _expertEl) {
    _doorWatch.observe(_expertEl, { attributes: true, attributeFilter: ['class'] });
    _revealWithExpertDoor();  // door may already be open (?expert URL flag)
  }

  window.DRILLS         = DRILLS;
  window.enterDrillMode = enterDrillMode;
  window.updateDrills   = updateDrills;
})();
