import {readdirSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {isSupportedOcrImage,validateOcrImage} from "./ocrImport";

describe("local statement OCR validation",()=>{
  it("accepts supported statement image formats",()=>{
    expect(isSupportedOcrImage({name:"statement.PNG",type:"image/png"})).toBe(true);
    expect(isSupportedOcrImage({name:"statement.jpeg",type:"image/jpeg"})).toBe(true);
    expect(isSupportedOcrImage({name:"statement.webp",type:""})).toBe(true);
  });

  it("rejects misleading and unsupported image formats",()=>{
    expect(isSupportedOcrImage({name:"statement.png",type:"application/pdf"})).toBe(false);
    expect(isSupportedOcrImage({name:"statement.gif",type:"image/gif"})).toBe(false);
  });

  it("enforces non-empty and bounded files",()=>{
    expect(()=>validateOcrImage({name:"statement.png",type:"image/png",size:0})).toThrow("empty");
    expect(()=>validateOcrImage({name:"statement.jpg",type:"image/jpeg",size:10*1024*1024+1})).toThrow("10 MB");
  });

  it("packages every Tesseract core loader shipped by the installed runtime",()=>{
    const matcher=/^tesseract-core(?:-[a-z]+)*\.wasm\.js$/i;
    const installed=readdirSync(join(process.cwd(),"node_modules","tesseract.js-core")).filter(file=>matcher.test(file)).sort();
    const packaged=readdirSync(join(process.cwd(),"public","ocr","core")).filter(file=>matcher.test(file)).sort();
    expect(packaged).toEqual(installed);
    // Tesseract.js 7 can select Relaxed SIMD on supported Chromium/WebView2 runtimes.
    expect(packaged).toContain("tesseract-core-relaxedsimd-lstm.wasm.js");
    expect(packaged).toContain("tesseract-core-relaxedsimd.wasm.js");
  });
});
