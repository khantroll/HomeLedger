import { describe, expect, it } from "vitest";
import type { Account, ScheduledTransaction, Security, Transaction } from "./domain";
import { financialFind, groupFinancialFindResults } from "./financialFind";

const accounts:Account[]=[
 {id:"checking",name:"Household Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
 {id:"old",name:"Old Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:true},
];
const transactions:Transaction[]=[
 {id:"t1",accountId:"checking",postedDate:"2026-09-12",payee:"Lowes",category:"Home Improvement",amountMinor:-8421,status:"cleared",memo:"garage shelves"},
 {id:"t2",accountId:"old",postedDate:"2022-03-01",payee:"LOWES #42",category:"Repairs",amountMinor:-12000,status:"reconciled"},
 {id:"t3",accountId:"checking",postedDate:"2026-09-13",payee:"Corner Store",category:"Home supplies",amountMinor:-8421,status:"cleared",memo:"Lowes return box"},
];
const schedules:ScheduledTransaction[]=[
 {id:"s1",kind:"transaction",accountId:"checking",payee:"Electric Utility",category:"Utilities",amountMinor:-10000,status:"pending",frequency:"monthly",anchorDate:"2026-10-01",enabled:true},
 {id:"s2",kind:"transaction",accountId:"old",payee:"Old Gym",category:"Fitness",amountMinor:-3000,status:"pending",frequency:"monthly",anchorDate:"2022-01-01",enabled:false,archived:true},
];
const securities:Security[]=[
 {id:"sec1",securityType:"stock",name:"Microsoft Corporation",symbol:"MSFT",currency:"USD",archived:false},
 {id:"sec2",securityType:"stock",name:"Legacy Holdings",symbol:"OLD",currency:"USD",archived:true},
];

describe("Financial Find matching",()=>{
 it("matches case-insensitive partial payees with deterministic strong-first ordering",()=>{
   const results=financialFind("low",{accounts,transactions,schedules,securities});
   expect(results.filter(r=>r.kind==="transaction").map(r=>r.id)).toEqual(["transaction:t1","transaction:t2","transaction:t3"]);
 });
 it("searches category, memo, account, schedule, security name and symbol",()=>{
   const data={accounts,transactions,schedules,securities};
   expect(financialFind("improve",data).some(r=>r.id==="transaction:t1")).toBe(true);
   expect(financialFind("shelves",data).some(r=>r.id==="transaction:t1")).toBe(true);
   expect(financialFind("household check",data).some(r=>r.kind==="account")).toBe(true);
   expect(financialFind("electric",data).some(r=>r.kind==="schedule")).toBe(true);
   expect(financialFind("micro",data).some(r=>r.kind==="security")).toBe(true);
   expect(financialFind("msft",data)[0]).toMatchObject({kind:"security",securityId:"sec1"});
 });
 it("retains historical archived-account transactions and marks inactive entities",()=>{
   const historical=financialFind("LOWES #42",{accounts,transactions,schedules,securities})[0];
   expect(historical).toMatchObject({kind:"transaction",transactionId:"t2",archived:true});
   expect(financialFind("old gym",{accounts,transactions,schedules,securities})[0]).toMatchObject({kind:"schedule",archived:true});
   expect(financialFind("legacy",{accounts,transactions,schedules,securities})[0]).toMatchObject({kind:"security",archived:true});
 });
 it("matches useful amount representation",()=>{
   expect(financialFind("84.21",{accounts,transactions,schedules,securities}).some(r=>r.id==="transaction:t1")).toBe(true);
 });
 it("emits only non-empty groups",()=>{
   const groups=groupFinancialFindResults(financialFind("electric",{accounts,transactions,schedules,securities}));
   expect(groups.map(g=>g.label)).toEqual(["Bills & deposits"]);
 });
 it("is read-only over source data",()=>{
   const before=JSON.stringify({accounts,transactions,schedules,securities});
   financialFind("lowes",{accounts,transactions,schedules,securities});
   expect(JSON.stringify({accounts,transactions,schedules,securities})).toBe(before);
 });
});
