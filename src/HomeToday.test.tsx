// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {HomeToday} from "./HomeToday";
import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";

vi.mock("./repository",()=>({financeRepository:{listSavingsGoals:vi.fn().mockResolvedValue([]),getDebtPlan:vi.fn().mockResolvedValue({currency:"USD",strategy:"snowball",extraPaymentMinor:0,terms:[]})}}));
afterEach(cleanup);
const checking:Account={id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:200000,ownerLabel:"Household"};
const budget:BudgetMonth={month:"2026-10",plannedMinor:100000,spentMinor:40000,carryInMinor:0,availableMinor:60000,lines:[{id:"food",category:"Food",rolloverEnabled:false,plannedMinor:100000,spentMinor:40000,carryInMinor:0,availableMinor:60000}]};
function renderHome(extra:{accounts?:Account[];transactions?:Transaction[];templates?:ScheduledTransaction[];occurrences?:ScheduledOccurrence[];budgets?:BudgetMonth[]}={}){
 const onNavigate=vi.fn(),onOpenAccount=vi.fn();
 render(<HomeToday accounts={extra.accounts??[checking]} transactions={extra.transactions??[]} templates={extra.templates??[]} occurrences={extra.occurrences??[]} budgets={extra.budgets??[budget]} onNavigate={onNavigate} onOpenAccount={onOpenAccount} today="2026-10-03"/>);
 return{onNavigate,onOpenAccount};
}
describe("Home / Today cockpit",()=>{
 it("is reassuring and useful when the household is quiet",()=>{
  renderHome();
  expect(screen.getByText("You're caught up")).toBeTruthy();
  expect(screen.getByText("Cash stays above zero for the next 30 days")).toBeTruthy();
  expect(screen.getByText("Monthly budget is within plan")).toBeTruthy();
  expect(screen.queryByText(/warning box/i)).toBeNull();
 });
 it("shows a useful setup state without inventing financial truth",()=>{
  renderHome({accounts:[],budgets:[]});
  expect(screen.getByText("Build your Home page")).toBeTruthy();
  expect(screen.getByText(/Investment accounts stay separate from spendable cash/)).toBeTruthy();
 });
 it("prioritizes overdue, auto-post, review, flagged, forecast and budget attention deterministically",()=>{
  const templates:ScheduledTransaction[]=[
   {id:"rent",kind:"transaction",accountId:"checking",payee:"Rent",category:"Housing",amountMinor:-250000,status:"pending",frequency:"monthly",anchorDate:"2026-10-01",enabled:true,autoPost:false},
   {id:"utility",kind:"transaction",accountId:"checking",payee:"Utility",category:"Utilities",amountMinor:-10000,status:"pending",frequency:"monthly",anchorDate:"2026-10-03",enabled:true,autoPost:true},
  ];
  const occurrences:ScheduledOccurrence[]=[{id:"late",scheduledTransactionId:"rent",dueDate:"2026-10-01",status:"expected"},{id:"auto",scheduledTransactionId:"utility",dueDate:"2026-10-03",status:"expected"}];
  const transactions:Transaction[]=[
   {id:"r",accountId:"checking",postedDate:"2026-10-02",payee:"Unknown",category:"Uncategorized",amountMinor:-100,status:"review"},
   {id:"f",accountId:"checking",postedDate:"2026-10-02",payee:"Follow up",category:"Misc",amountMinor:-100,status:"cleared",flagged:true},
  ];
  const over:BudgetMonth={...budget,availableMinor:-5000,spentMinor:105000,lines:[{...budget.lines[0],availableMinor:-5000,spentMinor:105000}]};
  const {container}=renderHome({transactions,templates,occurrences,budgets:[over]});
  const titles=[...container.querySelectorAll(".home-action strong")].map(x=>x.textContent);
  expect(titles.slice(0,4)).toEqual(["Rent is overdue","1 automatic posting is due","1 transaction needs review","1 flagged transaction to revisit"]);
  expect(screen.getByText("Cash is projected to go negative")).toBeTruthy();
  expect(screen.getByText("Food is over its monthly plan")).toBeTruthy();
 });
 it("routes review, flagged, upcoming and account actions into real workflows",async()=>{
  const user=userEvent.setup();
  const templates:ScheduledTransaction[]=[{id:"pay",kind:"transaction",accountId:"checking",payee:"Payroll",category:"Income",amountMinor:150000,status:"pending",frequency:"biweekly",anchorDate:"2026-10-04",enabled:true}];
  const occurrences:ScheduledOccurrence[]=[{id:"pay1",scheduledTransactionId:"pay",dueDate:"2026-10-04",status:"expected"}];
  const transactions:Transaction[]=[{id:"f",accountId:"checking",postedDate:"2026-10-02",payee:"Follow up",category:"Misc",amountMinor:-100,status:"cleared",flagged:true}];
  const {onNavigate,onOpenAccount}=renderHome({transactions,templates,occurrences});
  await user.click(screen.getByRole("button",{name:/flagged transaction/i}));
  expect(onNavigate).toHaveBeenCalledWith({page:"Transactions",status:"all",flaggedOnly:true});
  await user.click(screen.getByRole("button",{name:/Payroll/i}));
  expect(onNavigate).toHaveBeenCalledWith({page:"Bills",focus:{kind:"day",dueDate:"2026-10-04"}});
  await user.click(screen.getByRole("button",{name:/Checking/i}));
  expect(onOpenAccount).toHaveBeenCalledWith("checking");
 });
 it("keeps investment value outside spendable cash and forecast truth",()=>{
  const investment:Account={id:"broker",name:"Brokerage",type:"investment",currency:"USD",balanceMinor:99999999,ownerLabel:"Household"};
  renderHome({accounts:[checking,investment]});
  expect(screen.getByText("$2,000.00")).toBeTruthy();
  expect(screen.getByText(/Investment accounts are available in Portfolio/)).toBeTruthy();
  expect(screen.queryByText("$999,999.99")).toBeNull();
 });
 it("orders same-day upcoming events by stable template id",()=>{
  const templates:ScheduledTransaction[]=[
   {id:"b",kind:"transaction",accountId:"checking",payee:"B item",category:"Bills",amountMinor:-100,status:"pending",frequency:"monthly",anchorDate:"2026-10-05",enabled:true},
   {id:"a",kind:"transaction",accountId:"checking",payee:"A item",category:"Bills",amountMinor:-100,status:"pending",frequency:"monthly",anchorDate:"2026-10-05",enabled:true},
  ];
  const occurrences:ScheduledOccurrence[]=[{id:"2",scheduledTransactionId:"b",dueDate:"2026-10-05",status:"expected"},{id:"1",scheduledTransactionId:"a",dueDate:"2026-10-05",status:"expected"}];
  const {container}=renderHome({templates,occurrences});
  expect([...container.querySelectorAll(".home-upcoming strong")].map(x=>x.textContent)).toEqual(["A item","B item"]);
 });
});
