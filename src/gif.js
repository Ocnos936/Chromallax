// Animated GIF encoding (no DOM). The pictures here are a few flat colours with
// antialiased line edges between them, so a 256-colour median-cut palette shared by all
// frames keeps them faithful, and nothing is dithered.

// Colours are binned at 5 bits per channel; each bin keeps the sum of its exact colours.
const binOf = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * A palette of at most `maxColors` colours for RGBA `frames` (alpha is ignored), and a
 * lookup from colour bin to palette index. `palette` is [r, g, b, ...]; a colour that
 * fills a bin alone comes out exact.
 */
export function buildPalette(frames, maxColors = 256) {
  const count = new Float64Array(32768);
  const sum = new Float64Array(32768 * 3);
  for (const px of frames) {
    for (let i = 0; i < px.length; i += 4) {
      const bin = binOf(px[i], px[i + 1], px[i + 2]);
      count[bin]++;
      sum[bin * 3] += px[i];
      sum[bin * 3 + 1] += px[i + 1];
      sum[bin * 3 + 2] += px[i + 2];
    }
  }
  const bins = [];
  for (let bin = 0; bin < 32768; bin++) if (count[bin]) bins.push(bin);
  const channel = (bin, c) => (bin >> (10 - 5 * c)) & 31;

  // Median cut: keep splitting the box with the widest spread, at its weighted median.
  const spread = (box) => {
    let best = { range: 0, c: 0 };
    for (let c = 0; c < 3; c++) {
      let [lo, hi] = [31, 0];
      for (const bin of box) [lo, hi] = [Math.min(lo, channel(bin, c)), Math.max(hi, channel(bin, c))];
      if (hi - lo > best.range) best = { range: hi - lo, c };
    }
    return best;
  };
  const boxes = [bins];
  while (boxes.length < maxColors) {
    let pick = -1;
    let widest = { range: 0, c: 0 };
    boxes.forEach((box, i) => {
      const s = box.length > 1 ? spread(box) : { range: 0 };
      if (s.range > widest.range) [pick, widest] = [i, s];
    });
    if (pick < 0) break; // every box is a single bin
    const box = boxes[pick].sort((a, b) => channel(a, widest.c) - channel(b, widest.c));
    const half = box.reduce((n, bin) => n + count[bin], 0) / 2;
    let at = 0;
    for (let seen = 0; at < box.length - 1 && seen + count[box[at]] <= half; at++) seen += count[box[at]];
    at = Math.min(Math.max(at, 1), box.length - 1); // both halves keep a bin
    boxes.splice(pick, 1, box.slice(0, at), box.slice(at));
  }

  const palette = [];
  for (const box of boxes) {
    let [n, r, g, b] = [0, 0, 0, 0];
    for (const bin of box) [n, r, g, b] = [n + count[bin], r + sum[bin * 3], g + sum[bin * 3 + 1], b + sum[bin * 3 + 2]];
    palette.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  }
  // Each used bin goes to the palette colour nearest its average colour.
  const lookup = new Uint8Array(32768);
  for (const bin of bins) {
    const [r, g, b] = [0, 1, 2].map((c) => sum[bin * 3 + c] / count[bin]);
    let [best, bestD] = [0, Infinity];
    for (let i = 0; i < palette.length; i += 3) {
      const d = (palette[i] - r) ** 2 + (palette[i + 1] - g) ** 2 + (palette[i + 2] - b) ** 2;
      if (d < bestD) [best, bestD] = [i / 3, d];
    }
    lookup[bin] = best;
  }
  return { palette, lookup };
}

/** The palette index of every pixel of RGBA `px`. */
export function indexPixels(px, lookup) {
  const out = new Uint8Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = lookup[binOf(px[i], px[i + 1], px[i + 2])];
  return out;
}

// A growable byte buffer.
class Bytes {
  #buf = new Uint8Array(1 << 16);
  length = 0;

  #room(n) {
    if (this.length + n <= this.#buf.length) return;
    let size = this.#buf.length * 2;
    while (size < this.length + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(this.#buf);
    this.#buf = bigger;
  }

  byte(b) {
    this.#room(1);
    this.#buf[this.length++] = b;
  }

  bytes(list) {
    this.#room(list.length);
    this.#buf.set(list, this.length);
    this.length += list.length;
  }

  word(w) {
    this.byte(w & 0xff);
    this.byte((w >> 8) & 0xff);
  }

  get data() {
    return this.#buf.subarray(0, this.length);
  }
}

/**
 * GIF's variable-width LZW: `indices` (each below 2 ** minCodeSize) as image data,
 * in sub-blocks after the minimum code size byte. The dictionary is the classic
 * open-addressed hash table, cleared whenever it fills up.
 */
export function lzw(indices, minCodeSize) {
  const out = new Bytes();
  out.byte(minCodeSize);
  const HSIZE = 5003; // a prime; a key hashes to (c << 4) ^ prefix, then probes downwards
  const MAX_CODE = 4096;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const keys = new Int32Array(HSIZE).fill(-1);
  const codes = new Int32Array(HSIZE);
  let bits = minCodeSize + 1;
  let limit = (1 << bits) - 1;
  let next = clearCode + 2;
  let reset = false;

  const block = new Uint8Array(255);
  let blockLength = 0;
  const flushBlock = () => {
    if (!blockLength) return;
    out.byte(blockLength);
    out.bytes(block.subarray(0, blockLength));
    blockLength = 0;
  };
  const emitByte = (b) => {
    block[blockLength++] = b;
    if (blockLength === 255) flushBlock();
  };
  let acc = 0;
  let accBits = 0;
  // Write a code at the current width, then widen (or, after a clear, narrow) the
  // width for the next one, exactly when a decoder does.
  const emit = (code) => {
    acc |= code << accBits;
    accBits += bits;
    while (accBits >= 8) {
      emitByte(acc & 0xff);
      acc >>= 8;
      accBits -= 8;
    }
    if (reset) {
      bits = minCodeSize + 1;
      limit = (1 << bits) - 1;
      reset = false;
    } else if (next > limit && bits < 12) {
      bits++;
      limit = bits === 12 ? MAX_CODE : (1 << bits) - 1;
    }
  };

  emit(clearCode);
  let prefix = indices[0];
  scan: for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (c << 12) + prefix;
    let h = (c << 4) ^ prefix;
    if (keys[h] === key) {
      prefix = codes[h];
      continue;
    }
    if (keys[h] >= 0) {
      const step = h === 0 ? 1 : HSIZE - h;
      do {
        h -= step;
        if (h < 0) h += HSIZE;
        if (keys[h] === key) {
          prefix = codes[h];
          continue scan;
        }
      } while (keys[h] >= 0);
    }
    emit(prefix);
    prefix = c;
    if (next < MAX_CODE) {
      codes[h] = next++;
      keys[h] = key;
    } else {
      keys.fill(-1);
      next = clearCode + 2;
      reset = true;
      emit(clearCode);
    }
  }
  emit(prefix);
  emit(endCode);
  if (accBits > 0) emitByte(acc & 0xff);
  flushBlock();
  out.byte(0);
  return out.data;
}

/**
 * An endlessly looping GIF. `views` are RGBA pixel arrays of `width` × `height`, each
 * encoded once; `order` lists which view each frame shows; every frame lasts `delay`
 * hundredths of a second. `onProgress(done, total)` follows the encoding.
 */
export function encodeGif({ width, height, views, order, delay }, onProgress = () => {}) {
  const { palette, lookup } = buildPalette(views);
  const tableBits = Math.max(2, Math.ceil(Math.log2(palette.length / 3)));
  const images = views.map((px, i) => {
    const data = lzw(indexPixels(px, lookup), tableBits);
    onProgress(i + 1, views.length);
    return data;
  });

  const out = new Bytes();
  out.bytes([...'GIF89a'].map((ch) => ch.charCodeAt(0)));
  out.word(width);
  out.word(height);
  out.byte(0x80 | (7 << 4) | (tableBits - 1)); // global colour table, 8-bit colour resolution
  out.byte(0); // background colour index
  out.byte(0); // square pixels
  for (let i = 0; i < 3 << tableBits; i++) out.byte(palette[i] ?? 0);
  // Loop forever (the NETSCAPE2.0 application extension)
  out.bytes([0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((ch) => ch.charCodeAt(0)), 0x03, 0x01]);
  out.word(0);
  out.byte(0);
  for (const view of order) {
    out.bytes([0x21, 0xf9, 0x04, 1 << 2]); // graphic control: leave the frame in place, no transparency
    out.word(delay);
    out.bytes([0, 0]);
    out.byte(0x2c); // image descriptor: the whole canvas, no local colour table
    out.word(0);
    out.word(0);
    out.word(width);
    out.word(height);
    out.byte(0);
    out.bytes(images[view]);
  }
  out.byte(0x3b);
  return out.data;
}
