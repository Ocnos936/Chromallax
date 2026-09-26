// Line drawings from photos (no DOM): a flow-based difference of Gaussians (FDoG),
// after Kang, Lee and Chui, "Coherent Line Drawing" (2007), with the edge flow taken
// from a smoothed structure tensor, as in Kyprianidis's flow-based filters.
//
// A difference of Gaussians across an edge is negative on its dark side only, so a
// thin dark feature gives one line and a step between two tones gives one line along
// its darker side: nothing is outlined twice. Summing that response along the edge
// flow joins broken bits into long, even strokes and drops texture that has no
// direction. The result is grey levels with the lines dark, like inkLevels() makes for
// line art, so the threshold, softness and speck removal work the same on both.

const luminance = (data, i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

// A normalised 1-D Gaussian of standard deviation `sigma`, reaching 3 sigma.
function gaussian(sigma) {
  const reach = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(2 * reach + 1);
  let sum = 0;
  for (let i = -reach; i <= reach; i++) sum += kernel[i + reach] = Math.exp((-i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

// Separable Gaussian blur, clamped at the edges.
function blur(src, width, height, sigma) {
  const kernel = gaussian(sigma);
  const reach = (kernel.length - 1) / 2;
  const rows = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -reach; k <= reach; k++) sum += kernel[k + reach] * src[o + Math.min(width - 1, Math.max(0, x + k))];
      rows[o + x] = sum;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -reach; k <= reach; k++) sum += kernel[k + reach] * rows[Math.min(height - 1, Math.max(0, y + k)) * width + x];
      out[y * width + x] = sum;
    }
  }
  return out;
}

// Bilinear read of `img` at (x, y), clamped at the edges.
function sample(img, width, height, x, y) {
  x = Math.min(width - 1, Math.max(0, x));
  y = Math.min(height - 1, Math.max(0, y));
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [x1, y1] = [Math.min(width - 1, x0 + 1), Math.min(height - 1, y0 + 1)];
  const [tx, ty] = [x - x0, y - y0];
  const top = img[y0 * width + x0] + (img[y0 * width + x1] - img[y0 * width + x0]) * tx;
  const bottom = img[y1 * width + x0] + (img[y1 * width + x1] - img[y1 * width + x0]) * tx;
  return top + (bottom - top) * ty;
}

// Three box blurs, close to a Gaussian of standard deviation `sigma` and as fast for
// any sigma (running sums); good enough where exactness doesn't matter.
function roughBlur(src, width, height, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  const pass = (from, to, n, count, stride, step) => {
    for (let line = 0; line < count; line++) {
      const o = line * stride;
      let sum = from[o] * (r + 1);
      for (let k = 1; k <= r; k++) sum += from[o + Math.min(n - 1, k) * step];
      for (let i = 0; i < n; i++) {
        to[o + i * step] = sum / (2 * r + 1);
        sum += from[o + Math.min(n - 1, i + r + 1) * step] - from[o + Math.max(0, i - r) * step];
      }
    }
  };
  let [a, b] = [Float32Array.from(src), new Float32Array(src.length)];
  for (let k = 0; k < 3; k++) {
    pass(a, b, width, height, width, 1);
    pass(b, a, height, width, 1, width);
  }
  return a;
}

/**
 * The edge flow: at every pixel a unit vector (tx, ty) along the edge, the minor
 * eigenvector of the structure tensor smoothed with `sigma`. Flat areas get (1, 0).
 */
export function edgeFlow(gray, width, height, sigma = 2) {
  const n = width * height;
  const [jxx, jxy, jyy] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < height; y++) {
    const [up, down] = [Math.max(0, y - 1) * width, Math.min(height - 1, y + 1) * width];
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const [l, r] = [Math.max(0, x - 1), Math.min(width - 1, x + 1)];
      // Sobel
      const gx = gray[up + r] + 2 * gray[row + r] + gray[down + r] - gray[up + l] - 2 * gray[row + l] - gray[down + l];
      const gy = gray[down + l] + 2 * gray[down + x] + gray[down + r] - gray[up + l] - 2 * gray[up + x] - gray[up + r];
      jxx[row + x] = gx * gx;
      jxy[row + x] = gx * gy;
      jyy[row + x] = gy * gy;
    }
  }
  const [a, b, c] = [roughBlur(jxx, width, height, sigma), roughBlur(jxy, width, height, sigma), roughBlur(jyy, width, height, sigma)];
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // The minor eigenvector (b, l2 - a) runs along the edge, at right angles to the gradient.
    const l2 = (a[i] + c[i] - Math.sqrt((a[i] - c[i]) ** 2 + 4 * b[i] * b[i])) / 2;
    let u = b[i];
    let v = l2 - a[i];
    if (Math.abs(u) + Math.abs(v) < 1e-9) [u, v] = a[i] >= c[i] ? [0, 1] : [1, 0];
    const len = Math.hypot(u, v);
    tx[i] = u / len;
    ty[i] = v / len;
  }
  return { tx, ty };
}

/**
 * Line darkness from a photo: grey levels (0-255) with the lines dark and everything
 * else at 255, the size of `image`. `sigma` sets the smallest feature that makes a
 * line (px); `flow` sums the response along the edges, which gives long coherent
 * strokes; without it this is a plain, isotropic difference of Gaussians.
 */
export function photoLevels({ data, width, height }, { sigma = 1.2, flow = true } = {}) {
  const n = width * height;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = luminance(data, 4 * i);
  const sigmaS = 1.6 * sigma; // the surround, as in Marr and Hildreth's DoG
  let response;
  if (!flow) {
    const [centre, surround] = [blur(gray, width, height, sigma), blur(gray, width, height, sigmaS)];
    response = centre.map((v, i) => v - surround[i]);
  } else {
    const { tx, ty } = edgeFlow(gray, width, height, 2 * sigma);
    // Across the edge: centre minus surround, sampled along the gradient direction.
    // The image is padded by the kernel's reach, so the samples need no bounds checks.
    const [gc, gs] = [gaussian(sigma), gaussian(sigmaS)];
    const reach = (gs.length - 1) / 2;
    const weights = new Float32Array(2 * reach + 1);
    for (let k = -reach; k <= reach; k++) weights[k + reach] = (gc[k + (gc.length - 1) / 2] ?? 0) - gs[k + reach];
    const pad = reach + 1;
    const pw = width + 2 * pad;
    const padded = new Float32Array(pw * (height + 2 * pad));
    for (let y = 0; y < height + 2 * pad; y++) {
      const row = Math.min(height - 1, Math.max(0, y - pad)) * width;
      for (let x = 0; x < pw; x++) padded[y * pw + x] = gray[row + Math.min(width - 1, Math.max(0, x - pad))];
    }
    const across = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const nx = -ty[i];
        const ny = tx[i];
        let sum = 0;
        for (let k = -reach; k <= reach; k++) {
          const sx = x + pad + k * nx;
          const sy = y + pad + k * ny;
          const x0 = sx | 0;
          const y0 = sy | 0;
          const fx = sx - x0;
          const fy = sy - y0;
          const j = y0 * pw + x0;
          const top = padded[j] + (padded[j + 1] - padded[j]) * fx;
          const bottom = padded[j + pw] + (padded[j + pw + 1] - padded[j + pw]) * fx;
          sum += weights[k + reach] * (top + (bottom - top) * fy);
        }
        across[i] = sum;
      }
    }
    // Along the edge: a Gaussian-weighted sum following the flow both ways, one px a step.
    const sigmaM = 3 * sigma;
    const along = gaussian(sigmaM);
    const steps = (along.length - 1) / 2;
    response = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let sum = along[steps] * across[i];
        for (let dir = 1; dir >= -1; dir -= 2) {
          let px = x;
          let py = y;
          let vx = dir * tx[i];
          let vy = dir * ty[i];
          for (let s = 1; s <= steps; s++) {
            px += vx;
            py += vy;
            if (px < 0 || py < 0 || px >= width - 1 || py >= height - 1) break;
            const x0 = px | 0;
            const y0 = py | 0;
            const j = y0 * width + x0;
            const fx = px - x0;
            const fy = py - y0;
            const top = across[j] + (across[j + 1] - across[j]) * fx;
            const bottom = across[j + width] + (across[j + width + 1] - across[j + width]) * fx;
            sum += along[steps + s] * (top + (bottom - top) * fy);
            const t = ((py + 0.5) | 0) * width + ((px + 0.5) | 0);
            const flip = tx[t] * vx + ty[t] * vy < 0 ? -1 : 1; // keep going the same way
            vx = flip * tx[t];
            vy = flip * ty[t];
          }
        }
        response[i] = sum;
      }
    }
  }
  // Only the dark side counts, and only beyond rounding noise. The darkest 1 % of the
  // responses sets full darkness, so a dim or soft photo still gives dark lines.
  const NOISE = 0.5; // grey levels
  let deepest = 0;
  for (let i = 0; i < n; i++) if (response[i] < deepest) deepest = response[i];
  const bins = new Float64Array(2049);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (response[i] >= -NOISE) continue;
    bins[Math.min(2048, Math.round((response[i] / deepest) * 2048))]++;
    count++;
  }
  let strong = -deepest;
  for (let k = 2048, seen = 0; k > 0 && count; k--) {
    seen += bins[k];
    if (seen >= count * 0.01) {
      strong = (k / 2048) * -deepest;
      break;
    }
  }
  strong = Math.max(strong, 4 * NOISE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = response[i] < -NOISE ? Math.max(0, 255 * (1 + response[i] / strong)) : 255;
  return out;
}

/** Bilinear resize of a grey image. */
export function resizeGray(gray, width, height, toWidth, toHeight) {
  const out = new Float32Array(toWidth * toHeight);
  const [kx, ky] = [width / toWidth, height / toHeight];
  for (let y = 0; y < toHeight; y++) {
    for (let x = 0; x < toWidth; x++) out[y * toWidth + x] = sample(gray, width, height, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
  }
  return out;
}
