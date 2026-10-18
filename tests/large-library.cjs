'use strict';
// Real-file scalability and isolation checks. Uses only an independent fixture registry.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createLibraryService}=require('../cep/node/library-service.cjs');
const root=path.resolve(__dirname,'..'),fixtureRoot=path.join(root,'test-results/local-only');
fs.mkdirSync(fixtureRoot,{recursive:true});
const directory=fs.mkdtempSync(path.join(fixtureRoot,'large-library-'));
const template=JSON.parse(fs.readFileSync(path.join(root,'examples/basic-shapes/pack.json'),'utf8'));
const fixture=structuredClone(template.assets[0]);
delete fixture.help;delete fixture.extensions;delete fixture.requirements;
for(const d of fixture.parameters){delete d.help;delete d.unit;delete d.label;delete d.min;delete d.max;}
const host={aeVersion:'26.0',effects:[],capabilities:['shape.create','animation.keyframes','effect.add'],activeComp:true,comp:{id:1,width:960,height:640,duration:5,time:.25}};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={finished:false,scope:'Node real-file scaling at 100/1000/5000 assets; isolated copies and registry, no AE.',passed:0,failed:0,levels:[],directory};
async function check(name,body){const start=performance.now();try{const details=await body();report.passed++;return{name,passed:true,ms:+(performance.now()-start).toFixed(2),...details};}catch(error){report.failed++;return{name,passed:false,ms:+(performance.now()-start).toFixed(2),error:error.message,code:error.code};}}
(async()=>{
  for(const count of [100,1000,5000]){
    const source=path.join(directory,'pack-'+count),dataDir=path.join(directory,'registry-'+count);fs.mkdirSync(path.join(source,'assets'),{recursive:true});
    fs.copyFileSync(path.join(root,'examples/basic-shapes/assets/rounded-card.json'),path.join(source,fixture.source));
    const manifest={schemaVersion:1,pack:{id:'scale-'+count,name:'规模测试',version:'0.1.0'},assets:Array.from({length:count},(_,i)=>({...structuredClone(fixture),id:'card-'+String(i).padStart(4,'0'),name:'图形 '+i,tags:['group-'+i%10]}))};
    // One malformed entry must be isolated without disabling its healthy neighbours.
    manifest.assets[count-1].parameters[0].default='broken';
    const file=path.join(source,'pack.json');fs.writeFileSync(file,JSON.stringify(manifest));const before=hash(file),level={count,manifestBytes:fs.statSync(file).size,checks:[]};report.levels.push(level);
    let service=createLibraryService({dataDir}),packId;
    level.checks.push(await check('register all declared entries',async()=>{const registration=await service.registerLibrary(source);packId=registration.library.id;assert.equal(registration.library.assetCount,count);assert.equal(registration.library.status,'available');return{status:registration.library.status};}));
    if(!packId)continue;
    level.checks.push(await check('search and isolate the damaged asset',async()=>{const assets=await service.listAssets(packId);assert.equal(assets.length,count);assert.equal(assets.filter(a=>a.status==='blocked').length,1);assert.equal((await service.listAssets(packId,'group-7')).length,count/10);assert.equal((await service.listAssets(packId,'card-0000')).length,1);return{searchMatches:count/10,blocked:1};}));
    level.checks.push(await check('prepare an asset from the large manifest',async()=>{const selected=await service.getAsset(packId,'card-0000'),prepared=await service.prepareAsset(packId,selected.id,selected.fingerprint,host,{width:410,height:230});assert.deepEqual(prepared.plan.size,[410,230]);assert.equal(prepared.loaded.manifest.assets.length,1);return{hostAssetCount:1};}));
    level.checks.push(await check('restore registration and preserve source after removal',async()=>{service=createLibraryService({dataDir});assert.equal((await service.listLibraries()).length,1);assert.equal((await service.listAssets(packId)).length,count);await service.removeLibrary(packId);assert.deepEqual(await service.listLibraries(),[]);assert.equal(hash(file),before);return{sourceBytesUnchanged:true,registrationEmpty:true};}));
    console.log(JSON.stringify(level));
  }
  report.finished=true;report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'test-results/large-library.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed,directory}));process.exitCode=report.failed?1:0;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
