/*
 * AggBoard, Copyright (c) 2026 Carsten Dominik. MIT License (see LICENSE).
 */
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


  // ============================================================
  // Tunable cluster–cluster aggregation (CCA)
  // ------------------------------------------------------------
  // Subclusters are grown with the tunable particle–cluster method above, then
  // merged hierarchically in pairs of similar size. Each merge places the two
  // centres of mass at the distance Γ that makes the merged cluster obey
  //   N = kf (Rg/a)^Df   exactly (Filippov, Zurita & Rosner 2000; FracVAL,
  // Morán et al. 2019), then finds an orientation in which the clusters touch
  // without overlapping:
  //   Γ² = N²/(N1 N2) Rg² − N/N2 Rg1² − N/N1 Rg2²,   Rg = (N/kf)^(1/Df) a.
  // Monomers are unit spheres (a = 1, contact distance 2), as above.
  // ============================================================
  function centred(pos, n) {
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += pos[3 * i]; my += pos[3 * i + 1]; mz += pos[3 * i + 2]; }
    mx /= n; my /= n; mz /= n;
    const out = new Float64Array(3 * n);
    let s2 = 0, rmax = 0;
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i] - mx, y = pos[3 * i + 1] - my, z = pos[3 * i + 2] - mz;
      out[3 * i] = x; out[3 * i + 1] = y; out[3 * i + 2] = z;
      const r2 = x * x + y * y + z * z;
      s2 += r2; if (r2 > rmax) rmax = r2;
    }
    return { pos: out, n, rg2: s2 / n, rmax: Math.sqrt(rmax) };
  }
  function buildGrid(C) {
    const grid = new Map(), p = C.pos;
    for (let i = 0; i < C.n; i++) {
      const k = cellKey(Math.floor(p[3 * i] / CELL), Math.floor(p[3 * i + 1] / CELL), Math.floor(p[3 * i + 2] / CELL));
      const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]);
    }
    return grid;
  }
  function overlapsGrid(grid, P, x, y, z) {
    const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL), iz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(cellKey(ix + a, iy + b, iz + c));
      if (!l) continue;
      for (let m = 0; m < l.length; m++) {
        const j = l[m], dx = P[3 * j] - x, dy = P[3 * j + 1] - y, dz = P[3 * j + 2] - z;
        if (dx * dx + dy * dy + dz * dz < OVERLAP2) return true;
      }
    }
    return false;
  }
  function perpBasis(u) {
    let ax = 1, ay = 0, az = 0;
    if (Math.abs(u[0]) > 0.9) { ax = 0; ay = 1; }
    let vx = ay * u[2] - az * u[1], vy = az * u[0] - ax * u[2], vz = ax * u[1] - ay * u[0];
    const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
    return [[vx, vy, vz], [u[1] * vz - u[2] * vy, u[2] * vx - u[0] * vz, u[0] * vy - u[1] * vx]];
  }
  function axisAngle(u, t) {
    const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = u;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
            y * x * C + z * s, c + y * y * C, y * z * C - x * s,
            z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  function mul3(A, B) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return r;
  }
  // Rotation taking unit vector a onto unit vector b.
  function rotFromTo(a, b, rand) {
    const c = dot(a, b);
    if (c > 1 - 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (c < -1 + 1e-12) return axisAngle(perpBasis(a)[0], Math.PI);
    const ax = cross(a, b), l = Math.hypot(ax[0], ax[1], ax[2]);
    return axisAngle([ax[0] / l, ax[1] / l, ax[2] / l], Math.acos(c));
  }
  function randomRotation(rand) {
    const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), r = Math.sqrt(1 - z * z);
    return mul3(axisAngle([r * Math.cos(ph), r * Math.sin(ph), z], 2 * Math.PI * rand()), axisAngle([0, 0, 1], 2 * Math.PI * rand()));
  }
  function placeB(B, R, c, out) {
    const p = B.pos;
    for (let m = 0; m < B.n; m++) {
      const x = p[3 * m], y = p[3 * m + 1], z = p[3 * m + 2];
      out[3 * m] = c[0] + R[0] * x + R[1] * y + R[2] * z;
      out[3 * m + 1] = c[1] + R[3] * x + R[4] * y + R[5] * z;
      out[3 * m + 2] = c[2] + R[6] * x + R[7] * y + R[8] * z;
    }
  }
  // Try to put B (centre of mass at distance G from A's) in contact with A, no overlaps.
  function tryContact(A, B, G, grid, rand, attempts) {
    const PA = A.pos, PB = B.pos;
    const rA = new Float64Array(A.n), sB = new Float64Array(B.n);
    for (let i = 0; i < A.n; i++) rA[i] = Math.hypot(PA[3 * i], PA[3 * i + 1], PA[3 * i + 2]);
    for (let j = 0; j < B.n; j++) sB[j] = Math.hypot(PB[3 * j], PB[3 * j + 1], PB[3 * j + 2]);
    const candA = [];
    for (let i = 0; i < A.n; i++) if (rA[i] >= G - B.rmax - 2 - 1e-9 && rA[i] <= G + B.rmax + 2 + 1e-9) candA.push(i);
    if (!candA.length) return null;
    const out = new Float64Array(3 * B.n);
    const order = new Int32Array(B.n);
    for (let t = 0; t < attempts; t++) {
      const i = candA[Math.floor(rand() * candA.length)], r = rA[i];
      // a B monomer that can geometrically reach monomer i at this centre distance
      let j = -1, lo = 0, hi = 0;
      for (let k = 0; k < 24; k++) {
        const jj = Math.floor(rand() * B.n), s = sB[jj];
        const l = Math.max(Math.abs(s - 2), Math.abs(G - r)), h = Math.min(s + 2, G + r);
        if (l <= h) { j = jj; lo = l; hi = h; break; }
      }
      if (j < 0) continue;
      const s = sB[j];
      const rho = lo + rand() * (hi - lo);       // distance between monomer i and B's centre
      // B's centre: |c| = G, |c - p_i| = rho
      const pi = [PA[3 * i], PA[3 * i + 1], PA[3 * i + 2]];
      let c;
      if (r < 1e-9) {
        const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), q = Math.sqrt(1 - z * z);
        c = [G * q * Math.cos(ph), G * q * Math.sin(ph), G * z];
      } else {
        const u = [pi[0] / r, pi[1] / r, pi[2] / r];
        const x = (G * G - rho * rho + r * r) / (2 * r), h2 = G * G - x * x;
        if (h2 < 0) continue;
        const h = Math.sqrt(h2), [e1, e2] = perpBasis(u), ph = 2 * Math.PI * rand();
        c = [u[0] * x + h * (Math.cos(ph) * e1[0] + Math.sin(ph) * e2[0]),
             u[1] * x + h * (Math.cos(ph) * e1[1] + Math.sin(ph) * e2[1]),
             u[2] * x + h * (Math.cos(ph) * e1[2] + Math.sin(ph) * e2[2])];
      }
      // contact point q: |q - p_i| = 2, |q - c| = s
      const dv = [c[0] - pi[0], c[1] - pi[1], c[2] - pi[2]], dl = Math.hypot(dv[0], dv[1], dv[2]);
      let w, R0;
      if (s < 1e-9) {
        R0 = randomRotation(rand); w = null;
      } else {
        if (dl < 1e-9) continue;
        const uu = [dv[0] / dl, dv[1] / dl, dv[2] / dl];
        const x2 = (dl * dl + 4 - s * s) / (2 * dl), h2b = 4 - x2 * x2;
        if (h2b < 0) continue;
        const hb = Math.sqrt(h2b), [f1, f2] = perpBasis(uu), ps = 2 * Math.PI * rand();
        const q = [pi[0] + uu[0] * x2 + hb * (Math.cos(ps) * f1[0] + Math.sin(ps) * f2[0]),
                   pi[1] + uu[1] * x2 + hb * (Math.cos(ps) * f1[1] + Math.sin(ps) * f2[1]),
                   pi[2] + uu[2] * x2 + hb * (Math.cos(ps) * f1[2] + Math.sin(ps) * f2[2])];
        w = [(q[0] - c[0]) / s, (q[1] - c[1]) / s, (q[2] - c[2]) / s];
        R0 = rotFromTo([PB[3 * j] / s, PB[3 * j + 1] / s, PB[3 * j + 2] / s], w, rand);
      }
      // check B monomers nearest the contact first (fast rejection)
      const vj = [PB[3 * j], PB[3 * j + 1], PB[3 * j + 2]];
      const dj = new Float64Array(B.n);
      for (let m = 0; m < B.n; m++) { dj[m] = (PB[3 * m] - vj[0]) ** 2 + (PB[3 * m + 1] - vj[1]) ** 2 + (PB[3 * m + 2] - vj[2]) ** 2; order[m] = m; }
      order.sort((a, b) => dj[a] - dj[b]);
      const spins = w ? 12 : 1, ph0 = 2 * Math.PI * rand();
      for (let k = 0; k < spins; k++) {
        const R = w ? mul3(axisAngle(w, ph0 + k * 2 * Math.PI / spins), R0) : R0;
        let ok = true;
        for (let mm = 0; mm < B.n; mm++) {
          const m = order[mm], x = PB[3 * m], y = PB[3 * m + 1], z = PB[3 * m + 2];
          const X = c[0] + R[0] * x + R[1] * y + R[2] * z, Y = c[1] + R[3] * x + R[4] * y + R[5] * z, Z = c[2] + R[6] * x + R[7] * y + R[8] * z;
          if (overlapsGrid(grid, PA, X, Y, Z)) { ok = false; break; }
        }
        if (ok) { placeB(B, R, c, out); return out; }
      }
    }
    return null;
  }
  // Fallback that always succeeds: bring B in along a random line until it touches A.
  function ballisticContact(A, B, grid, rand) {
    const R = randomRotation(rand);
    const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), q = Math.sqrt(1 - z * z), u = [q * Math.cos(ph), q * Math.sin(ph), z];
    const out = new Float64Array(3 * B.n);
    const hits = (t) => {
      placeB(B, R, [u[0] * t, u[1] * t, u[2] * t], out);
      for (let m = 0; m < B.n; m++) if (overlapsGrid(grid, A.pos, out[3 * m], out[3 * m + 1], out[3 * m + 2])) return true;
      return false;
    };
    let tFree = A.rmax + B.rmax + 2.5, tHit = tFree;
    while (tHit > 0 && !hits(tHit)) { tFree = tHit; tHit -= 0.5; }
    if (tHit <= 0) tHit = 0;
    for (let k = 0; k < 30; k++) { const m = (tFree + tHit) / 2; if (hits(m)) tHit = m; else tFree = m; }
    placeB(B, R, [u[0] * tFree, u[1] * tFree, u[2] * tFree], out);
    return out;
  }
  function mergeClusters(A, B, df, kf, rand, st) {
    if (B.n > A.n) { const t = A; A = B; B = t; }
    const N = A.n + B.n;
    const rgT2 = Math.pow(N / kf, 2 / df);
    const G2 = (N * N / (A.n * B.n)) * rgT2 - (N / B.n) * A.rg2 - (N / A.n) * B.rg2;
    const Gmax = A.rmax + B.rmax + 2 - 1e-6;
    let G = G2 > 0 ? Math.sqrt(G2) : 0, exact = G <= Gmax;
    if (!exact) G = Gmax;
    const grid = buildGrid(A);
    let placed = null;
    for (let relax = 0; relax < 8 && !placed; relax++) {
      placed = tryContact(A, B, G, grid, rand, relax ? 80 : 160);
      if (!placed) { exact = false; G = G > 0.6 * Gmax ? G * 0.96 : G * 1.06 + 0.3; }
    }
    if (!placed) { placed = ballisticContact(A, B, grid, rand); exact = false; }
    st.merges++; if (exact) st.exact++;
    const pos = new Float64Array(3 * N);
    pos.set(A.pos); pos.set(placed, 3 * A.n);
    return centred(pos, N);
  }
  const CCA_MAX_DF = 2.3;   // above this, tunable CCA fails to meet the scaling law (validated)
  function subclusterSize(N) { return Math.max(4, Math.min(32, Math.round(Math.pow(N, 0.4)))); }
  const ccaCache = new Map();
  function generateCCA(N, df, kf, seed) {
    const key = N + '|' + df.toFixed(3) + '|' + kf.toFixed(3) + '|' + (seed >>> 0);
    let res = ccaCache.get(key);
    if (res) { ccaCache.delete(key); ccaCache.set(key, res); return res; }
    const rand = mulberry32(((seed >>> 0) ^ 0x9e3779b9) || 7);
    const st = { merges: 0, exact: 0 };
    const hist = [];
    const ns = subclusterSize(N);
    let C;
    if (N <= 2 * ns) {
      const g = new Growth(df, kf, seed); g.extend(N);
      C = centred(g.pos, N);
      hist.push([N, Math.sqrt(C.rg2)]);
    } else {
      const m = Math.round(N / ns), sizes = [];
      for (let k = 0; k < m; k++) sizes.push(Math.floor(N / m) + (k < N % m ? 1 : 0));
      let clusters = sizes.map((sz, k) => { const g = new Growth(df, kf, (seed >>> 0) + 7919 * (k + 1)); g.extend(sz); return centred(g.pos, sz); });
      for (const c of clusters) hist.push([c.n, Math.sqrt(c.rg2)]);
      while (clusters.length > 1) {
        clusters.sort((a, b) => b.n - a.n);
        const next = [];
        for (let k = 0; k + 1 < clusters.length; k += 2) {
          const mc = mergeClusters(clusters[k], clusters[k + 1], df, kf, rand, st);
          hist.push([mc.n, Math.sqrt(mc.rg2)]);
          next.push(mc);
        }
        if (clusters.length % 2) next.push(clusters[clusters.length - 1]);
        clusters = next;
      }
      C = clusters[0];
    }
    // fitted Df / kf over the hierarchy (all clusters of size >= 8)
    let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
    for (const [n, rg] of hist) if (n >= 8 && rg > 0) { const X = Math.log(rg), Y = Math.log(n); sx += X; sy += Y; sxx += X * X; sxy += X * Y; k++; }
    const slope = k >= 3 ? (k * sxy - sx * sy) / (k * sxx - sx * sx) : null;
    res = { C, exact: st.merges ? st.exact / st.merges : 1, dfFit: slope, kfFit: slope != null ? Math.exp((sy - slope * sx) / k) : null };
    ccaCache.set(key, res);
    while (ccaCache.size > 12) ccaCache.delete(ccaCache.keys().next().value);
    return res;
  }
  // Principal frame + extents of an explicit cluster at in-plane angle th.
  function frameOfPos(P, n, th) {
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += P[3 * i]; my += P[3 * i + 1]; mz += P[3 * i + 2]; }
    mx /= n; my /= n; mz /= n;
    const Cm = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const v = [P[3 * i] - mx, P[3 * i + 1] - my, P[3 * i + 2] - mz];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Cm[3 * a + b] += v[a] * v[b] / n;
    }
    const ev = eigenSym3(Cm);
    const p1 = ev[0].vec, p2 = ev[1].vec, ct = Math.cos(th), stt = Math.sin(th);
    const e1 = [ct * p1[0] + stt * p2[0], ct * p1[1] + stt * p2[1], ct * p1[2] + stt * p2[2]];
    const e2 = [-stt * p1[0] + ct * p2[0], -stt * p1[1] + ct * p2[1], -stt * p1[2] + ct * p2[2]];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const q = [P[3 * i] - mx, P[3 * i + 1] - my, P[3 * i + 2] - mz];
      const s1 = dot(q, e1), t1 = dot(q, e2);
      if (s1 < a0) a0 = s1; if (s1 > a1) a1 = s1; if (t1 < b0) b0 = t1; if (t1 > b1) b1 = t1;
    }
    return { c: [mx, my, mz], e1, e2, major: a1 - a0 + 2, minor: b1 - b0 + 2, a0, a1, b0, b1, ev };
  }
  function anisotropy(ev) { return Math.sqrt(Math.max(ev[0].val, 1e-12) / Math.max(ev[2].val, 1e-12)); }

  function fitBoxCCA(params, df, kf, W, H, nMax) {
    const long = Math.max(W, H), short = Math.min(W, H);
    const seed = params.seed | 0;
    const bestOrient = (C) => {
      let best = null;
      for (const th of ANGLES) {
        const f = frameOfPos(C.pos, C.n, th), fill = Math.max(f.major / long, f.minor / short);
        if (!best || fill < best.fill * 0.97) best = { f, fill, th };
      }
      return best;
    };
    if (short < 2) {
      const g = generateCCA(1, df, kf, seed);
      return { res: g, o: bestOrient(g.C) };
    }
    let N = Math.max(2, Math.min(nMax, Math.round(kf * Math.pow(0.5 * Math.sqrt(long * short) * Math.sqrt(df / (df + 2)), df))));
    const tried = [];
    for (let it = 0; it < 5; it++) {
      const res = generateCCA(N, df, kf, seed), o = bestOrient(res.C);
      tried.push({ N, res, o });
      if (o.fill <= 1 && (o.fill > 0.93 || N >= nMax)) break;
      let Nn = Math.round(N * Math.pow(1 / o.fill, df) * (o.fill > 1 ? 0.97 : 1));
      Nn = Math.max(2, Math.min(nMax, Nn));
      if (tried.some(t => t.N === Nn)) Nn = o.fill > 1 ? Math.max(2, N - Math.max(1, Math.round(0.08 * N))) : Math.min(nMax, N + Math.max(1, Math.round(0.08 * N)));
      if (Nn === N) break;
      N = Nn;
    }
    // largest aggregate that fits, else the one that overflows least
    const fits = tried.filter(t => t.o.fill <= 1.0);
    const pick = fits.length ? fits.reduce((a, b) => (b.N > a.N ? b : a)) : tried.reduce((a, b) => (b.o.fill < a.o.fill ? b : a));
    return { res: pick.res, o: pick.o };
  }

  /*
   * params: { W, H: box size in monomer radii; df, kf, seed, nMax, method: 'pc'|'cca' }
   * returns { pts: Float32Array (x,y,z per monomer, radii, centred on the box,
   *           x along the box width), n, rg, dfFit, kfFit, capped, fill, exact }
   */
  function fitBox(params) {
    const df = Math.min(3, Math.max(1, +params.df || 1.8));
    const kf = (params.kf == null || !(+params.kf > 0)) ? kfAuto(df) : Math.max(0.3, +params.kf);
    const nMax = Math.max(1, Math.floor(params.nMax || 3000));
    const W = Math.max(0, +params.W || 0), H = Math.max(0, +params.H || 0);
    const long = Math.max(W, H), short = Math.min(W, H);
    if (params.method === 'cca') {
      // Cluster–cluster cannot reach compact structures; above CCA_MAX_DF use particle–cluster.
      if (df <= CCA_MAX_DF) return fitBoxCCAResult(params, df, kf, W, H, nMax);
      const r = fitBox({ ...params, method: 'pc' });
      r.ccaFallback = true;
      return r;
    }
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
    const evK = eigenSym3(g.moments(k).C);
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
      aniso: anisotropy(evK),
      method: 'pc',
    };
  }

  function fitBoxCCAResult(params, df, kf, W, H, nMax) {
    const { res, o } = fitBoxCCA(params, df, kf, W, H, nMax);
    const C = res.C, f = o.f, k = C.n;
    let ex = f.e1, ey = f.e2, ox = (f.a0 + f.a1) / 2, oy = (f.b0 + f.b1) / 2;
    if (H > W) { ex = f.e2; ey = f.e1; ox = (f.b0 + f.b1) / 2; oy = (f.a0 + f.a1) / 2; }
    const ez = cross(ex, ey);
    const pts = new Float32Array(3 * k);
    for (let i = 0; i < k; i++) {
      const q = [C.pos[3 * i] - f.c[0], C.pos[3 * i + 1] - f.c[1], C.pos[3 * i + 2] - f.c[2]];
      pts[3 * i] = dot(q, ex) - ox; pts[3 * i + 1] = dot(q, ey) - oy; pts[3 * i + 2] = dot(q, ez);
    }
    const long = Math.max(W, H), short = Math.min(W, H);
    const fill = short >= 2 ? Math.max(f.major / long, f.minor / short) : 1;
    return {
      pts, n: k, rg: Math.sqrt(C.rg2), dfFit: res.dfFit, kfFit: res.kfFit,
      capped: k >= nMax && fill < 0.97, fill, fillMin: short >= 2 ? Math.min(f.major / long, f.minor / short) : 1,
      exact: res.exact, kf, aniso: anisotropy(f.ev), method: 'cca',
    };
  }

  const AggEngine = { fitBox, kfAuto, Growth, eigenSym3, generateCCA, CCA_MAX_DF, version: 1, release: '2026.10.18-15' };
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
        root.postMessage({ type: 'result', id: m.id, token: m.token, genA: m.a, ...r }, [r.pts.buffer]);
      } catch (err) {
        root.postMessage({ type: 'error', id: m.id, token: m.token, message: String(err && err.message || err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
