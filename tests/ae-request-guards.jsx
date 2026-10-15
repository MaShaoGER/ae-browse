(function () {
    var configFile = new File('D:/project/ae-browse/test-results/roundtrip-config.json');
    configFile.encoding = 'UTF-8'; configFile.open('r'); var config = JSON.parse(configFile.read()); configFile.close();
    var loaded = AEBrowseNative.load(config.library, 'rounded-card');
    var comp = null, report = { results: [], cleaned: false };
    function check(name, body) { try { body(); report.results.push({ name: name, passed: true }); } catch (error) { report.results.push({ name: name, passed: false, error: String(error) }); } }
    function require(condition, message) { if (!condition) { throw new Error(message); } }
    function conflict(data, time) { var rejected = false; try { AEBrowseNative.create(comp, data, {}, { insertTime: time, instanceId: config.runId + '-guard' }); } catch (error) { rejected = error.code === 'E_INSTANCE_CONFLICT'; } require(rejected && comp.numLayers === 1, 'Different request silently reused or mutated the instance'); }
    try {
        comp = app.project.items.addComp('__AEBrowse_' + config.runId + '_guards', 640, 360, 1, 4, 30);
        var initial = AEBrowseNative.create(comp, loaded, {}, { insertTime: .5, instanceId: config.runId + '-guard' });
        check('重复的相同请求仍可复用实例', function () { var repeated = AEBrowseNative.create(comp, loaded, {}, { insertTime: .5, instanceId: config.runId + '-guard' }); require(repeated.reused && repeated.layer.id === initial.layer.id && comp.numLayers === 1, 'Identical request did not reuse'); });
        check('同一操作 ID 的不同插入时间不会误复用', function () { conflict(loaded, 1); });
        check('同一操作 ID 的不同包版本不会误复用', function () { var changed = AEBrowsePlan.clone(loaded); changed.manifest.pack.version = '0.2.0'; conflict(changed, .5); });
        check('同一操作 ID 的不同效果内容不会误复用', function () { var changed = AEBrowsePlan.clone(loaded); changed.asset.effects[0].settings[0].value = 12; conflict(changed, .5); });
        check('二维尺寸参数能够更新并回读', function () { var changed = AEBrowsePlan.clone(loaded); changed.asset.parameters.push({ id: 'size', type: 'point2', "default": [320, 180] }); changed.payload.nodes[1].size.bind = 'size'; var created = AEBrowseNative.create(comp, changed, {}, { insertTime: 0 }); var updated = AEBrowseNative.updateAppearance(created.layer, changed, { size: [400, 220] }); require(updated.parameters.size[0] === 400 && updated.parameters.size[1] === 220, 'Point size did not round trip'); created.layer.remove(); });
    } finally { if (comp) { comp.remove(); report.cleaned = true; } }
    report.passed = 0; report.failed = 0;
    for (var i = 0; i < report.results.length; i++) { if (report.results[i].passed) { report.passed++; } else { report.failed++; } }
    return JSON.stringify(report);
})();
