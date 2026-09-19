import { describe, expect, it } from "vitest";
import { buildPreview, headerSignature, normalizeDate, parseDelimited, parseStatementMoney, suggestMapping, suggestParsingOptions } from "./csvImport";

describe("local delimited statement parser", () => {
  it("parses quoted CSV and escaped quotes", () => {
    const result = parseDelimited('Date,Description,Amount\r\n09/01/2026,"Store, Inc.","-12.34"\r\n09/02/2026,"A ""quoted"" name",5.00');
    expect(result.rows).toEqual([["09/01/2026","Store, Inc.","-12.34"],["09/02/2026",'A "quoted" name',"5.00"]]);
  });
  it("detects tab-separated statements", () => expect(parseDelimited("Date\tDescription\tAmount\n2026-09-01\tStore\t-1.00").delimiter).toBe("\t"));
  it("detects semicolon-delimited statements used with comma decimals",()=>expect(parseDelimited("Date;Description;Amount\n31/01/2026;Café;-1.234,56").delimiter).toBe(";"));
  it("creates stable normalized header signatures",()=>expect(headerSignature([" Posted Date ","DESCRIPTION","Amount"])).toBe("posted date\u001fdescription\u001famount"));
  it("normalizes common US and ISO dates", () => {
    expect(normalizeDate("9/2/2026")).toBe("2026-09-02");
    expect(normalizeDate("2026/09/02")).toBe("2026-09-02");
  });
  it("supports explicit day-first dates",()=>expect(normalizeDate("31/01/2026","dmy")).toBe("2026-01-31"));
  it("parses common statement amount conventions", () => {
    expect(parseStatementMoney("($1,234.56)")).toBe(-123456);
    expect(parseStatementMoney("25.00 CR")).toBe(2500);
  });
  it("parses comma-decimal amounts without floating point",()=>{
    expect(parseStatementMoney("€ 1.234,56","comma")).toBe(123456);
    expect(parseStatementMoney("(12,50)","comma")).toBe(-1250);
  });
  it("suggests unambiguous date and number conventions",()=>{
    const table=parseDelimited("Date;Description;Amount\n31/01/2026;Café;-1.234,56");
    const mapping=suggestMapping(table.headers);
    expect(suggestParsingOptions(table,mapping)).toEqual({dateOrder:"dmy",numberFormat:"comma"});
  });
  it("maps, normalizes, and identifies duplicates", () => {
    const table = parseDelimited("Date,Description,Amount\n09/01/2026,Store,-12.34\n09/01/2026,Store,-12.34");
    const rows = buildPreview(table, suggestMapping(table.headers), []);
    expect(rows[0]).toMatchObject({ postedDate:"2026-09-01", amountMinor:-1234 });
    expect(rows[0].duplicate).toBeUndefined();
    expect(rows[1].duplicate).toMatchObject({confidence:"exact"});
  });
});
