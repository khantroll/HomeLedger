// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {ForecastPage} from "./ForecastPage";
import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction} from "./domain";
import {financeRepository} from "./repository";

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const accounts:Account[]=[{id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Household"}];
const templates:ScheduledTransaction[]=[{id:"rent",kind:"transaction",accountId:"checking",payee:"Rent",category:"Housing",amountMinor:-50000,status:"pending",frequency:"monthly",anchorDate:"2026-09-15",enabled:true}];
const occurrences:ScheduledOccurrence[]=[{id:"rent-1",scheduledTransactionId:"rent",dueDate:"2026-09-15",status:"expected"}];
const budget:BudgetMonth={month:"2026-09",plannedMinor:50000,spentMinor:0,carryInMinor:0,availableMinor:50000,lines:[{id:"housing",category:"Housing",rolloverEnabled:false,plannedMinor:50000,spentMinor:0,carryInMinor:0,availableMinor:50000}]};

describe("ForecastPage",()=>{
  it("loads local occurrences and budgets and presents all scenarios",async()=>{
    vi.spyOn(financeRepository,"generateScheduledOccurrences").mockResolvedValue(1);
    vi.spyOn(financeRepository,"listScheduledOccurrences").mockResolvedValue(occurrences);
    vi.spyOn(financeRepository,"getBudgetMonth").mockResolvedValue(budget);
    render(<ForecastPage accounts={accounts} templates={templates} today="2026-09-01"/>);
    await waitFor(()=>expect(screen.getByText("Projected cash path")).toBeTruthy());
    expect(screen.getByText("Expected")).toBeTruthy();expect(screen.getByText("Conservative")).toBeTruthy();expect(screen.getByText("Optimistic")).toBeTruthy();
    await waitFor(()=>expect(screen.getAllByText("$500.00").length).toBeGreaterThan(0));
  });
  it("changes horizon and scenario without posting ledger entries",async()=>{
    const generate=vi.spyOn(financeRepository,"generateScheduledOccurrences").mockResolvedValue(0);
    vi.spyOn(financeRepository,"listScheduledOccurrences").mockResolvedValue([]);
    vi.spyOn(financeRepository,"getBudgetMonth").mockResolvedValue({...budget,plannedMinor:0,availableMinor:0,lines:[]});
    const create=vi.spyOn(financeRepository,"createTransaction");
    render(<ForecastPage accounts={accounts} templates={[]} today="2026-09-01"/>);
    await waitFor(()=>expect(generate).toHaveBeenCalled());
    fireEvent.click(screen.getByText("180d"));fireEvent.click(screen.getByText("Conservative"));
    await waitFor(()=>expect(generate).toHaveBeenLastCalledWith({fromDate:"2026-09-01",toDate:"2027-02-27"}));
    expect(create).not.toHaveBeenCalled();
  });
});
