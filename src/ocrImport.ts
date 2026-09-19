import {createWorker} from "tesseract.js";

export interface OcrProgress { status:string; progress:number; }
export interface OcrExtraction { text:string; confidence:number; }

const IMAGE_EXTENSIONS=/\.(?:png|jpe?g|webp)$/i;
const IMAGE_TYPES=new Set(["image/png","image/jpeg","image/webp"]);
const MAX_IMAGE_PIXELS=40_000_000;

export function isSupportedOcrImage(file:Pick<File,"name"|"type">):boolean{
  return IMAGE_EXTENSIONS.test(file.name)&&(!file.type||IMAGE_TYPES.has(file.type));
}

export function validateOcrImage(file:Pick<File,"name"|"type"|"size">):void{
  if(!isSupportedOcrImage(file))throw new Error("OCR supports PNG, JPEG, and WebP statement images");
  if(!file.size)throw new Error("The statement image is empty");
  if(file.size>10*1024*1024)throw new Error("Statement images are limited to 10 MB");
}

function assetUrl(path:string):string{return new URL(`ocr/${path}`,document.baseURI).href;}

function fileDataUrl(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Could not read the statement image"));reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file);});
}

async function validateImageDimensions(file:File):Promise<void>{
  const bitmap=await createImageBitmap(file);
  try{if(bitmap.width*bitmap.height>MAX_IMAGE_PIXELS)throw new Error("Statement images are limited to 40 megapixels");}
  finally{bitmap.close();}
}

export async function extractImageText(file:File,onProgress?:(progress:OcrProgress)=>void):Promise<OcrExtraction>{
  validateOcrImage(file);
  await validateImageDimensions(file);
  const worker=await createWorker("eng",1,{
    workerPath:assetUrl("worker.min.js"),
    corePath:assetUrl("core"),
    langPath:assetUrl("lang"),
    workerBlobURL:false,
    logger:message=>onProgress?.({status:message.status,progress:typeof message.progress==="number"?Math.max(0,Math.min(1,message.progress)):0})
  });
  try{
    const result=await worker.recognize(await fileDataUrl(file));
    return{text:result.data.text,confidence:result.data.confidence};
  }finally{await worker.terminate();}
}
