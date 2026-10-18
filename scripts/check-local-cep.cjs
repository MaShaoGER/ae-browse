'use strict';
// Real CEP UI handlers + Node filesystem. Does not create AE comps/layers.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {connect}=require('./cep-client.cjs');
(async()=>{const c=await connect(),directory=path.resolve(__dirname,'../test-results/local-folder-final');
 try {
  await c.evaluate("document.querySelector('#enter-path').click(); document.querySelector('#library-path').value='D:/project/ae-browse/assets/local';document.querySelector('#register-path').click();");
  let state;
  for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,200));state=await c.evaluate("({status:document.querySelector('#status').textContent,location:document.querySelector('#library-location').textContent,count:document.querySelector('#grid').children.length,name:document.querySelector('#asset-name').textContent,preview:!!document.querySelector('#card-preview img'),busy:document.querySelector('#register-path').disabled})");if(!state.busy)break;}
  assert.match(state.location,/assets[\\/]local/);assert.equal(state.name,'蓝色卡片');assert.equal(state.preview,true);
  await c.evaluate("document.querySelector('#search').value='不存在的素材';document.querySelector('#search').dispatchEvent(new Event('input'))");
  await new Promise(r=>setTimeout(r,150));const searched=await c.evaluate("document.querySelector('#grid').children.length");assert.equal(searched,0);
  await c.evaluate("document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'))");
  await new Promise(r=>setTimeout(r,150));
  const rect=await c.evaluate("document.querySelector('#pane-divider').getBoundingClientRect().toJSON()");
  await c.call('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x+3,y:rect.y+40,button:'left',clickCount:1});
  await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:300,y:rect.y+40,button:'left',buttons:1});
  await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:300,y:rect.y+40,button:'left',clickCount:1});
  const ratio=await c.evaluate("Number(document.querySelector('#pane-divider').getAttribute('aria-valuenow'))");assert.ok(ratio>=25&&ratio<=75);
  await c.evaluate("document.querySelector('#refresh-host').click()");await new Promise(r=>setTimeout(r,300));
  const context=await c.evaluate("document.querySelector('#context').textContent");
  const shot=await c.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(directory,'cep-local.png'),Buffer.from(shot.data,'base64'));
  const report={finished:true,scope:'Real CEP handlers, local registry and CEF pointer input; no AE writes',registration:state,searchEmpty:searched,dividerRatio:ratio,context};
  await fs.writeFile(path.join(directory,'cep-ui.json'),JSON.stringify(report,null,2));console.log(report);
 }finally{c.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
