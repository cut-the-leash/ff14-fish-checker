// Runs the screenshot reader off the main thread so the page stays responsive.
importScripts('core.js');
let refs = null, fishIcons = null;
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    refs = FishReader.buildRefs(m.icons, m.cols, m.count, m.unknown);
    fishIcons = m.fishIcons;
    postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'analyze') {
    try {
      const r = FishReader.analyze(m.img, refs, fishIcons, m.hint || null);
      postMessage({ type: 'result', id: m.id, r: {
        ok: r.ok, page: r.page, grid: r.grid,
        cells: (r.cells || []).map(c => ({ idx: c.idx, state: c.state }))
      } });
    } catch (err) {
      postMessage({ type: 'result', id: m.id, error: String(err && err.message || err) });
    }
  }
};
