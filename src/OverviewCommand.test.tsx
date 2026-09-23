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
    expect(screen.getByRole("heading",{name:"Today"})).toBeTruthy();
    expect(screen.getByText("Rent is overdue")).toBeTruthy();
    expect(screen.getByText("1 automatic posting is due")).toBeTruthy();
    expect(screen.getByText("1 transaction needs review")).toBeTruthy();
    expect(screen.getByText("Cash is projected to go negative")).toBeTruthy();
    expect(screen.getByText("This month’s budget is over plan")).toBeTruthy();
    expect(screen.queryByText(/Overdue \/ auto-post/i)).toBeNull();
    await user.click(screen.getByRole("button",{name:/Review bills/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Bills",focus:{kind:"overdue",dueDate:"2026-09-01"}});
    await user.click(screen.getByRole("button",{name:/Open forecast/i}));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({page:"Forecast",focus:expect.objectContaining({horizonDays:30})}));
    await user.click(screen.getByRole("button",{name:/Review budget/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Budget",focus:{month:"2026-09"}});
    await user.click(screen.getByRole("button",{name:/Review transactions/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Transactions",status:"review"});
    await user.click(screen.getByRole("button",{name:/Review scheduled items/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Bills",focus:{kind:"autoPost"}});
  });

  it("shows a reassuring all-clear, quiet setup cues, and calm near-term cash context",async()=>{
    const onNavigate=vi.fn(),user=userEvent.setup();
    render(<OverviewCommandCenter accounts={[account]} transactions={[]} templates={[]} occurrences={[]} budgets={[]} onNavigate={onNavigate} today="2026-09-20"/>);
    expect(screen.getByText("You're caught up")).toBeTruthy();
    expect(screen.getByText("No current budget plan")).toBeTruthy();
    expect(screen.getByText(/Optional: add a monthly budget/i)).toBeTruthy();
    expect(screen.queryByText(/needs a look/i)).toBeNull();
    expect(screen.getByText("Near-term cash")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:/See forecast/i}));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({page:"Forecast",focus:expect.objectContaining({horizonDays:30})}));
  });

  it("surfaces due-soon schedules quietly when nothing is overdue",async()=>{
    const templates:ScheduledTransaction[]=[{id:"gym",kind:"transaction",accountId:"checking",payee:"Gym",category:"Health",amountMinor:-4500,status:"pending",frequency:"monthly",anchorDate:"2026-09-22",enabled:true,autoPost:false}];
    const occurrences:ScheduledOccurrence[]=[{id:"soon",scheduledTransactionId:"gym",dueDate:"2026-09-22",status:"expected"}];
    const budgets:BudgetMonth[]=[{month:"2026-09",plannedMinor:10000,spentMinor:1000,carryInMinor:0,availableMinor:9000,lines:[{id:"health",category:"Health",rolloverEnabled:false,plannedMinor:10000,spentMinor:1000,carryInMinor:0,availableMinor:9000}]}];
    const onNavigate=vi.fn(),user=userEvent.setup();
    render(<OverviewCommandCenter accounts={[account]} transactions={[]} templates={templates} occurrences={occurrences} budgets={budgets} onNavigate={onNavigate} today="2026-09-20"/>);
    expect(screen.getByText("Gym is due soon")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:/Open bills/i}));
    expect(onNavigate).toHaveBeenCalledWith({page:"Bills",focus:{kind:"day",dueDate:"2026-09-22"}});
  });

  it("does not duplicate same-day auto-post items as quiet due-soon attention",()=>{
    const templates:ScheduledTransaction[]=[{id:"utility",kind:"transaction",accountId:"checking",payee:"Utility",category:"Utilities",amountMinor:-1000,status:"pending",frequency:"monthly",anchorDate:"2026-09-20",enabled:true,autoPost:true}];
    const occurrences:ScheduledOccurrence[]=[{id:"auto",scheduledTransactionId:"utility",dueDate:"2026-09-20",status:"expected"}];
    const budgets:BudgetMonth[]=[{month:"2026-09",plannedMinor:10000,spentMinor:0,carryInMinor:0,availableMinor:10000,lines:[{id:"x",category:"Misc",rolloverEnabled:false,plannedMinor:10000,spentMinor:0,carryInMinor:0,availableMinor:10000}]}];
    render(<OverviewCommandCenter accounts={[account]} transactions={[]} templates={templates} occurrences={occurrences} budgets={budgets} onNavigate={vi.fn()} today="2026-09-20"/>);
    expect(screen.getByText("1 automatic posting is due")).toBeTruthy();
    expect(screen.queryByText(/due soon/i)).toBeNull();
  });

  it("does not treat archived or paused schedules as actionable attention",()=>{
    const templates:ScheduledTransaction[]=[
      {id:"old",kind:"transaction",accountId:"checking",payee:"Archived Bill",category:"Housing",amountMinor:-1000,status:"pending",frequency:"monthly",anchorDate:"2026-09-01",enabled:true,autoPost:false,archived:true},
      {id:"paused",kind:"transaction",accountId:"checking",payee:"Paused Bill",category:"Utilities",amountMinor:-1000,status:"pending",frequency:"monthly",anchorDate:"2026-09-01",enabled:false,autoPost:false},
    ];
    const occurrences:ScheduledOccurrence[]=[
      {id:"a",scheduledTransactionId:"old",dueDate:"2026-09-01",status:"expected"},
      {id:"b",scheduledTransactionId:"paused",dueDate:"2026-09-01",status:"expected"},
    ];
    const budgets:BudgetMonth[]=[{month:"2026-09",plannedMinor:10000,spentMinor:0,carryInMinor:0,availableMinor:10000,lines:[{id:"x",category:"Misc",rolloverEnabled:false,plannedMinor:10000,spentMinor:0,carryInMinor:0,availableMinor:10000}]}];
    render(<OverviewCommandCenter accounts={[account]} transactions={[]} templates={templates} occurrences={occurrences} budgets={budgets} onNavigate={vi.fn()} today="2026-09-20"/>);
    expect(screen.queryByText(/Archived Bill/)).toBeNull();
    expect(screen.queryByText(/Paused Bill/)).toBeNull();
    expect(screen.getByText("You're caught up")).toBeTruthy();
  });
});
