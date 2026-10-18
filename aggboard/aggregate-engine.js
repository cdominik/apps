/*
 * Aggregate engine for AggBoard.
 *
 * Tunable particle–cluster aggregation (monodisperse spheres, radius 1).
 * Each new monomer is placed at the distance Γ from the current centre of mass
 * that makes the cluster obey  N = kf · (Rg / a)^Df  exactly after the step,
 * touching at least one existing monomer and overlapping none
 * (Filippov, Zurita & Rosner 2000, J. Colloid Interface Sci. 229, 261).
 *
 * Growth is sequential and deterministic for a given (Df, kf, seed), so the
 * cluster with N monomers is a prefix of the cluster with N' > N monomers.
 * fitBox() uses this: it grows one cluster and picks the prefix length whose
 * extent (along its principal axes) best fills the requested box. Changing the
 * monomer size or the box therefore keeps the same "core" structure.
 *
 * Runs as a Web Worker (message API at the bottom) or on the main thread via
 * the global AggEngine.fitBox(params).
 */
(function (root) {
  'use strict';

  // ---------- PRNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CONTACT = 2;            // centre distance of touching unit spheres
  const CONTACT2 = 4;
  const OVERLAP2 = 4 - 1e-6;    // closer than this counts as overlap
  const CELL = 2;
  const OFF = 1 << 20;

  function cellKey(ix, iy, iz) {
    return ((ix + OFF) * 2097152 + (iy + OFF)) * 2097152 + (iz + OFF);
  }

  // ---------- Growth ----------
  class Growth {
    constructor(df, kf, seed) {
      this.df = df; this.kf = kf;
      this.rand = mulberry32((seed >>> 0) || 1);
      this.n = 0;
      this.cap = 0;
      this.grid = new Map();
      this.exact = 0;           // placements that hit Γ exactly
      this.grow(256);
      this.add(0, 0, 0);
    }

    grow(cap) {
      const keep = (old, len) => { const a = new Float64Array(len); if (old) a.set(old.subarray(0, Math.min(old.length, len))); return a; };
      this.pos = keep(this.pos, 3 * cap);
      // cumulative sums, index k = sum over the first k monomers
      this.cx = keep(this.cx, cap + 1); this.cy = keep(this.cy, cap + 1); this.cz = keep(this.cz, cap + 1);
      this.cxx = keep(this.cxx, cap + 1); this.cyy = keep(this.cyy, cap + 1); this.czz = keep(this.czz, cap + 1);
      this.cxy = keep(this.cxy, cap + 1); this.cxz = keep(this.cxz, cap + 1); this.cyz = keep(this.cyz, cap + 1);
      this.cand = new Int32Array(cap);
      this.cap = cap;
    }

    add(x, y, z) {
      if (this.n >= this.cap) this.grow(this.cap * 2);
      const i = this.n, k = i + 1;
      this.pos[3 * i] = x; this.pos[3 * i + 1] = y; this.pos[3 * i + 2] = z;
      this.cx[k] = this.cx[i] + x; this.cy[k] = this.cy[i] + y; this.cz[k] = this.cz[i] + z;
      this.cxx[k] = this.cxx[i] + x * x; this.cyy[k] = this.cyy[i] + y * y; this.czz[k] = this.czz[i] + z * z;
      this.cxy[k] = this.cxy[i] + x * y; this.cxz[k] = this.cxz[i] + x * z; this.cyz[k] = this.cyz[i] + y * z;
      const key = cellKey(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL));
      const list = this.grid.get(key);
      if (list) list.push(i); else this.grid.set(key, [i]);
      this.n = k;
    }

    free(x, y, z) {
      const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL), iz = Math.floor(z / CELL);
      const p = this.pos;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const list = this.grid.get(cellKey(ix + a, iy + b, iz + c));
        if (!list) continue;
        for (let m = 0; m < list.length; m++) {
          const j = list[m];
          const dx = p[3 * j] - x, dy = p[3 * j + 1] - y, dz = p[3 * j + 2] - z;
          if (dx * dx + dy * dy + dz * dz < OVERLAP2) return false;
        }
      }
      return true;
    }

    rg2(k) {
      const mx = this.cx[k] / k, my = this.cy[k] / k, mz = this.cz[k] / k;
      return Math.max(0, (this.cxx[k] + this.cyy[k] + this.czz[k]) / k - (mx * mx + my * my + mz * mz));
    }

    step() {
      const n = this.n, rand = this.rand, p = this.pos;
      const mx = this.cx[n] / n, my = this.cy[n] / n, mz = this.cz[n] / n;
      const rgN2 = this.rg2(n);
      const rgT2 = Math.pow((n + 1) / this.kf, 2 / this.df);
      let g2 = ((n + 1) * rgT2 - n * rgN2) * (n + 1) / n;
      if (!(g2 > 0)) g2 = 1e-6;
      const G = Math.sqrt(g2);

      // Candidates: monomers whose contact sphere intersects the sphere of radius Γ.
      const cand = this.cand;
      let nc = 0;
      for (let i = 0; i < n; i++) {
        const dx = p[3 * i] - mx, dy = p[3 * i + 1] - my, dz = p[3 * i + 2] - mz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 1e-9 && Math.abs(d - G) < CONTACT - 1e-9 && d + G > CONTACT + 1e-9) cand[nc++] = i;
      }

      // Exact placement on the intersection circle.
      const maxCand = Math.min(nc, 64);
      for (let t = 0; t < maxCand; t++) {
        const r = t + Math.floor(rand() * (nc - t));
        const i = cand[r]; cand[r] = cand[t]; cand[t] = i;
        let ux = p[3 * i] - mx, uy = p[3 * i + 1] - my, uz = p[3 * i + 2] - mz;
        const D = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= D; uy /= D; uz /= D;
        const x = (D * D + g2 - CONTACT2) / (2 * D);
        const rho2 = g2 - x * x;
        if (rho2 < 0) continue;
        const rho = Math.sqrt(rho2);
        // orthonormal basis (v, w) perpendicular to u
        let ax = 1, ay = 0, az = 0;
        if (Math.abs(ux) > 0.9) { ax = 0; ay = 1; }
        let vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        vx /= vl; vy /= vl; vz /= vl;
        const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
        const qx = mx + ux * x, qy = my + uy * x, qz = mz + uz * x;
        for (let tries = 0; tries < 8; tries++) {
          const th = rand() * 2 * Math.PI, c = Math.cos(th), s = Math.sin(th);
          const px = qx + rho * (c * vx + s * wx);
          const py = qy + rho * (c * vy + s * wy);
          const pz = qz + rho * (c * vz + s * wz);
          if (this.free(px, py, pz)) { this.add(px, py, pz); this.exact++; return; }
        }
      }

      // Fallback: best of random contact positions (closest to Γ).
      let best = null, bestErr = Infinity;
      for (let s = 0; s < 400; s++) {
        const i = Math.floor(rand() * n);
        const z = 2 * rand() - 1, phi = 2 * Math.PI * rand(), rr = Math.sqrt(1 - z * z);
        const px = p[3 * i] + CONTACT * rr * Math.cos(phi);
        const py = p[3 * i + 1] + CONTACT * rr * Math.sin(phi);
        const pz = p[3 * i + 2] + CONTACT * z;
        const dx = px - mx, dy = py - my, dz = pz - mz;
        const err = Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) - G);
        if (err < bestErr && this.free(px, py, pz)) { best = [px, py, pz]; bestErr = err; }
      }
      if (best) { this.add(best[0], best[1], best[2]); return; }

      // Guaranteed placement: radially outside the farthest monomer.
      let far = 0, fd = -1;
      for (let i = 0; i < n; i++) {
        const dx = p[3 * i] - mx, dy = p[3 * i + 1] - my, dz = p[3 * i + 2] - mz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > fd) { fd = d; far = i; }
      }
      let dx = p[3 * far] - mx, dy = p[3 * far + 1] - my, dz = p[3 * far + 2] - mz;
      let dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl < 1e-9) { dx = 1; dy = 0; dz = 0; dl = 1; }
      this.add(p[3 * far] + CONTACT * dx / dl, p[3 * far + 1] + CONTACT * dy / dl, p[3 * far + 2] + CONTACT * dz / dl);
    }

    extend(N) { while (this.n < N) this.step(); }

    // Centre of mass and covariance matrix of the first k monomers.
    moments(k) {
      const mx = this.cx[k] / k, my = this.cy[k] / k, mz = this.cz[k] / k;
      return {
        c: [mx, my, mz],
        C: [
          this.cxx[k] / k - mx * mx, this.cxy[k] / k - mx * my, this.cxz[k] / k - mx * mz,
          this.cxy[k] / k - mx * my, this.cyy[k] / k - my * my, this.cyz[k] / k - my * mz,
          this.cxz[k] / k - mx * mz, this.cyz[k] / k - my * mz, this.czz[k] / k - mz * mz,
        ],
      };
    }
  }

  /*
   * Default prefactor as a function of Df. A fixed kf cannot span Df = 1…3:
   * a straight chain needs kf >= sqrt(3) (Df -> 1), a random dense packing
   * needs kf <~ 1 (Df -> 3). This piecewise-linear default passes through the
   * common kf = 1.3 at Df = 1.8 and was checked to give exact Df from 1 to 3.
   */
  function kfAuto(df) {
    return df < 1.8 ? 1.9 - 0.75 * (df - 1) : 1.3 - 0.25 * (df - 1.8);
  }

  // ---------- Linear algebra ----------
  // Eigen-decomposition of a symmetric 3x3 matrix (Jacobi). Returns axes sorted by eigenvalue, descending.
  function eigenSym3(Min) {
    const a = Min.slice();
    const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let sweep = 0; sweep < 30; sweep++) {
      const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
      if (off < 1e-18) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        const apq = a[3 * p + q];
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[3 * p + p], aqq = a[3 * q + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[3 * k + p], akq = a[3 * k + q];
          a[3 * k + p] = c * akp - s * akq;
          a[3 * k + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[3 * p + k], aqk = a[3 * q + k];
          a[3 * p + k] = c * apk - s * aqk;
          a[3 * q + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[3 * k + p], vkq = v[3 * k + q];
          v[3 * k + p] = c * vkp - s * vkq;
          v[3 * k + q] = s * vkp + c * vkq;
        }
      }
    }
    const out = [0, 1, 2].map(i => ({ val: a[3 * i + i], vec: [v[i], v[3 + i], v[6 + i]] }));
    out.sort((x, y) => y.val - x.val);
    return out;
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // ---------- Cache of growths ----------
  const cache = new Map();   // key -> Growth (LRU by insertion order)
  function getGrowth(df, kf, seed) {
    const key = df.toFixed(3) + '|' + kf.toFixed(3) + '|' + (seed >>> 0);
    let g = cache.get(key);
    if (g) { cache.delete(key); cache.set(key, g); return g; }
    g = new Growth(df, kf, seed);
    cache.set(key, g);
    while (cache.size > 8) cache.delete(cache.keys().next().value);
    return g;
  }

  // Principal frame of the first k monomers and projected extents (in radii)
  // along in-plane axes rotated by angle th from the principal axes.
  function frameOf(g, k, th = 0) {
    const { c, C } = g.moments(k);
    const ev = eigenSym3(C);
    const p1 = ev[0].vec, p2 = ev[1].vec;
    const ct = Math.cos(th), st = Math.sin(th);
    const e1 = [ct * p1[0] + st * p2[0], ct * p1[1] + st * p2[1], ct * p1[2] + st * p2[2]];
    const e2 = [-st * p1[0] + ct * p2[0], -st * p1[1] + ct * p2[1], -st * p1[2] + ct * p2[2]];
    const p = g.pos;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < k; i++) {
      const qx = p[3 * i] - c[0], qy = p[3 * i + 1] - c[1], qz = p[3 * i + 2] - c[2];
      const s1 = qx * e1[0] + qy * e1[1] + qz * e1[2], t1 = qx * e2[0] + qy * e2[1] + qz * e2[2];
      if (s1 < a0) a0 = s1; if (s1 > a1) a1 = s1;
      if (t1 < b0) b0 = t1; if (t1 > b1) b1 = t1;
    }
    return { c, e1, e2, major: a1 - a0 + 2, minor: b1 - b0 + 2, a0, a1, b0, b1 };
  }
  // In-plane orientations tried when fitting a box (0 = principal axis along the long side).
  const ANGLES = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90].map(d => d * Math.PI / 180);

  function fitDf(g, k) {
    if (k < 16) return { df: null, kf: null };
    const k0 = Math.max(8, Math.floor(k / 8));
    const steps = Math.min(60, k - k0);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
    for (let s = 0; s <= steps; s++) {
      const kk = Math.round(k0 * Math.pow(k / k0, s / steps));
      const rg = Math.sqrt(g.rg2(kk));
      if (rg <= 0) continue;
      const X = Math.log(rg), Y = Math.log(kk);
      sx += X; sy += Y; sxx += X * X; sxy += X * Y; m++;
    }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    const icpt = (sy - slope * sx) / m;
    return { df: slope, kf: Math.exp(icpt) };
  }

  /*
   * params: { W, H: box size in monomer radii; df, kf, seed, nMax }
   * returns { pts: Float32Array (x,y,z per monomer, radii, centred on the box,
   *           x along the box width), n, rg, dfFit, kfFit, capped, fill, exact }
   */
  function fitBox(params) {
    const df = Math.min(3, Math.max(1, +params.df || 1.8));
    const kf = (params.kf == null || !(+params.kf > 0)) ? kfAuto(df) : Math.max(0.3, +params.kf);
    const nMax = Math.max(1, Math.floor(params.nMax || 3000));
    const W = Math.max(0, +params.W || 0), H = Math.max(0, +params.H || 0);
    const long = Math.max(W, H), short = Math.min(W, H);
    const g = getGrowth(df, kf, params.seed | 0);

    const fillAt = (k, th) => { const f = frameOf(g, k, th); return Math.max(f.major / long, f.minor / short); };
    const bestFill = (k) => { let m = Infinity; for (const th of ANGLES) m = Math.min(m, fillAt(k, th)); return m; };
    // Largest prefix that fits the box at angle th (binary search; fill grows with k).
    const largestAt = (th, hiK) => {
      if (fillAt(hiK, th) <= 1) return hiK;
      let lo = 1, hi = hiK;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fillAt(mid, th) <= 1) lo = mid; else hi = mid; }
      return lo;
    };

    let k = 1, th = 0;
    if (short >= 2) {
      const est = kf * Math.pow(0.5 * long * Math.sqrt(df / (df + 2)), df);
      g.extend(Math.min(nMax, Math.max(2, Math.ceil(est * 1.5))));
      while (g.n < nMax && bestFill(g.n) < 1) g.extend(Math.min(nMax, Math.ceil(g.n * 1.6) + 4));
      const hiK = Math.min(g.n, nMax);
      // Pick the orientation that fits the most monomers; prefer small angles on near-ties
      // so the aggregate does not flip around when the box changes slightly.
      let bestK = -1;
      for (const a of ANGLES) {
        const kk = largestAt(a, hiK);
        if (kk > bestK * 1.03) { bestK = kk; th = a; }
      }
      k = Math.max(1, bestK);
    }

    const f = frameOf(g, k, th);
    // Major axis goes along the longer side of the box. Keep the frame right-handed.
    let ex = f.e1, ey = f.e2;
    let ox = (f.a0 + f.a1) / 2, oy = (f.b0 + f.b1) / 2;
    if (H > W) { ex = f.e2; ey = f.e1; ox = (f.b0 + f.b1) / 2; oy = (f.a0 + f.a1) / 2; }
    const ez = cross(ex, ey);
    const pts = new Float32Array(3 * k);
    const p = g.pos;
    for (let i = 0; i < k; i++) {
      const q = [p[3 * i] - f.c[0], p[3 * i + 1] - f.c[1], p[3 * i + 2] - f.c[2]];
      pts[3 * i] = dot(q, ex) - ox;
      pts[3 * i + 1] = dot(q, ey) - oy;
      pts[3 * i + 2] = dot(q, ez);
    }
    const fit = fitDf(g, k);
    const fillK = short >= 2 ? Math.max(f.major / long, f.minor / short) : 1;
    const fillMin = short >= 2 ? Math.min(f.major / long, f.minor / short) : 1;
    return {
      pts, n: k,
      rg: Math.sqrt(g.rg2(k)),
      dfFit: fit.df, kfFit: fit.kf,
      capped: k >= nMax && fillK < 0.97,
      fillMin,
      fill: fillK,
      exact: g.exact / Math.max(1, g.n - 1),
      kf,
    };
  }

  const AggEngine = { fitBox, kfAuto, Growth, eigenSym3, version: 1 };
  root.AggEngine = AggEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = AggEngine;

  // ---------- Worker API ----------
  const isWorker = typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope;
  if (isWorker) {
    root.onmessage = (e) => {
      const m = e.data;
      if (!m || m.type !== 'fit') return;
      const t0 = Date.now();
      try {
        const r = fitBox(m);
        r.ms = Date.now() - t0;
        root.postMessage({ type: 'result', id: m.id, token: m.token, ...r }, [r.pts.buffer]);
      } catch (err) {
        root.postMessage({ type: 'error', id: m.id, token: m.token, message: String(err && err.message || err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
