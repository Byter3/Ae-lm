'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Controller}=require('../extension/lib/controller');
const {HistoryStore,validateArchive,createArchive}=require('../extension/lib/history');
const visual=require('../extension/lib/visuals');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJfcAAAAASUVORK5CYII=','base64');
function image(name){return {bytes:Buffer.from(png),mime:'image/png',name:name||'Reference.png'};}
function call(id,name,args){return {id,type:'function',function:{name,arguments:JSON.stringify(args)}};}
function capture(id){return call(id,'ae_capture_view',{reason:'Compare the visible design with the reference.'});}
function response(calls){const message={role:'assistant',content:calls?'Inspecting the visible result.':'Observed.'};if(calls)message.tool_calls=calls;return {body:JSON.stringify({choices:[{message,finish_reason:calls?'tool_calls':'stop'}]}),headers:{'content-type':'application/json'}};}
function harness(responses,options){
  const opts=options||{}, requests=[], captures=[];
  const current={projectToken:'project-1',projectPath:opts.projectPath||'',hostVersion:'26.5'};
  const bridge={identity:async()=>({ok:true,data:Object.assign({},current)}),inspect:async()=>({ok:true,data:{scope:'activeComp',viewer:{type:'composition'},comp:{id:1,name:'Synthetic',time:0,frameRate:24,width:1920,height:1080}}}),execute:async()=>({ok:true,data:{result:{done:true}}})};
  const controller=new Controller({bridge,store:new HistoryStore(),captureView:async options=>{captures.push(options);if(opts.capture)return opts.capture(controller);return image('View');},transport:{normalizeBaseUrl:x=>x,request:async args=>{requests.push(JSON.parse(JSON.stringify(args.body)));const next=responses.shift();if(next instanceof Error)throw next;return next||response();}}});
  controller.configure({baseUrl:'https://studio.test',token:'synthetic',model:'test'});
  return {controller,requests,captures,current};
}
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aelm-visual-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function cleanupAssets(t,controller){t.after(()=>{const dir=controller.store.assets.directory;if(dir&&path.basename(dir).startsWith('aelm-assets-'))fs.rmSync(dir,{recursive:true,force:true});});}
function images(request){return request.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='image_url'):[]);}

test('text-only request shape, archive version and tool list remain unchanged',async()=>{
  const h=harness([response()]);await h.controller.send('Inspect authored controls.');
  assert.equal(h.controller.archive.schemaVersion,1);assert.equal(h.controller.archive.visuals,undefined);
  assert.ok(h.requests[0].messages.every(m=>typeof m.content==='string'));
  assert.equal(h.requests[0].tools.length,2);assert.doesNotMatch(h.requests[0].messages[0].content,/Reference images and captured/);
});
test('references persist in followups, are injected only into request copies, and can be cleared',async t=>{
  const h=harness([response(),response(),response()]);cleanupAssets(t,h.controller);
  await h.controller.setReferences([image()]);await h.controller.send('Use this design.');await h.controller.send('Refine it further.');
  assert.equal(images(h.requests[0]).length,1);assert.equal(images(h.requests[1]).length,1);
  assert.equal(h.controller.archive.visuals.items.length,1);
  assert.equal(h.controller.references.length,0,'composer drafts clear after accepted send');
  assert.equal(fs.readdirSync(h.controller.store.assets.directory).length,1,'content-addressed deduplication');
  assert.ok(h.controller.archive.messages.every(m=>typeof m.content==='string'));
  assert.doesNotMatch(JSON.stringify(h.controller.archive),/data:image|iVBORw0/);
  await h.controller.clearActiveReferences();await h.controller.send('Text only now.');assert.equal(images(h.requests[2]).length,0);
});
test('image references and captures survive Save As without changing the old history or assets',async t=>{
  const dir=temporary(t),h=harness([response()],{projectPath:path.join(dir,'One.aep')});
  await h.controller.syncProject();await h.controller.setReferences([image()]);await h.controller.send('Reference.');
  const oldPath=h.controller.store.path,old=fs.readFileSync(oldPath),oldDir=h.controller.store.assets.directory;
  h.current.projectPath=path.join(dir,'Two.aep');await h.controller.syncProject();
  assert.deepEqual(fs.readFileSync(oldPath),old);
  assert.notEqual(h.controller.store.assets.directory,oldDir);
  const restored=new HistoryStore().bind(h.current.projectPath).archive;assert.equal(restored.schemaVersion,2);assert.equal(restored.visuals.items.length,1);
  assert.deepEqual(h.controller.store.assets.read(restored.visuals.items[0]),png);
});
test('unsaved temporary images are copied when the project first receives a filename',async t=>{
  const dir=temporary(t),h=harness([response()]);await h.controller.setReferences([image()]);await h.controller.send('Use image.');
  const oldDir=h.controller.store.assets.directory;t.after(()=>fs.rmSync(oldDir,{recursive:true,force:true}));
  h.current.projectPath=path.join(dir,'Saved.aep');await h.controller.syncProject();
  assert.ok(h.controller.store.assets.directory.startsWith(path.join(dir,'.aelm')));
  assert.deepEqual(h.controller.store.assets.read(h.controller.archive.visuals.items[0]),png);
});
test('disabled capture cannot dispatch even when a model asks for it or Auto-run is enabled',async()=>{
  const h=harness([response([capture('disabled')]),response()]);h.controller.autoRun=true;await h.controller.send('Check design.');
  assert.equal(h.captures.length,0);assert.equal(h.controller.archive.receipts[0].result.error.code,'capture_disabled');
  assert.equal(h.requests[0].tools.some(t=>t.function.name==='ae_capture_view'),false);
});
test('enabled capture produces a receipt and only its latest image is sent',async t=>{
  const h=harness([response([capture('view-1')]),response([capture('view-2')]),response()]);cleanupAssets(t,h.controller);await h.controller.syncProject();h.controller.viewportAccess=true;
  await h.controller.setReferences([image()]);await h.controller.send('Compare image.');
  assert.equal(h.captures.length,2);assert.equal(images(h.requests[2]).length,2,'one reference plus latest capture');
  assert.equal(h.controller.archive.visuals.items.filter(i=>i.kind==='capture').length,2);
  assert.equal(h.controller.archive.receipts[0].authorization,'viewport-access');assert.equal(h.controller.error,'');
  const messages=h.requests[2].messages;assert.equal(messages[messages.length-1].role,'user');assert.ok(Array.isArray(messages[messages.length-1].content));assert.ok(messages.findIndex(m=>m.tool_call_id==='view-2')<messages.length-1,'visual observation follows its paired tool result');
  assert.equal(validateArchive(h.controller.archive).schemaVersion,2);
});
test('configured three-capture budget includes retry and never replays a previous capture',async t=>{
  const h=harness([response([capture('v1')]),response([capture('v2')]),response([capture('v3')]),new Error('synthetic timeout'),response([capture('v4')])]);cleanupAssets(t,h.controller);await h.controller.syncProject();h.controller.viewportAccess=true;
  h.controller.setMaxCaptures(3);await h.controller.send('Refine the visual.');assert.equal(h.captures.length,3);await h.controller.retry();
  assert.equal(h.captures.length,3);assert.match(h.controller.error,/3 visual checks/);assert.equal(h.controller.archive.receipts[3].result.error.code,'capture_limit');
});
test('restoring image history cannot enable viewport access or replay capture calls',async t=>{
  const dir=temporary(t),projectPath=path.join(dir,'Visual.aep');const h=harness([response([capture('done')]),response()],{projectPath});
  await h.controller.syncProject();h.controller.viewportAccess=true;await h.controller.send('See this.');
  const next=harness([response()],{projectPath});await next.controller.syncProject();assert.equal(next.controller.viewportAccess,false);assert.equal(next.captures.length,0);
  await next.controller.retry();assert.equal(next.captures.length,0);assert.equal(images(next.requests[0]).length,1,'recorded capture bytes are available without recapturing');
});
test('permission revoked during a capture discards its image',async t=>{
  const h=harness([response([capture('revoked')]),response()],{capture:c=>{c.viewportAccess=false;return image();}});cleanupAssets(t,h.controller);await h.controller.syncProject();h.controller.viewportAccess=true;await h.controller.send('Capture.');
  assert.equal(h.captures.length,1);assert.equal(visual.items(h.controller.archive).length,0);assert.equal(h.controller.archive.receipts[0].result.error.code,'cancelled');
});
test('new turns omit old screenshots and reset their capture budget',async t=>{
  const h=harness([response([capture('old')]),response(),response([capture('new')]),response()]);cleanupAssets(t,h.controller);await h.controller.syncProject();h.controller.viewportAccess=true;
  await h.controller.send('Check now.');await h.controller.send('Check this later state.');assert.equal(images(h.requests[2]).length,0);assert.equal(images(h.requests[3]).length,1);assert.equal(h.captures.length,2);
});
test('missing or tampered assets stop a visual request before transport',async t=>{
  const dir=temporary(t),projectPath=path.join(dir,'Missing.aep'),h=harness([response()],{projectPath});await h.controller.syncProject();await h.controller.setReferences([image()]);await h.controller.send('Image.');
  const item=h.controller.archive.visuals.items[0],file=path.join(h.controller.store.assets.directory,h.controller.store.assets.filename(item));fs.writeFileSync(file,Buffer.alloc(png.length));
  const next=harness([response()],{projectPath});await next.controller.syncProject();await next.controller.send('Continue.');assert.equal(next.requests.length,0);assert.match(next.controller.error,/image|Image/);
});
test('manifest rejects path injection, permissions and excessive reference counts',()=>{
  const archive=createArchive();archive.messages=[{role:'user',content:'Image'}];archive.schemaVersion=2;
  const entry=Object.assign({id:'a'+'1'.repeat(32),name:'ref.png',kind:'reference',userTurn:1,createdAt:new Date().toISOString()},visual.imageInfo(png));archive.visuals={version:1,items:[entry]};
  validateArchive(archive);
  for(const extra of [{path:'C:/private.txt'},{viewportAccess:true},{sha256:'../outside'},{name:'../private.png'}]){archive.visuals.items=[Object.assign({},entry,extra)];assert.throws(()=>validateArchive(archive));}
  archive.visuals.items=Array.from({length:4},(_,i)=>Object.assign({},entry,{id:'a'+String(i).repeat(32)}));assert.throws(()=>validateArchive(archive),/Too many/);
});
test('images are validated by bytes and normalized dimension limit, not extension',()=>{
  assert.throws(()=>visual.imageInfo(Buffer.from('<svg><script>bad()</script></svg>')));
  const large=Buffer.from(png);large.writeUInt32BE(10000,16);assert.throws(()=>visual.imageInfo(large));
  assert.throws(()=>visual.imageInfo(Buffer.alloc(visual.MAX_IMAGE_BYTES+1)));
});
test('invalid capture arguments abort the whole model batch before any script',async()=>{
  const h=harness([response([call('edit','ae_run_script',{title:'Modify',source:'return true;'}),call('bad','ae_capture_view',{reason:'Read',path:'C:/private'})])]);h.controller.autoRun=true;await h.controller.send('Check.');assert.equal(h.controller.archive.receipts.length,0);assert.match(h.controller.error,/capture request/);
});
test('explicit cleared reference selection survives reload without returning old images',async t=>{
  const dir=temporary(t),projectPath=path.join(dir,'Clear.aep');const h=harness([response()],{projectPath});await h.controller.syncProject();await h.controller.setReferences([image()]);await h.controller.send('Use reference.');await h.controller.clearActiveReferences();
  const next=harness([response()],{projectPath});await next.controller.syncProject();assert.equal(next.controller.references.length,0);await next.controller.retry();assert.equal(images(next.requests[0]).length,0);
});
test('missing historical image does not prevent Save As or a cleared text-only followup',async t=>{
  const dir=temporary(t),h=harness([response(),response()],{projectPath:path.join(dir,'Old.aep')});await h.controller.syncProject();await h.controller.setReferences([image()]);await h.controller.send('Image turn.');await h.controller.clearActiveReferences();
  const item=h.controller.archive.visuals.items[0];fs.unlinkSync(path.join(h.controller.store.assets.directory,h.controller.store.assets.filename(item)));
  h.current.projectPath=path.join(dir,'New.aep');await h.controller.syncProject();await h.controller.send('Continue in text only.');
  assert.equal(h.controller.error,'');assert.equal(images(h.requests[1]).length,0);assert.match(h.controller.historyStatus,/historical images are unavailable/);assert.equal(h.controller.archive.visuals.items.length,1);
});


test('automatic capture receives native viewer type and records detected-region provenance',async t=>{
  const h=harness([response([capture('auto-view')]),response()],{capture:()=>Object.assign(image('View'),{metadata:{method:'detected-visible-viewer'}})});
  cleanupAssets(t,h.controller);await h.controller.syncProject();h.controller.viewportAccess=true;await h.controller.send('Compare the visible viewer.');
  assert.equal(h.captures.length,1);assert.equal(h.captures[0].viewerType,'composition');
  assert.equal(h.controller.archive.receipts[0].result.data.observation.method,'detected-visible-viewer');
  assert.match(h.controller.archive.receipts[0].result.data.observation.note,/sole detected/);
});
test('failed authored viewer read prevents capture without inventing a target',async()=>{
  const h=harness([response([capture('unavailable-view')]),response()]);await h.controller.syncProject();h.controller.viewportAccess=true;
  h.controller.bridge.inspect=async()=>({ok:false,error:{code:'project_unavailable',message:'Synthetic invalid native handle'}});
  await h.controller.send('Compare the visible viewer.');assert.equal(h.captures.length,0);
  assert.equal(h.controller.archive.receipts[0].result.error.code,'capture_viewer_unavailable');
});
test('viewer changing from Composition to Footage during capture rejects its image',async()=>{
  const h=harness([response([capture('changed-view')]),response()]);await h.controller.syncProject();h.controller.viewportAccess=true;let reads=0;
  h.controller.bridge.inspect=async()=>({ok:true,data:{viewer:{type:++reads===1?'composition':'footage'},comp:null}});
  await h.controller.send('Compare the visible viewer.');assert.equal(h.captures.length,1);
  assert.equal(h.controller.archive.receipts[0].result.error.code,'capture_changed');assert.equal(h.controller.archive.visuals,undefined);
});
