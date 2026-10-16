'use strict';
// Prepares a unique live-test script. It never launches AE or edits user registrations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLibraryService } = require('../cep/node/library-service.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const runId = 'basic-shapes-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const directory = path.join(root, 'test-results', runId);
  fs.mkdirSync(directory, { recursive: true });
  const service = createLibraryService({ dataDir: path.join(directory, 'library-data') });
  const registered = await service.registerLibrary(path.join(root, 'examples/basic-shapes'));
  const assets = await service.listAssets(registered.library.id);
  const sources = [];
  for (const id of ['rounded-card', 'circle', 'ellipse', 'triangle', 'hexagon', 'star']) {
    const asset = assets.find(value => value.id === id);
    if (!asset) throw new Error('Missing fixture asset: ' + id);
    const prepared = await service.prepareAsset(asset.packId, id, asset.fingerprint, {
      aeVersion: '26.0', capabilities: ['shape.create', 'animation.keyframes', 'effect.add'],
      effects: [], activeComp: true, comp: { id: 1, width: 960, height: 640, duration: 3, time: .25 }
    });
    sources.push(prepared.loaded);
  }
  const host = fs.readFileSync(path.join(root, 'dist/AE Browse/jsx/host.jsx'), 'utf8');
  const forward = value => value.replace(/\\/g, '/');
  const config = {
    runId, tempName: '__AEBrowse_BasicShapes_' + runId,
    reportPath: forward(path.join(directory, 'ae-properties.json')),
    builtHostSha256: crypto.createHash('sha256').update(host).digest('hex'), sources
  };
  const scriptPath = path.join(directory, 'run.jsx');
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(scriptPath, host + '\nvar AEBrowseShapesConfig = ' + JSON.stringify(config) + ';\n' +
    fs.readFileSync(path.join(root, 'tests/ae-basic-shapes.jsx'), 'utf8'));
  console.log(JSON.stringify({ prepared: true, executedAE: false, runId,
    scriptPath: forward(scriptPath), reportPath: config.reportPath, tempName: config.tempName,
    hostSha256: config.builtHostSha256 }));
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
