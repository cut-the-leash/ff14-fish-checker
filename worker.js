// Runs the screenshot reader off the main thread so the page stays responsive.
// Holds one reference set per guide tab (fishing rod, spearfishing).
importScripts('core.js');
const sets = {};
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    for (const [mode, d] of Object.entries(m.sets)) {
      sets[mode] = { refs: FishReader.buildRefs(d.icons, d.cols, d.count, m.unknown, m.blank), fishIcons: d.fishIcons };
    }
    postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'analyze') {
    try {
      const run = (mode) => FishReader.analyze(m.img, sets[mode].refs, sets[mode].fishIcons, m.hint || null);
      let mode = m.mode, r = run(mode);
      // Not a page of this tab? It may be a screenshot of the other tab.
      if (!r.ok || r.page < 0) {
        for (const other of Object.keys(sets)) {
          if (other === mode) continue;
          const r2 = run(other);
          if (r2.ok && r2.page >= 0) { r = r2; mode = other; break; }
        }
      }
      postMessage({ type: 'result', id: m.id, mode, r: {
        ok: r.ok, page: r.page, grid: r.grid,
        cells: (r.cells || []).map(c => ({ idx: c.idx, state: c.state }))
      } });
    } catch (err) {
      postMessage({ type: 'result', id: m.id, error: String(err && err.message || err) });
    }
  }
};
