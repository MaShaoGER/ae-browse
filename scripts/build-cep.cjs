'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'AE Browse');
const resolvedOutput = path.resolve(out);
if (resolvedOutput !== path.resolve(root, 'dist', 'AE Browse')) throw new Error('Unexpected build target');
if (fs.existsSync(out)) {
  if (fs.lstatSync(out).isSymbolicLink() || fs.realpathSync(out) !== resolvedOutput) throw new Error('Build target must be a real workspace directory');
  // Only this named, generated output directory is replaced.
  fs.rmSync(out, { recursive: true });
}
function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function tree(directory, target) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name), dest = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Build inputs must not contain links: ' + source);
    if (entry.isDirectory()) tree(source, dest); else copy(source, dest);
  }
}
// Emit deterministic files from source; builds do not touch installed extensions or AE.
tree(path.join(root, 'cep'), path.join(out, 'cep'));
copy(path.join(root, 'cep/CSXS/manifest.xml'), path.join(out, 'CSXS/manifest.xml'));
tree(path.join(root, 'src'), path.join(out, 'src'));
const hostSources = ['json-compat.jsxinc', 'native-shape-plan.jsxinc', 'native-shape-adapter.jsxinc', 'host-dispatch.jsxinc'];
const host = hostSources.map(file => '/* Source: src/' + file + ' */\n' + fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n\n');
fs.mkdirSync(path.join(out, 'jsx'), { recursive: true });
fs.writeFileSync(path.join(out, 'jsx/host.jsx'), '/* AE Browse 0.2.0 - generated; edit src files instead. */\n' + host, 'utf8');
const demo = fs.readFileSync(path.join(root, 'examples/portable-demo/pack.json'), 'utf8');
fs.writeFileSync(path.join(out, 'cep/ui/demo-data.js'), 'window.AEBrowseDemo = ' + JSON.stringify(JSON.parse(demo)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n');
function inventory(directory, prefix = '') {
  let files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix + entry.name;
    if (relative === 'build-info.json') continue;
    if (entry.isDirectory()) files = files.concat(inventory(path.join(directory, entry.name), relative + '/'));
    else files.push({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, entry.name))).digest('hex') });
  }
  return files;
}
fs.writeFileSync(path.join(out, 'build-info.json'), JSON.stringify({ version: '0.2.0', extensionId: 'local.aebrowse.panel', files: inventory(out) }, null, 2) + '\n');
console.log('CEP build: ' + out);
