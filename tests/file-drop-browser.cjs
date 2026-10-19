'use strict';
// Isolated Chromium panel test. Real content service; simulated CEP path transport
// and read-only host responses. Never connects to AE or the user's registry.
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), http=require('node:http');
const {chromium}=require('playwright');
const {createContentService}=require('../cep/node/content-service.cjs');
const root=path.resolve(__dirname,'..'), out=path.join(root,'dist/AE Browse/cep');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'aebrowse-drop-browser-')), results=[], errors=[];
  let server,browser;
  try {
    const folder=path.join(temp,'中文 素材'), other=path.join(temp,'散文件'), dataDir=path.join(temp,'settings');
    await fs.mkdir(path.join(folder,'子目录'),{recursive:true}); await fs.mkdir(other);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><path d="M0 0H30V20H0Z"/></svg>';
    await fs.writeFile(path.join(folder,'子目录','圆.svg'),svg);
    const first=path.join(other,'箭头.svg'), second=path.join(other,'星.svg');
    await fs.writeFile(first,svg);await fs.writeFile(second,svg);await fs.writeFile(path.join(other,'不应出现.svg'),svg);
    const service=createContentService({dataDir}), calls=[];
    server=http.createServer(async(req,res)=>{
      try {
        const name=new URL(req.url,'http://localhost').pathname;
        const file=path.resolve(out,'.'+decodeURIComponent(name==='/'?'/index.html':name));
        if(!file.startsWith(out+path.sep))throw new Error('outside');
        res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
        res.end(await fs.readFile(file));
      }catch(_){res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage({viewport:{width:780,height:640}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('contentCall',async(method,args)=>{calls.push(method);return service[method](...args);});
    await page.route('**/vendor/CSInterface.js',route=>route.fulfill({contentType:'application/javascript',body:`window.__adobe_cep__={};window.SystemPath={EXTENSION:'extension',USER_DATA:'data'};window.CSInterface=function(){this.getSystemPath=function(){return '/isolated';};};window.cep_node={process:{env:{APPDATA:'/isolated'},versions:{node:'test',chrome:'test'}},require:function(name){if(name==='path')return {join:function(){return Array.from(arguments).join('/');}};return {createContentService:function(){return new Proxy({}, {get:function(_,method){return function(){return window.contentCall(method,Array.from(arguments));};}});}};}};`}));
    await page.route('**/bridge/host-bridge.js',route=>route.fulfill({contentType:'application/javascript',body:`window.testHost={busy:false,unconfirmed:false,calls:[]};window.AEBrowseBridge={createBridge:function(){return {getState:function(){return window.testHost;},dispose:function(){},request:async function(operation){window.testHost.calls.push(operation);return {ok:true,data:operation==='getContext'?{activeComp:false}:{},diagnostics:[]};}};}};`}));
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已连接 AE'));
    async function test(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.stack});console.error(name+': '+error.message);}}
    async function drop(paths,opts={}) {
      await page.evaluate(({paths,opts})=>{
        const data=new DataTransfer(); paths.forEach((path,i)=>{const file=new File([''], 'source-'+i+'.svg',{type:'image/svg+xml'});if(!opts.missingPath)Object.defineProperty(file,'path',{value:path});data.items.add(file);});
        document.querySelector('#grid').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      },{paths,opts});
    }
    await test('Panel drag highlight follows enter/leave without obscuring events',async()=>{
      await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File([''],'x.svg'));document.body.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:data}));});
      assert.equal(await page.locator('#drop-overlay').isVisible(),true);
      await page.evaluate(()=>document.dispatchEvent(new Event('dragend')));assert.equal(await page.locator('#drop-overlay').isVisible(),false);
    });
    await test('Dropping a folder renders recursive real filesystem assets',async()=>{
      await drop([folder]); await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已接收 1 项'));
      assert.equal(await page.locator('.asset-card').count(),1); assert.equal(await page.locator('.asset-label').innerText(),'圆');
      assert.equal(await page.locator('#instantiate').isDisabled(),true);
    });
    await test('Multiple files form a selected-only group and clear an old search',async()=>{
      await page.locator('#search').fill('不存在'); await drop([first,second]);
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已接收 2 项'));
      assert.equal(await page.locator('#search').inputValue(),''); assert.equal(await page.locator('.asset-card').count(),2);
      assert.ok((await page.locator('#library option:checked').innerText()).includes('散文件'));
      assert.equal(await page.locator('.asset-image').count(),3); // two thumbs and detail preview
    });
    await test('Repeated rapid drops are guarded while the first is registering',async()=>{
      const before=calls.filter(m=>m==='registerDroppedPaths').length;
      await page.evaluate((path)=>{for(let i=0;i<2;i++){const data=new DataTransfer(),f=new File([''],'x.svg');Object.defineProperty(f,'path',{value:path});data.items.add(f);document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));}},first);
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已接收 1 项'));
      assert.equal(calls.filter(m=>m==='registerDroppedPaths').length-before,1);assert.equal((await service.listLibraries()).length,2);
    });
    await test('Readiness guards block drops while a host result is unconfirmed',async()=>{
      await page.evaluate(()=>window.testHost.unconfirmed=true);const before=calls.length;
      await drop([folder]); assert.ok((await page.locator('#status').innerText()).includes('当前无法接收'));
      assert.equal(calls.length,before);await page.evaluate(()=>window.testHost.unconfirmed=false);
    });
    await test('A partial batch retains valid material and shows a rejected file reason',async()=>{
      await drop([first,path.join(temp,'missing.svg')]);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('missing.svg'));
      assert.equal(await page.locator('.asset-card').count(),2);assert.ok((await page.locator('#status').getAttribute('class')).includes('error'));
    });
    await test('Absent native paths show a fallback instead of registering a guessed path',async()=>{
      const before=calls.length;await drop([first],{missingPath:true});assert.ok((await page.locator('#status').innerText()).includes('本地路径'));assert.equal(calls.length,before);
    });
    await test('Panel reload restores actual dropped registrations and source-only selections',async()=>{
      await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已连接 AE'));
      assert.equal(await page.locator('#library option').count(),2);
      const id=(await service.listLibraries()).find(l=>l.sourceType==='files').id;await page.locator('#library').selectOption(id);
      await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===2);
      assert.deepEqual((await page.locator('.asset-label').allInnerTexts()).sort(),['星','箭头']);
    });
    await test('Narrow/wide layouts avoid horizontal overflow and the overlay fits the viewport',async()=>{
      for(const [width,height]of [[780,640],[560,420],[300,420]]){
        await page.setViewportSize({width,height});
        const size=await page.evaluate(()=>({overflow:document.body.scrollWidth>innerWidth,main:document.querySelector('main').getBoundingClientRect().height}));
        assert.equal(size.overflow,false);assert.ok(size.main>70);
      }
      await fs.mkdir(path.join(root,'test-results/local-only'),{recursive:true});
      await page.screenshot({path:path.join(root,'test-results/local-only/file-drop-narrow.png')});
    });
    await test('The complete drop flow never requests any AE write operation',async()=>{
      const operations=await page.evaluate(()=>window.testHost.calls);assert.ok(operations.length>=2);
      assert.ok(operations.every(name=>['getHostInfo','getContext'].includes(name)));assert.deepEqual(errors,[]);
    });
    const report={scope:'Isolated Edge Chromium UI + real Node content service; CEP File.path and host responses simulated; no live AE or physical OS drag',finished:true,finishedAt:new Date().toISOString(),passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
    await fs.writeFile(path.join(root,'test-results/file-drop-browser.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({scope:report.scope,passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
  }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
