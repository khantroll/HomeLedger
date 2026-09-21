// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from "vitest";
import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillsPage } from "./BillsPage";
import { financeRepository } from "./repository";
import type { Account,ScheduledOccurrence,ScheduledTransaction,Transaction } from "./domain";

const accounts:Account[]=[{id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Household"}];
const templates:ScheduledTransaction[]=[
  {id:"bill",kind:"transaction",accountId:"checking",payee:"Electric Utility",category:"Utilities",amountMinor:-2500,status:"pending",frequency:"monthly",anchorDate:"2026-09-15",enabled:true,autoPost:true},
  {id:"income",kind:"transaction",accountId:"checking",payee:"Payroll",category:"Income",amountMinor:200000,status:"pending",frequency:"biweekly",anchorDate:"2026-09-18",enabled:false},
];
const occurrences:ScheduledOccurrence[]=[
  {id:"overdue",scheduledTransactionId:"bill",dueDate:"2026-09-15",status:"expected"},
  {id:"soon",scheduledTransactionId:"bill",dueDate:"2026-09-20",status:"expected"},
  {id:"posted",scheduledTransactionId:"income",dueDate:"2026-09-18",status:"posted",transactionId:"payroll"},
];
const transactions:Transaction[]=[{id:"utility-txn",accountId:"checking",postedDate:"2026-09-16",payee:"Utility ACH",category:"Utilities",amountMinor:-2500,status:"cleared"}];

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("BillsPage",()=>{
  it("renders bills and deposits with explicit recurrence and occurrence states",()=>{
    render(<BillsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} onChanged={async()=>{}} today="2026-09-18"/>);
    expect(screen.getAllByText("Electric Utility").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Payroll").length).toBeGreaterThan(1);
    expect(screen.getByText(/Bill \/ expense/)).toBeTruthy();
    expect(screen.getByText("Deposit / income")).toBeTruthy();
    expect(screen.getByText("Monthly on the 15th")).toBeTruthy();
    expect(screen.getByText("Every 2 weeks")).toBeTruthy();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Due soon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Posted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paused")).toHaveLength(2);
    expect(screen.getByRole("grid",{name:"September 2026 scheduled transactions"})).toBeTruthy();
    expect(screen.getByRole("gridcell",{name:/Sep 15, 2026, 1 scheduled event/})).toBeTruthy();
  });

  it("navigates the month calendar and filters the agenda by day",async()=>{
    const user=userEvent.setup();
    const {container}=render(<BillsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} onChanged={async()=>{}} today="2026-09-18"/>);
    await user.click(screen.getByRole("gridcell",{name:/Sep 15, 2026/}));
    expect(screen.getByRole("heading",{name:"Sep 15, 2026"})).toBeTruthy();
    expect(container.querySelectorAll(".occurrence-table tbody tr")).toHaveLength(1);
    await user.click(screen.getByRole("button",{name:"Show whole month"}));
    expect(screen.getByRole("heading",{name:"September 2026 agenda"})).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Next month"}));
    expect(screen.getByRole("heading",{name:"October 2026"})).toBeTruthy();
  });

  it("posts, skips, and links expected occurrences through repository actions",async()=>{
    const user=userEvent.setup(),onChanged=vi.fn(async()=>{});
    const post=vi.spyOn(financeRepository,"postScheduledOccurrence").mockResolvedValue({...transactions[0],id:"posted-now"});
    const skip=vi.spyOn(financeRepository,"skipScheduledOccurrence").mockResolvedValue({...occurrences[0],status:"skipped"});
    const link=vi.spyOn(financeRepository,"linkScheduledOccurrence").mockResolvedValue({...occurrences[0],status:"linked",transactionId:"utility-txn"});
    render(<BillsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} onChanged={onChanged} today="2026-09-18"/>);
    await user.click(screen.getAllByRole("button",{name:"Post Now"})[0]);
    expect(post).toHaveBeenCalledWith("overdue");
    await user.click(screen.getAllByRole("button",{name:/Skip/})[1]);
    expect(skip).toHaveBeenCalledWith("soon");
    await user.click(screen.getAllByRole("button",{name:/Link/})[0]);
    await user.click(screen.getByRole("button",{name:"Link transaction"}));
    expect(link).toHaveBeenCalledWith("overdue","utility-txn");
    expect(onChanged).toHaveBeenCalledTimes(3);
  });


  it("opens contextual overdue work on the relevant due date",async()=>{
    render(<BillsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} onChanged={async()=>{}} today="2026-09-18" navigationFocus={{kind:"overdue",dueDate:"2026-09-15"}}/>);
    expect(screen.getByRole("heading",{name:"Sep 15, 2026"})).toBeTruthy();
    expect(screen.getByRole("gridcell",{name:/Sep 15, 2026/}).getAttribute("aria-selected")).toBe("true");
  });

  it("opens the existing auto-post review from contextual navigation",()=>{
    render(<BillsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} onChanged={async()=>{}} today="2026-09-18" navigationFocus={{kind:"autoPost"}}/>);
    expect(screen.getByRole("dialog",{name:/Review auto-post queue/i})).toBeTruthy();
  });

  it("creates deposits using financial-language recurrence controls",async()=>{
    const user=userEvent.setup(),onChanged=vi.fn(async()=>{});
    const create=vi.spyOn(financeRepository,"createScheduledTransaction").mockImplementation(async input=>({id:"new",...input}));
    render(<BillsPage accounts={accounts} transactions={[]} templates={[]} occurrences={[]} onChanged={onChanged} today="2026-09-18"/>);
    await user.click(screen.getByRole("button",{name:/New schedule/}));
    await user.selectOptions(screen.getByLabelText("Type"),"deposit");
    await user.type(screen.getByLabelText("Payee or source"),"Side job");
    await user.clear(screen.getByLabelText("Category"));await user.type(screen.getByLabelText("Category"),"Income");
    await user.type(screen.getByLabelText("Expected amount"),"500.00");
    await user.selectOptions(screen.getByLabelText("Repeats"),"biweekly");
    await user.click(screen.getByRole("button",{name:"Save schedule"}));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({payee:"Side job",amountMinor:50000,frequency:"biweekly",kind:"transaction"}));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("creates transfer schedules and submits reviewed auto-post batches",async()=>{
    const user=userEvent.setup(),onChanged=vi.fn(async()=>{});
    const create=vi.spyOn(financeRepository,"createScheduledTransaction").mockImplementation(async input=>({id:"new",...input}));
    const process=vi.spyOn(financeRepository,"processScheduledAutoPost").mockResolvedValue({postedCount:1});
    const savings:Account={id:"savings",name:"Savings",type:"savings",currency:"USD",balanceMinor:0,ownerLabel:"Household"};
    render(<BillsPage accounts={[...accounts,savings]} transactions={transactions} templates={templates} occurrences={occurrences} onChanged={onChanged} today="2026-09-18"/>);
    await user.click(screen.getByRole("button",{name:/Review auto-post/}));
    await user.click(screen.getByRole("button",{name:"Confirm and post 1"}));
    expect(process).toHaveBeenCalledWith({occurrenceIds:["overdue"],asOfDate:"2026-09-18"});
    await user.click(screen.getByRole("button",{name:/New schedule/}));
    await user.selectOptions(screen.getByLabelText("Type"),"transfer");
    await user.selectOptions(screen.getByLabelText("To account"),"savings");
    await user.type(screen.getByLabelText("Payee or source"),"Monthly savings");
    await user.type(screen.getByLabelText("Expected amount"),"50.00");
    await user.click(screen.getByRole("button",{name:"Save schedule"}));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({kind:"transfer",accountId:"checking",transferAccountId:"savings",amountMinor:5000,category:"Transfer"}));
  });

  it("explains detected subscriptions and requires review before creating a schedule",async()=>{
    const user=userEvent.setup(),onChanged=vi.fn(async()=>{});
    const create=vi.spyOn(financeRepository,"createScheduledTransaction").mockImplementation(async input=>({id:"detected",...input}));
    const recurring:Transaction[]=[
      {id:"cloud-1",accountId:"checking",postedDate:"2026-06-15",payee:"CloudBox 101",category:"Software",amountMinor:-1299,status:"cleared",source:"import"},
      {id:"cloud-2",accountId:"checking",postedDate:"2026-07-15",payee:"CloudBox 202",category:"Software",amountMinor:-1299,status:"cleared",source:"import"},
      {id:"cloud-3",accountId:"checking",postedDate:"2026-08-15",payee:"CloudBox 303",category:"Software",amountMinor:-1299,status:"reconciled",source:"import"},
    ];
    render(<BillsPage accounts={accounts} transactions={recurring} templates={[]} occurrences={[]} onChanged={onChanged} today="2026-09-18"/>);
    expect(screen.getByText("3 payments · 31-day median · ±$0.00")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Review and schedule"}));
    expect((screen.getByLabelText("Payee or source") as HTMLInputElement).value).toBe("CloudBox 303");
    expect((screen.getByLabelText("Expected amount") as HTMLInputElement).value).toBe("12.99");
    expect((screen.getByLabelText("First due date") as HTMLInputElement).value).toBe("2026-10-15");
    await user.click(screen.getByRole("button",{name:"Save schedule"}));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({accountId:"checking",payee:"CloudBox 303",category:"Software",amountMinor:-1299,frequency:"monthly",anchorDate:"2026-10-15",autoPost:false}));
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
