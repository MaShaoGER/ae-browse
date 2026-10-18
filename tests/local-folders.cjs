'use strict';
// Node only. Real isolated files; no AE, installed extension or user registry access.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const entry = path.resolve(__dirname, '../cep/node/content-service.cjs');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><path d="M0 0H160V100H0Z" fill="#5386ed"/></svg>';
(async () => {
  assert.ok(require('node:fs').existsSync(entry), 'Local folder browsing service is not implemented');
  const { createContentService } = require(entry);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aebrowse-folder-'));
  let checks = 0;
  try {
    const folder = path.join(temp, '素材'), dataDir = path.join(temp, 'settings');
    await fs.mkdir(path.join(folder, '图标'), { recursive: true });
    await fs.writeFile(path.join(folder, '图标', '蓝色.svg'), svg);
    await fs.writeFile(path.join(folder, 'ignored.txt'), 'ignore me');
    await fs.writeFile(path.join(folder, 'bad.svg'), '<svg><script>alert(1)</script></svg>');
    let service = createContentService({ dataDir });
    const registration = await service.registerFolder(folder), id = registration.library.id;
    let assets = await service.listAssets(id);
    assert.equal(assets.length, 2); assert.equal(assets.find(a => a.name === 'bad').status, 'blocked');
    const good = assets.find(a => a.name === '蓝色'); assert.equal(good.kind, 'local.svg'); assert.equal(good.relativePath, '图标/蓝色.svg');
    assert.equal((await service.listAssets(id, '图标 蓝色')).length, 1); checks++;
    service = createContentService({ dataDir });
    assert.equal((await service.listLibraries()).length, 1);
    assert.equal((await service.registerFolder(folder)).library.id, id); checks++;
    const prepared = await service.prepareAsset(id, good.id, good.fingerprint, {}, {});
    assert.equal(prepared.local.extension, '.svg');
    assert.equal(await fs.readFile(prepared.local.path, 'utf8'), svg); checks++;
    assert.equal(typeof service.attachSVGRaster, 'function', 'SVG compatibility snapshot is not implemented');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
    const fallback = await service.attachSVGRaster(prepared.local, {dataURL:png,width:1,height:1,displayWidth:160,displayHeight:100});
    assert.equal(fallback.fallback.extension,'.png'); assert.equal(fallback.fallback.displayWidth,160);
    await assert.rejects(service.attachSVGRaster(prepared.local, {dataURL:'data:image/png;base64,AAAA',width:1,height:1,displayWidth:160,displayHeight:100})); checks++;
    await fs.writeFile(path.join(folder, '图标', '蓝色.svg'), svg.replace('#5386ed', '#ee5500'));
    await assert.rejects(service.prepareAsset(id, good.id, good.fingerprint, {}, {}), e => e.code === 'E_LOCAL_CHANGED');
    await fs.writeFile(path.join(folder, 'new.svg'), svg); await service.refreshLibrary(id);
    assets = await service.listAssets(id); assert.equal(assets.length, 3);
    assert.notEqual(assets.find(a => a.id === good.id).fingerprint, good.fingerprint); checks++;
    await service.removeLibrary(id); assert.equal((await service.listLibraries()).length, 0);
    assert.equal(await fs.readFile(path.join(folder, 'new.svg'), 'utf8'), svg);
    assert.equal(await fs.readFile(prepared.local.path, 'utf8'), svg); checks++;
    await service.registerFolder(folder); await fs.rename(folder, folder + '-moved');
    service = createContentService({ dataDir }); const missing = (await service.listLibraries())[0];
    assert.equal(missing.status, 'unavailable'); assert.equal((await service.listAssets(id)).length, 0); checks++;
    const pack = await service.registerLibrary(path.resolve(__dirname, '../examples/basic-shapes'));
    assert.equal((await service.listAssets(pack.library.id)).length, 6); checks++;
    console.log(JSON.stringify({ scope:'Node-only local folders', passed: checks, failed:0 }));
  } finally { await fs.rm(temp, { recursive:true, force:true }); }
})().catch(e => { console.error(e); process.exitCode=1; });
