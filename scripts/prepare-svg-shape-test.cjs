'use strict';
// Preparation only: generates an opt-in live AE test; never starts AE.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-results/workflow-20261018');
const fixtures=JSON.parse(fs.readFileSync(path.join(dir,'svg-fixtures.json'),'utf8'));
const runId='svg-shapes-'+Date.now(),cache=path.join(dir,runId);fs.mkdirSync(cache,{recursive:true});
for(const fixture of fixtures){const fingerprint=crypto.createHash('sha256').update(fixture.source).digest('hex'),file=path.join(cache,fingerprint+'.svg');fs.writeFileSync(file,fixture.source);fixture.local={path:file.replace(/\\/g,'/'),fingerprint,extension:'.svg',name:fixture.name,vector:fixture.plan};}
const body=`(function(){
 var fixtures=${JSON.stringify(fixtures)},runId=${JSON.stringify(runId)},results=[],comps=[],before=[],report;
 function check(name,value){results.push({name:name,passed:!!value});if(!value)throw Error(name);}
 for(var b=1;b<=app.project.numItems;b++)before.push({id:app.project.item(b).id,name:app.project.item(b).name});
 try {
  for(var f=0;f<fixtures.length;f++){
   var fixture=fixtures[f],plan=fixture.plan,comp=app.project.items.addComp('__AEBrowse_'+runId+'_'+fixture.name,plan.width,plan.height,1,2,30);comps.push({id:comp.id,name:comp.name,fixture:fixture.name});
   var added=AEBrowseLocal.create(comp,fixture.local,runId+'-'+f,0),layer=comp.layer(1);
   check(fixture.name+' creates a shape layer',layer instanceof ShapeLayer && added.vectorized && !added.rasterized);
   check(fixture.name+' creates no footage',app.project.numItems===before.length+comps.length);
   var anchor=layer.property('ADBE Transform Group').property('ADBE Anchor Point').value;check(fixture.name+' original size',anchor[0]===plan.width/2 && anchor[1]===plan.height/2);
   check(fixture.name+' operation reused',AEBrowseLocal.create(comp,fixture.local,runId+'-'+f,0).reused && comp.numLayers===1);
   var groups=layer.property('ADBE Root Vectors Group');check(fixture.name+' element groups',groups.numProperties===plan.elements.length);
   for(var e=0;e<plan.elements.length;e++){
    var el=plan.elements[e],group=groups.property(plan.elements.length-e),contents=group.property('ADBE Vectors Group');
    for(var p=0;p<el.paths.length;p++){var observed=contents.property(p+1).property('ADBE Vector Shape').value;check(fixture.name+' editable path '+e+'-'+p,observed.vertices.length===el.paths[p].vertices.length && observed.closed===el.paths[p].closed);}
    var next=el.paths.length+1;
    if(el.fill){var fill=contents.property(next++),color=fill.property('ADBE Vector Fill Color').value;check(fixture.name+' fill '+e,Math.abs(color[0]-el.fill[0])<.001 && Math.abs(color[1]-el.fill[1])<.001 && Math.abs(color[2]-el.fill[2])<.001 && Math.abs(fill.property('ADBE Vector Fill Opacity').value-el.fill[3]*100)<.001);check(fixture.name+' fill rule '+e,fill.property('ADBE Vector Fill Rule').value===(el.fillRule==='evenodd'?2:1));}
    if(el.stroke){var stroke=contents.property(next),expectedCap=1;if(el.lineCap==='round')expectedCap=2;else if(el.lineCap==='square')expectedCap=3;check(fixture.name+' stroke '+e,Math.abs(stroke.property('ADBE Vector Stroke Width').value-el.strokeWidth)<.001);check(fixture.name+' cap '+e,stroke.property('ADBE Vector Stroke Line Cap').value===expectedCap);}
   }
   var bad=AEBrowseJSON.parse(AEBrowseJSON.stringify(fixture.local));bad.vector.elements[0].paths[0].inTangents=[];var rejected=false;try{AEBrowseLocal.create(comp,bad,runId+'-bad-'+f,0);}catch(error){rejected=error.code==='E_SVG_PLAN';}check(fixture.name+' rejects malformed before creating',rejected && comp.numLayers===1);
  }
  report={finished:false,runId:runId,scope:'Actual AE native SVG property checks; no project save',results:results,comps:comps,before:before,passed:results.length,failed:0};
 }catch(error){
  var cleanup=[];for(var c=comps.length-1;c>=0;c--){for(var z=app.project.numItems;z>=1;z--){var it=app.project.item(z);if(it.id===comps[c].id && it.name===comps[c].name){it.remove();cleanup.push(comps[c].id);}}}
  report={finished:true,runId:runId,error:String(error),line:error.line,debug:{hasVector:!!fixture.local.vector,adapter:String(AEBrowseLocal.create).substring(0,1900),svgType:typeof AEBrowseSVGNative},results:results,comps:comps,before:before,cleanup:cleanup,failed:1};
 }
 var file=new File(${JSON.stringify(path.join(dir,'ae-properties.json').replace(/\\/g,'/'))});file.encoding='UTF-8';if(!file.open('w'))throw Error('Cannot write test result');file.write(AEBrowseJSON.stringify(report));file.close();return AEBrowseJSON.stringify(report);
})();`;
const modules=['json-compat.jsxinc','svg-shape-adapter.jsxinc','local-file-adapter.jsxinc'];
fs.writeFileSync(path.join(dir,'ae-properties.jsx'),'(function(){\n'+modules.map(file=>fs.readFileSync(path.join(root,'src',file),'utf8')).join('\n')+'\nreturn '+body+'\n})();');
console.log(JSON.stringify({prepared:true,runId,fixtures:fixtures.length,script:path.join(dir,'ae-properties.jsx')}));
