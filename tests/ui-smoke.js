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
const modules = ['bridge', 'history', 'context', 'protocol', 'controller'];
const factories = modules.map(name => JSON.stringify(name) + ':function(require,module,exports){\n' + fs.readFileSync(path.join(root, 'extension/lib', name + '.js'), 'utf8') + '\n}').join(',\n');
const harness = `(() => {
  const factories={${factories}}, cache={};
  const state=window.__harness={responses:[],executions:[],reads:0,prefs:{},modelRequests:0,connections:[],loginReads:0,project:'synthetic-project',layers:[{index:1,name:'Title',type:'TextLayer'}]};
  const hou={baseUrl:'https://studio.example',model:'studio-synthetic',credentialServer:'https://studio.example'};
  const settingsMock={readSettings:()=>({baseUrl:hou.baseUrl,model:hou.model,source:'houlm',houlm:hou}),loadHouToken:async(hou,server)=>{state.loginReads++;return server===hou.baseUrl?'synthetic-saved-login':'';}};
  const identity=()=>({projectToken:state.project,projectPath:null,hostVersion:'25.1-synthetic'});
  const cryptoMock={randomBytes:n=>{const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return {toString:()=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')};},createHash:()=>{let value='';return {update:s=>{value=String(s);return {digest:()=>Array.from(value).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0).toString(16).padStart(64,'0')};}};}};
  const pathMock={join:(...p)=>p.join('/'),isAbsolute:p=>p.startsWith('/'),dirname:p=>p.slice(0,p.lastIndexOf('/')),basename:p=>p.slice(p.lastIndexOf('/')+1)};
  const missing=()=>{const e=new Error('Synthetic file does not exist');e.code='ENOENT';throw e;};
  const fsMock={statSync:missing,lstatSync:missing,readFileSync:missing,existsSync:()=>false,writeFileSync:(p,text)=>{state.prefs[p]=text;}};
  window.Buffer={byteLength:s=>new TextEncoder().encode(s).length,from:s=>({length:new TextEncoder().encode(s).length,toString:()=>s})};
  const transport={normalizeBaseUrl:value=>{const url=new URL(value);return url.origin;},listModels:async options=>{state.connections.push({baseUrl:options.baseUrl,token:options.token});return [{id:'studio-other',name:'Other'},{id:'studio-synthetic',name:'Studio synthetic model'}];},request:async options=>{
    state.modelRequests++;options.onProgress({phase:'headers'});await new Promise(resolve=>setTimeout(resolve,20));
    if(!state.responses.length)throw Error('Synthetic model response queue exhausted');
    return {body:JSON.stringify({choices:[{index:0,message:state.responses.shift(),finish_reason:state.responsesReason.shift()}]}),headers:{'content-type':'application/json'}};
  }};
  state.responsesReason=[];
  state.enqueue=(message,reason)=>{state.responses.push(message);state.responsesReason.push(reason||'stop');};
  function load(name){
    if(name==='crypto')return cryptoMock;if(name==='path')return pathMock;if(name==='fs')return fsMock;if(name==='os')return {homedir:()=>'/synthetic-user'};
    name=name.slice(name.lastIndexOf('/')+1);if(name.endsWith('.js'))name=name.slice(0,-3);if(name==='transport')return transport;if(name==='settings')return settingsMock;
    if(cache[name])return cache[name].exports;if(!factories[name])throw Error('Unknown synthetic module '+name);
    const module={exports:{}};cache[name]=module;factories[name](load,module,module.exports);return module.exports;
  }
  window.cep_node={require:load};
  window.__adobe_cep__={getSystemPath:()=>'/extension',getHostEnvironment:()=>JSON.stringify({appSkinInfo:{baseFontSize:13,baseFontFamily:'Arial'}}),evalScript:(invocation,callback)=>{
    const encoded=JSON.parse('['+invocation.slice('AELM.dispatch('.length,-1)+']');const method=encoded[0],args=JSON.parse(encoded[1]);let response;
    if(method==='identity')response={ok:true,data:identity()};
    else if(method==='inspect'){state.reads++;response={ok:true,data:{identity:identity(),comp:{id:7,name:'Synthetic title sequence',width:1920,height:1080,frameRate:24,duration:8},layers:state.layers,observation:'Authored state; no render requested.'}};}
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
    await page.click('#connect');
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected');
    assert.equal(await page.locator('#model').inputValue(),'studio-synthetic');
    assert.equal(await page.evaluate(()=>window.__harness.connections[0].token),'synthetic-saved-login');
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__harness.prefs).includes('synthetic-saved-login')),false);
    await page.click('#settingsToggle');await page.fill('#server','https://other.example');
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
    assert.equal(requests.some(url=>!url.startsWith('http://127.0.0.1:')),false);
    assert.deepEqual(failures,[]);
    // Project switching must clear the previous transcript even when the new archive is empty.
    await page.evaluate(()=>{window.__harness.project='another-synthetic-project';});
    await page.waitForFunction(()=>document.querySelector('#transcript').textContent.includes('Work with your composition.'),{timeout:8000});
    assert.equal(await page.locator('details.activity').count(),0);
    const report={syntheticOnly:true,nativeHostTest:false,checks:['Hou-lm prefill and saved login','saved model selection','no token persisted','server edit disconnects','foreign server requires its own key','manual override','reload Hou-lm settings','local inspection','model connection','review source','reject without execution','apply once','partial output status without failure','collapsed command receipts','literal HTML rendering','340px layout','project-switch transcript reset'],executions:1,screenshots:['ui-wide.png','ui-narrow.png']};
    fs.writeFileSync(path.join(output,'ui-smoke.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
