// Canvas rendering (browser only).
import { boxCorners, snapRect } from './geometry.js';

/** Canvas whose alpha channel is the mask coverage (RGB black). */
export function maskToCanvas(mask, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0, j = 3; i < mask.length; i++, j += 4) img.data[j] = mask[i] * 255;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Paint `color` into `target` wherever `maskCanvas` has coverage. */
export function tint(maskCanvas, color, target = document.createElement('canvas')) {
  target.width = maskCanvas.width; // resizing also clears and resets the context
  target.height = maskCanvas.height;
  const ctx = target.getContext('2d');
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, target.width, target.height);
  return target;
}

/**
 * Background → flat windows → dark lines (clipped to the windows) → magenta lines on top.
 * `layout` comes from computeLayout(); `primary` / `secondary` are tinted layer canvases;
 * `style` supplies the background / window colours and `showPanels`. Without windows
 * (none, or hidden) the dark lines are drawn straight onto the background, unclipped,
 * and end where the art itself ends.
 */
export function drawComposite(ctx, { width, height, layout, primary, secondary, style }) {
  const p = layout.primary;
  const s = layout.secondary;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (style.showPanels && layout.panels.length) {
    // Each window is filled on its own path: Chrome draws a lone full circle as an exact
    // oval, whose edge antialiases far better than a circle within a longer path. The clip
    // needs the union in one path; there, only line ends touch its edge.
    ctx.fillStyle = style.panel;
    for (const box of layout.panels) {
      ctx.beginPath();
      panelPath(ctx, box);
      ctx.fill();
    }
    ctx.beginPath();
    layout.panels.forEach((box, i) => panelPath(ctx, box, i > 0));
    ctx.clip();
  }
  ctx.drawImage(primary, p.x, p.y, p.w, p.h);
  ctx.restore();
  ctx.drawImage(secondary, s.x, s.y, s.w, s.h);
  ctx.restore();
}

// Add a window's outline to the path. Every outline runs clockwise, so under the
// nonzero rule overlapping windows clip as their union. A circle `joined` to earlier
// outlines starts with a moveTo, or a line would link it to the previous one.
function panelPath(ctx, box, joined = false) {
  const { shape, x, y, w, h, angle } = box;
  if (shape === 'circle') {
    if (joined) ctx.moveTo(x + w / 2, y);
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
  } else if (!angle) {
    const r = snapRect({ x: x - w / 2, y: y - h / 2, w, h }); // crisp axis-aligned edges
    ctx.rect(r.x, r.y, r.w, r.h);
  } else {
    boxCorners(box).forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    ctx.closePath();
  }
}
