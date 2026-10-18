'use strict';
// Prepare an explicit live test only; never launch AE from the Node suite.
const fs = require('node:fs'), path = require('node:path');
const {createContentService} = require('../cep/node/content-service.cjs');
(async () => {
 const root = path.resolve(__dirname,'..'), directory = path.join(root,'test-results/local-folder-final');
 const service = createContentService({dataDir:path.join(directory,'library-data')});
 const library = await service.registerFolder(path.join(root,'assets/local'));
 const svg = (await service.listAssets(library.library.id)).find(a=>a.kind==='local.svg');
 const prepared = await service.prepareAsset(svg.packId,svg.id,svg.fingerprint,{},{});
 const local = await service.attachSVGRaster(prepared.local,JSON.parse(fs.readFileSync(path.join(directory,'raster.json'),'utf8')));
 const pack = await service.registerLibrary(path.join(root,'examples/basic-shapes'));
 const card = (await service.listAssets(pack.library.id))[0];
 const native = (await service.prepareAsset(card.packId,card.id,card.fingerprint,{aeVersion:'26.0',effects:[],capabilities:['shape.create','animation.keyframes','effect.add'],activeComp:true,comp:{width:960,height:640,duration:3,time:.25}},{})).loaded;
 const config = {runId:'local-'+Date.now(),local,shape:native,directory:directory.replace(/\\/g,'/')};
 fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify(config,null,2));
 fs.writeFileSync(path.join(directory,'run.jsx'),'app.exitAfterLaunchAndEval=false;\n'+fs.readFileSync(path.join(root,'dist/AE Browse/jsx/host.jsx'),'utf8')+'\nvar AEBrowseLocalConfig='+JSON.stringify(config)+';\n'+fs.readFileSync(path.join(root,'tests/ae-local-import.jsx'),'utf8'));
 console.log(JSON.stringify({prepared:true,executedAE:false,script:path.join(directory,'run.jsx')}));
})().catch(e=>{console.error(e);process.exitCode=1;});
