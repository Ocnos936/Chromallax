// Default parameters. Geometry and colours are measured from the reference artwork
// that inspired the project (a 1179 × 1668 screenshot, not included here).
import { referencePanel } from './geometry.js';

const FOCUS = { centerX: 0.521, centerY: 0.588 }; // the reference's fixed point

export const DEFAULTS = Object.freeze({
  // Canvas, independent of the source image. Portrait 1:√2 is the reference artwork's ratio.
  ratio: '√2:1', // key of RATIOS in geometry.js, or 'free'
  orientation: 'portrait', // 'portrait' | 'landscape' (ignored by 1:1 and free)
  size: 1920, // long edge in px, one of SIZES
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
  flatten: false, // divide out the paper's uneven light (scans, phone photos of paper)
  specks: 0, // remove marks up to this many source px across; 0 = keep everything

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

  // Motion preview: a looping camera move (see moveLayout in geometry.js)
  motionPath: 'wiggle', // 'wiggle' | 'orbit' | 'breathe'
  motionShift: 0.006, // echo against ink, end to end of the move, in canvas short edges
  motionViews: 2, // views the move steps through
  motionViewTime: 0.06, // seconds per view
  motionPivot: 0.5, // where the still windows sit, from the ink (0) to the echo (1)

  // Style
  lineWidth: 1, // stroke width relative to the source (via the median stroke width)
  equalWidth: false, // thicken the black copy so it is as wide as magenta after shrinking
  background: '#000000',
  panel: '#0b03f6',
  primary: '#000000',
  secondary: '#f0087d',
});

// Long edges in the canvas size menu, in px.
export const SIZES = Object.freeze([1080, 1920, 2560, 3840]);

// Slider ranges, also used to clamp values set by gestures and linking.
export const RANGES = Object.freeze({
  artScale: [0.1, 4],
  artX: [-0.5, 1.5],
  artY: [-0.5, 1.5],
  depth: [1, 2],
  panelX: [-0.5, 1.5], // window centre
  panelY: [-0.5, 1.5],
  panelSide: [0.02, 3], // window width and height, in canvas short edges
  offset: [-2, 2], // echo and ink shifts, as canvas fractions
  lineWidth: [0.3, 3],
  specks: [0, 40],
  freeWidth: [100, 4096], // 4096² is about the largest canvas every browser allows
  freeHeight: [100, 4096],
  motionShift: [0.001, 0.02], // a small shift reads as depth, a big one as two pictures
  motionViewTime: [0.02, 0.2], // GIF delays come in 10 ms steps, and browsers play 10 ms or less as 100 ms
  motionPivot: [0, 1],
});

// Views a move can step through, and the number each path starts with: an orbit of two
// views would just be a wiggle.
export const MOTION_VIEWS = Object.freeze([2, 3, 4, 5]);
export const PATH_VIEWS = Object.freeze({ wiggle: 2, orbit: 4, breathe: 2 });

// Parameters that `Reset to reference` restores (canvas, placement and extraction are kept).
export const REFERENCE_KEYS = Object.freeze([
  'panels', 'showPanels', 'depth', 'centerX', 'centerY',
  'secondaryOffsetX', 'secondaryOffsetY', 'primaryOffsetX', 'primaryOffsetY',
  'lineWidth', 'equalWidth', 'background', 'panel', 'primary', 'secondary',
]);

// Export: the file formats, and the options the export menu starts with. A GIF is the
// motion preview, at a share of the canvas size.
export const EXPORT_FORMATS = Object.freeze(['png', 'jpeg', 'webp', 'gif']);
export const GIF_SCALES = Object.freeze([1, 0.5, 0.25]);
export const EXPORT_DEFAULTS = Object.freeze({ format: 'png', quality: 0.92, gifScale: 1 });
export const QUALITY_RANGE = Object.freeze([0.5, 1]); // JPEG and WebP

// Sources are thresholded with their long edge in this range: large images are
// shrunk (memory / speed); small ones are enlarged first, so that thresholding
// at the finer grid keeps edges crisp instead of blurring an upscaled mask.
export const MIN_SOURCE_EDGE = 2400;
export const MAX_SOURCE_EDGE = 3200;

// Above this share of "heavy" ink (fills, fat strokes) the status line suggests thinner art.
// Not without a window: there, hatching and fills read as tone rather than flattening the depth.
export const HEAVY_SHARE_HINT = 0.15;
