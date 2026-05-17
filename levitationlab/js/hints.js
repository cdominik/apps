/**
 * @file hints.js
 * @description
 *   Rule-based hint system. Displays brief contextual messages inside the
 *   drum when the player could benefit from a nudge. Toggle with the ? key.
 *   Suppressed during Game and Challenge modes.
 *
 * Exposes globals: updateHints, drawHints
 * Reads globals:   TUNING, CFG, state, GAME, CHALLENGE,
 *                  CX, CY, ctxOv, Y2px, pxDist
 */
(() => {
  'use strict';

  window.hintsOn = false;

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
  };

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const _expertOpen = () => _expertEl.classList.contains('open');

  // ── RULES ─────────────────────────────────────────────────────────────────
  // Priority: higher fires first when multiple rules match simultaneously.
  // Cooldown: seconds before this individual rule can fire again.
  // Rules pointing at expert buttons are gated on _expertOpen().
  const RULES = [

    // ── DRAMATIC EVENTS ───────────────────────────────────────────────────

    {
      id: 'pebble_formed',
      priority: 100,
      cooldown: 120,
      when: c => c.pebbles.count >= 1 && c.pebbles.count <= 2,
      message: 'A pebble has formed — seven aggregates compressed into one.',
    },
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
    {
      id: 'pebble_imminent',
      priority: 85,
      cooldown: 30,
      when: c => c.aggregates.levitated >= 7 && c.pebbles.count === 0,
      message: 'Seven aggregates levitated. A pebble should form soon.',
    },

    // ── EXPERT BUTTON SUGGESTIONS (require expert door open) ──────────────

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
                 _expertOpen() &&
                 (state.aggHoldRevs > 0.5 || state.eggHoldRevs > 0.5),
      message: 'A merge is building — enable slow motion to watch it form.',
    },

    // ── FORMATION CONDITIONS ──────────────────────────────────────────────

    {
      id: 'spread_low_for_pebble',
      priority: 75,
      cooldown: 60,
      when: c => c.aggregates.count >= 3 &&
                 c.params.VT_SPREAD < 0.30 &&
                 c.pebbles.count === 0,
      message: 'Pebble formation needs a v_t spread of at least 30%.',
    },

    // ── MORE EXPERT BUTTON SUGGESTIONS ────────────────────────────────────

    {
      id: 'suggest_encounters',
      priority: 63,
      cooldown: 120,
      when: c => !window.encountersOn &&
                 window.aggGrowthOn &&
                 c.aggregates.levitated >= 3 &&
                 _expertOpen(),
      message: 'Aggregates drifting together — try the encounter projection HUD.',
    },
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

    // ── PHYSICS OBSERVATIONS ──────────────────────────────────────────────

    {
      id: 'spread_low_for_aggregates',
      priority: 60,
      cooldown: 60,
      when: c => c.particles.levitated >= 5 &&
                 c.params.VT_SPREAD > 0 &&
                 c.params.VT_SPREAD < 0.20 &&
                 c.aggregates.count === 0,
      message: 'Aggregate formation needs a v_t spread of at least 20%.',
    },
    {
      id: 'monodisperse',
      priority: 55,
      cooldown: 90,
      when: c => c.particles.levitated >= 3 && c.params.VT_SPREAD === 0,
      message: 'Same v_t for all — orbits never cross. Increase spread for collisions.',
    },

    // ── MORE EXPERT BUTTON SUGGESTIONS ────────────────────────────────────

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

    // ── BASIC GUIDANCE ────────────────────────────────────────────────────

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
                 c.running,
      message: 'Particles are falling. Swipe the drum to spin it.',
    },
    {
      id: 'expert_panel',
      priority: 10,
      cooldown: 300,
      when: c => c.particles.levitated >= 5 && !_expertOpen(),
      message: 'Expert controls are behind the locked door, bottom left.',
    },
  ];

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
      running: state.running,
      state_t: state.t,
    };
  }

  // ── UPDATE (called every frame from main.js) ──────────────────────────────
  function updateHints() {
    if (!window.hintsOn) return;
    if (typeof GAME      !== 'undefined' && GAME.on)      return;
    if (typeof CHALLENGE !== 'undefined' && CHALLENGE.on) return;

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
    if (!window.hintsOn || !hs.current) return;

    const now = performance.now() / 1000;
    const age = now - hs.current.startedAt;
    if (age >= TOTAL_DUR) { hs.current = null; return; }

    // Alpha envelope: fade in → hold → fade out
    let alpha;
    if      (age < FADE_IN)        alpha = age / FADE_IN;
    else if (age < FADE_IN + HOLD) alpha = 1.0;
    else                           alpha = 1.0 - (age - FADE_IN - HOLD) / FADE_OUT;
    alpha = Math.max(0, Math.min(1, alpha));
    if (alpha < 0.01) return;

    const msg      = hs.current.message;
    const fontSize = Math.max(10, Math.min(13, pxDist(5)));
    const cx       = CX;        // drum centre x
    const cy       = Y2px(78);  // near top of drum, above levitation zone

    ctxOv.save();
    ctxOv.globalAlpha  = alpha;
    ctxOv.font         = `italic ${fontSize}px "Courier New", monospace`;
    ctxOv.textAlign    = 'center';
    ctxOv.textBaseline = 'middle';

    // Rounded-rect backdrop
    const tw  = ctxOv.measureText(msg).width;
    const pad = 7;
    const bx  = cx - tw * 0.5 - pad;
    const by  = cy - fontSize * 0.5 - pad * 0.5;
    const bw  = tw + pad * 2;
    const bh  = fontSize + pad;
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
    ctxOv.arcTo(bx, by,            bx + br, by,           br);
    ctxOv.closePath();
    ctxOv.fill();

    // Text in brass tone to match the lab aesthetic
    ctxOv.fillStyle = '#d8c18a';
    ctxOv.fillText(msg, cx, cy);
    ctxOv.restore();
  }

  // ── KEY TOGGLE ────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key !== '?') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    window.hintsOn = !window.hintsOn;
    if (!window.hintsOn) hs.current = null;
  });

  window.updateHints = updateHints;
  window.drawHints   = drawHints;
})();
