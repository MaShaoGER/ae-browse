'use strict';
// Node-only service integration: isolated files/settings, no CEP or live AE.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createContentService } = require('../cep/node/content-service.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const declaration = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
const drawing = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 5000 5000"><path d="M0 0H5000V5000H0Z" fill="white"/></svg>';
const exported = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + declaration + '\n' + drawing;
const cases = [
  ['exported', exported, true],
  ['single-quotes-crlf', exported.replace(/"/g, "'").replace(/\n/g, '\r\n'), true],
  ['plain', drawing, true],
  ['gradient', '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><path fill="url(#g)" d="M0 0H1V1Z"/></svg>', true],
  ['custom-dtd', exported.replace('http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd', 'https://example.test/evil.dtd'), false],
  ['internal-entity', exported.replace(declaration, '<!DOCTYPE svg [<!ENTITY test "hello">]>'), false],
  ['public-internal-subset', exported.replace('svg11.dtd">', 'svg11.dtd" [<!ENTITY test "hello">]>'), false],
  ['script', exported.replace('</svg>', '<script>alert(1)</script></svg>'), false],
  ['event-handler', exported.replace('<path ', '<path onload="alert(1)" '), false],
  ['image', exported.replace('</svg>', '<image href="https://example.test/p.png"/></svg>'), false],
  ['external-use', exported.replace('</svg>', '<use href="https://example.test/p.svg#p"/></svg>'), false],
  ['external-style', exported.replace('</svg>', '<style>path{fill:url(https://example.test/p.svg#g)}</style></svg>'), false],
  ['encoded-url', exported.replace('fill="white"', 'fill="url(&#104;ttps://example.test/g)"'), false],
  ['foreign-object', exported.replace('</svg>', '<foreignObject><div>hello</div></foreignObject></svg>'), false],
  ['second-dtd', declaration + exported, false]
];
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aebrowse-svg-'));
  let passed = 0;
  try {
    const folder = path.join(temp, 'source'), dataDir = path.join(temp, 'settings');
    await fs.mkdir(folder);
    for (const [name, source] of cases) await fs.writeFile(path.join(folder, name + '.svg'), source);
    const service = createContentService({ dataDir });
    const { library } = await service.registerFolder(folder);
    for (const [name, source, allowed] of cases) {
      const [asset] = await service.listAssets(library.id, name);
      assert.ok(asset, name);
      assert.equal(asset.valid, allowed, name + ': unexpected SVG eligibility');
      if (allowed) {
        assert.equal(asset.fingerprint, hash(source), name + ': identity must track original bytes');
        const preview = Buffer.from(asset.previewUrl.split(',')[1], 'base64');
        assert.doesNotMatch(preview.toString(), /<!DOCTYPE/i, name + ': preview must not load a DTD');
        const prepared = await service.prepareAsset(library.id, asset.id, asset.fingerprint, {}, {});
        const snapshot = await fs.readFile(prepared.local.path);
        assert.deepEqual(snapshot, preview, name + ': preview and import use identical normalized bytes');
        assert.deepEqual(Buffer.from(prepared.svgURL.split(',')[1], 'base64'), snapshot);
        assert.equal(prepared.local.fingerprint, hash(snapshot));
        assert.equal(path.basename(prepared.local.path), hash(snapshot) + '.svg');
        assert.equal(await fs.readFile(path.join(folder, name + '.svg'), 'utf8'), source, 'original must remain unchanged');
        if (name === 'exported') {
          assert.equal(snapshot.toString(), exported.replace(declaration, ''));
          const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
          const raster = await service.attachSVGRaster(prepared.local, { dataURL:png, width:1, height:1, displayWidth:5000, displayHeight:5000 });
          assert.equal(raster.fallback.displayWidth, 5000);
          await fs.writeFile(path.join(folder, name + '.svg'), source.replace('white', 'red'));
          await assert.rejects(service.prepareAsset(library.id, asset.id, asset.fingerprint, {}, {}), e => e.code === 'E_LOCAL_CHANGED');
          await fs.writeFile(path.join(folder, name + '.svg'), source);
        }
      } else {
        assert.equal(asset.status, 'blocked');
        assert.equal(asset.diagnostics[0].code, 'E_SVG_CONTENT');
        assert.equal(asset.previewUrl, undefined);
        await assert.rejects(service.prepareAsset(library.id, asset.id, asset.fingerprint, {}, {}));
      }
      passed++;
    }
    console.log(JSON.stringify({ scope:'Node-only SVG compatibility and guards', passed, failed:0 }));
  } finally { await fs.rm(temp, { recursive:true, force:true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
