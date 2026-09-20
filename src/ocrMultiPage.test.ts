import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  createWorker:vi.fn(),
  recognize:vi.fn(),
  terminate:vi.fn()
}));

vi.mock("tesseract.js",()=>({createWorker:mocks.createWorker}));

import {extractCanvasPages} from "./ocrImport";

describe("multi-page local OCR",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.stubGlobal("document",{baseURI:"http://localhost/"});
    mocks.createWorker.mockImplementation(async(_language,_mode,options)=>{
      mocks.recognize.mockImplementationOnce(async()=>{options.logger({status:"recognizing text",progress:.5});return{data:{text:"page one",confidence:90}};});
      mocks.recognize.mockImplementationOnce(async()=>{options.logger({status:"recognizing text",progress:.5});return{data:{text:"page two",confidence:70}};});
      return{recognize:mocks.recognize,terminate:mocks.terminate};
    });
  });
  afterEach(()=>vi.unstubAllGlobals());

  it("reuses one worker, combines pages, reports document progress, and releases canvases",async()=>{
    const first={width:100,height:100} as HTMLCanvasElement,second={width:100,height:100} as HTMLCanvasElement;
    async function* pages(){yield{canvas:first,pageNumber:1,pageCount:2};yield{canvas:second,pageNumber:2,pageCount:2};}
    const progress:{status:string;progress:number}[]=[];
    await expect(extractCanvasPages(pages(),item=>progress.push(item))).resolves.toEqual({text:"page one\npage two",confidence:80});
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.recognize).toHaveBeenCalledTimes(2);
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
    expect(progress.map(item=>item.progress)).toEqual([.25,.75]);
    expect(first.width).toBe(1);expect(second.width).toBe(1);
  });
});
