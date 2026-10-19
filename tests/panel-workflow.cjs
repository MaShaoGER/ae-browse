'use strict';
// Edge + real Node service in isolated settings. AE transport is a read-only double.
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), http=require('node:http');
const {chromium}=require('playwright'), {createContentService}=require('../cep/node/content-service.cjs');
const root=path.resolve(__dirname,'..'), out=path.join(root,'dist/AE Browse/cep');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'aebrowse-workflow-')), errors=[];
  let server,browser,checks=0;
  try {
    const folder=path.join(temp,'我的素材');await fs.mkdir(path.join(folder,'图标'),{recursive:true});
    await fs.writeFile(path.join(folder,'蓝色卡片.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect x="16" y="16" width="288" height="168" rx="24" fill="#5386ed"/></svg>');
    await fs.writeFile(path.join(folder,'图标','箭头.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#e5a65a" d="M10 40H60V20L90 50L60 80V60H10Z"/></svg>');
    const service=createContentService({dataDir:path.join(temp,'settings')});
    server=http.createServer(async(req,res)=>{try {const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(out,'.'+decodeURIComponent(name==='/'?'/index.html':name));if(!file.startsWith(out+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(file));}catch(_){res.writeHead(404);res.end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:780,height:640}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('contentCall',(method,args)=>service[method](...args));
    await page.route('**/vendor/CSInterface.js',route=>route.fulfill({contentType:'application/javascript',body:`window.__adobe_cep__={};window.SystemPath={EXTENSION:'extension',USER_DATA:'data'};window.CSInterface=function(){this.getSystemPath=function(){return '/isolated';};};window.cep_node={process:{env:{APPDATA:'/isolated'},versions:{node:'test',chrome:'test'}},require:function(name){if(name==='path')return {join:function(){return Array.from(arguments).join('/');}};return {createContentService:function(){return new Proxy({}, {get:function(_,method){return function(){return window.contentCall(method,Array.from(arguments));};}});}};}};`}));
    await page.route('**/bridge/host-bridge.js',route=>route.fulfill({contentType:'application/javascript',body:`window.hostCalls=[];window.AEBrowseBridge={createBridge:function(){return {getState:function(){return {};},dispose:function(){},request:async function(operation){hostCalls.push(operation);return {ok:true,data:operation==='getContext'?{activeComp:false}:{},diagnostics:[]};}};}};`}));
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已连接 AE'));
    assert.equal(await page.locator('#setup').isVisible(),true,'Unconfigured panel must lead with folder setup');checks++;
    assert.equal(await page.locator('#search').isVisible(),false);checks++;
    await fs.mkdir(path.join(root,'test-results/workflow-20261018'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results/workflow-20261018/setup.png')});
    await page.locator('#setup-path').click();await page.locator('#library-path').fill(folder);await page.locator('#register-path').click();
    await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===2);
    assert.equal(await page.locator('#setup').isVisible(),false);checks++;
    assert.equal(await page.locator('#add-folder').isVisible(),false,'Management actions must be collapsed');checks++;
    await page.locator('#source-management > summary').click();assert.equal(await page.locator('#add-folder').isVisible(),true);checks++;
    await page.keyboard.press('Escape');assert.equal(await page.locator('#add-folder').isVisible(),false);checks++;
    const sourceId=await page.locator('#library').inputValue();
    await service.registerLibrary(path.join(root,'examples/basic-shapes'));
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===2);
    assert.equal(await page.locator('#library').inputValue(),sourceId,'Last used folder must survive a reload with packs registered');checks++;
    await page.locator('#folder-nav').selectOption('图标/');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
    assert.equal(await page.locator('.asset-label').innerText(),'箭头');checks++;
    await page.locator('#search').fill('蓝色');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===0);checks++;
    await page.locator('#search').fill('');await page.locator('#folder-nav').selectOption('');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===2);
    assert.equal(await page.locator('#svg-mode').inputValue(),'shape','SVG defaults to editable shapes');checks++;
    const geometry=await page.evaluate(()=>AEBrowseSVG.compile('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 20 100 50"><g transform="translate(2 3)"><path d="M10 20h20v10h-20z" fill="#ff0000" fill-rule="evenodd" stroke="#0000ff" stroke-width="2"/></g></svg>'));
    assert.deepEqual(geometry.elements[0].paths[0].vertices[0],[4,6]);assert.deepEqual(geometry.elements[0].fill,[1,0,0,1]);assert.equal(geometry.elements[0].strokeWidth,4);assert.equal(geometry.elements[0].fillRule,'evenodd');checks++;
    const unsupported=await page.evaluate(()=>{try{AEBrowseSVG.compile('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/></svg>');return null;}catch(e){return e.message;}});
    assert.match(unsupported,/渐变|纯色/);checks++;
    const compound=await page.evaluate(()=>AEBrowseSVG.compile('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill-rule="evenodd" d="M0 0H100V100H0Z M25 25v50h50V25Z"/></svg>'));
    assert.equal(compound.elements[0].paths.length,2);checks++;
    for(const size of [{width:780,height:640},{width:560,height:420},{width:300,height:540}]) {
      await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth),false);
      assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().height)>100);
      await page.screenshot({path:path.join(root,'test-results/workflow-20261018/panel-'+size.width+'.png')});checks++;
    }
    assert.deepEqual(errors,[]);assert.ok((await page.evaluate(()=>hostCalls)).every(op=>['getHostInfo','getContext'].includes(op)));checks++;
    const fixtures=[
      {name:'rounded-card',source:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect x="16" y="16" width="288" height="168" rx="24" fill="#5386ed"/></svg>'},
      {name:'compound-stroke',source:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><path fill="#ec704a" fill-rule="evenodd" d="M20 20H180V180H20Z M60 60H140V140H60Z"/><path d="M220 40v120h65" fill="none" stroke="#53c8ba" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>'},
      {name:'curves-transform',source:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 160 100"><g transform="translate(5 5)"><path d="M5 50Q30 5 55 50T105 50" fill="none" stroke="#e4b95e" stroke-width="3" stroke-linecap="square"/><ellipse cx="125" cy="30" rx="12" ry="20" fill="#7398ed" fill-opacity="0.5"/><polygon points="20,65 45,90 5,90" fill="#9bc57a" opacity="0.7"/></g></svg>'},
      {name:'paint-order',source:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect x="20" y="20" width="200" height="140" fill="#ff0000"/><rect x="100" y="60" width="200" height="120" fill="#0000ff"/></svg>'}
    ];
    for(const fixture of fixtures){
      const result=await page.evaluate(async source=>{var url='data:image/svg+xml;base64,'+btoa(source),plan=AEBrowseSVG.compile(source),raster=await AEBrowseRaster.fromSVG(url);return {plan:plan,png:raster.dataURL};},fixture.source);
      fixture.plan=result.plan;
      await fs.writeFile(path.join(root,'test-results/workflow-20261018/'+fixture.name+'-reference.png'),Buffer.from(result.png.split(',')[1],'base64'));
    }
    await fs.writeFile(path.join(root,'test-results/workflow-20261018/svg-fixtures.json'),JSON.stringify(fixtures,null,2));
    await fs.writeFile(path.join(root,'test-results/workflow-20261018/browser.json'),JSON.stringify({finished:true,scope:'Isolated Edge UI + real Node service, no live AE',checks,errors},null,2));
    console.log(JSON.stringify({scope:'Isolated Edge UI + real Node service; no AE',passed:checks,failed:0}));
  } finally {if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
