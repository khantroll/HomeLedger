import {describe,expect,it} from "vitest";
import type {Account,ScheduledTransaction,Transaction} from "./domain";
import {
  buildAffordabilityAnalysisContext,
  buildSpendingChangeAnalysisContext,
  defaultSpendingChangePeriods,
  serializeAiTaskContext
} from "./aiTaskContext";
import {calculateTransactionReport} from "./reportMath";
import {calculateCashFlowForecast} from "./forecastMath";

const accounts:Account[]=[
  {id:"checking-private",name:"Jeffrey Household Checking",type:"checking",currency:"USD",balanceMinor:250_000,ownerLabel:"Jeffrey"},
  {id:"savings-private",name:"Emergency Vault",type:"savings",currency:"USD",balanceMinor:100_000,ownerLabel:"Jeffrey"},
  {id:"card-private",name:"Travel Card",type:"credit",currency:"USD",balanceMinor:-40_000,ownerLabel:"Jeffrey"}
];
const transactions:Transaction[]=[
  {id:"tx-secret-1",accountId:"checking-private",postedDate:"2026-07-05",payee:"Acme Payroll",category:"Income: Salary",amountMinor:400_000,status:"cleared",externalId:"bank-secret",memo:"private memo",source:"import",importBatchId:"batch-1"},
  {id:"tx-secret-2",accountId:"checking-private",postedDate:"2026-07-12",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-12_500,status:"cleared"},
  {id:"tx-secret-3",accountId:"checking-private",postedDate:"2026-08-05",payee:"Acme Payroll",category:"Income: Salary",amountMinor:400_000,status:"cleared"},
  {id:"tx-secret-4",accountId:"checking-private",postedDate:"2026-08-12",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-13_000,status:"cleared"},
  {id:"tx-secret-5",accountId:"checking-private",postedDate:"2026-09-05",payee:"Acme Payroll",category:"Income: Salary",amountMinor:400_000,status:"cleared"},
  {id:"tx-secret-6",accountId:"checking-private",postedDate:"2026-09-12",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-11_000,status:"cleared"}
];
const templates:ScheduledTransaction[]=[
  {id:"sched-rent",kind:"transaction",accountId:"checking-private",payee:"Oak Street Landlord",category:"Housing",amountMinor:-150_000,status:"pending",frequency:"monthly",anchorDate:"2026-01-01",enabled:true},
  {id:"sched-pay",kind:"transaction",accountId:"checking-private",payee:"Acme Payroll",category:"Income: Salary",amountMinor:400_000,status:"pending",frequency:"monthly",anchorDate:"2026-01-05",enabled:true}
];

describe("Affordability Analysis task context",()=>{
  it("builds required financial facts from deterministic engines without identity or provenance fields",()=>{
    const context=buildAffordabilityAnalysisContext({
      question:"Can I afford another $50 per month?",
      currency:"USD",
      proposedMonthlyCostMinor:5_000,
      asOfDate:"2026-09-20",
      accounts,
      transactions,
      templates,
      occurrences:[],
      budgets:[]
    });
    const report=calculateTransactionReport({fromDate:"2026-07-01",toDate:"2026-09-20",currency:"USD",accounts,transactions});
    const forecast=calculateCashFlowForecast({today:"2026-09-20",horizonDays:90,currency:"USD",scenario:"expected",accounts,templates,occurrences:[],budgets:[]});
    expect(context.task).toBe("affordability-analysis");
    expect(context.cashFlow.totalIncomeMinor).toBe(report.incomeMinor);
    expect(context.forecast.lowestBalanceMinor).toBe(forecast.lowestBalanceMinor);
    const payload=serializeAiTaskContext(context);
    expect(payload).not.toContain("Jeffrey");
    expect(payload).not.toMatch(/"id"\s*:/);
  });

  it("rejects empty questions and non-positive proposed costs",()=>{
    expect(()=>buildAffordabilityAnalysisContext({
      question:" ",currency:"USD",proposedMonthlyCostMinor:5_000,asOfDate:"2026-09-20",
      accounts,transactions,templates,occurrences:[],budgets:[]
    })).toThrow(/affordability question/i);
    expect(()=>buildAffordabilityAnalysisContext({
      question:"Can I afford this?",currency:"USD",proposedMonthlyCostMinor:0,asOfDate:"2026-09-20",
      accounts,transactions,templates,occurrences:[],budgets:[]
    })).toThrow(/positive amount/i);
  });
});

describe("Spending Change Analysis task context",()=>{
  const spendingTx:Transaction[]=[
    {id:"a1",accountId:"checking-private",postedDate:"2026-08-03",payee:"Acme Payroll",category:"Income: Salary",amountMinor:300_000,status:"cleared"},
    {id:"a2",accountId:"checking-private",postedDate:"2026-08-05",payee:"Oak Street Landlord",category:"Housing",amountMinor:-150_000,status:"cleared"},
    {id:"a3",accountId:"checking-private",postedDate:"2026-08-08",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-8_000,status:"cleared"},
    {id:"a4",accountId:"checking-private",postedDate:"2026-08-10",payee:"City Transit",category:"Transport",amountMinor:-4_000,status:"cleared"},
    {id:"a5",accountId:"checking-private",postedDate:"2026-08-12",payee:"Savings Sweep",category:"Transfer",amountMinor:-20_000,status:"cleared",transferLinkId:"xfer-1",source:"transfer"},
    {id:"b1",accountId:"checking-private",postedDate:"2026-09-03",payee:"Acme Payroll",category:"Income: Salary",amountMinor:300_000,status:"cleared"},
    {id:"b2",accountId:"checking-private",postedDate:"2026-09-05",payee:"Oak Street Landlord",category:"Housing",amountMinor:-160_000,status:"cleared"},
    {id:"b3",accountId:"checking-private",postedDate:"2026-09-08",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-12_000,status:"cleared"},
    {id:"b4",accountId:"checking-private",postedDate:"2026-09-09",payee:"Appliance World",category:"Home",amountMinor:-60_000,status:"cleared",memo:"new fridge private"},
    {id:"b5",accountId:"checking-private",postedDate:"2026-09-11",payee:"City Transit",category:"Transport",amountMinor:-4_000,status:"cleared"},
    {id:"b6",accountId:"checking-private",postedDate:"2026-09-12",payee:"Private Clinic",category:"Medical",amountMinor:-25_000,status:"cleared"}
  ];

  it("defaults to month-to-date versus equivalent prior days",()=>{
    const periods=defaultSpendingChangePeriods("2026-09-20");
    expect(periods.analysis).toEqual({fromDate:"2026-09-01",toDate:"2026-09-20"});
    expect(periods.comparison).toEqual({fromDate:"2026-08-01",toDate:"2026-08-20"});
    expect(periods.alignment).toBe("equivalent-prior-days");
    const full=defaultSpendingChangePeriods("2026-09-30");
    expect(full.alignment).toBe("full-prior-month");
    expect(full.comparison).toEqual({fromDate:"2026-08-01",toDate:"2026-08-31"});
  });

  it("computes period totals, category deltas, transfer exclusion, and sanitizes notable transactions",()=>{
    const context=buildSpendingChangeAnalysisContext({
      question:"Why was this month expensive?",
      currency:"USD",
      asOfDate:"2026-09-20",
      accounts,
      transactions:spendingTx,
      templates
    });
    const analysis=calculateTransactionReport({fromDate:"2026-09-01",toDate:"2026-09-20",currency:"USD",accounts,transactions:spendingTx});
    const comparison=calculateTransactionReport({fromDate:"2026-08-01",toDate:"2026-08-20",currency:"USD",accounts,transactions:spendingTx});
    expect(context.task).toBe("spending-change-analysis");
    expect(context.totals.analysis.spendingMinor).toBe(analysis.spendingMinor);
    expect(context.totals.comparison.spendingMinor).toBe(comparison.spendingMinor);
    expect(context.totals.spendingChangeMinor).toBe(analysis.spendingMinor-comparison.spendingMinor);
    expect(context.periodLimitations.comparisonUsesEquivalentDays).toBe(true);
    expect(context.periodLimitations.analysisIsPartialMonth).toBe(true);
    expect(context.largestIncreases.some(item=>item.category==="Home"&&item.changeMinor===60_000)).toBe(true);
    expect(context.notableTransactions.some(item=>item.reason==="high-value"&&item.amountMinor===60_000)).toBe(true);
    expect(context.recurringChanges.some(item=>item.classification==="recurring-structural"&&item.changeMinor===10_000)).toBe(true);
    expect(context.categoryChanges.some(item=>item.category==="Removed-sensitive")).toBe(true);
    const payload=serializeAiTaskContext(context);
    for(const secret of ["Jeffrey","Neighborhood Market","Appliance World","Private Clinic","Oak Street Landlord","new fridge private","checking-private","a1","xfer-1","bank-secret"]){
      expect(payload).not.toContain(secret);
    }
    expect(payload).toMatch(/Merchant-[0-9A-F]{8}/);
    expect(payload).not.toMatch(/"payee"|"memo"|"accountId"|"id"\s*:/);
  });

  it("keeps custom full-month comparisons and marks unequal custom day counts",()=>{
    const context=buildSpendingChangeAnalysisContext({
      question:"What changed compared with last month?",
      currency:"USD",
      asOfDate:"2026-09-30",
      analysisPeriod:{fromDate:"2026-09-01",toDate:"2026-09-30"},
      comparisonPeriod:{fromDate:"2026-08-01",toDate:"2026-08-31"},
      accounts,
      transactions:spendingTx,
      templates
    });
    expect(context.comparisonPeriod.alignment).toBe("custom");
    expect(context.analysisPeriod.isPartialMonth).toBe(false);
    expect(context.periodLimitations.comparisonUsesEquivalentDays).toBe(false);
  });
});
