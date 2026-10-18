'use strict';
// Opt-in real-file stability test. Never starts AE or uses the user's registry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { createLibraryService } = require('../cep/node/library-service.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const minutes = Number(args[0] || 1);
const persistent = args[2] === '--persistent';
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120 || args.length > 3 || (args[2] !== undefined && !persistent)) {
  throw new Error('Usage: node --expose-gc tests/soak.cjs [minutes: 0-120] [new-report-directory] [--persistent]');
}
const directory = path.resolve(args[1] || path.join(root, 'test-results/local-only', 'soak-' + Date.now()));
if (!directory.startsWith(path.join(root, 'test-results') + path.sep)) throw new Error('Report directory must be inside test-results');
const source = path.join(directory, 'source'), dataDir = path.join(directory, 'registration');
const report = { startedAt: new Date().toISOString(), finished: false,
  scope: 'Node-only real-file library/planner stability; isolated package copies and registrations; no AE calls.',
  requestedMinutes: minutes, mode: persistent ? 'persistent-service' : 'reopen-and-recovery',
  seed: 0x417ae, cycles: 0, passed: 0, failed: 0, cases: {}, samples: [], cleanup: null };
let randomState = report.seed;
const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
const integer = (low, high) => low + Math.floor(random() * (high - low + 1));
const ids = ['rounded-card', 'circle', 'ellipse', 'triangle', 'hexagon', 'star'];
const motions = ['none', 'pop', 'slide', 'fade'];
const types = ['rectangle', 'ellipse', 'ellipse', 'polygon', 'polygon', 'star'];
const latencies = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let service, assets, packId, originalPayload, originalHash;
const payloadPath = path.join(source, 'assets/star.json');
const started = performance.now();
let lastSample = -Infinity;
async function measure(name, body) {
  const begin = performance.now();
  try { await body(); report.passed++; report.cases[name] = (report.cases[name] || 0) + 1; }
  catch (error) { report.failed++; report.error = { name, message: error.message, stack: error.stack, code: error.code }; throw error; }
  finally { latencies.push(performance.now() - begin); }
}
function sample() {
  if (global.gc) global.gc();
  const memory = process.memoryUsage(), sorted = [...latencies].sort((a, b) => a - b);
  const snapshot = { elapsedSeconds: +((performance.now() - started) / 1000).toFixed(1), cycles: report.cycles,
    passed: report.passed, failed: report.failed, heapMiB: +(memory.heapUsed / 1048576).toFixed(2),
    rssMiB: +(memory.rss / 1048576).toFixed(2), windowCases: latencies.length,
    p95Ms: +(sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] || 0).toFixed(2),
    maxMs: +(sorted.at(-1) || 0).toFixed(2) };
  report.samples.push(snapshot); latencies.length = 0;
  fs.writeFileSync(path.join(directory, 'progress.json'), JSON.stringify({ ...report, elapsedSeconds: snapshot.elapsedSeconds }, null, 2));
  console.log(JSON.stringify(snapshot)); lastSample = performance.now();
}
async function register() {
  const registered = await service.registerLibrary(source);
  packId = registered.library.id; assets = await service.listAssets(packId);
  assert.equal(assets.length, 6);
}
function host() { return { aeVersion: '26.0', effects: [], capabilities: ['shape.create', 'animation.keyframes', 'effect.add'],
  activeComp: true, comp: { id: 1, width: integer(640, 1920), height: integer(480, 1080), duration: 5, time: .25 } }; }
async function cycle(index) {
  const a = index % 6, asset = assets.find(value => value.id === ids[a]);
  const context = host(), color = [integer(0, 255) / 255, integer(0, 255) / 255, integer(0, 255) / 255, 1];
  const values = { color, duration: integer(1, 20) / 10, motion: motions[integer(0, 3)] };
  const width = integer(20, 800), height = integer(20, 600), radius = integer(30, 200);
  if (a === 0 || a === 2) Object.assign(values, { width, height });
  if (a === 1) values.diameter = width;
  if (a >= 3) Object.assign(values, { outerRadius: radius, rotation: integer(-180, 180), points: integer(3, 12) });
  if (a === 5) values.innerRadius = Math.floor(radius / 2);
  await measure('randomized plans preserve dimensions, color, time and geometry', async () => {
    const prepared = await service.prepareAsset(packId, asset.id, asset.fingerprint, context, values);
    assert.equal(prepared.plan.geometryType, types[a]);
    assert.deepEqual(prepared.plan.position, [context.comp.width / 2, context.comp.height / 2]);
    assert.equal(prepared.plan.insertTime, .25); assert.deepEqual(prepared.plan.color, color);
    assert.equal(prepared.plan.parameters.motion, values.motion);
    if (a === 0 || a === 2) assert.deepEqual(prepared.plan.size, [width, height]);
    if (a === 1) assert.deepEqual(prepared.plan.size, [width, width]);
    if (a >= 3) { assert.equal(prepared.plan.points, values.points); assert.equal(prepared.plan.outerRadius, radius); }
    if (a === 5) assert.equal(prepared.plan.innerRadius, values.innerRadius);
    prepared.loaded.asset.name = 'caller mutation'; prepared.loaded.payload.nodes.length = 0;
    assert.notEqual((await service.getAsset(packId, asset.id)).name, 'caller mutation');
  });
  await measure('invalid geometry leaves the request queue usable', async () => {
    const star = assets.find(value => value.id === 'star');
    await assert.rejects(service.prepareAsset(packId, 'star', star.fingerprint, context, { innerRadius: 400 }), error => error.code === 'E_GEOMETRY_VALUE');
    assert.equal((await service.listAssets(packId, '星形')).length, 1);
  });
  if (index % 5 === 0) await measure('concurrent reads return independent snapshots', async () => {
    const reads = await Promise.all(ids.map(id => service.getAsset(packId, id)));
    assert.deepEqual(reads.map(value => value.id), ids);
    reads[0].parameters[0].default = -999;
    assert.equal((await service.getAsset(packId, 'rounded-card')).parameters[0].default, 320);
    // Library names are searchable too: all six entries belong to 基础图形库.
    assert.equal((await service.listAssets(packId, '形')).length, 6);
  });
  if (!persistent && index % 11 === 0) await measure('reopening registration restores all six fixtures', async () => {
    const prior = assets[0].fingerprint;
    service = createLibraryService({ dataDir });
    assert.equal((await service.listLibraries()).length, 1);
    assets = await service.listAssets(packId); assert.equal(assets.length, 6);
    assert.equal(assets[0].fingerprint, prior);
  });
  if (index % 17 === 0) await measure('changed source refuses preparation and recovers after explicit registration', async () => {
    await fsp.appendFile(payloadPath, '\n');
    await assert.rejects(service.prepareAsset(packId, asset.id, asset.fingerprint, context, {}), error => error.code === 'E_PACK_CHANGED');
    await assert.rejects(service.refreshLibrary(packId), error => error.code === 'E_PACK_VERSION_CONFLICT');
    assert.equal((await service.listLibraries())[0].status, 'unavailable');
    await fsp.writeFile(payloadPath, originalPayload);
    await service.removeLibrary(packId); await register();
    assert.equal(assets[0].fingerprint, asset.fingerprint);
  });
  if (!persistent && index % 29 === 0) await measure('primary registry damage restores the committed backup', async () => {
    await fsp.writeFile(path.join(dataDir, 'libraries.json'), '{incomplete');
    service = createLibraryService({ dataDir });
    const libraries = await service.listLibraries();
    assert.equal(libraries.length, 1);
    assert.ok(libraries[0].diagnostics.some(value => value.code === 'W_REGISTRY_RECOVERED'));
    assets = await service.listAssets(packId); assert.equal(assets.length, 6);
  });
  assert.equal(hash(await fsp.readFile(payloadPath)), originalHash, 'Read/preflight modified the source bytes');
}
(async () => {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory); fs.cpSync(path.join(root, 'examples/basic-shapes'), source, { recursive: true });
  originalPayload = fs.readFileSync(payloadPath); originalHash = hash(originalPayload);
  service = createLibraryService({ dataDir }); await register(); sample();
  try {
    while (performance.now() - started < minutes * 60000) {
      await cycle(report.cycles++);
      if (performance.now() - lastSample >= 60000) sample();
      await delay(750);
    }
  } catch (error) { if (!report.error) { report.failed++; report.error = { message: error.message, stack: error.stack }; } }
  finally {
    try {
      await fsp.writeFile(payloadPath, originalPayload);
      await service.removeLibrary(packId);
      report.cleanup = { registrationEmpty: (await service.listLibraries()).length === 0,
        isolatedSourceBytesRestored: hash(await fsp.readFile(payloadPath)) === originalHash,
        userRegistryAccessed: false, executedAE: false };
      assert.ok(report.cleanup.registrationEmpty && report.cleanup.isolatedSourceBytesRestored);
    } catch (error) { report.failed++; report.cleanupError = error.message; }
    sample(); report.finished = true; report.endedAt = new Date().toISOString();
    report.elapsedSeconds = +((performance.now() - started) / 1000).toFixed(1);
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ finished: true, directory, cycles: report.cycles, passed: report.passed, failed: report.failed, cleanup: report.cleanup }));
    process.exitCode = report.failed ? 1 : 0;
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
