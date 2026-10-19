'use strict';
// Host plan validation in Node VM. Real AE properties are checked separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const file=path.resolve(__dirname,'../src/svg-shape-adapter.jsxinc');
assert.ok(fs.existsSync(file),'SVG native shape adapter is not implemented');
const sandbox=vm.createContext({});vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
const plan={version:1,width:100,height:100,elements:[{name:'square',paths:[{vertices:[[0,0],[100,0],[100,100],[0,100]],inTangents:[[0,0],[0,0],[0,0],[0,0]],outTangents:[[0,0],[0,0],[0,0],[0,0]],closed:true}],fill:[1,0,0,1],stroke:null,strokeWidth:0,lineCap:'butt',lineJoin:'miter',miterLimit:4,fillRule:'evenodd',opacity:1}]};
function validate(value){sandbox.plan=JSON.stringify(value);return vm.runInContext('AEBrowseSVGNative.validate(JSON.parse(plan))',sandbox);}
validate(plan);
const invalid=[{...plan,width:Infinity},{...plan,elements:[]},{...plan,elements:[{...plan.elements[0],fill:[2,0,0,1]}]},{...plan,elements:[{...plan.elements[0],fillRule:'guess'}]},{...plan,elements:[{...plan.elements[0],paths:[{...plan.elements[0].paths[0],inTangents:[]}]}]},{...plan,elements:[{...plan.elements[0],opacity:-1}]},{...plan,elements:[{...plan.elements[0],strokeWidth:-1}]},{...plan,elements:[{...plan.elements[0],paths:[{...plan.elements[0].paths[0],closed:'yes'}]}]}];
for(const value of invalid)assert.throws(()=>validate(value),e=>e.code==='E_SVG_PLAN');
console.log('SVG host validation: 9 checks passed (Node VM; no live AE)');
