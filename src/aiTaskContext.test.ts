import {describe,expect,it} from "vitest";
import type {Account,BudgetMonth,DebtPlan,SavingsGoal,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import {buildAffordabilityAnalysisContext,serializeAiTaskContext} from "./aiTaskContext";
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
const occurrences:ScheduledOccurrence[]=[
  {id:"occ-1",scheduledTransactionId:"sched-rent",dueDate:"2026-09-21",status:"expected"},
  {id:"occ-2",scheduledTransactionId:"sched-pay",dueDate:"2026-10-05",status:"expected"}
];
const budgets:BudgetMonth[]=[{month:"2026-09",plannedMinor:200_000,spentMinor:50_000,carryInMinor:0,availableMinor:150_000,lines:[{id:"b1",category:"Food",rolloverEnabled:false,plannedMinor:200_000,spentMinor:50_000,carryInMinor:0,availableMinor:150_000}]}];
const debtPlan:DebtPlan={currency:"USD",strategy:"avalanche",extraPaymentMinor:0,terms:[{accountId:"card-private",annualRateBps:1999,minimumPaymentMinor:5_000,customPriority:0,enabled:true}]};
const savingsGoals:SavingsGoal[]=[{id:"goal-1",name:"Emergency Fund",accountId:"savings-private",targetMinor:500_000,targetDate:"2027-09-01",plannedMonthlyMinor:20_000}];

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
      occurrences,
      budgets,
      debtPlan,
      savingsGoals
    });
    const report=calculateTransactionReport({fromDate:"2026-07-01",toDate:"2026-09-20",currency:"USD",accounts,transactions});
    const forecast=calculateCashFlowForecast({today:"2026-09-20",horizonDays:90,currency:"USD",scenario:"expected",accounts,templates,occurrences,budgets});
    expect(context.task).toBe("affordability-analysis");
    expect(context.proposedMonthlyCostMinor).toBe(5_000);
    expect(context.cashFlow.totalIncomeMinor).toBe(report.incomeMinor);
    expect(context.cashFlow.totalSpendingMinor).toBe(report.spendingMinor);
    expect(context.cashFlow.averageMonthlyIncomeMinor).toBe(Math.round(report.incomeMinor/3));
    expect(context.liquidBalances.totalMinor).toBe(350_000);
    expect(context.recurringObligations.monthlyExpenseTotalMinor).toBe(150_000);
    expect(context.recurringObligations.monthlyIncomeTotalMinor).toBe(400_000);
    expect(context.debt.totalBalanceMinor).toBe(40_000);
    expect(context.debt.totalMinimumPaymentMinor).toBe(5_000);
    expect(context.debt.items[0].annualRateBps).toBe(1999);
    expect(context.savingsGoals.totalPlannedMonthlyMinor).toBe(20_000);
    expect(context.budget.plannedMinor).toBe(200_000);
    expect(context.forecast.lowestBalanceMinor).toBe(forecast.lowestBalanceMinor);
    expect(context.forecast.withProposed.appliedMonthCount).toBeGreaterThan(0);
    expect(context.affordabilitySummary.averageMonthlySurplusAfterMinor).toBe(context.cashFlow.averageMonthlyNetMinor-5_000);
    const payload=serializeAiTaskContext(context);
    for(const secret of [
      "Jeffrey","checking-private","savings-private","card-private","Neighborhood Market","Acme Payroll",
      "Oak Street Landlord","Travel Card","Emergency Vault","Emergency Fund","bank-secret","private memo",
      "tx-secret-1","sched-rent","batch-1","goal-1","occ-1"
    ])expect(payload).not.toContain(secret);
    expect(payload).not.toMatch(/"id"\s*:/);
    expect(payload).not.toMatch(/accountId|externalId|importBatchId|payee|memo|ownerLabel|filename/i);
  });

  it("rejects empty questions and non-positive proposed costs",()=>{
    expect(()=>buildAffordabilityAnalysisContext({
      question:" ",currency:"USD",proposedMonthlyCostMinor:5_000,asOfDate:"2026-09-20",
      accounts,transactions,templates,occurrences,budgets
    })).toThrow(/affordability question/i);
    expect(()=>buildAffordabilityAnalysisContext({
      question:"Can I afford this?",currency:"USD",proposedMonthlyCostMinor:0,asOfDate:"2026-09-20",
      accounts,transactions,templates,occurrences,budgets
    })).toThrow(/positive amount/i);
  });
});
