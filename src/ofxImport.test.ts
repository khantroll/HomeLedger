import { describe, expect, it } from "vitest";
import { buildOfxPreview, parseOfx } from "./ofxImport";

const sgml = `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><ACCTID>123456789</BANKACCTFROM><BANKTRANLIST><DTSTART>20260901000000.000[-5:EST]<DTEND>20260930235959<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260918120000<TRNAMT>-12.34<FITID>abc-1<NAME>Store &amp; Market<MEMO>Weekly groceries<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260919000000<TRNAMT>2500.00<FITID>abc-2<NAME>Payroll</BANKTRANLIST><LEDGERBAL><BALAMT>3124.55<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("OFX/QFX parser", () => {
  it("parses OFX 1.x SGML transactions and metadata", () => {
    const result = parseOfx(sgml);
    expect(result).toMatchObject({ accountIdMasked:"••••6789", currency:"USD", dateStart:"2026-09-01", dateEnd:"2026-09-30", ledgerBalanceMinor:312455 });
    expect(result.rows[0]).toMatchObject({ postedDate:"2026-09-18", payee:"Store & Market", amountMinor:-1234, memo:"Weekly groceries", externalId:"abc-1" });
    expect(result.rows[1].amountMinor).toBe(250000);
  });
  it("parses XML-style credit-card QFX", () => {
    const xml = `<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD</CURDEF><CCACCTFROM><ACCTID>9876</ACCTID></CCACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260918</DTPOSTED><TRNAMT>-5.25</TRNAMT><FITID>q1</FITID><MEMO>Coffee</MEMO></STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    expect(parseOfx(xml)).toMatchObject({ accountType:"credit-card", accountIdMasked:"••••9876" });
  });
  it("uses FITID to identify a repeated bank transaction", () => {
    const statement = parseOfx(sgml);
    const existing = [{ id:"t", accountId:"a", postedDate:"2026-09-18", payee:"Renamed merchant", category:"Food", amountMinor:-1234, status:"cleared" as const, externalId:"abc-1" }];
    expect(buildOfxPreview(statement, existing)[0].duplicate).toBe(true);
  });
  it("rejects investment-account OFX explicitly", () => expect(() => parseOfx("<OFX><INVSTMTRS><INVTRANLIST></INVTRANLIST></INVSTMTRS></OFX>")).toThrow(/Investment-account/));
});
