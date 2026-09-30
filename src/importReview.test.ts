import {describe,expect,it} from "vitest";
import type {Account} from "./domain";
import type {PreviewRow} from "./csvImport";
import {applyImportReviewEdits,importBlockingReason,matchingReviewSourceRows,suggestTransferAccount} from "./importReview";

const accounts:Account[]=[
  {id:"checking",name:"RFCU Checking",institution:"Rivertown Federal Credit Union",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
  {id:"citi",name:"Citi Card",institution:"Citi",type:"credit",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
  {id:"chase",name:"Chase Card",institution:"Chase",type:"credit",currency:"USD",balanceMinor:0,ownerLabel:"Household"}
];
const row=(sourceRow:number,payee:string,amountMinor:number):PreviewRow=>({sourceRow,postedDate:"2026-06-03",payee,amountMinor});

describe("import review model",()=>{
  it("keeps raw statement description while applying payee and category corrections",()=>{
    const edited=applyImportReviewEdits([row(1,"ARKANSAS VALLEY",-7995)],new Map([[1,{payee:"Arkansas Valley Electric",category:"Utilities: Electric"}]]))[0];
    expect(edited).toMatchObject({payee:"Arkansas Valley Electric",originalPayee:"ARKANSAS VALLEY",category:"Utilities: Electric",amountMinor:-7995});
  });

  it("lets a recognized payee remain uncategorized",()=>{
    const edited=applyImportReviewEdits([row(2,"PAYPAL",-399)],new Map([[2,{payee:"PayPal",category:""}]]))[0];
    expect(edited).toMatchObject({payee:"PayPal",originalPayee:"PAYPAL"});
    expect(edited.category).toBe("Uncategorized");
  });

  it("suggests but does not select a matching credit-card account",()=>{
    const citi=row(3,"CITI AUTOPAY",-15000);
    expect(suggestTransferAccount(citi,"checking",accounts)?.id).toBe("citi");
    expect(applyImportReviewEdits([citi],new Map())[0]).not.toHaveProperty("transferAccountId");
  });

  it("supports explicit transfer confirmation in review state",()=>{
    const chase=row(4,"CHASE CREDIT CRD",-80000);
    const edited=applyImportReviewEdits([chase],new Map([[4,{payee:"Chase",transferAccountId:"chase"}]]))[0] as PreviewRow&{transferAccountId?:string};
    expect(edited).toMatchObject({payee:"Chase",originalPayee:"CHASE CREDIT CRD",transferAccountId:"chase",amountMinor:-80000});
  });

  it("finds repeated normalized descriptions only after an explicit user action",()=>{
    const rows=[row(1,"ARKANSAS VALLEY",-7995),row(2,"Arkansas-Valley",-8200),row(3,"PAYPAL",-399)];
    expect(matchingReviewSourceRows(rows,1)).toEqual([1,2]);
  });

  it("reports the actual fail-closed reason in precedence order",()=>{
    expect(importBlockingReason({unresolved:3,balanceMismatches:1,errors:2,currencyMismatch:true,ready:0})).toContain("3 transaction candidates");
    expect(importBlockingReason({unresolved:0,balanceMismatches:0,errors:1,currencyMismatch:false,ready:5})).toContain("1 parsed row");
    expect(importBlockingReason({unresolved:0,balanceMismatches:0,errors:0,currencyMismatch:false,ready:5})).toBe("");
  });
});
