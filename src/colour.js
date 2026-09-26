// Colours and depth (no DOM). On a dark background most people see red in front of
// blue: the eye's chromatic aberration, with the pupil off its visual axis, shifts red
// and blue images apart in opposite directions in the two eyes, a small disparity
// (chromostereopsis). A screen mixes three primaries, so it has three such depths: red
// near, green about at the screen, blue far. A line stands out from what is behind it by
// the light it adds or takes away, so black ink on a blue window sits at blue depth,
// and red on white can look behind blue on white.
import { LIGHT_WINDOW, PALETTES, REVERSED_COLOURS } from './config.js';

// Each primary's mean refractive error in the eye, luminance-weighted over its spectrum,
// in dioptres (Winn, Bradley, Strang, McGraw and Thibos, "Reversals of the colour-depth
// illusion explained by ocular chromatic aberration", Vision Research 1995), and its
// share of luminance (sRGB).
const REFRACTION = [0.05, -0.245, -0.602];
const LUMINANCE = [0.2126, 0.7152, 0.0722];

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * How near a line of colour `line` on `behind` tends to look from the eye's chromatic
 * aberration alone: the refractive error of the light that makes it stand out, weighted
 * by luminance, in dioptres. More is nearer (the red end), less is farther (the blue
 * end); NaN when the line doesn't stand out at all.
 */
export function chromaticDepth(line, behind = '#000000') {
  const [a, b] = [rgb(line), rgb(behind)];
  let weight = 0;
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    const w = LUMINANCE[c] * Math.abs(a[c] - b[c]);
    weight += w;
    sum += w * REFRACTION[c];
  }
  return weight > 1e-4 ? sum / weight : Number.NaN;
}

/**
 * The colours a palette gives (see PALETTES): the echo in the near colour; with windows,
 * windows in the far colour and ink in the background's (black lines cut out of the
 * window); without, ink in the far colour. The window colour is set either way, so the
 * windows match when they come back.
 */
export function paletteColours({ near, far }, { windowOff, background }) {
  return { secondary: near, panel: far, primary: windowOff ? far : background };
}

/**
 * The ink colour to draw with: ink in the colour behind it (the window's, or the
 * background's without a window) would vanish, so it takes the other of those two.
 */
export function shownInk({ primary, panel }, { windowOff, background }) {
  const [behind, other] = windowOff ? [background, panel] : [panel, background];
  return same(primary, behind) && !same(other, behind) ? other : primary;
}

/** Colours picked by hand (echo, ink, window) as drawn now: see shownInk. */
export function customColours(custom, context) {
  return { ...custom, primary: shownInk(custom, context) };
}

// The echo, ink and window colours of `p`.
export const colours = ({ secondary, primary, panel }) => ({ secondary, primary, panel });

const sameColours = (a, b) => ['secondary', 'primary', 'panel'].every((key) => same(a[key], b[key]));

/** Whether `p` has the colours of the palette `id`: a preset's, or 'custom'. */
export function hasPalette(p, id, windowOff) {
  const context = { windowOff, background: p.background };
  if (id !== 'custom') {
    const preset = PALETTES.find((palette) => palette.id === id);
    return !!preset && sameColours(p, paletteColours(preset, context));
  }
  const custom = p.customColours;
  return !!custom && (sameColours(p, custom) || sameColours(p, customColours(custom, context)));
}

/** The palette `p`'s colours come from: a preset's id, 'custom', or null for neither. */
export function paletteOf(p, windowOff) {
  return [...PALETTES.map((palette) => palette.id), 'custom'].find((id) => hasPalette(p, id, windowOff)) ?? null;
}

/** The preset `p`'s colours are swapped from (see swapColours), or null. */
export function swappedPaletteOf(p, windowOff) {
  const context = { windowOff, background: p.background };
  const swapped = (palette) => swapColours({ ...p, ...paletteColours(palette, context) }, windowOff);
  return PALETTES.find((palette) => sameColours(p, swapped(palette)))?.id ?? null;
}

/**
 * Echo and ink colours swapped, near for far. With windows, the far colour is the
 * window's, so the echo swaps with the windows; ink that would then vanish into them
 * takes the background's colour. Without, the echo swaps with the ink, and windows
 * that had the ink's colour take the echo's, so they still match when they come back.
 */
export function swapColours({ secondary, primary, panel, background }, windowOff) {
  if (windowOff) return { secondary: primary, primary: secondary, panel: same(panel, primary) ? secondary : panel };
  return { secondary: panel, panel: secondary, primary: same(primary, secondary) ? background : primary };
}

/** Relative luminance, 0 for black to 1 for white. */
export const luminance = (hex) => rgb(hex).reduce((sum, v, c) => sum + v * LUMINANCE[c], 0);

/**
 * What the colours do to the depth, for the status line: 'hidden-ink' or 'hidden-echo'
 * when a layer has the colour behind it (the window, or the background without one);
 * 'light-window' when the windows are at least LIGHT_WINDOW light; 'reversed' when the
 * echo's colour reads at least REVERSED_COLOURS dioptres farther than the ink's; else null.
 */
export function colourHint(p, windowOff) {
  const behind = windowOff ? p.background : p.panel;
  const ink = chromaticDepth(p.primary, behind);
  const echo = chromaticDepth(p.secondary, behind);
  if (Number.isNaN(ink)) return 'hidden-ink';
  if (Number.isNaN(echo)) return 'hidden-echo';
  if (!windowOff && luminance(p.panel) >= LIGHT_WINDOW) return 'light-window';
  return echo - ink <= -REVERSED_COLOURS ? 'reversed' : null;
}
