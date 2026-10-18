/* Explicit live AE smoke test. Unique temporary items; never save the project. */
(function () {
 var config=AEBrowseLocalConfig, report={runId:config.runId,finished:false,results:[],before:[],created:[]}, comp=null;
 function write(name,value) {var f=new File(config.directory+'/'+name);f.encoding='UTF-8';if(!f.open('w'))throw Error(f.error);f.write(AEBrowseJSON.stringify(value));f.close();}
 function check(name,ok,detail) {report.results.push({name:name,passed:!!ok,detail:detail||null});if(!ok)throw Error(name+': '+AEBrowseJSON.stringify(detail));}
 function request(operation,payload,operationId) {var r=AEBrowseJSON.parse(AEBrowseHost.dispatch(AEBrowseJSON.stringify({protocolVersion:1,requestId:'req-'+report.results.length+'-'+operation,operation:operation,operationId:operationId||'op-'+report.results.length,target:{compId:comp.id},payload:payload})));return r;}
 app.beginUndoGroup('AE Browse local smoke test');
 try {
  for(var i=1;i<=app.project.numItems;i++) report.before.push({id:app.project.item(i).id,name:app.project.item(i).name});
  comp=app.project.items.addComp('__AEBrowse_Local_'+config.runId,960,640,1,3,30);comp.openInViewer();
  var svg=request('importLocalAsset',{local:config.local,insertTime:.25},'svg-smoke');
  check('SVG compatibility import',svg.ok,svg);
  var svgLayer=comp.layer(1), scale=svgLayer.property('ADBE Transform Group').property('ADBE Scale').value;
  check('SVG displayed at original size and centered',Math.abs(svgLayer.source.width*scale[0]/100-320)<.1 && Math.abs(svgLayer.source.height*scale[1]/100-200)<.1,{scale:scale,width:svgLayer.source.width,height:svgLayer.source.height});
  var repeat=request('importLocalAsset',{local:config.local,insertTime:.25},'svg-smoke');
  check('Duplicate request creates one layer',repeat.ok&&repeat.data.reused&&comp.numLayers===1,repeat);
  var plain={path:config.local.fallback.path,extension:'.png',fingerprint:config.local.fallback.fingerprint,name:'PNG smoke'};
  var png=request('importLocalAsset',{local:plain,insertTime:.25},'png-smoke');check('PNG import',png.ok&&comp.numLayers===2,png);
  comp.layer(1).enabled=false;
  var missing={path:config.directory+'/'+new Array(65).join('c')+'.png',extension:'.png',fingerprint:new Array(65).join('c'),name:'missing'};
  var rejected=request('importLocalAsset',{local:missing,insertTime:.25},'missing-smoke');check('Missing file leaves existing layers intact',!rejected.ok&&comp.numLayers===2,rejected);
  var shapeResult=request('instantiateAsset',{loaded:config.shape,parameters:{motion:'none'},insertTime:.25},'native-smoke');check('Existing native shape creation',shapeResult.ok,shapeResult);
  var layer=comp.layer(1);for(i=1;i<=comp.numLayers;i++)comp.layer(i).selected=false;layer.selected=true;
  var read=request('getSelectedInstance',{});check('Existing instance read',read.ok,read);
  var values=AEBrowseJSON.parse(AEBrowseJSON.stringify(read.data.parameters));values.width=260;
  var update=AEBrowseJSON.parse(AEBrowseHost.dispatch(AEBrowseJSON.stringify({protocolVersion:1,requestId:'update-smoke',operation:'updateInstance',operationId:'native-update',target:{compId:comp.id,layerId:layer.id,instanceId:read.data.instanceId},payload:{loaded:config.shape,parameters:values,expected:{parameters:read.data.parameters,observed:read.data.observed}}})));
  check('Existing instance update',update.ok,update);
  layer.enabled=false;
  comp.saveFrameToPng(1,new File(config.directory+'/ae-svg.png'));
  report.frameRequested=true;
 } catch(e) {report.error=String(e)+' @'+e.line;}
 finally {
  for(var n=1;n<=app.project.numItems;n++){var item=app.project.item(n),original=false;for(var j=0;j<report.before.length;j++)if(report.before[j].id===item.id)original=true;if(!original)report.created.push({id:item.id,name:item.name});}
  report.passed=0;report.failed=0;for(n=0;n<report.results.length;n++)if(report.results[n].passed)report.passed++;else report.failed++;
  report.finished=true;app.endUndoGroup();write('ae-properties.json',report);
 }
})();
