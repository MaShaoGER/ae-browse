/* Fixed JSON-only CEP transport. A timeout cannot cancel AE's active call. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  // CEP mixed-context pages also expose Node's module; the browser global is
  // still required by the panel script regardless of that Node export.
  if (root) { root.AEBrowseBridge = api; }
}(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null, function () {
  'use strict';
  var serial = 0;
  var session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var readOperations = { getHostInfo: true, getContext: true, readInstance: true, captureAsset: true };

  function nextId(kind) { serial += 1; return kind + '-' + session + '-' + serial; }
  function bridgeError(code, message, requestId) {
    var error = new Error(message);
    error.code = code;
    error.requestId = requestId || null;
    error.diagnostics = [{ severity: 'error', code: code, message: message }];
    return error;
  }
  function scriptFor(serialized) {
    // JSON is passed as a string argument, never evaluated as package source.
    var argument = JSON.stringify(serialized).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return 'AEBrowseHost.dispatch(' + argument + ')';
  }
  function createBridge(options) {
    options = options || {};
    var csInterface = options.csInterface;
    if (!csInterface || typeof csInterface.evalScript !== 'function') {
      throw bridgeError('E_BRIDGE_UNAVAILABLE', 'CEP 宿主桥不可用，请在 AE 扩展面板内打开。');
    }
    var timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;
    if (typeof timeoutMs !== 'number' || !isFinite(timeoutMs) || timeoutMs <= 0) {
      throw bridgeError('E_BRIDGE_REQUEST', '宿主请求超时时间必须是正数。');
    }
    var queue = [], active = null, disposed = false, lastResult = null;

    function getState() {
      return {
        busy: active !== null,
        unconfirmed: !!(active && active.unconfirmed),
        queued: queue.length,
        disposed: disposed,
        lastResult: lastResult,
        activeRequestId: active ? active.requestId : null,
        activeOperation: active ? active.operation : null
      };
    }
    function settle(entry, error, result) {
      if (entry.settled) { return; }
      entry.settled = true;
      if (error) { entry.reject(error); }
      else { entry.resolve(result); }
    }
    function clearTimer(entry) {
      if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
    }
    function finish(entry) {
      clearTimer(entry);
      if (active === entry) { active = null; }
      pump();
    }
    function protocolFailure(entry, message) {
      clearTimer(entry);
      settle(entry, bridgeError('E_BRIDGE_PROTOCOL', message, entry.requestId));
      if (entry.mutation) {
        // A returned but unreadable write result leaves the mutation's outcome unknown.
        entry.unconfirmed = true;
      } else { finish(entry); }
    }
    function callback(entry, raw) {
      if (active !== entry) { return; }
      var result;
      try {
        if (typeof raw !== 'string' || /^\s*EvalScript error\.?\s*$/i.test(raw)) { throw new Error('transport'); }
        result = JSON.parse(raw);
      } catch (_) {
        protocolFailure(entry, 'AE 返回内容无法读取；写入结果需要确认，请勿重复添加。');
        return;
      }
      // A callback bearing another request's identity must never unlock this request.
      if (result && typeof result === 'object' && typeof result.requestId === 'string' && result.requestId !== entry.requestId) { return; }
      if (!result || typeof result !== 'object' || result.protocolVersion !== 1 ||
          result.requestId !== entry.requestId || typeof result.ok !== 'boolean' ||
          !Array.isArray(result.diagnostics) || !result.timing || typeof result.timing !== 'object' || Array.isArray(result.timing) ||
          !Object.prototype.hasOwnProperty.call(result, 'data')) {
        protocolFailure(entry, 'AE 返回的协议不完整；写入结果需要确认，请勿重复添加。');
        return;
      }
      var normalized = {
        protocolVersion: 1,
        requestId: result.requestId,
        ok: result.ok,
        data: result.data,
        diagnostics: result.diagnostics,
        timing: result.timing
      };
      lastResult = normalized;
      settle(entry, null, normalized);
      finish(entry);
    }
    function pump() {
      if (disposed || active || !queue.length) { return; }
      var entry = queue.shift();
      active = entry;
      entry.timer = setTimeout(function () {
        if (active !== entry) { return; }
        entry.timer = null;
        entry.unconfirmed = true;
        settle(entry, bridgeError('E_BRIDGE_TIMEOUT', 'AE 尚未返回结果，请等待确认；超时不会停止 AE，请勿重复添加。', entry.requestId));
        // Keep the host lock, including for reads: AE might still be executing.
      }, timeoutMs);
      try {
        csInterface.evalScript(entry.script, function (raw) { callback(entry, raw); });
      } catch (_) {
        // evalScript can throw after dispatch; its throw does not prove AE stopped.
        clearTimer(entry);
        entry.unconfirmed = true;
        settle(entry, bridgeError('E_BRIDGE_PROTOCOL', '宿主通信发生异常，AE 是否完成尚未确认，请勿重复添加。', entry.requestId));
      }
    }
    function cancelEntry(entry, reason) {
      var index = queue.indexOf(entry);
      if (index === -1) { return false; }
      queue.splice(index, 1);
      settle(entry, bridgeError('E_BRIDGE_CANCELLED', reason || '尚未执行的宿主请求已取消。', entry.requestId));
      return true;
    }
    function request(operation, target, payload, requestOptions) {
      requestOptions = requestOptions || {};
      var entry, promise;
      if (disposed) { return Promise.reject(bridgeError('E_BRIDGE_DISPOSED', '宿主桥已关闭。')); }
      if (typeof operation !== 'string' || !operation) { return Promise.reject(bridgeError('E_BRIDGE_REQUEST', '宿主操作名称不能为空。')); }
      var requestId = nextId('request');
      var mutation = !Object.prototype.hasOwnProperty.call(readOperations, operation);
      var envelope = { protocolVersion: 1, requestId: requestId, operation: operation, target: target === undefined ? null : target, payload: payload === undefined ? {} : payload };
      if (mutation || requestOptions.operationId !== undefined) {
        envelope.operationId = requestOptions.operationId === undefined ? nextId('operation') : requestOptions.operationId;
        if (typeof envelope.operationId !== 'string' || !envelope.operationId) { return Promise.reject(bridgeError('E_BRIDGE_REQUEST', '写入操作 ID 不能为空。', requestId)); }
      }
      var script;
      try { script = scriptFor(JSON.stringify(envelope)); }
      catch (_) { return Promise.reject(bridgeError('E_BRIDGE_REQUEST', '宿主请求无法编码为 JSON。', requestId)); }
      promise = new Promise(function (resolve, reject) {
        entry = { requestId: requestId, operation: operation, mutation: mutation, script: script, resolve: resolve, reject: reject, settled: false, unconfirmed: false, timer: null };
      });
      promise.cancel = function (reason) { return cancelEntry(entry, reason); };
      promise.requestId = requestId;
      queue.push(entry);
      pump();
      return promise;
    }
    function cancelQueued(reason) {
      var count = queue.length;
      while (queue.length) { cancelEntry(queue[0], reason); }
      return count;
    }
    function recover() {
      // Recovery is observation only. A callback is the evidence that releases a lock.
      return getState();
    }
    function dispose() {
      if (disposed) { return getState(); }
      disposed = true;
      cancelQueued('面板已关闭，尚未执行的宿主请求已取消。');
      if (active) {
        clearTimer(active);
        active.unconfirmed = true;
        settle(active, bridgeError('E_BRIDGE_DISPOSED', '面板已关闭；已执行的 AE 请求仍可能完成。', active.requestId));
      }
      return getState();
    }
    return { request: request, getState: getState, recover: recover, cancelQueued: cancelQueued, dispose: dispose };
  }
  return { createBridge: createBridge };
}));
