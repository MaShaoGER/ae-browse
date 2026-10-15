'use strict';

// Node-only package/registry/preflight checks. No AE bridge is loaded or called.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLibraryService } = require('../cep/node/library-service.cjs');
const validator = require('../src/pack-validator.cjs');
const root = path.resolve(__dirname, '..');
const template = JSON.parse(fs.readFileSync(path.join(root, 'examples/portable-demo/pack.json'), 'utf8'));
const payloadTemplate = JSON.parse(fs.readFileSync(path.join(root, 'examples/portable-demo/assets/rounded-card.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const host = { aeVersion: '26.0', capabilities: ['shape.create', 'animation.keyframes', 'effect.add'],
  effects: ['ADBE Gaussian Blur 2'], activeComp: true, selectionCount: 0,
  comp: { id: 123, width: 640, height: 360, duration: 3, time: 0.25 } };
const results = [];
let temporary;

async function makePack(name, modify) {
  const directory = path.join(temporary, name);
  await fsp.mkdir(path.join(directory, 'assets'), { recursive: true });
  const manifest = clone(template), payload = clone(payloadTemplate);
  if (modify) modify(manifest, payload);
  await fsp.writeFile(path.join(directory, 'pack.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(directory, 'assets/rounded-card.json'), JSON.stringify(payload, null, 2));
  return { directory, manifest, payload };
}
function service(name) { return createLibraryService({ dataDir: path.join(temporary, name) }); }
async function rewriteManifest(pack) { await fsp.writeFile(path.join(pack.directory, 'pack.json'), JSON.stringify(pack.manifest, null, 2)); }
async function sourceHash(directory) {
  const hash = crypto.createHash('sha256');
  async function visit(current) {
    for (const entry of (await fsp.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else { hash.update(path.relative(directory, full)); hash.update(await fsp.readFile(full)); }
    }
  }
  await visit(directory);
  return hash.digest('hex');
}
async function test(name, body) {
  try { await body(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message, code: error.code }); console.error('FAIL: ' + name + ': ' + error.message); }
}
async function rejects(body, code) { await assert.rejects(body, error => error.code === code); }

async function main() {
  temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'ae-browse-libraries-'));
  try {
    await test('中文路径登记、跨实例恢复与移除保持来源字节不变', async () => {
      const pack = await makePack('中文图形库');
      const before = await sourceHash(pack.directory);
      const first = service('中文用户数据');
      assert.deepEqual(await first.listLibraries(), []);
      const registered = await first.registerLibrary(pack.directory);
      assert.equal(registered.action, 'added');
      assert.equal(registered.library.status, 'available');
      assert.equal(registered.library.fingerprint, validator.fingerprint(pack.directory));
      const second = service('中文用户数据');
      assert.equal((await second.listLibraries())[0].directory, await fsp.realpath(pack.directory));
      assert.equal((await second.listAssets(pack.manifest.pack.id, '圆角 卡片')).length, 1);
      assert.equal((await second.getAsset(pack.manifest.pack.id, 'rounded-card')).status, 'needs-host-check');
      assert.deepEqual(await second.removeLibrary(pack.manifest.pack.id), { removed: true, packId: pack.manifest.pack.id });
      assert.equal((await service('中文用户数据').listLibraries()).length, 0);
      assert.equal(await sourceHash(pack.directory), before);
    });

    await test('完全相同的库复用，并明确记录迁移后的来源目录', async () => {
      const first = await makePack('relocate-original');
      const second = await makePack('relocate-copy');
      const libraries = service('relocate-data');
      await libraries.registerLibrary(first.directory);
      const result = await libraries.registerLibrary(second.directory);
      assert.equal(result.action, 'reused');
      assert.equal(result.reused, true);
      assert.equal((await libraries.listLibraries()).length, 1);
      assert.equal((await service('relocate-data').listLibraries())[0].directory, await fsp.realpath(second.directory));
    });

    await test('同版本内容冲突与不同版本更新均要求明确选择', async () => {
      const first = await makePack('conflict-original');
      const changed = await makePack('conflict-content', (_, payload) => { payload.description = 'different bytes'; });
      const update = await makePack('conflict-version', manifest => { manifest.pack.version = '0.2.0'; });
      const libraries = service('conflict-data');
      const saved = await libraries.registerLibrary(first.directory);
      await rejects(() => libraries.registerLibrary(changed.directory), 'E_PACK_VERSION_CONFLICT');
      await rejects(() => libraries.registerLibrary(update.directory), 'I_PACK_UPDATE_AVAILABLE');
      assert.equal((await libraries.listLibraries())[0].fingerprint, saved.library.fingerprint);
      assert.equal((await libraries.listLibraries())[0].directory, await fsp.realpath(first.directory));
    });

    await test('来源内容变化阻止准备请求，并保留旧登记到明确重新添加', async () => {
      const pack = await makePack('changed-source');
      const libraries = service('changed-data');
      const registered = await libraries.registerLibrary(pack.directory);
      await fsp.appendFile(path.join(pack.directory, 'assets/rounded-card.json'), '\n');
      await rejects(() => libraries.prepareAsset(pack.manifest.pack.id, 'rounded-card', registered.library.fingerprint, host, {}), 'E_PACK_CHANGED');
      await rejects(() => libraries.refreshLibrary(pack.manifest.pack.id), 'E_PACK_VERSION_CONFLICT');
      assert.equal((await libraries.listLibraries())[0].status, 'unavailable');
      assert.equal((await libraries.listLibraries())[0].fingerprint, registered.library.fingerprint);
      const restarted = service('changed-data');
      assert.equal((await restarted.listLibraries())[0].status, 'unavailable');
      await restarted.removeLibrary(pack.manifest.pack.id);
      assert.notEqual((await restarted.registerLibrary(pack.directory)).library.fingerprint, registered.library.fingerprint);
    });

    await test('缺失或失效的来源在重启后保留 unavailable 诊断', async () => {
      const pack = await makePack('missing-source');
      const libraries = service('missing-data');
      await libraries.registerLibrary(pack.directory);
      await fsp.rename(pack.directory, pack.directory + '-removed');
      const missing = (await service('missing-data').listLibraries())[0];
      assert.equal(missing.status, 'unavailable');
      assert.equal(missing.diagnostics[0].code, 'E_PACK_READ');
      const invalid = await makePack('invalid-source');
      const another = service('invalid-data');
      await another.registerLibrary(invalid.directory);
      await fsp.writeFile(path.join(invalid.directory, 'pack.json'), '{ invalid json');
      assert.equal((await service('invalid-data').listLibraries())[0].diagnostics[0].code, 'E_JSON_INVALID');
    });

    await test('单个损坏素材不会阻止同包中的完好素材', async () => {
      const pack = await makePack('isolated-errors', manifest => {
        manifest.assets.push({ ...clone(manifest.assets[0]), id: 'damaged', source: 'assets/damaged.json' });
        manifest.assets.push({ ...clone(manifest.assets[0]), id: 'missing', source: 'assets/missing.json' });
        manifest.assets.push({ ...clone(manifest.assets[0]), id: 'reserved', extensions: JSON.parse('{"vendor":{"constructor":{"invalid":true}}}') });
      });
      await fsp.writeFile(path.join(pack.directory, 'assets/damaged.json'), '{ broken');
      const libraries = service('isolated-data');
      const registered = await libraries.registerLibrary(pack.directory);
      const assets = await libraries.listAssets(pack.manifest.pack.id);
      assert.equal(assets.length, 4);
      assert.equal(assets.find(asset => asset.id === 'rounded-card').valid, true);
      assert.equal(assets.find(asset => asset.id === 'damaged').status, 'blocked');
      assert.equal(assets.find(asset => asset.id === 'missing').status, 'blocked');
      assert.equal(assets.find(asset => asset.id === 'reserved').status, 'blocked');
      const prepared = await libraries.prepareAsset(pack.manifest.pack.id, 'rounded-card', registered.library.fingerprint, host, { width: 420 });
      assert.deepEqual(prepared.plan.size, [420, 180]);
      assert.equal(prepared.loaded.asset.source, 'assets/rounded-card.json');
      assert.equal(own(prepared.loaded, 'directory'), false);
      assert.deepEqual(prepared.loaded.manifest.assets.map(asset => asset.id), ['rounded-card']);
      assert.equal(JSON.stringify(prepared.loaded).includes('constructor'), false);
    });

    await test('不支持的素材类型只阻止自身，并可按类型过滤', async () => {
      const pack = await makePack('unsupported-kind', manifest => {
        manifest.assets.push({ id: 'unknown', name: '未知类型', kind: 'vendor.unknown', source: 'assets/unknown.json' });
        manifest.assets.push({ id: 'footage', name: '静帧', kind: 'ae.footage', source: 'assets/image.png' });
      });
      await fsp.writeFile(path.join(pack.directory, 'assets/unknown.json'), '{}');
      await fsp.writeFile(path.join(pack.directory, 'assets/image.png'), Buffer.from([137, 80, 78, 71]));
      const libraries = service('unsupported-data');
      await libraries.registerLibrary(pack.directory);
      const assets = await libraries.listAssets(null, { kind: 'ae.footage' });
      assert.equal(assets.length, 1);
      assert.equal(assets[0].status, 'blocked');
      assert.ok(assets[0].diagnostics.some(item => item.code === 'E_KIND_UNSUPPORTED'));
      assert.equal((await libraries.listAssets(null, '圆角')).length, 1);
    });

    await test('相对路径穿越与目录链接越界只阻止对应素材', async () => {
      const outside = path.join(temporary, 'outside-files');
      await fsp.mkdir(outside);
      await fsp.writeFile(path.join(outside, 'shape.json'), JSON.stringify(payloadTemplate));
      const pack = await makePack('path-escapes', manifest => {
        manifest.assets.push({ ...clone(manifest.assets[0]), id: 'traversal', source: '../outside-files/shape.json' });
        manifest.assets.push({ ...clone(manifest.assets[0]), id: 'linked', source: 'linked/shape.json' });
      });
      await fsp.symlink(outside, path.join(pack.directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      const libraries = service('escape-data');
      await libraries.registerLibrary(pack.directory);
      const assets = await libraries.listAssets(pack.manifest.pack.id);
      assert.ok(assets.find(asset => asset.id === 'traversal').diagnostics.some(item => item.code === 'E_PATH_INVALID'));
      assert.ok(assets.find(asset => asset.id === 'linked').diagnostics.some(item => item.code === 'E_PATH_ESCAPE'));
      assert.equal(assets.find(asset => asset.id === 'rounded-card').valid, true);
    });

    await test('发送前重做 AE 版本、能力、合成与参数预检', async () => {
      const pack = await makePack('preflight-source');
      const libraries = service('preflight-data');
      const registered = await libraries.registerLibrary(pack.directory);
      const prepare = (actualHost, parameters = {}) => libraries.prepareAsset(pack.manifest.pack.id, 'rounded-card', registered.library.fingerprint, actualHost, parameters);
      await rejects(() => prepare({ ...host, activeComp: false }), 'E_NO_ACTIVE_COMP');
      await rejects(() => prepare({ ...host, aeVersion: '25.0' }), 'E_AE_VERSION_LOW');
      await rejects(() => prepare({ ...host, capabilities: [] }), 'E_CAPABILITY_MISSING');
      await rejects(() => prepare(host, { width: 0 }), 'E_PARAMETER_VALUE');
      await rejects(() => prepare({ ...host, comp: { ...host.comp, time: 2.8 } }), 'E_DURATION_OUTSIDE_COMP');
      await rejects(() => libraries.prepareAsset(pack.manifest.pack.id, 'rounded-card', 'missing', host, {}), 'E_FINGERPRINT_REQUIRED');
      const ready = await prepare(host, { width: 400 });
      assert.deepEqual(ready.plan.position, [320, 180]);
      assert.equal(ready.plan.insertTime, .25);
      assert.deepEqual(ready.plan.size, [400, 180]);
      assert.deepEqual(await prepare(host, { width: 400 }), ready);
    });

    await test('必需效果缺失阻止准备，可选效果缺失允许基础图形', async () => {
      const optional = await makePack('optional-effect');
      const required = await makePack('required-effect', manifest => {
        manifest.pack.id = 'local.effects.required';
        manifest.assets[0].effects[0].required = true;
      });
      const libraries = service('effects-data');
      const first = await libraries.registerLibrary(optional.directory);
      const second = await libraries.registerLibrary(required.directory);
      const degraded = await libraries.prepareAsset(optional.manifest.pack.id, 'rounded-card', first.library.fingerprint, { ...host, effects: [] }, {});
      assert.equal(degraded.plan.effects.length, 0);
      assert.ok(degraded.diagnostics.some(item => item.code === 'W_EFFECT_MISSING'));
      await rejects(() => libraries.prepareAsset(required.manifest.pack.id, 'rounded-card', second.library.fingerprint, { ...host, effects: [] }, {}), 'E_EFFECT_MISSING');
    });

    await test('主登记损坏可从最近成功副本恢复，两者损坏时保留原文件', async () => {
      const pack = await makePack('recovery-source');
      const dataDir = path.join(temporary, 'recovery-data');
      const libraries = createLibraryService({ dataDir });
      await libraries.registerLibrary(pack.directory);
      await fsp.writeFile(path.join(dataDir, 'libraries.json'), '{ corrupted');
      const restored = createLibraryService({ dataDir });
      const list = await restored.listLibraries();
      assert.equal(list.length, 1);
      assert.ok(list[0].diagnostics.some(item => item.code === 'W_REGISTRY_RECOVERED'));
      assert.equal(JSON.parse(await fsp.readFile(path.join(dataDir, 'libraries.json'), 'utf8')).libraries.length, 1);
      await fsp.writeFile(path.join(dataDir, 'libraries.json'), 'broken-main');
      await fsp.writeFile(path.join(dataDir, 'libraries.backup.json'), 'broken-backup');
      await rejects(() => createLibraryService({ dataDir }).listLibraries(), 'E_REGISTRY_CORRUPT');
      assert.equal(await fsp.readFile(path.join(dataDir, 'libraries.json'), 'utf8'), 'broken-main');
    });

    await test('同一实例的并发登记串行保存，且移除不存在的库是幂等操作', async () => {
      const first = await makePack('parallel-first');
      const second = await makePack('parallel-second', manifest => { manifest.pack.id = 'local.motion.second'; });
      const libraries = service('parallel-data');
      await Promise.all([libraries.registerLibrary(first.directory), libraries.registerLibrary(second.directory)]);
      assert.equal((await service('parallel-data').listLibraries()).length, 2);
      assert.deepEqual(await libraries.removeLibrary('not-registered'), { removed: false, packId: 'not-registered' });
      await rejects(() => libraries.getAsset(first.manifest.pack.id, 'absent'), 'E_ASSET_NOT_FOUND');
      await rejects(() => libraries.listAssets('absent'), 'E_LIBRARY_NOT_FOUND');
    });
  } finally {
    // Only the exact mkdtemp directory is removed. Packages here are fixtures.
    const verified = await fsp.realpath(temporary);
    const relative = path.relative(await fsp.realpath(os.tmpdir()), verified);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(verified).startsWith('ae-browse-libraries-'));
    await fsp.rm(verified, { recursive: true, force: true });
  }
  const passed = results.filter(result => result.passed).length;
  const failed = results.length - passed;
  await fsp.mkdir(path.join(root, 'test-results'), { recursive: true });
  await fsp.writeFile(path.join(root, 'test-results/library-service.json'), JSON.stringify({
    finished: true, timestamp: new Date().toISOString(), scope: 'Node-only read-only package snapshots, registry recovery, and host/plan preflight; no AE mutation.',
    passed, failed, results
  }, null, 2));
  console.log(JSON.stringify({ passed, failed, total: results.length }));
  process.exitCode = failed ? 1 : 0;
}
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
main().catch(error => { console.error(error); process.exitCode = 1; });
