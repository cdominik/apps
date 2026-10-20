/*
 * AggBoard, Copyright (c) 2026 Carsten Dominik. MIT License (see LICENSE).
 */
/* AggBoard — notebook whiteboard with a 3D fractal aggregate tool. */
(() => {
  'use strict';

  // ============================================================
  // Configuration
  // ============================================================
  // Bump on every release: shown in the menu, and used to bypass cached program files.
  const VERSION = '2026.10.19-26';
  window.AGGBOARD_VERSION = VERSION;
  const CONFIG = {
    MENU_URL: null,            // e.g. '../index.html' to show a "back to menu" button
    PAGE_W: 1600, PAGE_H: 900, // page size in page units (16:9)
    N_MAX: 5000,               // maximum monomers per aggregate
    DB_NAME: 'aggboard',
    SETTINGS_KEY: 'aggboard.settings.v1',
    FORMAT: 'aggboard-notebook',
    FORMAT_VERSION: 4,         // v2: chains, edited aggregates; v3: page formats; v4: polydisperse monomers (per-monomer radii)
  };
  const PW = CONFIG.PAGE_W, PH = CONFIG.PAGE_H;
  // Page formats: the width is always PW (1600 page units), only the height differs, so
  // switching formats never moves anything sideways. 'screen' is measured when chosen.
  const PAGE_FORMATS = { '16:9': 9 / 16, '16:10': 10 / 16, '4:3': 3 / 4, 'A4': 1 / Math.SQRT2 };
  const pageH = (pg) => (pg && pg.h > 0 ? pg.h : PH);
  const INK = [
    { name: 'Black', v: '#1d1d22' },
    { name: 'Blue', v: '#1f5bd6' },
    { name: 'Red', v: '#d1342f' },
    { name: 'Green', v: '#2b8a3e' },
    { name: 'Orange', v: '#e8860c' },
  ];
  const WIDTHS = [2.5, 5, 10];
  const AGG_COLORS = ['#3b78c8', '#1f8c8a', '#c8362c', '#c89a2b', '#7a7468'];
  const DESK = '#e9e9ee';
  const ACCENT = '#22aa77';
  const TAP_SLOP = 6, TAP_MS = 350, DOUBLE_MS = 420;
  const ERASER_PX = 12;
  const MIN_BOX = 16;
  const LASER_FADE = 1100;

  const $ = (id) => document.getElementById(id);
  const board = $('board'), bctx = board.getContext('2d');
  const overlay = $('overlay'), octx = overlay.getContext('2d', { desynchronized: true }) || overlay.getContext('2d');
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const randSeed = () => (Math.random() * 2147483647) | 0;
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // ============================================================
  // Settings (localStorage, small)
  // ============================================================
  const settings = (() => {
    const d = {
      tool: 'pen', color: INK[0].v, width: 1,
      fingersDraw: true, penSeen: false,   // who draws with one finger; the Pencil switches it off
      agg: { a: 10, df: 1.8, kf: null, ns: null, color: AGG_COLORS[0], method: 'cca', sigma: 1 },
      chain: { temp: 0.25 },
      aggCreate: 'circle',       // 'box' | 'circle': how the aggregate tool places a new aggregate
      hand: 'right',             // 'right' | 'left': controls go to the side away from the writing hand
      spinStyle: 'rotate',       // 'rotate' (full rotations) | 'rock' (swing back and forth)
      ovScale: 0.8,              // size of all overlay text on the board (labels, plot, ring numbers)
    };
    try {
      const s = JSON.parse(localStorage.getItem(CONFIG.SETTINGS_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (['pen', 'eraser', 'select', 'laser', 'chain'].includes(s.tool)) d.tool = s.tool;
        if (INK.some(c => c.v === s.color)) d.color = s.color;
        if (s.width >= 0 && s.width < WIDTHS.length) d.width = s.width | 0;
        d.penSeen = !!s.penSeen;
        if (typeof s.fingersDraw === 'boolean') d.fingersDraw = s.fingersDraw;
        else if (s.fingerMode === 'draw') d.fingersDraw = true;          // earlier three-way setting
        else if (s.fingerMode === 'navigate') d.fingersDraw = false;
        else d.fingersDraw = !d.penSeen;
        if (s.agg) {
          if (s.agg.a >= 0.5 && s.agg.a <= 200) d.agg.a = +s.agg.a;
          if (s.agg.df >= 1 && s.agg.df <= 3) d.agg.df = +s.agg.df;
          d.agg.kf = (s.agg.kf > 0) ? +s.agg.kf : null;
          if (AGG_COLORS.includes(s.agg.color)) d.agg.color = s.agg.color;
          if (s.agg.method === 'pc' || s.agg.method === 'cca') d.agg.method = s.agg.method;
          if (isFinite(s.agg.sigma)) d.agg.sigma = clamp(+s.agg.sigma, 1, 1.4);
          if (s.agg.ns != null && isFinite(s.agg.ns)) d.agg.ns = clamp(Math.round(+s.agg.ns), 2, 500);
          d.agg.showNums = !!s.agg.showNums; d.agg.showRg = !!s.agg.showRg; d.agg.showGrowth = !!s.agg.showGrowth; d.agg.showMR = !!s.agg.showMR;
        }
        if (s.chain && s.chain.temp >= 0 && s.chain.temp <= 1) d.chain.temp = +s.chain.temp;
        if (s.aggCreate === 'box' || s.aggCreate === 'circle') d.aggCreate = s.aggCreate;
        if (s.hand === 'left' || s.hand === 'right') d.hand = s.hand;
        if (s.spinStyle === 'rotate' || s.spinStyle === 'rock') d.spinStyle = s.spinStyle;
        if ([0.5, 0.8, 1, 1.25, 1.5].includes(+s.ovScale)) d.ovScale = +s.ovScale;
        else if (s.spinStyle === 'turn') d.spinStyle = 'rotate';   // earlier name
        if (s.gen && typeof s.gen === 'object') {   // from the short-lived global setting
          if (s.gen.kf != null && isFinite(s.gen.kf)) d.agg.kf = clamp(+s.gen.kf, 0.5, 2.5);
          if (s.gen.ns != null && isFinite(s.gen.ns)) d.agg.ns = clamp(Math.round(+s.gen.ns), 2, 500);
        }
      }
    } catch (_) {}
    return d;
  })();
  function saveSettings() {
    try { localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  // ============================================================
  // Notebook model
  // ------------------------------------------------------------
  // Items are immutable: every change creates a new object and a new items
  // array, so undo snapshots are just references to earlier arrays.
  //   stroke: { id, type:'stroke', color, width, points:[x,y,p, ...] }
  //   agg:    { id, type:'agg', x,y,w,h (box), a, df, kf|null, seed, color,
  //             R:[9], pts:Float32Array|null (radii, box-centred), n, rg,
  //             dfFit, capped, needsGen,
  //             kind:'agg'|'chain', edited?, genBox?, path? (chains), temp? (chains) }
  //   A 'chain' is drawn by hand (particle stroke) and re-laid along its path.
  //   An 'edited' aggregate contains merged hand-drawn chains and is never regenerated.
  // ============================================================
  function newNotebook() {
    const t = Date.now();
    return {
      format: CONFIG.FORMAT, version: CONFIG.FORMAT_VERSION,
      id: uid(), title: 'Notebook', created: t, modified: t,
      page: { w: PW, h: PH }, current: 0,
      pages: [{ id: uid(), items: [] }],
    };
  }
  let nb = newNotebook();
  const curPage = () => nb.pages[nb.current];
  const items = () => curPage().items;

  // ---------- undo (per page, in memory) ----------
  const histories = new Map();
  function hist() {
    const id = curPage().id;
    let h = histories.get(id);
    if (!h) { h = { undo: [], redo: [] }; histories.set(id, h); }
    return h;
  }
  function pushUndo() {
    const h = hist();
    h.undo.push(curPage().items);
    if (h.undo.length > 200) h.undo.shift();
    h.redo = [];
  }
  function setItems(arr) { curPage().items = arr; afterChange(); }
  function findItem(id) { return items().find(it => it.id === id) || null; }
  function replaceItem(ni) { setItems(items().map(it => (it.id === ni.id ? ni : it))); }

  function afterChange() {
    nb.modified = Date.now();
    if (selection) {
      const ids = new Set(items().map(it => it.id));
      for (const id of [...selection]) if (!ids.has(id)) selection.delete(id);
      if (!selection.size) selection = null;
    }
    scheduleSave();
    updateChrome();
    refreshPanel();
    if (typeof refreshDfScale === 'function') refreshDfScale();
    requestRender();
  }

  function undo() {
    if (pendingDot) { clearTimeout(pendingDot.timer); pendingDot = null; requestRender(); return; }
    const h = hist();
    if (!h.undo.length) return;
    h.redo.push(curPage().items);
    curPage().items = h.undo.pop();
    invalidateGen();
    afterChange();
    ensureGenerated(curPage());
  }
  function redo() {
    const h = hist();
    if (!h.redo.length) return;
    h.undo.push(curPage().items);
    curPage().items = h.redo.pop();
    invalidateGen();
    afterChange();
    ensureGenerated(curPage());
  }

  // ============================================================
  // View (page <-> screen)
  // ============================================================
  const view = { scale: 1, ox: 0, oy: 0, fit: true, fitScale: 1 };
  let gestureActive = false;

  function toPage(pt) { return { x: (pt.x - view.ox) / view.scale, y: (pt.y - view.oy) / view.scale }; }
  function toScreen(x, y) { return { x: view.ox + x * view.scale, y: view.oy + y * view.scale }; }

  function fitPage() {
    const W = window.innerWidth, H = window.innerHeight;
    const top = $('toolbar').getBoundingClientRect().bottom + 10;
    const bottom = 14;   // no bottom bar: the page may use the full height below the toolbar
    const availH = Math.max(100, H - top - bottom);
    const ph = pageH(curPage());
    const s = Math.max(0.05, Math.min((W - 24) / PW, availH / ph));
    view.scale = s; view.fitScale = s;
    view.ox = (W - PW * s) / 2;
    view.oy = top + (availH - ph * s) / 2;
    view.fit = true;
    requestRender();
  }
  function zoomAbout(cx, cy, ratio) {
    const ns = clamp(view.scale * ratio, view.fitScale * 0.4, view.fitScale * 12);
    const r = ns / view.scale;
    view.ox = cx - (cx - view.ox) * r;
    view.oy = cy - (cy - view.oy) * r;
    view.scale = ns;
    view.fit = false;
  }

  function resize() {
    const d = dpr(), W = window.innerWidth, H = window.innerHeight;
    for (const c of [board, overlay]) {
      c.width = Math.round(W * d); c.height = Math.round(H * d);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    if (view.fit) fitPage();
    requestRender();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // ============================================================
  // Strokes: geometry and drawing
  // ============================================================
  const strokeCache = new WeakMap();
  function pressureWidth(base, p) { return base * (0.35 + 0.9 * p); }

  // Variable-width stroke as runs of quadratic segments with constant width.
  // Round caps/joins make the runs blend; robust at sharp corners.
  // Variable-width stroke as runs of constant width. Segments are Catmull-Rom
  // splines through every sample, so fast (sparsely sampled) handwriting keeps
  // its shape. Round caps/joins make consecutive runs blend seamlessly.
  // Stroke geometry as runs of constant width, each a list of path commands.
  // Used for the screen (Path2D) and for SVG export, so both look identical.
  // Freehand: Catmull-Rom splines through every sample (keeps fast handwriting
  // in shape); snapped shapes: straight segments, constant width.
  function strokeRuns(pts, base, straight) {
    const n = pts.length / 3, runs = [];
    if (!n) return runs;
    const q = Math.max(0.25, base * 0.1);
    const wq = (p) => Math.max(q, Math.round(pressureWidth(base, p) / q) * q);
    if (straight && n >= 2) {
      const cmds = [['M', pts[0], pts[1]]];
      for (let i = 1; i < n; i++) cmds.push(['L', pts[3 * i], pts[3 * i + 1]]);
      runs.push({ w: wq(pts[2]), cmds });
      return runs;
    }
    if (n === 1) {
      runs.push({ w: wq(pts[2]), cmds: [['M', pts[0], pts[1]], ['L', pts[0] + 0.01, pts[1]]] });
      return runs;
    }
    const X = (i) => pts[3 * clamp(i, 0, n - 1)], Y = (i) => pts[3 * clamp(i, 0, n - 1) + 1];
    let cur = null, curW = -1;
    for (let i = 0; i < n - 1; i++) {
      const w = wq((pts[3 * i + 2] + pts[3 * i + 5]) / 2);
      const x0 = X(i), y0 = Y(i), x1 = X(i + 1), y1 = Y(i + 1);
      if (w !== curW) { cur = [['M', x0, y0]]; curW = w; runs.push({ w, cmds: cur }); }
      cur.push(['C', x0 + (x1 - X(i - 1)) / 6, y0 + (y1 - Y(i - 1)) / 6, x1 - (X(i + 2) - x0) / 6, y1 - (Y(i + 2) - y0) / 6, x1, y1]);
    }
    return runs;
  }
  function buildRuns(pts, base, straight) {
    return strokeRuns(pts, base, straight).map(({ w, cmds }) => {
      const path = new Path2D();
      for (const c of cmds) {
        if (c[0] === 'M') path.moveTo(c[1], c[2]);
        else if (c[0] === 'L') path.lineTo(c[1], c[2]);
        else path.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      }
      return { w, path };
    });
  }
  function strokeBBox(s) {
    const p = s.points, pad = s.width * 0.75;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
  function strokeGeom(s) {
    let g = strokeCache.get(s);
    if (!g) { g = { runs: buildRuns(s.points, s.width, s.straight), bbox: strokeBBox(s) }; strokeCache.set(s, g); }
    return g;
  }
  function drawRuns(ctx, runs, color) {
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of runs) { ctx.lineWidth = r.w; ctx.stroke(r.path); }
  }
  // ---------- board themes ----------
  // Strokes keep their logical colour; on a dark board each colour is shown as a
  // bright, chalk-like variant, so switching back shows them exactly as written.
  const THEMES = {
    light: { page: '#ffffff', desk: '#e9e9ee', mist: { r: 255, g: 255, b: 255 }, shadow: 1, cursor: 'rgba(60,60,70,0.8)', cursorFill: 'rgba(255,255,255,0.35)' },
    dark: { page: '#1f2428', desk: '#3a3e44', mist: { r: 31, g: 36, b: 40 }, shadow: 0, cursor: 'rgba(235,235,230,0.85)', cursorFill: 'rgba(255,255,255,0.08)' },
  };
  const DARK_INK = { '#1d1d22': '#f1f1ec', '#1f5bd6': '#7fb0ff', '#d1342f': '#ff7a70', '#2b8a3e': '#6fd88a', '#e8860c': '#ffbb55' };
  const darkInkCache = new Map();
  function inkFor(color, theme) {
    if (theme !== 'dark') return color;
    if (DARK_INK[color]) return DARK_INK[color];
    let v = darkInkCache.get(color);
    if (!v) {   // any other colour: keep the hue, make it light enough for a dark board
      const c = hexToRgb(color), h = rgbToHsl(c.r, c.g, c.b);
      const q = hslToRgb(h.h, Math.min(h.s, 85), Math.max(65, 100 - h.l * 0.5));
      v = `rgb(${Math.round(q.r)},${Math.round(q.g)},${Math.round(q.b)})`;
      darkInkCache.set(color, v);
    }
    return v;
  }
  const themeOf = (pg) => (pg && pg.bg === 'dark' ? 'dark' : 'light');
  let renderTheme = 'light';     // theme used by sphere rendering (set before drawing a page)
  function drawStroke(ctx, s, theme = renderTheme) { drawRuns(ctx, strokeGeom(s).runs, inkFor(s.color, theme)); }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function distToStroke(s, x, y) {
    const p = s.points;
    if (p.length === 3) return Math.hypot(x - p[0], y - p[1]);
    let best = Infinity;
    for (let i = 3; i < p.length; i += 3) {
      const d = distToSegment(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]);
      if (d < best) best = d;
    }
    return best;
  }

  // ============================================================
  // Aggregates: sphere rendering and bitmap cache
  // ============================================================
  const SPR_EXT = 1.4, LEVELS = 24, DEPTH = 0.5;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
  }
  const hslCache = new Map();
  function hslOf(color) {
    let v = hslCache.get(color);
    if (!v) { const c = hexToRgb(color); v = rgbToHsl(c.r, c.g, c.b); hslCache.set(color, v); }
    return v;
  }
  function stopColor(hsl, light, mist) {
    const c = hslToRgb(hsl.h, hsl.s, clamp(light, 0, 100));
    const mix = (a, b) => Math.round(a + (b - a) * mist);
    const M = THEMES[renderTheme].mist;
    return `rgb(${mix(c.r, M.r)},${mix(c.g, M.g)},${mix(c.b, M.b)})`;
  }
  // Sphere shading per board, shared by screen rendering and SVG export. t = depth (0 back, 1 front).
  // On the dark board, back spheres stay brighter, fade less into the board, and get a light rim
  // instead of a dark outline, so aggregates read clearly on a projector.
  const SHADE = {
    light: { bMin: 0.55, mist: 0.65, edgeMin: 20, edgeBase: 10 },
    dark:  { bMin: 0.78, mist: 0.32, edgeMin: 36, edgeBase: 24 },
  };
  function shade(t) {
    const S = SHADE[renderTheme] || SHADE.light;
    const brightness = S.bMin + (1 - S.bMin) * t;
    const mist = DEPTH * S.mist * (1 - t);
    return { brightness, mist, l0: 85 + brightness * 8, l1: 55 * brightness + 20, l2: Math.max(S.edgeMin, 25 * brightness + S.edgeBase) };
  }
  function outlineStyle(t) {
    if (renderTheme === 'dark') return `rgba(225,232,245,${(0.16 + 0.14 * t).toFixed(3)})`;
    const mist = DEPTH * 0.65 * (1 - t);
    return `rgba(20,25,40,${((0.35 + 0.25 * (1 - t)) * (1 - mist)).toFixed(3)})`;
  }
  function renderSphere(c, sx, sy, r, t, color, outline) {
    const hsl = hslOf(color);
    const { mist, l0, l1, l2 } = shade(t);
    c.beginPath();
    c.arc(sx + r * 0.15, sy + r * 0.2, r * 0.95, 0, Math.PI * 2);
    c.fillStyle = `rgba(0,0,0,${(0.05 + 0.08 * t) * (1 - mist * 0.8) * THEMES[renderTheme].shadow})`;
    c.fill();
    const g = c.createRadialGradient(sx - r * 0.4, sy - r * 0.4, r * 0.1, sx, sy, r);
    g.addColorStop(0, stopColor(hsl, l0, mist));
    g.addColorStop(0.55, stopColor(hsl, l1, mist));
    g.addColorStop(1, stopColor(hsl, l2, mist));
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    if (outline) { c.lineWidth = Math.max(0.6, r * 0.06); c.strokeStyle = outlineStyle(t); c.stroke(); }
  }
  const spriteCache = new Map();
  function getSprite(color, level, S) {
    const key = renderTheme + '|' + color + '|' + level + '|' + S;
    let spr = spriteCache.get(key);
    if (!spr) {
      spr = document.createElement('canvas');
      spr.width = spr.height = S;
      renderSphere(spr.getContext('2d'), S / 2, S / 2, S / (2 * SPR_EXT), level / (LEVELS - 1), color, false);
      spriteCache.set(key, spr);
      if (spriteCache.size > 600) spriteCache.delete(spriteCache.keys().next().value);
    }
    return spr;
  }
  function drawSphere(c, sx, sy, r, level, color) {
    const need = 2 * SPR_EXT * r;
    if (need > 256) { renderSphere(c, sx, sy, r, level / (LEVELS - 1), color, true); return; }
    let S = 8; while (S < need) S *= 2;
    const ext = SPR_EXT * r;
    c.drawImage(getSprite(color, level, S), sx - ext, sy - ext, 2 * ext, 2 * ext);
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.lineWidth = Math.max(0.6, r * 0.06);
    c.strokeStyle = outlineStyle(level / (LEVELS - 1));
    c.stroke();
  }

  // Monomer radius the stored coordinates were generated for. While a regeneration
  // is pending, the displayed structure keeps its own size (it.aGen) instead of
  // being stretched to the newly requested monomer size.
  const ptsScale = (it) => it.aGen || it.a;
  // "How it was built" colouring (overlay): particle-cluster aggregates by growth order
  // (purple = first, centre -> yellow = last, rim); cluster-cluster aggregates by subcluster
  // (groups); hand-drawn parts of edited aggregates in neutral grey. Only the hue counts;
  // the depth shading stays as usual.
  const ORDER_RAMP = (() => {
    const A = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]], out = [];
    for (let k = 0; k < 24; k++) {
      const f = k / 23 * (A.length - 1), i = Math.min(A.length - 2, Math.floor(f)), u = f - i;
      const c = A[i].map((v, j) => Math.round(v + (A[i + 1][j] - v) * u));
      out.push('#' + c.map(v => v.toString(16).padStart(2, '0')).join(''));
    }
    return out;
  })();
  const GROUP_PAL = Array.from({ length: 24 }, (_, k) => {
    const c = hslToRgb((k * 15) % 360, 68, 52);
    return '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  });
  const NEUTRAL_SPHERE = '#9a9aa2';
  const growthKind = (it) => (it.kind === 'chain' ? null : it.groups ? 'subclusters' : 'order');
  function sphereColorFn(it) {
    if (!it.showGrowth || !growthKind(it)) return null;
    const nGen = it.nGen != null ? it.nGen : it.n;
    if (it.groups) return (i) => (i < nGen ? GROUP_PAL[(it.groups[i] * 7) % 24] : NEUTRAL_SPHERE);   // 7 is coprime to 24: neighbours differ
    return (i) => (i < nGen ? ORDER_RAMP[Math.min(23, Math.floor((i / Math.max(1, nGen)) * 24))] : NEUTRAL_SPHERE);
  }
  // Monomer radius relative to the aggregate's monomer size a (= a_g, the geometric mean radius).
  // Monodisperse aggregates store no radii: every monomer has radius 1.
  const radOf = (it, i) => (it.radii ? it.radii[i] : 1);
  const maxRad = (it) => { if (!it.radii) return 1; let m = 0; for (let i = 0; i < it.n; i++) if (it.radii[i] > m) m = it.radii[i]; return m; };
  // Render an aggregate into its own canvas. ppu = device pixels per page unit.
  function renderAggBitmap(it, ppu) {
    const n = it.n, P = it.pts, a = ptsScale(it), R = it.R, colorOf = sphereColorFn(it);
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      xs[i] = (R[0] * x + R[1] * y + R[2] * z) * a;
      ys[i] = (R[3] * x + R[4] * y + R[5] * z) * a;
      zs[i] = R[6] * x + R[7] * y + R[8] * z;
      if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
      if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
      if (zs[i] < zmin) zmin = zs[i]; if (zs[i] > zmax) zmax = zs[i];
    }
    const pad = a * SPR_EXT * maxRad(it);
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const bw = x1 - x0, bh = y1 - y0;
    ppu = Math.min(ppu, 2048 / Math.max(bw, bh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(bw * ppu));
    canvas.height = Math.max(1, Math.ceil(bh * ppu));
    const c = canvas.getContext('2d');
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => zs[i] - zs[j]);
    const zr = Math.max(1e-6, zmax - zmin);
    for (const i of order) {
      const level = clamp(Math.round(((zs[i] - zmin) / zr) * (LEVELS - 1)), 0, LEVELS - 1);
      drawSphere(c, (xs[i] - x0) * ppu, (ys[i] - y0) * ppu, a * radOf(it, i) * ppu, level, colorOf ? colorOf(i) : it.color);
    }
    return { canvas, ppu, ox: x0, oy: y0 };
  }
  const aggBmpCache = new WeakMap();   // pts -> { sig, entry }
  function aggSig(it) { return renderTheme + '|' + ptsScale(it) + '|' + (it.radii ? 'p' : '') + '|' + it.color + '|' + (it.showGrowth ? 'g' + (it.nGen != null ? it.nGen : '') : '') + '|' + it.R.join(','); }
  function getAggBitmap(it, ppu, allowStale) {
    if (!it.pts || !it.n) return null;
    const sig = aggSig(it);
    const e = aggBmpCache.get(it.pts);
    if (e && e.sig === sig) {
      const ok = allowStale || (e.bmp.ppu >= ppu * 0.7 && e.bmp.ppu <= ppu * 1.6) || (e.capped && ppu >= e.bmp.ppu);
      if (ok) return e.bmp;
    }
    const bmp = renderAggBitmap(it, ppu);
    aggBmpCache.set(it.pts, { sig, bmp, capped: bmp.ppu < ppu * 0.99 });
    return bmp;
  }
  function drawAgg(ctx, it, ppu, allowStale, unit) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const bmp = getAggBitmap(it, ppu, allowStale);
    if (!bmp) {
      ctx.save();
      ctx.setLineDash([6 * unit, 4 * unit]);
      ctx.lineWidth = 1.5 * unit;
      ctx.strokeStyle = 'rgba(60,120,200,0.6)';
      ctx.strokeRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = 'rgba(60,120,200,0.7)';
      ctx.font = `${13 * unit}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Building…', cx, cy);
      ctx.restore();
      return;
    }
    if (it.needsGen) ctx.globalAlpha = 0.7;
    ctx.drawImage(bmp.canvas, cx + bmp.ox, cy + bmp.oy, bmp.canvas.width / bmp.ppu, bmp.canvas.height / bmp.ppu);
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // Aggregate generation (Web Worker, latest-request-wins)
  // ============================================================
  let worker = null, workerBusy = false;
  const pendingGen = new Map();   // item id -> message
  const latestToken = new Map();  // item id -> token of the newest request
  const shownToken = new Map();   // item id -> token of the result currently displayed
  let tokenSeq = 0;
  const PREVIEW_ID = '__circle_preview__';
  try {
    worker = new Worker('aggregate-engine.js?v=' + VERSION);
    worker.onmessage = onGenMessage;
    worker.onerror = (e) => {
      console.warn('Aggregate worker failed, using main thread:', e.message);
      e.preventDefault && e.preventDefault();
      worker = null; workerBusy = false; pumpGen();
    };
  } catch (_) { worker = null; }

  function requestGen(it) {
    const token = ++tokenSeq;
    latestToken.set(it.id, token);
    pendingGen.set(it.id, {
      type: 'fit', id: it.id, token,
      W: it.w / it.a, H: it.h / it.a, df: it.df, kf: it.kf, seed: it.seed, nMax: CONFIG.N_MAX, method: it.method === 'cca' ? 'cca' : 'pc', a: it.a,
      sigma: it.sigma > 1 ? it.sigma : 1, ns: it.ns || null,
      shape: it.fitShape === 'circle' ? 'circle' : undefined,
    });
    pumpGen();
    return token;
  }
  function pumpGen() {
    if (workerBusy || !pendingGen.size) return;
    const [id, msg] = pendingGen.entries().next().value;
    pendingGen.delete(id);
    workerBusy = true;
    if (worker) { worker.postMessage(msg); return; }
    setTimeout(() => {
      let data;
      try { data = { type: 'result', id: msg.id, token: msg.token, genA: msg.a, ...window.AggEngine.fitBox(msg) }; }
      catch (err) { data = { type: 'error', id: msg.id, token: msg.token, message: String(err) }; }
      onGenMessage({ data });
    }, 0);
  }
  function onGenMessage(e) {
    workerBusy = false;
    const m = e.data;
    if (m && m.id === PREVIEW_ID) {           // circle gesture preview, not a page item
      if (m.type === 'result' && latestToken.get(PREVIEW_ID) === m.token) {
        latestToken.delete(PREVIEW_ID);
        onCirclePreview(m);
      }
      pumpGen();
      return;
    }
    // Show any result that is newer than the one on screen: intermediate results keep
    // the aggregate updating live while a slider is dragged, even when generation is slower
    // than the slider; only the newest request's result ends the update.
    const latest = latestToken.get(m && m.id);
    if (m && m.type === 'result' && latest != null && m.token <= latest && m.token > (shownToken.get(m.id) || 0)) {
      shownToken.set(m.id, m.token);
      applyGen(m, m.token === latest);
    }
    else if (m && m.type === 'error') console.warn('Aggregate generation failed:', m.message);
    pumpGen();
  }
  function applyGen(m, final = true) {
    if (final) { latestToken.delete(m.id); shownToken.delete(m.id); }
    for (const pg of nb.pages) {
      const idx = pg.items.findIndex(it => it.id === m.id);
      if (idx < 0) continue;
      const it = pg.items[idx];
      const arr = pg.items.slice();
      // Generated coordinates are aligned with the box, so the rotation starts fresh.
      arr[idx] = { ...it, pts: m.pts, n: m.n, rg: m.rg, dfFit: m.dfFit, kfUsed: m.kf, capped: !!m.capped, needsGen: !final, R: IDENTITY.slice(),
        aniso: m.aniso, ccaFallback: !!m.ccaFallback, aGen: (m.genA && Math.abs(m.genA - it.a) > 1e-9) ? m.genA : undefined,
        groups: m.groups || undefined, radii: m.radii || undefined, nGen: undefined };
      if (final && m.capped && !it.capped && pg === curPage()) toast(`Limit of ${CONFIG.N_MAX} monomers reached, so the aggregate is smaller than its box. Increase the monomer size to fill it.`, 5000);
      pg.items = arr;
      nb.modified = Date.now();
      scheduleSave();
      if (pg === curPage()) { refreshPanel(); requestRender(); }
      return;
    }
  }
  function invalidateGen() { latestToken.clear(); pendingGen.clear(); shownToken.clear(); }
  function ensureGenerated(pg) {
    for (const it of pg.items) {
      if (it.type === 'agg' && it.kind !== 'chain' && !it.edited && (it.needsGen || !it.pts) && !latestToken.has(it.id)) requestGen(it);
    }
  }

  // ============================================================
  // Shape snapping: hold the pencil still at the end of a stroke and the stroke
  // is replaced by the recognised shape (line, polyline, arrow, polygon,
  // rectangle, ellipse/circle). Coordinates in page units.
  // ============================================================
  const HOLD_MS = 450, HOLD_SLOP = 5, UNSNAP_PX = 14;
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function pathLength(P) { let L = 0; for (let i = 1; i < P.length; i++) L += d2(P[i - 1], P[i]); return L; }
  function resample(P, n) {
    const L = pathLength(P);
    if (L === 0) return [P[0].slice()];
    const out = [P[0].slice()], step = L / (n - 1);
    let acc = 0;
    for (let i = 1; i < P.length; i++) {
      let a = P[i - 1], b = P[i], seg = d2(a, b);
      while (acc + seg >= step && out.length < n) {
        const t = (step - acc) / seg;
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        out.push(q); a = q; seg = d2(a, b); acc = 0;
      }
      acc += seg;
    }
    while (out.length < n) out.push(P[P.length - 1].slice());
    return out;
  }
  function segDist(p, a, b) { return distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]); }
  function rdp(P, eps) {
    if (P.length < 3) return P.slice();
    let idx = -1, dmax = 0;
    for (let i = 1; i < P.length - 1; i++) { const d = segDist(P[i], P[0], P[P.length - 1]); if (d > dmax) { dmax = d; idx = i; } }
    if (dmax <= eps) return [P[0], P[P.length - 1]];
    const A = rdp(P.slice(0, idx + 1), eps), B = rdp(P.slice(idx), eps);
    return A.slice(0, -1).concat(B);
  }
  const angleAt = (a, b, c) => {
    const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
    return Math.acos(clamp((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1), -1, 1)) * 180 / Math.PI;
  };
  // Mean distance of points to a polyline (closed or open).
  function polyError(R, V, closed) {
    let s = 0;
    for (const p of R) {
      let m = Infinity;
      const k = closed ? V.length : V.length - 1;
      for (let i = 0; i < k; i++) m = Math.min(m, segDist(p, V[i], V[(i + 1) % V.length]));
      s += m;
    }
    return s / R.length;
  }
  // Snap a direction to 0/45/90/... degrees if within tol degrees.
  function snapAngle(ang, tol, step = 45) {
    const deg = ang * 180 / Math.PI, near = Math.round(deg / step) * step;
    return Math.abs(deg - near) <= tol ? near * Math.PI / 180 : ang;
  }
  function straightenOpen(V) {
    const out = [V[0].slice()];
    for (let i = 1; i < V.length; i++) {
      const a = out[i - 1], b = V[i], len = d2(a, b);
      const ang = snapAngle(Math.atan2(b[1] - a[1], b[0] - a[0]), 6, 90);
      out.push([a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]);
    }
    return out;
  }
  function arrowShape(tail, tip, headLen) {
    const ang = snapAngle(Math.atan2(tip[1] - tail[1], tip[0] - tail[0]), 4);
    const L = d2(tail, tip);
    const t2 = [tail[0] + L * Math.cos(ang), tail[1] + L * Math.sin(ang)];
    const h = clamp(headLen, L * 0.08, L * 0.3), spread = 28 * Math.PI / 180;
    const b1 = [t2[0] - h * Math.cos(ang - spread), t2[1] - h * Math.sin(ang - spread)];
    const b2 = [t2[0] - h * Math.cos(ang + spread), t2[1] - h * Math.sin(ang + spread)];
    return { kind: 'arrow', straight: true, pts: [tail, t2, b1, t2, b2] };
  }
  function lineShape(a, b) {
    const ang = snapAngle(Math.atan2(b[1] - a[1], b[0] - a[0]), 4), L = d2(a, b);
    return { kind: 'line', straight: true, pts: [a, [a[0] + L * Math.cos(ang), a[1] + L * Math.sin(ang)]] };
  }
  function isLine(R) {
    const a = R[0], b = R[R.length - 1], chord = d2(a, b), L = pathLength(R);
    if (chord < 1e-6 || chord / L < 0.94) return false;
    let m = 0; for (const p of R) m = Math.max(m, segDist(p, a, b));
    return m < Math.max(0.045 * chord, 1.5);
  }
  function fitEllipse(R) {
    let cx = 0, cy = 0;
    for (const p of R) { cx += p[0]; cy += p[1]; }
    cx /= R.length; cy /= R.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of R) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
    sxx /= R.length; syy /= R.length; sxy /= R.length;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
    let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2);
    const c = Math.cos(th), s = Math.sin(th);
    let err = 0;
    for (const p of R) {
      const x = p[0] - cx, y = p[1] - cy, u = c * x + s * y, v = -s * x + c * y;
      err += Math.abs(Math.hypot(u / a, v / b) - 1) * Math.sqrt(a * b);
    }
    return { cx, cy, a, b, th, err: err / R.length };
  }
  function ellipseShape(e) {
    let { cx, cy, a, b, th } = e;
    if (b / a > 0.86) { a = b = (a + b) / 2; th = 0; }
    else th = snapAngle(th, 10, 90);
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * 2 * Math.PI, u = a * Math.cos(t), v = b * Math.sin(t);
      pts.push([cx + u * Math.cos(th) - v * Math.sin(th), cy + u * Math.sin(th) + v * Math.cos(th)]);
    }
    return { kind: a === b ? 'circle' : 'ellipse', straight: false, pts };
  }
  function polygonShape(V) {
    if (V.length === 4 && V.every((_, i) => Math.abs(angleAt(V[(i + 3) % 4], V[i], V[(i + 1) % 4]) - 90) < 18)) {
      // rectangle: common orientation from the edges, squared corners
      let sx = 0, sy = 0;
      for (let i = 0; i < 4; i++) {
        const a = V[i], b = V[(i + 1) % 4];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 4;   // fold to a 90-degree period
        sx += Math.cos(ang) * d2(a, b); sy += Math.sin(ang) * d2(a, b);
      }
      let th = Math.atan2(sy, sx) / 4;
      th = snapAngle(th, 6, 90);
      const c = Math.cos(th), s = Math.sin(th);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of V) { const u = c * p[0] + s * p[1], v = -s * p[0] + c * p[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const back = (u, v) => [c * u - s * v, s * u + c * v];
      const pts = [back(u0, v0), back(u1, v0), back(u1, v1), back(u0, v1)];
      return { kind: 'rectangle', straight: true, pts: [...pts, pts[0]] };
    }
    return { kind: V.length === 3 ? 'triangle' : 'polygon', straight: true, pts: [...V.map(p => p.slice()), V[0].slice()] };
  }
  // Is R a "V" (arrowhead) whose apex sits on the end of the previous straight stroke?
  function arrowFromHead(R, diag) {
    const V = rdp(R, 0.12 * diag);
    if (V.length !== 3) return null;
    const [p, apex, q] = V, ang = angleAt(p, apex, q);
    const l1 = d2(p, apex), l2 = d2(q, apex);
    if (ang < 20 || ang > 130 || Math.max(l1, l2) / Math.min(l1, l2) > 2.6) return null;
    const list = items();
    const prev = list[list.length - 1];
    if (!prev || prev.type !== 'stroke') return null;
    const PP = [];
    for (let i = 0; i < prev.points.length; i += 3) PP.push([prev.points[i], prev.points[i + 1]]);
    if (PP.length < 2 || !isLine(resample(PP, 32))) return null;
    const A = PP[0], B = PP[PP.length - 1];
    const tol = Math.max(0.6 * (l1 + l2) / 2, 14 / view.scale);
    for (const [tip, tail] of [[B, A], [A, B]]) {
      if (d2(apex, tip) > tol) continue;
      const bis = [(p[0] + q[0]) / 2 - apex[0], (p[1] + q[1]) / 2 - apex[1]];
      const dir = [tip[0] - tail[0], tip[1] - tail[1]];
      const cosb = (bis[0] * dir[0] + bis[1] * dir[1]) / (Math.hypot(...bis) * Math.hypot(...dir) || 1);
      if (cosb > -0.5) continue;   // the V must open back along the line
      const sh = arrowShape(tail, tip, (l1 + l2) / 2);
      sh.replaceId = prev.id;
      return sh;
    }
    return null;
  }
  // Every piece of a polyline must be straight on its own (curves approximated by
  // several short pieces fail this): max deviation <= 6% of the piece length.
  function piecesStraight(R, V) {
    for (let i = 0; i < V.length - 1; i++) {
      const a = V[i], b = V[i + 1], len = d2(a, b);
      // points of R closest to this piece
      let m = 0;
      for (const p of R) {
        let best = Infinity, bi = -1;
        for (let j = 0; j < V.length - 1; j++) { const dd = segDist(p, V[j], V[j + 1]); if (dd < best) { best = dd; bi = j; } }
        if (bi === i) m = Math.max(m, best);
      }
      if (m > 0.06 * len + 1) return false;
    }
    return true;
  }
  function recognizeShape(raw) {
    const P = [];
    for (let i = 0; i < raw.length; i += 3) P.push([raw[i], raw[i + 1]]);
    if (P.length < 3) return null;
    const L = pathLength(P);
    if (L * view.scale < 20) return null;
    const R = resample(P, 64);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of R) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const diag = Math.hypot(x1 - x0, y1 - y0) || 1;
    if (isLine(R)) return lineShape(R[0], R[R.length - 1]);
    const head = arrowFromHead(R, diag);
    if (head) return head;
    const closed = d2(R[0], R[R.length - 1]) < Math.max(0.2 * diag, 10 / view.scale);
    if (closed) {
      // polygon: start the ring at the point farthest from the centre (a likely corner)
      let cx = 0, cy = 0; for (const p of R) { cx += p[0]; cy += p[1]; } cx /= R.length; cy /= R.length;
      let k0 = 0; R.forEach((p, i) => { if (Math.hypot(p[0] - cx, p[1] - cy) > Math.hypot(R[k0][0] - cx, R[k0][1] - cy)) k0 = i; });
      const ring = R.slice(k0).concat(R.slice(0, k0 + 1));
      let V = rdp(ring, 0.055 * diag).slice(0, -1);
      // drop nearly straight vertices
      for (let changed = true; changed && V.length > 3;) {
        changed = false;
        for (let i = 0; i < V.length; i++) {
          if (angleAt(V[(i + V.length - 1) % V.length], V[i], V[(i + 1) % V.length]) > 158) { V.splice(i, 1); changed = true; break; }
        }
      }
      const polyErr = V.length >= 3 ? polyError(R, V, true) / diag : Infinity;
      const ell = fitEllipse(R), ellErr = ell.err / diag;
      // Real polygons have distinct corners; a smooth curve approximated by many sides does not.
      const maxCorner = V.length >= 3 ? Math.max(...V.map((v, i) => angleAt(V[(i + V.length - 1) % V.length], v, V[(i + 1) % V.length]))) : 180;
      const cornersOk = V.length <= 4 || maxCorner <= 140;
      if (V.length >= 3 && V.length <= 8 && cornersOk && polyErr < 0.03 && (polyErr < ellErr || ellErr > 0.05)) return polygonShape(V);
      if (ellErr < 0.06) return ellipseShape(ell);
      return null;
    }
    const V = rdp(R, 0.06 * diag);
    const openErr = polyError(R, V, false) / diag;
    if (openErr > 0.035) return null;
    if (V.length >= 3) {
      // one-stroke arrow: a long shaft, then short strokes near its end
      const shaft = d2(V[0], V[1]);
      const rest = V.slice(2);
      const sharpTip = angleAt(V[0], V[1], V[2]) < 65;   // the head turns back sharply at the tip
      if (sharpTip && openErr < 0.03 && rest.every(v => d2(v, V[1]) < 0.4 * shaft) && V.slice(1).every((v, i, arr) => i === 0 || d2(arr[i - 1], v) * 2.5 < shaft)) {
        const barb = rest.reduce((m, v) => Math.max(m, d2(v, V[1])), 0);
        return arrowShape(V[0], V[1], barb);
      }
    }
    // Angled lines (axes, zigzags): pieces must be genuinely straight with distinct corners,
    // so curvy handwriting such as an "S" is left alone.
    const inner = V.slice(1, -1).map((v, i) => angleAt(V[i], v, V[i + 2]));
    if (V.length <= 5 && openErr < 0.018 && inner.every(a => a < 130) && piecesStraight(R, V)) return { kind: 'polyline', straight: true, pts: straightenOpen(V) };
    return null;
  }
  function shapeStroke(a, sh) {
    let ps = 0; const n = a.pts.length / 3;
    for (let i = 0; i < n; i++) ps += a.pts[3 * i + 2];
    const p = Math.round((ps / n) * 100) / 100;
    const pts = [];
    for (const q of sh.pts) pts.push(Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10, p);
    const st = { id: uid(), type: 'stroke', color: a.color, width: a.width, points: pts };
    if (sh.straight) st.straight = true;
    return st;
  }
  let holdTimer = 0;
  function armHold() {
    clearTimeout(holdTimer);
    const a = action;
    holdTimer = setTimeout(() => {
      if (action !== a || !a || a.kind !== 'draw' || a.snap) return;
      const sh = recognizeShape(a.pts);
      if (sh) { a.snap = sh; dlog('  -> snapped to ' + sh.kind); requestOverlay(); }
    }, HOLD_MS);
  }

  // ============================================================
  // Chains (particle strokes) and merging into aggregates
  // ------------------------------------------------------------
  // Coordinates: "view space" = page x, y plus depth z (page units, towards
  // the viewer), with each aggregate's own centre at depth 0.
  // ============================================================
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Projected sphere centres of an aggregate, relative to its box centre (cached).
  const viewCache = new WeakMap();
  function viewSpheres(it) {
    const sig = ptsScale(it) + '|' + (it.radii ? 'p' : '') + '|' + it.R.join(',');
    let e = viewCache.get(it.pts);
    if (e && e.sig === sig) return e;
    const n = it.n, P = it.pts, R = it.R, a = ptsScale(it);
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n), rs = new Float32Array(n);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2], r = a * radOf(it, i);
      xs[i] = (R[0] * x + R[1] * y + R[2] * z) * a;
      ys[i] = (R[3] * x + R[4] * y + R[5] * z) * a;
      zs[i] = (R[6] * x + R[7] * y + R[8] * z) * a;
      rs[i] = r;
      if (xs[i] - r < x0) x0 = xs[i] - r; if (xs[i] + r > x1) x1 = xs[i] + r;
      if (ys[i] - r < y0) y0 = ys[i] - r; if (ys[i] + r > y1) y1 = ys[i] + r;
    }
    e = { sig, xs, ys, zs, rs, x0, x1, y0, y1 };
    viewCache.set(it.pts, e);
    return e;
  }
  // Front-most sphere under page point p, searching the top-most aggregate first.
  function sphereAt(p) {
    const list = items();
    for (let k = list.length - 1; k >= 0; k--) {
      const it = list[k];
      if (it.type !== 'agg' || !it.pts || !it.n) continue;
      const v = viewSpheres(it);
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      const lx = p.x - cx, ly = p.y - cy;
      if (lx < v.x0 || lx > v.x1 || ly < v.y0 || ly > v.y1) continue;
      let best = -1, bz = -Infinity;
      for (let i = 0; i < it.n; i++) {
        const dx = lx - v.xs[i], dy = ly - v.ys[i];
        if (dx * dx + dy * dy <= v.rs[i] * v.rs[i] && v.zs[i] > bz) { bz = v.zs[i]; best = i; }
      }
      if (best >= 0) return { item: it, i: best, X: cx + v.xs[best], Y: cy + v.ys[best], Z: v.zs[best], r: v.rs[best] };
    }
    return null;
  }

  /*
   * Lay touching spheres (radius a) along a 2D path (flat [x,y,...], page units).
   * Depth runs linearly from z0 to z1 along the path. temp (0..1) jitters each
   * placement in 3D; every sphere still touches the previous one.
   * start/end: optional existing spheres {X,Y,Z,r} to attach to (r: their radius, default a).
   * obstacles: optional flat [X,Y,Z,r,...] of existing spheres (any radius) that new
   * spheres must not overlap; the chain also avoids itself.
   */
  // Drop path points closer than minD to the last kept one. A slowly drawn Pencil line
  // arrives as many sub-pixel points with a little tremor; their zigzag makes the path much
  // longer than the line, and a chain that advances along that length packs too many spheres
  // and folds back. Bends on the scale of a monomer are kept.
  function thinPath(path, minD) {
    const n = path.length / 2;
    if (n <= 2) return path;
    const out = [path[0], path[1]];
    for (let i = 1; i < n - 1; i++) {
      const x = path[2 * i], y = path[2 * i + 1];
      if (Math.hypot(x - out[out.length - 2], y - out[out.length - 1]) >= minD) out.push(x, y);
    }
    const lx = path[2 * n - 2], ly = path[2 * n - 1];
    if (out.length >= 4 && Math.hypot(lx - out[out.length - 2], ly - out[out.length - 1]) < minD * 0.5) { out[out.length - 2] = lx; out[out.length - 1] = ly; }
    else out.push(lx, ly);
    return out;
  }
  function layChain(path0, z0, z1, a, temp, seed, start, end, obstacles) {
    const rand = mulberry32((seed >>> 0) || 1);
    const path = thinPath(path0, 0.5 * a);
    const n = path.length / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]));
    const L = cum[n - 1];
    const M = Math.max(1, Math.min(20000, Math.ceil(L / Math.max(1e-3, a * 0.25))));
    const S = [];
    let seg = 0;
    for (let k = 0; k <= M; k++) {
      const s = L * k / M;
      while (seg < n - 2 && cum[seg + 1] < s) seg++;
      const segLen = n > 1 ? cum[seg + 1] - cum[seg] : 0;
      const t = segLen > 0 ? (s - cum[seg]) / segLen : 0;
      const i0 = Math.min(seg, n - 1), i1 = Math.min(seg + 1, n - 1);
      S.push([
        path[2 * i0] + (path[2 * i1] - path[2 * i0]) * t,
        path[2 * i0 + 1] + (path[2 * i1 + 1] - path[2 * i0 + 1]) * t,
        z0 + (z1 - z0) * (L > 0 ? s / L : 0),
      ]);
    }
    // Walk: each step aims one diameter beyond the chain's current position along the line,
    // plus correlated 3D noise; the pull towards the line keeps the chain near it.
    const D = 2 * a, out = [];
    // Noise as in the original drawing tool: every sphere independently shifted in 3D by
    // 0.6 T radii (T = 0..3 there; here temp = 0..1, so 1.8 temp radii), anchored to its own
    // point on the line, so deviations stay local and spread evenly along the chain.
    let jit = temp * a * 1.8;
    const h = L / M;
    const at = (sArc) => {
      const f = L > 0 ? Math.min(M, sArc / h) : 0, k0 = Math.floor(f), k1 = Math.min(M, k0 + 1), t = f - k0;
      return [S[k0][0] + (S[k1][0] - S[k0][0]) * t, S[k0][1] + (S[k1][1] - S[k0][1]) * t, S[k0][2] + (S[k1][2] - S[k0][2]) * t];
    };
    // Collision grid over obstacles and placed chain spheres; cell = largest contact distance.
    // Each entry is [x, y, z, r]. clear() is the smallest gap to any sphere (negative = overlap).
    let rObs = a;
    if (obstacles) for (let i = 3; i < obstacles.length; i += 4) if (obstacles[i] > rObs) rObs = obstacles[i];
    const CELL = a + rObs, TOL = -2e-4 * a;
    const grid = new Map(), OFF = 1 << 20;
    const key = (x, y, z) => ((Math.floor(x / CELL) + OFF) * 2097152 + (Math.floor(y / CELL) + OFF)) * 2097152 + (Math.floor(z / CELL) + OFF);
    const gridAdd = (q) => { if (q.length < 4) q.push(a); const k = key(q[0], q[1], q[2]); const l = grid.get(k); if (l) l.push(q); else grid.set(k, [q]); };
    if (obstacles) for (let i = 0; i < obstacles.length; i += 4) gridAdd([obstacles[i], obstacles[i + 1], obstacles[i + 2], obstacles[i + 3]]);
    const dead = new Set();   // chain spheres removed again while closing
    const clear = (q) => {
      const ix = Math.floor(q[0] / CELL), iy = Math.floor(q[1] / CELL), iz = Math.floor(q[2] / CELL);
      let m = 2 * CELL;
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let w = -1; w <= 1; w++) {
        const l = grid.get(((ix + u + OFF) * 2097152 + (iy + v + OFF)) * 2097152 + (iz + w + OFF));
        if (!l) continue;
        for (const o of l) {
          if (dead.has(o)) continue;
          const g = Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) - (o[3] + a);
          if (g < m) m = g;
        }
      }
      return m;
    };
    // Place a sphere touching prev (at centre distance dist, default 2a) in direction (dx,dy,dz);
    // if that spot is taken, try directions tilted away from it by increasing angles.
    const placeFrom = (prev, dx, dy, dz, dist = D) => {
      let d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) { dx = 1; dy = 0; dz = 0; d = 1; }
      const ux = dx / d, uy = dy / d, uz = dz / d;
      const first = [prev[0] + dist * ux, prev[1] + dist * uy, prev[2] + dist * uz];
      let best = first, bestC = clear(first);
      if (bestC >= TOL) return first;
      let ax = Math.abs(ux) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
      let vx = uy * 0 - uz * ay, vy = uz * ax - ux * 0, vz = ux * ay - uy * ax;
      const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
      const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
      for (let ring = 1; ring <= 12; ring++) {
        const th = ring * Math.PI / 15, ct = Math.cos(th), st = Math.sin(th);
        const phi0 = rand() * 2 * Math.PI;
        for (let k = 0; k < 8; k++) {
          const ph = phi0 + k * Math.PI / 4, cp = Math.cos(ph) * st, sp = Math.sin(ph) * st;
          const q = [prev[0] + dist * (ct * ux + cp * vx + sp * wx), prev[1] + dist * (ct * uy + cp * vy + sp * wy), prev[2] + dist * (ct * uz + cp * vz + sp * wz)];
          const c2 = clear(q);
          if (c2 >= TOL) return q;
          if (c2 > bestC) { bestC = c2; best = q; }
        }
      }
      return best;   // boxed in: least overlap
    };
    // Independent noise per sphere (no memory): no drifting waves or excursions.
    const nv = [0, 0, 0], RHO = 0;
    const stepTo = (prev, T) => {
      for (let c = 0; c < 3; c++) nv[c] = RHO * nv[c] + gaussian(rand) * jit;
      // the first step from an attached sphere touches it at its own radius
      const dist = prev.length > 3 && prev[3] !== a ? prev[3] + a : D;
      const q = placeFrom(prev, T[0] - prev[0] + nv[0], T[1] - prev[1] + nv[1], T[2] - prev[2] + nv[2], dist);
      gridAdd(q);
      return q;
    };
    let prev;
    if (start) prev = [start.X, start.Y, start.Z, start.r || a];
    else { prev = S[0].slice(); out.push(prev); gridAdd(prev); }
    // Progress along the line = where the last sphere projects onto it (searched forward
    // only, so loops and crossings of the stroke are followed in order). Each step aims one
    // diameter beyond that point, and the walk goes on until the end of the line is reached:
    // a wigglier (hotter) chain needs more spheres, a straight one fewer, and nothing piles
    // up at the end.
    const Eend = end ? [end.X, end.Y, end.Z] : null, dE = end ? (end.r || a) + a : D;
    let kp = 0;
    const WIN = Math.ceil(3 * D / h) + 2;
    const project = (q) => {
      let best = kp, bd = Infinity;
      for (let k = kp, kEnd = Math.min(M, kp + WIN); k <= kEnd; k++) {
        const dd = (S[k][0] - q[0]) ** 2 + (S[k][1] - q[1]) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      kp = best;
      return kp * h;
    };
    let sP = start ? project(prev) : 0, stall = 0;
    const NCAP = Math.min(CONFIG.N_MAX, Math.ceil(8 * L / D) + 20);
    while (out.length < NCAP) {
      if (Eend && dist3(prev, Eend) <= D + dE) break;   // close enough: the closing step below connects
      if (L - sP <= 0.5 * a) break;
      const sAim = Math.min(L, sP + D);
      const T = at(sAim);
      if (sAim >= L && Math.hypot(T[0] - prev[0], T[1] - prev[1]) < D) break;   // end within reach
      prev = stepTo(prev, T);
      out.push(prev);
      const s2 = project(prev);
      if (s2 > sP + 1e-9) { sP = s2; stall = 0; }
      else if (++stall > 6) { kp = Math.min(M, kp + Math.ceil(D / h)); sP = kp * h; stall = 0; }   // boxed in: move on
    }
    // catch up with the end of the stroke if the walk lagged behind (straight, no noise)
    const tail = at(L);
    jit = 0; nv[0] = nv[1] = nv[2] = 0;
    for (let extra = 0; !end && extra < 50 && out.length < CONFIG.N_MAX && dist3(prev, tail) > D; extra++) {
      prev = stepTo(prev, tail);
      out.push(prev);
    }
    if (end) {
      // Close onto the end sphere E (radius rE) with exact contacts and no overlaps:
      // drop spheres closer than rE + a to E, step straight towards E in 2a steps
      // while more than 2a + rE + a away, then place one sphere touching both neighbours.
      const E = [end.X, end.Y, end.Z];
      while (out.length && dist3(out[out.length - 1], E) < dE - 1e-9) dead.add(out.pop());
      let last = out.length ? out[out.length - 1] : (start ? [start.X, start.Y, start.Z, start.r || a] : null);
      if (last) {
        let guard = 0;
        const maxSteps = Math.ceil(dist3(last, E) / D) + 4;
        while (dist3(last, E) > D + dE && guard++ < maxSteps) {
          const dist = last.length > 3 && last[3] !== a ? last[3] + a : D;
          last = placeFrom(last, E[0] - last[0], E[1] - last[1], E[2] - last[2], dist);
          gridAdd(last);
          out.push(last);
        }
        const r = dist3(last, E), dL = last.length > 3 && last[3] !== a ? last[3] + a : D;
        if (r > dE + 1e-9) {
          const ux = (E[0] - last[0]) / r, uy = (E[1] - last[1]) / r, uz = (E[2] - last[2]) / r;
          let px = uy, py = -ux, pz = 0;                    // perpendicular, preferably in the view plane
          let pl = Math.hypot(px, py, pz);
          if (pl < 1e-6) { px = 0; py = uz; pz = -uy; pl = Math.hypot(px, py, pz) || 1; }
          px /= pl; py /= pl; pz /= pl;
          const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;   // u x p
          // circle of points at distance dL from last and dE from E
          const xa = (r * r + dL * dL - dE * dE) / (2 * r);
          const h = Math.sqrt(Math.max(0, dL * dL - xa * xa));
          const mx = last[0] + ux * xa, my = last[1] + uy * xa, mz = last[2] + uz * xa;
          // every point on this circle touches both last and E; prefer view-plane positions, avoid overlaps
          let pick = null, pickC = -Infinity;   // if every spot overlaps, take the least overlapping one
          const phi0 = rand() < 0.5 ? 0 : Math.PI;
          for (let k = 0; k < 24; k++) {
            const ph = phi0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12;
            const c = Math.cos(ph) * h, sn = Math.sin(ph) * h;
            const q = [mx + c * px + sn * qx, my + c * py + sn * qy, mz + c * pz + sn * qz];
            const c2 = clear(q);
            if (c2 > pickC) { pickC = c2; pick = q; }
            if (c2 >= TOL) break;
          }
          out.push(pick);
        }
      }
    }
    return out.map(q => [q[0], q[1], q[2]]);
  }

  function rgOf(P, n, rad) {
    if (!n) return 0;
    const w = (i) => (rad ? rad[i] ** 3 : 1);
    let M = 0, mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { const m = w(i); M += m; mx += m * P[3 * i]; my += m * P[3 * i + 1]; mz += m * P[3 * i + 2]; }
    mx /= M; my /= M; mz /= M;
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += w(i) * ((P[3 * i] - mx) ** 2 + (P[3 * i + 1] - my) ** 2 + (P[3 * i + 2] - mz) ** 2);
    return Math.sqrt(s2 / M);
  }
  // Box centred on (cx, cy) that encloses the projected spheres (at least minW x minH).
  function withSymmetricBox(it, cx, cy, minW = 0, minH = 0) {
    const v = viewSpheres(it);
    const hx = Math.max(minW / 2, -v.x0, v.x1, ptsScale(it)), hy = Math.max(minH / 2, -v.y0, v.y1, ptsScale(it));
    return { ...it, x: cx - hx, y: cy - hy, w: 2 * hx, h: 2 * hy };
  }
  /*
   * Fit the box tightly around the current projection. The box centre is the
   * origin of the item's coordinates, so the origin is shifted (in the view
   * plane) without moving any sphere on screen. Chains shift their stored path
   * (and its depth offset pz) along, so re-laying still follows the drawn line.
   */
  function refitBox(it) {
    if (!it.pts || !it.n) return it;
    const v = viewSpheres(it);
    const dx = (v.x0 + v.x1) / 2, dy = (v.y0 + v.y1) / 2;
    const w = v.x1 - v.x0, h = v.y1 - v.y0;
    const cx = it.x + it.w / 2 + dx, cy = it.y + it.h / 2 + dy;
    const ni = { ...it, x: cx - w / 2, y: cy - h / 2, w, h };
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      const R = it.R, a = ptsScale(it);
      const sx = (R[0] * dx + R[3] * dy) / a, sy = (R[1] * dx + R[4] * dy) / a, sz = (R[2] * dx + R[5] * dy) / a;
      const pts = new Float32Array(3 * it.n);
      for (let i = 0; i < it.n; i++) {
        pts[3 * i] = it.pts[3 * i] - sx;
        pts[3 * i + 1] = it.pts[3 * i + 1] - sy;
        pts[3 * i + 2] = it.pts[3 * i + 2] - sz;
      }
      ni.pts = pts;
      if (it.path) {
        ni.path = it.path.map((val, i) => val - (i % 2 ? sy : sx) * a);
        ni.pz = (it.pz || 0) - sz * a;
      }
    }
    return ni;
  }
  // (Re)build a standalone chain from its stored path (relative to its centre, local frame).
  function regenChain(it, changes) {
    const ni = { ...it, ...changes };
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const pz = ni.pz || 0;
    const sph = layChain(ni.path, pz, pz, ni.a, ni.temp, ni.seed, null, null);
    const pts = new Float32Array(3 * sph.length);
    sph.forEach((q, i) => { pts[3 * i] = q[0] / ni.a; pts[3 * i + 1] = q[1] / ni.a; pts[3 * i + 2] = q[2] / ni.a; });
    ni.pts = pts; ni.n = sph.length; ni.rg = rgOf(pts, ni.n); ni.dfFit = null; ni.needsGen = false;
    return refitBox(withSymmetricBox(ni, cx, cy));
  }
  function makeChainItem(pathAbs, a, temp, seed, color) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pathAbs.length; i += 2) {
      x0 = Math.min(x0, pathAbs[i]); x1 = Math.max(x1, pathAbs[i]);
      y0 = Math.min(y0, pathAbs[i + 1]); y1 = Math.max(y1, pathAbs[i + 1]);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const path = pathAbs.map((v, i) => Math.round((v - (i % 2 ? cy : cx)) * 10) / 10);
    return regenChain({
      id: uid(), type: 'agg', kind: 'chain', x: cx, y: cy, w: 0, h: 0,
      a, df: 1, kf: null, temp, seed, color, R: IDENTITY.slice(), path,
      pts: null, n: 0, rg: 0, dfFit: null, capped: false, needsGen: false,
    }, {});
  }
  // Merge view-space spheres (and optionally all of aggregate B) into aggregate A.
  function mergeInto(A, sph, B) {
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2, R = A.R, a = ptsScale(A);
    const local = (X, Y, Z, out, o) => {
      const vx = (X - cx) / a, vy = (Y - cy) / a, vz = Z / a;   // R^T * v
      out[o] = R[0] * vx + R[3] * vy + R[6] * vz;
      out[o + 1] = R[1] * vx + R[4] * vy + R[7] * vz;
      out[o + 2] = R[2] * vx + R[5] * vy + R[8] * vz;
    };
    const nB = B ? B.n : 0;
    const n = A.n + sph.length + nB;
    const pts = new Float32Array(3 * n);
    pts.set(A.pts.subarray(0, 3 * A.n));
    let o = 3 * A.n;
    for (const q of sph) { local(q[0], q[1], q[2], pts, o); o += 3; }
    let rad = new Float32Array(n).fill(1), poly = !!A.radii;
    if (A.radii) rad.set(A.radii.subarray(0, A.n));
    if (B) {
      const vb = viewSpheres(B), bx = B.x + B.w / 2, by = B.y + B.h / 2;
      for (let i = 0; i < B.n; i++) {
        rad[A.n + sph.length + i] = vb.rs[i] / a;
        if (Math.abs(vb.rs[i] / a - 1) > 1e-6) poly = true;
        local(bx + vb.xs[i], by + vb.ys[i], vb.zs[i], pts, o); o += 3;
      }
    }
    if (!poly) rad = undefined;
    const ni = {
      ...A, a, aGen: undefined, pts, n, radii: rad, edited: true, needsGen: false, dfFit: null, rg: rgOf(pts, n, rad),
      nGen: A.nGen != null ? A.nGen : A.n,
      groups: A.groups ? (() => { const gr = new Uint16Array(n); gr.set(A.groups.subarray(0, A.n)); return gr; })() : undefined,
      genBox: A.genBox || (A.kind === 'chain' ? null : { w: A.w, h: A.h }),
    };
    return refitBox(ni);
  }
  function forgetGen(id) { latestToken.delete(id); pendingGen.delete(id); shownToken.delete(id); }

  function finishChain(a, isTap, p) {
    let startHit = a.startHit;
    const pathAbs = a.pts.slice();
    // The aggregate may have been regenerated while the chain was drawn: find the sphere
    // under the starting point again in its current version (or start a free chain).
    if (startHit && findItem(startHit.item.id) !== startHit.item) startHit = sphereAt({ x: pathAbs[0], y: pathAbs[1] });
    if (isTap && startHit) { if (handleTap(p) === 'single-agg') selectIds([startHit.item.id]); return; }
    if (isTap && a.deselected) return;   // a tap that only deselected places no sphere
    let endHit = isTap ? null : sphereAt({ x: pathAbs[pathAbs.length - 2], y: pathAbs[pathAbs.length - 1] });
    if (!startHit && endHit) {            // attach at the end only: walk the stroke backwards
      startHit = endHit; endHit = null;
      const rev = [];
      for (let i = pathAbs.length - 2; i >= 0; i -= 2) rev.push(pathAbs[i], pathAbs[i + 1]);
      pathAbs.splice(0, pathAbs.length, ...rev);
    }
    const temp = settings.chain.temp;
    const seed = randSeed();
    if (!startHit) {
      const it = makeChainItem(pathAbs, settings.agg.a, temp, seed, settings.agg.color);
      if (!it.n) return;
      pushUndo();
      setItems([...items(), it]);
      return;
    }
    const A = startHit.item;
    const z0 = startHit.Z, z1 = endHit ? endHit.Z : z0;
    const B = endHit && endHit.item.id !== A.id ? endHit.item : null;
    const obstacles = [];
    for (const T of B ? [A, B] : [A]) {
      const v = viewSpheres(T), tx = T.x + T.w / 2, ty = T.y + T.h / 2;
      for (let i = 0; i < T.n; i++) obstacles.push(tx + v.xs[i], ty + v.ys[i], v.zs[i], v.rs[i]);
    }
    const sph = layChain(pathAbs, z0, z1, ptsScale(A), temp, seed, startHit, endHit, obstacles);
    if (!sph.length) return;
    forgetGen(A.id);
    if (B) forgetGen(B.id);
    const merged = mergeInto(A, sph, B);
    pushUndo();
    setItems(items().filter(it => !B || it.id !== B.id).map(it => (it.id === A.id ? merged : it)));
    if (selection) clearSelection();
  }

  // ============================================================
  // Selection
  // ============================================================
  let selection = null;   // Set of item ids, or null
  function selectIds(ids) { selection = ids.length ? new Set(ids) : null; requestOverlay(); updateChrome(); refreshDfScale(); }
  function clearSelection() { if (selection) { selection = null; requestOverlay(); updateChrome(); refreshDfScale(); } }
  function selectedItems() { return selection ? items().filter(it => selection.has(it.id)) : []; }
  function singleSelectedAgg() {
    if (!selection || selection.size !== 1) return null;
    const it = findItem([...selection][0]);
    return it && it.type === 'agg' ? it : null;
  }
  function itemBounds(it) {
    return it.type === 'stroke' ? strokeGeom(it).bbox : { x: it.x, y: it.y, w: it.w, h: it.h };
  }
  function unionBounds(list) {
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of list) {
      const b = itemBounds(it);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function selectionBounds() { return unionBounds(selectedItems()); }
  const inRect = (p, b, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

  function topAggAt(p) {
    const list = items(), pad = 4 / view.scale;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.type === 'agg' && inRect(p, it, pad)) return it;
    }
    return null;
  }
  function topItemAt(p) {
    const list = items(), tol = 10 / view.scale;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.type === 'agg') { if (inRect(p, it, tol / 2)) return it; continue; }
      const b = strokeGeom(it).bbox;
      if (!inRect(p, b, tol)) continue;
      if (distToStroke(it, p.x, p.y) <= it.width / 2 + tol) return it;
    }
    return null;
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function lassoSelect(poly) {
    const ids = [];
    for (const it of items()) {
      if (it.type === 'agg') {
        if (pointInPoly(it.x + it.w / 2, it.y + it.h / 2, poly)) ids.push(it.id);
        continue;
      }
      const p = it.points, n = p.length / 3;
      const step = Math.max(1, Math.floor(n / 40));
      let inside = 0, total = 0;
      for (let i = 0; i < n; i += step) { total++; if (pointInPoly(p[3 * i], p[3 * i + 1], poly)) inside++; }
      if (total && inside / total >= 0.5) ids.push(it.id);
    }
    selectIds(ids);
  }

  function translateItem(it, dx, dy) {
    if (it.type === 'agg') return { ...it, x: it.x + dx, y: it.y + dy };
    const p = it.points.slice();
    for (let i = 0; i < p.length; i += 3) {
      p[i] = Math.round((p[i] + dx) * 10) / 10;
      p[i + 1] = Math.round((p[i + 1] + dy) * 10) / 10;
    }
    return { ...it, points: p };
  }
  function deleteSelection() {
    if (!selection) return;
    pushUndo();
    const sel = selection;
    selection = null;
    if (panelId && sel.has(panelId)) closePanel();
    setItems(items().filter(it => !sel.has(it.id)));
  }
  function duplicateSelection() {
    const sel = selectedItems();
    if (!sel.length) return;
    pushUndo();
    const copies = sel.map(it => ({ ...translateItem(it, 24, 24), id: uid() }));
    setItems([...items(), ...copies]);
    selectIds(copies.map(c => c.id));
    for (const c of copies) if (c.type === 'agg' && (c.needsGen || !c.pts)) requestGen(c);
  }
  function recolorSelection(color) {
    const sel = selectedItems().filter(it => it.type === 'stroke' && it.color !== color);
    if (!sel.length) return false;
    pushUndo();
    const ids = new Set(sel.map(s => s.id));
    setItems(items().map(it => (ids.has(it.id) ? { ...it, color } : it)));
    return true;
  }

  // ============================================================
  // Spin ("show 3D"): display-only rotation of aggregates
  // ------------------------------------------------------------
  // All spinning aggregates turn in step about an axis tilted 15° towards the viewer.
  // Tap the button: one rotation (ends exactly at the stored orientation). Hold: continuous;
  // tap again to stop with a short glide back. Stored orientations, saving, exports,
  // selection frames and handles are never affected. The spin pauses while anything
  // touches the page.
  // ============================================================
  const SPIN_TILT = 15 * Math.PI / 180, SPIN_FPS = 30, SPIN_RETURN_MS = 500;
  // Rocking: theta = A sin(phase), one swing (0 -> +A -> -A -> 0) per ROCK_PERIOD.
  const ROCK_AMP = 35 * Math.PI / 180, ROCK_PERIOD = 4500;
  const SPIN_AXIS = [0, Math.cos(SPIN_TILT), -Math.sin(SPIN_TILT)];
  const spin = { mode: null, theta: 0, last: 0, ids: null, from: 0, to: 0, t0: 0, timer: 0, period: 8000, style: 'rotate', phase: 0, rockPeriod: ROCK_PERIOD };
  function axisRot(u, t) {
    const c = Math.cos(t), sn = Math.sin(t), C = 1 - c, [x, y, z] = u;
    return [c + x * x * C, x * y * C - z * sn, x * z * C + y * sn,
            y * x * C + z * sn, c + y * y * C, y * z * C - x * sn,
            z * x * C - y * sn, z * y * C + x * sn, c + z * z * C];
  }
  const spinningItem = (it) => spin.mode && spin.theta !== 0 && (!spin.ids || spin.ids.has(it.id));
  function startSpin(mode) {
    const selAggs = selectedItems().filter(it => it.type === 'agg');
    spin.ids = selAggs.length ? new Set(selAggs.map(it => it.id)) : null;
    if (spin.mode !== 'loop' && spin.mode !== 'once') {
      // a new motion: take the chosen style now, so changing the setting mid-motion does not jump
      spin.theta = spin.mode === 'return' ? spin.theta : 0;
      spin.style = settings.spinStyle === 'rock' ? 'rock' : 'rotate';
      spin.phase = spin.style === 'rock' && spin.theta ? Math.asin(clamp(spin.theta / ROCK_AMP, -1, 1)) : 0;
    }
    spin.mode = mode;
    spin.last = now();
    dlog(`spin: ${mode}${spin.ids ? ` (${spin.ids.size} selected)` : ' (all)'}`);
    scheduleSpin(0);
    updateSpinBtn();
  }
  function stopSpin(smooth = true) {
    if (!spin.mode) return;
    clearTimeout(spin.timer);
    if (!smooth || spin.theta === 0) { spin.mode = null; spin.theta = 0; requestRender(); updateSpinBtn(); return; }
    const t = ((spin.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    spin.mode = 'return'; spin.from = t; spin.to = t > Math.PI ? 2 * Math.PI : 0; spin.t0 = now();
    scheduleSpin(0);
    updateSpinBtn();
  }
  function scheduleSpin(delay) {
    clearTimeout(spin.timer);
    spin.timer = setTimeout(() => requestAnimationFrame(spinTick), delay);
  }
  function spinTick() {
    if (!spin.mode) return;
    const t = now(), dt = t - spin.last;
    spin.last = t;
    if (spin.mode === 'return') {
      const u = clamp((t - spin.t0) / SPIN_RETURN_MS, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      spin.theta = spin.from + (spin.to - spin.from) * e;
      if (u >= 1) { spin.theta = 0; spin.mode = null; }
    } else if (!pointers.size) {               // paused while the pencil, a finger or the mouse is on the page
      if (spin.style === 'rock') {
        spin.phase += (dt / spin.rockPeriod) * 2 * Math.PI;
        if (spin.mode === 'once' && spin.phase >= 2 * Math.PI) { spin.theta = 0; spin.mode = null; }
        else spin.theta = ROCK_AMP * Math.sin(spin.phase);
      } else {
        spin.theta += (dt / spin.period) * 2 * Math.PI;
        if (spin.mode === 'once' && spin.theta >= 2 * Math.PI) { spin.theta = 0; spin.mode = null; }
      }
    }
    requestRender();
    updateSpinBtn();
    if (spin.mode) scheduleSpin(1000 / SPIN_FPS);
  }
  function updateSpinBtn() {
    const b = $('btnSpin');
    if (!b) return;
    b.classList.toggle('active', spin.mode === 'once' || spin.mode === 'loop');
    const rock = settings.spinStyle === 'rock';
    b.title = spin.mode === 'loop' ? 'Stop (Space)' : rock ? 'Show 3D: one swing (Space) · hold: keep rocking (Shift+Space)' : 'Show 3D: one rotation (Space) · hold: keep rotating (Shift+Space)';
  }

  // ============================================================
  // Teaching overlays: numbers (N, Df, kf, a, Rg, Rout, filling factor) and the Rg circle
  // ------------------------------------------------------------
  // Rg is the point-mass radius of gyration, as in N = kf (Rg/a)^Df. Rout is the largest
  // distance of a monomer surface from the centre of mass. The filling factor is
  // phi = N (a/R)^3 with R = sqrt(5/3) Rg (uniform sphere with the same Rg), so that
  // phi ~ N^(1 - 3/Df). Overlays follow the displayed orientation (also while spinning).
  // ============================================================
  // Typography of all overlays, in page units (one page unit is about 0.7 px on an iPad at fit):
  // values and symbols 20 (about 14 px), small text (captions, units, ticks) 16 (about 11 px).
  // All of it scales with Settings → Aggregates: Text (settings.ovScale).
  const OVS_BASE = { val: 20, small: 16 };
  const OVS = { ...OVS_BASE };
  const OV_FONT = OVS.val;
  const OV_FAMILY = 'system-ui, sans-serif';   // canvas: keep it simple, an unparsable font list is silently ignored
  const OV_FAMILY_SVG = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  // Eigenvalues of a symmetric 3x3 matrix [[a,d,e],[d,b,f],[e,f,c]], largest first.
  function symEig3(a, b, c, d, e, f) {
    const p1 = d * d + e * e + f * f;
    if (p1 < 1e-30) return [a, b, c].sort((u, v) => v - u);
    const q = (a + b + c) / 3, p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
    const A = (a - q) / p, B = (b - q) / p, Cc = (c - q) / p, D = d / p, E = e / p, F = f / p;
    const r = (A * (B * Cc - F * F) - D * (D * Cc - F * E) + E * (D * F - B * E)) / 2;
    const phi = r <= -1 ? Math.PI / 3 : r >= 1 ? 0 : Math.acos(r) / 3;
    const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3);
    return [e1, 3 * q - e1 - e3, e3];
  }
  // ---- rich text: runs of { s, i (italic), sub, z (size factor), w (weight), c (colour) } ----
  const measCtx = document.createElement('canvas').getContext('2d');
  const runSize = (r, size) => size * (r.z || 1) * (r.sub ? 0.7 : 1);
  const runFont = (r, size) => `${r.i ? 'italic ' : ''}${r.w || 400} ${runSize(r, size)}px ${OV_FAMILY}`;
  function richWidth(runs, size) {
    let w = 0;
    for (const r of runs) { measCtx.font = runFont(r, size); w += measCtx.measureText(r.s).width; }
    return w;
  }
  // Overlay palette, shared by the numbers label, the R_g marker and the mass-radius plot.
  const ovPalette = (theme) => theme === 'dark'
    ? { text: '#e8e8ee', sym: '#c4c6ce', muted: '#9a9ca6', card: 'rgba(31,36,40,0.92)', edge: 'rgba(230,232,240,0.18)', div: 'rgba(230,232,240,0.14)' }
    : { text: '#26262c', sym: '#55555f', muted: '#8a8a94', card: 'rgba(255,255,255,0.94)', edge: 'rgba(40,40,60,0.16)', div: 'rgba(40,40,60,0.12)' };
  const ovCache = new WeakMap();            // pts -> { com (units a, local frame), rg, rOut }
  function ovStats(it) {
    let st = ovCache.get(it.pts);
    if (st && st.radii === it.radii) return st;
    const P = it.pts, n = it.n, w = (i) => (it.radii ? it.radii[i] ** 3 : 1);
    let M = 0, mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { const m = w(i); M += m; mx += m * P[3 * i]; my += m * P[3 * i + 1]; mz += m * P[3 * i + 2]; }
    mx /= M; my /= M; mz /= M;
    let s2 = 0, rmax = 0;
    for (let i = 0; i < n; i++) {
      const d2 = (P[3 * i] - mx) ** 2 + (P[3 * i + 1] - my) ** 2 + (P[3 * i + 2] - mz) ** 2;
      s2 += w(i) * d2; rmax = Math.max(rmax, Math.sqrt(d2) + radOf(it, i));
    }
    // Anisotropy: largest over smallest principal radius of gyration, from the (mass-weighted)
    // gyration tensor, so chains and edited aggregates have it too.
    let txx = 0, tyy = 0, tzz = 0, txy = 0, txz = 0, tyz = 0;
    for (let i = 0; i < n; i++) {
      const m = w(i), x = P[3 * i] - mx, y = P[3 * i + 1] - my, z = P[3 * i + 2] - mz;
      txx += m * x * x; tyy += m * y * y; tzz += m * z * z; txy += m * x * y; txz += m * x * z; tyz += m * y * z;
    }
    const ev = symEig3(txx / M, tyy / M, tzz / M, txy / M, txz / M, tyz / M);
    const aniso = Math.sqrt(Math.max(ev[0], 1e-12) / Math.max(ev[2], 1e-12));
    // vol: total monomer volume in units of a^3 (= N for equal monomers), for the filling factor
    st = { com: [mx, my, mz], rg: Math.sqrt(s2 / M), rOut: rmax, vol: M, radii: it.radii, aniso };
    ovCache.set(it.pts, st);
    return st;
  }
  function ovGeometry(it) {
    const st = ovStats(it), a = ptsScale(it), R = it.R, c = st.com;
    return {
      X: it.x + it.w / 2 + (R[0] * c[0] + R[1] * c[1] + R[2] * c[2]) * a,
      Y: it.y + it.h / 2 + (R[3] * c[0] + R[4] * c[1] + R[5] * c[2]) * a,
      rg: st.rg * a, rOut: st.rOut * a, st,
    };
  }
  const fmtNum = (v, d) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));
  const fmtAniso = (v) => (v >= 100 ? '> 100' : v.toFixed(v >= 10 ? 0 : 1));
  // The numbers label as a small table: a caption, then rows of symbol / value / unit, then
  // (below a hairline) the filling factor and the anisotropy with their names.
  function ovTable(it) {
    const st = ovStats(it), n = it.n, a = ptsScale(it);
    const rc = Math.sqrt(5 / 3) * st.rg, phi = rc > 0 ? st.vol / Math.pow(rc, 3) : 1;
    const sym = (x, sub) => (sub ? [{ s: x, i: true, k: 'sym' }, { s: sub, sub: true, k: 'sym' }] : [{ s: x, i: true, k: 'sym' }]);
    const unitA = [{ s: 'a', i: true, z: 0.8, k: 'muted' }];
    const aSym = it.radii ? sym('a', 'g') : sym('a');
    let caption, top;
    const rowR = [{ sym: sym('R', 'g'), val: fmtNum(st.rg, 1), unit: unitA }, { sym: sym('R', 'out'), val: fmtNum(st.rOut, 1), unit: unitA }];
    if (it.kind === 'chain' && !it.edited) { caption = 'Hand-drawn chain'; top = [[{ sym: sym('N'), val: String(n) }, { sym: aSym, val: fmtNum(a, 1) }], rowR]; }
    else if (it.edited) { caption = 'Aggregate with hand-drawn parts'; top = [[{ sym: sym('N'), val: String(n) }, { sym: aSym, val: fmtNum(a, 1) }], rowR]; }
    else {
      const kf = it.kfUsed != null ? it.kfUsed : (it.kf != null ? it.kf : window.AggEngine.kfAuto(it.df, it.sigma || 1));
      caption = it.method === 'cca' && !it.ccaFallback ? 'Cluster–cluster aggregate' : 'Particle–cluster aggregate';
      const r1 = [{ sym: sym('N'), val: String(n) }, { sym: sym('D', 'f'), val: it.df.toFixed(2) }, { sym: sym('k', 'f'), val: kf.toFixed(2) }];
      if (it.radii && it.sigma > 1) r1.push({ sym: sym('σ', 'g'), val: it.sigma.toFixed(2) });
      top = [r1, [{ sym: aSym, val: fmtNum(a, 1) }, ...rowR]];
    }
    // One line below the hairline: filling factor and anisotropy, symbol and number only.
    const bottom = [
      { sym: [{ s: 'φ', i: true, k: 'sym' }], val: phi < 0.01 ? phi.toExponential(1) : phi.toFixed(3) },
      { sym: [{ s: 'R', i: true, k: 'sym' }, { s: '1', sub: true, k: 'sym' }, { s: '/', k: 'sym' }, { s: 'R', i: true, k: 'sym' }, { s: '3', sub: true, k: 'sym' }], val: fmtAniso(st.aniso) },
    ];
    return { caption, top, bottom };
  }
  const OVL_BASE = { padX: 14, padY: 11, lh: 30, capH: 26, gapCol: 26, gapSV: 9, gapVU: 4, divGap: 9 };
  const OVL = { ...OVL_BASE };
  function ovLabelLayout(it) {
    const T = ovTable(it), F = OVS.val, Fs = OVS.small;
    const nCol = Math.max(...T.top.map(r => r.length));
    const symW = Array(nCol).fill(0), valW = Array(nCol).fill(0), unitW = Array(nCol).fill(0);
    for (const row of T.top) row.forEach((c, j) => {
      symW[j] = Math.max(symW[j], richWidth(c.sym, F));
      valW[j] = Math.max(valW[j], richWidth([{ s: c.val }], F));
      if (c.unit) unitW[j] = Math.max(unitW[j], OVL.gapVU + richWidth(c.unit, F));
    });
    const colX = []; let x = 0;
    for (let j = 0; j < nCol; j++) { colX.push(x); x += symW[j] + OVL.gapSV + valW[j] + unitW[j] + (j < nCol - 1 ? OVL.gapCol : 0); }
    const topW = x;
    const bX = []; let bx = 0;
    T.bottom.forEach((c, j) => { bX.push(bx); bx += richWidth(c.sym, F) + OVL.gapSV + richWidth([{ s: c.val }], F) + (j < T.bottom.length - 1 ? OVL.gapCol : 0); });
    const botW = bx;
    const capW = richWidth([{ s: T.caption }], Fs);
    const w = 2 * OVL.padX + Math.max(topW, botW, capW);
    const h = 2 * OVL.padY + OVL.capH + (T.top.length + 1) * OVL.lh + 2 * OVL.divGap - 6 * (OVS.val / 20);
    return { T, nCol, symW, valW, unitW, colX, bX, w, h };
  }
  function ovLabelBox(it) {
    const L = ovLabelLayout(it);
    let y = it.y + it.h + 8;
    if (y + L.h > pageH(curPage())) y = it.y - L.h - 8;
    return { x: it.x, y, w: L.w, h: L.h, L };
  }
  // Shapes for the label (drawn the same way on screen, in PNG and in SVG).
  function labelShapes(it, theme) {
    const C = ovPalette(theme), b = ovLabelBox(it), L = b.L, F = OVS.val, Fs = OVS.small;
    const col = (r) => ({ ...r, c: r.k === 'muted' ? C.muted : r.k === 'sym' ? C.sym : (r.c || C.text) });
    const out = [{ t: 'card', x: b.x, y: b.y, w: b.w, h: b.h, fill: C.card, stroke: C.edge }];
    const x0 = b.x + OVL.padX;
    let y = b.y + OVL.padY;
    out.push({ t: 'rich', x: x0, y: y + Fs * 0.95, size: Fs, runs: [{ s: L.T.caption, c: C.muted }] });
    y += OVL.capH;
    for (const row of L.T.top) {
      const base = y + F * 1.02;
      row.forEach((c, j) => {
        const cx = x0 + L.colX[j];
        out.push({ t: 'rich', x: cx, y: base, size: F, runs: c.sym.map(col) });
        const vx = cx + L.symW[j] + OVL.gapSV + L.valW[j];
        out.push({ t: 'rich', x: vx, y: base, size: F, anchor: 'end', runs: [{ s: c.val, c: C.text }] });
        if (c.unit) out.push({ t: 'rich', x: vx + OVL.gapVU, y: base, size: F, runs: c.unit.map(col) });
      });
      y += OVL.lh;
    }
    y += OVL.divGap - 4 * (F / 20);
    out.push({ t: 'line', pts: [x0, y, b.x + b.w - OVL.padX, y], color: C.div, w: 1 });
    y += OVL.divGap - 2 * (F / 20);
    const base = y + F * 1.02;
    L.T.bottom.forEach((c, j) => {
      const cx = x0 + L.bX[j];
      out.push({ t: 'rich', x: cx, y: base, size: F, runs: c.sym.map(col) });
      out.push({ t: 'rich', x: cx + richWidth(c.sym, F) + OVL.gapSV, y: base, size: F, runs: [{ s: c.val, c: C.text }] });
    });
    return out;
  }
  const ovColors = (theme) => theme === 'dark'
    ? { rg: '#ffbb55', out: 'rgba(230,232,240,0.55)', text: '#e8e8ee', bg: 'rgba(31,36,40,0.82)' }
    : { rg: '#d4730a', out: 'rgba(60,60,70,0.5)', text: '#2a2a30', bg: 'rgba(255,255,255,0.82)' };
  function drawOverlays(ctx, it, theme, unit) {
    if (!it.pts || !it.n || (!it.showRg && !it.showNums && !it.showMR)) return;
    if (it.showMR) drawShapes(ctx, mrShapes(it, theme));
    const C = ovColors(theme);
    if (it.showRg) {
      const g = ovGeometry(it);
      ctx.save();
      ctx.lineWidth = 2.2;
      ctx.setLineDash([2, 5]); ctx.strokeStyle = C.out;
      ctx.beginPath(); ctx.arc(g.X, g.Y, g.rOut, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([10, 6]); ctx.strokeStyle = C.rg; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(g.X, g.Y, g.rg, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      const k = Math.max(6, ptsScale(it) * 0.9);
      ctx.beginPath(); ctx.moveTo(g.X - k, g.Y); ctx.lineTo(g.X + k, g.Y); ctx.moveTo(g.X, g.Y - k); ctx.lineTo(g.X, g.Y + k); ctx.stroke();
      ctx.restore();
      drawShapes(ctx, [rgMarker(it, theme, g)]);
    }
    if (it.showNums) drawShapes(ctx, labelShapes(it, theme));
  }
  // "R_g" next to the R_g circle: italic R with subscript g, amber, with a halo.
  function rgMarker(it, theme, g) {
    const C = ovColors(theme);
    // Upper left of the circle: the ring counts of the mass-radius overlay sit at the upper right.
    return { t: 'rich', x: g.X - g.rg * 0.72 - 4, y: g.Y - g.rg * 0.72 - 4 * (OVS.val / 20), size: OVS.val, anchor: 'end', halo: THEMES[theme].page,
      runs: [{ s: 'R', i: true, w: 600, c: C.rg }, { s: 'g', sub: true, w: 600, c: C.rg }] };
  }
  // ---------- mass-radius overlay: rings + log-log plot (slope = Df) ----------
  // Around the centre of mass a fluffy aggregate is often empty, which makes single-centre
  // counts misleading. The plot therefore shows <N(r)>, the mean number of monomers within r
  // of a monomer, averaged over up to 200 monomers as centres (the operational definition of
  // Df), fitted for 3a <= r <= 0.7 Rg (checked: matches Df within ~0.05). The rings illustrate
  // the counting around one monomer: the one closest to the centre of mass. r in units of a.
  const mrCache = new WeakMap();
  function mrStats(it) {
    let m = mrCache.get(it.pts);
    if (m && m.radii === it.radii) return m;
    const st = ovStats(it), P = it.pts, n = it.n, c = st.com;
    // ring centre: the monomer nearest the centre of mass
    let c0 = 0, best = Infinity;
    for (let i = 0; i < n; i++) { const q = (P[3 * i] - c[0]) ** 2 + (P[3 * i + 1] - c[1]) ** 2 + (P[3 * i + 2] - c[2]) ** 2; if (q < best) { best = q; c0 = i; } }
    const d0 = new Float64Array(n);
    for (let j = 0; j < n; j++) d0[j] = Math.hypot(P[3 * j] - P[3 * c0], P[3 * j + 1] - P[3 * c0 + 1], P[3 * j + 2] - P[3 * c0 + 2]);
    d0.sort();
    const count = (r) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (d0[mid] <= r) lo = mid + 1; else hi = mid; } return lo; };
    // centre-averaged N(r) on radii r_k = 2^(k/4), collected directly into bins (no sorting)
    const rMax = Math.max(2, st.rOut + 1), K = Math.ceil(4 * Math.log2(2 * rMax)) + 1;
    const hist = new Float64Array(K + 1), step = Math.max(1, Math.floor(n / 200));
    let centres = 0;
    for (let i = 0; i < n; i += step) {
      centres++;
      const xi = P[3 * i], yi = P[3 * i + 1], zi = P[3 * i + 2];
      for (let j = 0; j < n; j++) {
        const dd = Math.hypot(P[3 * j] - xi, P[3 * j + 1] - yi, P[3 * j + 2] - zi);
        const b = dd <= 1 ? 0 : Math.min(K, Math.ceil(4 * Math.log2(dd) - 1e-9));
        hist[b]++;
      }
    }
    const samples = [];
    let cum = 0;
    for (let k = 0; k <= K; k++) { cum += hist[k]; const r = Math.pow(2, k / 4); if (r > rMax) break; samples.push({ r, N: cum / centres }); }
    const fitPts = samples.filter(q => q.r >= 3 && q.r <= 0.7 * st.rg);
    m = { samples, slope: null, count, rMax, c0, radii: it.radii };
    if (fitPts.length >= 4) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0; const k = fitPts.length;
      for (const q of fitPts) { const X = Math.log(q.r), Y = Math.log(q.N); sx += X; sy += Y; sxx += X * X; sxy += X * Y; }
      m.slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
      m.icpt = (sy - m.slope * sx) / k; m.r0 = fitPts[0].r; m.r1 = fitPts[k - 1].r;
    }
    mrCache.set(it.pts, m);
    return m;
  }
  let MR_W = 340, MR_H = 240;
  function applyOvScale() {
    const k = settings.ovScale || 0.8;
    for (const key in OVS_BASE) OVS[key] = OVS_BASE[key] * k;
    for (const key in OVL_BASE) OVL[key] = OVL_BASE[key] * k;
    MR_W = 340 * k; MR_H = 240 * k;
  }
  applyOvScale();
  // Place the plot at the first position that fits on the page, avoiding the numbers label.
  function mrPlotBox(it) {
    const PHc = pageH(curPage()), W = MR_W, H = MR_H, gap = 8;
    const lb = it.showNums && it.pts ? ovLabelBox(it) : null;
    const hits = (b) => lb && b.x < lb.x + lb.w && b.x + b.w > lb.x && b.y < lb.y + lb.h && b.y + b.h > lb.y;
    const fits = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= PW && b.y + b.h <= PHc && !hits(b);
    const cands = [
      { x: it.x + it.w - W, y: it.y + it.h + 6 },                        // below, right-aligned (next to the label)
      { x: it.x + it.w + gap, y: it.y + it.h - H },                      // right of the aggregate, bottom-aligned
      { x: it.x + it.w + gap, y: it.y },                                 // right, top-aligned
      { x: it.x - W - gap, y: it.y + it.h - H },                         // left, bottom-aligned
      { x: it.x - W - gap, y: it.y },                                    // left, top-aligned
      { x: it.x, y: (lb ? lb.y + lb.h : it.y + it.h) + gap },            // below the label
      { x: it.x + it.w - W, y: it.y - H - 6 },                           // above
    ].map(c => ({ x: c.x, y: c.y, w: W, h: H }));
    return cands.find(fits) || { x: clamp(cands[0].x, 0, Math.max(0, PW - W)), y: clamp(cands[0].y, 0, Math.max(0, PHc - H)), w: W, h: H };
  }
  // Rings and plot as simple shapes, rendered both on canvas and in SVG.
  function mrShapes(it, theme) {
    const out = [], C = theme === 'dark'
      ? { ring: '#5fd1c8', text: '#e8e8ee', axis: 'rgba(230,232,240,0.6)', bg: 'rgba(31,36,40,0.85)', fit: '#5fd1c8', dot: '#e8e8ee' }
      : { ring: '#13807d', text: '#2a2a30', axis: 'rgba(60,60,70,0.55)', bg: 'rgba(255,255,255,0.88)', fit: '#13807d', dot: '#2a2a30' };
    const m = mrStats(it), a = ptsScale(it), F = OVS.small, R = it.R, P = it.pts, i0 = m.c0, Pal = ovPalette(theme);
    const gx = it.x + it.w / 2 + (R[0] * P[3 * i0] + R[1] * P[3 * i0 + 1] + R[2] * P[3 * i0 + 2]) * a;
    const gy = it.y + it.h / 2 + (R[3] * P[3 * i0] + R[4] * P[3 * i0 + 1] + R[5] * P[3 * i0 + 2]) * a;
    for (let r = 2; r < m.rMax; r *= 2) {
      out.push({ t: 'circle', x: gx, y: gy, r: r * a, color: C.ring, w: 1.8, dash: [4, 4] });
      const N = m.count(r), ang = -Math.PI / 4;
      out.push({ t: 'rich', x: gx + Math.cos(ang) * r * a + 3, y: gy + Math.sin(ang) * r * a - 3, size: F, halo: THEMES[theme].page, runs: [{ s: String(N), w: 600, c: C.ring }] });
    }
    out.push({ t: 'dot', x: gx, y: gy, r: Math.max(3, a * 0.35), fill: C.ring });
    const kk = F / 16, b = mrPlotBox(it), L = 58 * kk, Bm = 50 * kk, T = 40 * kk, Rm = 16 * kk;
    const px0 = b.x + L, px1 = b.x + b.w - Rm, py0 = b.y + b.h - Bm, py1 = b.y + T;
    const lx = (r) => px0 + (Math.log(r) / Math.log(m.rMax)) * (px1 - px0);
    const lN = Math.log(Math.max(2, it.n));
    const ly = (N) => py0 - (Math.log(N) / lN) * (py0 - py1);
    out.push({ t: 'card', x: b.x, y: b.y, w: b.w, h: b.h, fill: Pal.card, stroke: Pal.edge });
    out.push({ t: 'line', pts: [px0, py0, px1, py0], color: C.axis, w: 1.2 });
    out.push({ t: 'line', pts: [px0, py0, px0, py1], color: C.axis, w: 1.2 });
    for (let r = 1; r <= m.rMax * 1.001; r *= 2) {
      out.push({ t: 'line', pts: [lx(r), py0, lx(r), py0 + 4], color: C.axis, w: 1.2 });
      out.push({ t: 'rich', x: lx(r), y: py0 + 6 * kk + F * 0.9, size: F, anchor: 'middle', runs: [{ s: String(r), c: Pal.sym }] });
    }
    for (let N = 1; N <= it.n * 1.001; N *= 10) {
      out.push({ t: 'line', pts: [px0 - 4, ly(N), px0, ly(N)], color: C.axis, w: 1.2 });
      out.push({ t: 'rich', x: px0 - 7 * kk, y: ly(N) + F * 0.34, size: F, anchor: 'end', runs: [{ s: String(N), c: Pal.sym }] });
    }
    out.push({ t: 'rich', x: px1, y: py0 + 6 * kk + F * 2.05, size: F, anchor: 'end', runs: [{ s: 'r', i: true, c: Pal.sym }, { s: ' / ', c: Pal.sym }, { s: 'a', i: true, c: Pal.sym }] });
    out.push({ t: 'rich', x: b.x + 12 * kk, y: b.y + 12 * kk + F * 0.95, size: F, runs: [{ s: '⟨', c: Pal.sym }, { s: 'N', i: true, c: Pal.sym }, { s: '(', c: Pal.sym }, { s: 'r', i: true, c: Pal.sym }, { s: ')⟩', c: Pal.sym }] });
    for (const q of m.samples) out.push({ t: 'dot', x: lx(q.r), y: ly(q.N), r: 2.6, fill: C.dot });
    if (m.slope != null) {
      const f = (r) => Math.exp(m.icpt + m.slope * Math.log(r));
      out.push({ t: 'line', pts: [lx(m.r0), ly(f(m.r0)), lx(m.r1), ly(f(m.r1))], color: C.fit, w: 3 });
      const runs = [{ s: 'slope ', c: C.fit }, { s: m.slope.toFixed(2), w: 600, c: C.fit }];
      if (!(it.kind === 'chain' || it.edited)) runs.push({ s: '  ·  ', c: C.fit }, { s: 'D', i: true, c: C.fit }, { s: 'f', sub: true, c: C.fit }, { s: ' ' + it.df.toFixed(2), w: 600, c: C.fit });
      out.push({ t: 'rich', x: px1, y: b.y + 12 * kk + F * 0.95, size: F, anchor: 'end', runs });
    } else {
      out.push({ t: 'rich', x: px1, y: b.y + 12 * kk + F * 0.95, size: F, anchor: 'end', runs: [{ s: 'too small to fit', c: Pal.muted }] });
    }
    return out;
  }
  function drawShapes(ctx, shapes) {
    ctx.save();
    for (const q of shapes) {
      if (q.t === 'rect') { ctx.fillStyle = q.fill; ctx.fillRect(q.x, q.y, q.w, q.h); continue; }
      if (q.t === 'card') {
        const r = Math.min(9, q.w / 2, q.h / 2);
        ctx.beginPath();
        ctx.moveTo(q.x + r, q.y); ctx.arcTo(q.x + q.w, q.y, q.x + q.w, q.y + q.h, r); ctx.arcTo(q.x + q.w, q.y + q.h, q.x, q.y + q.h, r);
        ctx.arcTo(q.x, q.y + q.h, q.x, q.y, r); ctx.arcTo(q.x, q.y, q.x + q.w, q.y, r); ctx.closePath();
        ctx.fillStyle = q.fill; ctx.fill();
        ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = q.stroke; ctx.stroke();
        continue;
      }
      if (q.t === 'rich') { drawRich(ctx, q); continue; }
      if (q.t === 'dot') { ctx.fillStyle = q.fill; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill(); continue; }
      if (q.t === 'text') {
        ctx.fillStyle = q.color; ctx.font = `${q.bold ? '600 ' : ''}${q.size}px system-ui, sans-serif`;
        ctx.textAlign = q.anchor === 'middle' ? 'center' : q.anchor === 'end' ? 'right' : 'left'; ctx.textBaseline = 'alphabetic';
        if (q.halo) { ctx.strokeStyle = q.halo; ctx.lineWidth = q.size * 0.3; ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.strokeText(q.s, q.x, q.y); }
        ctx.fillText(q.s, q.x, q.y); continue;
      }
      ctx.strokeStyle = q.color; ctx.lineWidth = q.w; ctx.setLineDash(q.dash || []);
      ctx.beginPath();
      if (q.t === 'circle') ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); else { ctx.moveTo(q.pts[0], q.pts[1]); ctx.lineTo(q.pts[2], q.pts[3]); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawRich(ctx, q) {
    const W = richWidth(q.runs, q.size);
    let x = q.anchor === 'end' ? q.x - W : q.anchor === 'middle' ? q.x - W / 2 : q.x;
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.setLineDash([]);
    for (const pass of q.halo ? ['halo', 'fill'] : ['fill']) {
      let xx = x;
      for (const r of q.runs) {
        ctx.font = runFont(r, q.size);
        const y = q.y + (r.sub ? q.size * 0.24 : 0);
        if (pass === 'halo') { ctx.strokeStyle = q.halo; ctx.lineWidth = q.size * 0.28; ctx.lineJoin = 'round'; ctx.strokeText(r.s, xx, y); }
        else { ctx.fillStyle = r.c; ctx.fillText(r.s, xx, y); }
        xx += ctx.measureText(r.s).width;
      }
    }
    ctx.restore();
  }
  function richSVG(q) {
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const anchor = q.anchor ? ` text-anchor="${q.anchor}"` : '';
    // The halo is a separate outlined copy underneath (no reliance on paint-order, which
    // some SVG importers ignore).
    const body = (halo) => {
      let shift = 0, b = '';
      for (const r of q.runs) {
        const want = r.sub ? q.size * 0.24 : 0, dy = want - shift; shift = want;
        b += `<tspan${dy ? ` dy="${f2(dy)}"` : ''}${r.i ? ' font-style="italic"' : ''}${r.w && r.w !== 400 ? ` font-weight="${r.w}"` : ''} font-size="${f2(runSize(r, q.size))}" fill="${halo ? 'none' : r.c}">${esc(r.s)}</tspan>`;
      }
      return b;
    };
    const open = `<text x="${f2(q.x)}" y="${f2(q.y)}" font-family="${OV_FAMILY_SVG}"${anchor} xml:space="preserve"`;
    const haloText = q.halo ? `${open} stroke="${q.halo}" stroke-width="${f2(q.size * 0.28)}" stroke-linejoin="round">${body(true)}</text>` : '';
    return `${haloText}${open}>${body(false)}</text>`;
  }
  function shapesSVG(shapes) {
    let out = '';
    for (const q of shapes) {
      if (q.t === 'card') out += `<rect x="${f2(q.x)}" y="${f2(q.y)}" width="${f2(q.w)}" height="${f2(q.h)}" rx="${f2(Math.min(9, q.w / 2, q.h / 2))}" fill="${q.fill}" stroke="${q.stroke}" stroke-width="1"/>`;
      else if (q.t === 'rich') out += richSVG(q);
      else if (q.t === 'rect') out += `<rect x="${f2(q.x)}" y="${f2(q.y)}" width="${f2(q.w)}" height="${f2(q.h)}" fill="${q.fill}"/>`;
      else if (q.t === 'dot') out += `<circle cx="${f2(q.x)}" cy="${f2(q.y)}" r="${f2(q.r)}" fill="${q.fill}"/>`;
      else if (q.t === 'text') out += richSVG({ x: q.x, y: q.y, size: q.size, anchor: q.anchor, halo: q.halo, runs: [{ s: q.s, w: q.bold ? 600 : 400, c: q.color }] });
      else if (q.t === 'circle') out += `<circle cx="${f2(q.x)}" cy="${f2(q.y)}" r="${f2(q.r)}" fill="none" stroke="${q.color}" stroke-width="${q.w}"${q.dash ? ` stroke-dasharray="${q.dash.join(' ')}"` : ''}/>`;
      else out += `<path d="M${f2(q.pts[0])} ${f2(q.pts[1])}L${f2(q.pts[2])} ${f2(q.pts[3])}" stroke="${q.color}" stroke-width="${q.w}"/>`;
    }
    return out;
  }
  function overlaySVG(it, theme) {
    if (!it.pts || !it.n || (!it.showRg && !it.showNums && !it.showMR)) return '';
    const C = ovColors(theme), esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let out = it.showMR ? shapesSVG(mrShapes(it, theme)) : '';
    if (it.showRg) {
      const g = ovGeometry(it), k = Math.max(6, ptsScale(it) * 0.9);
      out += `<circle cx="${f2(g.X)}" cy="${f2(g.Y)}" r="${f2(g.rOut)}" fill="none" stroke="${C.out}" stroke-width="2.2" stroke-dasharray="2 5"/>`;
      out += `<circle cx="${f2(g.X)}" cy="${f2(g.Y)}" r="${f2(g.rg)}" fill="none" stroke="${C.rg}" stroke-width="2.6" stroke-dasharray="10 6"/>`;
      out += `<path d="M${f2(g.X - k)} ${f2(g.Y)}H${f2(g.X + k)}M${f2(g.X)} ${f2(g.Y - k)}V${f2(g.Y + k)}" stroke="${C.rg}" stroke-width="2.6"/>`;
      out += shapesSVG([rgMarker(it, theme, g)]);
    }
    if (it.showNums) out += shapesSVG(labelShapes(it, theme));
    return out;
  }
  function overlayBounds(it) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    if (it.showRg && it.pts) { const g = ovGeometry(it); x0 = g.X - g.rOut; x1 = g.X + g.rOut; y0 = g.Y - g.rOut; y1 = g.Y + g.rOut; }
    if (it.showNums && it.pts) { const b = ovLabelBox(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (it.showMR && it.pts) {
      const b = mrPlotBox(it), sh = mrShapes(it, 'light').filter(q => q.t === 'circle');
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      for (const q of sh) { x0 = Math.min(x0, q.x - q.r); y0 = Math.min(y0, q.y - q.r); x1 = Math.max(x1, q.x + q.r); y1 = Math.max(y1, q.y + q.r); }
    }
    return x0 < Infinity ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ============================================================
  // Rendering
  // ============================================================
  let raf = 0, needBoard = false, needOverlay = false;
  function requestRender() { needBoard = true; needOverlay = true; schedule(); }
  function requestOverlay() { needOverlay = true; schedule(); }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    if (needBoard) { needBoard = false; renderBoard(); }
    if (needOverlay) { needOverlay = false; renderOverlay(); }
    positionFloatingUI();
    if (laserTrails.length) { needOverlay = true; schedule(); }
  }

  function renderBoard() {
    const d = dpr(), W = window.innerWidth, H = window.innerHeight, s = view.scale;
    bctx.setTransform(d, 0, 0, d, 0, 0);
    renderTheme = themeOf(curPage());
    const TH = THEMES[renderTheme];
    bctx.fillStyle = TH.desk;
    bctx.fillRect(0, 0, W, H);
    bctx.setTransform(d * s, 0, 0, d * s, d * view.ox, d * view.oy);
    bctx.save();
    bctx.shadowColor = 'rgba(0,0,0,0.16)'; bctx.shadowBlur = 14; bctx.shadowOffsetY = 2;
    bctx.fillStyle = TH.page;
    const PHc = pageH(curPage());
    bctx.fillRect(0, 0, PW, PHc);
    bctx.restore();

    bctx.save();
    bctx.beginPath(); bctx.rect(0, 0, PW, PHc); bctx.clip();
    const vis = { x: -view.ox / s, y: -view.oy / s, w: W / s, h: H / s };
    const xf = action && (action.kind === 'move' || action.kind === 'scale') ? action : null;
    const erased = action && action.kind === 'erase' ? action.erased : null;
    const ppu = d * s, unit = 1 / s;
    const spinR = spin.mode && spin.theta !== 0 ? axisRot(SPIN_AXIS, spin.theta) : null;
    for (const it of items()) {
      if (erased && erased.has(it.id)) continue;
      const moved = xf && selection && selection.has(it.id);
      const b = itemBounds(it);
      if (!moved && it.type === 'stroke' && (b.x > vis.x + vis.w || b.x + b.w < vis.x || b.y > vis.y + vis.h || b.y + b.h < vis.y)) continue;
      if (moved) {
        bctx.save();
        if (xf.kind === 'move') bctx.translate(xf.dx, xf.dy);
        else { bctx.translate(xf.anchor.x, xf.anchor.y); bctx.scale(xf.s, xf.s); bctx.translate(-xf.anchor.x, -xf.anchor.y); }
      }
      if (it.type === 'stroke') drawStroke(bctx, it);
      else if (spinningItem(it)) { const sp = { ...it, R: matMul(spinR, it.R) }; drawAgg(bctx, sp, ppu * 0.75, false, unit); drawOverlays(bctx, sp, renderTheme, unit); }
      else { drawAgg(bctx, it, ppu, gestureActive, unit); drawOverlays(bctx, it, renderTheme, unit); }
      if (moved) bctx.restore();
    }
    if (pendingDot && pendingDot.page === curPage()) drawStroke(bctx, pendingDot.stroke);
    bctx.restore();
  }

  function renderOverlay() {
    const d = dpr(), W = window.innerWidth, H = window.innerHeight, s = view.scale;
    octx.setTransform(d, 0, 0, d, 0, 0);
    octx.clearRect(0, 0, W, H);
    const pageT = () => octx.setTransform(d * s, 0, 0, d * s, d * view.ox, d * view.oy);
    const screenT = () => octx.setTransform(d, 0, 0, d, 0, 0);

    if (action) {
      if (action.kind === 'draw' && action.snap) {
        pageT();
        const st = shapeStroke(action, action.snap);
        drawRuns(octx, buildRuns(st.points, st.width, st.straight), inkFor(st.color, themeOf(curPage())));
      } else if (action.kind === 'draw') {
        pageT();
        let P = action.pts;
        if (action.pred && action.pred.length) {
          P = P.slice();
          for (const q of action.pred) P.push(q.x, q.y, action.ps);
        }
        drawRuns(octx, buildRuns(P, action.width), inkFor(action.color, themeOf(curPage())));
      } else if (action.kind === 'lasso' && action.poly.length >= 4) {
        pageT();
        octx.beginPath();
        octx.moveTo(action.poly[0], action.poly[1]);
        for (let i = 2; i < action.poly.length; i += 2) octx.lineTo(action.poly[i], action.poly[i + 1]);
        octx.closePath();
        octx.fillStyle = 'rgba(34,170,119,0.07)'; octx.fill();
        octx.setLineDash([5 / s, 4 / s]); octx.lineWidth = 1.5 / s; octx.strokeStyle = ACCENT; octx.stroke();
        octx.setLineDash([]);
      } else if (action.kind === 'chain') {
        pageT();
        const P = action.pts;
        if (P.length >= 4) {
          octx.beginPath(); octx.moveTo(P[0], P[1]);
          for (let i = 2; i < P.length; i += 2) octx.lineTo(P[i], P[i + 1]);
          octx.lineWidth = 2 / s; octx.strokeStyle = 'rgba(59,120,200,0.7)'; octx.lineCap = 'round'; octx.lineJoin = 'round'; octx.stroke();
        }
        screenT();
        const ring = (X, Y, r, ok) => {
          const q = toScreen(X, Y);
          octx.beginPath(); octx.arc(q.x, q.y, r * s + 3, 0, Math.PI * 2);
          octx.setLineDash(ok ? [] : [4, 3]); octx.lineWidth = 2; octx.strokeStyle = ok ? ACCENT : 'rgba(59,120,200,0.8)'; octx.stroke();
          octx.setLineDash([]);
        };
        const sh = action.startHit;
        if (sh) ring(sh.X, sh.Y, sh.item.a, true);
        const tip = { x: P[P.length - 2], y: P[P.length - 1] };
        const eh = P.length >= 4 ? sphereAt(tip) : null;
        if (eh && !(sh && eh.item.id === sh.item.id && eh.i === sh.i)) ring(eh.X, eh.Y, eh.item.a, true);
        else ring(tip.x, tip.y, sh ? sh.item.a : settings.agg.a, false);
      } else if (action.kind === 'circle') {
        const A = action;
        if (A.previewBmp) {
          pageT();
          const b = A.previewBmp;
          octx.drawImage(b.canvas, A.cx + b.ox, A.cy + b.oy, b.canvas.width / b.ppu, b.canvas.height / b.ppu);
        }
        screenT();
        const c = toScreen(A.cx, A.cy), Rpx = A.R * s, blue = '#3b78c8';
        octx.beginPath(); octx.arc(c.x, c.y, Math.max(1, Rpx), 0, Math.PI * 2);
        octx.setLineDash([6, 4]); octx.lineWidth = 1.5; octx.strokeStyle = blue; octx.stroke(); octx.setLineDash([]);
        if (!A.previewBmp) { octx.fillStyle = 'rgba(59,120,200,0.06)'; octx.fill(); }
        octx.beginPath(); octx.arc(c.x, c.y, 3, 0, Math.PI * 2); octx.fillStyle = blue; octx.fill();
        octx.beginPath(); octx.moveTo(c.x, c.y); octx.lineTo(c.x + Math.sign(A.tip.x - c.x || 1) * Rpx, c.y);
        octx.lineWidth = 1; octx.strokeStyle = 'rgba(59,120,200,0.5)'; octx.stroke();
        // monomer ring at the pencil, and a second one on the circle opposite the pencil,
        // where it is never hidden under the hand and sits next to the outer monomers
        const ring = (x, y, fill) => {
          octx.beginPath(); octx.arc(x, y, Math.max(1.5, A.a * s), 0, Math.PI * 2);
          if (fill) { octx.fillStyle = 'rgba(34,170,119,0.22)'; octx.fill(); }
          octx.lineWidth = 2; octx.strokeStyle = ACCENT; octx.stroke();
        };
        ring(A.tip.x, A.tip.y, false);
        if (Rpx > 4) ring(c.x - Math.sign(A.tip.x - c.x || 1) * Rpx, c.y, true);
        // label
        const est = estimateN(A.R, A.a);
        const nTxt = A.preview ? `N = ${A.preview.n}` : (est >= CONFIG.N_MAX ? `N ≥ ${CONFIG.N_MAX} (limit)` : `N ≈ ${est}`);
        const dfNow = settings.agg.df;
        const fb = settings.agg.method === 'cca' && dfNow > window.AggEngine.CCA_MAX_DF ? ' (particle–cluster)' : '';
        const label = `Df ${dfNow.toFixed(2)}${A.dial.active ? ' ↻' : ''}${fb} · a = ${A.a.toFixed(1)} · ${nTxt}`;
        octx.font = '13px system-ui, sans-serif';
        const tw = octx.measureText(label).width;
        // label on the outer side of the pencil (away from the centre), so it never covers the aggregate
        const outward = A.tip.x >= c.x ? 1 : -1;
        let lx = outward > 0 ? A.tip.x + 16 : A.tip.x - tw - 28, ly = A.tip.y - 30;
        if (lx + tw + 12 > W) lx = A.tip.x - tw - 28;
        if (lx < 4) lx = A.tip.x + 16;
        if (ly < 70) ly = A.tip.y + 18;
        octx.fillStyle = 'rgba(30,30,36,0.85)';
        octx.beginPath(); octx.rect(lx, ly, tw + 12, 22); octx.fill();
        octx.fillStyle = '#fff'; octx.textBaseline = 'middle'; octx.fillText(label, lx + 6, ly + 11);
      } else if (action.kind === 'box') {
        pageT();
        const x = Math.min(action.x0, action.x1), y = Math.min(action.y0, action.y1);
        const w = Math.abs(action.x1 - action.x0), h = Math.abs(action.y1 - action.y0);
        octx.fillStyle = 'rgba(59,120,200,0.08)'; octx.fillRect(x, y, w, h);
        octx.setLineDash([6 / s, 4 / s]); octx.lineWidth = 1.5 / s; octx.strokeStyle = '#3b78c8'; octx.strokeRect(x, y, w, h);
        octx.setLineDash([]);
      }
    }

    // Selection frame and handles
    if (selection && !(action && action.kind === 'lasso')) {
      let b = selectionBounds();
      const ag = singleSelectedAgg();
      if (action && action.kind === 'resize') b = action.box;
      if (b) {
        if (action && action.kind === 'move') b = { x: b.x + action.dx, y: b.y + action.dy, w: b.w, h: b.h };
        if (action && action.kind === 'scale') {
          const { anchor: A, s: k } = action;
          b = { x: A.x + (b.x - A.x) * k, y: A.y + (b.y - A.y) * k, w: b.w * k, h: b.h * k };
        }
        screenT();
        const p0 = toScreen(b.x, b.y), p1 = toScreen(b.x + b.w, b.y + b.h);
        const pad = ag ? 0 : 6;
        octx.setLineDash([6, 4]); octx.lineWidth = 1.5; octx.strokeStyle = ACCENT;
        octx.strokeRect(p0.x - pad, p0.y - pad, p1.x - p0.x + 2 * pad, p1.y - p0.y + 2 * pad);
        octx.setLineDash([]);
        if (ag && !(action && (action.kind === 'move' || action.kind === 'scale'))) {
          drawHandle(p1.x, p1.y, 'resize');          // bottom-right: scale
          drawHandle(p1.x, p0.y, 'rotate');          // top-right: rotate in 3D
          if (canRefill(ag)) drawHandle(p0.x, p1.y, 'refill');   // bottom-left: refill the box
        } else if (!ag && !action) {
          for (const c of scaleCorners(b)) drawScaleHandle(c.sx, c.sy);
        }
      }
    }

    // Eraser cursor
    if (settings.tool === 'eraser' && hover && (!action || action.kind === 'erase')) {
      screenT();
      octx.beginPath(); octx.arc(hover.x, hover.y, ERASER_PX, 0, Math.PI * 2);
      const TC = THEMES[themeOf(curPage())];
      octx.lineWidth = 1.2; octx.strokeStyle = TC.cursor; octx.stroke();
      octx.fillStyle = TC.cursorFill; octx.fill();
    }

    // Laser trails (screen space, fading)
    if (laserTrails.length) {
      screenT();
      const t = now();
      octx.lineCap = 'round';
      octx.shadowColor = 'rgba(255,40,40,0.9)'; octx.shadowBlur = 10;
      for (const tr of laserTrails) {
        const pts = tr.pts;
        for (let i = 1; i < pts.length; i++) {
          const alpha = 1 - (t - pts[i].t) / LASER_FADE;
          if (alpha <= 0) continue;
          const a = toScreen(pts[i - 1].x, pts[i - 1].y), b = toScreen(pts[i].x, pts[i].y);
          octx.strokeStyle = `rgba(255,45,45,${alpha.toFixed(3)})`;
          octx.lineWidth = 4;
          octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke();
        }
        if (tr.active && pts.length) {
          const q = toScreen(pts[pts.length - 1].x, pts[pts.length - 1].y);
          octx.fillStyle = 'rgba(255,45,45,1)';
          octx.beginPath(); octx.arc(q.x, q.y, 5, 0, Math.PI * 2); octx.fill();
        }
      }
      octx.shadowBlur = 0;
      for (const tr of laserTrails) {
        while (tr.pts.length > 1 && t - tr.pts[0].t > LASER_FADE && !(tr.active && tr.pts.length < 2)) tr.pts.shift();
      }
      laserTrails = laserTrails.filter(tr => tr.active || (tr.pts.length > 1 && t - tr.pts[tr.pts.length - 1].t < LASER_FADE));
    }
  }
  function drawHandle(x, y, kind) {
    octx.beginPath(); octx.arc(x, y, 10, 0, Math.PI * 2);
    octx.fillStyle = '#fff'; octx.fill();
    octx.lineWidth = 2; octx.strokeStyle = ACCENT; octx.stroke();
    octx.strokeStyle = ACCENT; octx.lineWidth = 1.8; octx.lineCap = 'round';
    if (kind === 'refill') {
      octx.setLineDash([2, 1.6]); octx.lineWidth = 1.4;
      octx.strokeRect(x - 4.5, y - 4.5, 9, 9);
      octx.setLineDash([]);
      octx.fillStyle = ACCENT;
      for (const [u, v] of [[-1.6, -1.2], [1.4, -1.6], [0, 1.5]]) { octx.beginPath(); octx.arc(x + u, y + v, 1.3, 0, Math.PI * 2); octx.fill(); }
    } else if (kind === 'resize') {
      octx.beginPath(); octx.moveTo(x - 4, y - 4); octx.lineTo(x + 4, y + 4);
      octx.moveTo(x + 4, y + 0.5); octx.lineTo(x + 4, y + 4); octx.lineTo(x + 0.5, y + 4);
      octx.moveTo(x - 4, y - 0.5); octx.lineTo(x - 4, y - 4); octx.lineTo(x - 0.5, y - 4);
      octx.stroke();
    } else {
      octx.beginPath(); octx.arc(x, y, 5, -Math.PI * 0.9, Math.PI * 0.6); octx.stroke();
      octx.beginPath(); octx.moveTo(x + 5 * Math.cos(Math.PI * 0.6) - 3, y + 5 * Math.sin(Math.PI * 0.6));
      octx.lineTo(x + 5 * Math.cos(Math.PI * 0.6), y + 5 * Math.sin(Math.PI * 0.6));
      octx.lineTo(x + 5 * Math.cos(Math.PI * 0.6) + 0.5, y + 5 * Math.sin(Math.PI * 0.6) - 3);
      octx.stroke();
    }
  }
  function drawScaleHandle(x, y) {
    octx.fillStyle = '#fff'; octx.strokeStyle = ACCENT; octx.lineWidth = 2;
    octx.beginPath(); octx.rect(x - 6, y - 6, 12, 12); octx.fill(); octx.stroke();
  }
  // Corner handles of a group selection (screen position + opposite corner in page units as anchor).
  function scaleCorners(b) {
    const p0 = toScreen(b.x, b.y), p1 = toScreen(b.x + b.w, b.y + b.h), pad = 6;
    return [
      { sx: p0.x - pad, sy: p0.y - pad, corner: { x: b.x, y: b.y }, anchor: { x: b.x + b.w, y: b.y + b.h } },
      { sx: p1.x + pad, sy: p0.y - pad, corner: { x: b.x + b.w, y: b.y }, anchor: { x: b.x, y: b.y + b.h } },
      { sx: p0.x - pad, sy: p1.y + pad, corner: { x: b.x, y: b.y + b.h }, anchor: { x: b.x + b.w, y: b.y } },
      { sx: p1.x + pad, sy: p1.y + pad, corner: { x: b.x + b.w, y: b.y + b.h }, anchor: { x: b.x, y: b.y } },
    ];
  }
  function hitHandle(sp) {
    if (!selection) return null;
    const ag = singleSelectedAgg();
    if (ag) {
      const p0 = toScreen(ag.x, ag.y), p1 = toScreen(ag.x + ag.w, ag.y + ag.h);
      const cands = [
        { kind: 'scale', x: p1.x, y: p1.y },
        { kind: 'rotate', x: p1.x, y: p0.y },
      ];
      if (canRefill(ag)) cands.push({ kind: 'refill', x: p0.x, y: p1.y });
      let best = null, bd = 20;
      for (const c of cands) { const dd = Math.hypot(sp.x - c.x, sp.y - c.y); if (dd <= bd) { bd = dd; best = c; } }
      return best ? { kind: best.kind } : null;
    }
    const b = selectionBounds();
    if (!b) return null;
    for (const c of scaleCorners(b)) if (Math.hypot(sp.x - c.sx, sp.y - c.sy) <= 20) return { kind: 'scale', ...c };
    return null;
  }
  // Only generated (box) aggregates can be refilled; hand-drawn structures can only be scaled.
  function canRefill(ag) { return ag.kind !== 'chain' && !ag.edited; }
  function startHandleAction(e, sp, h) {
    const base = { id: e.pointerId, ptype: e.pointerType, t0: now(), start: sp, startP: toPage(sp), moved: false };
    const ag = singleSelectedAgg();
    if (h.kind === 'scale' && ag) {
      // Bottom-right: uniform scale about the top-left corner (structure unchanged).
      action = { ...base, kind: 'scale', anchor: { x: ag.x, y: ag.y }, d: { x: ag.w, y: ag.h }, s: 1 };
    } else if (h.kind === 'refill') {
      // Bottom-left: new box (top-right corner fixed), regenerated to fill it.
      action = { ...base, kind: 'resize', item: ag.id, right: ag.x + ag.w, box: { x: ag.x, y: ag.y, w: ag.w, h: ag.h } };
    }
    else if (h.kind === 'rotate') action = { ...base, kind: 'rotate', item: ag.id, last: sp, pushed: false };
    else action = { ...base, kind: 'scale', anchor: h.anchor, d: { x: h.corner.x - h.anchor.x, y: h.corner.y - h.anchor.y }, s: 1 };
    requestRender();
  }

  // ============================================================
  // Input diagnostics (menu -> Input diagnostics). Records raw events and the
  // app's decisions so problems on a real device can be diagnosed.
  // ============================================================
  const diag = { on: false, lines: [], started: 0, saved: 0, interrupted: 0, ignored: 0, t0: 0, moves: new Map(), raf: 0 };
  function dlog(msg) {
    if (!diag.on) return;
    diag.lines.push(((now() - diag.t0) / 1000).toFixed(3).padStart(8) + '  ' + msg);
    if (diag.lines.length > 600) diag.lines.shift();
    if (!diag.raf) diag.raf = requestAnimationFrame(renderDiag);
  }
  function renderDiag() {
    diag.raf = 0;
    $('diagSum').textContent = `strokes ${diag.started} · saved ${diag.saved} · interrupted ${diag.interrupted} · ignored ${diag.ignored}`;
    $('diagLog').textContent = diag.lines.slice(-26).join('\n');
  }
  function diagHeader() {
    return [
      'AggBoard input diagnostics',
      'userAgent: ' + navigator.userAgent,
      `screen ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio} maxTouchPoints ${navigator.maxTouchPoints}`,
      `fingersDraw ${settings.fingersDraw} penSeen ${settings.penSeen} coalesced ${typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype} predicted ${typeof PointerEvent !== 'undefined' && 'getPredictedEvents' in PointerEvent.prototype}`,
      `summary: strokes ${diag.started}, saved ${diag.saved}, interrupted ${diag.interrupted}, ignored ${diag.ignored}`,
      '',
    ].join('\n');
  }
  const fmtPt = (e) => `${e.pointerType || '?'}#${e.pointerId} p=${(e.pressure || 0).toFixed(2)} ${Math.round(e.width || 0)}x${Math.round(e.height || 0)} @${Math.round(e.clientX)},${Math.round(e.clientY)}`;
  // Raw events, captured before the app handles them.
  board.addEventListener('pointerdown', (e) => { diag.moves.set(e.pointerId, 0); dlog('down    ' + fmtPt(e)); }, true);
  board.addEventListener('pointermove', (e) => { if (diag.moves.has(e.pointerId)) diag.moves.set(e.pointerId, diag.moves.get(e.pointerId) + 1); }, true);
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    board.addEventListener(t, (e) => {
      const m = diag.moves.get(e.pointerId);
      diag.moves.delete(e.pointerId);
      dlog((t === 'pointerup' ? 'up      ' : t === 'pointercancel' ? 'CANCEL  ' : 'lostcap ') + fmtPt(e) + (m != null ? ` moves=${m}` : ''));
    }, true);
  }
  for (const t of ['touchstart', 'touchend', 'touchcancel']) {
    board.addEventListener(t, (e) => {
      const kinds = [...(e.changedTouches || [])].map(tc => tc.touchType || 'n/a').join(',');
      dlog(`${t.padEnd(12)}touchType=${kinds} active=${(e.touches || []).length}`);
    }, { capture: true, passive: true });
  }
  $('mDiag').addEventListener('click', () => {
    closeMenu();
    diag.on = true; diag.t0 = now(); diag.lines = []; diag.started = diag.saved = diag.interrupted = diag.ignored = 0;
    $('diag').hidden = false;
    dlog('diagnostics on. Write a quick word with the pencil, then tap Copy.');
  });
  $('diagClose').addEventListener('click', () => { diag.on = false; $('diag').hidden = true; });
  $('diagClear').addEventListener('click', () => { diag.lines = []; diag.started = diag.saved = diag.interrupted = diag.ignored = 0; diag.t0 = now(); renderDiag(); });
  $('diagCopy').addEventListener('click', async () => {
    const text = diagHeader() + diag.lines.join('\n');
    try { await navigator.clipboard.writeText(text); toast('Diagnostics copied. Paste them into your message.'); }
    catch (_) {
      const ta = $('diagText');
      ta.value = text; ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (__) {}
      toast(ok ? 'Diagnostics copied. Paste them into your message.' : 'Could not copy automatically. Take a screenshot instead.');
    }
  });

  // ============================================================
  // Input
  // ============================================================
  const pointers = new Map();   // pointerId -> { x, y, type }
  let action = null;            // current single-pointer tool action
  let nav = null;               // pan / zoom gesture
  let hover = null;             // last hover position (screen), for the eraser cursor
  let lastTap = null;           // { id, t } for double-tap detection on aggregates
  let pendingDot = null;        // { stroke, timer, page }: a tap-dot on an aggregate, held back in case it is a double-tap
  let laserTrails = [];
  let wheelTimer = 0;
  let lastPenUp = -1e9;
  const TAP_AFTER_PEN_MS = 1000;   // a finger tap this soon after the Pencil lifted keeps the selection
  const PALM_CONTACT = 90;   // px; contacts larger than this right after writing are treated as a palm
  const PALM_ALWAYS = 80;    // px; with a pencil in use, contacts this large are a palm at any time
  const isPalmSize = (e) => e.pointerType === 'touch' && e.width > PALM_ALWAYS && e.height > PALM_ALWAYS;

  const fingersDraw = () => settings.fingersDraw;
  const pressureOf = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  const screenPt = (e) => ({ x: e.clientX, y: e.clientY });

  // Any Pencil contact hands drawing back to the Pencil: fingers move the page again.
  function notePen() {
    const first = !settings.penSeen;
    if (!first && !settings.fingersDraw) return;
    settings.penSeen = true;
    if (settings.fingersDraw) {
      settings.fingersDraw = false;
      toast(first ? 'Apple Pencil detected: the Pencil draws, fingers move the page. The finger button next to … lets fingers draw again.'
                  : 'Pencil: fingers move the page again.', first ? 6000 : 2500);
    }
    saveSettings();
    updateChrome();
  }
  function setFingersDraw(on) {
    settings.fingersDraw = on;
    saveSettings();
    updateChrome();
    toast(on ? (settings.penSeen ? 'Fingers draw. Touch the screen with the Pencil to switch back.' : 'Fingers draw.') : 'Fingers move the page.', 3000);
  }
  $('btnFingers').addEventListener('click', () => setFingersDraw(!settings.fingersDraw));

  board.addEventListener('contextmenu', (e) => e.preventDefault());
  board.addEventListener('pointerdown', onDown);
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
  board.addEventListener('pointercancel', onCancel);
  board.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) onCancel(e); });
  board.addEventListener('pointerleave', (e) => { if (!pointers.has(e.pointerId)) { hover = null; requestOverlay(); } });
  board.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  // Pointer events still arrive; cancelling the touch events stops iPadOS from
  // interpreting fast Pencil on/off sequences as system gestures.
  for (const t of ['touchstart', 'touchmove', 'touchend']) board.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  function onDown(e) {
    closeMenu();
    if (panelId) closePanel();
    const type = e.pointerType;
    if (type === 'pen') {
      notePen();
      if (nav) endNav();
      if (action && action.ptype === 'touch') cancelAction();
      if (action && action.ptype === 'pen') { dlog('  -> previous stroke never got a pen-up: finishing it'); pointers.delete(action.id); finishAction(null); }   // lost pen-up
    }
    if (type === 'touch' && action && action.ptype === 'pen') { diag.ignored++; dlog('  -> ignored: pencil is down (palm)'); return; }
    // Palm between strokes: a touch right after the pencil lifted, or a palm-sized contact
    // shortly after writing. (iPadOS reports a normal fingertip as ~40-55 px across, so the
    // size limit must be well above that, or pinch and pan with fingers stop working.)
    if (type === 'touch' && settings.penSeen && !fingersDraw() &&
        (now() - lastPenUp < 350 || isPalmSize(e) || (e.width > PALM_CONTACT && e.height > PALM_CONTACT && now() - lastPenUp < 3000))) {
      diag.ignored++; dlog(`  -> ignored: palm guard (${Math.round(now() - lastPenUp)} ms after pen-up, contact ${Math.round(e.width)}x${Math.round(e.height)})`);
      return;
    }
    try { board.setPointerCapture(e.pointerId); } catch (_) {}
    const sp = screenPt(e);
    pointers.set(e.pointerId, { x: sp.x, y: sp.y, type });

    if (type === 'mouse' && e.button !== 0) { startNav([e.pointerId], false); return; }

    if (type === 'touch') {
      const touchIds = [...pointers].filter(([, q]) => q.type === 'touch').map(([id]) => id);
      if (touchIds.length >= 2) {
        if (action && action.ptype === 'touch') { dlog('  -> second touch: current touch stroke cancelled'); cancelAction(); }
        dlog(`  -> pan/zoom with ${touchIds.length} touches`);
        startNav(touchIds, false);
        return;
      }
      if (!fingersDraw()) {
        const h = hitHandle(sp);
        if (h) { startHandleAction(e, sp, h); return; }
        const p = toPage(sp);
        const ag = singleSelectedAgg();
        if (ag && inRect(p, ag, 6 / view.scale)) {
          action = { kind: 'rotate', id: e.pointerId, ptype: type, item: ag.id, last: sp, start: sp, t0: now(), moved: false, pushed: false };
          return;
        }
        dlog('  -> pan (finger in pan-and-zoom mode)');
        startNav(touchIds, true);
        return;
      }
    }
    startToolAction(e, sp);
    if (action && action.id === e.pointerId) {
      if (action.kind === 'draw') diag.started++;
      dlog('  -> ' + action.kind + (action.kind === 'draw' ? ` (tool pen, as ${type})` : ''));
    }
  }

  function startToolAction(e, sp) {
    const p = toPage(sp);
    if (pendingDot) {
      const ag = topAggAt(p);
      if (!(ag && lastTap && ag.id === lastTap.id)) commitPendingDot();
    }
    const base = { id: e.pointerId, ptype: e.pointerType, t0: now(), start: sp, startP: p, moved: false };

    if (selection) {
      const h = hitHandle(sp);
      if (h) { startHandleAction(e, sp, h); return; }
      const b = selectionBounds();
      if (b && inRect(p, b, 8 / view.scale)) { action = { ...base, kind: 'move', dx: 0, dy: 0 }; requestRender(); return; }   // selected things move, with any tool
      dlog(`  -> deselected: ${e.pointerType} down outside the selection`);
      clearSelection();
      base.deselected = true;   // a tap that only deselects leaves no mark; a stroke started here still draws
    }

    switch (settings.tool) {
      case 'pen': {
        const pr = pressureOf(e);
        action = { ...base, kind: 'draw', pts: [p.x, p.y, pr], ps: pr, color: settings.color, width: WIDTHS[settings.width], hold: { x: sp.x, y: sp.y } };
        armHold();
        requestOverlay();
        break;
      }
      case 'eraser':
        action = { ...base, kind: 'erase', erased: new Set(), last: p };
        hover = sp;
        eraseAlong(p, p);
        requestRender();
        break;
      case 'select':
        action = { ...base, kind: 'lasso', poly: [p.x, p.y] };
        break;
      case 'laser': {
        const tr = { pts: [{ x: p.x, y: p.y, t: now() }], active: true };
        laserTrails.push(tr);
        action = { ...base, kind: 'laser', trail: tr };
        requestOverlay();
        break;
      }
      case 'chain':
        action = { ...base, kind: 'chain', pts: [p.x, p.y], startHit: sphereAt(p) };
        requestOverlay();
        break;
      case 'aggregate':
        if (settings.aggCreate === 'circle') {
          action = { ...base, kind: 'circle', cx: p.x, cy: p.y, sy: sp.y, a0: settings.agg.a, a: settings.agg.a, R: 0,
                     seed: randSeed(), hold: { x: sp.x, y: sp.y }, tip: sp, preview: null, previewReq: null, previewBmp: null,
                     dial: { x: sp.x, y: sp.y, ang: null, acc: 0, active: false, straight: 0, base: { R: 0, a: settings.agg.a } } };
          armCircleRest();
          refreshDfScale();
          requestOverlay();
          break;
        }
        action = { ...base, kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        requestOverlay();
        break;
    }
  }

  function onMove(e) {
    const sp = screenPt(e);
    const rec = pointers.get(e.pointerId);
    if (!rec) {
      if (e.pointerType !== 'touch') { hover = sp; if (settings.tool === 'eraser') requestOverlay(); }
      return;
    }
    rec.x = sp.x; rec.y = sp.y;
    if (nav && nav.ids.includes(e.pointerId)) {
      if (settings.penSeen && !fingersDraw() && isPalmSize(e)) { rejectPalmInNav(e); return; }
      updateNav();
      return;
    }
    if (action && action.id === e.pointerId && action.kind === 'rotate' && action.ptype === 'touch' && settings.penSeen && isPalmSize(e)) {
      // a palm on a selected aggregate: undo the rotation it caused
      dlog(`  -> palm detected while rotating (contact ${Math.round(e.width)}x${Math.round(e.height)}): rotation undone`);
      const a = action; action = null; pointers.delete(e.pointerId);
      if (a.pushed) undo();
      return;
    }
    if (!action || action.id !== e.pointerId) return;
    hover = sp;
    if (!action.moved && Math.hypot(sp.x - action.start.x, sp.y - action.start.y) > TAP_SLOP) action.moved = true;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const list = evs.length ? evs : [e];

    switch (action.kind) {
      case 'draw': {
        for (const ev of list) addDrawPoint(ev);
        const dh = Math.hypot(sp.x - action.hold.x, sp.y - action.hold.y);
        if (action.snap) {
          if (dh > UNSNAP_PX) { action.snap = null; action.hold = { x: sp.x, y: sp.y }; armHold(); dlog('  -> snap released (moved on)'); }
        } else if (dh > HOLD_SLOP) { action.hold = { x: sp.x, y: sp.y }; armHold(); }
        const pred = (e.getPredictedEvents && e.getPredictedEvents()) || [];
        action.pred = pred.map(ev => toPage(screenPt(ev)));
        requestOverlay();
        break;
      }
      case 'erase':
        for (const ev of list) { const q = toPage(screenPt(ev)); eraseAlong(action.last, q); action.last = q; }
        requestRender();
        break;
      case 'lasso': {
        const q = toPage(sp), poly = action.poly;
        if (Math.hypot(q.x - poly[poly.length - 2], q.y - poly[poly.length - 1]) > 2 / view.scale) poly.push(q.x, q.y);
        requestOverlay();
        break;
      }
      case 'laser':
        for (const ev of list) { const q = toPage(screenPt(ev)); action.trail.pts.push({ x: q.x, y: q.y, t: now() }); }
        requestOverlay();
        break;
      case 'chain': {
        const P = action.pts;
        for (const ev of list) {
          const q = toPage(screenPt(ev));
          if (Math.hypot(q.x - P[P.length - 2], q.y - P[P.length - 1]) >= 0.5 / view.scale) P.push(q.x, q.y);
        }
        requestOverlay();
        break;
      }
      case 'circle': {
        const q = toPage(sp), A = action;
        if (!A.dial.active) {                    // while dialling, radius and monomer size stay frozen
          A.R = Math.abs(q.x - A.cx);
          const dy = sp.y - A.sy;
          const eff = Math.sign(dy) * Math.max(0, Math.abs(dy) - CIRCLE_DEAD);
          A.a = clamp(A.a0 * Math.pow(2, -eff / CIRCLE_OCTAVE), 1, 120);
        }
        for (const ev of list) dialStep(A, screenPt(ev));
        A.tip = sp;
        if (Math.hypot(sp.x - A.hold.x, sp.y - A.hold.y) > 4) {
          A.hold = { x: sp.x, y: sp.y };
          A.preview = null; A.previewReq = null; A.previewBmp = null;   // moving: outline only
          armCircleRest();
        }
        requestOverlay();
        break;
      }
      case 'box': {
        const q = toPage(sp);
        action.x1 = q.x; action.y1 = q.y;
        requestOverlay();
        break;
      }
      case 'move': {
        const q = toPage(sp);
        action.dx = q.x - action.startP.x; action.dy = q.y - action.startP.y;
        requestRender();
        break;
      }
      case 'scale': {
        const q = toPage(sp), A = action.anchor, D = action.d;
        const L = D.x * D.x + D.y * D.y || 1;
        let k = ((q.x - A.x) * D.x + (q.y - A.y) * D.y) / L;
        const minK = 8 / Math.max(1e-6, Math.sqrt(L));     // keep the group at least ~8 page units across
        action.s = clamp(k, minK, 20);
        requestRender();
        break;
      }
      case 'resize': {
        const q = toPage(sp), b = action.box;
        b.x = Math.min(q.x, action.right - MIN_BOX);
        b.w = action.right - b.x;
        b.h = Math.max(MIN_BOX, q.y - b.y);
        requestOverlay();
        break;
      }
      case 'rotate': {
        const dx = sp.x - action.last.x, dy = sp.y - action.last.y;
        action.last = sp;
        if (action.moved) rotateAgg(action, dx, dy);
        break;
      }
    }
  }

  function addDrawPoint(ev) {
    const q = toPage(screenPt(ev)), pts = action.pts;
    const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
    if (Math.hypot(q.x - lx, q.y - ly) < 0.6 / view.scale) return;
    action.ps = action.ps * 0.6 + pressureOf(ev) * 0.4;
    pts.push(q.x, q.y, action.ps);
  }

  function onUp(e) { endPointer(e, false); }
  // pointercancel / lostpointercapture: iPadOS Safari sends these when it suspects a
  // system gesture (Scribble, double-tap, ...), e.g. during fast print writing.
  // The work done so far is kept, never thrown away.
  function onCancel(e) { endPointer(e, true); }
  function endPointer(e, cancelled) {
    if (e.pointerType === 'pen') lastPenUp = now();
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    pointers.delete(e.pointerId);
    if (nav && nav.ids.includes(e.pointerId)) { endNavPointer(e, cancelled); return; }
    if (!action || action.id !== e.pointerId) return;
    finishAction(cancelled ? null : e);
  }
  // Finish the current action. e = the pointerup event, or null if the pointer was
  // interrupted (then the last known position is used and nothing counts as a tap).
  function finishAction(e) {
    const a = action;
    action = null;
    if (!a) return;
    const interrupted = !e;
    if (interrupted) { diag.interrupted++; dlog(`  -> ${a.kind} interrupted: keeping what was drawn`); }
    if (a.ptype === 'touch') hover = null;
    if (interrupted && (a.kind === 'box' || a.kind === 'lasso' || a.kind === 'circle')) {
      if (a.kind === 'circle') { clearTimeout(circleTimer); latestToken.delete(PREVIEW_ID); pendingGen.delete(PREVIEW_ID); refreshDfScale(); }
      requestRender(); return;
    }
    let p;
    if (e) p = toPage(screenPt(e));
    else if ((a.kind === 'draw') && a.pts.length >= 3) p = { x: a.pts[a.pts.length - 3], y: a.pts[a.pts.length - 2] };
    else if (a.kind === 'chain' && a.pts.length >= 2) p = { x: a.pts[a.pts.length - 2], y: a.pts[a.pts.length - 1] };
    else p = a.startP || { x: 0, y: 0 };
    const isTap = !interrupted && !a.moved && now() - a.t0 < TAP_MS;

    switch (a.kind) {
      case 'draw':
        if (!isTap && e) { action = a; addDrawPoint(e); action = null; }   // keep the very end of fast strokes
        finishDraw(a, isTap, p);
        break;
      case 'erase':
        if (a.erased.size) { pushUndo(); setItems(items().filter(it => !a.erased.has(it.id))); }
        else if (isTap && handleTap(p) === 'single-agg') selectIds([topAggAt(p).id]);
        break;
      case 'lasso':
        if (isTap || a.poly.length < 6) { if (handleTap(p) !== 'double') tapSelect(p); }
        else lassoSelect(a.poly);
        break;
      case 'laser':
        a.trail.active = false;
        break;
      case 'box': finishBox(a, isTap, p); break;
      case 'circle': finishCircle(a, isTap, p); break;
      case 'chain': finishChain(a, isTap, p); break;
      case 'move':
        if (a.moved && (a.dx || a.dy)) commitMove(a.dx, a.dy);
        else if (isTap) handleTap(p);
        break;
      case 'resize': commitResize(a); break;
      case 'scale': if (Math.abs(a.s - 1) > 0.005) commitScale(a.anchor, a.s); break;
      case 'rotate':
        if (isTap) handleTap(p);
        break;
    }
    requestRender();
  }
  function cancelAction() {
    if (action && action.kind === 'circle') { clearTimeout(circleTimer); latestToken.delete(PREVIEW_ID); pendingGen.delete(PREVIEW_ID); refreshDfScale(); }
    if (action && action.kind === 'laser') action.trail.active = false;
    action = null;
    requestRender();
  }

  // ---------- navigation ----------
  function navState(ids) {
    const pts = ids.map(id => pointers.get(id)).filter(Boolean);
    if (!pts.length) return null;
    let cx = 0, cy = 0;
    for (const q of pts) { cx += q.x; cy += q.y; }
    cx /= pts.length; cy /= pts.length;
    const dist = pts.length >= 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : null;
    return { cx, cy, dist, n: pts.length };
  }
  function rejectPalmInNav(e) {
    diag.ignored++;
    dlog(`  -> palm detected while moving the page (contact ${Math.round(e.width)}x${Math.round(e.height)}): view restored`);
    const sv = nav.startView;
    view.scale = sv.scale; view.ox = sv.ox; view.oy = sv.oy; view.fit = sv.fit;
    pointers.delete(e.pointerId);
    nav.ids = nav.ids.filter(id => id !== e.pointerId);
    if (nav.ids.length) { nav.last = navState(nav.ids); nav.tap = false; nav.startView = { ...sv }; }
    else endNav();
    requestRender();
  }
  function startNav(ids, tap) {
    const prevStart = nav && nav.startView;
    nav = { ids: ids.slice(), last: navState(ids), travel: 0, t0: now(), tap: tap && ids.length === 1,
            startView: { scale: view.scale, ox: view.ox, oy: view.oy, fit: view.fit } };
    void prevStart;
    gestureActive = true;
  }
  function updateNav() {
    const st = navState(nav.ids), l = nav.last;
    if (!st || !l || st.n !== l.n) { nav.last = st; return; }
    const dx = st.cx - l.cx, dy = st.cy - l.cy;
    nav.travel += Math.hypot(dx, dy);
    if (nav.travel > TAP_SLOP || st.n > 1) {
      view.ox += dx; view.oy += dy;
      if (st.dist && l.dist) zoomAbout(st.cx, st.cy, st.dist / l.dist);
      view.fit = false;
      requestRender();
    }
    if (st.n > 1) nav.tap = false;
    nav.last = st;
  }
  function endNavPointer(e, cancelled) {
    nav.ids = nav.ids.filter(id => id !== e.pointerId);
    if (nav.ids.length) { nav.last = navState(nav.ids); return; }
    const wasTap = !cancelled && nav.tap && nav.travel <= TAP_SLOP && now() - nav.t0 < TAP_MS;
    endNav();
    if (wasTap) {
      const p = toPage(screenPt(e));
      // A finger tap shortly after the Pencil lifted is most likely the hand that rested on
      // the screen: it must not change the selection (e.g. deselect a just-placed aggregate).
      if (e.pointerType === 'touch' && settings.penSeen && now() - lastPenUp < TAP_AFTER_PEN_MS) {
        dlog(`  -> tap ${Math.round(now() - lastPenUp)} ms after pen-up: selection kept (palm)`);
        return;
      }
      const r = handleTap(p);
      if (r === 'single-agg') selectIds([topAggAt(p).id]);
      else if (r === 'none') { if (selection) dlog('  -> deselected: finger tap on an empty spot'); clearSelection(); }
    }
  }
  function endNav() {
    nav = null;
    gestureActive = false;
    requestRender();
  }
  let wheelDf = 0;
  function onWheel(e) {
    e.preventDefault();
    if (action && action.kind === 'circle') {           // scrolling while placing: change Df
      wheelDf += -e.deltaY * 0.0005;
      const step = Math.trunc(wheelDf * 100) / 100;     // in 0.01 steps
      if (step) { wheelDf -= step; setGestureDf(settings.agg.df + step); }
      return;
    }
    if (e.ctrlKey || e.metaKey) zoomAbout(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else { view.ox -= e.deltaX; view.oy -= e.deltaY; view.fit = false; }
    gestureActive = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { gestureActive = false; requestRender(); }, 160);
    requestRender();
  }

  // ---------- taps ----------
  function handleTap(p) {
    const ag = topAggAt(p), t = now();
    if (ag && lastTap && lastTap.id === ag.id && t - lastTap.t < DOUBLE_MS) {
      lastTap = null;
      selectIds([ag.id]);
      openPanel(ag.id);
      return 'double';
    }
    lastTap = ag ? { id: ag.id, t } : null;
    return ag ? 'single-agg' : 'none';
  }
  function tapSelect(p) {
    const it = topItemAt(p);
    if (it) selectIds([it.id]); else clearSelection();
  }

  // ---------- tool results ----------
  function makeStroke(a) {
    const pts = a.pts.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
    return { id: uid(), type: 'stroke', color: a.color, width: a.width, points: pts };
  }
  function finishDraw(a, isTap, p) {
    clearTimeout(holdTimer);
    if (a.snap) {
      const st = shapeStroke(a, a.snap);
      commitPendingDot();
      pushUndo();
      const base = a.snap.replaceId ? items().filter(it => it.id !== a.snap.replaceId) : items();
      setItems([...base, st]);
      diag.saved++;
      dlog(`  -> ${a.snap.kind} saved`);
      return;
    }
    const stroke = makeStroke(a);
    if (isTap) {
      const r = handleTap(p);
      if (r === 'double') return;
      if (r === 'single-agg') { selectIds([topAggAt(p).id]); return; }
      if (a.deselected) { dlog('  -> tap only deselected, no dot'); return; }
    }
    commitPendingDot();
    pushUndo();
    setItems([...items(), stroke]);
    diag.saved++;
    dlog(`  -> stroke saved (${stroke.points.length / 3} points${isTap ? ', dot' : ''})`);
  }
  function commitPendingDot() {
    if (!pendingDot) return;
    clearTimeout(pendingDot.timer);
    const { stroke, page } = pendingDot;
    pendingDot = null;
    if (page !== curPage()) return;
    pushUndo();
    setItems([...items(), stroke]);
  }

  function eraseAlong(a, b) {
    const r = ERASER_PX / view.scale;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
    const er = action.erased;
    for (const it of items()) {
      if (it.type !== 'stroke' || er.has(it.id)) continue;
      const bb = strokeGeom(it).bbox;
      if (Math.max(a.x, b.x) < bb.x - r || Math.min(a.x, b.x) > bb.x + bb.w + r ||
          Math.max(a.y, b.y) < bb.y - r || Math.min(a.y, b.y) > bb.y + bb.h + r) continue;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        if (distToStroke(it, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) <= r + it.width / 2) { er.add(it.id); break; }
      }
    }
  }

  function finishBox(a, isTap, p) {
    const x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1);
    const w = Math.abs(a.x1 - a.x0), h = Math.abs(a.y1 - a.y0);
    if (isTap || w < MIN_BOX || h < MIN_BOX) {
      const r = handleTap(p);
      if (r === 'none') toast('Drag a box to place an aggregate.');
      else if (r === 'single-agg') selectIds([topAggAt(p).id]);
      return;
    }
    const A = settings.agg;
    const it = {
      id: uid(), type: 'agg', x, y, w, h,
      a: A.a, df: A.df, kf: A.kf, seed: randSeed(), color: A.color, method: A.method,
      ...(A.ns ? { ns: A.ns } : {}), ...(A.sigma > 1 ? { sigma: A.sigma } : {}),
      ...(A.showNums ? { showNums: true } : {}), ...(A.showRg ? { showRg: true } : {}), ...(A.showGrowth ? { showGrowth: true } : {}), ...(A.showMR ? { showMR: true } : {}),
      R: IDENTITY.slice(), pts: null, n: 0, rg: 0, dfFit: null, capped: false, needsGen: true,
    };
    pushUndo();
    setItems([...items(), it]);
    requestGen(it);
    dfScaleItem = it.id;
    selectIds([it.id]);
    setTool(prevTool);
  }

  // ---------- circle placement (aggregate tool, "Circle" setting) ----------
  // Pencil down at the centre; horizontal distance = outer radius; vertical offset =
  // monomer size (log scale: x2 per 80 px up, /2 per 80 px down, 12 px dead zone).
  // While moving: circle, monomer ring, N estimate. At rest (250 ms): real aggregate.
  const CIRCLE_DEAD = 12, CIRCLE_OCTAVE = 80, CIRCLE_REST_MS = 250;
  // Dial (experimental): small loops while placing change Df; clockwise = higher.
  const DIAL_PER_LOOP = 0.3, DIAL_START = 1.5 * Math.PI, DIAL_RELEASE_PX = 40;   // Df change per full loop (tuned up from 0.1)
  // Collect fractional changes until they make a whole 0.01 step (Df is kept in 0.01 steps).
  function dialApply(D, delta) {
    D.frac = (D.frac || 0) + delta;
    const step = Math.trunc(D.frac * 100) / 100;
    if (step) { D.frac -= step; setGestureDf(settings.agg.df + step); }
  }
  function dialStep(A, sp) {
    const D = A.dial, dx = sp.x - D.x, dy = sp.y - D.y, len = Math.hypot(dx, dy);
    if (len < 3) return;                        // ignore jitter: direction from movements of 3 px or more
    const ang = Math.atan2(dy, dx);
    D.x = sp.x; D.y = sp.y;
    if (D.ang === null) { D.ang = ang; return; }
    let turn = ang - D.ang;
    if (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < -Math.PI) turn += 2 * Math.PI;
    D.ang = ang;
    if (Math.abs(turn) > 2.6) return;           // sudden reversal: not part of a loop
    D.straight = Math.abs(turn) < 0.12 ? D.straight + len : 0;
    if (D.active) {
      if (Math.abs(turn) < 0.9) dialApply(D, (turn / (2 * Math.PI)) * DIAL_PER_LOOP);   // loops turn gradually; a sharp corner is leaving the dial
      if (D.straight > DIAL_RELEASE_PX) { D.active = false; D.acc = 0; D.frac = 0; dlog('  -> dial released'); }
      return;
    }
    // remember radius and monomer size from before the loops began
    if (D.straight > 25 || (D.acc && Math.sign(turn) !== Math.sign(D.acc))) { D.acc = 0; D.base = { R: A.R, a: A.a }; }
    if (!D.acc) D.base = D.base || { R: A.R, a: A.a };
    D.acc += turn;
    if (Math.abs(D.acc) > DIAL_START) {
      D.active = true;
      A.R = D.base.R; A.a = D.base.a;           // undo the wobble of the first loop
      D.frac = 0;
      dialApply(D, (D.acc / (2 * Math.PI)) * DIAL_PER_LOOP);
      dlog('  -> dial active');
    }
  }
  let circleTimer = 0;
  function circleItem(a) {
    const A = settings.agg;
    return {
      id: PREVIEW_ID, type: 'agg', x: a.cx - a.R, y: a.cy - a.R, w: 2 * a.R, h: 2 * a.R,
      a: a.a, df: A.df, kf: A.kf, seed: a.seed, color: A.color, method: A.method, fitShape: 'circle',
      ...(A.ns ? { ns: A.ns } : {}), R: IDENTITY.slice(), ...(A.sigma > 1 ? { sigma: A.sigma } : {}),
      ...(A.showNums ? { showNums: true } : {}), ...(A.showRg ? { showRg: true } : {}), ...(A.showGrowth ? { showGrowth: true } : {}), ...(A.showMR ? { showMR: true } : {}),
    };
  }
  function estimateN(R, a) {
    const df = settings.agg.df, kf = settings.agg.kf != null ? settings.agg.kf : window.AggEngine.kfAuto(df, settings.agg.sigma || 1);
    const rg = Math.max(0, R / a - 1) * Math.sqrt(df / (df + 2));
    return Math.max(1, Math.round(kf * Math.pow(rg, df)));
  }
  function armCircleRest() {
    clearTimeout(circleTimer);
    const a = action;
    circleTimer = setTimeout(() => {
      if (action !== a || !a || a.kind !== 'circle' || a.R < MIN_BOX / 2) return;
      a.previewReq = { R: a.R, a: a.a, token: requestGen(circleItem(a)) };
    }, CIRCLE_REST_MS);
  }
  // ---------- Df scale ----------
  // Visible on the left edge whenever the aggregate tool is active ("tool" mode: sets the Df
  // for the next aggregate), and after placing an aggregate, as long as that aggregate stays
  // selected ("item" mode: changes it, one undo step per slide).
  const dfScaleEl = $('dfScale'), dfTrack = $('dfTrack'), dfKnob = $('dfKnob');
  let dfScaleItem = null, dfScaleSession = false;
  function dfScaleMode() {
    // The freshly placed aggregate keeps the scale only until it is first deselected;
    // after that, its D_f is changed in its Settings.
    if (dfScaleItem && !(selection && selection.size === 1 && selection.has(dfScaleItem))) dfScaleItem = null;
    if (action && action.kind === 'circle') return 'tool';
    if (settings.tool === 'aggregate') return 'tool';
    if (dfScaleItem && selection && selection.size === 1 && selection.has(dfScaleItem)) {
      const it = findItem(dfScaleItem);
      if (it && it.type === 'agg' && it.kind !== 'chain' && !it.edited) return 'item';
    }
    return null;
  }
  function refreshDfScale() {
    const m = dfScaleMode();
    if (!m) { dfScaleEl.hidden = true; dfPointer = null; dfTouch = null; return; }
    const left = settings.hand !== 'left';   // away from the writing hand
    dfScaleEl.style.left = left ? 'calc(10px + env(safe-area-inset-left, 0px))' : 'auto';
    dfScaleEl.style.right = left ? 'auto' : 'calc(10px + env(safe-area-inset-right, 0px))';
    dfScaleEl.hidden = false;
    updateDfScale();
  }
  function scaleDf() {
    if (dfScaleMode() === 'item') { const it = findItem(dfScaleItem); if (it) return it.df; }
    return settings.agg.df;
  }
  function updateDfScale() {
    const df = scaleDf();
    dfKnob.style.bottom = ((df - 1) / 2 * 100) + '%';
    $('dfScaleVal').textContent = df.toFixed(2);
  }
  function setScaleDf(df) {
    df = clamp(Math.round(df * 100) / 100, 1, 3);
    if (dfScaleMode() === 'item') {
      const it = findItem(dfScaleItem);
      if (!it || it.df === df) return;
      if (!dfScaleSession) { pushUndo(); dfScaleSession = true; }
      const ni = { ...it, df, needsGen: true };
      replaceItem(ni);
      requestGen(ni);
      settings.agg.df = df; saveSettings();
      updateDfScale();
      return;
    }
    setGestureDf(df);
  }
  function setGestureDf(df) {
    df = clamp(Math.round(df * 100) / 100, 1, 3);
    if (df === settings.agg.df) return;
    settings.agg.df = df;
    saveSettings();
    if (!dfScaleEl.hidden) updateDfScale();
    if (action && action.kind === 'circle') {
      const A = action;
      A.preview = null; A.previewReq = null; A.previewBmp = null;
      latestToken.delete(PREVIEW_ID); pendingGen.delete(PREVIEW_ID);
      armCircleRest();
      requestOverlay();
    }
  }
  // Finger on the Df scale while the pencil draws the circle. On iPad the browser may deliver
  // a touch that starts during a pencil stroke to the surface where the stroke began, so the
  // scale cannot rely on receiving it directly: every non-pencil touch is checked here first
  // (capture phase, before the drawing surface and its palm rules), both as pointer events
  // and as touch events.
  const dfFromY = (y) => { const r = dfTrack.getBoundingClientRect(); return 1 + 2 * clamp(1 - (y - r.top) / (r.height || 1), 0, 1); };
  function onDfScale(x, y) {
    if (dfScaleEl.hidden) return false;
    const r = dfTrack.getBoundingClientRect(), pad = 8;   // the visible scale plus a small margin
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }
  let dfPointer = null, dfTouch = null;
  window.addEventListener('pointerdown', (e) => {
    if ((action && action.id === e.pointerId) || !onDfScale(e.clientX, e.clientY)) return;
    if (action && action.kind === 'circle' && e.pointerType === 'pen') return;   // the pencil drawing the circle
    dfPointer = e.pointerId; dfScaleSession = false;
    dlog(`df scale: ${e.pointerType}#${e.pointerId} down @${Math.round(e.clientX)},${Math.round(e.clientY)}`);
    setScaleDf(dfFromY(e.clientY));
    e.stopPropagation(); e.preventDefault();
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dfPointer) return;
    setScaleDf(dfFromY(e.clientY));
    e.stopPropagation();
  }, true);
  for (const t of ['pointerup', 'pointercancel']) {
    window.addEventListener(t, (e) => { if (e.pointerId === dfPointer) { dfPointer = null; dfScaleSession = false; e.stopPropagation(); } }, true);
  }
  // Touch-event path (used if the browser does not report the finger as a separate pointer).
  const fingerTouches = (e) => [...(e.changedTouches || [])].filter(t => t.touchType !== 'stylus');
  window.addEventListener('touchstart', (e) => {
    for (const t of fingerTouches(e)) {
      if (dfTouch === null && dfPointer === null && onDfScale(t.clientX, t.clientY)) {
        dfTouch = t.identifier; dfScaleSession = false;
        dlog(`df scale: touch ${t.identifier} start @${Math.round(t.clientX)},${Math.round(t.clientY)}`);
        setScaleDf(dfFromY(t.clientY));
      }
    }
    if (diag.on && action && action.kind === 'circle') {
      dlog(`touchstart during circle: ${[...(e.changedTouches || [])].map(t => `${t.touchType || 'n/a'}@${Math.round(t.clientX)},${Math.round(t.clientY)}`).join(' ')} target=${e.target && (e.target.id || e.target.className || e.target.tagName)}`);
    }
  }, { capture: true, passive: true });
  window.addEventListener('touchmove', (e) => {
    for (const t of fingerTouches(e)) if (t.identifier === dfTouch && dfPointer === null) setScaleDf(dfFromY(t.clientY));
  }, { capture: true, passive: true });
  for (const tt of ['touchend', 'touchcancel']) {
    window.addEventListener(tt, (e) => { for (const t of fingerTouches(e)) if (t.identifier === dfTouch) dfTouch = null; }, { capture: true, passive: true });
  }
  for (const t of ['touchstart', 'touchmove']) dfScaleEl.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  function onCirclePreview(m) {
    const a = action;
    if (!a || a.kind !== 'circle' || !a.previewReq || a.previewReq.token !== m.token) return;
    a.preview = { ...m, R: a.previewReq.R, a: a.previewReq.a };
    const pseudo = { ...circleItem(a), R: IDENTITY.slice(), pts: m.pts, n: m.n, a: a.previewReq.a };
    a.previewBmp = m.n ? renderAggBitmap(pseudo, dpr() * view.scale) : null;
    requestOverlay();
  }
  function finishCircle(a, isTap, p) {
    clearTimeout(circleTimer);
    refreshDfScale();
    latestToken.delete(PREVIEW_ID); pendingGen.delete(PREVIEW_ID);
    if (isTap || a.R < MIN_BOX / 2) {
      const r = handleTap(p);
      if (r === 'none') toast('Put the pencil at the centre and drag outwards to place an aggregate.');
      else if (r === 'single-agg') selectIds([topAggAt(p).id]);
      return;
    }
    const it = { ...circleItem(a), id: uid(), pts: null, n: 0, rg: 0, dfFit: null, capped: false, needsGen: true };
    const pv = a.preview;
    if (pv && Math.abs(pv.R - a.R) < 1e-9 && Math.abs(pv.a - a.a) < 1e-9) {
      // the aggregate seen at rest is exactly the one placed
      Object.assign(it, { pts: pv.pts, n: pv.n, rg: pv.rg, dfFit: pv.dfFit, aniso: pv.aniso, kfUsed: pv.kf, capped: !!pv.capped, ccaFallback: !!pv.ccaFallback, needsGen: false, groups: pv.groups || undefined, radii: pv.radii || undefined });
    }
    pushUndo();
    setItems([...items(), it]);
    if (it.needsGen) requestGen(it);
    settings.agg.a = a.a; saveSettings();
    dfScaleItem = it.id;
    selectIds([it.id]);
    setTool(prevTool);
  }

  function commitMove(dx, dy) {
    pushUndo();
    const sel = selection;
    setItems(items().map(it => (sel.has(it.id) ? translateItem(it, dx, dy) : it)));
  }
  function scaleItem(it, ax, ay, k) {
    if (it.type === 'agg') {
      // Coordinates are in monomer radii, so scaling the monomer size scales the whole aggregate exactly.
      const ni = { ...it, x: ax + (it.x - ax) * k, y: ay + (it.y - ay) * k, w: it.w * k, h: it.h * k, a: it.a * k };
      if (it.aGen) ni.aGen = it.aGen * k;
      if (it.path) { ni.path = it.path.map(v => Math.round(v * k * 1000) / 1000); if (it.pz) ni.pz = it.pz * k; }
      if (it.genBox) ni.genBox = { w: it.genBox.w * k, h: it.genBox.h * k };
      return ni;
    }
    const p = it.points.slice();
    for (let i = 0; i < p.length; i += 3) {
      p[i] = Math.round((ax + (p[i] - ax) * k) * 10) / 10;
      p[i + 1] = Math.round((ay + (p[i + 1] - ay) * k) * 10) / 10;
    }
    return { ...it, points: p, width: Math.max(0.3, Math.round(it.width * k * 100) / 100) };
  }
  function commitScale(A, k) {
    pushUndo();
    const sel = selection;
    setItems(items().map(it => (sel.has(it.id) ? scaleItem(it, A.x, A.y, k) : it)));
  }
  function commitResize(a) {
    const ag = findItem(a.item);
    if (!ag) return;
    const b = a.box;
    if (Math.abs(b.w - ag.w) < 0.5 && Math.abs(b.h - ag.h) < 0.5) return;
    pushUndo();
    const ni = { ...ag, x: b.x, y: b.y, w: b.w, h: b.h, needsGen: true };
    delete ni.fitShape;   // refilling a new box: box fitting from now on
    replaceItem(ni);
    requestGen(ni);
  }
  function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function matMul(A, B) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return r;
  }
  function rotateAgg(a, dx, dy) {
    const it = findItem(a.item);
    if (!it) return;
    if (!a.pushed) { pushUndo(); a.pushed = true; }
    const R = matMul(matMul(rotY(dx * 0.01), rotX(-dy * 0.01)), it.R);
    const ni = refitBox({ ...it, R });
    curPage().items = items().map(x => (x.id === it.id ? ni : x));
    nb.modified = Date.now();
    scheduleSave();
    updateChrome();
    requestRender();
  }

  // ============================================================
  // Tools, colours, widths (toolbar)
  // ============================================================
  let prevTool = settings.tool;
  function setTool(t) {
    if (t !== 'aggregate') prevTool = t;
    if (t === 'chain') clearSelection();
    settings.tool = t;
    saveSettings();
    for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
    board.style.cursor = t === 'eraser' ? 'none' : t === 'select' ? 'default' : 'crosshair';
    refreshDfScale();
    requestOverlay();
  }
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));

  const colorsEl = $('colors');
  INK.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.title = `${c.name} (${i + 1})`; b.setAttribute('aria-label', c.name);
    b.style.backgroundColor = c.v; b.dataset.color = c.v;
    b.addEventListener('click', () => setColor(c.v));
    colorsEl.appendChild(b);
  });
  function setColor(v) {
    settings.color = v;
    saveSettings();
    for (const b of colorsEl.children) b.classList.toggle('active', b.dataset.color === v);
    if (!recolorSelection(v) && !['pen'].includes(settings.tool) && settings.tool !== 'select') setTool('pen');
  }
  const widthsEl = $('widths');
  WIDTHS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'wbtn'; b.title = ['Thin', 'Medium', 'Thick'][i] + ' ([ / ])'; b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][i] + ' line');
    const dot = document.createElement('span');
    const px = [4, 7, 12][i];
    dot.style.width = dot.style.height = px + 'px';
    b.appendChild(dot);
    b.addEventListener('click', () => setWidth(i));
    widthsEl.appendChild(b);
  });
  function setWidth(i) {
    settings.width = i;
    saveSettings();
    [...widthsEl.children].forEach((b, j) => b.classList.toggle('active', j === i));
    if (settings.tool !== 'pen') setTool('pen');
  }

  $('btnUndo').addEventListener('click', undo);
  {
    const b = $('btnSpin');
    let holdTimer = 0, held = false;
    b.addEventListener('pointerdown', () => {
      held = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { held = true; startSpin('loop'); toast(settings.spinStyle === 'rock' ? 'Rocking continuously. Tap the button again to stop.' : 'Rotating continuously. Tap the button again to stop.', 2500); }, 500);
    });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, () => clearTimeout(holdTimer));
    b.addEventListener('click', () => {
      if (held) { held = false; return; }
      if (spin.mode === 'once' || spin.mode === 'loop') stopSpin(true); else startSpin('once');
    });
  }
  $('btnRedo').addEventListener('click', redo);
  $('versionLabel').textContent = 'AggBoard ' + VERSION;
  if (CONFIG.MENU_URL) { $('btnHome').href = CONFIG.MENU_URL; $('btnHome').hidden = false; }

  const PENCIL_ICON = '<svg viewBox="0 0 24 24"><path d="M15.6 3.6a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L9 19.8 4 21l1.2-5z"/><path d="M5.2 16l2.8 2.8"/><path d="M14 6l4 4"/></svg>';
  const FINGER_ICON = '<svg viewBox="0 0 24 24"><path d="M9 13.5V5a1.6 1.6 0 0 1 3.2 0v6"/><path d="M12.2 10.5a1.6 1.6 0 0 1 3.2 0v1.2"/><path d="M15.4 11.3a1.6 1.6 0 0 1 3.2 0V15c0 3.6-2.5 6-5.8 6h-.9c-1.9 0-3.3-.8-4.4-2.4l-2.7-4a1.5 1.5 0 0 1 2.4-1.8L9 15"/></svg>';
  function updateChrome() {
    setColorUI();
    for (const b of $('boardSeg').children) b.classList.toggle('active', b.dataset.board === themeOf(curPage()));
    for (const b of $('formatSeg').children) b.classList.toggle('active', b.dataset.format === currentFormat(curPage()));
    const h = hist();
    $('btnUndo').disabled = !h.undo.length && !pendingDot;
    $('btnRedo').disabled = !h.redo.length;
    $('pageLabel').textContent = `${nb.current + 1} / ${nb.pages.length}`;
    $('btnPrev').disabled = nb.current === 0;
    $('btnNext').disabled = nb.current === nb.pages.length - 1;
    $('btnClearPage').disabled = !items().length;
    const fb = $('btnFingers'), fd = settings.fingersDraw;
    fb.classList.toggle('fingers-draw', fd);
    fb.innerHTML = fd ? FINGER_ICON : PENCIL_ICON;
    fb.title = fd ? 'Fingers draw. Tap: fingers move the page (the Pencil also switches back)' : 'The Pencil draws, fingers move the page. Tap: let fingers draw';
    fb.setAttribute('aria-label', fd ? 'Fingers draw' : 'Pencil draws, fingers move the page');
    fb.setAttribute('aria-pressed', fd ? 'true' : 'false');
  }

  // ============================================================
  // Pages
  // ============================================================
  function goToPage(i) {
    stopSpin(false);
    commitPendingDot();
    action = null;
    if (nav) endNav();
    closePanel();
    selection = null;
    laserTrails = [];
    const prevH = pageH(curPage());
    nb.current = clamp(i, 0, nb.pages.length - 1);
    if (pageH(curPage()) !== prevH) fitPage();
    ensureGenerated(curPage());
    scheduleSave();
    updateChrome();
    requestRender();
  }
  function newPage() {
    commitPendingDot();
    const pg = { id: uid(), items: [] };
    if (curPage().bg === 'dark') pg.bg = 'dark';
    if (curPage().h) { pg.h = curPage().h; pg.format = curPage().format; }   // same format as the current page
    nb.pages.splice(nb.current + 1, 0, pg);
    goToPage(nb.current + 1);
  }
  function clearPage() {
    if (!items().length) { toast('This page is already empty.'); return; }
    closePanel();
    selection = null;
    pushUndo();
    setItems([]);
    const pg = curPage();
    toast('Page cleared.', 6000, { label: 'Undo', fn: () => { if (curPage() === pg) undo(); } });
  }
  function deletePage() {
    if (nb.pages.length === 1) {   // the only page: clearing it is the closest thing, and undoable
      if (!items().length) { toast('This is the only page, and it is already empty.'); return; }
      clearPage();
      return;
    }
    deletePageAt(nb.current);
  }
  // Delete page i; the message offers Undo (the page, its undo history and position come back).
  function deletePageAt(i) {
    if (nb.pages.length <= 1 || i < 0 || i >= nb.pages.length) return;
    const pg = nb.pages[i], wasCurrent = i === nb.current;
    nb.pages.splice(i, 1);
    nb.modified = Date.now();
    if (wasCurrent) goToPage(Math.min(i, nb.pages.length - 1));
    else { if (i < nb.current) nb.current--; scheduleSave(); updateChrome(); }
    if (pagesOpen()) renderPagesGrid();
    toast(`Page ${i + 1} deleted.`, 7000, { label: 'Undo', fn: () => {
      if (nb.pages.includes(pg)) return;
      const cur = curPage();
      nb.pages.splice(Math.min(i, nb.pages.length), 0, pg);
      nb.current = nb.pages.indexOf(cur);
      nb.modified = Date.now();
      if (wasCurrent && !pagesOpen()) goToPage(nb.pages.indexOf(pg));
      else { scheduleSave(); updateChrome(); }
      if (pagesOpen()) renderPagesGrid();
    } });
  }
  // Move page i so that it ends up at index j (in the final order).
  function movePageTo(i, j) {
    if (i === j || i < 0 || j < 0 || i >= nb.pages.length || j >= nb.pages.length) return;
    const cur = curPage();
    const [pg] = nb.pages.splice(i, 1);
    nb.pages.splice(j, 0, pg);
    nb.current = nb.pages.indexOf(cur);
    nb.modified = Date.now();
    scheduleSave(); updateChrome();
    if (pagesOpen()) renderPagesGrid();
  }
  function movePage(i, d) {
    const j = i + d;
    if (j < 0 || j >= nb.pages.length) return;
    const cur = curPage();
    [nb.pages[i], nb.pages[j]] = [nb.pages[j], nb.pages[i]];
    nb.current = nb.pages.indexOf(cur);
    nb.modified = Date.now();
    scheduleSave(); updateChrome();
    if (pagesOpen()) renderPagesGrid();
  }
  // A full copy right after page i. Everything gets new ids, so the copy and the
  // original never get mixed up (aggregate regeneration finds items by id).
  function duplicatePage(i) {
    const pg = nb.pages[i];
    const copy = { ...pg, id: uid(), items: pg.items.map(it => ({ ...it, id: uid() })) };
    const cur = curPage();
    nb.pages.splice(i + 1, 0, copy);
    nb.current = nb.pages.indexOf(cur);
    nb.modified = Date.now();
    scheduleSave(); updateChrome();
    if (pagesOpen()) renderPagesGrid(i + 1);
    toast(`Page ${i + 1} duplicated: the copy is page ${i + 2}.`, 3500);
  }
  function addPageAtEnd() {
    const last = nb.pages[nb.pages.length - 1];
    const pg = { id: uid(), items: [] };
    if (curPage().bg === 'dark') pg.bg = 'dark';
    if (curPage().h) { pg.h = curPage().h; pg.format = curPage().format; }
    nb.pages.push(pg);
    nb.modified = Date.now();
    scheduleSave(); updateChrome();
    if (pagesOpen()) renderPagesGrid(nb.pages.length - 1);
    return last;
  }

  // ---------- page overview ----------
  const pagesView = $('pagesView'), pagesGrid = $('pagesGrid');
  const pagesOpen = () => pagesView.classList.contains('visible');
  const THUMB_W = 420;                       // canvas pixels (shown at about half that)
  const thumbCache = new WeakMap();          // items array -> { key, canvas }
  let thumbQueue = [], thumbTimer = 0;
  function pageThumb(pg) {
    const theme = themeOf(pg), H = pageH(pg), key = theme + '|' + H;
    const e = thumbCache.get(pg.items);
    if (e && e.key === key) return e.canvas;
    const c = document.createElement('canvas');
    c.width = THUMB_W; c.height = Math.round(THUMB_W * H / PW);
    const x = c.getContext('2d'), k = THUMB_W / PW;
    x.fillStyle = THEMES[theme].page; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(k, 0, 0, k, 0, 0);
    const prevTheme = renderTheme; renderTheme = theme;
    try {
      for (const it of pg.items) {
        if (it.type === 'stroke') { drawStroke(x, it, theme); continue; }
        if (it.pts && it.n) {
          const bmp = renderAggBitmap(it, k);
          x.drawImage(bmp.canvas, it.x + it.w / 2 + bmp.ox, it.y + it.h / 2 + bmp.oy, bmp.canvas.width / bmp.ppu, bmp.canvas.height / bmp.ppu);
          drawOverlays(x, it, theme, 1 / k);
        } else {
          x.setLineDash([8, 6]); x.lineWidth = 3; x.strokeStyle = 'rgba(60,120,200,0.6)'; x.strokeRect(it.x, it.y, it.w, it.h); x.setLineDash([]);
        }
      }
    } finally { renderTheme = prevTheme; }
    thumbCache.set(pg.items, { key, canvas: c });
    return c;
  }
  const PV_ICONS = {
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    dup: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  };
  function renderPagesGrid(scrollTo = -1) {
    const keep = pagesGrid.scrollTop;
    clearTimeout(thumbTimer); thumbQueue = [];
    const N = nb.pages.length;
    $('pagesCount').textContent = `${N} page${N === 1 ? '' : 's'}`;
    pagesGrid.textContent = '';
    nb.pages.forEach((pg, i) => {
      const card = document.createElement('div');
      card.className = 'pv-card' + (i === nb.current ? ' current' : '');
      card.dataset.page = String(i);
      const cv = document.createElement('canvas');
      cv.className = 'pv-thumb';
      cv.width = THUMB_W; cv.height = Math.round(THUMB_W * pageH(pg) / PW);
      cv.dataset.act = 'go';
      cv.setAttribute('aria-label', `Go to page ${i + 1}`);
      const cx = cv.getContext('2d');
      cx.fillStyle = THEMES[themeOf(pg)].page; cx.fillRect(0, 0, cv.width, cv.height);
      card.appendChild(cv);
      const row = document.createElement('div');
      row.className = 'pv-row';
      row.innerHTML = `<span class="pv-num">${i + 1}${i === nb.current ? '<em>current</em>' : ''}</span>` +
        `<button data-act="left" title="Move earlier" aria-label="Move page ${i + 1} earlier"${i === 0 ? ' disabled' : ''}>${PV_ICONS.left}</button>` +
        `<button data-act="right" title="Move later" aria-label="Move page ${i + 1} later"${i === N - 1 ? ' disabled' : ''}>${PV_ICONS.right}</button>` +
        `<button data-act="dup" title="Duplicate" aria-label="Duplicate page ${i + 1}">${PV_ICONS.dup}</button>` +
        `<button data-act="del" class="danger" title="Delete" aria-label="Delete page ${i + 1}"${N === 1 ? ' disabled' : ''}>${PV_ICONS.del}</button>`;
      card.appendChild(row);
      pagesGrid.appendChild(card);
      thumbQueue.push([cv, pg]);
    });
    pagesGrid.scrollTop = keep;
    if (scrollTo >= 0 && pagesGrid.children[scrollTo] && pagesGrid.children[scrollTo].scrollIntoView) pagesGrid.children[scrollTo].scrollIntoView({ block: 'nearest' });
    pumpThumbs();
  }
  // Thumbnails are drawn one per tick, so the overview opens at once.
  function pumpThumbs() {
    const job = thumbQueue.shift();
    if (!job) return;
    const [cv, pg] = job;
    try { cv.getContext('2d').drawImage(pageThumb(pg), 0, 0); } catch (err) { console.warn('Thumbnail failed:', err); }
    thumbTimer = setTimeout(pumpThumbs, 0);
  }
  function openPages() {
    closeMenu();
    stopSpin(false);
    commitPendingDot();
    action = null;
    closePanel();
    pagesView.classList.add('visible');
    renderPagesGrid(nb.current);
  }
  function closePages() {
    endPvDrag(false);
    clearTimeout(thumbTimer); thumbQueue = [];
    pagesView.classList.remove('visible');
    pagesGrid.textContent = '';
  }
  // ---- drag and drop: hold a thumbnail (or drag with the mouse), drop in a gap ----
  // A quick swipe still scrolls and a tap still opens the page: only holding still first
  // lifts the card. While a card is lifted, touch scrolling is suppressed.
  const PV_HOLD_MS = 380, PV_SLOP = 10, PV_EDGE = 56;
  let pvDrag = null, pvSuppressClick = false;
  pagesGrid.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.pv-card');
    if (!card || e.target.closest('button') || pvDrag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pvDrag = { pid: e.pointerId, from: +card.dataset.page, card, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      st0: pagesGrid.scrollTop, active: false, mouse: e.pointerType === 'mouse', target: null, after: false, raf: 0 };
    pvDrag.timer = setTimeout(startPvDrag, PV_HOLD_MS);
  });
  function startPvDrag() {
    const g = pvDrag;
    if (!g || g.active) return;
    clearTimeout(g.timer);
    g.active = true;
    g.st0 = pagesGrid.scrollTop;
    g.card.classList.add('lifted');
    pagesView.classList.add('dragging');
    const loop = () => {
      if (!pvDrag || !pvDrag.active) return;
      const r = pagesGrid.getBoundingClientRect();
      if (r.height > 0) {
        if (g.y < r.top + PV_EDGE) pagesGrid.scrollTop -= Math.ceil((r.top + PV_EDGE - g.y) / 4);
        else if (g.y > r.bottom - PV_EDGE) pagesGrid.scrollTop += Math.ceil((g.y - (r.bottom - PV_EDGE)) / 4);
      }
      updatePvDrag();
      g.raf = requestAnimationFrame(loop);
    };
    g.raf = requestAnimationFrame(loop);
    updatePvDrag();
  }
  function updatePvDrag() {
    const g = pvDrag;
    if (!g || !g.active) return;
    g.card.style.transform = `translate(${g.x - g.x0}px, ${g.y - g.y0 + (pagesGrid.scrollTop - g.st0)}px) scale(1.04)`;
    // Target: the card under the pointer (gaps count to the nearer card); left half = before it.
    let best = null, bestD = Infinity;
    for (const c of pagesGrid.children) {
      if (c === g.card) continue;
      const r = c.getBoundingClientRect();
      const dx = g.x < r.left ? r.left - g.x : g.x > r.right ? g.x - r.right : 0;
      const dy = g.y < r.top ? r.top - g.y : g.y > r.bottom ? g.y - r.bottom : 0;
      const dd = dx * dx + dy * dy * 4;
      if (dd < bestD) { bestD = dd; best = { c, after: g.x > r.left + r.width / 2 }; }
    }
    if (g.target && (!best || g.target !== best.c || g.after !== best.after)) g.target.classList.remove('drop-before', 'drop-after');
    g.target = best ? best.c : null; g.after = best ? best.after : false;
    if (g.target) g.target.classList.add(g.after ? 'drop-after' : 'drop-before');
  }
  function dropIndex(g) {
    if (!g.target) return g.from;
    let to = +g.target.dataset.page + (g.after ? 1 : 0);
    if (g.from < to) to -= 1;
    return to;
  }
  function endPvDrag(drop) {
    const g = pvDrag;
    if (!g) return;
    pvDrag = null;
    clearTimeout(g.timer);
    cancelAnimationFrame(g.raf);
    pagesView.classList.remove('dragging');
    if (!g.active) return;
    g.card.classList.remove('lifted'); g.card.style.transform = '';
    if (g.target) g.target.classList.remove('drop-before', 'drop-after');
    pvSuppressClick = true; setTimeout(() => { pvSuppressClick = false; }, 400);
    const to = dropIndex(g);
    if (drop && to !== g.from) movePageTo(g.from, to);
  }
  window.addEventListener('pointermove', (e) => {
    const g = pvDrag;
    if (!g || e.pointerId !== g.pid) return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.active) {
      const d = Math.hypot(g.x - g.x0, g.y - g.y0);
      if (g.mouse && d > 5) startPvDrag();
      else if (!g.mouse && d > PV_SLOP) endPvDrag(false);   // moving before the hold: it is a scroll
      return;
    }
    e.preventDefault();
    updatePvDrag();
  });
  window.addEventListener('pointerup', (e) => { if (pvDrag && e.pointerId === pvDrag.pid) endPvDrag(true); });
  window.addEventListener('pointercancel', (e) => { if (pvDrag && e.pointerId === pvDrag.pid) endPvDrag(false); });
  pagesGrid.addEventListener('touchmove', (e) => { if (pvDrag && pvDrag.active && e.cancelable) e.preventDefault(); }, { passive: false });
  pagesGrid.addEventListener('contextmenu', (e) => { if (pvDrag) e.preventDefault(); });

  pagesGrid.addEventListener('click', (e) => {
    if (pvSuppressClick) { pvSuppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const el = e.target.closest('[data-act]'), card = e.target.closest('.pv-card');
    if (!el || !card || el.disabled) return;
    const i = +card.dataset.page;
    switch (el.dataset.act) {
      case 'go': closePages(); if (i !== nb.current) goToPage(i); break;
      case 'left': movePage(i, -1); break;
      case 'right': movePage(i, 1); break;
      case 'dup': duplicatePage(i); break;
      case 'del': deletePageAt(i); break;
    }
  });
  $('pagesDone').addEventListener('click', closePages);
  $('pagesNew').addEventListener('click', addPageAtEnd);
  pagesView.addEventListener('click', (e) => { if (e.target === pagesView) closePages(); });
  $('btnPrev').addEventListener('click', () => goToPage(nb.current - 1));
  $('btnNext').addEventListener('click', () => goToPage(nb.current + 1));
  $('btnNewPage').addEventListener('click', newPage);
  $('btnFit').addEventListener('click', fitPage);
  $('btnClearPage').addEventListener('click', clearPage);

  // ============================================================
  // Selection bar and aggregate panel
  // ============================================================
  const selbar = $('selbar'), panel = $('aggPanel');
  $('selAdjust').addEventListener('click', () => { const ag = singleSelectedAgg(); if (ag) openPanel(ag.id); });
  $('selDuplicate').addEventListener('click', duplicateSelection);
  $('selDelete').addEventListener('click', deleteSelection);
  $('selSvg').addEventListener('click', exportSelectionSVG);
  $('selGif').addEventListener('click', () => openGifDialog('selection'));
  for (const id of ['gifMotion', 'gifSize', 'gifFps', 'gifFormat']) for (const b of $(id).children) b.addEventListener('click', () => { if (b.disabled) return; for (const o of $(id).children) o.classList.toggle('active', o === b); if (id === 'gifFormat') updateFormatNote(); });
  $('gifCreate').addEventListener('click', () => { createGif().catch(err => { console.warn('Animation export failed:', err); toast('The animation could not be created: ' + (err && err.message || err), 6000); if (gifJob) { gifJob = { scope: gifJob.scope }; gifShowState('setup'); } }); });
  $('gifAgain').addEventListener('click', () => { if (gifJob) { if (gifJob.url) URL.revokeObjectURL(gifJob.url); gifJob = { scope: gifJob.scope }; $('gifPreview').removeAttribute('src'); gifShowState('setup'); } });
  $('gifSave').addEventListener('click', () => { if (gifJob && gifJob.blob) shareBlob(gifJob.blob, gifJob.name, gifJob.mime || 'image/gif'); });
  $('gifClose').addEventListener('click', closeGifDialog);
  $('gifDlg').addEventListener('click', (e) => { if (e.target === $('gifDlg') && !$('gifBusy').offsetParent) closeGifDialog(); });

  let panelId = null, panelSession = false;
  // The panel is placed once next to its aggregate and then stays put while the
  // aggregate changes; it is re-placed only when the view changes, and never
  // while a pointer is down on the panel.
  let panelPlace = null, panelPointer = false;
  panel.addEventListener('pointerdown', () => { panelPointer = true; });
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => { panelPointer = false; }, true);
  const aggSize = $('aggSize'), aggDf = $('aggDf');
  const NS_MIN = 2, NS_MAX = 500;
  const nsToSlider = (ns) => Math.log(ns / NS_MIN) / Math.log(NS_MAX / NS_MIN);
  const sliderToNs = (v) => Math.round(NS_MIN * Math.pow(NS_MAX / NS_MIN, v));
  function refreshAdvanced(it) {
    const kfAuto = it.kf == null;
    $('advKfAuto').checked = kfAuto;
    $('advKf').disabled = kfAuto;
    const kfShown = kfAuto ? (it.kfUsed != null ? it.kfUsed : window.AggEngine.kfAuto(it.df, it.sigma || 1)) : it.kf;
    $('advKf').value = kfShown;
    $('advKfVal').textContent = kfShown.toFixed(2);
    const cca = it.method === 'cca';
    $('advNsRow').style.opacity = cca ? '' : '0.45';
    $('advNsAuto').checked = !it.ns;
    $('advNs').disabled = !it.ns || !cca; $('advNsAuto').disabled = !cca;
    $('advNs').value = nsToSlider(it.ns || 16);
    $('advNsVal').textContent = it.ns ? String(it.ns) : '≈N^0.4';
    $('advNote').textContent = !cca ? 'Subclusters apply to cluster–cluster aggregates only.' : '';
  }
  const aggColorsEl = $('aggColors');
  AGG_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.backgroundColor = c; b.dataset.color = c; b.setAttribute('aria-label', 'Aggregate colour');
    b.addEventListener('click', () => {
      const it = findItem(panelId);
      if (!it || it.color === c) return;
      pushUndo();
      replaceItem({ ...it, color: c });
      settings.agg.color = c; saveSettings();
    });
    aggColorsEl.appendChild(b);
  });

  function openPanel(id) {
    panelId = id;
    panelPlace = null;
    panelSession = false;
    panel.classList.add('visible');
    refreshPanel();
    positionFloatingUI();
  }
  function closePanel() {
    panelId = null;
    panelSession = false;
    panel.classList.remove('visible');
  }
  function panelMode(it) { return it.edited ? 'edited' : it.kind === 'chain' ? 'chain' : 'agg'; }
  function refreshPanel() {
    if (!panelId) return;
    const it = findItem(panelId);
    if (!it) { closePanel(); return; }
    const mode = panelMode(it);
    const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
    $('aggTitle').textContent = mode === 'chain' ? 'Chain' : mode === 'edited' ? (it.kind === 'chain' ? 'Chain (connected)' : 'Aggregate (edited)') : 'Aggregate';
    show('rowDf', mode === 'agg');
    show('rowMethod', mode === 'agg');
    for (const b of $('methodSeg').children) b.classList.toggle('active', b.dataset.method === (it.method === 'cca' ? 'cca' : 'pc'));
    show('rowTemp', mode === 'chain');
    show('aggRandom', mode !== 'edited');
    show('aggRegen', mode === 'edited' && it.kind !== 'chain');
    $('aggSizeLabel').textContent = mode === 'edited' ? 'Monomer size (scales)' : 'Monomer size';
    if (mode === 'chain') { $('aggTemp').value = it.temp; $('aggTempVal').textContent = it.temp.toFixed(2); }
    aggSize.value = it.a;
    $('aggSizeVal').textContent = it.a.toFixed(1);
    aggDf.value = it.df;
    $('aggDfVal').textContent = it.df.toFixed(2);
    {
    $('aggSigma').value = it.sigma || 1;
    $('aggSigmaVal').textContent = (it.sigma || 1) > 1 ? (it.sigma).toFixed(2) : '1 (equal)';
    show('rowSigma', mode === 'agg');
    show('aggAdvanced', mode === 'agg');
    if (mode === 'agg') refreshAdvanced(it);
    }
    // Readout as a small table, typeset like the numbers label on the board.
    let html;
    if (!it.pts || !it.n) html = '<div class="ro-note">Building…</div>';
    else {
      const st = ovStats(it);
      const cell = (sym, val, unit = '', note = '') => `<span class="s">${sym}${note ? ` <small>${note}</small>` : ''}</span><span class="v">${val}${unit ? `<span class="u"> ${unit}</span>` : ''}</span>`;
      const cells = [cell('N', it.n), cell('R<sub>g</sub>', fmtNum(st.rg, 1), '<i>a</i>')];
      if (mode === 'agg' && it.dfFit != null) cells.push(cell('D<sub>f</sub>', it.dfFit.toFixed(2), '', 'fit'));
      cells.push(cell('R<sub>1</sub> / R<sub>3</sub>', fmtAniso(st.aniso)));
      html = `<div class="ro-grid">${cells.join('')}</div>`;
      if (mode === 'chain') html += '<div class="ro-note">Hand-drawn chain.</div>';
      else if (mode === 'edited') html += '<div class="ro-note">Contains hand-drawn chains, so it is no longer regenerated.</div>';
      else {
        if (it.ccaFallback) html += `<div class="ro-note warn">Cluster–cluster works up to <i>D</i><sub>f</sub> = ${window.AggEngine.CCA_MAX_DF}; this one uses particle–cluster.</div>`;
        if (it.needsGen) html += '<div class="ro-note">updating…</div>';
        else if (it.capped) html += `<div class="ro-note warn">Capped at ${CONFIG.N_MAX} monomers: increase the monomer size to fill the box.</div>`;
      }
    }
    $('aggReadout').innerHTML = html;
    for (const b of aggColorsEl.children) b.classList.toggle('active', b.dataset.color === it.color);
    $('ovNums').checked = !!it.showNums;
    $('ovRg').checked = !!it.showRg;
    const gk = growthKind(it);
    $('ovGrowthRow').style.visibility = gk ? '' : 'hidden';   // keep its cell, so the other toggles stay in place
    $('ovGrowthLbl').textContent = gk === 'subclusters' ? 'Subclusters' : 'Growth order';
    $('ovGrowth').checked = !!it.showGrowth;
    $('ovMR').checked = !!it.showMR;
    for (const c of panel.querySelectorAll('.chip')) c.classList.toggle('on', c.querySelector('input').checked);
  }
  function panelEdit(changes, discrete) {
    const it = findItem(panelId);
    if (!it) return;
    if (discrete || !panelSession) { pushUndo(); panelSession = !discrete; }
    const mode = panelMode(it);
    if (mode === 'edited') {
      if (!('a' in changes)) return;
      const k = changes.a / it.a, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      replaceItem(scaleItem(it, cx, cy, k));
      return;
    }
    if (mode === 'chain') {
      replaceItem(regenChain(it, changes));
      if ('a' in changes) settings.agg.a = changes.a;
      if ('temp' in changes) settings.chain.temp = changes.temp;
      saveSettings();
      return;
    }
    const ni = { ...it, ...changes, needsGen: true };
    if ('a' in changes && it.pts) ni.aGen = ptsScale(it);   // keep showing the current structure at its own size
    replaceItem(ni);
    requestGen(ni);
    if (!(ni.sigma > 1)) delete ni.sigma;
    if (!ni.ns) delete ni.ns;
    settings.agg.a = ni.a; settings.agg.df = ni.df; settings.agg.sigma = ni.sigma || 1;
    settings.agg.kf = ni.kf != null ? ni.kf : null; settings.agg.ns = ni.ns || null;
    settings.agg.method = ni.method === 'cca' ? 'cca' : 'pc';
    saveSettings();
  }
  aggSize.addEventListener('input', () => panelEdit({ a: +aggSize.value }));
  for (const b of $('methodSeg').children) {
    b.addEventListener('click', () => {
      const it = findItem(panelId);
      if (!it || (it.method === 'cca' ? 'cca' : 'pc') === b.dataset.method) return;
      panelEdit({ method: b.dataset.method }, true);
    });
  }
  $('aggTemp').addEventListener('input', () => panelEdit({ temp: +$('aggTemp').value }));
  $('aggTemp').addEventListener('change', () => { panelSession = false; });
  $('aggRegen').addEventListener('click', () => {
    const it = findItem(panelId);
    if (!it || !it.edited) return;
    pushUndo();
    const pg = curPage();
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, gb = it.genBox || { w: it.w, h: it.h };
    const ni = { ...it, edited: false, x: cx - gb.w / 2, y: cy - gb.h / 2, w: gb.w, h: gb.h, needsGen: true };
    delete ni.genBox;
    replaceItem(ni);
    requestGen(ni);
    toast('Chains removed: the aggregate is rebuilt from its settings.', 6000, { label: 'Undo', fn: () => { if (curPage() === pg) undo(); } });
  });
  aggDf.addEventListener('input', () => panelEdit({ df: +aggDf.value }));
  $('aggSigma').addEventListener('input', () => { const v = +$('aggSigma').value; panelEdit({ sigma: v > 1.0005 ? v : undefined }); });
  $('aggSigma').addEventListener('change', () => { panelSession = false; });
  for (const el of [aggSize, aggDf]) el.addEventListener('change', () => { panelSession = false; });
  $('advKfAuto').addEventListener('change', () => panelEdit({ kf: $('advKfAuto').checked ? null : +$('advKf').value }, true));
  $('advKf').addEventListener('input', () => { if (!$('advKfAuto').checked) panelEdit({ kf: +$('advKf').value }); });
  $('advNsAuto').addEventListener('change', () => panelEdit({ ns: $('advNsAuto').checked ? null : sliderToNs(+$('advNs').value) }, true));
  $('advNs').addEventListener('input', () => { if (!$('advNsAuto').checked) panelEdit({ ns: sliderToNs(+$('advNs').value) }); });
  for (const id of ['advKf', 'advNs']) $(id).addEventListener('change', () => { panelSession = false; });
  for (const [id, key] of [['ovNums', 'showNums'], ['ovRg', 'showRg'], ['ovGrowth', 'showGrowth'], ['ovMR', 'showMR']]) {
    $(id).addEventListener('change', () => {
      const it = findItem(panelId);
      if (!it) return;
      pushUndo();
      const ni = { ...it };
      if ($(id).checked) ni[key] = true; else delete ni[key];
      replaceItem(ni);
      settings.agg[key] = $(id).checked; saveSettings();
    });
  }
  $('aggRandom').addEventListener('click', () => panelEdit({ seed: randSeed() }, true));
  $('aggDuplicate').addEventListener('click', () => { closePanel(); duplicateSelection(); });
  $('aggCoords').addEventListener('click', () => { const it = findItem(panelId); if (it) exportCoordinates(it); });
  $('aggDelete').addEventListener('click', () => { closePanel(); deleteSelection(); });
  $('aggClose').addEventListener('click', closePanel);

  function positionFloatingUI() {
    const W = window.innerWidth, H = window.innerHeight;
    const topLimit = $('toolbar').getBoundingClientRect().bottom + 6;
    const bottomLimit = H - 10;
    // selection bar
    const b = selection && !action && !panelId ? selectionBounds() : null;
    if (b) {
      $('selAdjust').style.display = singleSelectedAgg() ? '' : 'none';
      selbar.classList.add('visible');
      const p0 = toScreen(b.x, b.y), p1 = toScreen(b.x + b.w, b.y + b.h);
      const bw = selbar.offsetWidth, bh = selbar.offsetHeight;
      let x = (p0.x + p1.x) / 2 - bw / 2;
      let y = p0.y - bh - 18;
      if (y < topLimit) y = p1.y + 18;
      if (y + bh > bottomLimit) y = Math.max(topLimit, Math.min(bottomLimit - bh, p0.y + 8));
      selbar.style.left = clamp(x, 8, W - bw - 8) + 'px';
      selbar.style.top = y + 'px';
    } else selbar.classList.remove('visible');
    // aggregate panel
    if (panelId) {
      const it = findItem(panelId);
      if (!it) return;
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      const sameView = panelPlace && panelPlace.s === view.scale && panelPlace.ox === view.ox && panelPlace.oy === view.oy && panelPlace.W === W && panelPlace.H === H;
      if (panelPlace && (sameView || panelPointer)) {
        panel.style.left = panelPlace.left + 'px';
        panel.style.top = panelPlace.top + 'px';
        return;
      }
      const p0 = toScreen(it.x, it.y), p1 = toScreen(it.x + it.w, it.y + it.h);
      let x, y;
      if (W < 560) { x = (W - pw) / 2; y = bottomLimit - ph; }
      else {
        if (p1.x + 14 + pw <= W - 8) x = p1.x + 14;
        else if (p0.x - 14 - pw >= 8) x = p0.x - 14 - pw;
        else x = W - pw - 8;
        y = (p0.y + p1.y) / 2 - ph / 2;
      }
      const left = clamp(x, 8, Math.max(8, W - pw - 8)), top = clamp(y, topLimit, Math.max(topLimit, bottomLimit - ph));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panelPlace = { left, top, s: view.scale, ox: view.ox, oy: view.oy, W, H };
    }
  }

  // ============================================================
  // Menu, help, toast
  // ============================================================
  const menu = $('menu'), shield = $('menuShield');
  function openMenu() {
    menu.style.top = ($('toolbar').getBoundingClientRect().bottom + 6) + 'px';
    showMenuView('main');
    menu.classList.add('visible'); shield.classList.add('visible'); updateChrome();
  }
  function showMenuView(v) {
    $('menuMain').hidden = v !== 'main';
    $('menuSettings').hidden = v !== 'settings';
    menu.scrollTop = 0;
  }
  $('mSettings').addEventListener('click', () => showMenuView('settings'));
  $('mBack').addEventListener('click', () => showMenuView('main'));
  function closeMenu() { menu.classList.remove('visible'); shield.classList.remove('visible'); }
  $('btnMenu').addEventListener('click', () => (menu.classList.contains('visible') ? closeMenu() : openMenu()));
  shield.addEventListener('pointerdown', closeMenu);
  const menuAction = (id, fn) => $(id).addEventListener('click', () => { closeMenu(); fn(); });
  menuAction('mExport', exportNotebook);
  menuAction('mGif', () => openGifDialog('page'));
  menuAction('mImport', () => $('fileInput').click());
  menuAction('mPng', exportPagePNG);
  menuAction('mSvg', exportPageSVG);
  menuAction('mDeletePage', deletePage);
  menuAction('mClearPage', clearPage);
  menuAction('mHelp', () => $('help').classList.add('visible'));
  menuAction('mPages', openPages);
  $('pageLabel').addEventListener('click', () => (pagesOpen() ? closePages() : openPages()));
  const AGG_ICONS = {
    box: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="2" stroke-dasharray="2.6 2.2" stroke-width="1.4"/><circle cx="9" cy="10" r="2"/><circle cx="12.6" cy="11.2" r="2"/><circle cx="15.4" cy="8.6" r="2"/><circle cx="11.6" cy="15" r="2"/><circle cx="8.4" cy="17" r="1.7"/></svg>',
    circle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="2.6 2.2" stroke-width="1.4"/><circle cx="9.6" cy="10.4" r="2"/><circle cx="13.2" cy="11.6" r="2"/><circle cx="15" cy="8.4" r="1.8"/><circle cx="11.6" cy="15.2" r="2"/></svg>',
  };
  function updateCreateUI() {
    const btn = document.querySelector('[data-tool=aggregate]');
    btn.innerHTML = AGG_ICONS[settings.aggCreate];
    btn.title = settings.aggCreate === 'circle' ? 'Aggregate: drag from the centre (A)' : 'Aggregate in a box (A)';
    for (const b of $('createSeg').children) b.classList.toggle('active', b.dataset.create === settings.aggCreate);
  }
  function updateSpinStyleUI() { for (const b of $('spinSeg').children) b.classList.toggle('active', b.dataset.spin === settings.spinStyle); updateSpinBtn(); }
  for (const b of $('spinSeg').children) b.addEventListener('click', () => { settings.spinStyle = b.dataset.spin; saveSettings(); updateSpinStyleUI(); });
  function updateOvScaleUI() { for (const b of $('ovScaleSeg').children) b.classList.toggle('active', +b.dataset.scale === (settings.ovScale || 0.8)); }
  for (const b of $('ovScaleSeg').children) b.addEventListener('click', () => {
    settings.ovScale = +b.dataset.scale; saveSettings(); applyOvScale(); updateOvScaleUI(); requestRender();
  });
  function applyHand() {
    document.body.classList.toggle('left-handed', settings.hand === 'left');
    for (const b of $('handSeg').children) b.classList.toggle('active', b.dataset.hand === settings.hand);
    refreshDfScale();
  }
  for (const b of $('handSeg').children) {
    b.addEventListener('click', () => { settings.hand = b.dataset.hand; saveSettings(); applyHand(); });
  }
  for (const b of $('createSeg').children) {
    b.addEventListener('click', () => { settings.aggCreate = b.dataset.create; saveSettings(); updateCreateUI(); });
  }
  updateCreateUI();
  applyHand();
  updateSpinStyleUI();
  updateOvScaleUI();
  function screenAspect() {
    const W = window.innerWidth, H = window.innerHeight;
    const top = $('toolbar').getBoundingClientRect().bottom + 10;
    return Math.max(100, H - top - 14) / Math.max(100, W - 24);
  }
  function currentFormat(pg) { return pg.format || '16:9'; }
  function setPageFormat(fmt) {
    const pg = curPage();
    const old = { h: pg.h, format: pg.format };
    const ratio = fmt === 'screen' ? screenAspect() : PAGE_FORMATS[fmt];
    const h = Math.round(clamp(PW * ratio, 300, 5000));
    if (fmt === '16:9' && h === PH) { delete pg.h; delete pg.format; } else { pg.h = h; pg.format = fmt; }
    if (old.h === pg.h && old.format === pg.format) return;
    nb.modified = Date.now();
    scheduleSave();
    fitPage();
    updateChrome();
    requestRender();
    const outside = items().some(it => { const b = itemBounds(it); return b.y + b.h > pageH(pg) + 1; });
    const restore = () => {
      if (old.h) { pg.h = old.h; pg.format = old.format; } else { delete pg.h; delete pg.format; }
      scheduleSave(); fitPage(); updateChrome(); requestRender();
    };
    if (outside) toast('Some content is now below the page edge.', 7000, { label: 'Undo', fn: restore });
    else toast(`Page format: ${fmt === 'screen' ? 'this screen' : fmt}`, 1800);
  }
  for (const b of $('formatSeg').children) b.addEventListener('click', () => setPageFormat(b.dataset.format));
  for (const b of $('boardSeg').children) {
    b.addEventListener('click', () => {
      const pg = curPage();
      if (b.dataset.board === 'dark') pg.bg = 'dark'; else delete pg.bg;
      nb.modified = Date.now();
      scheduleSave();
      updateChrome();
      requestRender();
    });
  }
  $('helpClose').addEventListener('click', () => $('help').classList.remove('visible'));
  $('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').classList.remove('visible'); });

  let toastTimer = 0;
  // action: optional { label, fn } shown as a button inside the message.
  function toast(msg, ms = 2800, action = null) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('has-action', !!action);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', () => { el.classList.remove('visible', 'has-action'); action.fn(); });
      el.appendChild(b);
    }
    el.classList.add('visible');
    clearTimeout(toastTimer);
    if (ms > 0) toastTimer = setTimeout(() => el.classList.remove('visible', 'has-action'), ms);
  }

  // ============================================================
  // Files: export / import / PNG
  // ============================================================
  function isMobile() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') return navigator.userAgentData.mobile;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints || 0) > 1;
  }
  async function shareBlob(blob, filename, mime) {
    const file = new File([blob], filename, { type: mime });
    if (isMobile() && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const dateStamp = () => new Date().toISOString().slice(0, 10);

  function pageMeta(pg) {
    return { ...(pg.bg ? { bg: pg.bg } : {}), ...(pg.h ? { h: pg.h, format: pg.format } : {}) };
  }
  function itemToJSON(it) {
    if (it.type !== 'agg') return it;
    const out = { ...it };
    out.pts = it.pts ? Array.from(it.pts, v => Math.round(v * 1000) / 1000) : null;
    if (it.groups) out.groups = Array.from(it.groups);
    if (it.radii) out.radii = Array.from(it.radii, v => Math.round(v * 10000) / 10000);
    return out;
  }
  function notebookToJSON() {
    // Version 4 only when a page holds polydisperse monomers; otherwise version 3, which older copies can read.
    const poly = nb.pages.some(pg => pg.items.some(it => it.radii));
    return {
      format: CONFIG.FORMAT, version: poly ? 4 : 3,
      id: nb.id, title: nb.title, created: nb.created, modified: nb.modified,
      page: { w: PW, h: PH }, current: nb.current,
      pages: nb.pages.map(pg => ({ id: pg.id, items: pg.items.map(itemToJSON), ...pageMeta(pg) })),
    };
  }
  function exportNotebook() {
    commitPendingDot();
    const blob = new Blob([JSON.stringify(notebookToJSON())], { type: 'application/json' });
    shareBlob(blob, `notebook-${dateStamp()}.aggboard.json`, 'application/json');
  }

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  function numArray(v) {
    if (!v || typeof v.length !== 'number') return null;
    const a = Array.from(v, Number);
    return a.every(isFinite) ? a : null;
  }
  function sanitizeItem(it) {
    if (!it || typeof it !== 'object') return null;
    const id = typeof it.id === 'string' && it.id ? it.id : uid();
    if (it.type === 'stroke') {
      const pts = numArray(it.points);
      if (!pts || pts.length < 3 || pts.length % 3) return null;
      const st = { id, type: 'stroke', color: isHex(it.color) ? it.color : INK[0].v, width: it.width > 0 ? +it.width : 5, points: pts };
      if (it.straight) st.straight = true;
      return st;
    }
    if (it.type === 'agg') {
      const isChain = it.kind === 'chain';
      if (isChain && !isNum(it.df)) it = { ...it, df: 1 };
      if (![it.x, it.y, it.w, it.h, it.a, it.df].every(isNum) || it.w <= 0 || it.h <= 0 || it.a <= 0) return null;
      const path = isChain ? numArray(it.path) : null;
      if (isChain && (!path || path.length < 2 || path.length % 2)) return null;
      const R = numArray(it.R);
      const pts = numArray(it.pts);
      const n = it.n | 0;
      const ok = pts && n > 0 && pts.length === 3 * n;
      let out = {
        id, type: 'agg', x: it.x, y: it.y, w: it.w, h: it.h,
        a: it.a, df: clamp(it.df, 1, 3), kf: it.kf > 0 ? +it.kf : null,
        seed: isNum(it.seed) ? it.seed | 0 : randSeed(),
        color: isHex(it.color) ? it.color : AGG_COLORS[0],
        R: R && R.length === 9 ? R : IDENTITY.slice(),
        pts: ok ? Float32Array.from(pts) : null, n: ok ? n : 0,
        rg: isNum(it.rg) ? it.rg : 0, dfFit: isNum(it.dfFit) ? it.dfFit : null,
        ...(it.method === 'cca' ? { method: 'cca' } : {}),
        ...(it.fitShape === 'circle' ? { fitShape: 'circle' } : {}),
        ...(it.showNums ? { showNums: true } : {}), ...(it.showRg ? { showRg: true } : {}), ...(it.showGrowth ? { showGrowth: true } : {}), ...(it.showMR ? { showMR: true } : {}),
        ...(ok && it.groups && it.groups.length === n ? { groups: Uint16Array.from(numArray(it.groups) || []) } : {}),
        ...(ok && it.radii && it.radii.length === n && (numArray(it.radii) || []).every(v => v >= 0.05 && v <= 20) ? { radii: Float32Array.from(numArray(it.radii)) } : {}),
        ...(isNum(it.sigma) && it.sigma > 1 ? { sigma: clamp(it.sigma, 1, 1.5) } : {}),
        ...(isNum(it.ns) && it.ns >= 2 ? { ns: clamp(Math.round(it.ns), 2, 500) } : {}),
        ...(ok && isNum(it.nGen) && it.nGen >= 0 && it.nGen <= n ? { nGen: it.nGen | 0 } : {}),
        ...(isNum(it.aGen) && it.aGen > 0 && ok ? { aGen: it.aGen } : {}),
        ...(isNum(it.aniso) ? { aniso: it.aniso } : {}),
        capped: !!it.capped, needsGen: isChain ? false : (!ok || (!!it.needsGen && !it.edited)),
        ...(isChain ? { kind: 'chain', path, temp: isNum(it.temp) ? clamp(it.temp, 0, 1) : 0.25, pz: isNum(it.pz) ? it.pz : 0 } : {}),
        ...(it.edited && ok ? { edited: true } : {}),
        ...(it.edited && ok && it.genBox && isNum(it.genBox.w) && isNum(it.genBox.h) ? { genBox: { w: it.genBox.w, h: it.genBox.h } } : {}),
      };
      if (isChain && !ok) out = regenChain(out, {});
      return out;
    }
    return null;
  }
  function sanitizeNotebook(d) {
    if (!d || d.format !== CONFIG.FORMAT || !Array.isArray(d.pages)) throw new Error('This file is not an AggBoard notebook.');
    if ((d.version | 0) > CONFIG.FORMAT_VERSION) throw new Error('This notebook was made with a newer version of AggBoard.');
    const pages = d.pages.map(pg => ({
      id: pg && typeof pg.id === 'string' ? pg.id : uid(),
      items: (pg && Array.isArray(pg.items) ? pg.items : []).map(sanitizeItem).filter(Boolean),
      ...(pg && pg.bg === 'dark' ? { bg: 'dark' } : {}),
      ...(pg && isNum(pg.h) && pg.h >= 300 && pg.h <= 5000 ? { h: pg.h, format: typeof pg.format === 'string' ? pg.format : 'custom' } : {}),
    }));
    if (!pages.length) pages.push({ id: uid(), items: [] });
    return {
      format: CONFIG.FORMAT, version: CONFIG.FORMAT_VERSION,
      id: typeof d.id === 'string' ? d.id : uid(),
      title: typeof d.title === 'string' ? d.title : 'Notebook',
      created: isNum(d.created) ? d.created : Date.now(),
      modified: isNum(d.modified) ? d.modified : Date.now(),
      page: { w: PW, h: PH },
      current: clamp(d.current | 0, 0, pages.length - 1),
      pages,
    };
  }
  function loadNotebook(next) {
    nb = next;
    histories.clear();
    invalidateGen();
    for (const pg of nb.pages) ensureGenerated(pg);
    goToPage(nb.current);
  }
  $('fileInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = sanitizeNotebook(JSON.parse(await f.text()));
      const hasContent = nb.pages.some(pg => pg.items.length);
      if (hasContent && !confirm(`Replace the current notebook with "${f.name}" (${data.pages.length} page${data.pages.length === 1 ? '' : 's'})?\nSave the current one to a file first if you want to keep it.`)) return;
      loadNotebook(data);
      saveNow();
      toast('Notebook opened.');
    } catch (err) {
      alert(err && err.message ? err.message : 'Could not open that file.');
    }
  });

  // ---------- SVG export (vector) ----------
  const f2 = (v) => (Math.round(v * 100) / 100).toString();
  function strokeSVG(st, theme) {
    const color = inkFor(st.color, theme);
    return strokeRuns(st.points, st.width, st.straight).map(({ w, cmds }) => {
      const d = cmds.map(c => c[0] + c.slice(1).map(f2).join(' ')).join('');
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f2(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
  }
  // Spheres as circles with radial-gradient shading, back to front, as on screen.
  function aggSVG(it, theme, defs, gradIds) {
    if (!it.pts || !it.n) return '';
    const v = viewSpheres(it), a = ptsScale(it), cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const prev = renderTheme; renderTheme = theme;
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < it.n; i++) { zmin = Math.min(zmin, v.zs[i]); zmax = Math.max(zmax, v.zs[i]); }
    const zr = Math.max(1e-6, zmax - zmin);
    const order = Array.from({ length: it.n }, (_, i) => i).sort((i, j) => v.zs[i] - v.zs[j]);
    const colorOf = sphereColorFn(it), shadowK = THEMES[theme].shadow;
    let out = '';
    for (const i of order) {
      const level = clamp(Math.round(((v.zs[i] - zmin) / zr) * (LEVELS - 1)), 0, LEVELS - 1);
      const t = level / (LEVELS - 1), { mist, l0, l1, l2 } = shade(t);
      const col = colorOf ? colorOf(i) : it.color, hsl = hslOf(col);
      const key = col + '|' + level;
      let id = gradIds.get(key);
      if (!id) {
        id = 'g' + gradIds.size;
        gradIds.set(key, id);
        defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" fx="0.3" fy="0.3" fr="0.05">` +
          `<stop offset="0" stop-color="${stopColor(hsl, l0, mist)}"/>` +
          `<stop offset="0.55" stop-color="${stopColor(hsl, l1, mist)}"/>` +
          `<stop offset="1" stop-color="${stopColor(hsl, l2, mist)}"/></radialGradient>`);
      }
      const x = cx + v.xs[i], y = cy + v.ys[i], ri = v.rs[i];
      if (shadowK > 0) out += `<circle cx="${f2(x + ri * 0.15)}" cy="${f2(y + ri * 0.2)}" r="${f2(ri * 0.95)}" fill="#000" fill-opacity="${((0.05 + 0.08 * t) * (1 - mist * 0.8) * shadowK).toFixed(3)}"/>`;
      const oc = outlineStyle(t).match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
      out += `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(ri)}" fill="url(#${id})" stroke="rgb(${oc[1]},${oc[2]},${oc[3]})" stroke-opacity="${oc[4]}" stroke-width="${f2(Math.max(0.3, ri * 0.06))}"/>`;
    }
    renderTheme = prev;
    return out;
  }
  function buildSVG(list, box, theme, withBackground) {
    const defs = [], gradIds = new Map();
    const body = list.map(it => (it.type === 'stroke' ? strokeSVG(it, theme) : aggSVG(it, theme, defs, gradIds) + overlaySVG(it, theme))).join('\n');
    const bg = withBackground ? `<rect x="${f2(box.x)}" y="${f2(box.y)}" width="${f2(box.w)}" height="${f2(box.h)}" fill="${THEMES[theme].page}"/>\n` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f2(box.x)} ${f2(box.y)} ${f2(box.w)} ${f2(box.h)}" width="${f2(box.w)}" height="${f2(box.h)}">\n` +
      `<title>AggBoard export</title>\n<defs>${defs.join('')}</defs>\n${bg}${body}\n</svg>\n`;
  }
  // Extent of an item including sphere radii / line widths (for cropping).
  function exportBounds(it) {
    if (it.type === 'stroke') return strokeGeom(it).bbox;
    if (!it.pts) return { x: it.x, y: it.y, w: it.w, h: it.h };
    const v = viewSpheres(it), cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = ptsScale(it);
    const b = { x: cx + v.x0 - 0.2 * a, y: cy + v.y0 - 0.2 * a, w: v.x1 - v.x0 + 0.5 * a, h: v.y1 - v.y0 + 0.5 * a };
    const o = overlayBounds(it);
    if (!o) return b;
    const x0 = Math.min(b.x, o.x), y0 = Math.min(b.y, o.y);
    return { x: x0, y: y0, w: Math.max(b.x + b.w, o.x + o.w) - x0, h: Math.max(b.y + b.h, o.y + o.h) - y0 };
  }
  // Monomer coordinates as a text file: index radius x y z, in units of the monomer
  // radius, in the orientation shown on the board (x right, y up, z toward the viewer,
  // right-handed), origin at the (mass-weighted) centre of mass.
  function coordinatesText(it) {
    const n = it.n, P = it.pts, R = it.R;
    const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), r = new Float64Array(n);
    let M = 0, mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      X[i] = R[0] * x + R[1] * y + R[2] * z;
      Y[i] = -(R[3] * x + R[4] * y + R[5] * z);   // screen y points down
      Z[i] = R[6] * x + R[7] * y + R[8] * z;
      r[i] = radOf(it, i);
      const m = r[i] ** 3; M += m; mx += m * X[i]; my += m * Y[i]; mz += m * Z[i];
    }
    mx /= M; my /= M; mz /= M;
    let s2 = 0;
    for (let i = 0; i < n; i++) { X[i] -= mx; Y[i] -= my; Z[i] -= mz; s2 += r[i] ** 3 * (X[i] * X[i] + Y[i] * Y[i] + Z[i] * Z[i]); }
    const rg = Math.sqrt(s2 / M), poly = !!it.radii;
    const H = [`# AggBoard ${VERSION} - ${dateStamp()}`];
    if (it.kind === 'chain' && !it.edited) H.push(`# hand-drawn chain, N = ${n} (Df and kf do not apply)`);
    else if (it.edited) H.push(`# aggregate with hand-drawn parts, N = ${n} (Df and kf of the generated part no longer apply)`);
    else {
      const kf = it.kfUsed != null ? it.kfUsed : (it.kf != null ? it.kf : window.AggEngine.kfAuto(it.df, it.sigma || 1));
      const cca = it.method === 'cca' && !it.ccaFallback;
      H.push(`# ${cca ? 'cluster-cluster' : 'particle-cluster'} aggregate${it.ccaFallback ? ' (cluster-cluster is not possible above Df 2.3)' : ''}, N = ${n}, Df = ${it.df.toFixed(2)}, kf = ${kf.toFixed(3)} (${it.kf != null ? 'fixed' : 'auto'}), seed ${it.seed >>> 0}${cca ? `, subcluster size ${it.ns ? it.ns : 'auto'}` : ''}`);
      if (it.dfFit) H.push(`# fitted Df of the growth = ${it.dfFit.toFixed(3)}`);
    }
    H.push(`# Rg = ${rg.toFixed(4)} a${poly ? ' (mass-weighted)' : ''}`);
    H.push(poly
      ? `# polydisperse: coordinates and radii in units of the geometric mean monomer radius a_g (log-normal, sigma_g = ${(it.sigma || 1).toFixed(2)}, truncated to 0.5 ... 2 a_g)`
      : `# coordinates and radii in units of the monomer radius a`);
    H.push(`# frame as shown on the board: x right, y up, z toward the viewer (right-handed); origin = centre of mass${poly ? ' (mass-weighted)' : ''}`);
    if (!(it.kind === 'chain' || it.edited) && !(it.method === 'cca' && !it.ccaFallback)) H.push('# index = order of growth');
    H.push('# index    radius            x            y            z');
    const f = (v, w, d) => v.toFixed(d).padStart(w);
    const L = new Array(n);
    for (let i = 0; i < n; i++) L[i] = `${String(i + 1).padStart(7)} ${f(r[i], 9, 4)} ${f(X[i], 12, 5)} ${f(Y[i], 12, 5)} ${f(Z[i], 12, 5)}`;
    return H.join('\n') + '\n' + L.join('\n') + '\n';
  }
  function exportCoordinates(it) {
    if (!it.pts || !it.n) { toast('This aggregate is still being built.', 2500); return; }
    const txt = coordinatesText(it);
    const kind = it.kind === 'chain' && !it.edited ? 'chain' : it.edited ? 'aggregate-edited' : `aggregate-Df${it.df.toFixed(2)}`;
    shareBlob(new Blob([txt], { type: 'text/plain' }), `${kind}-N${it.n}-${dateStamp()}.txt`, 'text/plain');
  }
  function exportPageSVG() {
    commitPendingDot();
    const theme = themeOf(curPage());
    const svg = buildSVG(items(), { x: 0, y: 0, w: PW, h: pageH(curPage()) }, theme, true);
    shareBlob(new Blob([svg], { type: 'image/svg+xml' }), `page-${nb.current + 1}-${dateStamp()}.svg`, 'image/svg+xml');
  }
  function exportSelectionSVG() {
    const sel = selectedItems();
    if (!sel.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of sel) { const b = exportBounds(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const m = 10, box = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
    const theme = themeOf(curPage());
    const ordered = items().filter(it => selection.has(it.id));      // keep page stacking order
    const svg = buildSVG(ordered, box, theme, theme === 'dark');       // white pages: transparent background
    shareBlob(new Blob([svg], { type: 'image/svg+xml' }), `selection-${dateStamp()}.svg`, 'image/svg+xml');
  }
  function exportPagePNG() {
    commitPendingDot();
    const k = 2;
    const c = document.createElement('canvas');
    c.width = PW * k; c.height = Math.round(pageH(curPage()) * k);
    const x = c.getContext('2d');
    const prevTheme = renderTheme;
    renderTheme = themeOf(curPage());
    x.fillStyle = THEMES[renderTheme].page; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(k, 0, 0, k, 0, 0);
    for (const it of items()) {
      if (it.type === 'stroke') drawStroke(x, it);
      else if (it.pts) {
        const bmp = renderAggBitmap(it, k);
        x.drawImage(bmp.canvas, it.x + it.w / 2 + bmp.ox, it.y + it.h / 2 + bmp.oy, bmp.canvas.width / bmp.ppu, bmp.canvas.height / bmp.ppu);
        drawOverlays(x, it, renderTheme, 1 / k);
      }
    }
    renderTheme = prevTheme;
    c.toBlob((blob) => { if (blob) shareBlob(blob, `page-${nb.current + 1}-${dateStamp()}.png`, 'image/png'); }, 'image/png');
  }

  // ============================================================
  // Animated GIF export of the spin (rotate or rock), one seamless cycle.
  // One palette for all frames (median cut over sample frames, no dithering, so
  // colours do not flicker); each frame stores only the rectangle that changed,
  // with unchanged pixels transparent. Encoder below, no external library.
  // ============================================================
  function gifMedianCut(hist, sums, maxColors) {
    const bins = [];
    for (let i = 0; i < 32768; i++) if (hist[i]) bins.push(i);
    const mean = (i, c) => sums[3 * i + c] / hist[i];
    const boxOf = (list) => {
      let n = 0, lo = [255, 255, 255], hi = [0, 0, 0];
      for (const i of list) { n += hist[i]; for (let c = 0; c < 3; c++) { const v = mean(i, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; } }
      const rg = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const ch = rg[0] >= rg[1] && rg[0] >= rg[2] ? 0 : rg[1] >= rg[2] ? 1 : 2;
      return { list, n, ch, range: rg[ch] };
    };
    const boxes = [boxOf(bins)];
    while (boxes.length < maxColors) {
      let best = -1, score = 0;
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        if (b.list.length < 2 || b.range <= 0) continue;
        const sc = Math.sqrt(b.n) * b.range;
        if (sc > score) { score = sc; best = k; }
      }
      if (best < 0) break;
      const b = boxes[best];
      b.list.sort((i, j) => mean(i, b.ch) - mean(j, b.ch));
      let acc = 0, cut = 1;
      for (let k = 0; k < b.list.length - 1; k++) { acc += hist[b.list[k]]; if (acc >= b.n / 2) { cut = k + 1; break; } cut = k + 1; }
      boxes.splice(best, 1, boxOf(b.list.slice(0, cut)), boxOf(b.list.slice(cut)));
    }
    return boxes.map(b => {
      let n = 0, r = 0, g = 0, bl = 0;
      for (const i of b.list) { n += hist[i]; r += sums[3 * i]; g += sums[3 * i + 1]; bl += sums[3 * i + 2]; }
      return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
    });
  }
  // LZW-compress palette indices into GIF data sub-blocks (minimum code size 8).
  const gifDict = { stamp: new Int32Array(4096 * 256), code: new Uint16Array(4096 * 256), gen: 0 };
  function gifLZW(idx, out) {
    const D = gifDict, CLEAR = 256, EOI = 257;
    let codeSize = 9, next = 258, cur = 0, nbits = 0;
    const block = new Uint8Array(255); let bl = 0;
    const flushBlock = () => { if (bl) { out.push(bl); for (let k = 0; k < bl; k++) out.push(block[k]); bl = 0; } };
    const emit = (c) => {
      cur |= c << nbits; nbits += codeSize;
      while (nbits >= 8) { block[bl++] = cur & 255; if (bl === 255) flushBlock(); cur >>>= 8; nbits -= 8; }
    };
    out.push(8);
    D.gen++;
    emit(CLEAR);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i], key = prefix * 256 + k;
      if (D.stamp[key] === D.gen) { prefix = D.code[key]; continue; }
      emit(prefix);
      if (next < 4096) {
        D.stamp[key] = D.gen; D.code[key] = next++;
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(CLEAR); D.gen++; next = 258; codeSize = 9;
      }
      prefix = k;
    }
    emit(prefix);
    emit(EOI);
    if (nbits > 0) { block[bl++] = cur & 255; if (bl === 255) flushBlock(); }
    flushBlock();
    out.push(0);
  }
  class ByteOut {
    constructor() { this.chunks = []; this.buf = new Uint8Array(1 << 16); this.n = 0; this.size = 0; }
    push(b) { if (this.n === this.buf.length) { this.chunks.push(this.buf); this.buf = new Uint8Array(1 << 16); this.n = 0; } this.buf[this.n++] = b; this.size++; }
    u16(v) { this.push(v & 255); this.push((v >> 8) & 255); }
    str(t) { for (let i = 0; i < t.length; i++) this.push(t.charCodeAt(i)); }
    blob() { return new Blob([...this.chunks, this.buf.slice(0, this.n)], { type: 'image/gif' }); }
  }

  // ------------------------------------------------------------
  // MP4 muxer for H.264 (one video track, 'faststart' layout: ftyp, moov, mdat).
  // samples: [{ data: Uint8Array (AVCC, 4-byte lengths, or Annex B), pts: µs, key }]
  // in decode order. description: avcC record (from the encoder); if absent it is
  // built from SPS/PPS found in the first key frame. Handles B-frames (ctts + edit list).
  // ------------------------------------------------------------
  function annexbToAvcc(u8) {
    const nals = [];
    let i = 0, start = -1;
    const n = u8.length;
    while (i + 3 <= n) {
      if (u8[i] === 0 && u8[i + 1] === 0 && (u8[i + 2] === 1 || (u8[i + 2] === 0 && i + 3 < n && u8[i + 3] === 1))) {
        if (start >= 0) nals.push(u8.subarray(start, i));
        i += u8[i + 2] === 1 ? 3 : 4; start = i;
      } else i++;
    }
    if (start >= 0) nals.push(u8.subarray(start, n));
    // drop trailing zero bytes of each NAL (they belong to the next start code)
    const clean = nals.map(x => { let e = x.length; while (e > 0 && x[e - 1] === 0) e--; return x.subarray(0, e); }).filter(x => x.length);
    return clean;
  }
  // High profiles (100 and up) need the chroma/bit-depth extension at the end of avcC;
  // add it (4:2:0, 8 bit, which is what we encode) when a record lacks it.
  function completeAvcC(c) {
    const prof = c[1];
    if (prof !== 100 && prof !== 110 && prof !== 122 && prof !== 144) return c;
    let o = 5, nS = c[o++] & 31;
    for (let k = 0; k < nS; k++) { const L = (c[o] << 8) | c[o + 1]; o += 2 + L; }
    let nP = c[o++];
    for (let k = 0; k < nP; k++) { const L = (c[o] << 8) | c[o + 1]; o += 2 + L; }
    if (o < c.length) return c;   // extension already present
    const out = new Uint8Array(c.length + 4);
    out.set(c, 0); out.set([0xFD, 0xF8, 0xF8, 0], c.length);
    return out;
  }
  const isAnnexB = (u8) => u8.length > 4 && u8[0] === 0 && u8[1] === 0 && (u8[2] === 1 || (u8[2] === 0 && u8[3] === 1));
  function mp4Mux({ width, height, fps, samples, description }) {
    const TS = 90000;
    let avcC = description ? new Uint8Array(description.buffer ? description.buffer.slice(description.byteOffset || 0, (description.byteOffset || 0) + description.byteLength) : description) : null;
    // Normalise sample data to AVCC; collect SPS/PPS if no description was given.
    let sps = null, pps = null;
    const data = samples.map(sm => {
      if (!isAnnexB(sm.data)) return sm.data;
      const nals = annexbToAvcc(sm.data).filter(x => {
        const t = x[0] & 31;
        if (t === 7) { if (!sps) sps = x; return false; }
        if (t === 8) { if (!pps) pps = x; return false; }
        return t !== 9;   // access unit delimiters are not stored in MP4
      });
      let len = 0; for (const x of nals) len += 4 + x.length;
      const out = new Uint8Array(len); let o = 0;
      for (const x of nals) { out[o] = x.length >>> 24; out[o + 1] = (x.length >>> 16) & 255; out[o + 2] = (x.length >>> 8) & 255; out[o + 3] = x.length & 255; out.set(x, o + 4); o += 4 + x.length; }
      return out;
    });
    if (!avcC) {
      if (!sps || !pps) throw new Error('No codec description (SPS/PPS) from the encoder');
      avcC = new Uint8Array(11 + sps.length + pps.length);
      avcC.set([1, sps[1], sps[2], sps[3], 0xFF, 0xE1, sps.length >> 8, sps.length & 255], 0);
      avcC.set(sps, 8);
      avcC.set([1, pps.length >> 8, pps.length & 255], 8 + sps.length);
      avcC.set(pps, 11 + sps.length);
    }
    avcC = completeAvcC(avcC);
    const N = samples.length;
    const dts = [], cto = [];
    for (let i = 0; i < N; i++) dts.push(Math.round(i * TS / fps));
    const ptsT = samples.map(sm => Math.round(sm.pts * TS / 1e6));
    // Presentation times may be reordered (B-frames); offsets relative to decode times.
    let minOff = Infinity;
    for (let i = 0; i < N; i++) { cto.push(ptsT[i] - dts[i]); minOff = Math.min(minOff, cto[i]); }
    const shift = minOff < 0 ? -minOff : 0;
    for (let i = 0; i < N; i++) cto[i] += shift;
    const needCtts = cto.some(v => v !== cto[0]) || cto[0] !== 0;
    const durT = Math.round(N * TS / fps);
    const mediaStart = Math.min(...ptsT) + shift;   // first presented frame, in media time
    const movieDur = Math.round(N * 1000 / fps);
    let mediaEnd = durT;   // end of the last presented frame in media time (B-frames shift it)
    for (let i = 0; i < N; i++) mediaEnd = Math.max(mediaEnd, dts[i] + cto[i] + Math.round(TS / fps));
    // Box helpers
    const parts = [];
    const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    const u16b = (v) => [(v >>> 8) & 255, v & 255];
    const str4 = (t) => [t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3)];
    const cat = (arrs) => { let L = 0; for (const a of arrs) L += a.length; const o = new Uint8Array(L); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
    const box = (type, ...content) => { const body = cat(content.map(c => (c instanceof Uint8Array ? c : new Uint8Array(c)))); return cat([new Uint8Array(u32(8 + body.length)), new Uint8Array(str4(type)), body]); };
    const full = (type, ver, flags, ...content) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...content);
    const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
    const ftyp = box('ftyp', str4('isom'), u32(512), str4('isom'), str4('iso2'), str4('avc1'), str4('mp41'));
    const sizes = data.map(d => d.length);
    const buildMoov = (chunkOffset) => {
      const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x10000), u16b(0x100), new Uint8Array(10), MATRIX, new Uint8Array(24), u32(2));
      const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), new Uint8Array(8), u16b(0), u16b(0), u16b(0), u16b(0), MATRIX, u32(width << 16), u32(height << 16));
      const elst = full('elst', 0, 0, u32(1), u32(movieDur), u32(mediaStart), u16b(1), u16b(0));
      const edts = box('edts', elst);
      const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(mediaEnd), u16b(0x55c4), u16b(0));
      const hdlr = full('hdlr', 0, 0, u32(0), str4('vide'), new Uint8Array(12), new Uint8Array([...'AggBoard video'].map(ch => ch.charCodeAt(0)).concat([0])));
      const vmhd = full('vmhd', 0, 1, new Uint8Array(8));
      const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
      const comp = new Uint8Array(32); const cname = 'AggBoard'; comp[0] = cname.length; for (let i = 0; i < cname.length; i++) comp[1 + i] = cname.charCodeAt(i);
      const avc1 = box('avc1', new Uint8Array(6), u16b(1), u16b(0), u16b(0), new Uint8Array(12), u16b(width), u16b(height),
        u32(0x00480000), u32(0x00480000), u32(0), u16b(1), comp, u16b(0x18), u16b(0xFFFF), box('avcC', avcC));
      const stsd = full('stsd', 0, 0, u32(1), avc1);
      // stts: runs of equal decode durations
      const runs = [];
      for (let i = 0; i < N; i++) {
        const dd = (i + 1 < N ? dts[i + 1] : durT) - dts[i];
        if (runs.length && runs[runs.length - 1][1] === dd) runs[runs.length - 1][0]++; else runs.push([1, dd]);
      }
      const stts = full('stts', 0, 0, u32(runs.length), ...runs.map(r => [...u32(r[0]), ...u32(r[1])]));
      const boxes = [stsd, stts];
      if (needCtts) {
        const cr = [];
        for (let i = 0; i < N; i++) { if (cr.length && cr[cr.length - 1][1] === cto[i]) cr[cr.length - 1][0]++; else cr.push([1, cto[i]]); }
        boxes.push(full('ctts', 0, 0, u32(cr.length), ...cr.map(r => [...u32(r[0]), ...u32(r[1])])));
      }
      const keys = []; samples.forEach((sm, i) => { if (sm.key) keys.push(i + 1); });
      if (keys.length < N) boxes.push(full('stss', 0, 0, u32(keys.length), ...keys.map(k => u32(k))));
      boxes.push(full('stsc', 0, 0, u32(1), u32(1), u32(N), u32(1)));
      boxes.push(full('stsz', 0, 0, u32(0), u32(N), ...sizes.map(z => u32(z))));
      boxes.push(full('stco', 0, 0, u32(1), u32(chunkOffset)));
      const stbl = box('stbl', ...boxes);
      const minf = box('minf', vmhd, dinf, stbl);
      const mdia = box('mdia', mdhd, hdlr, minf);
      const trak = box('trak', tkhd, edts, mdia);
      return box('moov', mvhd, trak);
    };
    const moovLen = buildMoov(0).length;
    const moov = buildMoov(ftyp.length + moovLen + 8);
    let total = 0; for (const z of sizes) total += z;
    const mdatHead = new Uint8Array([...u32(8 + total), ...str4('mdat')]);
    return new Blob([ftyp, moov, mdatHead, ...data], { type: 'video/mp4' });
  }

  // H.264 configurations to try, most capable first (High, Main, Constrained Baseline; level 4.0 / 5.1).
  const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033', 'avc1.42001f'];
  const videoBitrate = (W, H, fps) => Math.round(clamp(W * H * fps * 0.12, 4e5, 1.5e7));
  async function pickAvcConfig(W, H, fps) {
    if (typeof window.VideoEncoder !== 'function' || typeof window.VideoFrame !== 'function') return null;
    for (const codec of AVC_CODECS) for (const extra of [{ latencyMode: 'quality' }, {}]) {
      const cfg = { codec, width: W, height: H, bitrate: videoBitrate(W, H, fps), framerate: fps, avc: { format: 'avc' }, ...extra };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) return cfg; } catch (_) {}
    }
    return null;
  }
  let videoSupport = null;   // null = not checked yet, then true / false
  async function checkVideoSupport() {
    if (videoSupport === null) videoSupport = !!(await pickAvcConfig(800, 800, 25));
    return videoSupport;
  }

  const GIF_SIZES = { small: 480, medium: 800, large: 1200 };
  let gifJob = null;   // { scope, cancel, blob, url, name }
  function gifTargets(scope) {
    const list = scope === 'selection' ? items().filter(it => selection && selection.has(it.id)) : items();
    const moving = list.filter(it => it.type === 'agg' && it.pts && it.n);
    return { list, moving };
  }
  function gifThetas(motion, fps) {
    const period = motion === 'rock' ? ROCK_PERIOD : spin.period;
    const F = Math.max(8, Math.round(period / 1000 * fps));
    const th = [];
    for (let j = 0; j < F; j++) th.push(motion === 'rock' ? ROCK_AMP * Math.sin(2 * Math.PI * j / F) : 2 * Math.PI * j / F);
    return th;
  }
  function openGifDialog(scope) {
    commitPendingDot();
    const { moving } = gifTargets(scope);
    if (!moving.length) { toast(scope === 'selection' ? 'No aggregates in the selection, so nothing would move.' : 'There are no aggregates on this page, so nothing would move.', 3500); return; }
    closeMenu && closeMenu();
    gifCancel();
    gifJob = { scope };
    const g = settings.gif || {};
    setSeg('gifMotion', 'motion', settings.spinStyle === 'rock' ? 'rock' : 'rotate');
    setSeg('gifSize', 'size', GIF_SIZES[g.size] ? g.size : 'medium');
    setSeg('gifFps', 'fps', g.fps === 25 ? '25' : '15');
    setSeg('gifFormat', 'format', g.format === 'mp4' ? 'mp4' : 'gif');
    updateFormatNote();
    checkVideoSupport().then(ok => {
      const b = $('gifFormat').querySelector('[data-format=mp4]');
      b.disabled = !ok;
      b.title = ok ? '' : 'Video export needs WebCodecs, which this browser does not offer';
      if (!ok && segVal('gifFormat', 'format') === 'mp4') setSeg('gifFormat', 'format', 'gif');
      updateFormatNote();
    });
    const nAgg = moving.length;
    $('gifWhat').textContent = scope === 'selection'
      ? `The selection, cropped to it; ${nAgg === 1 ? 'the selected aggregate moves' : nAgg === 2 ? 'both selected aggregates move' : `the ${nAgg} selected aggregates move`}.`
      : `The whole page; ${nAgg === 1 ? 'its aggregate moves' : nAgg === 2 ? 'both aggregates move' : `all ${nAgg} aggregates move`}, everything else stays still.`;
    gifShowState('setup');
    $('gifDlg').classList.add('visible');
  }
  function updateFormatNote() {
    const mp4 = segVal('gifFormat', 'format') === 'mp4';
    $('gifNoteGif').style.display = mp4 ? 'none' : '';
    $('gifNoteMp4').style.display = mp4 ? '' : 'none';
    $('gifNoVideo').style.display = videoSupport === false ? '' : 'none';
  }
  function setSeg(id, key, val) { for (const b of $(id).children) b.classList.toggle('active', b.dataset[key] === val); }
  const segVal = (id, key) => { const b = $(id).querySelector('.active'); return b ? b.dataset[key] : null; };
  function gifShowState(st, info) {
    $('gifSetup').style.display = st === 'setup' ? '' : 'none';
    $('gifBusy').style.display = st === 'busy' ? '' : 'none';
    $('gifDone').style.display = st === 'done' ? '' : 'none';
    $('gifCreate').style.display = st === 'setup' ? '' : 'none';
    $('gifSave').style.display = st === 'done' ? '' : 'none';
    $('gifAgain').style.display = st === 'done' ? '' : 'none';
    $('gifClose').textContent = st === 'busy' ? 'Cancel' : 'Close';
    if (st === 'done' && info) $('gifInfo').textContent = info;
    if (st !== 'done') { const v = $('gifVideo'); try { v.pause(); } catch (_) {} v.removeAttribute('src'); }
  }
  function gifCancel() {
    if (!gifJob) return;
    gifJob.cancel = true;
    if (gifJob.url) URL.revokeObjectURL(gifJob.url);
    $('gifPreview').removeAttribute('src');
    const v = $('gifVideo'); try { v.pause(); } catch (_) {} v.removeAttribute('src');
  }
  function closeGifDialog() { gifCancel(); gifJob = null; $('gifDlg').classList.remove('visible'); }
  async function createGif() {
    const job = gifJob; if (!job) return;
    const motion = segVal('gifMotion', 'motion') || 'rotate', sizeKey = segVal('gifSize', 'size') || 'medium', fps = +(segVal('gifFps', 'fps') || 15);
    const format = segVal('gifFormat', 'format') === 'mp4' ? 'mp4' : 'gif';
    settings.gif = { size: sizeKey, fps, format }; saveSettings();
    const pg = curPage(), theme = themeOf(pg);
    const { list, moving } = gifTargets(job.scope);
    const movingIds = new Set(moving.map(it => it.id));
    const thetas = gifThetas(motion, fps);
    const frameItem = (it, theta) => (movingIds.has(it.id) && theta !== 0 ? { ...it, R: matMul(axisRot(SPIN_AXIS, theta), it.R) } : it);
    // Region: the page, or the selection over all frames (so nothing is cut off while it turns).
    let box;
    if (job.scope === 'selection') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
      for (const it of list) {
        if (!movingIds.has(it.id)) { add(exportBounds(it)); continue; }
        for (let j = 0; j < thetas.length; j += Math.max(1, Math.floor(thetas.length / 48))) add(exportBounds(frameItem(it, thetas[j])));
        if (motion === 'rock') { add(exportBounds(frameItem(it, ROCK_AMP))); add(exportBounds(frameItem(it, -ROCK_AMP))); }
      }
      const m = 12; box = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
    } else box = { x: 0, y: 0, w: PW, h: pageH(pg) };
    const longest = GIF_SIZES[sizeKey];
    const k = longest / Math.max(box.w, box.h);
    // H.264 needs even dimensions.
    const even = (v) => Math.max(2, 2 * Math.round(v / 2));
    const W = format === 'mp4' ? even(box.w * k) : Math.max(1, Math.round(box.w * k));
    const H = format === 'mp4' ? even(box.h * k) : Math.max(1, Math.round(box.h * k));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    const draw = (theta) => {
      const prevTheme = renderTheme; renderTheme = theme;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = THEMES[theme].page; x.fillRect(0, 0, W, H);
      x.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
      for (const it0 of list) {
        if (it0.type === 'stroke') { drawStroke(x, it0); continue; }
        if (!it0.pts) continue;
        const it = frameItem(it0, theta);
        const bmp = renderAggBitmap(it, k);
        x.drawImage(bmp.canvas, it.x + it.w / 2 + bmp.ox, it.y + it.h / 2 + bmp.oy, bmp.canvas.width / bmp.ppu, bmp.canvas.height / bmp.ppu);
        drawOverlays(x, it, theme, 1 / k);
      }
      renderTheme = prevTheme;
    };
    const render = (theta) => { draw(theta); return x.getImageData(0, 0, W, H).data; };
    gifShowState('busy');
    const bar = $('gifBar'), status = $('gifStatus');
    const yieldUI = () => new Promise(r => setTimeout(r, 0));
    const finish = (blob, mime, ext) => {
      job.blob = blob; job.mime = mime;
      job.url = URL.createObjectURL(blob);
      job.name = `${job.scope === 'selection' ? 'selection' : 'page-' + (nb.current + 1)}-${motion}-${dateStamp()}.${ext}`;
      $('gifPreview').style.display = ext === 'gif' ? '' : 'none';
      $('gifVideo').style.display = ext === 'mp4' ? '' : 'none';
      if (ext === 'gif') $('gifPreview').src = job.url;
      else { const v = $('gifVideo'); v.src = job.url; try { const pr = v.play && v.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {} }
      const mb = blob.size / 1048576;
      gifShowState('done', `${ext === 'mp4' ? 'Video (MP4)' : 'GIF'} · ${W} × ${H} px · ${thetas.length} frames · ${(thetas.length / fps).toFixed(1)} s · ${mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' kB'}`);
    };
    if (format === 'mp4') {
      const cfg = await pickAvcConfig(W, H, fps);
      if (!cfg) throw new Error(`this browser cannot encode video at ${W} × ${H} px. Try a smaller size, or GIF`);
      const F = thetas.length, samples = [];
      let desc = null, encErr = null;
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          if (!desc && meta && meta.decoderConfig && meta.decoderConfig.description) desc = meta.decoderConfig.description;
          const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
          samples.push({ data: b, pts: chunk.timestamp, key: chunk.type === 'key' });
        },
        error: (e) => { encErr = e; },
      });
      try {
        enc.configure(cfg);
        const keyEvery = Math.max(1, Math.round(fps * 2));
        for (let j = 0; j < F; j++) {
          if (job.cancel) return;
          if (encErr) throw encErr;
          draw(thetas[j]);
          const frame = new VideoFrame(c, { timestamp: Math.round(j * 1e6 / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: j % keyEvery === 0 });
          frame.close();
          while (enc.encodeQueueSize > 4 && !encErr && !job.cancel) await new Promise(r => setTimeout(r, 4));
          bar.style.width = (100 * (j + 1) / (F + 1)).toFixed(1) + '%';
          status.textContent = `Frame ${j + 1} of ${F}`;
          await yieldUI();
        }
        status.textContent = 'Finishing…';
        await enc.flush();
        if (encErr) throw encErr;
      } finally { try { enc.close(); } catch (_) {} }
      if (job.cancel) return;
      if (samples.length !== F) throw new Error(`the encoder returned ${samples.length} of ${F} frames`);
      finish(mp4Mux({ width: W, height: H, fps, samples, description: desc }), 'video/mp4', 'mp4');
      return;
    }
    const F = thetas.length, total = F + 8;
    status.textContent = 'Choosing colours…'; bar.style.width = '0%';
    await yieldUI();
    // 1. Palette from 8 sample frames.
    const hist = new Uint32Array(32768), sums = new Float64Array(32768 * 3);
    for (let sIdx = 0; sIdx < 8; sIdx++) {
      if (job.cancel) return;
      const d = render(thetas[Math.floor(sIdx * F / 8)]);
      for (let i = 0; i < d.length; i += 4) {
        const bin = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
        hist[bin]++; sums[3 * bin] += d[i]; sums[3 * bin + 1] += d[i + 1]; sums[3 * bin + 2] += d[i + 2];
      }
      bar.style.width = (100 * (sIdx + 1) / total).toFixed(1) + '%';
      await yieldUI();
    }
    const pal = gifMedianCut(hist, sums, 255);   // index 0 is reserved for "unchanged" (transparent)
    const P = new Uint8Array(768);
    pal.forEach((col, i) => { P[3 * (i + 1)] = col[0]; P[3 * (i + 1) + 1] = col[1]; P[3 * (i + 1) + 2] = col[2]; });
    const map = new Int16Array(32768).fill(-1);
    const nearest = (bin) => {
      const r = sums[3 * bin] / hist[bin] || ((bin >> 10) << 3) + 4, g = sums[3 * bin + 1] / hist[bin] || (((bin >> 5) & 31) << 3) + 4, b = sums[3 * bin + 2] / hist[bin] || ((bin & 31) << 3) + 4;
      let best = 1, bd = Infinity;
      for (let i = 0; i < pal.length; i++) {
        const dr = r - pal[i][0], dg = g - pal[i][1], db = b - pal[i][2], dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (dd < bd) { bd = dd; best = i + 1; }
      }
      return best;
    };
    // 2. Frames.
    const out = new ByteOut();
    out.str('GIF89a'); out.u16(W); out.u16(H); out.push(0xF7); out.push(0); out.push(0);
    for (let i = 0; i < 768; i++) out.push(P[i]);
    out.push(0x21); out.push(0xFF); out.push(11); out.str('NETSCAPE2.0'); out.push(3); out.push(1); out.u16(0); out.push(0);
    let prev = null;
    const cur = new Uint8Array(W * H);
    for (let j = 0; j < F; j++) {
      if (job.cancel) return;
      const d = render(thetas[j]);
      for (let p = 0, i = 0; p < cur.length; p++, i += 4) {
        const bin = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
        let v = map[bin]; if (v < 0) v = map[bin] = nearest(bin);
        cur[p] = v;
      }
      // Changed rectangle relative to the previous frame.
      let rx0 = 0, ry0 = 0, rx1 = W - 1, ry1 = H - 1, trans = false;
      if (prev) {
        rx0 = W; ry0 = H; rx1 = -1; ry1 = -1;
        for (let yy = 0; yy < H; yy++) {
          const o = yy * W;
          for (let xx = 0; xx < W; xx++) if (cur[o + xx] !== prev[o + xx]) { if (xx < rx0) rx0 = xx; if (xx > rx1) rx1 = xx; if (yy < ry0) ry0 = yy; if (yy > ry1) ry1 = yy; }
        }
        if (rx1 < 0) { rx0 = rx1 = ry0 = ry1 = 0; }
        trans = true;
      }
      const rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1, sub = new Uint8Array(rw * rh);
      for (let yy = 0; yy < rh; yy++) {
        const o = (ry0 + yy) * W + rx0;
        for (let xx = 0; xx < rw; xx++) { const v = cur[o + xx]; sub[yy * rw + xx] = trans && prev[o + xx] === v ? 0 : v; }
      }
      const delay = Math.round(100 * (j + 1) / fps) - Math.round(100 * j / fps);
      out.push(0x21); out.push(0xF9); out.push(4); out.push((1 << 2) | (trans ? 1 : 0)); out.u16(delay); out.push(0); out.push(0);
      out.push(0x2C); out.u16(rx0); out.u16(ry0); out.u16(rw); out.u16(rh); out.push(0);
      gifLZW(sub, out);
      if (!prev) prev = new Uint8Array(W * H);
      prev.set(cur);
      bar.style.width = (100 * (9 + j) / total).toFixed(1) + '%';
      status.textContent = `Frame ${j + 1} of ${F}`;
      await yieldUI();
    }
    out.push(0x3B);
    if (job.cancel) return;
    finish(out.blob(), 'image/gif', 'gif');
  }

  // ============================================================
  // Persistence (IndexedDB, with localStorage fallback)
  // ============================================================
  let db = null, saveTimer = 0, saveWarned = false, storageReady = false;
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const r = indexedDB.open(CONFIG.DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function dbGet(key) {
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function dbPut(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function scheduleSave() {
    if (!storageReady) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }
  async function saveNow(force) {
    clearTimeout(saveTimer);
    if (!storageReady) return;
    if (!force && (action || pointers.size)) { saveTimer = setTimeout(saveNow, 1500); return; }
    try {
      if (db) await dbPut('notebook', { ...nb, pages: nb.pages.map(pg => ({ id: pg.id, items: pg.items, ...pageMeta(pg) })) });
      else localStorage.setItem('aggboard.notebook', JSON.stringify(notebookToJSON()));
    } catch (err) {
      if (!saveWarned) { saveWarned = true; toast('Could not save on this device. Use "Save notebook to file".', 5000); }
      console.warn('Save failed:', err);
    }
  }
  window.addEventListener('pagehide', () => saveNow(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(true); });

  async function loadStored() {
    try {
      db = await openDB();
      const saved = await dbGet('notebook');
      if (saved) return sanitizeNotebook(saved);
    } catch (err) {
      db = null;
      console.warn('IndexedDB unavailable, falling back to localStorage:', err);
      try {
        const s = localStorage.getItem('aggboard.notebook');
        if (s) return sanitizeNotebook(JSON.parse(s));
      } catch (_) {}
    }
    return null;
  }

  // ============================================================
  // Keyboard
  // ============================================================
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if ($('help').classList.contains('visible')) $('help').classList.remove('visible');
      else if ($('gifDlg').classList.contains('visible')) closeGifDialog();
      else if (pagesOpen()) { if (pvDrag && pvDrag.active) endPvDrag(false); else closePages(); }
      else if (menu.classList.contains('visible')) closeMenu();
      else if (panelId) closePanel();
      else clearSelection();
      return;
    }
    if ($('help').classList.contains('visible') || $('gifDlg').classList.contains('visible') || pagesOpen()) return;
    // Df while placing a circle aggregate: arrow keys, or Z (lower) / X (higher) for the left hand
    if (action && action.kind === 'circle' && !mod && !e.altKey) {
      const up = e.key === 'ArrowUp' || k === 'x', down = e.key === 'ArrowDown' || k === 'z';
      if (up || down) {
        e.preventDefault();
        setGestureDf(settings.agg.df + (up ? 1 : -1) * (e.shiftKey ? 0.01 : 0.05));
        return;
      }
    }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod || e.altKey) return;
    if (tag === 'INPUT') return;   // keep letters away from focused sliders
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selection) { e.preventDefault(); deleteSelection(); } return; }
    if (e.key === 'PageDown') { goToPage(nb.current + 1); return; }
    if (e.key === 'PageUp') { goToPage(nb.current - 1); return; }
    const tools = { p: 'pen', e: 'eraser', s: 'select', l: 'laser', a: 'aggregate', c: 'chain' };
    if (tools[k]) { setTool(tools[k]); return; }
    if (k >= '1' && k <= '5') { setColor(INK[+k - 1].v); return; }
    if (e.key === '[' || e.key === ']') {   // thinner / thicker line
      const i = clamp(settings.width + (e.key === ']' ? 1 : -1), 0, WIDTHS.length - 1);
      if (i !== settings.width) setWidth(i);
      toast(['Thin', 'Medium', 'Thick'][i] + ' line', 1200);
      return;
    }
    if (k === '0') fitPage();
    if (e.key === ' ') {
      e.preventDefault();
      if (spin.mode === 'once' || spin.mode === 'loop') stopSpin(true);
      else startSpin(e.shiftKey ? 'loop' : 'once');
    }
  });

  // ============================================================
  // Start
  // ============================================================
  async function init() {
    setTool(settings.tool);
    setColorUI();
    [...widthsEl.children].forEach((b, j) => b.classList.toggle('active', j === settings.width));
    resize();
    fitPage();
    updateChrome();
    const stored = await loadStored();
    storageReady = true;
    if (stored) loadNotebook(stored);
    else { goToPage(0); saveNow(); }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    setupOffline();
  }
  function setColorUI() {
    const th = themeOf(curPage());
    for (const b of colorsEl.children) {
      b.classList.toggle('active', b.dataset.color === settings.color);
      b.style.backgroundColor = inkFor(b.dataset.color, th);
    }
  }

  // ============================================================
  // Offline support (service worker, see sw.js)
  // ============================================================
  function setupOffline() {
    const sw = navigator.serviceWorker;
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!sw || !secure) return;
    let reloading = false;
    sw.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
    const offerUpdate = (worker) => {
      toast('A new version of AggBoard is ready.', 0, {
        label: 'Reload',
        fn: () => { reloading = true; saveNow(true).finally(() => worker.postMessage({ type: 'SKIP_WAITING' })); },
      });
    };
    sw.register('sw.js').then((reg) => {
      if (reg.waiting && sw.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // A waiting worker while a page is controlled = an update (not the first install).
          if (nw.state === 'installed' && sw.controller) offerUpdate(nw);
        });
      });
      // Look for updates when the app comes back to the foreground, and every 30 minutes.
      const check = () => { if (navigator.onLine !== false) reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch((err) => console.warn('Offline support unavailable:', err));
  }

  // Exposed for automated tests only.
  window.__aggboard = { spin, startSpin, stopSpin, buildSVG, get gifJob() { return gifJob; }, openPages, closePages, pagesOpen, movePageTo, coordinatesText, gifLZW, ByteOut, mp4Mux, get action() { return action; }, get nb() { return nb; }, get selection() { return selection; }, view, settings, undo, redo, goToPage, newPage, saveNow, notebookToJSON, sanitizeNotebook };

  init();
})();
