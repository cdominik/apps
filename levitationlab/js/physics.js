/**
 * @file physics.js
 * @description
 *   All simulation physics: level initialisation, drum rotation, particle
 *   stepping, aggregate formation, pebble (golden-ball) merging, globe
 *   (planet) merging, and heatmap accumulation.
 *
 * Exposes globals: initLevel, randn, scheduleInjections, startRelease,
 *                  updateDrum, step, eggLevitatedParticles, aggImageIndex,
 *                  updateEgg, updateGlobe, spawnGoldenBall, updateAggregates,
 *                  updateSolar, computeAutoOmega, trayEndpoints, updateTray
 * Reads globals:   TUNING, TUNING_DEFAULT, CFG, LASER_OMEGA,
 *                  state, heatmap, aggregateImages,
 *                  soundTink, soundSnap, soundCrunch, soundAggMerge,
 *                  soundGoldenThud, soundGoldenChime,
 *                  GEO, X2px, angleSwept, visualSizeFactor,
 *                  updateGauge, resetExpertUI, resetSimSpeed
 */
(() => {
  'use strict';

  // Pre-computed grid size; mirrors heatmap.resolution² from state.js.
  const gridSize = heatmap.resolution * heatmap.resolution;

  function _ssOmega(r)    { return TUNING.solar.omegaBase / Math.pow(r, 0.75); }
  function _ssFitScale(n) {
    return TUNING.solar.maxR / (TUNING.solar.baseRadii[n-1] + TUNING.solar.orbitSize);
  }

  /**
   * Returns the aggregateImages array index for a given monomer count.
   * Clamps to available tiers (10–100 in steps of 10).
   *
   * @param {number} count - Number of monomers in the aggregate.
   * @returns {number} Index into aggregateImages (0–9).
   */
  function aggImageIndex(count) {
      const tier = Math.min(10, Math.max(1, Math.ceil(count / 10)));
      return tier - 1;
  }

  // ============================================================
  // SECTION: LEVEL INIT
  // ============================================================

  /**
   * Resets all simulation state to zero and refreshes the HUD.
   * Does NOT clear persistent structures (globes, pebbles) — use
   * the Reset button path in ui.js for a full lab reset.
   */
  function initLevel() {
    state.running    = false;
    state.particles  = [];
    state.toInject   = [];
    state.t          = 0;
    state.omega      = 0;
    state.omegaTarget = 0;
    state.drumAngle  = 0;
    state.puffs      = [];
    state.lostCount  = 0;
    state.renderN      = CFG.N_P;
    state.eggHoldRevs  = 0;
    state.eggBallCount = 0;
    state.eggMerging   = null;
    state.goldenBalls  = [];
    state.pebbleBannerUsed = false;

    state.aggregates  = [];
    state.aggGrowMerging = null;
    state.aggHoldRevs = 0;
    state.aggCount    = 0;
    state.aggMerging  = null;

    // Notify the Expert Analysis Controller so HUD overlays reset cleanly.
    if (window.resetExpertUI) window.resetExpertUI();

    state.tray.phase    = 'idle';
    state.tray.progress = 0;

    updateGauge();
  }

  /**
   * Returns a standard-normal random sample using the Box-Muller transform.
   *
   * @returns {number} A sample drawn from N(0, 1).
   */
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Builds and sorts the toInject queue for the next batch of particles.
   *
   * Terminal velocities are drawn from the distribution set in state.distMode:
   *   'default' — Gaussian centred on CFG.V_T with relative sigma CFG.VT_SPREAD.
   *   'bi'      — Two-component mixture; groups defined in state.distParams.bi.
   *               Each group has its own vt and fractional spread.
   *   'power'   — Power-law n(v) ~ v^q via inverse-transform sampling;
   *               parameters in state.distParams.power. The VT_SPREAD slider
   *               is ignored because the law itself defines the spread.
   *
   * All sampled vt values are clamped to TUNING.particle.settleFloor.
   */
  function scheduleInjections() {
    if (GEO && GEO.nozzleXs.length) {
      for (const nx of GEO.nozzleXs) {
        state.puffs.push({ x: nx, y: GEO.nozzleTipY, bornAt: state.t, life: 1.42 });
      }
    }
    state.toInject = [];
    const N    = CFG.N_P;
    const dist = state.distMode;
    const p    = state.distParams;

    for (let i = 0; i < N; i++) {
      // Spread injection events evenly across the DT_INJECT window.
      const t = (N === 1 || CFG.DT_INJECT === 0) ? 0 : (i / (N - 1)) * CFG.DT_INJECT;
      // Assign particle to one of 5 nozzles round-robin, then sample within
      // the focus beam centred on that nozzle. Matches drawInjector() geometry.
      const _nN       = 5;
      const _nX0      = CFG.RELEASE_X_MIN + 5;          // 5 cm
      const _nX1      = CFG.RELEASE_X_MAX - 5;          // 95 cm
      const _slotW    = (_nX1 - _nX0) / _nN;            // 18 cm per slot
      const _focus    = Math.min(Math.max(1, CFG.NOZZLE_FOCUS), _slotW);
      const _nCentre  = _nX0 + (i % _nN + 0.5) * _slotW;
      const x         = _nCentre + (Math.random() - 0.5) * _focus;
      let vt;

      if (dist === 'bi') {
        // Pick group 1 with probability ratio/(1+ratio), group 2 otherwise.
        const prob1 = p.bi.ratio / (1 + p.bi.ratio);
        if (Math.random() < prob1) {
          vt = p.bi.vt1 * (1 + p.bi.s1 * randn());
        } else {
          vt = p.bi.vt2 * (1 + p.bi.s2 * randn());
        }
      } else if (dist === 'power') {
        // Inverse-transform sampling for n(v) ~ v^q on [v0, v1].
        const q  = p.power.index;
        const v0 = p.power.vtMin;
        const v1 = p.power.vtMax;
        const u  = Math.random();
        if (Math.abs(q + 1) < 1e-6) {
          // Special case q = −1: log-uniform distribution.
          vt = v0 * Math.pow(v1 / v0, u);
        } else {
          vt = Math.pow(
            u * (Math.pow(v1, q + 1) - Math.pow(v0, q + 1)) + Math.pow(v0, q + 1),
            1 / (q + 1)
          );
        }
      } else {
        // Default: Gaussian with relative spread.
        vt = CFG.V_T * (1 + CFG.VT_SPREAD * randn());
      }

      if (vt < TUNING.particle.settleFloor) vt = TUNING.particle.settleFloor;
      state.toInject.push({ t, x, vt });
    }

    state.toInject.sort((a, b) => a.t - b.t);
  }

  /**
   * Adds a visual puff at the nozzle closest to the given x position.
   *
   * @param {number} particleX_cm - The particle's x coordinate in centimetres.
   */
  function spawnPuffAtNozzle(particleX_cm) {
    if (!GEO.nozzleXs.length) return;
    const particleX_px = X2px(particleX_cm);
    let bestIdx = 0, bestD = Infinity;
    for (let i = 0; i < GEO.nozzleXs.length; i++) {
      const d = Math.abs(GEO.nozzleXs[i] - particleX_px);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    state.puffs.push({ x: GEO.nozzleXs[bestIdx], y: GEO.nozzleTipY, bornAt: state.t, life: 0.42 });
  }

  /**
   * Clears particles and starts a fresh injection run, preserving any
   * persistent structures (aggregates, pebbles, globes) already in the drum.
   *
   * Persistent objects have their timeline references re-synced to t = 0 so
   * that levitation tracking and flash timers remain coherent after the reset.
   */
  function startRelease() {
    state.running   = false;
    state.particles = [];
    state.toInject  = [];
    state.puffs     = [];
    state.t         = 0;
    state.lostCount = 0;

    state.tray.phase    = 'idle';
    state.tray.progress = 0;

    // Re-sync persistent objects to the new timeline origin.
    state.goldenBalls.forEach(b  => { b.bornAt = 0; b.showBanner = false; });
    state.aggregates.forEach(agg => {
      agg.inHighlightSince = null; // force them to re-earn levitation
      agg.orbitFlashEndsAt = 0;
    });
    state.globes.forEach(g => { g.bornAt = 0; });
    state.pebbleBannerUsed = false;

    state.renderN = CFG.N_P;
    scheduleInjections();
    state.injectedMeanVt = state.toInject.length > 0
      ? state.toInject.reduce((s, p) => s + p.vt, 0) / state.toInject.length
      : CFG.V_T;
    state.running = true;
  }


  // ============================================================
  // SECTION: PHYSICS — DRUM
  // ============================================================

  /**
   * Advances drum angle, decays omega toward omegaTarget, and steps the laser angle.
   *
   * omegaTarget decays exponentially at TUNING.drum.omegaDecay (rad/s²).
   * omega tracks omegaTarget with a lag set by TUNING.drum.slipRate.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateDrum(dt) {
    state.omegaTarget *= Math.exp(-TUNING.drum.omegaDecay * dt);
    const a = 1 - Math.exp(-TUNING.drum.slipRate * dt);
    state.omega += (state.omegaTarget - state.omega) * a;

    // Snap to zero to avoid perpetual micro-rotation.
    if (Math.abs(state.omega) < 1e-4 && Math.abs(state.omegaTarget) < 1e-4) {
      state.omega = 0;
      state.omegaTarget = 0;
    }

    state.drumAngle  += state.omega    * dt;
    state.laserAngle += LASER_OMEGA    * dt;
  }


  // ============================================================
  // SECTION: PHYSICS — PARTICLES
  // ============================================================

  /**
   * Advances all particle positions by one substep, handling:
   *   - deferred injection from the toInject queue
   *   - ghost path decay (for diagnostic overlay)
   *   - kinematic orbit update (gas drag + terminal velocity)
   *   - wall collision detection and sticking
   *   - highlight zone entry/exit tracking
   *   - invincible-mode wall clamping
   *   - lidar flash tagging
   *   - puff lifetime expiry and dead-particle pruning
   *   - heatmap accumulation (once per full drum revolution)
   *
   * Wall collision uses a radial threshold test rather than continuous
   * detection. The substep size (DT_SUBSTEP in main.js) is calibrated so
   * a particle moving at max vt cannot cross the collision margin in one step.
   *
   * @param {number} dt - Elapsed substep time in seconds.
   */
  function step(dt) {
    // Inject any particles whose scheduled time has arrived.
    while (state.toInject.length && state.toInject[0].t <= state.t) {
      const inj = state.toInject.shift();
      state.particles.push({
        x: inj.x, y: CFG.RELEASE_Y,
        vx: 0, vy: 0,
        stuck: false, stuckAngle: 0,
        alive: true,
        inHighlightSince: null, flashEndsAt: -1,
        insideOnce: false,
        vt: inj.vt,
        imgIdx: Math.floor(Math.random() * aggregateImages.length),
      });
    }

    const omega  = state.omega;
    const HX     = TUNING.highlight.cx;
    const HY     = TUNING.highlight.cy;
    const HR2    = TUNING.highlight.radius * TUNING.highlight.radius;
    const laser1 = state.laserAngle;
    const laser0 = laser1 - LASER_OMEGA * dt;

    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.onTray) {
        // Rotate exactly with the drum so the particle stays fixed in the drum frame
        const dA = omega * dt;
        const c = Math.cos(dA), s = Math.sin(dA);
        const nx = p.x * c - p.y * s, ny = p.x * s + p.y * c;
        p.x = nx; p.y = ny;
        p.vx = -omega * p.y; p.vy = omega * p.x;
        p.inHighlightSince = null;  // prevent stale levitation timestamp
        continue;
      }

      // Decay ghost-path overlays (diagnostic mode).
      if (p.ghostPathGas || p.ghostPathVac) {
        const absOm = Math.abs(omega);
        const decay = (absOm > 0.01) ? (absOm * dt) / (4 * Math.PI) : dt * 0.2;
        p.ghostLife -= decay;
        if (p.ghostLife <= 0) {
          delete p.ghostPathGas;
          delete p.ghostPathVac;
        }
      }

      if (p.merging) continue;

      if (p.stuck) {
        // Stuck particles ride the drum wall; fade out after 5 s.
        p.stuckAngle += omega * dt;
        p.x = CFG.R_DRUM * Math.cos(p.stuckAngle);
        p.y = CFG.R_DRUM * Math.sin(p.stuckAngle);
        p.inHighlightSince = null;
        if (state.t - p.stuckAt >= 5) p.alive = false;

      } else {
        // Kinematic update: gas co-rotates with the drum, particle settles at vt.
        if (p.insideOnce) {
          p.vx = -omega * p.y;
          p.vy =  omega * p.x - p.vt;
        } else {
          // Still falling from the injector — no drag yet.
          p.vx = 0;
          p.vy = -p.vt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const r2    = p.x * p.x + p.y * p.y;
        const Rwall = CFG.R_DRUM - TUNING.particle.collisionR;
        const wasInside = p.insideOnce;

        if (!p.insideOnce && r2 <= CFG.R_DRUM * CFG.R_DRUM) p.insideOnce = true;

        const prevR2 = (p.prevR2 === undefined)
          ? (CFG.R_DRUM + 1) * (CFG.R_DRUM + 1)
          : p.prevR2;

        if (wasInside && prevR2 < Rwall * Rwall && r2 >= Rwall * Rwall) {
          // Particle just crossed the wall boundary — stick it.
          if (!TUNING.particle.invincible) {
            const ang = Math.atan2(p.y, p.x);
            p.stuck       = true;
            p.stuckAngle  = ang;
            p.stuckAt     = state.t;
            p.x           = Rwall * Math.cos(ang);
            p.y           = Rwall * Math.sin(ang);
            p.inHighlightSince = null;
            state.lostCount++;
            soundTink();
          }
        } else if (p.insideOnce) {
          // Track highlight zone membership.
          const dxh = p.x - HX, dyh = p.y - HY;
          const inside = (dxh * dxh + dyh * dyh) <= HR2;
          if (inside) {
            if (p.inHighlightSince === null) p.inHighlightSince = state.t;
          } else {
            p.inHighlightSince = null;
          }
        }

        // Invincible mode: clamp to just inside the wall rather than sticking.
        if (TUNING.particle.invincible && p.insideOnce && !p.stuck && r2 >= Rwall * Rwall) {
          const rr = Math.sqrt(r2);
          p.x = (p.x / rr) * Rwall * 0.999;
          p.y = (p.y / rr) * Rwall * 0.999;
          p.prevR2 = p.x * p.x + p.y * p.y;
        } else {
          p.prevR2 = r2;
        }

        // Collect particles within tray thickness of the live rotating tray line.
        // Particles: catchR = 0 (no radius added to the threshold), offsetR =
        // collisionR — the asymmetry is preserved exactly.
        if ((state.tray.phase === 'inserting' || state.tray.phase === 'inserted')
            && !p.onTray && p.insideOnce) {
          const ep = trayEndpoints();
          if (ep) tryCatchOnTray(p, ep, 0, TUNING.particle.collisionR);
        }

        // Remove particles that escaped the drum entirely.
        if (p.y < -CFG.R_DRUM * 1.5) { state.lostCount++; p.alive = false; }
        if (p.insideOnce && !p.stuck &&
            r2 > (CFG.R_DRUM * 1.05) * (CFG.R_DRUM * 1.05) &&
            !TUNING.particle.invincible) {
          state.lostCount++;
          p.alive = false;
        }
      }

      // Tag particles swept by the laser this substep.
      if (state.laserOn && !p.stuck && p.insideOnce) {
        const pa = Math.atan2(p.y, p.x);
        if (angleSwept(laser0, laser1, pa)) {
          p.flashEndsAt = state.t + 0.40 * TUNING.lidar.flashDurMul;
        }
      }
    }

    // Expire old puffs and prune dead particles.
    if (state.puffs.length) {
      state.puffs = state.puffs.filter(pf => (state.t - pf.bornAt) < pf.life);
    }
    if (state.particles.some(p => !p.alive)) {
      state.particles = state.particles.filter(p => p.alive);
    }

    state.t += dt;

    // Heatmap accumulation — finalised once per full drum revolution.
    if (heatmap.enabled) {
      const res = heatmap.resolution;
      heatmap.tickCount++;

      for (const p of state.particles) {
        if (!p.alive || p.stuck) continue;
        if (p.x * p.x + p.y * p.y <= CFG.R_DRUM * CFG.R_DRUM) {
          const gx = Math.floor(((p.x + 100) / 200) * res);
          const gy = Math.floor(((p.y + 100) / 200) * res);
          if (gx >= 0 && gx < res && gy >= 0 && gy < res) {
            const idx   = gy * res + gx;
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            heatmap.accN[idx]++;
            heatmap.accV[idx]  += speed;
            heatmap.accV2[idx] += speed * speed;
          }
        }
      }

      heatmap.angleProgress += Math.abs(state.omega * dt);

      if (heatmap.angleProgress >= 2 * Math.PI) {
        // One full revolution complete — finalise the heatmap arrays.
        let curMaxSigma = 0, curMaxDensity = 0, curMaxProduct = 0;
        const totalTicks = Math.max(1, heatmap.tickCount);

        for (let i = 0; i < gridSize; i++) {
          if (heatmap.accN[i] > 2) {
            const n        = heatmap.accN[i];
            const mean     = heatmap.accV[i] / n;
            const meanSq   = heatmap.accV2[i] / n;
            const variance = Math.max(0, meanSq - mean * mean);
            const density  = n / totalTicks; // mean particles per frame in this cell
            const sigma    = Math.sqrt(variance);

            heatmap.data[i]     = sigma;
            heatmap.densData[i] = density;
            heatmap.prodData[i] = density * variance;

            if (sigma            > curMaxSigma)   curMaxSigma   = sigma;
            if (density          > curMaxDensity) curMaxDensity = density;
            if (density*variance > curMaxProduct) curMaxProduct = density * variance;
          } else {
            heatmap.data[i] = heatmap.densData[i] = heatmap.prodData[i] = 0;
          }
        }

        heatmap.maxSigma   = curMaxSigma;
        heatmap.maxDensity = curMaxDensity;
        heatmap.maxProduct = curMaxProduct;
        heatmap.ready      = true;

        // Reset accumulators for the next revolution.
        heatmap.angleProgress = 0;
        heatmap.tickCount     = 0;
        heatmap.accN.fill(0);
        heatmap.accV.fill(0);
        heatmap.accV2.fill(0);
      }
    }
  }


  // ============================================================
  // SECTION: PHYSICS — EGG (PEBBLES)
  // ============================================================

  /**
   * Returns levitated particles: alive, not stuck, not merging, and have
   * completed at least one full orbit (inHighlightSince ≥ T) in the
   * highlight zone.
   *
   * @returns {object[]} Array of levitated particle objects.
   */
  function eggLevitatedParticles() {
    const out = [];
    for (const p of state.particles) {
      if (!p.alive || p.stuck || p.onTray || p.merging) continue;
      if (state.isLevitated(p)) out.push(p);
    }
    return out;
  }

  /**
   * Returns levitated aggregates: alive, not stuck, not merging, and have
   * completed at least one full orbit in the highlight zone.
   *
   * @returns {object[]} Array of levitated aggregate objects.
   */
  function eggLevitatedAggregates() {
    const out = [];
    for (const agg of state.aggregates) {
      if (!agg.alive || agg.stuck || agg.onTray || agg.merging) continue;
      if (state.isLevitated(agg)) out.push(agg);
    }
    return out;
  }

  /**
   * Integrates golden balls, resolves collisions, and manages pebble merge sequencing.
   *
   * A merge animation is started when enough aggregates have been levitated
   * for the required number of revolutions (holdTarget / holdSubseq).
   * While a merge is in progress (state.eggMerging), no new merge can start.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  /**
   * Integrates golden balls, resolves collisions, and manages pebble merge sequencing.
   *
   * On-tray pebbles co-rotate rigidly with the drum (same as on-tray
   * particles and aggregates) and are skipped by gravity integration,
   * wall collision, and ball-ball collision. When the tray is extending
   * or fully inserted, any free pebble within catch distance of the tray
   * segment is collected and pinned to the blade's upper surface.
   *
   * A merge animation is started when enough aggregates have been levitated
   * for the required number of revolutions (holdTarget / holdSubseq).
   * While a merge is in progress (state.eggMerging), no new merge can start.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateEgg(dt) {
    // 1. Advance free pebbles; pin on-tray pebbles to the drum frame.
    for (const b of state.goldenBalls) {
      if (b.onTray) {
        // Rotate rigidly with the drum so the pebble stays fixed on the blade.
        const dA = state.omega * dt;
        const c = Math.cos(dA), s = Math.sin(dA);
        const nx = b.x * c - b.y * s, ny = b.x * s + b.y * c;
        b.x = nx; b.y = ny;
        b.vx = -state.omega * b.y;
        b.vy =  state.omega * b.x;
        continue;
      }
      integrateGoldenBall(b, dt);
    }

    // 2. Ball-ball collisions — only between free pebbles.
    if (state.goldenBalls.length > 1) resolveBallBallCollisions();

    // 3. Wall and bump collisions — only for free pebbles.
    for (const b of state.goldenBalls) {
      if (b.onTray) continue;
      resolveWallCollision(b);
    }

    // 4. Tray catch — pin pebbles to the upper surface of the blade.
    if (state.tray.phase === 'inserting' || state.tray.phase === 'inserted') {
      const ep = trayEndpoints();
      if (ep) {
        for (const b of state.goldenBalls) {
          if (b.onTray || b.merging) continue;
          tryCatchOnTray(b, ep, b.r, b.r);
        }
      }
    }

    // 5. Advance in-progress pebble merge animation.
    if (state.eggMerging) {
      const m = state.eggMerging;
      const u = (state.t - m.startedAt) / m.dur;
      if (u >= 1) {
        for (const p of m.particles) p.alive = false;
        spawnGoldenBall(m.target.x, m.target.y);
        state.aggCount     = Math.max(0, state.aggCount - TUNING.egg.nCrit);
        state.eggMerging   = null;
        state.eggBallCount++;
      }
      return; // block new merges while one is running
    }

    if (state.eggBallCount >= TUNING.egg.maxBalls) return;

    // 6. Check whether enough aggregates are levitated to start a new merge.
    const target = (state.eggBallCount === 0)
      ? TUNING.egg.holdTarget
      : TUNING.egg.holdSubseq;

    const lev = eggLevitatedAggregates();
    const T   = state.period();

    if (!window.aggGrowthOn) {
      // SIMPLE MODE: nCrit levitated aggregates held for holdTarget revs,
      // gated on injection spread. Uses the animated startMerge().
      if (lev.length >= TUNING.egg.nCrit && isFinite(T) &&
          CFG.VT_SPREAD >= TUNING.egg.minSpread) {
        state.eggHoldRevs += dt / T;
        if (state.eggHoldRevs >= target) {
          startMerge(lev);
          state.eggHoldRevs = 0;
        }
      } else {
        state.eggHoldRevs = 0;
      }
    } else {
      // GROWTH MODE: Systemic pebble formation is disabled.
      // Pebble formation is handled entirely by resolveAggAggCollisions.
      state.eggHoldRevs = 0;
    }
  }

  // ============================================================
  // SECTION: PHYSICS — GLOBES (PLANETS)
  // ============================================================

  /**
   * Applies hover/repulsion forces to globes and manages globe merge sequencing.
   *
   * Each globe is attracted toward (0, TUNING.globe.hoverY) and repelled
   * from all other globes. Damping is time-corrected so behaviour is
   * frame-rate independent. A merge begins when enough pebbles are
   * available and the globe count is below the limit.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateGlobe(dt) {
    const R_GLOBE  = TUNING.globe.radius;
    const MIN_DIST = R_GLOBE * 2.2;

    if (state.solar.phase === 'none') {
      for (let i = 0; i < state.globes.length; i++) {
        const g = state.globes[i];
  
        // Attraction toward hover point.
        g.vx += (0                    - g.x) * 0.01 * dt * 60;
        g.vy += (TUNING.globe.hoverY  - g.y) * 0.01 * dt * 60;
  
        // Repulsion from other globes.
        for (let j = 0; j < state.globes.length; j++) {
          if (i === j) continue;
          const other  = state.globes[j];
          const dx     = g.x - other.x;
          const dy     = g.y - other.y;
          const dist   = Math.hypot(dx, dy);
          const distSq = dx * dx + dy * dy + 10; // +10 prevents divide-by-zero
  
          let force = TUNING.globe.repulsion / distSq;
          if (dist < MIN_DIST) force += (MIN_DIST - dist) * 50; // hard-contact push
  
          const angle = Math.atan2(dy, dx);
          g.vx += Math.cos(angle) * force * dt;
          g.vy += Math.sin(angle) * force * dt;
        }
  
        // Time-corrected exponential damping (equivalent to 0.85/frame at 60 fps).
        const damping = Math.exp(-9.74 * dt);
        g.vx *= damping;
        g.vy *= damping;
  
        g.x   += g.vx;
        g.y   += g.vy;
        if (state.solar.phase === 'none') {
          g.spin += TUNING.globe.rotationSpeed * dt;
        }
      }
    }

    // Start a merge if we have enough pebbles and room for another globe.
    if (!state.globeMerging &&
        state.goldenBalls.length >= TUNING.globe.nCrit &&
        state.globes.length < TUNING.globe.limit) {
      const chosen = state.goldenBalls.slice(0, TUNING.globe.nCrit);
      let avgX = 0, avgY = 0;
      for (const b of chosen) { avgX += b.x; avgY += b.y; }
      avgX /= chosen.length;
      avgY /= chosen.length;
      for (const b of chosen) {
        b.merging    = true;
        b.mergeStart = { x: b.x, y: b.y };
      }
      state.globeMerging = {
        pebbles:   chosen,
        startedAt: state.t,
        dur:       TUNING.globe.mergeDur,
        target:    { x: avgX, y: avgY },
      };
    }

    // Advance the merge animation and finalise when complete.
    if (state.globeMerging) {
      const m    = state.globeMerging;
      const u    = (state.t - m.startedAt) / m.dur;
      const ease = u * u * (3 - 2 * u); // smoothstep
      for (const b of m.pebbles) {
        b.x = b.mergeStart.x + (m.target.x - b.mergeStart.x) * ease;
        b.y = b.mergeStart.y + (m.target.y - b.mergeStart.y) * ease;
      }
      if (u >= 1) {
        state.goldenBalls = state.goldenBalls.filter(b => !m.pebbles.includes(b));
        state.globes.push({
          x: m.target.x, y: m.target.y,
          vx: 0, vy: 0,
          r:    TUNING.globe.radius,
          spin: 0,
          bornAt: state.t,
          mapIdx: state.globes.length,
        });
        state.eggBallCount = Math.max(0, state.eggBallCount - m.pebbles.length);
        state.globeMerging = null;
        // Trigger solar system when 2nd+ globe is created
        const newIdx = state.globes.length - 1;
        if (newIdx >= 1 && (state.solar.phase === 'none' || state.solar.phase === 'orbiting')) {
          _ssEnterShowing(newIdx);
        }
      }
    }
  }


  // ============================================================
  // SECTION: PHYSICS — GOLDEN BALLS
  // ============================================================

  /**
   * Integrates one golden ball's position under gravity, applies wall-contact
   * drag, and updates its spin rate.
   *
   * @param {object} b  - The golden ball object to integrate.
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function integrateGoldenBall(b, dt) {
    b.vy -= TUNING.ball.gravity * dt;
    b.x  += b.vx * dt;
    b.y  += b.vy * dt;

    const r            = Math.hypot(b.x, b.y);
    const rMax         = CFG.R_DRUM - b.r;
    const contactMargin = 1.0;

    if (r > rMax - contactMargin && r > 1e-6) {
      // Ball is near or touching the wall — apply tangential drag toward drum velocity.
      const nx = b.x / r, ny = b.y / r;
      const wallVx = -state.omega * b.y;
      const wallVy =  state.omega * b.x;
      const wallVn = wallVx * nx + wallVy * ny;
      const wTanX  = wallVx - wallVn * nx;
      const wTanY  = wallVy - wallVn * ny;
      const k      = 1 - Math.exp(-TUNING.ball.contactDrag * dt);
      const vn     = b.vx * nx + b.vy * ny;
      const vtx    = b.vx - vn * nx;
      const vty    = b.vy - vn * ny;
      const newVtx = vtx + (wTanX - vtx) * k;
      const newVty = vty + (wTanY - vty) * k;
      b.vx = newVtx + vn * nx;
      b.vy = newVty + vn * ny;
      const tx = -ny, ty = nx;
      b.spinRate = -(newVtx * tx + newVty * ty) / b.r;
    } else {
      b.spinRate *= Math.pow(0.95, dt * 60);
    }
    b.spin += b.spinRate * dt;
  }

  /**
   * Resolves a golden ball against the drum wall and the rotating bump.
   *
   * The bump is a small protrusion fixed to the drum that kicks balls
   * as it sweeps past, adding energy to keep them bouncing.
   *
   * @param {object} b - The golden ball object to resolve.
   */
  function resolveWallCollision(b) {
    // --- BUMP COLLISION ---
    // The bump sits at the same spot on the rim as the tray's collection slot.
    // In normal operation it kicks pebbles around; when the tray deploys, it's
    // the hinge from which the blade extends.
    const bumpAngle = state.tray.slotAngle - state.drumAngle;
    const bumpR     = 0.3;
    const bumpX     =  CFG.R_DRUM * Math.cos(bumpAngle);
    const bumpY     = -CFG.R_DRUM * Math.sin(bumpAngle);
    const dx        = b.x - bumpX;
    const dy        = b.y - bumpY;
    const dist      = Math.hypot(dx, dy);
    const minDist   = b.r + bumpR;

    if (dist < minDist && dist > 1e-6) {
      const nx      = dx / dist, ny = dy / dist;
      const overlap = minDist - dist;
      b.x += nx * overlap;
      b.y += ny * overlap;

      const vBumpX = -state.omega * bumpY;
      const vBumpY =  state.omega * bumpX;
      const vRelX  = b.vx - vBumpX;
      const vRelY  = b.vy - vBumpY;
      const vn     = vRelX * nx + vRelY * ny;

      if (vn < 0) {
        const strength = TUNING.ball.bumpStrength;
        b.vx -= (1 + strength) * vn * nx;
        b.vy -= (1 + strength) * vn * ny;
        if (Math.abs(vn) > 10) soundGoldenThud(Math.abs(vn));
      }
    }

    // --- OUTER WALL COLLISION ---
    const r    = Math.hypot(b.x, b.y);
    const rMax = CFG.R_DRUM - b.r;

    if (r <= rMax) {
      // Inside the wall — damp if nearly settled against it.
      if (Math.abs(b.vx) < TUNING.ball.settleVel &&
          Math.abs(b.vy) < TUNING.ball.settleVel &&
          r > rMax - 0.5) {
        b.vx *= 0.85;
        b.vy *= 0.85;
      }
      return;
    }
    if (r < 1e-6) return;

    const nxW = b.x / r, nyW = b.y / r;
    b.x = nxW * rMax;
    b.y = nyW * rMax;
    const vnW  = b.vx * nxW + b.vy * nyW;
    const vtxW = b.vx - vnW * nxW;
    const vtyW = b.vy - vnW * nyW;
    b.vx = vtxW * TUNING.ball.wallFriction + (-vnW * TUNING.ball.wallE) * nxW;
    b.vy = vtyW * TUNING.ball.wallFriction + (-vnW * TUNING.ball.wallE) * nyW;
    if (Math.abs(vnW) > 30) soundGoldenThud(Math.abs(vnW));
  }

  /**
   * Resolves all pairwise golden-ball collisions using coefficient of restitution.
   * Iterates O(n²) over all ball pairs; acceptable given the low ball count.
   */
  function resolveBallBallCollisions() {
    const balls = state.goldenBalls;
    const n     = balls.length;
    const e     = TUNING.ball.ballE;

    for (let i = 0; i < n; i++) {
      if (balls[i].onTray) continue;
      for (let j = i + 1; j < n; j++) {
        if (balls[j].onTray) continue;
        const A  = balls[i], B = balls[j];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d2 = dx * dx + dy * dy;
        const minD = A.r + B.r;
        if (d2 >= minD * minD) continue;

        const d    = Math.sqrt(d2);
        const nx   = d < 1e-6 ? 1 : dx / d;
        const ny   = d < 1e-6 ? 0 : dy / d;
        const half = (minD - d) * 0.5;
        A.x -= nx * half; A.y -= ny * half;
        B.x += nx * half; B.y += ny * half;

        const vAn     = A.vx * nx + A.vy * ny;
        const vBn     = B.vx * nx + B.vy * ny;
        const vRel    = vAn - vBn;
        if (vRel <= 0) continue;

        const impulse = (1 + e) * vRel * 0.5;
        A.vx -= impulse * nx; A.vy -= impulse * ny;
        B.vx += impulse * nx; B.vy += impulse * ny;
        if (vRel > 30) soundGoldenThud(vRel * 0.6);
      }
    }
  }

  /**
   * Adds a new golden ball to state at the given position and plays the crunch sound.
   *
   * @param {number} x - Initial x position in drum-units.
   * @param {number} y - Initial y position in drum-units.
   */
  function spawnGoldenBall(x, y) {
    const inChallenge = !!(window.CHALLENGE && window.CHALLENGE.on &&
                           window.CHALLENGE.phase === 'playing');
    let showBanner;
    if (inChallenge) {
      showBanner = true; // every pebble is celebrated in Challenge
    } else {
      showBanner = !state.pebbleBannerUsed; // first pebble of the run only
      if (showBanner) state.pebbleBannerUsed = true;
    }
    state.goldenBalls.push({
      x, y,
      vx: 0, vy: 0,
      r:        TUNING.ball.radius,
      spin:     0,
      spinRate: 0,
      bornAt:   state.t,
      showBanner,
    });
    if (navigator.vibrate) navigator.vibrate([60, 80, 120]);
    soundCrunch();
  }
  /**
   * Selects aggregate targets and initiates an egg-merge (pebble) animation.
   *
   * If there are ≤ 3 levitated aggregates the merge target is their centroid.
   * With more, a K-nearest-neighbours search finds the most tightly clustered
   * aggregate as the target, which produces more visually coherent merges.
   *
   * @param {object[]} levList - Array of currently levitated aggregate objects.
   */
  function startMerge(levList) {
    const N    = TUNING.egg.nCrit;
    const pool = levList.slice();

    // Fisher-Yates partial shuffle to pick N random candidates.
    for (let i = 0; i < N && i < pool.length; i++) {
      const j   = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const chosen = pool.slice(0, Math.min(N, pool.length));
    if (chosen.length === 0) return;

    let target;
    if (levList.length <= 3) {
      // Small population: use centroid.
      let cx = 0, cy = 0;
      for (const p of levList) { cx += p.x; cy += p.y; }
      target = { x: cx / levList.length, y: cy / levList.length };
    } else {
      // Larger population: find the aggregate with the smallest K-th neighbour
      // distance (densest cluster centre).
      const K = 3;
      let bestIdx = 0, bestKth = Infinity;
      for (let i = 0; i < levList.length; i++) {
        const a     = levList[i];
        const dists = [];
        for (let j = 0; j < levList.length; j++) {
          if (j === i) continue;
          const dx = levList[j].x - a.x;
          const dy = levList[j].y - a.y;
          dists.push(dx * dx + dy * dy);
        }
        dists.sort((x, y) => x - y);
        const kth = dists[K - 1];
        if (kth < bestKth) { bestKth = kth; bestIdx = i; }
      }
      target = { x: levList[bestIdx].x, y: levList[bestIdx].y };
    }

    for (const p of chosen) {
      p.merging    = true;
      p.mergeStart = { x: p.x, y: p.y };
    }
    state.eggMerging = {
      particles: chosen,
      target,
      startedAt: state.t,
      dur:       TUNING.egg.mergeDur,
    };
  }


  // ============================================================
  // SECTION: PHYSICS — AGGREGATES
  // ============================================================

  /**
   * Manages aggregate orbit physics, wall collisions, and merge sequencing.
   * Also handles lidar sweep detection for visibility flash timing.
   *
   * Aggregates orbit like particles but use their own vt; they fragment back
   * into ~10 stuck particles when they hit the wall.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */

  /**
   * Scans all live aggregate pairs for physical contact and initiates
   * a growth merge when two overlap. Processes one pair per call —
   * subsequent collisions are deferred until the animation completes.
   * Only runs when window.aggGrowthOn is true.
   */
  
  function resolveAggAggCollisions() {
    // 1. Strict filter: must be alive, not stuck, not on tray, and not currently merging.
    const live = state.aggregates.filter(a => a.alive && !a.stuck && !a.onTray && !a.merging);
    const doBounce = (window.aggGrowthStage === 2); 
    
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        
        // Prevent objects currently flagged for animation from executing collisions
        if (a.merging || b.merging) continue;

        // Ensure aggregates have IDs for serialization-safe tracking
        if (!a.id) a.id = Math.random();
        if (!b.id) b.id = Math.random();

        // Pair-specific cooldown: prevent A and B from re-colliding
        if (a.lastBounce?.withId === b.id && state.t < a.lastBounce.until) continue;
        if (b.lastBounce?.withId === a.id && state.t < b.lastBounce.until) continue;        

        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;
        
        if (dist < minDist) {
          const totalCount = a.count + b.count;

          if (totalCount >= 100) {
            // PEBBLE FORMATION THRESHOLD CHECK
            const meanVt = state.injectedMeanVt || CFG.V_T;
            const threshold = TUNING.egg.vtSpreadMult * meanVt;

            if (!doBounce || (a.vt > threshold && b.vt > threshold)) {
              // Threshold met (or Stage 1 active): Form Pebble
              a.alive = false; 
              b.alive = false;
              spawnGoldenBall((a.x + b.x) / 2, (a.y + b.y) / 2);
              state.aggCount = Math.max(0, state.aggCount - 2);
              state.eggBallCount++;
              soundGoldenChime();
            } else {
              // Threshold failed (Stage 2 active): Billiard Bounce
              const nx = dx / dist, ny = dy / dist;
              const overlap = minDist - dist;
              
              // Push apart by 51% of the overlap each (creates a 2% safety gap)
              const push = overlap / 1.96; 
              a.x -= nx * push; 
              a.y -= ny * push;
              b.x += nx * push; 
              b.y += ny * push;
              
              // Increase terminal velocity to change their aerodynamic sorting
              const kick = TUNING.egg.bounceKick;
              const oldVtA = a.vt;
              const oldVtB = b.vt;
              
              a.vt *= kick;
              b.vt *= kick;

              // Half drum rotation cooldown (safeguarded against division by zero)
              // Half drum rotation cooldown (safeguarded against division by zero)
              const cooldownDur = Math.PI / Math.max(0.01, Math.abs(state.omega));
              a.lastBounce = { withId: b.id, until: state.t + cooldownDur };
              b.lastBounce = { withId: a.id, until: state.t + cooldownDur };
              
              // Visual flash timer for debugging (0.6 seconds)
              a.bounceFlashEndsAt = state.t + 0.6;
              b.bounceFlashEndsAt = state.t + 0.6;

              console.log(`Bounce! Agg A vt: ${oldVtA.toFixed(2)} -> ${a.vt.toFixed(2)} | Agg B vt: ${oldVtB.toFixed(2)} -> ${b.vt.toFixed(2)}`);

              if (TUNING.egg.bounceSound) {
                if (window.soundSharpPing) window.soundSharpPing();
              }
            }
          } else {
            // STANDARD GROWTH (< 100 monomers): Always Merge
            const smaller = a.count <= b.count ? a : b;
            const larger  = a.count <= b.count ? b : a;
            smaller.merging = true;
            smaller.mergeStart = { x: smaller.x, y: smaller.y };
            
            state.aggGrowMerging = { 
              smaller, 
              larger, 
              startedAt: state.t, 
              dur: TUNING.aggregate.mergeDur, 
              vtSmaller: smaller.vt, 
              vtLarger: larger.vt 
            };
          }
          return; // Resolve max one collision per frame to prevent chain-reaction bugs
        }
      }
    }
  }

  /**
   * Returns the required hold revolutions between aggregate formations,
   * scaled down for large particle counts to maintain visual interest.
   */
  function aggSubseqHoldRevs() {
    const n = CFG.N_P;
    if      (n >= 10000) return TUNING.aggregate.subseqHoldRevs / 10;
    else if (n >= 3000)  return TUNING.aggregate.subseqHoldRevs / 3;
    else if (n >= 1000)  return TUNING.aggregate.subseqHoldRevs / 2;
    else                 return TUNING.aggregate.subseqHoldRevs;
  }

  /**
   * Returns the relative spread (coefficient of variation) of vt among
   * a list of particle or aggregate objects. Returns 0 for fewer than 2.
   *
   * @param {object[]} list - Array of objects with a .vt property.
   * @returns {number} Relative spread: stddev(vt) / mean(vt).
 */
  function _levitatedSpread(list) {
    if (list.length < 2) return 0;
    const mean = list.reduce((s, p) => s + p.vt, 0) / list.length;
    if (mean < 1e-6) return 0;
    const variance = list.reduce((s, p) => s + (p.vt - mean) ** 2, 0) / list.length;
    return Math.sqrt(variance) / mean;
  }

  function updateAggregates(dt) {
    // 1. Advance an in-progress aggregate merge animation (initial 10-monomer formation).
    if (state.aggMerging) {
      const m = state.aggMerging;
      const u = (state.t - m.startedAt) / m.dur;
      if (u >= 1) {
        for (const p of m.particles) p.alive = false;
        spawnAggregate(m.target.x, m.target.y, m.meanVt * m.vtFactor, m.sizeFac, m.targetImgIdx);
        state.aggMerging = null;
        state.aggCount++;
      }
    }
    // 1b. Advance in-progress aggregate-aggregate growth merge
    if (state.aggGrowMerging) {
      const m = state.aggGrowMerging;
      const u = (state.t - m.startedAt) / m.dur;
      const ease = u * u * (3 - 2 * u);
      
      m.smaller.x = m.smaller.mergeStart.x + (m.larger.x - m.smaller.mergeStart.x) * ease;
      m.smaller.y = m.smaller.mergeStart.y + (m.larger.y - m.smaller.mergeStart.y) * ease;
      
      if (u >= 1) {
        m.larger.count += m.smaller.count;
        m.larger.vt *= (TUNING.aggregate.vtGrowFactor || 1.05);
        m.larger.imgIdx = aggImageIndex(m.larger.count);
        
        // Scale radius proportional to the cube root of the new mass
        const scale = Math.pow(m.larger.count / (m.larger.count - m.smaller.count), 1/3);
        m.larger.r *= scale;
        
        m.smaller.alive = false;
        state.aggCount--;
        state.aggGrowMerging = null;
      }
    }

    // 2. FIXME Check for aggregate-aggregate collisions when growth mode is active.
    // Collision gate: Run collision logic ONLY for Stage 1 and Stage 2
    // Collision gate: Run collision logic ONLY for Stage 1 and Stage 2
    if (window.aggGrowthStage >= 1 && window.aggGrowthStage <= 2 && !state.aggMerging && !state.aggGrowMerging) {
      resolveAggAggCollisions();
    }

    // 3. Check whether enough particles are levitated to start a new 10-monomer aggregate merge.
    if (!state.aggMerging) {
      const lev = eggLevitatedParticles();
      const T   = state.period();
      
      // Criterion: the empirical 95.45% range (2.275th–97.725th percentile)
      // of floating particle vt must exceed 50% of the mean vt.
      const _floatingVts = state.particles
            .filter(p => p.alive && !p.stuck && !p.merging && p.insideOnce)
            .map(p => p.vt);
      const _aggCanForm = (() => {
        if (_floatingVts.length < 2) return false;
        const sorted = [..._floatingVts].sort((a, b) => a - b);
        const n      = sorted.length;
        const lo     = sorted[Math.floor(0.02275 * (n - 1))];
        const hi     = sorted[Math.ceil(0.97725  * (n - 1))];
        const mean   = _floatingVts.reduce((s, v) => s + v, 0) / n;
        return mean > 0 && (hi - lo) >= TUNING.aggregate.spreadThresh * mean;
      })();
      if (lev.length >= TUNING.aggregate.minLevitated &&
          isFinite(T) &&
          _aggCanForm) {
        state.aggHoldRevs += dt / T;
        const target = state.aggCount === 0
          ? TUNING.aggregate.initialHoldRevs
          : aggSubseqHoldRevs();
        if (state.aggHoldRevs >= target) {
          const pool = state.particles.filter(
            p => p.alive && !p.stuck && !p.merging && p.inHighlightSince !== null
          );
          if (pool.length >= TUNING.aggregate.mergeCount) {
            startAggregateMerge(lev, pool);
          }
          state.aggHoldRevs = 0;
        }
      } else {
        state.aggHoldRevs = 0;
      }
    }

    // 4. Main physics loop for all active aggregates
    const HX  = TUNING.highlight.cx;
    const HY  = TUNING.highlight.cy;
    const HR2 = TUNING.highlight.radius * TUNING.highlight.radius;

    for (const agg of state.aggregates) {
      if (agg.merging) continue;
      if (agg.onTray) {
        const dA = state.omega * dt;
        const c = Math.cos(dA), s = Math.sin(dA);
        const nx = agg.x * c - agg.y * s, ny = agg.x * s + agg.y * c;
        agg.x = nx; agg.y = ny;
        agg.vx = -state.omega * agg.y; agg.vy = state.omega * agg.x;
        continue;
      }

      if (agg.stuck) {
        // Stuck aggregates ride the drum wall.
        agg.stuckAngle += state.omega * dt;
        agg.x = (CFG.R_DRUM - agg.r) * Math.cos(agg.stuckAngle);
        agg.y = (CFG.R_DRUM - agg.r) * Math.sin(agg.stuckAngle);
      } else {
        // Lidar sweep detection.
        if (state.laserOn) {
          const pa = Math.atan2(agg.y, agg.x);
          if (angleSwept(state.laserAngle - LASER_OMEGA * dt, state.laserAngle, pa)) {
            agg.flashEndsAt = state.t + 0.40 * TUNING.lidar.flashDurMul;
          }
        }

        // Orbital kinematics: co-rotate with drum, settle at vt.
        agg.vx = -state.omega * agg.y;
        agg.vy =  state.omega * agg.x - agg.vt;

        // Turbulent perturbation — models gas velocity fluctuations.
        // Only applied when aggregate growth mode is active.
        if (window.aggGrowthOn && Math.abs(state.omega) > 1e-3) {
          const turb    = TUNING.aggregate.brownian;
          const kR      = TUNING.aggregate.restoreK;
          const xc      = agg.vt / state.omega;
        
          // Random Brownian kick
          agg.vx += turb * randn();
          agg.vy += turb * randn();
        
          // Restoring force toward natural orbit centre (xc, 0)
          agg.vx += kR * (xc - agg.x) * dt;
          agg.vy += kR * (0  - agg.y) * dt;
        }

        agg.x += agg.vx * dt;
        agg.y += agg.vy * dt;
        agg.rot += agg.rotSpeed * dt;

        // Collect aggregates within catch distance of the live rotating tray line.
        // Aggregates use their radius for both the catch threshold and offset.
        if ((state.tray.phase === 'inserting' || state.tray.phase === 'inserted')
            && !agg.onTray) {
          const ep = trayEndpoints();
          if (ep) tryCatchOnTray(agg, ep, agg.r, agg.r);
        }

        const r2    = agg.x * agg.x + agg.y * agg.y;
        const Rwall = CFG.R_DRUM - agg.r;

        if (r2 >= Rwall * Rwall) {
          if (TUNING.particle.invincible) {
            // Nanocoating active — reflect aggregate back inside
            const r    = Math.sqrt(r2);
            const nx   = agg.x / r, ny = agg.y / r;
            // Clamp position to just inside the wall
            agg.x = nx * Rwall * 0.999;
            agg.y = ny * Rwall * 0.999;
            // Reflect the radial velocity component
            const vn   = agg.vx * nx + agg.vy * ny;
            agg.vx -= 2 * vn * nx;
            agg.vy -= 2 * vn * ny;
            // Damp slightly so it doesn't rattle forever
            agg.vx *= 0.6;
            agg.vy *= 0.6;
          } else {
            // Normal wall collision: fragment back into stuck particles
            agg.alive = false;
            const baseAngle = Math.atan2(agg.y, agg.x);
            const pRwall    = CFG.R_DRUM - TUNING.particle.collisionR;
            state.aggCount = Math.max(0, state.aggCount - 1);
            
            for (let i = 0; i < 10; i++) {
              const spread = (Math.random() - 0.5) * (agg.r / CFG.R_DRUM) * 2.5;
              const pAngle = baseAngle + spread;
              state.particles.push({
                x: pRwall * Math.cos(pAngle),
                y: pRwall * Math.sin(pAngle),
                vx: 0, vy: 0,
                vt: agg.vt,
                stuck: true, stuckAngle: pAngle, stuckAt: state.t,
                alive: true, inHighlightSince: null,
                flashEndsAt: -1, insideOnce: true,
                imgIdx: Math.floor(Math.random() * aggregateImages.length),
              });
              state.lostCount++;
            }
            soundTink(); soundTink(); soundTink();
          }
        } else {
          // Track highlight zone membership.
          const dxh = agg.x - HX, dyh = agg.y - HY;
          if (dxh * dxh + dyh * dyh <= HR2) {
            if (agg.inHighlightSince === null) agg.inHighlightSince = state.t;
          } else {
            agg.inHighlightSince = null;
          }
        }
      }

      if (agg.y < -CFG.R_DRUM * 1.5) agg.alive = false;
    }

    // 5. Cleanup
    if (state.aggregates.length > 0) {
      state.aggregates = state.aggregates.filter(a => a.alive);
    }
  }

  /**
   * Chooses a merge centre and kicks off an aggregate merge animation.
   *
   * Candidates are chosen as the `mergeCount` particles nearest to a
   * randomly selected levitated particle (the "centre").
   *
   * @param {object[]} levList - Levitated particles used to pick the centre.
   * @param {object[]} pool    - Full pool of eligible particles.
   */
  function startAggregateMerge(levList, pool) {
    const centerP = levList[Math.floor(Math.random() * levList.length)];

    const sorted = pool
      .map(p => {
        const dx = p.x - centerP.x, dy = p.y - centerP.y;
        return { p, d2: dx * dx + dy * dy };
      })
      .sort((a, b) => a.d2 - b.d2);

    const chosen  = sorted.slice(0, TUNING.aggregate.mergeCount).map(item => item.p);
    const targetImgIdx = Math.floor(Math.random() * aggregateImages.length);
    let cx = 0, cy = 0, sumVt = 0, sumSizeFac = 0;

    for (const p of chosen) {
      p.merging    = true;
      p.mergeStart = { x: p.x, y: p.y };
      cx += p.x; cy += p.y;
      sumVt     += p.vt;
      sumSizeFac += visualSizeFactor(p.vt);
    }

    state.aggMerging = {
      particles:    chosen,
      target:       { x: cx / chosen.length, y: cy / chosen.length },
      // vtFactor gives the aggregate a slightly higher Stokes number than
      // the pure mean, modelling the increased inertia of the merged body.
      meanVt:       sumVt / chosen.length,
      vtFactor:     window.stokesKickOn ? TUNING.aggregate.vtFactor : 1.0,
      sizeFac:      sumSizeFac / chosen.length,
      startedAt:    state.t,
      dur:          TUNING.aggregate.mergeDur,
      targetImgIdx: targetImgIdx,
    };
  }

  /**
   * Adds a new aggregate to state and plays the snap sound.
   *
   * @param {number} x            - Initial x position in drum-units.
   * @param {number} y            - Initial y position in drum-units.
   * @param {number} vt           - Terminal velocity in cm/s.
   * @param {number} sizeFac      - Visual size scaling factor relative to one particle.
   * @param {number} presetImgIdx - Image index; a random index is chosen if undefined.
   */
  function spawnAggregate(x, y, vt, sizeFac, presetImgIdx) {
    const baseR    = TUNING.particle.collisionR * sizeFac * TUNING.aggregate.sizeMult;
    const speedMag = Math.abs(state.omega) * (1 + Math.random() * 2);
    const dir      = Math.random() < 0.5 ? 1 : -1;
    const imgIdx = aggImageIndex(10);

    state.aggregates.push({
      x, y, vt,
      vx: 0, vy: 0,
      r:        baseR,
      count:    10,
      rot:      Math.random() * Math.PI * 2,
      rotSpeed: speedMag * dir,
      stuck:    false,
      alive:    true,
      inHighlightSince: null,
      merging:  false,
      imgIdx,
      orbitFlashEndsAt: state.t + 2.0,
    });
    if (state.aggCount < 10 && navigator.vibrate) navigator.vibrate(30);
    soundSnap();
  }

  /**
   * Enters the 'showing' phase: the new globe appears full-size at the system centre.
   */
  function _ssEnterShowing(newIdx) {
    const s     = state.solar;
    s.phase     = 'showing';
    s.phaseStart = s.wallT;
    s.pendingIdx = newIdx;
    const g = state.globes[newIdx];
    if (g) { g.x = s.centerX; g.y = s.centerY; g.vx = 0; g.vy = 0; }
  }
  
  /**
   * Enters the 'transitioning' phase: globes animate smoothly to their orbital positions.
   */
  function _ssEnterTransitioning() {
    const s  = state.solar;
    const n  = state.globes.length;
    const SS = TUNING.solar;
    s.phase      = 'transitioning';
    s.phaseStart  = s.wallT;
    s.startScale  = s.scale;
    s.targetScale = _ssFitScale(n);
  
    // Register any globe not yet tracked
    for (let i = s.orbits.length; i < n; i++) {
      const g = state.globes[i];
      s.orbits.push({
        r:       SS.baseRadii[i],
        theta:   (i / Math.max(n, 2)) * 2 * Math.PI,
        omega:   _ssOmega(SS.baseRadii[i]),
        startX:  g.x,
        startY:  g.y,
        inOrbit: false,
      });
    }
  }
  
  /**
   * Drives the solar system state machine on real wall time (unaffected by simSpeed).
   * Called from main.js after updateGlobe().
   */
  function _probeUpdate(probe, dt) {
    probe.trail.push({ x: probe.x, y: probe.y });
    if (probe.trail.length > 120) probe.trail.shift();
  
    if (probe.escaping) {
      probe.escapeFrac += dt / 5.0;
      if (probe.escapeFrac >= 1) { probe.escapeFrac = 1; probe.done = true; }
      const e = probe.escapeFrac * probe.escapeFrac * (3 - 2 * probe.escapeFrac);
      probe.x = probe.escapeStartX + (probe.escapeEndX - probe.escapeStartX) * e;
      probe.y = probe.escapeStartY + (probe.escapeEndY - probe.escapeStartY) * e;
      return;
    }
  
    if (probe.legIdx >= state.globes.length) return;
    const tg  = state.globes[probe.legIdx];  // track planet's CURRENT position
    const dx  = tg.x - probe.x;
    const dy  = tg.y - probe.y;
    const dist = Math.hypot(dx, dy);
    const speed = 28.0; // drum-units per second
  
    if (dist < speed * dt * 4.5) {
      probe.x = tg.x;
      probe.y = tg.y;
      probe.legIdx++;
      if (probe.legIdx >= state.globes.length) {
        probe.escaping     = true;
        probe.escapeFrac   = 0;
        probe.escapeStartX = probe.x;
        probe.escapeStartY = probe.y;
        probe.escapeEndX   = probe.x * 0.05;
        probe.escapeEndY   = probe.escapeDir * CFG.R_DRUM * 0.88;
      }
    } else {
      probe.x += (dx / dist) * speed * dt;
      probe.y += (dy / dist) * speed * dt;
    }
  }

  function updateSolar() {
    const s = state.solar;
    if (s.phase === 'none') return;
  
    // Real-time delta
    const now = performance.now() / 1000;
    const dt  = Math.min(now - (s._lastT || now), 0.05);
    s._lastT  = now;
    s.wallT  += dt;
    
    const refOmega = s.orbits.length > 1
      ? s.orbits[1].omega
      : _ssOmega(TUNING.solar.baseRadii[1]);
    for (let i = 0; i < state.globes.length; i++) {
      const orb = s.orbits[i];
      // Inner two: tidally locked — spin matches orbital rate
      if (i < 2 && orb) {
        state.globes[i].spin += orb.omega * dt;
      } else {
        // Outer planets: prograde at 3× planet-2's orbital rate
        state.globes[i].spin += refOmega * 3 * dt;
      }
    }

    const elapsed = s.wallT - s.phaseStart;
    const SS = TUNING.solar;
  
    // Kill velocity on all globes — positions are driven here, not by updateGlobe
    for (const g of state.globes) { g.vx = 0; g.vy = 0; }
  
    // Advance thetas for all in-orbit globes
    for (const orb of s.orbits) {
      if (orb.inOrbit) orb.theta += orb.omega * dt;
    }
  
    // ── PHASE MACHINE ──────────────────────────────────────────────────────────
  
    if (s.phase === 'showing') {
      // Pin the pending globe to the system centre
      const g = state.globes[s.pendingIdx];
      if (g) { g.x = s.centerX; g.y = s.centerY; }
      if (elapsed >= SS.showDur) _ssEnterTransitioning();
  
    } else if (s.phase === 'transitioning') {
      const u    = Math.min(1, elapsed / SS.transDur);
      const ease = u * u * (3 - 2 * u);
  
      // Interpolate system scale
      s.scale = s.startScale + (s.targetScale - s.startScale) * ease;
  
      // Grow sun alpha toward target
      const tgtAlpha = Math.min(0.85, state.globes.length * 0.14);
      s.sunAlpha += (tgtAlpha - s.sunAlpha) * Math.min(1, dt * 2);
  
      // Animate any globe not yet in orbit toward its orbital position
      for (let i = 0; i < s.orbits.length; i++) {
        const orb = s.orbits[i];
        if (orb.inOrbit) continue;
        orb.theta += orb.omega * dt; // orbit angle advances during transition
        const tx = s.centerX + orb.r * s.scale * Math.cos(orb.theta);
        const ty = s.centerY + orb.r * s.scale * Math.sin(orb.theta) * SS.inclCos;
        const g  = state.globes[i];
        g.x = orb.startX + (tx - orb.startX) * ease;
        g.y = orb.startY + (ty - orb.startY) * ease;
      }
  
      if (u >= 1) {
        s.scale = s.targetScale;
        for (const orb of s.orbits) orb.inOrbit = true;
        s.pendingIdx = -1;
        const isLast = state.globes.length >= TUNING.globe.limit;
        s.phase      = isLast ? 'spindown' : 'orbiting';
        s.phaseStart  = s.wallT;
        if (isLast) {
          state.omegaTarget = 0;
          window.autoOmegaOn = false;
          if (window.setOmegaCtlMode) window.setOmegaCtlMode(0);
          if (window.setOmegaDecay) window.setOmegaDecay(false);
        }
      }
  
    } else if (s.phase === 'orbiting') {
      // thetas already advanced above — nothing extra needed
  
    } else if (s.phase === 'spindown') {
      // Decay omega on real wall time, independent of state.running
      state.omega *= Math.exp(-TUNING.drum.omegaDecay * dt);
      state.omegaTarget = 0;
      const stopped = Math.abs(state.omega) < 0.05;
      const empty   = state.particles.length === 0 && state.toInject.length === 0;
      if (stopped && empty && elapsed > 1) {
        state.omega   = 0;
        state.running = false;
        s.phase       = 'final_move';
        s.phaseStart  = s.wallT;
      }
  
    } else if (s.phase === 'final_move') {
      const u    = Math.min(1, elapsed / 5.0);
      const ease = u * u * (3 - 2 * u);
      s.centerY  = -50 + 50 * ease; // rise from hoverY to drum axis
      if (u >= 1) {
        s.centerY    = 0;
        s.phase      = 'final_view';
        s.phaseStart = s.wallT;
      }
  
    } else if (s.phase === 'final_view') {
      // Launch probes after a short settling delay
      if (!s.probesLaunched && elapsed >= 3.0 && state.globes.length >= 2) {
        s.probesLaunched = true;
        const g0 = state.globes[0];
        const mkProbe = (dir, delay) => ({
          x: g0.x, y: g0.y, trail: [],
          legIdx: 1,
          escapeDir: dir, escaping: false, escapeFrac: 0,
          escapeStartX: 0, escapeStartY: 0,
          escapeEndX: 0, escapeEndY: 0,
          delay, done: false,
        });
        s.probes = [
          mkProbe(+1, 0.0),
          mkProbe(-1, 2.4),
        ];
      }
    
      if (s.probesLaunched) {
        for (const probe of s.probes) {
          if (probe.done) continue;
          if (probe.delay > 0) {
            probe.delay -= dt;
            const g0 = state.globes[0];
            if (g0) { probe.x = g0.x; probe.y = g0.y; }
            continue;
          }
          _probeUpdate(probe, dt);
        }
        // Show end sheet when both probes are halfway through their escape
        const bothDone = s.probes.length === 2 && s.probes.every(p => p.done);
        if (bothDone && !s._sheetTimer && document.getElementById('gameSheet').hidden) {
          s._sheetTimer = setTimeout(() => {
            s._sheetTimer = null;
            if (window.showSheet) {
              document.getElementById('gameSheet').classList.add('no-backdrop');
              window.showSheet(
                'LIMIT OF SIMULATION SPACE REACHED',
                'Many planets, and you are still playing? Time to go do something else!',
                'Reset Lab',
                () => {
                  document.getElementById('gameSheet').classList.remove('no-backdrop');
                  document.getElementById('gameSheet').hidden = true;
                  state._endingSequenceTriggered = false;
                  document.getElementById('btnReset').click();
                }
              );
            }
          }, 2000);
        }
      }
    }
  
    // ── SET GLOBE POSITIONS FROM ORBIT STATE ──────────────────────────────────
    for (let i = 0; i < s.orbits.length; i++) {
      const orb = s.orbits[i];
      if (!orb.inOrbit) continue;
      state.globes[i].x = s.centerX + orb.r * s.scale * Math.cos(orb.theta);
      state.globes[i].y = s.centerY + orb.r * s.scale * Math.sin(orb.theta) * SS.inclCos;
    }
  }

  /**
   * Computes the drum angular velocity that centres the full range of
   * orbit centres for the current v_t distribution inside the levitation zone.
   *
   * Physics: orbit centre x_c = v_t / omega.
   * Centring condition: (vtLow + vtHigh) / (2 * omega) = highlight.cx
   *   => omega = (vtLow + vtHigh) / (2 * highlight.cx)
   *
   * This guarantees both endpoints land within [0, cx+radius] = [0, 100]
   * for any valid distribution without additional clamping.
   *
   * @returns {number} Target angular velocity in rad/s, clamped to drum limits.
   */
  function computeAutoOmega() {
    const HCX   = TUNING.highlight.cx;          // 50 — levitation zone centre
    const floor = TUNING.particle.settleFloor;  // minimum meaningful v_t
    const dist  = state.distMode;
    const p     = state.distParams;
  
    let vtLow, vtHigh;
  
    if (dist === 'bi') {
      // Each group spans vt * (1 ± spread); take the full envelope
      const lo1 = Math.max(floor, p.bi.vt1 * (1 - Math.abs(p.bi.s1)));
      const hi1 = p.bi.vt1 * (1 + Math.abs(p.bi.s1));
      const lo2 = Math.max(floor, p.bi.vt2 * (1 - Math.abs(p.bi.s2)));
      const hi2 = p.bi.vt2 * (1 + Math.abs(p.bi.s2));
      vtLow  = Math.min(lo1, lo2);
      vtHigh = Math.max(hi1, hi2);
  
    } else if (dist === 'power') {
      vtLow  = Math.max(floor, p.power.vtMin);
      vtHigh = Math.max(vtLow + 0.1, p.power.vtMax);
  
    } else {
      // Default Gaussian: ±1σ representative range
      const spread = CFG.VT_SPREAD;
      vtLow  = Math.max(floor, CFG.V_T * (1 - spread));
      vtHigh = CFG.V_T * (1 + spread);
    }
  
    // Safety: guarantee a non-degenerate interval
    vtHigh = Math.max(vtHigh, vtLow + 0.1);
  
    // Centre the orbit-centre range on the levitation zone
    const omega = (vtLow + vtHigh) / (2.0 * HCX);
  
    return Math.min(Math.max(omega, 0.02), TUNING.drum.omegaMax);
  }

  // ============================================================
  // SECTION: PHYSICS — COLLECTION TRAY
  // ============================================================

  /**
   * Drives the collection-tray state machine. Call once per frame AFTER
   * the updateDrum sub-loop.
   *
   * Timing
   *   armed     → waits for the gold slot marker to cross 12 o'clock
   *   inserting → tray slides in over 270° of drum rotation
   *               omega maintained at full speed for the first decelStart
   *               fraction, then a smooth cubic ramp-down to zero in the
   *               final (1 – decelStart) fraction only
   *   inserted  → drum stopped, particles/aggregates settle onto tray
   */

  /**
 * Returns the tray's hinge and tip in drum (lab) coordinates for the
 * current drum angle and tray progress. Returns null if tray not extended.
 */
  function trayEndpoints() {
    const tray = state.tray;
    if (tray.phase === 'idle' || tray.progress <= 0) return null;

    // slotAngle and drumAngle are canvas-frame angles (y-down). Convert
    // to a drum-frame angle (y-up) for use with X2px/Y2px later.
    const sCA      = tray.slotAngle - state.drumAngle;   // canvas frame
    const sCA_drum = -sCA;                               // drum frame (y-up)

    // Hinge: on the rim, in drum coordinates.
    const hx = CFG.R_DRUM * Math.cos(sCA_drum);
    const hy = CFG.R_DRUM * Math.sin(sCA_drum);

    // Recover lab-frame tray direction from the stored drum-frame vector.
    // Drum rotates by -drumAngle in the drum (y-up) frame, so we apply
    // the inverse rotation by +drumAngle here (sign flip of state.drumAngle
    // already accounted for by the storage convention below).
    const theta = state.drumAngle;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const dirX = tray.trayDirX * c - tray.trayDirY * s;
    const dirY = tray.trayDirX * s + tray.trayDirY * c;
    // Tip: hinge + (current length) · direction.   Length grows linearly with p.
    const len = tray.trayLen * tray.progress;
    const tx  = hx + dirX * len;
    const ty  = hy + dirY * len;

    // Perpendicular unit vector to the tray axis, in the drum frame,
    // pointing toward the tray's "top" surface (the side particles
    // land on). For a tray entering from the rim, the natural choice
    // is the side facing the drum centre — i.e. roughly opposite the
    // outward radial at the hinge. We compute it as 90° CCW from
    // (hinge → tip), then flip if it points outward.
    const ax = tx - hx, ay = ty - hy;
    const alen = Math.hypot(ax, ay) || 1;
    let upx = -ay / alen, upy = ax / alen;     // 90° CCW
    // Flip if pointing outward (dot product with hinge's outward radial > 0)
    if (upx * hx + upy * hy > 0) { upx = -upx; upy = -upy; }

    return { hx, hy, tx, ty, upx, upy };
  }
  window.trayEndpoints = trayEndpoints;

  /**
   * Pins a floating object onto the collection-tray blade if it lies within
   * catch distance of the tray segment. Shared by particles, aggregates, and
   * pebbles (the three previously-duplicated catch blocks).
   *
   * The caller owns the phase gate, the eligibility checks
   * (onTray / merging / insideOnce), and supplying `ep` — so the per-frame
   * trayEndpoints() call frequency is unchanged at every site.
   *
   * @param {object} obj     - Object with x, y, vx, vy (optionally spinRate, onTray).
   * @param {object} ep      - Non-null result of trayEndpoints().
   * @param {number} catchR  - Radius added to the catch-distance threshold.
   * @param {number} offsetR - Radius used for the landing offset off the blade.
   * @returns {boolean} True if the object was caught and pinned this call.
   */
  function tryCatchOnTray(obj, ep, catchR, offsetR) {
    const tdx = ep.tx - ep.hx, tdy = ep.ty - ep.hy;
    const lenSq = tdx * tdx + tdy * tdy;
    const t = lenSq < 1e-9 ? 0
      : Math.max(0, Math.min(1, ((obj.x - ep.hx) * tdx + (obj.y - ep.hy) * tdy) / lenSq));
    const cx = ep.hx + t * tdx, cy = ep.hy + t * tdy;
    if (Math.hypot(obj.x - cx, obj.y - cy) < TUNING.tray.thickness * 2 + catchR) {
      const off = TUNING.tray.thickness * 0.5 + offsetR;
      obj.x = cx + ep.upx * off;
      obj.y = cy + ep.upy * off;
      obj.vx = 0; obj.vy = 0;
      if (obj.spinRate !== undefined) obj.spinRate = 0;
      obj.onTray = true;
      obj.inHighlightSince = null;
      return true;
    }
    return false;
  }

  function updateTray() {
    const tray = state.tray;
    if (tray.phase === 'idle' || tray.phase === 'inserted') return;

    /* ── ARMED: wait for slot to cross 12 o'clock ─────────────────────── */
    if (tray.phase === 'armed') {
      if (Math.abs(state.omega) < 0.1) return;
      const past = state.omega >= 0
        ? state.drumAngle >= tray.triggerAtAngle
        : state.drumAngle <= tray.triggerAtAngle;
      if (past) {
        tray.phase            = 'inserting';
        // Fast sim speed makes the brake ramp overshoot final positioning —
        // force 1× the moment deployment actually begins.
        if (window.resetSimSpeed) window.resetSimSpeed();
        tray.insertStartAngle = state.drumAngle;
        tray.savedOmega       = state.omega;
        tray.progress         = 0;
        tray.brakeT0          = 0; // mark brake phase as not-yet-entered
        tray._savedOmegaDecay  = TUNING.drum.omegaDecay;
        TUNING.drum.omegaDecay = 0;

        // ── LOCK IN TRAY GEOMETRY ──────────────────────────────────────
        // Everything below is computed in the drum (y-up) frame.
        //
        // At fire-time the slot is at canvas-frame angle (slotAngle - drumAngle),
        // which equals -π/2 (top of screen). In the drum (y-up) frame that's +π/2.
        // We use that as our reference and work from there.
        const sCA_drum = -(tray.slotAngle - state.drumAngle);   // hinge angle, drum frame
        
        // Hinge position at fire-time, drum frame:
        const hx0 = CFG.R_DRUM * Math.cos(sCA_drum);
        const hy0 = CFG.R_DRUM * Math.sin(sCA_drum);
        
        // Lab-frame (drum-frame, y-up) direction the tray points at fire-time.
        // Aim toward the far side of the drum, leaning along the wall.
        // Easiest concrete choice: aim at (0, -R) — the bottom of the drum,
        // diametrically opposite the slot at fire-time. The tip will sweep a
        // chord that's roughly a diameter. Override with another point if you
        // want a different sweep.
        const aimX = +CFG.R_DRUM*0.4472;
        const aimY = +CFG.R_DRUM*0.2236;
        const ddx = aimX - hx0;
        const ddy = aimY - hy0;
        const L   = Math.hypot(ddx, ddy);
        const labDirX = ddx / L;
        const labDirY = ddy / L;

        // Store in the drum-rotating frame so the tray co-rotates with the rim.
        // Forward rotation by +drumAngle (drum-frame convention).
        const theta = -state.drumAngle;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        tray.trayDirX = labDirX * c - labDirY * s;
        tray.trayDirY = labDirX * s + labDirY * c;
        tray.trayLen  = L;
      }
      return;
    }

    /* ── INSERTING ───────────────────────────────────────────────────── */
    const swept   = Math.abs(state.drumAngle - tray.insertStartAngle);
    tray.progress = Math.min(1, swept / TUNING.tray.totalAngle);

    const ds = TUNING.tray.decelStart;     // 0.667 — start braking at 6 o'clock

    if (tray.progress < ds) {
      // ── Cruise phase: hold full speed, defy decay and slip lag ──
      state.omega       = tray.savedOmega;
      state.omegaTarget = tray.savedOmega;

    } else {
      // ── Brake phase: drive omega smoothly to zero on wall-clock time ──
      const now = performance.now() / 1000;

      // On first entry to brake phase, lock in start time, omega, and
      // a brake duration matched to remaining rotation.
      if (tray.brakeT0 === 0) {
        tray.brakeT0         = now;
        tray.brakeStartOmega = state.omega;
        const sign = tray.savedOmega >= 0 ? 1 : -1;
        const absOm = Math.max(0.01, Math.abs(state.omega));
        tray.brakeDur = 2 * (1 - ds) * TUNING.tray.totalAngle / absOm;
        void sign;
        // Disable omega control so it doesn't fight the brake
        if (window.setOmegaCtlMode) window.setOmegaCtlMode(0);
      }

      const u = Math.min(1, (now - tray.brakeT0) / tray.brakeDur);
      const ease = u * u * (3 - 2 * u);    // smoothstep
      state.omega       = tray.brakeStartOmega * (1 - ease);
      state.omegaTarget = state.omega;
    }

    if (tray.progress >= 1) {
      tray.phase        = 'inserted';
      state.omegaTarget = 0;
      state.omega       = 0;
      TUNING.drum.omegaDecay = tray._savedOmegaDecay != null
        ? tray._savedOmegaDecay
        : TUNING_DEFAULT.drum.omegaDecay;
      tray._savedOmegaDecay  = null;
    }
  }

  // ============================================================
  // EXPORTS
  // ============================================================

  window.initLevel             = initLevel;
  window.randn                 = randn;
  window.scheduleInjections    = scheduleInjections;
  window.startRelease          = startRelease;
  window.updateDrum            = updateDrum;
  window.step                  = step;
  window.eggLevitatedParticles = eggLevitatedParticles;
  window.aggImageIndex         = aggImageIndex;
  window.updateEgg             = updateEgg;
  window.updateGlobe           = updateGlobe;
  window.spawnGoldenBall       = spawnGoldenBall;
  window.updateAggregates      = updateAggregates;
  window.updateSolar           = updateSolar;
  window.computeAutoOmega      = computeAutoOmega;
  window.updateTray            = updateTray;
})();
