/* Explicit live AE property test; caller supplies AEBrowseShapesConfig and the built host.
   Keeps one named temporary comp only for separate pixel capture; cleanup is mandatory afterward. */
(function () {
    var config = AEBrowseShapesConfig, scratch = null, opened = false;
    var report = { runId: config.runId, builtHostSha256: config.builtHostSha256, aeVersion: app.version, startedAtMs: new Date().getTime(), finished: false, scope: 'Actual AE geometry and animation properties; separate rendered checks follow.', tests: [], temporary: null, baseline: [], beforeActiveId: app.project.activeItem ? app.project.activeItem.id : null, projectFile: app.project.file ? app.project.file.fsName : null };
    function require(value, message) { if (!value) { throw new Error(message); } }
    function test(name, fn, keepLayers) {
        var count = scratch ? scratch.numLayers : 0, passed = false;
        try { fn(); passed = true; report.tests.push({ name: name, passed: true }); }
        catch (e) { report.tests.push({ name: name, passed: false, error: String(e), line: e.line }); }
        finally { if (scratch && !(passed && keepLayers)) { while (scratch.numLayers > count) { scratch.layer(1).remove(); } } }
    }
    function write() { var file = new File(config.reportPath); file.encoding = 'UTF-8'; require(file.open('w'), 'Cannot open report'); try { file.write(JSON.stringify(report, null, 2)); } finally { file.close(); } }
    function snapshot() {
        var items = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i), item = { id: it.id, name: it.name };
            if (it instanceof CompItem) { item.layers = []; for (var j = 1; j <= it.numLayers; j++) { item.layers.push({ id: it.layer(j).id, name: it.layer(j).name }); } }
            items.push(item);
        }
        return items;
    }
    function request(source, parameters, operationId) {
        return JSON.parse(AEBrowseHost.dispatch(JSON.stringify({ protocolVersion: 1, requestId: operationId + '-request', operation: 'instantiateAsset', operationId: operationId, target: { compId: scratch.id }, payload: { loaded: source, parameters: parameters, insertTime: .25 } })));
    }
    function layerById(id) { for (var i = 1; i <= scratch.numLayers; i++) { if (scratch.layer(i).id === id) { return scratch.layer(i); } } throw new Error('Created layer missing'); }
    function channel(data, name) { for (var i = 0; i < data.observed.animation.length; i++) { if (data.observed.animation[i].channel === name) { return data.observed.animation[i]; } } throw new Error('Channel missing'); }
    app.beginUndoGroup('AE Browse basic shapes temporary test'); opened = true;
    try {
        report.baseline = snapshot();
        scratch = app.project.items.addComp(config.tempName, 960, 640, 1, 3, 30);
        scratch.openInViewer();
        report.temporary = { id: scratch.id, name: scratch.name };
        var motions = ['none', 'pop', 'slide', 'fade'];
        for (var a = 0; a < config.sources.length; a++) {
            var source = config.sources[a];
            for (var m = 0; m < motions.length; m++) {
                test(source.asset.id + ' / ' + motions[m] + ' creates and reads native properties', function () {
                    var parameters = { motion: motions[m], duration: .6 }, operationId = config.runId + '-' + a + '-' + m;
                    var response = request(source, parameters, operationId);
                    require(response.ok, JSON.stringify(response.diagnostics));
                    var data = response.data, layer = layerById(data.layerId);
                    require(data.modified === false, 'Fresh shape differs from baseline');
                    var node = source.payload.nodes[1], observed = data.observed;
                    var metadata = JSON.parse(layer.comment.substring('AEBrowse:'.length));
                    var shape = layer.property('ADBE Root Vectors Group').property(metadata.groupIndex).property('ADBE Vectors Group').property(metadata.shapeIndex);
                    if (node.type === 'ellipse') {
                        require(shape.matchName === 'ADBE Vector Shape - Ellipse', 'Wrong native ellipse primitive');
                        if (source.asset.id === 'circle') { require(AEBrowsePlan.same(observed.size, [180,180]), 'Circle dimensions'); }
                        else { require(AEBrowsePlan.same(observed.size, [260,150]), 'Ellipse dimensions'); }
                    } else if (node.type === 'polygon' || node.type === 'star') {
                        require(shape.matchName === 'ADBE Vector Shape - Star', 'Wrong native polystar primitive');
                        require(observed.polystarType === (node.type === 'star' ? 1 : 2), 'Wrong native star/polygon mode');
                        // ExtendScript on the tested AE build associates an unparenthesized nested ternary differently from Node.
                        var points = 5;
                        if (source.asset.id === 'triangle') { points = 3; }
                        else if (source.asset.id === 'hexagon') { points = 6; }
                        require(observed.points === points && observed.outerRadius === 110 && observed.rotation === 0, 'Radial geometry mismatch: ' + JSON.stringify({ expectedPoints: points, points: observed.points, outerRadius: observed.outerRadius, rotation: observed.rotation }));
                        if (node.type === 'star') { require(observed.innerRadius === 50, 'Star inner radius'); }
                    } else { require(shape.matchName === 'ADBE Vector Shape - Rect' && AEBrowsePlan.same(observed.size, [320,180]) && observed.radius === 24, 'Rectangle regression'); }
                    var color = null;
                    for (var p = 0; p < source.asset.parameters.length; p++) { if (source.asset.parameters[p].id === 'color') { color = source.asset.parameters[p].default; } }
                    require(AEBrowsePlan.same(observed.color, color), 'Native fill mismatch');
                    var counts = { none: [0,0,0], pop: [3,0,0], slide: [0,2,0], fade: [0,0,2] }[motions[m]];
                    var channels = ['ADBE Scale','ADBE Position','ADBE Opacity'];
                    for (var c = 0; c < channels.length; c++) {
                        var keys = channel(data, channels[c]).keys; require(keys.length === counts[c], 'Wrong animation channel/count');
                        if (keys.length) { require(Math.abs(keys[0].time) < .00001 && Math.abs(keys[keys.length-1].time - .6) < .00001, 'Wrong relative animation timing'); }
                    }
                    var repeat = request(source, parameters, operationId); require(repeat.ok && repeat.data.layerId === data.layerId, 'Duplicate operation created twice');
                    layer.remove();
                });
            }
        }
        test('Invalid star geometry stops before any layer creation', function () {
            var count = scratch.numLayers, response = request(config.sources[5], { innerRadius: 200 }, config.runId + '-invalid');
            require(!response.ok && scratch.numLayers === count, 'Invalid star created a partial layer');
        });
        test('Six shapes can coexist as native editable layers', function () {
            for (var i = 0; i < config.sources.length; i++) {
                var source = config.sources[i], parameters = { motion: 'pop', duration: .6 };
                if (i === 0) { parameters.width = 240; parameters.height = 140; }
                var response = request(source, parameters, config.runId + '-render-' + i); require(response.ok, JSON.stringify(response.diagnostics));
                var layer = layerById(response.data.layerId); layer.property('ADBE Transform Group').property('ADBE Position').setValue([160 + (i % 3) * 320, 160 + Math.floor(i / 3) * 320]);
            }
            require(scratch.numLayers === 6, 'Unexpected render layer count');
        }, true);
        report.passed = 0; report.failed = 0;
        for (var t = 0; t < report.tests.length; t++) { if (report.tests[t].passed) { report.passed++; } else { report.failed++; } }
        report.finished = true; report.awaitingPixelCaptureAndCleanup = true;
    } catch (error) { report.error = String(error); report.errorLine = error.line; }
    finally { if (opened) { app.endUndoGroup(); } write(); }
    return JSON.stringify(report);
})();
