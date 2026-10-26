'use strict';
// Decode/re-encode image pixels; metadata and extension-only impostors are not forwarded.
const {MAX_INPUT_BYTES,MAX_IMAGE_BYTES,MAX_EDGE}=require('./visuals');
const {sourceImageInfo}=require('./image-headers');
function createImageInput(dom){
  function prepare(dataUrl,name){return new Promise((resolve,reject)=>{
    const match=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if(!match){reject(new Error('The selected file is not a supported image.'));return;}
    let source;try{source=sourceImageInfo(Buffer.from(match[1],'base64'));}catch(e){reject(e);return;}
    const image=new dom.Image();
    image.onerror=()=>reject(new Error('The selected file could not be decoded as an image.'));
    image.onload=()=>{
      try{
        if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>30000000||image.naturalWidth*image.naturalHeight!==source.width*source.height)throw new Error('The decoded image dimensions do not match its bounded header.');
        let scale=Math.min(1,MAX_EDGE/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=dom.document.createElement('canvas');
        for(let attempt=0;attempt<8;attempt++){
          canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
          const bytes=Buffer.from(canvas.toDataURL('image/png').split(',')[1],'base64');
          if(bytes.length<=MAX_IMAGE_BYTES){resolve({bytes,mime:'image/png',name:name||'Reference image'});return;}
          scale*=0.75;
        }
        throw new Error('The image could not be prepared within the 512 KiB limit.');
      }catch(e){reject(e);}
    };
    image.src=dataUrl;
  });}
  function file(file){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))return Promise.reject(new Error('Attach PNG, JPEG or WebP images. Other files are not supported yet.'));
    if(file.size>MAX_INPUT_BYTES)return Promise.reject(new Error('The source image must be at most 20 MiB.'));
    return new Promise((resolve,reject)=>{
      const reader=new dom.FileReader();reader.onerror=()=>reject(new Error('The selected image could not be read.'));
      reader.onload=()=>prepare(reader.result,file.name).then(resolve,reject);reader.readAsDataURL(file);
    });
  }
  function capture(result){return prepare('data:'+result.mime+';base64,'+result.bytes.toString('base64'),'Visible AE view').then(image=>Object.assign(image,{metadata:result.metadata}));}
  return {file,capture};
}
module.exports={createImageInput};
