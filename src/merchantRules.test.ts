import { describe,expect,it } from "vitest";
import { applyMerchantRules,merchantRulePrecedenceCompare,normalizeMerchant,ruleMatches } from "./merchantRules";
import type { MerchantRule } from "./domain";

const rule=(patch:Partial<MerchantRule>={}):MerchantRule=>({id:"rule-1",name:"Market",pattern:"NEIGHBORHOOD MARKET",matchType:"contains",direction:"expense",renameTo:"Neighborhood Market",category:"Food: Groceries",priority:100,enabled:true,...patch});

describe("deterministic merchant rules",()=>{
  it("normalizes case, punctuation, and repeated spacing",()=>{
    expect(normalizeMerchant("  SQ *Neighborhood--Market #042  ")).toBe("sq neighborhood market 042");
  });

  it("matches normalized text and transaction direction",()=>{
    expect(ruleMatches(rule(),"SQ * NEIGHBORHOOD MARKET 042",-1250)).toBe(true);
    expect(ruleMatches(rule(),"SQ * NEIGHBORHOOD MARKET 042",1250)).toBe(false);
  });

  it("preserves explicit reviewed corrections instead of reapplying a weaker rule",()=>{
    const reviewed={postedDate:"2026-09-18",payee:"Arkansas Valley Electric",originalPayee:"ARKANSAS VALLEY",amountMinor:-7995,category:"Utilities: Electric"};
    const result=applyMerchantRules([reviewed],[rule({pattern:"ARKANSAS VALLEY",renameTo:"Wrong Payee",category:"Wrong Category"})])[0];
    expect(result.rule).toBeUndefined();
    expect(result.row).toEqual(reviewed);
  });

  it("keeps custom rules above remembered corrections even when remembered has higher numeric priority",()=>{
    const manual=rule({id:"manual",origin:"manual",pattern:"ARKANSAS VALLEY",matchType:"exact",priority:10,renameTo:"Arkansas Valley Electric",category:"Utilities: Electric"});
    const remembered=rule({id:"remembered",origin:"remembered",pattern:"ARKANSAS VALLEY",matchType:"exact",priority:9999,renameTo:"Wrong",category:"Wrong"});
    const result=applyMerchantRules([{postedDate:"2026-09-18",payee:"ARKANSAS VALLEY",amountMinor:-7995}],[remembered,manual])[0];
    expect(result.rule?.id).toBe("manual");
    expect(result.row).toMatchObject({payee:"Arkansas Valley Electric",category:"Utilities: Electric"});
    expect([remembered,manual].sort(merchantRulePrecedenceCompare).map(item=>item.id)).toEqual(["manual","remembered"]);
  });

  it("supports exact, starts-with, and contains matching without fuzzy broadening",()=>{
    expect(ruleMatches(rule({matchType:"exact",pattern:"PAYPAL"}),"PAYPAL",-399)).toBe(true);
    expect(ruleMatches(rule({matchType:"exact",pattern:"PAYPAL"}),"PAYPAL STORE",-399)).toBe(false);
    expect(ruleMatches(rule({matchType:"starts_with",pattern:"PAYPAL"}),"PAYPAL STORE",-399)).toBe(true);
    expect(ruleMatches(rule({matchType:"contains",pattern:"PAYPAL"}),"PP PAYMENT PAYPAL STORE",-399)).toBe(true);
  });

  it("uses highest priority and preserves explicit source categories",()=>{
    const rows=[{postedDate:"2026-09-18",payee:"SQ *Neighborhood Market",amountMinor:-1250},{postedDate:"2026-09-19",payee:"Neighborhood Market",amountMinor:-500,category:"QIF Category"}];
    const applications=applyMerchantRules(rows,[rule({id:"low",priority:10,category:"Low"}),rule({id:"high",priority:200})]);
    expect(applications[0].row).toMatchObject({originalPayee:"SQ *Neighborhood Market",payee:"Neighborhood Market",category:"Food: Groceries"});
    expect(applications[0].rule?.id).toBe("high");
    expect(applications[1].row.category).toBe("QIF Category");
  });
});
