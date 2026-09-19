import {describe,expect,it} from "vitest";
import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction} from "./domain";
import {calculateCashFlowForecast,forecastMonths} from "./forecastMath";

const accounts:Account[]=[
  {id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Household"},
  {id:"loan",name:"Loan",type:"loan",currency:"USD",balanceMinor:-500000,ownerLabel:"Household"},
  {id:"cad",name:"Canada cash",type:"cash",currency:"CAD",balanceMinor:20000,ownerLabel:"Household"},
];
const templates:ScheduledTransaction[]=[
  {id:"pay",kind:"transaction",accountId:"checking",payee:"Payroll",category:"Income",amountMinor:200000,status:"pending",frequency:"monthly",anchorDate:"2026-09-05",enabled:true},
  {id:"rent",kind:"transaction",accountId:"checking",payee:"Rent",category:"Housing",amountMinor:-80000,status:"pending",frequency:"monthly",anchorDate:"2026-09-10",enabled:true},
];
const occurrences:ScheduledOccurrence[]=[
  {id:"pay-1",scheduledTransactionId:"pay",dueDate:"2026-09-05",status:"expected"},
  {id:"rent-1",scheduledTransactionId:"rent",dueDate:"2026-09-10",status:"expected"},
  {id:"rent-done",scheduledTransactionId:"rent",dueDate:"2026-09-02",status:"posted",transactionId:"t"},
];
const budget:BudgetMonth={month:"2026-09",plannedMinor:110000,spentMinor:10000,carryInMinor:50000,availableMinor:150000,lines:[
  {id:"housing",category:"Housing",rolloverEnabled:false,plannedMinor:90000,spentMinor:0,carryInMinor:0,availableMinor:90000},
  {id:"food",category:"Food",rolloverEnabled:true,plannedMinor:20000,spentMinor:10000,carryInMinor:50000,availableMinor:60000},
]};
const run=(scenario:"expected"|"conservative"|"optimistic"="expected")=>calculateCashFlowForecast({today:"2026-09-01",horizonDays:30,currency:"USD",scenario,accounts,templates,occurrences,budgets:[budget]});

describe("cash-flow forecasting",()=>{
  it("uses liquid accounts, expected occurrences, and remaining budget without spending rollover",()=>expect(run()).toMatchObject({startBalanceMinor:100000,totalInflowsMinor:200000,totalOutflowsMinor:100000,budgetReserveMinor:20000,endingBalanceMinor:200000}));
  it("does not double-count scheduled expenses already covered by the matching budget category",()=>expect(run().budgetReserveMinor).toBe(20000));
  it("creates conservative and optimistic ranges from documented factors",()=>{expect(run("conservative").endingBalanceMinor).toBe(170000);expect(run("optimistic").endingBalanceMinor).toBe(216000);});
  it("excludes posted occurrences, liabilities, and other currencies",()=>expect(run().days.reduce((total,item)=>total+item.scheduledCount,0)).toBe(2));
  it("treats transfers inside the selected cash scope as neutral and external payments as outflows",()=>{
    const savings:Account={id:"savings",name:"Savings",type:"savings",currency:"USD",balanceMinor:50000,ownerLabel:"Household"};
    const internal:ScheduledTransaction={...templates[0],id:"internal",kind:"transfer",accountId:"checking",transferAccountId:"savings",amountMinor:25000};
    const payment:ScheduledTransaction={...internal,id:"payment",transferAccountId:"loan",amountMinor:30000};
    const transfers:ScheduledOccurrence[]=[{id:"i",scheduledTransactionId:"internal",dueDate:"2026-09-05",status:"expected"},{id:"p",scheduledTransactionId:"payment",dueDate:"2026-09-06",status:"expected"}];
    const result=calculateCashFlowForecast({today:"2026-09-01",horizonDays:30,currency:"USD",scenario:"expected",accounts:[...accounts,savings],templates:[internal,payment],occurrences:transfers,budgets:[]});
    expect(result).toMatchObject({startBalanceMinor:150000,totalInflowsMinor:0,totalOutflowsMinor:30000,endingBalanceMinor:120000});
  });
  it("returns every intersecting budget month",()=>expect(forecastMonths("2026-09-19",90)).toEqual(["2026-09","2026-10","2026-11","2026-12"]));
  it("prorates a final partial month's plan to the days inside the horizon",()=>{
    const october:BudgetMonth={month:"2026-10",plannedMinor:31000,spentMinor:0,carryInMinor:0,availableMinor:31000,lines:[{id:"food",category:"Food",rolloverEnabled:false,plannedMinor:31000,spentMinor:0,carryInMinor:0,availableMinor:31000}]};
    const result=calculateCashFlowForecast({today:"2026-09-19",horizonDays:30,currency:"USD",scenario:"expected",accounts,templates:[],occurrences:[],budgets:[october]});
    expect(result.budgetReserveMinor).toBe(18000);
  });
  it("rejects unsupported horizons",()=>expect(()=>calculateCashFlowForecast({today:"2026-09-01",horizonDays:31,currency:"USD",scenario:"expected",accounts,templates,occurrences,budgets:[budget]})).toThrow("Unsupported"));
});
