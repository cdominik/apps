/* AggBoard — notebook whiteboard with a 3D fractal aggregate tool. */
(() => {
  'use strict';

  // ============================================================
  // Configuration
  // ============================================================
  const CONFIG = {
    MENU_URL: null,            // e.g. '../index.html' to show a "back to menu" button
    PAGE_W: 1600, PAGE_H: 900, // page size in page units (16:9)
    N_MAX: 3000,               // maximum monomers per aggregate
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
  const overlay = $('overlay'), octx = overlay.getContext('2d');
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
      agg: { a: 10, df: 1.8, kf: null, color: AGG_COLORS[0] },
      chain: { temp: 0.25 },
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
        }
        if (s.chain && s.chain.temp >= 0 && s.chain.temp <= 1) d.chain.temp = +s.chain.temp;
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
    const bottom = H - $('pagebar').getBoundingClientRect().top + 10;
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
  function buildRuns(pts, base) {
    const n = pts.length / 3, runs = [];
    if (!n) return runs;
    const q = Math.max(0.25, base * 0.1);
    const wq = (p) => Math.max(q, Math.round(pressureWidth(base, p) / q) * q);
    if (n === 1) {
      const path = new Path2D();
      path.moveTo(pts[0], pts[1]); path.lineTo(pts[0] + 0.01, pts[1]);
      runs.push({ w: wq(pts[2]), path });
      return runs;
    }
    const xs = new Float64Array(n), ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) { xs[i] = pts[3 * i]; ys[i] = pts[3 * i + 1]; }
      else {
        xs[i] = 0.25 * pts[3 * i - 3] + 0.5 * pts[3 * i] + 0.25 * pts[3 * i + 3];
        ys[i] = 0.25 * pts[3 * i - 2] + 0.5 * pts[3 * i + 1] + 0.25 * pts[3 * i + 4];
      }
    }
    let cur = null, curW = -1;
    const seg = (w, x0, y0, cx, cy, x1, y1) => {
      if (w !== curW) { cur = new Path2D(); curW = w; runs.push({ w, path: cur }); cur.moveTo(x0, y0); }
      cur.quadraticCurveTo(cx, cy, x1, y1);
    };
    let mx = (xs[0] + xs[1]) / 2, my = (ys[0] + ys[1]) / 2;
    seg(wq(pts[2]), xs[0], ys[0], (xs[0] + mx) / 2, (ys[0] + my) / 2, mx, my);
    for (let i = 1; i < n - 1; i++) {
      const nx = (xs[i] + xs[i + 1]) / 2, ny = (ys[i] + ys[i + 1]) / 2;
      seg(wq(pts[3 * i + 2]), mx, my, xs[i], ys[i], nx, ny);
      mx = nx; my = ny;
    }
    seg(wq(pts[3 * n - 1]), mx, my, (mx + xs[n - 1]) / 2, (my + ys[n - 1]) / 2, xs[n - 1], ys[n - 1]);
    return runs;
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
    if (!g) { g = { runs: buildRuns(s.points, s.width), bbox: strokeBBox(s) }; strokeCache.set(s, g); }
    return g;
  }
  function drawRuns(ctx, runs, color) {
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of runs) { ctx.lineWidth = r.w; ctx.stroke(r.path); }
  }
  function drawStroke(ctx, s) { drawRuns(ctx, strokeGeom(s).runs, s.color); }

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
  const MIST_TO = { r: 255, g: 255, b: 255 };   // page background
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
    return `rgb(${mix(c.r, MIST_TO.r)},${mix(c.g, MIST_TO.g)},${mix(c.b, MIST_TO.b)})`;
  }
  function outlineStyle(t) {
    const mist = DEPTH * 0.65 * (1 - t);
    return `rgba(20,25,40,${((0.35 + 0.25 * (1 - t)) * (1 - mist)).toFixed(3)})`;
  }
  function renderSphere(c, sx, sy, r, t, color, outline) {
    const hsl = hslOf(color);
    const brightness = 0.55 + 0.45 * t;
    const mist = DEPTH * 0.65 * (1 - t);
    c.beginPath();
    c.arc(sx + r * 0.15, sy + r * 0.2, r * 0.95, 0, Math.PI * 2);
    c.fillStyle = `rgba(0,0,0,${(0.05 + 0.08 * t) * (1 - mist * 0.8)})`;
    c.fill();
    const g = c.createRadialGradient(sx - r * 0.4, sy - r * 0.4, r * 0.1, sx, sy, r);
    g.addColorStop(0, stopColor(hsl, 85 + brightness * 8, mist));
    g.addColorStop(0.55, stopColor(hsl, 55 * brightness + 20, mist));
    g.addColorStop(1, stopColor(hsl, Math.max(20, 25 * brightness + 10), mist));
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    if (outline) { c.lineWidth = Math.max(0.6, r * 0.06); c.strokeStyle = outlineStyle(t); c.stroke(); }
  }
  const spriteCache = new Map();
  function getSprite(color, level, S) {
    const key = color + '|' + level + '|' + S;
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

  // Render an aggregate into its own canvas. ppu = device pixels per page unit.
  function renderAggBitmap(it, ppu) {
    const n = it.n, P = it.pts, a = it.a, R = it.R;
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
  function aggSig(it) { return it.a + '|' + it.color + '|' + it.R.join(','); }
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
    if (it.needsGen) ctx.globalAlpha = 0.55;
    ctx.drawImage(bmp.canvas, cx + bmp.ox, cy + bmp.oy, bmp.canvas.width / bmp.ppu, bmp.canvas.height / bmp.ppu);
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // Aggregate generation (Web Worker, latest-request-wins)
  // ============================================================
  let worker = null, workerBusy = false;
  const pendingGen = new Map();   // item id -> message
  const latestToken = new Map();  // item id -> token
  let tokenSeq = 0;
  try {
    worker = new Worker('aggregate-engine.js');
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
      W: it.w / it.a, H: it.h / it.a, df: it.df, kf: it.kf, seed: it.seed, nMax: CONFIG.N_MAX,
    });
    pumpGen();
  }
  function pumpGen() {
    if (workerBusy || !pendingGen.size) return;
    const [id, msg] = pendingGen.entries().next().value;
    pendingGen.delete(id);
    workerBusy = true;
    if (worker) { worker.postMessage(msg); return; }
    setTimeout(() => {
      let data;
      try { data = { type: 'result', id: msg.id, token: msg.token, ...window.AggEngine.fitBox(msg) }; }
      catch (err) { data = { type: 'error', id: msg.id, token: msg.token, message: String(err) }; }
      onGenMessage({ data });
    }, 0);
  }
  function onGenMessage(e) {
    workerBusy = false;
    const m = e.data;
    if (m && m.type === 'result' && latestToken.get(m.id) === m.token) applyGen(m);
    else if (m && m.type === 'error') console.warn('Aggregate generation failed:', m.message);
    pumpGen();
  }
  function applyGen(m) {
    latestToken.delete(m.id);
    for (const pg of nb.pages) {
      const idx = pg.items.findIndex(it => it.id === m.id);
      if (idx < 0) continue;
      const it = pg.items[idx];
      const arr = pg.items.slice();
      // Generated coordinates are aligned with the box, so the rotation starts fresh.
      arr[idx] = { ...it, pts: m.pts, n: m.n, rg: m.rg, dfFit: m.dfFit, kfUsed: m.kf, capped: !!m.capped, needsGen: false, R: IDENTITY.slice() };
      pg.items = arr;
      nb.modified = Date.now();
      scheduleSave();
      if (pg === curPage()) { refreshPanel(); requestRender(); }
      return;
    }
  }
  function invalidateGen() { latestToken.clear(); pendingGen.clear(); }
  function ensureGenerated(pg) {
    for (const it of pg.items) {
      if (it.type === 'agg' && it.kind !== 'chain' && !it.edited && (it.needsGen || !it.pts) && !latestToken.has(it.id)) requestGen(it);
    }
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
    const sig = it.a + '|' + it.R.join(',');
    let e = viewCache.get(it.pts);
    if (e && e.sig === sig) return e;
    const n = it.n, P = it.pts, R = it.R, a = it.a;
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
      const r2 = it.a * it.a;
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
    const hx = Math.max(minW / 2, -v.x0, v.x1, it.a), hy = Math.max(minH / 2, -v.y0, v.y1, it.a);
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
      const R = it.R, a = it.a;
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
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2, R = A.R, a = A.a;
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
      ...A, pts, n, edited: true, needsGen: false, dfFit: null, rg: rgOf(pts, n),
      genBox: A.genBox || (A.kind === 'chain' ? null : { w: A.w, h: A.h }),
    };
    return refitBox(ni);
  }
  function forgetGen(id) { latestToken.delete(id); pendingGen.delete(id); }

  function finishChain(a, isTap, p) {
    let startHit = a.startHit;
    const pathAbs = a.pts.slice();
    if (isTap && startHit) { handleTap(p); return; }
    let endHit = isTap ? null : sphereAt({ x: pathAbs[pathAbs.length - 2], y: pathAbs[pathAbs.length - 1] });
    if (startHit && endHit && startHit.item.id !== endHit.item.id && Math.abs(startHit.item.a - endHit.item.a) > 1e-6) {
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
    const sph = layChain(pathAbs, z0, z1, A.a, temp, seed, startHit, endHit, obstacles);
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
  function selectIds(ids) { selection = ids.length ? new Set(ids) : null; requestOverlay(); updateChrome(); }
  function clearSelection() { if (selection) { selection = null; requestOverlay(); updateChrome(); } }
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
    bctx.fillStyle = DESK;
    bctx.fillRect(0, 0, W, H);
    bctx.setTransform(d * s, 0, 0, d * s, d * view.ox, d * view.oy);
    bctx.save();
    bctx.shadowColor = 'rgba(0,0,0,0.16)'; bctx.shadowBlur = 14; bctx.shadowOffsetY = 2;
    bctx.fillStyle = '#fff';
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
      if (action.kind === 'draw') {
        pageT();
        drawRuns(octx, buildRuns(action.pts, action.width), action.color);
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
      octx.lineWidth = 1.2; octx.strokeStyle = 'rgba(60,60,70,0.8)'; octx.stroke();
      octx.fillStyle = 'rgba(255,255,255,0.35)'; octx.fill();
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

  function onDown(e) {
    closeMenu();
    if (panelId) closePanel();
    const type = e.pointerType;
    if (type === 'pen') {
      notePen();
      if (nav) endNav();
      if (action && action.ptype === 'touch') cancelAction();
    }
    if (type === 'touch' && action && action.ptype === 'pen') return;   // palm while the pencil is down
    try { board.setPointerCapture(e.pointerId); } catch (_) {}
    const sp = screenPt(e);
    pointers.set(e.pointerId, { x: sp.x, y: sp.y, type });

    if (type === 'mouse' && e.button !== 0) { startNav([e.pointerId], false); return; }

    if (type === 'touch') {
      const touchIds = [...pointers].filter(([, q]) => q.type === 'touch').map(([id]) => id);
      if (touchIds.length >= 2) {
        if (action && action.ptype === 'touch') cancelAction();
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
        startNav(touchIds, true);
        return;
      }
    }
    startToolAction(e, sp);
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
      if (settings.tool !== 'chain' && b && inRect(p, b, 8 / view.scale)) { action = { ...base, kind: 'move', dx: 0, dy: 0 }; requestRender(); return; }
      clearSelection();
    }

    switch (settings.tool) {
      case 'pen': {
        const pr = pressureOf(e);
        action = { ...base, kind: 'draw', pts: [p.x, p.y, pr], ps: pr, color: settings.color, width: WIDTHS[settings.width] };
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
    if (nav && nav.ids.includes(e.pointerId)) { updateNav(); return; }
    if (!action || action.id !== e.pointerId) return;
    hover = sp;
    if (!action.moved && Math.hypot(sp.x - action.start.x, sp.y - action.start.y) > TAP_SLOP) action.moved = true;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const list = evs.length ? evs : [e];

    switch (action.kind) {
      case 'draw':
        for (const ev of list) addDrawPoint(ev);
        requestOverlay();
        break;
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

  function onUp(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    pointers.delete(e.pointerId);
    if (nav && nav.ids.includes(e.pointerId)) { endNavPointer(e); return; }
    if (!action || action.id !== e.pointerId) return;
    const a = action;
    action = null;
    const p = toPage(screenPt(e));
    const isTap = !a.moved && now() - a.t0 < TAP_MS;
    if (a.ptype === 'touch') hover = null;

    switch (a.kind) {
      case 'draw': finishDraw(a, isTap, p); break;
      case 'erase':
        if (a.erased.size) { pushUndo(); setItems(items().filter(it => !a.erased.has(it.id))); }
        else if (isTap) handleTap(p);
        break;
      case 'lasso':
        if (isTap || a.poly.length < 6) { if (handleTap(p) !== 'double') tapSelect(p); }
        else lassoSelect(a.poly);
        break;
      case 'laser':
        a.trail.active = false;
        break;
      case 'box': finishBox(a, isTap, p); break;
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

  function onCancel(e) {
    pointers.delete(e.pointerId);
    if (nav && nav.ids.includes(e.pointerId)) { endNavPointer(e, true); return; }
    if (action && action.id === e.pointerId) cancelAction();
  }
  function cancelAction() {
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
  function startNav(ids, tap) {
    nav = { ids: ids.slice(), last: navState(ids), travel: 0, t0: now(), tap: tap && ids.length === 1 };
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
  function onWheel(e) {
    e.preventDefault();
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
    const stroke = makeStroke(a);
    if (isTap) {
      const r = handleTap(p);
      if (r === 'double') {
        if (pendingDot) { clearTimeout(pendingDot.timer); pendingDot = null; updateChrome(); }
        return;
      }
      if (r === 'single-agg') {
        commitPendingDot();
        pendingDot = { stroke, page: curPage(), timer: setTimeout(commitPendingDot, DOUBLE_MS) };
        updateChrome();
        return;
      }
    }
    commitPendingDot();
    pushUndo();
    setItems([...items(), stroke]);
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
      if (handleTap(p) === 'none') toast('Drag a box to place an aggregate.');
      return;
    }
    const A = settings.agg;
    const it = {
      id: uid(), type: 'agg', x, y, w, h,
      a: A.a, df: A.df, kf: A.kf, seed: randSeed(), color: A.color,
      R: IDENTITY.slice(), pts: null, n: 0, rg: 0, dfFit: null, capped: false, needsGen: true,
    };
    pushUndo();
    setItems([...items(), it]);
    requestGen(it);
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
    b.className = 'wbtn'; b.title = ['Thin', 'Medium', 'Thick'][i]; b.setAttribute('aria-label', b.title + ' line');
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
  if (CONFIG.MENU_URL) { $('btnHome').href = CONFIG.MENU_URL; $('btnHome').hidden = false; }

  function updateChrome() {
    const h = hist();
    $('btnUndo').disabled = !h.undo.length && !pendingDot;
    $('btnRedo').disabled = !h.redo.length;
    $('pageLabel').textContent = `${nb.current + 1} / ${nb.pages.length}`;
    $('btnPrev').disabled = nb.current === 0;
    $('btnNext').disabled = nb.current === nb.pages.length - 1;
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
    nb.pages.splice(nb.current + 1, 0, { id: uid(), items: [] });
    goToPage(nb.current + 1);
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

  // ============================================================
  // Selection bar and aggregate panel
  // ============================================================
  const selbar = $('selbar'), panel = $('aggPanel');
  $('selAdjust').addEventListener('click', () => { const ag = singleSelectedAgg(); if (ag) openPanel(ag.id); });
  $('selDuplicate').addEventListener('click', duplicateSelection);
  $('selDelete').addEventListener('click', deleteSelection);

  let panelId = null, panelSession = false;
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
    replaceItem(ni);
    requestGen(ni);
    settings.agg.a = ni.a; settings.agg.df = ni.df; settings.agg.kf = ni.kf;
    saveSettings();
  }
  aggSize.addEventListener('input', () => panelEdit({ a: +aggSize.value }));
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
    const bottomLimit = $('pagebar').getBoundingClientRect().top - 6;
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
      const p0 = toScreen(it.x, it.y), p1 = toScreen(it.x + it.w, it.y + it.h);
      let x, y;
      if (W < 560) { x = (W - pw) / 2; y = bottomLimit - ph; }
      else {
        if (p1.x + 14 + pw <= W - 8) x = p1.x + 14;
        else if (p0.x - 14 - pw >= 8) x = p0.x - 14 - pw;
        else x = W - pw - 8;
        y = (p0.y + p1.y) / 2 - ph / 2;
      }
      panel.style.left = clamp(x, 8, Math.max(8, W - pw - 8)) + 'px';
      panel.style.top = clamp(y, topLimit, Math.max(topLimit, bottomLimit - ph)) + 'px';
    }
  }

  // ============================================================
  // Menu, help, toast
  // ============================================================
  const menu = $('menu'), shield = $('menuShield');
  function openMenu() { menu.classList.add('visible'); shield.classList.add('visible'); updateChrome(); }
  function closeMenu() { menu.classList.remove('visible'); shield.classList.remove('visible'); }
  $('btnMenu').addEventListener('click', () => (menu.classList.contains('visible') ? closeMenu() : openMenu()));
  shield.addEventListener('pointerdown', closeMenu);
  const menuAction = (id, fn) => $(id).addEventListener('click', () => { closeMenu(); fn(); });
  menuAction('mExport', exportNotebook);
  menuAction('mImport', () => $('fileInput').click());
  menuAction('mPng', exportPagePNG);
  menuAction('mDeletePage', deletePage);
  menuAction('mHelp', () => $('help').classList.add('visible'));
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
  function toast(msg, ms = 2800) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
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
      pages: nb.pages.map(pg => ({ id: pg.id, items: pg.items.map(itemToJSON) })),
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
      return { id, type: 'stroke', color: isHex(it.color) ? it.color : INK[0].v, width: it.width > 0 ? +it.width : 5, points: pts };
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

  function exportPagePNG() {
    commitPendingDot();
    const k = 2;
    const c = document.createElement('canvas');
    c.width = PW * k; c.height = PH * k;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(k, 0, 0, k, 0, 0);
    for (const it of items()) {
      if (it.type === 'stroke') drawStroke(x, it);
      else if (it.pts) {
        const bmp = renderAggBitmap(it, k);
        x.drawImage(bmp.canvas, it.x + it.w / 2 + bmp.ox, it.y + it.h / 2 + bmp.oy, bmp.canvas.width / bmp.ppu, bmp.canvas.height / bmp.ppu);
      }
    }
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
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!storageReady) return;
    try {
      if (db) await dbPut('notebook', { ...nb, pages: nb.pages.map(pg => ({ id: pg.id, items: pg.items })) });
      else localStorage.setItem('aggboard.notebook', JSON.stringify(notebookToJSON()));
    } catch (err) {
      if (!saveWarned) { saveWarned = true; toast('Could not save on this device. Use "Save notebook to file".', 5000); }
      console.warn('Save failed:', err);
    }
  }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

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
  }
  function setColorUI() { for (const b of colorsEl.children) b.classList.toggle('active', b.dataset.color === settings.color); }

  // Exposed for automated tests only.
  window.__aggboard = { get nb() { return nb; }, get selection() { return selection; }, view, settings, undo, redo, goToPage, newPage, saveNow, notebookToJSON, sanitizeNotebook };

  init();
})();
