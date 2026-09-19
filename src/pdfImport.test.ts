import {describe,expect,it} from "vitest";
import {buildPreview,suggestMapping,suggestParsingOptions} from "./csvImport";
import {isPdfComplete,pdfTextToTable,suggestPdfLayout} from "./pdfImport";

function preview(text:string,layout:Parameters<typeof pdfTextToTable>[1]){const parsed=pdfTextToTable(text,layout),mapping=suggestMapping(parsed.table.headers);return{parsed,rows:buildPreview(parsed.table,mapping,[],suggestParsingOptions(parsed.table,mapping))};}

describe("PDF statement recognition",()=>{
  it("recognizes explicitly directed amounts and preserves PDF line numbers",()=>{
    const {parsed,rows}=preview(`Account statement\nDate Description Amount\n09/01/2026 Corner Market -$12.34\n09/02/2026 Payroll $1,500.00 CR\n09/04/2026 Utility (85.20)\n09/05/2026 Fuel −40.00\nEnd of statement`,"signed-last");
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

  it("requires explicit selection before treating unsigned credit-card amounts as expenses",()=>{
    const text="Credit card activity\n09/01/2026 Corner Market 12.34\n09/02/2026 Fuel 40.00";
    const safe=pdfTextToTable(text);
    expect(safe).toMatchObject({candidateRowCount:2,matchedRowCount:0,unmatchedLineNumbers:[2,3]});
    expect(preview(text,"expenses-last").rows.map(row=>row.amountMinor)).toEqual([-1234,-4000]);
  });

  it("blocks partial layouts instead of silently omitting dated rows",()=>{
    const parsed=pdfTextToTable("Statement activity\n09/01/2026 Store -10.00\n09/02/2026 Unsupported row 20.00");
    expect(parsed).toMatchObject({candidateRowCount:2,matchedRowCount:1,unmatchedLineNumbers:[3]});
    expect(isPdfComplete(parsed)).toBe(false);
  });

  it("distinguishes scanned documents from searchable documents without dated rows",()=>{
    expect(()=>pdfTextToTable("   \n")).toThrow("no searchable text");
    expect(pdfTextToTable("Searchable statement with an unsigned balance of 123.45")).toMatchObject({candidateRowCount:0,matchedRowCount:0});
  });
});
