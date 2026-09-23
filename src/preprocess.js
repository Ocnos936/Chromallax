// Pure pixel functions (no DOM), so they run under `node --test`.
// Masks are Float32Array coverage maps: 1 = line, 0 = background.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Turn clean line art into a soft line mask.
 *
 * Images with real transparency use alpha as the mask (opaque = line, any colour).
 * Otherwise luminance is thresholded with a linear ramp of width `softness`
 * centred on `threshold`, which keeps the source's anti-aliasing.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image RGBA pixels
 * @param {{threshold?: number, softness?: number, invert?: 'auto'|'dark'|'light'}} options
 *   invert: 'dark' = dark lines on light, 'light' = light lines on dark,
 *   'auto' = decide from the median luminance (the background dominates line art).
 */
export function lineMask({ data, width, height }, { threshold = 180, softness = 48, invert = 'auto' } = {}) {
  const n = width * height;
  let transparent = 0;
  for (let j = 3; j < data.length; j += 4) if (data[j] < 250) transparent++;
  const usedAlpha = transparent > n * 0.01;

  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = usedAlpha ? 255 - data[j + 3] : (299 * data[j] + 587 * data[j + 1] + 114 * data[j + 2]) / 1000;
  }
  const lightLines = !usedAlpha && (invert === 'light' || (invert === 'auto' && median(gray) < 128));

  const mask = new Float32Array(n);
  const hi = threshold + softness / 2;
  for (let i = 0; i < n; i++) {
    const g = lightLines ? 255 - gray[i] : gray[i];
    mask[i] = softness > 0 ? clamp01((hi - g) / softness) : g < threshold ? 1 : 0;
  }
  return { mask, width, height, lightLines, usedAlpha };
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
