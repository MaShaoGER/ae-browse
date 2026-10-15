'use strict';
// Transport mocks only: no CSInterface runtime, AE launch, or project mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'cep/bridge/host-bridge.js'), 'utf8');
const results = [];

function harness(options = {}) {
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    module: { exports: {} }, Promise, Date, Math,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  const calls = [];
  const csInterface = { evalScript(script, callback) {
    let serialized;
    // This evaluates the actual emitted JS in a sealed mock of the fixed dispatcher.
    vm.runInNewContext(script, { AEBrowseHost: { dispatch(json) { serialized = json; } } });
    calls.push({ script, callback, request: JSON.parse(serialized) });
    if (options.throwOnDispatch) { throw new Error('evalScript failed after possible dispatch'); }
  } };
  const bridge = context.module.exports.createBridge({ csInterface, timeoutMs: 20 });
  return {
    bridge, calls,
    timeout() { const pending = [...timers.entries()]; timers.clear(); for (const [, callback] of pending) { callback(); } },
    reply(index, overrides = {}) {
      const call = calls[index];
      call.callback(JSON.stringify({ protocolVersion: 1, requestId: call.request.requestId, ok: true, data: { index }, diagnostics: [], timing: { elapsedMs: 1 }, ...overrides }));
    }
  };
}
function observed(promise) { return promise.then(value => ({ value }), error => ({ error })); }
function errorCode(result, expected) { assert.equal(result.error && result.error.code, expected); }
async function test(name, body) {
  try { await body(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL: ' + name + ': ' + error.stack); }
}

(async function () {
  await test('Node 与浏览器导出相同的桥接入口', () => {
    assert.equal(typeof require('../cep/bridge/host-bridge.js').createBridge, 'function');
    const browser = vm.createContext({ self: {}, Date, Math });
    vm.runInContext(source, browser);
    assert.equal(typeof browser.self.AEBrowseBridge.createBridge, 'function');
  });
  await test('CEP 混合上下文同时暴露浏览器全局与 Node 导出', () => {
    const page = {}, nodeModule = { exports: {} };
    const mixed = vm.createContext({ window: page, self: page, module: nodeModule, Date, Math });
    vm.runInContext(source, mixed);
    assert.equal(typeof page.AEBrowseBridge.createBridge, 'function');
    assert.equal(page.AEBrowseBridge, nodeModule.exports);
  });
  await test('没有 CEP 接口时给出中文错误', () => {
    assert.throws(() => require('../cep/bridge/host-bridge.js').createBridge({}), error => error.code === 'E_BRIDGE_UNAVAILABLE' && /AE/.test(error.message));
  });
  await test('JSON 字符串安全覆盖中文引号路径换行及脚本注入文本', async () => {
    const h = harness();
    const payload = { text: '中文 "\\\n\r\t\u2028\u2029', path: 'D:\\中文 图形库\\source.json', source: '"); malicious(); //', slash: '/' };
    const pending = h.bridge.request('instantiateAsset', { compId: 1 }, payload, { operationId: '稳定-ID' });
    assert.deepEqual(h.calls[0].request.payload, payload);
    assert.equal(h.calls[0].request.operationId, '稳定-ID');
    assert.equal(h.calls[0].request.protocolVersion, 1);
    assert.ok(h.calls[0].script.startsWith('AEBrowseHost.dispatch("'));
    assert.ok(!/[\u2028\u2029]/.test(h.calls[0].script));
    h.reply(0);
    assert.equal((await pending).ok, true);
  });
  await test('请求捕获提交时的数据快照', async () => {
    const h = harness(), payload = { width: 100 };
    const first = h.bridge.request('getContext');
    const second = h.bridge.request('instantiateAsset', null, payload);
    payload.width = 999;
    h.reply(0);
    assert.equal(h.calls[1].request.payload.width, 100);
    h.reply(1);
    await Promise.all([first, second]);
  });
  await test('并行创建请求进入串行队列且通信 ID 独立', async () => {
    const h = harness();
    const first = h.bridge.request('instantiateAsset', { compId: 1 }, {}, { operationId: '用户操作-1' });
    const second = h.bridge.request('instantiateAsset', { compId: 1 }, {}, { operationId: '用户操作-2' });
    assert.equal(h.calls.length, 1);
    assert.equal(h.bridge.getState().queued, 1);
    assert.equal(h.bridge.getState().busy, true);
    h.reply(0);
    assert.equal(h.calls.length, 2);
    assert.notEqual(h.calls[0].request.requestId, h.calls[1].request.requestId);
    assert.equal(h.calls[1].request.operationId, '用户操作-2');
    h.reply(1);
    await Promise.all([first, second]);
    assert.equal(h.bridge.getState().busy, false);
  });
  await test('宿主业务错误以 ok:false 结果返回', async () => {
    const h = harness();
    const pending = h.bridge.request('getContext');
    h.reply(0, { ok: false, data: null, diagnostics: [{ code: 'E_NO_ACTIVE_COMP', message: '没有活动合成。' }] });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'E_NO_ACTIVE_COMP');
    assert.equal(h.bridge.getState().unconfirmed, false);
  });
  await test('写入超时保留宿主锁并等待迟到结果且不自动重试', async () => {
    const h = harness();
    const first = observed(h.bridge.request('instantiateAsset', { compId: 1 }, {}, { operationId: '稳定操作' }));
    const second = h.bridge.request('getContext');
    h.timeout();
    errorCode(await first, 'E_BRIDGE_TIMEOUT');
    assert.equal(h.bridge.getState().busy, true);
    assert.equal(h.bridge.getState().unconfirmed, true);
    assert.equal(h.bridge.recover().unconfirmed, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].request.operationId, '稳定操作');
    h.reply(0, { data: { layerId: 42 } });
    assert.equal(h.bridge.getState().lastResult.data.layerId, 42);
    assert.equal(h.bridge.getState().unconfirmed, false);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].request.operation, 'getContext');
    h.reply(1);
    await second;
  });
  await test('读取超时也等待活动 AE 调用返回后才继续', async () => {
    const h = harness();
    const first = observed(h.bridge.request('getHostInfo'));
    const second = h.bridge.request('getContext');
    h.timeout();
    errorCode(await first, 'E_BRIDGE_TIMEOUT');
    assert.equal(h.calls.length, 1);
    h.reply(0);
    assert.equal(h.calls.length, 2);
    h.reply(1);
    await second;
  });
  await test('未知请求 ID 与重复旧回调不能解锁当前请求', async () => {
    const h = harness();
    const first = h.bridge.request('getContext');
    const second = h.bridge.request('getContext');
    h.reply(0, { requestId: 'unknown-request' });
    assert.equal(h.calls.length, 1);
    h.reply(0);
    await first;
    assert.equal(h.calls.length, 2);
    const oldResult = h.bridge.getState().lastResult.requestId;
    h.reply(0, { data: { stale: true } });
    assert.equal(h.bridge.getState().lastResult.requestId, oldResult);
    assert.equal(h.bridge.getState().busy, true);
    h.reply(1);
    await second;
  });
  await test('无法解析的写入回调阻止后续调用直到有效结果', async () => {
    const h = harness();
    const first = observed(h.bridge.request('instantiateAsset', null, {}));
    const second = h.bridge.request('getContext');
    h.calls[0].callback('not JSON');
    errorCode(await first, 'E_BRIDGE_PROTOCOL');
    assert.equal(h.bridge.recover().unconfirmed, true);
    assert.equal(h.calls.length, 1);
    h.reply(0);
    assert.equal(h.calls.length, 2);
    h.reply(1);
    await second;
  });
  await test('不完整写入协议保留待确认状态', async () => {
    const h = harness();
    const pending = observed(h.bridge.request('instantiateAsset', null, {}));
    h.calls[0].callback(JSON.stringify({ requestId: h.calls[0].request.requestId, ok: true }));
    errorCode(await pending, 'E_BRIDGE_PROTOCOL');
    assert.equal(h.bridge.getState().unconfirmed, true);
    h.reply(0);
  });
  await test('已返回的只读无效协议解除活动锁并报告错误', async () => {
    const h = harness();
    const first = observed(h.bridge.request('getContext'));
    const second = h.bridge.request('getHostInfo');
    h.calls[0].callback('EvalScript error.');
    errorCode(await first, 'E_BRIDGE_PROTOCOL');
    assert.equal(h.calls.length, 2);
    h.reply(1);
    await second;
  });
  await test('CEP evalScript 错误文本不能确认写入结果', async () => {
    const h = harness();
    const pending = observed(h.bridge.request('instantiateAsset'));
    h.calls[0].callback('EvalScript error.');
    errorCode(await pending, 'E_BRIDGE_PROTOCOL');
    assert.equal(h.bridge.getState().unconfirmed, true);
    h.reply(0);
  });
  await test('evalScript 同步抛错也不能证明 AE 未执行', async () => {
    const h = harness({ throwOnDispatch: true });
    const first = observed(h.bridge.request('instantiateAsset'));
    const second = observed(h.bridge.request('getContext'));
    errorCode(await first, 'E_BRIDGE_PROTOCOL');
    assert.equal(h.bridge.getState().unconfirmed, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.bridge.recover().busy, true);
    h.bridge.dispose();
    errorCode(await second, 'E_BRIDGE_CANCELLED');
    h.reply(0);
  });
  await test('迟到宿主失败结果可回读且不触发创建重试', async () => {
    const h = harness();
    const pending = observed(h.bridge.request('instantiateAsset'));
    h.timeout();
    errorCode(await pending, 'E_BRIDGE_TIMEOUT');
    h.reply(0, { ok: false, data: null, diagnostics: [{ code: 'E_TARGET_CHANGED', message: '目标变化。' }] });
    assert.equal(h.bridge.getState().busy, false);
    assert.equal(h.bridge.getState().lastResult.ok, false);
    assert.equal(h.calls.length, 1);
  });
  await test('取消只撤销尚未派发的队列项', async () => {
    const h = harness();
    const first = h.bridge.request('getContext');
    const second = h.bridge.request('instantiateAsset');
    const outcome = observed(second);
    assert.equal(first.cancel(), false);
    assert.equal(second.cancel(), true);
    assert.equal(second.cancel(), false);
    errorCode(await outcome, 'E_BRIDGE_CANCELLED');
    h.reply(0);
    await first;
    assert.equal(h.calls.length, 1);
  });
  await test('批量取消队列不影响已经执行的请求', async () => {
    const h = harness();
    const first = h.bridge.request('getContext');
    const second = observed(h.bridge.request('instantiateAsset'));
    const third = observed(h.bridge.request('instantiateAsset'));
    assert.equal(h.bridge.cancelQueued(), 2);
    errorCode(await second, 'E_BRIDGE_CANCELLED');
    errorCode(await third, 'E_BRIDGE_CANCELLED');
    assert.equal(h.bridge.getState().busy, true);
    h.reply(0);
    await first;
  });
  await test('关闭桥接拒绝未完成请求且不会派发队列或新请求', async () => {
    const h = harness();
    const first = observed(h.bridge.request('instantiateAsset'));
    const second = observed(h.bridge.request('getContext'));
    assert.equal(h.bridge.dispose().disposed, true);
    assert.equal(h.bridge.getState().busy, true);
    errorCode(await first, 'E_BRIDGE_DISPOSED');
    errorCode(await second, 'E_BRIDGE_CANCELLED');
    errorCode(await observed(h.bridge.request('getContext')), 'E_BRIDGE_DISPOSED');
    h.reply(0);
    assert.equal(h.bridge.getState().busy, false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.bridge.dispose().disposed, true);
  });
  await test('循环数据和无效操作在进入宿主前失败', async () => {
    const h = harness(), circular = {};
    circular.self = circular;
    errorCode(await observed(h.bridge.request('instantiateAsset', null, circular)), 'E_BRIDGE_REQUEST');
    errorCode(await observed(h.bridge.request('', null, {})), 'E_BRIDGE_REQUEST');
    errorCode(await observed(h.bridge.request('instantiateAsset', null, {}, { operationId: '' })), 'E_BRIDGE_REQUEST');
    assert.equal(h.calls.length, 0);
    assert.equal(h.bridge.getState().busy, false);
  });
  const passed = results.filter(result => result.passed).length, failed = results.length - passed;
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-results/host-bridge.json'), JSON.stringify({ finished: true, timestamp: new Date().toISOString(), scope: 'Node-only mock CEP evalScript transport; no AE access or project mutation.', passed, failed, results }, null, 2));
  console.log(JSON.stringify({ passed, failed, total: results.length }));
  process.exitCode = failed ? 1 : 0;
}()).catch(error => { console.error(error.stack); process.exitCode = 1; });
