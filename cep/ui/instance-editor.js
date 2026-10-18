/* Snapshot-bound editing state shared by the CEP panel and Node contract tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AEBrowseEditor = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function fail(code, message) { throw Object.assign(new Error(message), { code: code }); }
  function data(response) {
    if (!response.ok) {
      var diagnostics = response.diagnostics || [];
      throw Object.assign(new Error(diagnostics.map(function (d) { return d.message; }).join('；')), {
        code: diagnostics[0] && diagnostics[0].code, diagnostics: diagnostics
      });
    }
    return response.data;
  }
  function createEditor(options) {
    var state = null, revision = 0, service = options.service, bridge = options.bridge;
    function reset() { state = null; revision++; }
    function getState() { return state ? clone(state) : null; }
    async function read(host) {
      reset(); var reading = revision;
      if (!host || !host.activeComp) fail('E_NO_ACTIVE_COMP', '请先打开目标合成并选择一个 AE Browse 图层。');
      var instance = data(await bridge.request('getSelectedInstance', { compId: host.comp.id }, {}));
      if (instance.modified) fail('E_INSTANCE_MODIFIED', '所选实例已有手工修改，当前入口保留这些修改，不自动更新。');
      var libraries = await service.listLibraries();
      var library = libraries.find(function (item) { return item.id === instance.packId; });
      if (!library) fail('E_LIBRARY_NOT_FOUND', '请先登记这个实例的来源图形库。');
      if (library.version !== instance.packVersion) fail('E_INSTANCE_SOURCE_CHANGED', '来源图形库版本与实例不一致，请登记创建时的版本。');
      var asset = await service.getAsset(instance.packId, instance.assetId);
      if (!asset.valid || asset.status === 'blocked') fail('E_ASSET_BLOCKED', '实例来源素材当前不可用，请刷新图形库查看原因。');
      if (reading !== revision) fail('E_EDITOR_CHANGED', '读取期间素材选择已改变，请重新读取。');
      state = { instance: clone(instance), asset: clone(asset) };
      return getState();
    }
    async function apply(parameters, host) {
      if (!state) fail('E_EDITOR_EMPTY', '请先读取所选实例。');
      var bound = clone(state), applying = revision;
      if (!host || !host.activeComp || host.comp.id !== bound.instance.compId) fail('E_CONTEXT_CHANGED', '当前合成已经改变，请重新读取所选实例。');
      try {
        // The timeline may have moved since creation; validate animation at its original insertion time.
        var preflightHost = clone(host); preflightHost.comp.time = bound.instance.insertTime;
        var prepared = await service.prepareAsset(bound.asset.packId, bound.asset.id, bound.asset.fingerprint, preflightHost, clone(parameters));
        if (applying !== revision) fail('E_EDITOR_CHANGED', '预检期间素材选择已改变，未发送更新。');
        if (prepared.loaded.manifest.pack.version !== bound.instance.packVersion) fail('E_INSTANCE_SOURCE_CHANGED', '来源图形库版本已变化，请重新读取。');
        var target = { compId: bound.instance.compId, layerId: bound.instance.layerId, instanceId: bound.instance.instanceId };
        var instance = data(await bridge.request('updateInstance', target, { loaded: prepared.loaded, parameters: clone(parameters),
          expected: { parameters: bound.instance.parameters, observed: bound.instance.observed } }));
        if (applying !== revision) fail('E_EDITOR_CHANGED', '更新结果已返回，请重新读取当前所选实例。');
        state = { instance: clone(instance), asset: bound.asset };
        return getState();
      } catch (error) { reset(); throw error; }
    }
    return { read: read, apply: apply, reset: reset, getState: getState };
  }
  return { createEditor: createEditor };
}));
