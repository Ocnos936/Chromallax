import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, EXPORT_DEFAULTS } from '../src/config.js';
import { KEPT_KEYS, keptSettings, readExportOptions, readSettings } from '../src/settings.js';

// Stored the way app.js stores them: as JSON.
const roundTrip = (params) => readSettings(JSON.parse(JSON.stringify(keptSettings(params))));

test('kept settings come back unchanged', () => {
  const params = {
    ...DEFAULTS,
    ratio: 'free',
    freeWidth: 1500,
    freeHeight: 500,
    depth: 1.4,
    panels: [
      { shape: 'circle', x: 0.3, y: 0.4, w: 0.4, h: 0.4, angle: 0 },
      { shape: 'rect', x: 0.7, y: 0.6, size: 0.5, angle: 30 },
    ],
    showPanels: false,
    primaryOffsetX: -0.1,
    secondary: '#ff0000',
    customColours: { secondary: '#ff0000', primary: '#000000', panel: '#0000ff' },
    motionPath: 'orbit',
    motionViews: 3,
    motionPivot: 0.2,
  };
  const read = roundTrip(params);
  assert.deepEqual(Object.keys(read).sort(), [...KEPT_KEYS].sort());
  for (const key of KEPT_KEYS) assert.deepEqual(read[key], params[key], key);
});

test('placement, line extraction and the gesture target are not kept', () => {
  for (const key of ['artX', 'artY', 'artScale', 'threshold', 'softness', 'invert', 'dragTarget', 'background']) {
    assert.ok(!KEPT_KEYS.includes(key), key);
  }
});

test('unusable values are dropped and numbers are clamped', () => {
  const read = readSettings({
    version: 1,
    settings: {
      ratio: '5:4',
      orientation: 'sideways',
      size: 1234,
      depth: 9,
      centerX: 'middle',
      lineWidth: Number.NaN,
      equalWidth: 'yes',
      primary: 'black',
      secondary: '#F0087D',
      freeWidth: 50,
      customColours: { secondary: '#ff0000', primary: 'black', panel: '#0000ff' },
    },
  });
  assert.deepEqual(read, { depth: 2, secondary: '#F0087D', freeWidth: 100 });
});

test('a window list with one bad window is dropped whole', () => {
  const good = { shape: 'rect', x: 0.5, y: 0.5, size: 0.8, angle: 0 };
  const bad = [
    { ...good, shape: 'star' },
    { shape: 'rect', x: 0.5, y: 0.5, w: 0.4 },
    { shape: 'circle', x: 0.5, y: 0.5, size: -1 },
    null,
  ];
  for (const panel of bad) assert.equal(readSettings({ version: 1, settings: { panels: [good, panel] } }).panels, undefined);
  assert.deepEqual(readSettings({ version: 1, settings: { panels: [] } }).panels, []);
});

test('anything but version 1 settings reads as nothing', () => {
  for (const stored of [null, 42, 'x', {}, { version: 2, settings: { depth: 1.5 } }, { version: 1, settings: null }]) {
    assert.deepEqual(readSettings(stored), {});
  }
});

test('export options come back checked, with defaults for anything unusable', () => {
  assert.deepEqual(readExportOptions({ format: 'gif', quality: 0.8, gifScale: 0.5 }), { format: 'gif', quality: 0.8, gifScale: 0.5 });
  assert.deepEqual(readExportOptions({ format: 'bmp', quality: 3, gifScale: 0.3 }), { ...EXPORT_DEFAULTS, quality: 1 });
  for (const stored of [null, 'png', 7]) assert.deepEqual(readExportOptions(stored), EXPORT_DEFAULTS);
});
