'use strict';
// Explicit preparation only: creates files, never starts AE or edits installed extensions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLibraryService } = require('../cep/node/library-service.cjs');
(async function () {
  const args = process.argv.slice(2), suites = { update: 'ae-instance-update.jsx', alpha: 'ae-fill-alpha.jsx', logic: 'ae-logic-guards.jsx' };
  let suite = 'update';
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--suite' || !Object.prototype.hasOwnProperty.call(suites, args[1])) throw new Error('Usage: node scripts/prepare-instance-update-test.cjs [--suite update|alpha|logic]');
    suite = args[1];
  }
  const root = path.resolve(__dirname, '..'), runId = 'instance-' + suite + '-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const directory = path.join(root, 'test-results', runId); fs.mkdirSync(directory, { recursive: true });
  const service = createLibraryService({ dataDir: path.join(directory, 'library-data') });
  const registered = await service.registerLibrary(path.join(root, 'examples/basic-shapes'));
  const assets = await service.listAssets(registered.library.id), sources = [];
  for (const asset of assets) {
    sources.push((await service.prepareAsset(asset.packId, asset.id, asset.fingerprint, {
      aeVersion: '26.0', effects: [], capabilities: ['shape.create', 'animation.keyframes', 'effect.add'],
      activeComp: true, comp: { width: 960, height: 640, duration: 3, time: .25 }
    })).loaded);
  }
  const host = fs.readFileSync(path.join(root, 'dist/AE Browse/jsx/host.jsx'), 'utf8');
  const forward = s => s.replace(/\\/g, '/');
  const prefixes = { update: 'Update', alpha: 'Alpha', logic: 'Logic' };
  const config = { runId, suite, tempName: '__AEBrowse_' + prefixes[suite] + '_' + runId, sources,
    reportPath: forward(path.join(directory, 'ae-properties.json')), frameDirectory: forward(directory),
    hostSha256: crypto.createHash('sha256').update(host).digest('hex') };
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(directory, 'run.jsx'), 'app.exitAfterLaunchAndEval = false;\n' + host + '\nvar AEBrowseUpdateConfig = ' + JSON.stringify(config) + ';\n' + fs.readFileSync(path.join(root, 'tests', suites[suite]), 'utf8'));
  console.log(JSON.stringify({ prepared: true, executedAE: false, suite, runId, directory, scriptPath: forward(path.join(directory, 'run.jsx')), reportPath: config.reportPath }));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
