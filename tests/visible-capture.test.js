'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {createVisibleCapture} = require('../extension/lib/visible-capture');

function region() {
  return {processId: 1234, processStartTicks: '638960000000000000', windowHandle: '918822',
    windowRect: {x: 0, y: 0, width: 1920, height: 1080}, clientRect: {x: 0, y: 24, width: 1920, height: 1056},
    captureRect: {x: 100, y: 200, width: 960, height: 540}};
}
function image() {
  const buffer = Buffer.alloc(32);
  Buffer.from('89504e470d0a1a0a','hex').copy(buffer);
  buffer.writeUInt32BE(960, 16); buffer.writeUInt32BE(540,20);
  return {ok: true, imageBase64: buffer.toString('base64'), mime: 'image/png',
    metadata: {method:'selected-visible-region',capturedAt:'2026-10-25T18:00:00.000Z',width:960,height:540,sourceWidth:960,sourceHeight:540}};
}
function harness(results) {
  const calls=[];
  const spawn=(executable,args,options)=>{
    const child=new EventEmitter();
    child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
    child.kill=()=>{ child.killed=true; };
    const call={executable,args,options,child,input:''}; calls.push(call);
    child.stdin.on('data',chunk=>{ call.input+=chunk.toString(); });
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      const result=results.shift();
      if (typeof result==='function') { result(call); return; }
      child.stdout.write(JSON.stringify(result));
      child.emit('close',result.ok ? 0 : 1);
    }));
    return child;
  };
  return {calls,adapter:createVisibleCapture({platform:'win32',spawn,helperPath:'C:\\extension\\capture\\visible-capture.ps1',systemRoot:'C:\\Windows'})};
}

test('automatic capture requires trusted composition viewer hint',async()=>{
  const h=harness([]);
  await assert.rejects(h.adapter.capture(),{code:'capture_viewer_type'});
  assert.equal(h.calls.length,0);
});
test('selects and captures through a fixed hidden child, with bounded metadata',async()=>{
  const pic=image(); pic.metadata.privateWindowTitle='not forwarded';
  const h=harness([{ok:true,region:region()},pic]);
  assert.deepEqual(await h.adapter.selectRegion(),{selected:true,sourceWidth:960,sourceHeight:540});
  const result=await h.adapter.capture();
  assert(Buffer.isBuffer(result.bytes)); assert.equal(result.mime,'image/png');
  assert(!('privateWindowTitle' in result.metadata));
  assert.equal(h.calls[0].options.windowsHide,true); assert.equal(h.calls[0].options.shell,false);
  assert.equal(h.calls[0].args.at(-1),'select'); assert.equal(h.calls[1].args.at(-1),'capture');
  assert.equal(JSON.parse(h.calls[1].input).region.processId,1234);
  assert.equal(JSON.parse(h.calls[1].input).maxWidth,1280);
});
test('selection is session-only and clear prevents later capture',async()=>{
  const h=harness([{ok:true,region:region()}]);
  await h.adapter.selectRegion(); assert.equal(h.adapter.hasRegion(),true);
  h.adapter.clearRegion(); assert.equal(h.adapter.hasRegion(),false);
  await assert.rejects(h.adapter.capture(),{code:'capture_viewer_type'});
});
test('invalid window clears region and never falls back to a desktop capture',async()=>{
  const h=harness([{ok:true,region:region()},{ok:false,code:'capture_window_changed'}]);
  await h.adapter.selectRegion();
  await assert.rejects(h.adapter.capture(),{code:'capture_window_changed'});
  assert.equal(h.adapter.hasRegion(),false); assert.equal(h.calls.length,2);
});
test('foreground and occlusion failure retain selection but do not retry',async()=>{
  const h=harness([{ok:true,region:region()},{ok:false,code:'capture_foreground'},{ok:false,code:'capture_occluded'}]);
  await h.adapter.selectRegion();
  await assert.rejects(h.adapter.capture(),{code:'capture_foreground'});
  await assert.rejects(h.adapter.capture(),{code:'capture_occluded'});
  assert.equal(h.adapter.hasRegion(),true); assert.equal(h.calls.length,3);
});
test('rejects forged image dimensions and malformed PNG',async()=>{
  const forged=image(); forged.metadata.width=6000;
  const badPng=image(); badPng.imageBase64=Buffer.from('not an image').toString('base64');
  const h=harness([{ok:true,region:region()},forged,badPng]);
  await h.adapter.selectRegion();
  await assert.rejects(h.adapter.capture(),{code:'capture_failed'});
  await assert.rejects(h.adapter.capture(),{code:'capture_failed'});
});
test('rejects helper errors without exposing their contents',async()=>{
  const h=harness([{ok:false,code:'arbitrary private data',message:'C:\\private\\user'}]);
  await assert.rejects(h.adapter.selectRegion(),error=>error.code==='capture_failed' && !error.message.includes('private'));
});
test('unsupported OS never spawns',async()=>{
  const adapter=createVisibleCapture({platform:'darwin',spawn:()=>{ throw Error('must not run'); }});
  await assert.rejects(adapter.selectRegion(),{code:'capture_unavailable'});
});
test('rejects invalid capture dimensions before spawning',async()=>{
  const h=harness([{ok:true,region:region()}]); await h.adapter.selectRegion();
  await assert.rejects(h.adapter.capture({maxWidth:16000}),{code:'capture_bounds'});
  assert.equal(h.calls.length,1);
});
test('clear while selection or capture is pending discards eventual result',async()=>{
  let pending;
  const h=harness([call=>{ pending=call; },image()]);
  const select=h.adapter.selectRegion();
  await new Promise(resolve=>setImmediate(resolve));
  h.adapter.clearRegion();
  pending.child.stdout.write(JSON.stringify({ok:true,region:region()})); pending.child.emit('close',0);
  await assert.rejects(select,{code:'capture_cancelled'});
  assert.equal(h.adapter.hasRegion(),false);
});
test('rejects helper output beyond bounded stdout and terminates child',async()=>{
  const h=harness([call=>{call.child.stdout.write(Buffer.alloc(6*1024*1024+1));}]);
  await assert.rejects(h.adapter.selectRegion(),{code:'capture_too_large'});
  assert.equal(h.calls[0].child.killed,true);
});


test('automatically discovers the current viewer per call without retaining region',async()=>{
  const first=image();first.metadata.method='detected-visible-viewer';
  const second=image();second.metadata.method='detected-visible-viewer';
  const h=harness([first,second]);
  const result=await h.adapter.capture({viewerType:'composition'});
  await h.adapter.capture({viewerType:'composition'});
  assert.equal(result.metadata.method,'detected-visible-viewer');
  assert.equal(h.adapter.hasRegion(),false);
  assert.equal(h.calls.length,2);
  for(const call of h.calls){const body=JSON.parse(call.input);assert.equal(body.auto,true);assert.equal(body.viewerType,'composition');assert.equal(body.region,undefined);}
});
test('automatic capture rejects other viewer types without spawning',async()=>{
  const h=harness([]);
  for(const viewerType of ['footage','layer','Composition',null])await assert.rejects(h.adapter.capture({viewerType}),{code:'capture_viewer_type'});
  assert.equal(h.calls.length,0);
});
test('ambiguous and unsupported native viewer layouts fail without a fallback',async()=>{
  const h=harness([{ok:false,code:'capture_viewer_ambiguous'},{ok:false,code:'capture_viewer_not_found'}]);
  await assert.rejects(h.adapter.capture({viewerType:'composition'}),{code:'capture_viewer_ambiguous'});
  await assert.rejects(h.adapter.capture({viewerType:'composition'}),{code:'capture_viewer_not_found'});
  assert.equal(h.calls.length,2);assert.equal(h.adapter.hasRegion(),false);
});
test('automatic capture rejects a result pretending it used a manually selected region',async()=>{
  const h=harness([image()]);
  await assert.rejects(h.adapter.capture({viewerType:'composition'}),{code:'capture_failed'});
});
