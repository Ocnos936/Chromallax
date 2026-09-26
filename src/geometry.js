// Pure layout math (no DOM).
//
// The canvas has its own aspect preset and size; the extracted line art is
// placed on it (position + zoom). The line layers scale about the fixed point c:
// the magenta copy is the placed art, the black copy is it shrunk by 1/depth.
// The windows (panels) are fixed on the canvas. The reference's single window is
// the canvas shrunk by 1/depth about c, so there everything is one homothety and
// c sits at the same relative position in window and canvas.

// Canvas ratio presets in landscape form; the orientation decides which side is long.
export const RATIOS = Object.freeze({
  '1:1': [1, 1],
  '4:3': [4, 3],
  '16:9': [16, 9],
  '√2:1': [Math.SQRT2, 1], // ISO 216 paper; portrait 1:√2 is the reference artwork's ratio
});

/** Canvas size in px for a ratio preset in an orientation, with the given long edge. */
export function canvasSize(ratio, orientation, longEdge) {
  const [a, b] = RATIOS[ratio];
  const [w, h] = orientation === 'portrait' ? [b, a] : [a, b];
  const k = longEdge / Math.max(w, h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** How a ratio reads in an orientation: '4:3' is '3:4' in portrait. */
export function ratioLabel(ratio, orientation) {
  if (orientation !== 'portrait' || ratio === '1:1') return ratio;
  const [a, b] = ratio.split(':');
  return `${b}:${a}`;
}

/** Art zoom at which the art covers the canvas, relative to fitting inside it (zoom 1). */
export function fillScale(width, height, artWidth, artHeight) {
  const sx = width / artWidth;
  const sy = height / artHeight;
  return Math.max(sx, sy) / Math.min(sx, sy);
}

/**
 * Zoom the art by `factor`, keeping the canvas point `anchor` ({x, y} as fractions) fixed.
 * The zoom is clamped to [min, max].
 */
export function zoomArt({ artX, artY, artScale }, factor, anchor, [min, max] = [0.1, 4]) {
  const scale = Math.min(max, Math.max(min, artScale * factor));
  const k = scale / artScale;
  return { artX: anchor.x + (artX - anchor.x) * k, artY: anchor.y + (artY - anchor.y) * k, artScale: scale };
}

const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/**
 * Resize one line layer, or the art, by `factor` about the canvas point `anchor` ({x, y}
 * as fractions), leaving the other layers where they are, and return the parameters
 * that change. Layer sizes live in existing parameters: depth is magenta relative to
 * black, so resizing either line layer changes depth, and an offset compensation keeps
 * the other layer in place. `ranges` clamps artScale and depth; the factor actually
 * applied shrinks accordingly. With the anchor on the focus point c, no new offsets
 * appear, so the layers stay aligned at c.
 */
export function scaleLayer(p, target, factor, anchor, ranges) {
  const magentaAnchor = { x: anchor.x - p.secondaryOffsetX, y: anchor.y - p.secondaryOffsetY };
  if (target === 'art') return zoomArt(p, factor, magentaAnchor, ranges.artScale);
  if (target === 'primary') {
    // A homothety image about c plus an offset: off' = k·off + (k − 1)(c − anchor).
    const depth = clampTo(p.depth / factor, ranges.depth);
    const k = p.depth / depth;
    return {
      depth,
      primaryOffsetX: k * p.primaryOffsetX + (k - 1) * (p.centerX - anchor.x),
      primaryOffsetY: k * p.primaryOffsetY + (k - 1) * (p.centerY - anchor.y),
    };
  }
  // Magenta: zoom the art ×k about the anchor and raise depth ×k, so the black copy keeps
  // its size; its offset then cancels the move: off' = off − (k − 1)(c − anchor + offM)/(k·depth).
  let k = clampTo(p.depth * factor, ranges.depth) / p.depth;
  k = clampTo(p.artScale * k, ranges.artScale) / p.artScale;
  const shift = (c, a, offM) => ((k - 1) * (c - a + offM)) / (k * p.depth);
  return {
    ...zoomArt(p, k, magentaAnchor, [0, Infinity]),
    depth: p.depth * k,
    primaryOffsetX: p.primaryOffsetX - shift(p.centerX, anchor.x, p.secondaryOffsetX),
    primaryOffsetY: p.primaryOffsetY - shift(p.centerY, anchor.y, p.secondaryOffsetY),
  };
}

/**
 * @param {object} p
 * @param {number} p.width @param {number} p.height canvas size in px
 * @param {number} p.depth magenta size relative to the black copy (≥ 1)
 * @param {number} p.centerX @param {number} p.centerY  fixed point as fractions
 * @param {number} [p.artWidth] @param {number} [p.artHeight] source size in px (default: the canvas)
 * @param {number} [p.artX] @param {number} [p.artY] art centre as fractions of the canvas
 * @param {number} [p.artScale] art zoom; 1 = the whole art fits the canvas
 * @param {number} [p.secondaryOffsetX] @param {number} [p.secondaryOffsetY]
 * @param {number} [p.primaryOffsetX] @param {number} [p.primaryOffsetY]
 *   per-layer shifts (fractions of the canvas) applied after the construction; 0 = reference
 * @param {object[]} [p.panels] windows, see panelBox
 * @returns rects {x, y, w, h} in canvas px: `art` (placed art), `primary` (black copy),
 *   `secondary` (magenta copy); `panels`, the windows' boxes; `center` and the magenta/black `scale`.
 */
export function computeLayout({
  width,
  height,
  depth,
  centerX,
  centerY,
  artWidth = width,
  artHeight = height,
  artX = 0.5,
  artY = 0.5,
  artScale = 1,
  secondaryOffsetX = 0,
  secondaryOffsetY = 0,
  primaryOffsetX = 0,
  primaryOffsetY = 0,
  panels = [],
}) {
  const cx = centerX * width;
  const cy = centerY * height;
  const k = Math.min(width / artWidth, height / artHeight) * artScale;
  const w = artWidth * k;
  const h = artHeight * k;
  const art = { x: artX * width - w / 2, y: artY * height - h / 2, w, h };
  const shrink = (r, s) => ({ x: cx + (r.x - cx) * s, y: cy + (r.y - cy) * s, w: r.w * s, h: r.h * s });
  const shift = (r, dx, dy) => ({ ...r, x: r.x + dx * width, y: r.y + dy * height });
  return {
    center: { x: cx, y: cy },
    scale: depth,
    art,
    primary: shift(shrink(art, 1 / depth), primaryOffsetX, primaryOffsetY),
    secondary: shift(art, secondaryOffsetX, secondaryOffsetY),
    panels: panels.map((panel) => panelBox(panel, width, height)),
  };
}

// ---- Windows -----------------------------------------------------------------
// A window (panel) is fixed on the canvas: `x`, `y` is its centre as canvas fractions
// and `angle` its rotation in degrees, clockwise. Its size is either `size`, a fraction
// of the canvas that keeps the canvas's aspect ratio (the reference's window), or
// `w` × `h` in canvas short edges, so that a window keeps its shape when the canvas
// ratio changes. `shape` is 'rect' or 'circle', the inscribed circle of that box.

const toRadians = (deg) => (deg * Math.PI) / 180;

/** The reference's window: the canvas shrunk to `size` about the fixed point. */
export function referencePanel({ centerX, centerY }, size, shape = 'rect') {
  return { shape, x: centerX + (0.5 - centerX) * size, y: centerY + (0.5 - centerY) * size, size, angle: 0 };
}

/**
 * A window's box in canvas px: centre `x`, `y`, size `w` × `h` and `angle` in degrees.
 * A circle's box is the square around it, and it has no angle.
 */
export function panelBox(panel, width, height) {
  const u = Math.min(width, height);
  const fit = panel.size != null;
  let w = fit ? panel.size * width : panel.w * u;
  let h = fit ? panel.size * height : panel.h * u;
  const circle = panel.shape === 'circle';
  if (circle) w = h = Math.min(w, h);
  return { shape: panel.shape, x: panel.x * width, y: panel.y * height, w, h, angle: circle ? 0 : panel.angle || 0 };
}

// A point relative to a box's centre, on the box's own (unrotated) axes.
function toBox(box, { x, y }) {
  const t = toRadians(box.angle);
  const [dx, dy] = [x - box.x, y - box.y];
  return { x: dx * Math.cos(t) + dy * Math.sin(t), y: -dx * Math.sin(t) + dy * Math.cos(t) };
}

// The canvas point at (lx, ly) on a box's own axes, relative to its centre.
function fromBox(box, lx, ly) {
  const t = toRadians(box.angle);
  return { x: box.x + lx * Math.cos(t) - ly * Math.sin(t), y: box.y + lx * Math.sin(t) + ly * Math.cos(t) };
}

/** A rectangular box's corners in canvas px, clockwise from the top left. */
export function boxCorners(box) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => fromBox(box, (sx * box.w) / 2, (sy * box.h) / 2));
}

// Whether the canvas px point lies inside the box's shape.
function insideBox(box, point) {
  const { x, y } = toBox(box, point);
  if (box.shape === 'circle') return Math.hypot(x, y) <= box.w / 2;
  return Math.abs(x) <= box.w / 2 && Math.abs(y) <= box.h / 2;
}

/** Index of the topmost (last) window containing the canvas px point, or −1. */
export function panelAt(panels, point, { width, height }) {
  for (let i = panels.length - 1; i >= 0; i--) if (insideBox(panelBox(panels[i], width, height), point)) return i;
  return -1;
}

/**
 * A box's handles in canvas px. Each has `handle` [hx, hy], with −1, 0 or 1 per axis of the
 * box (a corner, or an edge midpoint where one is 0), or 'rotate' for the knob `lift` px
 * above the top edge. A circle has only the corners.
 */
export function panelHandles(box, lift) {
  const handles = [];
  for (const hy of [-1, 0, 1]) {
    for (const hx of [-1, 0, 1]) {
      if ((hx || hy) && (box.shape !== 'circle' || (hx && hy))) {
        handles.push({ handle: [hx, hy], ...fromBox(box, (hx * box.w) / 2, (hy * box.h) / 2) });
      }
    }
  }
  if (box.shape !== 'circle') handles.push({ handle: 'rotate', ...fromBox(box, 0, -box.h / 2 - lift) });
  return handles;
}

// Factors by which a box can be scaled with its sides within `range` short edges `u`.
// They always include 1, so a window that is already outside can come back.
function scaleLimits(box, u, [lo, hi]) {
  return [Math.min(1, (lo * u) / Math.min(box.w, box.h)), Math.max(1, (hi * u) / Math.max(box.w, box.h))];
}

// The windows `which` picks: one index, or all of them for null.
const picks = (which) => (_, i) => which == null || i === which;

/**
 * Scale window `which` (all windows when null) by `factor`, about `anchor` (canvas
 * fractions) or, without one, about each window's own centre. All scale by one factor,
 * clamped so that every side stays within `range` short edges. Returns the new list.
 */
export function scalePanels(panels, which, factor, anchor, { width, height }, range) {
  const u = Math.min(width, height);
  let [lo, hi] = [0, Infinity];
  for (const panel of panels.filter(picks(which))) {
    const [a, b] = scaleLimits(panelBox(panel, width, height), u, range);
    [lo, hi] = [Math.max(lo, a), Math.min(hi, b)];
  }
  const k = clampTo(factor, [lo, hi]);
  return panels.map((panel, i) => {
    if (!picks(which)(panel, i)) return panel;
    const { x, y } = anchor ?? panel;
    const next = { ...panel, x: x + (panel.x - x) * k, y: y + (panel.y - y) * k };
    if (panel.size != null) next.size = panel.size * k;
    else [next.w, next.h] = [panel.w * k, panel.h * k];
    return next;
  });
}

/**
 * Move window `which` (all windows when null) by `dx`, `dy` canvas fractions. The move
 * is clamped so that every centre stays within `rangeX` × `rangeY`; windows move together.
 */
export function movePanels(panels, which, dx, dy, rangeX, rangeY) {
  const picked = panels.filter(picks(which));
  const limit = (d, key, [lo, hi]) =>
    clampTo(d, [Math.min(0, Math.max(...picked.map((p) => lo - p[key]))), Math.max(0, Math.min(...picked.map((p) => hi - p[key])))]);
  const [mx, my] = [limit(dx, 'x', rangeX), limit(dy, 'y', rangeY)];
  return panels.map((panel, i) => (picks(which)(panel, i) ? { ...panel, x: panel.x + mx, y: panel.y + my } : panel));
}

/**
 * Drag one of a window's handles, [hx, hy] as in panelHandles. `delta` is the pointer's
 * move in canvas px since the drag began, and `panel` the window as it was then. The
 * opposite handle stays put, or the centre with `fromCenter`. With `keepRatio` (always
 * for a circle) both sides scale by one factor, following the pointer along the diagonal.
 * Sides stay within `range` short edges and never flip. The result has an explicit w × h.
 */
export function resizePanel(panel, [hx, hy], delta, { width, height }, range, { keepRatio = false, fromCenter = false } = {}) {
  const u = Math.min(width, height);
  const box = panelBox(panel, width, height);
  const d = toBox({ ...box, x: 0, y: 0 }, delta); // the move on the box's own axes
  const grow = fromCenter ? 2 : 1;
  let [w, h] = [box.w, box.h];
  if (keepRatio || panel.shape === 'circle') {
    const k = hx && hy
      ? 1 + (grow * (hx * d.x * box.w + hy * d.y * box.h)) / (box.w ** 2 + box.h ** 2)
      : 1 + (grow * (hx * d.x + hy * d.y)) / (hx ? box.w : box.h);
    const limited = clampTo(k, scaleLimits(box, u, range));
    [w, h] = [box.w * limited, box.h * limited];
  } else {
    const side = (v) => clampTo(v, [range[0] * u, range[1] * u]);
    if (hx) w = side(box.w + grow * hx * d.x);
    if (hy) h = side(box.h + grow * hy * d.y);
  }
  // The centre follows the dragged handle by half the growth.
  const c = fromCenter ? box : fromBox(box, (hx * (w - box.w)) / 2, (hy * (h - box.h)) / 2);
  const { size, ...rest } = panel;
  return { ...rest, x: c.x / width, y: c.y / height, w: w / u, h: h / u };
}

/**
 * Turn a window by the pointer's swing about its centre, `from` → `to` in canvas px, from
 * `panel` as it was when the drag began. With `step`, the angle snaps to multiples of it.
 * Angles stay within (−180, 180].
 */
export function rotatePanel(panel, from, to, { width, height }, step = 0) {
  const [cx, cy] = [panel.x * width, panel.y * height];
  const swing = Math.atan2(to.y - cy, to.x - cx) - Math.atan2(from.y - cy, from.x - cx);
  let angle = (panel.angle || 0) + (swing * 180) / Math.PI;
  if (step) angle = Math.round(angle / step) * step;
  angle = ((((angle + 180) % 360) + 360) % 360) - 180;
  return { ...panel, angle: angle === -180 ? 180 : angle };
}

// ---- Motion -------------------------------------------------------------------
// A looping camera move, as in a wigglegram. The windows are the stereo window: they,
// the background and the canvas edge stay put, the ink (behind them, since they clip
// it) moves one way, and the echo (in front, since it covers their edges) the other.
// `motionPivot` places the windows between the ink (0) and the echo (1): the nearer
// a layer is to them, the less it moves.

// The views a path steps through, in play order: a wiggle and a breath go there and
// back (1-2-3-4-3-2), an orbit keeps going round.
export function motionOrder({ motionPath, motionViews }) {
  const views = [...Array(motionViews).keys()];
  return motionPath === 'orbit' ? views : [...views, ...views.slice(1, -1).reverse()];
}

/** Seconds per loop: every view shows for `motionViewTime`. */
export function motionLoop(p) {
  return motionOrder(p).length * p.motionViewTime;
}

/**
 * The layout from computeLayout at `phase` (0 to 1, one loop). Each path steps through
 * `motionViews` views: 'wiggle' from left to right and back, 'orbit' round a circle, and
 * 'breathe' from far to near and back. `motionShift` is how far the echo shifts against
 * the ink from one end of the move to the other (the orbit's diameter), in canvas short
 * edges; for 'breathe', half a short edge from the focus point.
 */
export function moveLayout(layout, phase, p, { width, height }) {
  const order = motionOrder(p);
  const view = order[Math.floor((phase % 1) * order.length)];
  const across = view / (p.motionViews - 1) - 0.5; // from −1/2 to 1/2 over the views
  const [echo, ink] = [1 - p.motionPivot, -p.motionPivot]; // shares of the echo-against-ink move
  if (p.motionPath === 'breathe') {
    const k = 1 + 2 * p.motionShift * across; // echo size against the ink
    const c = layout.center;
    const about = (r, s) => ({ x: c.x + (r.x - c.x) * s, y: c.y + (r.y - c.y) * s, w: r.w * s, h: r.h * s });
    return { ...layout, secondary: about(layout.secondary, k ** echo), primary: about(layout.primary, k ** ink) };
  }
  const turn = (2 * Math.PI * view) / p.motionViews;
  const at = p.motionPath === 'orbit' ? [Math.cos(turn) / 2, Math.sin(turn) / 2] : [across, 0]; // echo against ink, as a share of the shift
  const total = p.motionShift * Math.min(width, height);
  const shift = (r, share) => ({ ...r, x: r.x + at[0] * total * share, y: r.y + at[1] * total * share });
  return { ...layout, secondary: shift(layout.secondary, echo), primary: shift(layout.primary, ink) };
}

/** Round a rect's edges to whole pixels so a flat fill has crisp borders. */
export function snapRect({ x, y, w, h }) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  return { x: x0, y: y0, w: Math.round(x + w) - x0, h: Math.round(y + h) - y0 };
}
