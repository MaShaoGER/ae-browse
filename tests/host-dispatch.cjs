'use strict';
/* Node VM contract tests with simulated AE properties; this file never calls live AE. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/portable-demo/pack.json'), 'utf8'));
const asset = manifest.assets[0];
const loaded = { manifest, asset, payload: JSON.parse(fs.readFileSync(path.join(root, 'examples/portable-demo', asset.source), 'utf8')) };
const clone = value => JSON.parse(JSON.stringify(value));
const mockSource = String.raw`
var nextLayerId = 101;
function Property(matchName, initial) { this.matchName = matchName; this.value = initial; this.numKeys = 0; this.expressionEnabled = false; this.keys = []; }
Property.prototype.setValue = function (value) { if (app.failWrite) { throw new Error('simulated property write failure'); } this.value = JSON.parse(JSON.stringify(value)); };
Property.prototype.setValueAtTime = function (time, value) { if (app.failWrite) { throw new Error('simulated keyframe failure'); } this.keys.push({ time: time, value: JSON.parse(JSON.stringify(value)) }); this.numKeys = this.keys.length; };
Property.prototype.valueAtTime = function (time) { var value = this.value; for (var i = 0; i < this.keys.length; i++) { if (this.keys[i].time <= time) { value = this.keys[i].value; } } return JSON.parse(JSON.stringify(value)); };
Property.prototype.keyTime = function (index) { return this.keys[index - 1].time; };
Property.prototype.keyValue = function (index) { return this.keys[index - 1].value; };
Property.prototype.keyInInterpolationType = function () { return 'LINEAR'; };
Property.prototype.keyOutInterpolationType = function () { return 'LINEAR'; };
Property.prototype.keyInTemporalEase = function () { return [{ speed: 0, influence: 33.333 }]; };
Property.prototype.keyOutTemporalEase = Property.prototype.keyInTemporalEase;
function Group(matchName) { this.matchName = matchName; this.items = []; this.numProperties = 0; }
Group.prototype.add = function (property) { property.propertyIndex = this.items.length + 1; this.items.push(property); this.numProperties = this.items.length; property.parentGroup = this; return property; };
Group.prototype.property = function (selector) { if (typeof selector === 'number') { return this.items[selector - 1] || null; } for (var i = 0; i < this.items.length; i++) { if (this.items[i].matchName === selector) { return this.items[i]; } } return null; };
Group.prototype.canAddProperty = function (matchName) { return app.effects.length > 0; };
Group.prototype.remove = function () { var list = this.parentGroup.items; for (var i = 0; i < list.length; i++) { if (list[i] === this) { list.splice(i, 1); break; } } this.parentGroup.numProperties = list.length; };
Group.prototype.addProperty = function (name) {
    var group = new Group(name);
    if (name === 'ADBE Vector Group') { group.add(new Group('ADBE Vectors Group')); }
    else if (name === 'ADBE Vector Shape - Rect') { group.add(new Property('ADBE Vector Rect Size', [100, 100])); group.add(new Property('ADBE Vector Rect Roundness', 0)); }
    else if (name === 'ADBE Vector Shape - Ellipse') { group.add(new Property('ADBE Vector Ellipse Size', [100, 100])); }
    else if (name === 'ADBE Vector Shape - Star') { for (var key in { 'ADBE Vector Star Type': 1, 'ADBE Vector Star Points': 5, 'ADBE Vector Star Outer Radius': 100, 'ADBE Vector Star Inner Radius': 50, 'ADBE Vector Star Rotation': 0 }) group.add(new Property(key, { 'ADBE Vector Star Type': 1, 'ADBE Vector Star Points': 5, 'ADBE Vector Star Outer Radius': 100, 'ADBE Vector Star Inner Radius': 50, 'ADBE Vector Star Rotation': 0 }[key])); }
    else if (name === 'ADBE Vector Graphic - Fill') { group.add(new Property('ADBE Vector Fill Color', [1, 1, 1, 1])); group.add(new Property('ADBE Vector Fill Opacity', 100)); }
    group.enabled = true; return this.add(group);
};
function ShapeLayer(comp) {
    this.id = nextLayerId++; this.containingComp = comp; this.name = ''; this.comment = ''; this.locked = false; this.inPoint = 0;
    this.root = new Group('layer'); this.root.add(new Group('ADBE Root Vectors Group'));
    var transform = this.root.add(new Group('ADBE Transform Group')); transform.add(new Property('ADBE Position', [0, 0])); transform.add(new Property('ADBE Scale', [100, 100])); transform.add(new Property('ADBE Opacity', 100));
    this.root.add(new Group('ADBE Effect Parade'));
}
ShapeLayer.prototype.property = function (name) { return this.root.property(name); };
ShapeLayer.prototype.remove = function () { if (app.failRemove) { throw new Error('simulated remove failure'); } var comp = this.containingComp; for (var i = 0; i < comp.list.length; i++) { if (comp.list[i] === this) { comp.list.splice(i, 1); comp.numLayers = comp.list.length; app.calls.removed++; return; } } };
function CompItem(id) { this.id = id; this.name = '测试合成'; this.width = 640; this.height = 360; this.duration = 4; this.time = .5; this.frameRate = 30; this.selectedLayers = []; this.list = []; this.numLayers = 0; var comp = this; this.layers = { addShape: function () { app.calls.created++; var layer = new ShapeLayer(comp); comp.list.unshift(layer); comp.numLayers = comp.list.length; return layer; } }; }
CompItem.prototype.layer = function (index) { return this.list[index - 1]; };
var app = { version: '26.0x67', project: { activeItem: new CompItem(7) }, effects: [{ matchName: 'ADBE Gaussian Blur 2', displayName: '高斯模糊' }], calls: { created: 0, removed: 0, begin: 0, end: 0 }, failWrite: false, failRemove: false,
    beginUndoGroup: function () { this.calls.begin++; }, endUndoGroup: function () { this.calls.end++; }
};
`;
function host() {
  const context = vm.createContext({ JSON: undefined });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/json-compat.jsxinc'), 'utf8'), context);
  vm.runInContext(mockSource, context);
  for (const file of ['native-shape-plan.jsxinc', 'native-shape-adapter.jsxinc', 'host-dispatch.jsxinc']) vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context, { filename: file });
  return context;
}
function request(operation, overrides = {}) {
  return { protocolVersion: 1, requestId: 'request-1', operation, target: null, payload: {}, ...overrides };
}
function createRequest(overrides = {}) {
  return request('instantiateAsset', { target: { compId: 7 }, operationId: 'operation-1', payload: { loaded: clone(loaded), parameters: {}, insertTime: .5 }, ...overrides });
}
function dispatch(context, value) { return JSON.parse(context.AEBrowseHost.dispatch(typeof value === 'string' ? value : JSON.stringify(value))); }
function evaluate(context, source) { const result = vm.runInContext(source, context); return result === undefined ? undefined : JSON.parse(JSON.stringify(result)); }
function diagnostic(response, code) { assert.equal(response.ok, false); assert.equal(response.data, null); assert.ok(response.diagnostics.some(value => value.code === code), JSON.stringify(response)); }
const results = [];
function test(name, body) { try { body(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.stack || error.message }); console.error('FAIL: ' + name + ': ' + error.message); } }
function rejects(source, code) { const context = host(); assert.throws(() => vm.runInContext(source, context), error => error.code === code); }

test('ES3 JSON roundtrips Chinese, controls, quotes and Unicode separators without eval', () => {
  const context = host(), value = { 中文: '引号"、反斜杠\\、换行\n、制表\t、零\u0000、\u2028\u2029、😀' };
  context.sourceText = JSON.stringify(value);
  const encoded = vm.runInContext('AEBrowseJSON.stringify(AEBrowseJSON.parse(sourceText))', context);
  assert.deepEqual(JSON.parse(encoded), value);
  assert.ok(!encoded.includes('\u2028'));
  assert.ok(encoded.includes('\\u2028'));
  assert.equal(evaluate(context, 'typeof JSON.parse'), 'function');
  assert.equal(evaluate(context, 'AEBrowseJSON.parse("-1.25e+2")'), -125);
});
test('JSON parser rejects execution text, malformed numbers, controls and trailing data', () => {
  for (const source of ['(app.failWrite=true)', '{"a":1,}', '[1,]', '01', '+1', '1.', '1e', 'true false', '"raw\nline"', '"\\x20"']) {
    const context = host(); context.invalidSource = source;
    assert.throws(() => vm.runInContext('AEBrowseJSON.parse(invalidSource)', context), error => error.code === 'E_JSON_INVALID');
    assert.equal(evaluate(context, 'app.failWrite'), false);
  }
});
test('JSON rejects dangerous and duplicate keys at every depth', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const context = host(); context.invalidSource = '{"child":{"' + key + '":true}}';
    assert.throws(() => vm.runInContext('AEBrowseJSON.parse(invalidSource)', context), error => error.code === 'E_RESERVED_KEY');
  }
  rejects('AEBrowseJSON.parse(\'{"name":1,"name":2}\')', 'E_JSON_DUPLICATE_KEY');
  rejects('AEBrowseJSON.parse(\'{"\\u005f\\u005fproto__":1}\')', 'E_RESERVED_KEY');
  rejects('AEBrowseJSON.stringify({ child: { constructor: 2 } })', 'E_RESERVED_KEY');
});
test('JSON enforces nesting, value, size and finite-number bounds', () => {
  const context = host();
  context.deep = '['.repeat(65) + '0' + ']'.repeat(65);
  assert.throws(() => vm.runInContext('AEBrowseJSON.parse(deep)', context), error => error.code === 'E_DEPTH_LIMIT');
  context.large = ' '.repeat(4 * 1024 * 1024 + 1);
  assert.throws(() => vm.runInContext('AEBrowseJSON.parse(large)', context), error => error.code === 'E_JSON_LIMIT');
  context.many = '[' + Array(100001).fill('0').join(',') + ']';
  assert.throws(() => vm.runInContext('AEBrowseJSON.parse(many)', context), error => error.code === 'E_JSON_LIMIT');
  rejects('AEBrowseJSON.parse("1e9999")', 'E_NUMBER_NONFINITE');
  rejects('var value = {}; value.self = value; AEBrowseJSON.stringify(value)', 'E_JSON_CYCLE');
});
test('JSON stringify supports pretty output, replacers and standard omission rules', () => {
  const context = host();
  assert.equal(evaluate(context, 'AEBrowseJSON.stringify({ a: 1, b: undefined }, null, 2)'), '{\n  "a": 1\n}');
  assert.equal(evaluate(context, 'AEBrowseJSON.stringify([undefined, NaN, Infinity])'), '[null,null,null]');
  assert.equal(evaluate(context, 'AEBrowseJSON.stringify({ a: 1, b: 2 }, ["b", "b"])'), '{"b":2}');
  assert.equal(evaluate(context, 'AEBrowseJSON.stringify({ a: 1 }, function (key, value) { return key === "a" ? 3 : value; })'), '{"a":3}');
});
test('Read-only host info and context expose only implemented capabilities and mutate nothing', () => {
  const context = host(), info = dispatch(context, request('getHostInfo')), comp = dispatch(context, request('getContext'));
  assert.equal(info.protocolVersion, 1); assert.equal(info.requestId, 'request-1'); assert.equal(info.ok, true);
  assert.deepEqual(info.data.capabilities, ['shape.create', 'animation.keyframes', 'effect.add']);
  assert.deepEqual(info.data.supportedKinds, ['ae.nativeShape']);
  assert.equal(info.data.effects[0].displayName, '高斯模糊'); assert.equal(info.data.aeVersion, '26.0x67');
  assert.equal(comp.data.activeComp, true); assert.equal(comp.data.comp.id, 7); assert.equal(comp.data.selectionCount, 0);
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 0, removed: 0, begin: 0, end: 0 });
  assert.ok(info.timing.hostMs >= 0);
  vm.runInContext('app.project.activeItem = null;', context);
  assert.deepEqual(dispatch(context, request('getContext')).data, { activeComp: false, comp: null, selectionCount: 0 });
});
test('Protocol, request identity, shape and unsupported mutations are guarded', () => {
  const context = host();
  diagnostic(dispatch(context, request('getContext', { protocolVersion: 2 })), 'E_PROTOCOL_VERSION');
  diagnostic(dispatch(context, request('getContext', { requestId: '' })), 'E_REQUEST_ID');
  diagnostic(dispatch(context, request('getContext', { payload: null })), 'E_REQUEST_FORMAT');
  diagnostic(dispatch(context, request('getContext', { target: 'arbitrary' })), 'E_REQUEST_FORMAT');
  diagnostic(dispatch(context, request('unsupportedMutation')), 'E_OPERATION_UNSUPPORTED');
  diagnostic(dispatch(context, request('evalScript', { payload: { source: 'app.failWrite=true' } })), 'E_OPERATION_UNSUPPORTED');
  diagnostic(dispatch(context, ' '.repeat(4 * 1024 * 1024 + 1)), 'E_REQUEST_LIMIT');
  diagnostic(dispatch(context, '{"protocolVersion":1,"constructor":{}}'), 'E_RESERVED_KEY');
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 0, removed: 0, begin: 0, end: 0 });
});
test('Create rejects changed context and absence before opening undo or writing', () => {
  const context = host();
  diagnostic(dispatch(context, createRequest({ target: { compId: 8 } })), 'E_CONTEXT_CHANGED');
  vm.runInContext('app.project.activeItem = null;', context);
  diagnostic(dispatch(context, createRequest()), 'E_NO_ACTIVE_COMP');
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 0, removed: 0, begin: 0, end: 0 });
});
test('A valid comp target does not bypass request shape validation', () => {
  const context = host();
  for (const overrides of [{ payload: null }, { payload: [] }, { operation: '' }, { operation: 'x'.repeat(129) }]) {
    diagnostic(dispatch(context, request('getContext', { target: { compId: 7 }, ...overrides })), 'E_REQUEST_FORMAT');
  }
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 0, removed: 0, begin: 0, end: 0 });
});
test('Host validates loaded schema, manifest membership, version and capability requirements', () => {
  const cases = [
    ['E_SCHEMA_VERSION', value => { value.manifest.schemaVersion = 2; }],
    ['E_ASSET_MISSING', value => { value.manifest.assets = []; }],
    ['E_ASSET_IDENTITY', value => { value.asset.name = 'changed'; }],
    ['E_ASSET_DUPLICATE', value => { value.manifest.assets.push(clone(value.asset)); }],
    ['E_AE_VERSION_LOW', value => { value.asset.requirements.aeMin = '99.0'; value.manifest.assets[0] = clone(value.asset); }],
    ['E_CAPABILITY_MISSING', value => { value.asset.requirements.capabilities.push('shape.path'); value.manifest.assets[0] = clone(value.asset); }],
    ['E_SOURCE_FORMAT', value => { value.asset.source = '../outside.json'; value.manifest.assets[0] = clone(value.asset); }],
    ['E_KIND_UNSUPPORTED', value => { value.asset.kind = 'ae.ffx'; value.manifest.assets[0] = clone(value.asset); }],
    ['E_OPERATION_LIMIT', value => { value.payload.nodes.push({ id: 'extra' }); }],
  ];
  for (const [code, change] of cases) {
    const context = host(), value = createRequest(); change(value.payload.loaded);
    diagnostic(dispatch(context, value), code);
    assert.equal(evaluate(context, 'app.calls.begin + app.calls.created'), 0, code);
  }
});
test('Plan errors and missing required effects stop before any AE writes', () => {
  const context = host(), invalid = createRequest(); invalid.payload.parameters.width = 0;
  diagnostic(dispatch(context, invalid), 'E_PARAMETER_VALUE');
  const required = createRequest(); required.payload.loaded.asset.effects[0].required = true; required.payload.loaded.manifest.assets[0] = clone(required.payload.loaded.asset);
  vm.runInContext('app.effects = [];', context);
  diagnostic(dispatch(context, required), 'E_EFFECT_MISSING');
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 0, removed: 0, begin: 0, end: 0 });
});
test('Actual native adapter creates, captures and reuses one layer for one stable operation', () => {
  const context = host(), value = createRequest(); value.payload.parameters = { width: 440, radius: 35, motion: 'slide' };
  const first = dispatch(context, value); assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.compId, 7); assert.equal(first.data.instanceId, 'operation-1'); assert.equal(first.data.reused, false);
  assert.deepEqual(first.data.observed.size, [440, 180]); assert.equal(first.data.observed.radius, 35);
  assert.equal(first.data.observed.animation[1].keys[0].time, 0); assert.ok(Math.abs(first.data.observed.animation[1].keys[1].time - .6) < .000001);
  value.requestId = 'request-retry'; const retry = dispatch(context, value);
  assert.equal(retry.ok, true, JSON.stringify(retry)); assert.equal(retry.data.layerId, first.data.layerId); assert.equal(retry.data.reused, true);
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1); assert.equal(evaluate(context, 'app.calls.created'), 1);
  assert.equal(evaluate(context, 'app.calls.begin'), evaluate(context, 'app.calls.end'));
});
test('A changed stable operation cannot create another layer or overwrite the instance', () => {
  const context = host(), first = dispatch(context, createRequest()); assert.equal(first.ok, true, JSON.stringify(first));
  const changed = createRequest(); changed.payload.parameters.width = 500;
  diagnostic(dispatch(context, changed), 'E_INSTANCE_CONFLICT');
  const otherPack = createRequest(); otherPack.payload.loaded.manifest.pack.id = 'different.pack';
  diagnostic(dispatch(context, otherPack), 'E_INSTANCE_CONFLICT');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1); assert.equal(evaluate(context, 'app.calls.created'), 1);
});
test('Optional unavailable effects return diagnostics while the native shape survives', () => {
  const context = host(); vm.runInContext('app.effects = [];', context);
  const result = dispatch(context, createRequest()); assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.diagnostics.some(item => item.code === 'W_EFFECT_MISSING')); assert.equal(result.data.observed.effects.length, 0);
});
test('Read instance requires stable comp, layer and instance identity and remains read-only', () => {
  const context = host(), created = dispatch(context, createRequest()); assert.equal(created.ok, true, JSON.stringify(created));
  const before = evaluate(context, 'app.calls'), value = request('readInstance', { target: { compId: 7, layerId: created.data.layerId, instanceId: created.data.instanceId } });
  const read = dispatch(context, value); assert.equal(read.ok, true, JSON.stringify(read)); assert.deepEqual(read.data.observed, created.data.observed);
  const changed = clone(value); changed.target.instanceId = 'other-instance'; diagnostic(dispatch(context, changed), 'E_INSTANCE_IDENTITY');
  changed.target.instanceId = created.data.instanceId; changed.target.layerId = 999; diagnostic(dispatch(context, changed), 'E_INSTANCE_MISSING');
  assert.deepEqual(evaluate(context, 'app.calls'), before);
});
test('Adapter write failure cleans its own layer and reliably closes undo', () => {
  const context = host(); vm.runInContext('app.failWrite = true;', context);
  diagnostic(dispatch(context, createRequest()), 'E_HOST_OPERATION');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 0);
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 1, removed: 1, begin: 1, end: 1 });
  vm.runInContext('app.failWrite = false;', context);
  assert.equal(dispatch(context, createRequest()).ok, true, 'host busy state was not cleared');
});
test('Post-create capture failure removes only this operation layer and reads cleanup back', () => {
  const context = host();
  vm.runInContext('var existing = app.project.activeItem.layers.addShape(); existing.name = "existing"; AEBrowseNative.capture = function () { throw new Error("simulated readback failure"); };', context);
  diagnostic(dispatch(context, createRequest()), 'E_HOST_OPERATION');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1);
  assert.equal(evaluate(context, 'app.project.activeItem.layer(1).name'), 'existing');
  assert.deepEqual(evaluate(context, 'app.calls'), { created: 2, removed: 1, begin: 1, end: 1 });
});
test('Readback failure on reused instances never deletes the existing layer', () => {
  const context = host(); assert.equal(dispatch(context, createRequest()).ok, true);
  vm.runInContext('AEBrowseNative.capture = function () { throw new Error("readback failure"); };', context);
  diagnostic(dispatch(context, createRequest()), 'E_HOST_OPERATION');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1); assert.equal(evaluate(context, 'app.calls.removed'), 0);
  assert.equal(evaluate(context, 'app.calls.begin'), evaluate(context, 'app.calls.end'));
});
test('Failed cleanup is explicit and undo still closes', () => {
  const context = host(); vm.runInContext('app.failRemove = true; AEBrowseNative.capture = function () { throw new Error("readback failure"); };', context);
  const result = dispatch(context, createRequest()); diagnostic(result, 'E_CLEANUP_FAILED');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1); assert.equal(evaluate(context, 'app.calls.end'), 1);
});
test('Failed adapter cleanup before a result is returned is detected by the dispatcher scan', () => {
  const context = host(); vm.runInContext('app.failWrite = true; app.failRemove = true;', context);
  const result = dispatch(context, createRequest()); diagnostic(result, 'E_CLEANUP_FAILED');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1); assert.equal(evaluate(context, 'app.calls.end'), 1);
});
test('Reentrant host calls report busy and do not alter the outer operation', () => {
  const context = host(); context.nestedRequest = JSON.stringify(request('getContext'));
  vm.runInContext('var originalBegin = app.beginUndoGroup; app.beginUndoGroup = function () { originalBegin.call(app); app.nestedResponse = AEBrowseHost.dispatch(nestedRequest); };', context);
  assert.equal(dispatch(context, createRequest()).ok, true);
  diagnostic(JSON.parse(evaluate(context, 'app.nestedResponse')), 'E_HOST_BUSY');
  assert.equal(dispatch(context, request('getContext')).ok, true);
});

for (const type of ['ellipse', 'polygon', 'star']) test('Create and capture ' + type + ' through the real dispatcher', () => {
  const context = host(), source = clone(loaded);
  source.asset.effects = []; source.payload.states = [];
  source.payload.nodes[1] = { id: 'card', parent: 'output', type };
  if (type === 'ellipse') source.payload.nodes[1].size = { bind: ['width', 'height'] };
  else {
    for (const [id, value] of [['points', 6], ['outerRadius', 120], ['innerRadius', 55], ['rotation', 30]]) source.asset.parameters.push({ id, type: 'number', default: value });
    for (const key of ['points', 'outerRadius', 'rotation']) source.payload.nodes[1][key] = { bind: key };
    if (type === 'star') source.payload.nodes[1].innerRadius = { bind: 'innerRadius' };
  }
  source.manifest.assets = [clone(source.asset)];
  const value = createRequest({ payload: { loaded: source, parameters: {}, insertTime: .5 } });
  const response = dispatch(context, value);
  assert.equal(response.ok, true, JSON.stringify(response.diagnostics));
  assert.equal(response.data.modified, false);
  if (type === 'ellipse') assert.deepEqual(response.data.observed.size, [320, 180]);
  else { assert.equal(response.data.observed.points, 6); assert.equal(response.data.observed.outerRadius, 120); assert.equal(response.data.observed.rotation, 30); }
  const repeated = dispatch(context, value); assert.equal(repeated.data.layerId, response.data.layerId); assert.equal(evaluate(context, 'app.calls.created'), 1);
  context.loadedJSON = JSON.stringify(source);
  const overrides = type === 'ellipse' ? { width: 280, height: 160 } : { outerRadius: 150, rotation: 45 };
  context.overridesJSON = JSON.stringify(overrides);
  const updated = evaluate(context, 'AEBrowseNative.updateAppearance(app.project.activeItem.layer(1), JSON.parse(loadedJSON), JSON.parse(overridesJSON))');
  assert.equal(updated.modified, false);
  for (const key of Object.keys(overrides)) assert.equal(updated.parameters[key], overrides[key]);
  vm.runInContext("app.project.activeItem.layer(1).property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1).property(1).setValue(99)", context);
  assert.equal(evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1)).modified'), true);
});
function editable(context) {
  const created = dispatch(context, createRequest());
  assert.equal(created.ok, true, JSON.stringify(created));
  vm.runInContext('app.project.activeItem.selectedLayers = [app.project.activeItem.layer(1)];', context);
  return created.data;
}
function updateRequest(instance, overrides = {}) {
  return request('updateInstance', { operationId: 'update-1',
    target: { compId: instance.compId, layerId: instance.layerId, instanceId: instance.instanceId },
    payload: { loaded: clone(loaded), parameters: { ...instance.parameters, width: 460, radius: 28 },
      expected: { parameters: instance.parameters, observed: instance.observed } }, ...overrides });
}
test('Read selected instance requires exactly one tool layer and never writes', () => {
  const context = host(), instance = editable(context), before = evaluate(context, 'app.calls');
  const response = dispatch(context, request('getSelectedInstance', { target: { compId: 7 } }));
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.data.layerId, instance.layerId);
  assert.equal(response.data.packVersion, '0.1.0');
  assert.equal(response.data.insertTime, .5);
  assert.deepEqual(response.data.parameters, instance.parameters);
  vm.runInContext('app.project.activeItem.selectedLayers = [];', context);
  diagnostic(dispatch(context, request('getSelectedInstance', { target: { compId: 7 } })), 'E_SELECTION_COUNT');
  vm.runInContext('var c = app.project.activeItem; c.selectedLayers = [c.layer(1), c.layer(1)];', context);
  diagnostic(dispatch(context, request('getSelectedInstance', { target: { compId: 7 } })), 'E_SELECTION_COUNT');
  vm.runInContext('var c = app.project.activeItem; c.selectedLayers = [c.layer(1)]; c.layer(1).comment = "user layer";', context);
  diagnostic(dispatch(context, request('getSelectedInstance', { target: { compId: 7 } })), 'E_INSTANCE_UNKNOWN');
  assert.deepEqual(evaluate(context, 'app.calls'), before);
});
test('Update changes appearance on the same layer while preserving original animation', () => {
  const context = host(), instance = editable(context);
  const response = dispatch(context, updateRequest(instance));
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.data.layerId, instance.layerId);
  assert.equal(response.data.instanceId, instance.instanceId);
  assert.deepEqual(response.data.observed.size, [460, 180]);
  assert.equal(response.data.observed.radius, 28);
  assert.equal(response.data.modified, false);
  assert.deepEqual(response.data.observed.animation, instance.observed.animation);
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1);
  assert.equal(evaluate(context, 'app.calls.created'), 1);
  assert.equal(evaluate(context, 'app.calls.removed'), 0);
  assert.equal(evaluate(context, 'app.calls.begin'), evaluate(context, 'app.calls.end'));
});
test('Update refuses a switched selection, instance identity, comp or stale read snapshot', () => {
  for (const [code, mutate] of [
    ['E_SELECTION_CHANGED', c => vm.runInContext('app.project.activeItem.selectedLayers = [];', c)],
    ['E_INSTANCE_IDENTITY', (c, value) => { value.target.instanceId = 'other-instance'; }],
    ['E_CONTEXT_CHANGED', (c, value) => { value.target.compId = 8; }],
    ['E_INSTANCE_STALE', (c, value) => { value.payload.expected.parameters.width = 100; }],
    ['E_EXPECTED_REQUIRED', (c, value) => { delete value.payload.expected; }]
  ]) {
    const context = host(), instance = editable(context), value = updateRequest(clone(instance));
    const before = evaluate(context, 'app.project.activeItem.layer(1).comment'); mutate(context, value);
    diagnostic(dispatch(context, value), code);
    assert.equal(evaluate(context, 'app.project.activeItem.layer(1).comment'), before, code);
    assert.deepEqual(evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1)).observed'), instance.observed, code);
  }
});
test('Update rejects changed package sources, version, animation, locked and manually edited layers', () => {
  for (const [code, mutate] of [
    ['E_INSTANCE_SOURCE_CHANGED', (c, value) => { value.payload.loaded.payload.nodes[0].name = 'different'; }],
    ['E_INSTANCE_SOURCE_CHANGED', (c, value) => { value.payload.loaded.manifest.pack.version = '1.0.1'; }],
    ['E_ANIMATION_UPDATE_UNSUPPORTED', (c, value) => { value.payload.parameters.motion = 'fade'; }],
    ['E_SELECTION_LOCKED', c => vm.runInContext('app.project.activeItem.layer(1).locked = true;', c)],
    ['E_INSTANCE_MODIFIED', c => vm.runInContext("app.project.activeItem.layer(1).property('ADBE Transform Group').property('ADBE Scale').setValueAtTime(.9, [20,20]);", c)]
  ]) {
    const context = host(), instance = editable(context), value = updateRequest(instance);
    mutate(context, value);
    const before = evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1))');
    const comment = evaluate(context, 'app.project.activeItem.layer(1).comment');
    diagnostic(dispatch(context, value), code);
    assert.deepEqual(evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1))'), before, code);
    assert.equal(evaluate(context, 'app.project.activeItem.layer(1).comment'), comment, code);
  }
});
test('A second update from an old snapshot cannot overwrite the first update', () => {
  const context = host(), instance = editable(context), value = updateRequest(instance);
  assert.equal(dispatch(context, value).ok, true);
  value.requestId = 'request-stale'; value.operationId = 'update-2'; value.payload.parameters.width = 600;
  diagnostic(dispatch(context, value), 'E_INSTANCE_STALE');
  assert.deepEqual(evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1)).observed.size'), [460, 180]);
});
function fillOpacity(context) { return evaluate(context, "app.project.activeItem.layer(1).property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(2).property('ADBE Vector Fill Opacity').value"); }
test('RGBA alpha controls native fill opacity without changing the fade animation', () => {
  for (const [alpha, opacity] of [[0, 0], [.25, 25], [1, 100]]) {
    const context = host(), value = createRequest();
    value.payload.parameters = { color: [.2,.5,1,alpha], motion: 'fade' };
    const result = dispatch(context, value); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fillOpacity(context), opacity);
    assert.equal(result.data.parameters.color[3], alpha);
    assert.deepEqual(result.data.observed.animation[2].keys.map(key => key.value), [0,100]);
    assert.equal(result.data.modified, false);
  }
});
test('Alpha updates preserve layer identity and allow returning to an opaque fill', () => {
  const context = host(), instance = editable(context), value = updateRequest(instance);
  value.payload.parameters.color = [.2,.5,1,.25];
  const first = dispatch(context, value); assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(fillOpacity(context), 25);
  assert.equal(first.data.layerId, instance.layerId); assert.equal(first.data.modified, false);
  const opaque = updateRequest(first.data); opaque.payload.parameters.color = [.2,.5,1,1];
  const second = dispatch(context, opaque); assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(fillOpacity(context), 100); assert.equal(second.data.modified, false);
  assert.deepEqual(second.data.observed.animation, instance.observed.animation);
});
test('Manual fill opacity edits and animation are protected, including old opaque baselines', () => {
  for (const mutation of ["p.setValue(40)", "p.setValueAtTime(.5, 100)", "p.expressionEnabled = true"]) {
    const context = host(), instance = editable(context);
    // Pre-alpha releases have no opacity field in their saved baseline.
    assert.equal(Object.hasOwn(instance.observed, 'fillOpacity'), false);
    vm.runInContext("var p = app.project.activeItem.layer(1).property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(2).property('ADBE Vector Fill Opacity'); " + mutation, context);
    diagnostic(dispatch(context, updateRequest(instance)), 'E_INSTANCE_MODIFIED');
    assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1);
  }
});
test('A failed alpha update restores the original opacity and exact metadata', () => {
  const context = host(), instance = editable(context), value = updateRequest(instance);
  const before = evaluate(context, 'app.project.activeItem.layer(1).comment');
  value.payload.parameters.color = [.2,.5,1,.25];
  vm.runInContext("var stringify = AEBrowseJSON.stringify; AEBrowseJSON.stringify = function(v) { if(v && v.layerId && v.parameters.width === 460) { app.atSerializationOpacity = app.project.activeItem.layer(1).property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(2).property('ADBE Vector Fill Opacity').value; throw new Error('response serialization failed'); } return stringify(v); };", context);
  const response = dispatch(context, value); diagnostic(response, 'I_UPDATE_ROLLED_BACK');
  assert.equal(evaluate(context, 'app.atSerializationOpacity'), 25);
  assert.equal(fillOpacity(context), 100); assert.equal(evaluate(context, 'app.project.activeItem.layer(1).comment'), before);
  assert.deepEqual(evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1)).observed'), instance.observed);
});
// These failures occur after the first geometry write. Each must restore both properties and the exact comment.
for (const stage of ['property', 'baseline', 'metadata', 'readback', 'serialization']) test('Update rolls back geometry and metadata after ' + stage + ' failure', () => {
  const context = host(), instance = editable(context), before = evaluate(context, 'app.project.activeItem.layer(1).comment');
  if (stage === 'property') vm.runInContext("var p = app.project.activeItem.layer(1).property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1).property('ADBE Vector Rect Roundness'); var set = p.setValue; p.setValue = function(v) { this.setValue = set; throw new Error('one write failed'); };", context);
  if (stage === 'baseline') vm.runInContext("var p = app.project.activeItem.layer(1).property('ADBE Transform Group').property('ADBE Position'); var read = p.valueAtTime, count = 0; p.valueAtTime = function(t) { count++; if (count === 2) throw new Error('baseline failed'); return read.call(this,t); };", context);
  if (stage === 'metadata') vm.runInContext("var l = app.project.activeItem.layer(1), text = l.comment, once = true; Object.defineProperty(l, 'comment', {get:function(){return text;},set:function(v){if(once){once=false;throw new Error('comment failed');}text=v;}});", context);
  if (stage === 'readback') vm.runInContext("var p = app.project.activeItem.layer(1).property('ADBE Transform Group').property('ADBE Position'); var read = p.valueAtTime, count = 0; p.valueAtTime = function(t) { count++; if(count === 3) throw new Error('readback failed'); return read.call(this,t); };", context);
  if (stage === 'serialization') vm.runInContext("var stringify = AEBrowseJSON.stringify; AEBrowseJSON.stringify = function(v) { if(v && v.layerId && v.parameters.width === 460) throw new Error('response serialization failed'); return stringify(v); };", context);
  const result = dispatch(context, updateRequest(instance));
  assert.equal(result.ok, false, 'injected failure was swallowed: ' + JSON.stringify(result));
  assert.ok(result.diagnostics.some(d => d.code === 'I_UPDATE_ROLLED_BACK'), JSON.stringify(result));
  assert.equal(evaluate(context, 'app.project.activeItem.layer(1).comment'), before);
  assert.deepEqual(evaluate(context, 'AEBrowseNative.capture(app.project.activeItem.layer(1)).observed'), instance.observed);
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1);
  assert.equal(evaluate(context, 'app.calls.begin'), evaluate(context, 'app.calls.end'));
});
test('Update reports unconfirmed rollback and keeps the layer when restoration fails', () => {
  const context = host(), instance = editable(context);
  vm.runInContext("var p = app.project.activeItem.layer(1).property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1).property('ADBE Vector Rect Roundness'); p.setValue = function() { app.failWrite = true; throw new Error('persistent failure'); };", context);
  diagnostic(dispatch(context, updateRequest(instance)), 'E_ROLLBACK_FAILED');
  assert.equal(evaluate(context, 'app.project.activeItem.numLayers'), 1);
  assert.equal(evaluate(context, 'app.calls.removed'), 0);
  assert.equal(evaluate(context, 'app.calls.begin'), evaluate(context, 'app.calls.end'));
});
const passed = results.filter(result => result.passed).length;
const failed = results.length - passed;
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results/host-dispatch.json'), JSON.stringify({ finished: true, timestamp: new Date().toISOString(), scope: 'Node VM mocks plus actual ES3 plan/native adapter; no live AE calls or rendered pixel checks.', passed, failed, results }, null, 2));
console.log(JSON.stringify({ passed, failed, total: results.length }));
process.exitCode = failed ? 1 : 0;
