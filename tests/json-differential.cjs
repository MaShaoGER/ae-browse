'use strict';
// Bounded data-codec differential checks in Node; no AE process is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),context=vm.createContext({JSON:undefined});
vm.runInContext(fs.readFileSync(path.join(root,'src/json-compat.jsxinc'),'utf8'),context);
let state=0x76ae11;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
const pick=n=>Math.floor(random()*n),alphabet=['中','文','a','"','\\','\n','\r','\t','\0','\u2028','\u2029','😀','\ud800','\udfff','é',' '];
function text(){let value='';for(let i=pick(20);i>0;i--)value+=alphabet[pick(alphabet.length)];return value;}
function value(depth=0){switch(pick(depth>4?5:7)){case 0:return null;case 1:return pick(2)===0;case 2:return(pick(2000000)-1000000)/10**pick(8);case 3:return text();case 4:return pick(2)===0?Number.MAX_VALUE:Number.MIN_VALUE;case 5:return Array.from({length:pick(6)},()=>value(depth+1));default:{const result={};for(let i=pick(6);i>0;i--)result['key-'+i+'-'+text()]=value(depth+1);return result;}}}
const report={finished:false,scope:'Node VM codec differential checks against native JSON; no AE access.',seed:state,generated:0,passed:0,failed:0};
try{
  for(let i=0;i<10000;i++){
    const input=value(),native=JSON.stringify(input);context.input=native;
    const encoded=vm.runInContext('AEBrowseJSON.stringify(AEBrowseJSON.parse(input))',context,{timeout:1000});
    assert.deepEqual(JSON.parse(encoded),JSON.parse(native),'Differential case '+i);
    context.input=encoded;
    assert.equal(vm.runInContext('AEBrowseJSON.stringify(AEBrowseJSON.parse(input))',context),encoded,'Non-canonical codec output at '+i);
    report.generated++;report.passed++;
  }
  for(const input of ['{"x":1,"x":2}','[1,]','{"x":true,}','01','1e','"\\x20"','{"__proto__":1}','{"nested":{"constructor":1}}']){
    context.input=input;
    assert.throws(()=>vm.runInContext('AEBrowseJSON.parse(input)',context),error=>['E_JSON_INVALID','E_JSON_DUPLICATE_KEY','E_RESERVED_KEY'].includes(error.code));report.passed++;
  }
}catch(error){report.failed++;report.error=error.stack;}
report.finished=true;report.finishedAt=new Date().toISOString();
fs.writeFileSync(path.join(root,'test-results/json-differential.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
