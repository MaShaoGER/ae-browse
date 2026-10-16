/* Approximate static geometry only; AE remains the rendering reference. */
(function () {
  'use strict';
  function positive(value, fallback) { value = Number(value); return isFinite(value) && value > 0 ? value : fallback; }
  function style(type, values, maxWidth, maxHeight) {
    values = values || {};
    var radial = type === 'polygon' || type === 'star', outer = positive(values.outerRadius, 100);
    var width = radial ? outer * 2 : positive(values.diameter, positive(values.width, 320));
    var height = radial ? outer * 2 : positive(values.diameter, positive(values.height, 180));
    var scale = Math.min(maxWidth / width, maxHeight / height, 1), color = values.color || [.2, .5, 1, 1];
    var result = { width: width * scale + 'px', height: height * scale + 'px', borderRadius: '0px', clipPath: 'none',
      background: 'rgba(' + color.slice(0, 3).map(function (c) { return Math.round(c * 255); }).join(',') + ',' + (color[3] === undefined ? 1 : color[3]) + ')' };
    if (type === 'ellipse') result.borderRadius = '50%';
    else if (radial) {
      var count = Math.max(3, Math.min(64, Math.round(positive(values.points, 5))));
      var rotation = Number(values.rotation); if (!isFinite(rotation)) rotation = 0;
      var inner = Math.min(1, positive(values.innerRadius, outer / 2) / outer), vertices = [], total = type === 'star' ? count * 2 : count;
      function rounded(value) { return String(Math.round(value * 1000) / 1000); }
      for (var i = 0; i < total; i++) {
        var angle = (-90 + rotation + 360 * i / total) * Math.PI / 180, radius = type === 'star' && i % 2 ? inner : 1;
        vertices.push(rounded(50 + Math.cos(angle) * radius * 50) + '% ' + rounded(50 + Math.sin(angle) * radius * 50) + '%');
      }
      result.clipPath = 'polygon(' + vertices.join(',') + ')';
    } else result.borderRadius = Math.max(0, Number(values.radius) || 0) * scale + 'px';
    return result;
  }
  function type(asset) { var extensions = asset && asset.extensions, local = extensions && extensions['local.aebrowse']; return local && local.previewShape || 'rectangle'; }
  function draw(element, asset, values, maxWidth, maxHeight) {
    var computed = style(type(asset), values, maxWidth, maxHeight);
    Object.keys(computed).forEach(function (key) { element.style[key] = computed[key]; });
  }
  window.AEBrowsePreview = { style: style, draw: draw };
})();
