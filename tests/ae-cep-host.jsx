/* Explicit live AE test. Include built host source in the same evaluation when using an isolated MCP script scope.
   No evalFile, save, project reopen, Undo, or user-item removal occurs here. */
(function () {
    var config = null, scratch = null, scratchId = null, beforeActive = null, requestSequence = 0;
    var started = new Date().getTime();
    var report = { schemaVersion: 1, finished: false, runId: null, aeVersion: String(app.version),
        startedAt: iso(started), startedAtMs: started, tests: [],
        scope: 'Actual AE properties through built AEBrowseHost.dispatch; no rendered pixel checks.',
        cleanup: { attempted: false, removed: false, absentByItemScan: false, baselineUnchanged: false },
        undoGroups: { directlyObserved: false, note: 'AE exposes no undo-group-depth query. Real failure recovery is checked without executing Undo or replacing app methods.' },
        persistence: { written: false } };
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z'; }
    function require(value, message) { if (!value) { throw new Error(message); } }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function clone(value) { return AEBrowseJSON.parse(AEBrowseJSON.stringify(value)); }
    function same(a, b) { return AEBrowsePlan.same(a, b); }
    function test(name, body) {
        var result = { name: name, passed: false, scope: 'live AE property test' };
        try { var detail = body(); result.passed = true; if (detail !== undefined) { result.details = detail; } }
        catch (error) { result.error = String(error.message || error); if (error.code) { result.code = error.code; } }
        report.tests.push(result);
        return result.passed;
    }
    function skip(name, reason) { report.tests.push({ name: name, passed: null, skipped: true, reason: reason, scope: 'live AE property test' }); }
    function snapshot() {
        var result = { itemCount: app.project.numItems, items: [], projectFile: app.project.file ? app.project.file.fsName : null };
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i), entry = { id: item.id, name: String(item.name), isComp: item instanceof CompItem };
            if (entry.isComp) {
                entry.layerCount = item.numLayers; entry.layers = [];
                for (var j = 1; j <= item.numLayers; j++) { var layer = item.layer(j); entry.layers.push({ id: layer.id, name: String(layer.name) }); }
            }
            result.items.push(entry);
        }
        return result;
    }
    function itemPresent(id) { for (var i = 1; i <= app.project.numItems; i++) { if (app.project.item(i).id === id) { return true; } } return false; }
    function layerIds(comp) { var result = []; for (var i = 1; i <= comp.numLayers; i++) { result.push(comp.layer(i).id); } return result; }
    function tempName(value) { app.beginUndoGroup('AE Browse test name'); try { scratch.name = value; } finally { app.endUndoGroup(); } }
    function request(operation, target, payload, operationId) {
        var value = { protocolVersion: 1, requestId: config.runId + '-request-' + (++requestSequence), operation: operation, target: target, payload: payload || {} };
        if (operationId) { value.operationId = operationId; }
        var raw = AEBrowseHost.dispatch(AEBrowseJSON.stringify(value));
        var response = AEBrowseJSON.parse(raw);
        require(response.requestId === value.requestId && response.protocolVersion === 1, 'Response identity or protocol mismatch');
        require(typeof response.timing.hostMs === 'number' && response.timing.hostMs >= 0, 'Host timing invalid');
        return response;
    }
    function create(operationId, parameters, loaded, targetId) {
        return request('instantiateAsset', { compId: targetId === undefined ? scratch.id : targetId },
            { loaded: loaded || config.loaded, parameters: parameters || config.parameters, insertTime: config.insertTime }, operationId);
    }
    function success(response) { require(response.ok === true, 'Dispatch failed: ' + AEBrowseJSON.stringify(response.diagnostics)); return response.data; }
    function rejected(response, code) {
        require(response.ok === false && response.data === null, 'Expected rejected dispatch');
        var found = false;
        for (var i = 0; i < response.diagnostics.length; i++) { if (response.diagnostics[i].code === code) { found = true; } }
        require(found, 'Expected ' + code + ': ' + AEBrowseJSON.stringify(response.diagnostics));
        return response.diagnostics;
    }
    function channel(data, name) { for (var i = 0; i < data.observed.animation.length; i++) { if (data.observed.animation[i].channel === name) { return data.observed.animation[i]; } } throw new Error('Animation channel missing: ' + name); }
    function checkMotion(data, motion) {
        var scale = channel(data, 'ADBE Scale'), position = channel(data, 'ADBE Position'), opacity = channel(data, 'ADBE Opacity');
        var expected = { pop: { scale: 3, position: 0, opacity: 0 }, slide: { scale: 0, position: 2, opacity: 0 }, fade: { scale: 0, position: 0, opacity: 2 }, none: { scale: 0, position: 0, opacity: 0 } }[motion];
        require(scale.keys.length === expected.scale && position.keys.length === expected.position && opacity.keys.length === expected.opacity, 'Unexpected animation channel/key counts');
        var animated = opacity;
        if (motion === 'pop') { animated = scale; }
        else if (motion === 'slide') { animated = position; }
        if (motion !== 'none') { require(Math.abs(animated.keys[0].time) < .000001 && Math.abs(animated.keys[animated.keys.length - 1].time - config.parameters.duration) < .000001, 'Animation times differ from insertion-relative duration'); }
        if (motion === 'pop') { require(scale.keys[0].value[0] === 0 && scale.keys[1].value[0] === 108 && scale.keys[2].value[0] === 100, 'Pop scale values differ'); }
        if (motion === 'slide') {
            var first = position.keys[0].value, last = position.keys[1].value;
            require(same([first[0], first[1]], [config.comp.width / 2, config.comp.height / 2 + 64]) && same([last[0], last[1]], [config.comp.width / 2, config.comp.height / 2]), 'Slide positions differ');
            require((first.length === 2 || first.length === 3 && first[2] === 0) && (last.length === 2 || last.length === 3 && last[2] === 0), 'Unexpected Position depth');
        }
        if (motion === 'fade') { require(opacity.keys[0].value === 0 && opacity.keys[1].value === 100, 'Fade opacity values differ'); }
        require(data.modified === false, 'New native instance is already marked modified');
    }
    function replaceAsset(loaded) { loaded.manifest.assets = [clone(loaded.asset)]; return loaded; }
    try {
        require(typeof AEBrowseHost === 'object' && typeof AEBrowseHost.dispatch === 'function', 'Load built dist/AE Browse/jsx/host.jsx separately before this harness');
        var file = new File('D:/project/ae-browse/test-results/cep-host-config.json');
        file.encoding = 'UTF-8'; require(file.open('r'), 'Cannot open prepared configuration');
        var content;
        try { content = file.read(); } finally { file.close(); }
        config = AEBrowseJSON.parse(content.replace(/^\uFEFF/, ''));
        require(config.schemaVersion === 1 && typeof config.runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(config.runId), 'Invalid test run identity');
        require(config.phase === 'full', 'This harness requires phase=full for guaranteed automatic cleanup');
        require(config.tempCompName === '__AE_BROWSE_CEP_TEST_' + config.runId, 'Unexpected temporary composition name');
        require(config.loaded.manifest.assets.length === 1 && config.loaded.manifest.assets[0].id === config.loaded.asset.id, 'Configuration must contain only the selected asset');
        report.runId = config.runId; report.builtHost = config.builtHost; report.preparationHostSource = config.preparationHostSource;
        report.reportFile = config.reportFile;
        beforeActive = app.project.activeItem;
        report.before = snapshot(); report.before.activeCompId = beforeActive instanceof CompItem ? beforeActive.id : null;
        // Unique names prevent accidentally using an earlier test's item.
        for (var existingIndex = 1; existingIndex <= app.project.numItems; existingIndex++) { require(app.project.item(existingIndex).name !== config.tempCompName, 'Temporary composition name already exists; prepare a new run'); }
        test('只读宿主信息与当前上下文', function () {
            var info = success(request('getHostInfo', null, {})), context = success(request('getContext', null, {}));
            require(String(info.aeVersion) === String(app.version), 'Host version mismatch');
            require(info.supportedKinds.length === 1 && info.supportedKinds[0] === 'ae.nativeShape', 'Unexpected kind capability');
            require(context.activeComp === (beforeActive instanceof CompItem), 'Baseline context mismatch');
            require(same(snapshot(), { itemCount: report.before.itemCount, items: report.before.items, projectFile: report.before.projectFile }), 'Read-only dispatch changed baseline items');
            report.hostInfo = info; report.initialContext = context;
            return { capabilities: info.capabilities, effectsCount: info.effects.length };
        });
        if (!(beforeActive instanceof CompItem)) {
            test('没有活动合成时创建请求提前停止', function () { var diagnostics = rejected(request('instantiateAsset', { compId: 1 }, { loaded: config.loaded, parameters: config.parameters, insertTime: config.insertTime }, config.runId + '-inactive'), 'E_NO_ACTIVE_COMP'); require(app.project.numItems === report.before.itemCount, 'No-active-comp guard created items'); return diagnostics; });
        } else { skip('没有活动合成时创建请求提前停止', 'User already has an active composition; it is not closed to force this branch.'); }
        app.beginUndoGroup('AE Browse test composition');
        try {
            scratch = app.project.items.addComp(config.tempCompName, config.comp.width, config.comp.height, 1, config.comp.duration, config.comp.frameRate);
            scratchId = scratch.id; report.tempComp = { id: scratchId, name: String(scratch.name) };
            scratch.time = config.insertTime; scratch.openInViewer();
        } finally { app.endUndoGroup(); }
        test('中文合成名称与特殊字符通过正式 JSON 编解码', function () {
            tempName(config.tempCompName + ' 中文验证');
            var context = success(request('getContext', null, {}));
            require(context.comp.id === scratchId && context.comp.name === scratch.name, 'Chinese composition name lost in dispatcher JSON');
            var probe = { message: config.unicodeProbe, key: '中文' };
            require(same(AEBrowseJSON.parse(AEBrowseJSON.stringify(probe)), probe), 'Unicode/control JSON roundtrip failed');
            tempName(config.tempCompName);
            return { returnedName: context.comp.name, probe: probe.message };
        });
        test('目标合成 ID 不匹配时停止且不添加图层', function () { var before = layerIds(scratch), diagnostics = rejected(create(config.runId + '-wrong-target', config.parameters, null, scratchId + 1), 'E_CONTEXT_CHANGED'); require(same(layerIds(scratch), before), 'Changed-target guard changed layers'); return diagnostics; });
        test('无效参数在创建图层前停止', function () { var parameters = clone(config.parameters); parameters.width = 0; var before = layerIds(scratch), diagnostics = rejected(create(config.runId + '-bad-parameters', parameters), 'E_PARAMETER_VALUE'); require(same(layerIds(scratch), before), 'Invalid-parameter guard changed layers'); return diagnostics; });
        test('缺失必需效果在创建前停止', function () {
            var loaded = clone(config.loaded); loaded.asset.effects = [{ id: 'missing-required', matchName: 'AE_BROWSE_NOT_INSTALLED_EFFECT_' + config.runId, target: 'output', required: true, settings: [] }]; replaceAsset(loaded);
            var before = layerIds(scratch), diagnostics = rejected(create(config.runId + '-missing-effect', config.parameters, loaded), 'E_EFFECT_MISSING'); require(same(layerIds(scratch), before), 'Missing-effect preflight changed layers'); return diagnostics;
        });
        var mainData = null, mainOperation = config.runId + '-main';
        test('原生形状实际尺寸、圆角、颜色和 pop 关键帧回读', function () {
            mainData = success(create(mainOperation));
            require(mainData.compId === scratchId && mainData.instanceId === mainOperation && mainData.reused === false && scratch.numLayers === 1, 'Created identity/count mismatch');
            require(same(mainData.parameters, config.parameters), 'Actual parameter readback mismatch');
            require(same(mainData.observed.size, [config.parameters.width, config.parameters.height]) && same(mainData.observed.radius, config.parameters.radius) && same(mainData.observed.color, config.parameters.color), 'Actual shape property mismatch');
            checkMotion(mainData, 'pop'); report.createdInstance = mainData; return mainData;
        });
        if (mainData) {
            test('readInstance 按真实图层 ID 回读且不修改图层', function () { var before = layerIds(scratch), read = success(request('readInstance', { compId: scratchId, layerId: mainData.layerId, instanceId: mainOperation }, {})); require(same(read.observed, mainData.observed) && same(read.parameters, config.parameters), 'readInstance properties differ'); require(same(layerIds(scratch), before), 'Readback changed layers'); return read; });
            test('同一操作 ID 的相同请求复用同一图层', function () { var before = layerIds(scratch), reused = success(create(mainOperation)); require(reused.layerId === mainData.layerId && reused.reused === true && same(layerIds(scratch), before), 'Retry added layer or changed identity'); return { layerId: reused.layerId, reused: reused.reused, layerCount: scratch.numLayers }; });
            test('同一操作 ID 的不同参数冲突且不覆盖已有实例', function () { var parameters = clone(config.parameters); parameters.width += 10; var before = layerIds(scratch), diagnostics = rejected(create(mainOperation, parameters), 'E_INSTANCE_CONFLICT'); require(same(layerIds(scratch), before), 'Conflicting operation changed layer list'); var read = success(request('readInstance', { compId: scratchId, layerId: mainData.layerId, instanceId: mainOperation }, {})); require(same(read.parameters, config.parameters) && same(read.observed, mainData.observed), 'Conflict overwrote original instance'); return diagnostics; });
        } else { skip('实例重复与冲突检查', 'Initial native creation failed; no original instance exists.'); }
        var motions = ['slide', 'fade', 'none'];
        for (var motionIndex = 0; motionIndex < motions.length; motionIndex++) {
            (function (motion) { test(motion + ' 动画通道与关键帧实际回读', function () { var parameters = clone(config.parameters); parameters.motion = motion; var count = scratch.numLayers, data = success(create(config.runId + '-motion-' + motion, parameters)); require(scratch.numLayers === count + 1, 'Motion create did not add exactly one layer'); checkMotion(data, motion); return data.observed.animation; }); })(motions[motionIndex]);
        }
        var availableEffect = null, actualInfo = success(request('getHostInfo', null, {}));
        for (var effectIndex = 0; effectIndex < actualInfo.effects.length; effectIndex++) { if (actualInfo.effects[effectIndex].matchName === 'ADBE Gaussian Blur 2' || actualInfo.effects[effectIndex].matchName === 'ADBE Fill') { availableEffect = actualInfo.effects[effectIndex].matchName; break; } }
        if (availableEffect) {
            test('必需效果属性写入失败后清理本次新建图层', function () {
                var loaded = clone(config.loaded); loaded.asset.effects = [{ id: 'bad-required-path', matchName: availableEffect, target: 'output', required: true, settings: [{ path: [{ matchName: 'AE_BROWSE_MISSING_PROPERTY_' + config.runId, occurrence: 1 }], valueType: 'number', value: 8 }] }]; replaceAsset(loaded);
                var before = layerIds(scratch), diagnostics = rejected(create(config.runId + '-effect-write-failure', config.parameters, loaded), 'E_EFFECT_PROPERTY_PATH');
                require(same(layerIds(scratch), before), 'Post-write failure left a new layer or removed an earlier layer');
                for (var i = 0; i < diagnostics.length; i++) { require(diagnostics[i].code !== 'E_CLEANUP_FAILED', 'Dispatcher could not verify cleanup'); }
                report.undoGroups.failurePathReached = true; report.cleanup.postWriteFailureLayerIdsUnchanged = true;
                return { effect: availableEffect, diagnostics: diagnostics, retainedLayerIds: before };
            });
            test('失败清理后正式入口仍能再次创建与回读', function () { var count = scratch.numLayers, data = success(create(config.runId + '-after-failure')); require(scratch.numLayers === count + 1 && data.modified === false, 'Dispatcher did not recover after failure'); report.undoGroups.subsequentDispatchSucceeded = true; return { layerId: data.layerId, layerCount: scratch.numLayers }; });
        } else { skip('必需效果属性写入失败与清理', 'Neither Gaussian Blur nor Fill is installed; required missing-effect preflight remains covered.'); }
        report.testLayerIds = layerIds(scratch);
    } catch (fatal) { report.fatal = String(fatal.message || fatal); if (fatal.code) { report.fatalCode = fatal.code; } }
    finally {
        if (scratch !== null) {
            report.cleanup.attempted = true;
            app.beginUndoGroup('AE Browse test cleanup');
            try { scratch.remove(); report.cleanup.removed = true; } catch (removeError) { report.cleanup.error = String(removeError.message || removeError); }
            finally { app.endUndoGroup(); }
            // itemByID can throw after deletion on current AE builds. Scan instead.
            try { report.cleanup.absentByItemScan = !itemPresent(scratchId); } catch (scanError) { report.cleanup.scanError = String(scanError.message || scanError); }
        }
        if (beforeActive instanceof CompItem) { try { beforeActive.openInViewer(); report.cleanup.priorCompViewerRestored = true; } catch (restoreError) { report.cleanup.viewerRestoreError = String(restoreError.message || restoreError); } }
        if (report.before) {
            try {
                report.after = snapshot();
                report.cleanup.baselineUnchanged = same(report.after, { itemCount: report.before.itemCount, items: report.before.items, projectFile: report.before.projectFile });
                test('清理后项目 item 扫描确认临时合成消失且原合成图层不变', function () { require(report.cleanup.removed && report.cleanup.absentByItemScan && report.cleanup.baselineUnchanged, 'Cleanup or baseline item/layer comparison failed'); return report.cleanup; });
            } catch (afterError) { report.cleanup.afterReadError = String(afterError.message || afterError); }
        }
    }
    report.passed = 0; report.failed = 0; report.skipped = 0;
    for (var resultIndex = 0; resultIndex < report.tests.length; resultIndex++) { var result = report.tests[resultIndex]; if (result.skipped) { report.skipped++; } else if (result.passed) { report.passed++; } else { report.failed++; } }
    if (report.fatal) { report.failed++; }
    report.finished = true; report.endedAtMs = new Date().getTime(); report.endedAt = iso(report.endedAtMs);
    report.ok = report.failed === 0 && report.cleanup.removed && report.cleanup.absentByItemScan && report.cleanup.baselineUnchanged;
    if (config && typeof config.reportFile === 'string') {
        var output = new File(config.reportFile); output.encoding = 'UTF-8';
        try {
            require(output.open('w'), 'Cannot open unique run report'); report.persistence.written = true;
            require(output.write(AEBrowseJSON.stringify(report, null, 2)), 'Cannot write unique run report');
        } catch (writeError) { report.persistence.written = false; report.persistence.error = String(writeError.message || writeError); report.ok = false; }
        finally { try { output.close(); } catch (_) {} }
    }
    return AEBrowseJSON.stringify(report);
})();
