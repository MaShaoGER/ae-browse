'use strict';
// Node only: isolated source files/registry plus UI event boundary. No AE calls.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createContentService } = require('../cep/node/content-service.cjs');
const root = path.resolve(__dirname, '..'), results = [];
async function test(name, fn) { try { await fn(); results.push({name, passed:true}); } catch(error) { results.push({name, passed:false, error:error.stack}); console.error(name + ': ' + error.message); } }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><path d="M0 0H30V20H0Z"/></svg>';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aebrowse-drop-'));
  try {
    const folder = path.join(temp, '中文 素材'), other = path.join(temp, '其他'), dataDir = path.join(temp, 'settings');
    await fs.mkdir(path.join(folder, '子目录'), {recursive:true}); await fs.mkdir(other);
    const first = path.join(folder, '箭头 #1.svg'), second = path.join(folder, '图片.PNG'), extra = path.join(folder, '未拖入.svg'), nested = path.join(folder, '子目录/圆.svg'), jpg = path.join(other, '照片.JPEG');
    for (const file of [first, extra, nested]) await fs.writeFile(file, svg);
    await fs.writeFile(second, png); await fs.writeFile(jpg, png);
    const before = await fs.readdir(folder), original = await fs.readFile(first);
    let service = createContentService({dataDir}), filesId, folderId;
    await test('Dragging selected files never registers unselected siblings or subfolders', async () => {
      const r = await service.registerDroppedPaths([first, second]); assert.equal(r.accepted,2); assert.equal(r.rejected.length,0);
      assert.equal(r.libraries.length,1); filesId = r.libraries[0].id;
      assert.equal(r.libraries[0].sourceType,'files');
      assert.deepEqual((await service.listAssets(filesId)).map(a=>a.name).sort(), ['图片','箭头 #1'].sort());
      assert.equal((await service.listAssets(filesId, '箭头 #1')).length,1);
    });
    await test('Mixed folders and file parents are registered independently and directory scans recurse', async () => {
      const r = await service.registerDroppedPaths([folder,jpg]); assert.equal(r.accepted,2); assert.equal(r.libraries.length,2);
      folderId = r.libraries.find(l=>l.sourceType==='folder').id;
      assert.equal((await service.listAssets(folderId)).length,4);
      assert.equal((await service.listAssets(filesId)).length,2);
      assert.equal((await service.listLibraries()).length,3);
    });
    await test('Repeated paths, case aliases on Windows and repeated drops do not duplicate libraries or assets', async () => {
      const r = await service.registerDroppedPaths([first,first,process.platform==='win32' ? first.toUpperCase() : first]);
      assert.equal(r.duplicates,2); assert.equal((await service.listLibraries()).length,3);
      await service.registerDroppedPaths([first]); assert.equal((await service.listAssets(filesId)).length,2);
    });
    await test('Dragging another selected sibling merges only that file into its parent group', async () => {
      await service.registerDroppedPaths([extra]); assert.equal((await service.listAssets(filesId)).length,3);
      assert.equal((await service.listLibraries()).length,3);
    });
    await test('Registrations and file selections survive service restart', async () => {
      service = createContentService({dataDir}); assert.equal((await service.listLibraries()).length,3);
      assert.equal((await service.listAssets(filesId)).length,3);
    });
    await test('Dropped SVG and PNG reuse verified immutable import snapshots', async () => {
      for (const name of ['箭头 #1','图片']) {
        const a = (await service.listAssets(filesId)).find(a=>a.name===name);
        const r = await service.prepareAsset(filesId,a.id,a.fingerprint,{},{});
        assert.deepEqual(await fs.readFile(r.local.path), name==='图片' ? png : original);
      }
    });
    await test('Changed sources cannot import using an old drop snapshot', async () => {
      const a = (await service.listAssets(filesId)).find(a=>a.name==='箭头 #1');
      await fs.writeFile(first,svg.replace('30','31'));
      await assert.rejects(service.prepareAsset(filesId,a.id,a.fingerprint,{},{}), e=>e.code==='E_LOCAL_CHANGED');
      await service.refreshLibrary(filesId);
      assert.notEqual((await service.getAsset(filesId,a.id)).fingerprint,a.fingerprint);
      await fs.writeFile(first,original);
    });
    await test('A missing file reports partial results without hiding other selected files', async () => {
      await fs.rename(extra,extra+'.moved'); const r = await service.refreshLibrary(filesId);
      assert.equal(r.status,'partial'); assert.ok(r.diagnostics.length);
      assert.equal((await service.listAssets(filesId)).length,2); await fs.rename(extra+'.moved',extra);
    });
    await test('Unsupported, missing and relative inputs are reported while valid inputs remain usable', async () => {
      const text = path.join(other,'说明.txt'); await fs.writeFile(text,'keep');
      const r = await service.registerDroppedPaths([text,path.join(temp,'missing.svg'),'relative.svg',null,first]);
      assert.equal(r.accepted,1); assert.equal(r.rejected.length,4);
      assert.ok(r.rejected.some(e=>e.code==='E_LOCAL_TYPE')); assert.equal((await service.listAssets(filesId)).length,3);
    });
    await test('Oversized and active SVG files are blocked rather than becoming importable', async () => {
      const bad = path.join(other,'bad.svg'), big = path.join(other,'big.png');
      await fs.writeFile(bad,'<svg><script>alert(1)</script></svg>'); await fs.writeFile(big,Buffer.alloc(8*1024*1024+1));
      const r = await service.registerDroppedPaths([bad,big]); const found = await service.listAssets(r.libraries[0].id);
      for (const a of found.filter(a=>['bad','big'].includes(a.name))) {
        assert.equal(a.status,'blocked'); await assert.rejects(service.prepareAsset(a.packId,a.id,a.fingerprint,{},{}));
      }
    });
    await test('The settings directory cannot be registered through drag and drop', async () => {
      const r = await service.registerDroppedPaths([dataDir,path.join(dataDir,'folders.json')]);
      assert.equal(r.accepted,0); assert.equal(r.rejected.length,2);
      assert.equal(r.rejected.find(item=>item.path===dataDir).code,'E_DATA_DIRECTORY_OVERLAP');
    });
    await test('Empty and excessive batches fail before modifying the registry', async () => {
      const before = await fs.readFile(path.join(dataDir,'folders.json'),'utf8');
      await assert.rejects(service.registerDroppedPaths([])); await assert.rejects(service.registerDroppedPaths(Array(1001).fill(first)));
      assert.equal(await fs.readFile(path.join(dataDir,'folders.json'),'utf8'),before);
    });
    await test('Concurrent batches serialize and retain both file selections', async () => {
      const a = path.join(other,'a.svg'), b = path.join(other,'b.svg'); await fs.writeFile(a,svg); await fs.writeFile(b,svg);
      const r = await Promise.all([service.registerDroppedPaths([a]),service.registerDroppedPaths([b])]);
      assert.equal(r[0].libraries[0].id,r[1].libraries[0].id);
      const names = (await service.listAssets(r[0].libraries[0].id)).map(a=>a.name);
      assert.ok(names.includes('a')&&names.includes('b'));
    });
    await test('Removing a dropped file group preserves source files and other registrations', async () => {
      await service.removeLibrary(filesId); assert.equal((await service.listLibraries()).length,2);
      assert.deepEqual(await fs.readdir(folder),before); assert.deepEqual(await fs.readFile(first),original);
      service = createContentService({dataDir}); assert.equal((await service.listLibraries()).length,2);
    });
    await test('Malformed persisted selections cannot escape the registered directory', async () => {
      const isolated = path.join(temp,'malformed'); await fs.mkdir(isolated);
      await fs.writeFile(path.join(isolated,'folders.json'), JSON.stringify({schemaVersion:1,folders:[{id:'folder-'+ 'a'.repeat(32),directory:folder,name:'bad',files:['../outside.svg']}]}));
      await assert.rejects(createContentService({dataDir:isolated}).listLibraries(),e=>e.code==='E_FOLDER_REGISTRY');
    });
    const context = vm.createContext({window:{},Promise});
    vm.runInContext(await fs.readFile(path.join(root,'cep/ui/file-drop.js'),'utf8'),context);
    const ui = context.window.AEBrowseFileDrop;
    function harness() {
      const handlers = new Map(), overlay={hidden:true}, paths=[], errors=[]; let enabled=true;
      const target={addEventListener:(n,fn)=>handlers.set(n,fn),removeEventListener:n=>handlers.delete(n)};
      const controller=ui.bind({target,overlay,canDrop:()=>enabled,onPaths:p=>paths.push(Array.from(p)),onError:e=>errors.push(e.message)});
      function fire(name, data={types:['Files'],files:[{path:first}]}) { let prevented=false; handlers.get(name)({dataTransfer:data,preventDefault(){prevented=true;}}); return prevented; }
      return {overlay,paths,errors,fire,controller,handlers,disable(){enabled=false;}};
    }
    await test('UI extracts native paths synchronously and never guesses a path from a file name', () => {
      assert.deepEqual(Array.from(ui.pathsFrom({files:[{path:first},{path:second}]})),[first,second]);
      assert.throws(()=>ui.pathsFrom({files:[{name:'x.svg',webkitRelativePath:'folder/x.svg'}]}),/本地路径/);
      assert.throws(()=>ui.pathsFrom({files:Array(1001).fill({path:first})}));
      assert.deepEqual(Array.from(ui.pathsFrom({items:[{kind:'file',getAsFile:()=>({path:first})}]})),[first]);
    });
    await test('Nested drag enter/leave keeps the highlight until the pointer leaves the panel', () => {
      const h=harness(); h.fire('dragenter'); h.fire('dragenter'); h.fire('dragleave'); assert.equal(h.overlay.hidden,false);
      h.fire('dragleave'); assert.equal(h.overlay.hidden,true); h.controller.dispose();
    });
    await test('A drop captures all file paths, hides the overlay and suppresses browser navigation', () => {
      const h=harness(); h.fire('dragenter'); assert.equal(h.fire('drop',{types:['Files'],files:[{path:first},{path:second}]}),true);
      assert.deepEqual(h.paths,[[first,second]]); assert.equal(h.overlay.hidden,true); h.controller.dispose();
    });
    await test('Busy/demo state rejects drops and sets the cursor to none', () => {
      const h=harness(); h.disable(); h.fire('dragenter'); assert.equal(h.overlay.hidden,true);
      const data={types:['Files'],files:[{path:first}]}; h.fire('dragover',data); assert.equal(data.dropEffect,'none');
      h.fire('drop'); assert.equal(h.paths.length,0); assert.equal(h.errors.length,1); h.controller.dispose();
    });
    await test('URLs and text cannot navigate the panel or register arbitrary paths', () => {
      const h=harness(); assert.equal(h.fire('drop',{types:['text/uri-list'],files:[]}),true);
      assert.equal(h.paths.length,0); assert.equal(h.errors.length,0); h.controller.dispose();
    });
    await test('Missing native paths report an actionable error and disposal removes handlers', () => {
      const h=harness(); h.fire('drop',{types:['Files'],files:[{name:'x.svg'}]}); assert.equal(h.errors.length,1); assert.equal(h.paths.length,0);
      h.controller.dispose(); assert.equal(h.handlers.size,0); assert.equal(h.overlay.hidden,true);
    });
  } finally { await fs.rm(temp,{recursive:true,force:true}); }
  const report={scope:'Node-only isolated filesystem and UI event boundary; no live AE',finished:true,finishedAt:new Date().toISOString(),passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
  await fs.writeFile(path.join(root,'test-results/file-drop.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({scope:report.scope,passed:report.passed,failed:report.failed}));
  if(report.failed) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
