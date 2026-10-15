'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({ manifestBytes: 4 * 1024 * 1024, assets: 5000, depth: 64, textLength: 16384 });
const DEFAULT_KINDS = Object.freeze(['ae.nativeShape', 'ae.project', 'ae.ffx', 'ae.footage']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const TYPES = ['number', 'color', 'boolean', 'enum', 'text', 'point2'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const validId = v => typeof v === 'string' && ID.test(v);

function diagnostic(code, severity, phase, pointer, message, action, assetId) {
  return { code, severity, phase, scope: assetId === undefined ? 'pack' : 'asset', assetId: assetId === undefined ? null : assetId, pointer, message, actions: action ? [action] : [] };
}

function relativePath(input) {
  if (!text(input) || /[\u0000-\u001f<>:"|?*]/.test(input)) return null;
  const normalized = input.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return null;
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return null;
  return normalized;
}

function within(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function valueFits(type, value, descriptor = {}) {
  if (type === 'number') return Number.isFinite(value) && (descriptor.min === undefined || value >= descriptor.min) && (descriptor.max === undefined || value <= descriptor.max);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'text') return typeof value === 'string';
  if (type === 'color') return Array.isArray(value) && value.length === 4 && value.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
  if (type === 'point2') return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  if (type === 'enum') return Array.isArray(descriptor.options) && descriptor.options.includes(value);
  return false;
}

function versionNumbers(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

function versionAtLeast(actual, minimum) {
  const a = versionNumbers(actual), b = versionNumbers(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}

function validatePack(input, options = {}) {
  const diagnostics = [], assets = [];
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const knownKinds = new Set(options.kinds || DEFAULT_KINDS);
  const host = options.host || null;
  let root = null;
  if (options.root) {
    try { root = fs.realpathSync(options.root); }
    catch (_) { return { schemaVersion: 1, canRegister: false, allContractValid: false, assetCount: 0, assets: [], diagnostics: [diagnostic('E_PACK_READ', 'error', 'parse', '/', '无法读取图形包目录。', '检查目录与读取权限')] }; }
  }
  let manifest;
  const add = (code, severity, phase, pointer, message, action, id) => {
    const match = pointer.match(/^\/assets\/(\d+)(?:\/|$)/);
    if (id === undefined && match && code !== 'E_ASSET_DUPLICATE' && object(manifest) && Array.isArray(manifest.assets)) {
      const entry = manifest.assets[Number(match[1])];
      id = object(entry) && typeof entry.id === 'string' ? entry.id : '@' + match[1];
    }
    diagnostics.push(diagnostic(code, severity, phase, pointer, message, action, id));
  };
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > limits.manifestBytes) {
      add('E_MANIFEST_LIMIT', 'error', 'parse', '/', '图形包清单超过当前读取预算。', '拆分图形包或调整读取预算');
    } else {
      try { manifest = JSON.parse(input.replace(/^\uFEFF/, '')); }
      catch (_) { add('E_JSON_INVALID', 'error', 'parse', '/', '图形包清单不是有效的 JSON。', '修复 pack.json 后重新载入'); }
    }
  } else { manifest = input; }

  function walk(value, pointer, depth, id) {
    if (depth > limits.depth) { add('E_DEPTH_LIMIT', 'error', 'contract', pointer, '数据嵌套超过当前读取预算。', '减少嵌套层级', id); return; }
    if (typeof value === 'number' && !Number.isFinite(value)) add('E_NUMBER_NONFINITE', 'error', 'contract', pointer, '数值必须是有限数值。', '修正数值', id);
    if (typeof value === 'string' && value.length > limits.textLength) add('E_TEXT_LIMIT', 'error', 'contract', pointer, '文本超过当前读取预算。', '缩短文本或调整预算', id);
    if (value && typeof value === 'object') for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) add('E_RESERVED_KEY', 'error', 'contract', pointer + '/' + key, '使用了保留字段名。', '更换字段名', id);
      else walk(value[key], pointer + '/' + key, depth + 1, id);
    }
  }

  function file(inputPath, pointer, required, id, parseJson = false) {
    const normalized = relativePath(inputPath);
    if (!normalized) { add('E_PATH_INVALID', 'error', 'contract', pointer, '文件路径必须是包内的相对路径。', '将资源放入图形包并改用相对路径', id); return null; }
    if (!root) { add('W_FILES_UNCHECKED', 'warning', 'compatibility', pointer, '未提供图形包目录，尚未检查文件是否存在。', '从完整图形包目录载入', id); return null; }
    let actual;
    try { actual = fs.realpathSync(path.resolve(root, normalized)); }
    catch (_) { add(required ? 'E_FILE_MISSING' : 'W_PREVIEW_MISSING', required ? 'error' : 'warning', required ? 'contract' : 'preview', pointer, required ? '图形包缺少所需文件：' + normalized : '缩略图缺失，将使用占位预览。', required ? '重新复制完整图形包' : '补充缩略图', id); return null; }
    if (!within(root, actual)) { add('E_PATH_ESCAPE', 'error', 'contract', pointer, '文件链接指向图形包目录之外。', '复制实际文件到包内', id); return null; }
    if (!fs.statSync(actual).isFile()) { add('E_FILE_TYPE', 'error', 'contract', pointer, '资源路径必须指向文件。', '修正资源路径', id); return null; }
    if (!parseJson) return actual;
    if (fs.statSync(actual).size > limits.manifestBytes) { add('E_SOURCE_LIMIT', 'error', 'contract', pointer, '图形描述文件超过当前读取预算。', '拆分图形或调整预算', id); return null; }
    const content = fs.readFileSync(actual, 'utf8');
    try {
      const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
      if (!object(parsed)) { add('E_SOURCE_OBJECT', 'error', 'contract', pointer, '图形描述文件的根必须是对象。', '修复图形描述文件', id); return null; }
      walk(parsed, pointer, 0, id);
      return parsed;
    } catch (_) { add('E_SOURCE_JSON_INVALID', 'error', 'contract', pointer, '图形描述文件不是有效的 JSON。', '修复图形描述文件', id); return null; }
  }

  if (manifest === undefined && diagnostics.length === 0) add('E_MANIFEST_OBJECT', 'error', 'contract', '/', '清单根必须是对象。', '检查图形包格式');
  if (options.intent !== undefined && !['inspect', 'instantiate', 'applyEffects'].includes(options.intent)) add('E_INTENT_UNSUPPORTED', 'error', 'contract', '/', '不支持这个操作类型。', '使用已定义的接口操作');
  if (manifest !== undefined) {
    walk(manifest, '', 0);
    if (!object(manifest)) add('E_MANIFEST_OBJECT', 'error', 'contract', '/', '清单根必须是对象。', '检查图形包格式');
    else {
      if (manifest.schemaVersion !== 1) add('E_SCHEMA_VERSION', 'error', 'contract', '/schemaVersion', '不支持这个图形包格式版本。', '使用兼容版本的浏览器或图形包');
      if (!object(manifest.pack) || !validId(manifest.pack.id) || typeof manifest.pack.version !== 'string' || !SEMVER.test(manifest.pack.version) || !text(manifest.pack.name)) add('E_PACK_IDENTITY', 'error', 'contract', '/pack', '图形包需要稳定 ID、语义版本号和名称。', '补全图形包信息');
      if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) add('E_ASSETS_EMPTY', 'error', 'contract', '/assets', '图形包至少需要一项素材。', '添加素材条目');
      else if (manifest.assets.length > limits.assets) add('E_ASSET_LIMIT', 'error', 'contract', '/assets', '素材数量超过当前读取预算。', '拆分图形包或调整预算');
      else {
        const ids = new Set();
        for (let i = 0; i < manifest.assets.length; i++) {
          const asset = manifest.assets[i], pointer = '/assets/' + i;
          const id = object(asset) && typeof asset.id === 'string' ? asset.id : '@' + i;
          let pending = false;
          const skippedEffects = [];
          if (!object(asset)) { add('E_ASSET_OBJECT', 'error', 'contract', pointer, '素材条目必须是对象。', '修正素材条目', id); assets.push({ id, valid: false, canImport: false, status: 'blocked', skippedEffects }); continue; }
          if (!validId(asset.id) || !text(asset.name) || !text(asset.kind)) add('E_ASSET_IDENTITY', 'error', 'contract', pointer, '素材需要稳定 ID、名称和类型。', '补全素材信息', id);
          if (ids.has(asset.id)) add('E_ASSET_DUPLICATE', 'error', 'contract', pointer + '/id', '同一图形包内出现重复素材 ID。', '为素材设置唯一 ID');
          ids.add(asset.id);
          if (!knownKinds.has(asset.kind)) add('E_KIND_UNSUPPORTED', 'error', 'compatibility', pointer + '/kind', '当前浏览器没有这个素材类型的适配器；其他素材仍可使用。', '安装支持该类型的浏览器版本', id);
          if (asset.source === undefined) add('E_SOURCE_MISSING', 'error', 'contract', pointer + '/source', '素材缺少源文件路径。', '指定包内源文件', id);
          else {
            const extension = path.extname(String(asset.source)).toLowerCase();
            const expected = { 'ae.nativeShape': ['.json'], 'ae.project': ['.aep', '.aepx'], 'ae.ffx': ['.ffx'], 'ae.footage': ['.png', '.jpg', '.jpeg', '.svg', '.ai', '.psd', '.mov', '.mp4'] }[asset.kind];
            if (['.jsx', '.jsxbin', '.js', '.exe', '.bat', '.cmd', '.ps1'].includes(extension)) add('E_EXECUTABLE_SOURCE', 'error', 'contract', pointer + '/source', '图形包源文件不接受可执行脚本。', '使用数据文件或 AE 素材文件', id);
            if (expected && !expected.includes(extension)) add('E_SOURCE_EXTENSION', 'error', 'contract', pointer + '/source', '源文件扩展名与素材类型不匹配。', '修正类型或源文件', id);
            file(asset.source, pointer + '/source', true, id, asset.kind === 'ae.nativeShape' && extension === '.json');
            if (!root) pending = true;
          }
          if (asset.preview !== undefined) {
            if (!object(asset.preview)) add('E_PREVIEW_FORMAT', 'error', 'contract', pointer + '/preview', '预览声明必须是对象。', '修正预览声明', id);
            else if (asset.preview.still !== undefined) file(asset.preview.still, pointer + '/preview/still', false, id);
          }
          if (asset.resources !== undefined) {
            if (!Array.isArray(asset.resources)) add('E_RESOURCES_FORMAT', 'error', 'contract', pointer + '/resources', '资源清单必须是相对路径数组。', '修正资源清单', id);
            else asset.resources.forEach((resource, n) => file(resource, pointer + '/resources/' + n, true, id));
          }
          const parameters = asset.parameters === undefined ? [] : asset.parameters;
          const parameterIds = new Set();
          if (!Array.isArray(parameters)) add('E_PARAMETERS_FORMAT', 'error', 'contract', pointer + '/parameters', '参数声明必须是数组。', '修正参数声明', id);
          else parameters.forEach((parameter, n) => {
            const where = pointer + '/parameters/' + n;
            if (!object(parameter) || !validId(parameter.id) || parameterIds.has(parameter.id)) { add('E_PARAMETER_ID', 'error', 'contract', where, '参数 ID 缺失或重复。', '修正参数 ID', id); return; }
            parameterIds.add(parameter.id);
            if (!TYPES.includes(parameter.type)) add('E_PARAMETER_TYPE_UNSUPPORTED', 'error', 'compatibility', where, '当前浏览器不支持这种参数控件。', '添加对应参数控件适配器', id);
            else {
              if (parameter.min !== undefined && !Number.isFinite(parameter.min) || parameter.max !== undefined && !Number.isFinite(parameter.max) || parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) add('E_PARAMETER_RANGE', 'error', 'contract', where, '参数范围无效。', '修正最小值和最大值', id);
              if (parameter.type === 'enum' && (!Array.isArray(parameter.options) || parameter.options.length === 0 || parameter.options.some(option => typeof option !== 'string') || new Set(parameter.options).size !== parameter.options.length)) add('E_ENUM_OPTIONS', 'error', 'contract', where, '枚举选项必须是非空且无重复的字符串列表。', '修正选项', id);
              if (!valueFits(parameter.type, parameter.default, parameter)) add('E_PARAMETER_DEFAULT', 'error', 'contract', where + '/default', '参数默认值与类型或范围不一致。', '修正默认值', id);
            }
          });
          const requirements = asset.requirements === undefined ? {} : asset.requirements;
          if (!object(requirements)) add('E_REQUIREMENTS_FORMAT', 'error', 'contract', pointer + '/requirements', '依赖声明必须是对象。', '修正依赖声明', id);
          else {
            if (requirements.aeMin !== undefined) {
              if (typeof requirements.aeMin !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(requirements.aeMin)) add('E_AE_VERSION_FORMAT', 'error', 'contract', pointer + '/requirements/aeMin', '最低 AE 版本格式无效。', '使用类似 26.0 的版本号', id);
              else if (!host || !text(host.aeVersion)) { pending = true; add('W_HOST_CHECK_PENDING', 'warning', 'compatibility', pointer + '/requirements/aeMin', '尚未取得 AE 版本。', '连接 AE 后重新检查', id); }
              else if (!versionAtLeast(host.aeVersion, requirements.aeMin)) add('E_AE_VERSION_LOW', 'error', 'compatibility', pointer + '/requirements/aeMin', '当前 AE 版本低于素材声明的最低版本。', '更换素材或使用兼容版本的 AE', id);
            }
            if (requirements.capabilities !== undefined) {
              if (!Array.isArray(requirements.capabilities) || requirements.capabilities.some(capability => !text(capability))) add('E_CAPABILITIES_FORMAT', 'error', 'contract', pointer + '/requirements/capabilities', '能力依赖必须是字符串数组。', '修正能力声明', id);
              else if (!host || !Array.isArray(host.capabilities)) { if (requirements.capabilities.length) { pending = true; add('W_CAPABILITY_CHECK_PENDING', 'warning', 'compatibility', pointer + '/requirements/capabilities', '执行适配器尚未验证这些能力。', '完成宿主能力检查', id); } }
              else requirements.capabilities.forEach(capability => { if (!host.capabilities.includes(capability)) add('E_CAPABILITY_MISSING', 'error', 'compatibility', pointer + '/requirements/capabilities', '缺少执行能力：' + capability, '使用支持此能力的浏览器版本', id); });
            }
            if (requirements.fonts !== undefined) { pending = true; add('W_FONT_CHECK_PENDING', 'warning', 'compatibility', pointer + '/requirements/fonts', '字体依赖检查尚未实现。', '在 AE 中确认字体或设置替代字体', id); }
          }
          const effects = asset.effects === undefined ? [] : asset.effects;
          const effectIds = new Set();
          if (!Array.isArray(effects)) add('E_EFFECTS_FORMAT', 'error', 'contract', pointer + '/effects', '效果声明必须是数组。', '修正效果声明', id);
          else effects.forEach((effect, n) => {
            const where = pointer + '/effects/' + n;
            if (!object(effect) || !validId(effect.id) || effectIds.has(effect.id) || !text(effect.matchName) || typeof effect.required !== 'boolean' || !text(effect.target)) { add('E_EFFECT_DESCRIPTOR', 'error', 'contract', where, '效果需要唯一 ID、matchName、目标和是否必需。', '补全效果声明', id); return; }
            effectIds.add(effect.id);
            if (!Array.isArray(effect.settings)) add('E_EFFECT_SETTINGS', 'error', 'contract', where + '/settings', '效果参数必须是数组。', '修正效果参数', id);
            else effect.settings.forEach((setting, j) => {
              const location = where + '/settings/' + j;
              if (!object(setting) || !Array.isArray(setting.path) || setting.path.length === 0 || setting.path.some(selector => !object(selector) || !text(selector.matchName) || !Number.isInteger(selector.occurrence) || selector.occurrence < 1)) add('E_EFFECT_PROPERTY_PATH', 'error', 'contract', location, '效果属性需通过 matchName 和实例序号定位。', '修正属性路径', id);
              if (!object(setting) || !TYPES.includes(setting.valueType) || setting.valueType === 'enum' || !valueFits(setting.valueType, setting.value)) add('E_EFFECT_VALUE', 'error', 'contract', location, '当前通用效果接口不支持该参数值。', '使用基础值类型或为特殊效果添加适配器', id);
            });
            if (!host || !Array.isArray(host.effects)) { pending = true; add('W_EFFECT_CHECK_PENDING', 'warning', 'compatibility', where, '尚未读取已安装效果。', '连接 AE 后检查效果依赖', id); }
            else if (!host.effects.some(available => (typeof available === 'string' ? available : available.matchName) === effect.matchName)) {
              add(effect.required ? 'E_EFFECT_MISSING' : 'W_EFFECT_MISSING', effect.required ? 'error' : 'warning', 'compatibility', where, (effect.required ? '缺少必需效果：' : '可选效果不可用，将跳过：') + effect.matchName, effect.required ? '安装依赖或选择其他素材' : '继续使用基础图形', id);
              if (!effect.required) skippedEffects.push(effect.id);
            }
          });
          if (options.intent === 'instantiate') {
            if (!host || host.activeComp !== true) add('E_NO_ACTIVE_COMP', 'error', 'context', pointer, '请先打开目标合成；图形库仍可浏览。', '打开一个合成', id);
          } else if (options.intent === 'applyEffects') {
            if (!host || host.activeComp !== true) add('E_NO_ACTIVE_COMP', 'error', 'context', pointer, '请先打开目标合成。', '打开一个合成', id);
            else if (!Number.isInteger(host.selectionCount) || host.selectionCount < 1) add('E_NO_SELECTION', 'error', 'context', pointer, '请先选择要添加效果的图层。', '选择目标图层', id);
            else if (host.writableSelection !== true) add('E_SELECTION_LOCKED', 'error', 'context', pointer, '选中图层不可修改。', '解锁或选择其他图层', id);
          }
          const own = diagnostics.filter(d => d.assetId === id);
          const valid = !own.some(d => d.severity === 'error' && d.phase === 'contract');
          const blocked = own.some(d => d.severity === 'error');
          assets.push({ id, valid, canImport: !blocked && !pending, status: blocked ? 'blocked' : pending ? 'needs-host-check' : skippedEffects.length ? 'degraded' : 'ready', skippedEffects });
        }
      }
      const knownKeys = new Set(['schemaVersion', 'pack', 'assets', 'extensions']);
      for (const key of Object.keys(manifest)) if (!knownKeys.has(key)) add('W_UNKNOWN_FIELD', 'warning', 'contract', '/' + key, '未知附加字段会保留，但当前浏览器不会解释。', '将扩展信息放入带命名空间的 extensions');
    }
  }
  const canRegister = !diagnostics.some(d => d.scope === 'pack' && d.severity === 'error');
  if (!canRegister) for (const asset of assets) { asset.canImport = false; asset.status = 'blocked'; }
  return { schemaVersion: 1, canRegister, allContractValid: canRegister && assets.every(asset => asset.valid), assetCount: assets.length, assets, diagnostics };
}

function inspectDirectory(directory, options = {}) {
  try {
    const manifestPath = path.join(directory, 'pack.json');
    const root = fs.realpathSync(directory), actual = fs.realpathSync(manifestPath);
    if (!within(root, actual)) return { schemaVersion: 1, canRegister: false, allContractValid: false, assetCount: 0, assets: [], diagnostics: [diagnostic('E_PATH_ESCAPE', 'error', 'contract', '/pack.json', '清单链接指向图形包之外。', '复制实际清单到包内')] };
    if (fs.statSync(actual).size > { ...DEFAULT_LIMITS, ...options.limits }.manifestBytes) return { schemaVersion: 1, canRegister: false, allContractValid: false, assetCount: 0, assets: [], diagnostics: [diagnostic('E_MANIFEST_LIMIT', 'error', 'parse', '/', '图形包清单超过当前读取预算。', '拆分图形包或调整预算')] };
    return validatePack(fs.readFileSync(actual, 'utf8'), { ...options, root });
  }
  catch (error) { return { schemaVersion: 1, canRegister: false, allContractValid: false, assetCount: 0, assets: [], diagnostics: [diagnostic('E_PACK_READ', 'error', 'parse', '/', '无法读取图形包目录或清单。', '检查目录、文件与读取权限')] }; }
}

function planRegistration(incoming, existing) {
  if (!existing) return { action: 'add', preserveUserPresets: true };
  if (incoming.id !== existing.id) return { action: 'add', preserveUserPresets: true };
  if (incoming.version === existing.version && incoming.fingerprint === existing.fingerprint && text(incoming.fingerprint)) return { action: 'reuse', preserveUserPresets: true };
  return { action: 'needs-choice', code: incoming.version === existing.version ? 'E_PACK_VERSION_CONFLICT' : 'I_PACK_UPDATE_AVAILABLE', preserveUserPresets: true };
}

function fingerprint(directory) {
  const hash = crypto.createHash('sha256');
  const root = fs.realpathSync(directory);
  const manifestPath = fs.realpathSync(path.join(root, 'pack.json'));
  if (!within(root, manifestPath)) throw new Error('Manifest escapes pack directory');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  hash.update(JSON.stringify(manifest));
  const files = new Map();
  const declare = (name, required) => {
    const relative = relativePath(name);
    if (!relative) throw new Error('Invalid pack resource path');
    files.set(relative, required || files.get(relative) === true);
  };
  for (const asset of manifest.assets || []) { if (asset.source) declare(asset.source, true); for (const resource of asset.resources || []) declare(resource, true); if (asset.preview && asset.preview.still) declare(asset.preview.still, false); }
  for (const relative of [...files.keys()].sort()) {
    let actual;
    try { actual = fs.realpathSync(path.resolve(root, relative)); }
    catch (error) {
      if (error.code === 'ENOENT' && !files.get(relative)) { hash.update('\0missing-optional\0' + relative + '\0'); continue; }
      throw error;
    }
    if (!within(root, actual)) throw new Error('Resource escapes pack directory');
    hash.update('\0file\0' + relative + '\0'); hash.update(fs.readFileSync(actual));
  }
  return hash.digest('hex');
}

module.exports = { validatePack, inspectDirectory, relativePath, valueFits, versionAtLeast, planRegistration, fingerprint, DEFAULT_LIMITS };
