// Settings kept between visits. app.js stores them in the browser; this module decides
// what is kept and checks what comes back. Left out: what belongs to the current image
// (its placement, and the line extraction tuned for it), the layer picked for gestures,
// and the background, which has no control.
import { EXPORT_DEFAULTS, EXPORT_FORMATS, GIF_SCALES, MOTION_VIEWS, QUALITY_RANGE, RANGES, SIZES } from './config.js';
import { RATIOS } from './geometry.js';

const VERSION = 1;

// Each rule returns the stored value, clamped where it has a range, or undefined if unusable.
const number = ([lo, hi]) => (v) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const positive = (v) => (Number.isFinite(v) && v > 0 ? v : undefined);
const oneOf = (values) => (v) => (values.includes(v) ? v : undefined);
const flag = (v) => (typeof v === 'boolean' ? v : undefined);
const colour = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

// A window, as panelBox in geometry.js reads it.
function panel(p) {
  if (p === null || typeof p !== 'object' || !['rect', 'circle'].includes(p.shape)) return undefined;
  const x = number(RANGES.panelX)(p.x);
  const y = number(RANGES.panelY)(p.y);
  const angle = p.angle === undefined ? 0 : number([-180, 180])(p.angle);
  if (x === undefined || y === undefined || angle === undefined) return undefined;
  if (p.size != null) {
    const size = positive(p.size);
    return size && { shape: p.shape, x, y, size, angle };
  }
  const [w, h] = [positive(p.w), positive(p.h)];
  return w && h ? { shape: p.shape, x, y, w, h, angle } : undefined;
}

// All windows or none: a list with one bad window keeps the default list.
function panels(list) {
  if (!Array.isArray(list)) return undefined;
  const read = list.map(panel);
  return read.includes(undefined) ? undefined : read;
}

const RULES = {
  ratio: oneOf([...Object.keys(RATIOS), 'free']),
  orientation: oneOf(['portrait', 'landscape']),
  size: oneOf(SIZES),
  freeWidth: number(RANGES.freeWidth),
  freeHeight: number(RANGES.freeHeight),
  depth: number(RANGES.depth),
  centerX: number([0, 1]),
  centerY: number([0, 1]),
  panels,
  showPanels: flag,
  secondaryOffsetX: number(RANGES.offset),
  secondaryOffsetY: number(RANGES.offset),
  primaryOffsetX: number(RANGES.offset),
  primaryOffsetY: number(RANGES.offset),
  motionPath: oneOf(['wiggle', 'orbit', 'breathe']),
  motionShift: number(RANGES.motionShift),
  motionViews: oneOf(MOTION_VIEWS),
  motionViewTime: number(RANGES.motionViewTime),
  motionPivot: number(RANGES.motionPivot),
  lineWidth: number(RANGES.lineWidth),
  equalWidth: flag,
  panel: colour,
  primary: colour,
  secondary: colour,
};

export const KEPT_KEYS = Object.freeze(Object.keys(RULES));

/** What to store for `params`. */
export function keptSettings(params) {
  return { version: VERSION, settings: Object.fromEntries(KEPT_KEYS.map((key) => [key, params[key]])) };
}

/** The usable settings in `stored`, as parsed from storage: a partial params object. */
export function readSettings(stored) {
  const settings = stored?.version === VERSION ? stored.settings : null;
  if (settings === null || typeof settings !== 'object') return {};
  const out = {};
  for (const [key, read] of Object.entries(RULES)) {
    const value = read(settings[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The export menu's options as stored (format, JPEG/WebP quality, GIF size), checked. */
export function readExportOptions(stored) {
  const rules = { format: oneOf(EXPORT_FORMATS), quality: number(QUALITY_RANGE), gifScale: oneOf(GIF_SCALES) };
  const out = { ...EXPORT_DEFAULTS };
  if (stored === null || typeof stored !== 'object') return out;
  for (const [key, read] of Object.entries(rules)) {
    const value = read(stored[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
