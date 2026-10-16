'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/portable-demo/pack.json'), 'utf8'));
const asset = manifest.assets[0];
const payload = JSON.parse(fs.readFileSync(path.join(root, 'examples/portable-demo', asset.source), 'utf8'));
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'src/native-shape-plan.jsxinc'), 'utf8'), context);
const clone = value => JSON.parse(JSON.stringify(value));
const host = { width: 640, height: 360, duration: 3, insertTime: 0, installedEffects: ['ADBE Gaussian Blur 2'] };
function plan(overrides = {}, options = {}) {
  const script = 'AEBrowsePlan.plan(' + [options.asset || asset, options.payload || payload, overrides, options.host || host].map(value => 'JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')').join(',') + ')';
  return JSON.parse(JSON.stringify(vm.runInContext(script, context)));
}
const results = [];
function test(name, body) { try { body(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL: ' + name + ': ' + error.message); } }
function rejects(body, code) { assert.throws(body, error => error.code === code); }
test('默认图形参数从包文件而来', () => { const p = plan(); assert.deepEqual(p.size, [320, 180]); assert.equal(p.radius, 24); assert.equal(p.animation.values.length, 3); });
test('外观参数覆盖可编译', () => assert.deepEqual(plan({ width: 420, height: 240, radius: 34 }).size, [420, 240]));
test('横向与竖向合成使用各自的中心位置', () => { assert.deepEqual(plan().position, [320, 180]); assert.deepEqual(plan({}, { host: { ...host, width: 360, height: 640 } }).position, [180, 320]); });
test('入场时间为相对插入时间', () => { const p = plan({}, { host: { ...host, insertTime: 1 } }); assert.equal(p.insertTime, 1); assert.equal(p.duration, .6); });
for (const motion of ['none', 'pop', 'slide', 'fade']) test('动画选择：' + motion, () => { const p = plan({ motion }); assert.equal(p.motion, motion); assert.equal(p.animation === null, motion === 'none'); });
for (const overrides of [{ width: 0 }, { width: 5000 }, { height: '200' }, { radius: -1 }, { color: [1, 0, 0] }, { duration: 0 }, { motion: 'absent' }]) test('非法参数被预检拒绝：' + JSON.stringify(overrides), () => rejects(() => plan(overrides), 'E_PARAMETER_VALUE'));
test('未知参数被拒绝', () => rejects(() => plan({ unrecognized: 1 }), 'E_PARAMETER_UNKNOWN'));
test('时长超过合成被拒绝', () => rejects(() => plan({ duration: 4 }), 'E_DURATION_OUTSIDE_COMP'));
test('负插入时间被拒绝', () => rejects(() => plan({}, { host: { ...host, insertTime: -1 } }), 'E_INSERT_TIME'));
test('没有可用合成时拒绝生成', () => rejects(() => plan({}, { host: { ...host, width: 0 } }), 'E_NO_ACTIVE_COMP'));
test('未知 payload 版本被拒绝', () => { const p = clone(payload); p.formatVersion = 2; rejects(() => plan({}, { payload: p }), 'E_PAYLOAD_VERSION'); });
test('重复节点 ID 被拒绝', () => { const p = clone(payload); p.nodes[1].id = p.nodes[0].id; rejects(() => plan({}, { payload: p }), 'E_NODE_ID'); });
test('父节点引用不存在被拒绝', () => { const p = clone(payload); p.nodes[1].parent = 'absent'; rejects(() => plan({}, { payload: p }), 'E_NODE_GRAPH'); });
test('额外或未知节点需要其他适配器', () => { const p = clone(payload); p.nodes.push({ id: 'other', type: 'vendor.path' }); rejects(() => plan({}, { payload: p }), 'E_NODE_KIND_UNSUPPORTED'); });
test('缺失参数绑定被拒绝', () => { const p = clone(payload); p.nodes[1].roundness.bind = 'absent'; rejects(() => plan({}, { payload: p }), 'E_BINDING_MISSING'); });
test('错误尺寸绑定被拒绝', () => { const p = clone(payload); p.nodes[1].size.bind = ['width', 'color']; rejects(() => plan({}, { payload: p }), 'E_GEOMETRY_VALUE'); });
test('状态引用不存在的参数被拒绝', () => { const p = clone(payload); p.states[0].parameters.unknown = 3; rejects(() => plan({}, { payload: p }), 'E_STATE_PARAMETER'); });
test('动画目标不存在被拒绝', () => { const p = clone(payload); p.animations[0].target = 'absent'; rejects(() => plan({}, { payload: p }), 'E_ANIMATION_FORMAT'); });
test('动画数值维度不匹配被拒绝', () => { const p = clone(payload); p.animations[0].values[0] = [0]; rejects(() => plan({}, { payload: p }), 'E_ANIMATION_VALUE'); });
test('保留字段不会进入参数合并', () => { const overrides = JSON.parse('{"__proto__":{"polluted":true}}'); rejects(() => plan(overrides), 'E_RESERVED_KEY'); assert.equal({}.polluted, undefined); });
test('必需效果缺失阻止生成', () => { const a = clone(asset); a.effects[0].required = true; rejects(() => plan({}, { asset: a, host: { ...host, installedEffects: [] } }), 'E_EFFECT_MISSING'); });
test('可选效果缺失允许降级', () => { const p = plan({}, { host: { ...host, installedEffects: [] } }); assert.equal(p.effects.length, 0); assert.equal(p.diagnostics[0].code, 'W_EFFECT_MISSING'); });
test('效果目标不存在被拒绝', () => { const a = clone(asset); a.effects[0].target = 'absent'; rejects(() => plan({}, { asset: a }), 'E_EFFECT_DESCRIPTOR'); });
test('附属文件不会被这个适配器静默丢弃', () => { const a = clone(asset); a.resources = ['image.png']; rejects(() => plan({}, { asset: a }), 'E_RESOURCE_ADAPTER_REQUIRED'); });
test('字体依赖需要额外适配器', () => { const a = clone(asset); a.requirements.fonts = ['Font']; rejects(() => plan({}, { asset: a }), 'E_RESOURCE_ADAPTER_REQUIRED'); });
test('同一输入多次编译不会修改源数据', () => { const before = JSON.stringify({ asset, payload }); plan({ width: 400 }); plan(); assert.equal(JSON.stringify({ asset, payload }), before); });
function shapeFixture(type) {
  const a = clone(asset), p = clone(payload);
  p.states = [];
  p.nodes[1] = { id: 'card', parent: 'output', type };
  if (type === 'ellipse') p.nodes[1].size = { bind: ['width', 'height'] };
  else {
    for (const [id, value] of [['points', 5], ['outerRadius', 120], ['innerRadius', 55], ['rotation', 18]]) a.parameters.push({ id, type: 'number', default: value });
    for (const key of ['points', 'outerRadius', 'rotation']) p.nodes[1][key] = { bind: key };
    if (type === 'star') p.nodes[1].innerRadius = { bind: 'innerRadius' };
  }
  return { asset: a, payload: p };
}
test('椭圆使用独立宽高，不要求矩形圆角绑定', () => {
  const p = plan({ width: 280, height: 160 }, shapeFixture('ellipse'));
  assert.equal(p.geometryType, 'ellipse'); assert.deepEqual(p.size, [280, 160]);
  assert.equal(p.bindings.radius, undefined);
});
for (const [type, points] of [['polygon', 3], ['polygon', 6], ['star', 5]]) test(type + ' 编译边数、半径与旋转', () => {
  const p = plan({ points, outerRadius: 140, innerRadius: 60, rotation: 30 }, shapeFixture(type));
  assert.equal(p.geometryType, type); assert.equal(p.points, points); assert.equal(p.outerRadius, 140); assert.equal(p.rotation, 30);
  assert.equal(p.innerRadius, type === 'star' ? 60 : undefined);
});
for (const points of [2, 3.5, 65]) test('拒绝非法或超预算的多边形边数 ' + points, () => rejects(() => plan({ points }, shapeFixture('polygon')), 'E_GEOMETRY_VALUE'));
for (const innerRadius of [0, 120, 140]) test('星形内半径必须小于外半径且大于零 ' + innerRadius, () => rejects(() => plan({ innerRadius }, shapeFixture('star')), 'E_GEOMETRY_VALUE'));
test('多边形不能绕过单几何节点限制', () => {
  const fixture = shapeFixture('polygon'); fixture.payload.nodes.push({ id: 'extra', type: 'ellipse', parent: 'output', size: { bind: ['width', 'height'] } });
  rejects(() => plan({}, fixture), 'E_NODE_KIND_UNSUPPORTED');
});
const passed = results.filter(result => result.passed).length;
const failed = results.length - passed;
fs.writeFileSync(path.join(root, 'test-results/native-plan.json'), JSON.stringify({ finished: true, timestamp: new Date().toISOString(), scope: 'Pure ES3 graph/parameter plan; no AE mutation.', passed, failed, results }, null, 2));
console.log(JSON.stringify({ passed, failed, total: results.length }));
process.exitCode = failed ? 1 : 0;
