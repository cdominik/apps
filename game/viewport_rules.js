// =============================================================================
// viewport_rules.js
// =============================================================================
//
// This file controls what gets displayed on the lab's brass-framed CRT viewport
// when the user activates either the MICROSCOPE button or the CHART button.
//
// The file is loaded at runtime by the main HTML application. It must call
// window.setViewportRules({ microscope: [...], chart: [...] }) to register
// its rules. Live (canvas-drawn) renderers can additionally be registered with
// window.registerViewportRenderer(name, fn).
//
// You don't need to know JavaScript to edit the basic rules — the asset
// fields are usually just filenames. Conditions (the `when` field) require
// a small bit of JS, but the patterns repeat and you can copy/adapt the
// examples below.
//
// -----------------------------------------------------------------------------
// HOW THE ENGINE WORKS
// -----------------------------------------------------------------------------
//
// While the viewport screen is on, the engine evaluates the active button's
// rule bank a few times per second (5 Hz by default; configurable in TUNING).
// For each evaluation:
//
//   1. It builds a `ctx` object that summarizes the simulation state.
//   2. It walks all rules in the bank and finds those whose `when` returns
//      true.  Rules without a `when` field always match (they're fallbacks).
//   3. Among matching rules, the highest-`priority` one wins. Ties go to
//      the first one in the array.
//   4. The chosen rule's `asset` is resolved and shown.
//
// If the chosen asset differs from what's currently on screen, a 0.4 s
// crossfade transitions to the new content. There's also a 1.0 s debounce
// so rapid state oscillation can't make the screen flicker.
//
// -----------------------------------------------------------------------------
// RULE STRUCTURE
// -----------------------------------------------------------------------------
//
// A rule is a plain object:
//
//   {
//     id:       'some_short_label',  // for your own debugging / logs
//     when:     function (ctx) { return ...; },   // optional; omit for default
//     asset:    'filename.png',                   // see "ASSET FORMS" below
//     priority: 10,                                // optional; default 0
//   }
//
// -----------------------------------------------------------------------------
// ASSET FORMS
// -----------------------------------------------------------------------------
//
// The `asset` field can take any of these forms:
//
//   1. A string filename. Type is inferred from the extension:
//        'pebble.png'        -> static image
//        'orbits.mp4'        -> looping video
//        'whirl.webm'        -> looping video
//
//   2. An array of strings. One is picked at random when the rule fires:
//        ['dust1.png', 'dust2.png', 'dust3.png']
//
//   3. An explicit descriptor object:
//        { type: 'image', src: 'pebble.png' }
//        { type: 'video', src: 'orbits.mp4', loop: true }   // loop defaults to true
//        { type: 'render', name: 'liveLossChart' }          // see "LIVE RENDERERS"
//
// Files are loaded relative to the HTML page. (You can prefix all paths by
// setting TUNING.viewport.assetDir in the main HTML.)
//
// -----------------------------------------------------------------------------
// THE CTX OBJECT
// -----------------------------------------------------------------------------
//
// Inside `when`, you receive a `ctx` object with this shape:
//
// ctx.particles
//     .floating          // currently airborne (not stuck, not merging)
//     .levitated         // floating AND in highlight zone for >= 1 rotation
//     .lost              // total particles ever stuck to the wall
//     .stuck             // particles currently stuck to the wall (subset of lost)
//     .total             // all particles in the array (alive only)
//     .injected          // particles already injected from the manifold
//     .pendingInjection  // particles still waiting in the injection queue
//
// ctx.aggregates
//     .active            // aggregates currently floating in the drum
//     .levitated         // aggregates in highlight zone for >= 1 rotation
//     .totalFormed       // running counter — aggregates ever formed in this run
//     .merging           // 1 if a particle->aggregate merge animation is in progress
//
// ctx.pebbles
//     .count             // golden pebbles formed so far in this run (caps at 10)
//     .merging           // 1 if an aggregate->pebble merge is in progress
//
// ctx.drum
//     .omega             // angular velocity (rad/s; signed)
//     .omegaTarget       // commanded angular velocity (rad/s; signed)
//     .period            // 2π/|ω| in seconds, or Infinity if not spinning
//     .spinning          // boolean: |ω| > 0.05 rad/s
//     .direction         // -1, 0, or +1
//     .angle             // current drum rotation angle (rad)
//
// ctx.time
//     .simT              // simulation time since last reset (s)
//     .sinceInjection    // time since last Inject press (s); Infinity if never
//
// ctx.params
//     .N_P               // number of particles to inject
//     .V_T               // settling velocity (cm/s)
//     .VT_SPREAD         // fractional v_t spread (0..0.5)
//     .DT_INJECT         // injection time interval (s)
//
// ctx.mode
//     .game              // boolean: game mode active
//     .gameLevel         // 0-based game level index, or -1
//     .gamePhase         // 'idle' | 'playing' | 'won' | 'lost' | 'aborted'
//     .challenge         // boolean: challenge mode active
//     .challengePhase    // 'idle' | 'playing' | 'scoring'
//     .running           // boolean: simulation is running
//
// ctx.flags
//     .laserOn           // boolean
//     .trailsOn          // boolean
//     .soundOn           // boolean
//     .theme             // 'dark' | 'light'
//
// ctx.button             // 'microscope' or 'chart' — the active button
//
// -----------------------------------------------------------------------------
// LIVE (CANVAS-DRAWN) RENDERERS
// -----------------------------------------------------------------------------
//
// You can supply an asset of type 'render' that draws live content into
// the screen each frame. To register a renderer, call:
//
//   registerViewportRenderer('myRendererName', function(g, w, h, ctx, t) {
//     // g     : 2D canvas context
//     // w, h  : pixel dimensions of the screen area
//     // ctx   : the same ctx object as in `when` rules
//     // t     : current simulation time (s)
//     // ... draw whatever you want ...
//   });
//
// Then reference it from a rule:
//
//   { id: 'live_loss', asset: { type: 'render', name: 'myRendererName' } }
//
// See the bottom of this file for working examples.
//
// =============================================================================


// -----------------------------------------------------------------------------
// MICROSCOPE BANK
// -----------------------------------------------------------------------------
// The microscope shows zoomed-in views of physical objects in the drum:
// individual particles, aggregates, pebbles, dust on the wall, etc.
// -----------------------------------------------------------------------------

const microscopeRules = [

  // --- HIGH PRIORITY: dramatic states ---

  {
    id: 'pebble_closeup',
    when: ctx => ctx.pebbles.count >= 1,
    asset: 'micro_pebble.jpg',
    priority: 100,
  },

  {
    id: 'aggregate_visible',
    when: ctx => ctx.aggregates.active >= 1 && ctx.pebbles.count === 0,
    asset: ['micro_agg_1.jpg', 'micro_agg_2.jpg'],   // randomly chosen
    priority: 80,
  },

  // --- MEDIUM PRIORITY: regime-based ---

  {
    id: 'crowd_view',
    when: ctx => ctx.particles.floating >= 100,
    asset: 'micro_crowd.jpg',
    priority: 60,
  },

  {
    id: 'fast_orbits',
    when: ctx => ctx.particles.floating > 5 && ctx.drum.spinning && ctx.drum.period < 1.5,
    asset: 'micro_streaks.jpg',
    priority: 50,
  },

  {
    id: 'wall_buildup',
    when: ctx => ctx.particles.stuck >= 5,
    asset: 'micro_wall_dust.jpg',
    priority: 40,
  },

  // --- LOW PRIORITY: gentle states ---

  {
    id: 'few_particles',
    when: ctx => ctx.particles.floating > 0 && ctx.particles.floating <= 5,
    asset: 'micro_single.jpg',
    priority: 20,
  },

  {
    id: 'empty_chamber',
    when: ctx => ctx.particles.total === 0 && ctx.aggregates.active === 0,
    asset: 'micro_empty.jpg',
    priority: 10,
  },

  // --- DEFAULT FALLBACK (no `when` = always matches; lowest priority) ---

  {
    id: 'default',
    asset: ['assets/micro_default_1.png', 'assets/micro_default_2.png'],
    priority: 200,   // FIXME: This chould be priority 0 when the other rules are in place.
  },
];


// -----------------------------------------------------------------------------
// CHART BANK
// -----------------------------------------------------------------------------
// The chart shows graphs, data plots, and quantitative info about the run.
// Live renderers (defined below) are great for this.
// -----------------------------------------------------------------------------

const chartRules = [

  // --- LIVE RENDERED: highest priority when in interesting states ---

  {
    id: 'live_population',
    when: ctx => ctx.particles.total > 0 || ctx.aggregates.active > 0,
    asset: { type: 'render', name: 'populationChart' },
    priority: 50,
  },

  // --- STATIC EXPLAINERS: shown in idle states ---

  {
    id: 'orbit_diagram',
    when: ctx => !ctx.drum.spinning && ctx.particles.total === 0,
    asset: 'chart_orbit_explainer.png',
    priority: 30,
  },

  {
    id: 'spread_explainer',
    when: ctx => ctx.params.VT_SPREAD > 0.10,
    asset: 'chart_size_distribution.png',
    priority: 20,
  },

  // --- DEFAULT ---

  {
    id: 'default',
    asset: ['assets/chart_default_1.png', 'assets/chart_default_2.png'],
    priority: 200, // FIXME: This should be 0, once other rules ae in place an d fire
  },
];


// -----------------------------------------------------------------------------
// REGISTER THE RULE BANKS
// -----------------------------------------------------------------------------

window.setViewportRules({
  microscope: microscopeRules,
  chart:      chartRules,
});


// =============================================================================
// LIVE RENDERER EXAMPLES
// =============================================================================
// Below are two example renderers. They paint into a 2D canvas context and
// have access to the same `ctx` object as the rule conditions.
//
// Coordinates: (0,0) is top-left, (w,h) is bottom-right. The screen has
// already been cleared and any crossfade alpha is handled by the engine —
// just paint as if you own the whole rect.
// =============================================================================


// A live bar chart of floating / levitated / lost particle counts.
registerViewportRenderer('populationChart', function (g, w, h, ctx, t) {

  // Background
  g.fillStyle = '#001a0c';
  g.fillRect(0, 0, w, h);

  // Title
  g.fillStyle = '#80ffa0';
  g.font = 'bold ' + Math.round(h * 0.07) + 'px "Courier New", monospace';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText('PARTICLE CENSUS', w * 0.06, h * 0.06);

  // Data
  const bars = [
    { label: 'FLOATING',  value: ctx.particles.floating,  color: '#ffee33' },
    { label: 'LEVITATED', value: ctx.particles.levitated, color: '#60ff90' },
    { label: 'LOST',      value: ctx.particles.lost,      color: '#ff6060' },
    { label: 'AGGREG.',   value: ctx.aggregates.active,   color: '#a0c0ff' },
    { label: 'PEBBLES',   value: ctx.pebbles.count,       color: '#ffcc55' },
  ];
  const maxVal = Math.max(1, ...bars.map(b => b.value));

  // Layout
  const x0 = w * 0.30;
  const xMax = w * 0.94;
  const yStart = h * 0.22;
  const rowH = (h * 0.70) / bars.length;
  const barH = rowH * 0.55;

  g.font = 'bold ' + Math.round(h * 0.05) + 'px "Courier New", monospace';
  g.textBaseline = 'middle';

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const cy = yStart + i * rowH + rowH * 0.5;

    // Label
    g.fillStyle = '#80ffa0';
    g.textAlign = 'right';
    g.fillText(b.label, x0 - w * 0.02, cy);

    // Bar background
    g.fillStyle = 'rgba(60,120,80,0.25)';
    g.fillRect(x0, cy - barH * 0.5, xMax - x0, barH);

    // Bar fill
    const frac = b.value / maxVal;
    g.fillStyle = b.color;
    g.fillRect(x0, cy - barH * 0.5, (xMax - x0) * frac, barH);

    // Value
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.fillText(String(b.value), x0 + (xMax - x0) * frac + w * 0.01, cy);
  }
});


// A live "phase-space" plot of (radius, tangential speed) for floating particles.
// Demonstrates how renderers can read live state.
//
// Note: this example renderer just draws a placeholder grid; it doesn't have
// access to individual particle positions through the ctx object (which gives
// aggregate counts only). If you need per-particle data, you'd need to extend
// buildViewportContext() in the main HTML to expose more.
registerViewportRenderer('phaseSpace', function (g, w, h, ctx, t) {
  g.fillStyle = '#0a0014';
  g.fillRect(0, 0, w, h);

  // Grid
  g.strokeStyle = 'rgba(160,120,255,0.20)';
  g.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * w;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    const y = (i / 10) * h;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }

  // Axes labels
  g.fillStyle = '#c0a0ff';
  g.font = 'bold ' + Math.round(h * 0.05) + 'px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillText('RADIUS  (cm)', w * 0.5, h * 0.97);
  g.save();
  g.translate(w * 0.04, h * 0.5);
  g.rotate(-Math.PI * 0.5);
  g.textBaseline = 'top';
  g.fillText('|v_t|  (cm/s)', 0, 0);
  g.restore();

  // Live readout
  g.fillStyle = '#80ffa0';
  g.textAlign = 'right';
  g.textBaseline = 'top';
  g.fillText('ω = ' + ctx.drum.omega.toFixed(2), w * 0.94, h * 0.06);
  g.fillText('T = ' + (isFinite(ctx.drum.period) ? ctx.drum.period.toFixed(2) : '∞'),
             w * 0.94, h * 0.06 + h * 0.06);
});


// =============================================================================
// END OF FILE
// =============================================================================
//
// Quick recipe for adding a new rule:
//
//   1. Pick a bank (microscopeRules or chartRules).
//   2. Add an entry. Most common patterns:
//
//      // "If X happens, show this":
//      { id: 'name', when: ctx => ctx.something > 5, asset: 'foo.png', priority: 50 }
//
//      // "Random selection from several":
//      { id: 'name', asset: ['a.png', 'b.png', 'c.png'], priority: 30 }
//
//      // "Looping video":
//      { id: 'name', when: ctx => ctx.drum.spinning, asset: 'orbit.mp4', priority: 40 }
//
//   3. Tune the priority so it fires at the right time relative to others.
//      Defaults are: 100 = dramatic events, 50 = regime-based, 20 = mild,
//      0 = catchall fallback.
//
// =============================================================================
