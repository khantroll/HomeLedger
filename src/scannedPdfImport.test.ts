import {describe,expect,it} from "vitest";
import {validateScannedPdfLimits} from "./scannedPdfImport";

describe("scanned PDF OCR limits",()=>{
  it("accepts bounded statements",()=>expect(()=>validateScannedPdfLimits(20,60_000_000)).not.toThrow());
  it("rejects empty and oversized page counts",()=>{
    expect(()=>validateScannedPdfLimits(0)).toThrow("does not contain any pages");
    expect(()=>validateScannedPdfLimits(21)).toThrow("20 pages");
  });
  it("rejects excessive rendered pixels",()=>expect(()=>validateScannedPdfLimits(2,60_000_001)).toThrow("60-megapixel"));
});
