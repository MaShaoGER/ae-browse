var AEBrowseRoundtrip = (function () {
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function assert(condition, message) { if (!condition) { throw new Error(message); } }
    function test(report, name, body) {
        try { body(); report.results.push({ name: name, passed: true }); }
        catch (error) { report.results.push({ name: name, passed: false, error: String(error), code: error.code || null }); }
    }
    function expectCode(body, code) { var error = null; try { body(); } catch (caught) { error = caught; } assert(error !== null && error.code === code, 'Expected ' + code + ', received ' + (error ? error.code + ': ' + String(error) : 'no error')); }
    function readJSON(filename) { var file = new File(filename); file.encoding = 'UTF-8'; assert(file.open('r'), 'Cannot read config'); var content; try { content = file.read(); } finally { file.close(); } return JSON.parse(content.replace(/^\uFEFF/, '')); }
    function summarize(report) { report.passed = 0; report.failed = 0; for (var i = 0; i < report.results.length; i++) { if (report.results[i].passed) { report.passed++; } else { report.failed++; } } return report; }
    function mutate(loaded, body) { var value = clone(loaded); body(value.asset, value.payload); return value; }
    function property(layer, name) { return layer.property('ADBE Transform Group').property(name); }
    function rectangle(layer) { return layer.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1); }
    function run() {
        var config = readJSON('D:/project/ae-browse/test-results/roundtrip-config.json');
        var report = { runId: config.runId, startedAtMs: new Date().getTime(), aeVersion: app.version, finished: false, phase: 'created', before: { projectItemCount: app.project.numItems, projectPath: app.project.file ? app.project.file.fsName : null }, results: [], temporaryComps: [], config: config };
        var main = null, cases = null;
        try {
            var loaded = AEBrowseNative.load(config.library, 'rounded-card');
            test(report, '从中文与空格目录读取包与图形描述', function () { assert(loaded.asset.id === 'rounded-card' && loaded.payload.nodes.length === 3, 'Package read mismatch'); });
            main = app.project.items.addComp('__AEBrowse_' + config.runId + '_original', 640, 360, 1, 4, 30);
            cases = app.project.items.addComp('__AEBrowse_' + config.runId + '_cases', 640, 360, 1, 4, 30);
            report.temporaryComps.push({ id: main.id, name: main.name }, { id: cases.id, name: cases.name });
            var overrides = { width: 420, height: 240, radius: 34, color: [.2, .5, 1, 1], duration: .8, motion: 'pop' };
            var created = AEBrowseNative.create(main, loaded, overrides, { insertTime: .7, instanceId: config.runId + '-original' });
            report.originalCompId = main.id;
            report.originalLayerId = created.layer.id;
            test(report, '由包参数生成实际可编辑形状', function () { var capture = AEBrowseNative.capture(created.layer); assert(capture.parameters.width === 420 && capture.parameters.height === 240 && capture.parameters.radius === 34, 'Shape readback mismatch'); });
            test(report, '动画关键帧相对插入时间生成', function () { var scale = property(created.layer, 'ADBE Scale'); assert(scale.numKeys === 3 && Math.abs(scale.keyTime(1) - .7) < .00001 && Math.abs(scale.keyTime(3) - 1.5) < .00001, 'Keyframe timing mismatch'); });
            test(report, '效果顺序与基础参数实际读取一致', function () { var capture = AEBrowseNative.capture(created.layer); var effects = capture.observed.effects; assert(effects.length === 2 && effects[0].descriptor.matchName === 'ADBE Gaussian Blur 2' && effects[1].descriptor.matchName === 'ADBE Fill', 'Effect stack mismatch'); assert(effects[0].descriptor.settings[0].value === 8 && effects[1].descriptor.settings[0].value[0] > .99, 'Effect setting mismatch'); });
            var layerId = created.layer.id;
            var beforeAnimation = AEBrowseNative.capture(created.layer).observed.animation;
            test(report, '外观更新保留图层身份与动画', function () { var capture = AEBrowseNative.updateAppearance(created.layer, loaded, { width: 430, radius: 30, color: [.2, .85, .45, 1] }); assert(created.layer.id === layerId && capture.parameters.width === 430 && AEBrowsePlan.same(capture.observed.animation, beforeAnimation), 'Appearance update changed identity or animation'); });
            test(report, '回读实例的外观与效果保存为独立图形包', function () { var exported = AEBrowseNative.exportPack(config.exported, loaded, created.layer); assert(new File(exported.directory + '/pack.json').exists, 'Export manifest missing'); });
            test(report, '已有导出文件不会静默覆盖', function () { expectCode(function () { AEBrowseNative.exportPack(config.exported, loaded, created.layer); }, 'E_EXPORT_EXISTS'); });
            report.originalSnapshot = AEBrowseNative.capture(created.layer);
            var reusable = AEBrowseNative.create(cases, loaded, {}, { insertTime: .5, instanceId: config.runId + '-reusable' });
            test(report, '重复导入同一操作不会生成重复图层', function () { var count = cases.numLayers; var repeated = AEBrowseNative.create(cases, loaded, {}, { insertTime: .5, instanceId: config.runId + '-reusable' }); assert(repeated.reused && repeated.layer.id === reusable.layer.id && cases.numLayers === count, 'Duplicate instance created'); });
            test(report, '同一操作 ID 的不同参数不会覆盖已有实例', function () { var count = cases.numLayers; expectCode(function () { AEBrowseNative.create(cases, loaded, { width: 400 }, { insertTime: .5, instanceId: config.runId + '-reusable' }); }, 'E_INSTANCE_CONFLICT'); assert(cases.numLayers === count, 'Conflict mutated layers'); });
            test(report, '非法尺寸在创建图层前被拒绝', function () { var count = cases.numLayers; expectCode(function () { AEBrowseNative.create(cases, loaded, { width: 0 }, { insertTime: 0 }); }, 'E_PARAMETER_VALUE'); assert(cases.numLayers === count, 'Invalid size created layer'); });
            test(report, '超出合成的动画时长在写入前被拒绝', function () { var count = cases.numLayers; expectCode(function () { AEBrowseNative.create(cases, loaded, { duration: 3 }, { insertTime: 2 }); }, 'E_DURATION_OUTSIDE_COMP'); assert(cases.numLayers === count, 'Invalid timing created layer'); });
            test(report, '无目标合成时给出上下文错误', function () { expectCode(function () { AEBrowseNative.create(null, loaded, {}, {}); }, 'E_NO_ACTIVE_COMP'); });
            test(report, '必需效果缺失在写入前被拒绝', function () { var count = cases.numLayers; var missing = mutate(loaded, function (asset) { asset.effects[0].matchName = 'AEBROWSE_NOT_INSTALLED'; }); expectCode(function () { AEBrowseNative.create(cases, missing, {}, { insertTime: 0 }); }, 'E_EFFECT_MISSING'); assert(cases.numLayers === count, 'Missing dependency left layer'); });
            test(report, '可选效果缺失可降级为真实图形', function () { var optional = mutate(loaded, function (asset) { asset.effects = [{ id: 'missing', matchName: 'AEBROWSE_NOT_INSTALLED', required: false, target: 'output', settings: [] }]; }); var degraded = AEBrowseNative.create(cases, optional, {}, { insertTime: 0 }); assert(degraded.layer.property('ADBE Effect Parade').numProperties === 0 && degraded.diagnostics[0].code === 'W_EFFECT_MISSING', 'Optional effect fallback mismatch'); degraded.layer.remove(); });
            test(report, '必需效果属性写入失败会清理已创建图层', function () { var count = cases.numLayers; var invalid = mutate(loaded, function (asset) { asset.effects[0].settings[0].path[0].matchName = 'AEBROWSE_MISSING_PROPERTY'; }); expectCode(function () { AEBrowseNative.create(cases, invalid, {}, { insertTime: 0 }); }, 'E_EFFECT_PROPERTY_PATH'); assert(cases.numLayers === count, 'Failed effect left partial layer'); });
            test(report, '可选效果属性失配只移除失败效果', function () { var optional = mutate(loaded, function (asset) { asset.effects[0].required = false; asset.effects[0].settings[0].path[0].matchName = 'AEBROWSE_MISSING_PROPERTY'; }); var partial = AEBrowseNative.create(cases, optional, {}, { insertTime: 0 }); assert(partial.layer.property('ADBE Effect Parade').numProperties === 1 && partial.diagnostics[0].code === 'W_EFFECT_SKIPPED', 'Optional effect cleanup mismatch'); partial.layer.remove(); });
            test(report, '锁定图层的更新被拒绝', function () { reusable.layer.locked = true; try { expectCode(function () { AEBrowseNative.updateAppearance(reusable.layer, loaded, { width: 400 }); }, 'E_SELECTION_LOCKED'); } finally { reusable.layer.locked = false; } });
            test(report, '手工修改图形后停止自动更新并保留修改', function () { var radius = rectangle(reusable.layer).property('ADBE Vector Rect Roundness'); var previous = radius.value; radius.setValue(55); try { expectCode(function () { AEBrowseNative.updateAppearance(reusable.layer, loaded, { width: 400 }); }, 'E_INSTANCE_MODIFIED'); assert(radius.value === 55, 'Manual edit overwritten'); } finally { radius.setValue(previous); } });
            test(report, '手工外观关键帧即使当前值相同也被保护', function () { var radius = rectangle(reusable.layer).property('ADBE Vector Rect Roundness'); radius.setValueAtTime(.5, radius.value); try { expectCode(function () { AEBrowseNative.updateAppearance(reusable.layer, loaded, { width: 400 }); }, 'E_INSTANCE_MODIFIED'); } finally { radius.removeKey(1); } });
            test(report, '手工效果关键帧即使当前值相同也被保护', function () { var amount = reusable.layer.property('ADBE Effect Parade').property(1).property(1); amount.setValueAtTime(.5, amount.value); try { expectCode(function () { AEBrowseNative.updateAppearance(reusable.layer, loaded, { width: 400 }); }, 'E_INSTANCE_MODIFIED'); } finally { amount.removeKey(1); } });
            test(report, '修改缓动也会被识别为手工修改', function () { var scale = property(reusable.layer, 'ADBE Scale'); scale.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); var ease = [new KeyframeEase(0, 70), new KeyframeEase(0, 70), new KeyframeEase(0, 70)]; scale.setTemporalEaseAtKey(1, ease, ease); expectCode(function () { AEBrowseNative.exportPack(config.root + '/manual-ease-export', loaded, reusable.layer); }, 'E_INSTANCE_MODIFIED'); });
            for (var motionIndex = 0; motionIndex < 3; motionIndex++) {
                var motion = ['none', 'slide', 'fade'][motionIndex];
                test(report, '实际生成动画模式：' + motion, function () { var result = AEBrowseNative.create(cases, loaded, { motion: motion }, { insertTime: .25 }); var expected = motion === 'none' ? 0 : 2; var channel = 'ADBE Scale'; if (motion === 'fade') { channel = 'ADBE Opacity'; } else if (motion === 'slide') { channel = 'ADBE Position'; } assert(property(result.layer, channel).numKeys === expected, 'Animation mode mismatch'); cases.time = 1.5; assert(!AEBrowseNative.capture(result.layer).modified, 'Playback time falsely detected as edit'); result.layer.remove(); });
            }
            cases.remove(); report.casesCompRemoved = true;
        } catch (fatal) { report.fatal = { message: String(fatal), code: fatal.code || null }; }
        report.finishedAtMs = new Date().getTime();
        return summarize(report);
    }
    function recreate(report) {
        var loaded = AEBrowseNative.load(report.config.copied, 'rounded-card');
        var restored = app.project.items.addComp('__AEBrowse_' + report.runId + '_restored', 640, 360, 1, 4, 30);
        report.temporaryComps.push({ id: restored.id, name: restored.name });
        var result = AEBrowseNative.create(restored, loaded, {}, { insertTime: .7, instanceId: report.runId + '-restored' });
        report.restoredCompId = restored.id; report.restoredLayerId = result.layer.id;
        report.restoredSnapshot = AEBrowseNative.capture(result.layer);
        test(report, '复制导出的包可再次读取并生成原生图形', function () { assert(report.restoredSnapshot.parameters.width === 430 && report.restoredSnapshot.parameters.radius === 30, 'Restored parameters mismatch'); });
        test(report, '往返前后参数与动画效果数据一致', function () { assert(AEBrowsePlan.same(report.originalSnapshot.parameters, report.restoredSnapshot.parameters) && AEBrowsePlan.same(report.originalSnapshot.observed, report.restoredSnapshot.observed), 'Round-trip semantic mismatch'); });
        var portrait = app.project.items.addComp('__AEBrowse_' + report.runId + '_portrait', 360, 640, 1, 4, 25);
        report.temporaryComps.push({ id: portrait.id, name: portrait.name });
        test(report, '换合成尺寸和帧率后仍按新合成中心定位', function () { var portraitInstance = AEBrowseNative.create(portrait, loaded, {}, { insertTime: .4, instanceId: report.runId + '-portrait' }); var position = property(portraitInstance.layer, 'ADBE Position').value; assert(position[0] === 180 && position[1] === 320 && Math.abs(property(portraitInstance.layer, 'ADBE Scale').keyTime(1) - .4) < .00001, 'Relative location or timing mismatch'); });
        portrait.remove(); report.portraitCompRemoved = true;
        report.phase = 'restored';
        return summarize(report);
    }
    return { run: run, recreate: recreate };
})();
