'use strict';

// Fixture preparation only. This script never connects to or executes After Effects.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLibraryService } = require('../cep/node/library-service.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  let hostInfoFile = null;
  let runId = 'cep-host-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host-info' && args[i + 1]) hostInfoFile = path.resolve(args[++i]);
    else if (args[i] === '--run-id' && args[i + 1]) runId = args[++i];
    else throw new Error('Usage: node scripts/prepare-cep-host-test.cjs [--host-info FILE] [--run-id ID]');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) throw new Error('Invalid test run ID.');
  const directory = path.join(root, 'test-results', runId);
  // Refuse to reuse an existing run directory, preserving unique report evidence.
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const builtHostFile = path.join(root, 'dist', 'AE Browse', 'jsx', 'host.jsx');
  const builtHost = fs.readFileSync(builtHostFile);
  let hostInfo = {
    aeVersion: '26.0', effects: ['ADBE Gaussian Blur 2'],
    capabilities: ['shape.create', 'animation.keyframes', 'effect.add'],
    supportedKinds: ['ae.nativeShape']
  };
  if (hostInfoFile) {
    const read = JSON.parse(fs.readFileSync(hostInfoFile, 'utf8').replace(/^\uFEFF/, ''));
    hostInfo = read.ok === true && read.data ? read.data : read;
    if (typeof hostInfo.aeVersion !== 'string' || !Array.isArray(hostInfo.effects) || !Array.isArray(hostInfo.capabilities)) {
      throw new Error('Host info file must contain getHostInfo data or its successful response envelope.');
    }
  }
  const comp = { width: 640, height: 360, duration: 4, time: 0.5, frameRate: 30 };
  const parameters = { width: 440, height: 220, radius: 35, color: [0.8, 0.25, 0.1, 1], duration: 0.6, motion: 'pop' };
  const service = createLibraryService({ dataDir: path.join(directory, 'library-data') });
  const registered = await service.registerLibrary(path.join(root, 'examples', 'portable-demo'));
  const packId = registered.library.packId;
  const selected = await service.getAsset(packId, 'rounded-card');
  const prepared = await service.prepareAsset(packId, selected.id, selected.fingerprint,
    { ...hostInfo, activeComp: true, selectionCount: 0, comp }, parameters);
  const forward = value => value.replace(/\\/g, '/');
  const config = {
    schemaVersion: 1, runId, preparedAt: new Date().toISOString(), phase: 'full',
    scope: 'Explicit live AE built-host property tests, with one identified temporary composition and automatic cleanup; no rendered pixel checks.',
    directory: forward(directory), reportFile: forward(path.join(directory, 'cep-host-report.json')),
    builtHost: { path: forward(builtHostFile), sha256: crypto.createHash('sha256').update(builtHost).digest('hex') },
    preparationHostSource: hostInfoFile ? forward(hostInfoFile) : 'synthetic Node fixture preflight; live host requirements are checked again by dispatcher',
    preparationHost: hostInfo, fingerprint: prepared.fingerprint, loaded: prepared.loaded,
    parameters, comp, insertTime: comp.time,
    tempCompName: '__AE_BROWSE_CEP_TEST_' + runId,
    unicodeProbe: '中文往返：引号"、反斜杠\\、换行\n、制表\t、分隔符\u2028\u2029'
  };
  const configFile = path.join(root, 'test-results', 'cep-host-config.json');
  fs.writeFileSync(path.join(directory, 'cep-host-config.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  console.log(JSON.stringify({ fixturePrepared: true, executedAE: false, runId, configFile: forward(configFile),
    reportFile: config.reportFile, hostFile: config.builtHost.path, hostSha256: config.builtHost.sha256,
    loadedAssetCount: config.loaded.manifest.assets.length, preparationHostSource: config.preparationHostSource }));
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
