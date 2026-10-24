'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { Bridge } = require('../extension/lib/bridge');
const source = fs.readFileSync(path.join(__dirname, '../extension/host/aelm.jsx'), 'utf8');

function host() {
  const context = vm.createContext({});
  vm.runInContext(`
    function CompItem(id,name) {this.id=id;this.name=name;this.width=1920;this.height=1080;this.frameRate=24;this.duration=10;this.layers=[];this.numLayers=0;}
    CompItem.prototype.layer=function(index){return this.layers[index-1];};
    function AVLayer(name){this.name=name;this.index=1;this.id=12;this.enabled=true;this.locked=false;this.shy=false;this.inPoint=0;this.outPoint=10;this.startTime=0;this.parent=null;this.numProperties=1;}
    function Property() {this.name='Position';this.matchName='ADBE Position';this.propertyIndex=1;this.propertyType=1;this.propertyValueType=2;this.numKeys=0;this.canSetExpression=true;this.expression='';this.expressionEnabled=false;this.expressionError='';this.value=[100,200];}
    var PropertyType={PROPERTY:1}, PropertyValueType={NO_VALUE:0,CUSTOM_VALUE:99};
    var prop=new Property(), layer=new AVLayer('Original'), comp=new CompItem(7,'Test');
    layer.property=function(key){return key===1 || key==='ADBE Position' ? prop : null;};
    comp.layers=[layer];comp.numLayers=1;
    var project={file:null,numItems:1,activeItem:comp,item:function(i){return i===1 ? comp : null;}};
    var app={version:'25.1',project:project,undosStarted:0,undosEnded:0,
      beginUndoGroup:function(){this.undosStarted++;},endUndoGroup:function(){this.undosEnded++;}};
  `, context);
  vm.runInContext(source, context);
  return {
    context,
    run(script) { return vm.runInContext(script, context); },
    call(method, args) { context.request = JSON.stringify(args || {}); return JSON.parse(vm.runInContext('AELM.dispatch(' + JSON.stringify(method) + ',request)', context)); }
  };
}

test('identity survives bridge reload, Save As, and distinguishes a new project', () => {
  const h=host(); const initial=h.call('identity').data;
  vm.runInContext(source,h.context);
  assert.equal(h.call('identity').data.projectToken,initial.projectToken);
  h.run("app.project.file={fsName:'C:/test/shot.aep'}");
  assert.equal(h.call('identity').data.projectToken,initial.projectToken);
  assert.equal(h.call('identity').data.projectPath,'C:/test/shot.aep');
  h.run('app.project={file:null,numItems:0}');
  assert.notEqual(h.call('identity').data.projectToken,initial.projectToken);
});

test('inspect composition and bounded project pages without evaluating expressions', () => {
  const h=host();
  const comp=h.call('inspect',{scope:'activeComp'}).data;
  assert.equal(comp.comp.name,'Test'); assert.equal(comp.layers[0].type,'AVLayer');
  assert.equal(h.call('inspect',{scope:'project',offset:1}).data.items.length,0);
  h.run("prop.expressionEnabled=true;prop.expression='time';Object.defineProperty(prop,'value',{get:function(){throw Error('must not evaluate');}})");
  const p=h.call('inspect',{scope:'layer',layerIndex:1,propertyPath:['ADBE Position']}).data.property;
  assert.equal(p.expression,'time'); assert.equal(p.evaluatedValueOmitted,true);
  assert.equal(Object.hasOwn(p,'authoredValue'),false);
});

test('keyframes read authored values and expose truncation', () => {
  const h=host(); h.run('prop.numKeys=30;prop.keyTime=function(i){return i/24;};prop.keyValue=function(i){return [i,i+1];};');
  const prop=h.call('inspect',{scope:'layer',propertyPath:[1]}).data.property;
  assert.equal(prop.keys.length,20); assert.equal(prop.keysTruncated,true);
  assert.deepEqual(prop.keys[0].value,[1,2]);
});

test('invalid JSON, prototype keys, and oversized or invalid query arguments are rejected without code execution', () => {
  const h=host();
  assert.equal(JSON.parse(h.run('AELM.dispatch("identity", "({x:(app.project=null)})")')).ok,false);
  assert.equal(JSON.parse(h.run('AELM.dispatch("identity", \'{"__proto__":{}}\')')).ok,false);
  assert.equal(h.call('inspect',{limit:999}).ok,false);
  assert.equal(h.call('inspect',{scope:'wrong'}).ok,false);
  assert.equal(h.call('identity').data.projectPath,null);
});

test('general scripts run once, in undo group, with exact returned result', () => {
  const h=host(); const token=h.call('identity').data.projectToken;
  const args={id:'first_1',source:'app.project.activeItem.name="Changed"; return {answer:42};',title:'Rename comp',expectedProjectToken:token};
  const result=h.call('execute',args);
  assert.equal(result.ok,true); assert.deepEqual(result.data.result,{answer:42});
  assert.equal(h.call('execute',args).error.code,'already_consumed');
  assert.equal(h.run('app.undosStarted'),1); assert.equal(h.run('app.undosEnded'),1);
});

test('stale project never executes; partial failure is consumed and reported honestly', () => {
  const h=host();
  assert.equal(h.call('execute',{id:'stale',expectedProjectToken:'wrong',source:'throw Error("ran")'}).error.code,'project_changed');
  assert.equal(h.run('app.undosStarted'),0);
  const args={id:'partial',expectedProjectToken:h.call('identity').data.projectToken,source:'app.project.activeItem.name="Partial";throw Error("Bad parameter");'};
  const result=h.call('execute',args);
  assert.equal(result.ok,false); assert.equal(result.error.possiblyModified,true);
  assert.match(result.error.message,/Bad parameter/);
  assert.equal(h.run('comp.name'),'Partial');
  assert.equal(h.call('execute',args).error.code,'already_consumed');
  assert.equal(h.run('app.undosEnded'),1);
});

test('execution IDs cannot bypass duplicate protection through prototype property names', () => {
  const h=host();
  const args={id:'__proto__',expectedProjectToken:h.call('identity').data.projectToken,source:'return 1;'};
  assert.equal(h.call('execute',args).ok,true);
  assert.equal(h.call('execute',args).error.code,'already_consumed');
});

test('no active composition is a successful empty observation', () => {
  const h=host();h.run('app.project.activeItem=null');
  const result=h.call('inspect',{});
  assert.equal(result.ok,true); assert.equal(result.data.activeComp,null);
});

test('Bridge safely encodes source and serializes callbacks', async () => {
  const callbacks=[], scripts=[];
  const bridge=new Bridge({evalScript:(script,callback)=>{scripts.push(script);callbacks.push(callback);}});
  const first=bridge.execute({id:'safe',source:'return "\n\\\"; injected()',expectedProjectToken:'token'});
  const second=bridge.identity();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scripts.length,1);
  const invocation=vm.runInNewContext(scripts[0],{AELM:{dispatch:(method,json)=>({method,args:JSON.parse(json)})}});
  assert.equal(invocation.method,'execute'); assert.match(invocation.args.source,/injected/);
  callbacks.shift()(JSON.stringify({ok:true,data:{execution:'completed'}}));
  await first; await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scripts.length,2);
  callbacks.shift()(JSON.stringify({ok:true,data:{projectToken:'token'}}));
  assert.equal((await second).data.projectToken,'token');
});

test('Bridge timeout latches unknown, ignores late completion, and never dispatches queued work', async () => {
  let callback, calls=0;
  const bridge=new Bridge({timeoutMs:20,evalScript:(_,cb)=>{calls++;callback=cb;}});
  const execution=bridge.execute({});
  const queued=bridge.identity();
  const a=assert.rejects(execution,error=>error.code==='host_timeout'&&error.outcome==='unknown');
  const b=assert.rejects(queued,error=>error.code==='host_outcome_unknown');
  await Promise.all([a,b]);callback('{"ok":true,"data":null}');
  assert.equal(calls,1);
});

test('Bridge rejects malformed completed response without executing anything again', async () => {
  let calls=0;
  const bridge=new Bridge({evalScript:(_,cb)=>{calls++;cb('EvalScript error.');}});
  await assert.rejects(bridge.execute({}),{code:'host_invalid_response'});
  await assert.rejects(bridge.execute({}),{code:'host_outcome_unknown'});
  assert.equal(calls,1);
});
