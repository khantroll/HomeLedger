import {extractCanvasPages,type OcrCanvasPage,type OcrExtraction,type OcrProgress} from "./ocrImport";

export interface ScannedPdfExtraction extends OcrExtraction { pageCount:number; }

const MAX_PDF_PAGES=20;
const MAX_RENDERED_PIXELS=60_000_000;
const RENDER_SCALE=2;

export function validateScannedPdfLimits(pageCount:number,renderedPixels=0):void{
  if(pageCount<1)throw new Error("The PDF does not contain any pages");
  if(pageCount>MAX_PDF_PAGES)throw new Error(`Scanned PDF OCR is limited to ${MAX_PDF_PAGES} pages`);
  if(renderedPixels>MAX_RENDERED_PIXELS)throw new Error("The scanned PDF is too large to OCR safely (60-megapixel rendered limit)");
}

function pdfAssetUrl(path:string):string{return new URL(`pdfjs/${path}`,document.baseURI).href;}
function pdfAssetDirectory(path:string):string{return new URL(`pdfjs/${path}/`,document.baseURI).href;}

function validatePdfBuffer(buffer:ArrayBuffer):void{
  if(!buffer.byteLength)throw new Error("The PDF is empty");
  if(buffer.byteLength>10*1024*1024)throw new Error("PDF statement files are limited to 10 MB");
}

async function openPdf(buffer:ArrayBuffer){
  const {GlobalWorkerOptions,getDocument}=await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc=pdfAssetUrl("pdf.worker.min.mjs");
  return getDocument({
    data:new Uint8Array(buffer.slice(0)),
    cMapPacked:true,
    cMapUrl:pdfAssetDirectory("cmaps"),
    iccUrl:pdfAssetDirectory("iccs"),
    isEvalSupported:false,
    maxImageSize:MAX_RENDERED_PIXELS,
    standardFontDataUrl:pdfAssetDirectory("standard_fonts"),
    stopAtErrors:true,
    useWorkerFetch:false,
    useWasm:true,
    wasmUrl:pdfAssetDirectory("wasm")
  }).promise;
}

export async function pdfNeedsOcr(buffer:ArrayBuffer):Promise<boolean>{
  validatePdfBuffer(buffer);
  const documentProxy=await openPdf(buffer);
  try{
    for(let pageNumber=1;pageNumber<=documentProxy.numPages;pageNumber++){
      const page=await documentProxy.getPage(pageNumber);
      try{const content=await page.getTextContent(),characterCount=content.items.reduce((sum,item)=>sum+("str" in item?item.str.trim().length:0),0);if(characterCount<20)return true;}
      finally{page.cleanup();}
    }
    return false;
  }finally{await documentProxy.destroy();}
}

export async function extractScannedPdfText(buffer:ArrayBuffer,onProgress?:(progress:OcrProgress)=>void):Promise<ScannedPdfExtraction>{
  validatePdfBuffer(buffer);
  const documentProxy=await openPdf(buffer);
  validateScannedPdfLimits(documentProxy.numPages);
  let renderedPixels=0;
  async function* pages():AsyncGenerator<OcrCanvasPage>{
    for(let pageNumber=1;pageNumber<=documentProxy.numPages;pageNumber++){
      onProgress?.({status:`rendering PDF page ${pageNumber} of ${documentProxy.numPages}`,progress:(pageNumber-1)/documentProxy.numPages});
      const page=await documentProxy.getPage(pageNumber),viewport=page.getViewport({scale:RENDER_SCALE});
      renderedPixels+=Math.ceil(viewport.width)*Math.ceil(viewport.height);
      validateScannedPdfLimits(documentProxy.numPages,renderedPixels);
      const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const context=canvas.getContext("2d",{alpha:false});if(!context)throw new Error("Could not create a local PDF rendering surface");
      try{await page.render({canvas,canvasContext:context,viewport,background:"#ffffff"}).promise;yield{canvas,pageNumber,pageCount:documentProxy.numPages};}
      finally{page.cleanup();}
    }
  }
  try{return{...await extractCanvasPages(pages(),onProgress),pageCount:documentProxy.numPages};}
  finally{await documentProxy.destroy();}
}
