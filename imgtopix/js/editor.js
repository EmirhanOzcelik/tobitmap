const Editor = (() => {
  let canvas, ctx;
  let overlayCanvas, overlayCtx;
  let wrap;

  function init() {
    wrap = document.getElementById('canvas-editor-wrap');
    canvas = document.getElementById('canvas-editor');
    ctx = canvas.getContext('2d');

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;image-rendering:pixelated;';
    wrap.style.position = 'relative';
    wrap.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext('2d');

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        UI.changeZoom(delta);
      }
    }, { passive: false });
  }

  function getCellSize() {
    return App.getZoom() * getBaseCell();
  }

  function getBaseCell() {
    const w = App.matrixWidth();
    const h = App.matrixHeight();
    if (!w || !h) return 4;
    const cw = wrap.clientWidth || 512;
    const ch = wrap.clientHeight || 512;
    return Math.max(1, Math.min(cw / w, ch / h));
  }

  function canvasToPixel(e) {
    const rect = canvas.getBoundingClientRect();
    const cs = getCellSize();
    const x = Math.floor((e.clientX - rect.left) / cs);
    const y = Math.floor((e.clientY - rect.top) / cs);
    const w = App.matrixWidth();
    const h = App.matrixHeight();
    if (x >= 0 && x < w && y >= 0 && y < h) return [x, y];
    return [null, null];
  }

  function redraw() {
    const w = App.matrixWidth();
    const h = App.matrixHeight();
    if (!w || !h) return;

    const cs = getCellSize();
    const pw = Math.ceil(w * cs);
    const ph = Math.ceil(h * cs);

    canvas.width = pw;
    canvas.height = ph;
    overlayCanvas.width = pw;
    overlayCanvas.height = ph;
    overlayCanvas.style.width = pw + 'px';
    overlayCanvas.style.height = ph + 'px';

    const imageData = ctx.createImageData(pw, ph);
    const data = imageData.data;

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const rgb = App.matrix[row][col];
        const isBlack = App.isBlack(rgb);
        const r = isBlack ? 10 : 245;
        const g = isBlack ? 10 : 245;
        const b = isBlack ? 10 : 245;

        const x0 = Math.round(col * cs);
        const y0 = Math.round(row * cs);
        const x1 = Math.round((col + 1) * cs);
        const y1 = Math.round((row + 1) * cs);

        for (let py = y0; py < y1 && py < ph; py++) {
          for (let px = x0; px < x1 && px < pw; px++) {
            const idx = (py * pw + px) * 4;
            data[idx]     = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    if (App.showGrid && cs >= 4) {
      drawGrid(w, h, cs, pw, ph);
    }

    drawSelectionOverlay();
  }

  function drawGrid(w, h, cs, pw, ph) {
    ctx.save();
    ctx.strokeStyle = 'rgba(40,40,40,0.8)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let col = 1; col < w; col++) {
      const x = Math.round(col * cs) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ph);
    }
    for (let row = 1; row < h; row++) {
      const y = Math.round(row * cs) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(pw, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSelectionOverlay() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!App.selection) return;
    const [x0, y0, x1, y1] = App.selection;
    const cs = getCellSize();
    overlayCtx.save();
    overlayCtx.strokeStyle = '#00ff88';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([4, 3]);
    overlayCtx.strokeRect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
    overlayCtx.fillStyle = 'rgba(0,255,136,0.06)';
    overlayCtx.fillRect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
    overlayCtx.restore();
  }

  function drawTempShape(type, x0, y0, x1, y1, color) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (App.selection) drawSelectionOverlay();

    const cs = getCellSize();
    const ox0 = Math.min(x0, x1) * cs;
    const oy0 = Math.min(y0, y1) * cs;
    const ow = (Math.abs(x1 - x0) + 1) * cs;
    const oh = (Math.abs(y1 - y0) + 1) * cs;
    const hexColor = App.rgbToHex(color);

    overlayCtx.save();
    overlayCtx.strokeStyle = hexColor;
    overlayCtx.fillStyle = hexColor;
    overlayCtx.lineWidth = Math.max(1, cs * 0.15);

    if (type === 'line') {
      overlayCtx.beginPath();
      overlayCtx.moveTo(x0 * cs + cs / 2, y0 * cs + cs / 2);
      overlayCtx.lineTo(x1 * cs + cs / 2, y1 * cs + cs / 2);
      overlayCtx.stroke();
    } else if (type === 'rect_fill') {
      overlayCtx.fillRect(ox0, oy0, ow, oh);
    } else if (type === 'rect_outline') {
      overlayCtx.strokeRect(ox0 + 1, oy0 + 1, ow - 2, oh - 2);
    } else if (type === 'select') {
      overlayCtx.strokeStyle = '#00ff88';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([4, 3]);
      overlayCtx.strokeRect(ox0, oy0, ow, oh);
      overlayCtx.fillStyle = 'rgba(0,255,136,0.06)';
      overlayCtx.fillRect(ox0, oy0, ow, oh);
    }
    overlayCtx.restore();
  }

  function setPixelAndUpdate(x, y, color) {
    const colorInt = Array.isArray(color) ? App.arrToInt(color) : color;
    App.setPixel(x, y, colorInt);
    updateSinglePixel(x, y);
  }

  function updateSinglePixel(x, y) {
    const cs = getCellSize();
    const rgb = App.matrix[y][x];
    const isBlack = App.isBlack(rgb);
    const r = isBlack ? 10 : 245;
    const g = isBlack ? 10 : 245;
    const b = isBlack ? 10 : 245;
    const x0 = Math.round(x * cs);
    const y0 = Math.round(y * cs);
    const x1 = Math.round((x + 1) * cs);
    const y1 = Math.round((y + 1) * cs);

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    if (App.showGrid && cs >= 4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(40,40,40,0.8)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      ctx.restore();
    }
  }

  function bresenham(x0, y0, x1, y1, color) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const colorInt = Array.isArray(color) ? App.arrToInt(color) : color;
    while (true) {
      App.setPixel(x0, y0, colorInt);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  function floodFill(sx, sy, targetInt, replaceInt) {
    if (targetInt === replaceInt) return;
    const w = App.matrixWidth(), h = App.matrixHeight();
    const stack = [[sx, sy]];
    const visited = new Uint8Array(w * h);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (visited[y * w + x]) continue;
      if (App.matrix[y][x] !== targetInt) continue;
      visited[y * w + x] = 1;
      App.matrix[y][x] = replaceInt;
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  }

  function drawRect(x0, y0, x1, y1, colorInt, fill) {
    const xl = Math.min(x0,x1), xr = Math.max(x0,x1);
    const yt = Math.min(y0,y1), yb = Math.max(y0,y1);
    const w = App.matrixWidth(), h = App.matrixHeight();
    for (let y = Math.max(0,yt); y <= Math.min(h-1,yb); y++) {
      for (let x = Math.max(0,xl); x <= Math.min(w-1,xr); x++) {
        if (fill || x===xl || x===xr || y===yt || y===yb) {
          App.matrix[y][x] = colorInt;
        }
      }
    }
  }

  function onMouseDown(e) {
    const [col, row] = canvasToPixel(e);
    if (col === null) return;
    App.rectStart = [col, row];
    App.lastDragPos = null;
    App.pushHistory();

    const colorInt = App.arrToInt(App.drawColor);
    const eraseInt = App.arrToInt(App.eraseColor);

    if (App.tool === 'pencil') {
      setPixelAndUpdate(col, row, colorInt);
      App.lastDragPos = [col, row];
    } else if (App.tool === 'eraser') {
      setPixelAndUpdate(col, row, eraseInt);
      App.lastDragPos = [col, row];
    } else if (App.tool === 'fill') {
      const target = App.matrix[row][col];
      floodFill(col, row, target, colorInt);
      redraw();
      Preview.redraw();
    }
  }

  function onMouseMove(e) {
    const [col, row] = canvasToPixel(e);
    UI.updateCursor(col, row, col !== null ? App.matrix[row][col] : null);

    if (!(e.buttons & 1)) return;
    if (col === null) return;

    const colorInt = App.arrToInt(App.drawColor);
    const eraseInt = App.arrToInt(App.eraseColor);

    if (App.tool === 'pencil') {
      if (App.lastDragPos) {
        bresenham(...App.lastDragPos, col, row, colorInt);
        const [lx, ly] = App.lastDragPos;
        const minX = Math.min(lx, col), maxX = Math.max(lx, col);
        const minY = Math.min(ly, row), maxY = Math.max(ly, row);
        if (maxX - minX < 3 && maxY - minY < 3) {
          for (let py = minY; py <= maxY; py++)
            for (let px = minX; px <= maxX; px++)
              updateSinglePixel(px, py);
        } else {
          redraw();
        }
      } else {
        setPixelAndUpdate(col, row, colorInt);
      }
      App.lastDragPos = [col, row];
      Preview.redraw();
    } else if (App.tool === 'eraser') {
      if (App.lastDragPos) {
        bresenham(...App.lastDragPos, col, row, eraseInt);
        redraw();
      } else {
        setPixelAndUpdate(col, row, eraseInt);
      }
      App.lastDragPos = [col, row];
      Preview.redraw();
    } else if (['rect_fill','rect_outline','line','select'].includes(App.tool) && App.rectStart) {
      const [x0, y0] = App.rectStart;
      drawTempShape(App.tool, x0, y0, col, row, App.drawColor);
    }
  }

  function onMouseUp(e) {
    const [col, row] = canvasToPixel(e);
    App.lastDragPos = null;
    if (!App.rectStart) return;
    const [x0, y0] = App.rectStart;
    App.rectStart = null;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (App.selection) drawSelectionOverlay();

    if (col === null && !['select','rect_fill','rect_outline','line'].includes(App.tool)) return;
    const cx = col !== null ? col : x0;
    const cy = row !== null ? row : y0;
    const colorInt = App.arrToInt(App.drawColor);

    if (App.tool === 'rect_fill') {
      drawRect(x0, y0, cx, cy, colorInt, true);
      redraw(); Preview.redraw();
    } else if (App.tool === 'rect_outline') {
      drawRect(x0, y0, cx, cy, colorInt, false);
      redraw(); Preview.redraw();
    } else if (App.tool === 'line') {
      bresenham(x0, y0, cx, cy, colorInt);
      redraw(); Preview.redraw();
    } else if (App.tool === 'select') {
      const sx0 = Math.min(x0, cx), sy0 = Math.min(y0, cy);
      const sx1 = Math.max(x0, cx), sy1 = Math.max(y0, cy);
      App.selection = [sx0, sy0, sx1, sy1];
      redraw();
    }

    UI.updateInfo();
  }

  function onMouseLeave() {
    UI.updateCursor(null, null, null);
  }

  return { init, redraw, bresenham, floodFill, drawRect, setPixelAndUpdate, drawSelectionOverlay };
})();

const Preview = (() => {
  let canvas, ctx;

  function init() {
    canvas = document.getElementById('canvas-preview');
    ctx = canvas.getContext('2d');
  }

  function redraw() {
    const w = App.matrixWidth(), h = App.matrixHeight();
    if (!w || !h) return;

    const wrap = document.getElementById('preview-wrap');
    const pw = wrap.clientWidth || 260;
    const ph = wrap.clientHeight || 120;

    let scale = Math.min(pw / w, ph / h);
    if (w * h <= 64 * 128) scale = Math.min(pw / w, ph / h, 3);
    scale = Math.max(1, Math.floor(scale));

    const dw = w * scale, dh = h * scale;
    canvas.width = dw;
    canvas.height = dh;
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';

    const imageData = ctx.createImageData(dw, dh);
    const data = imageData.data;

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const isBlack = App.isBlack(App.matrix[row][col]);
        const r = isBlack ? 10 : 245;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const idx = ((row * scale + sy) * dw + (col * scale + sx)) * 4;
            data[idx] = data[idx+1] = data[idx+2] = r;
            data[idx+3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return { init, redraw };
})();