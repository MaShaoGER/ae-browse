'use strict';
// CEP viewport/layout checks only; no AE project writes.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {connect}=require('./cep-client.cjs');
(async()=>{const c=await connect(),checks=[],directory=path.resolve(__dirname,'../test-results/local-folder-final');
try{
 for(const [width,height] of [[780,640],[560,420],[300,420]]){
  await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await c.evaluate("window.dispatchEvent(new Event('resize'));document.querySelector('#instantiate').scrollIntoView({block:'nearest'});");
  const state=await c.evaluate("({width:innerWidth,height:innerHeight,overflow:document.body.scrollWidth>innerWidth,orientation:document.querySelector('#pane-divider').getAttribute('aria-orientation'),buttonBottom:document.querySelector('#instantiate').getBoundingClientRect().bottom,mainBottom:document.querySelector('main').getBoundingClientRect().bottom,statusBottom:document.querySelector('#status').getBoundingClientRect().bottom})");
  assert.equal(state.overflow,false);assert.ok(state.buttonBottom<=state.mainBottom+1);assert.ok(state.statusBottom<=height+1);checks.push(state);
  if(width===300){const shot=await c.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(directory,'cep-300.png'),Buffer.from(shot.data,'base64'));}
 }
 await fs.writeFile(path.join(directory,'cep-layout.json'),JSON.stringify({finished:true,scope:'Real CEP emulated viewport; no physical window resize or docking',checks},null,2));console.log(checks);
}finally{await c.call('Emulation.clearDeviceMetricsOverride');c.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
