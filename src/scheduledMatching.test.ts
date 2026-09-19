import {describe,expect,it} from "vitest";
import type {ScheduledOccurrence,ScheduledTransaction} from "./domain";
import {findScheduledMatches} from "./scheduledMatching";

const template:ScheduledTransaction={id:"schedule",kind:"transaction",accountId:"checking",payee:"Electric Utility",category:"Utilities",amountMinor:-15000,status:"pending",frequency:"monthly",anchorDate:"2026-01-15",enabled:true};
const occurrence:ScheduledOccurrence={id:"occurrence",scheduledTransactionId:"schedule",dueDate:"2026-09-15",status:"expected"};
const match=(overrides:Record<string,unknown>={})=>findScheduledMatches({postedDate:"2026-09-15",payee:"Electric Utility",amountMinor:-15000,...overrides},"checking",[template],[occurrence]);

describe("scheduled occurrence matching",()=>{
  it("identifies an exact match",()=>expect(match()[0]).toMatchObject({occurrenceId:"occurrence",confidence:"exact",score:100}));
  it("uses original merchant text after a display rename",()=>expect(match({payee:"City Power",originalPayee:"ELECTRIC UTILITY PAYMENT"})[0]).toMatchObject({confidence:"probable"}));
  it("allows a modest variable amount and nearby date",()=>expect(match({postedDate:"2026-09-17",amountMinor:-17200})[0]).toMatchObject({confidence:"probable",dateDifferenceDays:2,amountDifferenceMinor:2200}));
  it("rejects amount and date coincidence without merchant evidence",()=>expect(match({payee:"Unrelated Store"})).toEqual([]));
  it("rejects wrong accounts and transaction direction",()=>{
    expect(findScheduledMatches({postedDate:"2026-09-15",payee:"Electric Utility",amountMinor:-15000},"savings",[template],[occurrence])).toEqual([]);
    expect(match({amountMinor:15000})).toEqual([]);
  });
  it("matches scheduled income with the same safeguards",()=>{
    const income={...template,id:"income",payee:"Payroll Deposit",amountMinor:240000};
    const payday={...occurrence,id:"payday",scheduledTransactionId:"income"};
    expect(findScheduledMatches({postedDate:"2026-09-15",payee:"Employer Payroll Deposit",amountMinor:240000},"checking",[income],[payday])[0]).toMatchObject({occurrenceId:"payday",confidence:"probable"});
  });
  it("excludes terminal and already-linked occurrences",()=>{
    expect(findScheduledMatches({postedDate:"2026-09-15",payee:"Electric Utility",amountMinor:-15000},"checking",[template],[{...occurrence,status:"linked",transactionId:"t"}])).toEqual([]);
  });
  it("orders ambiguous candidates deterministically by score",()=>{
    const second={...occurrence,id:"later",dueDate:"2026-09-17"};
    expect(findScheduledMatches({postedDate:"2026-09-15",payee:"Electric Utility",amountMinor:-15000},"checking",[template],[second,occurrence]).map(item=>item.occurrenceId)).toEqual(["occurrence","later"]);
  });
});
