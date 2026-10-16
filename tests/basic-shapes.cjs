'use strict';
// Real package/service/planner integration; no live AE or user registration writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createLibraryService } = require('../cep/node/library-service.cjs');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'examples/basic-shapes');
const dataDir = fs.mkdtempSync(path.join(root, 'test-results/basic-shapes-'));
const service = createLibraryService({ dataDir });
const host = { aeVersion: '26.0', capabilities: ['shape.create', 'animation.keyframes', 'effect.add'], effects: [], activeComp: true, comp: { id: 1, width: 1280, height: 720, duration: 5, time: 1 } };
const results = [];
(async () => {
  try {
    const registration = await service.registerLibrary(dir);
    const assets = await service.listAssets(registration.library.id);
    assert.equal(assets.length, 6);
    for (const [id, type, expected] of [['rounded-card','rectangle',[320,180]],['circle','ellipse',[180,180]],['ellipse','ellipse',[260,150]],['triangle','polygon',3],['hexagon','polygon',6],['star','star',5]]) {
      try {
        const asset = assets.find(a => a.id === id); assert.ok(asset);
        const prepared = await service.prepareAsset(asset.packId, id, asset.fingerprint, host);
        assert.equal(prepared.plan.geometryType, type); assert.deepEqual(prepared.plan.position, [640,360]); assert.equal(prepared.plan.insertTime, 1);
        if (Array.isArray(expected)) assert.deepEqual(prepared.plan.size, expected); else assert.equal(prepared.plan.points, expected);
        assert.equal(prepared.loaded.manifest.assets.length, 1);
        results.push({ name: id + ' registers and prepares through the real library service', passed: true });
      } catch (error) { results.push({ name: id, passed: false, error: error.message }); }
    }
    const star = assets.find(a => a.id === 'star');
    await assert.rejects(service.prepareAsset(star.packId, star.id, star.fingerprint, host, { innerRadius: 200 }), error => error.code === 'E_GEOMETRY_VALUE');
    results.push({ name: 'invalid star rejected before host dispatch', passed: true });
  } catch (error) { results.push({ name: 'library integration', passed: false, error: error.stack }); }
  const passed = results.filter(r => r.passed).length, failed = results.length - passed;
  fs.writeFileSync(path.join(root, 'test-results/basic-shapes.json'), JSON.stringify({ finished: true, timestamp: new Date().toISOString(), scope: 'Node real-file library registration, validation and plan preparation; isolated test registration only; no AE.', passed, failed, results }, null, 2));
  console.log(JSON.stringify({ passed, failed, results: failed ? results : undefined })); process.exitCode = failed ? 1 : 0;
})();
