'use strict';

// Synthetic browser acceptance, not native AE acceptance. Uses the shipped panel,
// Controller, Bridge, history validation, context reducer and protocol parser.
// CEP, model HTTP, filesystem and Node crypto are deliberately mocked in-browser.
// Run with Playwright available via NODE_PATH; no browser/dependency download occurs.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-artifacts');
const modules = ['bridge', 'history', 'context', 'protocol', 'controller', 'visuals', 'image-input', 'image-headers'];
const factories = modules.map(name => JSON.stringify(name) + ':function(require,module,exports){\n' + fs.readFileSync(path.join(root, 'extension/lib', name + '.js'), 'utf8') + '\n}').join(',\n');
const harness = `(() => {
  const factories={${factories}}, cache={};
  const scenario=window.__startupScenario||{};
  const state=window.__harness={responses:[],executions:[],reads:0,prefs:{},bodies:[],modelRequests:0,connections:[],loginReads:0,identityReads:0,captures:[],regionSelections:0,regionClears:0,manualRegion:false,project:'synthetic-project',layers:[{index:1,name:'Title',type:'TextLayer'}]};
  const hou={baseUrl:'https://studio.example',model:'studio-synthetic',credentialServer:'https://studio.example'};
  const settingsMock={readSettings:()=>({baseUrl:scenario.foreignServer?'https://other.example':hou.baseUrl,model:hou.model,source:scenario.foreignServer?'aelm':'houlm',maxCaptures:scenario.maxCaptures,houlm:scenario.noHou?null:hou}),loadHouToken:async(shared,server)=>{
    state.loginReads++;
    if(scenario.holdLogin)await new Promise(resolve=>{state.releaseLogin=resolve;});
    if(scenario.loginError)throw Error('Synthetic saved login cannot be read.');
    return !scenario.noLogin&&shared&&server===shared.baseUrl?'synthetic-saved-login':'';
  }};
  const identity=()=>({projectToken:state.project,projectPath:null,hostVersion:'25.1-synthetic'});
  const cryptoMock={randomBytes:n=>{const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return {toString:()=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')};},createHash:()=>{let value='';return {update:s=>{value=String(s);return {digest:()=>Array.from(value).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0).toString(16).padStart(64,'0')};}};}};
  const pathMock={join:(...p)=>p.join('/'),isAbsolute:p=>p.startsWith('/'),dirname:p=>p.slice(0,p.lastIndexOf('/')),basename:p=>p.slice(p.lastIndexOf('/')+1)};
  const missing=()=>{const e=new Error('Synthetic file does not exist');e.code='ENOENT';throw e;};
  class MemoryBuffer extends Uint8Array {
    static from(value,encoding){return new MemoryBuffer(typeof value==='string'?(encoding==='base64'?Uint8Array.from(atob(value),c=>c.charCodeAt(0)):new TextEncoder().encode(value)):value);}
    static byteLength(value){return new TextEncoder().encode(value).length;}
    static isBuffer(value){return value instanceof MemoryBuffer;}
    toString(encoding,start=0,end=this.length){const part=this.subarray(start,end);if(encoding==='base64')return btoa(Array.from(part,b=>String.fromCharCode(b)).join(''));if(encoding==='hex')return Array.from(part,b=>b.toString(16).padStart(2,'0')).join('');return new TextDecoder().decode(part);}
    equals(other){return this.length===other.length&&this.every((b,i)=>b===other[i]);}
    readUInt32BE(offset){return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint32(offset);}
    readUInt32LE(offset){return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint32(offset,true);}
    readUInt16BE(offset){return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint16(offset);}
    readUInt16LE(offset){return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint16(offset,true);}
    readUIntLE(offset,count){let n=0;for(let i=0;i<count;i++)n+=this[offset+i]*Math.pow(256,i);return n;}
  }
  window.Buffer=MemoryBuffer;
  const files=new Map(),directories=new Set(['/synthetic-temp']);let tempId=0;
  const fsMock={statSync:missing,lstatSync:p=>{if(directories.has(p))return {isSymbolicLink:()=>false,isDirectory:()=>true,isFile:()=>false};if(files.has(p))return {isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true,size:files.get(p).length};return missing();},readFileSync:p=>files.has(p)?MemoryBuffer.from(files.get(p)):missing(),existsSync:p=>files.has(p)||directories.has(p)||(scenario.captureAdapter&&p==='/extension/lib/visible-capture.js'),mkdirSync:p=>directories.add(p),mkdtempSync:p=>{const value=p+(++tempId);directories.add(value);return value;},writeFileSync:(p,value,options)=>{if(options&&options.flag==='wx'&&files.has(p)){const e=new Error('Exists');e.code='EEXIST';throw e;}files.set(p,MemoryBuffer.from(value));if(p.endsWith('.aelm-settings.json'))state.prefs[p]=value;}};
  const transport={normalizeBaseUrl:value=>{const url=new URL(value);return url.origin;},listModels:async options=>{state.connections.push({baseUrl:options.baseUrl,token:options.token});
    if(scenario.holdModels)await new Promise((resolve,reject)=>{state.releaseModels=resolve;state.rejectModels=()=>reject(Error('Synthetic obsolete connection failure'));});
    if(scenario.invalidLogin)throw Error('The saved login was rejected. Enter a valid Open WebUI key.');
    return [{id:'studio-other',name:'Other'},{id:'studio-synthetic',name:'Studio synthetic model'}];},request:async options=>{
    state.modelRequests++;state.bodies.push(JSON.parse(JSON.stringify(options.body)));options.onProgress({phase:'headers'});await new Promise(resolve=>setTimeout(resolve,20));
    if(!state.responses.length)throw Error('Synthetic model response queue exhausted');
    return {body:JSON.stringify({choices:[{index:0,message:state.responses.shift(),finish_reason:state.responsesReason.shift()}]}),headers:{'content-type':'application/json'}};
  }};
  state.responsesReason=[];
  state.enqueue=(message,reason)=>{state.responses.push(message);state.responsesReason.push(reason||'stop');};
  // This adapter produces synthetic canvas pixels only; it cannot inspect the desktop.
  const captureMock={hasRegion:()=>state.manualRegion,clearRegion:()=>{state.regionClears++;state.manualRegion=false;},selectRegion:async()=>{state.regionSelections++;state.manualRegion=true;},capture:async options=>{
    state.captures.push({viewerType:options.viewerType,maxWidth:options.maxWidth,maxHeight:options.maxHeight,manualRegion:state.manualRegion});
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const context=canvas.getContext('2d');context.fillStyle='#182c46';context.fillRect(0,0,320,180);context.fillStyle='#b5a2ff';context.fillRect(50,50,120,60);
    return {bytes:MemoryBuffer.from(canvas.toDataURL('image/png').split(',')[1],'base64'),mime:'image/png',metadata:{method:state.manualRegion?'selected-visible-region':'detected-visible-viewer'}};
  }};
  function load(name){
    if(name==='crypto')return cryptoMock;if(name==='path')return pathMock;if(name==='fs')return fsMock;if(name==='os')return {homedir:()=>'/synthetic-user',tmpdir:()=>'/synthetic-temp'};
    name=name.slice(name.lastIndexOf('/')+1);if(name.endsWith('.js'))name=name.slice(0,-3);if(name==='transport')return transport;if(name==='settings')return settingsMock;if(name==='visible-capture')return {createVisibleCapture:()=>captureMock};
    if(cache[name])return cache[name].exports;if(!factories[name])throw Error('Unknown synthetic module '+name);
    const module={exports:{}};cache[name]=module;factories[name](load,module,module.exports);
    if(name==='history'){
      const original=module.exports.HistoryStore.prototype.saveAsync;
      module.exports.HistoryStore.prototype.saveAsync=async function(value){
        if(value.messages.some(message=>message.role==='user')){
          if(state.holdAcceptance){state.holdAcceptance=false;await new Promise(resolve=>{state.releaseAcceptance=resolve;});}
          if(state.failAcceptance){state.failAcceptance=false;throw Error('Synthetic acceptance save failed');}
        }
        return original.call(this,value);
      };
    }
    return module.exports;
  }
  window.cep_node={require:load};
  window.__adobe_cep__={getSystemPath:()=>'/extension',getHostEnvironment:()=>JSON.stringify({appSkinInfo:{baseFontSize:13,baseFontFamily:'Arial'}}),evalScript:(invocation,callback)=>{
    const encoded=JSON.parse('['+invocation.slice('AELM.dispatch('.length,-1)+']');const method=encoded[0],args=JSON.parse(encoded[1]);let response;
    if(method==='identity'){state.identityReads++;response=scenario.identityError?{ok:false,error:{code:'host_unavailable',message:'Synthetic AE identity unavailable'}}:{ok:true,data:identity()};}
    else if(method==='inspect'){state.reads++;response={ok:true,data:{identity:identity(),viewer:{type:'composition'},comp:{id:7,name:'Synthetic title sequence',time:0,width:1920,height:1080,frameRate:24,duration:8},layers:state.layers,observation:'Authored state; no render requested.'}};}
    else if(method==='execute'){state.executions.push(args);state.layers.push({index:2,name:'AELM_TEST_CONTROL',type:'AVLayer'});response={ok:true,data:{execution:'completed',result:{name:'AELM_TEST_CONTROL'},identity:identity()}};if(state.partialOutput)response._aelmHost={partial:true,fullResultAvailable:false,note:'Synthetic partial capture'};}
    else response={ok:false,error:{code:'unsupported',message:'Unsupported synthetic host call'}};
    setTimeout(()=>callback(JSON.stringify(response)),5);
  }};
})();`;
new (require('vm').Script)(harness);

async function main() {
  fs.mkdirSync(output, {recursive:true});
  const server=http.createServer((request,response)=>{
    const relative=request.url==='/'?'index.html':request.url.slice(1);
    if(!['index.html','panel.css','panel.js'].includes(relative)){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',relative.endsWith('.css')?'text/css':relative.endsWith('.js')?'text/javascript':'text/html');
    response.end(fs.readFileSync(path.join(root,'extension',relative)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const options={headless:true};
    if(process.env.AELM_BROWSER_CHANNEL)options.channel=process.env.AELM_BROWSER_CHANNEL;
    browser=await chromium.launch(options);
    // Independent startup cases use only the synthetic service and credential
    // readers. The test never opens AE or reads a real saved login.
    async function startupCase(scenario,check){
      const boot=await browser.newPage({viewport:{width:560,height:900}});
      const errors=[];boot.on('pageerror',error=>errors.push(error.message));
      await boot.addInitScript({content:'window.__startupScenario='+JSON.stringify(scenario)+';'+harness});
      try{
        await boot.goto('http://127.0.0.1:'+server.address().port+'/');
        await boot.waitForFunction(()=>window.__harness&&window.__harness.identityReads===1);
        await check(boot);
        assert.deepEqual(errors,[]);
      }finally{await boot.close();}
    }
    for(const scenario of [{noLogin:true},{foreignServer:true},{noHou:true}]){
      await startupCase(scenario,async boot=>{
        await boot.waitForFunction(()=>!document.querySelector('#connect').disabled);
        assert.equal(await boot.locator('#connection').textContent(),'Not connected');
        assert.equal(await boot.locator('#settings').isVisible(),true);
        assert.equal(await boot.locator('#error').textContent(),'');
        assert.equal(await boot.evaluate(()=>window.__harness.connections.length),0);
        assert.equal(await boot.evaluate(()=>window.__harness.loginReads),scenario.noLogin?1:0);
      });
    }
    for(const scenario of [{invalidLogin:true},{loginError:true}]){
      await startupCase(scenario,async boot=>{
        await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connection failed'&&!document.querySelector('#connect').disabled);
        assert.equal(await boot.locator('#settings').isVisible(),true);
        assert.match(await boot.locator('#error').textContent(),/login/i);
        assert.equal(await boot.locator('#token').inputValue(),'');
        assert.equal(await boot.evaluate(()=>window.__harness.connections.length),scenario.invalidLogin?1:0);
        // A recurring host-only sync must not restart saved-login attempts.
        await boot.waitForFunction(()=>window.__harness.identityReads>=2,{timeout:7000});
        assert.equal(await boot.evaluate(()=>window.__harness.loginReads),1);
        assert.equal(await boot.evaluate(()=>window.__harness.connections.length),scenario.invalidLogin?1:0);
      });
    }
    await startupCase({identityError:true},async boot=>{
      await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
      assert.equal(await boot.evaluate(()=>window.__harness.connections.length),1);
      assert.equal(await boot.locator('#model').inputValue(),'studio-synthetic');
    });
    for(const fail of [false,true]){
      await startupCase({holdModels:true},async boot=>{
        await boot.waitForFunction(()=>Boolean(window.__harness.releaseModels));
        await boot.evaluate(fail=>{
          const server=document.querySelector('#server');server.value='https://changed.example';server.dispatchEvent(new Event('input'));
          if(fail)window.__harness.rejectModels();else window.__harness.releaseModels();
        },fail);
        await boot.waitForFunction(()=>!document.querySelector('#connect').disabled);
        assert.equal(await boot.locator('#connection').textContent(),'Not connected');
        assert.equal(await boot.locator('#settings').isVisible(),true);
        assert.equal(await boot.locator('#error').textContent(),'');
        assert.equal(await boot.evaluate(()=>Object.keys(window.__harness.prefs).length),0);
      });
    }
    await startupCase({holdLogin:true},async boot=>{
      await boot.waitForFunction(()=>Boolean(window.__harness.releaseLogin));
      await boot.evaluate(()=>{const server=document.querySelector('#server');server.value='https://changed.example';server.dispatchEvent(new Event('input'));window.__harness.releaseLogin();});
      await boot.waitForFunction(()=>!document.querySelector('#connect').disabled);
      assert.equal(await boot.evaluate(()=>window.__harness.connections.length),0);
      assert.equal(await boot.locator('#connection').textContent(),'Not connected');
    });
    await startupCase({},async boot=>{
      await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
      const draft='Keep this prompt and attachment until accepted.';
      await boot.setInputFiles('#imageFiles',{name:'preflight.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJfcAAAAASUVORK5CYII=','base64')});
      await boot.waitForFunction(()=>document.querySelectorAll('#references img').length===1);
      await boot.evaluate(()=>{window.__harness.failAcceptance=true;});
      await boot.fill('#prompt',draft);await boot.click('#send');
      await boot.waitForFunction(()=>document.querySelector('#progress').hidden&&document.querySelector('#error').textContent.includes('Synthetic acceptance save failed'));
      assert.equal(await boot.locator('#prompt').inputValue(),draft);
      assert.equal(await boot.locator('#references img').count(),1);
      assert.equal(await boot.evaluate(()=>window.__harness.modelRequests),0);
      assert.equal(await boot.locator('.message.user').count(),0);
      await boot.evaluate(()=>window.__harness.enqueue({role:'assistant',content:'The draft was accepted once.'}));
      await boot.click('#send');
      await boot.waitForFunction(()=>window.__harness.modelRequests===1&&document.querySelector('#progress').hidden);
      assert.equal(await boot.locator('#error').textContent(),'');
      assert.equal(await boot.locator('#prompt').inputValue(),'');
      assert.equal(await boot.locator('#references img').count(),0);
      assert.equal(await boot.locator('.message.user').count(),1);
      assert.equal(await boot.locator('.reference-thumbs img').count(),1);
    });
    await startupCase({},async boot=>{
      await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
      await boot.fill('#prompt','Accepted even if the model later fails.');await boot.click('#send');
      await boot.waitForFunction(()=>window.__harness.modelRequests===1&&document.querySelector('#progress').hidden);
      assert.match(await boot.locator('#error').textContent(),/Synthetic model response queue exhausted/);
      assert.equal(await boot.locator('#prompt').inputValue(),'');
      assert.equal(await boot.locator('.message.user').count(),1);
    });
    await startupCase({},async boot=>{
      await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
      await boot.evaluate(()=>{window.__harness.holdAcceptance=true;window.__harness.enqueue({role:'assistant',content:'The first prompt was accepted.'});});
      await boot.fill('#prompt','First submitted prompt.');await boot.click('#send');
      await boot.waitForFunction(()=>Boolean(window.__harness.releaseAcceptance));
      await boot.fill('#prompt','New text typed while acceptance was pending.');
      await boot.evaluate(()=>window.__harness.releaseAcceptance());
      await boot.waitForFunction(()=>window.__harness.modelRequests===1&&document.querySelector('#progress').hidden);
      assert.equal(await boot.locator('#prompt').inputValue(),'New text typed while acceptance was pending.');
      assert.equal(await boot.locator('.message.user').count(),1);
      assert.match(await boot.locator('.message.user').textContent(),/First submitted prompt/);
      assert.doesNotMatch(await boot.locator('.message.user').textContent(),/New text typed/);
    });
    await startupCase({maxCaptures:24},async boot=>{
      await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
      assert.equal(await boot.locator('#maxCaptures').inputValue(),'24');
      assert.equal(await boot.evaluate(()=>JSON.parse(Object.values(window.__harness.prefs)[0]).maxCaptures),24);
      assert.equal(await boot.locator('#viewportAccess').isChecked(),false);
    });
    await startupCase({captureAdapter:true},async boot=>{
      await boot.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
      assert.equal(await boot.locator('#viewportAccess').isEnabled(),true);
      assert.equal(await boot.locator('#viewportAccess').isChecked(),false);
      assert.equal(await boot.evaluate(()=>window.__harness.manualRegion),false);
      await boot.check('#viewportAccess');
      assert.equal(await boot.locator('#viewportAccess').isChecked(),true);
      assert.equal(await boot.evaluate(()=>window.__harness.regionSelections),0);
      assert.equal(await boot.evaluate(()=>window.__harness.captures.length),0);
      // Only the subsequent model tool request captures; enabling is not a capture.
      await boot.evaluate(()=>{
        window.__harness.enqueue({role:'assistant',content:'I will compare the visible composition.',tool_calls:[{id:'ui-auto-view',type:'function',function:{name:'ae_capture_view',arguments:JSON.stringify({reason:'Check visible layout'})}}]},'tool_calls');
        window.__harness.enqueue({role:'assistant',content:'The synthetic visible frame was inspected.'});
      });
      await boot.fill('#prompt','Inspect the visible composition without editing it.');await boot.click('#send');
      await boot.waitForFunction(()=>(window.__harness.modelRequests===2&&document.querySelector('#progress').hidden)||document.querySelector('#error').textContent);
      assert.equal(await boot.locator('#error').textContent(),'');
      assert.deepEqual(await boot.evaluate(()=>window.__harness.captures),[{viewerType:'composition',maxWidth:1280,maxHeight:1280,manualRegion:false}]);
      assert.equal(await boot.evaluate(()=>window.__harness.regionSelections),0);
      assert.equal(await boot.evaluate(()=>window.__harness.executions.length),0);
      assert.equal(await boot.evaluate(()=>window.__harness.bodies[0].tools.some(tool=>tool.function.name==='ae_capture_view')),true);
      const wire=await boot.evaluate(()=>window.__harness.bodies[1].messages);
      const resultIndex=wire.findIndex(message=>message.role==='tool'&&message.tool_call_id==='ui-auto-view');
      assert.ok(resultIndex>=0);
      assert.equal(JSON.parse(wire[resultIndex].content).data.observation.method,'detected-visible-viewer');
      assert.equal(wire.at(-1).role,'user');
      assert.equal(wire.at(-1).content.filter(part=>part.type==='image_url').length,1);
      assert.ok(wire.length-1>resultIndex);
      assert.equal(await boot.locator('details[open]').count(),0);
      assert.equal(await boot.locator('.captured-image').count(),1);
      const beforeOff=await boot.evaluate(()=>window.__harness.regionClears);
      await boot.uncheck('#viewportAccess');
      assert.equal(await boot.evaluate(()=>window.__harness.regionClears),beforeOff+1);
      assert.equal(await boot.evaluate(()=>window.__harness.captures.length),1);
      await boot.click('#chooseView');
      await boot.waitForFunction(()=>window.__harness.manualRegion);
      assert.equal(await boot.locator('#viewportAccess').isChecked(),false);
      await boot.check('#viewportAccess');await boot.uncheck('#viewportAccess');
      assert.equal(await boot.evaluate(()=>window.__harness.manualRegion),false);
      assert.equal(await boot.evaluate(()=>window.__harness.captures.length),1);
      // A project switch also invalidates a manual override without taking a picture.
      await boot.click('#chooseView');await boot.waitForFunction(()=>window.__harness.manualRegion);
      await boot.evaluate(()=>{window.__harness.project='capture-other-project';});
      await boot.waitForFunction(()=>!window.__harness.manualRegion,{timeout:8000});
      assert.equal(await boot.evaluate(()=>window.__harness.captures.length),1);
    });
    const page=await browser.newPage({viewport:{width:560,height:1000},deviceScaleFactor:1});
    const failures=[], requests=[];
    page.on('pageerror',error=>{failures.push(error.message);console.error('Synthetic browser error:',error.message);});page.on('request',request=>requests.push(request.url()));
    await page.addInitScript({content:harness});
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.waitForFunction(()=>document.querySelector('#history').textContent.includes('memory')||!document.querySelector('#error').hidden);
    assert.equal(await page.locator('#error').textContent(),'');
    await page.click('#inspect');
    await page.waitForFunction(()=>document.querySelectorAll('details.activity').length===1 && document.querySelector('#progress').hidden);
    assert.equal(await page.locator('details[open]').count(),0);
    assert.equal(await page.evaluate(()=>window.__harness.reads),1);
    assert.equal(await page.locator('#server').inputValue(),'https://studio.example');
    assert.equal(await page.locator('#token').inputValue(),'');
    assert.equal(await page.locator('#autoRun').isChecked(),false);
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
    assert.equal(await page.evaluate(()=>window.__harness.connections.length),1);
    assert.equal(await page.evaluate(()=>window.__harness.loginReads),1);
    assert.equal(await page.locator('#model').inputValue(),'studio-synthetic');
    assert.equal(await page.evaluate(()=>window.__harness.connections[0].token),'synthetic-saved-login');
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__harness.prefs).includes('synthetic-saved-login')),false);
    assert.equal(await page.locator('#maxCaptures').inputValue(),'12');
    await page.click('#settingsToggle');
    async function captureLimit(value){await page.fill('#maxCaptures',value);await page.locator('#maxCaptures').blur();}
    await captureLimit('18');
    assert.equal(await page.evaluate(()=>JSON.parse(Object.values(window.__harness.prefs)[0]).maxCaptures),18);
    assert.equal(await page.locator('#viewportAccess').isChecked(),false);
    for(const invalid of ['0','51','1.5']){
      await captureLimit(invalid);
      assert.equal(await page.locator('#maxCaptures').inputValue(),'18');
      assert.match(await page.locator('#error').textContent(),/whole number from 1 to 50/);
    }
    await captureLimit('1');assert.equal(await page.locator('#maxCaptures').inputValue(),'1');
    await captureLimit('50');assert.equal(await page.locator('#maxCaptures').inputValue(),'50');
    await captureLimit('18');
    await page.setViewportSize({width:340,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:path.join(output,'ui-settings.png')});
    await page.setViewportSize({width:560,height:1000});
    await page.fill('#server','https://other.example');
    assert.equal(await page.locator('#connection').textContent(),'Not connected');
    await page.fill('#prompt','This must not reach a model before reconnecting.');await page.click('#send');
    assert.match(await page.locator('#error').textContent(),/Connect to your studio/);
    assert.equal(await page.evaluate(()=>window.__harness.modelRequests),0);
    await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connection failed');
    assert.equal(await page.evaluate(()=>window.__harness.connections.length),1);
    await page.fill('#token','synthetic-manual-token');await page.click('#connect');
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
    assert.equal(await page.evaluate(()=>window.__harness.connections[1].baseUrl),'https://other.example');
    assert.equal(await page.evaluate(()=>window.__harness.connections[1].token),'synthetic-manual-token');
    await page.click('#settingsToggle');await page.click('#useHoulm');
    assert.equal(await page.locator('#token').inputValue(),'');
    assert.equal(await page.locator('#server').inputValue(),'https://studio.example');
    await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
    assert.equal(await page.evaluate(()=>JSON.parse(Object.values(window.__harness.prefs)[0]).maxCaptures),18);
    const script='var comp = app.project.activeItem; var layer = comp.layers.addNull(); layer.name = "AELM_TEST_CONTROL"; return {name: layer.name};';
    async function proposal(id){await page.evaluate(({id,script})=>{
      window.__harness.enqueue({role:'assistant',content:'I will add one control null after you review this script.',tool_calls:[{id,type:'function',function:{name:'ae_run_script',arguments:JSON.stringify({title:'Add a control null to the active composition',source:script})}}]},'tool_calls');
      window.__harness.enqueue({role:'assistant',content:'Receipt recorded. <img src="https://invalid.example/remote.png" onerror="window.injected=true">'},'stop');
    },{id,script});await page.fill('#prompt','Add a control null; show the script first.');await page.click('#send');await page.waitForSelector('#review:not([hidden])');}
    await proposal('ui-reject');
    assert.equal(await page.locator('#reviewSource').textContent(),script);
    assert.equal(await page.evaluate(()=>window.__harness.executions.length),0);
    await page.click('#reject');await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    assert.equal(await page.evaluate(()=>window.__harness.executions.length),0);
    await proposal('ui-apply');await page.evaluate(()=>{window.__harness.partialOutput=true;});await page.click('#approve');await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    assert.equal(await page.evaluate(()=>window.__harness.executions.length),1);
    assert.equal(await page.evaluate(()=>window.__harness.executions[0].source),script);
    assert.match(await page.locator('details.activity').last().locator('summary').textContent(),/completed · partial output/);
    assert.equal(await page.locator('#error').textContent(),'');
    assert.equal(await page.locator('details[open]').count(),0);
    assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
    await page.locator('details.activity').last().locator('summary').click();
    assert.match(await page.locator('details.activity').last().innerText(),/layers.addNull/);
    await page.locator('details.activity').last().locator('summary').click();
    await page.screenshot({path:path.join(output,'ui-wide.png')});
    await page.setViewportSize({width:340,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:path.join(output,'ui-narrow.png')});
    // Real browser decoding/canvas normalization and the shipped attachment UI;
    // synthetic filesystem/model only. No screenshot of any native application.
    const referenceBase64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;const ctx=c.getContext('2d');ctx.fillStyle='#152d46';ctx.fillRect(0,0,1600,900);ctx.fillStyle='#b5a2ff';ctx.fillRect(200,200,400,200);return c.toDataURL('image/png').split(',')[1];});
    await page.setInputFiles('#imageFiles',{name:'reference.png',mimeType:'image/png',buffer:Buffer.from(referenceBase64,'base64')});
    await page.waitForFunction(()=>document.querySelectorAll('#references img').length===1);
    assert.equal(await page.locator('#viewportAccess').isChecked(),false);
    const requestsBeforeBlockedSend=await page.evaluate(()=>window.__harness.modelRequests);
    await page.click('#settingsToggle');
    await page.evaluate(()=>document.querySelector('#server').dispatchEvent(new Event('input')));
    await page.fill('#prompt','Keep this attached image until I reconnect.');await page.click('#send');
    assert.match(await page.locator('#error').textContent(),/Connect to your studio/);
    assert.equal(await page.locator('#references img').count(),1);
    assert.equal(await page.evaluate(()=>window.__harness.modelRequests),requestsBeforeBlockedSend);
    await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
    await page.evaluate(()=>window.__harness.enqueue({role:'assistant',content:'I received a visual reference.'}));
    await page.fill('#prompt','Use this reference without changing AE.');await page.click('#send');await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    assert.equal(await page.evaluate(()=>window.__harness.bodies.at(-1).messages.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content.filter(c=>c.type==='image_url')).length),1);
    assert.equal(await page.locator('.reference-thumbs img').count(),1);
    assert.equal(await page.locator('#references img').count(),0);
    assert.equal(await page.locator('#imageHint').isVisible(),false);
    assert.equal(await page.getByRole('button',{name:'Stop using references',exact:true}).count(),1);
    await page.evaluate(()=>window.__harness.enqueue({role:'assistant',content:'The same original image is still available.'}));
    await page.fill('#prompt','Refine that reference a little further.');await page.click('#send');await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    assert.equal(await page.evaluate(()=>window.__harness.bodies.at(-1).messages.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content.filter(c=>c.type==='image_url')).length),1);
    assert.equal(await page.locator('#references img').count(),0);
    assert.equal(await page.locator('.reference-thumbs img').count(),1);
    await page.getByRole('button',{name:'Stop using references',exact:true}).click();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.reference-thumbs button')).some(button=>button.textContent==='Stop using references'));
    assert.equal(await page.locator('.reference-thumbs img').count(),1);
    await page.evaluate(()=>window.__harness.enqueue({role:'assistant',content:'No reference image was sent for this request.'}));
    await page.fill('#prompt','Continue without reference images.');await page.click('#send');await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    assert.equal(await page.evaluate(()=>window.__harness.bodies.at(-1).messages.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content.filter(c=>c.type==='image_url')).length),0);
    await page.getByRole('button',{name:'Reuse references',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#references img').length===1);
    await page.evaluate(base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'dropped.png',{type:'image/png'}));document.querySelector('#composer').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},referenceBase64);
    await page.waitForFunction(()=>document.querySelectorAll('#references img').length===2);
    await page.evaluate(base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'pasted.png',{type:'image/png'}));document.querySelector('#prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},referenceBase64);
    await page.waitForFunction(()=>document.querySelectorAll('#references img').length===3);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:path.join(output,'ui-images.png')});
    await page.getByRole('button',{name:'Clear references',exact:true}).click();
    assert.equal(requests.some(url=>!url.startsWith('http://127.0.0.1:')),false);
    assert.deepEqual(failures,[]);
    // Project switching must clear the previous transcript even when the new archive is empty.
    await page.evaluate(()=>{window.__harness.project='another-synthetic-project';});
    await page.waitForFunction(()=>document.querySelector('#transcript').textContent.includes('Work with your composition.'),{timeout:8000});
    assert.equal(await page.locator('details.activity').count(),0);
    const report={syntheticOnly:true,nativeHostTest:false,checks:['automatic saved-login connection once','missing login shows settings without a request','foreign saved URL never loads Hou login','missing Hou settings stay disconnected','invalid credentials do not retry','unreadable credentials show settings','host identity failure does not block connection','stale model success and failure ignored','stale token lookup cannot send to changed server','Hou-lm prefill and saved login','saved model selection','no token persisted','server edit disconnects','foreign server requires its own key','manual override','reload Hou-lm settings','local inspection','model connection','review source','reject without execution','apply once','partial output status without failure','collapsed command receipts','literal HTML rendering','340px layout','project-switch transcript reset','image file picker and browser normalization','wire image content','archived reference thumbnail','clear and reuse references','drop image','paste image','viewport access off','three-image narrow layout','capture adapter enables checkbox without region','capture permission starts off','enabling capture neither selects nor captures','model-requested automatic viewer capture','capture tool image follows completed result','capture receipt stays collapsed','turning capture off resets adapter','manual override requires explicit capture permission','project switch clears manual override without capture','draft reference clears after accepted Send','sent image thumbnail remains','follow-up keeps original reference without new draft','stop using references changes future wire only','saved visual-check limit restored','visual-check limit persists across reconnect','visual-check range validation','visual-check setting never grants capture permission','blocked send preserves draft attachment','preflight failure preserves typed prompt and attachment','accepted prompt clears despite later model failure','acceptance never overwrites newly typed text'],executions:1,screenshots:['ui-wide.png','ui-narrow.png','ui-images.png','ui-settings.png']};
    fs.writeFileSync(path.join(output,'ui-smoke.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
