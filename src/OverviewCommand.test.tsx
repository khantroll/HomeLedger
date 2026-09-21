// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {OverviewCommandCenter} from "./App";
import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";

afterEach(cleanup);
const account:Account={id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:200000,ownerLabel:"Household"};

describe("Overview attention center",()=>{
  it("separates actionable problem states and routes them to existing workspaces",async()=>{
    const templates:ScheduledTransaction[]=[
      {id:"rent",kind:"transaction",accountId:"checking",payee:"Rent",category:"Housing",amountMinor:-250000,status:"pending",frequency:"monthly",anchorDate:"2026-09-01",enabled:true,autoPost:false},
      {id:"utility",kind:"transaction",accountId:"checking",payee:"Utility",category:"Utilities",amountMinor:-1000,status:"pending",frequency:"monthly",anchorDate:"2026-09-20",enabled:true,autoPost:true},
    ];
    const occurrences:ScheduledOccurrence[]=[{id:"late",scheduledTransactionId:"rent",dueDate:"2026-09-01",status:"expected"},{id:"auto",scheduledTransactionId:"utility",dueDate:"2026-09-20",status:"expected"},{id:"future-rent",scheduledTransactionId:"rent",dueDate:"2026-09-25",status:"expected"}];
    const transactions:Transaction[]=[{id:"review",accountId:"checking",postedDate:"2026-09-10",payee:"Unknown",category:"Uncategorized",amountMinor:-1000,status:"review"}];
    const budgets:BudgetMonth[]=[{month:"2026-09",plannedMinor:50000,spentMinor:70000,carryInMinor:0,availableMinor:-20000,lines:[{id:"food",category:"Food",rolloverEnabled:false,plannedMinor:50000,spentMinor:70000,carryInMinor:0,availableMinor:-20000}]}];
    const onNavigate=vi.fn(),user=userEvent.setup();
    render(<OverviewCommandCenter accounts={[account]} transactions={transactions} templates={templates} occurrences={occurrences} budgets={budgets} onNavigate={onNavigate} today="2026-09-20"/>);
    expect(screen.getByText("1 overdue scheduled item")).toBeTruthy();
    expect(screen.getByText("1 automatic posting is due")).toBeTruthy();
    expect(screen.getByText("1 transaction needs review")).toBeTruthy();
    expect(screen.getByText("Cash is projected to go negative")).toBeTruthy();
    expect(screen.getByText("This month’s budget is over plan")).toBeTruthy();
    expect(screen.queryByText(/Overdue \/ auto-post/i)).toBeNull();
    await user.click(screen.getByRole("button",{name:/Review bills/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Bills",focus:{kind:"overdue",dueDate:"2026-09-01"}});
    await user.click(screen.getByRole("button",{name:/Open forecast/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Forecast"});
    await user.click(screen.getByRole("button",{name:/Review budget/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Budget"});
    await user.click(screen.getByRole("button",{name:/Review transactions/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Transactions",status:"review"});
  });

  it("shows a reassuring all-clear while keeping optional budget setup quiet",()=>{
    render(<OverviewCommandCenter accounts={[account]} transactions={[]} templates={[]} occurrences={[]} budgets={[]} onNavigate={vi.fn()} today="2026-09-20"/>);
    expect(screen.getByText("You're caught up")).toBeTruthy();
    expect(screen.getByText("No current budget plan")).toBeTruthy();
    expect(screen.getByText(/Optional: add a monthly budget/i)).toBeTruthy();
    expect(screen.queryByText(/needs a look/i)).toBeNull();
  });
});
