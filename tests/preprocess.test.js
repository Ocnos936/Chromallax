import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceTransform, flattenBackground, inkLevels, lineMask, maskFromLevels, offsetCoverage, otsuThreshold, removeSpecks,
  strokeField, strokeOffsets,
} from '../src/preprocess.js';

// RGBA image from fn(x, y) -> [r, g, b, a]
function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  return { data, width, height };
}
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const vline = (on, off) => image(10, 10, (x) => (x === 5 ? on : off)); // 1-px line at x = 5

test('dark lines on a light background', () => {
  const m = lineMask(vline(BLACK, WHITE));
  assert.equal(m.lightLines, false);
  assert.equal(m.mask[35], 1);
  assert.equal(m.mask[32], 0);
});

test('auto-detects light lines on a dark background', () => {
  const m = lineMask(vline([250, 250, 250, 255], [5, 5, 5, 255]));
  assert.equal(m.lightLines, true);
  assert.equal(m.mask[35], 1);
  assert.equal(m.mask[32], 0);
});

test('explicit polarity overrides auto-detection', () => {
  const m = lineMask(vline(BLACK, WHITE), { invert: 'light' });
  assert.equal(m.mask[35], 0);
  assert.equal(m.mask[32], 1);
});

test('transparent images use alpha as the mask, whatever the colour', () => {
  const m = lineMask(vline(WHITE, [0, 0, 0, 0]));
  assert.equal(m.usedAlpha, true);
  assert.equal(m.mask[35], 1);
  assert.equal(m.mask[32], 0);
});

test('soft threshold ramps linearly across the softness band', () => {
  const grays = [120, 156, 180, 204, 240];
  const img = image(5, 1, (x) => [grays[x], grays[x], grays[x], 255]);
  const { mask } = lineMask(img, { threshold: 180, softness: 48, invert: 'dark' });
  [1, 1, 0.5, 0, 0].forEach((v, i) => assert.ok(Math.abs(mask[i] - v) < 1e-6, `gray ${grays[i]}: ${mask[i]}`));
});

test('softness 0 is a hard threshold', () => {
  const grays = [179, 180, 181];
  const img = image(3, 1, (x) => [grays[x], grays[x], grays[x], 255]);
  assert.deepEqual([...lineMask(img, { threshold: 180, softness: 0, invert: 'dark' }).mask], [1, 0, 0]);
});

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// Mask with vertical bars: bars = [[x0, x1), ...] spanning the full height.
function bars(width, height, spans, value = 1) {
  const m = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (const [x0, x1] of spans) for (let x = x0; x < x1; x++) m[y * width + x] = value;
  return m;
}
const rowOf = (m, width, y) => [...m.subarray(y * width, (y + 1) * width)];

test('distance transform is exact against brute force', () => {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const w = 19;
  const h = 13;
  const feature = new Uint8Array(w * h).map(() => (rand() < 0.06 ? 1 : 0));
  const dist = distanceTransform(feature, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++) if (feature[j]) best = Math.min(best, Math.hypot(x - (j % w), y - Math.floor(j / w)));
      near(dist[y * w + x], best, 1e-5, `(${x},${y})`);
    }
  }
});

test('signed distance of a crisp 3-px bar', () => {
  const w = 11;
  const { sdf } = strokeField(bars(w, 5, [[4, 7]]), w, 5);
  // columns 0..10: bar covers 4, 5, 6
  assert.deepEqual(rowOf(sdf, w, 2), [3.5, 2.5, 1.5, 0.5, -0.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5]);
});

test('offsetCoverage: 0 keeps the mask, ±1 moves every edge by a pixel, 0.5 half-covers', () => {
  const w = 11;
  const soft = bars(w, 5, [[4, 7]]);
  for (let y = 0; y < 5; y++) soft[y * w + 3] = 0.25; // anti-aliased left edge
  const { sdf } = strokeField(soft, w, 5);
  assert.deepEqual(rowOf(offsetCoverage(sdf, 0), w, 2), [0, 0, 0, 0.25, 1, 1, 1, 0, 0, 0, 0]);
  // Beyond the first ring the edge follows the thresholded mask (±0.5 px), so the
  // 25 % sub-pixel offset of column 3 is not carried outwards.
  assert.deepEqual(rowOf(offsetCoverage(sdf, 1), w, 2), [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(rowOf(offsetCoverage(sdf, -1), w, 2), [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(rowOf(offsetCoverage(sdf, 0.5), w, 2), [0, 0, 0, 0.75, 1, 1, 1, 0.5, 0, 0, 0]);
});

test('thickening does not grow faint specks far from the lines', () => {
  const w = 21;
  const m = bars(w, 9, [[2, 5]]);
  m[4 * w + 15] = 0.3; // faint noise pixel
  const { sdf } = strokeField(m, w, 9);
  assert.equal(offsetCoverage(sdf, 2)[4 * w + 15], 0);
});

test('stroke stats: median width of even strokes, heavy share of fills', () => {
  const w = 80;
  const h = 40;
  const lines = bars(w, h, [[5, 8], [20, 23], [40, 43]]); // 3-px strokes
  const even = strokeField(lines, w, h);
  near(even.strokeWidth, 3, 0.5, 'width');
  assert.equal(even.heavyShare, 0);
  const filled = bars(w, h, [[5, 8], [20, 23], [40, 43], [55, 75]]); // plus a 20-px fill
  assert.ok(strokeField(filled, w, h).heavyShare > 0.3);
});

test('strokeOffsets: line width scales even strokes; equal width survives the shrink', () => {
  const base = { strokeWidth: 4, lineWidth: 1.5, depth: 1.25 };
  const plain = strokeOffsets({ ...base, equalWidth: false });
  assert.equal(plain.secondary, 1); // 4 px -> 6 px = ×1.5
  assert.equal(plain.primary, plain.secondary);
  const equal = strokeOffsets({ ...base, equalWidth: true });
  near((4 + 2 * equal.primary) / base.depth, 4 + 2 * equal.secondary, 1e-12, 'black width after shrink');
});

// ---- Cleaning up scans ----

// A page whose light falls off from 250 on the left to 120 on the right, with dark
// lines at x = 20 and x = 180 that are 40 % as bright as the paper around them.
const shaded = (width = 200, height = 60) =>
  image(width, height, (x) => {
    const paper = 250 - (130 * x) / (width - 1);
    const v = Math.round(x === 20 || x === 180 ? paper * 0.4 : paper);
    return [v, v, v, 255];
  });

test('flattening divides out uneven light, keeping each line against its paper', () => {
  const plain = inkLevels(shaded());
  const flat = inkLevels(shaded(), { flatten: true });
  const at = (levels, x) => levels.gray[30 * 200 + x];
  // Without it, one threshold can't tell the dim paper on the right from a line.
  assert.ok(at(plain, 190) < 140 && at(plain, 20) > 90);
  for (const x of [5, 60, 100, 150, 195]) near(at(flat, x), 255, 6, `paper at ${x}`);
  near(at(flat, 20), 102, 8, 'line on the bright side');
  near(at(flat, 180), 102, 8, 'line on the dim side');
  const mask = maskFromLevels(flat, { threshold: 180, softness: 0 }).mask;
  assert.deepEqual([...Array(200).keys()].filter((x) => mask[30 * 200 + x]), [20, 180]);
});

test('flattening on a coarse grid still evens out the light', () => {
  // radius 40 works on blocks of 5 × 5 px
  const { data, width, height } = shaded(800, 120);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = data[4 * i];
  const flat = flattenBackground(gray, width, height, 40);
  // Within `radius` of the edge, the half-width windows read a fast change of light a
  // little bright, so check the rest.
  for (let x = 41; x < width - 40; x += 7) if (x !== 180) near(flat[60 * width + x], 255, 8, `paper at ${x}`);
  near(flat[60 * width + 180], 102, 10, 'line');
});

test('flattening leaves transparent images alone', () => {
  const img = vline(WHITE, [0, 0, 0, 0]);
  assert.deepEqual([...inkLevels(img, { flatten: true }).gray], [...inkLevels(img).gray]);
});

test('flattenBackground keeps a flat page flat', () => {
  const gray = new Float32Array(50 * 50).fill(200);
  for (const v of flattenBackground(gray, 50, 50, 4)) near(v, 255, 1e-3, 'paper');
});

test('the automatic threshold falls between ink and paper', () => {
  const gray = new Float32Array(1000);
  gray.fill(240);
  for (let i = 0; i < 100; i++) gray[i] = 60 + (i % 20);
  for (let i = 100; i < 1000; i++) gray[i] = 230 + (i % 15);
  const t = otsuThreshold(gray);
  assert.ok(t > 80 && t < 230, `threshold ${t}`);
});

test('removing specks clears small marks and keeps long thin strokes', () => {
  const [w, h] = [60, 40];
  const mask = new Float32Array(w * h);
  const paint = (x0, y0, x1, y1, v = 1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = v;
  };
  paint(2, 2, 5, 5); // a 3 × 3 speck
  paint(10, 2, 12, 4, 0.3); // a faint 2 × 2 speck
  paint(20, 5, 21, 35); // a 1 px wide stroke, 30 px long
  paint(30, 10, 50, 30); // a 20 × 20 fill
  removeSpecks(mask, w, h, 5);
  const sum = (x0, y0, x1, y1) => {
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += mask[y * w + x];
    return s;
  };
  assert.equal(sum(0, 0, 15, 5), 0, 'specks gone');
  assert.equal(sum(20, 5, 21, 35), 30, 'thin stroke kept');
  assert.equal(sum(30, 10, 50, 30), 400, 'fill kept');
});

test('a speck with an antialiased fringe goes as a whole', () => {
  const [w, h] = [9, 9];
  const mask = new Float32Array(w * h);
  mask[4 * w + 4] = 1;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) mask[(4 + dy) * w + 4 + dx] = 0.2;
  assert.ok(removeSpecks(mask, w, h, 3).every((v) => v === 0));
});

test('maskFromLevels removes specks when asked', () => {
  const img = image(20, 20, (x, y) => (x === 3 && y === 3) || x === 12 ? BLACK : WHITE);
  const levels = inkLevels(img);
  assert.equal(maskFromLevels(levels).mask[3 * 20 + 3], 1);
  const cleaned = maskFromLevels(levels, { specks: 2 }).mask;
  assert.equal(cleaned[3 * 20 + 3], 0);
  assert.equal(cleaned[5 * 20 + 12], 1);
});
