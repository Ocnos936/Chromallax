// Default parameters. Geometry and colours are measured from the reference artwork
// that inspired the project (a 1179 × 1668 screenshot, not included here).
import { referencePanel } from './geometry.js';

const FOCUS = { centerX: 0.521, centerY: 0.588 }; // the reference's fixed point

export const DEFAULTS = Object.freeze({
  // Canvas, independent of the source image. Portrait 1:√2 is the reference artwork's ratio.
  ratio: '√2:1', // key of RATIOS in geometry.js, or 'free'
  orientation: 'portrait', // 'portrait' | 'landscape' (ignored by 1:1 and free)
  size: 1920, // long edge in px
  freeWidth: 1358, // canvas size in px when ratio is 'free'
  freeHeight: 1920,

  // Line-art placement on the canvas
  artX: 0.5, // art centre as fractions of canvas width / height
  artY: 0.5,
  artScale: 1, // zoom; 1 = the whole art fits the canvas

  // Line extraction
  threshold: 180, // luminance (0–255) separating line from background
  softness: 48, // width of the anti-aliasing ramp around the threshold
  invert: 'auto', // 'auto' | 'dark' (dark lines on light) | 'light' (light lines on dark)

  // Depth: the magenta copy is the placed art, the black copy is it shrunk by 1/depth
  // about the fixed point.
  depth: 1.2112,
  ...FOCUS, // fixed point as fractions of canvas width / height

  // Windows: flat panels that the black copy is clipped to, fixed on the canvas (see
  // panelBox in geometry.js). The reference has one, the canvas shrunk to 1/depth about
  // the fixed point; "Match depth" turns a window back into that.
  panels: Object.freeze([Object.freeze(referencePanel(FOCUS, 0.8256))]), // 0.8256 = 1/depth
  showPanels: true, // false: no window at all, nothing filled or clipped

  // What dragging the picture moves: 'art' (both line layers, through the construction)
  // or one layer alone: 'secondary' (magenta), 'primary' (black), 'panel' (the windows).
  dragTarget: 'art',
  // Per-layer shifts after the construction, fractions of canvas width / height; 0 = reference.
  secondaryOffsetX: 0,
  secondaryOffsetY: 0,
  primaryOffsetX: 0,
  primaryOffsetY: 0,

  // Style
  lineWidth: 1, // stroke width relative to the source (via the median stroke width)
  equalWidth: false, // thicken the black copy so it is as wide as magenta after shrinking
  background: '#000000',
  panel: '#0b03f6',
  primary: '#000000',
  secondary: '#f0087d',
});

// Slider ranges, also used to clamp values set by gestures and linking.
export const RANGES = Object.freeze({
  artScale: [0.1, 4],
  artX: [-0.5, 1.5],
  artY: [-0.5, 1.5],
  depth: [1, 2],
  panelX: [-0.5, 1.5], // window centre
  panelY: [-0.5, 1.5],
  panelSide: [0.02, 3], // window width and height, in canvas short edges
  lineWidth: [0.3, 3],
  freeWidth: [100, 4096], // 4096² is about the largest canvas every browser allows
  freeHeight: [100, 4096],
});

// Parameters that `Reset to reference` restores (canvas, placement and extraction are kept).
export const REFERENCE_KEYS = Object.freeze([
  'panels', 'showPanels', 'depth', 'centerX', 'centerY',
  'secondaryOffsetX', 'secondaryOffsetY', 'primaryOffsetX', 'primaryOffsetY',
  'lineWidth', 'equalWidth', 'background', 'panel', 'primary', 'secondary',
]);

// Sources are thresholded with their long edge in this range: large images are
// shrunk (memory / speed); small ones are enlarged first, so that thresholding
// at the finer grid keeps edges crisp instead of blurring an upscaled mask.
export const MIN_SOURCE_EDGE = 2400;
export const MAX_SOURCE_EDGE = 3200;

// Above this share of "heavy" ink (fills, fat strokes) the status line suggests thinner art.
// Not without a window: there, hatching and fills read as tone rather than flattening the depth.
export const HEAVY_SHARE_HINT = 0.15;
