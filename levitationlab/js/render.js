/**
 * @file render.js
 * @description
 *   Canvas setup, layout computation, and all drawing functions: lab
 *   background, drum interior, particles, aggregates, golden balls, globes,
 *   trails, vector field, heatmap overlay, and the omega-control SVG.
 *
 * Exposes globals: cv, ctxOv, W, H, DPR, CX, CY, SCALE, GEO, REGIME,
 *                  layout, draw, drawGlobes, recordTrails,
 *                  X2px, Y2px, pxDist, visualSizeFactor, angleSwept,
 *                  buildOmegaHint, resetEncounterCache, _zoomRestore
 * Reads globals:   TUNING, CFG, PAL, PAL_DARK, PAL_LIGHT,
 *                  state, heatmap, aggregateImages, globeMaps,
 *                  eggLevitatedParticles, trayEndpoints,
 *                  drawViewport, NOZZLE_COUNT, nozzleCentreX
 */
(() => {
  'use strict';

  // SECTION: CANVAS & LAYOUT
  // ============================================================
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const cvOv = document.getElementById('cvOverlay');
  const ctxOv = cvOv.getContext('2d');
  let W = 800, H = 600, DPR = 1;
  let CX = 400, CY = 300, SCALE = 2;
  let _baseCX = 400, _baseCY = 300, _baseSCALE = 2;
  let _zoomCX = 400, _zoomCY = 300, _zoomSCALE = 2;
  let _zoomT = 0; // 0=normal, 1=fully zoomed
  let _zoomDir = 0; // +1 zooming in, -1 zooming out, 0 idle
  const ZOOM_DUR = 0.5; // seconds for transition

  const GEO = {
    barTop: 0, barBot: 0, barHalfW: 0,
    footTopY: 0, footBotY: 0, footTopHalfW: 0, footBotHalfW: 0,
    wingW: 120, wingLeftW: 120, wingTop: 60, wingBot: 0, wingLeftX: 20, wingRightX: 0,
    drawFeet: true, drawSideBeams: true,
    injectBtnX: 0, injectBtnY: 0, injectBtnW: 0, injectBtnH: 0,
    leftWingTopX: 0, leftWingTopY: 0,
  };

  let REGIME = 'wide';
  /**
   * Returns the layout regime string based on window dimensions.
   *
   * @param {number} W - Window width in pixels.
   * @param {number} H - Window height in pixels.
   * @returns {string} 'wide', 'compact', or 'portrait'.
   */
  function pickRegime(W, H) {
    if (H >= W) return 'portrait';
    if (W >= 720 && H >= 540) return 'wide';
    return 'compact';
  }

  /**
   * Resizes canvases, recomputes CX/CY/SCALE, applies regime classes, calls
   * buildOmegaHint; updates all window.* primitives.
   */
  /**
   * Computes the zoomed CX/CY/SCALE so the levitation zone fills the drum area.
   */
  function _computeZoomTarget() {
    const bandW  = REGIME === 'wide' ? 32 : (REGIME === 'compact' ? 18 : 14);
    const rPx    = CFG.R_DRUM * _baseSCALE + bandW;
    const zScale = rPx / TUNING.highlight.radius;
    const zCX    = _baseCX - TUNING.highlight.cx * zScale;
    const zCY    = _baseCY + TUNING.highlight.cy * zScale;
    return { zCX, zCY, zScale };
  }
  /**
   * Restores CX/CY/SCALE to base values immediately (called on zoom off).
   */
  function _zoomRestore() {
    _zoomT   = 0;
    _zoomDir = 0;
    CX = _baseCX; CY = _baseCY; SCALE = _baseSCALE;
    window.CX = CX; window.CY = CY; window.SCALE = SCALE;
  }
  function layout() {
    DPR = Math.max(1, window.devicePixelRatio || 1);
    W = Math.max(200, window.innerWidth);
    H = Math.max(200, window.innerHeight);
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cvOv.width = W * DPR; cvOv.height = H * DPR;
    cvOv.style.width = W + 'px'; cvOv.style.height = H + 'px';
    ctxOv.setTransform(DPR, 0, 0, DPR, 0, 0);

    REGIME = pickRegime(W, H);
    document.body.classList.toggle('regime-wide',     REGIME === 'wide');
    document.body.classList.toggle('regime-compact',  REGIME === 'compact');
    document.body.classList.toggle('regime-portrait', REGIME === 'portrait');

    const instrBlock = document.getElementById('instrumentBlock');
    const wMiddle = document.getElementById('wingMiddle');
    const wRight = document.getElementById('wingRight');
    if (instrBlock && wMiddle && wRight) {
      if (REGIME === 'portrait') {
        if (instrBlock.parentElement !== wMiddle) wMiddle.appendChild(instrBlock);
        wMiddle.style.display = 'flex';
      } else {
        if (instrBlock.parentElement !== wRight) {
          const btnTheme = document.getElementById('btnTheme');
          if (btnTheme) wRight.insertBefore(instrBlock, btnTheme);
          else wRight.appendChild(instrBlock);
        }
        wMiddle.style.display = 'none';
      }
    }

    document.body.classList.remove('wing-split');   // re-applied by planLeftWingSplit
    document.body.style.removeProperty('--wing-zoom');
    placeInjectButton(false);                        // likewise
    if (REGIME === 'portrait') layoutPortrait();
    else                       layoutSideWings(REGIME);

    const startBtn = document.getElementById('btnStart');
    if (startBtn) {
      const r = startBtn.getBoundingClientRect();
      GEO.injectBtnX = r.left;
      GEO.injectBtnY = r.top;
      GEO.injectBtnW = r.width;
      GEO.injectBtnH = r.height;
    }
    GEO.leftWingTopX = GEO.wingLeftX + GEO.wingLeftW * 0.5;
    GEO.leftWingTopY = GEO.wingTop;

    buildOmegaHint();
    _baseCX = CX; _baseCY = CY; _baseSCALE = SCALE;
    const _zt = _computeZoomTarget();
    _zoomCX = _zt.zCX; _zoomCY = _zt.zCY; _zoomSCALE = _zt.zScale;
    window.W = W; window.H = H; window.DPR = DPR;
    window.CX = CX; window.CY = CY; window.SCALE = SCALE;
    window.REGIME = REGIME;

    // Refresh challenge button label in case regime changed
    if (window.setChallengeBtnLabel) window.setChallengeBtnLabel('Challenge');
  }

  /**
   * Positions drum, band, gauges, and wings for wide/compact regimes.
   *
   * @param {string} regime - Current layout regime ('wide' or 'compact').
   */
  function layoutSideWings(regime) {
    const isWide = (regime === 'wide');
    const BAND_OUTSIDE = isWide ? 32 : 18;
    const TOP_MARGIN   = isWide ? 40 : 16;
    const BOT_MARGIN   = isWide ? 30 : 16;
    const FOOT_HEIGHT  = isWide ? 70 : 14;
    const BAR_HEIGHT   = isWide ? 96 : 72;
    const WING_WIDTH   = isWide ? 120 : 100;
    const WING_GAP     = isWide ? 40 : 18;
    const ARROW_ROOM   = isWide ? 84 : 60;
    const SIDE_RESERVE = WING_WIDTH + WING_GAP + ARROW_ROOM;

    const SIDE_MARGIN  = isWide ? 20 : 12;

    const vBudget = Math.max(140, H - TOP_MARGIN - BOT_MARGIN - FOOT_HEIGHT - BAR_HEIGHT);
    const split = isWide ? planLeftWingSplit(vBudget + FOOT_HEIGHT + BAR_HEIGHT,
                                             W - 2 * SIDE_MARGIN - SIDE_RESERVE - WING_GAP - ARROW_ROOM - vBudget)
                         : null;
    const leftW = split ? split.width : WING_WIDTH;
    const leftReserve = leftW + WING_GAP + ARROW_ROOM;
    const hBudget = Math.max(140, W - 2 * SIDE_MARGIN - leftReserve - SIDE_RESERVE);
    const outerDia = Math.min(hBudget, vBudget);
    const rDrumPx = Math.max(40, outerDia * 0.5 - BAND_OUTSIDE);
    SCALE = Math.max(0.2, rDrumPx / CFG.R_DRUM);

    // Centre the drum in the space between the wings (W/2 when they are equal).
    CX = SIDE_MARGIN + leftReserve + (W - 2 * SIDE_MARGIN - leftReserve - SIDE_RESERVE) * 0.5;
    const dPx = CFG.R_DRUM * SCALE;
    CY = TOP_MARGIN + BAND_OUTSIDE + dPx;
    const bandBot = CY + dPx + BAND_OUTSIDE;
    const barTop = bandBot + FOOT_HEIGHT;
    const barBot = barTop + BAR_HEIGHT;
    const halfW = Math.min(W * 0.46,
                           CX - SIDE_MARGIN - leftW - 8,
                           W - SIDE_MARGIN - WING_WIDTH - 8 - CX,
                           Math.max(dPx * 1.3, (dPx + BAND_OUTSIDE) * 1.15));

    GEO.barTop = barTop;
    GEO.barBot = barBot;
    GEO.barHalfW = halfW;
    GEO.footTopY = bandBot - 2;
    GEO.footBotY = barTop + 2;
    GEO.footTopHalfW = (dPx + BAND_OUTSIDE) * Math.sin(28 * Math.PI / 180);
    GEO.footBotHalfW = halfW * 0.92;
    GEO.wingW = WING_WIDTH;
    GEO.wingLeftW = leftW;
    GEO.wingTop = TOP_MARGIN;
    GEO.wingBot = barBot;
    GEO.wingLeftX = SIDE_MARGIN;
    GEO.wingRightX = W - SIDE_MARGIN - WING_WIDTH;
    GEO.drawFeet = true;
    GEO.drawSideBeams = isWide;

    const g = document.getElementById('gauges');
    if (g) {
      g.style.left = (CX - halfW) + 'px';
      g.style.top = barTop + 'px';
      g.style.width = (2 * halfW) + 'px';
      g.style.height = BAR_HEIGHT + 'px';
      g.style.flexDirection = 'row';
      g.style.flexWrap = 'nowrap';
      g.style.padding = '0 12px';
    }
    const wL = document.getElementById('wingLeft');
    const wR = document.getElementById('wingRight');
    if (wL) {
      wL.style.left = GEO.wingLeftX + 'px';
      wL.style.top = GEO.wingTop + 'px';
      wL.style.width = leftW + 'px';
      wL.style.height = (GEO.wingBot - GEO.wingTop) + 'px';
      wL.style.flexDirection = split ? 'row-reverse' : 'column';   // door left, dials right
      wL.style.gap = split ? Math.round(8 * split.zoom) + 'px' : (isWide ? '8px' : '5px');
    }
    if (wR) {
      wR.style.left = GEO.wingRightX + 'px';
      wR.style.top = GEO.wingTop + 'px';
      wR.style.width = WING_WIDTH + 'px';
      wR.style.height = (GEO.wingBot - GEO.wingTop) + 'px';
      wR.style.flexDirection = 'column';
      wR.style.gap = isWide ? '6px' : '4px';
    }
  }

  const SPLIT_MIN_ZOOM = 1.3; // below this the side-by-side left wing is not worth it

  /**
   * Moves the INJECT button to the bottom of the selector column (split left
   * wing) or back to the top of the right wing.
   *
   * @param {boolean} inLeft - True for the split left wing.
   */
  function placeInjectButton(inLeft) {
    const btn = document.getElementById('btnStart');
    const colA = document.getElementById('wingLeftColA');
    const wR = document.getElementById('wingRight');
    if (!btn || !colA || !wR) return;
    if (inLeft) {
      if (btn.parentElement !== colA) colA.appendChild(btn);
    } else if (btn.parentElement !== wR) {
      wR.insertBefore(btn, wR.firstElementChild);
    }
  }

  /**
   * Decides whether the left wing's two sub-columns (expert door | selectors)
   * go side by side, zoomed so the expert buttons match the right wing's
   * square buttons (or less, if height/width run out). Applies or clears
   * body.wing-split and --wing-zoom accordingly.
   *
   * @param {number} wingH  - Wing height in pixels.
   * @param {number} availW - Horizontal space available for the left wing.
   * @returns {?{zoom: number, width: number}} Split geometry, or null for the
   *   normal single column.
   */
  function planLeftWingSplit(wingH, availW) {
    const body = document.body;
    const cols = [document.getElementById('wingLeftColA'),
                  document.getElementById('wingLeftColB')];
    if (!cols[0] || !cols[1]) return null;

    // Measure the natural (unzoomed) column sizes in split arrangement.
    body.classList.add('wing-split');
    placeInjectButton(true);
    body.style.setProperty('--wing-zoom', '1');
    cols[0].style.height = '';
    const rA = cols[0].getBoundingClientRect();
    const rB = cols[1].getBoundingClientRect();
    const natW = rA.width + rB.width + 8;          // 8px column gap, zoomed with the rest
    const natH = Math.max(rA.height, rB.height);
    const PAD_W = 16, PAD_H = 20;                  // .wing padding

    // Target: expert buttons as large as the right wing's square buttons.
    const expBtn = document.querySelector('#expertBlock .btnsq');
    const refBtn = document.querySelector('#instrumentBlock .btnsq');
    const target = (expBtn && refBtn && expBtn.offsetWidth > 0)
      ? refBtn.offsetWidth / expBtn.offsetWidth : 1.5;

    const zoom = Math.min(target, (wingH - PAD_H) / natH, (availW - PAD_W) / natW);
    if (!(natH > 0) || zoom < SPLIT_MIN_ZOOM) {
      body.classList.remove('wing-split');
      body.style.removeProperty('--wing-zoom');
      cols[0].style.height = '';
      placeInjectButton(false);
      return null;
    }
    body.style.setProperty('--wing-zoom', zoom.toFixed(3));
    // Stretch the selector column to the door's height (both share the zoom,
    // so the unzoomed height carries over); CSS spreads its items.
    cols[0].style.height = Math.max(rA.height, rB.height) + 'px';
    return { zoom, width: Math.ceil(natW * zoom + PAD_W) };
  }

  /**
   * Positions drum, gauges, and deck rows for portrait regime.
   */
  function layoutPortrait() {
    const TOP_MARGIN   = 12;
    const SIDE_MARGIN  = 8;
    const BAND_OUTSIDE = 14;
    const ARROW_ROOM   = 36;
    const GAUGE_H      = 56;
    const GAP_DRUM_GAUGES = 8;
    const GAP_GAUGES_DECK = 6;

    const ROW_PARAMS = 64;
    const ROW_INSTR  = 50;
    const ROW_ACTS   = 64;
    const ROW_GAP    = 4;
    const DECK_H = ROW_PARAMS + ROW_INSTR + ROW_ACTS + 2 * ROW_GAP;

    const hBudget = Math.max(120, W - 2 * SIDE_MARGIN - ARROW_ROOM);
    const totalAvail = Math.max(220, H - TOP_MARGIN);
    const drumVMax = totalAvail - GAUGE_H - DECK_H - GAP_DRUM_GAUGES - GAP_GAUGES_DECK - 4;

    const outerDia = Math.min(hBudget, drumVMax);
    const rDrumPx = Math.max(40, outerDia * 0.5 - BAND_OUTSIDE);
    SCALE = Math.max(0.2, rDrumPx / CFG.R_DRUM);

    const dPx = CFG.R_DRUM * SCALE;
    CX = SIDE_MARGIN + ARROW_ROOM + (W - 2 * SIDE_MARGIN - ARROW_ROOM) * 0.5;
    CY = TOP_MARGIN + BAND_OUTSIDE + dPx;

    const bandBot = CY + dPx + BAND_OUTSIDE;
    const gaugeTop = bandBot + GAP_DRUM_GAUGES;
    const gaugeBot = gaugeTop + GAUGE_H;
    const deckTop  = gaugeBot + GAP_GAUGES_DECK;

    const rowParamsTop = deckTop;
    const rowParamsBot = rowParamsTop + ROW_PARAMS;
    const rowInstrTop  = rowParamsBot + ROW_GAP;
    const rowInstrBot  = rowInstrTop + ROW_INSTR;
    const rowActsTop   = rowInstrBot + ROW_GAP;
    const rowActsBot   = rowActsTop + ROW_ACTS;

    const gaugeHalfW = (W - 2 * SIDE_MARGIN) * 0.5;

    GEO.barTop = gaugeTop;
    GEO.barBot = gaugeBot;
    GEO.barHalfW = gaugeHalfW;
    GEO.footTopY = bandBot;
    GEO.footBotY = bandBot;
    GEO.footTopHalfW = 0;
    GEO.footBotHalfW = 0;
    GEO.wingW = W - 2 * SIDE_MARGIN;
    GEO.wingLeftW = GEO.wingW;
    GEO.wingTop = deckTop;
    GEO.wingBot = rowActsBot;
    GEO.wingLeftX = SIDE_MARGIN;
    GEO.wingRightX = SIDE_MARGIN;
    GEO.drawFeet = false;
    GEO.drawSideBeams = false;

    const g = document.getElementById('gauges');
    if (g) {
      g.style.left = SIDE_MARGIN + 'px';
      g.style.top = gaugeTop + 'px';
      g.style.width = (W - 2 * SIDE_MARGIN) + 'px';
      g.style.height = GAUGE_H + 'px';
      g.style.flexDirection = 'row';
      g.style.flexWrap = 'nowrap';
      g.style.padding = '0 6px';
    }

    const wL = document.getElementById('wingLeft');
    const wM = document.getElementById('wingMiddle');
    const wR = document.getElementById('wingRight');
    if (wL) {
      wL.style.left = SIDE_MARGIN + 'px';
      wL.style.top = rowParamsTop + 'px';
      wL.style.width = (W - 2 * SIDE_MARGIN) + 'px';
      wL.style.height = ROW_PARAMS + 'px';
      wL.style.flexDirection = 'row';
      wL.style.gap = '6px';
    }
    if (wM) {
      wM.style.left = SIDE_MARGIN + 'px';
      wM.style.top = rowInstrTop + 'px';
      wM.style.width = (W - 2 * SIDE_MARGIN) + 'px';
      wM.style.height = ROW_INSTR + 'px';
      wM.style.flexDirection = 'row';
      wM.style.gap = '6px';
      wM.style.justifyContent = 'center';
      wM.style.alignItems = 'center';
    }
    if (wR) {
      wR.style.left = SIDE_MARGIN + 'px';
      wR.style.top = rowActsTop + 'px';
      wR.style.width = (W - 2 * SIDE_MARGIN) + 'px';
      wR.style.height = ROW_ACTS + 'px';
      wR.style.flexDirection = 'row';
      wR.style.gap = '6px';
    }
  }

  // ============================================================

  // SECTION: RENDER — AGGREGATES
  // ============================================================
  /**
   * Draws particles streaking toward the egg-merge target.
   */
  function drawMergeStreaks() {
    if (!state.eggMerging) return;
    const m = state.eggMerging;
    const u = Math.min(1, (state.t - m.startedAt) / m.dur);
    const ease = u * u * (3 - 2 * u);

    for (const agg of m.particles) {
      const sx = agg.mergeStart.x, sy = agg.mergeStart.y;
      const tx = m.target.x, ty = m.target.y;
      const cx = sx + (tx - sx) * ease;
      const cy = sy + (ty - sy) * ease;

      agg.x = cx; agg.y = cy;

      const ax = X2px(cx), ay = Y2px(cy);
      const scale = 1 - u;
      const ar = Math.max(0, pxDist(agg.r) * scale);

      if (ar < 0.5) continue;

      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(-agg.rot);
      ctx.globalAlpha = scale;

      const imgIdx = (typeof aggImageIndex === 'function' && agg.count)
          ? aggImageIndex(agg.count)
          : (agg.imgIdx !== undefined ? agg.imgIdx : 0);
      const img = aggregateImages[imgIdx];
      if (img && img.complete && img.naturalHeight !== 0) {
        const drawH = ar * 2;
        const drawW = drawH * (img.naturalWidth / img.naturalHeight);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.fillStyle = '#6a6a72';
        ctx.beginPath(); ctx.arc(0, 0, ar, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ============================================================
  // SECTION: RENDER — GOLDEN BALLS & PEBBLES
  // ============================================================
  /**
   * Draws all golden balls and the success text overlay.
   */
  function drawGoldenBalls() {
    for (const b of state.goldenBalls) drawOneGoldenBall(b);
    drawSuccessText();
  }

  // ============================================================
  // SECTION: RENDER — GLOBES
  // ============================================================
  /**
   * Draws all hovering globes (texture, shading, shine) and merging pebbles.
   */

  /**
   * Draws a globe body at an arbitrary canvas position and pixel radius.
   * Extracted from drawGlobes so drawSolarSystem can reuse it.
   */
  function _drawGlobeBody(g, cx, cy, rpx) {
    ctx.save();
    const halo = ctx.createRadialGradient(cx, cy, rpx*0.9, cx, cy, rpx*1.3);
    halo.addColorStop(0, 'rgba(100,200,255,0.3)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, rpx*1.3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI*2); ctx.clip();
    const tex = globeMaps[g.mapIdx];
    if (tex && tex.complete) {
      const tw = rpx*4, th = rpx*2, shift = (g.spin / (2 * Math.PI) * tw) % tw;
      ctx.drawImage(tex, cx - rpx + shift,      cy - rpx, tw, th);
      ctx.drawImage(tex, cx - rpx + shift - tw, cy - rpx, tw, th);
    } else {
      ctx.fillStyle = '#1e4a6d'; ctx.fill();
    }
    const shade = ctx.createRadialGradient(cx - rpx*0.3, cy - rpx*0.3, 0, cx, cy, rpx);
    shade.addColorStop(0,   'rgba(255,255,255,0.2)');
    shade.addColorStop(0.5, 'rgba(0,0,0,0)');
    shade.addColorStop(1,   'rgba(0,0,0,0.6)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - rpx, cy - rpx, rpx*2, rpx*2);
    ctx.restore();
    const shine = ctx.createRadialGradient(cx - rpx*0.4, cy - rpx*0.4, 0, cx - rpx*0.4, cy - rpx*0.4, rpx*0.7);
    shine.addColorStop(0, 'rgba(255,255,255,0.4)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.arc(cx - rpx*0.4, cy - rpx*0.4, rpx*0.7, 0, Math.PI*2); ctx.fill();
  }
  
  /** Draws the central star with glow at canvas position (cx, cy). */
  function _drawSolarSun(cx, cy, alpha) {
    const sizeMults = TUNING.solar.sizeMults;
    const rpx  = pxDist(TUNING.solar.sunR);
    const glow = ctx.createRadialGradient(cx, cy, rpx*0.5, cx, cy, rpx*4);
    glow.addColorStop(0,   `rgba(255,60,20,${alpha*0.7})`);
    glow.addColorStop(0.4, `rgba(200,30,10,${alpha*0.3})`);
    glow.addColorStop(1,   'rgba(160,20,5,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, rpx*4, 0, Math.PI*2); ctx.fill();
    const body = ctx.createRadialGradient(cx - rpx*0.3, cy - rpx*0.3, 0, cx, cy, rpx);
    body.addColorStop(0,   `rgba(255,200,160,${alpha})`);
    body.addColorStop(0.5, `rgba(255,100,40,${alpha})`);
    body.addColorStop(1,   `rgba(200,40,10,${alpha*0.8})`);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI*2); ctx.fill();
  }
  
  /**
   * Draws the full solar-system view: orbit ellipses, sun, and all planets
   * sorted back-to-front with inclination perspective scaling.
   */
  function drawSolarSystem() {
    const s   = state.solar;
    const SS  = TUNING.solar;
    const cx  = X2px(s.centerX);
    const cy  = Y2px(s.centerY);
    const elapsed = s.wallT - s.phaseStart;
    const sizeMults = TUNING.solar.sizeMults;   // ← ADD THIS LINE
  
    // Orbit ellipses (semi-minor = semi-major * cos(60°) = * 0.5)
    ctx.save();
    for (const orb of s.orbits) {
      const rx = pxDist(orb.r * s.scale);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, rx * SS.inclCos, 0, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(180,210,255,${s.sunAlpha * 0.35})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  
    // Build render list with depth-based perspective
    const list = [];
    for (let i = 0; i < state.globes.length; i++) {
      const g   = state.globes[i];
      const orb = s.orbits[i]; // may be undefined for globe 0 during first showing
      let baseR;
      if (i === s.pendingIdx && s.phase === 'showing') {
        baseR = TUNING.globe.radius; // full size while on display
      } else if (orb && !orb.inOrbit && s.phase === 'transitioning') {
        const u = Math.min(1, elapsed / SS.transDur);
        baseR = TUNING.globe.radius + (SS.orbitSize - TUNING.globe.radius) * u*u*(3-2*u);
      } else if (orb && orb.inOrbit) {
        baseR = SS.orbitSize;
      } else {
        baseR = TUNING.globe.radius; // not yet tracked, keep full size
      }
      baseR *= (sizeMults[i] ?? 1);
      // Perspective: depth = sin(theta), positive = closer to observer
      const depth = orb ? -Math.sin(orb.theta) : 0;
      list.push({ g, rpx: pxDist(baseR * (1 + SS.persp * depth)), depth });
    }
    list.sort((a, b) => a.depth - b.depth); // back-to-front
  
    // Draw back-half planets, then sun at depth 0, then front-half planets
    // Separate the pending (full-size) globe so it always draws on top
    const pending = s.phase === 'showing'
      ? list.find(item => item.g === state.globes[s.pendingIdx])
      : null;
    const rest = pending ? list.filter(item => item !== pending) : list;
  
    let sunDrawn = false;
    for (const item of rest) {
      if (!sunDrawn && item.depth >= 0) {
        if (s.sunAlpha > 0.01) _drawSolarSun(cx, cy, s.sunAlpha);
        sunDrawn = true;
      }
      _drawGlobeBody(item.g, X2px(item.g.x), Y2px(item.g.y), item.rpx);
    }
    if (!sunDrawn && s.sunAlpha > 0.01) _drawSolarSun(cx, cy, s.sunAlpha);
  
    // Pending globe always on top
    if (pending) {
      _drawGlobeBody(pending.g, X2px(pending.g.x), Y2px(pending.g.y), pending.rpx);
    }
  
    // Pebbles currently merging into a new globe
    if (state.globeMerging) {
      for (const b of state.globeMerging.pebbles) drawOneGoldenBall(b);
    }

    // ── VOYAGER PROBES ──────────────────────────────────────────────────────
    const probes = state.solar.probes;
    if (probes && probes.length) {
      for (const probe of probes) {
        if (probe.delay > 0) continue;
        if (probe.trail.length > 1) {
          ctx.save();
          ctx.lineWidth = 1.8;
          for (let i = 1; i < probe.trail.length; i++) {
            const alpha = (i / probe.trail.length) * 0.9;
            ctx.strokeStyle = `rgba(180, 230, 255, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(X2px(probe.trail[i-1].x), Y2px(probe.trail[i-1].y));
            ctx.lineTo(X2px(probe.trail[i].x),   Y2px(probe.trail[i].y));
            ctx.stroke();
          }
          ctx.restore();
        }
        const px = X2px(probe.x), py = Y2px(probe.y);
        ctx.save();
        ctx.shadowColor = 'rgba(160, 220, 255, 1.0)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 4.0, 0, Math.PI * 2);
        ctx.fill();
        // inner bright core
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#c8eeff';
        ctx.beginPath();
        ctx.arc(px, py, 2.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }


  function drawGlobes() {
    if (state.solar.phase !== 'none') { drawSolarSystem(); return; }
    // 1. Draw existing planets
    for (const g of state.globes) {
      const cx = X2px(g.x), cy = Y2px(g.y);
      const rpx = pxDist(g.r);
      _drawGlobeBody(g, cx, cy, rpx);
    }
    
    // 2. Draw the merging pebbles during the "soft motion" phase
    if (state.globeMerging) {
      const m = state.globeMerging;
      const u = Math.min(1, (state.t - m.startedAt) / m.dur);
      
      // Drawing the pebbles as they drift toward the meeting point
      for (const b of m.pebbles) {
        // Re-use the existing golden ball renderer while they are in motion
        drawOneGoldenBall(b);
      }
    }
  }

  /**
   * Draws a single golden ball with aura, flash, body gradient, and spin shine.
   *
   * @param {Object} b - Golden ball state object (x, y, r, spin, bornAt).
   */
  function drawOneGoldenBall(b) {
    const cx = X2px(b.x), cy = Y2px(b.y);
    const rpx = pxDist(b.r);
    const age = state.t - b.bornAt;

    const pulse = 0.85 + 0.15 * Math.sin(state.t * 4);
    const auraR = rpx * (3.5 + 0.2 * Math.sin(state.t * 2));
    const aura = ctx.createRadialGradient(cx, cy, rpx * 0.9, cx, cy, auraR);
    aura.addColorStop(0.0, `rgba(255, 220, 130, ${0.55 * pulse})`);
    aura.addColorStop(0.4, `rgba(255, 190, 80, ${0.30 * pulse})`);
    aura.addColorStop(1.0, 'rgba(255, 170, 40, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(cx, cy, auraR, 0, Math.PI * 2); ctx.fill();

    if (age < 0.25) {
      const f = 1 - age / 0.25;
      const flashR = rpx * (2.0 + 6 * (1 - f));
      const fl = ctx.createRadialGradient(cx, cy, 0, cx, cy, flashR);
      fl.addColorStop(0.0, `rgba(255, 255, 240, ${0.9 * f})`);
      fl.addColorStop(0.4, `rgba(255, 230, 150, ${0.5 * f})`);
      fl.addColorStop(1.0, 'rgba(255, 200, 80, 0)');
      ctx.fillStyle = fl;
      ctx.beginPath(); ctx.arc(cx, cy, flashR, 0, Math.PI * 2); ctx.fill();
    }

    const hlx = cx - rpx * 0.35, hly = cy - rpx * 0.4;
    const body = ctx.createRadialGradient(hlx, hly, 0, cx, cy, rpx);
    body.addColorStop(0.00, '#fff8d8');
    body.addColorStop(0.18, '#ffe48a');
    body.addColorStop(0.50, '#e0a830');
    body.addColorStop(0.85, '#8a5a14');
    body.addColorStop(1.00, '#3a2008');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI * 2); ctx.fill();

    const rim = ctx.createRadialGradient(cx + rpx * 0.3, cy + rpx * 0.4, rpx * 0.6, cx, cy, rpx * 1.05);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(0.7, 'rgba(60, 30, 5, 0)');
    rim.addColorStop(1.0, 'rgba(40, 20, 5, 0.55)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI * 2); ctx.clip();
    const spec = ctx.createRadialGradient(cx - rpx * 0.4, cy - rpx * 0.5, 0, cx - rpx * 0.4, cy - rpx * 0.5, rpx * 0.7);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    spec.addColorStop(0.4, 'rgba(255, 250, 220, 0.4)');
    spec.addColorStop(1.0, 'rgba(255, 240, 180, 0)');
    ctx.fillStyle = spec;
    ctx.beginPath(); ctx.arc(cx - rpx * 0.4, cy - rpx * 0.5, rpx * 0.7, 0, Math.PI * 2); ctx.fill();

    const sparkles = [
      { ang: 0.3, rad: 0.55, sz: 0.10 },
      { ang: 1.7, rad: 0.42, sz: 0.08 },
      { ang: 3.4, rad: 0.65, sz: 0.06 },
      { ang: 5.1, rad: 0.50, sz: 0.07 },
    ];
    for (const s of sparkles) {
      const a = s.ang + b.spin;
      const sx = cx + Math.cos(a) * rpx * s.rad;
      const sy = cy + Math.sin(a) * rpx * s.rad;
      const sr = rpx * s.sz;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.5);
      sg.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      sg.addColorStop(0.4, 'rgba(255, 250, 200, 0.6)');
      sg.addColorStop(1.0, 'rgba(255, 240, 180, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sx, sy, sr * 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(40, 20, 5, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI * 2); ctx.stroke();
  }

  /**
   * Draws all live aggregates with optional orbit flash ring.
   * Respects Lidar visibility logic: hidden unless hit by the laser sweep.
   */
  function drawAggregates() {
    if (state.aggMerging) {
      const m = state.aggMerging;
      const u = Math.min(1, (state.t - m.startedAt) / m.dur);
      const ease = u * u * (3 - 2 * u);
      for (const p of m.particles) {
        const sx = p.mergeStart.x, sy = p.mergeStart.y;
        const cx = sx + (m.target.x - sx) * ease;
        const cy = sy + (m.target.y - sy) * ease;
        p.x = cx; p.y = cy;
        ctx.strokeStyle = `rgba(180, 220, 255, ${1 - u})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X2px(sx), Y2px(sy)); ctx.lineTo(X2px(cx), Y2px(cy)); ctx.stroke();
      }
    }
  
    const rInnerPx = pxDist(CFG.R_DRUM) + 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, rInnerPx, 0, Math.PI * 2); ctx.clip();
  
    // Draw the smaller aggregate animating toward the larger during a growth merge.
    if (state.aggGrowMerging) {
      const m = state.aggGrowMerging;
      const u = Math.min(1, (state.t - m.startedAt) / m.dur);
      const s = m.smaller;
      const ax = X2px(s.x), ay = Y2px(s.y);
      const ar = Math.max(0, pxDist(s.r) * (1 - u));
      if (ar > 0.5) {
        const imgIdx = typeof aggImageIndex === 'function'
          ? aggImageIndex(s.count) : 0;
        const img = aggregateImages[imgIdx];
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(-s.rot);
        ctx.globalAlpha = 1 - u;
        if (img && img.complete && img.naturalHeight !== 0) {
          const drawH = ar * 2;
          const drawW = drawH * (img.naturalWidth / img.naturalHeight);
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        } else {
          ctx.fillStyle = '#6a6a72';
          ctx.beginPath(); ctx.arc(0, 0, ar, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    for (const agg of state.aggregates) {
      if (agg.merging) continue;
  
      // --- LIDAR VISIBILITY LOGIC ---
      const lidar = state.laserOn;
      const FLASH_DUR = 0.40 * (lidar ? TUNING.lidar.flashDurMul : 1);
      let flash = 0;
  
      // Calculate current brightness based on time since the laser hit (from physics.js)
      if (state.t < agg.flashEndsAt) {
        flash = (agg.flashEndsAt - state.t) / FLASH_DUR;
        if (flash > 1) flash = 1; if (flash < 0) flash = 0;
      }
  
      if (lidar) {
        // Hide if not hit by laser and not stuck to the wall
        if (!agg.stuck && flash <= 0) continue; 
        // Dim stuck aggregates for a low-opacity "background radar" look
        if (agg.stuck) ctx.globalAlpha = TUNING.lidar.stuckAlpha;
      }
  
      const ax = X2px(agg.x), ay = Y2px(agg.y);
      const ar = pxDist(agg.r);
      
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(-agg.rot);
  
      // Apply flash brightening if in Lidar mode
      if (lidar && flash > 0) {
        ctx.shadowBlur = 15 * flash;
        ctx.shadowColor = 'rgba(60, 255, 120, 0.8)';
      }

      // --- BOUNCE FLASH VISUALIZER ---
      if (agg.bounceFlashEndsAt && state.t < agg.bounceFlashEndsAt) {
        const bounceAlpha = (agg.bounceFlashEndsAt - state.t) / 0.6;
        ctx.shadowBlur = 20 * bounceAlpha;
        ctx.shadowColor = `rgba(255, 60, 60, ${bounceAlpha})`;
        ctx.strokeStyle = `rgba(255, 60, 60, ${bounceAlpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, ar + 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
  
      const imgIdx = (typeof aggImageIndex === 'function' && agg.count)
          ? aggImageIndex(agg.count)
          : (agg.imgIdx !== undefined ? agg.imgIdx : 0);
      const img = aggregateImages[imgIdx];
      if (img && img.complete && img.naturalHeight !== 0) {
        const drawH = ar * 2;
        const drawW = drawH * (img.naturalWidth / img.naturalHeight);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.fillStyle = '#6a6a72';
        ctx.beginPath(); ctx.arc(0, 0, ar, 0, Math.PI * 2); ctx.fill();
      }
      
      ctx.restore();
  
      // Reset global alpha in case it was modified for stuck aggregates
      if (lidar) ctx.globalAlpha = 1.0;
    }
    ctx.restore();
  }

  /**
   * Draws the "Pebble formed!" flash text when a new golden ball appears.
   */
  function drawSuccessText() {
    for (const b of state.goldenBalls) {
      if (!b.showBanner) continue;
      const age = state.t - b.bornAt;
      if (age < 1 || age > 3) continue;
      const u = (age - 1) / 2;
      let alpha;
      if (u < 0.075)      alpha = u / 0.075;
      else if (u > 0.925) alpha = (1 - u) / 0.075;
      else                alpha = 1;
      if (alpha <= 0) continue;

      const cxScreen = X2px(0);
      const cyScreen = Y2px(50);
      const big = Math.max(14, pxDist(16));
      const small = Math.max(10, pxDist(9));

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = alpha;

      ctx.font = 'bold ' + big + 'px "Courier New", monospace';
      ctx.shadowColor = 'rgba(255, 200, 80, 0.9)';
      ctx.shadowBlur = big * 0.6;
      ctx.fillStyle = '#fff2c0';
      ctx.fillText('Success!', cxScreen, cyScreen - big * 0.55);

      ctx.font = 'bold ' + small + 'px "Courier New", monospace';
      ctx.shadowColor = 'rgba(255, 180, 60, 0.7)';
      ctx.shadowBlur = small * 0.5;
      ctx.fillStyle = '#ffcc55';
      ctx.fillText('Pebble formed!', cxScreen, cyScreen + small * 0.7);

      ctx.restore();
    }
  }

  // ============================================================
  // SECTION: RENDER — HELPERS
  // ============================================================
  /**
   * Returns true if angle t falls within the arc swept from a0 to a1.
   *
   * @param {number} a0 - Start angle in radians.
   * @param {number} a1 - End angle in radians.
   * @param {number} t - Test angle in radians.
   * @returns {boolean} True if t is within the swept arc.
   */
  function angleSwept(a0, a1, t) {
    let d = a1 - a0;
    if (d === 0) return false;
    if (Math.abs(d) >= 2 * Math.PI) return true;
    const TAU = 2 * Math.PI;
    const norm = (x) => { let r = x % TAU; if (r > Math.PI) r -= TAU; if (r <= -Math.PI) r += TAU; return r; };
    const dN = norm(d);
    const tN = norm(t - a0);
    if (dN > 0) return tN >= 0 && tN <= dN;
    else        return tN <= 0 && tN >= dN;
  }

  /**
   * Converts a drum x-coordinate to canvas pixels.
   *
   * @param {number} x - Drum x-coordinate in cm.
   * @returns {number} Canvas x in pixels.
   */
  function X2px(x) { return CX + x * SCALE; }
  /**
   * Converts a drum y-coordinate to canvas pixels.
   *
   * @param {number} y - Drum y-coordinate in cm.
   * @returns {number} Canvas y in pixels.
   */
  function Y2px(y) { return CY - y * SCALE; }
  /**
   * Converts a drum-unit distance to canvas pixels.
   *
   * @param {number} cm - Distance in drum units (cm).
   * @returns {number} Distance in canvas pixels.
   */
  function pxDist(cm) { return cm * SCALE; }

  /**
   * Computes a size multiplier for a particle based on its terminal velocity.
   *
   * @param {number} vt - Particle terminal velocity in cm/s.
   * @returns {number} Size multiplier clamped to [sizeMin, sizeMax].
   */
  function visualSizeFactor(vt) {
    let s = Math.sqrt(Math.max(0.01, vt) / TUNING.particle.sizeRefVt);
    if (s < TUNING.particle.sizeMin) s = TUNING.particle.sizeMin;
    if (s > TUNING.particle.sizeMax) s = TUNING.particle.sizeMax;
    const n = state.renderN || CFG.N_P;
    if      (n >= 10000) s *= 0.10;
    else if (n >= 3000)  s *= 0.20;
    else if (n >= 1000)  s *= 0.50;
    else if (n >= 300)   s *= 0.70;
    return s;
  }

  /**
   * Draws a single rivet circle at canvas position (x, y) with radius r.
   *
   * @param {number} x - Canvas x position in pixels.
   * @param {number} y - Canvas y position in pixels.
   * @param {number} r - Rivet radius in pixels.
   */
  function rivet(x, y, r) {
    const rr = Math.max(0.5, r);
    const g = ctx.createRadialGradient(x - rr * 0.4, y - rr * 0.4, 0, x, y, rr);
    g.addColorStop(0, '#9a9aa2');
    g.addColorStop(0.6, '#3a3a44');
    g.addColorStop(1, '#101014');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }

  // ============================================================
  // SECTION: RENDER — BACKGROUND & STRUCTURE
  // ============================================================
  /**
   * Draws one side wing panel with gradient and border.
   *
   * @param {number} x - Left edge of the wing in pixels.
   * @param {number} y - Top edge of the wing in pixels.
   * @param {number} w - Wing width in pixels.
   * @param {number} h - Wing height in pixels.
   */
  function drawWing(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    for (const [pos, col] of PAL.wingStops) g.addColorStop(pos, col);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PAL.wingTopLine;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + w, y + 0.5); ctx.stroke();
    ctx.strokeStyle = PAL.wingBotLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y + h - 0.5); ctx.lineTo(x + w, y + h - 0.5); ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    for (let yy = y + 2; yy < y + h - 2; yy += 2) { ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + w - 2, yy); ctx.stroke(); }
    ctx.restore();
    rivet(x + 8, y + 10, 3);
    rivet(x + w - 8, y + 10, 3);
    rivet(x + 8, y + h - 10, 3);
    rivet(x + w - 8, y + h - 10, 3);
    const midCount = Math.max(1, Math.floor((h - 40) / 70));
    for (let i = 1; i <= midCount; i++) {
      const yy = y + 10 + i * ((h - 20) / (midCount + 1));
      rivet(x + 8, yy, 3);
      rivet(x + w - 8, yy, 3);
    }
  }

  // ============================================================
  // SECTION: RENDER — INJECTOR EXTRUSION
  // ============================================================
  // The injector is a triangular extrusion on the rim of the drum: the
  // nozzle bar forms its top, a straight outer wall drops to the rim, and
  // the drum circle closes it. It is bolted to the drum and rotates with
  // it. The front is a window outside the steel band, so the nozzles and
  // the falling particles stay visible; the band itself stays complete and
  // particles pass behind it into the drum. The whole assembly sits behind
  // the band and the display bar, in front of the red support. All drawing here happens in the drum frame: the context
  // is translated to the drum centre and rotated by the drum angle, and
  // drum-frame cm map to local pixels as (x * SCALE, -y * SCALE).

  const EXT_WALL_CM = 4;     // side wall thickness
  const EXT_BAR_CM  = 6;     // nozzle bar (top wall) height

  /** Enters the drum frame (pair with ctx.restore()). */
  function enterDrumFrame(c) {
    c.save();
    c.translate(CX, CY);
    c.rotate(-state.drumAngle);
  }

  /** Outer silhouette of the extrusion: walls meet the outside of the band. */
  function extrusionOuterGeom() {
    const rOut = CFG.R_DRUM + bandOutside() / SCALE;
    const xa = CFG.EXT_X_MIN - EXT_WALL_CM;
    const xb = CFG.EXT_X_MAX + EXT_WALL_CM;
    const ya = Math.sqrt(Math.max(1, rOut * rOut - xa * xa));
    const yb = Math.sqrt(Math.max(1, rOut * rOut - xb * xb));
    return { rOut, xa, xb, ya, yb };
  }

  /**
   * Adds a closed path to the current (drum-frame) context: the region with
   * x in [x0, x1], below yTop, outside the circle of radius r (cm).
   */
  function extrusionPath(x0, x1, yTop, r) {
    const S = SCALE;
    const y0 = Math.sqrt(Math.max(1, r * r - x0 * x0));
    const y1 = Math.sqrt(Math.max(1, r * r - x1 * x1));
    ctx.beginPath();
    ctx.moveTo(x0 * S, -y0 * S);
    ctx.lineTo(x0 * S, -yTop * S);
    ctx.lineTo(x1 * S, -yTop * S);
    ctx.lineTo(x1 * S, -y1 * S);
    ctx.arc(0, 0, r * S, Math.atan2(-y1, x1), Math.atan2(-y0, x0), true);
    ctx.closePath();
  }

  /** Window path of the extrusion (outside the steel band), in the drum frame. */
  function extrusionInteriorPath() {
    extrusionPath(CFG.EXT_X_MIN, CFG.EXT_X_MAX, CFG.EXT_Y_TOP, extrusionOuterGeom().rOut);
  }

  /** Open path along the three window walls (not the side against the band). */
  function extrusionFramePath() {
    const S = SCALE, R = extrusionOuterGeom().rOut;
    const x0 = CFG.EXT_X_MIN, x1 = CFG.EXT_X_MAX, yT = CFG.EXT_Y_TOP;
    ctx.beginPath();
    ctx.moveTo(x0 * S, -Math.sqrt(R * R - x0 * x0) * S);
    ctx.lineTo(x0 * S, -yT * S);
    ctx.lineTo(x1 * S, -yT * S);
    ctx.lineTo(x1 * S, -Math.sqrt(R * R - x1 * x1) * S);
  }

  /**
   * Draws the extrusion body: walls, the dark interior seen through the
   * window, the nozzle bar on top and the nozzles.
   */
  function drawInjector() {
    const S = SCALE;
    const isModern   = document.body.classList.contains('theme-modern');
    const isPfeiffer = isPfeifferTheme();
    const isLight    = PAL.name === 'light';
    const g = extrusionOuterGeom();
    const lx = x => x * S, ly = y => -y * S;

    enterDrumFrame(ctx);

    // --- 1. WALLS — same material as the steel band: each wall gets the
    // band's inner-to-outer gradient across its thickness. ---
    const bandStops = isPfeiffer
      ? [[0.00, '#4e5358'], [0.08, '#b9bec3'], [0.40, '#e2e5e8'], [0.72, '#c3c8cc'], [0.86, '#e9ecee'], [1.00, '#73787d']]
      : [[0, PAL.bandInner], [0.4, PAL.bandMid1], [0.7, PAL.bandMid2], [1, PAL.bandOuter]];
    const yWallTop = ly(CFG.EXT_Y_TOP + EXT_BAR_CM);
    ctx.save();
    extrusionPath(g.xa, g.xb, CFG.EXT_Y_TOP, g.rOut);
    ctx.clip();
    for (const [xIn, xOut] of [[CFG.EXT_X_MIN, g.xa], [CFG.EXT_X_MAX, g.xb]]) {
      const wg = ctx.createLinearGradient(lx(xIn), 0, lx(xOut), 0);
      for (const [pos, col] of bandStops) wg.addColorStop(pos, col);
      ctx.fillStyle = wg;
      ctx.fillRect(Math.min(lx(xIn), lx(xOut)), yWallTop, Math.abs(lx(xOut) - lx(xIn)), -yWallTop);
    }
    ctx.restore();
    extrusionPath(g.xa, g.xb, CFG.EXT_Y_TOP, g.rOut);
    ctx.strokeStyle = isLight ? 'rgba(20,20,30,0.45)' : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.2; ctx.stroke();

    // --- 2. INTERIOR, seen through the front window ---
    const dim = state.laserOn ? TUNING.lidar.backplateDim : 1;
    extrusionInteriorPath();
    const ig = ctx.createLinearGradient(0, ly(CFG.EXT_Y_TOP), 0, ly(0));
    ig.addColorStop(0, mixHex(PAL.backplateOuter, '#000000', 1 - dim));
    ig.addColorStop(1, mixHex(PAL.backplateMid,   '#000000', 1 - dim));
    ctx.fillStyle = ig; ctx.fill();

    // Window frame screws along both side walls
    const screwR = Math.max(1.4, pxDist(0.8));
    for (const [x, yLo] of [[CFG.EXT_X_MIN - EXT_WALL_CM / 2, g.ya], [CFG.EXT_X_MAX + EXT_WALL_CM / 2, g.yb]]) {
      const n = Math.max(1, Math.round((CFG.EXT_Y_TOP - yLo) / 22));
      for (let i = 0; i < n; i++) {
        const y = yLo + (i + 0.5) * (CFG.EXT_Y_TOP - yLo) / n;
        if (isPfeiffer) pfBolt(lx(x), ly(y), screwR); else rivet(lx(x), ly(y), screwR);
      }
    }

    // --- 3. NOZZLE BAR (top wall) ---
    const x0 = lx(g.xa), x1 = lx(g.xb);
    const yTop = ly(CFG.EXT_Y_TOP + EXT_BAR_CM), yBot = ly(CFG.EXT_Y_TOP);
    const barH = yBot - yTop;
    const capW = Math.max(6, pxDist(4));

    ctx.fillStyle = isModern ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(lx(CFG.EXT_X_MIN), yBot, lx(CFG.EXT_X_MAX) - lx(CFG.EXT_X_MIN), 4);

    const gBody = ctx.createLinearGradient(0, yTop, 0, yBot);
    if (isModern) {
      gBody.addColorStop(0.00, '#ffffff'); gBody.addColorStop(0.10, '#f8f9fa'); gBody.addColorStop(0.30, '#e8ecef');
      gBody.addColorStop(0.65, '#cfd4d9'); gBody.addColorStop(0.90, '#adb5bd'); gBody.addColorStop(1.00, '#495057');
    } else if (isPfeiffer) {
      gBody.addColorStop(0.00, '#ff9999'); gBody.addColorStop(0.10, '#ff4d4d'); gBody.addColorStop(0.30, '#d5001c');
      gBody.addColorStop(0.65, '#aa0016'); gBody.addColorStop(0.90, '#800011'); gBody.addColorStop(1.00, '#4d000a');
    } else {
      gBody.addColorStop(0.00, '#f0d088'); gBody.addColorStop(0.10, '#e8c77a'); gBody.addColorStop(0.30, '#d9b76a');
      gBody.addColorStop(0.65, '#8a6b2e'); gBody.addColorStop(0.90, '#5a4418'); gBody.addColorStop(1.00, '#2a1a06');
    }
    ctx.fillStyle = gBody; ctx.fillRect(x0, yTop, x1 - x0, barH);

    ctx.strokeStyle = isModern ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255,245,200,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, yTop + 0.6); ctx.lineTo(x1, yTop + 0.6); ctx.stroke();
    ctx.strokeStyle = isModern ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.7)';
    ctx.beginPath(); ctx.moveTo(x0, yBot - 0.6); ctx.lineTo(x1, yBot - 0.6); ctx.stroke();

    const capA = ctx.createLinearGradient(x0, 0, x0 + capW, 0);
    capA.addColorStop(0, isModern ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.55)'); capA.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = capA; ctx.fillRect(x0, yTop, capW, barH);
    const capB = ctx.createLinearGradient(x1 - capW, 0, x1, 0);
    capB.addColorStop(0, 'rgba(0,0,0,0)'); capB.addColorStop(1, isModern ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.55)');
    ctx.fillStyle = capB; ctx.fillRect(x1 - capW, yTop, capW, barH);

    const endBoltR = Math.max(2.2, barH * 0.16);
    rivet(x0 + capW * 0.5, yTop + barH * 0.5, endBoltR);
    rivet(x1 - capW * 0.5, yTop + barH * 0.5, endBoltR);

    // Cooling ribs
    const ribCount = 5;
    const ribW = Math.max(3, pxDist(2));
    for (let i = 0; i < ribCount; i++) {
      const cx = x0 + capW + (i + 1) * (x1 - x0 - 2 * capW) / (ribCount + 1);
      const ribX = cx - ribW / 2;
      const rg = ctx.createLinearGradient(ribX, 0, ribX + ribW, 0);
      if (isModern) {
        rg.addColorStop(0.00, 'rgba(0,0,0,0.25)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.3)'); rg.addColorStop(1.00, 'rgba(0,0,0,0.25)');
      } else {
        rg.addColorStop(0.00, 'rgba(0,0,0,0.45)'); rg.addColorStop(0.45, 'rgba(255,235,170,0.30)'); rg.addColorStop(1.00, 'rgba(0,0,0,0.45)');
      }
      ctx.fillStyle = rg; ctx.fillRect(ribX, yTop + 2, ribW, barH - 4);
      const ribBoltR = Math.max(1.6, barH * 0.10);
      rivet(cx, yTop + barH * 0.22, ribBoltR);
      rivet(cx, yTop + barH * 0.78, ribBoltR);
    }

    // --- 4. NOZZLES (hang into the window; tips at RELEASE_Y) ---
    const nozzleH = pxDist(CFG.EXT_Y_TOP - CFG.RELEASE_Y);
    const nozzleHalfW = Math.max(3, pxDist(2.6));
    const collarH = Math.max(2, pxDist(1.0));
    const collarHalfW = nozzleHalfW * 1.15;

    for (let i = 0; i < NOZZLE_COUNT; i++) {
      const cx = lx(nozzleCentreX(i));

      // Collar
      const colG = ctx.createLinearGradient(0, yBot - collarH, 0, yBot + collarH);
      if (isModern) {
        colG.addColorStop(0, '#e8ecef'); colG.addColorStop(0.5, '#adb5bd'); colG.addColorStop(1, '#6c757d');
      } else {
        colG.addColorStop(0, '#e8c77a'); colG.addColorStop(0.5, '#a07a30'); colG.addColorStop(1, '#5a4418');
      }
      ctx.fillStyle = colG; ctx.fillRect(cx - collarHalfW, yBot - collarH * 0.4, collarHalfW * 2, collarH);
      ctx.strokeStyle = isModern ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1; ctx.strokeRect(cx - collarHalfW, yBot - collarH * 0.4, collarHalfW * 2, collarH);

      // Tip
      const tipHalfW = nozzleHalfW * 0.55;
      const nGrad = ctx.createLinearGradient(0, yBot, 0, yBot + nozzleH);
      if (isModern) {
        nGrad.addColorStop(0.00, '#6c757d'); nGrad.addColorStop(0.40, '#495057'); nGrad.addColorStop(1.00, '#212529');
      } else {
        nGrad.addColorStop(0.00, '#a07a30'); nGrad.addColorStop(0.40, '#7a5a22'); nGrad.addColorStop(1.00, '#1a1004');
      }
      ctx.fillStyle = nGrad;
      ctx.beginPath();
      ctx.moveTo(cx - nozzleHalfW, yBot + collarH * 0.6); ctx.lineTo(cx + nozzleHalfW, yBot + collarH * 0.6);
      ctx.lineTo(cx + tipHalfW, yBot + nozzleH); ctx.lineTo(cx - tipHalfW, yBot + nozzleH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isModern ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1; ctx.stroke();

      // Interior hole (capped with metal when the nozzle is closed)
      const isOpen = CFG.NOZZLE_OPEN[i] !== false;
      ctx.fillStyle = isOpen ? (isModern ? '#0a0a0c' : '#040206')
                             : (isModern ? '#adb5bd' : '#a07a30');
      ctx.beginPath();
      ctx.ellipse(cx, yBot + nozzleH - 1, tipHalfW * 0.8, Math.max(1, nozzleH * 0.20), 0, 0, Math.PI * 2);
      ctx.fill();

      // Accent line
      ctx.strokeStyle = isModern ? 'rgba(140, 224, 240, 0.4)' : 'rgba(255,235,170,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - nozzleHalfW + 0.6, yBot + collarH * 0.6); ctx.lineTo(cx - tipHalfW + 0.4, yBot + nozzleH);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draws the window glass over the extrusion interior (after the
   * particles in it): a faint sheen, a diagonal reflection and a crisp frame edge.
   */
  function drawInjectorGlass() {
    const S = SCALE;
    enterDrumFrame(ctx);
    ctx.save();
    extrusionInteriorPath();
    ctx.clip();
    const x0 = CFG.EXT_X_MIN * S, x1 = CFG.EXT_X_MAX * S;
    const yT = -CFG.EXT_Y_TOP * S;
    const sheen = ctx.createLinearGradient(x0, yT, x1, 0);
    sheen.addColorStop(0.00, 'rgba(210,230,240,0.16)');
    sheen.addColorStop(0.35, 'rgba(210,230,240,0.05)');
    sheen.addColorStop(0.60, 'rgba(210,230,240,0.10)');
    sheen.addColorStop(1.00, 'rgba(210,230,240,0.03)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0, yT, x1 - x0, -yT);
    // Diagonal reflection streak
    const w = (x1 - x0);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(x0 + w * 0.55, yT); ctx.lineTo(x0 + w * 0.68, yT);
    ctx.lineTo(x0 + w * 0.18, 0);  ctx.lineTo(x0 + w * 0.05, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // Frame edge around the glass: dark seam plus a light bevel on the frame
    extrusionFramePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = PAL.name === 'light' ? 'rgba(20,20,30,0.6)' : 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /** Draws all active injection puffs at the nozzles (drum frame). */
  function drawPuffs() {
    if (!state.puffs.length) return;
    enterDrumFrame(ctx);
    for (const pf of state.puffs) {
      const age = state.t - pf.bornAt;
      if (age < 0 || age > pf.life) continue;
      const u = age / pf.life;
      const rise = u * 18;
      const r0 = 4 + u * 18;
      const px = pf.x * SCALE;
      const cy = -pf.y * SCALE + 2 - rise;
      const alpha = (1 - u) * 0.55;
      const g = ctx.createRadialGradient(px, cy, 0, px, cy, r0);
      g.addColorStop(0.00, `rgba(255, 245, 225, ${alpha})`);
      g.addColorStop(0.35, `rgba(230, 225, 215, ${alpha * 0.6})`);
      g.addColorStop(1.00, 'rgba(200, 200, 200, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, cy, r0, 0, Math.PI * 2); ctx.fill();
      const lobeR = r0 * 0.55;
      const g2 = ctx.createRadialGradient(px - r0 * 0.3, cy + 2, 0, px - r0 * 0.3, cy + 2, lobeR);
      g2.addColorStop(0, `rgba(240, 235, 225, ${alpha * 0.5})`);
      g2.addColorStop(1, 'rgba(200, 200, 200, 0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(px - r0 * 0.3, cy + 2, lobeR, 0, Math.PI * 2); ctx.fill();
      const g3 = ctx.createRadialGradient(px + r0 * 0.35, cy + 1, 0, px + r0 * 0.35, cy + 1, lobeR * 0.9);
      g3.addColorStop(0, `rgba(240, 235, 225, ${alpha * 0.45})`);
      g3.addColorStop(1, 'rgba(200, 200, 200, 0)');
      ctx.fillStyle = g3;
      ctx.beginPath(); ctx.arc(px + r0 * 0.35, cy + 1, lobeR * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** Draws the structural feet connecting the drum to the instrument bar. */
  function drawOmegaFeet() {
    const yTop = GEO.footTopY, yBot = GEO.footBotY;
    if (!isFinite(yTop) || !isFinite(yBot) || yBot <= yTop) return;
    const xTopInner = GEO.footTopHalfW * 0.55;
    const xTopOuter = GEO.footTopHalfW;
    const xBotInner = GEO.footBotHalfW * 0.55;
    const xBotOuter = GEO.footBotHalfW;
    
    if (isPfeifferTheme()) { drawPfeifferBase(); return; }
    const sg = ctx.createLinearGradient(0, yTop, 0, yBot);

    if (PAL.name === 'light') {
      sg.addColorStop(0.00, '#d0ccbc');
      sg.addColorStop(0.25, '#b0ac9c');
      sg.addColorStop(0.55, '#8a8678');
      sg.addColorStop(1.00, '#6a6658');
    } else {
      sg.addColorStop(0.00, '#6a6a72');
      sg.addColorStop(0.25, '#4a4a52');
      sg.addColorStop(0.55, '#2a2a32');
      sg.addColorStop(1.00, '#1a1a22');
    }

    for (const sign of [-1, +1]) {
      ctx.beginPath();
      ctx.moveTo(CX + sign * xTopInner, yTop);
      ctx.lineTo(CX + sign * xTopOuter, yTop);
      ctx.lineTo(CX + sign * xBotOuter, yBot);
      ctx.lineTo(CX + sign * xBotInner, yBot);
      ctx.closePath();
      ctx.fillStyle = sg; ctx.fill();
      ctx.strokeStyle = (PAL.name === 'light') ? 'rgba(255,255,255,0.55)' : 'rgba(210,210,220,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(CX + sign * xTopOuter, yTop); ctx.lineTo(CX + sign * xBotOuter, yBot); ctx.stroke();
      ctx.strokeStyle = (PAL.name === 'light') ? 'rgba(20,20,30,0.45)' : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(CX + sign * xTopInner, yTop); ctx.lineTo(CX + sign * xBotInner, yBot); ctx.stroke();
      const midTop = (xTopInner + xTopOuter) * 0.5;
      const midBot = (xBotInner + xBotOuter) * 0.5;
      rivet(CX + sign * midTop, yTop + 6, 3.5);
      rivet(CX + sign * midBot, yBot - 8, 3.5);
    }
  }

  /** Draws the horizontal instrument bar spanning below the drum. */
  function drawOmegaBar() {
    const x0 = CX - GEO.barHalfW, x1 = CX + GEO.barHalfW;
    const y0 = GEO.barTop, y1 = GEO.barBot;
    if (!isFinite(x0) || !isFinite(x1) || !isFinite(y0) || !isFinite(y1) || y1 <= y0 || x1 <= x0) return;
    
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    const isPfeiffer = document.body.classList.contains('theme-pfeiffer');

    if (PAL.name === 'light') {
      g.addColorStop(0.00, '#d6d2c2');
      g.addColorStop(0.05, '#e2dece');
      g.addColorStop(0.20, '#b4ae9e');
      g.addColorStop(0.55, '#928c7c');
      g.addColorStop(0.85, '#6e6858');
      g.addColorStop(1.00, '#54503f');
    } else {
      g.addColorStop(0.00, '#6a6a72');
      g.addColorStop(0.05, '#8a8a92');
      g.addColorStop(0.20, '#4a4a52');
      g.addColorStop(0.55, '#2e2e34');
      g.addColorStop(0.85, '#1a1a22');
      g.addColorStop(1.00, '#0e0e14');
    }
    
    ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = (PAL.name === 'light') ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0 + 0.5); ctx.lineTo(x1, y0 + 0.5); ctx.stroke();
    ctx.strokeStyle = (PAL.name === 'light') ? 'rgba(20,20,30,0.45)' : 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y1 - 0.5); ctx.lineTo(x1, y1 - 0.5); ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.08; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    for (let x = x0; x < x1; x += 2) { ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y1 - 2); ctx.stroke(); }
    ctx.restore();
    for (let x = x0 + 14; x < x1 - 10; x += 28) { rivet(x, y0 + 8, 3); rivet(x, y1 - 8, 3); }
    const capW = 6;
    const capA = ctx.createLinearGradient(x0, 0, x0 + capW, 0);
    capA.addColorStop(0, 'rgba(0,0,0,0.55)'); capA.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = capA; ctx.fillRect(x0, y0, capW, y1 - y0);
    const capB = ctx.createLinearGradient(x1 - capW, 0, x1, 0);
    capB.addColorStop(0, 'rgba(0,0,0,0)'); capB.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = capB; ctx.fillRect(x1 - capW, y0, capW, y1 - y0);
  }

  /** Draws the steel band ring surrounding the drum, including feet if applicable. */
  function drawSteelBand() {
    const rInner = Math.max(1, pxDist(CFG.R_DRUM));
    const rOuter = rInner + (REGIME === 'wide' ? 32 : (REGIME === 'compact' ? 18 : 14));
    if (isPfeifferTheme()) {
      // Support structure is drawn earlier (see drawPfeifferSupport)
      drawPfeifferBand(rInner, rOuter);
      return;
    }
    const g = ctx.createRadialGradient(CX, CY, rInner, CX, CY, rOuter);
    g.addColorStop(0, PAL.bandInner);
    g.addColorStop(0.4, PAL.bandMid1);
    g.addColorStop(0.7, PAL.bandMid2);
    g.addColorStop(1, PAL.bandOuter);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, CY, rOuter, 0, Math.PI * 2);
    ctx.arc(CX, CY, rInner, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = PAL.bandInnerLine; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, rInner, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = PAL.bandOuterLine; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(CX, CY, rOuter - 1, 0, Math.PI * 2); ctx.stroke();
  }

  /** Draws evenly spaced rivets around the steel band ring. */
  function drawBoltRing() {
    const bandPad = (REGIME === 'wide' ? 16 : (REGIME === 'compact' ? 9 : 7));
    const r = pxDist(CFG.R_DRUM) + bandPad;
    if (isPfeifferTheme()) {
      drawPfeifferBolts();
    } else {
      const N = REGIME === 'portrait' ? 16 : 24;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - state.drumAngle;
        rivet(CX + r * Math.cos(a), CY + r * Math.sin(a), REGIME === 'wide' ? 4 : 3);
      }
    }

    // Gold collection slot marker — rotates with drum, pulses when armed
    const slotA  = state.tray.slotAngle - state.drumAngle;
    const slotX  = CX + r * Math.cos(slotA); // reuse existing 'r' from above
    const slotY  = CY + r * Math.sin(slotA);
    const armed  = state.tray.phase === 'armed';
    const pulse  = armed ? 0.55 + 0.45 * Math.sin(state.t * 7) : 1;
    const nw = armed ? 11 : 7, nh = armed ? 4.5 : 3;
    ctx.save();
    ctx.translate(slotX, slotY);
    ctx.rotate(slotA + Math.PI / 2); // orient radially outward
    if (armed) {
      ctx.shadowColor = `rgba(255,204,60,${(0.9 * pulse).toFixed(2)})`;
      ctx.shadowBlur  = 10;
    }
    const ng = ctx.createLinearGradient(0, -nw / 2, 0, nw / 2);
    ng.addColorStop(0.0, '#3a2008');
    ng.addColorStop(0.3, `rgba(255,220,90,${pulse.toFixed(2)})`);
    ng.addColorStop(0.7, `rgba(255,220,90,${pulse.toFixed(2)})`);
    ng.addColorStop(1.0, '#3a2008');
    ctx.fillStyle = ng;
    ctx.fillRect(-nh / 2, -nw / 2, nh, nw);
    ctx.restore();
  }

  /** Draws the drum interior backplate with a radial gradient, dimmed in lidar mode. */
  function drawBackplate() {
    const r = Math.max(1, pxDist(CFG.R_DRUM));
    const lidar = state.laserOn;
    const dim = lidar ? TUNING.lidar.backplateDim : 1;
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, r);
    g.addColorStop(0, mixHex(PAL.backplateInner, '#000000', 1 - dim));
    g.addColorStop(0.7, mixHex(PAL.backplateMid,   '#000000', 1 - dim));
    g.addColorStop(1,   mixHex(PAL.backplateOuter, '#000000', 1 - dim));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.fill();
    // Skip the levitation-zone highlight once the shutdown/rise sequence
    // has begun — the zone is irrelevant from spindown onward.
    const phase = state.solar.phase;
    if (phase === 'spindown' || phase === 'final_move' || phase === 'final_view') return;
    const hx = X2px(TUNING.highlight.cx);
    const hy = Y2px(TUNING.highlight.cy);
    const hr = Math.max(1, pxDist(TUNING.highlight.radius));
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.clip();
    const hDim = lidar ? TUNING.lidar.highlightDim : 1;
    ctx.fillStyle = mixHex(PAL.highlightFill, '#000000', 1 - hDim);
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ============================================================
  // SECTION: RENDER — PFEIFFER CHAMBER
  // ============================================================
  // The Pfeiffer theme mimics the real vacuum chamber: a machined
  // aluminium flange ring with a dense bolt circle and face holes,
  // radial CF ports and feedthrough boxes around the rim, and a light
  // saddle cradle sitting on the red base frame.

  /** True when the Pfeiffer visual theme is active. */
  function isPfeifferTheme() {
    return document.body.classList.contains('theme-pfeiffer');
  }

  /** Band width (px) outside the drum radius for the current regime. */
  function bandOutside() {
    return REGIME === 'wide' ? 32 : (REGIME === 'compact' ? 18 : 14);
  }

  // Rim ports in drum-fixed angles (deg, canvas convention: -90 = top).
  // len / hw are fractions of the drum radius. The arc from -110 to -25
  // is kept free so that at drumAngle = 0 (launch and every reset) the
  // clean part of the rim sits top-right and the injector is unobstructed.
  const PF_PORTS = [
    { a:  -14, type: 'tube', len: 0.17, hw: 0.085 },
    { a:    4, type: 'feed', len: 0.30, hw: 0.070 },
    { a:   21, type: 'tube', len: 0.12, hw: 0.055 },
    { a:   38, type: 'tube', len: 0.17, hw: 0.080 },
    { a:   58, type: 'tube', len: 0.12, hw: 0.055 },
    { a:   80, type: 'tube', len: 0.14, hw: 0.060 },
    { a:  102, type: 'tube', len: 0.12, hw: 0.050 },
    { a:  126, type: 'tube', len: 0.12, hw: 0.050 },
    { a:  150, type: 'tube', len: 0.10, hw: 0.048 },
    { a:  172, type: 'tube', len: 0.11, hw: 0.050 },
    { a:  194, type: 'tube', len: 0.16, hw: 0.065 },
    { a:  216, type: 'box',  len: 0.24, hw: 0.090 },
    { a:  240, type: 'tube', len: 0.13, hw: 0.050 },
  ];

  // Face holes on the flange ring: [angle deg, size class 0/1].
  const PF_HOLES = [
    [-150, 1], [-112, 0], [-80, 1], [-52, 0], [-18, 1], [12, 0],
    [40, 1], [68, 0], [102, 1], [138, 0], [172, 1], [210, 0], [244, 1],
  ];

  /**
   * Fills a rectangle (in the current local frame) with a cylindrical
   * aluminium gradient running across y, then darkens it by `shade`.
   */
  function pfPart(x, y, w, h, stops, shade) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    for (const [pos, col] of stops) g.addColorStop(pos, col);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    if (shade > 0.005) {
      ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, y, w, h);
  }

  const PF_TUBE = [[0, '#5d6267'], [0.22, '#eef1f3'], [0.5, '#c4c9ce'], [0.85, '#868c92'], [1, '#4a4f54']];
  const PF_FLANGE = [[0, '#6c7176'], [0.2, '#f6f8f9'], [0.55, '#d3d7db'], [0.9, '#8f959a'], [1, '#55595e']];
  const PF_BOX = [[0, '#9da2a7'], [0.08, '#e9ecee'], [0.5, '#d4d8db'], [0.92, '#a9aeb3'], [1, '#6e7378']];

  /** Small bright hex-head bolt. */
  function pfBolt(x, y, r) {
    const rr = Math.max(0.8, r);
    const g = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.35, 0, x, y, rr);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#b9bec3');
    g.addColorStop(1, '#5b6065');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  /**
   * Draws the radial ports, boxes and feedthroughs on the chamber rim.
   * They rotate with the drum and are drawn before the injector and
   * cradle so those structures sit in front of them.
   */
  function drawPfeifferPorts() {
    const R = pxDist(CFG.R_DRUM);
    const rOuter = R + bandOutside();
    const lightA = -135 * Math.PI / 180;
    for (const p of PF_PORTS) {
      const a = p.a * Math.PI / 180 - state.drumAngle;
      // Ports facing away from the light get darker
      const shade = 0.30 * (1 - Math.cos(a - lightA)) * 0.5;
      const hw = Math.max(3, p.hw * R);
      const len = Math.max(8, p.len * R);
      const ft = Math.max(2.5, 0.032 * R);
      const x0 = rOuter - 3;

      ctx.save();
      ctx.translate(CX, CY);
      ctx.rotate(a);

      // Soft contact shadow on the ring
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x0 - 2, -hw * 1.35, 6, hw * 2.7);

      if (p.type === 'tube') {
        const xF = x0 + len - ft * 1.7;
        pfPart(x0, -hw * 1.18, ft * 0.9, hw * 2.36, PF_FLANGE, shade);       // weld collar
        pfPart(x0 + ft * 0.9, -hw, xF - x0 - ft * 0.9, hw * 2, PF_TUBE, shade); // tube
        pfPart(xF, -hw * 1.6, ft, hw * 3.2, PF_FLANGE, shade);              // CF flange
        pfPart(xF + ft, -hw * 1.6, ft * 0.7, hw * 3.2, PF_FLANGE, shade + 0.06); // blank
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(xF + ft - 0.4, -hw * 1.6, 0.8, hw * 3.2);
        const br = Math.max(0.8, ft * 0.28);
        pfBolt(xF + ft * 0.85, -hw * 1.32, br);
        pfBolt(xF + ft * 0.85,  hw * 1.32, br);
      } else if (p.type === 'box') {
        const neck = len * 0.22;
        pfPart(x0, -hw * 0.55, neck, hw * 1.1, PF_TUBE, shade);
        pfPart(x0 + neck - ft, -hw * 0.8, ft, hw * 1.6, PF_FLANGE, shade);
        const bx = x0 + neck, bw = len - neck;
        pfPart(bx, -hw, bw, hw * 2, PF_BOX, shade);
        // Cover plate inset
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.8;
        ctx.strokeRect(bx + ft, -hw + ft, bw - 2 * ft, hw * 2 - 2 * ft);
        const br = Math.max(0.8, ft * 0.3);
        for (const [u, v] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]]) {
          pfBolt(bx + bw * 0.5 + u * (bw - 3 * ft), v * (hw * 2 - 3 * ft), br);
        }
      } else if (p.type === 'feed') {
        const neck = len * 0.18;
        pfPart(x0, -hw * 0.6, neck, hw * 1.2, PF_TUBE, shade);
        pfPart(x0 + neck - ft, -hw * 0.95, ft, hw * 1.9, PF_FLANGE, shade);
        const bx = x0 + neck, bw = len * 0.55;
        pfPart(bx, -hw * 1.25, bw, hw * 2.5, PF_BOX, shade);
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.33, -hw * 1.25); ctx.lineTo(bx + bw * 0.33, hw * 1.25);
        ctx.moveTo(bx + bw * 0.66, -hw * 1.25); ctx.lineTo(bx + bw * 0.66, hw * 1.25);
        ctx.stroke();
        // Electrical feedthrough pins sticking out of the side face
        const pinL = len - neck - bw;
        ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const px = bx + bw * (0.18 + 0.22 * i);
          ctx.strokeStyle = '#8b9095'; ctx.lineWidth = Math.max(1, hw * 0.16);
          ctx.beginPath(); ctx.moveTo(px, hw * 1.25); ctx.lineTo(px, hw * 1.25 + pinL * 0.55); ctx.stroke();
          pfBolt(px, hw * 1.25 + pinL * 0.55, Math.max(1, hw * 0.16));
        }
        // End connector block
        pfPart(bx + bw, -hw * 0.7, pinL * 0.45, hw * 1.4, PF_FLANGE, shade);
      }
      ctx.restore();
    }
  }

  /**
   * Draws the machined aluminium flange ring that replaces the steel
   * band in the Pfeiffer theme, including the rotating face holes.
   */
  function drawPfeifferBand(rInner, rOuter) {
    const bw = rOuter - rInner;
    const ring = () => {
      ctx.beginPath();
      ctx.arc(CX, CY, rOuter, 0, Math.PI * 2);
      ctx.arc(CX, CY, rInner, 0, Math.PI * 2, true);
    };
    const g = ctx.createRadialGradient(CX, CY, rInner, CX, CY, rOuter);
    g.addColorStop(0.00, '#4e5358');
    g.addColorStop(0.08, '#b9bec3');
    g.addColorStop(0.40, '#e2e5e8');
    g.addColorStop(0.72, '#c3c8cc');
    g.addColorStop(0.86, '#e9ecee');
    g.addColorStop(1.00, '#73787d');
    ctx.fillStyle = g; ring(); ctx.fill();

    // Anisotropic sheen of turned aluminium (fixed relative to the light)
    if (ctx.createConicGradient) {
      const s = ctx.createConicGradient(-Math.PI / 4, CX, CY);
      const L = 'rgba(255,255,255,0.22)', D = 'rgba(0,0,0,0.16)', N = 'rgba(0,0,0,0)';
      s.addColorStop(0.00, L); s.addColorStop(0.12, N); s.addColorStop(0.25, D);
      s.addColorStop(0.38, N); s.addColorStop(0.50, L); s.addColorStop(0.62, N);
      s.addColorStop(0.75, D); s.addColorStop(0.88, N); s.addColorStop(1.00, L);
      ctx.fillStyle = s; ring(); ctx.fill();
    }

    // Concentric turning marks
    const nMarks = Math.max(3, Math.round(bw / 3));
    for (let k = 1; k <= nMarks; k++) {
      ctx.strokeStyle = (k % 2) ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(CX, CY, rInner + bw * k / (nMarks + 1), 0, Math.PI * 2); ctx.stroke();
    }

    // Dim slightly in the dark lab so the ring doesn't glare
    if (PAL.name !== 'light') { ctx.fillStyle = 'rgba(8,10,14,0.18)'; ring(); ctx.fill(); }

    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, rInner, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,32,36,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(CX, CY, rOuter - 0.6, 0, Math.PI * 2); ctx.stroke();

    // Face holes, rotating with the drum
    if (bw >= 16) {
      const rH = rInner + bw * 0.42;
      for (const [deg, big] of PF_HOLES) {
        const a = deg * Math.PI / 180 - state.drumAngle;
        const hx = CX + rH * Math.cos(a), hy = CY + rH * Math.sin(a);
        const hr = bw * (big ? 0.17 : 0.10);
        ctx.fillStyle = '#121418';
        ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
        // Lit lower-right chamfer, shadowed upper-left
        ctx.lineWidth = Math.max(0.8, hr * 0.25);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath(); ctx.arc(hx, hy, hr, -0.2, Math.PI * 0.8); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc(hx, hy, hr, Math.PI * 0.8, Math.PI * 1.8); ctx.stroke();
      }
    }
  }

  /** Dense circle of small bright bolts on the outer edge of the ring. */
  function drawPfeifferBolts() {
    const rInner = pxDist(CFG.R_DRUM);
    const bw = bandOutside();
    const r = rInner + bw * 0.82;
    const N = Math.max(24, Math.round(2 * Math.PI * r / 15));
    const br = Math.max(1.1, bw * 0.075);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - state.drumAngle;
      pfBolt(CX + r * Math.cos(a), CY + r * Math.sin(a), br);
    }
  }

  /**
   * Fills a red box-section beam: gradient across its short side, bevelled
   * edges and a recessed centre panel.
   */
  function pfRedBeam(x, y, w, h, vertical) {
    // Soft, rounded shading of painted steel: broad highlight, gentle falloff
    const g = vertical ? ctx.createLinearGradient(x, 0, x + w, 0)
                       : ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0.00, '#d81e2e');
    g.addColorStop(0.18, '#f0414b');
    g.addColorStop(0.40, '#dc0f22');
    g.addColorStop(0.75, '#b8061a');
    g.addColorStop(1.00, '#8c0412');
    const rad = Math.min(w, h) * 0.22;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h);
    ctx.fillStyle = g; ctx.fill();
    if (PAL.name !== 'light') { ctx.fillStyle = 'rgba(8,10,14,0.12)'; ctx.fill(); }
    ctx.strokeStyle = 'rgba(60,0,8,0.25)'; ctx.lineWidth = 1;
    ctx.stroke();
  }


  /**
   * Draws the red rectangular base frame under the cradle in a slight
   * top-down perspective: a front plinth beam on the instrument bar,
   * side rails receding to a back beam, and a mid-depth cross beam
   * carrying the two box-section columns under the saddle.
   */
  function drawPfeifferBase() {
    const R = pxDist(CFG.R_DRUM);
    const yTop = GEO.footTopY, yBot = GEO.footBotY;
    const gap = yBot - yTop;
    const beamH = Math.max(5, gap * 0.28);
    const beamY = yBot - beamH;
    const beamHalf = GEO.footBotHalfW;
    const railW = beamH * 1.1;
    const depth = gap * 0.66;  // vertical rise of the frame's far end
    const k = 0.18;            // horizontal shrink toward the far end
    const dim = PAL.name !== 'light' ? 0.85 : 1;

    // Project a front-plane point (x, y) to depth t in [0, 1]
    const P = (x, y, t) => [CX + (x - CX) * (1 - k * t), y - depth * t];
    const quad = (pts, fill) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = 'rgba(60,0,8,0.22)'; ctx.lineWidth = 1; ctx.stroke();
    };
    const shadeRed = (c) => mixHex(c, '#000000', 1 - dim);

    /**
     * Box beam spanning x0..x1, top at y (front-plane coords), height h,
     * from depth t0 (front face) to t1. Draws the side facing the centre,
     * the top face, then the front face.
     */
    const box = (x0, x1, y, h, t0, t1, frontDark) => {
      if (x1 < CX) {
        quad([P(x1, y, t0), P(x1, y, t1), P(x1, y + h, t1), P(x1, y + h, t0)], shadeRed('#9a0616'));
      } else if (x0 > CX) {
        quad([P(x0, y, t0), P(x0, y, t1), P(x0, y + h, t1), P(x0, y + h, t0)], shadeRed('#9a0616'));
      }
      quad([P(x0, y, t0), P(x1, y, t0), P(x1, y, t1), P(x0, y, t1)], shadeRed('#e8343f'));
      const [fx0, fy] = P(x0, y, t0);
      const [fx1] = P(x1, y, t0);
      const hh = h;
      pfRedBeam(fx0, fy, fx1 - fx0, hh, false);
      if (frontDark > 0) { ctx.fillStyle = `rgba(0,0,0,${frontDark})`; ctx.fillRect(fx0, fy, fx1 - fx0, hh); }
    };

    const tB = 0.12; // apparent depth of a beam's own top face

    // Floor shadow inside the frame
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    const s0 = P(CX - beamHalf, yBot, 0), s1 = P(CX + beamHalf, yBot, 0);
    const s2 = P(CX + beamHalf, yBot, 1), s3 = P(CX - beamHalf, yBot, 1);
    ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.lineTo(s3[0], s3[1]);
    ctx.closePath(); ctx.fill();

    // Back beam (farthest), then the two side rails receding backward
    box(CX - beamHalf, CX + beamHalf, beamY, beamH, 1 - tB, 1, 0.25);
    box(CX - beamHalf, CX - beamHalf + railW, beamY, beamH, tB, 1 - tB, 0);
    box(CX + beamHalf - railW, CX + beamHalf, beamY, beamH, tB, 1 - tB, 0);

    // Mid-depth cross beam carrying the columns
    const tM = 0.5;
    box(CX - beamHalf + railW, CX + beamHalf - railW, beamY, beamH, tM - tB / 2, tM + tB / 2, 0.12);

    // Columns standing on the cross beam (their tops hide behind the saddle)
    const colHalfW = Math.max(6, R * 0.13);
    const colBot = P(CX, beamY, tM)[1] + 1;
    for (const sign of [-1, 1]) {
      const cx = CX + sign * R * 0.37 * (1 - k * tM);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(cx - colHalfW + 3, yTop, colHalfW * 2, colBot - yTop);
      pfRedBeam(cx - colHalfW, yTop, colHalfW * 2, colBot - yTop, true);
    }

    // Front plinth beam with drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(CX - beamHalf + 2, beamY + 3, beamHalf * 2, beamH);
    box(CX - beamHalf, CX + beamHalf, beamY, beamH, 0, tB, 0);
    for (const sign of [-1, 1]) {
      rivet(CX + sign * (beamHalf - beamH * 0.5), beamY + beamH * 0.5, Math.max(2, beamH * 0.12));
    }
  }

  /**
   * Draws the red saddle cradle that holds the bottom of the chamber,
   * sitting on top of the red base frame.
   */
  function drawPfeifferCradle(rOuter) {
    const yBase = GEO.footTopY + (GEO.footBotY - GEO.footTopY) * 0.08;
    const span = 34 * Math.PI / 180;
    const aR = Math.PI / 2 - span, aL = Math.PI / 2 + span;
    const xL = CX + rOuter * Math.cos(aL), xR = CX + rOuter * Math.cos(aR);
    const yEnd = CY + rOuter * Math.sin(aR);
    const lip = Math.max(4, rOuter * 0.03);

    for (const sign of [-1, 1]) {
      // Each saddle half: an outer block whose top follows the chamber arc
      const xo = sign < 0 ? xL - lip : xR + lip;
      const xi = CX + sign * rOuter * 0.16;
      ctx.beginPath();
      ctx.moveTo(xo, yEnd - lip);
      ctx.arc(CX, CY, rOuter, sign < 0 ? aL : aR, Math.acos((xi - CX) / rOuter), sign < 0);
      ctx.lineTo(xi, yBase);
      ctx.lineTo(xo + sign * lip * 2.5, yBase);
      ctx.closePath();
      const g = ctx.createLinearGradient(xo, 0, xi, 0);
      g.addColorStop(0.00, '#b0081a');
      g.addColorStop(0.15, '#ee3d48');
      g.addColorStop(0.40, '#da0e22');
      g.addColorStop(0.80, '#bc071b');
      g.addColorStop(1.00, '#980515');
      ctx.fillStyle = g; ctx.fill();
      if (PAL.name !== 'light') { ctx.fillStyle = 'rgba(8,10,14,0.15)'; ctx.fill(); }
      ctx.strokeStyle = 'rgba(60,0,8,0.3)'; ctx.lineWidth = 1; ctx.stroke();
      // Box-section foot beam along the bottom of each saddle half
      const footH = Math.max(3, lip * 1.6);
      const fx0 = Math.min(xo + sign * lip * 2.5, xi), fx1 = Math.max(xo + sign * lip * 2.5, xi);
      pfRedBeam(fx0, yBase - footH, fx1 - fx0, footH, false);
      // Recessed web panel above the foot beam
      ctx.strokeStyle = 'rgba(60,0,6,0.45)';
      ctx.beginPath();
      ctx.moveTo(xo + sign * lip * 2.2, yBase - footH - lip * 0.6);
      ctx.lineTo(xi - sign * lip, yBase - footH - lip * 0.6);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,150,150,0.25)';
      ctx.beginPath();
      ctx.moveTo(xo + sign * lip * 2.2, yBase - footH - lip * 0.6 + 1);
      ctx.lineTo(xi - sign * lip, yBase - footH - lip * 0.6 + 1);
      ctx.stroke();
      const bh = Math.max(1.4, lip * 0.35);
      pfBolt(xo + sign * lip * 0.8, yBase - footH * 0.5, bh);
      pfBolt(xi - sign * lip * 1.6, yBase - footH * 0.5, bh);
    }
    // Shadow line where the cradle meets the red base
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(xL - lip, yBase, xR - xL + 2 * lip, 2);
  }

  // ============================================================
  // SECTION: RENDER — TRAILS
  // ============================================================
  /** Renders all particle trail lines with a head-to-tail opacity fade. */
  function drawTrails() {
    if (!state.trailsOn) return;
    if ((state.renderN || CFG.N_P) >= TUNING.trails.maxN) return;
    if (state.laserOn) return;
    
    const dur = TUNING.trails.durationS;
    const headA = TUNING.trails.headAlpha;
    const tailA = TUNING.trails.tailAlpha;

    const rInnerPx = pxDist(CFG.R_DRUM) + 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, rInnerPx, 0, Math.PI * 2); ctx.clip();

    for (const p of state.particles) {
      if (!p.alive || p.stuck) continue;
      const trail = p.trail;
      if (!trail || trail.length < 2) continue;

      const levitated = state.isLevitated(p);
      
      let r, g, b;
      if (levitated) { r = 0x40; g = 0xff; b = 0x70; }
      else           { r = 0xff; g = 0xee; b = 0x33; }

      ctx.lineWidth = TUNING.trails.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = trail.length - 1; i > 0; i--) {
        const s1 = trail[i];
        const s0 = trail[i - 1];
        
        // Calculate age based on simulation time
        const age = state.t - s1.t;
        if (age > dur) break;

        const u = age / dur;
        const a = headA + (tailA - headA) * u;
        if (a <= 0.01) continue;
        
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(X2px(s0.x), Y2px(s0.y));
        ctx.lineTo(X2px(s1.x), Y2px(s1.y));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Appends the current position of each live, non-stuck particle to its trail buffer. */
  function recordTrails() {
    if (!state.trailsOn) return;
    if ((state.renderN || CFG.N_P) >= TUNING.trails.maxN) return;
    
    // Use simulation time (state.t) for consistent length during slow-mo
    const dur = TUNING.trails.durationS;
    
    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck) {
        if (p.trail && p.trail.length) p.trail.length = 0;
        continue;
      }
      if (!p.insideOnce) continue;
      if (!p.trail) p.trail = [];

      p.trail.push({ x: p.x, y: p.y, t: state.t });

      while (p.trail.length && (state.t - p.trail[0].t) > dur) {
        p.trail.shift();
      }
    }
  }

  // ============================================================
  // SECTION: RENDER — DRUM INTERIOR
  // ============================================================
  /** Draws the levitation highlight zone and laser beam inside the drum. */
  function drawDrumInterior() {
    const r = pxDist(CFG.R_DRUM);
    ctx.save();
    ctx.translate(CX, CY); ctx.rotate(-state.drumAngle);
    ctx.strokeStyle = 'rgba(80,80,100,0.18)'; ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * pxDist(8), Math.sin(a) * pxDist(8));
      ctx.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
      ctx.stroke();
    }
    ctx.restore();

    if (state.laserOn) {
      ctx.save();
      ctx.translate(CX, CY); ctx.rotate(-state.laserAngle);
      const lidar = state.laserOn;
      const fanHalfAngle = lidar ? TUNING.lidar.laserFanHalf : 0.025;
      const am = lidar ? TUNING.lidar.laserAlphaMul : 1;
      const innerR = pxDist(8);
      const outerR = r * 0.99;
      ctx.beginPath();
      ctx.moveTo(Math.cos(-fanHalfAngle) * innerR, Math.sin(-fanHalfAngle) * innerR);
      ctx.arc(0, 0, outerR, -fanHalfAngle, fanHalfAngle, false);
      ctx.lineTo(Math.cos(fanHalfAngle) * innerR, Math.sin(fanHalfAngle) * innerR);
      ctx.arc(0, 0, innerR, fanHalfAngle, -fanHalfAngle, true);
      ctx.closePath();
      const grad = ctx.createLinearGradient(innerR, 0, outerR, 0);
      grad.addColorStop(0.0, 'rgba(60, 255, 120, 0.0)');
      grad.addColorStop(0.1, `rgba(60, 255, 120, ${Math.min(1, 0.18 * am)})`);
      grad.addColorStop(0.7, `rgba(60, 255, 120, ${Math.min(1, 0.10 * am)})`);
      grad.addColorStop(1.0, 'rgba(60, 255, 120, 0.0)');
      ctx.fillStyle = grad; ctx.fill();
      ctx.shadowColor = 'rgba(60, 255, 120, 0.9)'; ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(150, 255, 180, 0.95)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(innerR, 0); ctx.lineTo(outerR, 0); ctx.stroke();
      ctx.shadowBlur = 10; ctx.fillStyle = 'rgba(180, 255, 200, 1)';
      ctx.beginPath(); ctx.arc(innerR + 2, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  /** Draws the central axis hub with drop shadow and specular highlight. */
  function drawAxis() {
    const r = Math.max(3, pxDist(CFG.R_AXIS));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(CX, CY + 2, r + 4, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(CX - r * 0.4, CY - r * 0.4, 0, CX, CY, r);
    g.addColorStop(0, '#b8b8c0');
    g.addColorStop(0.5, '#6a6a72');
    g.addColorStop(1, '#2a2a32');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(CX, CY); ctx.rotate(-state.drumAngle);
    ctx.strokeStyle = 'rgba(20,20,26,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0); ctx.lineTo(r * 0.7, 0);
    ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, r * 0.7);
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - state.drumAngle;
      rivet(CX + Math.cos(a) * r * 0.65, CY + Math.sin(a) * r * 0.65, 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.stroke();
  }

  // ============================================================
  // SECTION: RENDER — PARTICLES
  // ============================================================
  /**
   * Draws a single particle in normal or lidar mode.
   *
   * @param {object} p - Particle object from state.particles.
   */
  function drawOneParticle(p) {
    const x = X2px(p.x), y = Y2px(p.y);
    const sizeFac = visualSizeFactor(p.vt);
    const n = state.renderN || CFG.N_P;
    const minR = n >= 1000 ? 0.5 : (n >= 300 ? 1.0 : 2.0);
    const rpx = Math.max(minR, pxDist(TUNING.particle.collisionR) * 2 * sizeFac);
    const lidar = state.laserOn;
    const FLASH_DUR = 0.40 * (lidar ? TUNING.lidar.flashDurMul : 1);
    let flash = 0;
    if (state.t < p.flashEndsAt) {
      flash = (p.flashEndsAt - state.t) / FLASH_DUR;
      if (flash > 1) flash = 1; if (flash < 0) flash = 0;
    }

    const levitated = state.isLevitated(p);
    let alphaMul = 1;
    if (p.stuck && p.stuckAt !== undefined) {
      const age = state.t - p.stuckAt;
      if (age > 4) alphaMul = Math.max(0, 1 - (age - 4));
      if (alphaMul <= 0) return;
    }

    if (lidar) {
      if (!p.stuck && flash <= 0) return;
      if (p.stuck) alphaMul *= TUNING.lidar.stuckAlpha;
    }

    const drawGlow = lidar || ((state.renderN || CFG.N_P) < 300);

    let coreColor, glowColor;
    if (p.stuck) {
      coreColor = flash > 0 ? mixHex('#ff4040', '#e6ffea', flash) : '#ff4040';
      glowColor = flash > 0
        ? `rgba(${rgbLerp(0xff, 0x60, flash)}, ${rgbLerp(0x40, 0xff, flash)}, ${rgbLerp(0x40, 0x90, flash)}, ${(0.35 + 0.55 * flash) * alphaMul})`
        : `rgba(255,64,64,${0.35 * alphaMul})`;
    } else if (levitated) {
      coreColor = flash > 0 ? mixHex('#40ff70', '#e6ffea', flash) : '#40ff70';
      glowColor = flash > 0
        ? `rgba(${rgbLerp(0x60, 0xb0, flash)}, 255, ${rgbLerp(0x80, 0xd0, flash)}, ${0.55 + 0.35 * flash})`
        : 'rgba(80, 255, 130, 0.55)';
    } else {
      coreColor = flash > 0 ? mixHex('#ffee33', '#e6ffea', flash) : '#ffee33';
      glowColor = flash > 0
        ? `rgba(${rgbLerp(0xff, 0x60, flash)}, ${rgbLerp(0xee, 0xff, flash)}, ${rgbLerp(0x33, 0x90, flash)}, ${0.45 + 0.55 * flash})`
        : 'rgba(255,238,51,0.45)';
    }

    if (alphaMul < 1) ctx.globalAlpha = alphaMul;

    if (drawGlow) {
      const glowR = Math.max(rpx + 1, rpx * (3 + flash * 3.5));
      const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      g.addColorStop(0, glowColor);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fill();
    }

    if (flash > 0 && drawGlow) {
      const hr = rpx * (2.2 + flash * 2.5);
      const hg = ctx.createRadialGradient(x, y, 0, x, y, hr);
      hg.addColorStop(0, `rgba(180, 255, 210, ${0.5 * flash})`);
      hg.addColorStop(0.6, `rgba(80, 255, 130, ${0.25 * flash})`);
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = coreColor;
    ctx.beginPath(); ctx.arc(x, y, rpx * (1 + flash * 0.3), 0, Math.PI * 2); ctx.fill();
    if (drawGlow) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.7 + flash * 0.3) + ')';
      ctx.beginPath(); ctx.arc(x - rpx * 0.3, y - rpx * 0.3, rpx * 0.35, 0, Math.PI * 2); ctx.fill();
    }

    if (alphaMul < 1) ctx.globalAlpha = 1;
  }

  /** Draws all live particles in the drum, clipped to its interior. */
  function drawParticles() {
    const rInnerPx = pxDist(CFG.R_DRUM) + 2;
    const R_DRUM_CM = CFG.R_DRUM;
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, rInnerPx, 0, Math.PI * 2); ctx.clip();
    for (const p of state.particles) {
      if (!p.alive) continue;
      if (Math.hypot(p.x, p.y) > R_DRUM_CM + 0.5) continue;
      drawOneParticle(p);
    }
    ctx.restore();
  }

  /**
   * Draws particles in the injector extrusion, clipped to its window. Part
   * of the injector assembly, so they pass behind the steel band.
   */
  function drawInjectorParticles() {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(-state.drumAngle);
    extrusionInteriorPath();
    ctx.clip();
    ctx.rotate(state.drumAngle);
    ctx.translate(-CX, -CY);
    for (const p of state.particles) {
      if (!p.alive) continue;
      if (Math.hypot(p.x, p.y) <= CFG.R_DRUM + 0.5) continue;
      drawOneParticle(p);
    }
    ctx.restore();
  }

  /** Injector extrusion with its contents and glass, in back-to-front order. */
  function drawInjectorAssembly() {
    drawInjector();
    drawPuffs();
    drawInjectorParticles();
    drawInjectorGlass();
  }

  /** Draws the glass glare arc across the front face of the drum. */
  function drawGlare() {
    const r = pxDist(CFG.R_DRUM);
    const g = ctx.createLinearGradient(CX - r, CY - r, CX + r, CY + r);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.3, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(CX - r, CY - r, r * 2, r * 2);
    ctx.restore();
  }

  // ============================================================
  // SECTION: RENDER — ANALYTICAL TOOLS
  // ============================================================
  
  function drawAnalyticalBackdrop() {
    // Triggers if opacity is 0.9 (or 1.0)
    if (heatmap.opacity < 0.01) return; 
    ctx.save();
    
    // Set the exact opacity and color
    ctx.globalAlpha = heatmap.opacity;
    ctx.fillStyle = '#0a0a0c'; // Locked to dark for analytical visibility
    
    // 1. Draw the core circular drum backdrop
    ctx.beginPath();
    ctx.arc(CX, CY, pxDist(CFG.R_DRUM), 0, Math.PI * 2);
    ctx.fill();

    // Helper for drawing clean, independent rounded rectangles
    const drawPad = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
    };

    const bandW = (REGIME === 'wide' ? 32 : (REGIME === 'compact' ? 18 : 14));
    const rOuter = pxDist(CFG.R_DRUM) + bandW;

    // 2. Floating Pad for the Color Bar (Right Side)
    if (heatmap.enabled && heatmap.ready && !state.showVectors && (heatmap.maxSigma > 0 || heatmap.maxDensity > 0 || heatmap.maxProduct > 0)) {
      const barW = 15;
      const barH = pxDist(60);
      const bx = CX + rOuter + 10; 
      const by = CY - barH / 2;
      
      // Nicely fitted padding around the color bar and its vertical text
      drawPad(bx - 12, by - 32, barW + 24, barH + 54, 8);
    }

    // 3. Floating Pad for the Caption (Bottom)
    if (heatmap.enabled || state.showVectors) {
      const textY = CY + pxDist(CFG.R_DRUM) + bandW + 25; 
      const isWaiting = (heatmap.enabled && !heatmap.ready && !state.showVectors);
      
      const padW = 320; // Reduced from 380 to perfectly frame the shorter text
      const padH = isWaiting ? 56 : 36;
      
      // Nicely fitted padding around the 1-line or 2-line caption
      drawPad(CX - padW / 2, textY - 8, padW, padH, 8);
    }

    ctx.restore();
  }

  function drawVectorField() {
    if (!state.showVectors) return;
    const res = 15; 
    const vScale = 0.15;
    const vt = CFG.V_T;
    const omega = state.omega;
    const step = (CFG.R_DRUM * 2) / res;
  
    // Now drawing on ctxOv!
    ctxOv.save();
    ctxOv.lineWidth = 1.2;
    for (let x = -CFG.R_DRUM; x <= CFG.R_DRUM; x += step) {
      for (let y = -CFG.R_DRUM; y <= CFG.R_DRUM; y += step) {
        if (x * x + y * y > CFG.R_DRUM * CFG.R_DRUM) continue;
        const px = X2px(x);
        const py = Y2px(y);
  
        const gravLen = vt * vScale * SCALE;
        drawSimpleArrow(px, py, px, py + gravLen, 'rgba(255, 220, 100, 0.4)');
        
        const dragVx = -omega * y;
        const dragVy = omega * x;
        const dx = dragVx * vScale * SCALE;
        const dy = -dragVy * vScale * SCALE;
        drawSimpleArrow(px, py, px + dx, py + dy, 'rgba(90, 200, 255, 0.4)');
  
        if (Math.abs(omega) > 0.01 || vt > 0) {
          drawSimpleArrow(px, py, px + dx, py + dy + gravLen, 'rgba(96, 255, 144, 0.8)');
        }
      }
    }
    ctxOv.restore();
  }

  function drawSimpleArrow(x1, y1, x2, y2, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const headlen = 4;
    const angle = Math.atan2(dy, dx);
    
    // Now drawing on ctxOv!
    ctxOv.strokeStyle = color;
    ctxOv.beginPath();
    ctxOv.moveTo(x1, y1);
    ctxOv.lineTo(x2, y2);
    ctxOv.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    ctxOv.moveTo(x2, y2);
    ctxOv.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    ctxOv.stroke();
  }

function drawRepresentativeOrbits() {
  if (typeof state.orbitSample === 'undefined' || !window.hudMasterOn || heatmap.mode !== 'orbits') {
    return;
  }

  const R_DRUM = CFG.R_DRUM;

  // 1. UPDATE THE SAMPLE EVERY 3.0 SECONDS
  const lastUpdate = state.lastOrbitUpdate || 0;
  if (state.t - lastUpdate > 3.0) {
    state.lastOrbitUpdate = state.t;
    
    const getContainedOrb = (p, isLev) => {
      if (!state.omega || Math.abs(state.omega) < 0.001) return null;
      const xc = p.vt / state.omega;
      const r = Math.hypot(p.x - xc, p.y);
      if (Math.abs(xc) + r > R_DRUM) return null; 
      return { p, xc, r, isLevitated: isLev };
    };

    // Filter all floating particles first
    const allValid = state.particles
      .filter(p => p.alive && !p.stuck)
      .map(p => {
        const isL = state.isLevitated(p);
        return getContainedOrb(p, isL);
      })
      .filter(o => o !== null);
    
    if (allValid.length === 0) {
      state.orbitSample = [];
      return;
    }

    const finalSelection = new Set();

    // --- CATEGORY 1: 5 Smallest Circumferences ---
    const bySize = [...allValid].sort((a, b) => a.r - b.r);
    bySize.slice(0, 5).forEach(o => finalSelection.add(o));

    // --- CATEGORY 2: Levitated Spread (Min/Max Xc + 8 internal) ---
    const levPool = allValid.filter(o => o.isLevitated).sort((a, b) => a.xc - b.xc);
    if (levPool.length > 0) {
      const count = 10;
      if (levPool.length <= count) {
        levPool.forEach(o => finalSelection.add(o));
      } else {
        for (let i = 0; i < count; i++) {
          const idx = Math.floor(i * (levPool.length - 1) / (count - 1));
          finalSelection.add(levPool[idx]);
        }
      }
    }

    // --- CATEGORY 3: Floating Spread (Min/Max Xc + 8 internal) ---
    const floatPool = allValid.filter(o => !o.isLevitated).sort((a, b) => a.xc - b.xc);
    if (floatPool.length > 0) {
      const count = 10;
      if (floatPool.length <= count) {
        floatPool.forEach(o => finalSelection.add(o));
      } else {
        for (let i = 0; i < count; i++) {
          const idx = Math.floor(i * (floatPool.length - 1) / (count - 1));
          finalSelection.add(floatPool[idx]);
        }
      }
    }

    state.orbitSample = Array.from(finalSelection);
  }

  // 2. RENDER THE STEADY SAMPLE
  if (state.orbitSample.length === 0) return;

  ctxOv.save();
  ctxOv.lineWidth = 1.2;
  ctxOv.setLineDash([]);

  state.orbitSample.forEach(orb => {
    if (!orb.p.alive || orb.p.stuck) return;

    const col = orb.isLevitated ? '0, 255, 255' : '255, 64, 64';
    ctxOv.strokeStyle = `rgba(${col}, 0.6)`;
    ctxOv.fillStyle = `rgba(${col}, 0.8)`;

    const pxCenter = X2px(orb.xc);
    const pyCenter = Y2px(0);
    const currentR = Math.hypot(orb.p.x - orb.xc, orb.p.y);
    const pxRadius = pxDist(currentR);

    ctxOv.beginPath();
    ctxOv.arc(pxCenter, pyCenter, pxRadius, 0, Math.PI * 2); 
    ctxOv.stroke();

    ctxOv.beginPath(); 
    ctxOv.arc(pxCenter, pyCenter, 2.0, 0, Math.PI * 2); 
    ctxOv.fill();
  });
  ctxOv.restore();
}


  function drawAggregateOrbits() {
    if (!TUNING.aggregate.flashOrbit) return;

    const rInnerPx = pxDist(CFG.R_DRUM) + 2;
    // Now drawing on ctxOv!
    ctxOv.save();
    ctxOv.beginPath(); ctxOv.arc(CX, CY, rInnerPx, 0, Math.PI * 2); ctxOv.clip();

    for (const agg of state.aggregates) {
      if (agg.merging || agg.stuck) continue;
      if (state.t < agg.orbitFlashEndsAt) {
        const absOm = Math.abs(state.omega);
        if (absOm > 1e-3) {
          const alpha = Math.max(0, (agg.orbitFlashEndsAt - state.t) / 2);
          const xcAgg = agg.vt / state.omega;
          const rOrb = Math.hypot(agg.x - xcAgg, agg.y);
          
          ctxOv.beginPath();
          ctxOv.arc(X2px(xcAgg), Y2px(0), pxDist(rOrb), 0, Math.PI * 2);
          ctxOv.strokeStyle = `rgba(200, 255, 220, ${alpha * 0.75})`;
          ctxOv.lineWidth = 1.2;
          ctxOv.stroke();

          const levParticles = eggLevitatedParticles();
          let sumVt = 0;
          for (const p of levParticles) sumVt += p.vt;
          const meanVt = levParticles.length > 0 ? (sumVt / levParticles.length) : agg.vt;
          const xcMean = meanVt / state.omega;

          const pxAggX = X2px(xcAgg);
          const pxMeanX = X2px(xcMean);
          const py0 = Y2px(0);

          ctxOv.strokeStyle = `rgba(255, 220, 100, ${alpha * 0.9})`;
          ctxOv.fillStyle = `rgba(255, 220, 100, ${alpha})`;
          ctxOv.lineWidth = 1.5;

          ctxOv.beginPath(); ctxOv.moveTo(pxAggX, py0); ctxOv.lineTo(pxMeanX, py0); ctxOv.stroke();
          ctxOv.beginPath(); ctxOv.arc(pxAggX, py0, 3, 0, Math.PI * 2); ctxOv.fill();
          ctxOv.beginPath(); ctxOv.arc(pxMeanX, py0, 3, 0, Math.PI * 2); ctxOv.fill();
        }
      }
    }

    // Growth merge orbit flash — two fading parents, one brightening child
    if (state.aggGrowMerging && TUNING.aggregate.flashOrbit) {
      const m    = state.aggGrowMerging;
      const absOm = Math.abs(state.omega);
      if (absOm > 1e-3) {
        const u    = Math.min(1, (state.t - m.startedAt) / m.dur);
        const ease = u * u * (3 - 2 * u);
    
        // Parent orbit centres
        const xcSmall = m.vtSmaller / state.omega;
        const xcLarge = m.vtLarger  / state.omega;
    
        // Radii from current aggregate positions
        const rSmall = Math.hypot(m.smaller.x - xcSmall, m.smaller.y);
        const rLarge = Math.hypot(m.larger.x  - xcLarge, m.larger.y);
    
        const py0 = Y2px(0);
    
        // Draw parent orbits — orange, fading out as merge progresses
        const parentAlpha = (1 - ease) * 0.85;
        if (parentAlpha > 0.01) {
          for (const [xc, r] of [[xcSmall, rSmall], [xcLarge, rLarge]]) {
            ctxOv.beginPath();
            ctxOv.arc(X2px(xc), py0, pxDist(r), 0, Math.PI * 2);
            ctxOv.strokeStyle = `rgba(255, 140, 40, ${parentAlpha.toFixed(3)})`;
            ctxOv.lineWidth = 1.5;
            ctxOv.stroke();
    
            // Orbit centre dot
            ctxOv.beginPath();
            ctxOv.arc(X2px(xc), py0, 3, 0, Math.PI * 2);
            ctxOv.fillStyle = `rgba(255, 140, 40, ${parentAlpha.toFixed(3)})`;
            ctxOv.fill();
          }
    
          // Connecting line between parent centres — shows the gap closing
          ctxOv.beginPath();
          ctxOv.moveTo(X2px(xcSmall), py0);
          ctxOv.lineTo(X2px(xcLarge), py0);
          ctxOv.strokeStyle = `rgba(255, 140, 40, ${(parentAlpha * 0.5).toFixed(3)})`;
          ctxOv.lineWidth = 1;
          ctxOv.setLineDash([3, 3]);
          ctxOv.stroke();
          ctxOv.setLineDash([]);
        }
    
        // Draw new merged orbit — cyan, brightening as merge completes
        const newVt  = (m.smaller.count * m.vtSmaller +
                        m.larger.count  * m.vtLarger) /
                       (m.smaller.count + m.larger.count);
        const xcNew  = newVt / state.omega;
        const rNew   = Math.hypot(m.larger.x - xcNew, m.larger.y);
        const newAlpha = ease * 0.85;
    
        if (newAlpha > 0.01) {
          ctxOv.beginPath();
          ctxOv.arc(X2px(xcNew), py0, pxDist(rNew), 0, Math.PI * 2);
          ctxOv.strokeStyle = `rgba(200, 255, 220, ${newAlpha.toFixed(3)})`;
          ctxOv.lineWidth = 1.5;
          ctxOv.stroke();
    
          ctxOv.beginPath();
          ctxOv.arc(X2px(xcNew), py0, 3, 0, Math.PI * 2);
          ctxOv.fillStyle = `rgba(200, 255, 220, ${newAlpha.toFixed(3)})`;
          ctxOv.fill();
        }
      }
    }
    ctxOv.restore();
  }

   /**
   * Computes a normalised 1-D Gaussian KDE over nGrid evenly-spaced points
   * in [xMin, xMax]. Returns a Float32Array of values in [0, 1].
   *
   * @param {number[]} samples - Input values (drum units).
   * @param {number}   xMin    - Left edge of the evaluation domain.
   * @param {number}   xMax    - Right edge of the evaluation domain.
   * @param {number}   nGrid   - Number of evaluation points.
   * @returns {Float32Array}
   */
  function _kde1D(samples, xMin, xMax, nGrid) {
    const n    = samples.length;
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const sig  = Math.sqrt(Math.max(0.1, samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n));
    const bw   = Math.max(0.5, 1.06 * sig * Math.pow(n, -0.2));
    const vals = new Float32Array(nGrid);
    let maxVal = 0;
    for (let i = 0; i < nGrid; i++) {
      const x = xMin + (i / (nGrid - 1)) * (xMax - xMin);
      let sum = 0;
      for (const s of samples) { const z = (x - s) / bw; sum += Math.exp(-0.5 * z * z); }
      vals[i] = sum;
      if (sum > maxVal) maxVal = sum;
    }
    if (maxVal > 0) for (let i = 0; i < nGrid; i++) vals[i] /= maxVal;
    return vals;
  }

  /**
   * Draws a KDE strip centred on pyCentre, one column per grid point.
   * Alpha at each column is kde[i] * maxAlpha.
   *
   * @param {Float32Array} kde      - Normalised KDE values from _kde1D.
   * @param {number}       x0drum  - Left domain edge in drum units.
   * @param {number}       x1drum  - Right domain edge in drum units.
   * @param {number}       nGrid   - Number of grid points.
   * @param {number}       pyCentre - Canvas y of the strip centre (pixels).
   * @param {number}       stripH  - Strip height in pixels.
   * @param {string}       rgb     - Colour as 'R,G,B' string.
   * @param {number}       maxAlpha - Maximum alpha at peak density.
   */
  function _drawKDEStrip(kde, x0drum, x1drum, nGrid, pyCentre, stripH, rgb, maxAlpha) {
    const pxStep = (X2px(x1drum) - X2px(x0drum)) / nGrid;
    const pxOrig = X2px(x0drum);
    for (let i = 0; i < nGrid; i++) {
      const alpha = kde[i] * maxAlpha;
      if (alpha < 0.01) continue;
      ctxOv.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
      ctxOv.fillRect(pxOrig + i * pxStep, pyCentre - stripH * 0.5, pxStep + 0.5, stripH);
    }
  }


  function drawVtProjection() {
    const mode = TUNING.particle.showVtProjection;
    if (!mode) return;

    const absOm = Math.abs(state.omega);
    if (absOm < 0.01) return;

    const py0 = Y2px(0);

    // ── MODE 1: PREDICTED — orbit centres implied by the current selector values ──
    if (mode === 1) {
      if (!state.distParams) return;
      const dist = state.distMode;
      const p    = state.distParams;

      ctxOv.save();
      ctxOv.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      ctxOv.fillStyle   = 'rgba(0, 255, 255, 0.7)';
      ctxOv.lineWidth   = 1.2;

      if (dist === 'bi') {
        const groups = [
          { vt: p.bi.vt1 || 10, s: p.bi.s1 ?? 0 },
          { vt: p.bi.vt2 || 40, s: p.bi.s2 ?? 0 },
        ];
        groups.forEach(group => {
          const delta  = group.vt * group.s;
          const points = [group.vt - delta, group.vt, group.vt + delta].map(v => X2px(v / state.omega));
          ctxOv.setLineDash([4, 4]);
          ctxOv.beginPath(); ctxOv.moveTo(points[0], py0); ctxOv.lineTo(points[2], py0); ctxOv.stroke();
          ctxOv.setLineDash([]);
          points.forEach((px, i) => {
            ctxOv.beginPath();
            ctxOv.arc(px, py0, i === 1 ? 4.5 : 2.2, 0, Math.PI * 2);
            if (i === 1) ctxOv.fill(); else ctxOv.stroke();
          });
        });

      } else if (dist === 'power') {
        const vMin   = p.power.vtMin || 5;
        const vMax   = p.power.vtMax || 50;
        const points = [vMin, vMax].map(v => X2px(v / state.omega));
        ctxOv.setLineDash([4, 4]);
        ctxOv.beginPath(); ctxOv.moveTo(points[0], py0); ctxOv.lineTo(points[1], py0); ctxOv.stroke();
        ctxOv.setLineDash([]);
        points.forEach(px => { ctxOv.beginPath(); ctxOv.arc(px, py0, 2.5, 0, Math.PI * 2); ctxOv.stroke(); });

      } else {
        const vtBase = CFG.V_T;
        const delta  = vtBase * CFG.VT_SPREAD;
        const points = [vtBase - delta, vtBase, vtBase + delta].map(v => X2px(v / state.omega));
        ctxOv.setLineDash([4, 4]);
        ctxOv.beginPath(); ctxOv.moveTo(points[0], py0); ctxOv.lineTo(points[2], py0); ctxOv.stroke();
        ctxOv.setLineDash([]);
        points.forEach((px, i) => {
          ctxOv.beginPath();
          ctxOv.arc(px, py0, i === 1 ? 5 : 2.5, 0, Math.PI * 2);
          if (i === 1) ctxOv.fill(); else ctxOv.stroke();
        });
      }
      ctxOv.restore();

    // ── MODE 2: LIVE — KDE band from particles and aggregates in the drum ────────
    } else {
      // Collect orbit centres of live free-floating particles
      const xcParts = [];
      for (const pt of state.particles) {
        if (!pt.alive || pt.stuck || pt.onTray || !pt.insideOnce) continue;
        xcParts.push(pt.vt / state.omega);
      }
      // Collect orbit centres of live free-floating aggregates
      const xcAggs = [];
      for (const agg of state.aggregates) {
        if (!agg.alive || agg.stuck || agg.onTray || agg.merging) continue;
        xcAggs.push(agg.vt / state.omega);
      }

      if (xcParts.length === 0 && xcAggs.length === 0) return;

      const nGrid  = 200;
      const stripH = pxDist(4); // 4 drum-units tall, centred on the equator

      ctxOv.save();
      ctxOv.beginPath();
      ctxOv.arc(CX, CY, pxDist(CFG.R_DRUM), 0, Math.PI * 2);
      ctxOv.clip();

      const hasAggs = xcAggs.length > 0;
      if (xcParts.length > 0) {
        const kde      = _kde1D(xcParts, 0, CFG.R_DRUM, nGrid);
        const pyCentre = hasAggs ? py0 + stripH * 0.25 : py0;
        const height   = hasAggs ? stripH * 0.5 : stripH;
        _drawKDEStrip(kde, 0, CFG.R_DRUM, nGrid, pyCentre, height, '0,220,255', 0.65);
      }
      if (hasAggs) {
        const kde = _kde1D(xcAggs, 0, CFG.R_DRUM, nGrid);
        _drawKDEStrip(kde, 0, CFG.R_DRUM, nGrid, py0 - stripH * 0.25, stripH * 0.5, '255,200,60', 0.65);
      }
      ctxOv.restore();
    }
  }

  /**
   * Draws an aggregate size distribution histogram on the left side of the drum.
   * 11 bins: monomer counts 10-100 (step 10) plus pebbles.
   * Y-axis scales dynamically with a minimum of 10.
   */
  function drawAggSizeHist() {
    if (!window.aggHistOn) return;
    
    // --- COMPUTE HISTOGRAM ---
    const bins = new Array(11).fill(0);
    for (const agg of state.aggregates) {
      if (!agg.alive || agg.merging) continue;
      const tier = Math.min(9, Math.max(0, Math.floor(((agg.count || 10) - 1) / 10)));
      bins[tier]++;
    }
    bins[10] = state.eggBallCount;
    
    const maxCount = 10; // fixed scale — bars cap at 10, labels show true count
    
    // --- LAYOUT (drum-units) ---
    const X0 = -88, X1 = -18;   // left and right edges
    const Y0 = -28, Y1 = 28;    // half height: was -55/55
    const totalW = X1 - X0;
    const totalH = Y1 - Y0;
    const slotW  = totalW / 11;
    const barW   = slotW * 0.70;
    const padX   = slotW * 0.15;
    const labelH = 8; // drum-units reserved below bars for x-axis labels
    
    // --- BARS ---
    ctxOv.save();
    ctxOv.beginPath();
    ctxOv.arc(CX, CY, pxDist(CFG.R_DRUM), 0, Math.PI * 2);
    ctxOv.clip();
    
    const barAreaH = totalH - labelH;
    
    for (let i = 0; i < 11; i++) {
      const isPebble = (i === 10);
      const frac     = Math.min(1, bins[i] / maxCount);
      const barH     = frac * barAreaH;
      const bx       = X0 + i * slotW + padX;
      const by       = Y0 + labelH;
      
      // Bar colour — gray-brown graduating to gold, bright gold for pebbles
      let col;
      if (isPebble) {
        col = 'rgba(255, 204, 85, 0.90)';
      } else {
        const t = i / 9;
        const r = Math.round(90  + t * 140);
        const g = Math.round(90  + t * 80);
        const b = Math.round(80  + t * 20);
        col = `rgba(${r},${g},${b},0.88)`;
      }
      
      if (bins[i] > 0) {
        ctxOv.fillStyle = col;
        ctxOv.fillRect(
          X2px(bx),
          Y2px(by + barH),
          pxDist(barW),
          pxDist(barH)
        );
        
        // Always show count label above bar
        const fontSize = Math.max(7, Math.min(11, pxDist(4.5)));
        ctxOv.fillStyle = isPebble ? '#ffee99' : '#d0d0c0';
        ctxOv.font = `${fontSize}px monospace`;
        ctxOv.textAlign = 'center';
        ctxOv.fillText(
          String(bins[i]),
          X2px(bx + barW / 2),
          Y2px(by + barH) - 2
        );
      }
      
      // X-axis label
      const fontSize = Math.max(7, Math.min(10, pxDist(4)));
      ctxOv.fillStyle = isPebble ? '#ffcc55' : 'rgba(180,180,160,0.85)';
      ctxOv.font = `${fontSize}px monospace`;
      ctxOv.textAlign = 'center';
      ctxOv.fillText(
        isPebble ? 'P' : String((i + 1) * 10),
        X2px(bx + barW / 2),
        Y2px(Y0) + fontSize * 0.5 + 1
      );
    }

    // --- BASELINE ---
    ctxOv.strokeStyle = 'rgba(180,180,160,0.5)';
    ctxOv.lineWidth = 1;
    ctxOv.beginPath();
    ctxOv.moveTo(X2px(X0), Y2px(Y0 + labelH));
    ctxOv.lineTo(X2px(X1), Y2px(Y0 + labelH));
    ctxOv.stroke();

    // --- TITLE ---
    const yFontSize = Math.max(7, Math.min(10, pxDist(4)));
    ctxOv.fillStyle = 'rgba(180,180,160,0.7)';
    ctxOv.font = `${yFontSize}px monospace`;
    ctxOv.textAlign = 'center';
    ctxOv.fillText('size dist.', X2px((X0 + X1) / 2), Y2px(Y1) + yFontSize);
    
    ctxOv.restore();
  }

/**
   * Returns the peak KDE density for vts over [xMin, xMax] using Silverman's
   * bandwidth — identical formula to drawKDE so peak values are directly
   * comparable and can be used as a shared normMax.
   *
   * @param {number[]} vts  - Terminal-velocity samples.
   * @param {number} xMin   - Left edge of the evaluation domain.
   * @param {number} xMax   - Right edge of the evaluation domain.
   * @returns {number} Peak density, or 0 for empty / degenerate input.
   */
  function computeKDEPeak(vts, xMin, xMax) {
    if (!vts || vts.length === 0) return 0;
    const n    = vts.length;
    const mean = vts.reduce((a, b) => a + b, 0) / n;
    const sig  = Math.sqrt(Math.max(0.1, vts.reduce((s, v) => s + (v - mean) ** 2, 0) / n));
    const bw   = Math.max(0.5, 1.06 * sig * Math.pow(n, -0.2));
    const nGrid = 60;
    let peak = 0;
    for (let i = 0; i < nGrid; i++) {
      const vt = xMin + (i / (nGrid - 1)) * (xMax - xMin);
      let sum = 0;
      for (const v of vts) { const z = (vt - v) / bw; sum += Math.exp(-0.5 * z * z); }
      if (sum > peak) peak = sum;
    }
    return peak;
  }

  /**
   * Draws a Gaussian-KDE curve (filled area + stroked outline) for a v_t
   * sample. Uses Silverman's rule for bandwidth and a fixed 60-point grid
   * over [xMin, xMax].
   *
   * @param {number[]} vts    - Terminal-velocity samples.
   * @param {string}   fill   - Fill style for the area under the curve.
   * @param {string}   stroke - Stroke style for the curve outline.
   * @param {number}   xMin   - Left edge of the KDE domain (cm/s).
   * @param {number}   xMax   - Right edge of the KDE domain (cm/s).
   * @param {number}   X0     - Left edge of the plot in drum-units.
   * @param {number}   totalW - Plot width in drum-units.
   * @param {number}   baseY  - Baseline y in drum-units.
   * @param {number}   plotH  - Plot height in drum-units.
   * @param {number}  [normMax=0] - When > 0, normalise to this peak instead
   *                               of the curve's own maximum. Pass the same
   *                               value to two calls to co-normalise them.
   */
  function drawKDE(vts, fill, stroke, xMin, xMax, X0, totalW, baseY, plotH, normMax = 0) {
    if (!vts || vts.length === 0) return;
    const n    = vts.length;
    const mean = vts.reduce((a, b) => a + b, 0) / n;
    const sig  = Math.sqrt(Math.max(0.1, vts.reduce((s, v) => s + (v - mean) ** 2, 0) / n));
    const bw   = Math.max(0.5, 1.06 * sig * Math.pow(n, -0.2));

    const nGrid = 60;
    const ky = new Array(nGrid);
    let kMax = 0;
    for (let i = 0; i < nGrid; i++) {
      const vt = xMin + (i / (nGrid - 1)) * (xMax - xMin);
      let sum = 0;
      for (const v of vts) { const z = (vt - v) / bw; sum += Math.exp(-0.5 * z * z); }
      ky[i] = sum;
      if (ky[i] > kMax) kMax = ky[i];
    }

    const effectiveMax = normMax > 0 ? normMax : kMax;
    if (effectiveMax > 0) {
      ctxOv.beginPath();
      ctxOv.moveTo(X2px(X0), Y2px(baseY));
      for (let i = 0; i < nGrid; i++) {
        const x = X0 + (i / (nGrid - 1)) * totalW;
        ctxOv.lineTo(X2px(x), Y2px(baseY + plotH * (ky[i] / effectiveMax)));
      }
      ctxOv.lineTo(X2px(X0 + totalW), Y2px(baseY));
      ctxOv.closePath();
      ctxOv.fillStyle = fill;
      ctxOv.fill();

      ctxOv.beginPath();
      for (let i = 0; i < nGrid; i++) {
        const x = X0 + (i / (nGrid - 1)) * totalW;
        const y = baseY + plotH * (ky[i] / effectiveMax);
        i === 0 ? ctxOv.moveTo(X2px(x), Y2px(y)) : ctxOv.lineTo(X2px(x), Y2px(y));
      }
      ctxOv.strokeStyle = stroke;
      ctxOv.lineWidth = 1.5;
      ctxOv.stroke();
    }
  }


  /**
   * Computes relative spread (coefficient of variation) of vt for a list
   * of objects with a .vt property. Returns 0 for fewer than 2 items.
   */
  function _vtSpread(list) {
    if (list.length < 2) return 0;
    const mean = list.reduce((s, p) => s + p.vt, 0) / list.length;
    if (mean < 1e-6) return 0;
    const variance = list.reduce((s, p) => s + (p.vt - mean) ** 2, 0) / list.length;
    return Math.sqrt(variance) / mean;
  }

  
  /**
   * Draws the v_t distribution of all floating particles (KDE, yellow),
   * levitated particles (KDE, green), and live aggregates (histogram, amber)
   * in the upper-left drum area, plus two spread bars below the x-axis:
   *   Lime bar  — all floating particles: width = 2σ, threshold line = 2·minSpread.
   *   Amber bar — live aggregates:        width = 2σ, threshold line = 2·minSpread.
   *
   * The yellow and green KDE curves are co-normalised to the same peak so
   * that their relative heights reflect relative population sizes.
   *
   * The number row and both spread bars are anchored in pixels relative to
   * the baseline so the below-axis cluster stays tight and cohesive at any
   * zoom level.
   */
  function drawVtDistribution() {
    if (!window.vtDistOn) return;

    // --- COLLECT DATA ---
    const levVts   = [];
    const floatVts = [];
    for (const p of state.particles) {
      if (!p.alive || p.stuck || p.merging || !p.insideOnce) continue;
      if (state.isLevitated(p)) levVts.push(p.vt);
      else                      floatVts.push(p.vt);
    }
    const allFloatVts = floatVts.concat(levVts); // all floating for spread bar
    const aggVts = [];
    for (const agg of state.aggregates) {
      if (!agg.alive || agg.merging) continue;
      aggVts.push(agg.vt);
    }

    // --- LAYOUT (drum-units) ---
    const X0 = -70, X1 = -10;
    const Y0 = 38,  Y1 = 68;
    const totalW = X1 - X0;
    const totalH = Y1 - Y0;
    const labelH = 7;
    const plotH  = totalH - labelH;
    const baseY  = Y0 + labelH;

    // --- EMPTY FRAME ---
    if (levVts.length === 0 && floatVts.length === 0 && aggVts.length === 0) {
      const fs = Math.max(7, Math.min(9, pxDist(3.5)));
      ctxOv.save();
      ctxOv.beginPath();
      ctxOv.arc(CX, CY, pxDist(CFG.R_DRUM), 0, Math.PI * 2);
      ctxOv.clip();
      ctxOv.strokeStyle = 'rgba(180,180,160,0.4)';
      ctxOv.lineWidth = 1;
      ctxOv.beginPath();
      ctxOv.moveTo(X2px(X0), Y2px(baseY));
      ctxOv.lineTo(X2px(X1), Y2px(baseY));
      ctxOv.stroke();
      ctxOv.fillStyle = 'rgba(180,180,160,0.7)';
      ctxOv.font = `${fs}px monospace`;
      ctxOv.textAlign = 'center';
      ctxOv.fillText('v_t dist.', X2px((X0 + X1) / 2), Y2px(Y1) - fs);
      ctxOv.restore();
      return;
    }

    // --- X-AXIS RANGE from actual data only ---
    // Derived entirely from particles and aggregates currently in the drum so
    // that changing the wing selectors mid-run never shifts the axis.
    // Falls back to a CFG snapshot only when the drum is empty.
    const allData = allFloatVts.concat(aggVts);
    let xMin, xMax;
    if (allData.length >= 2) {
      const dataMin = Math.min(...allData);
      const dataMax = Math.max(...allData);
      const pad = (dataMax - dataMin) * 0.15 || dataMin * 0.15 || 1;
      xMin = Math.max(0.1, dataMin - pad);
      xMax = dataMax + pad;
    } else {
      // Empty drum — one-time CFG snapshot, not continuously tracked.
      xMin = Math.max(0.1, CFG.V_T * 0.5);
      xMax = CFG.V_T * 1.5;
    }
    if (xMax <= xMin) return;

    const vtToX = vt => X0 + ((vt - xMin) / (xMax - xMin)) * totalW;

    // --- SPREAD-BAR GEOMETRY (drum-units) ---
    const barThick = 2.8;
    const barGap   = 1.5;

    // --- SPREAD-BAR HELPERS ---
    const _stats = (vts) => {
      if (vts.length < 2) return null;
      const mean = vts.reduce((s, v) => s + v, 0) / vts.length;
      const sig  = Math.sqrt(
        vts.reduce((s, v) => s + (v - mean) ** 2, 0) / vts.length
      );
      return { mean, sig };
    };

    // barTopPx is the bar's TOP edge in canvas pixels.
    // loVt / hiVt  — bar edges in vt space (cm/s).
    // threshFrac   — if > 0, draws a centred threshold line of half-width
    //                threshFrac × mean; pass 0 to suppress the line.
    // mean         — centre for the threshold line (ignored when threshFrac=0).
    const _drawSpreadBar = (barTopPx, loVt, hiVt, lineLeftVt, lineRightVt, fillCol, lineCol, showTick = true) => {
      const barHpx   = pxDist(barThick);
      const barMidPx = barTopPx + barHpx * 0.5;

      const barW = vtToX(hiVt) - vtToX(loVt);
      if (barW > 0) {
        ctxOv.fillStyle = fillCol;
        ctxOv.fillRect(X2px(vtToX(loVt)), barTopPx, pxDist(barW), barHpx);
      }

      if (lineLeftVt !== null && lineRightVt !== null) {
        const lineLeft  = vtToX(lineLeftVt);
        const lineRight = vtToX(lineRightVt);
        
        // Clamp line to plot boundaries
        const drawLeft  = Math.max(X0, Math.min(X1, lineLeft));
        const drawRight = Math.max(X0, Math.min(X1, lineRight));

        if (drawRight >= drawLeft) {
          ctxOv.strokeStyle = lineCol;
          ctxOv.lineWidth   = 1.5;
          ctxOv.beginPath();
          ctxOv.moveTo(X2px(drawLeft),  barMidPx);
          ctxOv.lineTo(X2px(drawRight), barMidPx);
          ctxOv.stroke();
          
          // Draw a small vertical tick at the start of the threshold
          if (showTick && lineLeft >= X0 && lineLeft <= X1) {
            ctxOv.beginPath();
            ctxOv.moveTo(X2px(lineLeft), barMidPx - barHpx * 0.8);
            ctxOv.lineTo(X2px(lineLeft), barMidPx + barHpx * 0.8);
            ctxOv.stroke();
          }
        }
      }
    };

    ctxOv.save();
    ctxOv.beginPath();
    ctxOv.arc(CX, CY, pxDist(CFG.R_DRUM), 0, Math.PI * 2);
    ctxOv.clip();

    // --- KDE CURVES (co-normalised: levitated and floating share the same peak) ---
    const sharedKMax = Math.max(
      computeKDEPeak(floatVts, xMin, xMax),
      computeKDEPeak(levVts,   xMin, xMax)
    );
    drawKDE(floatVts, 'rgba(255,238,51,0.10)', 'rgba(255,238,51,0.75)',
            xMin, xMax, X0, totalW, baseY, plotH, sharedKMax);
    drawKDE(levVts,   'rgba(64,255,112,0.15)', 'rgba(64,255,112,0.85)',
            xMin, xMax, X0, totalW, baseY, plotH, sharedKMax);

    // --- AGGREGATE HISTOGRAM ---
    if (aggVts.length > 0) {
      const nBins = 24;
      const bins  = new Array(nBins).fill(0);
      const binW  = (xMax - xMin) / nBins;
      for (const vt of aggVts) {
        const bi = Math.min(nBins - 1, Math.max(0, Math.floor((vt - xMin) / binW)));
        bins[bi]++;
      }
      const binMax = Math.max(1, ...bins);
      const bSlotW = totalW / nBins;
      const bBarW  = bSlotW * 0.65;
      const bPadX  = bSlotW * 0.175;
      for (let i = 0; i < nBins; i++) {
        if (bins[i] === 0) continue;
        const bx = X0 + i * bSlotW + bPadX;
        const bh = plotH * (bins[i] / binMax);
        ctxOv.fillStyle = 'rgba(230,160,50,0.70)';
        ctxOv.fillRect(X2px(bx), Y2px(baseY + bh), pxDist(bBarW), pxDist(bh));
      }
    }

    // --- BASELINE ---
    ctxOv.strokeStyle = 'rgba(180,180,160,0.4)';
    ctxOv.lineWidth = 1;
    ctxOv.beginPath();
    ctxOv.moveTo(X2px(X0), Y2px(baseY));
    ctxOv.lineTo(X2px(X1), Y2px(baseY));
    ctxOv.stroke();

    // --- X-AXIS LABELS (number row tucked just under the baseline) ---
    const fs      = Math.max(7, Math.min(9, pxDist(3.5)));
    const axisPy  = Y2px(baseY);
    const labelPy = axisPy + fs * 1.3;
    ctxOv.fillStyle = 'rgba(180,180,160,0.8)';
    ctxOv.font = `${fs}px monospace`;
    ctxOv.textAlign = 'center';
    for (const vt of [xMin, (xMin + xMax) / 2, xMax]) {
      ctxOv.fillText(Math.round(vt), X2px(vtToX(vt)), labelPy);
    }

    // --- TITLE ---
    ctxOv.fillStyle = 'rgba(180,180,160,0.7)';
    ctxOv.font = `${fs}px monospace`;
    ctxOv.textAlign = 'center';
    ctxOv.fillText('v_t dist.', X2px((X0 + X1) / 2), Y2px(Y1) - fs);

    // --- SPREAD BARS ---
    const partStats = _stats(allFloatVts);
    const aggStats  = aggVts.length >= 2 ? _stats(aggVts) : null;

    const barHpx    = pxDist(barThick);
    const bar1TopPx = labelPy + fs * 0.5;
    const bar2TopPx = bar1TopPx + barHpx + pxDist(barGap);

    // Particle bar (lime) — empirical 95.45% range
    if (allFloatVts.length >= 2) {
      const sorted = [...allFloatVts].sort((a, b) => a - b);
      const n      = sorted.length;
      const loVt   = sorted[Math.floor(0.02275 * (n - 1))];
      const hiVt   = sorted[Math.ceil(0.97725  * (n - 1))];
      const mean   = allFloatVts.reduce((s, v) => s + v, 0) / allFloatVts.length;
      const threshHalf = TUNING.aggregate.spreadThresh * mean * 0.5;


      _drawSpreadBar(
        bar1TopPx,
        loVt, hiVt,
        mean - threshHalf,  // threshold line centred on mean, half-width = spreadThresh*mean/2
        mean + threshHalf,
        'rgba(210,255,20,0.50)',
        'rgba(210,255,20,0.95)',
        false
      );
    }
    // Aggregate bar (amber) — full min-to-max range
    if (aggVts.length >= 2) {
      const aggMin  = Math.min(...aggVts);
      const aggMax  = Math.max(...aggVts);
      const aggMid  = (aggMin + aggMax) * 0.5;
      
      let lineLeftVt = null;
      let lineRightVt = null;

      if (window.aggGrowthStage === 2) {
        // Stage 2 (Bouncing): Draw target line from the spread threshold to the right edge
        let sumVt = 0, count = 0;
        for (const p of state.particles) {
          if (p.insideOnce) { sumVt += p.vt; count++; }
        }
        const meanVt = count > 0 ? sumVt / count : 1;
        const threshold = (TUNING.egg.vtSpreadMult || 2.0) * meanVt;
        
        lineLeftVt = threshold;
        lineRightVt = xMax;
      } else {
        // Stages 0, 1, 3: Draw a centered threshold width
        const threshAbs = TUNING.egg.widthThresh * 0.5 * aggMid;
        // lineLeftVt = aggMid - threshAbs;
        // lineRightVt = aggMid + threshAbs;
        lineLeftVt = null;
        lineRightVt = null;
      }

      _drawSpreadBar(
        bar2TopPx,
        aggMin, aggMax,
        lineLeftVt,
        lineRightVt,
        'rgba(230,160,50,0.45)',
        'rgba(230,160,50,0.90)',
        (window.aggGrowthStage === 2)
      );
    }

    ctxOv.restore();
  }

  /**
   * Draws ghost paths, selection ring, and click hint for ghost HUD mode.
   * Runs on ctxOv.
   */
  function drawGhostOverlay() {
    if (!window.ghostModeOn) return;

    const rInnerPx = pxDist(CFG.R_DRUM);
    ctxOv.save();
    ctxOv.beginPath();
    ctxOv.arc(CX, CY, rInnerPx, 0, Math.PI * 2);
    ctxOv.clip();

    const omega  = state.omega;
    const steps  = 40;
    const dt_sim = 0.05;

    for (const p of state.particles) {
      if (!p.alive || !p.isDiagnosticTarget) continue;

      const x   = X2px(p.x), y = Y2px(p.y);
      const rpx = Math.max(2, pxDist(1.0));

      // --- PATH 1: ACTUAL ORBIT (white solid) ---
      ctxOv.strokeStyle = 'rgba(255,255,255,0.8)';
      ctxOv.lineWidth = 1.5;
      ctxOv.setLineDash([]);
      ctxOv.beginPath();
      let ax = p.x, ay = p.y;
      ctxOv.moveTo(x, y);
      for (let i = 0; i < steps; i++) {
        ax += (-omega * ay)        * dt_sim;
        ay += ( omega * ax - p.vt) * dt_sim;
        ctxOv.lineTo(X2px(ax), Y2px(ay));
        if (ax * ax + ay * ay > CFG.R_DRUM * CFG.R_DRUM) break;
      }
      ctxOv.stroke();

      // --- PATH 2: GAS PATH (cyan dashed) ---
      ctxOv.strokeStyle = 'rgba(90,208,255,0.75)';
      ctxOv.lineWidth = 1.2;
      ctxOv.setLineDash([4, 2]);
      ctxOv.beginPath();
      let gx = p.x, gy = p.y;
      ctxOv.moveTo(x, y);
      for (let i = 0; i < steps; i++) {
        const ox = gx, oy = gy;
        gx += (-omega * oy) * dt_sim;
        gy += ( omega * ox) * dt_sim;
        ctxOv.lineTo(X2px(gx), Y2px(gy));
      }
      ctxOv.stroke();

      // --- PATH 3: VACUUM PATH (purple dashed) ---
      ctxOv.strokeStyle = 'rgba(255,90,255,0.75)';
      ctxOv.setLineDash([4, 2]);
      ctxOv.beginPath();
      let vx = p.x, vy = p.y, vvx = p.vx, vvy = p.vy;
      ctxOv.moveTo(x, y);
      for (let i = 0; i < steps; i++) {
        vvy -= 200 * dt_sim;
        vx  += vvx * dt_sim;
        vy  += vvy * dt_sim;
        ctxOv.lineTo(X2px(vx), Y2px(vy));
        if (vx * vx + vy * vy > CFG.R_DRUM * CFG.R_DRUM * 1.1) break;
      }
      ctxOv.stroke();
      ctxOv.setLineDash([]);

      // --- SELECTION RING (pulsing) ---
      const pulse = 0.6 + 0.4 * Math.sin(state.t * 5);
      ctxOv.strokeStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
      ctxOv.lineWidth = 1.5;
      ctxOv.beginPath();
      ctxOv.arc(x, y, rpx + 5, 0, Math.PI * 2);
      ctxOv.stroke();
    }

    // --- CLICK HINT ---
    const fs = Math.max(8, Math.min(11, pxDist(4)));
    ctxOv.font = `${fs}px monospace`;
    ctxOv.textAlign = 'center';
    ctxOv.fillStyle = 'rgba(200,200,190,0.65)';
    ctxOv.fillText('click to select particle', CX, CY - rInnerPx + fs * 1.6);

    ctxOv.restore();
  }

  /**
   * Draws closest-approach projections for the top-10 nearest aggregate pairs
   * during the next orbit. Updates at ~5 Hz via frame counter gate.
   * Runs on ctxOv.
   */

  // Module-level state for the encounter overlay
  let _encFrameCount = 0;
  let _encCache = []; // cached list of {ai, aj, xi, yi, xj, yj, dist} sorted by dist

  function _updateEncounterCache() {
    const omega = state.omega;
    if (Math.abs(omega) < 1e-3) { _encCache = []; return; }

    const live = state.aggregates.filter(a => a.alive && !a.stuck && !a.merging && !a.onTray);
    const n = live.length;
    if (n < 2) { _encCache = []; return; }

    const pairs = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ai = live[i], aj = live[j];

        // Orbit centres
        const xci = ai.vt / omega;
        const xcj = aj.vt / omega;

        // Orbit radii and phases
        const Ri  = Math.hypot(ai.x - xci, ai.y);
        const Rj  = Math.hypot(aj.x - xcj, aj.y);
        const phi_i = Math.atan2(ai.y, ai.x - xci);
        const phi_j = Math.atan2(aj.y, aj.x - xcj);

        // Delta orbit centre
        const dxc = xci - xcj;

        // Cross-term coefficients
        // d²(θ) = C + 2·dxc·(P·cos θ - Q·sin θ)
        // where P = Ri·cos(phi_i) - Rj·cos(phi_j)
        //       Q = Ri·sin(phi_i) - Rj·sin(phi_j)
        const P = Ri * Math.cos(phi_i) - Rj * Math.cos(phi_j);
        const Q = Ri * Math.sin(phi_i) - Rj * Math.sin(phi_j);

        // Minimum distance angle — two candidates
        let thetaMin;
        if (Math.abs(P) < 1e-9 && Math.abs(Q) < 1e-9) {
          // Concentric / same phase — constant distance
          thetaMin = 0;
        } else {
          thetaMin = Math.atan2(-Q, P);
        }

        // Evaluate both candidates, keep the one with smaller d²
        let bestD2 = Infinity, bestTheta = thetaMin;
        for (const th of [thetaMin, thetaMin + Math.PI]) {
          const xi = xci + Ri * Math.cos(phi_i + th);
          const yi =       Ri * Math.sin(phi_i + th);
          const xj = xcj + Rj * Math.cos(phi_j + th);
          const yj =       Rj * Math.sin(phi_j + th);
          const dx = xi - xj, dy = yi - yj;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestTheta = th; }
        }

        // Closest approach positions
        const xi = xci + Ri * Math.cos(phi_i + bestTheta);
        const yi =       Ri * Math.sin(phi_i + bestTheta);
        const xj = xcj + Rj * Math.cos(phi_j + bestTheta);
        const yj =       Rj * Math.sin(phi_j + bestTheta);

        pairs.push({ ai, aj, xi, yi, xj, yj, dist: Math.sqrt(bestD2), bestTheta, xci, xcj, Ri, Rj, phi_i, phi_j });
      }
    }

    // Keep top shortest
    pairs.sort((a, b) => a.dist - b.dist);
    _encCache = pairs.slice(0, TUNING.encounters.showPairs);
  }

  function drawAggregateEncounters() {
    if (!window.encountersOn) return;

    // Gate cache updates to ~5 Hz
    _encFrameCount++;
    if (_encFrameCount % 12 === 0) _updateEncounterCache();
    if (_encCache.length === 0 && state.aggregates.length >= 2) _updateEncounterCache();
    
    // Compute phase remaining to closest approach for the top pair.
    // Runs every render frame so main.js can use it for slow-mo gating.
    if (_encCache.length > 0 && Math.abs(state.omega) > 1e-3) {
      const enc = _encCache[0];
      if (enc.ai.alive && enc.aj.alive) {
        const curPhiI = Math.atan2(enc.ai.y, enc.ai.x - enc.xci);
        const advance  = ((curPhiI - enc.phi_i) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        window._nearestEncounterPhase =
          Math.abs(((enc.bestTheta - advance + Math.PI) % (2 * Math.PI)) - Math.PI);
      }
    } else {
      window._nearestEncounterPhase = Infinity;
    }
    
    if (_encCache.length === 0) return;

    const NEAR_THRESHOLD = 0.15; // rad — within this of bestTheta counts as "at closest approach"
    const FLASH_DUR      = 0.35; // s

    const rInnerPx = pxDist(CFG.R_DRUM);
    ctxOv.save();
    ctxOv.beginPath();
    ctxOv.arc(CX, CY, rInnerPx, 0, Math.PI * 2);
    ctxOv.clip();

    const omega = state.omega;
    const arcPairColors = []; // one entry per arc pair, filled during the k-loop
    
    for (let k = 0; k < _encCache.length; k++) {
      const enc = _encCache[k];
      const { ai, aj, xi, yi, xj, yj, dist, bestTheta, xci, xcj, Ri, Rj, phi_i, phi_j } = enc;

      // --- CLOSEST APPROACH DETECTION (every frame, using live positions) ---
      const curPhiI = Math.atan2(ai.y, ai.x - enc.xci);
      const advance = ((curPhiI - enc.phi_i) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const distToApproach = Math.abs(((enc.bestTheta - advance + Math.PI) % (2 * Math.PI)) - Math.PI);
      if (distToApproach < NEAR_THRESHOLD) {
        enc.flashEndsAt = state.t + FLASH_DUR;
      }

      const flash = enc.flashEndsAt ? Math.max(0, (enc.flashEndsAt - state.t) / FLASH_DUR) : 0;

      // --- COLOUR ---
      const sumR = ai.r + aj.r;
      let lineColor, circleColor;
      // Green = collision predicted (dist < sumR), takes precedence at any rank.
      // Amber = in the top arcPairs but not colliding.
      // Gray-purple = all others.
      const isColliding = dist < sumR;
      const isArcPair   = k < TUNING.encounters.arcPairs;
      if (flash > 0) {
        if (isColliding) {
          lineColor   = `rgba(64,255,112,${(0.85 + 0.15 * flash).toFixed(2)})`;
          circleColor = `rgba(64,255,112,${(0.55 + 0.45 * flash).toFixed(2)})`;
        } else if (isArcPair) {
          lineColor   = `rgba(255,200,60,${(0.75 + 0.10 * flash).toFixed(2)})`;
          circleColor = `rgba(255,200,60,${(0.40 + 0.15 * flash).toFixed(2)})`;
        } else {
          lineColor   = `rgba(180,180,200,${(0.35 + 0.15 * flash).toFixed(2)})`;
          circleColor = `rgba(180,180,200,${(0.18 + 0.10 * flash).toFixed(2)})`;
        }
      } else if (isColliding) {
        lineColor   = 'rgba(64,255,112,0.85)';
        circleColor = 'rgba(64,255,112,0.55)';
      } else if (isArcPair) {
        lineColor   = 'rgba(255,200,60,0.75)';
        circleColor = 'rgba(255,200,60,0.40)';
      } else {
        lineColor   = 'rgba(180,180,200,0.35)';
        circleColor = 'rgba(180,180,200,0.18)';
      }
      if (k < TUNING.encounters.arcPairs) arcPairColors[k] = lineColor;

      const pxi = X2px(xi), pyi = Y2px(yi);
      const pxj = X2px(xj), pyj = Y2px(yj);
      const pri = pxDist(ai.r);
      const prj = pxDist(aj.r);

      // --- CONNECTING LINE ---
      ctxOv.strokeStyle = lineColor;
      ctxOv.lineWidth = flash > 0 ? 1.8 : 1.0;
      ctxOv.setLineDash(flash > 0 ? [] : [3, 2]);
      ctxOv.beginPath();
      ctxOv.moveTo(pxi, pyi);
      ctxOv.lineTo(pxj, pyj);
      ctxOv.stroke();
      ctxOv.setLineDash([]);

      // --- CLOSEST-APPROACH CIRCLES ---
      for (const [cx2, cy2, r2] of [[pxi, pyi, pri], [pxj, pyj, prj]]) {
        ctxOv.fillStyle = circleColor;
        ctxOv.beginPath();
        ctxOv.arc(cx2, cy2, r2, 0, Math.PI * 2);
        ctxOv.fill();
        ctxOv.strokeStyle = lineColor;
        ctxOv.lineWidth = flash > 0 ? 2.0 : 1.2;
        ctxOv.beginPath();
        ctxOv.arc(cx2, cy2, r2, 0, Math.PI * 2);
        ctxOv.stroke();
      }

      // --- DISTANCE LABEL (top 3 only) ---
      if (k < 3) {
        const mx = (pxi + pxj) * 0.5;
        const my = (pyi + pyj) * 0.5;
        const fs = Math.max(7, Math.min(9, pxDist(3.5)));
        ctxOv.font = `${flash > 0 ? 'bold ' : ''}${fs}px monospace`;
        ctxOv.textAlign = 'center';
        ctxOv.fillStyle = lineColor;
        ctxOv.fillText(dist.toFixed(1), mx, my - 3);
        }
    }

    // Arc from current position to closest approach for the top arcPairs pairs.
    const arcCount = Math.min(TUNING.encounters.arcPairs, _encCache.length);
    for (let ka = 0; ka < arcCount; ka++) {
      const enc = _encCache[ka];
      if (Math.abs(omega) < 1e-3) break;
      const py0 = Y2px(0);
      ctxOv.strokeStyle = arcPairColors[ka] || 'rgba(180,180,200,0.35)';
      ctxOv.lineWidth   = 1.5;
      ctxOv.setLineDash([]);
      for (const [agg, xc, r, phi] of [
        [enc.ai, enc.xci, enc.Ri, enc.phi_i],
        [enc.aj, enc.xcj, enc.Rj, enc.phi_j],
      ]) {
        const curPhi = Math.atan2(agg.y, agg.x - xc);
        const endPhi = phi + enc.bestTheta;
        const ccw    = omega > 0;
        ctxOv.beginPath();
        ctxOv.arc(X2px(xc), py0, pxDist(r), -curPhi, -endPhi, ccw);
        ctxOv.stroke();
      }
    }
    ctxOv.restore();
  }

  /**
   * Draws the collection tray sliding into the drum.
   * Leading edge enters from the right rim and sweeps left as progress 0 → 1.
   * At progress = 1 the tray spans the full drum diameter at y = TUNING.tray.yPos.
   */
  /**
   * Draws the collection tray as a thin metallic blade.
   * Reads endpoints from window.trayEndpoints() so render and physics
   * stay in sync. The blade is rendered as three parallel strokes:
   * a dark underside line, a flat steel gradient body, and a bright
   * top-edge highlight — plus a small cap across the leading tip.
   */
  function drawTray() {
    const ep = window.trayEndpoints && window.trayEndpoints();
    if (!ep) return;

    const ox = X2px(ep.hx), oy = Y2px(ep.hy);
    const ix = X2px(ep.tx), iy = Y2px(ep.ty);

    const R_px = pxDist(CFG.R_DRUM);
    const th   = Math.max(3, pxDist(TUNING.tray.thickness));

    // Perpendicular unit vector (canvas pixels) to the tray axis,
    // 90° CCW from (hinge → tip). Used to offset the edge lines.
    const dx = ix - ox, dy = iy - oy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;

    ctx.save();

    // Clip to drum interior so the tray cannot poke past the rim.
    ctx.beginPath();
    ctx.arc(CX, CY, R_px - 1, 0, Math.PI * 2);
    ctx.clip();

    ctx.lineCap = 'butt';

    // 1. Dark underside line
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.moveTo(ox + nx * th * 0.5, oy + ny * th * 0.5);
    ctx.lineTo(ix + nx * th * 0.5, iy + ny * th * 0.5);
    ctx.stroke();

    // 2. Body fill — flat steel gradient across the thickness
    const bgx = ox + nx * th, bgy = oy + ny * th;
    const tgx = ox - nx * th, tgy = oy - ny * th;
    const g = ctx.createLinearGradient(bgx, bgy, tgx, tgy);
    g.addColorStop(0.0, '#2a2a2e');   // dark underside
    g.addColorStop(0.3, '#7a7a82');
    g.addColorStop(0.6, '#c8c8cc');
    g.addColorStop(1.0, '#f4f4f6');   // bright top edge
    ctx.strokeStyle = g;
    ctx.lineWidth = th;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ix, iy);
    ctx.stroke();

    // 3. Bright top-edge highlight
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(ox - nx * th * 0.5, oy - ny * th * 0.5);
    ctx.lineTo(ix - nx * th * 0.5, iy - ny * th * 0.5);
    ctx.stroke();

    // 4. Tip cap — small darker line across the leading edge
    const ang = Math.atan2(dy, dx) + Math.PI / 2;
    const hw  = th * 0.55;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(40,40,50,0.9)';
    ctx.beginPath();
    ctx.moveTo(ix + Math.cos(ang) * hw, iy + Math.sin(ang) * hw);
    ctx.lineTo(ix - Math.cos(ang) * hw, iy - Math.sin(ang) * hw);
    ctx.stroke();

    ctx.restore();
  }  

  // ============================================================
  // SECTION: RENDER — MASTER DRAW
  // ============================================================
  /** Master draw function: clears the canvas and calls all draw functions in order. */
  function draw() {

    // --- ZOOM TRANSITION ---
    if (window.zoomOn && _zoomT < 1) {
      _zoomDir = 1;
    } else if (!window.zoomOn && _zoomT > 0) {
      _zoomDir = -1;
    } else {
      _zoomDir = 0;
    }
    if (_zoomDir !== 0) {
      _zoomT = Math.max(0, Math.min(1, _zoomT + _zoomDir * (1 / (ZOOM_DUR * 60))));
      const ease = _zoomT * _zoomT * (3 - 2 * _zoomT);
      const { zCX, zCY, zScale } = _computeZoomTarget();
      CX    = _baseCX    + (_zoomCX    - _baseCX)    * ease;
      CY    = _baseCY    + (_zoomCY    - _baseCY)    * ease;
      SCALE = _baseSCALE + (_zoomSCALE - _baseSCALE) * ease;
      window.CX = CX; window.CY = CY; window.SCALE = SCALE;
      _zoomCX = zCX; _zoomCY = zCY; _zoomSCALE = zScale;
    } else if (window.zoomOn) {
      const { zCX, zCY, zScale } = _computeZoomTarget();
      CX = zCX; CY = zCY; SCALE = zScale;
      window.CX = CX; window.CY = CY; window.SCALE = SCALE;
    }
    const inZoom = window.zoomOn || _zoomT > 0;

    // --- CLEAR ---
    ctx.clearRect(0, 0, W, H);

    // --- STRUCTURAL CHROME (suppressed in zoom) ---
    if (!inZoom) {
      if (REGIME !== 'portrait') {
        drawWing(GEO.wingLeftX, GEO.wingTop, GEO.wingLeftW, GEO.wingBot - GEO.wingTop);
        drawWing(GEO.wingRightX, GEO.wingTop, GEO.wingW, GEO.wingBot - GEO.wingTop);
      } else {
        drawWing(GEO.wingLeftX, GEO.wingTop, GEO.wingW, (GEO.wingBot - GEO.wingTop));
      }
      // Back to front: support (feet / Pfeiffer cradle), injector extrusion,
      // then the display bar and the drum, so the rotating extrusion passes
      // between the support and the display mounting and behind the band.
      // Pfeiffer: the bar goes before ports and band so the rim ports pass
      // in front of it (the chamber hangs free).
      const pf = isPfeifferTheme();
      if (GEO.drawFeet) {
        drawOmegaFeet();
        if (pf) drawPfeifferCradle(pxDist(CFG.R_DRUM) + bandOutside());
      }
      drawInjectorAssembly();
      if (pf) {
        if (REGIME !== 'portrait') drawOmegaBar();
        drawPfeifferPorts();
      }
      drawSteelBand();
      if (!pf && REGIME !== 'portrait') drawOmegaBar();
    }

    // --- DRUM INTERIOR ---
    drawBackplate();
    drawTrails();
    drawDrumInterior();
    if (!inZoom && state.solar.phase !== 'final_move' && state.solar.phase !== 'final_view') drawAxis();
    drawTray();
    drawParticles();
    drawAggregates();
    drawMergeStreaks();
    drawGoldenBalls();

    // --- ANALYTICS BACKDROP & OVERLAYS ---
    // All HUD overlays are suppressed during the solar system finale so
    // nothing competes with the rising system view.
    const _solarFinal = state.solar.phase === 'final_move' ||
                        state.solar.phase === 'final_view';
    if (_solarFinal) {
      ctxOv.clearRect(0, 0, W, H);
    }
    if (!_solarFinal) drawAnalyticalBackdrop();

    // --- GLARE & BOLT RING (suppressed in zoom) ---
    if (!inZoom) {
      drawGlare();
      drawBoltRing();
    }

    // MUST execute before overlay tools, because it clears ctxOv!
    drawViewport();

    // --- EXPERT HUD OVERLAY (Heatmap & Captions) ---
    if (!_solarFinal && (heatmap.enabled || state.showVectors)) {
      if (heatmap.enabled && heatmap.ready && !state.showVectors && (heatmap.maxSigma > 0 || heatmap.maxDensity > 0 || heatmap.maxProduct > 0)) {
        const res = heatmap.resolution;
        const cellW = pxDist(200 / res);
        const cellH = pxDist(200 / res);
        const startX = X2px(-100);
        const startY = Y2px(100);

        ctxOv.save();
        ctxOv.beginPath();
        ctxOv.arc(CX, CY, pxDist(CFG.R_DRUM), 0, Math.PI * 2);
        ctxOv.clip();
        ctxOv.globalAlpha = 0.6;
        ctxOv.globalAlpha = 0.5 + heatmap.opacity * 0.35;

        for (let gy = 0; gy < res; gy++) {
          for (let gx = 0; gx < res; gx++) {
            const idx = gy * res + gx;
            let u = 0;
            if      (heatmap.mode === 'dispersion') u = heatmap.maxSigma   > 0 ? heatmap.data[idx]     / heatmap.maxSigma   : 0;
            else if (heatmap.mode === 'density')    u = heatmap.maxDensity > 0 ? heatmap.densData[idx] / heatmap.maxDensity : 0;
            else if (heatmap.mode === 'product')    u = heatmap.maxProduct > 0 ? heatmap.prodData[idx] / heatmap.maxProduct : 0;

            if (u <= 0) continue;
            const r = Math.floor(0  + 255 * u);
            const g = Math.floor(16 + 239 * u);
            const b = Math.floor(64 + 191 * u);
            ctxOv.fillStyle = `rgb(${r},${g},${b})`;
            ctxOv.fillRect(startX + gx * cellW, startY + gy * cellH, cellW + 1, cellH + 1);
          }
        }
        ctxOv.restore();

        // DRAW COLOR BAR
        const rOuter = pxDist(CFG.R_DRUM) + (REGIME === 'wide' ? 32 : (REGIME === 'compact' ? 18 : 14));
        const barW = 15;
        const barH = pxDist(60);
        const bx = CX + rOuter + 10;
        const by = CY - barH / 2;

        const grad = ctxOv.createLinearGradient(0, by + barH, 0, by);
        grad.addColorStop(0, 'rgb(0,16,64)');
        grad.addColorStop(1, 'rgb(255,255,255)');
        ctxOv.fillStyle = grad;
        ctxOv.fillRect(bx, by, barW, barH);
        ctxOv.strokeStyle = 'rgba(255,255,255,0.3)';
        ctxOv.lineWidth = 1;
        ctxOv.strokeRect(bx, by, barW, barH);

        ctxOv.save();
        ctxOv.globalAlpha = 0.7;
        ctxOv.fillStyle = (PAL.name === 'light') ? '#000000' : '#ffffff';
        ctxOv.font = 'bold 11px monospace';
        ctxOv.textAlign = 'center';

        let topL = "", unitL = "";
        if      (heatmap.mode === 'dispersion') { topL = heatmap.maxSigma.toFixed(1);   unitL = "cm/s (σ)"; }
        else if (heatmap.mode === 'density')    { topL = heatmap.maxDensity.toFixed(1); unitL = "parts/cell (ρ)"; }
        else if (heatmap.mode === 'product')    { topL = heatmap.maxProduct.toFixed(1); unitL = "collisions"; }

        ctxOv.fillText(topL,  bx + barW/2, by - 8);
        ctxOv.fillText("0.0", bx + barW/2, by + barH + 14);
        ctxOv.font = '8px monospace';
        ctxOv.fillText(unitL, bx + barW/2, by - 20);
        ctxOv.restore();
      }

      // DRAW CAPTION
      ctxOv.save();
      ctxOv.globalAlpha = 0.7;
      const hudColor = (PAL.name === 'light') ? '#000000' : '#ffffff';
      ctxOv.fillStyle = hudColor;

      if (PAL.name !== 'light') {
        ctxOv.shadowColor = 'rgba(255, 255, 255, 0.4)';
        ctxOv.shadowBlur = 4;
      }

      ctxOv.font = 'bold 20px "Courier New", monospace';
      ctxOv.textAlign = 'center';
      ctxOv.textBaseline = 'top';

      let caption = "";
      if (state.showVectors) {
        caption = "vector field";
      } else if (window.ghostModeOn) {
        caption = "ghost paths";
      } else if (heatmap.mode === 'orbits') {
        caption = "selected orbits";
      } else if (heatmap.mode === 'dispersion') {
        caption = "velocity variance σ_v";
      } else if (heatmap.mode === 'density') {
        caption = "particle density n_p";
      } else if (heatmap.mode === 'product') {
        caption = "coll. proxy n_p · σ_v";
      }

      const rInnerCaption = pxDist(CFG.R_DRUM);
      const bandWidthCaption = (REGIME === 'wide' ? 32 : (REGIME === 'compact' ? 18 : 14));
      const textY = CY + rInnerCaption + bandWidthCaption + 25;

      ctxOv.fillText(caption, CX, textY);

      if (heatmap.enabled && !heatmap.ready && !state.showVectors) {
        ctxOv.font = 'italic 13px "Courier New", monospace';
        ctxOv.globalAlpha = 0.7;
        ctxOv.fillText("(accumulating orbital data...)", CX, textY + 28);
      }
      ctxOv.restore();
    }

    // --- OVERLAY LINE-ART ---
    if (!_solarFinal) {
      drawVectorField();
      drawRepresentativeOrbits();
      drawAggregateOrbits();
      drawVtProjection();
      drawAggSizeHist();
      drawVtDistribution();
      drawGhostOverlay();
      drawAggregateEncounters();
    }
  }
  
  

  /**
   * Linearly interpolates between two integer channel values.
   *
   * @param {number} a - Start channel value (0–255).
   * @param {number} b - End channel value (0–255).
   * @param {number} t - Blend factor in [0, 1].
   * @returns {number} Rounded interpolated channel value.
   */
  function rgbLerp(a, b, t) { return Math.round(a + (b - a) * t); }
  /**
   * Blends two CSS hex colour strings by factor t.
   *
   * @param {string} h1 - Start hex colour (e.g. '#1a2b3c').
   * @param {string} h2 - End hex colour.
   * @param {number} t - Blend factor in [0, 1].
   * @returns {string} Blended hex colour string.
   */
  function mixHex(h1, h2, t) {
    const c1 = parseInt(h1.slice(1), 16), c2 = parseInt(h2.slice(1), 16);
    const r = rgbLerp((c1>>16)&0xff, (c2>>16)&0xff, t);
    const g = rgbLerp((c1>>8)&0xff, (c2>>8)&0xff, t);
    const b = rgbLerp(c1&0xff, c2&0xff, t);
    return '#' + ((1<<24) | (r<<16) | (g<<8) | b).toString(16).slice(1);
  }

  // ============================================================


  /** Builds the SVG omega arrow as hint how to operate. */
  function buildOmegaHint() {
    const svg = document.getElementById('omegaCtl');
    if (!svg) return;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    // Check layout mode to adjust distance from the drum dynamically
    const isPortrait = document.body.classList.contains('regime-portrait');
    const rInnerBase = isPortrait ? 1.05 : 1.15;
    const rOuterBase = isPortrait ? 1.15 : 1.25;

    const r1 = CFG.R_DRUM * SCALE * rInnerBase; 
    const r2 = CFG.R_DRUM * SCALE * rOuterBase; 
    const rm = (r1 + r2) / 2;             
    
    const flare = 8;        
    const rIn = r1 - flare;
    const rOut = r2 + flare;
    const headA = 0.12;     

    const aMid = Math.PI; 
    const span = 0.4;     

    const aTop = aMid - span;
    const aBot = aMid + span;
    const aTopHead = aTop - headA;
    const aBotHead = aBot + headA;

    const p1x = CX + r1 * Math.cos(aBot),     p1y = CY + r1 * Math.sin(aBot);     
    const p2x = CX + r1 * Math.cos(aTop),     p2y = CY + r1 * Math.sin(aTop);     
    const p3x = CX + rIn * Math.cos(aTop),    p3y = CY + rIn * Math.sin(aTop);    
    const p4x = CX + rm * Math.cos(aTopHead), p4y = CY + rm * Math.sin(aTopHead); 
    const p5x = CX + rOut * Math.cos(aTop),   p5y = CY + rOut * Math.sin(aTop);   
    const p6x = CX + r2 * Math.cos(aTop),     p6y = CY + r2 * Math.sin(aTop);     
    const p7x = CX + r2 * Math.cos(aBot),     p7y = CY + r2 * Math.sin(aBot);     
    const p8x = CX + rOut * Math.cos(aBot),   p8y = CY + rOut * Math.sin(aBot);   
    const p9x = CX + rm * Math.cos(aBotHead), p9y = CY + rm * Math.sin(aBotHead); 
    const p10x = CX + rIn * Math.cos(aBot),   p10y = CY + rIn * Math.sin(aBot);   

    const pathD = `M ${p1x} ${p1y} ` +
                  `A ${r1} ${r1} 0 0 0 ${p2x} ${p2y} ` +                                 
                  `L ${p3x} ${p3y} L ${p4x} ${p4y} L ${p5x} ${p5y} L ${p6x} ${p6y} ` +   
                  `A ${r2} ${r2} 0 0 1 ${p7x} ${p7y} ` +                                 
                  `L ${p8x} ${p8y} L ${p9x} ${p9y} L ${p10x} ${p10y} Z`;                 

    svg.innerHTML = `
      <defs>
        <linearGradient id="gradFatGreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#a0ffb8"/>
          <stop offset="0.5" stop-color="#2cc058"/>
          <stop offset="1" stop-color="#0e5020"/>
        </linearGradient>
      </defs>
      <path d="${pathD}" 
            fill="url(#gradFatGreen)" 
            stroke="#2a2a32" 
            stroke-width="1.5" 
            style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.7)); pointer-events: auto; cursor: help;" />
    `;
  }

  window.cv            = cv;
  window.ctxOv         = ctxOv;
  window.W             = W;
  window.H             = H;
  window.DPR           = DPR;
  window.CX            = CX;
  window.CY            = CY;
  window.SCALE         = SCALE;
  window.GEO           = GEO;
  window.REGIME        = REGIME;
  window.layout        = layout;
  window.draw          = draw;
  window.drawGlobes    = drawGlobes;
  window.recordTrails  = recordTrails;
  window.X2px          = X2px;
  window.Y2px          = Y2px;
  window.pxDist        = pxDist;
  window.visualSizeFactor = visualSizeFactor;
  window.angleSwept    = angleSwept;
  window.buildOmegaHint = buildOmegaHint;
  window.resetEncounterCache = () => { _encCache = []; _encFrameCount = 0; };
  window._zoomRestore  = _zoomRestore;
})();
