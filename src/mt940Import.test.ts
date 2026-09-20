import {describe,expect,it} from "vitest";
import {isMt940Statement,parseMt940} from "./mt940Import";

const statement=`:20:STARTUMSE
:25:NL91ABNA0417164300
:28C:00001/001
:60F:C260901EUR1234,56
:61:2609180918D12,34NTRFNONREF//BANK-1
:86:?20NEIGHBORHOOD MARKET?21WEEKLY GROCERIES
:61:260919C2500,00NTRFPAYROLL//BANK-2
:86:Employer payroll
:62F:C260930EUR3722,22
-`;

describe("MT940 statement parser",()=>{
  it("parses transactions, metadata, signs, references, and structured descriptions",()=>{
    expect(isMt940Statement(statement)).toBe(true);
    expect(parseMt940(statement)).toEqual({
      format:"MT940",accountIdMasked:"••••4300",accountType:"bank",currency:"EUR",dateStart:"2026-09-18",dateEnd:"2026-09-19",ledgerBalanceMinor:372222,
      rows:[
        {postedDate:"2026-09-18",payee:"NEIGHBORHOOD MARKET WEEKLY GROCERIES",amountMinor:-1234,memo:"NONREF",externalId:"BANK-1"},
        {postedDate:"2026-09-19",payee:"Employer payroll",amountMinor:250000,memo:"PAYROLL",externalId:"BANK-2"}
      ]
    });
  });
  it("handles reversed entries and rejects incomplete statements",()=>{
    expect(parseMt940(statement.replace("D12,34","RD12,34")).rows[0].amountMinor).toBe(1234);
    expect(parseMt940(statement.replace("D12,34","DE12,34")).rows[0].amountMinor).toBe(-1234);
    expect(()=>parseMt940(":20:X\n:61:260918D1,00NTRFREF")).toThrow(/currency/);
  });
  it("rejects multiple accounts and malformed transactions instead of partially importing",()=>{
    expect(()=>parseMt940(statement.replace(":28C:",":25:OTHER\n:28C:"))).toThrow(/one account/);
    expect(()=>parseMt940(statement.replace("2609180918D12,34NTRF","not-a-transaction"))).toThrow(/transaction 1/);
  });
});
