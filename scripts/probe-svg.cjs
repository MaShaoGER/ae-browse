const fs = require('node:fs'), path = require('node:path');
const dir = path.resolve(__dirname, '../test-results/local-folder-probe-' + Date.now());
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'probe.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect x="10" y="10" width="140" height="80" rx="16" fill="#5386ed"/></svg>');
const json = fs.readFileSync(path.resolve(__dirname, '../src/json-compat.jsxinc'), 'utf8');
const script = `app.exitAfterLaunchAndEval = false;
${json}
(function () {
var before = {}, created = [], result = {finished:false}, comp = null;
app.beginUndoGroup('AE Browse SVG probe');
try {
 for (var i=1;i<=app.project.numItems;i++) before['$'+app.project.item(i).id]=true;
 comp=app.project.items.addComp('__AEBrowse_SVG_Probe_${path.basename(dir)}',640,360,1,2,30);
 comp.openInViewer();
 var opts=new ImportOptions(new File(${JSON.stringify(path.join(dir,'probe.svg').replace(/\\/g,'/'))}));
 result.canComp=opts.canImportAs(ImportAsType.COMP); result.canFootage=opts.canImportAs(ImportAsType.FOOTAGE);
 if(result.canComp) opts.importAs=ImportAsType.COMP;
 var imported=app.project.importFile(opts); result.type=imported instanceof CompItem?'comp':'footage';
 result.name=imported ? imported.name : null; result.compLayers=comp.numLayers; result.layers=[];
 for(i=1;i<=comp.numLayers;i++) result.layers.push({name:comp.layer(i).name,shape:comp.layer(i) instanceof ShapeLayer});
 if(imported instanceof CompItem) for(i=1;i<=imported.numLayers;i++) result.layers.push({name:imported.layer(i).name,shape:imported.layer(i) instanceof ShapeLayer});
 result.ok=true;
}catch(e){result.error=String(e)+' @'+e.line;}
finally{
 for(var n=app.project.numItems;n>=1;n--) {var item=app.project.item(n);if(!before['$'+item.id]) {created.push(item.id);try{item.remove();}catch(e){result.cleanupError=String(e);}}}
 result.remaining=[];for(n=1;n<=app.project.numItems;n++)if(!before['$'+app.project.item(n).id])result.remaining.push(app.project.item(n).id);
 result.finished=true; app.endUndoGroup();var out=new File(${JSON.stringify(path.join(dir,'result.json').replace(/\\/g,'/'))});out.encoding='UTF-8';out.open('w');out.write(AEBrowseJSON.stringify(result));out.close();
}
})();`;
fs.writeFileSync(path.join(dir,'run.jsx'), script);
console.log(path.join(dir,'run.jsx'));
