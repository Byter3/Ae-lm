'use strict';
// Read only bounded encoded headers before the browser can allocate decoded pixels.
function sourceImageInfo(bytes){
  function invalid(){throw new Error('Use a valid PNG, JPEG or static WebP image with at most 30 million pixels and 20 MiB.');}
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>20*1024*1024)invalid();
  let width,height,mime;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
    if(bytes.length<33||bytes.readUInt32BE(8)!==13)invalid();
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);mime='image/png';
  }else if(bytes[0]===255&&bytes[1]===216){
    mime='image/jpeg';let offset=2;
    while(offset+4<=bytes.length&&offset<1024*1024){
      if(bytes[offset++]!==255)invalid();
      while(offset<bytes.length&&bytes[offset]===255)offset++;
      if(offset+2>=bytes.length)invalid();
      const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
      if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
      const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)invalid();
      if([0xc0,0xc1,0xc2].includes(marker)){
        if(size<8)invalid();height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;
      }
      offset+=size;
    }
  }else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    if(bytes.length<30||bytes.readUInt32LE(4)+8!==bytes.length)invalid();
    mime='image/webp';const kind=bytes.toString('ascii',12,16),size=bytes.readUInt32LE(16);
    if(size+20>bytes.length)invalid();
    if(kind==='VP8X'){
      if(size!==10||(bytes[20]&2))invalid();
      width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);
    }else if(kind==='VP8 '){
      if(size<10||bytes[23]!==0x9d||bytes[24]!==0x01||bytes[25]!==0x2a)invalid();
      width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;
    }else if(kind==='VP8L'){
      if(size<5||bytes[20]!==0x2f)invalid();
      width=1+(bytes[21]|((bytes[22]&63)<<8));height=1+((bytes[22]>>6)|(bytes[23]<<2)|((bytes[24]&15)<<10));
    }else invalid();
  }else invalid();
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>32768||height>32768||width*height>30000000)invalid();
  return {width,height,mime};
}
module.exports={sourceImageInfo};
