/**
 * @file physics.js
 * @description
 *   All simulation physics: level initialisation, drum rotation, particle
 *   stepping, aggregate formation, pebble (golden-ball) merging, globe
 *   (planet) merging, and heatmap accumulation.
 *
 * Exposes globals: initLevel, randn, scheduleInjections, startRelease,
 *                  updateDrum, step, eggLevitatedParticles, updateEgg,
 *                  updateGlobe, spawnGoldenBall, updateAggregates
 * Reads globals:   TUNING, TUNING_DEFAULT, CFG, LASER_OMEGA,
 *                  state, heatmap, aggregateImages,
 *                  soundTink, soundSnap, soundCrunch,
 *                  soundGoldenThud, soundGoldenChime,
 *                  GEO, X2px, angleSwept, visualSizeFactor,
 *                  updateHUD, resetExpertUI
 */
(() => {
  'use strict';

  // Derived from heatmap.resolution; mirrors the value in state.js
  const gridSize = heatmap.resolution * heatmap.resolution;

  // ============================================================
  // SECTION: LEVEL INIT
  // ============================================================
  /**
   * Resets all simulation state to zero and calls updateHUD.
   */
  function initLevel() {
    state.running = false;
    state.particles = [];
    state.toInject = [];
    state.t = 0;
    state.omega = 0;
    state.omegaTarget = 0;
    state.drumAngle = 0;
    state.puffs = [];
    state.lostCount = 0;
    state.eggHoldRevs = 0;
    state.eggBallCount = 0;
    state.eggMerging = null;
    state.goldenBalls = [];
    state.aggregates = [];
    state.aggHoldRevs = 0;
    state.aggCount = 0;
    state.aggMerging = null;

    // Reset Expert UI states via callback set by EXPERT ANALYSIS CONTROLLER
    if (window.resetExpertUI) window.resetExpertUI();

    updateHUD();
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
   */
  function scheduleInjections() {
    state.toInject = [];
    const N = CFG.N_P;
    const dist = state.distMode;
    const p = state.distParams;
  
    for (let i = 0; i < N; i++) {
      const t = (N === 1 || CFG.DT_INJECT === 0) ? 0 : (i / (N - 1)) * CFG.DT_INJECT;
      const x = CFG.RELEASE_X_MIN + Math.random() * (CFG.RELEASE_X_MAX - CFG.RELEASE_X_MIN);
      let vt;
  
      if (dist === 'bi') {
        const prob1 = p.bi.ratio / (1 + p.bi.ratio);
        if (Math.random() < prob1) {
          // Use v_t 1 and spread 1
          vt = p.bi.vt1 * (1 + p.bi.s1 * randn());
        } else {
          // Use v_t 2 and spread 2
          vt = p.bi.vt2 * (1 + p.bi.s2 * randn());
        }
      } 
      else if (dist === 'power') {
        // Powerlaw Inverse Transform Sampling: n(v) ~ v^q
        const q = p.power.index;
        const v0 = p.power.vtMin;
        const v1 = p.power.vtMax;
        const u = Math.random();
        
        if (Math.abs(q + 1) < 1e-6) { // Special case for q = -1 (log distribution)
          vt = v0 * Math.pow(v1 / v0, u);
        } else {
          vt = Math.pow(u * (Math.pow(v1, q + 1) - Math.pow(v0, q + 1)) + Math.pow(v0, q + 1), 1 / (q + 1));
        }
        // Spread slider is ignored for powerlaw as the law defines the spread
      } 
      else {
        // Default Gaussian behavior
        vt = CFG.V_T * (1 + CFG.VT_SPREAD * randn());
      }
  
      if (vt < TUNING.particle.settleFloor) vt = TUNING.particle.settleFloor;
      state.toInject.push({ t, x, vt });
    }
    state.toInject.sort((a, b) => a.t - b.t);
  }
 /**
   * Triggers a new particle injection while preserving persistent 
   * structures like pebbles (golden balls), globes, and aggregates.
   */
  function startRelease() {
    state.running = false;
    state.particles = [];
    state.toInject = [];
    state.puffs = [];
    
    // 1. Reset simulation clock
    state.t = 0;
    state.lostCount = 0;
  
    // 2. RE-SYNC PERSISTENT OBJECTS TO THE NEW TIMELINE
    state.goldenBalls.forEach(b => {
      b.bornAt = 0; 
    });
    
    state.aggregates.forEach(agg => {
      // RESET LEVITATION TRACKING: Force them to earn levitation in the new run
      agg.inHighlightSince = null; 
      // Reset any time-dependent aggregate flashes
      agg.orbitFlashEndsAt = 0; 
    });
  
    state.globes.forEach(g => {
      g.bornAt = 0;
    });
  
    // 3. SCHEDULE AND START
    scheduleInjections();
    state.running = true;
  }

  // ============================================================
  // SECTION: PHYSICS — DRUM
  // ============================================================
  /**
   * Advances drum angle, decays omega toward omegaTarget, and steps the laser angle.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateDrum(dt) {
    state.omegaTarget *= Math.exp(-TUNING.drum.omegaDecay * dt);
    const a = 1 - Math.exp(-TUNING.drum.slipRate * dt);
    state.omega += (state.omegaTarget - state.omega) * a;
    if (Math.abs(state.omega) < 1e-4 && Math.abs(state.omegaTarget) < 1e-4) {
      state.omega = 0; state.omegaTarget = 0;
    }
    state.drumAngle += state.omega * dt;
    state.laserAngle += LASER_OMEGA * dt;
  }

  // ============================================================
  // SECTION: PHYSICS — PARTICLES
  // ============================================================
  /**
   * Advances all particle positions, handles wall collisions, highlight tracking, and heatmap accumulation.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function step(dt) {
    while (state.toInject.length && state.toInject[0].t <= state.t) {
      const inj = state.toInject.shift();
      state.particles.push({
        x: inj.x, y: CFG.RELEASE_Y,
        vx: 0, vy: 0, stuck: false, stuckAngle: 0, alive: true,
        inHighlightSince: null, flashEndsAt: -1, insideOnce: false,
        vt: inj.vt,
        imgIdx: Math.floor(Math.random() * aggregateImages.length),
        ghostlife: 0 /*FIXME: Is this really necessary*/
      });
      spawnPuffAtNozzle(inj.x);
    }
    const omega = state.omega;
    const HX = TUNING.highlight.cx;
    const HY = TUNING.highlight.cy;
    const HR2 = TUNING.highlight.radius * TUNING.highlight.radius;
    const laser1 = state.laserAngle;
    const laser0 = laser1 - LASER_OMEGA * dt;

    for (const p of state.particles) {
      if (!p.alive) continue;

      // --- GHOST PATH DECAY ---
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
        p.stuckAngle += omega * dt;
        p.x = CFG.R_DRUM * Math.cos(p.stuckAngle);
        p.y = CFG.R_DRUM * Math.sin(p.stuckAngle);
        p.inHighlightSince = null;
        if (state.t - p.stuckAt >= 5) p.alive = false;
      } else {
        if (p.insideOnce) {
          const vxg = -omega * p.y;
          const vyg =  omega * p.x;
          p.vx = vxg;
          p.vy = vyg - p.vt;
        } else {
          p.vx = 0;
          p.vy = -p.vt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const r2 = p.x * p.x + p.y * p.y;
        const Rwall = CFG.R_DRUM - TUNING.particle.collisionR;
        const wasInside = p.insideOnce;
        if (!p.insideOnce && r2 <= CFG.R_DRUM * CFG.R_DRUM) p.insideOnce = true;

        const prevR2 = p.prevR2 === undefined ? (CFG.R_DRUM + 1) * (CFG.R_DRUM + 1) : p.prevR2;
        if (wasInside && prevR2 < Rwall * Rwall && r2 >= Rwall * Rwall) {
          if (!TUNING.particle.invincible) {
            const ang = Math.atan2(p.y, p.x);
            p.stuck = true;
            p.stuckAngle = ang;
            p.stuckAt = state.t;
            p.x = Rwall * Math.cos(ang);
            p.y = Rwall * Math.sin(ang);
            p.inHighlightSince = null;
            state.lostCount++;
            soundTink();
          }
        } else if (p.insideOnce) {
          const dxh = p.x - HX, dyh = p.y - HY;
          const inside = (dxh * dxh + dyh * dyh) <= HR2;
          if (inside) {
            if (p.inHighlightSince === null) p.inHighlightSince = state.t;
          } else {
            p.inHighlightSince = null;
          }
        }

        if (TUNING.particle.invincible && p.insideOnce && !p.stuck && r2 >= Rwall * Rwall) {
          const rr = Math.sqrt(r2);
          p.x = (p.x / rr) * Rwall * 0.999;
          p.y = (p.y / rr) * Rwall * 0.999;
          p.prevR2 = p.x * p.x + p.y * p.y;
        } else {
          p.prevR2 = r2;
        }

        if (p.y < -CFG.R_DRUM * 1.5) p.alive = false;
        if (p.insideOnce && !p.stuck && r2 > (CFG.R_DRUM * 1.05) * (CFG.R_DRUM * 1.05) && !TUNING.particle.invincible) {
          state.lostCount++;
          p.alive = false;
        }

      }

      if (state.laserOn && !p.stuck && p.insideOnce) {
        const pa = Math.atan2(p.y, p.x);
        if (angleSwept(laser0, laser1, pa)) {
          const flashDur = 0.40 * (state.laserOn ? TUNING.lidar.flashDurMul : 1);
          p.flashEndsAt = state.t + flashDur;
        }
      }
    }

    if (state.puffs.length) {
      state.puffs = state.puffs.filter(pf => (state.t - pf.bornAt) < pf.life);
    }
    if (state.particles.length > 0) {
      let anyDead = false;
      for (let i = 0; i < state.particles.length; i++) {
        if (!state.particles[i].alive) { anyDead = true; break; }
      }
      if (anyDead) state.particles = state.particles.filter(p => p.alive);
    }

    state.t += dt;

    if (heatmap.enabled) {
      const res = heatmap.resolution;
      heatmap.tickCount++;

      for (const p of state.particles) {
        if (!p.alive || p.stuck) continue;
        if (p.x * p.x + p.y * p.y <= CFG.R_DRUM * CFG.R_DRUM) {
          const gx = Math.floor(((p.x + 100) / 200) * res);
          const gy = Math.floor(((p.y + 100) / 200) * res);
          if (gx >= 0 && gx < res && gy >= 0 && gy < res) {
            const idx = gy * res + gx;
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            heatmap.accN[idx]++;
            heatmap.accV[idx] += speed;
            heatmap.accV2[idx] += speed * speed;
          }
        }
      }

      const diff = Math.abs(state.omega * dt);
      heatmap.angleProgress += diff;

      if (heatmap.angleProgress >= 2 * Math.PI) {
        let curMaxSigma = 0, curMaxDensity = 0, curMaxProduct = 0;
        const totalTicks = Math.max(1, heatmap.tickCount);

        for (let i = 0; i < gridSize; i++) {
          if (heatmap.accN[i] > 2) {
            const n = heatmap.accN[i];
            const mean = heatmap.accV[i] / n;
            const meanSq = heatmap.accV2[i] / n;
            const variance = Math.max(0, meanSq - mean * mean);

            // DIVISION BY ACCUMULATED TIME:
            // density = average particles per frame in this cell
            const density = n / totalTicks;
            const sigma = Math.sqrt(variance);

            heatmap.data[i] = sigma;
            heatmap.densData[i] = density;
            heatmap.prodData[i] = density * variance;

            if (sigma > curMaxSigma) curMaxSigma = sigma;
            if (density > curMaxDensity) curMaxDensity = density;
            if ((density * variance) > curMaxProduct) curMaxProduct = density * variance;
          } else {
            heatmap.data[i] = 0;
            heatmap.densData[i] = 0;
            heatmap.prodData[i] = 0;
          }
        }
        heatmap.maxSigma = curMaxSigma;
        heatmap.maxDensity = curMaxDensity;
        heatmap.maxProduct = curMaxProduct;
        heatmap.ready = true;
        heatmap.angleProgress = 0;
        heatmap.tickCount = 0;
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
   * Returns the array of particles that have completed at least one full orbit in the highlight zone.
   *
   * @returns {object[]} Array of levitated particle objects.
   */
  function eggLevitatedParticles() {
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    if (!isFinite(T)) return [];
    const out = [];
    for (const p of state.particles) {
      if (!p.alive || p.stuck || p.merging) continue;
      if (p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= T) {
        out.push(p);
      }
    }
    return out;
  }

  /**
   * Returns the array of aggregates that have completed at least one full orbit in the highlight zone.
   *
   * @returns {object[]} Array of levitated aggregate objects.
   */
  function eggLevitatedAggregates() {
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    if (!isFinite(T)) return [];
    const out = [];
    for (const agg of state.aggregates) {
      if (!agg.alive || agg.stuck || agg.merging) continue;
      if (agg.inHighlightSince !== null && (state.t - agg.inHighlightSince) >= T) {
        out.push(agg);
      }
    }
    return out;
  }

  /**
   * Integrates golden balls, resolves collisions, and manages pebble merge sequencing.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateEgg(dt) {
    for (const b of state.goldenBalls) integrateGoldenBall(b, dt);
    if (state.goldenBalls.length > 1) resolveBallBallCollisions();
    for (const b of state.goldenBalls) resolveWallCollision(b);

    // Only block if a PEBBLE is currently merging
    if (state.eggMerging) {
      const m = state.eggMerging;
      const u = (state.t - m.startedAt) / m.dur;
      if (u >= 1) {
        for (const p of m.particles) p.alive = false;
        spawnGoldenBall(m.target.x, m.target.y);
        state.aggCount -= TUNING.egg.nCrit;
        state.eggMerging = null;
        state.eggBallCount++;
      }
      return;
    }

    if (state.eggBallCount >= TUNING.egg.maxBalls) return;

    const target = (state.eggBallCount === 0)
      ? TUNING.egg.holdTarget
      : TUNING.egg.holdSubseq;

    const lev = eggLevitatedAggregates();
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);

    if (lev.length >= TUNING.egg.nCrit && isFinite(T) && CFG.VT_SPREAD >= TUNING.egg.minSpread) {
      state.eggHoldRevs += dt / T;
      if (state.eggHoldRevs >= target) {
        startMerge(lev);
        state.eggHoldRevs = 0;
      }
    } else {
      state.eggHoldRevs = 0;
    }
  }

  // ============================================================
  // SECTION: PHYSICS — GLOBES (PLANETS)
  // ============================================================
  /**
   * Applies hover/repulsion forces to globes and manages globe merge sequencing.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateGlobe(dt) {
    const R_GLOBE = TUNING.globe.radius;
    const MIN_DIST = R_GLOBE * 2.2;

    // 1. Physics for existing globes (Attraction + Repulsion)
    for (let i = 0; i < state.globes.length; i++) {
      const g = state.globes[i];
      const ax = (0 - g.x) * 0.01;
      const ay = (TUNING.globe.hoverY - g.y) * 0.01;
      g.vx = (g.vx + ax) * 0.85;
      g.vy = (g.vy + ay) * 0.85;

      for (let j = 0; j < state.globes.length; j++) {
        if (i === j) continue;
        const other = state.globes[j];
        const dx = g.x - other.x;
        const dy = g.y - other.y;
        const dist = Math.hypot(dx, dy);
        const distSq = dx * dx + dy * dy + 10;
        let force = TUNING.globe.repulsion / distSq;
        if (dist < MIN_DIST) force += (MIN_DIST - dist) * 50;
        const angle = Math.atan2(dy, dx);
        g.vx += Math.cos(angle) * force * dt;
        g.vy += Math.sin(angle) * force * dt;
      }
      g.x += g.vx;
      g.y += g.vy;
      g.spin += TUNING.globe.rotationSpeed * dt;
    }

    // 2. Start merge ONLY IF below the limit of 7
    if (!state.globeMerging && state.goldenBalls.length >= TUNING.globe.nCrit && state.globes.length < TUNING.globe.limit) {
      const chosen = state.goldenBalls.slice(0, TUNING.globe.nCrit);
      const avgX = (chosen[0].x + chosen[1].x) / 2;
      const avgY = (chosen[0].y + chosen[1].y) / 2;

      for (const b of chosen) {
        b.merging = true;
        b.mergeStart = { x: b.x, y: b.y };
      }

      state.globeMerging = {
        pebbles: chosen,
        startedAt: state.t,
        dur: TUNING.globe.mergeDur,
        target: { x: avgX, y: avgY }
      };
    }

    // 3. Handle merge completion
    if (state.globeMerging) {
      const m = state.globeMerging;
      const u = (state.t - m.startedAt) / m.dur;
      const ease = u * u * (3 - 2 * u);
      for (const b of m.pebbles) {
        b.x = b.mergeStart.x + (m.target.x - b.mergeStart.x) * ease;
        b.y = b.mergeStart.y + (m.target.y - b.mergeStart.y) * ease;
      }

      if (u >= 1) {
        state.goldenBalls = state.goldenBalls.filter(b => !m.pebbles.includes(b));
        state.globes.push({
          x: m.target.x, y: m.target.y, vx: 0, vy: 0,
          r: TUNING.globe.radius,
          spin: 0, bornAt: state.t,
          mapIdx: state.globes.length
        });
        state.globeMerging = null;
      }
    }
  }

  // ============================================================
  // SECTION: PHYSICS — GOLDEN BALLS
  // ============================================================
  /**
   * Integrates one golden ball's position, applies wall drag, and updates spin rate.
   *
   * @param {object} b  - The golden ball object to integrate.
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function integrateGoldenBall(b, dt) {
    b.vy -= TUNING.ball.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const r = Math.hypot(b.x, b.y);
    const rMax = CFG.R_DRUM - b.r;
    const contactMargin = 1.0;
    if (r > rMax - contactMargin && r > 1e-6) {
      const wallVx = -state.omega * b.y;
      const wallVy =  state.omega * b.x;
      const nx = b.x / r, ny = b.y / r;
      const wallVn = wallVx * nx + wallVy * ny;
      const wTanX = wallVx - wallVn * nx;
      const wTanY = wallVy - wallVn * ny;
      const k = 1 - Math.exp(-TUNING.ball.contactDrag * dt);
      const vn = b.vx * nx + b.vy * ny;
      const vtx = b.vx - vn * nx;
      const vty = b.vy - vn * ny;
      const newVtx = vtx + (wTanX - vtx) * k;
      const newVty = vty + (wTanY - vty) * k;
      b.vx = newVtx + vn * nx;
      b.vy = newVty + vn * ny;
      const tx = -ny, ty = nx;
      const vtAlongTan = newVtx * tx + newVty * ty;
      b.spinRate = -vtAlongTan / b.r;
    } else {
      b.spinRate *= Math.pow(0.95, dt * 60);
    }
    b.spin += b.spinRate * dt;
  }

  /**
   * Resolves a golden ball against the drum wall and the rotating bump.
   *
   * @param {object} b - The golden ball object to resolve.
   */
  function resolveWallCollision(b) {
    // --- BUMP COLLISION ---
    const bumpAngle = -state.drumAngle;
    const bumpR = 3.5;
    const bumpX = CFG.R_DRUM * Math.cos(bumpAngle);
    const bumpY = CFG.R_DRUM * Math.sin(bumpAngle);

    const dx = b.x - bumpX;
    const dy = b.y - bumpY;
    const dist = Math.hypot(dx, dy);
    const minDist = b.r + bumpR;

    if (dist < minDist && dist > 1e-6) {
      const nx = dx / dist, ny = dy / dist;
      const overlap = minDist - dist;
      b.x += nx * overlap;
      b.y += ny * overlap;

      const vBumpX = -state.omega * bumpY;
      const vBumpY =  state.omega * bumpX;
      const vRelX = b.vx - vBumpX;
      const vRelY = b.vy - vBumpY;
      const vn = vRelX * nx + vRelY * ny;

      if (vn < 0) {
        const e = TUNING.ball.wallE;
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
        if (Math.abs(vn) > 10) soundGoldenThud(Math.abs(vn));
      }
    }

    // --- WALL COLLISION ---
    const r = Math.hypot(b.x, b.y);
    const rMax = CFG.R_DRUM - b.r;
    if (r <= rMax) {
      const sv = TUNING.ball.settleVel;
      if (Math.abs(b.vx) < sv && Math.abs(b.vy) < sv && r > rMax - 0.5) {
        b.vx *= 0.85; b.vy *= 0.85;
      }
      return;
    }
    if (r < 1e-6) return;
    const nxWall = b.x / r, nyWall = b.y / r;
    b.x = nxWall * rMax;
    b.y = nyWall * rMax;
    const vnWall = b.vx * nxWall + b.vy * nyWall;
    const vtxWall = b.vx - vnWall * nxWall;
    const vtyWall = b.vy - vnWall * nyWall;
    const eWall = TUNING.ball.wallE;
    const frictionWall = TUNING.ball.wallFriction;
    const newVnWall = -vnWall * eWall;
    b.vx = vtxWall * frictionWall + newVnWall * nxWall;
    b.vy = vtyWall * frictionWall + newVnWall * nyWall;
    const speed = Math.abs(vnWall);
    if (speed > 30) soundGoldenThud(speed);
  }

  /**
   * Resolves all pairwise golden-ball collisions with coefficient of restitution.
   */
  function resolveBallBallCollisions() {
    const balls = state.goldenBalls;
    const n = balls.length;
    const e = TUNING.ball.ballE;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = balls[i], B = balls[j];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d2 = dx * dx + dy * dy;
        const minD = A.r + B.r;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2);
        let nx, ny;
        if (d < 1e-6) { nx = 1; ny = 0; }
        else { nx = dx / d; ny = dy / d; }
        const overlap = minD - d;
        const half = overlap * 0.5;
        A.x -= nx * half; A.y -= ny * half;
        B.x += nx * half; B.y += ny * half;
        const vAn = A.vx * nx + A.vy * ny;
        const vBn = B.vx * nx + B.vy * ny;
        const vRel = vAn - vBn;
        if (vRel <= 0) continue;
        const impulse = (1 + e) * vRel * 0.5;
        A.vx -= impulse * nx;
        A.vy -= impulse * ny;
        B.vx += impulse * nx;
        B.vy += impulse * ny;
        if (vRel > 30) soundGoldenThud(vRel * 0.6);
      }
    }
  }

  /**
   * Adds a new golden ball to state and plays the crunch sound.
   *
   * @param {number} x - Initial x position in centimetres.
   * @param {number} y - Initial y position in centimetres.
   */
  function spawnGoldenBall(x, y) {
    state.goldenBalls.push({
      x, y,
      vx: 0, vy: 0,
      r: TUNING.ball.radius,
      spin: 0,
      spinRate: 0,
      bornAt: state.t,
    });
    soundCrunch();
  }

  /**
   * Picks aggregate targets and initiates an egg-merge animation.
   *
   * @param {object[]} levList - Array of currently levitated aggregate objects to merge from.
   */
  function startMerge(levList) {
    const N = TUNING.egg.nCrit;
    const pool = levList.slice();
    for (let i = 0; i < N && i < pool.length; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const chosen = pool.slice(0, Math.min(N, pool.length));
    if (chosen.length === 0) return;

    let target;
    if (levList.length <= 3) {
      let cx = 0, cy = 0;
      for (const p of levList) { cx += p.x; cy += p.y; }
      target = { x: cx / levList.length, y: cy / levList.length };
    } else {
      const K = 3;
      let bestIdx = 0;
      let bestKth = Infinity;
      for (let i = 0; i < levList.length; i++) {
        const a = levList[i];
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
      p.merging = true;
      p.mergeStart = { x: p.x, y: p.y };
    }
    state.eggMerging = {
      particles: chosen,
      target,
      startedAt: state.t,
      dur: TUNING.egg.mergeDur,
    };
  }

  // ============================================================
  // SECTION: PHYSICS — AGGREGATES
  // ============================================================
  /**
   * Manages aggregate orbit physics, wall collisions, and merge sequencing.
   *
   * @param {number} dt - Elapsed time in seconds since the last frame.
   */
  function updateAggregates(dt) {
    if (state.aggMerging) {
      const m = state.aggMerging;
      const u = (state.t - m.startedAt) / m.dur;
      if (u >= 1) {
        for (const p of m.particles) p.alive = false;
        spawnAggregate(m.target.x, m.target.y, m.meanVt, m.sizeFac, m.targetImgIdx);
        state.aggMerging = null;
        state.aggCount++;
      }
    }

    /* FIXME: Is this still working?  */
    if (!state.aggMerging) {
      const lev = eggLevitatedParticles();
      const absOm = Math.abs(state.omega);
      const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);

      if (lev.length >= TUNING.aggregate.minLevitated && isFinite(T) && CFG.VT_SPREAD >= TUNING.aggregate.minSpread) {
        state.aggHoldRevs += dt / T;
        const target = state.aggCount === 0 ? TUNING.aggregate.initialHoldRevs : TUNING.aggregate.subseqHoldRevs;
        if (state.aggHoldRevs >= target) {
          const pool = [];
          for (const p of state.particles) {
            if (p.alive && !p.stuck && !p.merging && p.inHighlightSince !== null) {
              pool.push(p);
            }
          }
          if (pool.length >= TUNING.aggregate.mergeCount) {
            startAggregateMerge(lev, pool);
          }
          state.aggHoldRevs = 0;
        }
      } else {
        state.aggHoldRevs = 0;
      }
    }

    const HX = TUNING.highlight.cx;
    const HY = TUNING.highlight.cy;
    const HR2 = TUNING.highlight.radius * TUNING.highlight.radius;

    for (const agg of state.aggregates) {
      if (agg.merging) continue;
      if (agg.stuck) continue;

      agg.vx = -state.omega * agg.y;
      agg.vy = state.omega * agg.x - agg.vt;
      agg.x += agg.vx * dt;
      agg.y += agg.vy * dt;
      agg.rot += agg.rotSpeed * dt;

      const r2 = agg.x * agg.x + agg.y * agg.y;
      const Rwall = CFG.R_DRUM - agg.r;

      if (r2 >= Rwall * Rwall) {
        agg.alive = false;
        const baseAngle = Math.atan2(agg.y, agg.x);
        const pRwall = CFG.R_DRUM - TUNING.particle.collisionR;
        state.aggCount--;

        for (let i = 0; i < 10; i++) {
          const spread = (Math.random() - 0.5) * (agg.r / CFG.R_DRUM) * 2.5;
          const pAngle = baseAngle + spread;
          state.particles.push({
            x: pRwall * Math.cos(pAngle),
            y: pRwall * Math.sin(pAngle),
            vx: 0, vy: 0,
            vt: agg.vt,
            stuck: true,
            stuckAngle: pAngle,
            stuckAt: state.t,
            alive: true,
            inHighlightSince: null,
            flashEndsAt: -1,
            insideOnce: true,
            imgIdx: Math.floor(Math.random() * aggregateImages.length)
          });
          state.lostCount++;
        }
        soundTink();
        soundTink();
        soundTink();
      } else {
        const dxh = agg.x - HX, dyh = agg.y - HY;
        if (dxh * dxh + dyh * dyh <= HR2) {
          if (agg.inHighlightSince === null) agg.inHighlightSince = state.t;
        } else {
          agg.inHighlightSince = null;
        }
      }
      if (agg.y < -CFG.R_DRUM * 1.5) agg.alive = false;
    }

    if (state.aggregates.length > 0) {
      state.aggregates = state.aggregates.filter(a => a.alive);
    }
  }

  /**
   * Chooses a merge centre and kicks off an aggregate merge animation.
   *
   * @param {object[]} levList - Array of currently levitated particles used to pick the centre.
   * @param {object[]} pool    - Full pool of eligible particles to select merging candidates from.
   */
  function startAggregateMerge(levList, pool) {
    const centerIdx = Math.floor(Math.random() * levList.length);
    const centerP = levList[centerIdx];

    const dists = pool.map(p => {
      const dx = p.x - centerP.x;
      const dy = p.y - centerP.y;
      return { p, d2: dx * dx + dy * dy };
    });
    dists.sort((a, b) => a.d2 - b.d2);

    const chosen = dists.slice(0, TUNING.aggregate.mergeCount).map(item => item.p);
    let cx = 0, cy = 0, sumVt = 0, sumSizeFac = 0;

    const targetImgIdx = Math.floor(Math.random() * aggregateImages.length);

    for (const p of chosen) {
      p.merging = true;
      p.mergeStart = { x: p.x, y: p.y };
      cx += p.x; cy += p.y;
      sumVt += p.vt;
      sumSizeFac += visualSizeFactor(p.vt);
    }

    state.aggMerging = {
      particles: chosen,
      target: { x: cx / chosen.length, y: cy / chosen.length },
      meanVt: sumVt / chosen.length * TUNING.aggregate.vtFactor,
      sizeFac: sumSizeFac / chosen.length,
      startedAt: state.t,
      dur: TUNING.aggregate.mergeDur,
      targetImgIdx: targetImgIdx
    };
  }

  /**
   * Adds a new aggregate to state and plays the snap sound.
   *
   * @param {number} x            - Initial x position in centimetres.
   * @param {number} y            - Initial y position in centimetres.
   * @param {number} vt           - Terminal velocity of the aggregate in cm/s.
   * @param {number} sizeFac      - Visual size scaling factor relative to a single particle.
   * @param {number} presetImgIdx - Image index to use; if undefined a random one is chosen.
   */
  function spawnAggregate(x, y, vt, sizeFac, presetImgIdx) {
    const baseR = TUNING.particle.collisionR * sizeFac * TUNING.aggregate.sizeMult;
    const speedMag = Math.abs(state.omega) * (1 + Math.random() * 2);
    const dir = Math.random() < 0.5 ? 1 : -1;

    const finalImgIdx = presetImgIdx !== undefined ? presetImgIdx : Math.floor(Math.random() * aggregateImages.length);

    state.aggregates.push({
      x, y, vt,
      vx: 0, vy: 0,
      r: baseR,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: speedMag * dir,
      stuck: false,
      alive: true,
      inHighlightSince: null,
      merging: false,
      imgIdx: finalImgIdx,
      orbitFlashEndsAt: state.t + 2.0
    });
    soundSnap();
  }

  window.initLevel           = initLevel;
  window.randn               = randn;
  window.scheduleInjections  = scheduleInjections;
  window.startRelease        = startRelease;
  window.updateDrum          = updateDrum;
  window.step                = step;
  window.eggLevitatedParticles = eggLevitatedParticles;
  window.updateEgg           = updateEgg;
  window.updateGlobe         = updateGlobe;
  window.spawnGoldenBall     = spawnGoldenBall;
  window.updateAggregates    = updateAggregates;
})();
