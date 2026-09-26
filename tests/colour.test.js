import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LIGHT_WINDOW, PALETTES } from '../src/config.js';
import {
  chromaticDepth, colourHint, hasPalette, luminance, paletteColours, paletteOf, shownInk, swapColours, swappedPaletteOf,
} from '../src/colour.js';

const BLACK = '#000000';
const WHITE = '#ffffff';
const context = (windowOff) => ({ windowOff, background: BLACK });
// Params with a palette applied, the windows on or off.
const withPalette = (palette, windowOff) => ({ ...DEFAULTS, ...paletteColours(palette, context(windowOff)) });

test('on black, red looks nearest, green in between and blue farthest', () => {
  const [red, green, blue] = ['#ff0000', '#00ff00', '#0000ff'].map((c) => chromaticDepth(c));
  assert.ok(red > green && green > blue);
  assert.ok(Math.abs(red - blue - 0.652) < 1e-9); // Winn et al.'s red–blue difference
  // Brightness alone changes nothing: grey sits where white does.
  assert.ok(Math.abs(chromaticDepth('#5a5a5a') - chromaticDepth(WHITE)) < 1e-9);
});

test("a line stands out by what it changes: black ink on blue sits at blue's depth", () => {
  assert.ok(Math.abs(chromaticDepth(BLACK, '#0000ff') - chromaticDepth('#0000ff')) < 1e-9);
  assert.ok(Number.isNaN(chromaticDepth('#0b03f6', '#0b03f6')));
});

test('on white, red over blue turns round', () => {
  assert.ok(chromaticDepth('#fa0303') > chromaticDepth('#080bea'));
  assert.ok(chromaticDepth('#fa0303', WHITE) < chromaticDepth('#080bea', WHITE));
});

test('every preset keeps the echo in front, with windows and without', () => {
  for (const palette of PALETTES) {
    for (const windowOff of [false, true]) {
      const p = withPalette(palette, windowOff);
      assert.equal(colourHint(p, windowOff), null, `${palette.id}, windows ${windowOff ? 'off' : 'on'}`);
      assert.equal(paletteOf(p, windowOff), palette.id);
    }
  }
});

test('a preset draws black ink in its window colour, or ink in that colour without one', () => {
  const [classic] = PALETTES;
  assert.deepEqual(paletteColours(classic, context(false)), { secondary: '#f0087d', panel: '#0b03f6', primary: BLACK });
  assert.deepEqual(paletteColours(classic, context(true)), { secondary: '#f0087d', panel: '#0b03f6', primary: '#0b03f6' });
  // Toggling the windows with shownInk turns one into the other.
  assert.equal(shownInk(paletteColours(classic, context(false)), context(true)), '#0b03f6');
  assert.equal(shownInk(paletteColours(classic, context(true)), context(false)), BLACK);
});

test('swapping near and far twice gives the colours back, and once turns them round', () => {
  for (const palette of PALETTES) {
    for (const windowOff of [false, true]) {
      const p = withPalette(palette, windowOff);
      const once = { ...p, ...swapColours(p, windowOff) };
      const twice = { ...once, ...swapColours(once, windowOff) };
      assert.equal(paletteOf(twice, windowOff), palette.id);
      assert.equal(paletteOf(once, windowOff), null);
      assert.equal(swappedPaletteOf(once, windowOff), palette.id);
      assert.equal(swappedPaletteOf(p, windowOff), null);
      // With windows, a light near colour becomes a light window. White over grey has no
      // colour depth to turn round.
      const expected = !windowOff && luminance(palette.near) >= LIGHT_WINDOW ? 'light-window' : palette.id === 'mono' ? null : 'reversed';
      assert.equal(colourHint(once, windowOff), expected, `${palette.id}, windows ${windowOff ? 'off' : 'on'}`);
    }
  }
});

test('a light window is pointed out, the background never', () => {
  assert.equal(colourHint({ ...DEFAULTS, panel: WHITE }, false), 'light-window');
  assert.equal(colourHint({ ...DEFAULTS, panel: '#5a5a5a' }, false), null);
  assert.equal(colourHint({ ...DEFAULTS, panel: WHITE, primary: '#0b03f6' }, true), null);
});

test('swapping without windows keeps the windows in the far colour', () => {
  const p = withPalette(PALETTES[0], true);
  assert.deepEqual(swapColours(p, true), { secondary: '#0b03f6', primary: '#f0087d', panel: '#f0087d' });
});

test('colours picked by hand are recognised, also after the windows come or go', () => {
  const customColours = { secondary: '#33ff66', primary: BLACK, panel: '#0b03f6' };
  const p = { ...DEFAULTS, ...customColours, customColours };
  assert.equal(paletteOf(p, false), 'custom');
  // Without windows the black ink is drawn in the window colour.
  assert.equal(paletteOf({ ...p, primary: '#0b03f6' }, true), 'custom');
  // Ink picked in the window colour is still the hand-picked set, though it doesn't show.
  const hidden = { ...customColours, primary: '#0b03f6' };
  assert.equal(paletteOf({ ...p, ...hidden, customColours: hidden }, false), 'custom');
  assert.equal(paletteOf({ ...p, secondary: '#123456' }, false), null);
});

test("Custom can hold a preset's colours", () => {
  const p = { ...DEFAULTS, customColours: paletteColours(PALETTES[0], context(false)) };
  assert.ok(hasPalette(p, 'custom', false) && hasPalette(p, 'classic', false));
  assert.equal(paletteOf(p, false), 'classic'); // unless Custom was picked, the preset shows
  assert.ok(!hasPalette({ ...DEFAULTS, customColours: null }, 'custom', false));
});

test('a layer in the colour behind it is pointed out', () => {
  const p = { ...DEFAULTS, primary: '#0b03f6' };
  assert.equal(colourHint(p, false), 'hidden-ink');
  assert.equal(colourHint({ ...DEFAULTS, secondary: BLACK, primary: '#0b03f6' }, true), 'hidden-echo');
  assert.equal(colourHint(DEFAULTS, false), null);
});
