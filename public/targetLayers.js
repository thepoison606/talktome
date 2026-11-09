(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TalktomeTargetLayers = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function packRows(heights, availableHeight, gap = 0, columnCount = 1) {
    let layer = 0, used = 0, rowCount = 0;
    const available = Math.max(1, Number(availableHeight) || 1);
    const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
    const assignments = [];
    for (let index = 0; index < heights.length; index += columns) {
      const row = heights.slice(index, index + columns);
      const size = Math.max(...row.map(height => Math.max(1, Number(height) || 1)));
      if (rowCount && used + gap + size > available) { layer++; used = 0; rowCount = 0; }
      used += (rowCount ? gap : 0) + size; rowCount++;
      row.forEach(() => assignments.push(layer));
    }
    return assignments;
  }
  return { packRows };
});
