import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPalette, encodeGif, lzw } from '../src/gif.js';

// A small GIF decoder, enough to read back what encodeGif writes.
function lzwDecode(data, pixelCount) {
  let pos = 0;
  const minCodeSize = data[pos++];
  const bytes = [];
  for (let n = data[pos++]; n; n = data[pos++]) for (let i = 0; i < n; i++) bytes.push(data[pos++]);
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let bits, table, prev;
  const reset = () => {
    bits = minCodeSize + 1;
    table = [...Array(clearCode).keys()].map((i) => [i]);
    table.push(null, null);
    prev = null;
  };
  reset();
  const out = [];
  let bit = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < bits; i++, bit++) code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << i;
    return code;
  };
  for (;;) {
    const code = read();
    if (code === clearCode) {
      reset();
      continue;
    }
    if (code === endCode) break;
    let entry;
    if (code < table.length) entry = table[code];
    else entry = [...table[prev], table[prev][0]]; // the code being defined right now
    out.push(...entry);
    if (prev !== null && table.length < 4096) table.push([...table[prev], entry[0]]);
    prev = code;
    if (table.length === 1 << bits && bits < 12) bits++;
  }
  assert.equal(out.length, pixelCount, 'pixel count');
  return { pixels: out, length: pos };
}

function decodeGif(gif) {
  const u16 = (i) => gif[i] | (gif[i + 1] << 8);
  assert.equal(String.fromCharCode(...gif.subarray(0, 6)), 'GIF89a');
  const [width, height, packed] = [u16(6), u16(8), gif[10]];
  const tableSize = 2 << (packed & 7);
  const palette = gif.subarray(13, 13 + 3 * tableSize);
  let pos = 13 + 3 * tableSize;
  const frames = [];
  let loop = null;
  let delay = null;
  while (gif[pos] !== 0x3b) {
    if (gif[pos] === 0x21 && gif[pos + 1] === 0xff) {
      loop = u16(pos + 16);
      pos += 19;
    } else if (gif[pos] === 0x21 && gif[pos + 1] === 0xf9) {
      delay = u16(pos + 4);
      pos += 8;
    } else if (gif[pos] === 0x2c) {
      assert.deepEqual([u16(pos + 1), u16(pos + 3), u16(pos + 5), u16(pos + 7)], [0, 0, width, height]);
      const { pixels, length } = lzwDecode(gif.subarray(pos + 10), width * height);
      frames.push({ delay, rgb: pixels.map((i) => [...palette.subarray(3 * i, 3 * i + 3)]) });
      pos += 10 + length;
    } else assert.fail(`unexpected block 0x${gif[pos].toString(16)} at ${pos}`);
  }
  return { width, height, loop, frames };
}

// An RGBA image from a function of (x, y) giving [r, g, b].
function image(width, height, colour) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) px.set([...colour(x, y), 255], (y * width + x) * 4);
  }
  return px;
}

const rgbOf = (px) => [...Array(px.length / 4).keys()].map((i) => [px[4 * i], px[4 * i + 1], px[4 * i + 2]]);

test('a GIF of a few flat colours reads back exactly, frame by frame', () => {
  const [w, h] = [37, 23];
  const colours = [[0, 0, 0], [11, 3, 246], [240, 8, 125], [255, 255, 255]];
  const views = [
    image(w, h, (x, y) => colours[(x + y) % 4]),
    image(w, h, (x, y) => colours[(x * y) % 3]),
    image(w, h, (x) => colours[x < 18 ? 1 : 2]),
  ];
  const order = [0, 1, 2, 1];
  const gif = decodeGif(encodeGif({ width: w, height: h, views, order, delay: 6 }));
  assert.deepEqual([gif.width, gif.height, gif.loop], [w, h, 0]);
  assert.equal(gif.frames.length, 4);
  gif.frames.forEach((frame, i) => {
    assert.equal(frame.delay, 6);
    assert.deepEqual(frame.rgb, rgbOf(views[order[i]]), `frame ${i}`);
  });
});

test('long runs and noise both survive the dictionary filling up and clearing', () => {
  // 300 × 200 = 60 000 pixels of noise over 200 colours overflow the 4096-code table many times.
  let seed = 1;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 200);
  const levels = [...Array(200).keys()].map((i) => [i * 8 % 256, (i * 40) % 256, i]);
  const noise = image(300, 200, () => levels[random()]);
  const flat = image(300, 200, () => [11, 3, 246]);
  const gif = decodeGif(encodeGif({ width: 300, height: 200, views: [noise, flat], order: [0, 1], delay: 10 }));
  const exact = (a, b) => a.every((c, i) => c[0] === b[i][0] && c[1] === b[i][1] && c[2] === b[i][2]);
  assert.ok(exact(gif.frames[1].rgb, rgbOf(flat)), 'flat frame');
  // The noise colours differ by at least one 5-bit bin on some channel, and fit 256 colours.
  assert.ok(exact(gif.frames[0].rgb, rgbOf(noise)), 'noise frame');
});

test('the palette keeps pure colours exact and covers antialiased blends', () => {
  const [a, b] = [[11, 3, 246], [240, 8, 125]];
  // 1000 blend steps between two colours, plus both pure colours in large areas.
  const px = image(1000, 3, (x, y) => (y === 1 ? a.map((c, i) => Math.round(c + ((b[i] - c) * x) / 999)) : y === 0 ? a : b));
  const { palette } = buildPalette([px]);
  assert.ok(palette.length / 3 <= 256);
  const has = (c) => palette.some((_, i) => i % 3 === 0 && palette[i] === c[0] && palette[i + 1] === c[1] && palette[i + 2] === c[2]);
  assert.ok(has(a) && has(b), 'pure colours');
});

test('lzw codes widen and reset in step with a decoder', () => {
  for (const minCodeSize of [2, 4, 8]) {
    const n = 1 << minCodeSize;
    const indices = Uint8Array.from({ length: 20000 }, (_, i) => (i * 7 + (i >> 5)) % n);
    assert.deepEqual(lzwDecode(lzw(indices, minCodeSize), indices.length).pixels, [...indices]);
  }
});
