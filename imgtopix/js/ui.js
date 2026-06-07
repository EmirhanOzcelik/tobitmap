const UI = (() => {

  let toastTimer = null;

  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type === 'accent' ? 'accent' : '');
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 250);
    }, 2400);
  }

  function updateInfo() {
    const w = App.matrixWidth(), h = App.matrixHeight();
    if (!w || !h) { document.getElementById('info-bar').textContent = '—'; return; }
    let black = 0, white = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        App.isBlack(App.matrix[y][x]) ? black++ : white++;
    const bytes = Math.ceil(w / 8) * h;
    document.getElementById('info-bar').textContent =
      `${w}×${h}px  ⬛${black}  ⬜${white}  ${bytes}B  Ctrl+Z undo  Ctrl+S kaydet`;
  }

  function updateDimLabel() {
    const w = App.matrixWidth(), h = App.matrixHeight();
    const zoom = App.getZoom();
    const zoomLevels = App.zoomLevels;
    const idx = App.zoomIndex;
    document.getElementById('lbl-dim').textContent = `${w}×${h} | ${zoomLevels[idx]}×`;
    document.getElementById('lbl-zoom').textContent = zoomLevels[idx] + '×';
  }

  function updateCursor(x, y, rgb) {
    if (x === null) {
      document.getElementById('cursor-pos').textContent = 'x:— y:—';
    } else {
      const sym = App.isBlack(rgb) ? '⬛' : '⬜';
      document.getElementById('cursor-pos').textContent = `x:${x} y:${y} ${sym}`;
    }
  }

  function changeZoom(delta) {
    App.zoomIndex = Math.max(0, Math.min(App.zoomLevels.length - 1, App.zoomIndex + delta));
    updateDimLabel();
    Editor.redraw();
  }

  function getDrawColorInt() { return App.arrToInt(App.drawColor); }
  function getEraseColorInt() { return App.arrToInt(App.eraseColor); }

  function updateColorSwatches() {
    document.getElementById('swatch-draw').style.background = App.rgbToHex(App.drawColor);
    document.getElementById('swatch-erase').style.background = App.rgbToHex(App.eraseColor);
  }

  function bindAll() {
    document.getElementById('btn-load').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) ImageProcessor.loadFile(file);
      e.target.value = '';
    });

    document.getElementById('btn-crop-mode').addEventListener('click', () => {
      if (!App.originalImg) { toast('Önce resim yükleyin', 'danger'); return; }
      App.cropActive = true;
      App.cropStart = null;
      const c = document.getElementById('canvas-source');
      c.style.cursor = 'crosshair';
      document.getElementById('crop-hint').classList.remove('hidden');
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('Her şey sıfırlanacak. Emin misiniz?')) return;
      App.originalImg = null;
      App.processedImgData = null;
      App.brightness = 1; App.contrast = 1; App.sharpness = 0; App.threshold = 128;
      App.ditherMode = 'floyd'; App.filterMode = 'nearest'; App.invertOutput = false;
      document.getElementById('sl-brightness').value = 1; document.getElementById('val-brightness').textContent = '1.00';
      document.getElementById('sl-contrast').value = 1; document.getElementById('val-contrast').textContent = '1.00';
      document.getElementById('sl-sharpness').value = 0; document.getElementById('val-sharpness').textContent = '0.0';
      document.getElementById('sl-threshold').value = 128; document.getElementById('val-threshold').textContent = '128';
      document.getElementById('sel-dither').value = 'floyd';
      document.getElementById('sel-filter').value = 'nearest';
      document.getElementById('chk-invert').checked = false;
      document.getElementById('canvas-source').getContext('2d').clearRect(0, 0,
        document.getElementById('canvas-source').width, document.getElementById('canvas-source').height);
      App.resetMatrix(128, 64, true);
      Editor.redraw(); Preview.redraw(); updateInfo(); updateDimLabel();
      toast('Sıfırlandı');
    });

    document.getElementById('btn-apply').addEventListener('click', () => {
      ImageProcessor.processImage();
    });

    document.querySelectorAll('.btn-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('out-w').value = btn.dataset.w;
        document.getElementById('out-h').value = btn.dataset.h;
        if (App.originalImg) ImageProcessor.processImage();
        else { App.resetMatrix(+btn.dataset.w, +btn.dataset.h, true); Editor.redraw(); Preview.redraw(); updateInfo(); updateDimLabel(); }
      });
    });

    ['sl-brightness','sl-contrast','sl-sharpness','sl-threshold'].forEach(id => {
      const el = document.getElementById(id);
      const valId = 'val-' + id.replace('sl-','');
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        document.getElementById(valId).textContent = Number.isInteger(v) ? v : v.toFixed(id === 'sl-sharpness' ? 1 : 2);
        if (id === 'sl-brightness') App.brightness = v;
        else if (id === 'sl-contrast') App.contrast = v;
        else if (id === 'sl-sharpness') App.sharpness = v;
        else if (id === 'sl-threshold') App.threshold = v;
      });
      el.addEventListener('change', () => { if (App.originalImg) ImageProcessor.processImage(); });
    });

    document.getElementById('sel-dither').addEventListener('change', e => {
      App.ditherMode = e.target.value;
      if (App.originalImg) ImageProcessor.processImage();
    });

    document.getElementById('sel-filter').addEventListener('change', e => {
      App.filterMode = e.target.value;
      if (App.originalImg) ImageProcessor.processImage();
    });

    document.getElementById('chk-invert').addEventListener('change', e => {
      App.invertOutput = e.target.checked;
      if (App.originalImg) ImageProcessor.processImage();
    });

    document.getElementById('chk-grid').addEventListener('change', e => {
      App.showGrid = e.target.checked;
      Editor.redraw();
    });

    document.getElementById('btn-zoom-in').addEventListener('click', () => changeZoom(+1));
    document.getElementById('btn-zoom-out').addEventListener('click', () => changeZoom(-1));

    document.getElementById('btn-undo').addEventListener('click', () => {
      App.undo(); Editor.redraw(); Preview.redraw(); updateInfo();
    });
    document.getElementById('btn-redo').addEventListener('click', () => {
      App.redo(); Editor.redraw(); Preview.redraw(); updateInfo();
    });

    document.querySelectorAll('input[name="tool"]').forEach(el => {
      el.addEventListener('change', () => { App.tool = el.value; });
    });

    document.getElementById('btn-draw-color').addEventListener('click', () => {
      document.getElementById('picker-draw').click();
    });
    document.getElementById('picker-draw').addEventListener('input', e => {
      App.drawColor = App.intToArr(App.hexToRgbInt(e.target.value));
      updateColorSwatches();
    });

    document.getElementById('btn-erase-color').addEventListener('click', () => {
      document.getElementById('picker-erase').click();
    });
    document.getElementById('picker-erase').addEventListener('input', e => {
      App.eraseColor = App.intToArr(App.hexToRgbInt(e.target.value));
      updateColorSwatches();
    });

    document.getElementById('btn-swap').addEventListener('click', () => {
      [App.drawColor, App.eraseColor] = [App.eraseColor, App.drawColor];
      updateColorSwatches();
    });

    document.getElementById('btn-fill-all').addEventListener('click', () => {
      App.pushHistory();
      const c = App.arrToInt(App.drawColor);
      const h = App.matrixHeight(), w = App.matrixWidth();
      for (let y = 0; y < h; y++) App.matrix[y].fill(c);
      Editor.redraw(); Preview.redraw(); updateInfo();
    });

    document.getElementById('btn-fill-sel').addEventListener('click', () => {
      if (!App.selection) { toast('Önce alan seçin', 'danger'); return; }
      App.pushHistory();
      const [x0,y0,x1,y1] = App.selection;
      Editor.drawRect(x0,y0,x1,y1, App.arrToInt(App.drawColor), true);
      Editor.redraw(); Preview.redraw(); updateInfo();
    });

    document.getElementById('btn-clear-sel').addEventListener('click', () => {
      if (!App.selection) { toast('Önce alan seçin', 'danger'); return; }
      App.pushHistory();
      const [x0,y0,x1,y1] = App.selection;
      Editor.drawRect(x0,y0,x1,y1, App.arrToInt(App.eraseColor), true);
      Editor.redraw(); Preview.redraw(); updateInfo();
    });

    document.getElementById('btn-deselect').addEventListener('click', () => {
      App.selection = null;
      Editor.redraw();
    });

    document.getElementById('btn-flip-h').addEventListener('click', () => {
      App.pushHistory();
      App.matrix = App.matrix.map(row => [...row].reverse());
      Editor.redraw(); Preview.redraw();
    });

    document.getElementById('btn-flip-v').addEventListener('click', () => {
      App.pushHistory();
      App.matrix = [...App.matrix].reverse();
      Editor.redraw(); Preview.redraw();
    });

    document.getElementById('btn-rotate-90').addEventListener('click', () => {
      App.pushHistory();
      const h = App.matrixHeight(), w = App.matrixWidth();
      const newMat = Array.from({length: w}, () => new Array(h).fill(0));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          newMat[x][h - 1 - y] = App.matrix[y][x];
      App.matrix = newMat;
      Editor.redraw(); Preview.redraw(); updateInfo(); updateDimLabel();
    });

    document.getElementById('btn-invert-canvas').addEventListener('click', () => {
      App.pushHistory();
      const h = App.matrixHeight(), w = App.matrixWidth();
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          App.matrix[y][x] = App.matrix[y][x] === 0xFFFFFF ? 0x000000 : 0xFFFFFF;
      Editor.redraw(); Preview.redraw();
    });

    document.getElementById('btn-mirror-paste').addEventListener('click', () => {
      if (!App.originalImg) { toast('Önce resim yükleyin', 'danger'); return; }
      ImageProcessor.processImage();
      toast('Orijinalden yapıştırıldı');
    });

    document.getElementById('btn-save-png').addEventListener('click', ImageProcessor.saveAsPNG);
    document.getElementById('btn-copy-c').addEventListener('click', ImageProcessor.copyCArray);
    document.getElementById('btn-copy-hex').addEventListener('click', ImageProcessor.copyHexArray);

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); App.undo(); Editor.redraw(); Preview.redraw(); updateInfo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); App.redo(); Editor.redraw(); Preview.redraw(); updateInfo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); ImageProcessor.saveAsPNG(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); document.getElementById('file-input').click(); }
      if (e.key === 'Escape') { App.selection = null; Editor.redraw(); }
      if (e.key === '+' || e.key === '=') changeZoom(+1);
      if (e.key === '-') changeZoom(-1);
    });

    document.getElementById('out-w').addEventListener('change', () => {
      if (document.getElementById('chk-proportional').checked && App.originalImg) {
        const w = parseInt(document.getElementById('out-w').value);
        const h = Math.max(1, Math.round(w * App.originalImg.height / App.originalImg.width));
        document.getElementById('out-h').value = h;
      }
    });

    document.getElementById('out-h').addEventListener('change', () => {
      if (document.getElementById('chk-proportional').checked && App.originalImg) {
        const h = parseInt(document.getElementById('out-h').value);
        const w = Math.max(1, Math.round(h * App.originalImg.width / App.originalImg.height));
        document.getElementById('out-w').value = w;
      }
    });

    window.addEventListener('resize', () => {
      SourceCanvas.redraw();
      Editor.redraw();
      Preview.redraw();
    });

    const dropZone = document.getElementById('source-wrap');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#00ff88'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) ImageProcessor.loadFile(file);
    });
  }

  return { toast, updateInfo, updateDimLabel, updateCursor, changeZoom, bindAll, updateColorSwatches };
})();