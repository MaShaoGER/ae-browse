'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { validatePack, inspectDirectory, planRegistration, fingerprint, relativePath, versionAtLeast } = require('../src/pack-validator.cjs');
const project = path.resolve(__dirname, '..');
const sample = path.join(project, 'examples', 'portable-demo');
const base = JSON.parse(fs.readFileSync(path.join(sample, 'pack.json'), 'utf8'));
const results = [];
const host = { aeVersion: '26.0x67', capabilities: ['shape.create', 'animation.keyframes', 'effect.add'], effects: [{ matchName: 'ADBE Gaussian Blur 2', displayName: '高斯模糊' }], activeComp: true, selectionCount: 1, writableSelection: true };
const clone = value => JSON.parse(JSON.stringify(value));
const mutated = change => { const pack = clone(base); change(pack, pack.assets[0]); return pack; };
const check = (input = base, options = {}) => validatePack(input, { root: sample, host, ...options });
const has = (report, code) => report.diagnostics.some(d => d.code === code);
const expectCode = (input, code, options) => assert.ok(has(check(input, options), code), 'Expected ' + code);
function test(group, name, run) {
  try { run(); results.push({ group, name, passed: true }); }
  catch (error) { results.push({ group, name, passed: false, error: error.message }); console.error('FAIL: ' + name + ': ' + error.message); }
}

test('package', '完整示例包可登记并满足模拟宿主预检', () => { const result = check(); assert.equal(result.canRegister, true); assert.equal(result.allContractValid, true); assert.equal(result.assets[0].canImport, true); });
test('package', 'UTF-8 BOM 清单可读取', () => assert.equal(check('\uFEFF' + JSON.stringify(base)).allContractValid, true));
for (const [name, input] of [['损坏 JSON', '{broken'], ['尾随逗号', '{"a":1,}'], ['执行语句', 'globalThis.executed = true']]) test('package', name + '被拒绝', () => expectCode(input, 'E_JSON_INVALID'));
for (const input of [null, [], 42, undefined]) test('package', '无效清单根：' + String(input), () => assert.ok(has(validatePack(input, { root: sample, host }), 'E_MANIFEST_OBJECT')));
test('package', '空素材包被拒绝', () => expectCode(mutated(pack => { pack.assets = []; }), 'E_ASSETS_EMPTY'));
test('package', '未来协议版本被明确拒绝', () => expectCode(mutated(pack => { pack.schemaVersion = 2; }), 'E_SCHEMA_VERSION'));
test('package', '格式错误的素材数组被拒绝', () => expectCode(mutated(pack => { pack.assets = {}; }), 'E_ASSETS_EMPTY'));
test('package', '空素材条目被单独隔离', () => { const report = check(mutated(pack => { pack.assets.push(null); })); assert.equal(report.canRegister, true); assert.equal(report.assets[0].canImport, true); assert.equal(report.assets[1].canImport, false); });
test('package', '图形包 ID 必须是字符串', () => expectCode(mutated(pack => { pack.pack.id = 123; }), 'E_PACK_IDENTITY'));
test('package', '包名缺失被拒绝', () => expectCode(mutated(pack => { delete pack.pack.name; }), 'E_PACK_IDENTITY'));
test('package', '正式及预发布包版本可读取', () => { for (const version of ['0.1.0', '1.2.3-beta.1', '1.2.3+build.4']) assert.equal(check(mutated(pack => { pack.pack.version = version; })).canRegister, true); });
test('package', '非语义版本号被拒绝', () => expectCode(mutated(pack => { pack.pack.version = 'latest'; }), 'E_PACK_IDENTITY'));
test('package', '包内重复素材 ID 阻止登记', () => { const report = check(mutated(pack => { pack.assets.push(clone(pack.assets[0])); })); assert.equal(report.canRegister, false); assert.ok(has(report, 'E_ASSET_DUPLICATE')); });
test('package', '一个损坏素材不影响另一个素材', () => { const report = check(mutated(pack => { const bad = clone(pack.assets[0]); bad.id = 'bad'; bad.source = 'missing.json'; pack.assets.push(bad); })); assert.equal(report.canRegister, true); assert.equal(report.assets[0].canImport, true); assert.equal(report.assets[1].canImport, false); });
test('package', '未知素材类型可展示元数据但单项停用', () => { const report = check(mutated((pack, asset) => { asset.kind = 'vendor.futureShape'; })); assert.equal(report.canRegister, true); assert.equal(report.assets[0].canImport, false); assert.ok(has(report, 'E_KIND_UNSUPPORTED')); });
test('package', '未来素材类型可通过注册能力扩展', () => assert.equal(check(mutated((pack, asset) => { asset.kind = 'vendor.futureShape'; }), { kinds: ['vendor.futureShape'] }).assets[0].canImport, true));
test('package', '未知扩展字段保留且不会改变清单', () => { const input = mutated(pack => { pack.futureField = { example: 1 }; }); const before = JSON.stringify(input); const report = check(input); assert.ok(has(report, 'W_UNKNOWN_FIELD')); assert.equal(JSON.stringify(input), before); assert.equal(report.canRegister, true); });
test('package', '清单大小读取预算生效', () => expectCode(JSON.stringify(base), 'E_MANIFEST_LIMIT', { limits: { manifestBytes: 20 } }));
test('package', '素材数量预算可配置', () => expectCode(mutated(pack => { pack.assets.push({ ...clone(pack.assets[0]), id: 'second' }); }), 'E_ASSET_LIMIT', { limits: { assets: 1 } }));
test('package', '深度预算拒绝过深输入', () => { const pack = clone(base); let node = pack.extensions = {}; for (let i = 0; i < 70; i++) node = node.next = {}; expectCode(pack, 'E_DEPTH_LIMIT'); });
test('package', '文本预算生效', () => expectCode(mutated(pack => { pack.pack.description = 'a'.repeat(16400); }), 'E_TEXT_LIMIT'));
test('package', '未知操作名称被拒绝', () => expectCode(base, 'E_INTENT_UNSUPPORTED', { intent: 'addEffectTypo' }));

for (const value of ['../outside.json', 'C:/outside.json', '/outside.json', '\\\\server\\share\\a.json', 'assets/a.json:stream', 'assets/CON.json', 'assets/NUL', 'assets/a?.json', 'assets/a\u0000.json', 'assets/../rounded-card.json', 'assets//rounded-card.json', 'assets/a.json.']) test('portability', '非法资源路径：' + JSON.stringify(value), () => expectCode(mutated((pack, asset) => { asset.source = value; }), 'E_PATH_INVALID'));
test('portability', '相对 Windows 分隔符可归一化', () => assert.equal(relativePath('assets\\rounded-card.json'), 'assets/rounded-card.json'));
test('portability', '缺失预览图使用占位图且不阻止基础导入', () => { const report = check(mutated((pack, asset) => { asset.preview = { still: 'previews/missing.png' }; })); assert.ok(has(report, 'W_PREVIEW_MISSING')); assert.equal(report.assets[0].canImport, true); });
test('portability', '预览图也不能越过图形包目录', () => expectCode(mutated((pack, asset) => { asset.preview = { still: '../outside.png' }; }), 'E_PATH_INVALID'));
test('portability', '必需源文件缺失会停用单项素材', () => expectCode(mutated((pack, asset) => { asset.source = 'missing.json'; }), 'E_FILE_MISSING'));
test('portability', '必需附属资源缺失会停用素材', () => expectCode(mutated((pack, asset) => { asset.resources = ['missing-font-or-image.png']; }), 'E_FILE_MISSING'));
test('portability', '未提供包目录时不会宣称素材可导入', () => { const report = validatePack(base, { host }); assert.ok(has(report, 'W_FILES_UNCHECKED')); assert.equal(report.assets[0].canImport, false); });
test('portability', '目录读取失败返回使用提示', () => { const report = inspectDirectory(path.join(project, 'not-present')); assert.ok(has(report, 'E_PACK_READ')); assert.equal(report.canRegister, false); });

const fixtureRoot = path.join(project, 'test-results', 'fixtures-' + Date.now() + '-' + process.pid);
fs.mkdirSync(fixtureRoot, { recursive: true });
const copied = path.join(fixtureRoot, '复制后的 图形库');
fs.cpSync(sample, copied, { recursive: true });
test('portability', '整个包复制到含中文及空格的目录后仍可读取', () => assert.equal(inspectDirectory(copied, { host }).assets[0].canImport, true));
test('portability', '包移动后的内容指纹保持一致', () => assert.equal(fingerprint(copied), fingerprint(sample)));
const outside = path.join(fixtureRoot, 'outside');
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'external.json'), '{}');
test('portability', '指向包外的目录链接被拒绝', () => {
  fs.symlinkSync(outside, path.join(copied, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = validatePack(mutated((pack, asset) => { asset.source = 'escaped/external.json'; }), { root: copied, host });
  assert.ok(has(report, 'E_PATH_ESCAPE'));
});
test('portability', '错误源文件类型被拒绝', () => expectCode(mutated((pack, asset) => { asset.source = 'assets/a.aep'; }), 'E_SOURCE_EXTENSION'));
test('portability', '脚本源文件被拒绝且不会执行', () => { globalThis.executed = false; expectCode(mutated((pack, asset) => { asset.source = 'assets/run.jsx'; }), 'E_EXECUTABLE_SOURCE'); assert.equal(globalThis.executed, false); });
test('portability', '图形源 JSON 损坏被隔离', () => { fs.writeFileSync(path.join(copied, 'broken.json'), '{broken'); const report = validatePack(mutated((pack, asset) => { asset.source = 'broken.json'; }), { root: copied, host }); assert.ok(has(report, 'E_SOURCE_JSON_INVALID')); });
test('portability', '图形描述根必须是对象', () => { fs.writeFileSync(path.join(copied, 'array.json'), '[]'); const report = validatePack(mutated((pack, asset) => { asset.source = 'array.json'; }), { root: copied, host }); assert.ok(has(report, 'E_SOURCE_OBJECT')); });
test('portability', '源 JSON 的读取预算在解析前检查', () => { fs.writeFileSync(path.join(copied, 'large.json'), JSON.stringify({ text: 'x'.repeat(9000) })); const report = validatePack(mutated((pack, asset) => { asset.source = 'large.json'; }), { root: copied, host, limits: { manifestBytes: 8000 } }); assert.ok(has(report, 'E_SOURCE_LIMIT')); });
test('portability', '源文件中的无穷数被隔离', () => { fs.writeFileSync(path.join(copied, 'infinity.json'), '{"size":1e999}'); const report = validatePack(mutated((pack, asset) => { asset.source = 'infinity.json'; }), { root: copied, host }); assert.ok(has(report, 'E_NUMBER_NONFINITE')); });
test('portability', '清单中的保留字段被拒绝', () => { const input = JSON.stringify(base).replace('"schemaVersion":1', '"__proto__":{"polluted":true},"schemaVersion":1'); expectCode(input, 'E_RESERVED_KEY'); assert.equal({}.polluted, undefined); });

for (const [name, change, code] of [
  ['数值默认值超出上限', p => { p.default = 5000; }, 'E_PARAMETER_DEFAULT'],
  ['数值默认值是字符串', p => { p.default = '320'; }, 'E_PARAMETER_DEFAULT'],
  ['范围最小值大于最大值', p => { p.min = 100; p.max = 10; }, 'E_PARAMETER_RANGE'],
  ['无穷数', p => { p.default = Infinity; }, 'E_NUMBER_NONFINITE'],
  ['未知参数类型', p => { p.type = 'vendor.futureControl'; }, 'E_PARAMETER_TYPE_UNSUPPORTED']
]) test('parameters', name, () => expectCode(mutated((pack, asset) => change(asset.parameters[0])), code));
test('parameters', '颜色必须含四个归一化分量', () => expectCode(mutated((pack, asset) => { asset.parameters[3].default = [255, 0, 0]; }), 'E_PARAMETER_DEFAULT'));
test('parameters', '枚举默认值必须存在于选项', () => expectCode(mutated((pack, asset) => { asset.parameters[5].default = 'absent'; }), 'E_PARAMETER_DEFAULT'));
test('parameters', '枚举选项不得重复', () => expectCode(mutated((pack, asset) => { asset.parameters[5].options = ['pop', 'pop']; }), 'E_ENUM_OPTIONS'));
test('parameters', '参数 ID 不得重复', () => expectCode(mutated((pack, asset) => { asset.parameters.push(clone(asset.parameters[0])); }), 'E_PARAMETER_ID'));
test('parameters', '中文参数提示可保留', () => assert.equal(check(mutated((pack, asset) => { asset.parameters[0].help = '保持中心位置，可输入自定义尺寸。'; })).assets[0].canImport, true));
test('parameters', '提示文本中的代码保持为数据', () => { globalThis.executed = false; const pack = mutated((p, asset) => { asset.help.summary = 'globalThis.executed = true'; }); assert.equal(check(pack).canRegister, true); assert.equal(globalThis.executed, false); });

test('effects', '效果通过 matchName 匹配而不依赖中文名称', () => assert.equal(check(base, { host: { ...host, effects: [{ matchName: 'ADBE Gaussian Blur 2', displayName: '任意语言名称' }] } }).assets[0].canImport, true));
test('effects', '可选效果缺失允许降级并报告被跳过的效果', () => { const report = check(base, { host: { ...host, effects: [] } }); assert.equal(report.assets[0].status, 'degraded'); assert.equal(report.assets[0].canImport, true); assert.deepEqual(report.assets[0].skippedEffects, ['soften']); assert.ok(has(report, 'W_EFFECT_MISSING')); });
test('effects', '必需效果缺失阻止单项素材导入', () => { const report = check(mutated((pack, asset) => { asset.effects[0].required = true; }), { host: { ...host, effects: [] } }); assert.equal(report.canRegister, true); assert.equal(report.assets[0].canImport, false); assert.ok(has(report, 'E_EFFECT_MISSING')); });
test('effects', '效果名称不能模糊匹配', () => { const report = check(base, { host: { ...host, effects: ['ADBE Gaussian Blur 22'] } }); assert.ok(has(report, 'W_EFFECT_MISSING')); });
test('effects', '同名效果的多个实例可用不同稳定 ID 声明', () => assert.equal(check(mutated((pack, asset) => { asset.effects.push({ ...clone(asset.effects[0]), id: 'soften-second' }); })).allContractValid, true));
test('effects', '效果实例 ID 重复被拒绝', () => expectCode(mutated((pack, asset) => { asset.effects.push(clone(asset.effects[0])); }), 'E_EFFECT_DESCRIPTOR'));
test('effects', '效果参数可以声明基础数值和属性路径', () => { const report = check(mutated((pack, asset) => { asset.effects[0].settings = [{ path: [{ matchName: 'host-verified-property', occurrence: 1 }], valueType: 'number', value: 12 }]; })); assert.equal(report.allContractValid, true); });
test('effects', '效果属性路径缺失被拒绝', () => expectCode(mutated((pack, asset) => { asset.effects[0].settings = [{ path: [], valueType: 'number', value: 12 }]; }), 'E_EFFECT_PROPERTY_PATH'));
test('effects', '自定义复杂效果参数需要专用适配器', () => expectCode(mutated((pack, asset) => { asset.effects[0].settings = [{ path: [{ matchName: 'custom', occurrence: 1 }], valueType: 'customBlob', value: {} }]; }), 'E_EFFECT_VALUE'));
test('effects', '效果参数的实例序号必须为正整数', () => expectCode(mutated((pack, asset) => { asset.effects[0].settings = [{ path: [{ matchName: 'property', occurrence: 0 }], valueType: 'number', value: 12 }]; }), 'E_EFFECT_PROPERTY_PATH'));
test('effects', '未取得效果清单时不会宣称可执行', () => { const report = check(base, { host: { ...host, effects: undefined } }); assert.ok(has(report, 'W_EFFECT_CHECK_PENDING')); assert.equal(report.assets[0].canImport, false); });

test('host', 'AE 26.0x67 构建字符串可作最低版本比较', () => assert.equal(versionAtLeast('26.0x67', '26.0'), true));
test('host', '过低 AE 版本阻止单项导入', () => expectCode(base, 'E_AE_VERSION_LOW', { host: { ...host, aeVersion: '25.6' } }));
test('host', '最低 AE 版本格式错误有提示', () => expectCode(mutated((pack, asset) => { asset.requirements.aeMin = 'latest'; }), 'E_AE_VERSION_FORMAT'));
test('host', '完全离线时允许登记与浏览但执行需检查', () => { const report = check(base, { host: null }); assert.equal(report.canRegister, true); assert.equal(report.assets[0].status, 'needs-host-check'); assert.equal(report.assets[0].canImport, false); });
test('host', '缺失执行能力只停用相关素材', () => expectCode(base, 'E_CAPABILITY_MISSING', { host: { ...host, capabilities: ['shape.create'] } }));
test('host', '未验证执行适配器不会冒充已支持', () => { const report = check(base, { host: { ...host, capabilities: undefined } }); assert.ok(has(report, 'W_CAPABILITY_CHECK_PENDING')); assert.equal(report.assets[0].canImport, false); });
test('host', '字体依赖保留专用检查入口', () => { const report = check(mutated((pack, asset) => { asset.requirements.fonts = ['ExampleFont-Regular']; })); assert.ok(has(report, 'W_FONT_CHECK_PENDING')); assert.equal(report.assets[0].canImport, false); });
test('host', '无合成时可浏览但不能创建图形', () => { assert.equal(check(base, { host: { ...host, activeComp: false } }).canRegister, true); expectCode(base, 'E_NO_ACTIVE_COMP', { host: { ...host, activeComp: false }, intent: 'instantiate' }); });
test('host', '未选中图层时提示选择效果目标', () => expectCode(base, 'E_NO_SELECTION', { host: { ...host, selectionCount: 0 }, intent: 'applyEffects' }));
test('host', '锁定的选中图层不能添加效果', () => expectCode(base, 'E_SELECTION_LOCKED', { host: { ...host, writableSelection: false }, intent: 'applyEffects' }));
test('host', '未锁定目标满足添加效果的上下文预检', () => assert.equal(check(base, { intent: 'applyEffects' }).assets[0].canImport, true));
test('host', '报错包含稳定代码、阶段、范围、中文提示与处理动作', () => { const report = check(base, { host: { ...host, selectionCount: 0 }, intent: 'applyEffects' }); const error = report.diagnostics.find(d => d.code === 'E_NO_SELECTION'); assert.equal(error.phase, 'context'); assert.equal(error.scope, 'asset'); assert.equal(error.assetId, 'rounded-card'); assert.ok(error.message); assert.deepEqual(error.actions, ['选择目标图层']); });

const registration = { id: base.pack.id, version: base.pack.version, fingerprint: fingerprint(sample) };
test('registration', '新图形包登记为新增', () => assert.equal(planRegistration(registration).action, 'add'));
test('registration', '重复复制相同包复用而不重复安装', () => assert.equal(planRegistration(registration, clone(registration)).action, 'reuse'));
test('registration', '同版本不同内容要求选择而不静默覆盖', () => assert.equal(planRegistration({ ...registration, fingerprint: 'changed' }, registration).code, 'E_PACK_VERSION_CONFLICT'));
test('registration', '新版本包保留用户自建预设', () => { const plan = planRegistration({ ...registration, version: '0.2.0' }, registration); assert.equal(plan.action, 'needs-choice'); assert.equal(plan.preserveUserPresets, true); });
test('registration', '资源内容变化会改变指纹', () => { const source = path.join(copied, 'assets', 'rounded-card.json'); fs.appendFileSync(source, '\n'); assert.notEqual(fingerprint(copied), fingerprint(sample)); });
test('registration', '缺失可选预览仍可计算稳定指纹', () => { const directory = path.join(fixtureRoot, 'missing-preview'); fs.cpSync(sample, directory, { recursive: true }); const pack = clone(base); pack.assets[0].preview = { still: 'previews/missing.png' }; fs.writeFileSync(path.join(directory, 'pack.json'), JSON.stringify(pack)); assert.equal(inspectDirectory(directory, { host }).assets[0].canImport, true); assert.equal(fingerprint(directory), fingerprint(directory)); });
test('registration', '缺失必需资源不能被指纹函数忽略', () => { const directory = path.join(fixtureRoot, 'missing-required'); fs.cpSync(sample, directory, { recursive: true }); const pack = clone(base); pack.assets[0].resources = ['missing.png']; fs.writeFileSync(path.join(directory, 'pack.json'), JSON.stringify(pack)); assert.throws(() => fingerprint(directory)); });
test('registration', '缺失入口清单不能计算指纹', () => { const directory = path.join(fixtureRoot, 'missing-manifest'); fs.mkdirSync(directory); assert.throws(() => fingerprint(directory), error => error.code === 'ENOENT'); });
test('package', '不存在的根目录返回诊断而不直接抛异常', () => assert.ok(has(validatePack(base, { root: path.join(fixtureRoot, 'does-not-exist') }), 'E_PACK_READ')));
for (const version of ['1.2.3-alpha..1', '1.2.3-01', '1.2.3+build..1']) test('package', '无效语义版本拒绝：' + version, () => expectCode(mutated(pack => { pack.pack.version = version; }), 'E_PACK_IDENTITY'));

const started = performance.now();
const bulk = mutated(pack => { pack.assets = Array.from({ length: 1000 }, (_, i) => ({ id: 'shape-' + i, name: '图形 ' + i, kind: 'ae.nativeShape', source: 'assets/rounded-card.json' })); });
const bulkReport = check(bulk);
const bulkMs = performance.now() - started;
test('budget', '1000 项清单能够完成文件与结构预检', () => { assert.equal(bulkReport.assets.length, 1000); assert.equal(bulkReport.allContractValid, true); });

const passed = results.filter(result => result.passed).length;
const failed = results.length - passed;
const report = { finished: true, timestamp: new Date().toISOString(), scope: 'Node package contract, real file relocation, and simulated host preflight; no AE layer generation or rendering.', passed, failed, total: results.length, metadata1000Ms: Number(bulkMs.toFixed(2)), fixtures: path.relative(project, fixtureRoot).replace(/\\/g, '/'), results };
const currentHostPath = path.join(project, 'test-results', 'ae-host-current.json');
const hostPath = fs.existsSync(currentHostPath) ? currentHostPath : path.join(project, 'test-results', 'ae-host.json');
if (fs.existsSync(hostPath)) {
  const snapshot = JSON.parse(fs.readFileSync(hostPath, 'utf8').replace(/^\uFEFF/, ''));
  report.hostSnapshot = { mode: snapshot.mode, finished: snapshot.finished, aeVersion: snapshot.aeVersion, startedAtMs: snapshot.startedAtMs, snapshotAgeMs: Date.now() - snapshot.startedAtMs, effectCount: snapshot.effects.length, gaussianBlurAvailable: snapshot.effects.some(effect => effect.matchName === 'ADBE Gaussian Blur 2'), activeComp: snapshot.activeComp, selectionCount: snapshot.selectionCount };
  report.realHostInventoryPreflight = inspectDirectory(sample, { host: snapshot });
}
fs.writeFileSync(path.join(project, 'test-results', 'boundaries.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed, failed, total: results.length, metadata1000Ms: report.metadata1000Ms, hostSnapshot: report.hostSnapshot }, null, 2));
process.exitCode = failed ? 1 : 0;
