/**
 * @file hints.js
 * @description
 *   Rule-based hint system. Displays brief contextual messages inside the
 *   drum when the player could benefit from a nudge. Toggle with the ? key.
 *   Suppressed during Game and Challenge modes.
 *
 *   On/off transitions show an immediate acknowledgement message that
 *   bypasses the normal rule system and cooldowns.
 *
 *   Growth stages (window.aggGrowthStage):
 *     0 — systemic (7 levitated aggregates collapse to a pebble)
 *     1 — grow    (aggregate-aggregate merges; pebble at 100 monomers)
 *     2 — bounce  (sub-threshold collisions bounce, super-threshold form pebbles)
 *     3 — off     (no growth beyond aggregate formation)
 *
 * Exposes globals: updateHints, drawHints, toggleHints, setHints
 * Reads globals:   TUNING, CFG, state, GAME, CHALLENGE,
 *                  CX, CY, ctxOv, Y2px, pxDist
 */
(() => {
  'use strict';

  window.hintsOn = true;

  // Cached DOM reference — avoids repeated getElementById in rule conditions.
  const _expertEl = document.getElementById('expertContainer');

  // ── TIMING ────────────────────────────────────────────────────────────────
  const GLOBAL_COOLDOWN = 12;  // s — minimum gap between any two hints
  const FADE_IN         = 0.5; // s
  const HOLD            = 5.5; // s
  const FADE_OUT        = 1.0; // s
  const TOTAL_DUR       = FADE_IN + HOLD + FADE_OUT;

  // ── STATE ─────────────────────────────────────────────────────────────────
  const hs = {
    current:     null,   // { message, startedAt (wall s) } | null
    lastFiredAt: -999,   // wall time of last hint fired
    cooldowns:   {},     // rule id → wall time last fired
    forceDraw:   false,  // true while the farewell hint is showing after hints turned off
    bounceCount: 0,      // total bounces observed (for stage 2 nudges)
    lastBounceObservedAt: -999,
  };

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const _expertOpen = () => _expertEl.classList.contains('open');

  /**
   * Returns the 95.45% percentile range of vt for all floating particles,
   * plus their mean. Returns null if fewer than 2 samples.
   */
  function _floatVtRange() {
    const vts = state.particles
      .filter(p => p.alive && !p.stuck && !p.merging && p.insideOnce)
      .map(p => p.vt);
    if (vts.length < 2) return null;
    const sorted = [...vts].sort((a, b) => a - b);
    const n    = sorted.length;
    const lo   = sorted[Math.floor(0.02275 * (n - 1))];
    const hi   = sorted[Math.ceil(0.97725  * (n - 1))];
    const mean = vts.reduce((s, v) => s + v, 0) / n;
    return { lo, hi, mean, range: hi - lo };
  }

  /**
   * Returns the empirical min-to-max vt range of live aggregates, plus mean
   * and max. Returns null if fewer than 2 aggregates.
   */
  function _aggVtRange() {
    const vts = state.aggregates
      .filter(a => a.alive && !a.stuck && !a.merging && !a.onTray)
      .map(a => a.vt);
    if (vts.length < 2) return null;
    const vtMin  = Math.min(...vts);
    const vtMax  = Math.max(...vts);
    const vtMean = vts.reduce((s, v) => s + v, 0) / vts.length;
    return { vtMin, vtMax, vtMean, range: vtMax - vtMin };
  }

  /**
   * Returns the bounce threshold currently used in stage 2 (multiplier
   * applied to the injected mean vt). Used by hint rules and messages.
   */
  function _bounceThreshold() {
    const m = state.injectedMeanVt || CFG.V_T;
    return TUNING.egg.vtSpreadMult * m;
  }

  /**
   * Returns true if any live aggregate has v_t at or above the stage-2
   * pebble-formation threshold. A reasonable proxy for "progress is happening".
   */
  function _anyAggAboveThreshold() {
    const thresh = _bounceThreshold();
    for (const a of state.aggregates) {
      if (!a.alive || a.stuck || a.merging || a.onTray) continue;
      if (a.vt >= thresh) return true;
    }
    return false;
  }

  /**
   * Counts how many bounce-flashes are currently active. Cheap proxy for
   * "bouncing is actively happening right now".
   */
  function _activeBounces() {
    let n = 0;
    for (const a of state.aggregates) {
      if (a.bounceFlashEndsAt && a.bounceFlashEndsAt > state.t) n++;
    }
    return n;
  }

  // ── RULES ─────────────────────────────────────────────────────────────────
  // Priority: higher fires first when multiple rules match simultaneously.
  // Cooldown: seconds before this individual rule can fire again.
  const RULES = [

    // ══════════════════════════════════════════════════════════════════════
    // DRAMATIC EVENTS — fire once per run, very high priority
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'pebble_formed_stage0',
      priority: 100,
      cooldown: 120,
      when: c => c.growthStage === 0 &&
                 c.pebbles.count >= 1 && c.pebbles.count <= 2,
      message: 'A pebble has formed — seven aggregates compressed into one.',
    },
    {
      id: 'pebble_formed_stage1',
      priority: 100,
      cooldown: 120,
      when: c => c.growthStage === 1 &&
                 c.pebbles.count >= 1 && c.pebbles.count <= 2,
      message: 'A pebble has formed from sequential aggregate merges.',
    },
    {
      id: 'pebble_formed_stage2',
      priority: 100,
      cooldown: 120,
      when: c => c.growthStage === 2 &&
                 c.pebbles.count >= 1 && c.pebbles.count <= 2,
      message: 'A pebble formed — an aggregate finally crossed the v_t threshold.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // FIRST AGGREGATE — fires once early
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'aggregate_formed_no_kick',
      priority: 90,
      cooldown: 90,
      when: c => c.aggregates.count >= 1 &&
                 c.pebbles.count === 0 &&
                 !window.stokesKickOn,
      message: 'Aggregate formed. It orbits at the mean v_t of its constituents.',
    },
    {
      id: 'aggregate_formed_kick',
      priority: 90,
      cooldown: 90,
      when: c => c.aggregates.count >= 1 &&
                 c.pebbles.count === 0 &&
                 window.stokesKickOn,
      message: 'Aggregate formed. Its higher Stokes number shifts its orbit outward.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // STAGE INTRO HINTS — fire when the player switches modes mid-run
    // and there is something to comment on
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'stage_1_intro',
      priority: 87,
      cooldown: 300,
      when: c => c.growthStage === 1 && c.aggregates.count >= 2 &&
                 c.pebbles.count === 0,
      message: 'Grow mode: aggregates that collide will now merge. Pebble at 100 monomers.',
    },
    {
      id: 'stage_2_intro',
      priority: 87,
      cooldown: 300,
      when: c => c.growthStage === 2 && c.aggregates.count >= 2 &&
                 c.pebbles.count === 0,
      message: 'Bounce mode: large aggregates only form pebbles once their v_t is high enough.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // STAGE 2 — BOUNCE PHYSICS (the most novel, least intuitive mode)
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'bounce_first_observed',
      priority: 86,
      cooldown: 600,
      when: c => c.growthStage === 2 && hs.bounceCount >= 1 &&
                 hs.bounceCount <= 3 && c.pebbles.count === 0,
      message: 'A collision bounced — both aggregates received a v_t kick. Their orbits will shift outward.',
    },
    {
      id: 'bounce_threshold_reached',
      priority: 84,
      cooldown: 120,
      when: c => c.growthStage === 2 &&
                 c.pebbles.count === 0 &&
                 c.aggregates.count >= 2 &&
                 _anyAggAboveThreshold(),
      message: 'An aggregate is now above the pebble threshold — next contact will form one.',
    },
    {
      id: 'bounce_stuck_below_threshold',
      priority: 70,
      cooldown: 90,
      when: c => c.growthStage === 2 &&
                 c.pebbles.count === 0 &&
                 c.aggregates.count >= 3 &&
                 hs.bounceCount >= 8 &&
                 !_anyAggAboveThreshold() &&
                 c.state_t > 20,
      message: 'Many bounces, no pebbles — aggregates are stuck below the threshold. A wider spread would help.',
    },
    {
      id: 'suggest_slow_mo_for_bounce',
      priority: 80,
      cooldown: 120,
      when: c => c.growthStage === 2 &&
                 !window.slowMoArmed &&
                 hs.bounceCount >= 2 &&
                 _expertOpen(),
      message: 'Bounce collisions are fast — slow motion makes them easier to follow.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // PEBBLE IMMINENCE — mode-specific
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'pebble_imminent_stage0',
      priority: 85,
      cooldown: 30,
      when: c => c.growthStage === 0 &&
                 c.aggregates.levitated >= 7 &&
                 c.params.VT_SPREAD >= TUNING.egg.minSpread &&
                 c.pebbles.count === 0,
      message: 'Seven aggregates levitated with sufficient spread. A pebble should form soon.',
    },
    {
      id: 'pebble_imminent_stage1',
      priority: 85,
      cooldown: 30,
      when: c => {
        if (c.growthStage !== 1) return false;
        if (c.pebbles.count > 0) return false;
        if (state.eggHoldRevs < 0.3) return false;
        const r = _aggVtRange();
        return r !== null && r.vtMean > 0 &&
               r.range >= TUNING.egg.widthThresh * r.vtMean;
      },
      message: 'Aggregate v_t range is wide — a pebble is imminent. Keep the drum spinning.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // FORMATION CONDITIONS — mode-specific blockers
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'spread_low_for_pebble_stage0',
      priority: 75,
      cooldown: 60,
      when: c => c.growthStage === 0 &&
                 c.aggregates.count >= 3 &&
                 c.params.VT_SPREAD < TUNING.egg.minSpread &&
                 c.pebbles.count === 0,
      message: 'Pebble formation needs an injection spread of at least 30%. Increase v_t spread.',
    },
    {
      id: 'grow_range_narrow_stage1',
      priority: 75,
      cooldown: 60,
      when: c => {
        if (c.growthStage !== 1) return false;
        if (c.aggregates.count < 2) return false;
        if (c.pebbles.count > 0) return false;
        const r = _aggVtRange();
        return r !== null && r.vtMean > 0 &&
               r.range < TUNING.egg.widthThresh * r.vtMean;
      },
      message: 'Aggregate v_t range has collapsed — pebble formation paused. A wider injection spread would help.',
    },
    {
      id: 'growth_off_explainer',
      priority: 72,
      cooldown: 180,
      when: c => c.growthStage === 3 &&
                 c.aggregates.count >= 5 &&
                 c.pebbles.count === 0,
      message: 'Growth is off — aggregates will not combine further. Cycle the growth button to enable.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // EXPERT BUTTON SUGGESTIONS (require expert door open)
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'agg_size_dist',
      priority: 82,
      cooldown: 120,
      when: c => {
        if (window.aggHistOn) return false;
        if (!_expertOpen()) return false;
        const aggs = state.aggregates.filter(a => a.alive && !a.merging && !a.onTray);
        if (aggs.length < 4) return false;
        const counts = aggs.map(a => a.count);
        return Math.max(...counts) > Math.min(...counts) * 2;
      },
      message: 'A spread of aggregate sizes has formed. Try the size histogram in the HUD.',
    },
    {
      id: 'suggest_slow_mo',
      priority: 76,
      cooldown: 60,
      when: c => !window.slowMoArmed &&
                 !c.merging &&
                 c.growthStage !== 2 &&  // stage 2 has its own slow-mo hint
                 _expertOpen() &&
                 (state.aggHoldRevs > 0.5 || state.eggHoldRevs > 0.5),
      message: 'A merge is building — enable slow motion to watch it form.',
    },
    {
      id: 'suggest_encounters',
      priority: 63,
      cooldown: 120,
      when: c => !window.encountersOn &&
                 (c.growthStage === 1 || c.growthStage === 2) &&
                 c.aggregates.levitated >= 3 &&
                 _expertOpen(),
      message: 'Aggregates drifting together — try the encounter projection HUD.',
    },
    {
      id: 'suggest_vt_dist_stage2',
      priority: 58,
      cooldown: 120,
      when: c => c.growthStage === 2 &&
                 !window.vtDistOn &&
                 c.aggregates.count >= 3 &&
                 _expertOpen(),
      message: 'Watch v_t climb after each bounce — the v_t distribution HUD shows the threshold line.',
    },
    {
      id: 'suggest_vt_dist',
      priority: 53,
      cooldown: 120,
      when: c => !window.vtDistOn &&
                 c.params.VT_SPREAD >= 0.15 &&
                 c.particles.levitated >= 3 &&
                 c.particles.floating > c.particles.levitated &&
                 c.state_t > 5 &&
                 _expertOpen(),
      message: 'Particles sorting by size — try the v_t distribution HUD.',
    },
    {
      id: 'suggest_orbit_proj',
      priority: 47,
      cooldown: 120,
      when: c => TUNING.particle.showVtProjection === 0 &&
                 c.params.VT_SPREAD > 0 &&
                 c.particles.levitated >= 3 &&
                 _expertOpen(),
      message: "Try the orbit projection button to see each size's orbit.",
    },
    {
      id: 'suggest_auto_omega',
      priority: 44,
      cooldown: 90,
      when: c => window.omegaCtlMode === 0 &&
                 c.drum.spinning &&
                 c.particles.floating >= 5 &&
                 c.particles.levitated < c.particles.floating * 0.3 &&
                 c.particles.lost > 3 &&
                 c.state_t > 8 &&
                 _expertOpen(),
      message: 'Auto-omega can centre the orbits automatically.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // PHYSICS OBSERVATIONS — general, not stage-specific
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'orbits_crossing',
      priority: 65,
      cooldown: 45,
      when: c => c.particles.levitated >= 10 &&
                 c.params.VT_SPREAD >= 0.20 &&
                 c.aggregates.count === 0 &&
                 c.state_t > 5,
      message: 'Orbits are crossing. Keep particles levitated and aggregates will form.',
    },
    {
      id: 'spread_low_for_aggregates',
      priority: 60,
      cooldown: 60,
      when: c => {
        if (c.particles.levitated < 5) return false;
        if (c.params.VT_SPREAD === 0) return false; // monodisperse rule handles this
        if (c.aggregates.count > 0) return false;
        const r = _floatVtRange();
        if (!r) return false;
        return r.mean > 0 && r.range < TUNING.aggregate.spreadThresh * r.mean;
      },
      message: 'Particle size range too narrow for aggregates. Increase v_t spread.',
    },
    {
      id: 'monodisperse',
      priority: 55,
      cooldown: 90,
      when: c => c.particles.levitated >= 3 && c.params.VT_SPREAD === 0,
      message: 'Same v_t for all — orbits never cross. Increase spread for collisions.',
    },

    // ══════════════════════════════════════════════════════════════════════
    // BASIC GUIDANCE — lowest priority, fallback nudges
    // ══════════════════════════════════════════════════════════════════════

    {
      id: 'too_many_losses',
      priority: 50,
      cooldown: 25,
      when: c => c.particles.lost > 5 &&
                 c.particles.levitated < 3 &&
                 c.drum.spinning &&
                 c.particles.floating > 0 &&
                 c.state_t > 4,
      message: 'Too many wall losses. Try adjusting drum speed to centre the orbits.',
    },
    {
      id: 'spinning_no_particles',
      priority: 40,
      cooldown: 20,
      when: c => c.drum.spinning &&
                 c.particles.total === 0 &&
                 c.particles.pending === 0 &&
                 c.running,
      message: 'Drum is spinning. Press Inject to release particles.',
    },
    {
      id: 'particles_not_spinning',
      priority: 35,
      cooldown: 20,
      when: c => !c.drum.spinning &&
                 c.particles.floating > 0 &&
                 c.running &&
                 state.tray.phase !== 'inserting' &&
                 state.tray.phase !== 'inserted',
      message: 'Particles are falling. Swipe the drum to spin it.',
    },
  ];

  // ── BOUNCE OBSERVER ───────────────────────────────────────────────────────
  // The physics code sets agg.bounceFlashEndsAt the moment a bounce fires.
  // We count rising edges of that flag so rules can use hs.bounceCount.
  const _bounceSeen = new WeakSet();
  function _observeBounces() {
    for (const a of state.aggregates) {
      if (!a.bounceFlashEndsAt) continue;
      // Treat each (aggregate, flashEndTime) pair as one event. We tag the
      // aggregate with the most recent end-time we've credited; if the new
      // end-time is later, that's a new bounce.
      if (a._lastBounceCredited !== a.bounceFlashEndsAt) {
        a._lastBounceCredited = a.bounceFlashEndsAt;
        // Each collision flashes both aggregates, so we'd double-count
        // by walking the list. Halve via a simple parity gate: only
        // increment on aggregates that haven't been credited this frame.
        if (!_bounceSeen.has(a)) {
          _bounceSeen.add(a);
          // Re-clear next frame — see end of updateHints.
        }
      }
    }
    // Collapse: increment bounceCount by half the new entries, rounded up.
    // Since both aggregates in a pair share the same flashEndsAt, we count
    // one bounce per *pair*, not per aggregate.
    // Simpler: just count distinct flashEndsAt values seen this frame.
  }

  // ── CONTEXT ───────────────────────────────────────────────────────────────
  function buildCtx() {
    let floating = 0, levitated = 0;
    for (const p of state.particles) {
      if (!p.alive || p.stuck || p.merging) continue;
      floating++;
      if (state.isLevitated(p)) levitated++;
    }
    let aggLev = 0;
    for (const a of state.aggregates) {
      if (!a.alive || a.stuck || a.merging) continue;
      if (state.isLevitated(a)) aggLev++;
    }
    return {
      particles: {
        floating,
        levitated,
        lost:    state.lostCount,
        total:   state.particles.length,
        pending: state.toInject.length,
      },
      aggregates: {
        active:    state.aggregates.filter(a => a.alive && !a.merging).length,
        levitated: aggLev,
        count:     state.aggCount,
      },
      pebbles:  { count: state.eggBallCount },
      drum: {
        spinning: Math.abs(state.omega) > 0.05,
        omega:    state.omega,
        period:   state.period(),
      },
      params: {
        VT_SPREAD: CFG.VT_SPREAD,
        N_P:       CFG.N_P,
        V_T:       CFG.V_T,
      },
      merging: !!(state.aggMerging || state.eggMerging ||
                  state.globeMerging || state.aggGrowMerging),
      running:     state.running,
      state_t:     state.t,
      growthStage: window.aggGrowthStage || 0,
    };
  }

  // ── UPDATE (called from main.js, throttled to 4 Hz) ───────────────────────
  function updateHints() {
    if (!window.hintsOn) return;
    if (typeof GAME      !== 'undefined' && GAME.on)      return;
    if (typeof CHALLENGE !== 'undefined' && CHALLENGE.on) return;

    // No hints during tray time, as the user has no control
    if (state.tray.phase === 'inserting' || state.tray.phase === 'inserted') return;

    // Track bounces across calls — distinct flashEndsAt values are new events.
    // Each collision flashes BOTH aggregates with the same end-time, so we
    // dedupe by end-time, not by aggregate.
    {
      const seenEnds = new Set();
      for (const a of state.aggregates) {
        if (!a.bounceFlashEndsAt) continue;
        if (a.bounceFlashEndsAt <= hs.lastBounceObservedAt) continue;
        seenEnds.add(a.bounceFlashEndsAt);
      }
      if (seenEnds.size > 0) {
        hs.bounceCount += seenEnds.size;
        hs.lastBounceObservedAt = Math.max(...seenEnds);
      }
    }

    const now = performance.now() / 1000;

    // Still showing — don't interrupt
    if (hs.current && (now - hs.current.startedAt) < TOTAL_DUR) return;
    if (hs.current) hs.current = null;

    // Global cooldown
    if (now - hs.lastFiredAt < GLOBAL_COOLDOWN) return;

    const ctx = buildCtx();
    if (ctx.merging) return; // don't talk over merge animations

    // Pick highest-priority matching rule that is off its own cooldown
    let best = null, bestPri = -Infinity;
    for (const rule of RULES) {
      let matches;
      try { matches = rule.when(ctx); } catch (e) { matches = false; }
      if (!matches) continue;
      const lastFired = hs.cooldowns[rule.id] || -9999;
      if (now - lastFired < rule.cooldown) continue;
      if (rule.priority > bestPri) { bestPri = rule.priority; best = rule; }
    }

    if (!best) return;
    hs.current            = { message: best.message, startedAt: now };
    hs.cooldowns[best.id] = now;
    hs.lastFiredAt        = now;
  }

  // ── DRAW (called each render frame from main.js, draws on ctxOv) ─────────
  function drawHints() {
    if (!hs.current) return;
    // Allow the farewell hint to render even though hintsOn is now false.
    if (!window.hintsOn && !hs.forceDraw) return;

    const now = performance.now() / 1000;
    const age = now - hs.current.startedAt;
    if (age >= TOTAL_DUR) {
      hs.current   = null;
      hs.forceDraw = false;
      return;
    }

    // Alpha envelope: fade in → hold → fade out
    let alpha;
    if      (age < FADE_IN)        alpha = age / FADE_IN;
    else if (age < FADE_IN + HOLD) alpha = 1.0;
    else                           alpha = 1.0 - (age - FADE_IN - HOLD) / FADE_OUT;
    alpha = Math.max(0, Math.min(1, alpha));
    if (alpha < 0.01) return;

    const msg      = hs.current.message;
    const fontSize = Math.max(10, Math.min(13, pxDist(5)));
    const cx       = CX;
    const cy       = Y2px(78);  // near top of drum, above levitation zone

    ctxOv.save();
    ctxOv.globalAlpha  = alpha;
    ctxOv.font         = `italic ${fontSize}px "Courier New", monospace`;
    ctxOv.textAlign    = 'center';
    ctxOv.textBaseline = 'middle';

    // ── WORD-WRAP into two lines ──────────────────────────────────────────
    const maxW  = pxDist(CFG.R_DRUM) * 1.1;
    const words = msg.split(' ');

    let built = '';
    let splitAt = words.length;
    for (let i = 0; i < words.length; i++) {
      const test = built ? built + ' ' + words[i] : words[i];
      if (ctxOv.measureText(test).width > maxW && built) {
        splitAt = i;
        break;
      }
      built = test;
    }
    const line1 = words.slice(0, splitAt).join(' ');
    const line2 = words.slice(splitAt).join(' ');

    const hasTwo = line2.length > 0;
    const tw1    = ctxOv.measureText(line1).width;
    const tw2    = hasTwo ? ctxOv.measureText(line2).width : 0;
    const tw     = Math.max(tw1, tw2);

    // ── BACKDROP ─────────────────────────────────────────────────────────
    const pad = 7;
    const lineH = fontSize * 1.35;
    const bh  = (hasTwo ? lineH * 2 : lineH) + pad;
    const bw  = tw + pad * 2;
    const bx  = cx - tw * 0.5 - pad;
    const by  = cy - bh * 0.5;
    const br  = 4;

    ctxOv.fillStyle = 'rgba(8,8,12,0.80)';
    ctxOv.beginPath();
    ctxOv.moveTo(bx + br, by);
    ctxOv.lineTo(bx + bw - br, by);
    ctxOv.arcTo(bx + bw, by,      bx + bw, by + br,      br);
    ctxOv.lineTo(bx + bw, by + bh - br);
    ctxOv.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
    ctxOv.lineTo(bx + br, by + bh);
    ctxOv.arcTo(bx, by + bh,      bx, by + bh - br,      br);
    ctxOv.lineTo(bx, by + br);
    ctxOv.arcTo(bx, by,           bx + br, by,            br);
    ctxOv.closePath();
    ctxOv.fill();

    // ── TEXT ─────────────────────────────────────────────────────────────
    ctxOv.fillStyle = '#d8c18a';
    if (hasTwo) {
      ctxOv.fillText(line1, cx, cy - lineH * 0.5);
      ctxOv.fillText(line2, cx, cy + lineH * 0.5);
    } else {
      ctxOv.fillText(line1, cx, cy);
    }

    ctxOv.restore();
  }

  // ── TOGGLE (shared by the ? key and the wing button) ──────────────────────
  function setHints(on) {
    window.hintsOn = on;
    const now = performance.now() / 1000;
    if (on) {
      // Welcome hint — bypasses cooldown and rules, shows immediately.
      hs.current     = { message: 'Hint system on. Watch this space for tips and information.', startedAt: now };
      hs.lastFiredAt = now;
      hs.forceDraw   = false;
    } else {
      // Farewell hint — must render even though hintsOn is now false.
      hs.current   = { message: 'Hint system turned off.', startedAt: now };
      hs.forceDraw = true;
    }
    const btn = document.getElementById('btnHints');
    if (btn) btn.classList.toggle('on', on);
  }
  function toggleHints() { setHints(!window.hintsOn); }

  document.addEventListener('keydown', e => {
    if (e.key !== '?') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    toggleHints();
  });

  // Reflect the initial (possibly default-on) state on the button without
  // firing the welcome banner — silent on load, banner only on explicit toggle.
  const _hintBtnInit = document.getElementById('btnHints');
  if (_hintBtnInit) _hintBtnInit.classList.toggle('on', window.hintsOn);

  window.toggleHints = toggleHints;
  window.setHints    = setHints;
  window.updateHints = updateHints;
  window.drawHints   = drawHints;
})();
