(function () {
  'use strict';
  var byId = function (id) { return document.getElementById(id); };
  var service, bridge, cs, editor, selected = null, assets = [], libraries = [], values = {}, hostInfo = null, context = null;
  var busy = false, searchRevision = 0, libraryRevision = 0, lateTimer = null, pathMode = 'folder';
  var demo = new URLSearchParams(window.location.search).get('demo') === '1';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function status(message, error) { byId('status').textContent = message; byId('status').classList.toggle('error', !!error); }
  function report(error) { var detail = error.diagnostics && error.diagnostics.length ? error.diagnostics.map(function (d) { return d.message; }).join('；') : error.message; status((error.code ? error.code + ' · ' : '') + detail, true); if (bridge && bridge.getState().unconfirmed) awaitLateResult(); }
  function isLocal(asset) { return asset && (asset.kind === 'local.svg' || asset.kind === 'local.image'); }
  function canCreate() { return !busy && bridge && !bridge.getState().busy && !bridge.getState().unconfirmed && selected && selected.valid && (selected.kind === 'ae.nativeShape' || isLocal(selected)) && selected.status !== 'blocked' && context && context.activeComp; }
  function updateButtons() {
    var editing = editor && editor.getState(), locked = busy || !!(bridge && bridge.getState().busy);
    byId('instantiate').disabled = !canCreate();
    byId('instantiate').textContent = editing ? '添加副本到当前合成' : '添加到当前合成';
    byId('read-instance').disabled = locked || !bridge || !context || !context.activeComp;
    byId('search').disabled = locked;
    byId('update-instance').hidden = !editing;
    byId('update-instance').disabled = !editing || !canCreate();
    byId('instance-info').hidden = !editing; byId('update-help').hidden = !editing;
    byId('instance-info').textContent = editing ? '正在编辑：' + editing.instance.layerName + ' · 图层 ' + editing.instance.layerId : '';
    ['add-folder', 'enter-path', 'add-library', 'refresh-library', 'remove-library', 'register-path', 'library', 'refresh-host'].forEach(function (id) { byId(id).disabled = busy || !!(bridge && bridge.getState().busy); });
    Array.prototype.forEach.call(byId('parameters').querySelectorAll('input,select'), function (el) { el.disabled = locked || !!(editing && (el.dataset.parameter === 'motion' || el.dataset.parameter === 'duration')); });
  }
  async function task(body) {
    if (busy) return;
    busy = true; updateButtons();
    try { await body(); } catch (error) { report(error); }
    finally { busy = false; updateButtons(); }
  }
  function diagnostics(items) {
    byId('asset-diagnostics').replaceChildren();
    (items || []).forEach(function (item) {
      var li = document.createElement('li'); li.textContent = item.message; li.className = item.severity;
      li.title = item.code; byId('asset-diagnostics').appendChild(li);
    });
  }
  function preview(target, asset, params, width, height) {
    target.replaceChildren(); target.removeAttribute('style'); target.classList.remove('file-placeholder');
    if (isLocal(asset)) {
      target.style.background = 'transparent'; target.style.width = '100%'; target.style.height = '100%';
      if (asset.previewUrl) { var image = document.createElement('img'); image.className = 'asset-image'; image.src = asset.previewUrl; image.alt = asset.name; target.style.display = 'flex'; target.style.alignItems = 'center'; target.style.justifyContent = 'center'; target.appendChild(image); }
      else { target.classList.add('file-placeholder'); target.textContent = asset.extension.slice(1).toUpperCase(); }
    } else AEBrowsePreview.draw(target, asset, params, width, height);
  }
  function drawPreview() { preview(byId('card-preview'), selected, values, 200, 94); }
  function hex(color) { return '#' + color.slice(0, 3).map(function (value) { return Math.round(value * 255).toString(16).padStart(2, '0'); }).join(''); }
  function numberInput(descriptor, value, changed) {
    var input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = value;
    if (descriptor.min !== undefined) input.min = descriptor.min;
    if (descriptor.max !== undefined) input.max = descriptor.max;
    input.addEventListener('input', function () { changed(input.value === '' ? null : Number(input.value)); drawPreview(); });
    return input;
  }
  function parameters(asset, initial) {
    var form = byId('parameters'); form.replaceChildren(); values = {};
    (asset.parameters || []).forEach(function (descriptor, index) {
      descriptor = clone(descriptor);
      if (initial && Object.prototype.hasOwnProperty.call(initial, descriptor.id)) descriptor.default = clone(initial[descriptor.id]);
      values[descriptor.id] = clone(descriptor.default);
      var row = document.createElement('div'); row.className = 'parameter';
      var label = document.createElement('label'); label.textContent = descriptor.label || descriptor.id;
      var input, extraInput, id = 'param-' + index; label.htmlFor = id; row.appendChild(label);
      function changed(value) { values[descriptor.id] = value; byId('result').textContent = ''; }
      if (descriptor.type === 'number') input = numberInput(descriptor, descriptor.default, changed);
      else if (descriptor.type === 'enum') {
        input = document.createElement('select');
        descriptor.options.forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = { none: '无动画', pop: '缩放入场', slide: '滑入', fade: '淡入' }[value] || value; input.appendChild(option); });
        input.value = descriptor.default; input.addEventListener('change', function () { changed(input.value); drawPreview(); });
      } else if (descriptor.type === 'color') {
        input = document.createElement('input'); input.type = 'color'; input.value = hex(descriptor.default); input.title = '面板选色器（尚未接入 AE 原生选色）';
        input.addEventListener('input', function () { var value = input.value; changed([parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255, values[descriptor.id][3]]); drawPreview(); });
      } else if (descriptor.type === 'boolean') {
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = descriptor.default; input.addEventListener('change', function () { changed(input.checked); });
      } else if (descriptor.type === 'point2') {
        input = numberInput({}, descriptor.default[0], function (value) { var vector = values[descriptor.id].slice(); vector[0] = value; changed(vector); });
        input.setAttribute('aria-label', label.textContent + ' X'); input.title = 'X';
        extraInput = numberInput({}, descriptor.default[1], function (value) { var vector = values[descriptor.id].slice(); vector[1] = value; changed(vector); }); extraInput.setAttribute('aria-label', label.textContent + ' Y'); extraInput.title = 'Y';
      } else {
        input = document.createElement('input'); input.type = 'text'; input.value = descriptor.default; input.addEventListener('input', function () { changed(input.value); });
      }
      input.id = id; input.dataset.parameter = descriptor.id; row.appendChild(input);
      if (extraInput) row.appendChild(extraInput);
      if (descriptor.unit) { var unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = descriptor.unit; row.appendChild(unit); }
      form.appendChild(row);
      if (descriptor.help) { var help = document.createElement('p'); help.className = 'parameter-help'; help.textContent = descriptor.help; form.appendChild(help); }
    });
    drawPreview();
  }
  function selectAsset(asset, initial, keepEditor) {
    if (editor && !keepEditor) editor.reset();
    selected = asset;
    byId('detail').hidden = !asset; byId('detail-empty').hidden = !!asset;
    if (asset) {
      byId('asset-name').textContent = asset.name;
      document.querySelector('.kind').textContent = asset.kind === 'ae.nativeShape' ? '原生形状' : isLocal(asset) ? asset.extension.slice(1).toUpperCase() : '尚未适配';
      byId('asset-help').textContent = asset.help && asset.help.summary || '调整参数后添加到当前合成。';
      diagnostics(asset.diagnostics); byId('result').textContent = '';
      if (asset.valid && asset.status !== 'blocked') parameters(asset, initial);
      else { values = {}; byId('parameters').replaceChildren(); }
      document.querySelector('.preview-stage').hidden = !asset.valid || asset.status === 'blocked';
      document.querySelector('.preview-note').hidden = !asset.valid || asset.status === 'blocked';
      document.querySelector('.preview-note').textContent = isLocal(asset) ? '文件预览 · SVG 复杂效果以 AE 导入结果为准' : '面板近似预览 · 颜色与效果以 AE 为准';
    }
    Array.prototype.forEach.call(byId('grid').children, function (card) { card.classList.toggle('selected', !!asset && card.dataset.id === asset.id); });
    updateButtons();
  }
  async function renderAssets() {
    var revision = ++searchRevision, packId = byId('library').value;
    var found = packId ? await service.listAssets(packId, byId('search').value) : [];
    if (revision !== searchRevision) return;
    assets = found; byId('grid').replaceChildren(); byId('asset-count').textContent = found.length + ' 项';
    byId('empty').hidden = !!found.length;
    byId('empty').textContent = packId ? (byId('search').value ? '没有找到匹配素材。' : '目录暂无可用素材。放入 SVG、PNG、JPG 后点击刷新，或查看目录读取提示。') : '点击“添加文件夹”读取本地 SVG、PNG、JPG；参数图形库使用“添加图形包”。';
    // First-round pagination bounds DOM work; virtual scrolling is a later measured stage.
    var rendered = 0;
    function appendBatch() {
      var limit = Math.min(rendered + 100, assets.length);
      for (; rendered < limit; rendered++) {
        (function (asset) {
          var button = document.createElement('button'); button.type = 'button'; button.className = 'asset-card'; button.dataset.id = asset.id;
          var thumb = document.createElement('div'); thumb.className = 'asset-thumb'; var shape = document.createElement('div'); shape.className = 'thumb-shape'; thumb.appendChild(shape); button.appendChild(thumb);
          var defaults = {}; (asset.parameters || []).forEach(function (parameter) { defaults[parameter.id] = parameter.default; });
          preview(shape, asset, defaults, 76, 46);
          var name = document.createElement('span'); name.className = 'asset-label'; name.textContent = asset.name || asset.id; button.appendChild(name);
          var state = document.createElement('span'); state.className = 'asset-state ' + (asset.status === 'blocked' ? 'blocked' : '');
          state.textContent = asset.status === 'blocked' ? '不可用 · 查看原因' : isLocal(asset) ? asset.extension.slice(1).toUpperCase() + ' · 本地文件' : '参数可编辑'; button.appendChild(state);
          button.title = asset.relativePath || asset.name;
          button.addEventListener('click', function () { if (!busy && !(bridge && bridge.getState().busy)) selectAsset(asset); }); byId('grid').appendChild(button);
        })(assets[rendered]);
      }
      if (rendered < assets.length) {
        var more = document.createElement('button'); more.type = 'button'; more.textContent = '继续显示（剩余 ' + (assets.length - rendered) + ' 项）';
        more.addEventListener('click', function () { more.remove(); appendBatch(); }); byId('grid').appendChild(more);
      }
    }
    appendBatch();
    var retained = selected && found.find(function (asset) { return asset.id === selected.id && asset.packId === selected.packId && asset.fingerprint === selected.fingerprint; });
    if (retained) { selected = retained; Array.prototype.forEach.call(byId('grid').children, function (card) { card.classList.toggle('selected', card.dataset.id === retained.id); }); }
    else selectAsset(found[0] || null);
  }
  async function renderLibraries(preferred) {
    var revision = ++libraryRevision, current = preferred || byId('library').value;
    var found = await service.listLibraries(); if (revision !== libraryRevision) return;
    libraries = found; var select = byId('library'); select.replaceChildren();
    if (!found.length) { var empty = document.createElement('option'); empty.value = ''; empty.textContent = '尚未添加图形库'; select.appendChild(empty); }
    found.forEach(function (library) { var option = document.createElement('option'); option.value = library.id; option.textContent = (library.sourceType === 'folder' ? '文件夹 · ' : '图形包 · ') + library.name + (library.status === 'unavailable' ? ' · 不可用' : ''); option.title = library.directory; select.appendChild(option); });
    if (found.some(function (library) { return library.id === current; })) select.value = current;
    await renderAssets();
    var activeLibrary = found.find(function (library) { return library.id === select.value; });
    byId('library-location').textContent = activeLibrary ? activeLibrary.directory : '支持子文件夹；放入新素材后点击刷新'; byId('library-location').title = byId('library-location').textContent;
    if (activeLibrary && activeLibrary.status !== 'available') status((activeLibrary.diagnostics || []).map(function (d) { return d.message; }).join('；') || '目录无法完整读取，请重新定位或选择子文件夹。', true);
  }
  async function readHost() {
    if (!bridge) return;
    var info = await bridge.request('getHostInfo', null, {});
    if (!info.ok) { var error = new Error(info.diagnostics.map(function (d) { return d.message; }).join('；')); error.code = info.diagnostics[0] && info.diagnostics[0].code; throw error; }
    hostInfo = info.data;
    var result = await bridge.request('getContext', null, {});
    if (!result.ok) throw new Error(result.diagnostics.map(function (d) { return d.message; }).join('；'));
    context = result.data;
    byId('context').textContent = context.activeComp ? '目标：' + context.comp.name + ' · ' + context.comp.width + ' × ' + context.comp.height : '请打开目标合成；图形库仍可浏览';
    updateButtons();
  }
  function awaitLateResult() {
    if (lateTimer) clearTimeout(lateTimer);
    var pendingOperation = bridge.getState().activeOperation;
    function check() {
      var state = bridge.getState(); updateButtons();
      if (!state.busy && !state.unconfirmed) {
        if (pendingOperation === 'updateInstance') {
          if (editor) editor.reset(); updateButtons();
          if (state.lastResult && state.lastResult.ok) status('AE 已完成迟到更新，请重新读取所选实例后继续。');
          else if (state.lastResult) status(state.lastResult.diagnostics.map(function (d) { return d.message; }).join('；'), true);
          lateTimer = null; return;
        }
        if (pendingOperation !== 'instantiateAsset' && pendingOperation !== 'importLocalAsset') { lateTimer = null; task(async function () { await readHost(); status('已恢复宿主连接，请重新读取所选实例。'); }); return; }
        if (state.lastResult && state.lastResult.ok) { status('AE 已返回迟到结果，请确认图层。'); byId('result').textContent = '已收到导入结果 · 图层 ' + state.lastResult.data.layerId; }
        else if (state.lastResult) status(state.lastResult.diagnostics.map(function (d) { return d.message; }).join('；'), true);
        lateTimer = null; return;
      }
      // This observes local bridge state only; no AE polling or automatic retry.
      lateTimer = setTimeout(check, 1000);
    }
    lateTimer = setTimeout(check, 1000);
  }
  byId('search').addEventListener('input', function () { renderAssets().catch(report); });
  byId('read-instance').addEventListener('click', function () {
    task(async function () {
      await readHost();
      var state = await editor.read(Object.assign({}, hostInfo, context));
      byId('library').value = state.asset.packId; byId('search').value = '';
      selectAsset(state.asset, state.instance.parameters, true); await renderAssets();
      status('已读取所选实例，调整外观后点击“更新所选图形”。');
    });
  });
  byId('update-instance').addEventListener('click', function () {
    if (!canCreate() || !editor || !editor.getState()) return;
    var snapshot = clone(values);
    task(async function () {
      await readHost(); status('正在核对实例并更新外观…');
      var state = await editor.apply(snapshot, Object.assign({}, hostInfo, context));
      parameters(state.asset, state.instance.parameters);
      byId('result').textContent = '已更新 · 图层 ' + state.instance.layerId + ' · 原动画已保留';
      status('已更新外观并回读确认。');
    });
  });
  byId('library').addEventListener('change', function () { selectAsset(null); renderLibraries().catch(report); });
  byId('refresh-host').addEventListener('click', function () { task(async function () { await readHost(); status('已刷新 AE 上下文。'); }); });
  function chooseDirectory(mode) {
    pathMode = mode;
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
        var result = window.cep.fs.showOpenDialogEx(false, true, mode === 'folder' ? '选择 SVG / PNG / JPG 素材文件夹' : '选择含 pack.json 的图形库文件夹', '', []);
        if (result.err === 0 && result.data && result.data.length) { task(async function () { var registration = await service[mode === 'folder' ? 'registerFolder' : 'registerLibrary'](result.data[0]); await renderLibraries(registration.library.id); status('已载入目录。放入新素材后点击刷新。'); }); return; }
        if (result.err === 0) return;
      }
    } catch (_) { /* Older CEP builds can use a typed directory path. */ }
    byId('path-label').textContent = mode === 'folder' ? '素材文件夹（SVG / PNG / JPG，含子文件夹）' : '图形包文件夹（含 pack.json）';
    byId('path-entry').hidden = false; byId('library-path').focus();
  }
  byId('add-folder').addEventListener('click', function () { chooseDirectory('folder'); });
  byId('enter-path').addEventListener('click', function () { pathMode = 'folder'; byId('path-label').textContent = '素材文件夹（SVG / PNG / JPG，含子文件夹）'; byId('path-entry').hidden = false; byId('library-path').focus(); });
  byId('add-library').addEventListener('click', function () { chooseDirectory('pack'); });
  byId('cancel-path').addEventListener('click', function () { byId('path-entry').hidden = true; });
  byId('register-path').addEventListener('click', function () { task(async function () { var result = await service[pathMode === 'folder' ? 'registerFolder' : 'registerLibrary'](byId('library-path').value.trim()); await renderLibraries(result.library.id); byId('path-entry').hidden = true; status('目录已载入，源文件保持独立。'); }); });
  byId('library-path').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); byId('register-path').click(); } });
  byId('refresh-library').addEventListener('click', function () { task(async function () { if (!byId('library').value) return; var refreshed; try { refreshed = await service.refreshLibrary(byId('library').value); } finally { await renderLibraries(); } if (refreshed.status === 'available') status('已刷新目录中的素材。'); }); });
  byId('remove-library').addEventListener('click', function () { task(async function () { if (!byId('library').value) return; await service.removeLibrary(byId('library').value); selectAsset(null); await renderLibraries(); status('已移除登记，源图形库文件仍保留。'); }); });
  byId('instantiate').addEventListener('click', function () {
    if (!canCreate()) return;
    var asset = selected, parametersSnapshot = clone(values);
    task(async function () {
      status('正在检查文件与目标合成…');
      await readHost();
      var host = Object.assign({}, hostInfo, context);
      var prepared = await service.prepareAsset(asset.packId, asset.id, asset.fingerprint, host, parametersSnapshot);
      if (asset.kind === 'local.svg') { status('正在准备 SVG 兼容图片…'); prepared.local = await service.attachSVGRaster(prepared.local, await AEBrowseRaster.fromSVG(prepared.svgURL)); }
      var operationId = 'create-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      status('正在添加图形…');
      var response = await bridge.request(isLocal(asset) ? 'importLocalAsset' : 'instantiateAsset', { compId: context.comp.id }, isLocal(asset) ? { local:prepared.local, insertTime:context.comp.time } : { loaded: prepared.loaded, parameters: parametersSnapshot, insertTime: context.comp.time }, { operationId: operationId });
      diagnostics((prepared.diagnostics || []).concat(response.diagnostics || []));
      if (!response.ok) { status(response.diagnostics.map(function (d) { return d.message; }).join('；'), true); return; }
      byId('result').textContent = '已添加 · 图层 ' + response.data.layerId + (response.data.rasterized ? ' · SVG 已通过高清透明图片兼容导入' : isLocal(asset) ? ' · 文件已导入' : ' · 参数已回读');
      status('已完成导入。');
    });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && lateTimer) { clearTimeout(lateTimer); lateTimer = null; } else if (!document.hidden && bridge && bridge.getState().unconfirmed) awaitLateResult(); });
  window.addEventListener('beforeunload', function () { if (lateTimer) clearTimeout(lateTimer); if (bridge) bridge.dispose(); });
  async function start() {
    if (demo) {
      var manifest = window.AEBrowseDemo;
      var entries = manifest.assets.map(function (asset) { return Object.assign({}, asset, { packId: manifest.pack.id, fingerprint: 'demo', valid: true, status: 'needs-host-check', diagnostics: [{ severity: 'warning', message: '界面演示模式：导入按钮关闭。' }] }); });
      service = { listLibraries: async function () { return [{ id: manifest.pack.id, name: manifest.pack.name, directory: 'examples/basic-shapes', status: 'available' }]; }, listAssets: async function (_, query) { return entries.filter(function (asset) { return !query || (asset.name + asset.tags.join(' ')).indexOf(query) >= 0; }); } };
      ['add-folder', 'enter-path', 'add-library', 'refresh-library', 'remove-library', 'refresh-host'].forEach(function (id) { byId(id).hidden = true; });
      byId('context').textContent = '浏览器界面演示 · 未连接 AE'; byId('runtime').textContent = 'UI preview'; await renderLibraries(); status('可查看布局与参数近似预览；实际导入需要 CEP。'); return;
    }
    if (!window.__adobe_cep__ || !window.cep_node || !window.cep_node.require) {
      status('请在 AE 的 CEP 面板中打开；浏览器演示请使用 ?demo=1。', true);
      byId('context').textContent = '未连接 AE'; ['add-folder', 'enter-path', 'add-library', 'refresh-library', 'remove-library', 'refresh-host'].forEach(function (id) { byId(id).disabled = true; }); return;
    }
    cs = new CSInterface(); var req = window.cep_node.require, process = window.cep_node.process, path = req('path');
    var root = cs.getSystemPath(SystemPath.EXTENSION), dataDir = path.join(process.env.APPDATA || cs.getSystemPath(SystemPath.USER_DATA), 'AE Browse');
    service = req(path.join(root, 'cep/node/content-service.cjs')).createContentService({ dataDir: dataDir });
    bridge = AEBrowseBridge.createBridge({ csInterface: cs, timeoutMs: 20000 });
    editor = AEBrowseEditor.createEditor({ bridge: bridge, service: service });
    byId('runtime').textContent = 'Node ' + process.versions.node + ' · Chromium ' + (process.versions.chrome || '待确认');
    await renderLibraries();
    try { await readHost(); status('已连接 AE，选择图形库开始。'); }
    catch (error) { report(error); byId('context').textContent = '宿主连接失败；可继续浏览图形库'; }
    updateButtons();
  }
  start().catch(report);
})();
