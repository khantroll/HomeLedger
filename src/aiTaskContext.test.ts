import {describe,expect,it} from "vitest";
import type {Account,BudgetMonth,DebtPlan,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import {
  buildAffordabilityAnalysisContext,
  buildBudgetReviewAnalysisContext,
  buildDebtStrategyAnalysisContext,
  buildSpendingChangeAnalysisContext,
  defaultSpendingChangePeriods,
  serializeAiTaskContext
} from "./aiTaskContext";
import {calculateTransactionReport} from "./reportMath";
import {calculateCashFlowForecast} from "./forecastMath";

const accounts:Account[]=[
  {id:"checking-private",name:"Jeffrey Household Checking",type:"checking",currency:"USD",balanceMinor:250_000,ownerLabel:"Jeffrey"},
  {id:"savings-private",name:"Emergency Vault",type:"savings",currency:"USD",balanceMinor:100_000,ownerLabel:"Jeffrey"},
  {id:"card-private",name:"Travel Card",type:"credit",currency:"USD",balanceMinor:-40_000,ownerLabel:"Jeffrey"},
  {id:"loan-private",name:"Auto Loan Secret",type:"loan",currency:"USD",balanceMinor:-300_000,ownerLabel:"Jeffrey"}
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
      analysisPeriod:{fromDate:"2026-09-01",toDate:"2026-09-15"},
      comparisonPeriod:{fromDate:"2026-08-01",toDate:"2026-08-31"},
      accounts,
      transactions:spendingTx,
      templates
    });
    expect(context.comparisonPeriod.alignment).toBe("custom");
    expect(context.periodLimitations.note).toMatch(/different lengths/i);
  });

  it("recognizes default-equivalent periods even when supplied explicitly",()=>{
    const defaults=defaultSpendingChangePeriods("2026-09-20");
    const context=buildSpendingChangeAnalysisContext({
      question:"Why was this month expensive?",
      currency:"USD",
      asOfDate:"2026-09-20",
      analysisPeriod:defaults.analysis,
      comparisonPeriod:defaults.comparison,
      accounts,
      transactions:spendingTx,
      templates
    });
    expect(context.comparisonPeriod.alignment).toBe("equivalent-prior-days");
    expect(context.periodLimitations.comparisonUsesEquivalentDays).toBe(true);
    expect(context.periodLimitations.note).toMatch(/same number of days/i);
  });
});

describe("Budget Review task context",()=>{
  const budget:BudgetMonth={
    month:"2026-09",
    plannedMinor:220_000,
    spentMinor:95_000,
    carryInMinor:0,
    availableMinor:125_000,
    lines:[
      {id:"b-food",category:"Food: Groceries",rolloverEnabled:false,plannedMinor:40_000,spentMinor:30_000,carryInMinor:0,availableMinor:10_000},
      {id:"b-housing",category:"Housing",rolloverEnabled:false,plannedMinor:150_000,spentMinor:0,carryInMinor:0,availableMinor:150_000},
      {id:"b-fun",category:"Entertainment",rolloverEnabled:false,plannedMinor:20_000,spentMinor:25_000,carryInMinor:0,availableMinor:-5_000},
      {id:"b-medical",category:"Medical",rolloverEnabled:false,plannedMinor:10_000,spentMinor:0,carryInMinor:0,availableMinor:10_000},
      {id:"b-empty",category:"Unused",rolloverEnabled:false,plannedMinor:0,spentMinor:0,carryInMinor:0,availableMinor:0}
    ]
  };
  const reviewTx:Transaction[]=[
    {id:"r1",accountId:"checking-private",postedDate:"2026-09-05",payee:"Acme Payroll",category:"Income: Salary",amountMinor:400_000,status:"cleared"},
    {id:"r2",accountId:"checking-private",postedDate:"2026-09-08",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-30_000,status:"cleared",memo:"private"},
    {id:"r3",accountId:"checking-private",postedDate:"2026-09-10",payee:"Cinema",category:"Entertainment",amountMinor:-25_000,status:"cleared"}
  ];
  const reviewTemplates:ScheduledTransaction[]=[
    {id:"sched-rent",kind:"transaction",accountId:"checking-private",payee:"Oak Street Landlord",category:"Housing",amountMinor:-150_000,status:"pending",frequency:"monthly",anchorDate:"2026-01-01",enabled:true},
    {id:"sched-pay",kind:"transaction",accountId:"checking-private",payee:"Acme Payroll",category:"Income: Salary",amountMinor:400_000,status:"pending",frequency:"monthly",anchorDate:"2026-01-05",enabled:true}
  ];
  const reviewOccurrences:ScheduledOccurrence[]=[
    {id:"occ-rent",scheduledTransactionId:"sched-rent",dueDate:"2026-09-25",status:"expected"},
    {id:"occ-pay",scheduledTransactionId:"sched-pay",dueDate:"2026-09-28",status:"expected"}
  ];

  it("classifies already-over, scheduled-aware projected-over, and sanitizes the payload",()=>{
    const context=buildBudgetReviewAnalysisContext({
      question:"How am I doing against my budget?",
      currency:"USD",
      asOfDate:"2026-09-20",
      budgetMonth:"2026-09",
      accounts,
      transactions:reviewTx,
      templates:reviewTemplates,
      occurrences:reviewOccurrences,
      budget,
      debtPlan:{currency:"USD",strategy:"avalanche",extraPaymentMinor:0,terms:[{accountId:"card-private",annualRateBps:1999,minimumPaymentMinor:5_000,customPriority:0,enabled:true}]},
      savingsGoals:[{id:"goal-1",name:"Emergency Fund",accountId:"savings-private",targetMinor:500_000,targetDate:"2027-09-01",plannedMonthlyMinor:20_000}]
    });
    expect(context.task).toBe("budget-review-analysis");
    expect(context.period.elapsedPercent).toBeGreaterThan(50);
    expect(context.period.isPartialMonth).toBe(true);
    expect(context.budgetTotals.plannedMinor).toBe(220_000);
    expect(context.income.receivedMinor).toBe(400_000);
    expect(context.income.expectedRemainingMinor).toBe(400_000);
    expect(context.categories.find(item=>item.category==="Entertainment")?.status).toBe("already-over");
    const housing=context.categories.find(item=>item.category==="Housing");
    expect(housing?.projectionBasis).toBe("scheduled-aware");
    expect(housing?.scheduledRemainingMinor).toBe(150_000);
    expect(housing?.status).toBe("on-track");
    expect(context.categories.find(item=>item.category==="Removed-sensitive")).toBeTruthy();
    expect(context.categories.find(item=>item.category==="Unused")?.status).toBe("insufficient-data");
    expect(context.reviewSummary.categoriesAlreadyOver).toBe(1);
    expect(context.reviewSummary.scheduledObligationsDueMinor).toBe(150_000);
    expect(context.savingsCommitments.totalPlannedMonthlyMinor).toBe(20_000);
    expect(context.debtObligations.totalMinimumPaymentMinor).toBe(5_000);
    const payload=serializeAiTaskContext(context);
    for(const secret of ["Jeffrey","Neighborhood Market","Oak Street Landlord","Emergency Fund","Cinema","private","checking-private","b-food","sched-rent","goal-1"]){
      expect(payload).not.toContain(secret);
    }
    expect(payload).not.toMatch(/"payee"|"memo"|"accountId"|"id"\s*:/);
  });

  it("uses linear pace only when schedules do not explain remaining spend",()=>{
    const context=buildBudgetReviewAnalysisContext({
      question:"Am I spending too quickly?",
      currency:"USD",
      asOfDate:"2026-09-20",
      budget:{
        month:"2026-09",
        plannedMinor:40_000,
        spentMinor:30_000,
        carryInMinor:0,
        availableMinor:10_000,
        lines:[{id:"b-food",category:"Food: Groceries",rolloverEnabled:false,plannedMinor:40_000,spentMinor:30_000,carryInMinor:0,availableMinor:10_000}]
      },
      accounts,
      transactions:reviewTx,
      templates:[],
      occurrences:[]
    });
    const food=context.categories[0];
    expect(food.projectionBasis).toBe("linear-pace");
    expect(food.status).toBe("projected-over");
    expect(food.projectedSpendMinor).toBeGreaterThan(food.plannedMinor);
    expect(context.spendingPace.spendingAheadOfElapsedPace).toBe(true);
  });

  it("marks scheduled-aware projected-over when known bills exceed remaining budget",()=>{
    const context=buildBudgetReviewAnalysisContext({
      question:"Will rent push me over?",
      currency:"USD",
      asOfDate:"2026-09-20",
      budget:{
        month:"2026-09",
        plannedMinor:100_000,
        spentMinor:20_000,
        carryInMinor:0,
        availableMinor:80_000,
        lines:[{id:"b-housing",category:"Housing",rolloverEnabled:false,plannedMinor:100_000,spentMinor:20_000,carryInMinor:0,availableMinor:80_000}]
      },
      accounts,
      transactions:reviewTx,
      templates:reviewTemplates,
      occurrences:reviewOccurrences
    });
    const housing=context.categories[0];
    expect(housing.projectionBasis).toBe("scheduled-aware");
    expect(housing.scheduledRemainingMinor).toBe(150_000);
    expect(housing.projectedSpendMinor).toBe(170_000);
    expect(housing.status).toBe("projected-over");
    expect(context.reviewSummary.categoriesProjectedOver).toBe(1);
  });

  it("reports insufficient data early in the month with no spending history",()=>{
    const context=buildBudgetReviewAnalysisContext({
      question:"How am I doing against my budget?",
      currency:"USD",
      asOfDate:"2026-09-02",
      budget:{
        month:"2026-09",
        plannedMinor:40_000,
        spentMinor:0,
        carryInMinor:0,
        availableMinor:40_000,
        lines:[{id:"b-food",category:"Food: Groceries",rolloverEnabled:false,plannedMinor:40_000,spentMinor:0,carryInMinor:0,availableMinor:40_000}]
      },
      accounts,
      transactions:[],
      templates:[],
      occurrences:[]
    });
    expect(context.period.isPartialMonth).toBe(true);
    expect(context.period.daysElapsed).toBe(2);
    expect(context.categories[0].status).toBe("insufficient-data");
    expect(context.categories[0].projectionBasis).toBe("insufficient-data");
    expect(context.statusCounts.insufficientData).toBe(1);
  });

  it("rejects empty questions and mismatched budget months",()=>{
    expect(()=>buildBudgetReviewAnalysisContext({
      question:" ",currency:"USD",asOfDate:"2026-09-20",budget,accounts,transactions:reviewTx,templates:[],occurrences:[]
    })).toThrow(/budget-review question/i);
    expect(()=>buildBudgetReviewAnalysisContext({
      question:"How am I doing?",currency:"USD",asOfDate:"2026-09-20",budgetMonth:"2026-08",budget,accounts,transactions:reviewTx,templates:[],occurrences:[]
    })).toThrow(/does not match/i);
  });
});

describe("Debt Strategy task context",()=>{
  const debtPlan:DebtPlan={
    currency:"USD",
    strategy:"avalanche",
    extraPaymentMinor:10_000,
    terms:[
      {accountId:"loan-private",annualRateBps:2000,minimumPaymentMinor:7_000,customPriority:1,enabled:true},
      {accountId:"card-private",annualRateBps:500,minimumPaymentMinor:4_000,customPriority:2,enabled:true}
    ]
  };

  it("compares minimum, avalanche, and snowball using calculateDebtProjection",()=>{
    const context=buildDebtStrategyAnalysisContext({
      question:"How should I approach my debt?",
      currency:"USD",
      asOfDate:"2026-09-20",
      extraPaymentMinor:10_000,
      accounts,
      transactions,
      templates,
      occurrences:[],
      budgets:[],
      debtPlan,
      savingsGoals:[{id:"goal-1",name:"Emergency Fund",accountId:"savings-private",targetMinor:500_000,targetDate:"2027-09-01",plannedMonthlyMinor:20_000}]
    });
    expect(context.task).toBe("debt-strategy-analysis");
    expect(context.completeDebtCount).toBe(2);
    expect(context.extraPaymentMinor).toBe(10_000);
    const minimum=context.scenarios.find(item=>item.kind==="minimum")!;
    const avalanche=context.scenarios.find(item=>item.kind==="avalanche")!;
    const snowball=context.scenarios.find(item=>item.kind==="snowball")!;
    expect(minimum.extraPaymentMinor).toBe(0);
    expect(avalanche.extraPaymentMinor).toBe(10_000);
    expect(snowball.extraPaymentMinor).toBe(10_000);
    expect(avalanche.runnable).toBe(true);
    expect(snowball.runnable).toBe(true);
    expect(snowball.payoffOrderAliases[0]).toBe("Debt 2");
    expect(avalanche.totalInterestMinor!).toBeLessThan(snowball.totalInterestMinor!);
    expect(avalanche.interestSavedVsMinimumMinor!).toBeGreaterThan(0);
    expect(context.comparisonSummary.interestAdvantageKind).toBe("avalanche");
    expect(context.debts.map(item=>item.alias)).toEqual(["Debt 1","Debt 2"]);
    expect(context.cashFlowSafety.requiredMinimumPaymentsMinor).toBe(11_000);
    expect(context.cashFlowSafety.savingsCommitmentsMonthlyMinor).toBe(20_000);
    expect(context.debts.every(item=>item.alias.startsWith("Debt "))).toBe(true);
    const payload=serializeAiTaskContext(context);
    for(const secret of ["Jeffrey","Travel Card","Auto Loan Secret","Emergency Fund","card-private","loan-private","goal-1"]){
      expect(payload).not.toContain(secret);
    }
    expect(payload).not.toMatch(/"accountId"|"payee"|"name"|"id"\s*:/);
  });

  it("marks missing APR or minimum as incomplete and excludes them from projections",()=>{
    const context=buildDebtStrategyAnalysisContext({
      question:"How should I approach my debt?",
      currency:"USD",
      asOfDate:"2026-09-20",
      extraPaymentMinor:5_000,
      accounts,
      transactions,
      templates:[],
      occurrences:[],
      budgets:[],
      debtPlan:{currency:"USD",strategy:"avalanche",extraPaymentMinor:0,terms:[
        {accountId:"loan-private",annualRateBps:1999,minimumPaymentMinor:7_000,customPriority:1,enabled:true}
      ]}
    });
    expect(context.completeDebtCount).toBe(1);
    expect(context.incompleteDebtCount).toBe(1);
    const incomplete=context.debts.find(item=>item.dataStatus==="incomplete")!;
    expect(incomplete.incompleteReasons).toEqual(expect.arrayContaining(["missing-apr","missing-minimum"]));
    expect(context.scenarios.every(item=>item.runnable)).toBe(true);
    expect(context.limitations.note).toMatch(/incomplete/i);
  });

  it("handles zero-interest debt and insufficient monthly payment",()=>{
    const zeroInterest=buildDebtStrategyAnalysisContext({
      question:"How should I approach my debt?",
      currency:"USD",
      asOfDate:"2026-09-20",
      extraPaymentMinor:0,
      accounts:[{id:"card-private",name:"Zero Card",type:"credit",currency:"USD",balanceMinor:-50_000,ownerLabel:"X"}],
      transactions:[],
      templates:[],
      occurrences:[],
      budgets:[],
      debtPlan:{currency:"USD",strategy:"avalanche",extraPaymentMinor:0,terms:[
        {accountId:"card-private",annualRateBps:0,minimumPaymentMinor:5_000,customPriority:1,enabled:true}
      ]}
    });
    expect(zeroInterest.scenarios.find(item=>item.kind==="minimum")?.totalInterestMinor).toBe(0);
    expect(zeroInterest.scenarios.find(item=>item.kind==="minimum")?.complete).toBe(true);

    const insufficient=buildDebtStrategyAnalysisContext({
      question:"How should I approach my debt?",
      currency:"USD",
      asOfDate:"2026-09-20",
      extraPaymentMinor:0,
      accounts:[{id:"card-private",name:"Bad Card",type:"credit",currency:"USD",balanceMinor:-100_000,ownerLabel:"X"}],
      transactions:[],
      templates:[],
      occurrences:[],
      budgets:[],
      debtPlan:{currency:"USD",strategy:"avalanche",extraPaymentMinor:0,terms:[
        {accountId:"card-private",annualRateBps:1200,minimumPaymentMinor:100,customPriority:1,enabled:true}
      ]}
    });
    const min=insufficient.scenarios.find(item=>item.kind==="minimum")!;
    expect(min.complete).toBe(false);
    expect(min.months).toBeNull();
    expect(min.limitationNote).toMatch(/100 years/i);
  });

  it("flags cash-flow pressure when extra payment exceeds surplus",()=>{
    const context=buildDebtStrategyAnalysisContext({
      question:"How should I approach my debt?",
      currency:"USD",
      asOfDate:"2026-09-20",
      extraPaymentMinor:340_000,
      accounts,
      transactions,
      templates,
      occurrences:[],
      budgets:[],
      debtPlan,
      savingsGoals:[{id:"goal-1",name:"Emergency Fund",accountId:"savings-private",targetMinor:500_000,targetDate:"2027-09-01",plannedMonthlyMinor:50_000}]
    });
    expect(context.cashFlowSafety.extraAppearsSupportableFromSurplus).toBe(false);
    expect(context.cashFlowSafety.wouldRelyOnLiquidReserves).toBe(true);
    expect(context.cashFlowSafety.note).toMatch(/liquid reserves/i);
  });

  it("rejects empty questions and negative extra payments",()=>{
    expect(()=>buildDebtStrategyAnalysisContext({
      question:" ",currency:"USD",asOfDate:"2026-09-20",accounts,transactions,templates:[],occurrences:[],budgets:[],debtPlan
    })).toThrow(/debt-strategy question/i);
    expect(()=>buildDebtStrategyAnalysisContext({
      question:"How should I approach my debt?",currency:"USD",asOfDate:"2026-09-20",extraPaymentMinor:-1,accounts,transactions,templates:[],occurrences:[],budgets:[],debtPlan
    })).toThrow(/Extra monthly debt payment/i);
  });

  it("keeps Affordability, Spending Change, and Budget Review task identities unchanged",()=>{
    expect(buildAffordabilityAnalysisContext({
      question:"Can I afford another $50 per month?",currency:"USD",proposedMonthlyCostMinor:5_000,asOfDate:"2026-09-20",
      accounts,transactions,templates,occurrences:[],budgets:[]
    }).task).toBe("affordability-analysis");
    expect(buildSpendingChangeAnalysisContext({
      question:"Why was this month expensive?",currency:"USD",asOfDate:"2026-09-20",accounts,transactions,templates:[]
    }).task).toBe("spending-change-analysis");
    expect(buildBudgetReviewAnalysisContext({
      question:"How am I doing against my budget?",currency:"USD",asOfDate:"2026-09-20",
      accounts,transactions,templates:[],occurrences:[],
      budget:{month:"2026-09",plannedMinor:40_000,spentMinor:10_000,carryInMinor:0,availableMinor:30_000,lines:[
        {id:"b1",category:"Food",rolloverEnabled:false,plannedMinor:40_000,spentMinor:10_000,carryInMinor:0,availableMinor:30_000}
      ]}
    }).task).toBe("budget-review-analysis");
  });
});
