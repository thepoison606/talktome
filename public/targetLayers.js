(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TalktomeTargetLayers = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function packRows(heights, availableHeight, gap = 0) {
    let layer = 0, used = 0, count = 0;
    const available = Math.max(1, Number(availableHeight) || 1);
    return heights.map(height => {
      const size = Math.max(1, Number(height) || 1);
      if (count && used + gap + size > available) { layer++; used = 0; count = 0; }
      used += (count ? gap : 0) + size; count++;
      return layer;
    });
  }
  return { packRows };
});
