// Fish guide screenshot reader. Pure functions over {w,h,data:RGBA} images.
// Works in the browser and in Node (for testing).
(function (root) {
  'use strict';

  const ICON = 44;            // reference icon size in px
  const FB = 12;              // feature grid (FB x FB bins)
  const INNER = 0.2;          // crop this fraction off each side before binning
  const FBC = 6;             // coarse grid, tolerant of a few pixels of misalignment

  // ---------- integral image over a sub-rectangle ----------
  function integral(img, rx, ry, rw, rh) {
    rx = Math.max(0, Math.floor(rx)); ry = Math.max(0, Math.floor(ry));
    rw = Math.min(img.w - rx, Math.ceil(rw)); rh = Math.min(img.h - ry, Math.ceil(rh));
    const W = rw + 1, H = rh + 1;
    const I = [new Float64Array(W * H), new Float64Array(W * H), new Float64Array(W * H)];
    const d = img.data;
    for (let y = 1; y < H; y++) {
      let s0 = 0, s1 = 0, s2 = 0;
      let p = ((ry + y - 1) * img.w + rx) * 4;
      const row = y * W, prev = (y - 1) * W;
      for (let x = 1; x < W; x++, p += 4) {
        s0 += d[p]; s1 += d[p + 1]; s2 += d[p + 2];
        I[0][row + x] = I[0][prev + x] + s0;
        I[1][row + x] = I[1][prev + x] + s1;
        I[2][row + x] = I[2][prev + x] + s2;
      }
    }
    return { I, W, H, ox: rx, oy: ry };
  }

  // Feature of a square box (x,y,size s) in image coords, using integral ii.
  function feature(ii, x, y, s, fb) {
    fb = fb || FB;
    const out = new Float32Array(fb * fb * 3);
    const x0 = x + s * INNER, y0 = y + s * INNER, span = s * (1 - 2 * INNER), step = span / fb;
    const { I, W, H, ox, oy } = ii;
    let k = 0;
    for (let by = 0; by < fb; by++) {
      let ya = Math.round(y0 + by * step) - oy, yb = Math.round(y0 + (by + 1) * step) - oy;
      ya = Math.max(0, Math.min(H - 1, ya)); yb = Math.max(ya + 1, Math.min(H - 1, yb));
      for (let bx = 0; bx < fb; bx++) {
        let xa = Math.round(x0 + bx * step) - ox, xb = Math.round(x0 + (bx + 1) * step) - ox;
        xa = Math.max(0, Math.min(W - 1, xa)); xb = Math.max(xa + 1, Math.min(W - 1, xb));
        const area = (xb - xa) * (yb - ya) || 1;
        for (let c = 0; c < 3; c++) {
          const A = I[c];
          out[k++] = (A[yb * W + xb] - A[ya * W + xb] - A[yb * W + xa] + A[ya * W + xa]) / area;
        }
      }
    }
    return out;
  }

  function dist(a, b) {
    let s = 0;
    const n = a.length;
    for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s / n;
  }

  // ---------- reference data ----------
  // icons: image of the icon sheet; cols: icons per row; unknown: strip of "?" cells
  function buildRefs(iconsImg, cols, count, unknownImg) {
    const ii = integral(iconsImg, 0, 0, iconsImg.w, iconsImg.h);
    const icons = [], iconsC = [];
    for (let k = 0; k < count; k++) {
      const x = (k % cols) * ICON, y = Math.floor(k / cols) * ICON;
      icons.push(feature(ii, x, y, ICON)); iconsC.push(feature(ii, x, y, ICON, FBC));
    }
    const ui = integral(unknownImg, 0, 0, unknownImg.w, unknownImg.h);
    const unknown = [], unknownC = [];
    for (let k = 0; k < Math.floor(unknownImg.w / ICON); k++) {
      unknown.push(feature(ui, k * ICON, 0, ICON)); unknownC.push(feature(ui, k * ICON, 0, ICON, FBC));
    }
    return { icons, unknown, coarse: { icons: iconsC, unknown: unknownC } };
  }

  // ---------- coarse lattice search ----------
  // Finds a 10x10 grid of square cells by looking for regularly spaced dark gaps.
  // Gray, min-filtered gap maps and their running sums at scale f, plus the lattice score.
  function latticeMaps(img, f) {
    const w = Math.max(2, Math.floor(img.w * f)), h = Math.max(2, Math.floor(img.h * f));
    // downscaled gray by box sampling
    const G = new Float32Array(w * h);
    const inv = 1 / f, d = img.data;
    for (let y = 0; y < h; y++) {
      const sy0 = Math.floor(y * inv), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * inv));
      for (let x = 0; x < w; x++) {
        const sx0 = Math.floor(x * inv), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * inv));
        let s = 0, n = 0;
        for (let yy = sy0; yy < sy1 && yy < img.h; yy += 1) for (let xx = sx0; xx < sx1 && xx < img.w; xx += 1) {
          const p = (yy * img.w + xx) * 4; s += d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11; n++;
        }
        G[y * w + x] = n ? s / n : 0;
      }
    }
    // Cells are separated by thin dark gaps. Min-filter so a 1px gap survives downscaling.
    const Dx = new Float32Array(w * h), Dy = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      Dx[i] = Math.min(G[i], x > 0 ? G[i - 1] : 255, x < w - 1 ? G[i + 1] : 255, x > 1 ? G[i - 2] : 255, x < w - 2 ? G[i + 2] : 255);
      Dy[i] = Math.min(G[i], y > 0 ? G[i - w] : 255, y < h - 1 ? G[i + w] : 255, y > 1 ? G[i - 2 * w] : 255, y < h - 2 ? G[i + 2 * w] : 255);
    }
    // column-cumulative (down y) and row-cumulative (along x) sums
    const colCum = A => { const C = new Float32Array(w * (h + 1)); for (let x = 0; x < w; x++) { let s = 0; const b = x * (h + 1); for (let y = 0; y < h; y++) { s += A[y * w + x]; C[b + y + 1] = s; } } return C; };
    const rowCum = A => { const C = new Float32Array(h * (w + 1)); for (let y = 0; y < h; y++) { let s = 0; const b = y * (w + 1); for (let x = 0; x < w; x++) { s += A[y * w + x]; C[b + x + 1] = s; } } return C; };
    const CDx = colCum(Dx), CG = colCum(G), RDy = rowCum(Dy), RG = rowCum(G);
    const colSeg = (C, x, y0, y1) => C[x * (h + 1) + y1] - C[x * (h + 1) + y0];
    const rowSeg = (C, y, x0, x1) => C[y * (w + 1) + x1] - C[y * (w + 1) + x0];

    // Gap lines darker than the cell middles, in both directions.
    function score(x0, y0, P) {
      const L = Math.round(10 * P), y1 = y0 + L, x1 = x0 + L;
      if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) return -1e9;
      let vGap = 0, vMid = 0, hGap = 0, hMid = 0, vMax = 0, hMax = 0;
      for (let i = 0; i <= 10; i++) {
        const a = colSeg(CDx, Math.round(x0 + i * P), y0, y1), b = rowSeg(RDy, Math.round(y0 + i * P), x0, x1);
        vGap += a; hGap += b; vMax = Math.max(vMax, a); hMax = Math.max(hMax, b);
        if (i < 10) {
          vMid += colSeg(CG, Math.round(x0 + i * P + P / 2), y0, y1);
          hMid += rowSeg(RG, Math.round(y0 + i * P + P / 2), x0, x1);
        }
      }
      // the brightest gap line counts against the score, so every line must be dark
      const v = vMid / 10 - (vGap + vMax) / 12, hh = hMid / 10 - (hGap + hMax) / 12;
      return Math.min(v, hh) / L;
    }

    return { score, w, h, f };
  }

  // Coarse-to-fine: scan a small copy of the screenshot for grid-like regions,
  // then re-score only around those regions at a finer scale.
  function findLattice(img, maxCandidates, probe) {
    const big = Math.max(img.w, img.h);
    const fine = latticeMaps(img, Math.min(1, 1200 / big));
    if (probe) return probe.map(q => fine.score(Math.round(q.x * fine.f), Math.round(q.y * fine.f), q.P * fine.f));
    const coarse = fine.f > 700 / big ? latticeMaps(img, Math.min(1, 700 / big)) : fine;
    const { w, h } = coarse, cs = coarse.score;
    const Pmin = Math.max(7, 26 * coarse.f), Pmax = Math.min(Math.min(w, h) / 10.2, 130 * coarse.f);
    // At the coarse scale keep several pitches per region: the right one may only win after refining.
    const keep = maxCandidates * 4;
    const best = [];
    const push = (s, x, y, P) => {
      for (const b of best) if (Math.abs(b.x - x) < P * 0.6 && Math.abs(b.y - y) < P * 0.6 && Math.abs(b.P - P) < P * 0.06) {
        if (s > b.s) { b.s = s; b.x = x; b.y = y; b.P = P; } return;
      }
      best.push({ s, x, y, P }); best.sort((a, b) => b.s - a.s); if (best.length > keep) best.pop();
    };
    for (let P = Pmin; P <= Pmax; P *= 1.02) {
      const L = Math.round(10 * P);
      for (let y = 1; y + L < h - 1; y += 2) for (let x = 1; x + L < w - 1; x += 2) {
        const sc = cs(x, y, P);
        if (best.length < keep || sc > best[best.length - 1].s) push(sc, x, y, P);
      }
    }
    // refine each region at the fine scale
    const k = fine.f / coarse.f, R = Math.ceil(2.5 * k) + 1;
    const out = best.map(b => {
      const cx = Math.round(b.x * k), cy = Math.round(b.y * k), cP = b.P * k;
      let r = { s: -1e18, x: cx, y: cy, P: cP };
      for (let dp = -0.04; dp <= 0.0401; dp += 0.01) {
        const P = cP * (1 + dp);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const sc = fine.score(cx + dx, cy + dy, P);
          if (sc > r.s) r = { s: sc, x: cx + dx, y: cy + dy, P };
        }
      }
      let improved = true;
      while (improved) {
        improved = false;
        for (const [dx, dy, dq] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,0.004],[0,0,-0.004]]) {
          const nx = r.x + dx, ny = r.y + dy, nP = r.P * (1 + dq);
          const sc = fine.score(nx, ny, nP);
          if (sc > r.s + 1e-6) { r = { s: sc, x: nx, y: ny, P: nP }; improved = true; }
        }
      }
      return r;
    });
    out.sort((a, b) => b.s - a.s);
    // one candidate per region, whatever its pitch, so a busy HUD can't crowd out the guide
    const picked = [];
    for (const r of out) {
      if (picked.some(b => Math.abs(b.x + 5 * b.P - r.x - 5 * r.P) < 5 * Math.max(r.P, b.P) && Math.abs(b.y + 5 * b.P - r.y - 5 * r.P) < 5 * Math.max(r.P, b.P))) continue;
      picked.push(r);
      if (picked.length >= maxCandidates) break;
    }
    return picked.map(b => ({ x: b.x / fine.f, y: b.y / fine.f, P: b.P / fine.f, s: b.s }));
  }


  // ---------- fine fit against reference icons ----------
  const CLIP = 40;

  function cellFeatures(ii, g) {
    const out = [];
    const s = g.P * 0.997;
    for (let k = 0; k < 100; k++) out.push(feature(ii, g.x + (k % 10) * g.P, g.y + Math.floor(k / 10) * g.P, s));
    return out;
  }

  function minUnknown(refs, fv) {
    let m = Infinity;
    for (const u of refs.unknown) { const d = dist(fv, u); if (d < m) m = d; }
    return m;
  }

  // Cost of interpreting the 100 cells as guide page p (0-based).
  function pageCost(refs, fishIcons, feats, unk, p) {
    let c = 0;
    for (let k = 0; k < 100; k++) {
      const idx = p * 100 + k;
      let best = unk[k];
      if (idx < fishIcons.length && fishIcons[idx] >= 0) best = Math.min(best, dist(feats[k], refs.icons[fishIcons[idx]]));
      c += Math.min(best, CLIP);
    }
    return c;
  }

  function bestPage(refs, fishIcons, feats, unk) {
    const pages = Math.ceil(fishIcons.length / 100);
    let bp = 0, bc = Infinity, second = Infinity;
    for (let p = 0; p < pages; p++) {
      const c = pageCost(refs, fishIcons, feats, unk, p);
      if (c < bc) { second = bc; bc = c; bp = p; } else if (c < second) second = c;
    }
    return { page: bp, cost: bc, second };
  }

  // Snap a candidate to the dark gaps between cells. On pages full of "?" cells
  // the edge lattice can lock onto icon interiors, but the gaps stay darkest.
  function snapToGaps(img, c) {
    const P = c.P, d = img.data;
    const gray = (x, y) => { const p = (y * img.w + x) * 4; return d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11; };
    const prof = (horizontal, a0, lenA, b0, lenB) => {
      // mean gray along lines: horizontal=false gives a per-column profile
      const out = new Float32Array(Math.max(0, Math.ceil(lenA)));
      const bs = Math.max(0, Math.floor(b0)), be = Math.min(horizontal ? img.w : img.h, Math.floor(b0 + lenB));
      const step = Math.max(1, Math.floor((be - bs) / 300));
      for (let i = 0; i < out.length; i++) {
        const a = Math.floor(a0) + i;
        if (a < 0 || a >= (horizontal ? img.h : img.w)) { out[i] = 255; continue; }
        let s = 0, n = 0;
        for (let b = bs; b < be; b += step) { s += horizontal ? gray(b, a) : gray(a, b); n++; }
        out[i] = n ? s / n : 255;
      }
      return out;
    };
    const phase = (pr, base) => {
      let best = 0, bv = Infinity;
      for (let ph = 0; ph < P; ph += 0.5) {
        let v = 0, n = 0;
        for (let i = 1; i <= 9; i++) {
          const j = Math.round(base + ph + i * P);
          if (j < 1 || j >= pr.length - 1) continue;
          v += (pr[j - 1] + pr[j] + pr[j + 1]) / 3; n++;
        }
        if (n && v / n < bv) { bv = v / n; best = ph; }
      }
      return best;
    };
    const cx = prof(false, c.x - P, 12 * P, c.y, 10 * P);
    let phx = phase(cx, P);
    const cy = prof(true, c.y - P, 12 * P, c.x, 10 * P);
    let phy = phase(cy, P);
    if (phx > P / 2) phx -= P;
    if (phy > P / 2) phy -= P;
    const off = 0.01 * P;
    return { x: c.x + phx + off, y: c.y + phy + off, P };
  }

  // The coarse lattice can land one or two cells off; try whole-cell shifts.
  function nudgeCandidates(img, refs, fishIcons, c) {
    const offs = [];
    for (const dy of [-0.1, 0, 0.1]) for (const dx of [-0.1, 0, 0.1]) if (dx || dy) offs.push([dx, dy]);
    return shiftCandidates(img, refs, fishIcons, c, 8, offs);
  }

  function shiftCandidates(img, refs, fishIcons, c, keep, offsets) {
    const pad = c.P * 3.5;
    const ii = integral(img, c.x - pad, c.y - pad, c.P * 10 + 2 * pad, c.P * 10 + 2 * pad);
    const out = [];
    const pages = Math.ceil(fishIcons.length / 100);
    const sub = [];
    for (let k = 0; k < 100; k += 3) sub.push(k);
    const s = c.P * 0.997;
    if (!offsets) { offsets = []; for (let sy = -2; sy <= 2; sy++) for (let sx = -2; sx <= 2; sx++) offsets.push([sx, sy]); }
    for (const [sx, sy] of offsets) {
      const g = { x: c.x + sx * c.P, y: c.y + sy * c.P, P: c.P };
      if (g.x < -c.P * 0.2 || g.y < -c.P * 0.2 || g.x + 10 * g.P > img.w + c.P * 0.2 || g.y + 10 * g.P > img.h + c.P * 0.2) continue;
      const feats = sub.map(k => feature(ii, g.x + (k % 10) * g.P, g.y + Math.floor(k / 10) * g.P, s, FBC));
      const unk = feats.map(fv => minUnknown(refs.coarse, fv));
      let bc = Infinity;
      for (let p = 0; p < pages; p++) {
        let cst = 0;
        sub.forEach((k, j) => {
          const idx = p * 100 + k;
          let b = unk[j];
          if (idx < fishIcons.length && fishIcons[idx] >= 0) b = Math.min(b, dist(feats[j], refs.coarse.icons[fishIcons[idx]]));
          cst += Math.min(b, CLIP);
        });
        if (cst < bc) bc = cst;
      }
      out.push({ g, cost: bc * 100 / sub.length });
    }
    out.sort((a, b) => a.cost - b.cost);
    return out.slice(0, keep);
  }

  function fitGrid(img, refs, fishIcons, g0, fixedPage) {
    const pad = g0.P * 1.5;
    const ii = integral(img, g0.x - pad, g0.y - pad, g0.P * 10 + 2 * pad, g0.P * 10 + 2 * pad);
    const evalAt = (g, page) => {
      const feats = cellFeatures(ii, g);
      const unk = feats.map(fv => minUnknown(refs, fv));
      if (page == null) { const b = bestPage(refs, fishIcons, feats, unk); return { cost: b.cost, second: b.second, page: b.page, feats, unk }; }
      return { cost: pageCost(refs, fishIcons, feats, unk, page), page, feats, unk };
    };
    let g = { x: g0.x, y: g0.y, P: g0.P };
    let cur = evalAt(g, fixedPage);
    let page = cur.page;
    const steps = [[3, 0.012], [1.5, 0.006], [0.75, 0.003], [0.4, 0.0015]];
    for (const [st, ps] of steps) {
      let improved = true, guard = 0;
      while (improved && guard++ < 30) {
        improved = false;
        for (const [dx, dy, dp] of [[st,0,0],[-st,0,0],[0,st,0],[0,-st,0],[0,0,ps],[0,0,-ps]]) {
          const ng = { x: g.x + dx * g.P / 44, y: g.y + dy * g.P / 44, P: g.P * (1 + dp) };
          const r = evalAt(ng, page);
          if (r.cost < cur.cost - 1e-6) { g = ng; cur = r; improved = true; }
        }
      }
      if (fixedPage == null) { const r = evalAt(g, null); cur = r; page = r.page; }
    }
    return { grid: g, page, cost: cur.cost, second: cur.second, feats: cur.feats, unk: cur.unk };
  }

  // ---------- classification ----------
  function classify(refs, fishIcons, fit) {
    const cells = [];
    for (let k = 0; k < 100; k++) {
      const idx = fit.page * 100 + k;
      if (idx >= fishIcons.length) { cells.push({ idx: -1, state: 'none' }); continue; }
      const de = fishIcons[idx] >= 0 ? dist(fit.feats[k], refs.icons[fishIcons[idx]]) : Infinity;
      const du = fit.unk[k];
      let state;
      if (de < 34 && de < du - 8) state = 'caught';
      else if (du < 26 && du < de - 8) state = 'empty';
      else state = 'unsure';
      cells.push({ idx, state, de, du });
    }
    return cells;
  }

  // Full pipeline for one screenshot. hint: optional {x,y,P} from manual clicks.
  // Surround the screenshot with a dark border so a grid cropped right to its edges
  // still has room around it for the search. Results are shifted back afterwards.
  function padImage(img, pad) {
    const w = img.w + 2 * pad, h = img.h + 2 * pad;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 24; data[i + 1] = 26; data[i + 2] = 28; data[i + 3] = 255; }
    for (let y = 0; y < img.h; y++) {
      data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + pad) * w + pad) * 4);
    }
    return { w, h, data };
  }

  function analyze(img0, refs, fishIcons, hint0) {
    const pad = Math.round(Math.max(img0.w, img0.h) * 0.06) + 8;
    const img = padImage(img0, pad);
    const hint = hint0 ? { x: hint0.x + pad, y: hint0.y + pad, P: hint0.P } : null;
    const r = analyzePadded(img, refs, fishIcons, hint);
    if (r.grid) r.grid = { x: r.grid.x - pad, y: r.grid.y - pad, P: r.grid.P };
    return r;
  }

  function analyzePadded(img, refs, fishIcons, hint) {
    const lat = hint ? [hint] : findLattice(img, 10);
    let cands = [];
    for (const c of lat) {
      cands = cands.concat(shiftCandidates(img, refs, fishIcons, c, 2));
      cands = cands.concat(shiftCandidates(img, refs, fishIcons, snapToGaps(img, c), 2));
    }
    cands.sort((a, b) => a.cost - b.cost);
    // The darkest line can be a cell's own frame rather than the gap, so nudge the
    // most promising placements by a tenth of a cell before the fine fit.
    let nudged = [];
    for (const c of cands.slice(0, 4)) nudged = nudged.concat(nudgeCandidates(img, refs, fishIcons, c.g));
    cands = cands.concat(nudged);
    cands.sort((a, b) => a.cost - b.cost);
    let best = null;
    for (const c of cands.slice(0, 3)) {
      const fit = fitGrid(img, refs, fishIcons, c.g, null);
      if (!best || fit.cost < best.cost) best = fit;
    }
    if (!best) return { ok: false, reason: 'nogrid' };
    // A page of nothing but "?" cells fits every page equally well. Don't guess a page for it.
    const pages = Math.ceil(fishIcons.length / 100);
    const emptyish = best.unk.filter(du => du < 26).length;
    if (pages > 1 && emptyish >= 75 && best.second - best.cost < 10) {
      const cells = best.unk.map(du => ({ idx: -1, state: du < 26 ? 'empty' : 'unsure' }));
      return { ok: true, page: -1, grid: best.grid, cells, caught: 0, unsure: cells.filter(c => c.state === 'unsure').length, cost: best.cost };
    }
    const cells = classify(refs, fishIcons, best);
    const valid = cells.filter(c => c.state !== 'none');
    const unsure = valid.filter(c => c.state === 'unsure').length;
    const caught = valid.filter(c => c.state === 'caught').length;
    const ok = valid.length > 0 && unsure / valid.length < 0.25;
    return { ok, reason: ok ? null : 'mismatch', page: best.page, grid: best.grid, cells, caught, unsure, cost: best.cost };
  }

  root.FishReader = { analyze, buildRefs, findLattice, fitGrid, classify, ICON };
})(typeof window !== 'undefined' ? window : globalThis);
