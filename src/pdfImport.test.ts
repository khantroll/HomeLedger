import {describe,expect,it} from "vitest";
import {buildPreview,suggestMapping,suggestParsingOptions} from "./csvImport";
import {isPdfComplete,pdfTextToTable,representativePdfLines,suggestPdfLayout} from "./pdfImport";

function preview(text:string,layout:Parameters<typeof pdfTextToTable>[1]){
  const parsed=pdfTextToTable(text,layout),mapping=suggestMapping(parsed.table.headers);
  return{parsed,mapping,rows:buildPreview(parsed.table,mapping,[],suggestParsingOptions(parsed.table,mapping))};
}

describe("PDF statement recognition",()=>{
  it("recognizes explicitly directed signed amounts and preserves PDF line numbers",()=>{
    const {parsed,rows}=preview(`Account statement
Date Description Amount
09/01/2026 Corner Market -$12.34
09/02/2026 Payroll $1,500.00 CR
09/04/2026 Utility (85.20)
09/05/2026 Fuel −40.00
End of statement`,"signed-last");
    expect(parsed).toMatchObject({candidateRowCount:4,matchedRowCount:4,unmatchedLineNumbers:[]});
    expect(rows.map(row=>({sourceRow:row.sourceRow,payee:row.payee,amountMinor:row.amountMinor}))).toEqual([
      {sourceRow:3,payee:"Corner Market",amountMinor:-1234},{sourceRow:4,payee:"Payroll",amountMinor:150000},{sourceRow:5,payee:"Utility",amountMinor:-8520},{sourceRow:6,payee:"Fuel",amountMinor:-4000}
    ]);
  });

  it("supports a signed amount followed by a running balance",()=>{
    const text="Statement transactions\n2026-09-18 Coffee Shop 4.75 DR 995.25\n2026-09-19 Refund +2.00 997.25";
    expect(suggestPdfLayout(text)).toBe("signed-before-balance");
    expect(preview(text,"signed-before-balance").rows.map(row=>row.amountMinor)).toEqual([-475,200]);
  });

  it("supports separate debit and credit columns while requiring exactly one side per row",()=>{
    const text="Activity\n09/01/2026 Corner Market  12.34    \n09/02/2026 Payroll      1,500.00";
    const {parsed,mapping,rows}=preview(text,"debit-credit-last");
    expect(parsed).toMatchObject({candidateRowCount:2,matchedRowCount:2,unmatchedLineNumbers:[]});
    expect(mapping).toMatchObject({date:0,payee:1,amount:-1,debit:2,credit:3});
    expect(rows.map(row=>row.amountMinor)).toEqual([-1234,150000]);
  });

  it("requires explicit selection before treating unsigned credit-card amounts as expenses",()=>{
    const text="Credit card activity\n09/01/2026 Corner Market 12.34\n09/02/2026 Fuel 40.00";
    const safe=pdfTextToTable(text);
    expect(safe).toMatchObject({candidateRowCount:2,matchedRowCount:0,unmatchedLineNumbers:[2,3]});
    expect(preview(text,"expenses-last").rows.map(row=>row.amountMinor)).toEqual([-1234,-4000]);
  });

  it("exposes representative rejected rows and reruns recognition deterministically when layout changes",()=>{
    const text="Credit card activity\n09/01/2026 Corner Market 12.34\n09/02/2026 Fuel 40.00";
    const rejected=pdfTextToTable(text,"signed-last");
    expect(representativePdfLines(rejected,1)).toEqual([{lineNumber:2,text:"09/01/2026 Corner Market 12.34",matched:false}]);
    const taught=pdfTextToTable(text,"expenses-last");
    expect(taught).toMatchObject({candidateRowCount:2,matchedRowCount:2,unmatchedLineNumbers:[]});
    expect(representativePdfLines(taught,2).every(line=>line.matched)).toBe(true);
  });

  it("blocks partial layouts instead of silently omitting dated rows",()=>{
    const parsed=pdfTextToTable("Statement activity\n09/01/2026 Store -10.00\n09/02/2026 Unsupported row 20.00");
    expect(parsed).toMatchObject({candidateRowCount:2,matchedRowCount:1,unmatchedLineNumbers:[3]});
    expect(parsed.candidateLines.find(line=>line.lineNumber===3)).toMatchObject({matched:false,text:"09/02/2026 Unsupported row 20.00"});
    expect(isPdfComplete(parsed)).toBe(false);
  });

  it("rejects structurally ambiguous debit/credit rows instead of guessing",()=>{
    const parsed=pdfTextToTable("Statement activity\n09/01/2026 Ambiguous  10.00  20.00","debit-credit-last");
    expect(parsed).toMatchObject({candidateRowCount:1,matchedRowCount:0,unmatchedLineNumbers:[2]});
    expect(isPdfComplete(parsed)).toBe(false);
  });

  it("distinguishes scanned documents from searchable documents without dated rows",()=>{
    expect(()=>pdfTextToTable("   \n")).toThrow("no searchable text");
    expect(pdfTextToTable("Searchable statement with an unsigned balance of 123.45")).toMatchObject({candidateRowCount:0,matchedRowCount:0});
  });
});
