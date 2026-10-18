(function () {
  'use strict';
  window.AEBrowseRaster = { fromSVG: function (url) {
    return new Promise(function (resolve, reject) {
      var image = new Image(), timer = setTimeout(function () { image.src = ''; reject(new Error('SVG 渲染超时，请检查文件。')); }, 15000);
      image.onerror = function () { clearTimeout(timer); reject(new Error('SVG 无法预览，请检查文件或将文字转换为路径。')); };
      image.onload = function () {
        clearTimeout(timer);
        try {
          var displayWidth = image.naturalWidth || 300, displayHeight = image.naturalHeight || 150;
          var factor = Math.min(4, 4096 / Math.max(displayWidth,displayHeight));
          var canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(displayWidth*factor)); canvas.height = Math.max(1,Math.round(displayHeight*factor));
          canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
          resolve({dataURL:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayWidth:displayWidth,displayHeight:displayHeight});
        } catch (error) { reject(error); }
      };
      image.src = url;
    });
  } };
})();
