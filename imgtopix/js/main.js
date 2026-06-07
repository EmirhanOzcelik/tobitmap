document.addEventListener('DOMContentLoaded', () => {
  Editor.init();
  Preview.init();
  SourceCanvas.init();
  UI.bindAll();
  UI.updateColorSwatches();

  App.resetMatrix(128, 64, true);
  Editor.redraw();
  Preview.redraw();
  UI.updateInfo();
  UI.updateDimLabel();
});