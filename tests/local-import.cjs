'use strict';
// Node VM exercises the real importer with an isolated AE API double; no live AE.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const file = path.resolve(__dirname, '../src/local-file-adapter.jsxinc');
assert.ok(fs.existsSync(file), 'Local AE file importer is not implemented');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/json-compat.jsxinc'),'utf8'),sandbox);
vm.runInContext(`
var next=20, items=[], layers=[];
function File(path){this.fsName=path;this.exists=true;this.name='example.svg';}
function ImportOptions(file){this.file=file;this.canImportAs=function(type){return type==='COMP'?!app.noSVG:true;};}
var ImportAsType={COMP:'COMP',FOOTAGE:'FOOTAGE'};
function Layer(){this.id=next++;this.comment='';this.startTime=0;this.inPoint=0;this.outPoint=3;this.name='svg';this.containingComp=target;}
Layer.prototype.property=function(){return {property:function(){return {setValue:function(){}};}};};
Layer.prototype.remove=function(){layers.splice(layers.indexOf(this),1);};
function CompItem(){this.id=next++;this.numLayers=1;this.name='import';this.width=160;this.height=100;this.layer=function(){return {copyToComp:function(){layers.unshift(new Layer());}};};}
var target={id:7,width:640,height:360,duration:3,time:.5,layer:function(i){return layers[i-1];},layers:{add:function(source){var l=new Layer();layers.unshift(l);return l;}}};
Object.defineProperty(target,'numLayers',{get:function(){return layers.length;}});
var app={project:{item:function(i){return items[i-1];},importFile:function(){var c=new CompItem();items.push(c);c.remove=function(){items.splice(items.indexOf(c),1);};if(app.failImport)throw Error('import failed');return c;}}};
Object.defineProperty(app.project,'numItems',{get:function(){return items.length;}});
var ShapeLayer=Layer;
`,sandbox);
vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
const local = {path:'D:/cache/'+'a'.repeat(64)+'.svg',extension:'.svg',fingerprint:'a'.repeat(64),name:'测试图标'};
function run(payload,op='one'){sandbox.payload=JSON.stringify(payload);return JSON.parse(vm.runInContext(`AEBrowseJSON.stringify(AEBrowseLocal.create(target,AEBrowseJSON.parse(payload),'${op}',.5))`,sandbox));}
const result=run(local); assert.equal(result.layerIds.length,1); assert.equal(result.compId,7);
assert.equal(run(local).reused,true); assert.equal(vm.runInContext('layers.length',sandbox),1);
assert.throws(()=>run({...local,path:'D:/bad.exe'}),e=>e.code==='E_LOCAL_FORMAT');
sandbox.app.failImport=true; assert.throws(()=>run(local,'two'),/import failed/);
assert.equal(vm.runInContext('items.length',sandbox),1); assert.equal(vm.runInContext('layers.length',sandbox),1);
sandbox.app.failImport=false; sandbox.app.noSVG=true;
assert.throws(()=>run(local,'three'),e=>e.code==='E_SVG_UNSUPPORTED');
const compatible=run({...local,fallback:{path:'D:/cache/'+'b'.repeat(64)+'.png',extension:'.png',fingerprint:'b'.repeat(64),displayWidth:160,displayHeight:100}},'four');
assert.equal(compatible.rasterized,true); assert.equal(compatible.layerIds.length,1);
console.log('Local importer: 6 checks passed (Node VM; no live AE)');
