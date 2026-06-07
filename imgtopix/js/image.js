const ImageProcessor = (() => {

  function loadFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      App.originalImg = img;
      const w = Math.min(img.width, App.MAX_DIM);
      const h = Math.min(img.height, App.MAX_DIM);
      let fw = w, fh = h;
      if (img.width / img.height > 1) {
        fh = Math.max(1, Math.round(fw * img.height / img.width));
      } else {
        fw = Math.max(1, Math.round(fh * img.width / img.height));
      }
      document.getElementById('out-w').value = fw;
      document.getElementById('out-h').value = fh;
      processImage();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { UI.toast('Resim yüklenemedi', 'danger'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function getImgPixels(img, w, h) {
    const offscreen = new OffscreenCanvas(w, h);
    const octx = offscreen.getContext('2d');
    octx.drawImage(img, 0, 0, w, h);
    return octx.getImageData(0, 0, w, h);
  }

  function applyBrightness(data, factor) {
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.min(255, data[i]     * factor);
      data[i + 1] = Math.min(255, data[i + 1] * factor);
      data[i + 2] = Math.min(255, data[i + 2] * factor);
    }
  }

  function applyContrast(data, factor) {
    const intercept = 128 * (1 - factor);
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.min(255, Math.max(0, data[i]     * factor + intercept));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor + intercept));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor + intercept));
    }
  }

  function applySharpness(imageData, amount) {
    if (amount <= 0) return imageData;
    const w = imageData.width, h = imageData.height;
    const src = imageData.data;
    const out = new Uint8ClampedArray(src);
    const kernel = [-amount, -amount, -amount, -amount, 1 + 8 * amount, -amount, -amount, -amount, -amount];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              val += src[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          out[(y * w + x) * 4 + c] = Math.min(255, Math.max(0, val));
        }
        out[(y * w + x) * 4 + 3] = 255;
      }
    }
    return new ImageData(out, w, h);
  }

  function toGray(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function applyFloydSteinberg(grayArr, w, h, threshold) {
    const err = new Float32Array(w * h);
    const result = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const oldVal = Math.min(255, Math.max(0, grayArr[idx] + err[idx]));
        const newVal = oldVal >= threshold ? 255 : 0;
        result[idx] = newVal;
        const quantErr = oldVal - newVal;

        if (x + 1 < w)           err[idx + 1]         += quantErr * 7 / 16;
        if (y + 1 < h) {
          if (x > 0)             err[idx + w - 1]      += quantErr * 3 / 16;
                                 err[idx + w]           += quantErr * 5 / 16;
          if (x + 1 < w)         err[idx + w + 1]       += quantErr * 1 / 16;
        }
      }
    }
    return result;
  }

  function applyOrdered(grayArr, w, h) {
    const bayer = [
       0, 32,  8, 40,  2, 34, 10, 42,
      48, 16, 56, 24, 50, 18, 58, 26,
      12, 44,  4, 36, 14, 46,  6, 38,
      60, 28, 52, 20, 62, 30, 54, 22,
       3, 35, 11, 43,  1, 33,  9, 41,
      51, 19, 59, 27, 49, 17, 57, 25,
      15, 47,  7, 39, 13, 45,  5, 37,
      63, 31, 55, 23, 61, 29, 53, 21,
    ];
    const result = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const threshold = (bayer[(y % 8) * 8 + (x % 8)] / 64) * 255;
        result[y * w + x] = grayArr[y * w + x] >= threshold ? 255 : 0;
      }
    }
    return result;
  }

  function applyThreshold(grayArr, w, h, threshold) {
    const result = new Uint8Array(w * h);
    for (let i = 0; i < grayArr.length; i++) {
      result[i] = grayArr[i] >= threshold ? 255 : 0;
    }
    return result;
  }

  function resizeNearest(srcData, srcW, srcH, dstW, dstH) {
    const out = new Uint8ClampedArray(dstW * dstH * 4);
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const sx = Math.floor(x * srcW / dstW);
        const sy = Math.floor(y * srcH / dstH);
        const si = (sy * srcW + sx) * 4;
        const di = (y * dstW + x) * 4;
        out[di] = srcData[si]; out[di+1] = srcData[si+1];
        out[di+2] = srcData[si+2]; out[di+3] = 255;
      }
    }
    return new ImageData(out, dstW, dstH);
  }

  function resizeBilinear(srcData, srcW, srcH, dstW, dstH) {
    const out = new Uint8ClampedArray(dstW * dstH * 4);
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const gx = x * (srcW - 1) / (dstW - 1);
        const gy = y * (srcH - 1) / (dstH - 1);
        const x0 = Math.floor(gx), x1 = Math.min(x0 + 1, srcW - 1);
        const y0 = Math.floor(gy), y1 = Math.min(y0 + 1, srcH - 1);
        const wx = gx - x0, wy = gy - y0;
        const di = (y * dstW + x) * 4;
        for (let c = 0; c < 3; c++) {
          const tl = srcData[(y0 * srcW + x0) * 4 + c];
          const tr = srcData[(y0 * srcW + x1) * 4 + c];
          const bl = srcData[(y1 * srcW + x0) * 4 + c];
          const br = srcData[(y1 * srcW + x1) * 4 + c];
          out[di + c] = tl * (1-wx)*(1-wy) + tr * wx*(1-wy) + bl * (1-wx)*wy + br * wx*wy;
        }
        out[di+3] = 255;
      }
    }
    return new ImageData(out, dstW, dstH);
  }

  function processImage() {
    if (!App.originalImg) return;

    const w = Math.max(1, Math.min(parseInt(document.getElementById('out-w').value) || 128, App.MAX_DIM));
    const h = Math.max(1, Math.min(parseInt(document.getElementById('out-h').value) || 64, App.MAX_DIM));

    const rawID = getImgPixels(App.originalImg, w, h);
    let id;

    if (App.filterMode === 'bilinear' && w !== App.originalImg.width) {
      const full = getImgPixels(App.originalImg, App.originalImg.width, App.originalImg.height);
      id = resizeBilinear(full.data, App.originalImg.width, App.originalImg.height, w, h);
    } else if (App.filterMode === 'bicubic') {
      id = resizeBilinear(rawID.data, w, h, w, h);
      id = rawID;
    } else {
      id = rawID;
    }

    const d = new Uint8ClampedArray(id.data);
    applyBrightness(d, App.brightness);
    applyContrast(d, App.contrast);
    let processedID = new ImageData(d, w, h);
    if (App.sharpness > 0) {
      processedID = applySharpness(processedID, App.sharpness * 0.3);
    }

    App.processedImgData = processedID;

    const grayArr = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      grayArr[i] = toGray(processedID.data[i*4], processedID.data[i*4+1], processedID.data[i*4+2]);
    }

    let bwArr;
    if (App.ditherMode === 'floyd') {
      bwArr = applyFloydSteinberg(grayArr, w, h, App.threshold);
    } else if (App.ditherMode === 'ordered') {
      bwArr = applyOrdered(grayArr, w, h);
    } else {
      bwArr = applyThreshold(grayArr, w, h, App.threshold);
    }

    App.resetMatrix(w, h, false);
    const white = 0xFFFFFF, black = 0x000000;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let px = bwArr[y * w + x] === 255 ? white : black;
        if (App.invertOutput) px = px === white ? black : white;
        App.matrix[y][x] = px;
      }
    }

    App.history = [];
    App.redoStack = [];
    App.selection = null;

    SourceCanvas.redraw();
    Editor.redraw();
    Preview.redraw();
    UI.updateInfo();
    UI.updateDimLabel();
  }

  function saveAsPNG() {
    const w = App.matrixWidth(), h = App.matrixHeight();
    if (!w || !h) { UI.toast('Kaydedilecek çıktı yok', 'danger'); return; }

    const offscreen = new OffscreenCanvas(w, h);
    const octx = offscreen.getContext('2d');
    const id = octx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const isBlack = App.isBlack(App.matrix[y][x]);
        const v = isBlack ? 0 : 255;
        const idx = (y * w + x) * 4;
        id.data[idx] = id.data[idx+1] = id.data[idx+2] = v;
        id.data[idx+3] = 255;
      }
    }
    octx.putImageData(id, 0, 0);

    offscreen.convertToBlob({ type: 'image/png' }).then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `oled_${w}x${h}.png`;
      a.click();
      UI.toast(`💾 PNG kaydedildi: ${w}×${h}px`, 'accent');
    });
  }

  function copyCArray() {
    const w = App.matrixWidth(), h = App.matrixHeight();
    if (!w || !h) { UI.toast('Önce resim dönüştürün', 'danger'); return; }

    const lines = [`// ${w}x${h} OLED bitmap`, `static const uint8_t PROGMEM img_bitmap[] = {`];
    for (let y = 0; y < h; y++) {
      const bytes = [];
      let byte = 0, bitPos = 7;
      for (let x = 0; x < w; x++) {
        const pixel = App.isBlack(App.matrix[y][x]) ? 0 : 1;
        byte |= (pixel << bitPos);
        bitPos--;
        if (bitPos < 0) { bytes.push('0x' + byte.toString(16).toUpperCase().padStart(2,'0')); byte = 0; bitPos = 7; }
      }
      if (bitPos < 7) bytes.push('0x' + byte.toString(16).toUpperCase().padStart(2,'0'));
      lines.push('  ' + bytes.join(', ') + ',');
    }
    lines.push('};');

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      UI.toast(`📋 C Array kopyalandı! ${w}×${h} = ${w*h} piksel`, 'accent');
    });
  }

  function copyHexArray() {
    const w = App.matrixWidth(), h = App.matrixHeight();
    if (!w || !h) { UI.toast('Önce resim dönüştürün', 'danger'); return; }

    const bytes = [];
    for (let y = 0; y < h; y++) {
      let byte = 0, bitPos = 7;
      for (let x = 0; x < w; x++) {
        const pixel = App.isBlack(App.matrix[y][x]) ? 0 : 1;
        byte |= (pixel << bitPos);
        bitPos--;
        if (bitPos < 0) { bytes.push('0x' + byte.toString(16).toUpperCase().padStart(2,'0')); byte = 0; bitPos = 7; }
      }
      if (bitPos < 7) bytes.push('0x' + byte.toString(16).toUpperCase().padStart(2,'0'));
    }

    navigator.clipboard.writeText(bytes.join(', ')).then(() => {
      UI.toast(`🔢 Hex array kopyalandı (${bytes.length} byte)`, 'accent');
    });
  }

  return { loadFile, processImage, saveAsPNG, copyCArray, copyHexArray };
})();


const SourceCanvas = (() => {
  let canvas, ctx;
  let displayedImg = null;
  let cropOverlay = null;

  function init() {
    canvas = document.getElementById('canvas-source');
    ctx = canvas.getContext('2d');

    canvas.addEventListener('mousedown', onCropDown);
    canvas.addEventListener('mousemove', onCropMove);
    canvas.addEventListener('mouseup', onCropUp);
  }

  function redraw() {
    const wrap = document.getElementById('source-wrap');
    const w = wrap.clientWidth || 260;
    const h = wrap.clientHeight || 200;
    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);

    if (!App.processedImgData) return;

    const id = App.processedImgData;
    const iw = id.width, ih = id.height;
    const scale = Math.min(w / iw, h / ih, 1);
    const dw = iw * scale, dh = ih * scale;
    const ox = (w - dw) / 2, oy = (h - dh) / 2;

    const tmp = new OffscreenCanvas(iw, ih);
    tmp.getContext('2d').putImageData(id, 0, 0);
    ctx.drawImage(tmp, ox, oy, dw, dh);

    displayedImg = { ox, oy, dw, dh, iw: App.originalImg ? App.originalImg.width : iw, ih: App.originalImg ? App.originalImg.height : ih };
  }

  function onCropDown(e) {
    if (!App.cropActive) return;
    const rect = canvas.getBoundingClientRect();
    App.cropStart = [e.clientX - rect.left, e.clientY - rect.top];
    cropOverlay = null;
  }

  function onCropMove(e) {
    if (!App.cropActive || !App.cropStart) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    cropOverlay = [App.cropStart[0], App.cropStart[1], x, y];

    redraw();
    if (cropOverlay) {
      const [x0,y0,x1,y1] = cropOverlay;
      ctx.save();
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([5,3]);
      ctx.strokeRect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0));
      ctx.fillStyle = 'rgba(255,68,68,0.08)';
      ctx.fillRect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0));
      ctx.restore();
    }
  }

  function onCropUp(e) {
    if (!App.cropActive || !App.cropStart) return;
    const rect = canvas.getBoundingClientRect();
    const x1 = e.clientX - rect.left, y1 = e.clientY - rect.top;
    const [x0, y0] = App.cropStart;

    if (!displayedImg || !App.originalImg) {
      endCrop();
      return;
    }

    const { ox, oy, dw, dh, iw, ih } = displayedImg;
    const scaleX = iw / dw, scaleY = ih / dh;

    const lf = Math.max(0, Math.round((Math.min(x0,x1) - ox) * scaleX));
    const tp = Math.max(0, Math.round((Math.min(y0,y1) - oy) * scaleY));
    const rt = Math.min(iw, Math.round((Math.max(x0,x1) - ox) * scaleX));
    const bt = Math.min(ih, Math.round((Math.max(y0,y1) - oy) * scaleY));

    if (rt - lf < 5 || bt - tp < 5) {
      UI.toast('Kırpma alanı çok küçük', 'danger');
    } else {
      const offscreen = new OffscreenCanvas(iw, ih);
      const octx = offscreen.getContext('2d');
      octx.drawImage(App.originalImg, 0, 0);
      const cropW = rt - lf, cropH = bt - tp;
      const croppedData = octx.getImageData(lf, tp, cropW, cropH);
      const bmp = new OffscreenCanvas(cropW, cropH);
      bmp.getContext('2d').putImageData(croppedData, 0, 0);

      const newImg = new Image();
      bmp.convertToBlob().then(blob => {
        const url = URL.createObjectURL(blob);
        newImg.onload = () => {
          App.originalImg = newImg;
          document.getElementById('out-w').value = Math.min(cropW, App.MAX_DIM);
          document.getElementById('out-h').value = Math.min(cropH, App.MAX_DIM);
          ImageProcessor.processImage();
          URL.revokeObjectURL(url);
        };
        newImg.src = url;
      });
    }
    endCrop();
  }

  function endCrop() {
    App.cropActive = false;
    App.cropStart = null;
    cropOverlay = null;
    canvas.style.cursor = 'default';
    document.getElementById('crop-hint').classList.add('hidden');
    redraw();
  }

  return { init, redraw };
})();