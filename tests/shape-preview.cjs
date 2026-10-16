'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), context = vm.createContext({ window: {} });
const file = path.join(root, 'cep/ui/shape-preview.js');
if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const results = [];
function test(name, fn) { try { fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } }
function style(type, values) {
  assert.ok(context.window.AEBrowsePreview, 'Shape previews must support the new library');
  return JSON.parse(JSON.stringify(context.window.AEBrowsePreview.style(type, values, 200, 100)));
}
test('圆形以直径保持等宽等高，切换图形时清理旧裁剪', () => {
  const s = style('ellipse', { diameter: 180, color: [1, .5, 0, 1] });
  assert.equal(s.width, '100px'); assert.equal(s.height, '100px'); assert.equal(s.borderRadius, '50%'); assert.equal(s.clipPath, 'none');
});
test('椭圆保留宽高比例', () => { const s = style('ellipse', { width: 240, height: 120 }); assert.equal(s.width, '200px'); assert.equal(s.height, '100px'); });
test('四边形旋转零度的预览顶点与 AE 朝向一致', () => {
  assert.equal(style('polygon', { points: 4, outerRadius: 100, rotation: 0 }).clipPath, 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)');
});
test('五角星使用交替半径的十个顶点', () => {
  const clip = style('star', { points: 5, outerRadius: 100, innerRadius: 50, rotation: 0 }).clipPath;
  assert.equal(clip.split(',').length, 10); assert.ok(clip.startsWith('polygon(50% 0%,64.695% 29.775%'));
});
test('非法输入不会产生无限尺寸或无限顶点循环', () => {
  const s = style('star', { points: 1e9, outerRadius: -1, innerRadius: NaN, rotation: Infinity });
  assert.ok(!JSON.stringify(s).match(/NaN|Infinity/)); assert.ok(s.clipPath.split(',').length <= 128);
});
const passed = results.filter(r => r.passed).length, failed = results.length - passed;
fs.writeFileSync(path.join(root, 'test-results/shape-preview.json'), JSON.stringify({ finished: true, timestamp: new Date().toISOString(), scope: 'Node preview geometry only; no browser, CEP or AE access.', passed, failed, results }, null, 2));
console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
