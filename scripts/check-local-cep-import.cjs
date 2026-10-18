'use strict';
// Explicit live smoke test: one uniquely named temp comp, real panel click, cleanup.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {connect}=require('./cep-client.cjs');
(async()=>{const c=await connect(),directory=path.resolve(__dirname,'../test-results/local-folder-final'),name='__AEBrowse_CEP_Local_'+Date.now();let temp=null,report={finished:false,name};
 try {
  temp=JSON.parse(await c.host('(function(){app.beginUndoGroup("AE Browse CEP smoke");try{var comp=app.project.items.addComp('+JSON.stringify(name)+',960,640,1,3,30);comp.openInViewer();return AEBrowseJSON.stringify({id:comp.id,name:comp.name});}finally{app.endUndoGroup();}})()'));
  await c.evaluate("document.querySelector('#refresh-host').click()");
  for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,200));if(await c.evaluate("!document.querySelector('#instantiate').disabled"))break;}
  assert.equal(await c.evaluate("document.querySelector('#asset-name').textContent"),'蓝色卡片');
  await c.evaluate("document.querySelector('#instantiate').click();document.querySelector('#instantiate').click()");
  for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,200));if(await c.evaluate("document.querySelector('#result').textContent.length>0"))break;}
  report.result=await c.evaluate("({result:document.querySelector('#result').textContent,status:document.querySelector('#status').textContent})");
  assert.match(report.result.result,/SVG 已通过高清透明图片兼容导入/);
  report.observed=JSON.parse(await c.host('(function(){var comp=app.project.activeItem;if(!comp||comp.id!=='+temp.id+')throw Error("Target changed");var l=comp.layer(1);return AEBrowseJSON.stringify({layers:comp.numLayers,name:l.name,scale:l.property("ADBE Transform Group").property("ADBE Scale").value,width:l.source.width,height:l.source.height});})()'));
  assert.equal(report.observed.layers,1);assert.equal(report.observed.name,'蓝色卡片');assert.equal(report.observed.width,1280);assert.equal(report.observed.scale[0],25);
 }catch(e){report.error=e.stack;process.exitCode=1;}
 finally {
  if(temp) report.cleanup=JSON.parse(await c.host('(function(){var id='+temp.id+',name='+JSON.stringify(name)+',sources=[],removed=[],remain=[];app.beginUndoGroup("AE Browse CEP cleanup");try{for(var i=app.project.numItems;i>=1;i--){var item=app.project.item(i);if(item.id===id&&item.name===name){for(var j=1;j<=item.numLayers;j++){var s=item.layer(j).source;if(s&&/^[a-f0-9]{64}\\.png$/.test(s.name))sources.push(s.id);}item.remove();removed.push(id);break;}}for(i=app.project.numItems;i>=1;i--){item=app.project.item(i);for(j=0;j<sources.length;j++)if(item.id===sources[j]){removed.push(item.id);item.remove();break;}}for(i=1;i<=app.project.numItems;i++){item=app.project.item(i);if(item.id===id)remain.push(item.id);for(j=0;j<sources.length;j++)if(item.id===sources[j])remain.push(item.id);}return AEBrowseJSON.stringify({remaining:remain,removed:removed,projectItems:app.project.numItems,projectSaved:false});}finally{app.endUndoGroup();}})()'));
  await c.evaluate("document.querySelector('#refresh-host').click()");
  report.finished=true;await fs.writeFile(path.join(directory,'cep-import.json'),JSON.stringify(report,null,2));c.close();console.log(report);
  if(report.cleanup?.remaining.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
