'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sourceImageInfo}=require('../extension/lib/image-headers');
const {createImageInput}=require('../extension/lib/image-input');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJfcAAAAASUVORK5CYII=','base64');
test('preflight reads PNG and rejects large, zero or malformed dimensions before decode',()=>{
  assert.deepEqual(sourceImageInfo(png),{width:1,height:1,mime:'image/png'});
  for(const size of [0,1000000]){const bytes=Buffer.from(png);bytes.writeUInt32BE(size,16);assert.throws(()=>sourceImageInfo(bytes));}
  const bytes=Buffer.from(png);bytes.writeUInt32BE(12,8);assert.throws(()=>sourceImageInfo(bytes));
});
test('preflight checks bounded JPEG segments and supported SOF dimensions',()=>{
  const bytes=Buffer.alloc(32);bytes[0]=255;bytes[1]=216;bytes[2]=255;bytes[3]=0xc0;bytes.writeUInt16BE(17,4);bytes[6]=8;bytes.writeUInt16BE(100,7);bytes.writeUInt16BE(200,9);
  assert.deepEqual(sourceImageInfo(bytes),{width:200,height:100,mime:'image/jpeg'});
  bytes.writeUInt16BE(65535,7);bytes.writeUInt16BE(65535,9);assert.throws(()=>sourceImageInfo(bytes));
  bytes.writeUInt16BE(65535,4);assert.throws(()=>sourceImageInfo(bytes));
});
test('preflight supports static WebP headers, rejects animation and RIFF size mismatches',()=>{
  const bytes=Buffer.alloc(30);bytes.write('RIFF');bytes.writeUInt32LE(22,4);bytes.write('WEBP',8);bytes.write('VP8X',12);bytes.writeUInt32LE(10,16);bytes.writeUIntLE(199,24,3);bytes.writeUIntLE(99,27,3);
  assert.deepEqual(sourceImageInfo(bytes),{width:200,height:100,mime:'image/webp'});
  bytes[20]=2;assert.throws(()=>sourceImageInfo(bytes));bytes[20]=0;bytes.writeUInt32LE(1000,4);assert.throws(()=>sourceImageInfo(bytes));
});
test('image input refuses compressed oversized source before constructing Image',async()=>{
  let constructed=0;const bomb=Buffer.from(png);bomb.writeUInt32BE(1000000,16);
  const dom={Image:function(){constructed++;},document:{},FileReader:function(){this.readAsDataURL=()=>{this.result='data:image/png;base64,'+bomb.toString('base64');this.onload();};}};
  await assert.rejects(createImageInput(dom).file({type:'image/png',name:'huge.png',size:bomb.length}),/30 million/);assert.equal(constructed,0);
});
test('unsupported source types and oversized encoded input never invoke browser decoding',async()=>{
  let decoded=0;const input=createImageInput({Image:function(){decoded++;},FileReader:function(){throw new Error('Must not read');}});
  await assert.rejects(input.file({type:'image/svg+xml',size:5}));await assert.rejects(input.file({type:'image/png',size:21*1024*1024}));assert.equal(decoded,0);
});
