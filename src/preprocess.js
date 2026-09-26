// Pure pixel functions (no DOM), so they run under `node --test`.
// Masks are Float32Array coverage maps: 1 = line, 0 = background.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Grey levels with the lines dark, whatever the source's polarity.
 *
 * Images with real transparency use alpha (opaque = line, any colour); otherwise
 * luminance, inverted for light lines on dark. With `flatten`, the paper's uneven
 * light (a phone photo's shading, a scan's vignette) is divided out first, so one
 * threshold fits the whole page.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image RGBA pixels
 * @param {{invert?: 'auto'|'dark'|'light', flatten?: boolean}} options
 *   invert: 'dark' = dark lines on light, 'light' = light lines on dark,
 *   'auto' = decide from the median luminance (the background dominates line art).
 */
export function inkLevels({ data, width, height }, { invert = 'auto', flatten = false } = {}) {
  const n = width * height;
  let transparent = 0;
  for (let j = 3; j < data.length; j += 4) if (data[j] < 250) transparent++;
  const usedAlpha = transparent > n * 0.01;

  let gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = usedAlpha ? 255 - data[j + 3] : (299 * data[j] + 587 * data[j + 1] + 114 * data[j + 2]) / 1000;
  }
  const lightLines = !usedAlpha && (invert === 'light' || (invert === 'auto' && median(gray) < 128));
  if (lightLines) for (let i = 0; i < n; i++) gray[i] = 255 - gray[i];
  if (flatten && !usedAlpha) gray = flattenBackground(gray, width, height, Math.round(0.02 * Math.max(width, height)));
  return { gray, width, height, lightLines, usedAlpha };
}

/**
 * A soft line mask from inkLevels(): a linear ramp of width `softness` centred on
 * `threshold`, which keeps the source's anti-aliasing. With `specks` > 0, marks no
 * more than that many px across (dust, paper grain) are removed.
 */
export function maskFromLevels({ gray, width, height, lightLines, usedAlpha }, { threshold = 180, softness = 48, specks = 0 } = {}) {
  const mask = new Float32Array(width * height);
  const hi = threshold + softness / 2;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = softness > 0 ? clamp01((hi - gray[i]) / softness) : gray[i] < threshold ? 1 : 0;
  }
  if (specks > 0) removeSpecks(mask, width, height, specks);
  return { mask, width, height, lightLines, usedAlpha };
}

/** inkLevels() and maskFromLevels() in one go. */
export function lineMask(image, options = {}) {
  return maskFromLevels(inkLevels(image, options), options);
}

function median(values) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[Math.round(values[i])]++;
  let seen = 0;
  for (let k = 0; k < 256; k++) {
    seen += hist[k];
    if (seen * 2 >= values.length) return k;
  }
  return 255;
}

// ---- Cleaning up scans and photos of paper -------------------------------------

/**
 * Divide out the paper's light. The paper level is a grey closing (the max, then the
 * min, over a square of radius `radius`), which drops every dark mark narrower than
 * that square, smoothed by two box blurs. The result has the paper at 255 everywhere
 * and each line as dark as it was against its own surroundings. Dark areas wider than
 * the square count as paper and fade.
 *
 * The paper's light varies slowly, so it is worked out on a grid of blocks (each the
 * brightest of its pixels, about radius / 8 across) and read back bilinearly. Within
 * `radius` of the image's edge the windows are cut short, so where the light changes
 * fast there the paper comes out a few levels grey.
 */
export function flattenBackground(gray, width, height, radius) {
  const f = Math.max(1, Math.floor(radius / 8));
  const [w, h] = [Math.ceil(width / f), Math.ceil(height / f)];
  let paper = new Float32Array(w * h);
  for (let y = 0; y < height; y++) {
    const row = ((y / f) | 0) * w;
    for (let x = 0; x < width; x++) {
      const i = row + ((x / f) | 0);
      const v = gray[y * width + x];
      if (v > paper[i]) paper[i] = v;
    }
  }
  const r = Math.max(1, Math.round(radius / f));
  paper = slidingExtreme(paper, w, h, r, Math.max);
  paper = slidingExtreme(paper, w, h, r, Math.min);
  const blur = Math.max(1, Math.round(r / 2));
  paper = boxBlur(boxBlur(paper, w, h, blur), w, h, blur);

  // Read back bilinearly; a grid one block wide or tall just repeats.
  const cell = (pos, n) => {
    const t = Math.min(n - 1, Math.max(0, (pos + 0.5) / f - 0.5));
    const i0 = Math.floor(t);
    return [i0, Math.min(n - 1, i0 + 1), t - i0];
  };
  const [x0, x1, tx] = [new Int32Array(width), new Int32Array(width), new Float32Array(width)];
  for (let x = 0; x < width; x++) [x0[x], x1[x], tx[x]] = cell(x, w);
  const out = new Float32Array(gray.length);
  for (let y = 0; y < height; y++) {
    const [y0, y1, ty] = cell(y, h);
    const [r0, r1] = [y0 * w, y1 * w];
    for (let x = 0; x < width; x++) {
      const top = paper[r0 + x0[x]] + (paper[r0 + x1[x]] - paper[r0 + x0[x]]) * tx[x];
      const bottom = paper[r1 + x0[x]] + (paper[r1 + x1[x]] - paper[r1 + x0[x]]) * tx[x];
      const p = top + (bottom - top) * ty;
      const i = y * width + x;
      out[i] = p > 1 ? Math.min(255, (255 * gray[i]) / p) : gray[i];
    }
  }
  return out;
}

// The max (or min) over a (2r + 1)² square around each pixel, clamped at the image
// edges: a monotonic queue per row, then per column, so the cost doesn't depend on r.
function slidingExtreme(src, width, height, r, pick) {
  const better = pick === Math.max ? (a, b) => a >= b : (a, b) => a <= b;
  const run = (read, write, n) => {
    const queue = new Int32Array(n);
    let [head, tail] = [0, 0];
    for (let i = 0, added = 0; i < n; i++) {
      for (; added < Math.min(n, i + r + 1); added++) {
        const v = read(added);
        while (tail > head && better(v, read(queue[tail - 1]))) tail--;
        queue[tail++] = added;
      }
      while (queue[head] < i - r) head++;
      write(i, read(queue[head]));
    }
  };
  const rows = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    run((x) => src[o + x], (x, v) => (rows[o + x] = v), width);
  }
  const out = new Float32Array(src.length);
  for (let x = 0; x < width; x++) run((y) => rows[y * width + x], (y, v) => (out[y * width + x] = v), height);
  return out;
}

// The mean over a (2r + 1)² square, clamped at the edges (running sums, rows then columns).
function boxBlur(src, width, height, r) {
  const run = (read, write, n) => {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += read(Math.min(n - 1, Math.max(0, i)));
    for (let i = 0; i < n; i++) {
      write(i, sum / (2 * r + 1));
      sum += read(Math.min(n - 1, i + r + 1)) - read(Math.max(0, i - r));
    }
  };
  const rows = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    run((x) => src[o + x], (x, v) => (rows[o + x] = v), width);
  }
  const out = new Float32Array(src.length);
  for (let x = 0; x < width; x++) run((y) => rows[y * width + x], (y, v) => (out[y * width + x] = v), height);
  return out;
}

/**
 * A threshold between the lines and the paper, from the grey levels' histogram (Otsu:
 * the split with the most variance between the two sides). Where a gap in the levels
 * makes a run of splits equally good, it takes the middle of the run, so the soft
 * ramp around the threshold falls in the gap rather than on the lines.
 */
export function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
  const total = gray.length;
  let sumAll = 0;
  for (let k = 0; k < 256; k++) sumAll += k * hist[k];
  let [first, last, bestVar] = [127, 127, -1];
  let [count, sum] = [0, 0];
  for (let k = 0; k < 255; k++) {
    count += hist[k];
    sum += k * hist[k];
    if (!count || count === total) continue;
    const [mDark, mLight] = [sum / count, (sumAll - sum) / (total - count)];
    const between = count * (total - count) * (mDark - mLight) ** 2;
    if (between > bestVar * (1 + 1e-9)) [first, last, bestVar] = [k, k, between];
    else if (between >= bestVar * (1 - 1e-9)) last = k;
  }
  return (first + last) / 2 + 0.5;
}

/**
 * Clear every mark (8-connected pixels with any coverage) that fits in a square of
 * `size` px. Long thin strokes stay, however little ink they have. Changes `mask`.
 */
export function removeSpecks(mask, width, height, size) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const found = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] <= 0) continue;
    seen[start] = 1;
    stack[0] = start;
    let [top, count] = [1, 0];
    let [x0, x1, y0, y1] = [start % width, start % width, (start / width) | 0, (start / width) | 0];
    let small = true;
    while (top) {
      const i = stack[--top];
      const [x, y] = [i % width, (i / width) | 0];
      if (small) {
        [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
        small = x1 - x0 < size && y1 - y0 < size;
        found[count++] = i; // kept only while the mark might still be a speck
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const j = ny * width + nx;
          if (nx < 0 || nx >= width || seen[j] || mask[j] <= 0) continue;
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (small) for (let k = 0; k < count; k++) mask[found[k]] = 0;
  }
  return mask;
}

// ---- Stroke distance field ---------------------------------------------------

const FAR = 1e20; // "no feature" in the squared-distance transform (finite, so FAR - FAR = 0)

/**
 * Exact Euclidean distance from every pixel to the nearest pixel with `feature[i]`
 * set (Felzenszwalb & Huttenlocher, O(n)). Pixels with no feature at all get ~1e10.
 */
export function distanceTransform(feature, width, height) {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const out = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = feature[y * width + x] ? 0 : FAR;
    lowerEnvelope(f, height, d, v, z);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) f[x] = out[o + x];
    lowerEnvelope(f, width, d, v, z);
    for (let x = 0; x < width; x++) out[o + x] = Math.sqrt(d[x]);
  }
  return out;
}

// 1-D squared distance transform: d[q] = min_p (q - p)² + f[p].
function lowerEnvelope(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Signed distance (px) from each pixel to the stroke edge: negative inside strokes,
 * positive outside. Pixels right next to the edge take their sub-pixel offset from
 * the soft mask, so offsetCoverage(sdf, 0) keeps the mask's anti-aliasing.
 *
 * Also measures the strokes: `strokeWidth` is the median width along stroke centre
 * lines, `heavyShare` the fraction of ink deeper inside a shape than a normal stroke
 * is wide (fills such as pupils, or heavy strokes).
 */
export function strokeField(mask, width, height) {
  const n = width * height;
  const sdf = new Float32Array(n);
  const feature = new Uint8Array(n);
  for (let i = 0; i < n; i++) feature[i] = mask[i] >= 0.5 ? 1 : 0;
  let dist = distanceTransform(feature, width, height); // outside pixels: distance to ink
  for (let i = 0; i < n; i++) if (!feature[i]) sdf[i] = dist[i] === 1 ? 0.5 - mask[i] : dist[i] - 0.5;
  for (let i = 0; i < n; i++) feature[i] ^= 1;
  dist = distanceTransform(feature, width, height); // ink pixels: distance to background
  for (let i = 0; i < n; i++) if (!feature[i]) sdf[i] = dist[i] === 1 ? 0.5 - mask[i] : 0.5 - dist[i];
  return { sdf, ...strokeStats(dist, feature, width, height) };
}

function strokeStats(depth, background, width, height) {
  // Centre-line pixels are local maxima of the distance to the background.
  const bins = new Uint32Array(801); // widths in 1/8 px, up to 100 px
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (background[i]) continue;
      const d = depth[i];
      if (
        d < depth[i - 1] || d < depth[i + 1] || d < depth[i - width] || d < depth[i + width] ||
        d < depth[i - width - 1] || d < depth[i - width + 1] || d < depth[i + width - 1] || d < depth[i + width + 1]
      ) continue;
      bins[Math.min(800, Math.round((2 * d - 0.5) * 8))]++; // pixel-centre distances: width ≈ 2d - 0.5
      count++;
    }
  }
  let strokeWidth = 0;
  for (let k = 0, seen = 0; k < bins.length && count; k++) {
    seen += bins[k];
    if (seen * 2 >= count) {
      strokeWidth = k / 8;
      break;
    }
  }
  let ink = 0;
  let heavy = 0;
  const deep = Math.max(2, strokeWidth);
  for (let i = 0; i < depth.length; i++) {
    if (background[i]) continue;
    ink++;
    if (depth[i] > deep) heavy++;
  }
  return { strokeWidth, heavyShare: ink ? heavy / ink : 0 };
}

/** Coverage with every stroke edge moved outwards by `delta` px (inwards if negative). */
export function offsetCoverage(sdf, delta) {
  const out = new Float32Array(sdf.length);
  for (let i = 0; i < sdf.length; i++) out[i] = clamp01(0.5 - sdf[i] + delta);
  return out;
}

/**
 * Edge offsets (source px) for the two layers. `lineWidth` scales a stroke of the
 * median width; the black copy is later shrunk by 1/depth, so with `equalWidth`
 * it is thickened first to come out as wide as the magenta strokes.
 */
export function strokeOffsets({ strokeWidth, lineWidth, depth, equalWidth }) {
  const secondary = ((lineWidth - 1) * strokeWidth) / 2;
  const primary = equalWidth ? depth * secondary + (strokeWidth * (depth - 1)) / 2 : secondary;
  return { primary, secondary };
}
