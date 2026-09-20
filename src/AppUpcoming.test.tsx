// @vitest-environment jsdom
import { afterEach,describe,expect,it } from "vitest";
import { cleanup,render,screen } from "@testing-library/react";
import { UpcomingScheduled } from "./App";
import type { Account,ScheduledOccurrence,ScheduledTransaction } from "./domain";

afterEach(cleanup);

describe("Overview upcoming widget",()=>{
  it("shows every expected financial event, including transfers",()=>{
    const accounts:Account[]=[{id:"a",name:"Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"},{id:"b",name:"Savings",type:"savings",currency:"USD",balanceMinor:0,ownerLabel:"Household"}];
    const templates:ScheduledTransaction[]=[
      {id:"expense",kind:"transaction",accountId:"a",payee:"Rent",category:"Housing",amountMinor:-100000,status:"pending",frequency:"monthly",anchorDate:"2099-01-01",enabled:true},
      {id:"deposit",kind:"transaction",accountId:"a",payee:"Payroll",category:"Income",amountMinor:200000,status:"pending",frequency:"biweekly",anchorDate:"2099-01-02",enabled:true},
      {id:"transfer",kind:"transfer",accountId:"a",transferAccountId:"b",payee:"Savings transfer",category:"Transfer",amountMinor:25000,status:"pending",frequency:"monthly",anchorDate:"2099-01-08",enabled:true},
    ];
    const occurrences:ScheduledOccurrence[]=Array.from({length:7},(_,index)=>({id:String(index),scheduledTransactionId:index%2?"deposit":"expense",dueDate:`2099-01-${String(index+1).padStart(2,"0")}`,status:"expected"}));
    occurrences.push({id:"done",scheduledTransactionId:"expense",dueDate:"2099-01-01",status:"posted",transactionId:"t"});
    occurrences.push({id:"move",scheduledTransactionId:"transfer",dueDate:"2099-01-08",status:"expected"});
    const {container}=render(<UpcomingScheduled accounts={accounts} templates={templates} occurrences={occurrences}/>);
    expect(container.querySelectorAll(".upcoming-row")).toHaveLength(8);
    expect(screen.getAllByText("Rent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payroll").length).toBeGreaterThan(0);
    expect(screen.getByText("Savings transfer")).toBeTruthy();
    expect(screen.getByText(/Checking → Savings/)).toBeTruthy();
    expect(screen.queryByText("Posted")).toBeNull();
  });
});
