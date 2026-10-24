'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../extension/host/aelm.jsx'), 'utf8');

// These fixtures check the inspection contract. Node's parser does not reproduce
// ExtendScript's reported nested-ternary association; native acceptance is separate.
function host() {
  const context = vm.createContext({});
  vm.runInContext(`
    function CompItem(id, name) {
      this.id=id;this.name=name;this.width=1920;this.height=1080;
      this.frameRate=24;this.duration=10;this.layers=[];this.numLayers=0;
    }
    CompItem.prototype.layer=function(index){return this.layers[index-1];};
    function FolderItem(id, name){this.id=id;this.name=name;}
    function FootageItem(id, name){this.id=id;this.name=name;}
    function Layer(name){
      this.name=name;this.enabled=true;this.locked=false;this.shy=false;
      this.inPoint=0;this.outPoint=10;this.startTime=0;this.parent=null;
    }
    function AVLayer(name){Layer.call(this,name);this.nullLayer=false;this.threeDLayer=false;}
    AVLayer.prototype=Object.create(Layer.prototype);
    function TextLayer(name){AVLayer.call(this,name);}
    TextLayer.prototype=Object.create(AVLayer.prototype);
    function ShapeLayer(name){AVLayer.call(this,name);}
    ShapeLayer.prototype=Object.create(AVLayer.prototype);
    function CameraLayer(name){Layer.call(this,name);}
    CameraLayer.prototype=Object.create(Layer.prototype);
    function LightLayer(name){Layer.call(this,name);}
    LightLayer.prototype=Object.create(Layer.prototype);
    var comp=new CompItem(101,'Composition fixture');
    var folder=new FolderItem(102,'Folder fixture');
    var footage=new FootageItem(103,'Footage fixture');
    var unknown={id:104,name:'Unknown item fixture'};
    comp.layers=[new TextLayer('Text'),new ShapeLayer('Shape'),
      new CameraLayer('Camera'),new LightLayer('Light'),
      new AVLayer('Footage layer'),new AVLayer('Null'),new Layer('Other layer')];
    comp.layers[5].nullLayer=true;
    for(var i=0;i<comp.layers.length;i++){
      comp.layers[i].index=i+1;comp.layers[i].id=201+i;
    }
    comp.numLayers=comp.layers.length;
    var items=[comp,folder,footage,unknown];
    var project={file:null,numItems:items.length,activeItem:comp,
      item:function(index){return items[index-1];}};
    var app={version:'synthetic',project:project,
      beginUndoGroup:function(){throw Error('Inspection must not edit');},
      endUndoGroup:function(){throw Error('Inspection must not edit');}};
  `, context);
  vm.runInContext(source, context);
  return {
    run(script) { return vm.runInContext(script, context); },
    inspect(args) {
      context.request=JSON.stringify(args);
      return JSON.parse(vm.runInContext('AELM.dispatch("inspect",request)',context));
    }
  };
}

test('project inspection distinguishes composition, folder, footage and unknown items', () => {
  const h=host();
  const result=h.inspect({scope:'project'});
  assert.equal(result.ok,true);
  assert.deepEqual(result.data.items.map(item=>[item.id,item.type]),[
    [101,'composition'],[102,'folder'],[103,'footage'],[104,'item']
  ]);
  const page=h.inspect({scope:'project',offset:1,limit:2}).data;
  assert.deepEqual(page.items.map(item=>item.type),['folder','footage']);
  assert.equal(page.hasMore,true);
});

test('composition ID inspection works with no active item', () => {
  const h=host();h.run('app.project.activeItem=null');
  assert.equal(h.inspect({scope:'activeComp'}).data.activeComp,null);
  const result=h.inspect({scope:'comp',compId:101});
  assert.equal(result.ok,true);
  assert.equal(result.data.comp.type,'composition');
  assert.equal(result.data.comp.id,101);
  assert.equal(result.data.comp.numLayers,7);
});

test('an active folder is not a composition and does not hide project compositions', () => {
  const h=host();h.run('app.project.activeItem=folder');
  assert.equal(h.inspect({scope:'activeComp'}).data.activeComp,null);
  assert.equal(h.inspect({scope:'comp',compId:102}).data.activeComp,null);
  assert.equal(h.inspect({scope:'project'}).data.items[0].type,'composition');
  assert.equal(h.inspect({scope:'comp',compId:101}).data.comp.id,101);
});

test('layer inspection preserves specific types before AVLayer and fallback Layer', () => {
  const h=host();
  const result=h.inspect({scope:'activeComp'});
  assert.equal(result.ok,true);
  assert.deepEqual(result.data.layers.map(layer=>layer.type),[
    'TextLayer','ShapeLayer','CameraLayer','LightLayer','AVLayer','AVLayer','Layer'
  ]);
  assert.equal(result.data.layers[5].nullLayer,true);
  assert.equal(result.data.layers[4].nullLayer,false);
});
