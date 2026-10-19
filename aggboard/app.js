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
  const VERSION = '2026.10.18-28';
  window.AGGBOARD_VERSION = VERSION;
  const CONFIG = {
    MENU_URL: null,            // e.g. '../index.html' to show a "back to menu" button
    PAGE_W: 1600, PAGE_H: 900, // page size in page units (16:9)
    N_MAX: 5000,               // maximum monomers per aggregate
    DB_NAME: 'aggboard',
    SETTINGS_KEY: 'aggboard.settings.v1',
    FORMAT: 'aggboard-notebook',
    FORMAT_VERSION: 2,         // v2 adds chains and edited aggregates
  };
  const PW = CONFIG.PAGE_W, PH = CONFIG.PAGE_H;
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
      fingerMode: 'auto', penSeen: false,
      agg: { a: 10, df: 1.8, kf: null, color: AGG_COLORS[0], method: 'cca' },
      chain: { temp: 0.25 },
      aggCreate: 'circle',       // 'box' | 'circle': how the aggregate tool places a new aggregate
      hand: 'right',             // 'right' | 'left': controls go to the side away from the writing hand
    };
    try {
      const s = JSON.parse(localStorage.getItem(CONFIG.SETTINGS_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (['pen', 'eraser', 'select', 'laser', 'chain'].includes(s.tool)) d.tool = s.tool;
        if (INK.some(c => c.v === s.color)) d.color = s.color;
        if (s.width >= 0 && s.width < WIDTHS.length) d.width = s.width | 0;
        if (['auto', 'draw', 'navigate'].includes(s.fingerMode)) d.fingerMode = s.fingerMode;
        d.penSeen = !!s.penSeen;
        if (s.agg) {
          if (s.agg.a >= 0.5 && s.agg.a <= 200) d.agg.a = +s.agg.a;
          if (s.agg.df >= 1 && s.agg.df <= 3) d.agg.df = +s.agg.df;
          d.agg.kf = (s.agg.kf > 0) ? +s.agg.kf : null;
          if (AGG_COLORS.includes(s.agg.color)) d.agg.color = s.agg.color;
          if (s.agg.method === 'pc' || s.agg.method === 'cca') d.agg.method = s.agg.method;
        }
        if (s.chain && s.chain.temp >= 0 && s.chain.temp <= 1) d.chain.temp = +s.chain.temp;
        if (s.aggCreate === 'box' || s.aggCreate === 'circle') d.aggCreate = s.aggCreate;
        if (s.hand === 'left' || s.hand === 'right') d.hand = s.hand;
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
    const s = Math.max(0.05, Math.min((W - 24) / PW, availH / PH));
    view.scale = s; view.fitScale = s;
    view.ox = (W - PW * s) / 2;
    view.oy = top + (availH - PH * s) / 2;
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
  // Render an aggregate into its own canvas. ppu = device pixels per page unit.
  function renderAggBitmap(it, ppu) {
    const n = it.n, P = it.pts, a = ptsScale(it), R = it.R;
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
    const pad = a * SPR_EXT;
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
      drawSphere(c, (xs[i] - x0) * ppu, (ys[i] - y0) * ppu, a * ppu, level, it.color);
    }
    return { canvas, ppu, ox: x0, oy: y0 };
  }
  const aggBmpCache = new WeakMap();   // pts -> { sig, entry }
  function aggSig(it) { return renderTheme + '|' + ptsScale(it) + '|' + it.color + '|' + it.R.join(','); }
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
      ctx.font = `${13 * unit}px -apple-system, sans-serif`;
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
        aniso: m.aniso, ccaFallback: !!m.ccaFallback, aGen: (m.genA && Math.abs(m.genA - it.a) > 1e-9) ? m.genA : undefined };
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
    const sig = ptsScale(it) + '|' + it.R.join(',');
    let e = viewCache.get(it.pts);
    if (e && e.sig === sig) return e;
    const n = it.n, P = it.pts, R = it.R, a = ptsScale(it);
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      xs[i] = (R[0] * x + R[1] * y + R[2] * z) * a;
      ys[i] = (R[3] * x + R[4] * y + R[5] * z) * a;
      zs[i] = (R[6] * x + R[7] * y + R[8] * z) * a;
      if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
      if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
    }
    e = { sig, xs, ys, zs, x0: x0 - a, x1: x1 + a, y0: y0 - a, y1: y1 + a };
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
      const r2 = ptsScale(it) * ptsScale(it);
      let best = -1, bz = -Infinity;
      for (let i = 0; i < it.n; i++) {
        const dx = lx - v.xs[i], dy = ly - v.ys[i];
        if (dx * dx + dy * dy <= r2 && v.zs[i] > bz) { bz = v.zs[i]; best = i; }
      }
      if (best >= 0) return { item: it, i: best, X: cx + v.xs[best], Y: cy + v.ys[best], Z: v.zs[best] };
    }
    return null;
  }

  /*
   * Lay touching spheres (radius a) along a 2D path (flat [x,y,...], page units).
   * Depth runs linearly from z0 to z1 along the path. temp (0..1) jitters each
   * placement in 3D; every sphere still touches the previous one.
   * start/end: optional existing sphere centres {X,Y,Z} to attach to.
   * obstacles: optional flat [X,Y,Z,...] of existing spheres (same radius) that new
   * spheres must not overlap; the chain also avoids itself.
   */
  function layChain(path, z0, z1, a, temp, seed, start, end, obstacles) {
    const rand = mulberry32((seed >>> 0) || 1);
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
    // Walk: each step aims at the path point one diameter further along, plus 3D noise.
    // The aim point always advances, so N stays ~ length / 2a at any temperature, and
    // the deterministic pull keeps the chain near the drawn line.
    const D = 2 * a, out = [];
    let jit = temp * a * 2.4;
    const h = L / M;
    const at = (sArc) => {
      const f = L > 0 ? Math.min(M, sArc / h) : 0, k0 = Math.floor(f), k1 = Math.min(M, k0 + 1), t = f - k0;
      return [S[k0][0] + (S[k1][0] - S[k0][0]) * t, S[k0][1] + (S[k1][1] - S[k0][1]) * t, S[k0][2] + (S[k1][2] - S[k0][2]) * t];
    };
    // Collision grid (cell = one diameter) over obstacles and placed chain spheres.
    const grid = new Map(), OFF = 1 << 20, LIM2 = (D * (1 - 1e-4)) ** 2;
    const key = (x, y, z) => ((Math.floor(x / D) + OFF) * 2097152 + (Math.floor(y / D) + OFF)) * 2097152 + (Math.floor(z / D) + OFF);
    const gridAdd = (q) => { const k = key(q[0], q[1], q[2]); const l = grid.get(k); if (l) l.push(q); else grid.set(k, [q]); };
    if (obstacles) for (let i = 0; i < obstacles.length; i += 3) gridAdd([obstacles[i], obstacles[i + 1], obstacles[i + 2]]);
    const dead = new Set();   // chain spheres removed again while closing
    // Squared distance to the nearest sphere (capped at the search range).
    const clear2 = (q) => {
      const ix = Math.floor(q[0] / D), iy = Math.floor(q[1] / D), iz = Math.floor(q[2] / D);
      let m = 4 * D * D;
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let w = -1; w <= 1; w++) {
        const l = grid.get(((ix + u + OFF) * 2097152 + (iy + v + OFF)) * 2097152 + (iz + w + OFF));
        if (!l) continue;
        for (const o of l) {
          if (dead.has(o)) continue;
          const d2 = (o[0] - q[0]) ** 2 + (o[1] - q[1]) ** 2 + (o[2] - q[2]) ** 2;
          if (d2 < m) m = d2;
        }
      }
      return m;
    };
    const free = (q) => clear2(q) >= LIM2;
    // Place a sphere touching prev in direction (dx,dy,dz); if that spot is taken,
    // try directions tilted away from it by increasing angles.
    const placeFrom = (prev, dx, dy, dz) => {
      let d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) { dx = 1; dy = 0; dz = 0; d = 1; }
      const ux = dx / d, uy = dy / d, uz = dz / d;
      const first = [prev[0] + D * ux, prev[1] + D * uy, prev[2] + D * uz];
      let best = first, bestC = clear2(first);
      if (bestC >= LIM2) return first;
      let ax = Math.abs(ux) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
      let vx = uy * 0 - uz * ay, vy = uz * ax - ux * 0, vz = ux * ay - uy * ax;
      const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
      const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
      for (let ring = 1; ring <= 12; ring++) {
        const th = ring * Math.PI / 15, ct = Math.cos(th), st = Math.sin(th);
        const phi0 = rand() * 2 * Math.PI;
        for (let k = 0; k < 8; k++) {
          const ph = phi0 + k * Math.PI / 4, cp = Math.cos(ph) * st, sp = Math.sin(ph) * st;
          const q = [prev[0] + D * (ct * ux + cp * vx + sp * wx), prev[1] + D * (ct * uy + cp * vy + sp * wy), prev[2] + D * (ct * uz + cp * vz + sp * wz)];
          const c2 = clear2(q);
          if (c2 >= LIM2) return q;
          if (c2 > bestC) { bestC = c2; best = q; }
        }
      }
      return best;   // boxed in: least overlap
    };
    // Correlated (AR(1)) noise: smooth, wave-like excursions instead of kinks.
    const nv = [0, 0, 0], RHO = 0.75;
    const stepTo = (prev, T) => {
      for (let c = 0; c < 3; c++) nv[c] = RHO * nv[c] + gaussian(rand) * jit;
      const q = placeFrom(prev, T[0] - prev[0] + nv[0], T[1] - prev[1] + nv[1], T[2] - prev[2] + nv[2]);
      gridAdd(q);
      return q;
    };
    let prev;
    if (start) prev = [start.X, start.Y, start.Z];
    else { prev = S[0].slice(); out.push(prev); gridAdd(prev); }
    let sArc = 0;
    const Eend = end ? [end.X, end.Y, end.Z] : null;
    while (sArc < L - 1e-9 && out.length < CONFIG.N_MAX) {
      if (Eend && dist3(prev, Eend) <= 2 * D) break;   // close enough: the closing step below connects
      sArc = Math.min(L, sArc + D);
      const T = at(sArc);
      if (dist3(T, prev) < D * 0.5 && sArc >= L) break;
      prev = stepTo(prev, T);
      out.push(prev);
    }
    // catch up with the end of the stroke if the walk lagged behind (straight, no noise)
    const tail = at(L);
    jit = 0; nv[0] = nv[1] = nv[2] = 0;
    for (let extra = 0; !end && extra < 50 && out.length < CONFIG.N_MAX && dist3(prev, tail) > D; extra++) {
      prev = stepTo(prev, tail);
      out.push(prev);
    }
    if (end) {
      // Close onto the end sphere E with exact contacts and no overlaps:
      // drop spheres closer than 2a to E, step straight towards E in 2a steps
      // while more than 4a away, then place one sphere touching both neighbours.
      const E = [end.X, end.Y, end.Z];
      while (out.length && dist3(out[out.length - 1], E) < D - 1e-9) dead.add(out.pop());
      let last = out.length ? out[out.length - 1] : (start ? [start.X, start.Y, start.Z] : null);
      if (last) {
        let guard = 0;
        const maxSteps = Math.ceil(dist3(last, E) / D) + 4;
        while (dist3(last, E) > 2 * D && guard++ < maxSteps) {
          last = placeFrom(last, E[0] - last[0], E[1] - last[1], E[2] - last[2]);
          gridAdd(last);
          out.push(last);
        }
        const r = dist3(last, E);
        if (r > D + 1e-9) {
          const ux = (E[0] - last[0]) / r, uy = (E[1] - last[1]) / r, uz = (E[2] - last[2]) / r;
          let px = uy, py = -ux, pz = 0;                    // perpendicular, preferably in the view plane
          let pl = Math.hypot(px, py, pz);
          if (pl < 1e-6) { px = 0; py = uz; pz = -uy; pl = Math.hypot(px, py, pz) || 1; }
          px /= pl; py /= pl; pz /= pl;
          const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;   // u x p
          const h = Math.sqrt(Math.max(0, D * D - (r / 2) * (r / 2)));
          const mx = (last[0] + E[0]) / 2, my = (last[1] + E[1]) / 2, mz = (last[2] + E[2]) / 2;
          // every point on this circle touches both last and E; prefer view-plane positions, avoid overlaps
          let pick = null, pickC = -1;
          const phi0 = rand() < 0.5 ? 0 : Math.PI;
          for (let k = 0; k < 24; k++) {
            const ph = phi0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12;
            const c = Math.cos(ph) * h, sn = Math.sin(ph) * h;
            const q = [mx + c * px + sn * qx, my + c * py + sn * qy, mz + c * pz + sn * qz];
            const c2 = clear2(q);
            if (c2 > pickC) { pickC = c2; pick = q; }
            if (c2 >= LIM2) break;
          }
          out.push(pick);
        }
      }
    }
    return out;
  }

  function rgOf(P, n) {
    if (!n) return 0;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += P[3 * i]; my += P[3 * i + 1]; mz += P[3 * i + 2]; }
    mx /= n; my /= n; mz /= n;
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += (P[3 * i] - mx) ** 2 + (P[3 * i + 1] - my) ** 2 + (P[3 * i + 2] - mz) ** 2;
    return Math.sqrt(s2 / n);
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
    if (B) {
      const vb = viewSpheres(B), bx = B.x + B.w / 2, by = B.y + B.h / 2;
      for (let i = 0; i < B.n; i++) { local(bx + vb.xs[i], by + vb.ys[i], vb.zs[i], pts, o); o += 3; }
    }
    const ni = {
      ...A, a, aGen: undefined, pts, n, edited: true, needsGen: false, dfFit: null, rg: rgOf(pts, n),
      genBox: A.genBox || (A.kind === 'chain' ? null : { w: A.w, h: A.h }),
    };
    return refitBox(ni);
  }
  function forgetGen(id) { latestToken.delete(id); pendingGen.delete(id); shownToken.delete(id); }

  function finishChain(a, isTap, p) {
    let startHit = a.startHit;
    const pathAbs = a.pts.slice();
    if (isTap && startHit) { if (handleTap(p) === 'single-agg') selectIds([startHit.item.id]); return; }
    let endHit = isTap ? null : sphereAt({ x: pathAbs[pathAbs.length - 2], y: pathAbs[pathAbs.length - 1] });
    if (startHit && endHit && startHit.item.id !== endHit.item.id && Math.abs(ptsScale(startHit.item) - ptsScale(endHit.item)) > 1e-6) {
      endHit = null;
      toast('The two aggregates have different monomer sizes: connected to the first one only.', 4000);
    }
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
      for (let i = 0; i < T.n; i++) obstacles.push(tx + v.xs[i], ty + v.ys[i], v.zs[i]);
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
    bctx.fillRect(0, 0, PW, PH);
    bctx.restore();

    bctx.save();
    bctx.beginPath(); bctx.rect(0, 0, PW, PH); bctx.clip();
    const vis = { x: -view.ox / s, y: -view.oy / s, w: W / s, h: H / s };
    const xf = action && (action.kind === 'move' || action.kind === 'scale') ? action : null;
    const erased = action && action.kind === 'erase' ? action.erased : null;
    const ppu = d * s, unit = 1 / s;
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
      else drawAgg(bctx, it, ppu, gestureActive, unit);
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
        octx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
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
      `fingerMode ${settings.fingerMode} penSeen ${settings.penSeen} coalesced ${typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype} predicted ${typeof PointerEvent !== 'undefined' && 'getPredictedEvents' in PointerEvent.prototype}`,
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
  const PALM_CONTACT = 90;   // px; contacts larger than this right after writing are treated as a palm
  const PALM_ALWAYS = 80;    // px; with a pencil in use, contacts this large are a palm at any time
  const isPalmSize = (e) => e.pointerType === 'touch' && e.width > PALM_ALWAYS && e.height > PALM_ALWAYS;

  const fingersDraw = () => settings.fingerMode === 'draw' || (settings.fingerMode === 'auto' && !settings.penSeen);
  const pressureOf = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  const screenPt = (e) => ({ x: e.clientX, y: e.clientY });

  function notePen() {
    if (settings.penSeen) return;
    settings.penSeen = true;
    saveSettings();
    if (settings.fingerMode === 'auto') toast('Pencil detected: the pencil draws, fingers pan and zoom.');
    updateChrome();
  }

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
      clearSelection();
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
      const r = handleTap(p);
      if (r === 'single-agg') selectIds([topAggAt(p).id]);
      else if (r === 'none') clearSelection();
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
      a: a.a, df: A.df, kf: A.kf, seed: a.seed, color: A.color, method: A.method, fitShape: 'circle', R: IDENTITY.slice(),
    };
  }
  function estimateN(R, a) {
    const df = settings.agg.df, kf = settings.agg.kf != null ? settings.agg.kf : window.AggEngine.kfAuto(df);
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
      Object.assign(it, { pts: pv.pts, n: pv.n, rg: pv.rg, dfFit: pv.dfFit, aniso: pv.aniso, kfUsed: pv.kf, capped: !!pv.capped, ccaFallback: !!pv.ccaFallback, needsGen: false });
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
  $('btnRedo').addEventListener('click', redo);
  $('versionLabel').textContent = 'AggBoard version ' + VERSION;
  if (CONFIG.MENU_URL) { $('btnHome').href = CONFIG.MENU_URL; $('btnHome').hidden = false; }

  function updateChrome() {
    setColorUI();
    for (const b of $('boardSeg').children) b.classList.toggle('active', b.dataset.board === themeOf(curPage()));
    const h = hist();
    $('btnUndo').disabled = !h.undo.length && !pendingDot;
    $('btnRedo').disabled = !h.redo.length;
    $('pageLabel').textContent = `${nb.current + 1} / ${nb.pages.length}`;
    $('btnPrev').disabled = nb.current === 0;
    $('btnNext').disabled = nb.current === nb.pages.length - 1;
    $('btnClearPage').disabled = !items().length;
    for (const b of $('fingerSeg').children) b.classList.toggle('active', b.dataset.mode === settings.fingerMode);
  }

  // ============================================================
  // Pages
  // ============================================================
  function goToPage(i) {
    commitPendingDot();
    action = null;
    if (nav) endNav();
    closePanel();
    selection = null;
    laserTrails = [];
    nb.current = clamp(i, 0, nb.pages.length - 1);
    ensureGenerated(curPage());
    scheduleSave();
    updateChrome();
    requestRender();
  }
  function newPage() {
    commitPendingDot();
    const pg = { id: uid(), items: [] };
    if (curPage().bg === 'dark') pg.bg = 'dark';
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
    if (nb.pages.length === 1) {
      if (!items().length) return;
      if (!confirm('This is the only page. Clear it? (You can undo this.)')) return;
      pushUndo();
      setItems([]);
      return;
    }
    if (!confirm(`Delete page ${nb.current + 1}? This cannot be undone.`)) return;
    histories.delete(curPage().id);
    nb.pages.splice(nb.current, 1);
    goToPage(Math.min(nb.current, nb.pages.length - 1));
  }
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

  let panelId = null, panelSession = false;
  // The panel is placed once next to its aggregate and then stays put while the
  // aggregate changes; it is re-placed only when the view changes, and never
  // while a pointer is down on the panel.
  let panelPlace = null, panelPointer = false;
  panel.addEventListener('pointerdown', () => { panelPointer = true; });
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => { panelPointer = false; }, true);
  const aggSize = $('aggSize'), aggDf = $('aggDf'), aggKf = $('aggKf'), aggKfAuto = $('aggKfAuto');
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
    show('aggAdvanced', mode === 'agg');
    show('rowTemp', mode === 'chain');
    show('aggRandom', mode !== 'edited');
    show('aggRegen', mode === 'edited' && it.kind !== 'chain');
    $('aggSizeLabel').textContent = mode === 'edited' ? 'Monomer size (scales)' : 'Monomer size';
    if (mode === 'chain') { $('aggTemp').value = it.temp; $('aggTempVal').textContent = it.temp.toFixed(2); }
    aggSize.value = it.a;
    $('aggSizeVal').textContent = it.a.toFixed(1);
    aggDf.value = it.df;
    $('aggDfVal').textContent = it.df.toFixed(2);
    const auto = it.kf == null;
    aggKfAuto.checked = auto;
    const kfShown = auto ? window.AggEngine.kfAuto(it.df) : it.kf;
    aggKf.value = kfShown;
    aggKf.disabled = auto;
    $('aggKfVal').textContent = kfShown.toFixed(2);
    let html;
    if (mode === 'chain') html = `N = <b>${it.n}</b> monomers &middot; hand-drawn chain`;
    else if (mode === 'edited') html = `N = <b>${it.n}</b> monomers<br><i>Contains hand-drawn chains, so it is no longer regenerated.</i>`;
    else if (!it.pts) html = 'Building…';
    else {
      html = `N = <b>${it.n}</b> monomers<br>R<sub>g</sub> = ${it.rg.toFixed(1)} a`;
      if (it.dfFit != null) html += ` &middot; fitted D<sub>f</sub> = ${it.dfFit.toFixed(2)}`;
      if (it.aniso) html += `<br>anisotropy ${it.aniso.toFixed(1)}`;
      if (it.ccaFallback) html += `<br><span class="warn">Cluster–cluster works up to D<sub>f</sub> = ${window.AggEngine.CCA_MAX_DF}; this one uses particle–cluster.</span>`;
      if (it.needsGen) html += '<br><i>updating…</i>';
      else if (it.capped) html += `<br><span class="warn">Capped at ${CONFIG.N_MAX} monomers: increase the monomer size to fill the box.</span>`;
    }
    $('aggReadout').innerHTML = html;
    for (const b of aggColorsEl.children) b.classList.toggle('active', b.dataset.color === it.color);
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
    settings.agg.a = ni.a; settings.agg.df = ni.df; settings.agg.kf = ni.kf;
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
    if (!confirm('Regenerate this aggregate? The hand-drawn chains will be removed. (You can undo this.)')) return;
    pushUndo();
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, gb = it.genBox || { w: it.w, h: it.h };
    const ni = { ...it, edited: false, x: cx - gb.w / 2, y: cy - gb.h / 2, w: gb.w, h: gb.h, needsGen: true };
    delete ni.genBox;
    replaceItem(ni);
    requestGen(ni);
  });
  aggDf.addEventListener('input', () => panelEdit({ df: +aggDf.value }));
  aggKf.addEventListener('input', () => { if (!aggKfAuto.checked) panelEdit({ kf: +aggKf.value }); });
  for (const el of [aggSize, aggDf, aggKf]) el.addEventListener('change', () => { panelSession = false; });
  aggKfAuto.addEventListener('change', () => panelEdit({ kf: aggKfAuto.checked ? null : +aggKf.value }, true));
  $('aggRandom').addEventListener('click', () => panelEdit({ seed: randSeed() }, true));
  $('aggDuplicate').addEventListener('click', () => { closePanel(); duplicateSelection(); });
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
    menu.classList.add('visible'); shield.classList.add('visible'); updateChrome();
  }
  function closeMenu() { menu.classList.remove('visible'); shield.classList.remove('visible'); }
  $('btnMenu').addEventListener('click', () => (menu.classList.contains('visible') ? closeMenu() : openMenu()));
  shield.addEventListener('pointerdown', closeMenu);
  const menuAction = (id, fn) => $(id).addEventListener('click', () => { closeMenu(); fn(); });
  menuAction('mExport', exportNotebook);
  menuAction('mImport', () => $('fileInput').click());
  menuAction('mPng', exportPagePNG);
  menuAction('mSvg', exportPageSVG);
  menuAction('mDeletePage', deletePage);
  menuAction('mClearPage', clearPage);
  menuAction('mHelp', () => $('help').classList.add('visible'));
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
  for (const b of $('fingerSeg').children) {
    b.addEventListener('click', () => {
      settings.fingerMode = b.dataset.mode;
      saveSettings();
      updateChrome();
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

  function itemToJSON(it) {
    if (it.type !== 'agg') return it;
    const out = { ...it };
    out.pts = it.pts ? Array.from(it.pts, v => Math.round(v * 1000) / 1000) : null;
    return out;
  }
  function notebookToJSON() {
    return {
      format: CONFIG.FORMAT, version: CONFIG.FORMAT_VERSION,
      id: nb.id, title: nb.title, created: nb.created, modified: nb.modified,
      page: { w: PW, h: PH }, current: nb.current,
      pages: nb.pages.map(pg => ({ id: pg.id, items: pg.items.map(itemToJSON), ...(pg.bg ? { bg: pg.bg } : {}) })),
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
    const hsl = hslOf(it.color), shadowK = THEMES[theme].shadow;
    let out = '';
    for (const i of order) {
      const level = clamp(Math.round(((v.zs[i] - zmin) / zr) * (LEVELS - 1)), 0, LEVELS - 1);
      const t = level / (LEVELS - 1), { mist, l0, l1, l2 } = shade(t);
      const key = it.color + '|' + level;
      let id = gradIds.get(key);
      if (!id) {
        id = 'g' + gradIds.size;
        gradIds.set(key, id);
        defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" fx="0.3" fy="0.3" fr="0.05">` +
          `<stop offset="0" stop-color="${stopColor(hsl, l0, mist)}"/>` +
          `<stop offset="0.55" stop-color="${stopColor(hsl, l1, mist)}"/>` +
          `<stop offset="1" stop-color="${stopColor(hsl, l2, mist)}"/></radialGradient>`);
      }
      const x = cx + v.xs[i], y = cy + v.ys[i];
      if (shadowK > 0) out += `<circle cx="${f2(x + a * 0.15)}" cy="${f2(y + a * 0.2)}" r="${f2(a * 0.95)}" fill="#000" fill-opacity="${((0.05 + 0.08 * t) * (1 - mist * 0.8) * shadowK).toFixed(3)}"/>`;
      const oc = outlineStyle(t).match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
      out += `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(a)}" fill="url(#${id})" stroke="rgb(${oc[1]},${oc[2]},${oc[3]})" stroke-opacity="${oc[4]}" stroke-width="${f2(Math.max(0.3, a * 0.06))}"/>`;
    }
    renderTheme = prev;
    return out;
  }
  function buildSVG(list, box, theme, withBackground) {
    const defs = [], gradIds = new Map();
    const body = list.map(it => (it.type === 'stroke' ? strokeSVG(it, theme) : aggSVG(it, theme, defs, gradIds))).join('\n');
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
    return { x: cx + v.x0 - 0.2 * a, y: cy + v.y0 - 0.2 * a, w: v.x1 - v.x0 + 0.5 * a, h: v.y1 - v.y0 + 0.5 * a };
  }
  function exportPageSVG() {
    commitPendingDot();
    const theme = themeOf(curPage());
    const svg = buildSVG(items(), { x: 0, y: 0, w: PW, h: PH }, theme, true);
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
    c.width = PW * k; c.height = PH * k;
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
      }
    }
    renderTheme = prevTheme;
    c.toBlob((blob) => { if (blob) shareBlob(blob, `page-${nb.current + 1}-${dateStamp()}.png`, 'image/png'); }, 'image/png');
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
      if (db) await dbPut('notebook', { ...nb, pages: nb.pages.map(pg => ({ id: pg.id, items: pg.items, ...(pg.bg ? { bg: pg.bg } : {}) })) });
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
      else if (menu.classList.contains('visible')) closeMenu();
      else if (panelId) closePanel();
      else clearSelection();
      return;
    }
    if ($('help').classList.contains('visible')) return;
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
  window.__aggboard = { buildSVG, get action() { return action; }, get nb() { return nb; }, get selection() { return selection; }, view, settings, undo, redo, goToPage, newPage, saveNow, notebookToJSON, sanitizeNotebook };

  init();
})();
