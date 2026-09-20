// @vitest-environment jsdom
import {describe,expect,it} from "vitest";
import {isCamtStatement,parseCamt} from "./camtImport";

const statement=`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">3722.22</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">12.34</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-18</Dt></BookgDt><AcctSvcrRef>BANK-1</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Neighborhood Market</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Weekly groceries</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">2500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><DtTm>2026-09-19T08:00:00Z</DtTm></BookgDt><NtryRef>BANK-2</NtryRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Employer</Nm></Dbtr></RltdPties><AddtlTxInf>September payroll</AddtlTxInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe("CAMT statement parser",()=>{
  it("parses namespaced CAMT.053 entries and closing balance",()=>{
    expect(isCamtStatement(statement)).toBe(true);
    expect(parseCamt(statement)).toEqual({
      format:"CAMT",accountIdMasked:"••••4300",accountType:"bank",currency:"EUR",dateStart:"2026-09-18",dateEnd:"2026-09-19",ledgerBalanceMinor:372222,
      rows:[
        {postedDate:"2026-09-18",payee:"Neighborhood Market",amountMinor:-1234,memo:"Weekly groceries",externalId:"BANK-1"},
        {postedDate:"2026-09-19",payee:"Employer",amountMinor:250000,memo:"September payroll",externalId:"BANK-2"}
      ]
    });
  });
  it("supports CAMT notifications and rejects dangerous or malformed XML",()=>{
    expect(parseCamt(statement.replace("camt.053","camt.054").replaceAll("Stmt>","Ntfctn>")).format).toBe("CAMT");
    expect(parseCamt(statement.replace("camt.053","camt.052").replaceAll("Stmt>","Rpt>")).format).toBe("CAMT");
    expect(()=>parseCamt(statement.replace("<?xml version=\"1.0\" encoding=\"UTF-8\"?>","<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///x'>]>") )).toThrow(/entities/);
    expect(()=>parseCamt(statement.replace("</Document>",""))).toThrow(/malformed/);
  });
  it("rejects mixed currencies, multiple accounts, and aggregated entries",()=>{
    expect(()=>parseCamt(statement.replace('<Amt Ccy="EUR">2500.00','<Amt Ccy="USD">2500.00'))).toThrow(/mixed/);
    expect(()=>parseCamt(statement.replace("</Stmt>","</Stmt><Stmt></Stmt>"))).toThrow(/exactly one/);
    expect(()=>parseCamt(statement.replace("</NtryDtls>","<TxDtls><AddtlTxInf>Second</AddtlTxInf></TxDtls></NtryDtls>"))).toThrow(/aggregates multiple/);
  });
});
