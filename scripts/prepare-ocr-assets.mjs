import {cpSync,mkdirSync,rmSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const destination=join(root,"public","ocr");
const pdfDestination=join(root,"public","pdfjs");
const coreFiles=["tesseract-core.wasm.js","tesseract-core-simd.wasm.js","tesseract-core-lstm.wasm.js","tesseract-core-simd-lstm.wasm.js"];

rmSync(destination,{recursive:true,force:true});
rmSync(pdfDestination,{recursive:true,force:true});
mkdirSync(join(destination,"core"),{recursive:true});
mkdirSync(join(destination,"lang"),{recursive:true});
mkdirSync(pdfDestination,{recursive:true});
cpSync(join(root,"node_modules","tesseract.js","dist","worker.min.js"),join(destination,"worker.min.js"));
for(const file of coreFiles)cpSync(join(root,"node_modules","tesseract.js-core",file),join(destination,"core",file));
cpSync(join(root,"node_modules","@tesseract.js-data","eng","4.0.0","eng.traineddata.gz"),join(destination,"lang","eng.traineddata.gz"));
cpSync(join(root,"node_modules","pdfjs-dist","build","pdf.worker.min.mjs"),join(pdfDestination,"pdf.worker.min.mjs"));
for(const directory of ["cmaps","iccs","standard_fonts","wasm"])cpSync(join(root,"node_modules","pdfjs-dist",directory),join(pdfDestination,directory),{recursive:true});
