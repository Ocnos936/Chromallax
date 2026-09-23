// UI wiring. The canvas (ratio + orientation + long edge, or a free size) is
// independent of the source image: the extracted line art is placed on it and
// can be moved and zoomed. Pixel work (thresholding, the stroke distance field,
// line width) is debounced; every other change recomposites cached layer
// canvases per frame.
import { DEFAULTS, HEAVY_SHARE_HINT, MAX_SOURCE_EDGE, MIN_SOURCE_EDGE, RANGES, REFERENCE_KEYS } from './config.js';
import {
  RATIOS, canvasSize, computeLayout, fillScale, movePanels, panelAt, panelBox, panelHandles, ratioLabel,
  referencePanel, resizePanel, rotatePanel, scaleLayer, scalePanels,
} from './geometry.js';
import { lineMask, offsetCoverage, strokeField, strokeOffsets } from './preprocess.js';
import { maskToCanvas, tint, drawComposite } from './render.js';

const $ = (selector) => document.querySelector(selector);
const output = $('#output');
const outputCtx = output.getContext('2d');
const crosshair = $('#crosshair');
const stageEl = $('#stage');
const statusEl = $('#status');
const fileInput = $('#file');

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// Canvas size in px for the current settings.
function canvasDims(p = params) {
  if (p.ratio !== 'free') return canvasSize(p.ratio, p.orientation, p.size);
  return { width: Math.round(clamp(p.freeWidth, RANGES.freeWidth)), height: Math.round(clamp(p.freeHeight, RANGES.freeHeight)) };
}

// '16:9' → '9:16' in portrait; free sizes read as '1500×500'.
function canvasLabel() {
  if (params.ratio !== 'free') return ratioLabel(params.ratio, params.orientation);
  const { width, height } = canvasDims();
  return `${width}×${height}`;
}

const params = { ...DEFAULTS };
const state = {
  name: 'demo',
  notice: '', // error that should stay visible while the current image is shown
  image: null, // ImageBitmap | HTMLImageElement | HTMLCanvasElement, untouched source
  source: null, // source scaled so its long edge is within [MIN_SOURCE_EDGE, MAX_SOURCE_EDGE]
  field: null, // strokeField() of the line mask, plus the mask's polarity info
  masks: { primary: null, secondary: null }, // alpha-only canvases at the current line width
  layers: { primary: document.createElement('canvas'), secondary: document.createElement('canvas') },
  ready: false, // layers exist for the current image
  linePx: 0, // magenta stroke width in output px, for the line-width readout
  selectedPanel: null, // index of the window being edited while the Windows layer is picked; null = all
};

// No windows, or hidden ones: nothing is filled or clipped, and the Windows layer has nothing to act on.
const windowOff = () => !params.showPanels || !params.panels.length;
const inertTarget = () => params.dragTarget === 'panel' && windowOff();
// The window being edited on the picture, or null.
const activePanel = () =>
  params.dragTarget === 'panel' && !windowOff() && state.selectedPanel != null ? params.panels[state.selectedPanel] : null;

// Pipeline stages, earliest first. A parameter invalidates its stage and all later
// ones; parameters not listed (canvas, placement, windows, the window colour) only
// recomposite. Depth reshapes the black strokes only while equalWidth is on.
const STAGES = ['source', 'mask', 'weight', 'tint', 'composite'];
const [SOURCE, MASK, WEIGHT, TINT] = [0, 1, 2, 3];
const STAGE_OF = {
  threshold: 'mask',
  softness: 'mask',
  invert: 'mask',
  lineWidth: 'weight',
  equalWidth: 'weight',
  primary: 'tint',
  secondary: 'tint',
};
const stageOf = (key) => (key === 'depth' && params.equalWidth ? 'weight' : STAGE_OF[key] ?? 'composite');
let dirtyFrom = STAGES.length;
let timer = 0;
let frame = 0;

function invalidate(stage) {
  const i = STAGES.indexOf(stage);
  dirtyFrom = Math.min(dirtyFrom, i);
  if (i < TINT) {
    clearTimeout(timer); // pixel work waits until a slider pauses
    timer = setTimeout(runPixels, 60);
  }
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(runFrame); // meanwhile, recomposite what we have
}

// Lots of heavy ink flattens the depth against a window; without one it reads as tone.
const heavyInk = () => state.field.heavyShare > HEAVY_SHARE_HINT && !windowOff();

function runPixels() {
  if (!state.image) return;
  const from = dirtyFrom;
  dirtyFrom = STAGES.length;
  try {
    if (from <= SOURCE) prepareSource();
    if (from <= MASK) computeField();
    // A new image with lots of heavy ink may need a different threshold: surface those controls.
    if (from <= SOURCE && heavyInk()) $('#extraction').open = true;
    if (from <= WEIGHT) buildMasks();
    if (from <= TINT) tintLayers();
    state.ready = true;
    composite();
  } catch (err) {
    showStatus(`Rendering failed: ${err.message}`, true);
    throw err;
  }
}

function runFrame() {
  if (!state.ready) return;
  if (dirtyFrom === TINT) tintLayers();
  if (dirtyFrom >= TINT) dirtyFrom = STAGES.length; // else pixel work is pending and redraws again
  composite();
}

function prepareSource() {
  const { width: w0, height: h0 } = state.image;
  const k = clamp(1, [MIN_SOURCE_EDGE, MAX_SOURCE_EDGE].map((edge) => edge / Math.max(w0, h0)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * k));
  canvas.height = Math.max(1, Math.round(h0 * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  state.source = canvas;
}

function computeField() {
  const { width, height } = state.source;
  const pixels = state.source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const { mask, lightLines, usedAlpha } = lineMask(pixels, params);
  state.field = { ...strokeField(mask, width, height), width, height, lightLines, usedAlpha };
}

function buildMasks() {
  const { sdf, width, height, strokeWidth } = state.field;
  const offsets = strokeOffsets({ ...params, strokeWidth });
  state.masks.secondary = maskToCanvas(offsetCoverage(sdf, offsets.secondary), width, height);
  state.masks.primary =
    offsets.primary === offsets.secondary
      ? state.masks.secondary
      : maskToCanvas(offsetCoverage(sdf, offsets.primary), width, height);
}

function tintLayers() {
  tint(state.masks.primary, params.primary, state.layers.primary);
  tint(state.masks.secondary, params.secondary, state.layers.secondary);
}

function composite() {
  const { width, height } = canvasDims();
  if (output.width !== width || output.height !== height) {
    output.width = width;
    output.height = height;
  }
  const { width: artWidth, height: artHeight } = state.source;
  const layout = computeLayout({ ...params, width, height, artWidth, artHeight });
  drawComposite(outputCtx, {
    width,
    height,
    layout,
    primary: state.layers.primary,
    secondary: state.layers.secondary,
    style: params,
  });
  crosshair.style.left = `${params.centerX * 100}%`;
  crosshair.style.top = `${params.centerY * 100}%`;
  syncSelection();
  const zoom = layout.art.w / artWidth; // output px per source px
  const f = state.field;
  state.linePx = f.strokeWidth * params.lineWidth * zoom;
  showValue('lineWidth');
  if (state.notice) {
    showStatus(state.notice, true);
    return;
  }
  const lines = f.usedAlpha ? 'from transparency' : f.lightLines ? 'light on dark' : 'dark on light';
  const heavy = heavyInk()
    ? ` · ${Math.round(f.heavyShare * 100)}% of the ink is fills or heavy strokes; thin, even lines give more depth`
    : '';
  const soft = zoom > 1.25 ? ` · art enlarged ×${zoom.toFixed(1)}, lines may look soft` : '';
  showStatus(`${state.name} · ${width} × ${height} px · lines ${lines}${heavy}${soft}`);
}

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

// ---- Controls -------------------------------------------------------------

const FORMAT = {
  artScale: (v) => `×${v.toFixed(2)}`,
  artX: (v) => v.toFixed(3),
  artY: (v) => v.toFixed(3),
  depth: (v) => `×${v.toFixed(3)}`,
  centerX: (v) => v.toFixed(3),
  centerY: (v) => v.toFixed(3),
  lineWidth: (v) => `×${v.toFixed(2)}${state.linePx ? ` · ${state.linePx.toFixed(1)} px` : ''}`,
};

// Layers that can be dragged on their own, with their offset parameters.
// The windows ('panel') are not listed: each has its own position.
const LAYERS = {
  secondary: { name: 'the echo', x: 'secondaryOffsetX', y: 'secondaryOffsetY' },
  primary: { name: 'the ink', x: 'primaryOffsetX', y: 'primaryOffsetY' },
};
const gestureHint = $('#gesture-hint');
const frameEl = $('#frame');
const windowColour = $('.layer input[data-param="panel"]');
const controls = [...document.querySelectorAll('[data-param]')];

for (const [key, [min, max]] of Object.entries(RANGES)) {
  for (const el of document.querySelectorAll(`input[type="range"][data-param="${key}"]`)) {
    el.min = String(min);
    el.max = String(max);
  }
}

function showValue(key) {
  for (const readout of document.querySelectorAll(`output[data-for="${key}"]`)) {
    readout.textContent = (FORMAT[key] ?? String)(params[key]);
  }
}

function syncControls() {
  for (const el of controls) {
    const key = el.dataset.param;
    if (el.type === 'radio') el.checked = el.value === params[key];
    else if (el.type === 'checkbox') el.checked = params[key];
    else el.value = String(params[key]);
  }
  // Every readout, including values set only by gestures (depth).
  for (const key of new Set([...document.querySelectorAll('output[data-for]')].map((o) => o.dataset.for))) showValue(key);
  for (const button of document.querySelectorAll('.layer .reset')) {
    const layer = LAYERS[button.dataset.layer];
    button.hidden = layer
      ? !params[layer.x] && !params[layer.y]
      : params.artX === 0.5 && params.artY === 0.5 && params.artScale === 1;
  }
  windowColour.disabled = windowOff();
  syncCanvasControls();
  syncPanelControls();
  document.documentElement.style.setProperty('--c-primary', params.primary);
  document.documentElement.style.setProperty('--c-secondary', params.secondary);
  gestureHint.textContent = `${gestureText()} · drag the crosshair or double-click to set the focus point`;
  const shown = params.dragTarget !== 'panel' ? params.dragTarget : state.selectedPanel == null ? 'panels' : 'panel';
  for (const props of document.querySelectorAll('.props')) props.hidden = props.dataset.target !== shown;
}

function gestureText() {
  if (params.dragTarget !== 'panel') {
    const target = LAYERS[params.dragTarget]?.name ?? 'the figure';
    const around = LAYERS[params.dragTarget] ? 'the focus point' : 'the pointer';
    return `Drag to move ${target}, scroll to resize it around ${around}`;
  }
  if (!params.showPanels) return 'The windows are hidden';
  if (!params.panels.length) return 'No windows: add one with + in the Windows row';
  if (state.selectedPanel == null) {
    return 'Click a window to select it · drag to move all windows, scroll to resize them around the focus point';
  }
  return 'Drag to move the window, its handles to resize it (Shift keeps the ratio) or turn it (Shift: 15° steps) · Delete removes it';
}

// Show the focus-point crosshair for a moment when it moves without the pointer on the picture.
let flashTimer = 0;
function flashCenter() {
  frameEl.classList.add('show-center');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => frameEl.classList.remove('show-center'), 1200);
}

// Toolbar: ratio labels and icons follow the orientation, the size menu lists
// the resulting pixel sizes, and a free ratio swaps the menu for width/height fields.
const ICON_BOX = [16, 12]; // max icon width, height in px
function syncCanvasControls() {
  const free = params.ratio === 'free';
  for (const span of document.querySelectorAll('[data-ratio]')) {
    const [a, b] = RATIOS[span.dataset.ratio];
    const [w, h] = params.orientation === 'portrait' ? [b, a] : [a, b];
    const k = Math.min(ICON_BOX[0] / w, ICON_BOX[1] / h);
    span.textContent = ratioLabel(span.dataset.ratio, params.orientation);
    span.style.setProperty('--w', `${(w * k).toFixed(1)}px`);
    span.style.setProperty('--h', `${(h * k).toFixed(1)}px`);
  }
  $('#orientation').classList.toggle('inactive', free || params.ratio === '1:1');
  const sizeSelect = $('#size');
  sizeSelect.hidden = free;
  $('#free-size').hidden = !free;
  if (!free) {
    for (const option of sizeSelect.options) {
      const { width, height } = canvasSize(params.ratio, params.orientation, Number(option.value));
      option.textContent = `${width} × ${height}`;
    }
  }
}

function readControl(el) {
  if (el.type === 'checkbox') return el.checked;
  return ['range', 'number'].includes(el.type) || el.dataset.type === 'number' ? Number(el.value) : el.value;
}

let lastDims = canvasDims(); // canvas size before the latest change, to seed a free size


for (const el of controls) {
  // Typed numbers apply when committed, so the canvas doesn't jump through partial values.
  const onCommit = ['radio', 'checkbox', 'number'].includes(el.type);
  el.addEventListener(onCommit ? 'change' : 'input', () => {
    if (el.type === 'radio' && !el.checked) return;
    const key = el.dataset.param;
    params[key] = readControl(el);
    if (key === 'ratio' && params.ratio === 'free') {
      params.freeWidth = lastDims.width; // start from the current canvas
      params.freeHeight = lastDims.height;
    }
    if (key === 'freeWidth' || key === 'freeHeight') params[key] = Math.round(clamp(params[key] || 0, RANGES[key]));
    if (key === 'centerX' || key === 'centerY') flashCenter();
    if (key === 'dragTarget') state.selectedPanel = null; // the Windows row picks all of them
    lastDims = canvasDims();
    syncControls();
    invalidate(stageOf(key));
  });
}

// Ink in the colour behind it vanishes: the window's colour, or the background's when
// there is no window. When the windows come or go, hand it the other one of the two, so
// the reference's black ink on blue becomes blue ink on black, and back.
function keepInkVisible() {
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const [behind, other] = windowOff() ? [params.background, params.panel] : [params.panel, params.background];
  if (!same(params.primary, behind) || same(other, behind)) return false;
  params.primary = other;
  return true;
}

for (const button of document.querySelectorAll('.layer .reset')) {
  button.addEventListener('click', (e) => {
    e.preventDefault(); // don't also select the row
    const layer = LAYERS[button.dataset.layer];
    if (!layer) {
      setArt({ artX: 0.5, artY: 0.5, artScale: 1 }); // the figure: whole art, centred
      return;
    }
    params[layer.x] = 0;
    params[layer.y] = 0;
    syncControls();
    invalidate('composite');
  });
}

function setArt({ artX, artY, artScale }) {
  params.artX = clamp(artX, RANGES.artX);
  params.artY = clamp(artY, RANGES.artY);
  params.artScale = clamp(artScale, RANGES.artScale);
  syncControls();
  invalidate('composite');
}

$('#fill').addEventListener('click', () => {
  if (!state.source) return;
  const { width, height } = canvasDims();
  setArt({ artX: 0.5, artY: 0.5, artScale: fillScale(width, height, state.source.width, state.source.height) });
});

$('#reset').addEventListener('click', () => {
  for (const key of REFERENCE_KEYS) params[key] = DEFAULTS[key];
  state.selectedPanel = null;
  syncControls();
  flashCenter();
  invalidate('weight');
});

// ---- Windows ------------------------------------------------------------------
// The Windows row adds windows, shows or hides them all, and picks all of them as the
// target; a row per window below it (or a click on the window) picks that one. Windows
// are replaced, never changed in place, so a copy of `params` keeps its windows.

const panelList = $('#panel-list');
const selectionEl = $('#selection');
const showPanelsButton = $('#show-panels');
const angleInput = $('#angle');
let panelRows = [];
let panelRowsKey = '';

// Change the windows. When that makes them appear or disappear, the ink may need the
// other colour to stay visible.
function setPanels(update, select = state.selectedPanel) {
  const wasOff = windowOff();
  Object.assign(params, update);
  state.selectedPanel = select != null && select < params.panels.length ? select : null;
  const inkChanged = windowOff() !== wasOff && keepInkVisible();
  syncControls();
  invalidate(inkChanged ? 'tint' : 'composite');
}

const replacePanel = (i, panel) => params.panels.map((p, j) => (j === i ? panel : p));

// Change the selected window.
function editPanel(change) {
  const i = state.selectedPanel;
  if (i != null) setPanels({ panels: replacePanel(i, { ...params.panels[i], ...change }) });
}

function selectPanel(i) {
  params.dragTarget = 'panel';
  state.selectedPanel = i;
  syncControls();
}

const removePanel = (i) => setPanels({ panels: params.panels.filter((_, j) => j !== i) }, null);

// A new window goes in the middle of the canvas, stepped aside while another one is
// centred there. (Not on the focus point: a drag there would move the crosshair.)
function addPanel(shape) {
  const { width, height } = canvasDims();
  const u = Math.min(width, height);
  const [w, h] = shape === 'circle' ? [0.4, 0.4] : height > width ? [0.36, 0.48] : [0.48, 0.36];
  let [x, y] = [0.5, 0.5];
  while (params.panels.some((p) => Math.abs(p.x - x) * width < 1 && Math.abs(p.y - y) * height < 1)) {
    x += (0.04 * u) / width;
    y += (0.04 * u) / height;
  }
  params.dragTarget = 'panel';
  setPanels({ panels: [...params.panels, { shape, x, y, w, h, angle: 0 }], showPanels: true }, params.panels.length);
}

for (const button of document.querySelectorAll('[data-add]')) {
  button.addEventListener('click', (e) => {
    e.preventDefault(); // don't also select the row
    addPanel(button.dataset.add);
  });
}

showPanelsButton.addEventListener('click', (e) => {
  e.preventDefault();
  setPanels({ showPanels: !params.showPanels });
});

for (const el of document.querySelectorAll('input[name="panelShape"]')) {
  el.addEventListener('change', () => el.checked && editPanel({ shape: el.value }));
}
angleInput.addEventListener('input', () => editPanel({ angle: Number(angleInput.value) }));

$('#match-depth').addEventListener('click', () => {
  const i = state.selectedPanel;
  if (i != null) setPanels({ panels: replacePanel(i, referencePanel(params, 1 / params.depth, params.panels[i].shape)) });
});
$('#remove-panel').addEventListener('click', () => state.selectedPanel != null && removePanel(state.selectedPanel));

// One row per window. Rows are rebuilt when windows come, go or change shape; their
// icons follow every change.
function buildPanelRows() {
  panelRows = params.panels.map((_, i) => {
    const row = document.createElement('label');
    row.className = 'layer child';
    row.innerHTML = `<input type="radio" name="dragTarget" value="panel" />
      <span class="shape-icon" aria-hidden="true"></span>
      <span class="name">Window ${i + 1}</span>
      <button type="button" class="remove" aria-label="Delete window ${i + 1}" title="Delete">×</button>`;
    const radio = row.querySelector('input');
    radio.addEventListener('change', () => selectPanel(i));
    radio.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') removePanel(i);
    });
    row.querySelector('.remove').addEventListener('click', (e) => {
      e.preventDefault();
      removePanel(i);
    });
    return row;
  });
  panelList.replaceChildren(...panelRows);
}

const ROW_ICON = 14; // px, the largest side of a window's icon
function syncPanelControls() {
  const key = params.panels.map((p) => p.shape).join();
  if (key !== panelRowsKey) {
    buildPanelRows();
    panelRowsKey = key;
  }
  const { width, height } = canvasDims();
  panelRows.forEach((row, i) => {
    const box = panelBox(params.panels[i], width, height);
    const round = box.shape === 'circle';
    const k = ROW_ICON / Math.max(box.w, box.h);
    const icon = row.querySelector('.shape-icon');
    icon.style.setProperty('--w', `${Math.max(3, box.w * k).toFixed(1)}px`);
    icon.style.setProperty('--h', `${Math.max(3, box.h * k).toFixed(1)}px`);
    icon.style.setProperty('--r', round ? '50%' : '1.5px');
    icon.style.setProperty('--a', `${box.angle}deg`);
    if (params.dragTarget === 'panel' && state.selectedPanel === i) row.querySelector('input').checked = true;
  });
  panelList.classList.toggle('off', !params.showPanels);
  showPanelsButton.setAttribute('aria-pressed', String(params.showPanels));
  const verb = params.showPanels ? 'Hide' : 'Show';
  showPanelsButton.title = `${verb} the windows${params.showPanels ? ': the ink then sits straight on the background' : ''}`;
  showPanelsButton.setAttribute('aria-label', `${verb} the windows`);
  $('#panels-note').textContent = !params.showPanels
    ? 'The windows are hidden, so the ink sits straight on the background. The eye in the Windows row shows them again.'
    : !params.panels.length
      ? 'No windows: the ink sits straight on the background. Add one with + in the Windows row.'
      : 'Select a window, on the picture or in the list, to reshape or turn it.';
  const panel = state.selectedPanel == null ? null : params.panels[state.selectedPanel];
  if (panel) {
    const box = panelBox(panel, width, height);
    const size = box.shape === 'circle' ? `⌀ ${Math.round(box.w)}` : `${Math.round(box.w)} × ${Math.round(box.h)}`;
    $('#panel-size').textContent = `${size} px`;
    for (const el of document.querySelectorAll('input[name="panelShape"]')) el.checked = el.value === panel.shape;
    angleInput.value = String(panel.angle || 0);
    $('#angle-out').textContent = `${Math.round(panel.angle || 0)}°`;
    $('#angle-field').hidden = panel.shape === 'circle';
  }
  syncSelection();
}

// The selected window's outline and handles over the picture.
function syncSelection() {
  const panel = activePanel();
  selectionEl.hidden = !panel;
  if (!panel) return;
  const { width, height } = canvasDims();
  const box = panelBox(panel, width, height);
  Object.assign(selectionEl.style, {
    left: `${((box.x - box.w / 2) / width) * 100}%`,
    top: `${((box.y - box.h / 2) / height) * 100}%`,
    width: `${(box.w / width) * 100}%`,
    height: `${(box.h / height) * 100}%`,
    transform: `rotate(${box.angle}deg)`,
  });
  selectionEl.classList.toggle('circle', box.shape === 'circle');
}

// ---- Canvas gestures ---------------------------------------------------------
// Drag the crosshair: move the focus point. Anything else acts on the target picked
// in the Layers legend (the artwork, one layer on its own, or the windows): drag or
// arrow keys (Shift: 10 px) move it; wheel, trackpad pinch, two-finger pinch or +/-
// resize it. Double-click puts the focus point under the pointer.
// With the Windows layer picked, a press on a window selects that window, whose
// handles then resize it (Shift keeps the ratio, Alt/Option keeps the centre) or turn
// it (Shift: 15° steps). A press on empty canvas drops the selection; once none is
// selected, dragging there moves all windows.

const HANDLE_RADIUS = 20; // CSS px around the crosshair centre
const GRIP = { mouse: 8, touch: 20 }; // CSS px around a window handle
const ROTATE_LIFT = 24; // CSS px from a window's top edge to its rotation knob
const OFFSET_RANGE = [-2, 2]; // layer offsets, as canvas fractions
const pointers = new Map(); // pointerId -> {x, y} in client px
let gesture = null; // {kind: 'center' | 'pan' | 'pinch' | 'resize' | 'rotate' | 'none', ...}

selectionEl.style.setProperty('--lift', `${ROTATE_LIFT}px`);

function toCanvas(x, y) {
  const r = output.getBoundingClientRect();
  return { x: (x - r.left) / r.width, y: (y - r.top) / r.height };
}

function toPixels(x, y) {
  const { width, height } = canvasDims();
  const p = toCanvas(x, y);
  return { x: p.x * width, y: p.y * height };
}

const cssPerPixel = () => output.getBoundingClientRect().width / canvasDims().width;

// Apply a parameter update from a gesture, clamped, and redraw.
function applyUpdate(update) {
  Object.assign(params, update);
  params.artX = clamp(params.artX, RANGES.artX);
  params.artY = clamp(params.artY, RANGES.artY);
  for (const { x, y } of Object.values(LAYERS)) {
    params[x] = clamp(params[x], OFFSET_RANGE);
    params[y] = clamp(params[y], OFFSET_RANGE);
  }
  syncControls();
  invalidate('depth' in update ? stageOf('depth') : 'composite');
}

// Move the target by dx, dy canvas fractions from where it was in `from`, a copy of params.
function moveBy(from, dx, dy) {
  if (inertTarget()) return;
  const layer = LAYERS[params.dragTarget];
  if (params.dragTarget === 'panel') {
    applyUpdate({ panels: movePanels(from.panels, state.selectedPanel, dx, dy, RANGES.panelX, RANGES.panelY) });
  } else if (layer) {
    applyUpdate({ [layer.x]: from[layer.x] + dx, [layer.y]: from[layer.y] + dy });
  } else {
    applyUpdate({ artX: from.artX + dx, artY: from.artY + dy });
  }
}

// The figure zooms around the pointer; a single layer resizes around the focus point,
// so echo and ink stay aligned there (the crosshair shows where). All windows together
// also resize around the focus point, and a selected window around its own centre.
function resizeTarget(factor, pointer, from = params) {
  if (inertTarget()) return;
  const target = params.dragTarget;
  const focus = { x: from.centerX, y: from.centerY };
  if (target === 'panel') {
    const one = state.selectedPanel;
    if (one == null) flashCenter();
    applyUpdate({ panels: scalePanels(from.panels, one, factor, one == null ? focus : null, canvasDims(), RANGES.panelSide) });
    return;
  }
  if (target !== 'art') flashCenter();
  applyUpdate(scaleLayer(from, target, factor, target === 'art' ? pointer : focus, RANGES));
}

function onHandle(e) {
  const r = output.getBoundingClientRect();
  const dx = e.clientX - (r.left + params.centerX * r.width);
  const dy = e.clientY - (r.top + params.centerY * r.height);
  return Math.hypot(dx, dy) <= HANDLE_RADIUS;
}

// The selected window's handle under the pointer: [hx, hy], 'rotate', or null.
function panelHandleAt(e) {
  const panel = activePanel();
  if (!panel) return null;
  const { width, height } = canvasDims();
  const scale = cssPerPixel();
  const p = toPixels(e.clientX, e.clientY);
  const grip = (e.pointerType === 'touch' ? GRIP.touch : GRIP.mouse) / scale;
  let best = null;
  for (const { handle, x, y } of panelHandles(panelBox(panel, width, height), ROTATE_LIFT / scale)) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= grip && (!best || d < best.d)) best = { handle, d };
  }
  return best?.handle ?? null;
}

const panelUnder = (e) => panelAt(params.panels, toPixels(e.clientX, e.clientY), canvasDims());

// Resize cursors by the direction a handle points on screen.
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
function resizeCursor([hx, hy], panel) {
  const { width, height } = canvasDims();
  const deg = (Math.atan2(hy, hx) * 180) / Math.PI + panelBox(panel, width, height).angle;
  return RESIZE_CURSORS[((Math.round(deg / 45) % 4) + 4) % 4];
}

function setCenter(x, y) {
  params.centerX = clamp(x, [0, 1]);
  params.centerY = clamp(y, [0, 1]);
  syncControls();
  invalidate('composite');
}

const startPan = ({ x, y }) => ({ kind: 'pan', x, y, from: { ...params } });

function startPinch() {
  const [a, b] = pointers.values();
  return {
    kind: 'pinch',
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    start: { ...params },
  };
}

// What a single press starts: a window handle, the crosshair, picking a window, or a pan.
function startGesture(e) {
  const handle = panelHandleAt(e);
  if (handle) {
    const from = params.panels[state.selectedPanel];
    const start = { x: e.clientX, y: e.clientY, at: toPixels(e.clientX, e.clientY) };
    return { kind: handle === 'rotate' ? 'rotate' : 'resize', handle, from, ...start };
  }
  if (onHandle(e)) return { kind: 'center' };
  if (params.dragTarget === 'panel' && !windowOff()) {
    const hit = panelUnder(e);
    if (hit >= 0) selectPanel(hit);
    else if (state.selectedPanel != null) {
      selectPanel(null); // a press beside the selected window only deselects it
      return { kind: 'none' };
    }
  }
  return startPan({ x: e.clientX, y: e.clientY });
}

function updateGesture(e) {
  const r = output.getBoundingClientRect();
  if (gesture.kind === 'center') {
    const p = toCanvas(e.clientX, e.clientY);
    setCenter(p.x, p.y);
  } else if (gesture.kind === 'pan') {
    moveBy(gesture.from, (e.clientX - gesture.x) / r.width, (e.clientY - gesture.y) / r.height);
  } else if (gesture.kind === 'pinch') {
    // Resize from the state at pinch start, then follow the midpoint.
    const [a, b] = pointers.values();
    const factor = Math.hypot(b.x - a.x, b.y - a.y) / gesture.distance;
    Object.assign(params, gesture.start);
    resizeTarget(factor, toCanvas(gesture.mid.x, gesture.mid.y), gesture.start);
    moveBy({ ...params }, ((a.x + b.x) / 2 - gesture.mid.x) / r.width, ((a.y + b.y) / 2 - gesture.mid.y) / r.height);
  } else if (gesture.kind === 'resize') {
    const scale = cssPerPixel();
    const delta = { x: (e.clientX - gesture.x) / scale, y: (e.clientY - gesture.y) / scale };
    const options = { keepRatio: e.shiftKey, fromCenter: e.altKey };
    const panel = resizePanel(gesture.from, gesture.handle, delta, canvasDims(), RANGES.panelSide, options);
    applyUpdate({ panels: replacePanel(state.selectedPanel, panel) });
  } else if (gesture.kind === 'rotate') {
    const panel = rotatePanel(gesture.from, gesture.at, toPixels(e.clientX, e.clientY), canvasDims(), e.shiftKey ? 15 : 0);
    applyUpdate({ panels: replacePanel(state.selectedPanel, panel) });
  }
}

function cursorFor(e) {
  if (gesture?.kind === 'resize') return resizeCursor(gesture.handle, gesture.from);
  if (gesture?.kind === 'rotate') return 'grabbing';
  if (gesture?.kind === 'center') return 'move';
  if (gesture?.kind === 'none' || inertTarget()) return 'default';
  if (gesture) return 'grabbing';
  const handle = panelHandleAt(e);
  if (handle) return handle === 'rotate' ? 'grab' : resizeCursor(handle, activePanel());
  if (onHandle(e)) return 'move';
  const beside = params.dragTarget === 'panel' && state.selectedPanel != null && panelUnder(e) < 0;
  return beside ? 'default' : 'grab';
}

const updateCursor = (e) => (frameEl.style.cursor = cursorFor(e));

// Pointer events go to the frame, so that handles reaching past the picture work too.
frameEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); // or a press on a handle, which can't take focus, would move it to the page
  output.focus({ preventScroll: true }); // for the keys
  frameEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) gesture = startPinch();
  else if (pointers.size === 1) gesture = startGesture(e);
  if (gesture?.kind === 'center') updateGesture(e);
  updateCursor(e);
});
frameEl.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) updateGesture(e);
  }
  updateCursor(e);
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) gesture = null;
  else if (gesture?.kind === 'pinch') gesture = startPan(pointers.values().next().value);
  updateCursor(e);
}
frameEl.addEventListener('pointerup', endPointer);
frameEl.addEventListener('pointercancel', endPointer);

frameEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines -> px
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.001)); // ~10 % per wheel notch; ctrlKey = trackpad pinch
    resizeTarget(factor, toCanvas(e.clientX, e.clientY));
  },
  { passive: false },
);

// The frame holds the pointer capture, so clicks land on it rather than on the canvas.
frameEl.addEventListener('dblclick', (e) => {
  const p = toCanvas(e.clientX, e.clientY);
  if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) setCenter(p.x, p.y);
});

output.addEventListener('keydown', (e) => {
  if (activePanel() && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    removePanel(state.selectedPanel);
    return;
  }
  if (e.key === 'Escape' && state.selectedPanel != null) {
    selectPanel(null);
    return;
  }
  const zoom = { '+': 1.05, '=': 1.05, '-': 1 / 1.05 }[e.key];
  if (zoom) {
    e.preventDefault();
    resizeTarget(zoom, { x: params.centerX, y: params.centerY });
    return;
  }
  const px = e.shiftKey ? 10 : 1;
  const move = { ArrowLeft: [-px, 0], ArrowRight: [px, 0], ArrowUp: [0, -px], ArrowDown: [0, px] }[e.key];
  if (!move) return;
  e.preventDefault();
  moveBy({ ...params }, move[0] / output.width, move[1] / output.height);
});

// ---- Loading and export -----------------------------------------------------

// New art starts centred and fitted, or covering the canvas with `fill` (the demo).
function setImage(image, name, { notice = '', fill = false } = {}) {
  state.image = image;
  state.name = name;
  state.notice = notice;
  state.ready = false; // don't recomposite the previous image's layers meanwhile
  const { width, height } = canvasDims();
  const artScale = fill ? clamp(fillScale(width, height, image.width, image.height), RANGES.artScale) : 1;
  Object.assign(params, { artX: 0.5, artY: 0.5, artScale });
  syncControls();
  invalidate('source');
}

async function decode(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    // e.g. SVG, which createImageBitmap can't decode from a Blob. The object URL
    // is kept alive because an SVG image is re-rasterised on every draw.
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    if (!img.width || !img.height) throw new Error('image has no intrinsic size');
    return img;
  }
}

async function loadBlob(blob, name) {
  try {
    setImage(await decode(blob), name);
  } catch {
    showStatus(`Could not read ${name} as an image.`, true);
  }
}

const DEMO_URL = 'assets/demo.webp';
const nameOf = (url) => decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[^.]+$/, '') || 'image';

// Load an image by URL; anything but the demo falls back to the demo, with a notice.
async function loadUrl(url, name = nameOf(url), notice = '') {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setImage(await decode(await res.blob()), name, { notice, fill: url === DEMO_URL });
  } catch (err) {
    if (url === DEMO_URL) showStatus(`Could not load the demo drawing (${err.message}).`, true);
    else loadUrl(DEMO_URL, 'demo', `Could not load ${url} (${err.message}). Showing the demo instead.`);
  }
}
const loadDemo = () => loadUrl(DEMO_URL, 'demo');

const imageFile = (files) => [...files].find((f) => f.type.startsWith('image/'));
const baseName = (file) => file.name.replace(/\.[^.]+$/, '');

$('#open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = imageFile(fileInput.files);
  if (file) loadBlob(file, baseName(file));
  fileInput.value = '';
});
$('#demo').addEventListener('click', loadDemo);

stageEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  stageEl.classList.add('dropping');
});
stageEl.addEventListener('dragleave', () => stageEl.classList.remove('dropping'));
stageEl.addEventListener('drop', (e) => {
  e.preventDefault();
  stageEl.classList.remove('dropping');
  const file = imageFile(e.dataTransfer.files);
  if (file) loadBlob(file, baseName(file));
});
window.addEventListener('paste', (e) => {
  const file = imageFile(e.clipboardData.files);
  if (file) loadBlob(file, 'pasted');
});

$('#export').addEventListener('click', () => {
  output.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.name}-${canvasLabel().replace(':', 'x').replace('√', 'sqrt')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }, 'image/png');
});

// ---- Start ------------------------------------------------------------------

syncControls();
const src = new URLSearchParams(location.search).get('src');
if (src) loadUrl(src);
else loadDemo();
