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
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Due soon")).toBeTruthy();
    expect(screen.getByText("Posted")).toBeTruthy();
    expect(screen.getAllByText("Paused")).toHaveLength(2);
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
});
