// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {DebtPage} from "./DebtPage";
import {financeRepository} from "./repository";
import type {Account,DebtPlan} from "./domain";

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const accounts:Account[]=[
  {id:"card",name:"Rewards Card",type:"credit",currency:"USD",balanceMinor:-100000,ownerLabel:"Household"},
  {id:"loan",name:"Auto Loan",type:"loan",currency:"USD",balanceMinor:-300000,ownerLabel:"Household"},
];
const plan:DebtPlan={currency:"USD",strategy:"avalanche",extraPaymentMinor:10000,terms:[
  {accountId:"card",annualRateBps:500,minimumPaymentMinor:4000,customPriority:2,enabled:true},
  {accountId:"loan",annualRateBps:2000,minimumPaymentMinor:7000,customPriority:1,enabled:true},
]};

describe("DebtPage",()=>{
  it("compares all strategies and shows the selected payoff schedule",async()=>{
    vi.spyOn(financeRepository,"getDebtPlan").mockResolvedValue(plan);
    render(<DebtPage accounts={accounts} startMonth="2026-10"/>);
    await waitFor(()=>expect(screen.getByText("Avalanche payoff schedule")).toBeTruthy());
    expect(screen.getAllByText("Snowball").length).toBeGreaterThan(0);expect(screen.getAllByText("Avalanche").length).toBeGreaterThan(0);expect(screen.getAllByText("Custom").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Auto Loan").length).toBeGreaterThan(1);expect(screen.getByText(/planned each month/).textContent).toContain("$210.00");
  });
  it("saves edited strategy, extra payment, and account terms",async()=>{
    const user=userEvent.setup();vi.spyOn(financeRepository,"getDebtPlan").mockResolvedValue(plan);const save=vi.spyOn(financeRepository,"saveDebtPlan").mockImplementation(async input=>input);
    render(<DebtPage accounts={accounts} startMonth="2026-10"/>);await waitFor(()=>screen.getByText("Avalanche payoff schedule"));
    await user.selectOptions(screen.getByLabelText("Strategy"),"custom");const extra=screen.getByLabelText("Extra monthly payment");await user.clear(extra);await user.type(extra,"150.00");const apr=screen.getByLabelText("APR for Rewards Card");await user.clear(apr);await user.type(apr,"6.25");await user.click(screen.getByRole("button",{name:/Save and recalculate/}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({currency:"USD",strategy:"custom",extraPaymentMinor:15000,terms:expect.arrayContaining([expect.objectContaining({accountId:"card",annualRateBps:625})])})));
  });
  it("requires configured debt accounts before projecting",async()=>{
    vi.spyOn(financeRepository,"getDebtPlan").mockResolvedValue({currency:"USD",strategy:"avalanche",extraPaymentMinor:0,terms:[]});render(<DebtPage accounts={accounts} startMonth="2026-10"/>);expect(await screen.findByText(/Choose at least one debt account/)).toBeTruthy();
  });
});
