app.exitAfterLaunchAndEval=false;
/* AE Browse 0.2.0 - generated; edit src files instead. */
/* Source: src/json-compat.jsxinc */
/* Bounded ES3 JSON data codec. Parsing never evaluates source text. */
var AEBrowseJSON = (function () {
    var MAX_CHARS = 4 * 1024 * 1024, MAX_DEPTH = 64, MAX_VALUES = 100000;
    function fail(code, message) { var error = new Error(message); error.code = code; throw error; }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function array(value) { return Object.prototype.toString.call(value) === '[object Array]'; }
    function reserved(key) { return key === '__proto__' || key === 'constructor' || key === 'prototype'; }
    function parse(source) {
        if (typeof source !== 'string') { fail('E_JSON_INVALID', 'JSON 输入必须是字符串。'); }
        if (source.length > MAX_CHARS) { fail('E_JSON_LIMIT', 'JSON 输入超过读取预算。'); }
        var at = 0, count = 0;
        function invalid() { fail('E_JSON_INVALID', 'JSON 格式无效，位置：' + at); }
        function white() { while (at < source.length && /[ \t\r\n]/.test(source.charAt(at))) { at++; } }
        function string() {
            var result = '', character, escaped, hex;
            if (source.charAt(at++) !== '"') { invalid(); }
            while (at < source.length) {
                character = source.charAt(at++);
                if (character === '"') { return result; }
                if (character === '\\') {
                    if (at >= source.length) { invalid(); }
                    escaped = source.charAt(at++);
                    if (escaped === '"' || escaped === '\\' || escaped === '/') { result += escaped; }
                    else if (escaped === 'b') { result += '\b'; }
                    else if (escaped === 'f') { result += '\f'; }
                    else if (escaped === 'n') { result += '\n'; }
                    else if (escaped === 'r') { result += '\r'; }
                    else if (escaped === 't') { result += '\t'; }
                    else if (escaped === 'u') {
                        hex = source.substr(at, 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) { invalid(); }
                        result += String.fromCharCode(parseInt(hex, 16)); at += 4;
                    } else { invalid(); }
                } else {
                    if (character.charCodeAt(0) < 32) { invalid(); }
                    result += character;
                }
            }
            invalid();
        }
        function value(depth) {
            if (depth > MAX_DEPTH) { fail('E_DEPTH_LIMIT', 'JSON 数据嵌套过深。'); }
            if (++count > MAX_VALUES) { fail('E_JSON_LIMIT', 'JSON 数据项目超过预算。'); }
            white();
            var character = source.charAt(at), result, key, token, numberStart;
            if (character === '"') { return string(); }
            if (character === '{') {
                at++; result = {}; white();
                if (source.charAt(at) === '}') { at++; return result; }
                while (at < source.length) {
                    white(); key = string();
                    if (reserved(key)) { fail('E_RESERVED_KEY', 'JSON 数据包含保留字段。'); }
                    if (own(result, key)) { fail('E_JSON_DUPLICATE_KEY', 'JSON 对象包含重复字段。'); }
                    white(); if (source.charAt(at++) !== ':') { invalid(); }
                    result[key] = value(depth + 1); white();
                    character = source.charAt(at++);
                    if (character === '}') { return result; }
                    if (character !== ',') { invalid(); }
                }
                invalid();
            }
            if (character === '[') {
                at++; result = []; white();
                if (source.charAt(at) === ']') { at++; return result; }
                while (at < source.length) {
                    result.push(value(depth + 1)); white(); character = source.charAt(at++);
                    if (character === ']') { return result; }
                    if (character !== ',') { invalid(); }
                }
                invalid();
            }
            token = source.substr(at, 4);
            if (token === 'true') { at += 4; return true; }
            if (token === 'null') { at += 4; return null; }
            if (source.substr(at, 5) === 'false') { at += 5; return false; }
            if (character === '-' || (/[0-9]/.test(character) && character !== '')) {
                numberStart = at;
                if (character === '-') { at++; }
                if (source.charAt(at) === '0') { at++; }
                else {
                    if (!/[1-9]/.test(source.charAt(at)) || at >= source.length) { invalid(); }
                    while (at < source.length && /[0-9]/.test(source.charAt(at))) { at++; }
                }
                if (source.charAt(at) === '.') {
                    at++; if (at >= source.length || !/[0-9]/.test(source.charAt(at))) { invalid(); }
                    while (at < source.length && /[0-9]/.test(source.charAt(at))) { at++; }
                }
                character = source.charAt(at);
                if (character === 'e' || character === 'E') {
                    at++; character = source.charAt(at); if (character === '+' || character === '-') { at++; }
                    if (at >= source.length || !/[0-9]/.test(source.charAt(at))) { invalid(); }
                    while (at < source.length && /[0-9]/.test(source.charAt(at))) { at++; }
                }
                result = Number(source.substring(numberStart, at));
                if (!isFinite(result)) { fail('E_NUMBER_NONFINITE', 'JSON 数值必须是有限数值。'); }
                return result;
            }
            invalid();
        }
        var result = value(0); white(); if (at !== source.length) { invalid(); } return result;
    }
    function quote(source) {
        var result = '"', character, code, hex;
        for (var i = 0; i < source.length; i++) {
            character = source.charAt(i); code = source.charCodeAt(i);
            if (character === '"' || character === '\\') { result += '\\' + character; }
            else if (code < 32 || code === 0x2028 || code === 0x2029 || (code >= 0xD800 && code <= 0xDFFF)) {
                hex = code.toString(16); result += '\\u' + ('0000' + hex).substr(hex.length);
            } else { result += character; }
        }
        return result + '"';
    }
    function stringify(input, replacer, space) {
        var stack = [], count = 0, gap = '', indent = '', propertyList = null;
        if (replacer !== undefined && replacer !== null && typeof replacer !== 'function' && !array(replacer)) { fail('E_JSON_REPLACER', 'JSON replacer 无效。'); }
        if (array(replacer)) {
            propertyList = [];
            for (var p = 0; p < replacer.length; p++) {
                if (typeof replacer[p] === 'string' || typeof replacer[p] === 'number') {
                    var selected = String(replacer[p]), duplicate = false;
                    if (reserved(selected)) { fail('E_RESERVED_KEY', 'JSON 数据包含保留字段。'); }
                    for (var q = 0; q < propertyList.length; q++) { if (propertyList[q] === selected) { duplicate = true; } }
                    if (!duplicate) { propertyList.push(selected); }
                }
            }
        }
        if (typeof space === 'number' && isFinite(space)) { for (var s = 0; s < Math.min(10, Math.max(0, Math.floor(space))); s++) { gap += ' '; } }
        else if (typeof space === 'string') { gap = space.substr(0, 10); }
        function encode(holder, key, depth) {
            if (depth > MAX_DEPTH) { fail('E_DEPTH_LIMIT', 'JSON 数据嵌套过深。'); }
            if (++count > MAX_VALUES) { fail('E_JSON_LIMIT', 'JSON 数据项目超过预算。'); }
            var value = holder[key], i, names = [], parts = [], encoded, priorIndent, result;
            if (value && typeof value === 'object' && typeof value.toJSON === 'function') { value = value.toJSON(key); }
            if (typeof replacer === 'function') { value = replacer.call(holder, key, value); }
            if (value === null) { return 'null'; }
            if (typeof value === 'string') { if (value.length > MAX_CHARS) { fail('E_JSON_LIMIT', 'JSON 文本超过预算。'); } return quote(value); }
            if (typeof value === 'number') { return isFinite(value) ? String(value) : 'null'; }
            if (typeof value === 'boolean') { return String(value); }
            if (typeof value !== 'object') { return undefined; }
            for (i = 0; i < stack.length; i++) { if (stack[i] === value) { fail('E_JSON_CYCLE', 'JSON 数据包含循环引用。'); } }
            for (var name in value) { if (own(value, name) && reserved(name)) { fail('E_RESERVED_KEY', 'JSON 数据包含保留字段。'); } }
            stack.push(value); priorIndent = indent; indent += gap;
            if (array(value)) {
                if (value.length > MAX_VALUES) { fail('E_JSON_LIMIT', 'JSON 数组超过预算。'); }
                for (i = 0; i < value.length; i++) { encoded = encode(value, String(i), depth + 1); parts.push(encoded === undefined ? 'null' : encoded); }
                result = parts.length === 0 ? '[]' : gap ? '[\n' + indent + parts.join(',\n' + indent) + '\n' + priorIndent + ']' : '[' + parts.join(',') + ']';
            } else {
                if (propertyList !== null) { names = propertyList; }
                else { for (name in value) { if (own(value, name)) { names.push(name); } } }
                for (i = 0; i < names.length; i++) {
                    if (!own(value, names[i])) { continue; }
                    encoded = encode(value, names[i], depth + 1);
                    if (encoded !== undefined) { parts.push(quote(names[i]) + (gap ? ': ' : ':') + encoded); }
                }
                result = parts.length === 0 ? '{}' : gap ? '{\n' + indent + parts.join(',\n' + indent) + '\n' + priorIndent + '}' : '{' + parts.join(',') + '}';
            }
            stack.pop(); indent = priorIndent;
            if (result.length > MAX_CHARS) { fail('E_JSON_LIMIT', 'JSON 输出超过预算。'); }
            return result;
        }
        var result = encode({ '': input }, '', 0);
        if (result !== undefined && result.length > MAX_CHARS) { fail('E_JSON_LIMIT', 'JSON 输出超过预算。'); }
        return result;
    }
    return { parse: parse, stringify: stringify, maxChars: MAX_CHARS };
})();
/* Existing adapters use JSON; install only where the host has no native codec. */
if (typeof JSON === 'undefined') { var JSON = AEBrowseJSON; }


/* Source: src/native-shape-plan.jsxinc */
/* ES3-compatible planning shared by Node boundary tests and the AE test adapter. */
var AEBrowsePlan = (function () {
    function fail(code, message) { var error = new Error(message); error.code = code; throw error; }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function object(value) { return value !== null && typeof value === 'object' && !(value instanceof Array); }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function finite(value) { return typeof value === 'number' && isFinite(value); }
    function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
    function vector(value, count, color) {
        if (!(value instanceof Array) || value.length !== count) { return false; }
        for (var i = 0; i < count; i++) { if (!finite(value[i]) || (color && (value[i] < 0 || value[i] > 1))) { return false; } }
        return true;
    }
    function fits(descriptor, value) {
        if (descriptor.type === 'number') { return finite(value) && (descriptor.min === undefined || value >= descriptor.min) && (descriptor.max === undefined || value <= descriptor.max); }
        if (descriptor.type === 'color') { return vector(value, 4, true); }
        if (descriptor.type === 'point2') { return vector(value, 2, false); }
        if (descriptor.type === 'boolean') { return typeof value === 'boolean'; }
        if (descriptor.type === 'text') { return typeof value === 'string'; }
        if (descriptor.type === 'enum' && descriptor.options instanceof Array) { for (var i = 0; i < descriptor.options.length; i++) { if (descriptor.options[i] === value) { return true; } } }
        return false;
    }
    function scan(value, depth) {
        if (depth > 64) { fail('E_DEPTH_LIMIT', '数据嵌套过深。'); }
        if (typeof value === 'number' && !finite(value)) { fail('E_NUMBER_NONFINITE', '数值必须是有限数值。'); }
        if (value && typeof value === 'object') { for (var key in value) { if (own(value, key)) { if (key === '__proto__' || key === 'constructor' || key === 'prototype') { fail('E_RESERVED_KEY', '包含保留字段。'); } scan(value[key], depth + 1); } } }
    }
    function parameters(asset, overrides) {
        if (!object(overrides)) { fail('E_PARAMETERS_FORMAT', '参数覆盖必须是对象。'); }
        var result = {}, descriptors = {}, list = asset.parameters || [], i, key;
        if (!(list instanceof Array)) { fail('E_PARAMETERS_FORMAT', '参数声明必须是数组。'); }
        for (i = 0; i < list.length; i++) {
            var descriptor = list[i];
            if (!object(descriptor) || !validId(descriptor.id) || own(descriptors, '$' + descriptor.id)) { fail('E_PARAMETER_ID', '参数 ID 无效或重复。'); }
            descriptors['$' + descriptor.id] = descriptor;
            var value = own(overrides, descriptor.id) ? overrides[descriptor.id] : descriptor.default;
            if (!fits(descriptor, value)) { fail('E_PARAMETER_VALUE', '参数值不符合类型或范围：' + descriptor.id); }
            result[descriptor.id] = clone(value);
        }
        for (key in overrides) { if (own(overrides, key) && !own(descriptors, '$' + key)) { fail('E_PARAMETER_UNKNOWN', '不认识的参数：' + key); } }
        return { values: result, descriptors: descriptors };
    }
    function binding(spec, values) {
        if (!object(spec) || !own(spec, 'bind')) { fail('E_BINDING_FORMAT', '图形属性需要参数绑定。'); }
        if (spec.bind instanceof Array) { var result = []; for (var i = 0; i < spec.bind.length; i++) { result.push(binding({ bind: spec.bind[i] }, values)); } return result; }
        if (typeof spec.bind !== 'string' || !own(values, spec.bind)) { fail('E_BINDING_MISSING', '图形引用了不存在的参数。'); }
        return clone(values[spec.bind]);
    }
    function plan(asset, payload, overrides, context) {
        scan(asset, 0); scan(payload, 0); scan(overrides, 0);
        if (!object(asset) || asset.kind !== 'ae.nativeShape') { fail('E_KIND_UNSUPPORTED', '当前测试适配器只生成原生形状。'); }
        if ((asset.resources && (!(asset.resources instanceof Array) || asset.resources.length > 0)) || (asset.requirements && asset.requirements.fonts !== undefined)) { fail('E_RESOURCE_ADAPTER_REQUIRED', '附属资源或字体需要额外适配器，当前入口不忽略它们。'); }
        if (!object(payload) || payload.formatVersion !== 1 || !(payload.nodes instanceof Array)) { fail('E_PAYLOAD_VERSION', '图形描述格式不支持。'); }
        if (!object(context) || !finite(context.width) || !finite(context.height) || !finite(context.duration) || context.width <= 0 || context.height <= 0 || context.duration <= 0) { fail('E_NO_ACTIVE_COMP', '需要有效的目标合成。'); }
        var parsed = parameters(asset, overrides || {}), values = parsed.values;
        var nodes = {}, layerNode = null, shapeNode = null, fillNode = null, i, key;
        for (i = 0; i < payload.nodes.length; i++) {
            var node = payload.nodes[i];
            if (!object(node) || !validId(node.id) || own(nodes, '$' + node.id)) { fail('E_NODE_ID', '图形节点 ID 无效或重复。'); }
            nodes['$' + node.id] = node;
            if (node.type === 'shapeLayer' && layerNode === null) { layerNode = node; }
            else if ((node.type === 'rectangle' || node.type === 'ellipse' || node.type === 'polygon' || node.type === 'star') && shapeNode === null) { shapeNode = node; }
            else if (node.type === 'fill' && fillNode === null) { fillNode = node; }
            else { fail('E_NODE_KIND_UNSUPPORTED', '当前适配器支持一个形状层、一个基础几何图形和一个填充。'); }
        }
        if (!layerNode || !shapeNode || !fillNode || shapeNode.parent !== layerNode.id || fillNode.parent !== shapeNode.id) { fail('E_NODE_GRAPH', '图形节点层级不支持。'); }
        if (layerNode.anchor !== 'center' || layerNode.position !== 'compCenter') { fail('E_POSITION_MODE', '当前测试适配器使用中心锚点与合成中心定位。'); }
        var geometry = {}, bindings = { color: fillNode.color.bind }, color = binding(fillNode.color, values);
        if (!vector(color, 4, true)) { fail('E_GEOMETRY_VALUE', '图形颜色无效。'); }
        if (shapeNode.type === 'rectangle' || shapeNode.type === 'ellipse') {
            geometry.size = binding(shapeNode.size, values); bindings.size = clone(shapeNode.size.bind);
            if (!vector(geometry.size, 2, false) || geometry.size[0] <= 0 || geometry.size[1] <= 0) { fail('E_GEOMETRY_VALUE', '图形尺寸无效。'); }
            if (shapeNode.type === 'rectangle') {
                geometry.radius = binding(shapeNode.roundness, values); bindings.radius = shapeNode.roundness.bind;
                if (!finite(geometry.radius) || geometry.radius < 0) { fail('E_GEOMETRY_VALUE', '圆角无效。'); }
            }
        } else {
            var fields = ['points', 'outerRadius', 'rotation'];
            if (shapeNode.type === 'star') { fields.push('innerRadius'); }
            for (i = 0; i < fields.length; i++) { key = fields[i]; geometry[key] = binding(shapeNode[key], values); bindings[key] = shapeNode[key].bind; }
            if (!finite(geometry.points) || Math.floor(geometry.points) !== geometry.points || geometry.points < 3 || geometry.points > 64 || !finite(geometry.outerRadius) || geometry.outerRadius <= 0 || !finite(geometry.rotation) || (shapeNode.type === 'star' && (!finite(geometry.innerRadius) || geometry.innerRadius <= 0 || geometry.innerRadius >= geometry.outerRadius))) { fail('E_GEOMETRY_VALUE', '边数或角数须为 3–64 的整数；星形内半径须大于零并小于外半径。'); }
        }
        var states = payload.states || [], stateIds = {};
        if (!(states instanceof Array)) { fail('E_STATE_FORMAT', '状态必须是数组。'); }
        for (i = 0; i < states.length; i++) {
            var state = states[i];
            if (!object(state) || !validId(state.id) || own(stateIds, '$' + state.id) || !object(state.parameters)) { fail('E_STATE_FORMAT', '状态 ID 或参数声明无效。'); }
            stateIds['$' + state.id] = true;
            for (key in state.parameters) { if (own(state.parameters, key) && (!own(parsed.descriptors, '$' + key) || !fits(parsed.descriptors['$' + key], state.parameters[key]))) { fail('E_STATE_PARAMETER', '状态包含不存在或无效的参数：' + key); } }
        }
        var motion = values.motion === undefined ? 'none' : values.motion;
        var insertTime = context.insertTime === undefined ? 0 : context.insertTime;
        var duration = motion === 'none' ? 0 : values.duration;
        if (!finite(insertTime) || insertTime < 0 || insertTime >= context.duration) { fail('E_INSERT_TIME', '插入时间必须位于目标合成内。'); }
        if (!finite(duration) || duration < 0 || (motion !== 'none' && duration <= 0) || insertTime + duration > context.duration + 0.000001) { fail('E_DURATION_OUTSIDE_COMP', '动画时长超过目标合成可用区间。'); }
        var animation = null, recipes = payload.animations || [], recipeIds = {};
        if (!(recipes instanceof Array)) { fail('E_ANIMATION_FORMAT', '动画必须是数组。'); }
        for (i = 0; i < recipes.length; i++) {
            var recipe = recipes[i];
            if (!object(recipe) || !validId(recipe.id) || own(recipeIds, '$' + recipe.id) || recipe.target !== layerNode.id || recipe.channel !== 'scale' || recipe.timeOrigin !== 'insertTime' || !(recipe.values instanceof Array) || recipe.values.length < 2) { fail('E_ANIMATION_FORMAT', '动画声明或目标无效。'); }
            recipeIds['$' + recipe.id] = true;
            for (var j = 0; j < recipe.values.length; j++) { if (!vector(recipe.values[j], 2, false)) { fail('E_ANIMATION_VALUE', '动画关键帧数值无效。'); } }
            var recipeDuration = binding(recipe.duration, values);
            if (!finite(recipeDuration) || recipeDuration <= 0) { fail('E_ANIMATION_VALUE', '动画时长绑定无效。'); }
            if (recipe.id === motion) { animation = { channel: 'scale', values: clone(recipe.values) }; }
        }
        if (motion === 'slide') { animation = { channel: 'position', values: [[context.width / 2, context.height / 2 + 64], [context.width / 2, context.height / 2]] }; }
        if (motion === 'fade') { animation = { channel: 'opacity', values: [0, 100] }; }
        if (motion === 'none') { animation = null; }
        if (motion !== 'none' && animation === null) { fail('E_ANIMATION_UNSUPPORTED', '当前图形没有这个动画的实现。'); }
        var effects = asset.effects || [], effectIds = {}, selectedEffects = [], diagnostics = [];
        if (!(effects instanceof Array) || !(context.installedEffects instanceof Array)) { fail('E_EFFECTS_FORMAT', '缺少效果声明或宿主效果清单。'); }
        for (i = 0; i < effects.length; i++) {
            var effect = effects[i];
            if (!object(effect) || !validId(effect.id) || own(effectIds, '$' + effect.id) || typeof effect.matchName !== 'string' || !effect.matchName || effect.target !== layerNode.id || typeof effect.required !== 'boolean' || !(effect.settings instanceof Array)) { fail('E_EFFECT_DESCRIPTOR', '效果声明、实例 ID 或目标无效。'); }
            effectIds['$' + effect.id] = true;
            for (j = 0; j < effect.settings.length; j++) {
                var setting = effect.settings[j];
                if (!object(setting) || !(setting.path instanceof Array) || setting.path.length < 1 || setting.valueType === 'enum' || !fits({ type: setting.valueType }, setting.value)) { fail('E_EFFECT_VALUE', '效果参数类型不支持。'); }
                for (var k = 0; k < setting.path.length; k++) { var selector = setting.path[k]; if (!object(selector) || typeof selector.matchName !== 'string' || !selector.matchName || !finite(selector.occurrence) || Math.floor(selector.occurrence) !== selector.occurrence || selector.occurrence < 1) { fail('E_EFFECT_PROPERTY_PATH', '效果属性路径无效。'); } }
            }
            var available = false;
            for (j = 0; j < context.installedEffects.length; j++) { if (context.installedEffects[j] === effect.matchName) { available = true; break; } }
            if (!available) {
                if (effect.required) { fail('E_EFFECT_MISSING', '缺少必需效果：' + effect.matchName); }
                diagnostics.push({ code: 'W_EFFECT_MISSING', message: '跳过不可用的可选效果：' + effect.matchName, effectId: effect.id });
            } else { selectedEffects.push(clone(effect)); }
        }
        var result = { assetId: asset.id, name: asset.name, parameters: values, bindings: bindings, geometryType: shapeNode.type, color: color, position: [context.width / 2, context.height / 2], insertTime: insertTime, duration: duration, motion: motion, animation: animation, effects: selectedEffects, diagnostics: diagnostics };
        for (key in geometry) { if (own(geometry, key)) { result[key] = geometry[key]; } }
        return result;
    }
    function same(a, b) {
        if (typeof a === 'number' && typeof b === 'number') { return Math.abs(a - b) < 0.00001; }
        if (a === b) { return true; }
        if (!a || !b || typeof a !== typeof b || typeof a !== 'object') { return false; }
        var countA = 0, countB = 0;
        for (var key in a) { if (own(a, key)) { countA++; if (!own(b, key) || !same(a[key], b[key])) { return false; } } }
        for (key in b) { if (own(b, key)) { countB++; } }
        return countA === countB;
    }
    return { plan: plan, parameters: parameters, same: same, clone: clone, fail: fail, scan: scan };
})();


/* Source: src/native-shape-adapter.jsxinc */
/* AE native geometry adapter shared by the CEP host and explicit round-trip tests. */
var AEBrowseNative = (function () {
    var PREFIX = 'AEBrowse:';
    function fail(code, message) { AEBrowsePlan.fail(code, message); }
    function readJSON(file) {
        if (!file.exists) { fail('E_FILE_MISSING', '文件缺失：' + file.fsName); }
        if (file.length > 4 * 1024 * 1024) { fail('E_SOURCE_LIMIT', 'JSON 文件超过读取预算。'); }
        file.encoding = 'UTF-8';
        if (!file.open('r')) { fail('E_FILE_READ', '无法读取文件：' + file.fsName); }
        var content;
        try { content = file.read(); } finally { file.close(); }
        var data;
        try { data = JSON.parse(content.replace(/^\uFEFF/, '')); } catch (_) { fail('E_JSON_INVALID', 'JSON 文件损坏。'); }
        AEBrowsePlan.scan(data, 0);
        return data;
    }
    function pathInPack(directory, relative) {
        if (typeof relative !== 'string' || !relative || /[\u0000-\u001f<>:"|?*]/.test(relative)) { fail('E_PATH_INVALID', '需要包内相对路径。'); }
        relative = relative.replace(/\\/g, '/');
        var parts = relative.split('/');
        for (var i = 0; i < parts.length; i++) { if (!parts[i] || parts[i] === '.' || parts[i] === '..' || /[. ]$/.test(parts[i]) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(parts[i])) { fail('E_PATH_INVALID', '需要规范的包内相对路径。'); } }
        return new File(directory.fsName + '/' + relative);
    }
    function load(directory, assetId) {
        var root = new Folder(directory), manifest = readJSON(new File(root.fsName + '/pack.json'));
        if (!manifest || manifest.schemaVersion !== 1 || !manifest.pack || !(manifest.assets instanceof Array)) { fail('E_SCHEMA_VERSION', '图形包格式不支持。'); }
        var asset = null;
        for (var i = 0; i < manifest.assets.length; i++) { if (manifest.assets[i].id === assetId) { if (asset !== null) { fail('E_ASSET_DUPLICATE', '素材 ID 重复。'); } asset = manifest.assets[i]; } }
        if (asset === null) { fail('E_ASSET_MISSING', '图形包中没有这个素材。'); }
        if (asset.kind !== 'ae.nativeShape' || !/\.json$/i.test(asset.source)) { fail('E_KIND_UNSUPPORTED', '当前适配器只读取 JSON 原生形状。'); }
        return { manifest: manifest, asset: asset, payload: readJSON(pathInPack(root, asset.source)) };
    }
    function installedEffects() { var result = [], list = app.effects; for (var i = 0; i < list.length; i++) { result.push(list[i].matchName); } return result; }
    function meta(layer, required) {
        if (!layer || typeof layer.comment !== 'string' || layer.comment.indexOf(PREFIX) !== 0) { if (required) { fail('E_INSTANCE_UNKNOWN', '图层不是本工具生成的实例。'); } return null; }
        try { var value = JSON.parse(layer.comment.substring(PREFIX.length)); AEBrowsePlan.scan(value, 0); return value; }
        catch (_) { if (required) { fail('E_INSTANCE_METADATA', '实例信息已损坏。'); } return null; }
    }
    function findProperty(group, selectors) {
        var current = group;
        for (var i = 0; i < selectors.length; i++) {
            var found = null, occurrence = 0;
            for (var j = 1; j <= current.numProperties; j++) { var candidate = current.property(j); if (candidate.matchName === selectors[i].matchName) { occurrence++; if (occurrence === selectors[i].occurrence) { found = candidate; break; } } }
            if (found === null) { fail('E_EFFECT_PROPERTY_PATH', '效果参数路径不存在：' + selectors[i].matchName); }
            current = found;
        }
        return current;
    }
    function geometry(layer, metadata) {
        var contents = layer.property('ADBE Root Vectors Group').property(metadata.groupIndex).property('ADBE Vectors Group');
        var type = metadata.geometryType || 'rectangle', shape = contents.property(metadata.shapeIndex || metadata.rectangleIndex);
        var expected = 'ADBE Vector Shape - Star';
        if (type === 'rectangle') { expected = 'ADBE Vector Shape - Rect'; }
        else if (type === 'ellipse') { expected = 'ADBE Vector Shape - Ellipse'; }
        if (!shape || shape.matchName !== expected) { fail('E_INSTANCE_CHANGED', '实例图形结构已经更改。'); }
        return { shape: shape, fill: contents.property(metadata.fillIndex) };
    }
    function geometryFields(type) {
        if (type === 'rectangle') { return [['size', 'ADBE Vector Rect Size'], ['radius', 'ADBE Vector Rect Roundness']]; }
        if (type === 'ellipse') { return [['size', 'ADBE Vector Ellipse Size']]; }
        var result = [['points', 'ADBE Vector Star Points'], ['outerRadius', 'ADBE Vector Star Outer Radius'], ['rotation', 'ADBE Vector Star Rotation']];
        if (type === 'star') { result.push(['innerRadius', 'ADBE Vector Star Inner Radius']); }
        return result;
    }
    function appearanceProperties(layer, metadata) {
        var shape = geometry(layer, metadata), fields = geometryFields(metadata.geometryType || 'rectangle'), result = [];
        for (var i = 0; i < fields.length; i++) { result.push({ key: fields[i][0], property: shape.shape.property(fields[i][1]) }); }
        result.push({ key: 'color', property: shape.fill.property('ADBE Vector Fill Color') });
        result.push({ key: 'fillOpacity', property: shape.fill.property('ADBE Vector Fill Opacity') });
        return result;
    }
    function appearanceValue(plan, key) {
        // AE stores a fourth color component but renders transparency through
        // the fill's own opacity, independently of the layer's entrance animation.
        return key === 'fillOpacity' ? plan.color[3] * 100 : plan[key];
    }
    function writeGeometry(layer, metadata, plan) {
        var properties = appearanceProperties(layer, metadata);
        for (var i = 0; i < properties.length; i++) { properties[i].property.setValue(appearanceValue(plan, properties[i].key)); }
    }
    function easeValues(values) { var result = []; for (var i = 0; i < values.length; i++) { result.push({ speed: values[i].speed, influence: values[i].influence }); } return result; }
    function snapshot(layer, metadata) {
        var shape = geometry(layer, metadata), transform = layer.property('ADBE Transform Group');
        var result = { position: transform.property('ADBE Position').valueAtTime(metadata.insertTime, true), geometryPropertyState: [], animation: [], effects: [], effectsTotal: layer.property('ADBE Effect Parade').numProperties };
        var geometryProperties = appearanceProperties(layer, metadata);
        for (var g = 0; g < geometryProperties.length; g++) {
            var gp = geometryProperties[g];
            if (gp.key === 'fillOpacity') {
                // Opaque, unanimated legacy instances have no opacity field in
                // their baseline. Keep that representation readable, while any
                // manual opacity value, keyframe or expression remains visible.
                if (gp.property.value !== 100 || gp.property.numKeys > 0 || gp.property.expressionEnabled || (metadata.baseline && Object.prototype.hasOwnProperty.call(metadata.baseline, 'fillOpacity'))) {
                    result.fillOpacity = { value: gp.property.value, keys: gp.property.numKeys, expression: gp.property.expressionEnabled };
                }
                continue;
            }
            result[gp.key] = gp.property.value;
            result.geometryPropertyState.push({ keys: gp.property.numKeys, expression: gp.property.expressionEnabled });
        }
        if (metadata.geometryType === 'polygon' || metadata.geometryType === 'star') { result.polystarType = shape.shape.property('ADBE Vector Star Type').value; }
        var channels = ['ADBE Scale', 'ADBE Position', 'ADBE Opacity'];
        for (var i = 0; i < channels.length; i++) {
            var property = transform.property(channels[i]), keys = [];
            if (property.expressionEnabled) { fail('E_INSTANCE_EXPRESSION', '实例含手工表达式，当前测试适配器不覆盖它。'); }
            for (var j = 1; j <= property.numKeys; j++) { keys.push({ time: property.keyTime(j) - metadata.insertTime, value: property.keyValue(j), inType: String(property.keyInInterpolationType(j)), outType: String(property.keyOutInterpolationType(j)), inEase: easeValues(property.keyInTemporalEase(j)), outEase: easeValues(property.keyOutTemporalEase(j)) }); }
            result.animation.push({ channel: channels[i], keys: keys });
        }
        var effects = layer.property('ADBE Effect Parade');
        for (i = 0; i < metadata.effects.length; i++) {
            var record = metadata.effects[i], effect = effects.property(record.index);
            if (!effect || effect.matchName !== record.descriptor.matchName) { fail('E_INSTANCE_CHANGED', '效果结构已经手工更改。'); }
            var descriptor = AEBrowsePlan.clone(record.descriptor);
            var propertyState = [];
            for (j = 0; j < descriptor.settings.length; j++) { var settingProperty = findProperty(effect, descriptor.settings[j].path); descriptor.settings[j].value = settingProperty.valueAtTime(metadata.insertTime, true); propertyState.push({ keys: settingProperty.numKeys, expression: settingProperty.expressionEnabled }); }
            result.effects.push({ descriptor: descriptor, enabled: effect.enabled, propertyState: propertyState });
        }
        return result;
    }
    function capture(layer) {
        var metadata = meta(layer, true), observed;
        try { observed = snapshot(layer, metadata); } catch (error) { if (error.code) { throw error; } fail('E_INSTANCE_CHANGED', '实例图形结构已经更改。'); }
        var values = AEBrowsePlan.clone(metadata.parameters);
        for (var key in metadata.bindings) {
            if (Object.prototype.hasOwnProperty.call(metadata.bindings, key)) {
                var target = metadata.bindings[key];
                if (target instanceof Array) { for (var b = 0; b < target.length; b++) { values[target[b]] = observed[key][b]; } }
                else { values[target] = observed[key]; }
            }
        }
        return { packId: metadata.packId, assetId: metadata.assetId, parameters: values, observed: observed, modified: !AEBrowsePlan.same(observed, metadata.baseline) };
    }
    function create(comp, loaded, overrides, options) {
        options = options || {};
        if (!(comp instanceof CompItem)) { fail('E_NO_ACTIVE_COMP', '需要目标合成。'); }
        var plan = AEBrowsePlan.plan(loaded.asset, loaded.payload, overrides || {}, { width: comp.width, height: comp.height, duration: comp.duration, insertTime: options.insertTime === undefined ? comp.time : options.insertTime, installedEffects: installedEffects() });
        var instanceId = options.instanceId || ('instance-' + new Date().getTime() + '-' + Math.floor(Math.random() * 100000));
        var sourceSignature = JSON.stringify({ payload: loaded.payload, effects: loaded.asset.effects || [] });
        for (var existingIndex = 1; existingIndex <= comp.numLayers; existingIndex++) {
            var existing = comp.layer(existingIndex), existingMeta = meta(existing, false);
            if (existingMeta && existingMeta.packId === loaded.manifest.pack.id && existingMeta.instanceId === instanceId) {
                if (existingMeta.assetId === loaded.asset.id && existingMeta.packVersion === loaded.manifest.pack.version && existingMeta.sourceSignature === sourceSignature && Math.abs(existingMeta.insertTime - plan.insertTime) < .000001 && AEBrowsePlan.same(existingMeta.parameters, plan.parameters) && !capture(existing).modified) { return { layer: existing, reused: true, diagnostics: plan.diagnostics }; }
                fail('E_INSTANCE_CONFLICT', '同一次导入的实例已有不同参数或手工修改。');
            }
        }
        var layer = null;
        try {
            layer = comp.layers.addShape(); layer.name = plan.name;
            var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
            var groupIndex = group.propertyIndex;
            var contents = group.property('ADBE Vectors Group');
            var shapeMatchName = 'ADBE Vector Shape - Star';
            if (plan.geometryType === 'rectangle') { shapeMatchName = 'ADBE Vector Shape - Rect'; }
            else if (plan.geometryType === 'ellipse') { shapeMatchName = 'ADBE Vector Shape - Ellipse'; }
            var shapeIndex = contents.addProperty(shapeMatchName).propertyIndex;
            var fillIndex = contents.addProperty('ADBE Vector Graphic - Fill').propertyIndex;
            var metadata = { schemaVersion: 1, instanceId: instanceId, packId: loaded.manifest.pack.id, packVersion: loaded.manifest.pack.version, sourceSignature: sourceSignature, assetId: loaded.asset.id, parameters: plan.parameters, bindings: plan.bindings, insertTime: plan.insertTime, groupIndex: groupIndex, geometryType: plan.geometryType, shapeIndex: shapeIndex, rectangleIndex: shapeIndex, fillIndex: fillIndex, effects: [] };
            var shape = geometry(layer, metadata);
            if (plan.geometryType === 'polygon' || plan.geometryType === 'star') { shape.shape.property('ADBE Vector Star Type').setValue(plan.geometryType === 'polygon' ? 2 : 1); }
            writeGeometry(layer, metadata, plan);
            var transform = layer.property('ADBE Transform Group');
            transform.property('ADBE Position').setValue(plan.position);
            layer.inPoint = plan.insertTime;
            if (plan.animation) {
                var propertyMatchName = 'ADBE Opacity';
                if (plan.animation.channel === 'scale') { propertyMatchName = 'ADBE Scale'; }
                else if (plan.animation.channel === 'position') { propertyMatchName = 'ADBE Position'; }
                var property = transform.property(propertyMatchName);
                if (!property || property.matchName !== propertyMatchName) { fail('E_ANIMATION_PROPERTY', '动画属性定位与预期不一致。'); }
                for (var i = 0; i < plan.animation.values.length; i++) {
                    var value = AEBrowsePlan.clone(plan.animation.values[i]);
                    if (plan.animation.channel === 'scale' && property.value.length === 3 && value.length === 2) { value.push(100); }
                    property.setValueAtTime(plan.insertTime + plan.duration * i / (plan.animation.values.length - 1), value);
                }
            }
            for (i = 0; i < plan.effects.length; i++) {
                var descriptor = plan.effects[i], effectIndex = null;
                try {
                    var effects = layer.property('ADBE Effect Parade');
                    if (!effects.canAddProperty(descriptor.matchName)) { fail('E_EFFECT_MISSING', '目标图层不能添加这个效果。'); }
                    effectIndex = effects.addProperty(descriptor.matchName).propertyIndex;
                    for (var j = 0; j < descriptor.settings.length; j++) {
                        var setting = descriptor.settings[j], effect = layer.property('ADBE Effect Parade').property(effectIndex);
                        var target = findProperty(effect, setting.path);
                        target.setValue(setting.value);
                        if (!AEBrowsePlan.same(target.value, setting.value)) { fail('E_EFFECT_VALUE_ROUNDTRIP', '效果参数被宿主改变，不能确认还原。'); }
                    }
                    metadata.effects.push({ index: effectIndex, descriptor: descriptor });
                } catch (effectError) {
                    if (descriptor.required) { throw effectError; }
                    if (effectIndex !== null) { layer.property('ADBE Effect Parade').property(effectIndex).remove(); }
                    plan.diagnostics.push({ code: 'W_EFFECT_SKIPPED', effectId: descriptor.id, message: String(effectError) });
                }
            }
            metadata.baseline = snapshot(layer, metadata);
            layer.comment = PREFIX + JSON.stringify(metadata);
            return { layer: layer, reused: false, diagnostics: plan.diagnostics };
        } catch (error) { if (layer !== null) { layer.remove(); } throw error; }
    }
    function updateAppearance(layer, loaded, overrides, options) {
        options = options || {};
        var metadata = meta(layer, true);
        if (layer.locked) { fail('E_SELECTION_LOCKED', '图层已锁定。'); }
        if (metadata.packId !== loaded.manifest.pack.id || metadata.assetId !== loaded.asset.id) { fail('E_INSTANCE_IDENTITY', '素材身份不匹配。'); }
        if (metadata.packVersion !== loaded.manifest.pack.version || metadata.sourceSignature !== JSON.stringify({ payload: loaded.payload, effects: loaded.asset.effects || [] })) { fail('E_INSTANCE_SOURCE_CHANGED', '实例来源版本或内容已经变化，请使用创建时的图形库。'); }
        var current = capture(layer);
        if (current.modified) { fail('E_INSTANCE_MODIFIED', '实例已手工修改，当前更新已停止。'); }
        if (options.expected && (!AEBrowsePlan.same(options.expected.parameters, current.parameters) || !AEBrowsePlan.same(options.expected.observed, current.observed))) { fail('E_INSTANCE_STALE', '实例在读取后已经变化，请重新读取所选实例。'); }
        var values = AEBrowsePlan.clone(metadata.parameters);
        for (var key in overrides) { if (Object.prototype.hasOwnProperty.call(overrides, key)) { values[key] = overrides[key]; } }
        var comp = layer.containingComp;
        var plan = AEBrowsePlan.plan(loaded.asset, loaded.payload, values, { width: comp.width, height: comp.height, duration: comp.duration, insertTime: metadata.insertTime, installedEffects: installedEffects() });
        if (plan.motion !== metadata.parameters.motion || plan.parameters.duration !== metadata.parameters.duration) { fail('E_ANIMATION_UPDATE_UNSUPPORTED', '这个测试入口只更新外观，不重写动画。'); }
        if (plan.geometryType !== (metadata.geometryType || 'rectangle')) { fail('E_INSTANCE_IDENTITY', '更新不能改变实例的几何类型。'); }
        var properties = appearanceProperties(layer, metadata), old = [], oldComment = layer.comment;
        for (var i = 0; i < properties.length; i++) { if (properties[i].property.numKeys > 0 || properties[i].property.expressionEnabled) { fail('E_INSTANCE_MODIFIED', '外观参数已有动画或表达式。'); } old.push(AEBrowsePlan.clone(properties[i].property.value)); }
        try {
            writeGeometry(layer, metadata, plan);
            for (i = 0; i < properties.length; i++) { if (!AEBrowsePlan.same(properties[i].property.value, appearanceValue(plan, properties[i].key))) { fail('E_INSTANCE_READBACK', '宿主改变了外观参数，更新已停止。'); } }
            metadata.parameters = plan.parameters; metadata.baseline = snapshot(layer, metadata);
            layer.comment = PREFIX + JSON.stringify(metadata);
            var captured = capture(layer);
            if (captured.modified || !AEBrowsePlan.same(captured.parameters, plan.parameters)) { fail('E_INSTANCE_READBACK', '更新回读与预期参数不一致。'); }
            // Host response construction and serialization remain inside the rollback boundary.
            return options.finalize ? options.finalize(captured) : captured;
        } catch (error) {
            for (i = 0; i < properties.length; i++) { try { properties[i].property.setValue(old[i]); } catch (_) {} }
            try { layer.comment = oldComment; } catch (_) {}
            try {
                var originalMetadata = JSON.parse(oldComment.substring(PREFIX.length));
                error.rollbackConfirmed = layer.comment === oldComment && AEBrowsePlan.same(snapshot(layer, originalMetadata), current.observed);
            } catch (_) { error.rollbackConfirmed = false; }
            error.rollbackFailed = !error.rollbackConfirmed;
            throw error;
        }
    }
    function makeFolder(directory) { if (!directory.exists) { if (!directory.parent.exists) { makeFolder(directory.parent); } if (!directory.create()) { fail('E_EXPORT_WRITE', '无法创建导出目录。'); } } }
    function writeJSON(file, value) {
        if (file.exists) { fail('E_EXPORT_EXISTS', '导出文件已存在，停止覆盖。'); }
        makeFolder(file.parent); file.encoding = 'UTF-8';
        if (!file.open('w')) { fail('E_EXPORT_WRITE', '无法写入导出文件。'); }
        try { if (!file.write(JSON.stringify(value, null, 2))) { fail('E_EXPORT_WRITE', '写入导出文件失败。'); } } finally { file.close(); }
    }
    function exportPack(directory, loaded, layer) {
        var captured = capture(layer);
        if (captured.modified) { fail('E_INSTANCE_MODIFIED', '存在尚未支持导出的手工修改，请先明确保存策略。'); }
        var manifest = AEBrowsePlan.clone(loaded.manifest), asset = AEBrowsePlan.clone(loaded.asset);
        for (var i = 0; i < asset.parameters.length; i++) { asset.parameters[i].default = captured.parameters[asset.parameters[i].id]; }
        asset.effects = [];
        for (i = 0; i < captured.observed.effects.length; i++) { asset.effects.push(captured.observed.effects[i].descriptor); }
        delete asset.preview; delete asset.resources;
        manifest.assets = [asset];
        var root = new Folder(directory), manifestFile = new File(root.fsName + '/pack.json'), sourceFile = pathInPack(root, asset.source);
        if (manifestFile.exists || sourceFile.exists) { fail('E_EXPORT_EXISTS', '导出目标已有内容，停止覆盖。'); }
        writeJSON(sourceFile, loaded.payload); writeJSON(manifestFile, manifest);
        return { directory: root.fsName, packId: manifest.pack.id, assetId: asset.id };
    }
    return { load: load, create: create, capture: capture, updateAppearance: updateAppearance, exportPack: exportPack };
})();


/* Source: src/host-dispatch.jsxinc */
/* Fixed JSON-only CEP entry. Files and scripts from graphic packs are never loaded here. */
var AEBrowseHost = (function () {
    var PROTOCOL_VERSION = 1, BRIDGE_VERSION = '0.2.0', busy = false;
    var CAPABILITIES = ['shape.create', 'animation.keyframes', 'effect.add'];
    function fail(code, message) { var error = new Error(message); error.code = code; throw error; }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function array(value) { return value instanceof Array; }
    function object(value) { return value !== null && typeof value === 'object' && !array(value); }
    function id(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
    function integer(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0; }
    function text(value) { return typeof value === 'string' && /\S/.test(value) && value.length <= 16384; }
    function sameData(a, b) {
        if (a === b) { return true; }
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || array(a) !== array(b)) { return false; }
        var countA = 0, countB = 0;
        for (var key in a) { if (own(a, key)) { countA++; if (!own(b, key) || !sameData(a[key], b[key])) { return false; } } }
        for (key in b) { if (own(b, key)) { countB++; } }
        return countA === countB;
    }
    function length(value, max, code, label) { if (!array(value) || value.length > max) { fail(code, label + '格式无效或超过预算。'); } }
    function now() { return new Date().getTime(); }
    function activeComp() { var item = app.project ? app.project.activeItem : null; return item && item instanceof CompItem ? item : null; }
    function context() {
        var comp = activeComp();
        return { activeComp: comp !== null, comp: comp === null ? null : { id: comp.id, name: String(comp.name), width: comp.width, height: comp.height, duration: comp.duration, time: comp.time, frameRate: comp.frameRate }, selectionCount: comp === null ? 0 : comp.selectedLayers.length };
    }
    function effects() {
        var result = [], list = app.effects;
        if (!list || typeof list.length !== 'number' || list.length > 10000) { fail('E_HOST_EFFECTS', '无法读取有效的宿主效果清单。'); }
        for (var i = 0; i < list.length; i++) {
            if (list[i] && typeof list[i].matchName === 'string' && list[i].matchName) { result.push({ matchName: list[i].matchName, displayName: String(list[i].displayName || list[i].matchName) }); }
        }
        return result;
    }
    function hostInfo() { return { aeVersion: String(app.version), effects: effects(), capabilities: CAPABILITIES.slice(0), supportedKinds: ['ae.nativeShape'], bridgeVersion: BRIDGE_VERSION }; }
    function targetComp(target) {
        if (!object(target) || !integer(target.compId)) { fail('E_TARGET_FORMAT', '目标需要有效的合成 ID。'); }
        var comp = activeComp();
        if (comp === null) { fail('E_NO_ACTIVE_COMP', '请先打开目标合成。'); }
        if (comp.id !== target.compId) { fail('E_CONTEXT_CHANGED', '当前合成已经改变，请刷新后重新添加。'); }
        return comp;
    }
    function versionAtLeast(actual, minimum) {
        var a = String(actual).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/), b = String(minimum).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
        if (!a || !b) { return false; }
        for (var i = 1; i <= 3; i++) { var av = Number(a[i] || 0), bv = Number(b[i] || 0); if (av !== bv) { return av > bv; } }
        return true;
    }
    function requirements(asset) {
        if (asset.requirements === undefined) { return; }
        var declared = asset.requirements;
        if (!object(declared)) { fail('E_REQUIREMENTS_FORMAT', '素材依赖声明需要对象。'); }
        if (declared.aeMin !== undefined) {
            if (typeof declared.aeMin !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(declared.aeMin)) { fail('E_AE_VERSION_FORMAT', '最低 AE 版本格式无效。'); }
            if (!versionAtLeast(app.version, declared.aeMin)) { fail('E_AE_VERSION_LOW', '当前 AE 版本低于素材要求。'); }
        }
        if (declared.capabilities !== undefined) {
            length(declared.capabilities, 32, 'E_CAPABILITIES_FORMAT', '能力依赖');
            for (var i = 0; i < declared.capabilities.length; i++) {
                var found = false;
                if (!text(declared.capabilities[i])) { fail('E_CAPABILITIES_FORMAT', '能力依赖需要非空字符串。'); }
                for (var j = 0; j < CAPABILITIES.length; j++) { if (declared.capabilities[i] === CAPABILITIES[j]) { found = true; break; } }
                if (!found) { fail('E_CAPABILITY_MISSING', '当前执行入口不支持能力：' + declared.capabilities[i]); }
            }
        }
    }
    function loadedData(loaded) {
        if (!object(loaded) || !object(loaded.manifest) || !object(loaded.asset) || !object(loaded.payload)) { fail('E_LOADED_FORMAT', '执行数据缺少清单、素材或图形描述。'); }
        var manifest = loaded.manifest, asset = loaded.asset;
        if (manifest.schemaVersion !== 1) { fail('E_SCHEMA_VERSION', '不支持这个图形包格式版本。'); }
        if (!object(manifest.pack) || !id(manifest.pack.id) || typeof manifest.pack.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(manifest.pack.version) || !text(manifest.pack.name)) { fail('E_PACK_IDENTITY', '图形包身份、版本或名称无效。'); }
        length(manifest.assets, 5000, 'E_ASSET_LIMIT', '清单素材');
        if (!id(asset.id) || !text(asset.name)) { fail('E_ASSET_IDENTITY', '素材 ID 或名称无效。'); }
        var member = null, assetIds = {};
        for (var i = 0; i < manifest.assets.length; i++) {
            var candidate = manifest.assets[i];
            if (!object(candidate) || !id(candidate.id)) { fail('E_ASSET_IDENTITY', '清单包含无效素材身份。'); }
            if (own(assetIds, '$' + candidate.id)) { fail('E_ASSET_DUPLICATE', '清单素材 ID 重复。'); }
            assetIds['$' + candidate.id] = true;
            if (candidate.id === asset.id) { member = candidate; }
        }
        if (member === null) { fail('E_ASSET_MISSING', '执行素材不属于当前图形包。'); }
        if (!sameData(member, asset)) { fail('E_ASSET_IDENTITY', '执行素材与清单中的声明不一致。'); }
        if (asset.kind !== 'ae.nativeShape') { fail('E_KIND_UNSUPPORTED', '当前入口只支持原生形状素材。'); }
        if (typeof asset.source !== 'string' || !/\.json$/i.test(asset.source) || /[\u0000-\u001f<>:"|?*]/.test(asset.source)) { fail('E_SOURCE_FORMAT', '原生形状需要包内 JSON 描述。'); }
        var sourceParts = asset.source.replace(/\\/g, '/').split('/');
        for (i = 0; i < sourceParts.length; i++) { if (!sourceParts[i] || sourceParts[i] === '.' || sourceParts[i] === '..' || /[. ]$/.test(sourceParts[i]) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sourceParts[i])) { fail('E_SOURCE_FORMAT', '图形来源路径不规范。'); } }
        length(asset.parameters || [], 128, 'E_OPERATION_LIMIT', '参数声明');
        length(asset.effects || [], 64, 'E_OPERATION_LIMIT', '效果声明');
        for (i = 0; i < (asset.effects || []).length; i++) {
            var effect = asset.effects[i];
            if (!object(effect)) { fail('E_EFFECT_DESCRIPTOR', '效果声明格式无效。'); }
            length(effect.settings, 256, 'E_OPERATION_LIMIT', '效果设置');
            for (var j = 0; j < effect.settings.length; j++) { if (!object(effect.settings[j])) { fail('E_EFFECT_VALUE', '效果设置格式无效。'); } length(effect.settings[j].path, 16, 'E_OPERATION_LIMIT', '效果路径'); }
        }
        var payload = loaded.payload;
        length(payload.nodes, 3, 'E_OPERATION_LIMIT', '图形节点');
        length(payload.states || [], 128, 'E_OPERATION_LIMIT', '图形状态');
        length(payload.animations || [], 64, 'E_OPERATION_LIMIT', '图形动画');
        for (i = 0; i < (payload.animations || []).length; i++) { if (!object(payload.animations[i])) { fail('E_ANIMATION_FORMAT', '动画声明格式无效。'); } length(payload.animations[i].values, 2048, 'E_OPERATION_LIMIT', '动画关键帧'); }
        requirements(asset);
        return loaded;
    }
    function metadata(layer) {
        if (!layer || typeof layer.comment !== 'string' || layer.comment.indexOf('AEBrowse:') !== 0) { return null; }
        try { return AEBrowseJSON.parse(layer.comment.substring(9)); } catch (_) { return null; }
    }
    function guardOperation(comp, operationId, loaded) {
        if (comp.numLayers > 20000) { fail('E_OPERATION_LIMIT', '目标合成图层超过当前扫描预算。'); }
        var found = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i), meta = metadata(layer);
            if (meta && meta.instanceId === operationId) {
                if (found !== null || meta.packId !== loaded.manifest.pack.id || meta.assetId !== loaded.asset.id) { fail('E_INSTANCE_CONFLICT', '同一个操作 ID 已被其他实例使用。'); }
                found = layer;
            }
        }
        return found;
    }
    function instanceData(comp, layer, instanceId, reused, captured) {
        if (!layer || !integer(layer.id) || layer.containingComp !== comp) { fail('E_INSTANCE_READBACK', '无法确认创建图层身份。'); }
        var meta = metadata(layer);
        if (!meta || meta.schemaVersion !== 1 || meta.instanceId !== instanceId) { fail('E_INSTANCE_IDENTITY', '实例身份与请求不一致。'); }
        captured = captured || AEBrowseNative.capture(layer);
        return { compId: comp.id, layerId: layer.id, layerName: String(layer.name), instanceId: instanceId, reused: !!reused, packId: captured.packId, packVersion: meta.packVersion, assetId: captured.assetId, insertTime: meta.insertTime, parameters: captured.parameters, observed: captured.observed, modified: captured.modified };
    }
    function instantiate(request) {
        var comp = targetComp(request.target);
        if (!id(request.operationId)) { fail('E_OPERATION_ID', '创建请求需要稳定的操作 ID。'); }
        var payload = request.payload;
        if (!object(payload) || !object(payload.parameters) || typeof payload.insertTime !== 'number' || !isFinite(payload.insertTime)) { fail('E_PAYLOAD_FORMAT', '创建请求需要素材、参数对象与有限插入时间。'); }
        var loaded = loadedData(payload.loaded), installed = effects(), names = [];
        for (var i = 0; i < installed.length; i++) { names.push(installed[i].matchName); }
        /* Validate the full plan before the undo group or any AE writes. */
        AEBrowsePlan.plan(loaded.asset, loaded.payload, payload.parameters, { width: comp.width, height: comp.height, duration: comp.duration, insertTime: payload.insertTime, installedEffects: names });
        guardOperation(comp, request.operationId, loaded);
        if (targetComp(request.target) !== comp) { fail('E_CONTEXT_CHANGED', '执行前目标合成已经改变。'); }
        var opened = false, result = null, diagnostics = [], data, priorIds = {};
        for (i = 1; i <= comp.numLayers; i++) { priorIds['$' + comp.layer(i).id] = true; }
        try {
            app.beginUndoGroup('AE Browse · 添加图形'); opened = true;
            result = AEBrowseNative.create(comp, loaded, payload.parameters, { insertTime: payload.insertTime, instanceId: request.operationId });
            if (result.reused && !own(priorIds, '$' + result.layer.id)) { fail('E_INSTANCE_READBACK', '实例复用状态与创建结果不一致。'); }
            data = instanceData(comp, result.layer, request.operationId, result.reused);
            if (data.modified) { fail('E_INSTANCE_READBACK', '实例回读与创建基线不一致。'); }
            if (data.packId !== loaded.manifest.pack.id || data.assetId !== loaded.asset.id) { fail('E_INSTANCE_IDENTITY', '实例回读的素材身份不一致。'); }
            /* Serialization is part of readback: fail inside the group so cleanup still runs. */
            AEBrowseJSON.stringify(data);
            diagnostics = result.diagnostics || [];
        } catch (error) {
            /* This adapter creates only one layer synchronously. Also catch its failed removal before it can return a result. */
            var createdLayers = [], createdIds = {};
            for (i = 1; i <= comp.numLayers; i++) {
                var candidate = comp.layer(i);
                if (!own(priorIds, '$' + candidate.id)) { createdLayers.push(candidate); createdIds['$' + candidate.id] = true; }
            }
            for (i = 0; i < createdLayers.length; i++) { try { createdLayers[i].remove(); } catch (cleanupError) { error.cleanupError = String(cleanupError); } }
            for (i = 1; i <= comp.numLayers; i++) { if (own(createdIds, '$' + comp.layer(i).id)) { error.cleanupFailed = true; break; } }
            throw error;
        } finally { if (opened) { app.endUndoGroup(); } }
        return { data: data, diagnostics: diagnostics };
    }
    function readInstance(request) {
        var comp = targetComp(request.target), target = request.target, found = null;
        if (!integer(target.layerId) || !id(target.instanceId)) { fail('E_TARGET_FORMAT', '读取实例需要图层 ID 与实例 ID。'); }
        if (comp.numLayers > 20000) { fail('E_OPERATION_LIMIT', '目标合成图层超过当前扫描预算。'); }
        for (var i = 1; i <= comp.numLayers; i++) { var layer = comp.layer(i); if (layer.id === target.layerId) { found = layer; break; } }
        if (found === null) { fail('E_INSTANCE_MISSING', '目标图层已不存在。'); }
        return { data: instanceData(comp, found, target.instanceId, true), diagnostics: [] };
    }
    function selectedInstance(request) {
        var comp = targetComp(request.target), selection = comp.selectedLayers;
        if (selection.length !== 1) { fail('E_SELECTION_COUNT', '请在 AE 中只选择一个 AE Browse 图层。'); }
        var layer = selection[0], meta = metadata(layer);
        if (!meta || !id(meta.instanceId)) { fail('E_INSTANCE_UNKNOWN', '所选图层不是有效的 AE Browse 实例。'); }
        return { data: instanceData(comp, layer, meta.instanceId, false), diagnostics: [] };
    }
    function updateInstance(request) {
        var comp = targetComp(request.target), target = request.target, payload = request.payload;
        if (!id(request.operationId)) { fail('E_OPERATION_ID', '更新请求需要稳定的操作 ID。'); }
        if (!integer(target.layerId) || !id(target.instanceId)) { fail('E_TARGET_FORMAT', '更新需要有效的图层和实例 ID。'); }
        var selection = comp.selectedLayers;
        if (selection.length !== 1 || selection[0].id !== target.layerId) { fail('E_SELECTION_CHANGED', '所选图层已经改变，请重新读取所选实例。'); }
        var layer = selection[0], meta = metadata(layer);
        if (!meta || meta.instanceId !== target.instanceId || meta.schemaVersion !== 1) { fail('E_INSTANCE_IDENTITY', '实例身份与读取时不一致。'); }
        if (!object(payload.expected) || !object(payload.expected.parameters) || !object(payload.expected.observed)) { fail('E_EXPECTED_REQUIRED', '更新需要读取时的参数与属性快照。'); }
        if (!object(payload.parameters)) { fail('E_PAYLOAD_FORMAT', '更新参数需要对象。'); }
        var loaded = loadedData(payload.loaded), opened = false, data;
        try {
            app.beginUndoGroup('AE Browse · 更新外观'); opened = true;
            // Recheck selection after entering the host operation, before any property write.
            if (targetComp(target) !== comp || comp.selectedLayers.length !== 1 || comp.selectedLayers[0].id !== target.layerId) { fail('E_SELECTION_CHANGED', '执行前所选图层已经改变。'); }
            data = AEBrowseNative.updateAppearance(layer, loaded, payload.parameters, {
                expected: payload.expected,
                finalize: function (captured) {
                    var result = instanceData(comp, layer, target.instanceId, false, captured);
                    AEBrowseJSON.stringify(result);
                    return result;
                }
            });
        } finally { if (opened) { app.endUndoGroup(); } }
        return { data: data, diagnostics: [] };
    }
    function dispatch(requestJSON) {
        var start = now(), requestId = null, response = { protocolVersion: PROTOCOL_VERSION, requestId: null, ok: false, data: null, diagnostics: [], timing: { hostMs: 0 } }, acquired = false;
        try {
            if (typeof requestJSON !== 'string' || requestJSON.length > AEBrowseJSON.maxChars) { fail('E_REQUEST_LIMIT', '宿主请求格式无效或超过预算。'); }
            var request = AEBrowseJSON.parse(requestJSON);
            if (object(request) && id(request.requestId)) { requestId = request.requestId; response.requestId = requestId; }
            if (!object(request) || request.protocolVersion !== PROTOCOL_VERSION) { fail('E_PROTOCOL_VERSION', '宿主通信协议版本不支持。'); }
            if (requestId === null) { fail('E_REQUEST_ID', '请求需要有效的通信 ID。'); }
            if (typeof request.operation !== 'string' || !request.operation || request.operation.length > 128 || !object(request.payload) || !own(request, 'target') || (request.target !== null && !object(request.target))) { fail('E_REQUEST_FORMAT', '请求操作、目标或数据格式无效。'); }
            if (busy) { fail('E_HOST_BUSY', '宿主正在处理另一个请求。'); }
            busy = true; acquired = true;
            var result;
            if (request.operation === 'getHostInfo') { result = { data: hostInfo(), diagnostics: [] }; }
            else if (request.operation === 'getContext') { result = { data: context(), diagnostics: [] }; }
            else if (request.operation === 'instantiateAsset') { result = instantiate(request); }
            else if (request.operation === 'readInstance') { result = readInstance(request); }
            else if (request.operation === 'getSelectedInstance') { result = selectedInstance(request); }
            else if (request.operation === 'updateInstance') { result = updateInstance(request); }
            else { fail('E_OPERATION_UNSUPPORTED', '当前入口尚未支持操作：' + request.operation); }
            response.data = result.data; response.diagnostics = result.diagnostics; response.ok = true;
        } catch (error) {
            response.data = null; response.ok = false;
            response.diagnostics.push({ code: error.code || 'E_HOST_OPERATION', severity: 'error', phase: 'host', message: String(error.message || error) });
            if (error.cleanupFailed || error.cleanupError) { response.diagnostics.push({ code: 'E_CLEANUP_FAILED', severity: 'error', phase: 'cleanup', message: '本次创建的图层未能确认清理，请检查目标合成。' }); }
            if (error.rollbackConfirmed) { response.diagnostics.push({ code: 'I_UPDATE_ROLLED_BACK', severity: 'info', phase: 'rollback', message: '更新失败，已回读确认原外观和实例信息恢复。' }); }
            if (error.rollbackFailed) { response.diagnostics.push({ code: 'E_ROLLBACK_FAILED', severity: 'error', phase: 'rollback', message: '无法确认原外观完整恢复，请检查该图层并使用撤销。' }); }
        } finally { if (acquired) { busy = false; } response.timing.hostMs = Math.max(0, now() - start); }
        try { return AEBrowseJSON.stringify(response); }
        catch (serializationError) { return AEBrowseJSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId: requestId, ok: false, data: null, diagnostics: [{ code: serializationError.code || 'E_RESPONSE_SERIALIZE', severity: 'error', phase: 'host', message: '宿主结果无法序列化。' }], timing: { hostMs: Math.max(0, now() - start) } }); }
    }
    return { dispatch: dispatch, protocolVersion: PROTOCOL_VERSION, bridgeVersion: BRIDGE_VERSION };
})();

(function(){var before=app.project.numItems,report;app.beginUndoGroup("AE Browse temporary request consistency tests");try{report=JSON.parse((function () {
    var configFile = new File('D:/project/ae-browse/test-results/roundtrip-config.json');
    configFile.encoding = 'UTF-8'; configFile.open('r'); var config = JSON.parse(configFile.read()); configFile.close();
    var loaded = AEBrowseNative.load(config.library, 'rounded-card');
    var comp = null, report = { results: [], cleaned: false };
    function check(name, body) { try { body(); report.results.push({ name: name, passed: true }); } catch (error) { report.results.push({ name: name, passed: false, error: String(error) }); } }
    function require(condition, message) { if (!condition) { throw new Error(message); } }
    function conflict(data, time) { var rejected = false; try { AEBrowseNative.create(comp, data, {}, { insertTime: time, instanceId: config.runId + '-guard' }); } catch (error) { rejected = error.code === 'E_INSTANCE_CONFLICT'; } require(rejected && comp.numLayers === 1, 'Different request silently reused or mutated the instance'); }
    try {
        comp = app.project.items.addComp('__AEBrowse_' + config.runId + '_guards', 640, 360, 1, 4, 30);
        var initial = AEBrowseNative.create(comp, loaded, {}, { insertTime: .5, instanceId: config.runId + '-guard' });
        check('重复的相同请求仍可复用实例', function () { var repeated = AEBrowseNative.create(comp, loaded, {}, { insertTime: .5, instanceId: config.runId + '-guard' }); require(repeated.reused && repeated.layer.id === initial.layer.id && comp.numLayers === 1, 'Identical request did not reuse'); });
        check('同一操作 ID 的不同插入时间不会误复用', function () { conflict(loaded, 1); });
        check('同一操作 ID 的不同包版本不会误复用', function () { var changed = AEBrowsePlan.clone(loaded); changed.manifest.pack.version = '0.2.0'; conflict(changed, .5); });
        check('同一操作 ID 的不同效果内容不会误复用', function () { var changed = AEBrowsePlan.clone(loaded); changed.asset.effects[0].settings[0].value = 12; conflict(changed, .5); });
        check('二维尺寸参数能够更新并回读', function () { var changed = AEBrowsePlan.clone(loaded); changed.asset.parameters.push({ id: 'size', type: 'point2', "default": [320, 180] }); changed.payload.nodes[1].size.bind = 'size'; var created = AEBrowseNative.create(comp, changed, {}, { insertTime: 0 }); var updated = AEBrowseNative.updateAppearance(created.layer, changed, { size: [400, 220] }); require(updated.parameters.size[0] === 400 && updated.parameters.size[1] === 220, 'Point size did not round trip'); created.layer.remove(); });
    } finally { if (comp) { comp.remove(); report.cleaned = true; } }
    report.passed = 0; report.failed = 0;
    for (var i = 0; i < report.results.length; i++) { if (report.results[i].passed) { report.passed++; } else { report.failed++; } }
    return JSON.stringify(report);
})());}catch(e){report={error:String(e)};}finally{app.endUndoGroup();}var remaining=[];for(var i=1;i<=app.project.numItems;i++){var item=app.project.item(i);if(item.name==="__AEBrowse_roundtrip-1792217519704_guards")remaining.push({id:item.id,name:item.name});}report.runId="roundtrip-1792217519704";report.finished=true;report.cleanup={absentByItemScan:remaining.length===0,remaining:remaining,itemCount:app.project.numItems,originalItemCountRestored:app.project.numItems===before,projectSaved:false};var f=new File("D:/project/ae-browse/test-results/roundtrip-1792217519704/request-guards.json");f.encoding="UTF-8";if(f.open("w")){f.write(JSON.stringify(report,null,2));f.close();}})();