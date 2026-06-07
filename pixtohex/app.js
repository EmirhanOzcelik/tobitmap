(function () {
'use strict';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const S = {
  W: 16, H: 16,
  zoom: 1,
  panX: 0, panY: 0,
  tool: 'pencil',
  fgColor: 1,
  bgColor: 0,
  brushSize: 1,
  brushShape: 'square',
  showGrid: true,
  isPainting: false,
  isPanning: false,
  panStart: null,
  panOrigin: null,
  toolState: {},
  lastCell: null,
  history: [],
  histIdx: -1,
  clipboard: null,
  clipW: 0,
  clipH: 0,
  stored: [],
  previewBg: 'black',
  hexFmt: 'c-array',
  readMode: 'page-h-msb',
  outFlipH: false,
  outFlipV: false,
  outInvert: false,
  outRotation: '0',
  oledBg: 'black',
  layers: [],
  activeLayerIdx: 0,
  selection: null,
  isDraggingSelection: false,
};

const TOOL_NAMES = {
  pencil: 'Kalem',
  fill: 'Doldur',
  line: 'Çizgi',
  'rect-outline': 'Çerçeve',
  'rect-fill': 'Dolu Kare',
  ellipse: 'Elips',
  eyedropper: 'Damlalık',
  select: 'Seçim',
};

const mainCanvas = $('main-canvas');
const overlayCanvas = $('overlay-canvas');
const selectCanvas = $('select-canvas');
const mctx = mainCanvas.getContext('2d');
const octx = overlayCanvas.getContext('2d');
const sctx = selectCanvas.getContext('2d');
const previewCanvas = $('preview-canvas');
const pctx = previewCanvas.getContext('2d');
const canvasContainer = $('canvas-container');
const canvasArea = $('canvas-area');

function makeGrid(w, h, fill) {
  fill = fill === undefined ? 0 : fill;
  const g = [];
  for (let r = 0; r < h; r++) g.push(new Uint8Array(w).fill(fill));
  return g;
}
function cloneGrid(g) { return g.map(r => new Uint8Array(r)); }

function createLayer(name, w, h) {
  return {
    name: name,
    grid: makeGrid(w, h),
    visible: true,
  };
}

function getActiveLayer() {
  return S.layers[S.activeLayerIdx];
}

function initCanvas(w, h, keepContent) {
  const oldLayers = S.layers;
  S.W = w;
  S.H = h;
  if (!keepContent || !oldLayers.length) {
    S.layers = [createLayer('Katman 1', w, h)];
    S.activeLayerIdx = 0;
  } else {
    S.layers = oldLayers.map(function (l) {
      const ng = makeGrid(w, h);
      const mr = Math.min(h, l.grid.length);
      const mc = Math.min(w, l.grid[0] ? l.grid[0].length : 0);
      for (let r = 0; r < mr; r++) for (let c = 0; c < mc; c++) ng[r][c] = l.grid[r][c];
      return { name: l.name, grid: ng, visible: l.visible };
    });
    if (S.activeLayerIdx >= S.layers.length) S.activeLayerIdx = S.layers.length - 1;
  }
  mainCanvas.width = w;
  mainCanvas.height = h;
  overlayCanvas.width = w;
  overlayCanvas.height = h;
  selectCanvas.width = w;
  selectCanvas.height = h;
  syncCanvasSizeUI();
  recordHistory();
  fitToScreen();
  redraw();
  renderLayerList();
}

function syncCanvasSizeUI() {
  $('canvas-w').value = S.W;
  $('canvas-h').value = S.H;
  $('size-label').textContent = S.W + '\u00d7' + S.H;
  $('status-size').textContent = S.W + '\u00d7' + S.H;
  updatePreviewSize();
}

function applyTransform() {
  const cw = S.W * S.zoom;
  const ch = S.H * S.zoom;
  canvasContainer.style.width = cw + 'px';
  canvasContainer.style.height = ch + 'px';
  canvasContainer.style.transform = 'translate(' + S.panX + 'px,' + S.panY + 'px)';
  mainCanvas.style.width = cw + 'px';
  mainCanvas.style.height = ch + 'px';
  overlayCanvas.style.width = cw + 'px';
  overlayCanvas.style.height = ch + 'px';
  selectCanvas.style.width = cw + 'px';
  selectCanvas.style.height = ch + 'px';
  const pct = Math.round(S.zoom * 100);
  $('zoom-chip').textContent = pct + '%';
  $('status-zoom').textContent = pct + '%';
  drawGridOverlay();
}

function fitToScreen() {
  const area = canvasArea.getBoundingClientRect();
  const pad = 48;
  const sx = (area.width - pad) / S.W;
  const sy = (area.height - pad) / S.H;
  S.zoom = Math.min(sx, sy, 32);
  S.zoom = Math.max(0.5, S.zoom);
  centerCanvas();
}

function centerCanvas() {
  const area = canvasArea.getBoundingClientRect();
  S.panX = (area.width - S.W * S.zoom) / 2;
  S.panY = (area.height - S.H * S.zoom) / 2;
  applyTransform();
}

function zoomAt(mx, my, factor) {
  const newZoom = Math.max(0.5, Math.min(64, S.zoom * factor));
  const wx = (mx - S.panX) / S.zoom;
  const wy = (my - S.panY) / S.zoom;
  S.zoom = newZoom;
  S.panX = mx - wx * S.zoom;
  S.panY = my - wy * S.zoom;
  applyTransform();
}

function screenToGrid(clientX, clientY) {
  const rect = canvasArea.getBoundingClientRect();
  const ax = clientX - rect.left;
  const ay = clientY - rect.top;
  const cx = ax - S.panX;
  const cy = ay - S.panY;
  const col = Math.floor(cx / S.zoom);
  const row = Math.floor(cy / S.zoom);
  return { col: col, row: row, valid: col >= 0 && col < S.W && row >= 0 && row < S.H };
}

function compositeGrid() {
  const comp = makeGrid(S.W, S.H, 0);
  for (let li = S.layers.length - 1; li >= 0; li--) {
    const l = S.layers[li];
    if (!l.visible) continue;
    for (let r = 0; r < S.H; r++) for (let c = 0; c < S.W; c++) {
      if (l.grid[r][c] === 1) comp[r][c] = 1;
    }
  }
  return comp;
}

function redraw() {
  drawCheckerboard();
  drawGridOverlay();
  drawPreview();
  refreshHex();
  updateStatus();
}

function drawCheckerboard() {
  // Ana canvas'a checkerboard arkaplan ve siyah pikselleri ciz
  mctx.clearRect(0, 0, S.W, S.H);
  for (let r = 0; r < S.H; r++) {
    for (let c = 0; c < S.W; c++) {
      const even = (r + c) % 2 === 0;
      mctx.fillStyle = even ? '#ffffff' : '#cccccc';
      mctx.fillRect(c, r, 1, 1);
    }
  }
  // Siyah pikselleri ciz (tum katmanlar)
  for (let li = S.layers.length - 1; li >= 0; li--) {
    const l = S.layers[li];
    if (!l.visible) continue;
    mctx.fillStyle = '#000000';
    for (let r = 0; r < S.H; r++) {
      for (let c = 0; c < S.W; c++) {
        if (l.grid[r][c] === 1) mctx.fillRect(c, r, 1, 1);
      }
    }
  }
}

function drawGridOverlay() {
  octx.clearRect(0, 0, S.W, S.H);

  // Tuval siniri
  if (S.activeLayerIdx >= 0) {
    octx.strokeStyle = 'rgba(61,232,160,0.7)';
    octx.lineWidth = 2 / S.zoom;
    octx.strokeRect(0, 0, S.W, S.H);
  }

  if (!S.showGrid || S.zoom < 3) return;

  // Ince grid cizgileri
  octx.lineWidth = 1 / S.zoom;
  octx.strokeStyle = 'rgba(80,80,80,0.45)';
  octx.beginPath();
  for (let c = 1; c < S.W; c++) { octx.moveTo(c, 0); octx.lineTo(c, S.H); }
  for (let r = 1; r < S.H; r++) { octx.moveTo(0, r); octx.lineTo(S.W, r); }
  octx.stroke();

  // Her 8 pikselde kalin grid
  octx.strokeStyle = 'rgba(40,40,40,0.5)';
  octx.lineWidth = 1.5 / S.zoom;
  octx.beginPath();
  for (let c = 8; c < S.W; c += 8) { octx.moveTo(c, 0); octx.lineTo(c, S.H); }
  for (let r = 8; r < S.H; r += 8) { octx.moveTo(0, r); octx.lineTo(S.W, r); }
  octx.stroke();
}

function drawPreview() {
  const pw = previewCanvas.width;
  const ph = previewCanvas.height;
  if (S.previewBg === 'white') {
    pctx.fillStyle = '#ffffff';
  } else {
    pctx.fillStyle = '#000000';
  }
  pctx.fillRect(0, 0, pw, ph);
  const sx = pw / S.W;
  const sy = ph / S.H;
  for (let r = 0; r < S.H; r++) for (let c = 0; c < S.W; c++) {
    const active = S.layers[S.activeLayerIdx];
    if (active && active.grid[r][c] === 1) {
      pctx.fillStyle = S.previewBg === 'white' ? '#000000' : '#ffffff';
      pctx.fillRect(c * sx, r * sy, sx + 0.5, sy + 0.5);
    }
  }
}

function updatePreviewSize() {
  const maxW = 240;
  const maxH = 120;
  const scale = Math.min(maxW / S.W, maxH / S.H, 8);
  const pw = Math.max(1, Math.round(S.W * scale));
  const ph = Math.max(1, Math.round(S.H * scale));
  previewCanvas.width = pw;
  previewCanvas.height = ph;
  previewCanvas.style.width = pw + 'px';
  previewCanvas.style.height = ph + 'px';
}

function updateStatus() {
  const bv = getOutputBytes();
  $('status-bytes').textContent = bv ? bv.length + ' byte' : '\u2014';
}

function recordHistory() {
  if (S.histIdx < S.history.length - 1) S.history = S.history.slice(0, S.histIdx + 1);
  S.history.push({
    layers: S.layers.map(l => ({ name: l.name, grid: cloneGrid(l.grid), visible: l.visible })),
    activeLayerIdx: S.activeLayerIdx,
    W: S.W, H: S.H,
  });
  S.histIdx = S.history.length - 1;
  if (S.history.length > 150) {
    S.history = S.history.slice(-150);
    S.histIdx = S.history.length - 1;
  }
  updateHistUI();
}

function updateHistUI() {
  $('undo-btn').disabled = S.histIdx <= 0;
  $('redo-btn').disabled = S.histIdx >= S.history.length - 1;
  const list = $('history-list');
  const start = Math.max(0, S.histIdx - 8);
  let html = '';
  for (let i = Math.min(S.histIdx + 1, S.history.length) - 1; i >= start; i--) {
    const h = S.history[i];
    const cur = i === S.histIdx;
    html += '<div style="font-size:9.5px;font-family:var(--font-mono);color:' +
      (cur ? 'var(--accent)' : 'var(--text3)') +
      ';padding:2px 0">' + (cur ? '\u25b8 ' : '  ') + '#' + (i + 1) + ' ' + h.W + '\u00d7' + h.H +
      ' (' + h.layers.length + ' kat.)</div>';
  }
  list.innerHTML = html;
}

function undo() {
  if (S.histIdx <= 0) return;
  S.histIdx--;
  applyHistoryState(S.history[S.histIdx]);
}

function redo() {
  if (S.histIdx >= S.history.length - 1) return;
  S.histIdx++;
  applyHistoryState(S.history[S.histIdx]);
}

function applyHistoryState(h) {
  S.layers = h.layers.map(l => ({ name: l.name, grid: cloneGrid(l.grid), visible: l.visible }));
  S.activeLayerIdx = h.activeLayerIdx;
  if (h.W !== S.W || h.H !== S.H) {
    S.W = h.W; S.H = h.H;
    mainCanvas.width = S.W; mainCanvas.height = S.H;
    overlayCanvas.width = S.W; overlayCanvas.height = S.H;
    selectCanvas.width = S.W; selectCanvas.height = S.H;
    syncCanvasSizeUI();
    applyTransform();
  }
  redraw();
  updateHistUI();
  renderLayerList();
}

function brushCells(r, c) {
  const cells = [];
  const s = S.brushSize;
  const half = Math.floor(s / 2);
  for (let dr = -half; dr < s - half; dr++) {
    for (let dc = -half; dc < s - half; dc++) {
      if (S.brushShape === 'circle' && Math.sqrt(dr * dr + dc * dc) > s / 2) continue;
      if (S.brushShape === 'h-line' && dr !== 0) continue;
      if (S.brushShape === 'v-line' && dc !== 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < S.H && nc >= 0 && nc < S.W) cells.push([nr, nc]);
    }
  }
  return cells;
}

function paintCells(r, c, color) {
  const layer = getActiveLayer();
  if (!layer) return false;
  let changed = false;
  for (const cell of brushCells(r, c)) {
    if (layer.grid[cell[0]][cell[1]] !== color) {
      layer.grid[cell[0]][cell[1]] = color;
      changed = true;
    }
  }
  return changed;
}

function bresenham(r0, c0, r1, c1) {
  const pts = [];
  let dr = Math.abs(r1 - r0);
  let dc = Math.abs(c1 - c0);
  let sr = r0 < r1 ? 1 : -1;
  let sc = c0 < c1 ? 1 : -1;
  let err = dr - dc;
  while (true) {
    pts.push([r0, c0]);
    if (r0 === r1 && c0 === c1) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r0 += sr; }
    if (e2 < dr) { err += dr; c0 += sc; }
  }
  return pts;
}

function floodFill(r, c, target, fill) {
  const layer = getActiveLayer();
  if (!layer) return;
  if (target === fill) return;
  const stack = [[r, c]];
  const vis = new Uint8Array(S.W * S.H);
  while (stack.length) {
    const pt = stack.pop();
    const cr = pt[0];
    const cc = pt[1];
    if (cr < 0 || cr >= S.H || cc < 0 || cc >= S.W) continue;
    const idx = cr * S.W + cc;
    if (vis[idx] || layer.grid[cr][cc] !== target) continue;
    vis[idx] = 1;
    layer.grid[cr][cc] = fill;
    stack.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
  }
}

function drawLine(r0, c0, r1, c1, color) {
  const layer = getActiveLayer();
  if (!layer) return;
  for (const pt of bresenham(r0, c0, r1, c1)) {
    for (const cell of brushCells(pt[0], pt[1])) {
      layer.grid[cell[0]][cell[1]] = color;
    }
  }
}

function drawRect(r0, c0, r1, c1, color, filled) {
  const layer = getActiveLayer();
  if (!layer) return;
  const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
  const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
    if (r >= 0 && r < S.H && c >= 0 && c < S.W) {
      if (filled || r === minR || r === maxR || c === minC || c === maxC) {
        layer.grid[r][c] = color;
      }
    }
  }
}

function drawEllipse(r0, c0, r1, c1, color) {
  const layer = getActiveLayer();
  if (!layer) return;
  const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
  const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
  const cy = (minR + maxR) / 2;
  const cx = (minC + maxC) / 2;
  const a = Math.max((maxC - minC) / 2, 0.5);
  const b = Math.max((maxR - minR) / 2, 0.5);
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
    if (r < 0 || r >= S.H || c < 0 || c >= S.W) continue;
    const v = Math.pow((c - cx) / a, 2) + Math.pow((r - cy) / b, 2);
    if (v >= 0.55 && v <= 1.5) layer.grid[r][c] = color;
  }
}

function drawOverlayShape(r0, c0, r1, c1) {
  octx.clearRect(0, 0, S.W, S.H);
  if (S.showGrid && S.zoom >= 3) drawGridOverlay();
  const lw = Math.max(0.3, 1 / S.zoom);
  octx.strokeStyle = 'rgba(61,232,160,0.85)';
  octx.fillStyle = 'rgba(61,232,160,0.08)';
  octx.lineWidth = lw;
  if (S.tool === 'line') {
    octx.beginPath();
    octx.moveTo(c0 + 0.5, r0 + 0.5);
    octx.lineTo(c1 + 0.5, r1 + 0.5);
    octx.stroke();
  } else if (S.tool === 'rect-outline' || S.tool === 'rect-fill') {
    const mr = Math.min(r0, r1), mc = Math.min(c0, c1);
    const h = Math.abs(r1 - r0) + 1, w = Math.abs(c1 - c0) + 1;
    if (S.tool === 'rect-fill') octx.fillRect(mc, mr, w, h);
    octx.strokeRect(mc, mr, w, h);
  } else if (S.tool === 'ellipse') {
    const cy = (r0 + r1) / 2 + 0.5, cx = (c0 + c1) / 2 + 0.5;
    const rx = Math.abs(c1 - c0) / 2 + 0.5, ry = Math.abs(r1 - r0) / 2 + 0.5;
    octx.beginPath();
    octx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    octx.stroke();
  } else if (S.tool === 'select') {
    sctx.clearRect(0, 0, S.W, S.H);
    const mr = Math.min(r0, r1), mc = Math.min(c0, c1);
    const sh = Math.abs(r1 - r0) + 1, sw = Math.abs(c1 - c0) + 1;
    sctx.strokeStyle = 'rgba(255,77,109,0.9)';
    sctx.lineWidth = 1 / S.zoom;
    sctx.setLineDash([2 / S.zoom, 2 / S.zoom]);
    sctx.strokeRect(mc, mr, sw, sh);
    sctx.setLineDash([]);
  }
}

let paintColor = 1;
let spaceDown = false;

canvasArea.addEventListener('mousedown', onMouseDown);
canvasArea.addEventListener('mousemove', onMouseMove);
canvasArea.addEventListener('mouseup', onMouseUp);
canvasArea.addEventListener('mouseleave', function () {
  $('coord-display').textContent = '\u2014';
  $('status-pos').textContent = '\u2014';
});
canvasArea.addEventListener('contextmenu', function (e) { e.preventDefault(); });
canvasArea.addEventListener('wheel', onWheel, { passive: false });

canvasArea.addEventListener('dragover', function (e) {
  e.preventDefault();
  canvasArea.classList.add('drag-over');
});
canvasArea.addEventListener('dragleave', function () {
  canvasArea.classList.remove('drag-over');
});
canvasArea.addEventListener('drop', function (e) {
  e.preventDefault();
  canvasArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});

function onMouseDown(e) {
  e.preventDefault();
  if (spaceDown || e.button === 1) {
    S.isPanning = true;
    S.panStart = [e.clientX, e.clientY];
    S.panOrigin = [S.panX, S.panY];
    canvasArea.style.cursor = 'grabbing';
    return;
  }
  const pos = screenToGrid(e.clientX, e.clientY);
  if (!pos.valid) return;

  paintColor = e.button === 2 ? S.bgColor : S.fgColor;

  if (S.tool === 'eyedropper') {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = layer.grid[pos.row][pos.col];
    if (e.button === 2) S.bgColor = v;
    else S.fgColor = v;
    updateColorUI();
    return;
  }

  if (S.tool === 'select') {
    S.toolState = { start: [pos.row, pos.col] };
    S.selection = null;
    sctx.clearRect(0, 0, S.W, S.H);
    return;
  }

  if (['line', 'rect-outline', 'rect-fill', 'ellipse'].includes(S.tool)) {
    S.toolState = { start: [pos.row, pos.col] };
    return;
  }

  if (S.tool === 'fill') {
    const layer = getActiveLayer();
    if (!layer) return;
    floodFill(pos.row, pos.col, layer.grid[pos.row][pos.col], paintColor);
    recordHistory();
    redraw();
    return;
  }

  S.isPainting = true;
  S.lastCell = [pos.row, pos.col];
  paintCells(pos.row, pos.col, paintColor);
  redraw();
}

function onMouseMove(e) {
  const pos = screenToGrid(e.clientX, e.clientY);
  const posText = pos.valid ? pos.col + ', ' + pos.row : '\u2014';
  $('coord-display').textContent = posText;
  $('status-pos').textContent = pos.valid ? '(' + pos.col + ',' + pos.row + ')' : '\u2014';

  if (S.isPanning && S.panStart) {
    S.panX = S.panOrigin[0] + (e.clientX - S.panStart[0]);
    S.panY = S.panOrigin[1] + (e.clientY - S.panStart[1]);
    applyTransform();
    return;
  }
  if (!pos.valid) return;

  if ('start' in S.toolState) {
    const st = S.toolState.start;
    drawOverlayShape(st[0], st[1], pos.row, pos.col);
    return;
  }

  if (!S.isPainting) return;

  if (S.tool === 'pencil') {
    const last = S.lastCell;
    if (last && (last[0] !== pos.row || last[1] !== pos.col)) {
      for (const pt of bresenham(last[0], last[1], pos.row, pos.col)) {
        paintCells(pt[0], pt[1], paintColor);
      }
    } else {
      paintCells(pos.row, pos.col, paintColor);
    }
    S.lastCell = [pos.row, pos.col];
    redraw();
  }
}

function onMouseUp(e) {
  canvasArea.style.cursor = spaceDown ? 'grab' : 'crosshair';
  if (S.isPanning) { S.isPanning = false; S.panStart = null; return; }

  const pos = screenToGrid(e.clientX, e.clientY);

  if ('start' in S.toolState) {
    const st = S.toolState.start;
    S.toolState = {};
    const r1 = pos.valid ? pos.row : st[0];
    const c1 = pos.valid ? pos.col : st[1];
    octx.clearRect(0, 0, S.W, S.H);
    if (S.showGrid && S.zoom >= 3) drawGridOverlay();

    if (S.tool === 'select') {
      S.selection = {
        r0: Math.min(st[0], r1), c0: Math.min(st[1], c1),
        r1: Math.max(st[0], r1), c1: Math.max(st[1], c1),
      };
      return;
    }

    if (S.tool === 'line') drawLine(st[0], st[1], r1, c1, paintColor);
    else if (S.tool === 'rect-outline') drawRect(st[0], st[1], r1, c1, paintColor, false);
    else if (S.tool === 'rect-fill') drawRect(st[0], st[1], r1, c1, paintColor, true);
    else if (S.tool === 'ellipse') drawEllipse(st[0], st[1], r1, c1, paintColor);
    recordHistory();
    redraw();
    return;
  }

  if (S.isPainting) {
    S.isPainting = false;
    S.lastCell = null;
    recordHistory();
  }
}

function onWheel(e) {
  e.preventDefault();
  const rect = canvasArea.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  zoomAt(mx, my, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}

document.addEventListener('keydown', function (e) {
  if (e.code === 'Space' && !e.target.matches('input,textarea,select')) {
    spaceDown = true;
    canvasArea.style.cursor = 'grab';
    e.preventDefault();
    return;
  }
  const tag = e.target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); return; }
    if (e.key === 'c') { e.preventDefault(); doCopy(); return; }
    if (e.key === 'x') { e.preventDefault(); doCut(); return; }
    if (e.key === 'v') { e.preventDefault(); doPaste(); return; }
    if (e.key === 's') { e.preventDefault(); savePng(); return; }
    if (e.key === 'n') { e.preventDefault(); handleAction('new'); return; }
    return;
  }

  if (e.shiftKey) {
    if (e.key === 'N' || e.key === 'n') { handleAction('layer-add'); return; }
    if (e.key === 'R' || e.key === 'r') { setTool('rect-fill'); return; }
    if (e.key === 'ArrowUp') { handleAction('layer-up'); return; }
    if (e.key === 'ArrowDown') { handleAction('layer-down'); return; }
    return;
  }

  const toolMap = { p: 'pencil', b: 'fill', l: 'line', r: 'rect-outline', o: 'ellipse', k: 'eyedropper', s: 'select' };
  if (toolMap[e.key]) { setTool(toolMap[e.key]); return; }
  if (e.key === 'x' || e.key === 'X') { swapColors(); return; }
  if (e.key === 'g' || e.key === 'G') { S.showGrid = !S.showGrid; redraw(); return; }
  if (e.key === 'f' || e.key === 'F') { fitToScreen(); return; }
  if (e.key === '0') { S.zoom = 1; centerCanvas(); return; }
  if (e.key === '+' || e.key === '=') { zoomAt(canvasArea.clientWidth / 2, canvasArea.clientHeight / 2, 1.25); return; }
  if (e.key === '-') { zoomAt(canvasArea.clientWidth / 2, canvasArea.clientHeight / 2, 1 / 1.25); return; }
  if (e.key === 'i' || e.key === 'I') { transformGrid('invert'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (confirm('Tuvali temizle?')) {
      const l = getActiveLayer();
      if (l) { l.grid = makeGrid(S.W, S.H); recordHistory(); redraw(); showStatus('Temizlendi \u2713'); }
    }
    return;
  }
  if (e.key === 'Escape') {
    S.toolState = {};
    S.selection = null;
    sctx.clearRect(0, 0, S.W, S.H);
    octx.clearRect(0, 0, S.W, S.H);
    if (S.showGrid && S.zoom >= 3) drawGridOverlay();
  }
});

document.addEventListener('keyup', function (e) {
  if (e.code === 'Space') { spaceDown = false; canvasArea.style.cursor = 'crosshair'; }
});

function setTool(name) {
  S.tool = name;
  S.toolState = {};
  sctx.clearRect(0, 0, S.W, S.H);
  octx.clearRect(0, 0, S.W, S.H);
  if (S.showGrid && S.zoom >= 3) drawGridOverlay();
  $$('.tool-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === name); });
  $('status-tool').textContent = TOOL_NAMES[name] || name;
}

function updateColorUI() {
  $('swatch-fg').style.background = S.fgColor === 1 ? '#000000' : '#ffffff';
  $('swatch-fg').style.borderColor = S.fgColor === 1 ? 'rgba(61,232,160,0.5)' : 'rgba(61,232,160,0.5)';
  $('swatch-bg').style.background = S.bgColor === 1 ? '#000000' : '#ffffff';
}

function swapColors() {
  const tmp = S.fgColor;
  S.fgColor = S.bgColor;
  S.bgColor = tmp;
  updateColorUI();
}

$$('.tool-btn').forEach(function (b) {
  b.addEventListener('click', function () { setTool(b.dataset.tool); });
});

$('swatch-fg').addEventListener('click', function () {
  S.fgColor = S.fgColor === 1 ? 0 : 1;
  updateColorUI();
});
$('swatch-bg').addEventListener('click', function () {
  S.bgColor = S.bgColor === 1 ? 0 : 1;
  updateColorUI();
});
$('swap-colors-btn').addEventListener('click', swapColors);

$$('.color-select-btn').forEach(function (b) {
  b.addEventListener('click', function () {
    S.fgColor = b.dataset.color === 'black' ? 1 : 0;
    updateColorUI();
  });
});

$('brush-size').addEventListener('input', function (e) {
  S.brushSize = parseInt(e.target.value);
  $('brush-size-val').textContent = S.brushSize;
});

$$('.shape-btn').forEach(function (b) {
  b.addEventListener('click', function () {
    S.brushShape = b.dataset.shape;
    $$('.shape-btn').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
  });
});

$$('.preset-btn').forEach(function (b) {
  b.addEventListener('click', function () {
    $('canvas-w').value = b.dataset.w;
    $('canvas-h').value = b.dataset.h;
  });
});

$('apply-size').addEventListener('click', function () {
  const w = parseInt($('canvas-w').value);
  const h = parseInt($('canvas-h').value);
  if (isNaN(w) || isNaN(h) || w < 1 || w > 512 || h < 1 || h > 512) {
    showStatus('Boyut 1-512 arası!');
    return;
  }
  initCanvas(w, h, $('keep-content').checked);
  showStatus('Tuval: ' + w + '\u00d7' + h + ' \u2713');
});

$('zoom-in-btn').addEventListener('click', function () {
  zoomAt(canvasArea.clientWidth / 2, canvasArea.clientHeight / 2, 1.25);
});
$('zoom-out-btn').addEventListener('click', function () {
  zoomAt(canvasArea.clientWidth / 2, canvasArea.clientHeight / 2, 1 / 1.25);
});
$('zoom-fit-btn').addEventListener('click', fitToScreen);
$('undo-btn').addEventListener('click', undo);
$('redo-btn').addEventListener('click', redo);

$$('[name="prev-bg"]').forEach(function (r) {
  r.addEventListener('change', function (e) { S.previewBg = e.target.value; drawPreview(); });
});

function transformGrid(action) {
  const layer = getActiveLayer();
  if (!layer) return;
  const g = layer.grid;
  const w = S.W;
  const h = S.H;
  if (action === 'flip-h') { for (let r = 0; r < h; r++) g[r].reverse(); }
  else if (action === 'flip-v') { g.reverse(); }
  else if (action === 'invert') { for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) g[r][c] = 1 - g[r][c]; }
  else if (action === 'rotate-cw') {
    const ng = makeGrid(h, w);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) ng[c][h - 1 - r] = g[r][c];
    layer.grid = ng; S.W = h; S.H = w;
    mainCanvas.width = S.W; mainCanvas.height = S.H;
    overlayCanvas.width = S.W; overlayCanvas.height = S.H;
    selectCanvas.width = S.W; selectCanvas.height = S.H;
    syncCanvasSizeUI(); applyTransform();
  } else if (action === 'rotate-ccw') {
    const ng = makeGrid(h, w);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) ng[w - 1 - c][r] = g[r][c];
    layer.grid = ng; S.W = h; S.H = w;
    mainCanvas.width = S.W; mainCanvas.height = S.H;
    overlayCanvas.width = S.W; overlayCanvas.height = S.H;
    selectCanvas.width = S.W; selectCanvas.height = S.H;
    syncCanvasSizeUI(); applyTransform();
  } else if (action === 'rotate-180') {
    const ng = makeGrid(w, h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) ng[h - 1 - r][w - 1 - c] = g[r][c];
    layer.grid = ng;
  } else if (action === 'shift-up') { g.shift(); g.push(makeGrid(w, 1)[0]); }
  else if (action === 'shift-down') { g.pop(); g.unshift(makeGrid(w, 1)[0]); }
  else if (action === 'shift-left') { for (let r = 0; r < h; r++) { g[r].copyWithin(0, 1); g[r][w - 1] = 0; } }
  else if (action === 'shift-right') { for (let r = 0; r < h; r++) { g[r].copyWithin(1, 0); g[r][0] = 0; } }
  recordHistory();
  redraw();
}

$$('.tr-btn').forEach(function (b) {
  b.addEventListener('click', function () { transformGrid(b.dataset.action); });
});

function doCopy() {
  const layer = getActiveLayer();
  if (!layer) return;
  if (S.selection) {
    const sel = S.selection;
    const sh = sel.r1 - sel.r0 + 1;
    const sw = sel.c1 - sel.c0 + 1;
    S.clipboard = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row = new Uint8Array(sw);
      for (let c = sel.c0; c <= sel.c1; c++) row[c - sel.c0] = layer.grid[r][c];
      S.clipboard.push(row);
    }
    S.clipW = sw;
    S.clipH = sh;
  } else {
    S.clipboard = cloneGrid(layer.grid).map(function (r) { return Array.from(r); });
    S.clipW = S.W;
    S.clipH = S.H;
  }
  showStatus('Kopyaland\u0131 \u2713');
}

function doCut() {
  const layer = getActiveLayer();
  if (!layer) return;
  doCopy();
  if (S.selection) {
    const sel = S.selection;
    for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) layer.grid[r][c] = 0;
  } else {
    layer.grid = makeGrid(S.W, S.H);
  }
  recordHistory();
  redraw();
  showStatus('Kesildi \u2713');
}

function doPaste() {
  if (!S.clipboard) { showStatus('Pano bo\u015f!'); return; }
  const layer = getActiveLayer();
  if (!layer) return;
  for (let dr = 0; dr < S.clipH; dr++) {
    for (let dc = 0; dc < S.clipW; dc++) {
      if (dr < S.H && dc < S.W) layer.grid[dr][dc] = S.clipboard[dr][dc];
    }
  }
  recordHistory();
  redraw();
  showStatus('Yap\u0131\u015ft\u0131r\u0131ld\u0131 \u2713');
}

function renderLayerList() {
  const list = $('layer-list');
  list.innerHTML = '';
  for (let i = 0; i < S.layers.length; i++) {
    const l = S.layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (i === S.activeLayerIdx ? ' active' : '');
    item.dataset.idx = i;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'layer-thumb';
    const tc = document.createElement('canvas');
    tc.width = S.W;
    tc.height = S.H;
    tc.style.width = '100%';
    tc.style.height = '100%';
    const ttx = tc.getContext('2d');
    ttx.fillStyle = '#fff';
    ttx.fillRect(0, 0, S.W, S.H);
    const timg = ttx.createImageData(S.W, S.H);
    for (let r = 0; r < S.H; r++) for (let c = 0; c < S.W; c++) {
      if (l.grid[r][c] === 1) {
        const ii = (r * S.W + c) * 4;
        timg.data[ii] = 0; timg.data[ii+1] = 0; timg.data[ii+2] = 0; timg.data[ii+3] = 255;
      }
    }
    ttx.putImageData(timg, 0, 0);
    thumbWrap.appendChild(tc);

    const nameEl = document.createElement('div');
    nameEl.className = 'layer-name';
    nameEl.textContent = l.name;
    nameEl.title = l.name;

    const visBtn = document.createElement('button');
    visBtn.className = 'layer-vis-btn' + (l.visible ? '' : ' hidden-layer');
    visBtn.textContent = l.visible ? '\u25cf' : '\u25cb';
    visBtn.title = l.visible ? 'Gizle' : 'G\u00f6ster';
    visBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      S.layers[i].visible = !S.layers[i].visible;
      renderLayerList();
      redraw();
    });

    item.appendChild(thumbWrap);
    item.appendChild(nameEl);
    item.appendChild(visBtn);

    item.addEventListener('click', function () {
      S.activeLayerIdx = parseInt(item.dataset.idx);
      renderLayerList();
      redraw();
      $('status-layer').textContent = S.layers[S.activeLayerIdx].name;
    });

    list.insertBefore(item, list.firstChild);
  }
  $('status-layer').textContent = S.layers[S.activeLayerIdx] ? S.layers[S.activeLayerIdx].name : '\u2014';
}

function handleLayerAction(action) {
  switch (action) {
    case 'layer-add': {
      const name = 'Katman ' + (S.layers.length + 1);
      S.layers.splice(S.activeLayerIdx + 1, 0, createLayer(name, S.W, S.H));
      S.activeLayerIdx = S.activeLayerIdx + 1;
      recordHistory();
      renderLayerList();
      redraw();
      showStatus(name + ' eklendi \u2713');
      break;
    }
    case 'layer-dup': {
      const src = S.layers[S.activeLayerIdx];
      if (!src) return;
      const dup = { name: src.name + ' kopya', grid: cloneGrid(src.grid), visible: src.visible };
      S.layers.splice(S.activeLayerIdx + 1, 0, dup);
      S.activeLayerIdx = S.activeLayerIdx + 1;
      recordHistory();
      renderLayerList();
      redraw();
      showStatus('\u00c7o\u011falt\u0131ld\u0131 \u2713');
      break;
    }
    case 'layer-del': {
      if (S.layers.length <= 1) { showStatus('Son katman silinemez!'); return; }
      S.layers.splice(S.activeLayerIdx, 1);
      S.activeLayerIdx = Math.min(S.activeLayerIdx, S.layers.length - 1);
      recordHistory();
      renderLayerList();
      redraw();
      showStatus('Katman silindi \u2713');
      break;
    }
    case 'layer-merge-down': {
      if (S.activeLayerIdx === 0) { showStatus('En alttaki katman!'); return; }
      const upper = S.layers[S.activeLayerIdx];
      const lower = S.layers[S.activeLayerIdx - 1];
      for (let r = 0; r < S.H; r++) for (let c = 0; c < S.W; c++) {
        if (upper.grid[r][c] === 1) lower.grid[r][c] = 1;
      }
      S.layers.splice(S.activeLayerIdx, 1);
      S.activeLayerIdx--;
      recordHistory();
      renderLayerList();
      redraw();
      showStatus('Birle\u015ftirildi \u2713');
      break;
    }
    case 'layer-merge-all': {
      const merged = makeGrid(S.W, S.H);
      for (let li = S.layers.length - 1; li >= 0; li--) {
        const l = S.layers[li];
        if (!l.visible) continue;
        for (let r = 0; r < S.H; r++) for (let c = 0; c < S.W; c++) {
          if (l.grid[r][c] === 1) merged[r][c] = 1;
        }
      }
      S.layers = [{ name: 'Birle\u015ftirilmi\u015f', grid: merged, visible: true }];
      S.activeLayerIdx = 0;
      recordHistory();
      renderLayerList();
      redraw();
      showStatus('T\u00fcm\u00fc birle\u015ftirildi \u2713');
      break;
    }
    case 'layer-up': {
      if (S.activeLayerIdx >= S.layers.length - 1) return;
      const tmp = S.layers[S.activeLayerIdx];
      S.layers[S.activeLayerIdx] = S.layers[S.activeLayerIdx + 1];
      S.layers[S.activeLayerIdx + 1] = tmp;
      S.activeLayerIdx++;
      recordHistory();
      renderLayerList();
      redraw();
      break;
    }
    case 'layer-down': {
      if (S.activeLayerIdx <= 0) return;
      const tmp = S.layers[S.activeLayerIdx];
      S.layers[S.activeLayerIdx] = S.layers[S.activeLayerIdx - 1];
      S.layers[S.activeLayerIdx - 1] = tmp;
      S.activeLayerIdx--;
      recordHistory();
      renderLayerList();
      redraw();
      break;
    }
  }
}

function handleAction(action) {
  if (action.startsWith('layer-')) { handleLayerAction(action); return; }
  switch (action) {
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'clear':
      if (confirm('Aktif katmanı temizle?')) {
        const l = getActiveLayer();
        if (l) { l.grid = makeGrid(S.W, S.H); recordHistory(); redraw(); showStatus('Temizlendi \u2713'); }
      }
      break;
    case 'new':
      if (confirm('Yeni tuval? (Mevcut kaybolur)')) initCanvas(16, 16, false);
      break;
    case 'full-reset':
      if (confirm('Her şeyi sıfırla?')) {
        S.stored = [];
        updateStoreUI();
        initCanvas(16, 16, false);
        showStatus('S\u0131f\u0131rland\u0131 \u2713');
      }
      break;
    case 'load-png': $('file-input').click(); break;
    case 'save-png': savePng(); break;
    case 'save-bmp': saveBmp(); break;
    case 'load-hex': openHexLoadDialog(); break;
    case 'copy': doCopy(); break;
    case 'cut': doCut(); break;
    case 'paste': doPaste(); break;
    case 'flip-h': transformGrid('flip-h'); break;
    case 'flip-v': transformGrid('flip-v'); break;
    case 'invert': transformGrid('invert'); break;
    case 'rotate-cw': transformGrid('rotate-cw'); break;
    case 'rotate-ccw': transformGrid('rotate-ccw'); break;
    case 'rotate-180': transformGrid('rotate-180'); break;
    case 'shift-up': transformGrid('shift-up'); break;
    case 'shift-down': transformGrid('shift-down'); break;
    case 'shift-left': transformGrid('shift-left'); break;
    case 'shift-right': transformGrid('shift-right'); break;
    case 'toggle-grid': S.showGrid = !S.showGrid; redraw(); break;
    case 'zoom-fit': fitToScreen(); break;
    case 'zoom-reset': S.zoom = 1; centerCanvas(); break;
    case 'toggle-left-panel': $('left-panel').classList.toggle('hidden'); break;
    case 'toggle-right-panel': $('right-panel').classList.toggle('hidden'); break;
  }
}

$$('[data-action]').forEach(function (el) {
  el.addEventListener('click', function (e) {
    handleAction(el.dataset.action);
    closeAllMenus();
  });
});

function closeAllMenus() { $$('.menu-item.open').forEach(function (m) { m.classList.remove('open'); }); }
$$('.menu-item').forEach(function (item) {
  item.addEventListener('click', function (e) {
    e.stopPropagation();
    const wasOpen = item.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) item.classList.add('open');
  });
});
document.addEventListener('click', closeAllMenus);

$$('.pg-header').forEach(function (header) {
  header.addEventListener('click', function (e) {
    if (e.target.closest('.pg-header-actions') || e.target.closest('.hdr-btn')) return;
    const group = header.closest('.panel-group');
    if (group) group.classList.toggle('collapsed');
  });
});

function loadImageFile(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function () {
    const w = img.width;
    const h = img.height;
    if (w > 512 || h > 512) { showStatus('Maks. 512\u00d7512!'); URL.revokeObjectURL(url); return; }
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    initCanvas(w, h, false);
    const layer = getActiveLayer();
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const idx = (r * w + c) * 4;
      const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      layer.grid[r][c] = (data[idx + 3] < 128 || lum > 127) ? 0 : 1;
    }
    recordHistory();
    redraw();
    showStatus('Resim y\u00fcklendi: ' + w + '\u00d7' + h + ' \u2713');
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

$('file-input').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  loadImageFile(file);
  e.target.value = '';
});

function savePng() {
  const off = document.createElement('canvas');
  off.width = S.W; off.height = S.H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S.W, S.H);
  const comp = compositeGrid();
  const img = ctx.createImageData(S.W, S.H);
  for (let r = 0; r < S.H; r++) for (let c = 0; c < S.W; c++) {
    const i = (r * S.W + c) * 4;
    const v = comp[r][c] === 1 ? 0 : 255;
    img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const a = document.createElement('a');
  a.href = off.toDataURL('image/png');
  a.download = 'bitmap_' + S.W + 'x' + S.H + '.png';
  a.click();
  showStatus('PNG kaydedildi \u2713');
}

function saveBmp() {
  const w = S.W, h = S.H;
  const comp = compositeGrid();
  const rowBytes = Math.ceil(w / 8);
  const rowPad = Math.ceil(rowBytes / 4) * 4;
  const dataSize = rowPad * h;
  const fileSize = 62 + dataSize;
  const buf = new ArrayBuffer(fileSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const le = true;
  dv.setUint16(0, 0x4D42, le); dv.setUint32(2, fileSize, le); dv.setUint32(6, 0, le); dv.setUint32(10, 62, le);
  dv.setUint32(14, 40, le); dv.setInt32(18, w, le); dv.setInt32(22, -h, le);
  dv.setUint16(26, 1, le); dv.setUint16(28, 1, le); dv.setUint32(30, 0, le); dv.setUint32(34, dataSize, le);
  dv.setUint32(38, 2835, le); dv.setUint32(42, 2835, le); dv.setUint32(46, 2, le); dv.setUint32(50, 0, le);
  dv.setUint32(54, 0x000000, le); dv.setUint32(58, 0xFFFFFF, le);
  for (let r = 0; r < h; r++) for (let c = 0; c < rowPad; c++) {
    let b = 0;
    for (let bit = 0; bit < 8; bit++) {
      const pc = c * 8 + bit;
      if (pc < w) b |= (1 - comp[r][pc]) << (7 - bit);
    }
    u8[62 + r * rowPad + c] = b;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'image/bmp' }));
  a.download = 'bitmap_' + w + 'x' + h + '.bmp';
  a.click();
  showStatus('BMP kaydedildi \u2713');
}

$('store-btn').addEventListener('click', function () {
  const bv = getOutputBytes();
  if (!bv || !bv.length) return;
  const code = generators[S.hexFmt](bv, S.W, S.H);
  S.stored.push({ dims: S.W + '\u00d7' + S.H, bytes: bv.length, code: code, fmt: S.hexFmt });
  updateStoreUI();
  const l = getActiveLayer();
  if (l) { l.grid = makeGrid(S.W, S.H); recordHistory(); redraw(); }
  showStatus('Depoland\u0131 (#' + S.stored.length + ') \u2713');
});

$('store-view-btn').addEventListener('click', function () {
  if (!S.stored.length) { showStatus('Henüz kayıt yok!'); return; }
  showStoreModal();
});

function updateStoreUI() {
  $('store-count').textContent = S.stored.length + ' kay\u0131t';
  const list = $('store-list');
  list.innerHTML = '';
  window._stored = S.stored;
  S.stored.slice(-5).forEach(function (item, i) {
    const idx = S.stored.length - Math.min(5, S.stored.length) + i;
    const el = document.createElement('div');
    el.className = 'store-item';
    el.innerHTML = '<span>#' + (idx + 1) + ' ' + item.dims + ' (' + item.bytes + 'B)</span>' +
      '<button onclick="navigator.clipboard.writeText(window._stored[' + idx + '].code).then(()=>{})">\u2398</button>';
    list.appendChild(el);
  });
}

function showStoreModal() {
  const body = $('store-modal-body');
  body.innerHTML = '';
  S.stored.forEach(function (item, i) {
    const el = document.createElement('div');
    el.className = 'store-entry';
    el.innerHTML = '<div class="store-entry-header">' +
      '<span>#' + (i + 1) + '  ' + item.dims + '  |  ' + item.bytes + ' byte  |  ' + item.fmt + '</span>' +
      '<button onclick="navigator.clipboard.writeText(window._stored[' + i + '].code)">\u2398 Kopyala</button>' +
      '</div><pre>' + esc(item.code) + '</pre>';
    body.appendChild(el);
  });
  $('store-modal').classList.remove('hidden');
}

$('store-modal-close').addEventListener('click', function () { $('store-modal').classList.add('hidden'); });
$('store-modal-close2').addEventListener('click', function () { $('store-modal').classList.add('hidden'); });
$('store-copy-all').addEventListener('click', function () {
  const all = S.stored.map(function (it, i) {
    return '// #' + (i + 1) + ': ' + it.dims + ' | ' + it.bytes + ' bytes\n' + it.code;
  }).join('\n\n');
  navigator.clipboard.writeText(all).then(function () { showStatus('T\u00fcm\u00fc kopyaland\u0131 \u2713'); });
});
$('store-clear-all').addEventListener('click', function () {
  if (!confirm('T\u00fcm\u00fcn\u00fc sil?')) return;
  S.stored = [];
  updateStoreUI();
  $('store-modal').classList.add('hidden');
  showStatus('Temizlendi \u2713');
});

function getOutputBytes() {
  const activeLayer = getActiveLayer();
  if (!activeLayer) return null;
  let grid = cloneGrid(activeLayer.grid);
  let w = S.W, h = S.H;
  const rot = S.outRotation;
  if (rot === '90cw') {
    const ng = makeGrid(h, w);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) ng[c][h - 1 - r] = grid[r][c];
    grid = ng; const tmp = w; w = h; h = tmp;
  } else if (rot === '180') {
    const ng = makeGrid(w, h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) ng[h - 1 - r][w - 1 - c] = grid[r][c];
    grid = ng;
  } else if (rot === '90ccw') {
    const ng = makeGrid(h, w);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) ng[w - 1 - c][r] = grid[r][c];
    grid = ng; const tmp = w; w = h; h = tmp;
  }
  if (S.outFlipH) for (let r = 0; r < h; r++) grid[r].reverse();
  if (S.outFlipV) grid.reverse();
  const inv = S.outInvert;
  const oledW = S.oledBg === 'white';
  const final = makeGrid(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    let v = grid[r][c];
    if (inv) v = 1 - v;
    if (oledW) v = 1 - v;
    final[r][c] = v;
  }
  return gridToBytes(final, w, h);
}

function gridToBytes(grid, w, h) {
  const mode = S.readMode;
  const msb = mode.includes('msb');
  const out = [];
  if (mode === 'h-msb' || mode === 'h-lsb') {
    const bpr = Math.ceil(w / 8);
    for (let r = 0; r < h; r++) for (let bi = 0; bi < bpr; bi++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pc = bi * 8 + bit;
        if (pc < w) b |= grid[r][pc] << (msb ? 7 - bit : bit);
      }
      out.push(b);
    }
  } else if (mode === 'v-msb' || mode === 'v-lsb') {
    const bpc = Math.ceil(h / 8);
    for (let c = 0; c < w; c++) for (let bi = 0; bi < bpc; bi++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pr = bi * 8 + bit;
        if (pr < h) b |= grid[pr][c] << (msb ? 7 - bit : bit);
      }
      out.push(b);
    }
  } else if (mode === 'page-h-msb' || mode === 'page-h-lsb') {
    const pages = Math.ceil(h / 8);
    for (let pg = 0; pg < pages; pg++) for (let c = 0; c < w; c++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pr = pg * 8 + bit;
        if (pr < h) b |= grid[pr][c] << (msb ? bit : 7 - bit);
      }
      out.push(b);
    }
  } else if (mode === 'page-v-msb' || mode === 'page-v-lsb') {
    const pages = Math.ceil(w / 8);
    for (let pg = 0; pg < pages; pg++) for (let r = 0; r < h; r++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pc = pg * 8 + bit;
        if (pc < w) b |= grid[r][pc] << (msb ? 7 - bit : bit);
      }
      out.push(b);
    }
  }
  return out;
}

function bytesToGrid(bvals, w, h) {
  const mode = S.readMode;
  const msb = mode.includes('msb');
  const grid = makeGrid(w, h);
  let bi = 0;
  if (mode === 'h-msb' || mode === 'h-lsb') {
    const bpr = Math.ceil(w / 8);
    for (let r = 0; r < h; r++) for (let cbi = 0; cbi < bpr; cbi++) {
      if (bi >= bvals.length) break;
      const b = bvals[bi++];
      for (let bp = 0; bp < 8; bp++) {
        const pc = cbi * 8 + bp;
        if (pc < w) grid[r][pc] = msb ? (b >> (7 - bp)) & 1 : (b >> bp) & 1;
      }
    }
  } else if (mode === 'page-h-msb' || mode === 'page-h-lsb') {
    const pages = Math.ceil(h / 8);
    for (let pg = 0; pg < pages; pg++) for (let c = 0; c < w; c++) {
      if (bi >= bvals.length) break;
      const b = bvals[bi++];
      for (let bp = 0; bp < 8; bp++) {
        const pr = pg * 8 + bp;
        if (pr < h) grid[pr][c] = msb ? (b >> bp) & 1 : (b >> (7 - bp)) & 1;
      }
    }
  }
  return grid;
}

function fmtHex(b) { return '0x' + b.toString(16).toUpperCase().padStart(2, '0'); }

const generators = {
  'c-array': function (bv, w, h) {
    let s = '// ' + w + 'x' + h + ' px \u2014 ' + bv.length + ' bytes\nconst unsigned char bitmap[' + bv.length + '] = {\n  ';
    let lc = 0;
    bv.forEach(function (b, i) {
      s += fmtHex(b);
      if (i < bv.length - 1) { s += ', '; if (++lc >= 16) { s += '\n  '; lc = 0; } }
    });
    return s + '\n};';
  },
  'arduino': function (bv, w, h) {
    let s = '// ' + w + 'x' + h + ' px \u2014 ' + bv.length + ' bytes\nconst unsigned char PROGMEM bitmap[' + bv.length + '] = {\n  ';
    let lc = 0;
    bv.forEach(function (b, i) {
      s += fmtHex(b);
      if (i < bv.length - 1) { s += ', '; if (++lc >= 16) { s += '\n  '; lc = 0; } }
    });
    return s + '\n};';
  },
  'plain': function (bv) { return bv.map(function (b) { return b.toString(16).toUpperCase().padStart(2, '0'); }).join(' '); },
  'py-int': function (bv, w, h) {
    let s = '# ' + w + 'x' + h + ' \u2014 ' + bv.length + ' bytes\nbm = [\n  ';
    bv.forEach(function (b, i) { s += b; if (i < bv.length - 1) { s += ', '; if ((i + 1) % 16 === 0) s += '\n  '; } });
    return s + '\n]';
  },
  'py-hex': function (bv, w, h) {
    let s = '# ' + w + 'x' + h + ' \u2014 ' + bv.length + ' bytes\nbm = [\n  ';
    bv.forEach(function (b, i) { s += fmtHex(b); if (i < bv.length - 1) { s += ', '; if ((i + 1) % 16 === 0) s += '\n  '; } });
    return s + '\n]';
  },
  'binary': function (bv, w, h) {
    let s = '// ' + w + 'x' + h + ' \u2014 ' + bv.length + ' bytes\n';
    bv.forEach(function (b, i) { s += b.toString(2).padStart(8, '0'); if (i < bv.length - 1) { s += ' '; if ((i + 1) % 8 === 0) s += '\n'; } });
    return s;
  },
};

const parsers = {
  'c-array': function (s) { const m = s.match(/0x[0-9a-fA-F]{2}/g); if (!m) throw new Error('Hex bulunamad\u0131'); return m.map(function (x) { return parseInt(x, 16); }); },
  'arduino': function (s) { const m = s.match(/0x[0-9a-fA-F]{2}/g); if (!m) throw new Error('Hex bulunamad\u0131'); return m.map(function (x) { return parseInt(x, 16); }); },
  'plain': function (s) { const c = s.replace(/[^0-9a-fA-F]/g, ''); if (c.length % 2) throw new Error('\u00c7ift karakter gerek'); const r = []; for (let i = 0; i < c.length; i += 2) r.push(parseInt(c.slice(i, i + 2), 16)); return r; },
  'py-int': function (s) { const m = s.match(/\b\d{1,3}\b/g); if (!m) throw new Error('Say\u0131 bulunamad\u0131'); const r = m.map(Number); if (r.some(function (v) { return v > 255; })) throw new Error('0-255 d\u0131\u015f\u0131'); return r; },
  'py-hex': function (s) { const m = s.match(/0x[0-9a-fA-F]{2}/g); if (!m) throw new Error('Hex bulunamad\u0131'); return m.map(function (x) { return parseInt(x, 16); }); },
  'binary': function (s) { const m = s.match(/[01]{8}/g); if (!m) throw new Error('Binary yok'); return m.map(function (b) { return parseInt(b, 2); }); },
};

function refreshHex() {
  const bv = getOutputBytes();
  if (!bv || !bv.length) return;
  const gen = generators[S.hexFmt];
  if (!gen) return;
  $('hex-editor').value = gen(bv, S.W, S.H);
  $('hex-byte-count').textContent = bv.length + ' byte  |  ' + S.W + '\u00d7' + S.H;
}

$('read-mode').addEventListener('change', function (e) { S.readMode = e.target.value; refreshHex(); });
$('hex-format').addEventListener('change', function (e) { S.hexFmt = e.target.value; refreshHex(); });
$('out-flip-h').addEventListener('change', function (e) { S.outFlipH = e.target.checked; refreshHex(); });
$('out-flip-v').addEventListener('change', function (e) { S.outFlipV = e.target.checked; refreshHex(); });
$('out-invert').addEventListener('change', function (e) { S.outInvert = e.target.checked; refreshHex(); });
$('out-rotation').addEventListener('change', function (e) { S.outRotation = e.target.value; refreshHex(); });
$$('[name="oled-bg"]').forEach(function (r) { r.addEventListener('change', function (e) { S.oledBg = e.target.value; refreshHex(); }); });
$('hex-refresh').addEventListener('click', refreshHex);
$('hex-copy').addEventListener('click', function () {
  const code = $('hex-editor').value.trim();
  if (!code) return;
  navigator.clipboard.writeText(code).then(function () { $('hex-status').textContent = 'Kopyaland\u0131 \u2713'; setTimeout(function () { $('hex-status').textContent = ''; }, 2000); });
});
$('hex-apply').addEventListener('click', function () {
  const code = $('hex-editor').value.trim();
  if (!code) return;
  const parser = parsers[S.hexFmt];
  if (!parser) return;
  let bvals;
  try { bvals = parser(code); } catch (err) { showStatus('Hata: ' + err.message); return; }
  if (!bvals.length) { showStatus('Byte bulunamad\u0131!'); return; }
  const layer = getActiveLayer();
  if (layer) layer.grid = bytesToGrid(bvals, S.W, S.H);
  recordHistory();
  redraw();
  showStatus('Hex uyguland\u0131 \u2713');
});

function openHexLoadDialog() {
  const fmtOpts = Object.keys(parsers).map(function (k) {
    return '<option value="' + k + '"' + (k === S.hexFmt ? ' selected' : '') + '>' + k + '</option>';
  }).join('');
  const body = '<div class="modal-row"><span>G:</span><input type="number" id="ml-w" value="' + S.W + '" min="1" max="512"><span>Y:</span><input type="number" id="ml-h" value="' + S.H + '" min="1" max="512"></div>' +
    '<div class="modal-row"><span>Format:</span><select id="ml-fmt">' + fmtOpts + '</select></div>' +
    '<textarea id="ml-code" placeholder="Hex kodunu yapıştır..."></textarea>';
  openModal('Hex\'ten Y\u00fckle', body, function () {
    const w = parseInt($('ml-w').value);
    const h = parseInt($('ml-h').value);
    const fmt = $('ml-fmt').value;
    const code = $('ml-code').value.trim();
    if (isNaN(w) || isNaN(h) || w < 1 || w > 512 || h < 1 || h > 512) { showStatus('Ge\u00e7ersiz boyut!'); return; }
    const parser = parsers[fmt];
    let bvals;
    try { bvals = parser(code); } catch (err) { showStatus('Hata: ' + err.message); return; }
    S.W = w; S.H = h;
    mainCanvas.width = w; mainCanvas.height = h;
    overlayCanvas.width = w; overlayCanvas.height = h;
    selectCanvas.width = w; selectCanvas.height = h;
    syncCanvasSizeUI(); applyTransform();
    const layer = getActiveLayer();
    if (layer) layer.grid = bytesToGrid(bvals, w, h);
    recordHistory(); redraw(); showStatus('Y\u00fcklendi: ' + w + '\u00d7' + h + ' \u2713');
  });
}

function openModal(title, bodyHtml, onOk) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  $('modal-overlay').classList.remove('hidden');
  $('modal-ok').onclick = function () { onOk(); $('modal-overlay').classList.add('hidden'); };
  $('modal-cancel').onclick = function () { $('modal-overlay').classList.add('hidden'); };
}

function showStatus(msg, dur) {
  dur = dur || 2500;
  const el = $('status-msg');
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.textContent = ''; }, dur);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('paste', function (e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      const file = items[i].getAsFile();
      if (file) { loadImageFile(file); break; }
    }
  }
});

updateColorUI();
initCanvas(16, 16, false);

})();