import {describe,expect,it} from "vitest";
import {buildPreview,suggestMapping,suggestParsingOptions} from "./csvImport";
import {pdfTextToTable} from "./pdfImport";

describe("PDF statement recognition",()=>{
  it("recognizes only rows with explicit amount direction and preserves PDF line numbers",()=>{
    const parsed=pdfTextToTable(`Account statement\nDate Description Amount\n09/01/2026 Corner Market -$12.34\n09/02/2026 Payroll $1,500.00 CR\n09/03/2026 Running balance 2,487.66\n09/04/2026 Utility (85.20)\n09/05/2026 Fuel −40.00\nEnd of statement`);
    expect(parsed.matchedRowCount).toBe(4);
    const mapping=suggestMapping(parsed.table.headers);
    expect(buildPreview(parsed.table,mapping,[],suggestParsingOptions(parsed.table,mapping)).map(row=>({sourceRow:row.sourceRow,payee:row.payee,amountMinor:row.amountMinor}))).toEqual([
      {sourceRow:3,payee:"Corner Market",amountMinor:-1234},
      {sourceRow:4,payee:"Payroll",amountMinor:150000},
      {sourceRow:6,payee:"Utility",amountMinor:-8520},
      {sourceRow:7,payee:"Fuel",amountMinor:-4000}
    ]);
  });

  it("supports ISO dates and DR suffixes",()=>{
    const parsed=pdfTextToTable("Statement transactions\n2026-09-18 Coffee Shop 4.75 DR\n2026-09-19 Refund +2.00");
    expect(parsed.table.rows).toEqual([["2026-09-18","Coffee Shop","4.75 DR"],["2026-09-19","Refund","+2.00"]]);
  });

  it("distinguishes scanned documents from unsupported searchable layouts",()=>{
    expect(()=>pdfTextToTable("   \n")).toThrow("no searchable text");
    expect(()=>pdfTextToTable("Searchable statement with an unsigned balance of 123.45")).toThrow("no supported transaction rows");
  });
});
