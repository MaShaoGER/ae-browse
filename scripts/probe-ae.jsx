/* Read-only host inventory. Does not add layers, import files, change selection or save the project. */
(function () {
    var started = new Date().getTime();
    var outputDirectory = new Folder(new File($.fileName).parent.parent.fsName + '/test-results');
    if (!outputDirectory.exists && !outputDirectory.create()) { throw new Error('Cannot create the boundary report directory.'); }
    var reportFile = new File(outputDirectory.fsName + '/ae-host.json');
    function quote(s) {
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    }
    function stringify(v) {
        var parts = [], i, key;
        if (v === null) { return 'null'; }
        if (typeof v === 'string') { return quote(v); }
        if (typeof v === 'number' || typeof v === 'boolean') { return String(v); }
        if (v instanceof Array) { for (i = 0; i < v.length; i++) { parts.push(stringify(v[i])); } return '[' + parts.join(',') + ']'; }
        for (key in v) { if (v.hasOwnProperty(key)) { parts.push(quote(key) + ':' + stringify(v[key])); } }
        return '{' + parts.join(',') + '}';
    }
    var report = { probeVersion: 1, mode: 'read-only', startedAtMs: started, aeVersion: app.version, aeBuild: app.buildNumber, isoLanguage: app.isoLanguage, finished: false, effects: [] };
    try {
        var list = app.effects;
        for (var i = 0; i < list.length; i++) {
            report.effects.push({ matchName: list[i].matchName, displayName: list[i].displayName, version: list[i].version });
        }
        var active = app.project ? app.project.activeItem : null;
        report.activeComp = active !== null && active instanceof CompItem;
        report.selectionCount = report.activeComp ? active.selectedLayers.length : 0;
        report.writableSelection = false;
        if (report.activeComp) {
            var selected = active.selectedLayers;
            for (i = 0; i < selected.length; i++) { if (!selected[i].locked) { report.writableSelection = true; } }
        }
        report.projectItemCount = app.project ? app.project.numItems : 0;
        report.finished = true;
    } catch (err) { report.error = String(err); }
    report.finishedAtMs = new Date().getTime();
    reportFile.encoding = 'UTF-8';
    if (!reportFile.open('w')) { throw new Error('Cannot write ae-host.json. Check AE script file-write permission.'); }
    try { reportFile.write(stringify(report)); } finally { reportFile.close(); }
})();
