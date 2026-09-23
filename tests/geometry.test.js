import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasSize, computeLayout, fillScale, movePanels, panelAt, panelBox, panelHandles, ratioLabel, referencePanel,
  resizePanel, rotatePanel, scaleLayer, scalePanels, snapRect, zoomArt,
} from '../src/geometry.js';
import { DEFAULTS } from '../src/config.js';

const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// Reference construction: one window, the canvas shrunk to 1/depth about the fixed point.
const reference = (depth, rest) => ({ depth, panels: [referencePanel(rest, 1 / depth)], ...rest });
const cases = [
  reference(1 / 0.8256, { width: 1179, height: 1668, centerX: 0.521, centerY: 0.588 }),
  reference(2, { width: 800, height: 800, centerX: 0, centerY: 1 }),
  reference(1 / 0.95, { width: 1200, height: 900, centerX: 0.3, centerY: 0.7 }),
];
// A window box as a top-left rect.
const rectOf = ({ x, y, w, h }) => ({ x: x - w / 2, y: y - h / 2, w, h });
const sameRect = (a, b, what, tol = 1e-6) => ['x', 'y', 'w', 'h'].forEach((key) => close(a[key], b[key], tol, `${what}.${key}`));

test('magenta copy is the black copy scaled by depth about the fixed point', () => {
  for (const p of cases) {
    const { center: c, primary: b, secondary: m, scale } = computeLayout(p);
    close(c.x + scale * (b.x - c.x), m.x, 1e-9, 'left');
    close(c.x + scale * (b.x + b.w - c.x), m.x + m.w, 1e-9, 'right');
    close(c.y + scale * (b.y - c.y), m.y, 1e-9, 'top');
    close(c.y + scale * (b.y + b.h - c.y), m.y + m.h, 1e-9, 'bottom');
  }
});

test('reference construction: the window is the canvas shrunk like the black copy, same aspect ratio', () => {
  for (const p of cases) {
    const { panels: [panel], primary } = computeLayout(p);
    sameRect(rectOf(panel), primary, 'window', 1e-9);
    close(panel.w / panel.h, p.width / p.height, 1e-9, 'aspect');
  }
});

test("a circle reference window is the canvas's inscribed circle shrunk about the fixed point", () => {
  for (const p of cases) {
    const size = 1 / p.depth;
    const { panels: [k], center: c } = computeLayout({ ...p, panels: [referencePanel(p, size, 'circle')] });
    close(k.x, c.x + size * (p.width / 2 - c.x), 1e-9, 'centre x');
    close(k.y, c.y + size * (p.height / 2 - c.y), 1e-9, 'centre y');
    close(k.w, size * Math.min(p.width, p.height), 1e-9, 'diameter');
    assert.equal(k.h, k.w);
  }
});

test('fixed point splits the window margins in the same ratio as the canvas', () => {
  const p = cases[2];
  const panel = rectOf(computeLayout(p).panels[0]);
  const left = panel.x;
  const right = p.width - panel.x - panel.w;
  const top = panel.y;
  const bottom = p.height - panel.y - panel.h;
  close(left / (left + right), p.centerX, 1e-9, 'horizontal');
  close(top / (top + bottom), p.centerY, 1e-9, 'vertical');
});

test('defaults reproduce the window measured in the reference artwork', () => {
  // The reference artwork is 1179 x 1668; its window edges are x 107..1081, y 172..1548.
  const { panels } = computeLayout({ ...DEFAULTS, width: 1179, height: 1668 });
  assert.equal(panels.length, 1);
  const panel = rectOf(panels[0]);
  close(panel.x, 107, 1.5, 'left');
  close(panel.x + panel.w, 1081, 1.5, 'right');
  close(panel.y, 172, 1.5, 'top');
  close(panel.y + panel.h, 1548, 1.5, 'bottom');
});

test('window size is independent of depth', () => {
  const p = { ...cases[0], panels: [referencePanel(cases[0], 0.6)] };
  const { panels: [panel], primary } = computeLayout(p);
  assert.deepEqual(primary, computeLayout(cases[0]).primary);
  close(panel.w, 0.6 * p.width, 1e-9, 'width');
});

test('each layer offset moves only its own layer, never the windows', () => {
  const base = computeLayout(cases[2]);
  for (const layer of ['secondary', 'primary']) {
    const moved = computeLayout({ ...cases[2], [`${layer}OffsetX`]: 0.1, [`${layer}OffsetY`]: -0.05 });
    for (const other of ['secondary', 'primary']) {
      if (other === layer) {
        assert.deepEqual(moved[other], { ...base[other], x: base[other].x + 120, y: base[other].y - 45 });
      } else {
        assert.deepEqual(moved[other], base[other], `${layer} offset moved ${other}`);
      }
    }
    assert.deepEqual(moved.panels, base.panels, `${layer} offset moved the window`);
  }
});

test('canvas presets give the expected pixel sizes in both orientations', () => {
  assert.deepEqual(canvasSize('16:9', 'landscape', 1920), { width: 1920, height: 1080 });
  assert.deepEqual(canvasSize('16:9', 'portrait', 1920), { width: 1080, height: 1920 });
  assert.deepEqual(canvasSize('4:3', 'landscape', 2560), { width: 2560, height: 1920 });
  assert.deepEqual(canvasSize('4:3', 'portrait', 1920), { width: 1440, height: 1920 });
  assert.deepEqual(canvasSize('1:1', 'portrait', 1080), { width: 1080, height: 1080 });
  assert.deepEqual(canvasSize('1:1', 'landscape', 1080), { width: 1080, height: 1080 });
  assert.deepEqual(canvasSize('√2:1', 'portrait', 1920), { width: 1358, height: 1920 });
  assert.deepEqual(canvasSize('√2:1', 'portrait', 1668), { width: 1179, height: 1668 }); // the reference artwork
});

test('ratio labels flip with the orientation, except square', () => {
  assert.equal(ratioLabel('16:9', 'landscape'), '16:9');
  assert.equal(ratioLabel('16:9', 'portrait'), '9:16');
  assert.equal(ratioLabel('√2:1', 'portrait'), '1:√2');
  assert.equal(ratioLabel('1:1', 'portrait'), '1:1');
});

const wide = {
  width: 1600, height: 900, depth: 1.25, centerX: 0.4, centerY: 0.6, artWidth: 1000, artHeight: 1000,
  panels: [referencePanel({ centerX: 0.4, centerY: 0.6 }, 0.8)],
};

test('art zoom 1 fits the whole art inside the canvas, centred', () => {
  assert.deepEqual(computeLayout(wide).art, { x: 350, y: 0, w: 900, h: 900 });
});

test('art position and zoom move the art but not the window', () => {
  const moved = computeLayout({ ...wide, artX: 0.25, artScale: 2 });
  assert.deepEqual(moved.art, { x: -500, y: -450, w: 1800, h: 1800 });
  assert.deepEqual(moved.panels, computeLayout(wide).panels);
});

test('placed art: black copy is the art shrunk about c, magenta is the art', () => {
  const p = { ...wide, artHeight: 700, artX: 0.3, artY: 0.55, artScale: 1.7 };
  const { art, primary: b, secondary: m, center: c, scale } = computeLayout(p);
  assert.deepEqual(m, art);
  close(b.x, c.x + (art.x - c.x) / p.depth, 1e-9, 'left');
  close(b.y, c.y + (art.y - c.y) / p.depth, 1e-9, 'top');
  close(b.w, art.w / p.depth, 1e-9, 'width');
  close(c.x + scale * (b.x + b.w - c.x), m.x + m.w, 1e-9, 'magenta = black x depth');
});

test('fillScale makes the art cover the canvas', () => {
  const { art } = computeLayout({ ...wide, centerX: 0.5, artScale: fillScale(1600, 900, 1000, 1000) });
  close(art.x, 0, 1e-9, 'left');
  close(art.w, 1600, 1e-9, 'width');
  assert.ok(art.h >= 900);
});

test('zoomArt keeps the anchor on the same spot of the art, and clamps', () => {
  const start = { artX: 0.5, artY: 0.4, artScale: 1.5 };
  const anchor = { x: 0.3, y: 0.7 };
  for (const factor of [2, 0.5, 100]) {
    const z = zoomArt(start, factor, anchor);
    close((anchor.x - z.artX) / z.artScale, (anchor.x - start.artX) / start.artScale, 1e-12, `x at ×${factor}`);
    close((anchor.y - z.artY) / z.artScale, (anchor.y - start.artY) / start.artScale, 1e-12, `y at ×${factor}`);
  }
  assert.equal(zoomArt(start, 100, anchor).artScale, 4);
  assert.equal(zoomArt(start, 0.001, anchor).artScale, 0.1);
});

const RANGES = { artScale: [0.1, 4], depth: [1, 2] };
const moved = {
  width: 1200, height: 1600, depth: 1.3, centerX: 0.45, centerY: 0.55,
  artWidth: 1000, artHeight: 1400, artX: 0.52, artY: 0.47, artScale: 1.1,
  secondaryOffsetX: 0.02, secondaryOffsetY: -0.01, primaryOffsetX: -0.03, primaryOffsetY: 0.015,
  panels: [{ shape: 'rect', x: 0.5, y: 0.52, size: 0.75, angle: 0 }],
};
const anchor = { x: 0.3, y: 0.62 };
// Asserts `after` is `before` scaled about the anchor; returns the factor.
function scaledAboutAnchor(before, after, what) {
  const [ax, ay] = [anchor.x * moved.width, anchor.y * moved.height];
  const k = after.w / before.w;
  close(after.h, before.h * k, 1e-6, `${what} height`);
  close(after.x, ax + k * (before.x - ax), 1e-6, `${what} x`);
  close(after.y, ay + k * (before.y - ay), 1e-6, `${what} y`);
  return k;
}

test('scaleLayer resizes only the chosen line layer, about the anchor', () => {
  const before = computeLayout(moved);
  for (const [target, factor] of [['secondary', 1.2], ['secondary', 0.8], ['primary', 1.2], ['primary', 0.85]]) {
    const update = scaleLayer(moved, target, factor, anchor, RANGES);
    const after = computeLayout({ ...moved, ...update });
    close(scaledAboutAnchor(before[target], after[target], target), factor, 1e-9, `${target} factor`);
    for (const other of ['secondary', 'primary']) {
      if (other !== target) sameRect(after[other], before[other], `${target} x${factor} moved ${other}`);
    }
    assert.deepEqual(after.panels, before.panels, `${target} moved the window`);
  }
});

test('scaleLayer on the artwork zooms the magenta lines about the anchor and leaves the window', () => {
  const before = computeLayout(moved);
  const after = computeLayout({ ...moved, ...scaleLayer(moved, 'art', 1.25, anchor, RANGES) });
  close(scaledAboutAnchor(before.secondary, after.secondary, 'magenta'), 1.25, 1e-9, 'factor');
  assert.deepEqual(after.panels, before.panels);
});

test('scaleLayer about the focus point keeps the layers aligned there (no new offsets)', () => {
  const aligned = { ...moved, secondaryOffsetX: 0, secondaryOffsetY: 0, primaryOffsetX: 0, primaryOffsetY: 0 };
  const c = { x: aligned.centerX, y: aligned.centerY };
  for (const target of ['secondary', 'primary']) {
    const update = scaleLayer(aligned, target, 1.15, c, RANGES);
    for (const [key, value] of Object.entries(update)) if (key.includes('Offset')) close(value, 0, 1e-12, `${target} ${key}`);
  }
});

test('scaleLayer clamps depth and still keeps the anchor fixed', () => {
  const p = { ...moved, depth: 1.1 };
  const update = scaleLayer(p, 'primary', 1.5, anchor, RANGES); // would need depth 0.73
  assert.equal(update.depth, 1);
  const k = scaledAboutAnchor(computeLayout(p).primary, computeLayout({ ...p, ...update }).primary, 'black');
  close(k, 1.1, 1e-9, 'applied factor');
});

// ---- Windows -------------------------------------------------------------------

const portrait = { width: 1000, height: 1500 };
const landscape = { width: 1600, height: 900 };
const box = (panel, dims = portrait) => panelBox(panel, dims.width, dims.height);
const SIDE = [0.02, 3];

test('a fitted window follows the canvas ratio, a w × h window keeps its shape', () => {
  const fitted = { shape: 'rect', x: 0.5, y: 0.5, size: 0.5, angle: 0 };
  const sized = { shape: 'rect', x: 0.5, y: 0.5, w: 0.4, h: 0.2, angle: 0 };
  for (const dims of [portrait, landscape]) {
    const f = box(fitted, dims);
    close(f.w / f.h, dims.width / dims.height, 1e-12, 'fitted aspect');
    const s = box(sized, dims);
    close(s.w, 0.4 * Math.min(dims.width, dims.height), 1e-9, 'width in short edges');
    close(s.w / s.h, 2, 1e-12, 'kept aspect');
  }
});

test('a circle is the inscribed circle of its box and has no angle', () => {
  const k = box({ shape: 'circle', x: 0.5, y: 0.4, size: 0.6, angle: 30 });
  assert.deepEqual(k, { shape: 'circle', x: 500, y: 600, w: 600, h: 600, angle: 0 });
});

test('panelAt finds the topmost window under a point, respecting rotation and circles', () => {
  const panels = [
    { shape: 'rect', x: 0.5, y: 0.5, w: 0.8, h: 0.2, angle: 90 }, // a tall bar after turning
    { shape: 'circle', x: 0.5, y: 0.5, w: 0.3, h: 0.3, angle: 0 },
  ];
  assert.equal(panelAt(panels, { x: 500, y: 750 }, portrait), 1); // centre: the circle is on top
  assert.equal(panelAt(panels, { x: 500, y: 450 }, portrait), 0); // along the turned bar
  assert.equal(panelAt(panels, { x: 850, y: 750 }, portrait), -1); // where the bar was before turning
  assert.equal(panelAt(panels, { x: 590, y: 880 }, portrait), 0); // in the circle's box but not the circle
});

test('panelHandles: corners, edges and a rotation knob, turned with the window', () => {
  const b = box({ shape: 'rect', x: 0.5, y: 0.5, w: 0.4, h: 0.2, angle: 90 });
  const handles = panelHandles(b, 30);
  assert.equal(handles.length, 9);
  const at = (h) => handles.find((x) => String(x.handle) === String(h));
  // After a quarter turn clockwise, the top edge faces right.
  close(at([0, -1]).x, 500 + 100, 1e-9, 'top edge x');
  close(at([0, -1]).y, 750, 1e-9, 'top edge y');
  close(at('rotate').x, 500 + 100 + 30, 1e-9, 'knob x');
  close(at([1, 1]).x, 500 - 100, 1e-9, 'corner x');
  close(at([1, 1]).y, 750 + 200, 1e-9, 'corner y');
  assert.deepEqual(panelHandles(box({ shape: 'circle', x: 0.5, y: 0.5, w: 0.4, h: 0.4 }), 30).map((h) => h.handle),
    [[-1, -1], [1, -1], [-1, 1], [1, 1]]);
});

test('scalePanels scales all windows about an anchor, or one about its own centre', () => {
  const panels = [
    { shape: 'rect', x: 0.3, y: 0.4, size: 0.5, angle: 0 },
    { shape: 'circle', x: 0.7, y: 0.6, w: 0.2, h: 0.2, angle: 0 },
  ];
  const c = { x: 0.5, y: 0.5 };
  const all = scalePanels(panels, null, 1.5, c, portrait, SIDE);
  close(all[0].x, 0.2, 1e-12, 'first x');
  close(all[1].y, 0.65, 1e-12, 'second y');
  close(all[0].size, 0.75, 1e-12, 'fitted size');
  close(all[1].w, 0.3, 1e-12, 'circle size');
  const one = scalePanels(panels, 1, 0.5, null, portrait, SIDE);
  assert.equal(one[0], panels[0], 'the other window is untouched');
  assert.deepEqual([one[1].x, one[1].y, one[1].w], [0.7, 0.6, 0.1]);
});

test('scalePanels uses one clamped factor for all, so the arrangement survives the limit', () => {
  const panels = [
    { shape: 'rect', x: 0.3, y: 0.4, w: 0.04, h: 0.1, angle: 0 },
    { shape: 'rect', x: 0.7, y: 0.6, w: 0.5, h: 0.5, angle: 0 },
  ];
  const shrunk = scalePanels(panels, null, 0.1, { x: 0.5, y: 0.5 }, portrait, SIDE);
  close(shrunk[0].w, 0.02, 1e-12, 'small window at the limit');
  close(shrunk[1].w, 0.25, 1e-12, 'the other one scaled by the same factor');
});

test('movePanels moves together and stops together at the range', () => {
  const panels = [{ shape: 'rect', x: 1.2, y: 0.5, w: 0.2, h: 0.2 }, { shape: 'rect', x: 0.4, y: 0.5, w: 0.2, h: 0.2 }];
  const moved = movePanels(panels, null, 0.5, 0.1, [-0.5, 1.5], [-0.5, 1.5]);
  close(moved[0].x, 1.5, 1e-12, 'first stops at the edge');
  close(moved[1].x, 0.7, 1e-12, 'second keeps its distance');
  close(moved[1].y, 0.6, 1e-12, 'y is free');
  assert.equal(movePanels(panels, 1, 0.5, 0, [-0.5, 1.5], [-0.5, 1.5])[1].x, 0.9);
});

test('resizePanel: a corner drag keeps the opposite corner, also when turned', () => {
  for (const angle of [0, 30, -120]) {
    const panel = { shape: 'rect', x: 0.4, y: 0.5, w: 0.3, h: 0.2, angle };
    const before = panelHandles(box(panel), 0).find((h) => String(h.handle) === '-1,-1');
    const after = resizePanel(panel, [1, 1], { x: 37, y: -12 }, portrait, SIDE);
    const kept = panelHandles(box(after), 0).find((h) => String(h.handle) === '-1,-1');
    close(kept.x, before.x, 1e-9, `anchor x at ${angle}°`);
    close(kept.y, before.y, 1e-9, `anchor y at ${angle}°`);
    assert.equal(after.angle, angle);
  }
  // Unturned, the corner follows the pointer exactly.
  const r = resizePanel({ shape: 'rect', x: 0.5, y: 0.5, w: 0.2, h: 0.2, angle: 0 }, [1, 1], { x: 100, y: 50 }, portrait, SIDE);
  sameRect(box(r), { x: 550, y: 775, w: 300, h: 250 }, 'grown box');
});

test('resizePanel: edges change one side, keepRatio and fromCenter as named, and no flipping', () => {
  const panel = { shape: 'rect', x: 0.5, y: 0.5, size: 0.4, angle: 0 }; // 400 x 600 px
  const edge = box(resizePanel(panel, [1, 0], { x: 100, y: 80 }, portrait, SIDE));
  assert.deepEqual([edge.w, edge.h, edge.x, edge.y], [500, 600, 550, 750]);
  const ratio = box(resizePanel(panel, [1, 1], { x: 200, y: 0 }, portrait, SIDE, { keepRatio: true }));
  close(ratio.w / ratio.h, 400 / 600, 1e-12, 'ratio kept');
  const centred = box(resizePanel(panel, [1, 1], { x: 50, y: 50 }, portrait, SIDE, { fromCenter: true }));
  assert.deepEqual([centred.x, centred.y, centred.w, centred.h], [500, 750, 500, 700]);
  const flat = box(resizePanel(panel, [1, 0], { x: -1000, y: 0 }, portrait, SIDE));
  close(flat.w, 20, 1e-9, 'stops at the smallest side');
  close(flat.x - flat.w / 2, 300, 1e-9, 'opposite edge kept');
  const r = resizePanel(panel, [1, 0], { x: 1, y: 0 }, portrait, SIDE);
  assert.ok(!('size' in r) && r.w > 0 && r.h > 0, 'a fitted window becomes w x h');
});

test('resizePanel keeps a circle round', () => {
  const circle = { shape: 'circle', x: 0.5, y: 0.5, w: 0.2, h: 0.2, angle: 0 };
  const r = resizePanel(circle, [1, 1], { x: 100, y: 0 }, portrait, SIDE);
  assert.equal(r.w, r.h);
  const b = box(r);
  close(b.x - b.w / 2, 400, 1e-9, 'opposite side kept');
});

test('rotatePanel follows the swing about the centre, snaps, and wraps', () => {
  const panel = { shape: 'rect', x: 0.5, y: 0.5, w: 0.4, h: 0.2, angle: 170 };
  const c = { x: 500, y: 750 };
  const quarter = rotatePanel(panel, { x: c.x, y: c.y - 100 }, { x: c.x + 100, y: c.y }, portrait);
  close(quarter.angle, -100, 1e-9, '170 + 90 wraps to -100');
  const snapped = rotatePanel({ ...panel, angle: 0 }, { x: c.x + 100, y: c.y }, { x: c.x + 100, y: c.y + 40 }, portrait, 15);
  assert.equal(snapped.angle, 15); // atan(0.4) = 21.8°
});

test('snapRect rounds edges, not sizes', () => {
  assert.deepEqual(snapRect({ x: 10.4, y: 3.6, w: 5.2, h: 2.2 }), { x: 10, y: 4, w: 6, h: 2 });
});
