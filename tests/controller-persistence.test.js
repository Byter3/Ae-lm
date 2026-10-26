'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Controller}=require('../extension/lib/controller');
const {HistoryStore,validateArchive}=require('../extension/lib/history');
function script(id){return {id,type:'function',function:{name:'ae_run_script',arguments:JSON.stringify({title:'Synthetic edit',source:'return {edited:true};'})}};}
function completion(calls){return {body:JSON.stringify({choices:[{index:0,message:calls?{role:'assistant',content:'Proposed.',tool_calls:calls}:{role:'assistant',content:'Done.'},finish_reason:calls?'tool_calls':'stop'}]}),headers:{'content-type':'application/json'}};}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function waitFor(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error('Test boundary not reached');await new Promise(r=>setTimeout(r,1));}}
function setup(options={}){
  const current={projectToken:'synthetic-1',projectPath:'',hostVersion:'26-synthetic'},executions=[],saves=[];
  const store=new HistoryStore();
  store.saveAsync=async archive=>{const copy=validateArchive(archive);saves.push(copy);if(options.save)await options.save(copy);return store.save(copy);};
  const responses=options.responses||[completion([script('first'),script('second')]),completion()];
  const bridge={identity:async()=>({ok:true,data:{...current}}),inspect:async()=>({ok:true,data:{}}),execute:async args=>{executions.push(args.id);return options.execute?options.execute(args):{ok:true,data:{edited:true}};}};
  const transport={normalizeBaseUrl:v=>v,request:async()=>{const next=responses.shift();if(!next)throw Error('No synthetic response');return next;}};
  const controller=new Controller({bridge,store,transport});controller.configure({baseUrl:'https://studio.test',token:'synthetic',model:'synthetic'});controller.autoRun=true;
  return {controller,executions,current,saves,responses};
}
function receipt(a){return a.receipts.find(r=>r.id==='first');}
function savedError(){return Object.assign(new Error('Synthetic history replacement denied'),{code:'history_write_failed'});}

test('failure saving a proposal records not dispatched, not unknown, and cancels the remaining batch',async()=>{
  let failed=false;const h=setup({save:a=>{if(!failed&&receipt(a)?.status==='proposed'){failed=true;throw savedError();}}});
  await h.controller.send('Apply two edits');
  assert.deepEqual(h.executions,[]);assert.equal(receipt(h.controller.archive).status,'failed');assert.equal(receipt(h.controller.archive).result.error.code,'history_save_failed');
  assert.equal(receipt(h.controller.archive).result.error.possiblyModified,false);assert.equal(receipt(h.controller.archive).startedAt,undefined);
  const second=h.controller.archive.messages.find(m=>m.tool_call_id==='second');assert.equal(JSON.parse(second.content).error.code,'cancelled');
  assert.equal(validateArchive(h.controller.archive,{restore:true}).receipts[0].status,'failed');
  await h.controller.retry();assert.deepEqual(h.executions,[]);
});

test('failure saving running intent cannot imply a host dispatch occurred',async()=>{
  let failed=false;const h=setup({save:a=>{if(!failed&&receipt(a)?.status==='running'){failed=true;throw savedError();}}});
  await h.controller.send('Apply');const r=receipt(h.controller.archive);
  assert.deepEqual(h.executions,[]);assert.equal(r.status,'failed');assert.equal(r.result.error.code,'not_dispatched');assert.equal(r.result.error.possiblyModified,false);assert.equal(r.startedAt,undefined);
});

test('Stop while saving the proposal does not create a pending review afterward',async()=>{
  const gate=deferred();let reached=false;const h=setup({save:a=>{if(receipt(a)?.status==='proposed'&&!reached){reached=true;return gate.promise;}}});h.controller.autoRun=false;
  const task=h.controller.send('Review');await waitFor(()=>reached);h.controller.stop();gate.resolve();await task;
  assert.deepEqual(h.executions,[]);assert.equal(h.controller.pending,null);assert.equal(receipt(h.controller.archive).status,'cancelled');
});

test('Stop during running-intent save prevents dispatch after the delayed commit',async()=>{
  const gate=deferred();let reached=false;const h=setup({save:a=>{if(receipt(a)?.status==='running'&&!reached){reached=true;return gate.promise;}}});
  const task=h.controller.send('Apply');await waitFor(()=>reached);h.controller.stop();gate.resolve();await task;
  assert.deepEqual(h.executions,[]);assert.equal(receipt(h.controller.archive).status,'cancelled');assert.equal(receipt(h.controller.archive).result.error.possiblyModified,false);
});

test('project switch during running-intent save prevents dispatch into either project',async()=>{
  const gate=deferred();let reached=false;const h=setup({save:a=>{if(receipt(a)?.status==='running'&&!reached){reached=true;return gate.promise;}}});
  const task=h.controller.send('Apply');await waitFor(()=>reached);h.current.projectToken='synthetic-2';gate.resolve();await task;
  assert.deepEqual(h.executions,[]);assert.equal(receipt(h.controller.archive).status,'failed');assert.equal(receipt(h.controller.archive).result.error.code,'not_dispatched');assert.match(h.controller.error,/project changed/);
});

test('a genuine dispatched unknown remains unknown and is never replayed on model retry',async()=>{
  const h=setup({execute:async()=>{throw Object.assign(new Error('Unknown host result'),{code:'host_timeout',outcome:'unknown'});}});
  await h.controller.send('Apply');assert.deepEqual(h.executions,['first']);assert.equal(receipt(h.controller.archive).status,'unknown');
  assert.equal(validateArchive(h.controller.archive,{restore:true}).receipts[0].status,'unknown');await h.controller.retry();assert.deepEqual(h.executions,['first']);
});

test('post-execution save failure preserves the completed in-memory receipt and stops the batch',async()=>{
  let failed=false;const h=setup({save:a=>{if(!failed&&receipt(a)?.status==='completed'){failed=true;throw savedError();}}});
  await h.controller.send('Apply');assert.deepEqual(h.executions,['first']);const r=receipt(h.controller.archive);assert.equal(r.status,'completed');assert.deepEqual(r.result,{ok:true,data:{edited:true}});
  await h.controller.retry();assert.deepEqual(h.executions,['first']);assert.equal(r.status,'completed');
});

test('a later batch command waits until the first completed receipt is durably saved',async()=>{
  const gate=deferred();let reached=false;const h=setup({save:a=>{if(!reached&&receipt(a)?.status==='completed'){reached=true;return gate.promise;}}});
  const task=h.controller.send('Apply');await waitFor(()=>reached);assert.deepEqual(h.executions,['first']);gate.resolve();await task;
  assert.deepEqual(h.executions,['first','second']);assert.equal(h.controller.error,'');
});

test('synchronous fake stores remain supported by awaited persistence',async()=>{
  const h=setup({responses:[completion()]});h.controller.store.saveAsync=undefined;
  await h.controller.send('Text only');assert.equal(h.controller.error,'');assert.equal(h.controller.archive.messages.length,2);
});
