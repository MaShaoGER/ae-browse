/* Explicit CEP loading test; launched with -m in a new empty AE process. Never saves a project. */
app.exitAfterLaunchAndEval = false;
$.evalFile(new File('D:/project/ae-browse/dist/AE Browse/jsx/host.jsx'));
(function () {
  var report = { startedAtMs: new Date().getTime(), aeVersion: app.version, itemCount: app.project.numItems, projectFile: app.project.file ? app.project.file.fsName : null, finished: false };
  try {
    if (report.projectFile !== null || report.itemCount !== 0) { throw new Error('Isolated test requires a new empty project'); }
    var command = app.findMenuCommandId('AE Browse');
    report.menuCommand = command;
    if (command > 0) { app.executeCommand(command); }
    report.finished = true;
  } catch (error) { report.error = String(error); }
  report.endedAtMs = new Date().getTime();
  var file = new File('D:/project/ae-browse/test-results/cep-isolated-bootstrap.json');
  file.encoding = 'UTF-8'; if (!file.open('w')) { throw new Error('Cannot write isolated bootstrap report'); }
  try { file.write(AEBrowseJSON.stringify(report)); } finally { file.close(); }
  return AEBrowseJSON.stringify(report);
})();
