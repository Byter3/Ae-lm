'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Controller}=require('../extension/lib/controller');
const {HistoryStore,validateArchive}=require('../extension/lib/history');
const FAILED_SOURCE='var target = app.project.activeItem; target.name = "Partially changed"; throw Error("Synthetic hidden property");';
const REPAIR_SOURCE='return {repaired: true};';
const failure={ok:false,error:{code:'script_failed',message:'Synthetic property is hidden; earlier edits may remain.',possiblyModified:true}};
function script(id,source=FAILED_SOURCE){return {id,type:'function',function:{name:'ae_run_script',arguments:JSON.stringify({title:'Synthetic edit',source})}};}
function inspect(id){return {id,type:'function',function:{name:'ae_inspect',arguments:JSON.stringify({scope:'comp',compId:7,offset:0,limit:5})}};}
function capture(id){return {id,type:'function',function:{name:'ae_capture_view',arguments:'{"reason":"Check current appearance"}'}};}
function completion(calls){const message={role:'assistant',content:calls?'Inspect or repair current state.':'Done.'};if(calls)message.tool_calls=calls;return {body:JSON.stringify({choices:[{index:0,message,finish_reason:calls?'tool_calls':'stop'}]}),headers:{'content-type':'application/json'}};}
function setup(responses,options={}){
  const current={projectToken:'synthetic-project',projectPath:'',hostVersion:'26-synthetic'},executions=[],reads=[],requests=[],captures=[];
  const store=new HistoryStore();
  if(options.archive){let first=true;const bind=store.bind.bind(store);store.bind=(project,opts)=>{if(!first)return bind(project,opts);first=false;const archive=validateArchive(options.archive,{restore:true});store.archive=archive;return {archive,path:null,status:'unsaved'};};}
  store.saveAsync=async archive=>{if(options.save)await options.save(validateArchive(archive));return store.save(archive);};
  const bridge={
    identity:async()=>options.identity?options.identity(current,executions):{ok:true,data:{...current}},
    inspect:async args=>{reads.push({...args});return options.inspect?options.inspect(args):{ok:true,data:{comp:{id:7,name:'Partial current state'},layers:[]}};},
    execute:async args=>{executions.push({...args});return options.execute?options.execute(args,current):args.source===FAILED_SOURCE?JSON.parse(JSON.stringify(failure)):{ok:true,data:{repaired:true}};}
  };
  const transport={normalizeBaseUrl:v=>v,request:async args=>{requests.push(JSON.parse(JSON.stringify(args.body)));const response=responses.shift();if(response instanceof Error)throw response;if(!response)throw Error('Synthetic response exhausted');return response;}};
  const controller=new Controller({bridge,store,transport,maxSteps:options.maxSteps||16,captureView:async()=>{captures.push(true);throw Error('Unexpected capture');}});
  controller.configure({baseUrl:'https://studio.test',token:'synthetic-token',model:'synthetic'});controller.autoRun=options.autoRun!==false;
  return {controller,current,executions,reads,requests,captures,store,responses};
}
function toolResult(h,id){return JSON.parse(h.controller.archive.messages.find(m=>m.tool_call_id===id).content);}
function toolNames(request){return request.tools.map(t=>t.function.name);}
async function pending(controller){const end=Date.now()+2000;while(Date.now()<end){if(controller.pending)return controller.pending.id;if(!controller.busy)throw Error(controller.error||'No pending review');await new Promise(r=>setTimeout(r,1));}throw Error('Review timeout');}

test('known failure cancels the remaining batch, inspects live state, then executes a new repair',async()=>{
  const h=setup([completion([script('failed'),script('stale-repair',REPAIR_SOURCE),capture('stale-capture'),inspect('stale-read')]),completion([inspect('fresh-read')]),completion([script('repair',REPAIR_SOURCE)]),completion()]);
  await h.controller.send('Refine current design');
  assert.equal(h.controller.error,'');assert.deepEqual(h.executions.map(e=>e.id),['failed','repair']);assert.equal(h.reads.length,1);assert.equal(h.captures.length,0);
  assert.deepEqual(h.controller.archive.receipts[0].result,failure);assert.equal(h.controller.archive.receipts[0].status,'failed');
  for(const id of ['stale-repair','stale-capture','stale-read'])assert.equal(toolResult(h,id).error.code,'batch_cancelled');
  assert.deepEqual(toolNames(h.requests[1]),['ae_inspect']);assert.ok(toolNames(h.requests[2]).includes('ae_run_script'));validateArchive(h.controller.archive);
});

test('failed inspection leaves recovery locked and cannot authorize a mutation',async()=>{
  const h=setup([completion([script('failed')]),completion([inspect('bad-read')]),completion([script('blocked-repair',REPAIR_SOURCE)]),completion()],{inspect:async()=>({ok:false,error:{code:'inspect_failed',message:'No current target'}})});
  await h.controller.send('Refine');assert.deepEqual(h.executions.map(e=>e.id),['failed']);assert.equal(h.reads.length,1);
  assert.equal(toolResult(h,'blocked-repair').error.code,'recovery_inspection_required');assert.deepEqual(toolNames(h.requests[3]),['ae_inspect']);
});

test('a mixed inspect and mutation response is rejected in full before any call runs',async()=>{
  const h=setup([completion([script('failed')]),completion([inspect('premature-read'),script('premature-repair',REPAIR_SOURCE)]),completion([inspect('fresh-read')]),completion([script('repair',REPAIR_SOURCE)]),completion()]);
  await h.controller.send('Refine');assert.equal(h.reads.length,1);assert.deepEqual(h.executions.map(e=>e.id),['failed','repair']);
  for(const id of ['premature-read','premature-repair'])assert.equal(toolResult(h,id).error.code,'recovery_inspection_required');
});

test('capture never substitutes for the required authored-state inspection',async()=>{
  const h=setup([completion([script('failed')]),completion([capture('premature-capture')]),completion()]);
  await h.controller.send('Refine');assert.equal(h.captures.length,0);assert.equal(h.reads.length,0);assert.equal(toolResult(h,'premature-capture').error.code,'recovery_inspection_required');
});

test('failed source cannot run under a new command ID after inspection',async()=>{
  const h=setup([completion([script('failed')]),completion([inspect('fresh')]),completion([script('new-id')]),completion()]);
  await h.controller.send('Refine');assert.deepEqual(h.executions.map(e=>e.id),['failed']);assert.equal(toolResult(h,'new-id').error.code,'failed_source_replay');
});

test('a successful unrelated script never makes failed source safe to replay',async()=>{
  const h=setup([completion([script('failed')]),completion([inspect('fresh')]),completion([script('diagnostic','return {ok:true};')]),completion([script('replay')]),completion()]);
  await h.controller.send('Refine');assert.deepEqual(h.executions.map(e=>e.id),['failed','diagnostic']);assert.equal(toolResult(h,'replay').error.code,'failed_source_replay');
});

test('retry retains recovery and source protection without redispatching the failed script',async()=>{
  const h=setup([completion([script('failed')]),new Error('Synthetic service interruption')]);
  await h.controller.send('Refine');assert.match(h.controller.error,/service interruption/);
  h.responses.push(completion([inspect('after-retry')]),completion([script('retry-replay')]),completion());await h.controller.retry();
  assert.deepEqual(h.executions.map(e=>e.id),['failed']);assert.deepEqual(toolNames(h.requests[2]),['ae_inspect']);assert.equal(toolResult(h,'retry-replay').error.code,'failed_source_replay');
});

test('reload requires fresh inspection and recomputes failed-source hashes from archived source',async()=>{
  const first=setup([completion([script('failed')]),completion([inspect('old-read')]),completion()]);await first.controller.send('Refine');
  const archive=JSON.parse(JSON.stringify(first.controller.archive));archive.receipts[0].sourceHash='untrusted-wrong-hash';
  const h=setup([completion([script('before-fresh',REPAIR_SOURCE)]),completion([inspect('new-read')]),completion([script('replay-after-reload')]),completion()],{archive});
  await h.controller.send('Continue');assert.deepEqual(h.executions,[]);assert.equal(h.reads.length,1);assert.deepEqual(toolNames(h.requests[0]),['ae_inspect']);
  assert.equal(toolResult(h,'before-fresh').error.code,'recovery_inspection_required');assert.equal(toolResult(h,'replay-after-reload').error.code,'failed_source_replay');
});

test('failed-source protection remains after a successful different script and later reload',async()=>{
  const first=setup([completion([script('failed')]),completion([inspect('read')]),completion([script('different',REPAIR_SOURCE)]),completion()]);await first.controller.send('Refine');
  const archive=JSON.parse(JSON.stringify(first.controller.archive));delete archive.receipts[0].sourceHash;
  const h=setup([completion([script('restored-replay')]),completion()],{archive});await h.controller.send('Continue');
  assert.deepEqual(h.executions,[]);assert.equal(toolResult(h,'restored-replay').error.code,'failed_source_replay');
});

test('unknown dispatch stays terminal and never enters recovery',async()=>{
  const h=setup([completion([script('unknown'),script('later',REPAIR_SOURCE)])],{execute:async()=>{throw Object.assign(new Error('No host result'),{code:'host_timeout',outcome:'unknown'});}});
  await h.controller.send('Refine');assert.equal(h.requests.length,1);assert.equal(h.executions.length,1);assert.equal(h.reads.length,0);assert.equal(h.controller.archive.receipts[0].status,'unknown');assert.match(h.controller.error,/unknown/);
});

test('project switch after known failure hard-stops instead of inspecting a different project',async()=>{
  const h=setup([completion([script('failed'),script('later',REPAIR_SOURCE)])],{execute:async(args,current)=>{current.projectToken='different-project';return failure;}});
  await h.controller.send('Refine');assert.equal(h.requests.length,1);assert.equal(h.executions.length,1);assert.equal(h.reads.length,0);assert.match(h.controller.error,/changed the active project/);
});

test('unconfirmed post-failure identity hard-stops recovery',async()=>{
  const h=setup([completion([script('failed')])],{identity:async(current,executions)=>executions.length?{ok:false,error:{code:'project_unavailable',message:'Unavailable'}}:{ok:true,data:{...current}}});
  await h.controller.send('Refine');assert.equal(h.requests.length,1);assert.equal(h.reads.length,0);assert.match(h.controller.error,/could not be confirmed/);
});

test('failure receipt must be saved before any recovery model request',async()=>{
  let denied=false;const h=setup([completion([script('failed')])],{save:async archive=>{if(!denied&&archive.receipts.some(r=>r.status==='failed')){denied=true;throw Error('Synthetic save denied');}}});
  await h.controller.send('Refine');assert.equal(h.requests.length,1);assert.equal(h.reads.length,0);assert.match(h.controller.error,/save denied/);assert.deepEqual(h.controller.archive.receipts[0].result,failure);
});

test('Stop during failure-result persistence prevents the recovery step',async()=>{
  let h;h=setup([completion([script('failed'),script('later',REPAIR_SOURCE)])],{save:async archive=>{if(archive.receipts.some(r=>r.status==='failed'))h.controller.stop();}});
  await h.controller.send('Refine');assert.equal(h.requests.length,1);assert.equal(h.executions.length,1);assert.equal(h.reads.length,0);
});

test('recovery allows more than three known failures within the existing step budget',async()=>{
  const replies=[];for(let i=1;i<=4;i++){replies.push(completion([script('fail-'+i,'throw Error("Failure '+i+'");')]));replies.push(completion([inspect('inspect-'+i)]));}replies.push(completion([script('repair',REPAIR_SOURCE)]),completion());
  const h=setup(replies,{maxSteps:12,execute:async args=>args.id.startsWith('fail-')?failure:{ok:true,data:{repaired:true}}});
  await h.controller.send('Refine');assert.equal(h.controller.error,'');assert.equal(h.executions.length,5);assert.equal(h.reads.length,4);assert.equal(h.requests.length,10);
});

test('each newly proposed repair still requires manual approval when Auto-run is off',async()=>{
  const h=setup([completion([script('failed')]),completion([inspect('fresh')]),completion([script('repair',REPAIR_SOURCE)]),completion()],{autoRun:false});
  const running=h.controller.send('Refine');assert.equal(await pending(h.controller),'failed');h.controller.decide('failed',true);
  assert.equal(await pending(h.controller),'repair');assert.equal(h.executions.length,1);h.controller.decide('repair',false);await running;
  assert.deepEqual(h.executions.map(e=>e.id),['failed']);assert.equal(h.controller.archive.receipts.at(-1).status,'rejected');assert.equal(h.controller.autoRun,false);
});


test('malformed script-failure flags cannot bypass the inspection gate',async()=>{
  for(const flag of [false,undefined,'true']){
    const reply={ok:false,error:{code:'script_failed',message:'Synthetic incompatible host failure'}};
    if(flag!==undefined)reply.error.possiblyModified=flag;
    const h=setup([completion([script('failed'),script('later',REPAIR_SOURCE)])],{execute:async()=>reply});
    await h.controller.send('Refine');assert.equal(h.requests.length,1);assert.equal(h.executions.length,1);assert.equal(h.reads.length,0);assert.match(h.controller.error,/incompatible script-failure metadata/);
  }
});
