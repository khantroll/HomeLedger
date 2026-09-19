import { describe,expect,it } from "vitest";
import { applyMerchantRules,normalizeMerchant,ruleMatches } from "./merchantRules";
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
  it("uses highest priority and preserves explicit source categories",()=>{
    const rows=[{postedDate:"2026-09-18",payee:"SQ *Neighborhood Market",amountMinor:-1250},{postedDate:"2026-09-19",payee:"Neighborhood Market",amountMinor:-500,category:"QIF Category"}];
    const applications=applyMerchantRules(rows,[rule({id:"low",priority:10,category:"Low"}),rule({id:"high",priority:200})]);
    expect(applications[0].row).toMatchObject({originalPayee:"SQ *Neighborhood Market",payee:"Neighborhood Market",category:"Food: Groceries"});
    expect(applications[0].rule?.id).toBe("high");
    expect(applications[1].row.category).toBe("QIF Category");
  });
});
