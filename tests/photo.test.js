import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeFlow, photoLevels, resizeGray } from '../src/photo.js';

// RGBA image from fn(x, y) -> grey level
function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

// The runs of line pixels (level below `cut`) along row y.
function runs(levels, width, y, cut = 128) {
  const found = [];
  for (let x = 0, start = -1; x <= width; x++) {
    const dark = x < width && levels[y * width + x] < cut;
    if (dark && start < 0) start = x;
    if (!dark && start >= 0) {
      found.push([start, x - 1]);
      start = -1;
    }
  }
  return found;
}

for (const flow of [true, false]) {
  const kind = flow ? 'along the flow' : 'plain';

  test(`a thin dark stroke gives one line, not two (${kind})`, () => {
    const img = image(80, 60, (x) => (x === 40 || x === 41 ? 30 : 230));
    const levels = photoLevels(img, { sigma: 1.2, flow });
    const found = runs(levels, 80, 30);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.ok(found[0][0] <= 41 && found[0][1] >= 40, 'on the stroke');
  });

  test(`a step between two tones gives one line on its dark side (${kind})`, () => {
    const img = image(80, 60, (x) => (x < 40 ? 60 : 200));
    const levels = photoLevels(img, { sigma: 1.2, flow });
    const found = runs(levels, 80, 30);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.ok(found[0][1] <= 40 && found[0][0] >= 34, `dark side of the step: ${found[0]}`);
    assert.equal(levels[30 * 80 + 10], 255, 'no fill inside the dark area');
    assert.equal(levels[30 * 80 + 70], 255, 'nothing in the light area');
  });
}

test('a flat photo has no lines', () => {
  assert.ok(photoLevels(image(40, 30, () => 120)).every((v) => v === 255));
});

test('the edge flow runs along the edges', () => {
  const gray = new Float32Array(60 * 40).map((_, i) => (i % 60 < 30 ? 50 : 200)); // a vertical edge
  const { tx, ty } = edgeFlow(gray, 60, 40, 2);
  const i = 20 * 60 + 30;
  assert.ok(Math.abs(ty[i]) > 0.99 && Math.abs(tx[i]) < 0.1, `(${tx[i]}, ${ty[i]})`);
  const flat = edgeFlow(new Float32Array(100).fill(9), 10, 10);
  assert.ok(flat.tx.every((v, j) => Math.hypot(v, flat.ty[j]) > 0.999), 'unit vectors in flat areas too');
});

test('resizeGray scales and keeps flat levels', () => {
  const out = resizeGray(new Float32Array(12).fill(77), 4, 3, 10, 7);
  assert.equal(out.length, 70);
  assert.ok(out.every((v) => Math.abs(v - 77) < 1e-4));
  const ramp = resizeGray(Float32Array.from([0, 100]), 2, 1, 4, 1);
  assert.deepEqual([...ramp], [0, 25, 75, 100]);
});
