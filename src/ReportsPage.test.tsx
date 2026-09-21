// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ReportsPage} from "./ReportsPage";
import type {Account,Transaction} from "./domain";
import {csvExportRepository} from "./repository";

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const accounts:Account[]=[{id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Household"},{id:"card",name:"Card",type:"credit",currency:"USD",balanceMinor:-5000,ownerLabel:"Household"}];
const transactions:Transaction[]=[
  {id:"pay",accountId:"checking",postedDate:"2026-09-01",payee:"Payroll",category:"Income",amountMinor:200000,status:"cleared",source:"manual"},
  {id:"market",accountId:"card",postedDate:"2026-09-05",payee:"Market",category:"Split transaction",amountMinor:-6000,status:"cleared",source:"import",splits:[{id:"food",category:"Food",amountMinor:-4000},{id:"home",category:"Household",amountMinor:-2000}]},
  {id:"rent",accountId:"checking",postedDate:"2026-09-10",payee:"Landlord",category:"Housing",amountMinor:-80000,status:"cleared",source:"manual"},
];

describe("ReportsPage",()=>{
  it("shows local totals, monthly trends, and split-aware category drill-down",async()=>{
    const user=userEvent.setup();render(<ReportsPage accounts={accounts} transactions={transactions} today="2026-09-19"/>);
    expect(screen.getByText("$2,000.00")).toBeTruthy();expect(screen.getAllByText("$860.00").length).toBeGreaterThan(0);expect(screen.getByText("57.0%")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:/Food/}));expect(screen.getByText("2 split lines")).toBeTruthy();expect(screen.getAllByText("$40.00").length).toBeGreaterThan(0);
  });
  it("switches to payee grouping and filters one account",async()=>{
    const user=userEvent.setup();render(<ReportsPage accounts={accounts} transactions={transactions} today="2026-09-19"/>);
    await user.click(screen.getByRole("button",{name:/Payee/}));expect(screen.getByRole("button",{name:/Market/})).toBeTruthy();expect(screen.getByRole("button",{name:/Landlord/})).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Account"),"checking");expect(screen.queryByRole("button",{name:/Market/})).toBeNull();expect(screen.getByRole("button",{name:/Landlord/})).toBeTruthy();
  });
  it("supports a custom date range with visible validation",async()=>{
    const user=userEvent.setup();render(<ReportsPage accounts={accounts} transactions={transactions} today="2026-09-19"/>);
    await user.selectOptions(screen.getByLabelText("Period"),"custom");const from=screen.getByLabelText("From");await user.clear(from);await user.type(from,"2026-09-20");expect(screen.getByRole("alert").textContent).toContain("after");
  });
  it("exports the active report through the local CSV save service",async()=>{
    const user=userEvent.setup(),save=vi.spyOn(csvExportRepository,"saveCsv").mockResolvedValue(true);render(<ReportsPage accounts={accounts} transactions={transactions} today="2026-09-19"/>);
    await user.selectOptions(screen.getByLabelText("Account"),"checking");await user.click(screen.getByRole("button",{name:"Export CSV"}));
    expect(save).toHaveBeenCalledWith(expect.stringContaining('"Account","Checking"'),"HomeLedger-report-2026-07-01-to-2026-09-19.csv");
    expect((await screen.findByRole("status")).textContent).toContain("Report CSV saved");
  });
  it("opens a contributing account register through an accessible contextual link",async()=>{
    const user=userEvent.setup(),onOpenAccount=vi.fn();
    render(<ReportsPage accounts={accounts} transactions={transactions} today="2026-09-19" onOpenAccount={onOpenAccount}/>);
    await user.click(screen.getByRole("button",{name:/Food/}));
    await user.click(screen.getByRole("button",{name:"Open Card register"}));
    expect(onOpenAccount).toHaveBeenCalledWith("card");
  });

});
