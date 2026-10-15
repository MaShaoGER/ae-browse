(function () {
    var beforeActive = app.project.activeItem;
    var report = { finished: false, aeVersion: app.version, startedAtMs: new Date().getTime(), before: { projectItemCount: app.project.numItems, activeCompId: beforeActive instanceof CompItem ? beforeActive.id : null }, results: [], effectProperties: [] };
    var scratch = null;
    function check(name, body) {
        try { body(); report.results.push({ name: name, passed: true }); }
        catch (error) { report.results.push({ name: name, passed: false, error: String(error) }); }
    }
    function require(condition, message) { if (!condition) { throw new Error(message); } }
    try {
        scratch = app.project.items.addComp('__AE_Browse_Boundary_' + report.startedAtMs, 640, 360, 1, 3, 30);
        report.compId = scratch.id;
        report.compName = scratch.name;
        var layer = scratch.layers.addShape();
        layer.name = 'AE Browse Boundary Card';
        var vectors = layer.property('ADBE Root Vectors Group');
        var group = vectors.addProperty('ADBE Vector Group');
        var groupIndex = group.propertyIndex;
        var contents = group.property('ADBE Vectors Group');
        var rectangle = contents.addProperty('ADBE Vector Shape - Rect');
        var rectangleIndex = rectangle.propertyIndex;
        var fill = contents.addProperty('ADBE Vector Graphic - Fill');
        var fillIndex = fill.propertyIndex;
        contents = layer.property('ADBE Root Vectors Group').property(groupIndex).property('ADBE Vectors Group');
        rectangle = contents.property(rectangleIndex);
        fill = contents.property(fillIndex);
        rectangle.property('ADBE Vector Rect Size').setValue([220, 120]);
        rectangle.property('ADBE Vector Rect Roundness').setValue(24);
        fill.property('ADBE Vector Fill Color').setValue([0.2, 0.5, 1, 1]);
        layer.property('ADBE Transform Group').property('ADBE Position').setValue([320, 180]);
        check('创建原生形状并读取尺寸与圆角', function () { require(rectangle.property('ADBE Vector Rect Size').value[0] === 220 && rectangle.property('ADBE Vector Rect Roundness').value === 24, 'Shape value mismatch'); });
        check('添加属性后重新取得引用仍可设置填充', function () { require(fill.property('ADBE Vector Fill Color').value[2] > 0.99, 'Fill value mismatch'); });
        var scale = layer.property('ADBE Transform Group').property('ADBE Scale');
        var initialScale = scale.value;
        initialScale[0] = 0; initialScale[1] = 0;
        scale.setValueAtTime(0, initialScale);
        var finalScale = scale.value;
        finalScale[0] = 100; finalScale[1] = 100;
        scale.setValueAtTime(0.6, finalScale);
        check('写入可编辑动画关键帧并读取实际值', function () { require(scale.numKeys === 2 && scale.keyValue(2)[0] === 100, 'Animation keyframe mismatch'); });
        check('已有关键帧的属性不能直接用静态 setValue 覆盖', function () { var rejected = false; try { scale.setValue(finalScale); } catch (_) { rejected = true; } require(rejected, 'Expected setValue to reject keyed property'); });
        var effects = layer.property('ADBE Effect Parade');
        check('本机允许给图层添加高斯模糊', function () { require(effects.canAddProperty('ADBE Gaussian Blur 2'), 'Gaussian Blur not addable'); });
        var blur = effects.addProperty('ADBE Gaussian Blur 2');
        var blurIndex = blur.propertyIndex;
        effects = layer.property('ADBE Effect Parade');
        var tint = effects.addProperty('ADBE Fill');
        var tintIndex = tint.propertyIndex;
        effects = layer.property('ADBE Effect Parade');
        blur = effects.property(blurIndex);
        tint = effects.property(tintIndex);
        var amount = blur.property('ADBE Gaussian Blur 2-0001');
        if (!amount) { amount = blur.property(1); }
        amount.setValue(12);
        check('按内部属性路径设置效果数值并读取确认', function () { require(amount.value === 12, 'Blur value mismatch'); });
        check('同时添加多个效果后重新取得引用', function () { require(blur.matchName === 'ADBE Gaussian Blur 2' && tint.matchName === 'ADBE Fill', 'Effect references mismatch'); });
        var tintColor = null;
        for (var i = 1; i <= tint.numProperties; i++) { if (tint.property(i).propertyValueType === PropertyValueType.COLOR) { tintColor = tint.property(i); break; } }
        check('为效果颜色参数写入基础颜色值', function () { require(tintColor !== null, 'Fill color property unavailable'); var color = tintColor.value; color[0] = 1; color[1] = 0.6; color[2] = 0.1; tintColor.setValue(color); require(tintColor.value[0] > 0.99, 'Effect color mismatch'); });
        check('缺失效果能够在添加前检测', function () { require(!effects.canAddProperty('AE_BROWSE_NOT_INSTALLED_EFFECT'), 'Missing effect unexpectedly addable'); });
        check('添加不存在的效果会报错并可被捕获', function () { var rejected = false; try { effects.addProperty('AE_BROWSE_NOT_INSTALLED_EFFECT'); } catch (_) { rejected = true; } require(rejected, 'Missing effect should be rejected'); });
        effects = layer.property('ADBE Effect Parade');
        blur = effects.property(blurIndex); tint = effects.property(tintIndex);
        check('不存在的效果属性路径不会写入其他参数', function () { require(blur.property('AE_BROWSE_MISSING_PROPERTY') === null, 'Missing property should resolve to null'); });
        for (i = 1; i <= blur.numProperties; i++) { report.effectProperties.push({ effect: blur.matchName, index: i, matchName: blur.property(i).matchName, displayName: blur.property(i).name, valueType: String(blur.property(i).propertyValueType) }); }
        blur.enabled = false; tint.enabled = false;
        report.layerId = layer.id;
        report.blurIndex = blurIndex;
        report.tintIndex = tintIndex;
        report.previewTime = 0.6;
        check('执行过程中保持用户原合成不变', function () { var active = app.project.activeItem; require(active instanceof CompItem && active.id === report.before.activeCompId, 'Active user comp changed'); });
    } catch (fatal) {
        report.fatal = String(fatal);
        if (scratch) { scratch.remove(); report.compId = null; report.cleanupAfterFailure = true; }
    }
    report.passed = 0; report.failed = 0;
    for (var n = 0; n < report.results.length; n++) { if (report.results[n].passed) { report.passed++; } else { report.failed++; } }
    report.finished = true;
    report.finishedAtMs = new Date().getTime();
    return JSON.stringify(report);
})();
