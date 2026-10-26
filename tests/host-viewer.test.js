'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../extension/host/aelm.jsx'),'utf8');
function host(){
  const context=vm.createContext({});
  vm.runInContext(`
    function CompItem(){this.id=1;this.name='Fixture';this.width=1920;this.height=1080;this.frameRate=24;this.duration=10;this.numLayers=0;this.time=1;}
    var comp=new CompItem(), viewerReads=0, typeReads=0;
    var ViewerType={VIEWER_COMPOSITION:100,VIEWER_LAYER:200,VIEWER_FOOTAGE:300};
    var viewer={type:ViewerType.VIEWER_COMPOSITION,active:false,setActive:function(){throw Error('Must not activate a viewer');}};
    var app={version:'26-synthetic',project:{file:null,activeItem:comp,numItems:1,item:function(){return comp;}},beginUndoGroup:function(){throw Error('Must not edit');}};
    Object.defineProperty(app,'activeViewer',{configurable:true,get:function(){viewerReads++;return viewer;}});
  `,context);
  vm.runInContext(source,context);
  return {run:s=>vm.runInContext(s,context),inspect:(args={scope:'activeComp'})=>JSON.parse(vm.runInContext('AELM.dispatch("inspect",'+JSON.stringify(JSON.stringify(args))+')',context))};
}

test('Composition viewer remains identifiable while CEP has focus, independently of activeItem',()=>{
  const h=host();h.run('app.project.activeItem=null');const result=h.inspect();
  assert.equal(result.ok,true);assert.deepEqual(result.data.viewer,{type:'composition'});assert.equal(result.data.activeComp,null);assert.equal(h.run('viewer.active'),false);assert.equal(h.run('viewerReads'),1);
});

test('Layer and Footage viewers are not inferred as composition from an active comp',()=>{
  const h=host();h.run('viewer.type=ViewerType.VIEWER_LAYER');assert.equal(h.inspect().data.viewer.type,'layer');
  h.run('viewer.type=ViewerType.VIEWER_FOOTAGE');assert.equal(h.inspect().data.viewer.type,'footage');
});

test('absent and unknown viewers stay explicit instead of guessing from an active comp',()=>{
  const h=host();h.run('viewer=null');assert.equal(h.inspect().data.viewer.type,'none');
  h.run('viewer=undefined');assert.equal(h.inspect().data.viewer.type,'unknown');
  h.run('viewer={type:999}');assert.equal(h.inspect().data.viewer.type,'unknown');
  h.run('viewer={}');assert.equal(h.inspect().data.viewer.type,'unknown');
  h.run('viewer={type:100};ViewerType=undefined');assert.equal(h.inspect().data.viewer.type,'unknown');
});

test('invalid native activeViewer does not fail the authored project inspection',()=>{
  const h=host();h.run("Object.defineProperty(app,'activeViewer',{get:function(){viewerReads++;throw new ReferenceError('Object is invalid');}})");
  const result=h.inspect();assert.equal(result.ok,true);assert.equal(result.data.viewer.type,'unknown');assert.equal(result.data.comp.id,1);assert.equal(h.run('viewerReads'),1);
});

test('invalid native viewer type becomes unknown with one bounded read',()=>{
  const h=host();h.run("Object.defineProperty(viewer,'type',{get:function(){typeReads++;throw new ReferenceError('Object is invalid');}})");
  const result=h.inspect();assert.equal(result.ok,true);assert.equal(result.data.viewer.type,'unknown');assert.equal(h.run('typeReads'),1);
});

test('viewer snapshot is fresh and does not read focus or change time',()=>{
  const h=host();h.run("Object.defineProperty(viewer,'active',{get:function(){throw Error('Focus is irrelevant');}})");
  assert.equal(h.inspect().data.viewer.type,'composition');h.run('viewer={type:ViewerType.VIEWER_LAYER}');
  assert.equal(h.inspect().data.viewer.type,'layer');assert.equal(h.run('viewerReads'),2);assert.equal(h.run('comp.time'),1);
});

test('ordinary project and explicit composition inspections do not read viewer state',()=>{
  const h=host();assert.equal(h.inspect({scope:'project'}).ok,true);assert.equal(h.inspect({scope:'comp',compId:1}).ok,true);assert.equal(h.run('viewerReads'),0);
});
