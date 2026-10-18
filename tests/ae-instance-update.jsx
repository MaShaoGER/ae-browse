/* Explicit live AE property test. All writes stay in one uniquely named temporary comp.
   On success the caller must render separately, then remove/scan the comp and restore the prior viewer.
   On error this script attempts cleanup. Neither path saves the project. */
(function () {
    var config = AEBrowseUpdateConfig, scratch = null, opened = false, serial = 0, previous = app.project.activeItem;
    var report = { runId: config.runId, hostSha256: config.hostSha256, aeVersion: app.version, startedAtMs: new Date().getTime(), finished: false, tests: [], frames: [], baseline: [], cleanup: null, beforeActiveId: previous ? previous.id : null };
    function require(value, message) { if (!value) { throw new Error(message); } }
    function snapshot() {
        var items = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i), record = { id: item.id, name: item.name };
            if (item instanceof CompItem) { record.layers = []; for (var j = 1; j <= item.numLayers; j++) { record.layers.push({ id: item.layer(j).id, name: item.layer(j).name }); } }
            items.push(record);
        }
        return items;
    }
    function test(name, fn) { try { fn(); report.tests.push({ name: name, passed: true }); } catch (e) { report.tests.push({ name: name, passed: false, error: String(e), line: e.line }); } }
    function send(operation, target, payload) {
        serial++;
        return JSON.parse(AEBrowseHost.dispatch(JSON.stringify({ protocolVersion: 1, requestId: 'request-' + serial, operationId: config.runId + '-' + serial, operation: operation, target: target, payload: payload || {} })));
    }
    function ok(response) { require(response.ok, JSON.stringify(response.diagnostics)); return response.data; }
    function rejected(response, code) {
        require(!response.ok, 'Unexpected success');
        var found = false; for (var i = 0; i < response.diagnostics.length; i++) { if (response.diagnostics[i].code === code) { found = true; } }
        require(found, JSON.stringify(response.diagnostics));
    }
    function select(layer) { var selected = scratch.selectedLayers; for (var i = 0; i < selected.length; i++) { selected[i].selected = false; } if (layer) { layer.selected = true; } }
    function target(data) { return { compId: scratch.id, layerId: data.layerId, instanceId: data.instanceId }; }
    function payload(source, instance, parameters) { return { loaded: source, parameters: parameters, expected: { parameters: instance.parameters, observed: instance.observed } }; }
    function changed(instance) {
        var result = AEBrowsePlan.clone(instance.parameters);
        if (result.width !== undefined) { result.width = 240; result.height = 130; }
        if (result.diameter !== undefined) { result.diameter = 150; }
        if (result.outerRadius !== undefined) { result.outerRadius = 85; result.rotation = 30; }
        if (result.innerRadius !== undefined) { result.innerRadius = 38; }
        if (result.radius !== undefined) { result.radius = 30; }
        result.color = [.9,.3,.2,1]; return result;
    }
    try {
        report.baseline = snapshot();
        app.beginUndoGroup('AE Browse · 临时实例更新验收'); opened = true;
        scratch = app.project.items.addComp(config.tempName, 960, 640, 1, 3, 30); scratch.openInViewer();
        report.temporary = { id: scratch.id, name: scratch.name };
        var motions = ['none', 'pop', 'slide', 'fade'];
        for (var a = 0; a < config.sources.length; a++) {
            var source = config.sources[a];
            for (var m = 0; m < motions.length; m++) {
                var layer = null;
                test(source.asset.id + ' / ' + motions[m] + ' updates on the same layer and preserves animation', function () {
                    var created = ok(send('instantiateAsset', { compId: scratch.id }, { loaded: source, parameters: { motion: motions[m] }, insertTime: .25 }));
                    layer = scratch.layer(1); select(layer);
                    var read = ok(send('getSelectedInstance', { compId: scratch.id }));
                    require(read.layerId === created.layerId && !read.modified, 'Selection identity');
                    var values = changed(read), updated = ok(send('updateInstance', target(read), payload(source, read, values)));
                    require(updated.layerId === created.layerId && updated.instanceId === created.instanceId, 'Layer replaced');
                    require(!updated.modified && AEBrowsePlan.same(updated.parameters, values), 'Wrong updated values');
                    require(AEBrowsePlan.same(updated.observed.animation, read.observed.animation), 'Animation changed');
                    require(AEBrowsePlan.same(updated.observed.color, [.9,.3,.2,1]), 'Fill did not change');
                    if (m === 1) { layer.property('ADBE Transform Group').property('ADBE Position').setValue([160 + (a % 3) * 320, 160 + Math.floor(a / 3) * 320]); layer = null; }
                });
                if (layer) { layer.remove(); }
            }
        }
        var card = config.sources[0];
        var instance = ok(send('instantiateAsset', { compId: scratch.id }, { loaded: card, parameters: {}, insertTime: .25 }));
        var guarded = scratch.layer(1); select(guarded);
        test('Selection changes stop before mutation', function () { select(null); rejected(send('updateInstance', target(instance), payload(card, instance, changed(instance))), 'E_SELECTION_CHANGED'); select(guarded); });
        test('Locked layers remain unchanged', function () { guarded.locked = true; try { rejected(send('updateInstance', target(instance), payload(card, instance, changed(instance))), 'E_SELECTION_LOCKED'); } finally { guarded.locked = false; } });
        test('Source version changes stop before mutation', function () { var source = AEBrowsePlan.clone(card); source.manifest.pack.version = '9.0.0'; rejected(send('updateInstance', target(instance), payload(source, instance, changed(instance))), 'E_INSTANCE_SOURCE_CHANGED'); });
        test('Manual appearance changes are preserved', function () {
            var metadata = JSON.parse(guarded.comment.substring(9));
            var size = guarded.property('ADBE Root Vectors Group').property(metadata.groupIndex).property('ADBE Vectors Group').property(metadata.shapeIndex).property('ADBE Vector Rect Size');
            size.setValue([321,180]);
            rejected(send('updateInstance', target(instance), payload(card, instance, changed(instance))), 'E_INSTANCE_MODIFIED');
            require(AEBrowsePlan.same(size.value, [321,180]), 'Manual change overwritten'); size.setValue([320,180]);
        });
        test('Serialization failure restores actual geometry and exact metadata', function () {
            var before = guarded.comment, stringify = AEBrowseJSON.stringify;
            AEBrowseJSON.stringify = function (value) { if (value && value.layerId && value.parameters.width === 240) { throw new Error('Injected response failure'); } return stringify(value); };
            var result;
            try { result = send('updateInstance', target(instance), payload(card, instance, changed(instance))); }
            finally { AEBrowseJSON.stringify = stringify; }
            rejected(result, 'I_UPDATE_ROLLED_BACK');
            require(guarded.comment === before, 'Metadata did not restore');
            require(AEBrowsePlan.same(AEBrowseNative.capture(guarded).observed, instance.observed), 'Properties did not restore');
        });
        test('Successful update rejects another write from the old snapshot', function () {
            var updated = ok(send('updateInstance', target(instance), payload(card, instance, changed(instance))));
            rejected(send('updateInstance', target(instance), payload(card, instance, instance.parameters)), 'E_INSTANCE_STALE');
            require(AEBrowsePlan.same(AEBrowseNative.capture(guarded).parameters, updated.parameters), 'Stale write changed values');
        });
        guarded.remove();
        require(scratch.numLayers === 6, 'Expected six preview layers');
        // Rendering is a separate host call with no open undo groups.
        report.awaitingPixelCaptureAndCleanup = true;
    } catch (error) { report.error = String(error); report.errorLine = error.line; }
    finally {
        try {
            if (scratch && report.error) { scratch.remove(); scratch = null; }
            if (!report.awaitingPixelCaptureAndCleanup || report.error) {
            var absent = true;
            for (var i = 1; i <= app.project.numItems; i++) { var item = app.project.item(i); if (item.name === config.tempName || report.temporary && item.id === report.temporary.id) { absent = false; } }
            var after = snapshot();
            report.cleanup = { absentByItemScan: absent, originalItemsAndLayerIdentitiesUnchanged: AEBrowsePlan.same(after, report.baseline), itemCount: app.project.numItems, projectSaved: false };
            if (previous && previous instanceof CompItem) { previous.openInViewer(); }
            }
        } catch (cleanupError) { report.cleanupError = String(cleanupError); }
        if (opened) { app.endUndoGroup(); }
        report.passed = 0; report.failed = 0;
        for (i = 0; i < report.tests.length; i++) { if (report.tests[i].passed) { report.passed++; } else { report.failed++; } }
        report.finished = true; report.endedAtMs = new Date().getTime();
        var file = new File(config.reportPath); file.encoding = 'UTF-8';
        if (file.open('w')) { try { file.write(JSON.stringify(report, null, 2)); } finally { file.close(); } }
    }
    return JSON.stringify(report);
})();
