'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {Controller} = require('../extension/lib/controller');
const {HistoryStore, validateArchive} = require('../extension/lib/history');

const source = fs.readFileSync(path.join(__dirname, '../extension/host/aelm.jsx'), 'utf8');
const largeRead = 'app.executionCount++; var rows=[]; for(var i=0;i<100;i++) rows.push({index:i,text:new Array(2001).join("x")}); return rows;';

function host() {
  const context = vm.createContext({});
  vm.runInContext(`
    function CompItem(id,name) {this.id=id;this.name=name;this.width=1920;this.height=1080;this.frameRate=24;this.duration=12;this.layers=[];this.numLayers=0;}
    CompItem.prototype.layer=function(index){return this.layers[index-1];};
    function AVLayer(name){this.name=name;this.index=1;this.id=12;this.enabled=true;this.locked=false;this.shy=false;this.inPoint=0;this.outPoint=12;this.startTime=0;this.parent=null;this.numProperties=0;}
    function Property(index) {this.name='Property '+index;this.matchName='ADBE Property '+index;this.propertyIndex=index;this.propertyType=1;this.propertyValueType=2;this.numKeys=0;this.canSetExpression=true;this.expression='';this.expressionEnabled=false;this.expressionError='';this.value=50;}
    var PropertyType={PROPERTY:1}, PropertyValueType={NO_VALUE:0,CUSTOM_VALUE:99};
    var layer=new AVLayer('Synthetic ring'), comp=new CompItem(7,'Synthetic composition');
    layer.property=function(index){return new Property(index);};
    comp.layers=[layer];comp.numLayers=1;
    var project={file:null,numItems:1,activeItem:comp,item:function(index){return index===1 ? comp : null;}};
    var app={version:'25.6',project:project,executionCount:0,undosStarted:0,undosEnded:0,
      beginUndoGroup:function(){this.undosStarted++;},endUndoGroup:function(){this.undosEnded++;}};
  `, context);
  vm.runInContext(source, context);
  return {
    context,
    run(script) { return vm.runInContext(script, context); },
    raw(method, args) {
      context.request = JSON.stringify(args || {});
      return vm.runInContext('AELM.dispatch(' + JSON.stringify(method) + ',request)', context);
    },
    call(method, args) { return JSON.parse(this.raw(method, args)); }
  };
}

function execute(h, id, script) {
  return h.call('execute', {id, source: script, title: 'Inspect synthetic authored data',
    expectedProjectToken: h.call('identity').data.projectToken});
}

function assertPartialSuccess(reply) {
  assert.equal(reply.ok, true, 'the successfully returned operation remains successful');
  assert.equal(reply._aelmHost.partial, true);
  assert.equal(reply._aelmHost.fullResultAvailable, false, 'uncaptured output is not claimed to exist locally');
  assert.equal(typeof reply._aelmHost.note, 'string');
  assert.ok(JSON.stringify(reply).length <= 100000, 'reply fits the host transport bound');
}

test('oversized script output returns bounded partial data with completion identity and no repeat', () => {
  const h = host();
  const identity = h.call('identity').data;
  const args = {id: 'large-once', source: largeRead, title: 'Inspect synthetic authored data', expectedProjectToken: identity.projectToken};
  const raw = h.raw('execute', args);
  assert.ok(raw.length <= 100000);
  const reply = JSON.parse(raw);
  assertPartialSuccess(reply);
  assert.equal(reply.data.id, args.id);
  assert.equal(reply.data.execution, 'completed');
  assert.deepEqual(reply.data.identity, identity);
  assert.match(reply.data.verification, /Inspect authored state separately/);
  assert.ok(JSON.stringify(reply.data.result).includes('_aelmOmitted'));
  assert.equal(h.run('app.executionCount'), 1);
  assert.equal(h.run('app.undosStarted'), 1);
  assert.equal(h.run('app.undosEnded'), 1);
  assert.equal(h.call('execute', args).error.code, 'already_consumed');
  vm.runInContext(source, h.context);
  assert.equal(h.call('execute', args).error.code, 'already_consumed', 'bridge reload preserves consumed command IDs');
  assert.equal(h.run('app.executionCount'), 1);
});

test('small script output remains exact and has no partial-capture label', () => {
  const h = host();
  const reply = execute(h, 'small-exact', 'return {label:"Synthetic",values:[0,1,false,null],nested:{answer:42}};');
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.data.result, {label: 'Synthetic', values: [0, 1, false, null], nested: {answer: 42}});
  assert.equal(Object.hasOwn(reply, '_aelmHost'), false);
});

test('string capture limit is explicitly partial even below the total reply limit', () => {
  const h = host();
  const reply = execute(h, 'long-string', 'return new Array(12002).join("x")+"LATE_STRING_SENTINEL";');
  assertPartialSuccess(reply);
  assert.equal(JSON.stringify(reply).includes('LATE_STRING_SENTINEL'), false);
  assert.match(reply.data.result, /text truncated/);
});

test('array capture limit flags missing late elements rather than presenting a complete array', () => {
  const h = host();
  const reply = execute(h, 'long-array', 'var a=[]; for(var i=0;i<500;i++) a.push(i); a.push("LATE_ARRAY_SENTINEL"); return a;');
  assertPartialSuccess(reply);
  assert.equal(reply.data.result.length, 500);
  assert.equal(reply.data.result[499], 499);
  assert.equal(JSON.stringify(reply).includes('LATE_ARRAY_SENTINEL'), false);
});

test('a preview of an already truncated array reports captured counts instead of inventing an original total', () => {
  const h = host();
  const reply = execute(h, 'array-captured-count', 'var a=[];for(var i=0;i<1000;i++)a.push({index:i,text:new Array(301).join("x")});return a;');
  assertPartialSuccess(reply);
  const preview = reply.data.result;
  assert.equal(preview._aelmOmitted, 'array');
  assert.equal(preview.capturedItems, 500, 'the bridge captured only the first 500 before previewing');
  assert.equal(preview.omittedCapturedItems, 500 - preview.preview.length);
  assert.equal(Object.hasOwn(preview, 'totalItems'), false, '500 is not presented as the original array size');
  assert.equal(reply._aelmHost.fullResultAvailable, false);
});

test('object capture limit flags missing late fields', () => {
  const h = host();
  const reply = execute(h, 'wide-object', 'var o={}; for(var i=0;i<200;i++) o["field"+i]=i; o.late="LATE_FIELD_SENTINEL"; return o;');
  assertPartialSuccess(reply);
  assert.equal(Object.keys(reply.data.result).length, 200);
  assert.equal(reply.data.result.field199, 199);
  assert.equal(JSON.stringify(reply).includes('LATE_FIELD_SENTINEL'), false);
});

test('depth capture limit flags omitted descendants', () => {
  const h = host();
  const reply = execute(h, 'deep-object', 'var o={},p=o; for(var i=0;i<20;i++){p.child={};p=p.child;} p.value="DEEP_SENTINEL";return o;');
  assertPartialSuccess(reply);
  assert.equal(JSON.stringify(reply).includes('DEEP_SENTINEL'), false);
  assert.match(JSON.stringify(reply.data.result), /depth limit/);
});

test('real script exceptions remain failures with possibly modified state and one-use execution', () => {
  const h = host();
  const args = {id: 'partial-throw', source: 'app.executionCount++;comp.name="Partial edit";throw Error("Synthetic bad property");',
    title: 'Synthetic failure', expectedProjectToken: h.call('identity').data.projectToken};
  const reply = h.call('execute', args);
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, 'script_failed');
  assert.equal(reply.error.possiblyModified, true);
  assert.match(reply.error.message, /Synthetic bad property/);
  assert.equal(Object.hasOwn(reply, '_aelmHost'), false);
  assert.equal(h.run('comp.name'), 'Partial edit');
  assert.equal(h.call('execute', args).error.code, 'already_consumed');
  assert.equal(h.run('app.executionCount'), 1);
  assert.equal(h.run('app.undosEnded'), 1);
});

test('large authored property inspection stays bounded and retains target and pagination metadata', () => {
  const h = host();
  h.run(`
    layer.numProperties=75;
    layer.property=function(index){var p=new Property(index);p.expressionEnabled=true;p.expression=new Array(7001).join('x');Object.defineProperty(p,'value',{get:function(){throw Error('Must not evaluate expression');}});return p;};
  `);
  const before = h.call('identity').data;
  const reply = h.call('inspect', {scope: 'layer', compId: 7, layerIndex: 1, offset: 0, limit: 50});
  assertPartialSuccess(reply);
  assert.equal(reply.data.scope, 'layer');
  assert.deepEqual(reply.data.identity, before);
  assert.equal(reply.data.comp.id, 7);
  assert.equal(reply.data.layer.name, 'Synthetic ring');
  assert.equal(reply.data.offset, 0);
  assert.equal(reply.data.limit, 50);
  assert.equal(reply.data.total, 75);
  assert.equal(reply.data.hasMore, true);
  assert.match(reply.data.observation, /no render or preview requested/);
  assert.ok(JSON.stringify(reply.data.properties).includes('_aelmOmitted'));
  assert.equal(h.run('app.undosStarted'), 0);
});

function completion(calls, content) {
  const message = {role: 'assistant', content: content || 'I will inspect the authored data.'};
  if (calls) message.tool_calls = calls;
  return {body: JSON.stringify({choices: [{index: 0, message, finish_reason: calls ? 'tool_calls' : 'stop'}]}),
    headers: {'content-type': 'application/json'}};
}

test('controller continues after a real host partial capture and retries the model without replay', async () => {
  const h = host();
  const call = {id: 'controller-large', type: 'function', function: {name: 'ae_run_script',
    arguments: JSON.stringify({title: 'Inspect synthetic authored data', source: largeRead})}};
  const responses = [completion([call]), new Error('Synthetic transport interruption'), completion(null, 'Only the captured subset is available.')];
  const requests = [];
  const bridge = {
    async identity() { return h.call('identity'); },
    async execute(args) { return h.call('execute', args); },
    async inspect(args) { return h.call('inspect', args); }
  };
  const transport = {
    normalizeBaseUrl(value) { return value; },
    async request(args) {
      requests.push(JSON.parse(JSON.stringify(args.body)));
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('Unexpected extra model call.');
      return next;
    }
  };
  const controller = new Controller({bridge, transport, store: new HistoryStore()});
  controller.configure({baseUrl: 'https://studio.test', token: 'synthetic-token', model: 'synthetic-model'});
  controller.autoRun = true;
  await controller.send('Inspect the synthetic composition.');
  assert.equal(requests.length, 2, 'oversized output does not stop the continuation model step');
  assert.match(controller.error, /Synthetic transport interruption/);
  assert.equal(controller.archive.receipts.length, 1);
  assert.equal(controller.archive.receipts[0].status, 'completed');
  assertPartialSuccess(controller.archive.receipts[0].result);
  const resultMessage = requests[1].messages.find(message => message.tool_call_id === call.id);
  assertPartialSuccess(JSON.parse(resultMessage.content));
  await controller.retry();
  assert.equal(controller.error, '');
  assert.equal(requests.length, 3);
  assert.equal(h.run('app.executionCount'), 1);
  assert.equal(controller.archive.receipts.length, 1);
  assert.deepEqual(requests[2].messages, requests[1].messages);
  validateArchive(controller.archive);
});
