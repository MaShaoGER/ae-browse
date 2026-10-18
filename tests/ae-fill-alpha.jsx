/* Explicit real AE alpha/property regression. Caller supplies AEBrowseUpdateConfig.
   Keeps only a uniquely identified temporary comp for separate asynchronous PNG capture. */
(function () {
    var config = AEBrowseUpdateConfig, scratch = null, opened = false, serial = 0;
    var report = { runId: config.runId, hostSha256: config.hostSha256, aeVersion: app.version,
        startedAtMs: new Date().getTime(), finished: false, tests: [], baseline: [],
        beforeActiveId: app.project.activeItem ? app.project.activeItem.id : null, passed: 0, failed: 0 };
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
    function test(name, body) {
        try { var details = body(); report.tests.push({ name: name, passed: true, details: details }); report.passed++; }
        catch (e) { report.tests.push({ name: name, passed: false, error: String(e), line: e.line }); report.failed++; }
    }
    function send(operation, target, payload) {
        serial++;
        return JSON.parse(AEBrowseHost.dispatch(JSON.stringify({ protocolVersion: 1,
            requestId: 'alpha-request-' + serial, operationId: config.runId + '-' + serial,
            operation: operation, target: target, payload: payload || {} })));
    }
    function ok(response) { require(response.ok, JSON.stringify(response.diagnostics)); return response.data; }
    function rejected(response, code) {
        require(!response.ok, 'Expected rejection');
        var found = false; for (var i = 0; i < response.diagnostics.length; i++) { if (response.diagnostics[i].code === code) { found = true; } }
        require(found, JSON.stringify(response.diagnostics));
    }
    function opacity(layer) {
        var meta = JSON.parse(layer.comment.substring(9));
        return layer.property('ADBE Root Vectors Group').property(meta.groupIndex).property('ADBE Vectors Group').property(meta.fillIndex).property('ADBE Vector Fill Opacity');
    }
    function select(layer) { var selected = scratch.selectedLayers; for (var i = 0; i < selected.length; i++) { selected[i].selected = false; } layer.selected = true; }
    function create(source, parameters) { return ok(send('instantiateAsset', { compId: scratch.id }, { loaded: source, parameters: parameters, insertTime: 0 })); }
    function update(source, instance, alpha) {
        var parameters = AEBrowsePlan.clone(instance.parameters); parameters.color[3] = alpha;
        return send('updateInstance', { compId: scratch.id, layerId: instance.layerId, instanceId: instance.instanceId },
            { loaded: source, parameters: parameters, expected: { parameters: instance.parameters, observed: instance.observed } });
    }
    try {
        report.baseline = snapshot(); app.beginUndoGroup('AE Browse RGBA temporary tests'); opened = true;
        scratch = app.project.items.addComp('__AEBrowse_Alpha_' + config.runId, 960, 640, 1, 3, 30);
        scratch.openInViewer(); report.temporary = { id: scratch.id, name: scratch.name };
        var source = config.sources[0], alphas = [0, .25, 1], previewLayers = [];
        for (var a = 0; a < alphas.length; a++) {
            test('RGBA alpha ' + alphas[a] + ' writes native fill opacity', function () {
                var instance = create(source, { width: 180, height: 140, motion: 'none', color: [.2, .5, 1, alphas[a]] });
                var layer = scratch.layer(1); previewLayers.push(layer);
                layer.property('ADBE Transform Group').property('ADBE Position').setValue([160 + 320 * a, 320]);
                require(Math.abs(instance.parameters.color[3] - alphas[a]) < .00001, 'Wrong alpha readback');
                require(Math.abs(opacity(layer).value - alphas[a] * 100) < .00001, 'Fill opacity did not follow RGBA');
                return { declaredAlpha: alphas[a], actualFillOpacity: opacity(layer).value };
            });
        }
        var motions = ['none', 'pop', 'slide', 'fade'];
        for (a = 0; a < config.sources.length; a++) {
            source = config.sources[a];
            for (var m = 0; m < motions.length; m++) {
                var currentLayer = null;
                test(source.asset.id + ' / ' + motions[m] + ' updates alpha and preserves animation', function () {
                    var instance = create(source, { motion: motions[m] }); currentLayer = scratch.layer(1); select(currentLayer);
                    var changed = ok(update(source, instance, .25));
                    require(changed.layerId === instance.layerId && changed.instanceId === instance.instanceId, 'Identity changed');
                    require(opacity(currentLayer).value === 25 && !changed.modified, 'Wrong transparent appearance');
                    require(AEBrowsePlan.same(changed.observed.animation, instance.observed.animation), 'Animation changed');
                    var opaque = ok(update(source, changed, 1));
                    require(opacity(currentLayer).value === 100 && !opaque.modified, 'Failed to restore opaque fill');
                    require(AEBrowsePlan.same(opaque.observed.animation, instance.observed.animation), 'Animation changed while restoring alpha');
                });
                if (currentLayer) { currentLayer.remove(); }
            }
        }
        source = config.sources[0];
        var instance = create(source, { motion: 'fade' }), guarded = scratch.layer(1); select(guarded);
        test('Opaque legacy baselines remain editable', function () {
            require(!Object.prototype.hasOwnProperty.call(instance.observed, 'fillOpacity'), 'Opaque legacy baseline format changed');
            instance = ok(update(source, instance, .25)); require(opacity(guarded).value === 25, 'Legacy update failed');
        });
        test('Manual native fill opacity remains protected', function () {
            opacity(guarded).setValue(40);
            try { rejected(update(source, instance, .75), 'E_INSTANCE_MODIFIED'); require(opacity(guarded).value === 40, 'Manual opacity overwritten'); }
            finally { opacity(guarded).setValue(25); }
        });
        test('Serialization failure restores actual opacity and exact metadata', function () {
            var before = guarded.comment, stringify = AEBrowseJSON.stringify;
            AEBrowseJSON.stringify = function (value) { if (value && value.layerId && value.parameters.color[3] === .75) { throw new Error('Injected alpha response failure'); } return stringify(value); };
            var response; try { response = update(source, instance, .75); } finally { AEBrowseJSON.stringify = stringify; }
            rejected(response, 'I_UPDATE_ROLLED_BACK'); require(opacity(guarded).value === 25 && guarded.comment === before, 'Opacity or metadata did not restore');
            require(AEBrowsePlan.same(AEBrowseNative.capture(guarded).observed, instance.observed), 'Original snapshot changed');
        });
        guarded.remove(); require(scratch.numLayers === 3, 'Expected three alpha preview cards');
        report.awaitingPixelCaptureAndCleanup = true;
    } catch (e) { report.error = String(e); report.errorLine = e.line; }
    finally {
        if (report.error && scratch) { scratch.remove(); scratch = null; }
        if (opened) { app.endUndoGroup(); }
        report.finished = true; report.endedAtMs = new Date().getTime();
        var file = new File(config.reportPath); file.encoding = 'UTF-8';
        if (file.open('w')) { try { file.write(JSON.stringify(report, null, 2)); } finally { file.close(); } }
    }
})();
