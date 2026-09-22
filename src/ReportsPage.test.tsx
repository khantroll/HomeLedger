// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ReportsPage} from "./ReportsPage";
import type {Account,PortfolioSnapshot,Transaction} from "./domain";
import {csvExportRepository,investmentRepository} from "./repository";

vi.mock("./repository",async()=>{
  const actual=await vi.importActual<typeof import("./repository")>("./repository");
  return {
    ...actual,
    isNativeApp:true,
    investmentRepository:{
      ...actual.investmentRepository,
      calculatePortfolioSnapshot:vi.fn(),
      listSecurities:vi.fn(),
      listInvestmentEvents:vi.fn(),
    },
  };
});

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const accounts:Account[]=[
  {id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Household"},
  {id:"card",name:"Card",type:"credit",currency:"USD",balanceMinor:-5000,ownerLabel:"Household"},
  {id:"inv",name:"Brokerage",type:"investment",currency:"USD",balanceMinor:999999,ownerLabel:"Household"},
  {id:"old",name:"Old brokerage",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:true},
];
const transactions:Transaction[]=[
  {id:"pay",accountId:"checking",postedDate:"2026-09-01",payee:"Payroll",category:"Income",amountMinor:200000,status:"cleared",source:"manual"},
  {id:"market",accountId:"card",postedDate:"2026-09-05",payee:"Market",category:"Split transaction",amountMinor:-6000,status:"cleared",source:"import",splits:[{id:"food",category:"Food",amountMinor:-4000},{id:"home",category:"Household",amountMinor:-2000}]},
  {id:"rent",accountId:"checking",postedDate:"2026-09-10",payee:"Landlord",category:"Housing",amountMinor:-80000,status:"cleared",source:"manual"},
];

const investmentSnapshot:PortfolioSnapshot={
  asOfDate:"2026-09-19",
  accounts:[{
    accountId:"inv",
    cashMinor:2500,
    holdings:[{
      accountId:"inv",
      securityId:"sec",
      quantityE8:100_000_000,
      knownBasisMinor:10000,
      unknownBasisQuantityE8:0,
      priceE8:125_000_000,
      priceObservedAt:"2026-09-10",
      marketValueMinor:12500,
      unrealizedGainMinor:2500,
      incompleteUnknownBasis:false,
      lots:[],
      realized:{
        knownBasisQuantityE8:0,
        knownDisposedBasisMinor:0,
        calculableProceedsMinor:0,
        calculableGainMinor:0,
        unknownBasisQuantityE8:0,
        unknownBasisProceedsMinor:0,
        incompleteUnknownBasis:false,
      },
    }],
  }],
};

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
  it("opens the Investments report with Foundation as-of snapshots and excludes archived accounts",async()=>{
    const user=userEvent.setup();
    vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(investmentSnapshot);
    vi.mocked(investmentRepository.listSecurities).mockResolvedValue([{id:"sec",name:"Example",symbol:"EX",securityType:"stock",currency:"USD",archived:false}]);
    vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([
      {id:"div",eventId:"div",revisionNumber:1,accountId:"inv",eventType:"dividend",tradeDate:"2026-08-01",cashEffectMinor:500,incomeMinor:500,acquisitionFundingMinor:0,feeMinor:0,basisEffectMinor:0,status:"cleared",source:"manual"},
    ]);
    render(<ReportsPage accounts={accounts} transactions={transactions} today="2026-09-19"/>);
    await user.click(screen.getByRole("tab",{name:"Investments"}));
    expect(await screen.findByText("Investment cash")).toBeTruthy();
    expect(screen.getByText("$25.00")).toBeTruthy();
    expect(screen.getByText("$125.00")).toBeTruthy();
    expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledWith(["inv"],"2026-09-19");
    expect(investmentRepository.listInvestmentEvents).toHaveBeenCalledWith("inv","2026-01-01","2026-09-19");
    expect(screen.queryByText("Old brokerage")).toBeNull();
    fireEvent.change(screen.getByLabelText("As of"),{target:{value:"2026-01-15"}});
    await waitFor(()=>expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledWith(["inv"],"2026-01-15"));
  });
});
