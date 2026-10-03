import {cpSync,mkdirSync,readdirSync,rmSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const destination=join(root,"public","ocr");
const pdfDestination=join(root,"public","pdfjs");
const coreSource=join(root,"node_modules","tesseract.js-core");

// Tesseract.js 7 feature-detects the best core at runtime. Package every browser
// loader shipped by the installed matching tesseract.js-core instead of freezing
// the v5/v6 four-file list. v7 adds relaxedsimd variants on capable runtimes.
const coreFiles=readdirSync(coreSource)
  .filter(file=>/^tesseract-core(?:-[a-z]+)*\.wasm\.js$/i.test(file))
  .sort();
if(!coreFiles.length)throw new Error("No Tesseract core browser runtime assets found");
for(const required of ["tesseract-core.wasm.js","tesseract-core-lstm.wasm.js","tesseract-core-simd.wasm.js","tesseract-core-simd-lstm.wasm.js"]){
  if(!coreFiles.includes(required))throw new Error(`Installed tesseract.js-core is missing expected runtime asset: ${required}`);
}

rmSync(destination,{recursive:true,force:true});
rmSync(pdfDestination,{recursive:true,force:true});
mkdirSync(join(destination,"core"),{recursive:true});
mkdirSync(join(destination,"lang"),{recursive:true});
mkdirSync(pdfDestination,{recursive:true});
cpSync(join(root,"node_modules","tesseract.js","dist","worker.min.js"),join(destination,"worker.min.js"));
for(const file of coreFiles)cpSync(join(coreSource,file),join(destination,"core",file));
cpSync(join(root,"node_modules","@tesseract.js-data","eng","4.0.0","eng.traineddata.gz"),join(destination,"lang","eng.traineddata.gz"));
cpSync(join(root,"node_modules","pdfjs-dist","build","pdf.worker.min.mjs"),join(pdfDestination,"pdf.worker.min.mjs"));
for(const directory of ["cmaps","iccs","standard_fonts","wasm"])cpSync(join(root,"node_modules","pdfjs-dist",directory),join(pdfDestination,directory),{recursive:true});

// Fail the prepare step if the installed core and locally packaged runtime drift.
// This makes dependency upgrades fail closed rather than falling back to a CDN.
const packagedCoreFiles=readdirSync(join(destination,"core"))
  .filter(file=>/^tesseract-core(?:-[a-z]+)*\.wasm\.js$/i.test(file))
  .sort();
if(JSON.stringify(packagedCoreFiles)!==JSON.stringify(coreFiles)){
  throw new Error(`Packaged Tesseract core assets do not match installed runtime. Expected ${coreFiles.join(", ")}; found ${packagedCoreFiles.join(", ")}`);
}
