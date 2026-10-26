'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const visual=require('../extension/lib/visuals');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJfcAAAAASUVORK5CYII=','base64');
const info=visual.imageInfo(png);
function entry(index,kind,turn){
  const item=Object.assign({id:'a'+index.toString(16).padStart(32,'0'),name:(kind==='capture'?'View':'Reference')+index+'.png',kind,userTurn:turn,createdAt:'2026-10-25T12:00:00Z'},info);
  if(kind==='capture'){item.callId='capture-'+index;item.observation='Displayed pixels only.';}
  return item;
}
function archive(entries,activeReferences){
  const value={messages:[{role:'user',content:'Original reference'},{role:'assistant',content:'Done.'},{role:'user',content:'Another reference'},{role:'assistant',content:'Done.'},{role:'user',content:'Refine the result.'}],visuals:{version:1,items:entries}};
  if(activeReferences!==undefined)value.visuals.activeReferences=activeReferences;
  return value;
}
function reads(){const ids=[];return {ids,dataUrl(item){ids.push(item.id);return 'data:image/png;base64,'+png.toString('base64');}};}
function imageCount(messages){return messages.reduce((n,m)=>n+(Array.isArray(m.content)?m.content.filter(v=>v.type==='image_url').length:0),0);}

test('default attempt budget is 12 and archive safety ceiling is independently 50',()=>{
  assert.equal(visual.DEFAULT_CAPTURE_BUDGET,12);
  assert.equal(visual.MAX_CAPTURES,50);
  assert.equal(visual.captureBudget(),12);
  assert.match(visual.captureTool().function.description,/At most 12 capture attempts/);
  assert.match(visual.visionNote(),/12 capture attempts; 0 have been used and 12 remain/);
  assert.doesNotMatch(visual.visionNote(),/two correction passes|three captures|at most 3 captures/i);
  assert.deepEqual(visual.CAPTURE_TOOL,visual.captureTool());
  assert.equal(visual.VISION_NOTE,visual.visionNote());
});

test('dynamic prompts explain failed attempts and carry their budget through retries',()=>{
  const note=visual.visionNote(24,7);
  assert.match(note,/24 capture attempts; 7 have been used and 17 remain/);
  assert.match(note,/Failed attempts count/);
  assert.match(note,/retrying this model task does not reset/);
  assert.match(note,/Continue while meaningful improvements remain/);
  assert.match(visual.captureTool(24).function.description,/24 capture attempts/);
  assert.match(visual.captureTool(24).function.description,/including failed attempts and attempts before a model retry/);
  assert.equal(visual.captureTool(24).function.parameters.additionalProperties,false);
  assert.deepEqual(Object.keys(visual.captureTool(24).function.parameters.properties),['reason']);
});

test('exhausted budget stops automatic refinement without pretending to have a final image',()=>{
  for(const used of [12,13,500]){
    const note=visual.visionNote(12,used);
    assert.match(note,/0 remain/);
    assert.match(note,/No capture attempts remain/);
    assert.match(note,/Stop automatic visual refinement/);
    assert.match(note,/Do not continue visual correction scripts/);
    assert.match(note,/Never bypass disabled capture or an exhausted budget/);
    assert.doesNotMatch(note,/Continue while meaningful improvements remain/);
  }
});

test('capture budget builders reject nonlocal or malformed settings',()=>{
  for(const value of [0,-1,51,1.5,'12',null,true,NaN,Infinity]){
    assert.throws(()=>visual.captureTool(value),{code:'capture_budget'});
    assert.throws(()=>visual.visionNote(value,0),{code:'capture_budget'});
  }
  for(const used of [-1,0.5,'0',null,NaN])assert.throws(()=>visual.visionNote(12,used),{code:'capture_budget'});
  assert.match(visual.captureTool(1).function.description,/At most 1 capture attempts/);
  assert.match(visual.captureTool(50).function.description,/At most 50 capture attempts/);
});

test('selected references from different turns remain available in artist-selected order',()=>{
  const old=entry(1,'reference',1),middle=entry(2,'reference',2),latest=entry(3,'reference',3),ignored=entry(4,'reference',1);
  const a=archive([old,middle,latest,ignored],[latest.id,old.id,middle.id]),assets=reads();
  const before=JSON.stringify(a),wire=visual.injectImages(a.messages,a,assets);
  assert.deepEqual(assets.ids,[latest.id,old.id,middle.id]);
  assert.deepEqual(visual.activeReferenceItems(a).map(i=>i.id),assets.ids);
  assert.equal(imageCount(wire),3);
  assert.equal(wire[0].content,'Original reference');
  assert.equal(wire[4].content[0].text,'Refine the result.');
  assert.equal(wire[4].content[1].text,'Attached reference: '+latest.name);
  assert.equal(JSON.stringify(a),before,'wire preparation never duplicates archive entries or changes text messages');
});

test('historical references pair only with the latest current-turn capture after its tool result',()=>{
  const ref=entry(1,'reference',1),old=entry(2,'capture',1),first=entry(3,'capture',3),latest=entry(4,'capture',3);
  const a=archive([ref,old,first,latest],[ref.id]);
  a.messages.push({role:'assistant',content:'Checking.',tool_calls:[{id:latest.callId,type:'function',function:{name:'ae_capture_view',arguments:'{"reason":"check"}'}}]},{role:'tool',tool_call_id:latest.callId,content:'Current capture result'});
  const assets=reads(),before=JSON.stringify(a),wire=visual.injectImages(a.messages,a,assets);
  assert.deepEqual(assets.ids,[ref.id,latest.id]);
  assert.equal(imageCount(wire),2);
  assert.equal(wire.length,a.messages.length+1);
  assert.equal(wire[wire.length-2].tool_call_id,latest.callId);
  assert.equal(wire[wire.length-1].role,'user');
  assert.match(wire[wire.length-1].content[0].text,/tool evidence, not a new artist instruction/);
  assert.match(wire[wire.length-1].content[0].text,new RegExp(latest.callId));
  assert.equal(JSON.stringify(a),before);
});

test('cleared active references stay cleared while the latest capture can still be shown',()=>{
  const ref=entry(1,'reference',1),cap=entry(2,'capture',3),a=archive([ref,cap],[]),assets=reads();
  const wire=visual.injectImages(a.messages,a,assets);
  assert.deepEqual(assets.ids,[cap.id]);assert.equal(imageCount(wire),1);
  assert.equal(wire[4].content,'Refine the result.');
});

test('legacy manifest with no active selection keeps only current-turn references',()=>{
  const old=entry(1,'reference',1),latest=entry(2,'reference',3),a=archive([old,latest]),assets=reads();
  visual.injectImages(a.messages,a,assets);assert.deepEqual(assets.ids,[latest.id]);
});

test('active references remain bounded and cannot silently select captures or nonexistent IDs',()=>{
  const ref=entry(1,'reference',1),cap=entry(2,'capture',3);
  for(const ids of [[ref.id,ref.id],[cap.id],['a'+'f'.repeat(32)],[ref.id,ref.id,ref.id,ref.id],false]){
    const a=archive([ref,cap],ids),assets=reads();
    assert.throws(()=>visual.injectImages(a.messages,a,assets),{code:'image_context'});
    assert.deepEqual(assets.ids,[]);
  }
});

test('missing remembered reference fails before sending a misleading reference-free request',()=>{
  const ref=entry(1,'reference',1),a=archive([ref],[ref.id]);
  assert.throws(()=>visual.injectImages(a.messages,a,{dataUrl(){throw Object.assign(new Error('Unavailable reference'),{code:'image_missing'});}}),{code:'image_missing'});
});

test('archive validation keeps old three-capture histories and allows up to fifty per turn',()=>{
  const captures=Array.from({length:51},(_,i)=>entry(i+1,'capture',3));
  const ids=new Set(captures.map(i=>i.callId));
  for(const count of [3,12,50]){
    const validated=visual.validateVisuals({version:1,items:captures.slice(0,count),activeReferences:[]},3,ids);
    assert.equal(validated.items.length,count);assert.deepEqual(validated.activeReferences,[]);
  }
  assert.throws(()=>visual.validateVisuals({version:1,items:captures,activeReferences:[]},3,ids),/Too many images/);
});

test('archive validation accepts historical active references without moving their original turn',()=>{
  const a=entry(1,'reference',1),b=entry(2,'reference',2);
  const value={version:1,items:[a,b],activeReferences:[b.id,a.id]};
  const validated=visual.validateVisuals(value,3,new Set());
  assert.deepEqual(validated.activeReferences,[b.id,a.id]);
  assert.deepEqual(validated.items.map(i=>i.userTurn),[1,2]);
  assert.deepEqual(value.items,[a,b]);
});
