/**
 * @file timeline.js
 * @description
 *   Rolling snapshot buffer (one per 10 wall-clock seconds, max 20 snapshots),
 *   pause / resume / scrub, and branch-point restoration.
 *
 *   Pausing freezes the simulation and reveals a timeline scrubber drawn on
 *   the overlay canvas. Tapping a dot or pressing ← / → steps through history.
 *   Pressing Space (or the pause button) resumes from the current position,
 *   discarding any "future" snapshots and branching the simulation forward.
 *
 *   Memory is managed dynamically: each snapshot is measured by JSON proxy
 *   size and the oldest snapshots are discarded when the rolling total exceeds
 *   MAX_BYTES. This means fewer snapshots are kept at high particle counts,
 *   but in practice counts drop quickly due to wall losses and aggregate
 *   formation, so the full 20-snapshot history is available in most sessions.
 *
 * Exposes globals: TIMELINE, togglePause, takeSnapshot, drawTimeline,
 *                  resetTimeline, handleTimelineClick
 * Reads globals:   state, CFG, AUDIO, CX, CY, W, SCALE, REGIME,
 *                  ctxOv, pxDist, updateGauge
 */
(() => {
  'use strict';

  const MAX_SNAPS     = 20;          // hard cap on snapshot count
  const SNAP_INTERVAL = 10;          // wall-clock seconds between automatic snapshots
  const MAX_BYTES     = 20_000_000;  // ~20 MB proxy budget (JSON char count × 2)

  // ── MODULE STATE ──────────────────────────────────────────────────────────
  const TIMELINE = {
    snapshots:     [],      // [{wallT, simT, omega, particles, …}, …] oldest→newest
    lastSnapWallT: -Infinity,
    cursorIdx:     0,       // 0 .. snapshots.length  (.length = "NOW")
    frozenSnap:    null,    // full state captured at the moment of pause
    _dotPositions: [],      // cached {x, y, idx} for pointer hit-testing
  };

  // ── CAPTURE ───────────────────────────────────────────────────────────────
  function _capture() {
    const gaugeAgg    = document.getElementById('gaugeAgg');
    const gaugePebble = document.getElementById('gaugePebble');
    const shallow     = obj => Object.assign({}, obj);
    const cleanPart   = p   => {
      const c = Object.assign({}, p);
      delete c.trail;
      delete c.isDiagnosticTarget;
      return c;
    };

    return {
      wallT:            performance.now() / 1000,
      simT:             state.t,
      omega:            state.omega,
      omegaTarget:      state.omegaTarget,
      drumAngle:        state.drumAngle,
      laserAngle:       state.laserAngle,
      lostCount:        state.lostCount,
      aggCount:         state.aggCount,
      eggBallCount:     state.eggBallCount,
      aggHoldRevs:      state.aggHoldRevs,
      eggHoldRevs:      state.eggHoldRevs,
      pebbleBannerUsed: state.pebbleBannerUsed,
      running:          state.running,
      renderN:          state.renderN || CFG.N_P,

      particles:   state.particles.map(cleanPart),
      aggregates:  state.aggregates.map(shallow),
      goldenBalls: state.goldenBalls.map(shallow),
      globes:      state.globes.map(shallow),
      toInject:    state.toInject.map(shallow),
      puffs:       [],   // intentionally cleared on restore

      solar: JSON.parse(JSON.stringify(state.solar)),
      tray:  shallow(state.tray),

      gaugeAggVisible:    !!(gaugeAgg    && gaugeAgg.style.display    !== 'none'),
      gaugePebbleVisible: !!(gaugePebble && gaugePebble.style.display !== 'none'),
    };
  }

  // ── RESTORE ───────────────────────────────────────────────────────────────
  function _restore(snap) {
    // Scalar fields
    state.t              = snap.simT;
    state.omega          = snap.omega;
    state.omegaTarget    = snap.omegaTarget;
    state.drumAngle      = snap.drumAngle;
    state.laserAngle     = snap.laserAngle;
    state.lostCount      = snap.lostCount;
    state.aggCount       = snap.aggCount;
    state.eggBallCount   = snap.eggBallCount;
    state.aggHoldRevs    = snap.aggHoldRevs;
    state.eggHoldRevs    = snap.eggHoldRevs;
    state.pebbleBannerUsed = snap.pebbleBannerUsed;
    state.running        = snap.running;
    state.renderN        = snap.renderN;
    state.puffs          = [];

    // Null out all in-progress merge animations.
    // Constituent objects have merging=false restored below so they don't
    // remain invisible or skipped by the physics loops.
    state.aggMerging     = null;
    state.eggMerging     = null;
    state.globeMerging   = null;
    state.aggGrowMerging = null;

    const cleanObj = src => {
      const c = Object.assign({}, src);
      c.merging = false;
      delete c.mergeStart;
      return c;
    };

    state.particles   = snap.particles.map(cleanObj);
    state.aggregates  = snap.aggregates.map(cleanObj);
    state.goldenBalls = snap.goldenBalls.map(cleanObj);
    state.globes      = snap.globes.map(g => Object.assign({}, g));
    state.toInject    = snap.toInject.map(i => Object.assign({}, i));

    // Solar system — deep copy and re-anchor to current wall time so the
    // phase machine doesn't see a time-jump on the first frame after restore.
    state.solar        = JSON.parse(JSON.stringify(snap.solar));
    state.solar._lastT = performance.now() / 1000;

    Object.assign(state.tray, snap.tray);

    // Gauge visibility
    const ga = document.getElementById('gaugeAgg');
    const gp = document.getElementById('gaugePebble');
    if (ga) ga.style.display = snap.gaugeAggVisible    ? 'flex' : 'none';
    if (gp) gp.style.display = snap.gaugePebbleVisible ? 'flex' : 'none';

    if (window.updateGauge) window.updateGauge();
  }

  // ── NAVIGATION ────────────────────────────────────────────────────────────
  function _navigateTo(idx) {
    const n = TIMELINE.snapshots.length;
    TIMELINE.cursorIdx = Math.max(0, Math.min(n, idx));
    if (TIMELINE.cursorIdx < n) {
      _restore(TIMELINE.snapshots[TIMELINE.cursorIdx]);
    } else if (TIMELINE.frozenSnap) {
      _restore(TIMELINE.frozenSnap);   // return to "NOW"
    }
  }

  // ── PUBLIC: SNAPSHOT RECORDING ───────────────────────────────────────────
  /**
   * Called every frame from main.js; records at most once per SNAP_INTERVAL
   * wall-clock seconds. No-ops while paused or the simulation is not running.
   * Snapshot size is measured as a JSON proxy and the oldest snapshots are
   * discarded when the rolling total exceeds MAX_BYTES.
   */
  function takeSnapshot() {
    if (!state.running || state.paused) return;
    const now = performance.now() / 1000;
    if (now - TIMELINE.lastSnapWallT < SNAP_INTERVAL) return;
    TIMELINE.lastSnapWallT = now;

    const snap     = _capture();
    const snapSize = JSON.stringify(snap).length * 2; // bytes proxy
    snap._bytes    = snapSize;

    TIMELINE.snapshots.push(snap);

    // Enforce count cap first.
    if (TIMELINE.snapshots.length > MAX_SNAPS) TIMELINE.snapshots.shift();

    // Then enforce memory budget: drop oldest until we fit.
    let total = TIMELINE.snapshots.reduce((s, sn) => s + (sn._bytes || 0), 0);
    while (total > MAX_BYTES && TIMELINE.snapshots.length > 1) {
      total -= TIMELINE.snapshots[0]._bytes || 0;
      TIMELINE.snapshots.shift();
    }
  }

  // ── PUBLIC: PAUSE / RESUME ────────────────────────────────────────────────
  function togglePause() {
    const btn = document.getElementById('btnPause');

    if (!state.paused) {
      // ── PAUSE ────────────────────────────────────────────────────────────
      state.paused        = true;
      TIMELINE.frozenSnap = _capture();
      TIMELINE.cursorIdx  = TIMELINE.snapshots.length; // start cursor at "NOW"

      // Silence motor hum immediately
      if (AUDIO.ctx && AUDIO.motor.started) {
        const t = AUDIO.ctx.currentTime;
        AUDIO.motor.gainOsc.gain.cancelScheduledValues(t);
        AUDIO.motor.gainOsc.gain.setValueAtTime(0, t);
        AUDIO.motor.gainNoise.gain.cancelScheduledValues(t);
        AUDIO.motor.gainNoise.gain.setValueAtTime(0, t);
      }

      if (btn) btn.classList.add('on');

    } else {
      // ── RESUME ───────────────────────────────────────────────────────────
      const cur = TIMELINE.cursorIdx;
      const n   = TIMELINE.snapshots.length;

      if (cur < n) {
        // Branching from a historical point.
        // State is already restored to snapshots[cur] (done during navigation).
        // Keep history up to and including the branch point; discard the future.
        TIMELINE.snapshots = TIMELINE.snapshots.slice(0, cur + 1);
        // Re-normalise wallT so the branch point reads as "just now" and
        // older snapshots retain their correct relative spacing.
        const now   = performance.now() / 1000;
        const delta = now - TIMELINE.snapshots[cur].wallT;
        for (const snap of TIMELINE.snapshots) snap.wallT += delta;
        TIMELINE.lastSnapWallT = now;
      }
      // If cur === n we are at "NOW"; live state is already the frozen snap.

      TIMELINE.frozenSnap = null;
      state.paused        = false;

      if (btn) btn.classList.remove('on');
    }
  }

  // ── PUBLIC: RESET (called by btnReset in ui.js) ──────────────────────────
  function resetTimeline() {
    if (state.paused) togglePause();   // unpause first
    TIMELINE.snapshots     = [];
    TIMELINE.lastSnapWallT = -Infinity;
    TIMELINE.frozenSnap    = null;
    TIMELINE.cursorIdx     = 0;
    TIMELINE._dotPositions = [];
  }

  // ── PUBLIC: POINTER HANDLER (routed from ui.js onDown while paused) ──────
  function handleTimelineClick(clientX, clientY) {
    if (!TIMELINE._dotPositions.length) return;
    const cvEl = document.getElementById('cv');
    if (!cvEl) return;
    const rect = cvEl.getBoundingClientRect();
    const px   = clientX - rect.left;
    const py   = clientY - rect.top;
    const HIT2 = 22 * 22;  // generous 22 px touch radius
    for (const dot of TIMELINE._dotPositions) {
      const dx = px - dot.x, dy = py - dot.y;
      if (dx * dx + dy * dy < HIT2) { _navigateTo(dot.idx); return; }
    }
  }

  // ── DRAWING ───────────────────────────────────────────────────────────────
  function _rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.arcTo(x + w, y,     x + w, y + r,     r);
    g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h);
    g.arcTo(x, y + h,     x, y + h - r,     r);
    g.lineTo(x, y + r);
    g.arcTo(x, y,         x + r, y,         r);
    g.closePath();
  }

  function drawTimeline() {
    if (!state.paused) return;

    const n   = TIMELINE.snapshots.length;
    const rPx = pxDist(CFG.R_DRUM);

    // Vertical position: just below the steel band in wide mode (plenty of
    // room in the feet zone); lower drum interior in compact/portrait so it
    // doesn't collide with the gauge bar.
    const dotY = REGIME === 'wide'
      ? CY + rPx + 32 + 35       // wide: centre of the feet zone
      : CY + rPx * 0.82;         // compact / portrait: lower drum interior

    // Horizontal span: 68% of canvas width, centred
    const tlW = Math.min(W * 0.68, 520);
    const x0  = CX - tlW * 0.5;
    const x1  = CX + tlW * 0.5;

    ctxOv.save();

    // ── BACKGROUND PILL ──────────────────────────────────────────────────
    const pillH = 56;
    _rrect(ctxOv, x0 - 16, dotY - pillH * 0.5, tlW + 32, pillH, 8);
    ctxOv.fillStyle   = 'rgba(8, 8, 12, 0.88)';
    ctxOv.fill();
    ctxOv.strokeStyle = 'rgba(90, 68, 24, 0.65)';
    ctxOv.lineWidth   = 1;
    ctxOv.stroke();

    // ── "PAUSED" BADGE ────────────────────────────────────────────────────
    ctxOv.fillStyle    = '#d8c18a';
    ctxOv.font         = 'bold 9px "Courier New", monospace';
    ctxOv.textAlign    = 'left';
    ctxOv.textBaseline = 'top';
    ctxOv.fillText('⏸ PAUSED', x0 - 12, dotY - pillH * 0.5 + 4);

    // ── NO-HISTORY FALLBACK ───────────────────────────────────────────────
    if (n === 0) {
      ctxOv.fillStyle    = 'rgba(180,170,150,0.6)';
      ctxOv.font         = '10px "Courier New", monospace';
      ctxOv.textAlign    = 'center';
      ctxOv.textBaseline = 'middle';
      ctxOv.fillText('No history yet — SPACE to resume', CX, dotY);
      ctxOv.restore();
      return;
    }

    // ── CONNECTING TRACK ─────────────────────────────────────────────────
    ctxOv.strokeStyle = 'rgba(200,160,80,0.35)';
    ctxOv.lineWidth   = 1.5;
    ctxOv.beginPath();
    ctxOv.moveTo(x0, dotY);
    ctxOv.lineTo(x1, dotY);
    ctxOv.stroke();

    // ── DOTS ──────────────────────────────────────────────────────────────
    // n snapshot dots  +  1 "NOW" dot  =  n+1 positions
    const total   = n + 1;
    const spacing = total > 1 ? (x1 - x0) / (total - 1) : 0;
    const nowWallT = TIMELINE.frozenSnap
      ? TIMELINE.frozenSnap.wallT
      : performance.now() / 1000;

    const newDots = [];
    for (let i = 0; i <= n; i++) {
      const dx    = x0 + i * spacing;
      const isNow = i === n;
      const isCur = i === TIMELINE.cursorIdx;
      const r     = isCur ? 8 : isNow ? 5.5 : 4;
      const fill  = isCur ? '#ffcc55'
                  : isNow ? '#60ff90'
                  :          'rgba(200,160,80,0.65)';

      if (isCur) {
        ctxOv.beginPath();
        ctxOv.arc(dx, dotY, r + 6, 0, Math.PI * 2);
        ctxOv.fillStyle = 'rgba(255,204,85,0.22)';
        ctxOv.fill();
      }

      ctxOv.beginPath();
      ctxOv.arc(dx, dotY, r, 0, Math.PI * 2);
      ctxOv.fillStyle = fill;
      ctxOv.fill();

      if (isCur) {
        ctxOv.strokeStyle = 'rgba(255,220,100,0.9)';
        ctxOv.lineWidth   = 1.5;
        ctxOv.stroke();
      }

      newDots.push({ x: dx, y: dotY, idx: i });
    }
    TIMELINE._dotPositions = newDots;

    // ── TIME LABEL (under cursor dot) ─────────────────────────────────────
    const curX  = x0 + TIMELINE.cursorIdx * spacing;
    const label = TIMELINE.cursorIdx === n
      ? 'NOW'
      : `−${Math.round(nowWallT - TIMELINE.snapshots[TIMELINE.cursorIdx].wallT)}s`;

    ctxOv.fillStyle    = '#ffcc55';
    ctxOv.font         = 'bold 10px "Courier New", monospace';
    ctxOv.textAlign    = 'center';
    ctxOv.textBaseline = 'top';
    ctxOv.fillText(label, curX, dotY + 11);

    // ── HINT TEXT (above dots) ─────────────────────────────────────────────
    const hint = TIMELINE.cursorIdx < n
      ? '← → to scrub  •  SPACE to branch here'
      : '← to step back  •  SPACE to resume';
    ctxOv.fillStyle    = 'rgba(180,170,150,0.65)';
    ctxOv.font         = '9px "Courier New", monospace';
    ctxOv.textAlign    = 'center';
    ctxOv.textBaseline = 'bottom';
    ctxOv.fillText(hint, CX, dotY - 12);

    ctxOv.restore();
  }

  // ── KEYBOARD NAVIGATION (active only while paused) ────────────────────────
  document.addEventListener('keydown', e => {
    if (!state.paused) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); _navigateTo(TIMELINE.cursorIdx - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); _navigateTo(TIMELINE.cursorIdx + 1); }
  });

  // ── EXPORTS ───────────────────────────────────────────────────────────────
  window.TIMELINE            = TIMELINE;
  window.togglePause         = togglePause;
  window.takeSnapshot        = takeSnapshot;
  window.drawTimeline        = drawTimeline;
  window.resetTimeline       = resetTimeline;
  window.handleTimelineClick = handleTimelineClick;
})();
