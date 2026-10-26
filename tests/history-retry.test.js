'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {HistoryStore}=require('../extension/lib/history');
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aelm-atomic-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new HistoryStore(), archive=store.bind(path.join(dir,'Shot.aep')).archive;
  archive.messages.push({role:'user',content:'Original'});store.save(archive);
  const old=fs.readFileSync(store.path),baseline=store.baselineHash;
  archive.messages.push({role:'assistant',content:'New receipt'});
  return {store,archive,old,baseline,dir};
}
function intercept(t,callback){const original=fs.rename;fs.rename=callback(original);t.after(()=>{fs.rename=original;});}
for(const code of ['EPERM','EBUSY','EACCES'])test('atomic async save retries transient '+code+' while the event loop stays responsive',async t=>{
  const s=setup(t);let attempts=0,ticked=false;
  intercept(t,original=>(from,to,done)=>{
    attempts++;assert.equal(fs.existsSync(to+'.lock'),true);
    if(attempts===1){assert.deepEqual(fs.readFileSync(to),s.old);return setImmediate(()=>done(Object.assign(new Error('Synthetic busy file'),{code})));}
    assert.equal(ticked,true);original(from,to,done);
  });
  const timer=setTimeout(()=>{ticked=true;},5);t.after(()=>clearTimeout(timer));
  const result=await s.store.saveAsync(s.archive);
  assert.equal(result.status,'saved');assert.equal(attempts,2);assert.notDeepEqual(fs.readFileSync(s.store.path),s.old);
  assert.equal(fs.existsSync(s.store.path+'.lock'),false);assert.equal(s.store._saving,false);
});

test('persistent Windows rename failure preserves old bytes and baseline after six attempts',async t=>{
  const s=setup(t);let attempts=0;
  intercept(t,()=> (from,to,done)=>{attempts++;setImmediate(()=>done(Object.assign(new Error('Synthetic persistent sharing failure'),{code:'EPERM'})));});
  await assert.rejects(s.store.saveAsync(s.archive),error=>error.code==='history_write_failed'&&error.causeCode==='EPERM');
  assert.equal(attempts,6);assert.deepEqual(fs.readFileSync(s.store.path),s.old);assert.equal(s.store.baselineHash,s.baseline);
  assert.deepEqual(fs.readdirSync(path.dirname(s.store.path)),[path.basename(s.store.path)]);assert.equal(s.store._saving,false);
});

test('a noncooperating writer during a retry is detected before another rename',async t=>{
  const s=setup(t);let attempts=0;const external=Buffer.from('{"external":"changed while our lock was held"}\n');
  intercept(t,()=> (from,to,done)=>{attempts++;fs.writeFileSync(to,external);setImmediate(()=>done(Object.assign(new Error('Busy'),{code:'EBUSY'})));});
  await assert.rejects(s.store.saveAsync(s.archive),{code:'history_conflict'});
  assert.equal(attempts,1);assert.deepEqual(fs.readFileSync(s.store.path),external);assert.equal(s.store.baselineHash,s.baseline);
  assert.equal(fs.existsSync(s.store.path+'.lock'),false);
});

test('unsupported rename errors fail immediately without replacement',async t=>{
  const s=setup(t);let attempts=0;
  intercept(t,()=> (from,to,done)=>{attempts++;setImmediate(()=>done(Object.assign(new Error('No space'),{code:'ENOSPC'})));});
  await assert.rejects(s.store.saveAsync(s.archive),{code:'ENOSPC'});assert.equal(attempts,1);assert.deepEqual(fs.readFileSync(s.store.path),s.old);
});

test('an async commit prevents rebinding or another save on the same store',async t=>{
  const s=setup(t);let complete;
  intercept(t,original=>(from,to,done)=>{complete=()=>original(from,to,done);});
  const writing=s.store.saveAsync(s.archive);
  assert.throws(()=>s.store.bind(path.join(s.dir,'Other.aep')),{code:'history_locked'});
  assert.throws(()=>s.store.save(s.archive),{code:'history_locked'});
  await assert.rejects(s.store.saveAsync(s.archive),{code:'history_locked'});
  complete();await writing;assert.equal(s.store.path.endsWith('Shot.aep.json'),true);
});


test('cleanup failure after commit returns saved with a warning and keeps the new baseline',async t=>{
  const s=setup(t),unlink=fs.unlinkSync;
  fs.unlinkSync=file=>{if(file===s.store.path+'.lock')throw Object.assign(new Error('Synthetic lock cleanup denied'),{code:'EPERM'});return unlink(file);};
  let result;
  try { result=await s.store.saveAsync(s.archive); } finally { fs.unlinkSync=unlink; }
  assert.equal(result.status,'saved');assert.match(result.warning,/History was saved/);
  assert.notDeepEqual(fs.readFileSync(s.store.path),s.old);assert.notEqual(s.store.baselineHash,s.baseline);
  assert.equal(s.store._saving,false);assert.equal(fs.existsSync(s.store.path+'.lock'),true);
  unlink(s.store.path+'.lock');
  await s.store.saveAsync(s.archive);
});
