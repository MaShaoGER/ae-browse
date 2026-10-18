'use strict';
// Ordinary folders are independent of versioned packs. Never write into a source folder.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { createLibraryService } = require('./library-service.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const mime = { '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg' };
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const inside = (root, file) => { const rel = path.relative(root, file); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const diagnostic = (code, message) => ({ code, message, severity:'error', phase:'local' });
function checkSVG(bytes) {
  // Drawing tools commonly emit this fixed SVG 1.1 declaration. Remove it only
  // in the prolog, without resolving a DTD. Other DTDs/internal subsets stay
  // blocked below. Never modify the source file; all consumers use this copy.
  const source = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(
    /^(\s*(?:<\?xml\s[^?]*\?>\s*)?)<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])-\/\/W3C\/\/DTD SVG 1\.1\/\/EN\2\s+(["'])https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd\3\s*>/,
    '$1'
  );
  if (!/<svg(?:\s|>)/i.test(source) || !/<\/svg\s*>\s*$/i.test(source) && !/<svg\b[^>]*\/\s*>\s*$/i.test(source)) fail('E_SVG_FORMAT', 'SVG 文件结构无效。');
  // Preview is an isolated image, never inserted as HTML. Reject active/external content
  // before passing the same bytes to AE's importer (including escaped URL schemes).
  const referencesRemoved = source.replace(/\b(?:xlink:)?href\s*=\s*(["'])#[\w.-]+\1/gi, '').replace(/url\(\s*(["']?)#[\w.-]+\1\s*\)/gi, '');
  if (/<!DOCTYPE|<!ENTITY|<\s*(?:[\w.-]+:)?(?:script|foreignObject|image)\b|\bon[\w-]+\s*=|\b(?:[\w.-]+:)?href\s*=|@import|url\s*\(|&#|\\[0-9a-f]{1,6}/i.test(referencesRemoved)) {
    fail('E_SVG_CONTENT', 'SVG 含脚本、外部引用或嵌入内容，请先转换为独立矢量路径。');
  }
  return Buffer.from(source, 'utf8');
}
async function readFile(file, maximum = 8 * 1024 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) fail('E_LOCAL_LIMIT', '素材不是普通文件或超过 8 MB。');
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) { const r = await handle.read(bytes, offset, bytes.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead; }
    const after = await handle.stat(), current = await fs.stat(file);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== after.ino || current.mtimeMs !== after.mtimeMs) fail('E_LOCAL_CHANGED', '读取期间素材发生变化，请刷新后重试。');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
function createContentService(options) {
  const packs = createLibraryService(options), dataDir = path.resolve(options.dataDir);
  const registry = path.join(dataDir, 'folders.json'), backup = path.join(dataDir, 'folders.backup.json');
  let entries = [], cache = new Map(), queue = Promise.resolve();
  const isFolder = id => typeof id === 'string' && id.startsWith('folder-');
  async function atomic(file, text) {
    const temporary = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
    try { await fs.writeFile(temporary, text, { flag:'wx' }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  }
  async function persist(next) {
    const value = JSON.stringify({ schemaVersion:1, folders:next }, null, 2);
    await atomic(backup, JSON.stringify({schemaVersion:1, folders:entries}));
    await atomic(registry, value); entries = next;
    await atomic(backup, value).catch(() => {});
  }
  async function decode(file) {
    const value = JSON.parse((await readFile(file)).toString('utf8'));
    if (value.schemaVersion !== 1 || !Array.isArray(value.folders) || value.folders.length > 1000) fail('E_FOLDER_REGISTRY', '本地文件夹登记损坏，原文件已保留。');
    const seen = new Set();
    for (const entry of value.folders) {
      if (!entry || typeof entry.id !== 'string' || !/^folder-[a-f0-9]{32}$/.test(entry.id) || seen.has(entry.id) || typeof entry.directory !== 'string' || !path.isAbsolute(entry.directory) || typeof entry.name !== 'string') fail('E_FOLDER_REGISTRY', '本地文件夹登记格式无效。');
      seen.add(entry.id);
    }
    return value.folders;
  }
  async function scan(entry) {
    const assets = [], diagnostics = []; let count = 0, total = 0;
    try {
      const root = await fs.realpath(entry.directory);
      if (!(await fs.stat(root)).isDirectory()) fail('E_LOCAL_FOLDER', '本地素材文件夹不可用。');
      async function walk(directory, depth) {
        if (depth > 16) fail('E_LOCAL_LIMIT', '子文件夹超过 16 层，请选择更具体的素材目录。');
        const names = (await fs.readdir(directory, { withFileTypes:true })).sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
        for (const name of names) {
          if (++count > 10000 || assets.length >= 1000) fail('E_LOCAL_LIMIT', '文件夹较大，请按子目录分别添加（最多 1000 素材）。');
          const file = path.join(directory, name.name);
          if (name.isSymbolicLink()) continue;
          const actual = await fs.realpath(file);
          if (!inside(root, actual)) continue;
          if (name.isDirectory()) { await walk(actual, depth + 1); continue; }
          const extension = path.extname(name.name).toLowerCase(); if (!mime[extension]) continue;
          const relativePath = path.relative(root, file).split(path.sep).join('/');
          const asset = { id:'file-' + hash(relativePath).slice(0,32), packId:entry.id, kind:extension === '.svg' ? 'local.svg' : 'local.image', name:path.basename(name.name, path.extname(name.name)), relativePath, extension, parameters:[], tags:[relativePath,extension.slice(1)], valid:true, status:'available', diagnostics:[], help:{ summary: extension === '.svg' ? '添加到合成中心。当前 AE 脚本不支持矢量导入时，使用高清透明图片；原 SVG 保留。' : '图片添加到当前合成中心。原始文件保持不变。' } };
          try {
            const bytes = await readFile(actual); total += bytes.length;
            if (total > 64 * 1024 * 1024) fail('E_LOCAL_LIMIT', '当前目录超过 64 MB 读取预算，请按子目录分别添加。');
            const previewBytes = extension === '.svg' ? checkSVG(bytes) : bytes;
            asset.fingerprint = hash(bytes); asset.byteLength = bytes.length;
            if (previewBytes.length <= 2 * 1024 * 1024) asset.previewUrl = 'data:' + mime[extension] + ';base64,' + previewBytes.toString('base64');
          } catch (error) { asset.valid = false; asset.status = 'blocked'; asset.diagnostics = [diagnostic(error.code || 'E_LOCAL_READ', error.message)]; }
          assets.push(asset);
          if (total > 64 * 1024 * 1024) fail('E_LOCAL_LIMIT', '当前目录读取预算已用尽，请按子目录分别添加。');
        }
      }
      await walk(root, 0);
      return { assets, library:{ ...entry, sourceType:'folder', status:'available', assetCount:assets.length, diagnostics } };
    } catch (error) {
      diagnostics.push(diagnostic(error.code || 'E_LOCAL_FOLDER', error.message || '无法读取文件夹。'));
      return { assets, library:{ ...entry, sourceType:'folder', status: assets.length ? 'partial' : 'unavailable', assetCount:assets.length, diagnostics } };
    }
  }
  const ready = (async () => {
    await fs.mkdir(dataDir, {recursive:true});
    try { entries = await decode(registry); }
    catch (error) {
      try { entries = await decode(backup); await atomic(registry, JSON.stringify({schemaVersion:1,folders:entries})); }
      catch (other) { if (error.code !== 'ENOENT' || other.code !== 'ENOENT') fail('E_FOLDER_REGISTRY', '本地文件夹登记无法恢复，原文件已保留。'); }
    }
    for (const entry of entries) cache.set(entry.id, await scan(entry));
  })();
  ready.catch(() => {});
  function enqueue(fn) { const result = queue.then(() => ready).then(fn); queue = result.catch(() => {}); return result; }
  function item(id) { const value = cache.get(id); if (!value) fail('E_LIBRARY_NOT_FOUND', '这个文件夹尚未登记。'); return value; }
  const api = {
    registerLibrary: directory => packs.registerLibrary(directory),
    registerFolder(directory) { return enqueue(async () => {
      if (typeof directory !== 'string' || !directory.trim()) fail('E_LOCAL_FOLDER', '请选择素材文件夹。');
      const root = await fs.realpath(directory), canonicalData = await fs.realpath(dataDir);
      if (root === canonicalData || inside(root, canonicalData) || inside(canonicalData, root)) fail('E_DATA_DIRECTORY_OVERLAP', '请选择独立于 AE Browse 设置目录的素材文件夹。');
      if (!(await fs.stat(root)).isDirectory()) fail('E_LOCAL_FOLDER', '请选择文件夹。');
      const normalized = process.platform === 'win32' ? root.toLowerCase() : root;
      const id = 'folder-' + hash(normalized).slice(0,32);
      const entry = { id, name:path.basename(root) || root, directory:root };
      const scanned = await scan(entry);
      if (scanned.library.status === 'unavailable') fail('E_LOCAL_FOLDER', scanned.library.diagnostics[0].message);
      if (!entries.some(e => e.id === id)) await persist([...entries,entry]);
      cache.set(id, scanned); return { library:copy(scanned.library) };
    }); },
    async listLibraries() { const folders = await enqueue(() => entries.map(e => copy(item(e.id).library))); return (await packs.listLibraries()).concat(folders); },
    removeLibrary(id) { return isFolder(id) ? enqueue(async () => { const exists = entries.some(e => e.id === id); if(exists) await persist(entries.filter(e => e.id !== id)); cache.delete(id); return { removed:exists }; }) : packs.removeLibrary(id); },
    refreshLibrary(id) { return isFolder(id) ? enqueue(async () => { const entry = entries.find(e => e.id === id); if(!entry) item(id); const scanned = await scan(entry); cache.set(id,scanned); return copy(scanned.library); }) : packs.refreshLibrary(id); },
    listAssets(id, query='') { return isFolder(id) ? enqueue(() => {
      const tokens = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      return item(id).assets.filter(a => tokens.every(t => (a.name + ' ' + a.relativePath).toLocaleLowerCase().includes(t))).map(copy);
    }) : packs.listAssets(id,query); },
    getAsset(id, assetId) { return isFolder(id) ? enqueue(() => { const asset = item(id).assets.find(a => a.id === assetId); if(!asset) fail('E_ASSET_NOT_FOUND', '素材已不存在，请刷新。'); return copy(asset); }) : packs.getAsset(id,assetId); },
    prepareAsset(id, assetId, fingerprint, host, parameters) { return isFolder(id) ? enqueue(async () => {
      const folder = item(id), asset = folder.assets.find(a => a.id === assetId);
      if (!asset || !asset.valid || asset.fingerprint !== fingerprint) fail('E_LOCAL_CHANGED', '素材已变化或不可用，请刷新后重新选择。');
      const root = await fs.realpath(folder.library.directory), source = await fs.realpath(path.join(root,asset.relativePath));
      if (!inside(root,source)) fail('E_PATH_ESCAPE', '素材链接指向登记目录之外。');
      const bytes = await readFile(source);
      if (hash(bytes) !== fingerprint) fail('E_LOCAL_CHANGED', '素材文件已变化，请刷新后重新选择。');
      const snapshot = asset.extension === '.svg' ? checkSVG(bytes) : bytes;
      const snapshotFingerprint = hash(snapshot);
      const staging = path.join(dataDir,'local-cache'); await fs.mkdir(staging,{recursive:true});
      const file = path.join(staging,snapshotFingerprint + asset.extension);
      try { await fs.writeFile(file,snapshot,{flag:'wx'}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
      if (hash(await readFile(file)) !== snapshotFingerprint) fail('E_LOCAL_CACHE', '导入缓存不一致，已停止添加。');
      return { local:{ path:file, extension:asset.extension, name:asset.name, fingerprint:snapshotFingerprint }, svgURL:asset.extension === '.svg' ? 'data:image/svg+xml;base64,' + snapshot.toString('base64') : null, diagnostics:[] };
    }) : packs.prepareAsset(id,assetId,fingerprint,host,parameters); }
  };
  api.attachSVGRaster = (local, raster) => enqueue(async () => {
    const staging = path.join(dataDir,'local-cache');
    if (!local || local.extension !== '.svg' || !/^[a-f0-9]{64}$/.test(local.fingerprint) || path.resolve(local.path) !== path.join(staging,local.fingerprint + '.svg')) fail('E_LOCAL_CACHE', 'SVG 快照身份无效。');
    if (hash(await readFile(local.path)) !== local.fingerprint) fail('E_LOCAL_CACHE', 'SVG 快照已变化。');
    if (!raster || typeof raster.dataURL !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raster.dataURL) || raster.dataURL.length > 24 * 1024 * 1024) fail('E_LOCAL_RASTER', 'SVG 兼容图片格式无效。');
    for (const key of ['width','height','displayWidth','displayHeight']) if (!Number.isFinite(raster[key]) || raster[key] < 1 || raster[key] > (key.startsWith('display') ? 30000 : 4096)) fail('E_LOCAL_RASTER', 'SVG 兼容图片尺寸无效。');
    const bytes = Buffer.from(raster.dataURL.slice(22),'base64');
    if (bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== raster.width || bytes.readUInt32BE(20) !== raster.height) fail('E_LOCAL_RASTER', 'PNG 尺寸与渲染结果不一致。');
    const fingerprint = hash(bytes), file = path.join(staging,fingerprint+'.png');
    try { await fs.writeFile(file,bytes,{flag:'wx'}); } catch(error) {if(error.code !== 'EEXIST') throw error;}
    if (hash(await readFile(file,18*1024*1024)) !== fingerprint) fail('E_LOCAL_CACHE', '兼容图片缓存不一致。');
    return {...copy(local), fallback:{path:file,extension:'.png',fingerprint,displayWidth:raster.displayWidth,displayHeight:raster.displayHeight}};
  });
  return api;
}
module.exports = { createContentService };
