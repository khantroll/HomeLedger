import { describe, expect, it } from "vitest";
import { buildPreview, suggestMapping, suggestParsingOptions } from "./csvImport";
import { bytesToBase64, suggestWorkbookHeaderRow, suggestWorkbookSelection, workbookHeaderChoices, workbookSheetToTable, type WorkbookSheet } from "./workbookImport";

const sheet:WorkbookSheet={name:"Checking",firstRow:1,rows:[
  ["Monthly statement"],
  ["Account ending 1234"],
  [],
  ["Posted Date","Description","Amount"],
  ["2026-09-01","Corner Market","-12.34"],
  ["2026-09-02","Payroll","1,500.00"]
]};

describe("workbook import",()=>{
  it("finds a transaction header after statement title rows",()=>{
    expect(suggestWorkbookHeaderRow(sheet)).toBe(3);
    expect(workbookHeaderChoices(sheet)).toEqual([0,1,3,4,5]);
  });

  it("skips cover sheets when choosing the initial worksheet",()=>{
    expect(suggestWorkbookSelection({sheets:[{name:"Cover",firstRow:1,rows:[["Statement"]]},sheet]})).toEqual({sheetIndex:1,headerRow:3});
  });

  it("converts a worksheet and retains physical spreadsheet row numbers",()=>{
    const table=workbookSheetToTable(sheet,3);
    const mapping=suggestMapping(table.headers);
    const preview=buildPreview(table,mapping,[],suggestParsingOptions(table,mapping));
    expect(table.headers).toEqual(["Posted Date","Description","Amount"]);
    expect(preview.map(row=>({sourceRow:row.sourceRow,payee:row.payee,amountMinor:row.amountMinor}))).toEqual([
      {sourceRow:5,payee:"Corner Market",amountMinor:-1234},
      {sourceRow:6,payee:"Payroll",amountMinor:150000}
    ]);
  });

  it("fills blank headers and rejects sheets without data rows",()=>{
    expect(workbookSheetToTable({name:"Data",firstRow:4,rows:[["Date","","Amount"],["9/1/2026","Store","-1.00"]]},0).headers).toEqual(["Date","Column 2","Amount"]);
    expect(()=>workbookSheetToTable({name:"Empty",firstRow:1,rows:[["Date","Description","Amount"]]},0)).toThrow("at least one transaction row");
  });

  it("encodes workbook bytes without argument-size failures",()=>{
    expect(bytesToBase64(new Uint8Array([0,1,2,253,254,255]).buffer)).toBe("AAEC/f7/");
  });
});
