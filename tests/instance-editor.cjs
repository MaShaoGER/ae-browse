'use strict';
// Node-only state/transport contract checks. No live AE or browser process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEditor } = require('../cep/ui/instance-editor.js');
const clone = value => JSON.parse(JSON.stringify(value));
const original = { compId: 7, layerId: 101, instanceId: 'instance-1', packId: 'demo', packVersion: '0.1.0', assetId: 'card',
  insertTime: .5, parameters: { width: 320, duration: .6, motion: 'pop' }, observed: { size: [320,180], animation: [{ keys: [0,.6] }] }, modified: false };
const host = { activeComp: true, comp: { id: 7, width: 640, height: 360, duration: 4, time: 3.9 }, effects: [] };
function harness() {
  const sent = [], prepared = [];
  let read = clone(original), updateFailure = null, duringPrepare;
  const bridge = { async request(operation, target, payload) {
    sent.push(clone({ operation, target, payload }));
    if (operation === 'getSelectedInstance') return { ok: true, data: clone(read) };
    if (updateFailure) throw Object.assign(new Error('timeout'), { code: updateFailure });
    return { ok: true, data: { ...clone(original), parameters: clone(payload.parameters), observed: { size: [460,180] } } };
  } };
  const service = {
    async listLibraries() { return [{ id: 'demo', version: '0.1.0' }]; },
    async getAsset() { return { id: 'card', packId: 'demo', fingerprint: 'fingerprint', valid: true, status: 'ready' }; },
    async prepareAsset(packId, assetId, fingerprint, context, parameters) {
      prepared.push(clone({ context, parameters })); if (duringPrepare) duringPrepare();
      return { loaded: { manifest: { pack: { version: '0.1.0' } } }, diagnostics: [] };
    }
  };
  return { editor: createEditor({ bridge, service }), sent, prepared,
    readAs(value) { read = clone(value); }, failUpdate(code) { updateFailure = code; }, onPrepare(fn) { duringPrepare = fn; } };
}
const results = [];
async function test(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch(e) { results.push({ name, passed: false, error: e.stack }); console.error(name + ': ' + e.message); } }
(async function () {
  await test('Read binds an immutable snapshot to the selected tool instance', async () => {
    const h = harness(), read = await h.editor.read(host);
    assert.equal(read.instance.layerId, 101);
    read.instance.parameters.width = 999;
    assert.equal(h.editor.getState().instance.parameters.width, 320);
    assert.equal(h.sent[0].operation, 'getSelectedInstance');
    assert.deepEqual(h.sent[0].target, { compId: 7 });
  });
  await test('Apply sends the bound identity and old snapshot and preflights at original insert time', async () => {
    const h = harness(); await h.editor.read(host);
    const result = await h.editor.apply({ width: 460, duration: .6, motion: 'pop' }, host);
    assert.equal(result.instance.parameters.width, 460);
    assert.deepEqual(h.sent[1].target, { compId: 7, layerId: 101, instanceId: 'instance-1' });
    assert.equal(h.sent[1].payload.expected.parameters.width, 320);
    assert.equal(h.prepared[0].context.comp.time, .5);
    assert.equal(host.comp.time, 3.9);
    assert.deepEqual(h.editor.getState().instance.observed.size, [460,180]);
  });
  await test('Switching comp or clearing the editor prevents sending an update', async () => {
    const h = harness(); await h.editor.read(host);
    await assert.rejects(h.editor.apply({}, { ...host, comp: { ...host.comp, id: 8 } }), e => e.code === 'E_CONTEXT_CHANGED');
    h.editor.reset();
    await assert.rejects(h.editor.apply({}, host), e => e.code === 'E_EDITOR_EMPTY');
    assert.equal(h.sent.length, 1);
  });
  await test('Unavailable source version and manual modifications cannot become editable', async () => {
    for (const [change, code] of [[{ packVersion: '0.2.0' }, 'E_INSTANCE_SOURCE_CHANGED'], [{ modified: true }, 'E_INSTANCE_MODIFIED']]) {
      const h = harness(); h.readAs({ ...original, ...change });
      await assert.rejects(h.editor.read(host), e => e.code === code);
      assert.equal(h.editor.getState(), null);
      assert.equal(h.sent.length, 1);
    }
  });
  await test('A timeout clears editable state and cannot cause an automatic write retry', async () => {
    const h = harness(); await h.editor.read(host); h.failUpdate('E_BRIDGE_TIMEOUT');
    await assert.rejects(h.editor.apply({ width: 460 }, host), e => e.code === 'E_BRIDGE_TIMEOUT');
    assert.equal(h.editor.getState(), null);
    await assert.rejects(h.editor.apply({ width: 460 }, host), e => e.code === 'E_EDITOR_EMPTY');
    assert.equal(h.sent.length, 2);
  });
  await test('Clearing the editor during preflight stops the queued write', async () => {
    const h = harness(); await h.editor.read(host); h.onPrepare(() => h.editor.reset());
    await assert.rejects(h.editor.apply({ width: 460 }, host), e => e.code === 'E_EDITOR_CHANGED');
    assert.equal(h.sent.length, 1);
  });
  const passed = results.filter(r => r.passed).length, failed = results.length - passed;
  fs.writeFileSync(path.join(__dirname, '../test-results/instance-editor.json'), JSON.stringify({ finished: true, timestamp: new Date().toISOString(), scope: 'Node-only editor contract; no live AE.', passed, failed, results }, null, 2));
  console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
})();
