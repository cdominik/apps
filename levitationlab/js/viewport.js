/**
 * @file viewport.js
 * @description
 *   The Microscope and Chart viewport subsystem: rule evaluation, slide/
 *   crossfade animation, off-screen canvas rendering, and the video element
 *   lifecycle. Also polls the aggregate counter for viewport rule context.
 *
 * Exposes globals: VIEWPORT, updateViewport, drawViewport,
 *                  pollAggregateCounter, hideVideoElement
 * Reads globals:   TUNING, CFG, PAL, state, heatmap,
 *                  CX, CY, W, H, SCALE, REGIME, ctx, ctxOv,
 *                  X2px, Y2px, pxDist, draw,
 *                  GAME, CHALLENGE, eggLevitatedParticles
 */
(() => {
  'use strict';

  // Button refs reused from DOM
  const btnStart = document.getElementById('btnStart');
  const btnReset = document.getElementById('btnReset');

  // SECTION: VIEWPORT SUBSYSTEM
  // ============================================================
  const VIEWPORT = {
    active: null,
    phase: 'hidden',
    phaseStart: 0,
    slideU: 0,
    currentAsset: null,
    pendingAsset: null,
    crossfadeStart: -1,
    lastSwitchAt: -10,
    lastEvalAt: 0,
    aggregatesEverFormed: 0,
    lastInjectedAt: -1,
    wallT: 0,
    lastRuleKey: null,
  };

  let VIEWPORT_RULES = {
    microscope: [{ id: 'fallback', asset: null }],
    chart: [{ id: 'fallback', asset: null }],
  };

  const VIEWPORT_RENDERERS = {};
  window.registerViewportRenderer = (name, fn) => {
    VIEWPORT_RENDERERS[name] = fn;
  };

  VIEWPORT_RENDERERS['__fallback__'] = function(g, w, h, c, t) {
    g.fillStyle = '#001008'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#60ff90';
    g.font = 'bold ' + Math.round(h * 0.06) + 'px "Courier New", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('NO SIGNAL', w/2, h/2);
  };

  window.setViewportRules = (rules) => {
    if (rules && typeof rules === 'object') {
      if (Array.isArray(rules.microscope)) VIEWPORT_RULES.microscope = rules.microscope;
      if (Array.isArray(rules.chart))      VIEWPORT_RULES.chart      = rules.chart;
    }
  };

  (function loadRulesScript() {
    const s = document.createElement('script');
    s.src = 'viewport_rules.js';
    s.async = true;
    s.onerror = () => {
      console.warn('[viewport] viewport_rules.js not found; using built-in fallback rules.');
    };
    document.head.appendChild(s);
  })();

  /**
   * Assembles the rule-evaluation context object from current simulation state.
   *
   * @returns {object} Snapshot of particles, aggregates, pebbles, drum, time, params, mode, and flags
   */
  function buildViewportContext() {
    const absOm = Math.abs(state.omega);
    const T = absOm < 1e-3 ? Infinity : (2 * Math.PI / absOm);
    let floating = 0, levitated = 0, stuck = 0;
    for (const p of state.particles) {
      if (!p.alive) continue;
      if (p.stuck) { stuck++; continue; }
      if (p.merging) continue;
      floating++;
      if (isFinite(T) && p.inHighlightSince !== null && (state.t - p.inHighlightSince) >= T) {
        levitated++;
      }
    }
    let aggLev = 0;
    for (const a of state.aggregates) {
      if (!a.alive || a.stuck || a.merging) continue;
      if (isFinite(T) && a.inHighlightSince !== null && (state.t - a.inHighlightSince) >= T) {
        aggLev++;
      }
    }
    const sinceInj = (VIEWPORT.lastInjectedAt < 0) ? Infinity : (state.t - VIEWPORT.lastInjectedAt);
    return {
      particles: {
        floating, levitated,
        lost: state.lostCount,
        stuck,
        total: state.particles.length,
        injected: CFG.N_P - state.toInject.length,
        pendingInjection: state.toInject.length,
      },
      aggregates: {
        active: state.aggregates.filter(a => a.alive && !a.merging).length,
        levitated: aggLev,
        totalFormed: VIEWPORT.aggregatesEverFormed,
        merging: state.aggMerging ? 1 : 0,
      },
      pebbles: {
        count: state.eggBallCount,
        merging: state.eggMerging ? 1 : 0,
      },
      drum: {
        omega: state.omega,
        omegaTarget: state.omegaTarget,
        period: T,
        spinning: absOm > 0.05,
        direction: state.omega > 0 ? 1 : (state.omega < 0 ? -1 : 0),
        angle: state.drumAngle,
      },
      time: {
        simT: state.t,
        sinceInjection: sinceInj,
      },
      params: {
        N_P: CFG.N_P,
        V_T: CFG.V_T,
        VT_SPREAD: CFG.VT_SPREAD,
        DT_INJECT: CFG.DT_INJECT,
      },
      mode: {
        game: GAME.on,
        gameLevel: GAME.on ? GAME.levelIdx : -1,
        gamePhase: GAME.phase,
        challenge: CHALLENGE.on,
        challengePhase: CHALLENGE.phase,
        running: state.running,
      },
      flags: {
        laserOn: state.laserOn,
        trailsOn: state.trailsOn,
        soundOn: AUDIO.enabled,
        theme: PAL.name,
      },
      button: VIEWPORT.active,
    };
  }

  /**
   * Selects the best matching viewport rule asset for 'microscope' or 'chart'.
   *
   * @param {Array} bank - Array of rule objects for a viewport channel
   * @param {object} ctx - Rule-evaluation context produced by buildViewportContext
   * @returns {object|null} The highest-priority matching rule, or null if none matched
   */
  function pickRule(bank, ctx) {
    if (!bank || !bank.length) return null;
    let best = null, bestPri = -Infinity;
    for (const rule of bank) {
      let matches;
      try {
        matches = (typeof rule.when === 'function') ? !!rule.when(ctx) : true;
      } catch (e) {
        console.warn('[viewport] rule', rule.id, 'threw:', e);
        matches = false;
      }
      if (!matches) continue;
      const pri = rule.priority != null ? rule.priority : 0;
      if (pri > bestPri) { bestPri = pri; best = rule; }
    }
    return best;
  }

  function resolveAsset(rule) {
    if (!rule || rule.asset == null) {
      return { type: 'render', name: '__fallback__' };
    }
    let a = rule.asset;
    if (Array.isArray(a)) {
      a = a[Math.floor(Math.random() * a.length)];
    }
    if (typeof a === 'string') {
      const lower = a.toLowerCase();
      const isVideo = /\.(mp4|webm|ogv|mov)$/i.test(lower);
      return { type: isVideo ? 'video' : 'image', src: TUNING.viewport.assetDir + a };
    }
    if (typeof a === 'object') {
      if (a.type === 'image' || a.type === 'video') {
        return { type: a.type, src: TUNING.viewport.assetDir + a.src, loop: a.loop !== false };
      }
      if (a.type === 'render') {
        return { type: 'render', name: a.name };
      }
    }
    return { type: 'render', name: '__fallback__' };
  }

  function assetsEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.type === 'render') return a.name === b.name;
    return a.src === b.src;
  }

  const VIEWPORT_IMG_CACHE = new Map();
  function getImage(src) {
    let img = VIEWPORT_IMG_CACHE.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      VIEWPORT_IMG_CACHE.set(src, img);
    }
    return img;
  }

  let VP_OFFSCREEN = document.createElement('canvas');

  const vpVideoEl = document.getElementById('viewportVideo');
  let vpVideoCurrentSrc = null;

  function showVideoElement(src, loop, geom, opacity) {
    if (vpVideoCurrentSrc !== src) {
      vpVideoEl.src = src;
      vpVideoEl.loop = !!loop;
      vpVideoCurrentSrc = src;
      vpVideoEl.play().catch(() => {});
    }
    vpVideoEl.style.left = geom.screenX + 'px';
    vpVideoEl.style.top = geom.screenY + 'px';
    vpVideoEl.style.width = geom.screenW + 'px';
    vpVideoEl.style.height = geom.screenH + 'px';
    vpVideoEl.style.opacity = (opacity != null) ? String(opacity) : '1';
    vpVideoEl.classList.add('show');
  }
  /**
   * Pauses and clears the video element used for video assets.
   */
  function hideVideoElement() {
    vpVideoEl.classList.remove('show');
    vpVideoEl.pause();
    vpVideoCurrentSrc = null;
    vpVideoEl.removeAttribute('src');
    vpVideoEl.load();
  }
  window.hideVideoElement = hideVideoElement;

  /**
   * Computes pixel position and size of the viewport panel based on REGIME and GEO.
   *
   * @returns {object} Geometry record with deviceX/Y, totalW/H, mountX/Y/W/H, screenX/Y/W/H, visible, and slideU
   */
  function getViewportGeometry() {
    const sizeCm = TUNING.viewport.sizeCm;
    const totalPx = pxDist(sizeCm);
    const isPortrait = (REGIME === 'portrait');
    const screenW = totalPx;
    const screenH = totalPx / TUNING.viewport.screenAspect;
    const mountH = isPortrait ? 0 : (totalPx - screenH) * 0.5;

    let deviceX, u;
    if (REGIME === 'portrait') {
      deviceX = CX - totalPx;
      u = (VIEWPORT.phase === 'hidden' || VIEWPORT.phase === 'sliding-up') ? 0 : 1;
    } else {
      const wingRight = GEO.wingLeftX + GEO.wingW;
      deviceX = wingRight + TUNING.viewport.gapToWingPx;
      const maxX = W - totalPx - 4;
      if (deviceX > maxX) deviceX = maxX;
      u = VIEWPORT.slideU;
    }

    const totalH = mountH + screenH;
    let deviceY;
    if (isPortrait) {
      deviceY = u > 0.5 ? (CY - totalH) : (-totalH - 10);
      if (deviceY < 0) deviceY = 0;
    } else {
      deviceY = -totalH + u * totalH;
    }

    return {
      deviceX,
      deviceY,
      totalW: totalPx,
      totalH: totalPx,
      mountX: deviceX,
      mountY: deviceY,
      mountW: totalPx,
      mountH: mountH,
      screenX: deviceX,
      screenY: deviceY + mountH,
      screenW: screenW,
      screenH: screenH,
      visible: u > 0,
      slideU: u,
    };
  }

  /**
   * Starts the slide-in animation for the given viewport panel.
   *
   * @param {string} which - Panel identifier: 'microscope' or 'chart'
   */
  function activateViewport(which) {
    if (VIEWPORT.active === which) return;
    const wasActive = VIEWPORT.active !== null;
    VIEWPORT.active = which;
    btnMicro.classList.toggle('on', which === 'microscope');
    btnChart.classList.toggle('on', which === 'chart');

    if (wasActive) {
      VIEWPORT.lastEvalAt = 0;
      VIEWPORT.currentAsset = null;
      VIEWPORT.lastRuleKey = null;
      VIEWPORT.pendingAsset = null;
      VIEWPORT.crossfadeStart = -1;
      VIEWPORT.lastSwitchAt = -10; // reset debounce so first asset shows immediately
    } else {
      VIEWPORT.phase = 'sliding-down';
      VIEWPORT.phaseStart = VIEWPORT.wallT;
      VIEWPORT.slideU = 0;
      VIEWPORT.currentAsset = null;
      VIEWPORT.lastRuleKey = null
      VIEWPORT.pendingAsset = null;
    }
  }

  /**
   * Starts the slide-out animation for the active viewport panel.
   */
  function deactivateViewport() {
    if (VIEWPORT.active === null) return;
    VIEWPORT.active = null;
    btnMicro.classList.remove('on');
    btnChart.classList.remove('on');
    if (VIEWPORT.phase === 'on' || VIEWPORT.phase === 'warmup') {
      VIEWPORT.phase = 'sliding-up';
      VIEWPORT.phaseStart = VIEWPORT.wallT;
    } else if (VIEWPORT.phase === 'sliding-down') {
      VIEWPORT.phase = 'sliding-up';
      VIEWPORT.phaseStart = VIEWPORT.wallT - (1 - VIEWPORT.slideU) * TUNING.viewport.slideDur;
    }
    VIEWPORT.lastRuleKey = null
    hideVideoElement();
  }

  /**
   * Smooth ease-in-out curve; returns a value in [0,1] for t in [0,1].
   *
   * @param {number} t - Input progress value, clamped to [0,1]
   * @returns {number} Eased output value in [0,1]
   */
  function easeInOut(t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5;
  }

/**
 * Advances viewport slide/crossfade animation and fires rule evaluation.
 *
 * @param {number} dt - Elapsed wall-clock time in seconds since the last frame
 */
function updateViewport(dt) {
    VIEWPORT.wallT += dt;
    const dur = TUNING.viewport.slideDur;
    const warm = TUNING.viewport.warmUpDur;
    const now = VIEWPORT.wallT;

    if (REGIME === 'portrait') {
      if (VIEWPORT.active && VIEWPORT.phase !== 'on') {
        VIEWPORT.phase = 'on';
        VIEWPORT.slideU = 1;
      } else if (!VIEWPORT.active && VIEWPORT.phase !== 'hidden') {
        VIEWPORT.phase = 'hidden';
        VIEWPORT.slideU = 0;
        VIEWPORT.currentAsset = null;
        VIEWPORT.pendingAsset = null;
      }
    } else {
      switch (VIEWPORT.phase) {
        case 'sliding-down': {
          const u = (now - VIEWPORT.phaseStart) / dur;
          VIEWPORT.slideU = Math.min(1, easeInOut(u));
          if (u >= 1) {
            VIEWPORT.phase = 'warmup';
            VIEWPORT.phaseStart = now;
            VIEWPORT.slideU = 1;
          }
          break;
        }
        case 'warmup': {
          if ((now - VIEWPORT.phaseStart) >= warm) {
            VIEWPORT.phase = 'on';
            VIEWPORT.lastEvalAt = 0;
          }
          break;
        }
        case 'sliding-up': {
          const u = (now - VIEWPORT.phaseStart) / dur;
          VIEWPORT.slideU = Math.max(0, 1 - easeInOut(u));
          if (u >= 1) {
            VIEWPORT.phase = 'hidden';
            VIEWPORT.slideU = 0;
            VIEWPORT.currentAsset = null;
            VIEWPORT.pendingAsset = null;
            hideVideoElement();
          }
          break;
        }
      }
    }

    if (VIEWPORT.phase === 'on' && VIEWPORT.active) {
      const evalInterval = 1.0 / TUNING.viewport.ruleEvalHz;
      if ((now - VIEWPORT.lastEvalAt) >= evalInterval) {
        VIEWPORT.lastEvalAt = now;
        const ctx = buildViewportContext();
        const bank = VIEWPORT_RULES[VIEWPORT.active];
        const rule = pickRule(bank, ctx);
        const ruleKey = rule ? (VIEWPORT.active + ':' + rule.id) : null;

        // Only re-resolve when the matching rule changes. Otherwise an
        // `asset: [...]` array would re-pick a random element on every tick.
        if (ruleKey !== VIEWPORT.lastRuleKey) {
          const newAsset = resolveAsset(rule);
          if (!assetsEqual(newAsset, VIEWPORT.currentAsset) &&
              !assetsEqual(newAsset, VIEWPORT.pendingAsset)) {
            if ((now - VIEWPORT.lastSwitchAt) >= TUNING.viewport.switchDebounce) {
              if (VIEWPORT.currentAsset === null) {
                VIEWPORT.currentAsset = newAsset;
                VIEWPORT.crossfadeStart = -1;
              } else {
                VIEWPORT.pendingAsset = newAsset;
                VIEWPORT.crossfadeStart = now;
              }
              VIEWPORT.lastSwitchAt = now;
            }
          }
          VIEWPORT.lastRuleKey = ruleKey;
        }
      }

      if (VIEWPORT.pendingAsset && VIEWPORT.crossfadeStart > 0) {
        const u = (now - VIEWPORT.crossfadeStart) / TUNING.viewport.crossfadeDur;
        if (u >= 1) {
          VIEWPORT.currentAsset = VIEWPORT.pendingAsset;
          VIEWPORT.pendingAsset = null;
          VIEWPORT.crossfadeStart = -1;
        }
      }
    }
  }

  function renderAssetTo(targetG, asset, x, y, w, h, alpha, simCtx, geom) {
    if (alpha <= 0 || !asset) return;
    targetG.save();
    targetG.globalAlpha = alpha;
    if (asset.type === 'image') {
      const img = getImage(asset.src);
      if (img.complete && img.naturalWidth > 0) {
        const ar = img.naturalWidth / img.naturalHeight;
        const screenAr = w / h;
        let dw, dh, dx, dy;
        if (ar > screenAr) {
          dh = h; dw = h * ar; dx = x + (w - dw) * 0.5; dy = y;
        } else {
          dw = w; dh = w / ar; dx = x; dy = y + (h - dh) * 0.5;
        }
        targetG.beginPath();
        targetG.rect(x, y, w, h);
        targetG.clip();
        targetG.drawImage(img, dx, dy, dw, dh);
      } else {
        targetG.fillStyle = '#000';
        targetG.fillRect(x, y, w, h);
      }
    } else if (asset.type === 'video') {
      // No fill — video element sits above canvas and fades out via opacity
    } else if (asset.type === 'render') {
      const fn = VIEWPORT_RENDERERS[asset.name] || VIEWPORT_RENDERERS['__fallback__'];
      VP_OFFSCREEN.width = Math.max(2, Math.round(w));
      VP_OFFSCREEN.height = Math.max(2, Math.round(h));
      const og = VP_OFFSCREEN.getContext('2d');
      og.clearRect(0, 0, VP_OFFSCREEN.width, VP_OFFSCREEN.height);
      try {
        fn(og, VP_OFFSCREEN.width, VP_OFFSCREEN.height, simCtx, state.t);
      } catch (e) {
        console.warn('[viewport] renderer threw:', asset.name, e);
        VIEWPORT_RENDERERS['__fallback__'](og, VP_OFFSCREEN.width, VP_OFFSCREEN.height, simCtx, state.t);
      }
      targetG.drawImage(VP_OFFSCREEN, x, y, w, h);
    }
    targetG.restore();
  }

  /**
   * Renders the viewport panel, asset content, and glass overlay onto ctxOv.
   */
  function drawViewport() {
    try { ctxOv.restore(); } catch (e) {}
    ctxOv.clearRect(0, 0, W, H);
    ctxOv.save();
    if (VIEWPORT.phase === 'hidden') {
      hideVideoElement();
      ctxOv.restore();
      return;
    }
    const geom = getViewportGeometry();
    if (!geom.visible) { ctxOv.restore(); return; }
    const ctx = ctxOv;
    const rivet = (x, y, r) => {
      const rr = Math.max(0.5, r);
      const g = ctx.createRadialGradient(x - rr * 0.4, y - rr * 0.4, 0, x, y, rr);
      g.addColorStop(0, '#9a9aa2');
      g.addColorStop(0.6, '#3a3a44');
      g.addColorStop(1, '#101014');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    };

    if (VIEWPORT.phase === 'hidden') {
      hideVideoElement();
      return;
    }

    // === MOUNT (top portion) — brass plate with rivets ===
    const mountG = ctxOv.createLinearGradient(0, geom.mountY, 0, geom.mountY + geom.mountH);
    mountG.addColorStop(0.00, '#f0d088');
    mountG.addColorStop(0.10, '#e8c77a');
    mountG.addColorStop(0.30, '#d9b76a');
    mountG.addColorStop(0.65, '#8a6b2e');
    mountG.addColorStop(0.90, '#5a4418');
    mountG.addColorStop(1.00, '#3a2a0e');
    ctxOv.fillStyle = mountG;
    ctxOv.fillRect(geom.mountX, geom.mountY, geom.mountW, geom.mountH);

    ctxOv.strokeStyle = 'rgba(255,245,200,0.7)';
    ctxOv.lineWidth = 1.2;
    ctxOv.beginPath();
    ctxOv.moveTo(geom.mountX, geom.mountY + 0.6);
    ctxOv.lineTo(geom.mountX + geom.mountW, geom.mountY + 0.6);
    ctxOv.stroke();
    ctxOv.strokeStyle = 'rgba(0,0,0,0.7)';
    ctxOv.lineWidth = 1.2;
    ctxOv.beginPath();
    ctxOv.moveTo(geom.mountX, geom.mountY + geom.mountH - 0.6);
    ctxOv.lineTo(geom.mountX + geom.mountW, geom.mountY + geom.mountH - 0.6);
    ctxOv.stroke();
    const capW = Math.max(4, geom.mountW * 0.04);
    const capA = ctxOv.createLinearGradient(geom.mountX, 0, geom.mountX + capW, 0);
    capA.addColorStop(0, 'rgba(0,0,0,0.55)'); capA.addColorStop(1, 'rgba(0,0,0,0)');
    ctxOv.fillStyle = capA; ctxOv.fillRect(geom.mountX, geom.mountY, capW, geom.mountH);
    const capB = ctxOv.createLinearGradient(geom.mountX + geom.mountW - capW, 0, geom.mountX + geom.mountW, 0);
    capB.addColorStop(0, 'rgba(0,0,0,0)'); capB.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctxOv.fillStyle = capB; ctxOv.fillRect(geom.mountX + geom.mountW - capW, geom.mountY, capW, geom.mountH);

    const rR = Math.max(2.4, geom.mountW * 0.022);
    rivet(geom.mountX + capW * 0.7, geom.mountY + geom.mountH * 0.3, rR);
    rivet(geom.mountX + capW * 0.7, geom.mountY + geom.mountH * 0.7, rR);
    rivet(geom.mountX + geom.mountW - capW * 0.7, geom.mountY + geom.mountH * 0.3, rR);
    rivet(geom.mountX + geom.mountW - capW * 0.7, geom.mountY + geom.mountH * 0.7, rR);
    const bossX = geom.mountX + geom.mountW * 0.5;
    const bossY = geom.mountY + geom.mountH * 0.5;
    const bossR = Math.max(6, geom.mountH * 0.30);
    const bossG = ctxOv.createRadialGradient(bossX - bossR * 0.35, bossY - bossR * 0.35, 0, bossX, bossY, bossR);
    bossG.addColorStop(0, '#fff0c8');
    bossG.addColorStop(0.4, '#d9b76a');
    bossG.addColorStop(1, '#3a2a0e');
    ctxOv.fillStyle = bossG;
    ctxOv.beginPath(); ctxOv.arc(bossX, bossY, bossR, 0, Math.PI * 2); ctxOv.fill();
    ctxOv.strokeStyle = 'rgba(0,0,0,0.6)'; ctxOv.lineWidth = 1;
    ctxOv.beginPath(); ctxOv.arc(bossX, bossY, bossR, 0, Math.PI * 2); ctxOv.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rivet(bossX + Math.cos(a) * bossR * 0.65, bossY + Math.sin(a) * bossR * 0.65, rR * 0.7);
    }

    // === SCREEN FRAME ===
    const bezelW = Math.max(8, geom.screenW * 0.04);
    const sx = geom.screenX, sy = geom.screenY;
    const sw = geom.screenW, sh = geom.screenH;
    const bezelG = ctxOv.createLinearGradient(0, sy, 0, sy + sh);
    bezelG.addColorStop(0.00, '#e8c77a');
    bezelG.addColorStop(0.30, '#d9b76a');
    bezelG.addColorStop(0.65, '#8a6b2e');
    bezelG.addColorStop(1.00, '#3a2a0e');
    ctxOv.fillStyle = bezelG;
    ctxOv.fillRect(sx, sy, sw, sh);
    ctxOv.strokeStyle = 'rgba(255,245,200,0.6)';
    ctxOv.lineWidth = 1;
    ctxOv.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    const cornerR = rR * 0.85;
    rivet(sx + bezelW * 0.5, sy + bezelW * 0.5, cornerR);
    rivet(sx + sw - bezelW * 0.5, sy + bezelW * 0.5, cornerR);
    rivet(sx + bezelW * 0.5, sy + sh - bezelW * 0.5, cornerR);
    rivet(sx + sw - bezelW * 0.5, sy + sh - bezelW * 0.5, cornerR);

    const ix = sx + bezelW;
    const iy = sy + bezelW;
    const iw = sw - 2 * bezelW;
    const ih = sh - 2 * bezelW;
    ctxOv.fillStyle = '#000';
    ctxOv.fillRect(ix, iy, iw, ih);
    ctxOv.save();
    ctxOv.beginPath(); ctxOv.rect(ix, iy, iw, ih); ctxOv.clip();
    const shadowG = ctxOv.createLinearGradient(ix, iy, ix, iy + ih * 0.15);
    shadowG.addColorStop(0, 'rgba(0,0,0,0.85)');
    shadowG.addColorStop(1, 'rgba(0,0,0,0)');
    ctxOv.fillStyle = shadowG;
    ctxOv.fillRect(ix, iy, iw, ih * 0.15);
    ctxOv.restore();

    const screenGeomForVideo = { screenX: ix, screenY: iy, screenW: iw, screenH: ih };

    if (VIEWPORT.phase === 'warmup') {
      const u = (VIEWPORT.wallT - VIEWPORT.phaseStart) / TUNING.viewport.warmUpDur;
      const phase1 = Math.min(1, u / 0.4);
      const phase2 = Math.max(0, (u - 0.4) / 0.6);
      ctxOv.save();
      ctxOv.beginPath(); ctxOv.rect(ix, iy, iw, ih); ctxOv.clip();
      const cy = iy + ih * 0.5;
      if (phase2 < 1) {
        const lineH = 1 + phase2 * ih;
        const grad = ctxOv.createLinearGradient(0, cy - lineH * 0.5, 0, cy + lineH * 0.5);
        grad.addColorStop(0.0, 'rgba(180,255,200,0)');
        grad.addColorStop(0.5, `rgba(220,255,230,${0.9 * phase1})`);
        grad.addColorStop(1.0, 'rgba(180,255,200,0)');
        ctxOv.fillStyle = grad;
        ctxOv.fillRect(ix, cy - lineH * 0.5, iw, lineH);
      } else {
        ctxOv.fillStyle = `rgba(220,255,230,${0.3 * (1 - phase2 * 0.5)})`;
        ctxOv.fillRect(ix, iy, iw, ih);
      }
      ctxOv.restore();
      hideVideoElement();
    } else if (VIEWPORT.phase === 'on' && VIEWPORT.currentAsset) {
      const simCtx = buildViewportContext();
      let curAlpha = 1;
      let pendAlpha = 0;
      if (VIEWPORT.pendingAsset && VIEWPORT.crossfadeStart > 0) {
        const u = Math.min(1, (VIEWPORT.wallT - VIEWPORT.crossfadeStart) / TUNING.viewport.crossfadeDur);
        curAlpha = 1 - u;
        pendAlpha = u;
      }

      let videoAsset = null, videoAlpha = 0;
      if (VIEWPORT.currentAsset && VIEWPORT.currentAsset.type === 'video' && curAlpha > videoAlpha) {
        videoAsset = VIEWPORT.currentAsset; videoAlpha = curAlpha;
      }
      if (VIEWPORT.pendingAsset && VIEWPORT.pendingAsset.type === 'video' && pendAlpha > videoAlpha) {
        videoAsset = VIEWPORT.pendingAsset; videoAlpha = pendAlpha;
      }
      if (videoAsset) {
        showVideoElement(videoAsset.src, videoAsset.loop !== false, screenGeomForVideo, videoAlpha);
        vpVideoEl.style.opacity = String(videoAlpha);
      } else {
        hideVideoElement();
      }

      renderAssetTo(ctxOv, VIEWPORT.currentAsset, ix, iy, iw, ih, curAlpha, simCtx, geom);
      if (VIEWPORT.pendingAsset) {
        renderAssetTo(ctxOv, VIEWPORT.pendingAsset, ix, iy, iw, ih, pendAlpha, simCtx, geom);
      }
    } else {
      hideVideoElement();
    }

    if (VIEWPORT.phase === 'on' || VIEWPORT.phase === 'warmup') {
      ctxOv.save();
      ctxOv.beginPath(); ctxOv.rect(ix, iy, iw, ih); ctxOv.clip();
      const vg = ctxOv.createRadialGradient(
        ix + iw * 0.5, iy + ih * 0.5, Math.min(iw, ih) * 0.3,
        ix + iw * 0.5, iy + ih * 0.5, Math.max(iw, ih) * 0.7
      );
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctxOv.fillStyle = vg;
      ctxOv.fillRect(ix, iy, iw, ih);
      const gl = ctxOv.createLinearGradient(ix, iy, ix + iw, iy + ih);
      gl.addColorStop(0.0, 'rgba(255,255,255,0.06)');
      gl.addColorStop(0.3, 'rgba(255,255,255,0)');
      gl.addColorStop(0.7, 'rgba(255,255,255,0)');
      gl.addColorStop(1.0, 'rgba(255,255,255,0.04)');
      ctxOv.fillStyle = gl;
      ctxOv.fillRect(ix, iy, iw, ih);
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#000';
      for (let yy = iy; yy < iy + ih; yy += 3) {
        ctx.fillRect(ix, yy, iw, 1);
      }
      ctx.restore();
    }
    ctxOv.restore();
  }
  window.drawViewport = drawViewport;

  const btnMicro = document.getElementById('btnMicro');
  const btnChart = document.getElementById('btnChart');
  btnMicro.addEventListener('click', () => {
    if (btnMicro.classList.contains('disabled')) return;
    if (VIEWPORT.active === 'microscope') deactivateViewport();
    else activateViewport('microscope');
  });
  btnChart.addEventListener('click', () => {
    if (btnChart.classList.contains('disabled')) return;
    if (VIEWPORT.active === 'chart') deactivateViewport();
    else activateViewport('chart');
  });

  let _prevAggCount = 0;
  /**
   * Updates VIEWPORT.aggregatesEverFormed by diffing state.aggCount each frame.
   */
  function pollAggregateCounter() {
    if (state.aggCount > _prevAggCount) {
      VIEWPORT.aggregatesEverFormed += (state.aggCount - _prevAggCount);
    } else if (state.aggCount < _prevAggCount) {
      _prevAggCount = state.aggCount;
    }
    _prevAggCount = state.aggCount;
  }

  btnStart.addEventListener('click', () => {
    VIEWPORT.lastInjectedAt = state.t;
  });
  btnReset.addEventListener('click', () => {
    VIEWPORT.lastInjectedAt = -1;
    VIEWPORT.aggregatesEverFormed = 0;
    _prevAggCount = 0;
  });

  // ============================================================
  // END VIEWPORT SUBSYSTEM

  window.VIEWPORT            = VIEWPORT;
  window.updateViewport      = updateViewport;
  window.drawViewport        = drawViewport;
  window.pollAggregateCounter = pollAggregateCounter;
  window.hideVideoElement    = hideVideoElement;
})();
