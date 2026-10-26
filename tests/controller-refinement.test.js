'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Controller}=require('../extension/lib/controller');
const {HistoryStore,validateArchive}=require('../extension/lib/history');
const visual=require('../extension/lib/visuals');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJfcAAAAASUVORK5CYII=','base64');
function image(name){return {bytes:Buffer.from(png),mime:'image/png',name:name||'Reference.png'};}
function tool(id,name,args){return {id,type:'function',function:{name,arguments:JSON.stringify(args)}};}
function capture(id){return tool(id,'ae_capture_view',{reason:'Inspect iteration '+id});}
function script(id){return tool(id,'ae_run_script',{title:'Refine '+id,source:'return {iteration:'+JSON.stringify(id)+'};'});}
function response(calls,content){const message={role:'assistant',content:content||(calls?'Next focused step.':'Requested result achieved.')};if(calls)message.tool_calls=calls;return {body:JSON.stringify({choices:[{message,finish_reason:calls?'tool_calls':'stop'}]}),headers:{'content-type':'application/json'}};}
function images(body){return body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(part=>part.type==='image_url'):[]);}
function setup(t,responses,options){
  const opts=options||{},requests=[],executions=[],captures=[],store=new HistoryStore();
  const current={projectToken:'synthetic-project',projectPath:'',hostVersion:'26.5'};
  let state;
  const bridge={identity:async()=>({ok:true,data:Object.assign({},current)}),inspect:async()=>{
    if(opts.inspect)await opts.inspect(state);
    return {ok:true,data:{viewer:{type:'composition'},comp:{id:1,name:'Synthetic',time:0,frameRate:24,width:1920,height:1080}}};
  },execute:async args=>{executions.push(args);return {ok:true,data:{changed:true}};}};
  const controller=new Controller({bridge,store,maxCaptures:opts.maxCaptures,maxSteps:opts.maxSteps,captureView:async args=>{
    captures.push(args);if(opts.capture)return opts.capture(state);return Object.assign(image('Visible'),{metadata:{method:'detected-visible-viewer'}});
  },transport:{normalizeBaseUrl:x=>x,request:async args=>{
    requests.push(JSON.parse(JSON.stringify(args.body)));if(opts.request)await opts.request(state);
    const next=responses.shift();if(next instanceof Error)throw next;if(!next)throw new Error('Synthetic response queue exhausted');return next;
  }}});
  controller.configure({baseUrl:'https://studio.test',token:'synthetic',model:'test'});
  state={controller,store,bridge,current,requests,executions,captures};
  t.after(()=>{const directory=store.assets.directory;if(directory&&path.basename(directory).startsWith('aelm-assets-'))fs.rmSync(directory,{recursive:true,force:true});});
  return state;
}
async function enable(state){await state.controller.syncProject();state.controller.viewportAccess=true;state.controller.autoRun=true;}

test('default visual task completes twelve edit/check cycles beyond the former 24-step ceiling',async t=>{
  const queue=[];for(let i=1;i<=12;i++)queue.push(response([script('edit-'+i)]),response([capture('view-'+i)]));queue.push(response());
  const h=setup(t,queue);await enable(h);await h.controller.send('Refine with repeated visual checks until the result is achieved.');
  assert.equal(h.controller.error,'');assert.equal(h.executions.length,12);assert.equal(h.captures.length,12);
  assert.equal(h.requests.length,25,'the final summary is reached after twelve separate edits and checks');
  assert.equal(h.controller.archive.messages.at(-1).content,'Requested result achieved.');
  assert.equal(h.controller.archive.visuals.items.length,12,'all observed captures remain in the full archive');
  assert.equal(images(h.requests.at(-1)).length,1,'only the latest screenshot is sent to the model');
  assert.match(h.requests.at(-1).messages[0].content,/12 have been used and 0 remain/);
  assert.equal(validateArchive(h.controller.archive).visuals.items.length,12);
});

test('configured capture budget counts failed attempts across model retry and does not replay successful work',async t=>{
  const queue=[response([capture('view-1')]),response([capture('view-2')]),new Error('Synthetic model outage'),response([capture('view-3')]),response([capture('view-4')]),response([capture('view-5'),script('must-not-run')])];
  const h=setup(t,queue,{maxCaptures:4,capture:s=>{if(s.captures.length===2)throw Object.assign(new Error('Synthetic covered viewer'),{code:'capture_occluded'});return image('View');}});
  await enable(h);await h.controller.send('Compare and refine.');
  assert.match(h.controller.error,/Synthetic model outage/);assert.equal(h.captures.length,2);
  await h.controller.retry();
  assert.equal(h.captures.length,4,'two new attempts were allowed, and old attempts were not replayed');
  assert.equal(h.executions.length,0,'the command after the exhausted capture is not executed');
  assert.match(h.controller.error,/4 visual checks/);
  assert.match(h.requests[3].messages[0].content,/2 have been used and 2 remain/);
  assert.equal(images(h.requests[3]).length,1,'retry reuses the previous successful observed image');
  assert.equal(h.controller.archive.visuals.items.length,3,'the failed capture has no fabricated image');
  assert.equal(h.controller.archive.receipts.filter(r=>r.authorization==='viewport-access').length,4);
  assert.equal(h.controller.archive.receipts.find(r=>r.id==='view-5').result.error.code,'capture_limit');
  assert.equal(h.controller.archive.messages.filter(m=>m.role==='user').length,1);
  assert.match(h.controller.archive.messages.find(m=>m.tool_call_id==='must-not-run').content,/Do not replay/);
});

test('revoking viewport permission during asynchronous intent save prevents capture dispatch',async t=>{
  let inspections=0;
  const h=setup(t,[response([capture('cancelled-save')]),response()],{inspect:()=>{inspections++;}});await enable(h);
  const save=h.store.saveAsync.bind(h.store);let revoked=false;
  h.store.saveAsync=async archive=>{
    if(!revoked&&archive.receipts.some(r=>r.kind==='capture'&&r.status==='running'&&r.authorization==='viewport-access')){
      revoked=true;await new Promise(resolve=>setImmediate(resolve));h.controller.viewportAccess=false;
    }
    return save(archive);
  };
  await h.controller.send('Check the viewer.');
  assert.equal(revoked,true);assert.equal(inspections,0);assert.equal(h.captures.length,0);
  assert.equal(h.controller.archive.receipts[0].result.error.code,'cancelled');
  assert.equal(visual.items(h.controller.archive).length,0);
});

test('revoking viewport permission during authored viewer inspection prevents the later screenshot',async t=>{
  const h=setup(t,[response([capture('cancelled-inspect')]),response()],{inspect:async s=>{
    await new Promise(resolve=>setImmediate(resolve));s.controller.viewportAccess=false;
  }});await enable(h);await h.controller.send('Check the viewer.');
  assert.equal(h.captures.length,0);assert.equal(visual.items(h.controller.archive).length,0);
  assert.equal(h.controller.archive.receipts[0].result.error.code,'cancelled');
});

test('accepted attachment leaves composer immediately and remains in context without archive duplication',async t=>{
  const h=setup(t,[new Error('Synthetic model outage'),response(),response(),response()],{request:s=>assert.equal(s.controller.references.length,0,'accepted draft is cleared before transport starts')});
  await h.controller.setReferences([image('Original.png')]);await h.controller.send('Match this reference.');
  const first=h.controller.archive.visuals.items[0];
  assert.match(h.controller.error,/Synthetic model outage/);assert.equal(h.controller.references.length,0);
  assert.deepEqual(h.controller.activeReferences().map(i=>i.id),[first.id]);
  await h.controller.retry();await h.controller.send('Make the details finer.');
  assert.equal(h.controller.archive.visuals.items.length,1,'retry and follow-up reuse the original entry');
  assert.ok(h.requests.slice(0,3).every(body=>images(body).length===1));
  assert.match(JSON.stringify(h.requests[2].messages),/Attached reference: Original.png/);
  await h.controller.setReferences([image('Replacement.png')]);await h.controller.send('Use this new direction.');
  assert.equal(h.controller.archive.visuals.items.length,2);assert.equal(h.controller.activeReferences().length,1);
  assert.notEqual(h.controller.activeReferences()[0].id,first.id);
  assert.match(JSON.stringify(h.requests[3].messages),/Attached reference: Replacement.png/);
  assert.doesNotMatch(JSON.stringify(h.requests[3].messages),/Attached reference: Original.png/);
  assert.equal(images(h.requests[3]).length,1);assert.equal(h.controller.references.length,0);
});

test('preflight save failure preserves draft and rolls back acceptance so retry creates one reference entry',async t=>{
  const h=setup(t,[response()]);await h.controller.setReferences([image('Keep me.png')]);
  const save=h.store.saveAsync.bind(h.store);let failed=false;
  h.store.saveAsync=async archive=>{
    if(!failed&&archive.visuals&&archive.messages.some(m=>m.role==='user')){failed=true;throw Object.assign(new Error('Synthetic preflight replacement failure'),{code:'EPERM'});}
    return save(archive);
  };
  await h.controller.send('This draft must survive.');
  assert.equal(h.requests.length,0);assert.equal(h.controller.references.length,1);
  assert.equal(h.controller.archive.messages.length,0);assert.equal(h.controller.archive.visuals,undefined);
  assert.match(h.controller.error,/Synthetic preflight replacement failure/);
  await h.controller.send('This draft must survive.');
  assert.equal(h.requests.length,1);assert.equal(h.controller.references.length,0);
  assert.equal(h.controller.archive.visuals.items.length,1);assert.equal(images(h.requests[0]).length,1);
});

test('post-dispatch save failure stops the batch and model retry consumes the recorded result without replay',async t=>{
  const h=setup(t,[response([script('completed-edit'),script('not-dispatched')]),response()]);await enable(h);
  const save=h.store.saveAsync.bind(h.store);let failed=false;
  h.store.saveAsync=async archive=>{
    if(!failed&&archive.receipts.some(r=>r.id==='completed-edit'&&r.status==='completed')){failed=true;throw Object.assign(new Error('Synthetic post-result save failure'),{code:'EPERM'});}
    return save(archive);
  };
  await h.controller.send('Perform the refinement.');
  assert.equal(h.executions.length,1);assert.match(h.controller.error,/Synthetic post-result save failure/);
  assert.equal(h.controller.archive.receipts[0].status,'completed');
  await h.controller.retry();
  assert.equal(h.executions.length,1);assert.equal(h.controller.error,'');
  assert.ok(h.requests[1].messages.some(m=>m.tool_call_id==='completed-edit'&&JSON.parse(m.content).ok===true));
  assert.match(h.requests[1].messages.find(m=>m.tool_call_id==='not-dispatched').content,/Do not replay/);
});

test('capture budgets remain local configuration and cannot be raised above fifty',async t=>{
  const h=setup(t,[response()]);assert.equal(h.controller.maxCaptures,12);
  h.controller.setMaxCaptures(50);assert.equal(h.controller.maxCaptures,50);
  for(const value of [51,0,'50',NaN])assert.throws(()=>h.controller.setMaxCaptures(value),{code:'capture_budget'});
  await h.controller.send('Read authored state only.');
  assert.equal(h.controller.viewportAccess,false);assert.equal(h.captures.length,0);
  assert.doesNotMatch(JSON.stringify(h.controller.archive),/maxCaptures|viewportAccess|captureBudget/);
  assert.equal(h.requests[0].tools.some(tool=>tool.function.name==='ae_capture_view'),false);
});

test('permission revoked during post-capture inspection discards the captured pixels',async t=>{
  let reads=0;
  const h=setup(t,[response([capture('revoked-after-pixels')]),response()],{inspect:async s=>{
    if(++reads===2){await new Promise(resolve=>setImmediate(resolve));s.controller.viewportAccess=false;}
  }});await enable(h);await h.controller.send('Inspect the visible result.');
  assert.equal(h.captures.length,1,'the already-started capture itself cannot be undone');
  assert.equal(visual.items(h.controller.archive).length,0,'revoked pixels must not enter history or model context');
  assert.equal(h.controller.archive.receipts[0].result.error.code,'cancelled');
  assert.equal(images(h.requests.at(-1)).length,0);
});

test('project switch during post-capture inspection prevents attaching pixels to the previous project',async t=>{
  let reads=0;
  const h=setup(t,[response([capture('switched-after-pixels')]),response()],{inspect:async s=>{
    if(++reads===2)s.current.projectToken='different-project';
  }});await enable(h);await h.controller.send('Inspect the visible result.');
  assert.equal(h.captures.length,1);assert.equal(visual.items(h.controller.archive).length,0);
  assert.equal(h.controller.archive.receipts[0].status,'failed');
  assert.equal(h.requests.every(body=>images(body).length===0),true);
});

test('send acceptance callback fires once only after durable user-turn acceptance, never on model retry',async t=>{
  const h=setup(t,[new Error('Synthetic model failure after acceptance'),response()]);
  await h.controller.setReferences([image('Pending.png')]);
  const save=h.store.saveAsync.bind(h.store);let fail=true,accepted=0;
  h.store.saveAsync=async archive=>{
    if(fail&&archive.visuals&&archive.messages.some(m=>m.role==='user')){fail=false;throw new Error('Synthetic preflight failure');}
    return save(archive);
  };
  const onAccepted=()=>{
    accepted++;
    assert.equal(h.controller.references.length,0);
    assert.equal(h.store.archive.messages.filter(m=>m.role==='user').length,1,'the accepted turn has been saved');
    assert.equal(h.store.archive.visuals.items.length,1);
  };
  await h.controller.send('Keep this draft.',onAccepted);assert.equal(accepted,0);assert.equal(h.controller.references.length,1);
  await h.controller.send('Keep this draft.',onAccepted);assert.equal(accepted,1);
  assert.match(h.controller.error,/Synthetic model failure after acceptance/);
  await h.controller.retry();assert.equal(accepted,1);assert.equal(h.controller.error,'');
  assert.equal(h.controller.archive.messages.filter(m=>m.role==='user').length,1);
});
