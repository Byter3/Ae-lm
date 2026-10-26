'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../extension/host/aelm.jsx'),'utf8');
function fixture(){
  const context=vm.createContext({});
  vm.runInContext(`
    var live={file:{fsName:'C:/synthetic/shot.aep'}}, current=live, reads=0, edits=0;
    var app={version:'26.5-synthetic',beginUndoGroup:function(){},endUndoGroup:function(){}};
    Object.defineProperty(app,'project',{configurable:true,get:function(){reads++;return current;}});
  `,context);
  vm.runInContext(source,context);
  return {run:s=>vm.runInContext(s,context),reload:()=>vm.runInContext(source,context),call:(method,args)=>JSON.parse(vm.runInContext('AELM.dispatch('+JSON.stringify(method)+','+JSON.stringify(JSON.stringify(args||{}))+')',context))};
}

test('startup identity reads Project and File getters once instead of touching an invalid second handle',()=>{
  const h=fixture();
  h.run(`var fileReads=0;Object.defineProperty(live,'file',{configurable:true,get:function(){fileReads++;if(fileReads>1)throw new ReferenceError('Object is invalid');return {fsName:'C:/synthetic/shot.aep'};}});`);
  const result=h.call('identity');
  assert.equal(result.ok,true);assert.equal(result.data.projectPath,'C:/synthetic/shot.aep');assert.equal(h.run('reads'),1);assert.equal(h.run('fileReads'),1);
});

test('an invalid first native Project handle is reacquired once without changing the scene',()=>{
  const h=fixture();
  h.run(`var stale={};Object.defineProperty(stale,'file',{get:function(){throw new ReferenceError('Object is invalid');}});Object.defineProperty(app,'project',{get:function(){reads++;return reads===1?stale:live;}});`);
  const result=h.call('identity');assert.equal(result.ok,true);assert.equal(result.data.projectPath,'C:/synthetic/shot.aep');assert.equal(h.run('reads'),2);assert.equal(h.run('edits'),0);
});

test('a stale File wrapper is retried from a fresh project snapshot without caching its invalid path',()=>{
  const h=fixture();
  h.run(`var fileReads=0, staleFile={};Object.defineProperty(staleFile,'fsName',{get:function(){throw new ReferenceError('Object is invalid');}});Object.defineProperty(live,'file',{get:function(){fileReads++;return fileReads===1?staleFile:{fsName:'C:/synthetic/shot.aep'};}});`);
  const result=h.call('identity');assert.equal(result.ok,true);assert.equal(result.data.projectPath,'C:/synthetic/shot.aep');assert.equal(h.run('reads'),2);assert.equal(h.run('fileReads'),2);
});

test('a persistent invalid handle is a bounded unavailable error, not an invented empty project',()=>{
  const h=fixture(),token=h.call('identity').data.projectToken;
  h.run(`reads=0;var stale={};Object.defineProperty(stale,'file',{get:function(){throw new ReferenceError('Object is invalid');}});current=stale;`);
  const result=h.call('identity');assert.equal(result.ok,false);assert.equal(result.error.code,'project_unavailable');assert.equal(result.data,undefined);assert.equal(h.run('reads'),2);assert.match(result.error.message,/not substituted an unsaved/);
  h.run('current=live');assert.equal(h.call('identity').data.projectToken,token,'failed snapshots must not replace the last valid project identity');
});

test('recovery to a different project changes the token and rejects a stale edit target',()=>{
  const h=fixture(),token=h.call('identity').data.projectToken;
  h.run(`var old=live;Object.defineProperty(old,'file',{get:function(){throw new ReferenceError('Object is invalid');}});current={file:{fsName:'C:/synthetic/new.aep'}};`);
  const next=h.call('identity');assert.equal(next.ok,true);assert.notEqual(next.data.projectToken,token);
  const edit=h.call('execute',{id:'stale-target',expectedProjectToken:token,source:'edits++;return true;'});assert.equal(edit.error.code,'project_changed');assert.equal(h.run('edits'),0);
});

test('invalid startup recovery and host reload retain consumed execution IDs',()=>{
  const h=fixture(),token=h.call('identity').data.projectToken;
  const args={id:'once',expectedProjectToken:token,source:'edits++;return edits;'};
  assert.equal(h.call('execute',args).ok,true);
  h.run(`var stale={};Object.defineProperty(stale,'file',{get:function(){throw new ReferenceError('Object is invalid');}});current=stale;`);
  assert.equal(h.call('identity').error.code,'project_unavailable');h.run('current=live');h.reload();assert.equal(h.call('identity').data.projectToken,token);
  assert.equal(h.call('execute',args).error.code,'already_consumed');assert.equal(h.run('edits'),1);
});

test('genuinely unsaved and closed-project states remain valid explicit null paths',()=>{
  const h=fixture();h.run('current={file:null}');const unsaved=h.call('identity');assert.equal(unsaved.ok,true);assert.equal(unsaved.data.projectPath,null);
  h.run('current=null');const closed=h.call('identity');assert.equal(closed.ok,true);assert.equal(closed.data.projectPath,null);assert.notEqual(closed.data.projectToken,unsaved.data.projectToken);
});
