import {createWorker} from "tesseract.js";

export interface OcrProgress { status:string; progress:number; }
export interface OcrExtraction { text:string; confidence:number; }
export interface OcrCanvasPage { canvas:HTMLCanvasElement; pageNumber:number; pageCount:number; }

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

async function createLocalWorker(onProgress?:(progress:OcrProgress)=>void){
  return createWorker("eng",1,{
    workerPath:assetUrl("worker.min.js"),
    corePath:assetUrl("core"),
    langPath:assetUrl("lang"),
    workerBlobURL:false,
    logger:message=>onProgress?.({status:message.status,progress:typeof message.progress==="number"?Math.max(0,Math.min(1,message.progress)):0})
  });
}

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
  const worker=await createLocalWorker(onProgress);
  try{
    const result=await worker.recognize(await fileDataUrl(file));
    return{text:result.data.text,confidence:result.data.confidence};
  }finally{await worker.terminate();}
}

export async function extractCanvasPages(pages:AsyncIterable<OcrCanvasPage>,onProgress?:(progress:OcrProgress)=>void):Promise<OcrExtraction>{
  let activePage:OcrCanvasPage|null=null;
  const worker=await createLocalWorker(progress=>{
    if(!activePage){onProgress?.(progress);return;}
    onProgress?.({status:`OCR page ${activePage.pageNumber} of ${activePage.pageCount}: ${progress.status}`,progress:(activePage.pageNumber-1+progress.progress)/activePage.pageCount});
  });
  const texts:string[]=[],confidences:number[]=[];
  try{
    for await(const page of pages){
      activePage=page;
      try{const result=await worker.recognize(page.canvas);texts.push(result.data.text);confidences.push(result.data.confidence);}
      finally{page.canvas.width=1;page.canvas.height=1;}
    }
    if(!texts.length)throw new Error("The PDF does not contain any pages to OCR");
    return{text:texts.join("\n"),confidence:confidences.reduce((sum,value)=>sum+value,0)/confidences.length};
  }finally{await worker.terminate();}
}
