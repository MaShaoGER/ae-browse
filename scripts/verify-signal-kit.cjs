'use strict';
// Node + headless Edge only. Uses disposable registration, never connects to AE.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { inspectDirectory } = require('../src/pack-validator.cjs');
const { createContentService } = require('../cep/node/content-service.cjs');
const root = path.resolve(__dirname, '../examples/signal-kit');
const reportPath = path.resolve(__dirname, '../test-results/signal-kit/report.json');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aebrowse-signal-'));
  const report = { finished:false, scope:'Node package/preflight and real service plan compilation; browser SVG compilation and preview rendering. No live AE property or rendered AE pixel checks.', checks:[], errors:[] };
  let browser;
  try {
    const validation = inspectDirectory(root);
    assert.equal(validation.canRegister, true);
    assert.equal(validation.allContractValid, true);
    assert.equal(validation.assetCount, 7);
    report.checks.push('7 native presets pass package contract validation');
    const service = createContentService({ dataDir:temp });
    const registration = await service.registerLibrary(root);
    const presets = await service.listAssets(registration.library.id);
    const host = { aeVersion:'26.0',capabilities:['shape.create','animation.keyframes'],effects:[],activeComp:true,comp:{id:1,width:1920,height:1080,duration:6,time:0} };
    for (const preset of presets) {
      for (const motion of ['none','pop','slide','fade']) {
        const prepared = await service.prepareAsset(preset.packId,preset.id,preset.fingerprint,host,{motion});
        assert.ok(prepared.plan.geometryType);
        assert.deepEqual(prepared.plan.position,[960,540]);
      }
      report.checks.push(`${preset.id}: real service prepares all four motion options (simulated host capabilities)`);
    }
    const local = await service.registerFolder(path.join(root,'svg'));
    const files = await service.listAssets(local.library.id);
    const catalog = JSON.parse(await fs.readFile(path.join(root,'catalog.json'),'utf8'));
    assert.equal(files.length,12);
    assert.ok(files.every(f=>f.valid));
    report.checks.push('12 SVG files register through real local-folder scanner');
    browser = await chromium.launch({ headless:true,channel:'msedge' });
    const page = await browser.newPage({ viewport:{width:1600,height:1400},deviceScaleFactor:1 });
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.addScriptTag({ path:path.resolve(__dirname,'../cep/ui/svg-shapes.js') });
    for (const file of files) {
      const prepared = await service.prepareAsset(local.library.id,file.id,file.fingerprint);
      const source = Buffer.from(prepared.svgURL.split(',')[1],'base64').toString('utf8');
      const plan = await page.evaluate(source=>AEBrowseSVG.compile(source),source);
      assert.ok(plan.elements.length>0);
      const entry = catalog.assets.find(a=>a.file.endsWith(file.relativePath.replaceAll('\\','/')));
      assert.ok(entry,'SVG must be listed in catalog');
      assert.equal(plan.width,entry.width);
      assert.equal(plan.height,entry.height);
      assert.ok(plan.elements.every(e=>e.paths.every(p=>p.vertices.length>=2)));
      report.checks.push(`${file.name}: sanitized snapshot compiles to ${plan.elements.length} editable shape groups`);
    }
    await page.goto('file:///'+path.join(root,'preview.html').replaceAll('\\','/'));
    await page.waitForFunction(()=>document.querySelector('img').complete && document.querySelector('img').naturalWidth===1600);
    await page.locator('img').screenshot({path:path.join(root,'overview.png')});
    for (const width of [780,360]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      report.checks.push(`Preview at ${width}px: no horizontal overflow`);
    }
    assert.deepEqual(report.errors,[]);
    report.checks.push('1600 × 1400 overview PNG rendered in Edge; no browser errors');
    report.finished=true;
  } catch (error) {
    report.errors.push(error.stack);
    process.exitCode=1;
  } finally {
    if(browser) await browser.close();
    await fs.rm(temp,{recursive:true,force:true});
    report.isolatedSettingsRemoved = !(await fs.stat(temp).catch(()=>null));
    report.timestamp=new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath),{recursive:true});
    await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }
})();
