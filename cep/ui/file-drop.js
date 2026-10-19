(function (root) {
  'use strict';
  function isFileDrop(data) {
    return !!data && (Array.prototype.indexOf.call(data.types || [], 'Files') >= 0 || (data.files && data.files.length > 0));
  }
  function pathsFrom(data) {
    var files = Array.prototype.slice.call(data.files || []);
    if (!files.length) Array.prototype.forEach.call(data.items || [], function (item) { if (item.kind === 'file') { var file = item.getAsFile(); if (file) files.push(file); } });
    if (!files.length || files.length > 1000) throw new Error('请每次拖入 1–1000 个本地文件或文件夹。');
    // CEP's Node-WebKit File exposes the native path; never guess from file.name
    // or webkitRelativePath (both can be relative to an unrelated directory).
    var paths = files.map(function (file) { return file.path; });
    if (paths.some(function (path) { return typeof path !== 'string' || !path; })) throw new Error('当前面板未提供拖入项目的本地路径，请使用“添加文件夹”或“输入路径”。');
    return paths;
  }
  function bind(options) {
    var target = options.target, overlay = options.overlay, depth = 0;
    function reset() { depth = 0; overlay.hidden = true; }
    function enter(event) {
      if (!isFileDrop(event.dataTransfer)) return;
      event.preventDefault(); depth++;
      if (options.canDrop()) overlay.hidden = false;
    }
    function over(event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = isFileDrop(event.dataTransfer) && options.canDrop() ? 'copy' : 'none';
    }
    function leave(event) { if (isFileDrop(event.dataTransfer) && --depth <= 0) reset(); }
    function drop(event) {
      event.preventDefault(); reset();
      if (!isFileDrop(event.dataTransfer)) return;
      if (!options.canDrop()) { options.onError(new Error('当前无法接收拖入，请等待操作完成；浏览器演示不支持本地登记。')); return; }
      // Capture File.path synchronously while the OS drag data store is readable.
      try { var paths = pathsFrom(event.dataTransfer); Promise.resolve(options.onPaths(paths)).catch(options.onError); }
      catch (error) { options.onError(error); }
    }
    var handlers = { dragenter:enter, dragover:over, dragleave:leave, drop:drop, dragend:reset };
    Object.keys(handlers).forEach(function (name) { target.addEventListener(name, handlers[name]); });
    var win = target.defaultView;
    if (win) win.addEventListener('blur', reset);
    return { dispose:function () { reset(); Object.keys(handlers).forEach(function (name) { target.removeEventListener(name, handlers[name]); }); if (win) win.removeEventListener('blur', reset); } };
  }
  root.AEBrowseFileDrop = { bind:bind, pathsFrom:pathsFrom };
})(typeof window === 'object' ? window : this);
