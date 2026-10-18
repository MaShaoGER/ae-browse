/* Explicit AE negative-case checks for logical operator evaluation differences.
   Requires the generated host plus AEBrowseUpdateConfig. Never saves the project. */
(function () {
    var config = AEBrowseUpdateConfig, scratch = null, opened = false, sequence = 0;
    var report = { runId: config.runId, hostSha256: config.hostSha256, finished: false, startedAtMs: new Date().getTime(),
        scope: 'Actual AE malformed-request and native-plan guards; no pixel checks.', tests: [], baseline: [], cleanup: null };
    var previous = app.project.activeItem;
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
        try { body(); report.tests.push({ name: name, passed: true }); }
        catch (e) { report.tests.push({ name: name, passed: false, error: String(e), line: e.line }); }
        finally { if (scratch) { while (scratch.numLayers > 0) { scratch.layer(1).remove(); } } }
    }
    function send(value) { value.requestId = config.runId + '-guard-' + (++sequence); return JSON.parse(AEBrowseHost.dispatch(JSON.stringify(value))); }
    function rejected(response, code) {
        require(response.ok === false, 'Unexpected success: ' + JSON.stringify(response));
        var found = false; for (var i = 0; i < response.diagnostics.length; i++) { if (response.diagnostics[i].code === code) { found = true; } }
        require(found, 'Expected ' + code + ': ' + JSON.stringify(response.diagnostics));
        require(scratch.numLayers === 0, 'Rejected request left a layer');
    }
    function create(source, parameters) {
        source.manifest.assets = [AEBrowsePlan.clone(source.asset)];
        return send({ protocolVersion: 1, operation: 'instantiateAsset', operationId: config.runId + '-' + sequence,
            target: { compId: scratch.id }, payload: { loaded: source, parameters: parameters || {}, insertTime: .25 } });
    }
    try {
        report.baseline = snapshot(); app.beginUndoGroup('AE Browse logical guard temporary tests'); opened = true;
        scratch = app.project.items.addComp('__AEBrowse_Logic_' + config.runId, 640, 360, 1, 3, 30);
        scratch.openInViewer(); report.temporary = { id: scratch.id, name: scratch.name };
        test('A package with resources is refused before creating a layer', function () {
            var source = AEBrowsePlan.clone(config.sources[0]); source.asset.resources = ['image.png']; rejected(create(source), 'E_RESOURCE_ADAPTER_REQUIRED');
        });
        test('Malformed resource declarations are refused before creating a layer', function () {
            var source = AEBrowsePlan.clone(config.sources[0]); source.asset.resources = 'image.png'; rejected(create(source), 'E_RESOURCE_ADAPTER_REQUIRED');
        });
        test('Fractional star points are refused even when its radii are valid', function () { rejected(create(AEBrowsePlan.clone(config.sources[5]), { points: 3.5 }), 'E_GEOMETRY_VALUE'); });
        test('Out-of-range star points remain refused without relying on descriptor limits', function () {
            var source = AEBrowsePlan.clone(config.sources[5]);
            for (var i = 0; i < source.asset.parameters.length; i++) { if (source.asset.parameters[i].id === 'points') { delete source.asset.parameters[i].min; delete source.asset.parameters[i].max; } }
            rejected(create(source, { points: 65 }), 'E_GEOMETRY_VALUE');
        });
        test('A null payload is refused even with a valid composition target', function () { rejected(send({ protocolVersion: 1, operation: 'getContext', target: { compId: scratch.id }, payload: null }), 'E_REQUEST_FORMAT'); });
        test('An array payload is refused even with a valid composition target', function () { rejected(send({ protocolVersion: 1, operation: 'getContext', target: { compId: scratch.id }, payload: [] }), 'E_REQUEST_FORMAT'); });
        test('An empty operation is refused as a malformed request', function () { rejected(send({ protocolVersion: 1, operation: '', target: { compId: scratch.id }, payload: {} }), 'E_REQUEST_FORMAT'); });
        test('An oversized operation is refused as a malformed request', function () {
            var operation = ''; for (var i = 0; i < 129; i++) { operation += 'x'; }
            rejected(send({ protocolVersion: 1, operation: operation, target: { compId: scratch.id }, payload: {} }), 'E_REQUEST_FORMAT');
        });
        test('A normal read-only request remains usable after malformed requests', function () { var response = send({ protocolVersion: 1, operation: 'getContext', target: null, payload: {} }); require(response.ok && response.data.comp.id === scratch.id, 'Normal context request failed'); require(scratch.numLayers === 0, 'Read created a layer'); });
    } catch (e) { report.error = String(e); report.errorLine = e.line; }
    finally {
        try {
            if (scratch) { scratch.remove(); scratch = null; }
            var remaining = []; for (var i = 1; i <= app.project.numItems; i++) { var item = app.project.item(i); if (report.temporary && (item.id === report.temporary.id || item.name === report.temporary.name)) { remaining.push({ id: item.id, name: item.name }); } }
            report.cleanup = { absentByItemScan: remaining.length === 0, remaining: remaining,
                originalItemsAndLayerIdentitiesUnchanged: AEBrowsePlan.same(snapshot(), report.baseline), itemCount: app.project.numItems, projectSaved: false };
            if (previous && previous instanceof CompItem) { previous.openInViewer(); }
        } catch (e) { report.cleanupError = String(e); }
        if (opened) { app.endUndoGroup(); }
        report.passed = 0; report.failed = 0;
        for (i = 0; i < report.tests.length; i++) { if (report.tests[i].passed) { report.passed++; } else { report.failed++; } }
        report.finished = true; report.endedAtMs = new Date().getTime();
        var file = new File(config.reportPath); file.encoding = 'UTF-8'; if (file.open('w')) { try { file.write(JSON.stringify(report, null, 2)); } finally { file.close(); } }
    }
})();
