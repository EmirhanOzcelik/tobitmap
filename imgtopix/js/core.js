const App = {
  matrix: [],
  history: [],
  redoStack: [],
  originalImg: null,
  processedImgData: null,

  tool: 'pencil',
  drawColor: [0, 0, 0],
  eraseColor: [255, 255, 255],
  selection: null,
  cropActive: false,
  cropStart: null,
  rectStart: null,
  lastDragPos: null,

  showGrid: true,
  zoomIndex: 2,
  zoomLevels: [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16],

  brightness: 1,
  contrast: 1,
  sharpness: 0,
  threshold: 128,
  ditherMode: 'floyd',
  filterMode: 'nearest',
  invertOutput: false,

  HISTORY_LIMIT: 40,
  MAX_DIM: 256,

  getZoom() {
    return this.zoomLevels[Math.max(0, Math.min(this.zoomIndex, this.zoomLevels.length - 1))];
  },

  pushHistory() {
    this.history.push(this.matrix.map(row => row.slice()));
    if (this.history.length > this.HISTORY_LIMIT) this.history.shift();
    this.redoStack = [];
  },

  undo() {
    if (!this.history.length) return;
    this.redoStack.push(this.matrix.map(row => row.slice()));
    this.matrix = this.history.pop();
  },

  redo() {
    if (!this.redoStack.length) return;
    this.history.push(this.matrix.map(row => row.slice()));
    this.matrix = this.redoStack.pop();
  },

  resetMatrix(w, h, fillWhite = true) {
    const fill = fillWhite ? 0xFFFFFF : 0x000000;
    this.matrix = Array.from({ length: h }, () => new Array(w).fill(fill));
    this.history = [];
    this.redoStack = [];
    this.selection = null;
  },

  getPixel(x, y) {
    if (!this.matrix[y]) return null;
    return this.matrix[y][x];
  },

  setPixel(x, y, rgb) {
    if (y >= 0 && y < this.matrix.length && x >= 0 && x < this.matrix[0].length) {
      this.matrix[y][x] = rgb;
    }
  },

  rgbToHex(rgb) {
    if (Array.isArray(rgb)) {
      const [r, g, b] = rgb;
      return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    const n = rgb;
    return '#' + ((n >> 16) & 0xff).toString(16).padStart(2, '0')
              + ((n >> 8) & 0xff).toString(16).padStart(2, '0')
              + (n & 0xff).toString(16).padStart(2, '0');
  },

  hexToRgbInt(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r << 16) | (g << 8) | b;
  },

  arrToInt(arr) {
    return (arr[0] << 16) | (arr[1] << 8) | arr[2];
  },

  intToArr(n) {
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  },

  isBlack(rgb) {
    if (Array.isArray(rgb)) {
      return (rgb[0] + rgb[1] + rgb[2]) < 384;
    }
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    return (r + g + b) < 384;
  },

  matrixWidth() {
    return this.matrix[0] ? this.matrix[0].length : 0;
  },
  matrixHeight() {
    return this.matrix.length;
  }
};