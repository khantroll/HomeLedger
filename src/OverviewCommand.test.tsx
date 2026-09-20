// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {OverviewCommandCenter} from "./App";
import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";

afterEach(cleanup);

describe("Overview command center",()=>{
  it("summarizes attention items and routes each card to its workspace",async()=>{
    const accounts:Account[]=[{id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:200000,ownerLabel:"Household"}];
    const templates:ScheduledTransaction[]=[{id:"rent",kind:"transaction",accountId:"checking",payee:"Rent",category:"Housing",amountMinor:-70000,status:"pending",frequency:"monthly",anchorDate:"2026-09-01",enabled:true,autoPost:true}];
    const occurrences:ScheduledOccurrence[]=[{id:"late",scheduledTransactionId:"rent",dueDate:"2026-09-01",status:"expected"},{id:"next",scheduledTransactionId:"rent",dueDate:"2026-09-25",status:"expected"}];
    const transactions:Transaction[]=[{id:"review",accountId:"checking",postedDate:"2026-09-10",payee:"Unknown",category:"Uncategorized",amountMinor:-1000,status:"review"}];
    const budgets:BudgetMonth[]=[{month:"2026-09",plannedMinor:50000,spentMinor:20000,carryInMinor:0,availableMinor:30000,lines:[]}];
    const onNavigate=vi.fn();
    const user=userEvent.setup();
    render(<OverviewCommandCenter accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} budgets={budgets} onNavigate={onNavigate} today="2026-09-20"/>);
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.getByText("$300.00")).toBeTruthy();
    expect(screen.getByText("Needs review").nextElementSibling?.textContent).toBe("1");
    await user.click(screen.getByText("30-day low point").closest("button")!);
    expect(onNavigate).toHaveBeenCalledWith("Forecast");
    await user.click(screen.getByText("Budget remaining").closest("button")!);
    expect(onNavigate).toHaveBeenCalledWith("Budget");
  });
});
