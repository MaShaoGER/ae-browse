'use strict';
// Runs preparation in Node and evaluates generated fixtures in a sealed VM.
// The simulated addComp throws before any host properties are touched. No AE launch.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),script=path.join(root,'scripts/prepare-instance-update-test.cjs');
const results=[];
function test(name,body){try{body();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});console.error('FAIL '+name+': '+error.message);}}
for(const [args,suite,prefix] of [[[],'update','Update'],[['--suite','update'],'update','Update'],[['--suite','alpha'],'alpha','Alpha'],[['--suite','logic'],'logic','Logic']]){
  test(suite+' fixture selects the intended temporary composition and leaves AE open',()=>{
    const child=spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
    const info=JSON.parse(child.stdout.trim()),files=new Map(),attempts=[];
    function File(file){this.path=file;}File.prototype.open=function(mode){assert.equal(mode,'w');return true;};File.prototype.write=function(text){files.set(this.path,text);return true;};File.prototype.close=function(){};
    const app={version:'26.0x67',project:{activeItem:null,numItems:0,items:{addComp(name){attempts.push(name);throw Error('sealed VM composition sentinel');}}},beginUndoGroup(){},endUndoGroup(){}};
    const context=vm.createContext({app,File,CompItem:function CompItem(){}});
    vm.runInContext(fs.readFileSync(info.scriptPath,'utf8'),context,{timeout:1500});
    assert.deepEqual(attempts,['__AEBrowse_'+prefix+'_'+info.runId]);
    assert.equal(app.exitAfterLaunchAndEval,false);
    const output=JSON.parse(files.get(info.reportPath));assert.equal(output.finished,true);assert.match(output.error,/sealed VM composition sentinel/);
    assert.equal(output.runId,info.runId);
  });
}
for(const args of [['--suite','missing'],['--unknown']])test('invalid preparation arguments refuse without creating a fixture: '+args.join(' '),()=>{
  const before=fs.readdirSync(path.join(root,'test-results')).sort();
  const child=spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8'});assert.notEqual(child.status,0);
  assert.deepEqual(fs.readdirSync(path.join(root,'test-results')).sort(),before);
});
test('basic-shape preparation also keeps the explicitly launched AE instance open',()=>{
  const child=spawnSync(process.execPath,[path.join(root,'scripts/prepare-basic-shapes-test.cjs')],{cwd:root,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  const info=JSON.parse(child.stdout),attempts=[],files=new Map();
  function File(file){this.path=file;}File.prototype.open=function(){return true;};File.prototype.write=function(text){files.set(this.path,text);return true;};File.prototype.close=function(){};
  const app={version:'26.0x67',project:{activeItem:null,file:null,numItems:0,items:{addComp(name){attempts.push(name);throw Error('sealed VM composition sentinel');}}},beginUndoGroup(){},endUndoGroup(){}};
  vm.runInNewContext(fs.readFileSync(info.scriptPath,'utf8'),{app,File,CompItem:function CompItem(){}},{timeout:1500});
  assert.deepEqual(attempts,['__AEBrowse_BasicShapes_'+info.runId]);assert.equal(app.exitAfterLaunchAndEval,false);
  assert.match(JSON.parse(files.get(info.reportPath)).error,/sealed VM composition sentinel/);
});
const report={finished:true,timestamp:new Date().toISOString(),scope:'Node subprocess fixture preparation and sealed VM routing only; no real AE calls.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
fs.writeFileSync(path.join(root,'test-results/live-test-preparation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed}));process.exitCode=report.failed?1:0;
