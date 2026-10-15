'use strict';
// Explicit local MCP integration driver. No UI automation, project saves, or automatic write retries.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Provide the verified local AE MCP port.');
const endpoint = 'http://127.0.0.1:' + port + '/mcp';
let session, sequence = 0;
async function rpc(method, params, notification = false) {
  const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  if (session) headers['Mcp-Session-Id'] = session;
  const body = { jsonrpc: '2.0', method, params };
  if (!notification) body.id = ++sequence;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(55000) });
  session = response.headers.get('mcp-session-id') || session;
  const raw = await response.text();
  if (!response.ok) throw new Error('Local MCP HTTP ' + response.status + ': ' + raw.slice(0, 300));
  if (!raw.trim()) return null;
  const payload = raw.trim().startsWith('{') ? raw : raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
  const result = JSON.parse(payload);
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.result;
}
function unwrap(result) {
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || []).find(item => item.type === 'text');
  if (!text) return result;
  try { return JSON.parse(text.text); } catch (_) { return { ok: false, error: text.text }; }
}
async function call(name, args) { return unwrap(await rpc('tools/call', { name, arguments: args })); }
async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'AE Browse explicit live test', version: '0.2.0' } });
  await rpc('notifications/initialized', {}, true);
  const listed = await rpc('tools/list', {});
  for (const required of ['ae_workspace', 'ae_skillUse', 'ae_exec', 'ae_read']) if (!listed.tools.some(tool => tool.name === required)) throw new Error('Missing maintained AE tool: ' + required);
  const bound = await call('ae_workspace', { action: 'bind', access: 'write', work_dir: root });
  if (!bound.ok) throw new Error(JSON.stringify(bound));
  const context_id = bound.context_id;
  const guide = await call('ae_skillUse', { name: 'ae-execution-guide', context_id, include_templates: false });
  if (!guide.ok) throw new Error('Execution guide unavailable');
  const read = await call('ae_read', { context_id, target: 'project', page: { limit: 50, offset: 0 } });
  const expectedName = '__AE_BROWSE_CEP_UI_cep-host-1791981162921-de010fe9';
  if (read.total !== 1 || read.items[0].itemId !== '1' || read.items[0].name !== expectedName) throw new Error('Isolated test project identity mismatch: ' + JSON.stringify(read));
  const code = fs.readFileSync(path.join(root, 'dist/AE Browse/jsx/host.jsx'), 'utf8') + '\n' +
    "(function(){var comp=app.project.activeItem;if(!(comp instanceof CompItem)||comp.id!==1||comp.name!==" + JSON.stringify(expectedName) + ")throw new Error('UI test target changed');if(comp.numLayers!==1)throw new Error('Expected exactly one UI-created layer');var layer=comp.layer(1),meta=AEBrowseJSON.parse(layer.comment.substring(9)),data=AEBrowseNative.capture(layer);return AEBrowseJSON.stringify({ok:true,compId:comp.id,layerId:layer.id,instanceId:meta.instanceId,layerCount:comp.numLayers,packId:data.packId,assetId:data.assetId,parameters:data.parameters,observed:data.observed,modified:data.modified,projectFile:app.project.file?app.project.file.fsName:null});})();";
  const observed = await call('ae_exec', { context_id, code, timeout_sec: 20 });
  if (!observed.ok) throw new Error(JSON.stringify(observed));
  const result = JSON.parse(observed.content);
  fs.writeFileSync(path.join(root, 'test-results/cep-ui-readback.json'), JSON.stringify({ ...result, execution_source: observed.execution_source, readAt: new Date().toISOString() }, null, 2));
  const report = { finished: false, startedAt: new Date().toISOString(), readback: result, frames: null, comparison: null, cleanup: null };
  if (process.argv[3] === '--finish') {
    const outDir = path.join(root, 'test-results/cep-host-1791981162921-de010fe9/ui-frames');
    try {
      report.frames = await call('ae_previewFrame', { context_id, comp_id: '1', times: [0.5, 0.8, 1.1], layout: 'grid', out_dir: outDir, include_base64: false });
      if (report.frames.ok === false) throw new Error(JSON.stringify(report.frames));
      report.comparison = await call('ae_previewFrame', { context_id, comp_id: '1', compare: { a: { time: 0.5 }, b: { time: 1.1 }, mode: 'both', threshold: 0 }, out_dir: outDir });
      if (report.comparison.ok === false) throw new Error(JSON.stringify(report.comparison));
    } catch (error) { report.renderError = String(error.message || error); }
    finally {
      const cleanupCode = "(function(){var hit=null;for(var i=1;i<=app.project.numItems;i++){var item=app.project.item(i);if(item.id===1&&item.name===" + JSON.stringify(expectedName) + ")hit=item;}var removed=false;if(hit){removed=true;hit.remove();hit=null;}var left=[];for(i=1;i<=app.project.numItems;i++){item=app.project.item(i);if(item.id===1||item.name===" + JSON.stringify(expectedName) + ")left.push({id:item.id,name:item.name});}return JSON.stringify({removed:removed,absentByItemScan:left.length===0,itemCount:app.project.numItems,remaining:left,saved:false});})();";
      const cleanup = await call('ae_exec', { context_id, code: cleanupCode, undo_group_name: 'AE Browse CEP UI test cleanup', timeout_sec: 20 });
      report.cleanup = cleanup.ok ? JSON.parse(cleanup.content) : cleanup;
      report.finalScan = await call('ae_read', { context_id, target: 'project', page: { limit: 50, offset: 0 } });
    }
    report.finished = true; report.endedAt = new Date().toISOString();
    report.ok = !report.renderError && report.cleanup.absentByItemScan && report.finalScan.total === 0;
    fs.writeFileSync(path.join(root, 'test-results/cep-ui-live-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: report.ok, cleanup: report.cleanup, renderError: report.renderError, frames: report.frames, comparison: report.comparison }));
  } else console.log(JSON.stringify({ ok: result.ok, context_id, layerId: result.layerId, parameters: result.parameters, modified: result.modified, itemCount: read.total }));
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
