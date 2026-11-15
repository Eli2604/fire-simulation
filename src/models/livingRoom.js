import { hexToRgb } from './util.js';
import { livingRoomPrims } from './furniture.js';

/**
 * The contents of a furnished living room, as in the house (models/furniture.js): a foam
 * sofa against the back wall (-z), a coffee table, a bookshelf full of books (+x), a carpet,
 * and a bed in the corner if wanted. No walls: put it in a building, a hall, a tent, or out in
 * the open. Lit, the fire starts on the sofa.
 */
export default {
  label: 'Living room furniture (sofa, table, bookshelf, carpet)',
  params: {
    width: { value: 5, min: 3, max: 10, step: 0.1, label: 'Room width X (m)' },
    depth: { value: 4, min: 2.5, max: 8, step: 0.1, label: 'Room depth Z (m)' },
    sofaColor: { value: '#4d6b8c', color: true, label: 'Sofa colour' },
    carpetColor: { value: '#8c3333', color: true, label: 'Carpet colour' },
    books: { value: true, label: 'Bookshelf' },
    bed: { value: false, label: 'Bed in the corner' },
  },
  build(p, { h }) {
    const { prims, ignite } = livingRoomPrims(
      { x0: -p.width / 2, x1: p.width / 2, z0: -p.depth / 2, z1: p.depth / 2, f: h * 1.01 },
      { h, sofa: hexToRgb(p.sofaColor), carpet: hexToRgb(p.carpetColor), bed: p.bed, books: p.books },
    );
    return { prims, ignite };
  },
};
