// Sculpts one part of the operator off the main thread (see sculpt.js).
import { SC } from './sculpt.js';

self.onmessage = (e) => {
  const { n, h } = e.data;
  let last = 0;
  const r = SC.polygonize(n, (p) => {
    const t = Date.now();
    if (t - last > 150) {
      last = t;
      self.postMessage({ t: 'p', n, p });
    }
  }, h);
  const tr = [r.ao.buffer, r.pos.buffer, r.nrm.buffer, r.id.buffer, r.uv.buffer, r.idx.buffer];
  if (r.lb) tr.push(r.lb.buffer);
  self.postMessage({ t: 'd', n, lb: r.lb, ao: r.ao, pos: r.pos, nrm: r.nrm, id: r.id, uv: r.uv, idx: r.idx }, tr);
};
