'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'dist/AE Browse');
const results = [];
function test(name, fn) { try { fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } }
test('CEP 清单只声明本轮 AE 26 与 CEP 12 目标', () => {
  const manifest = fs.readFileSync(path.join(out, 'CSXS/manifest.xml'), 'utf8');
  assert.match(manifest, /Host Name="AEFT" Version="\[26\.0,27\.0\)"/);
  assert.match(manifest, /RequiredRuntime Name="CSXS" Version="12\.0"/);
  for (const tag of ['MainPath', 'ScriptPath']) {
    const file = manifest.match(new RegExp('<' + tag + '>([^<]+)</' + tag + '>'))[1];
    assert.ok(fs.statSync(path.join(out, file)).isFile());
  }
});
test('构建使用官方 CSInterface 的固定内容', () => {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'cep/vendor/CSInterface.js'))).digest('hex');
  assert.equal(actual, '3c45400984772b88cdf4604b4763a29219f8071fdedb9a1fa19d997349003783');
  assert.ok(fs.statSync(path.join(out, 'cep/vendor/Adobe-SDK-License.pdf')).size > 0);
});
test('所有本地 UI 脚本与样式均在构建内，不使用远程运行依赖', () => {
  const html = fs.readFileSync(path.join(out, 'cep/index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(refs.length >= 4);
  for (const ref of refs) { assert.ok(!/^(https?:|\/\/)/.test(ref)); assert.ok(fs.statSync(path.join(out, 'cep', ref)).isFile()); }
});
test('Node 库服务可以从发布结构加载', () => { assert.equal(typeof require(path.join(out, 'cep/node/library-service.cjs')).createLibraryService, 'function'); });
test('JSX 已合并 JSON、计划与正式分发入口，加载不读包或写 AE 工程', () => {
  const calls = [], context = vm.createContext({ JSON: undefined, app: { beginUndoGroup() { calls.push('undo'); } } });
  vm.runInContext(fs.readFileSync(path.join(out, 'jsx/host.jsx'), 'utf8'), context);
  assert.equal(typeof context.JSON.parse, 'function'); assert.equal(typeof context.AEBrowseHost.dispatch, 'function');
  assert.deepEqual(calls, []);
});
test('浏览器演示包含可复制示例的真实清单', () => {
  const context = vm.createContext({ window: {} }); vm.runInContext(fs.readFileSync(path.join(out, 'cep/ui/demo-data.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.AEBrowseDemo)), JSON.parse(fs.readFileSync(path.join(root, 'examples/basic-shapes/pack.json'), 'utf8')));
});
test('构建清单中的文件指纹都与当前产物一致，测试样例没有打包', () => {
  const info = JSON.parse(fs.readFileSync(path.join(out, 'build-info.json'), 'utf8'));
  for (const file of info.files) { assert.ok(!/^(tests|test-results|examples)\//.test(file.path)); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, file.path))).digest('hex'), file.sha256); }
});
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results/cep-build.json'), JSON.stringify({ category: 'Node package checks; no live CEP or AE', finished: true, finishedAt: new Date().toISOString(), passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results }, null, 2));
console.log('CEP package: ' + results.filter(r => r.passed).length + ' passed, ' + results.filter(r => !r.passed).length + ' failed');
if (results.some(r => !r.passed)) process.exitCode = 1;
