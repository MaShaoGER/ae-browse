'use strict';

// All writes belong to dataDir. Packages are captured and validated as read-only
// byte snapshots so a later host request never opens a package file itself.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const baseValidator = require('../../src/pack-validator.cjs');
const VALIDATOR_PATH = path.resolve(__dirname, '../../src/pack-validator.cjs');
const PLAN_PATH = path.resolve(__dirname, '../../src/native-shape-plan.jsxinc');
const REGISTRY_LIMIT = 4 * 1024 * 1024;
const FILE_LIMIT = 16 * 1024 * 1024;
const PACK_LIMIT = 64 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const diagnostic = (code, message, assetId, severity = 'error') => ({
  code, message, severity, phase: 'library', scope: assetId === undefined ? 'pack' : 'asset',
  assetId: assetId === undefined ? null : assetId, pointer: '/', actions: []
});
function fail(code, message, details = {}) { throw Object.assign(new Error(message), { code }, details); }
function ioError(code, message, error) { return Object.assign(new Error(message), { code, causeCode: error && error.code }); }

async function readBounded(file, maximum) {
  const handle = await fsp.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail('E_FILE_TYPE', '资源路径必须指向普通文件。');
    if (before.size > maximum) fail('E_SOURCE_LIMIT', '文件超过当前读取预算。', { size: before.size });
    // A bounded extra byte detects growth without allowing readFile to allocate
    // an arbitrarily large buffer after the size check.
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, Math.min(65536, buffer.length - offset), offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await fsp.stat(file);
    if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || current.dev !== after.dev || current.ino !== after.ino ||
        current.size !== after.size || current.mtimeMs !== after.mtimeMs) {
      fail('E_PACK_CHANGED', '读取期间图形包发生变化，请稍后重新载入。');
    }
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

async function capture(directory) {
  let root;
  try { root = await fsp.realpath(directory); }
  catch (error) { throw ioError('E_PACK_READ', '无法读取图形包目录。', error); }
  if (!(await fsp.stat(root)).isDirectory()) fail('E_PACK_READ', '请选择图形包目录。');
  const manifestAlias = path.join(root, 'pack.json');
  let manifestPath;
  try { manifestPath = await fsp.realpath(manifestAlias); }
  catch (error) { throw ioError('E_PACK_READ', '图形包目录中没有可读取的 pack.json。', error); }
  if (!within(root, manifestPath)) fail('E_PATH_ESCAPE', '清单链接指向图形包目录之外。');
  let manifestBytes;
  try { manifestBytes = await readBounded(manifestPath, baseValidator.DEFAULT_LIMITS.manifestBytes); }
  catch (error) {
    if (error.code === 'E_SOURCE_LIMIT') fail('E_MANIFEST_LIMIT', '图形包清单超过当前读取预算。');
    throw error;
  }
  if (normalize(await fsp.realpath(manifestAlias)) !== normalize(manifestPath)) fail('E_PACK_CHANGED', '读取期间清单路径发生变化。');
  let manifest;
  const manifestText = manifestBytes.toString('utf8');
  try { manifest = JSON.parse(manifestText.replace(/^\uFEFF/, '')); }
  catch (_) { fail('E_JSON_INVALID', '图形包清单不是有效的 JSON。'); }
  const records = new Map();
  const aliases = new Map([[normalize(root), { actual: root, directory: true }],
    [normalize(manifestAlias), { actual: manifestPath, bytes: manifestBytes }],
    [normalize(manifestPath), { actual: manifestPath, bytes: manifestBytes }]]);
  const declarations = new Map();
  const invalid = [];
  const declare = (value, required, owner) => {
    const relative = baseValidator.relativePath(value);
    if (!relative) { invalid.push(JSON.stringify(value)); return; }
    const existing = declarations.get(relative);
    if (existing) { existing.required = existing.required || required; existing.owners.push(owner); }
    else declarations.set(relative, { required, owners: [owner] });
    if (declarations.size > 10000) fail('E_PACK_FILE_LIMIT', '图形包声明文件过多，请拆分图形包。');
  };
  if (object(manifest) && Array.isArray(manifest.assets) && manifest.assets.length <= baseValidator.DEFAULT_LIMITS.assets) {
    for (const asset of manifest.assets) {
      if (!object(asset)) continue;
      if (asset.source !== undefined) declare(asset.source, true, asset.id);
      if (Array.isArray(asset.resources)) for (const resource of asset.resources) declare(resource, true, asset.id);
      if (object(asset.preview) && asset.preview.still !== undefined) declare(asset.preview.still, false, asset.id);
    }
  }
  let total = manifestBytes.length;
  const extraDiagnostics = [];
  for (const [relative, declared] of declarations) {
    const alias = path.resolve(root, relative);
    const record = { relative, required: declared.required, owners: declared.owners };
    try {
      record.actual = await fsp.realpath(alias);
      if (!within(root, record.actual)) record.state = 'escape';
      else {
        const stat = await fsp.stat(record.actual);
        record.size = stat.size;
        record.directory = !stat.isFile();
        if (record.directory) record.state = 'type';
        else if (stat.size > FILE_LIMIT) record.state = 'oversized';
        else {
          if (total + stat.size > PACK_LIMIT) fail('E_PACK_LIMIT', '图形包文件总量超过当前快照读取预算，请拆分图形包。');
          record.bytes = await readBounded(record.actual, FILE_LIMIT);
          if (normalize(await fsp.realpath(alias)) !== normalize(record.actual)) fail('E_PACK_CHANGED', '读取期间资源路径发生变化。');
          total += record.bytes.length;
          record.state = 'file';
        }
      }
    } catch (error) {
      if (error.code === 'E_PACK_CHANGED' || error.code === 'E_PACK_LIMIT') throw error;
      record.state = 'missing';
      record.errorCode = error.code || 'E_FILE_READ';
    }
    if (record.state === 'oversized') {
      for (const id of new Set(record.owners)) extraDiagnostics.push(diagnostic('E_SOURCE_LIMIT', '文件超过当前读取预算：' + relative, id, record.required ? 'error' : 'warning'));
    }
    records.set(relative, record);
    aliases.set(normalize(alias), record);
    if (record.actual && record.state !== 'escape') aliases.set(normalize(record.actual), record);
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(manifest));
  for (const relative of [...records.keys()].sort()) {
    const record = records.get(relative);
    if (record.state === 'file') hash.update('\0file\0' + relative + '\0').update(record.bytes);
    else if (record.state === 'missing' && !record.required) hash.update('\0missing-optional\0' + relative + '\0');
    else hash.update('\0' + record.state + '\0' + relative + '\0' + (record.size || '') + '\0');
  }
  for (const declaration of invalid.sort()) hash.update('\0invalid\0' + declaration + '\0');
  return { root, manifest, manifestText, records, aliases, extraDiagnostics, fingerprint: hash.digest('hex') };
}

// The validator's existing filesystem API is adapted to the captured bytes.
// It performs no second read against mutable source files while validating.
function snapshotFilesystem(snapshot) {
  const lookup = input => {
    const record = snapshot.aliases.get(normalize(input));
    if (!record || record.state === 'missing') throw Object.assign(new Error('Snapshot file missing'), { code: 'ENOENT' });
    return record;
  };
  return {
    realpathSync(input) { const record = lookup(input); return record.actual || path.resolve(input); },
    statSync(input) { const record = lookup(input); return { size: record.size === undefined ? record.bytes ? record.bytes.length : 0 : record.size, isFile: () => !record.directory }; },
    readFileSync(input, encoding) {
      const record = lookup(input);
      if (!record.bytes) throw Object.assign(new Error('Snapshot bytes unavailable'), { code: 'E_SOURCE_LIMIT' });
      return encoding ? record.bytes.toString(encoding) : Buffer.from(record.bytes);
    }
  };
}

function createLibraryService(options = {}) {
  if (typeof options.dataDir !== 'string' || !options.dataDir.trim()) fail('E_DATA_DIRECTORY', '图形库服务需要独立的用户数据目录。');
  const dataDir = path.resolve(options.dataDir);
  const registryFile = path.join(dataDir, 'libraries.json');
  const backupFile = path.join(dataDir, 'libraries.backup.json');
  const suppliedValidator = options.validator || null;
  let validatorScript, planScript, canonicalDataDir, entries = [], cache = new Map();
  let queue = Promise.resolve();
  const startupDiagnostics = [];

  function validate(snapshot, host, intent = 'inspect') {
    let validator = suppliedValidator;
    let result;
    if (!validator) {
      if (!validatorScript) validatorScript = new vm.Script(fs.readFileSync(VALIDATOR_PATH, 'utf8'), { filename: VALIDATOR_PATH });
      const module = { exports: {} };
      const sandbox = vm.createContext({ module, exports: module.exports, Buffer,
        manifestText: snapshot.manifestText, validateOptions: { root: snapshot.root, kinds: ['ae.nativeShape'], host, intent },
        require: name => name === 'node:fs' ? snapshotFilesystem(snapshot) : require(name) });
      validatorScript.runInContext(sandbox, { timeout: 1500 });
      result = vm.runInContext('module.exports.validatePack(manifestText, validateOptions)', sandbox, { timeout: 2000 });
    }
    if (validator) {
      if (typeof validator.validatePack !== 'function') fail('E_VALIDATOR_API', '校验器缺少 validatePack 接口。');
      result = validator.validatePack(snapshot.manifestText, { root: snapshot.root, kinds: ['ae.nativeShape'], host, intent });
    }
    result.diagnostics = [...result.diagnostics, ...snapshot.extraDiagnostics];
    for (const asset of result.assets) {
      if (result.diagnostics.some(item => item.assetId === asset.id && item.severity === 'error')) {
        asset.canImport = false; asset.status = 'blocked';
      }
    }
    return result;
  }

  function compile(asset, payload, parameters, host) {
    if (!planScript) planScript = new vm.Script(fs.readFileSync(PLAN_PATH, 'utf8'), { filename: PLAN_PATH });
    const comp = object(host.comp) ? host.comp : {};
    const context = { width: comp.width, height: comp.height, duration: comp.duration,
      insertTime: comp.time === undefined ? 0 : comp.time,
      installedEffects: (host.effects || []).map(effect => typeof effect === 'string' ? effect : effect.matchName) };
    const sandbox = vm.createContext({ inputJSON: JSON.stringify({ asset, payload, parameters, context }) });
    planScript.runInContext(sandbox, { timeout: 1500 });
    return JSON.parse(vm.runInContext('var input = JSON.parse(inputJSON); JSON.stringify(AEBrowsePlan.plan(input.asset, input.payload, input.parameters, input.context))', sandbox, { timeout: 1500 }));
  }

  function buildCache(entry, snapshot, validation, unavailableDiagnostics = []) {
    const diagnostics = [...validation.diagnostics, ...unavailableDiagnostics];
    const available = validation.canRegister && unavailableDiagnostics.length === 0;
    const assets = [];
    const results = new Map(validation.assets.map(asset => [asset.id, asset]));
    for (const source of Array.isArray(snapshot.manifest.assets) ? snapshot.manifest.assets : []) {
      if (!object(source)) continue;
      const result = results.get(source.id) || { valid: false, canImport: false, status: 'blocked' };
      const ownDiagnostics = diagnostics.filter(item => item.scope === 'pack' || item.assetId === source.id);
      const unsupported = source.kind !== 'ae.nativeShape';
      const metadata = { ...clone(source), packId: entry.id, fingerprint: entry.fingerprint,
        valid: result.valid && !unsupported, canImport: available && result.canImport && !unsupported,
        status: !available || unsupported ? 'blocked' : result.status, diagnostics: clone(ownDiagnostics) };
      const searchText = [source.id, source.name, source.kind, entry.name, ...(Array.isArray(source.tags) ? source.tags : []),
        object(source.help) ? source.help.summary : ''].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
      assets.push({ metadata, searchText });
    }
    return { snapshot, assets, library: { ...clone(entry), packId: entry.id, status: available ? 'available' : 'unavailable',
      available, assetCount: assets.length, diagnostics: clone(diagnostics) } };
  }

  function unavailable(entry, error) {
    return { snapshot: null, assets: [], library: { ...clone(entry), packId: entry.id, status: 'unavailable', available: false,
      assetCount: 0, diagnostics: clone(error.diagnostics || [diagnostic(error.code || 'E_PACK_READ', error.message || '无法读取图形包。')]) } };
  }

  async function scanEntry(entry) {
    try {
      const snapshot = await capture(entry.directory);
      const validation = validate(snapshot);
      const changed = !object(snapshot.manifest.pack) || snapshot.manifest.pack.id !== entry.id ||
        snapshot.manifest.pack.version !== entry.version || snapshot.fingerprint !== entry.fingerprint;
      const additional = changed ? [diagnostic('E_PACK_CHANGED', '来源图形包与登记版本不同，请明确选择移除后重新登记。')] : [];
      return buildCache(entry, snapshot, validation, additional);
    } catch (error) { return unavailable(entry, error); }
  }

  async function atomicWrite(file, value) {
    const temporary = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
    let handle;
    try {
      handle = await fsp.open(temporary, 'wx', 0o600);
      await handle.writeFile(value, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await fsp.rename(temporary, file);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fsp.unlink(temporary).catch(() => {});
    }
  }

  function decodeRegistry(bytes) {
    const registry = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!object(registry) || registry.schemaVersion !== 1 || !Array.isArray(registry.libraries) || registry.libraries.length > 5000) fail('E_REGISTRY_CORRUPT', '图形库登记文件格式无效。');
    const ids = new Set();
    for (const entry of registry.libraries) {
      if (!object(entry) || typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.id) || ids.has(entry.id) ||
          typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version) ||
          typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || typeof entry.directory !== 'string' || !path.isAbsolute(entry.directory)) {
        fail('E_REGISTRY_CORRUPT', '图形库登记文件包含无效或重复条目。');
      }
      ids.add(entry.id);
    }
    return registry.libraries.map(entry => ({ id: entry.id, name: entry.name, version: entry.version, fingerprint: entry.fingerprint, directory: entry.directory }));
  }
  const encodeRegistry = value => JSON.stringify({ schemaVersion: 1, libraries: value }, null, 2) + '\n';

  async function persist(next) {
    const serialized = encodeRegistry(next);
    if (Buffer.byteLength(serialized) > REGISTRY_LIMIT) fail('E_REGISTRY_LIMIT', '登记文件超过当前保存预算。');
    try {
      await atomicWrite(backupFile, encodeRegistry(entries));
      await atomicWrite(registryFile, serialized);
    } catch (error) { throw ioError('E_REGISTRY_WRITE', '无法保存图形库登记，请检查用户数据目录。', error); }
    entries = next;
    // Keep the most recent successful state recoverable. A backup failure after
    // the commit is reported as a warning; it cannot roll back the main file.
    try { await atomicWrite(backupFile, serialized); }
    catch (_) { startupDiagnostics.push(diagnostic('W_REGISTRY_BACKUP', '登记已保存，但恢复副本暂时无法更新。', undefined, 'warning')); }
  }

  async function initialize() {
    try { await fsp.mkdir(dataDir, { recursive: true }); canonicalDataDir = await fsp.realpath(dataDir); }
    catch (error) { throw ioError('E_DATA_DIRECTORY', '无法创建或读取用户数据目录。', error); }
    let primaryError;
    try { entries = decodeRegistry(await readBounded(registryFile, REGISTRY_LIMIT)); }
    catch (error) {
      primaryError = error;
      try {
        entries = decodeRegistry(await readBounded(backupFile, REGISTRY_LIMIT));
        startupDiagnostics.push(diagnostic('W_REGISTRY_RECOVERED', '登记文件无法读取，已从恢复副本还原。', undefined, 'warning'));
        await atomicWrite(registryFile, encodeRegistry(entries));
      } catch (backupError) {
        if (primaryError.code === 'ENOENT' && backupError.code === 'ENOENT') entries = [];
        else fail('E_REGISTRY_CORRUPT', '图形库登记与恢复副本均无法读取，原文件已保留。');
      }
    }
    for (const entry of entries) cache.set(entry.id, await scanEntry(entry));
  }
  const ready = initialize();
  // Attach a handler immediately so a failed startup is delivered by the first
  // API call rather than creating an unhandled rejection in the CEP process.
  ready.catch(() => {});
  const enqueue = body => {
    const operation = queue.then(() => ready).then(body).catch(error => {
      if (typeof error.code === 'string' && /^[EIW]_/.test(error.code)) throw error;
      throw ioError('E_LIBRARY_IO', '图形库操作无法完成，请检查文件、权限或当前读取预算。', error);
    });
    queue = operation.catch(() => {});
    return operation;
  };
  function findEntry(packId) {
    const entry = entries.find(item => item.id === packId);
    if (!entry) fail('E_LIBRARY_NOT_FOUND', '这个图形库尚未登记。');
    return entry;
  }
  function libraryView(item) {
    const library = clone(item.library);
    library.diagnostics = [...library.diagnostics, ...clone(startupDiagnostics)];
    return library;
  }
  function registrationConflict(incoming, existing, diagnostics) {
    const decision = baseValidator.planRegistration(incoming, existing);
    fail(decision.code || 'E_PACK_VERSION_CONFLICT', decision.code === 'I_PACK_UPDATE_AVAILABLE' ?
      '发现同一图形库的不同版本；请明确选择移除旧登记后再添加。' : '同一图形库版本的内容不同；请明确选择移除旧登记后再添加。',
    { existing: clone(existing), incoming: clone(incoming), diagnostics: clone(diagnostics || []) });
  }

  return {
    listLibraries() { return enqueue(() => entries.map(entry => libraryView(cache.get(entry.id)))); },
    registerLibrary(directory) {
      return enqueue(async () => {
        if (typeof directory !== 'string' || !directory.trim()) fail('E_PACK_READ', '请选择图形包目录。');
        const snapshot = await capture(directory);
        if (normalize(snapshot.root) === normalize(canonicalDataDir) || within(snapshot.root, canonicalDataDir)) fail('E_DATA_DIRECTORY_OVERLAP', '用户数据目录不能位于来源图形包内。');
        const validation = validate(snapshot);
        if (!validation.canRegister) fail('E_PACK_INVALID', '图形包清单无法登记，请检查诊断。', { diagnostics: clone(validation.diagnostics) });
        const incoming = { id: snapshot.manifest.pack.id, name: snapshot.manifest.pack.name, version: snapshot.manifest.pack.version,
          fingerprint: snapshot.fingerprint, directory: snapshot.root };
        const existing = entries.find(entry => entry.id === incoming.id);
        if (existing && baseValidator.planRegistration(incoming, existing).action !== 'reuse') registrationConflict(incoming, existing, validation.diagnostics);
        const next = existing ? entries.map(entry => entry.id === incoming.id ? incoming : entry) : [...entries, incoming];
        if (!existing || normalize(existing.directory) !== normalize(incoming.directory)) await persist(next);
        else entries = next;
        const item = buildCache(incoming, snapshot, validation);
        cache.set(incoming.id, item);
        return { action: existing ? 'reused' : 'added', reused: Boolean(existing), library: libraryView(item), diagnostics: clone(validation.diagnostics) };
      });
    },
    removeLibrary(packId) {
      return enqueue(async () => {
        const exists = entries.some(entry => entry.id === packId);
        if (exists) { await persist(entries.filter(entry => entry.id !== packId)); cache.delete(packId); }
        return { removed: exists, packId };
      });
    },
    refreshLibrary(packId) {
      return enqueue(async () => {
        const entry = findEntry(packId);
        const item = await scanEntry(entry);
        cache.set(packId, item);
        if (item.snapshot && item.snapshot.manifest.pack && item.snapshot.fingerprint !== entry.fingerprint) {
          registrationConflict({ ...entry, id: item.snapshot.manifest.pack.id, version: item.snapshot.manifest.pack.version, fingerprint: item.snapshot.fingerprint }, entry, item.library.diagnostics);
        }
        return libraryView(item);
      });
    },
    listAssets(packId, query = '') {
      return enqueue(() => {
        const selected = packId === undefined || packId === null ? entries.map(entry => cache.get(entry.id)) : [cache.get(findEntry(packId).id)];
        const search = (typeof query === 'string' ? query : object(query) ? query.search || query.text || query.query || '' : '').trim().toLocaleLowerCase();
        const tokens = search.split(/\s+/).filter(Boolean);
        return selected.flatMap(item => item.assets.filter(asset => tokens.every(token => asset.searchText.includes(token)) &&
          (!object(query) || !query.kind || asset.metadata.kind === query.kind) &&
          (!object(query) || !query.tag || Array.isArray(asset.metadata.tags) && asset.metadata.tags.includes(query.tag))).map(asset => clone(asset.metadata)));
      });
    },
    getAsset(packId, assetId) {
      return enqueue(() => {
        findEntry(packId);
        const asset = cache.get(packId).assets.find(item => item.metadata.id === assetId);
        if (!asset) fail('E_ASSET_NOT_FOUND', '这个图形库中没有所选素材。');
        return clone(asset.metadata);
      });
    },
    prepareAsset(packId, assetId, expectedFingerprint, host, parameters = {}) {
      return enqueue(async () => {
        const entry = findEntry(packId);
        if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) fail('E_FINGERPRINT_REQUIRED', '请从已载入的素材记录提供内容指纹。');
        if (expectedFingerprint !== entry.fingerprint) fail('E_PACK_CHANGED', '素材选择对应的图形库版本已变化，请重新选择。');
        const snapshot = await capture(entry.directory);
        if (!object(snapshot.manifest.pack) || snapshot.manifest.pack.id !== entry.id || snapshot.manifest.pack.version !== entry.version || snapshot.fingerprint !== expectedFingerprint) {
          fail('E_PACK_CHANGED', '来源图形包内容已变化，已停止发送到 AE；请重新载入并选择版本。', { expectedFingerprint, actualFingerprint: snapshot.fingerprint });
        }
        const validation = validate(snapshot, host, 'instantiate');
        const asset = snapshot.manifest.assets.find(item => item && item.id === assetId);
        const checked = validation.assets.find(item => item.id === assetId);
        if (!asset || !checked) fail('E_ASSET_NOT_FOUND', '这个图形库中没有所选素材。');
        const diagnostics = validation.diagnostics.filter(item => item.scope === 'pack' || item.assetId === assetId);
        if (!validation.canRegister || !checked.canImport) {
          const blocking = diagnostics.find(item => item.severity === 'error');
          fail(blocking ? blocking.code : 'E_HOST_CHECK_PENDING', blocking ? blocking.message : '宿主依赖检查尚未完成，素材暂时不能插入。', { diagnostics: clone(diagnostics) });
        }
        if (asset.kind !== 'ae.nativeShape') fail('E_KIND_UNSUPPORTED', '当前版本只支持原生形状图形。');
        const record = snapshot.records.get(baseValidator.relativePath(asset.source));
        if (!record || record.state !== 'file') fail('E_SOURCE_MISSING', '素材源文件无法读取。');
        const payload = JSON.parse(record.bytes.toString('utf8').replace(/^\uFEFF/, ''));
        const plan = compile(asset, payload, parameters, host || {});
        const manifest = { schemaVersion: snapshot.manifest.schemaVersion, pack: clone(snapshot.manifest.pack), assets: [clone(asset)] };
        return { loaded: { manifest, asset: clone(asset), payload }, fingerprint: snapshot.fingerprint,
          diagnostics: clone(diagnostics), plan };
      });
    }
  };
}

module.exports = { createLibraryService };
