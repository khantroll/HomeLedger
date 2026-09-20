import type {Account,BudgetMonth,DebtPlan,SavingsGoal,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import {calculateCashFlowForecast} from "./forecastMath";
import {calculateTransactionReport} from "./reportMath";
import {calculateSavingsGoal} from "./savingsGoalMath";
import {addDaysIso} from "./scheduledPresentation";

export type AiTaskKind="affordability-analysis"|"spending-change-analysis";

export interface AffordabilityAnalysisInput{
  question:string;
  currency:string;
  proposedMonthlyCostMinor:number;
  asOfDate:string;
  trailingMonths?:number;
  forecastHorizonDays?:30|60|90|180|365;
  accounts:readonly Account[];
  transactions:readonly Transaction[];
  templates:readonly ScheduledTransaction[];
  occurrences:readonly ScheduledOccurrence[];
  budgets:readonly BudgetMonth[];
  debtPlan?:DebtPlan;
  savingsGoals?:readonly SavingsGoal[];
}

export interface AffordabilityAnalysisContext{
  task:"affordability-analysis";
  schemaVersion:1;
  question:string;
  currency:string;
  asOfDate:string;
  proposedMonthlyCostMinor:number;
  cashFlow:{
    trailingMonths:number;
    fromDate:string;
    toDate:string;
    averageMonthlyIncomeMinor:number;
    averageMonthlySpendingMinor:number;
    averageMonthlyNetMinor:number;
    totalIncomeMinor:number;
    totalSpendingMinor:number;
  };
  liquidBalances:{
    totalMinor:number;
    accountCount:number;
    byType:ReadonlyArray<{type:string;count:number;balanceMinor:number}>;
  };
  recurringObligations:{
    monthlyExpenseTotalMinor:number;
    monthlyIncomeTotalMinor:number;
    itemCount:number;
    items:ReadonlyArray<{
      kind:"transaction"|"transfer";
      frequency:string;
      monthlyEquivalentMinor:number;
      direction:"expense"|"income"|"transfer-boundary";
    }>;
  };
  debt:{
    totalBalanceMinor:number;
    totalMinimumPaymentMinor:number;
    accountCount:number;
    items:ReadonlyArray<{balanceMinor:number;minimumPaymentMinor:number;annualRateBps:number}>;
  };
  savingsGoals:{
    count:number;
    totalRemainingMinor:number;
    totalPlannedMonthlyMinor:number;
    items:ReadonlyArray<{remainingMinor:number;plannedMonthlyMinor:number;status:string}>;
  };
  budget:{
    month:string;
    plannedMinor:number;
    spentMinor:number;
    availableMinor:number;
    lineCount:number;
  };
  forecast:{
    horizonDays:number;
    scenario:"expected";
    startBalanceMinor:number;
    endingBalanceMinor:number;
    lowestBalanceMinor:number;
    lowestBalanceDate:string;
    withProposed:{
      endingBalanceMinor:number;
      lowestBalanceMinor:number;
      lowestBalanceDate:string;
      appliedMonthCount:number;
    };
  };
  affordabilitySummary:{
    averageMonthlySurplusBeforeMinor:number;
    averageMonthlySurplusAfterMinor:number;
    canCoverFromAverageNet:boolean;
    projectedLowStaysNonNegative:boolean;
    projectedLowWithProposedStaysNonNegative:boolean;
  };
}

export type AiTaskContext=AffordabilityAnalysisContext|SpendingChangeAnalysisContext;

export interface SpendingChangePeriodSpec{
  fromDate:string;
  toDate:string;
}

export interface SpendingChangeAnalysisInput{
  question:string;
  currency:string;
  asOfDate:string;
  analysisPeriod?:SpendingChangePeriodSpec;
  comparisonPeriod?:SpendingChangePeriodSpec;
  accounts:readonly Account[];
  transactions:readonly Transaction[];
  templates?:readonly ScheduledTransaction[];
}

export interface SpendingChangePeriodFacts{
  fromDate:string;
  toDate:string;
  dayCount:number;
  isPartialMonth:boolean;
  month:string;
}

export interface SpendingChangeCategoryDelta{
  category:string;
  analysisSpendingMinor:number;
  comparisonSpendingMinor:number;
  changeMinor:number;
  changePercent:number|null;
}

export interface SpendingChangeRecurringDelta{
  merchantAlias:string;
  category:string;
  frequency:string|null;
  analysisTotalMinor:number;
  comparisonTotalMinor:number;
  changeMinor:number;
  classification:"recurring-structural"|"possible-recurring";
}

export interface SpendingChangeNotableTransaction{
  postedDate:string;
  amountMinor:number;
  category:string;
  merchantAlias:string;
  reason:"high-value"|"new-merchant"|"category-driver";
}

export interface SpendingChangeAnalysisContext{
  task:"spending-change-analysis";
  schemaVersion:1;
  question:string;
  currency:string;
  asOfDate:string;
  analysisPeriod:SpendingChangePeriodFacts;
  comparisonPeriod:SpendingChangePeriodFacts&{alignment:"equivalent-prior-days"|"full-prior-month"|"custom"};
  totals:{
    analysis:{incomeMinor:number;spendingMinor:number;netMinor:number;transactionCount:number};
    comparison:{incomeMinor:number;spendingMinor:number;netMinor:number;transactionCount:number};
    spendingChangeMinor:number;
    spendingChangePercent:number|null;
    incomeChangeMinor:number;
    netChangeMinor:number;
  };
  categoryChanges:ReadonlyArray<SpendingChangeCategoryDelta>;
  largestIncreases:ReadonlyArray<SpendingChangeCategoryDelta>;
  largestDecreases:ReadonlyArray<SpendingChangeCategoryDelta>;
  recurringChanges:ReadonlyArray<SpendingChangeRecurringDelta>;
  notableTransactions:ReadonlyArray<SpendingChangeNotableTransaction>;
  newlyAppearingCategories:ReadonlyArray<string>;
  disappearedCategories:ReadonlyArray<string>;
  periodLimitations:{
    analysisIsPartialMonth:boolean;
    comparisonUsesEquivalentDays:boolean;
    note:string;
  };
  changeSummary:{
    spendingDifferenceMinor:number;
    topIncreaseCategories:ReadonlyArray<{category:string;changeMinor:number}>;
    topDecreaseCategories:ReadonlyArray<{category:string;changeMinor:number}>;
    oneTimeExpenseTotalMinor:number;
    recurringExpenseChangeMinor:number;
    incomeChangeMinor:number;
  };
}

const PROHIBITED_CONTEXT_KEYS=new Set([
  "id","accountId","transferAccountId","externalId","importBatchId","providerId","routingNumber",
  "accountNumber","filename","fileName","memo","payee","name","ownerLabel","institution","auth",
  "password","token","apiKey","secret","transactionId","scheduledTransactionId"
]);
const SENSITIVE_CATEGORY=/(?:health|medical|therapy|counsel|relig|legal|gambl|adult|substance|disability)/i;
const MAX_CATEGORY_DELTAS=12;
const MAX_NOTABLE_TRANSACTIONS=8;

export function buildAffordabilityAnalysisContext(input:AffordabilityAnalysisInput):AffordabilityAnalysisContext{
  const question=input.question.trim();
  if(!question)throw new Error("Describe the affordability question before building a task context");
  if(!/^[A-Z]{3}$/.test(input.currency))throw new Error("Affordability analysis requires a three-letter currency code");
  if(!Number.isSafeInteger(input.proposedMonthlyCostMinor)||input.proposedMonthlyCostMinor<=0){
    throw new Error("Proposed monthly cost must be a positive amount in minor units");
  }
  const trailingMonths=input.trailingMonths??3;
  if(!Number.isInteger(trailingMonths)||trailingMonths<1||trailingMonths>24)throw new Error("Trailing month window is invalid");
  const horizonDays=input.forecastHorizonDays??90;
  const asOfDate=input.asOfDate;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))throw new Error("Affordability as-of date must use YYYY-MM-DD");

  const currencyAccounts=input.accounts.filter(item=>item.currency===input.currency&&!item.archived);
  const liquid=currencyAccounts.filter(item=>["checking","savings","cash"].includes(item.type));
  const fromDate=shiftMonthStart(asOfDate,-(trailingMonths-1));
  const report=calculateTransactionReport({
    fromDate,
    toDate:asOfDate,
    currency:input.currency,
    accounts:currencyAccounts,
    transactions:input.transactions
  });
  const averageMonthlyIncomeMinor=divRound(report.incomeMinor,trailingMonths);
  const averageMonthlySpendingMinor=divRound(report.spendingMinor,trailingMonths);
  const averageMonthlyNetMinor=averageMonthlyIncomeMinor-averageMonthlySpendingMinor;

  const byTypeMap=new Map<string,{count:number;balanceMinor:number}>();
  for(const account of liquid){
    const row=byTypeMap.get(account.type)??{count:0,balanceMinor:0};
    row.count++;
    row.balanceMinor=safeAdd(row.balanceMinor,account.balanceMinor);
    byTypeMap.set(account.type,row);
  }
  const liquidBalances={
    totalMinor:liquid.reduce((total,item)=>safeAdd(total,item.balanceMinor),0),
    accountCount:liquid.length,
    byType:[...byTypeMap].sort(([left],[right])=>left.localeCompare(right)).map(([type,values])=>({type,...values}))
  };

  const cashIds=new Set(liquid.map(item=>item.id));
  const activeTemplates=input.templates.filter(item=>item.enabled&&!item.archived&&(cashIds.has(item.accountId)||(item.kind==="transfer"&&item.transferAccountId&&cashIds.has(item.transferAccountId))));
  const recurringItems=activeTemplates.map(template=>{
    const monthlyEquivalentMinor=monthlyEquivalent(template);
    const direction=template.kind==="transfer"
      ?("transfer-boundary" as const)
      :template.amountMinor>=0?("income" as const):("expense" as const);
    return{
      kind:template.kind,
      frequency:template.frequency,
      monthlyEquivalentMinor:direction==="expense"?-Math.abs(monthlyEquivalentMinor):direction==="income"?Math.abs(monthlyEquivalentMinor):monthlyEquivalentMinor,
      direction
    };
  }).sort((left,right)=>Math.abs(right.monthlyEquivalentMinor)-Math.abs(left.monthlyEquivalentMinor)||left.frequency.localeCompare(right.frequency));
  const monthlyExpenseTotalMinor=recurringItems.filter(item=>item.direction==="expense").reduce((total,item)=>safeAdd(total,-item.monthlyEquivalentMinor),0);
  const monthlyIncomeTotalMinor=recurringItems.filter(item=>item.direction==="income").reduce((total,item)=>safeAdd(total,item.monthlyEquivalentMinor),0);

  const debtAccounts=currencyAccounts.filter(item=>["credit","loan"].includes(item.type)&&item.balanceMinor<0);
  const debtTerms=input.debtPlan?.currency===input.currency?input.debtPlan.terms:[];
  const debtItems=debtAccounts.map(account=>{
    const term=debtTerms.find(item=>item.accountId===account.id&&item.enabled);
    return{
      balanceMinor:Math.abs(account.balanceMinor),
      minimumPaymentMinor:term?.minimumPaymentMinor??0,
      annualRateBps:term?.annualRateBps??0
    };
  }).sort((left,right)=>right.balanceMinor-left.balanceMinor||right.annualRateBps-left.annualRateBps);
  const debt={
    totalBalanceMinor:debtItems.reduce((total,item)=>safeAdd(total,item.balanceMinor),0),
    totalMinimumPaymentMinor:debtItems.reduce((total,item)=>safeAdd(total,item.minimumPaymentMinor),0),
    accountCount:debtItems.length,
    items:debtItems
  };

  const goals=(input.savingsGoals??[]).filter(goal=>currencyAccounts.some(account=>account.id===goal.accountId));
  const savingsItems=goals.map(goal=>{
    const account=currencyAccounts.find(item=>item.id===goal.accountId)!;
    const projection=calculateSavingsGoal(goal,account.balanceMinor,asOfDate);
    return{remainingMinor:projection.remainingMinor,plannedMonthlyMinor:goal.plannedMonthlyMinor,status:projection.status};
  }).sort((left,right)=>right.remainingMinor-left.remainingMinor);
  const savingsGoals={
    count:savingsItems.length,
    totalRemainingMinor:savingsItems.reduce((total,item)=>safeAdd(total,item.remainingMinor),0),
    totalPlannedMonthlyMinor:savingsItems.reduce((total,item)=>safeAdd(total,item.plannedMonthlyMinor),0),
    items:savingsItems
  };

  const budgetMonth=asOfDate.slice(0,7);
  const budgetRow=input.budgets.find(item=>item.month===budgetMonth);
  const budget={
    month:budgetMonth,
    plannedMinor:budgetRow?.plannedMinor??0,
    spentMinor:budgetRow?.spentMinor??0,
    availableMinor:budgetRow?.availableMinor??0,
    lineCount:budgetRow?.lines.length??0
  };

  const baseForecast=calculateCashFlowForecast({
    today:asOfDate,
    horizonDays,
    currency:input.currency,
    scenario:"expected",
    accounts:currencyAccounts,
    templates:input.templates,
    occurrences:input.occurrences,
    budgets:input.budgets
  });
  const withProposed=applyProposedMonthlyCost(baseForecast.days,input.proposedMonthlyCostMinor,asOfDate);

  const averageMonthlySurplusBeforeMinor=averageMonthlyNetMinor;
  const averageMonthlySurplusAfterMinor=averageMonthlySurplusBeforeMinor-input.proposedMonthlyCostMinor;
  const context:AffordabilityAnalysisContext={
    task:"affordability-analysis",
    schemaVersion:1,
    question,
    currency:input.currency,
    asOfDate,
    proposedMonthlyCostMinor:input.proposedMonthlyCostMinor,
    cashFlow:{
      trailingMonths,
      fromDate,
      toDate:asOfDate,
      averageMonthlyIncomeMinor,
      averageMonthlySpendingMinor,
      averageMonthlyNetMinor,
      totalIncomeMinor:report.incomeMinor,
      totalSpendingMinor:report.spendingMinor
    },
    liquidBalances,
    recurringObligations:{
      monthlyExpenseTotalMinor,
      monthlyIncomeTotalMinor,
      itemCount:recurringItems.length,
      items:recurringItems
    },
    debt,
    savingsGoals,
    budget,
    forecast:{
      horizonDays,
      scenario:"expected",
      startBalanceMinor:baseForecast.startBalanceMinor,
      endingBalanceMinor:baseForecast.endingBalanceMinor,
      lowestBalanceMinor:baseForecast.lowestBalanceMinor,
      lowestBalanceDate:baseForecast.lowestBalanceDate,
      withProposed:{
        endingBalanceMinor:withProposed.endingBalanceMinor,
        lowestBalanceMinor:withProposed.lowestBalanceMinor,
        lowestBalanceDate:withProposed.lowestBalanceDate,
        appliedMonthCount:withProposed.appliedMonthCount
      }
    },
    affordabilitySummary:{
      averageMonthlySurplusBeforeMinor,
      averageMonthlySurplusAfterMinor,
      canCoverFromAverageNet:averageMonthlySurplusAfterMinor>=0,
      projectedLowStaysNonNegative:baseForecast.lowestBalanceMinor>=0,
      projectedLowWithProposedStaysNonNegative:withProposed.lowestBalanceMinor>=0
    }
  };
  assertNoProhibitedFields(context);
  return context;
}

export function serializeAiTaskContext(context:AiTaskContext):string{
  assertNoProhibitedFields(context);
  return JSON.stringify(context,null,2);
}

export function defaultSpendingChangePeriods(asOfDate:string):{
  analysis:SpendingChangePeriodSpec;
  comparison:SpendingChangePeriodSpec;
  alignment:"equivalent-prior-days"|"full-prior-month";
}{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))throw new Error("Spending-change as-of date must use YYYY-MM-DD");
  const analysisFrom=monthStartIso(asOfDate);
  const analysisTo=asOfDate;
  const fullMonth=asOfDate===lastDayOfMonthIso(asOfDate);
  const priorStart=shiftMonthStart(asOfDate,-1);
  if(fullMonth){
    return{
      analysis:{fromDate:analysisFrom,toDate:analysisTo},
      comparison:{fromDate:priorStart,toDate:lastDayOfMonthIso(priorStart)},
      alignment:"full-prior-month"
    };
  }
  const day=Number(asOfDate.slice(8,10));
  const priorLastDay=Number(lastDayOfMonthIso(priorStart).slice(8,10));
  const comparisonDay=Math.min(day,priorLastDay);
  return{
    analysis:{fromDate:analysisFrom,toDate:analysisTo},
    comparison:{fromDate:priorStart,toDate:`${priorStart.slice(0,7)}-${String(comparisonDay).padStart(2,"0")}`},
    alignment:"equivalent-prior-days"
  };
}

export function buildSpendingChangeAnalysisContext(input:SpendingChangeAnalysisInput):SpendingChangeAnalysisContext{
  const question=input.question.trim();
  if(!question)throw new Error("Describe the spending-change question before building a task context");
  if(!/^[A-Z]{3}$/.test(input.currency))throw new Error("Spending-change analysis requires a three-letter currency code");
  const asOfDate=input.asOfDate;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))throw new Error("Spending-change as-of date must use YYYY-MM-DD");

  const defaults=defaultSpendingChangePeriods(asOfDate);
  const analysisSpec=input.analysisPeriod??defaults.analysis;
  const comparisonSpec=input.comparisonPeriod??defaults.comparison;
  validatePeriod(analysisSpec,"Analysis");
  validatePeriod(comparisonSpec,"Comparison");
  if(analysisSpec.fromDate>asOfDate)throw new Error("Analysis period cannot start after the as-of date");

  const currencyAccounts=input.accounts.filter(item=>item.currency===input.currency&&!item.archived);
  const analysisReport=calculateTransactionReport({
    fromDate:analysisSpec.fromDate,toDate:analysisSpec.toDate,currency:input.currency,
    accounts:currencyAccounts,transactions:input.transactions
  });
  const comparisonReport=calculateTransactionReport({
    fromDate:comparisonSpec.fromDate,toDate:comparisonSpec.toDate,currency:input.currency,
    accounts:currencyAccounts,transactions:input.transactions
  });

  const analysisPeriod=periodFacts(analysisSpec);
  const matchesDefault=
    analysisSpec.fromDate===defaults.analysis.fromDate
    &&analysisSpec.toDate===defaults.analysis.toDate
    &&comparisonSpec.fromDate===defaults.comparison.fromDate
    &&comparisonSpec.toDate===defaults.comparison.toDate;
  const comparisonAlignment=matchesDefault?defaults.alignment:"custom" as const;
  const comparisonPeriod={...periodFacts(comparisonSpec),alignment:comparisonAlignment};

  const spendingChangeMinor=safeAdd(analysisReport.spendingMinor,-comparisonReport.spendingMinor);
  const incomeChangeMinor=safeAdd(analysisReport.incomeMinor,-comparisonReport.incomeMinor);
  const netChangeMinor=safeAdd(analysisReport.netMinor,-comparisonReport.netMinor);
  const spendingChangePercent=percentChange(analysisReport.spendingMinor,comparisonReport.spendingMinor);

  const categoryChanges=buildCategoryDeltas(analysisReport,comparisonReport);
  const largestIncreases=categoryChanges.filter(item=>item.changeMinor>0).slice(0,5);
  const largestDecreases=categoryChanges.filter(item=>item.changeMinor<0).slice(0,5);
  const newlyAppearingCategories=categoryChanges.filter(item=>item.comparisonSpendingMinor===0&&item.analysisSpendingMinor>0).map(item=>item.category);
  const disappearedCategories=categoryChanges.filter(item=>item.analysisSpendingMinor===0&&item.comparisonSpendingMinor>0).map(item=>item.category);

  const analysisExpenses=expenseTransactions(currencyAccounts,input.transactions,analysisSpec);
  const comparisonExpenses=expenseTransactions(currencyAccounts,input.transactions,comparisonSpec);
  const recurringChanges=buildRecurringChanges(analysisExpenses,comparisonExpenses,input.templates??[]);
  const notableTransactions=selectNotableTransactions({
    analysisExpenses,
    comparisonExpenses,
    categoryChanges:largestIncreases,
    analysisSpendingMinor:analysisReport.spendingMinor
  });
  const oneTimeExpenseTotalMinor=notableTransactions
    .filter(item=>item.reason==="high-value"||item.reason==="new-merchant")
    .reduce((total,item)=>safeAdd(total,item.amountMinor),0);
  const recurringExpenseChangeMinor=recurringChanges.reduce((total,item)=>safeAdd(total,item.changeMinor),0);

  const note=periodLimitationNote(analysisPeriod,comparisonPeriod);

  const context:SpendingChangeAnalysisContext={
    task:"spending-change-analysis",
    schemaVersion:1,
    question,
    currency:input.currency,
    asOfDate,
    analysisPeriod,
    comparisonPeriod,
    totals:{
      analysis:{
        incomeMinor:analysisReport.incomeMinor,
        spendingMinor:analysisReport.spendingMinor,
        netMinor:analysisReport.netMinor,
        transactionCount:analysisReport.transactionCount
      },
      comparison:{
        incomeMinor:comparisonReport.incomeMinor,
        spendingMinor:comparisonReport.spendingMinor,
        netMinor:comparisonReport.netMinor,
        transactionCount:comparisonReport.transactionCount
      },
      spendingChangeMinor,
      spendingChangePercent,
      incomeChangeMinor,
      netChangeMinor
    },
    categoryChanges:categoryChanges.slice(0,MAX_CATEGORY_DELTAS),
    largestIncreases,
    largestDecreases,
    recurringChanges,
    notableTransactions,
    newlyAppearingCategories,
    disappearedCategories,
    periodLimitations:{
      analysisIsPartialMonth:analysisPeriod.isPartialMonth,
      comparisonUsesEquivalentDays:comparisonPeriod.alignment==="equivalent-prior-days",
      note
    },
    changeSummary:{
      spendingDifferenceMinor:spendingChangeMinor,
      topIncreaseCategories:largestIncreases.map(item=>({category:item.category,changeMinor:item.changeMinor})),
      topDecreaseCategories:largestDecreases.map(item=>({category:item.category,changeMinor:item.changeMinor})),
      oneTimeExpenseTotalMinor,
      recurringExpenseChangeMinor,
      incomeChangeMinor
    }
  };
  assertNoProhibitedFields(context);
  return context;
}

export function assertNoProhibitedFields(value:unknown,path="root"):void{
  if(Array.isArray(value)){
    value.forEach((item,index)=>assertNoProhibitedFields(item,`${path}[${index}]`));
    return;
  }
  if(value&&typeof value==="object"){
    for(const [key,child] of Object.entries(value as Record<string,unknown>)){
      if(PROHIBITED_CONTEXT_KEYS.has(key))throw new Error(`Task context includes prohibited field ${path}.${key}`);
      assertNoProhibitedFields(child,`${path}.${key}`);
    }
  }
}

function validatePeriod(period:SpendingChangePeriodSpec,label:string):void{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(period.fromDate)||!/^\d{4}-\d{2}-\d{2}$/.test(period.toDate)){
    throw new Error(`${label} period dates must use YYYY-MM-DD`);
  }
  if(period.fromDate>period.toDate)throw new Error(`${label} period start must not be after its end`);
}

function periodFacts(period:SpendingChangePeriodSpec):SpendingChangePeriodFacts{
  const dayCount=inclusiveDayCount(period.fromDate,period.toDate);
  const month=period.fromDate.slice(0,7);
  const isPartialMonth=period.fromDate!==monthStartIso(period.fromDate)||period.toDate!==lastDayOfMonthIso(period.fromDate);
  return{fromDate:period.fromDate,toDate:period.toDate,dayCount,isPartialMonth,month};
}

function periodLimitationNote(
  analysis:SpendingChangePeriodFacts,
  comparison:SpendingChangePeriodFacts&{alignment:string}
):string{
  if(analysis.isPartialMonth&&comparison.alignment==="equivalent-prior-days"){
    return `Analysis covers ${analysis.dayCount} days month-to-date. Comparison uses the same number of days from the prior month so incomplete months are not compared against a full month.`;
  }
  if(analysis.isPartialMonth){
    return `Analysis period is a partial month (${analysis.dayCount} days). Treat remaining days as unknown when explaining the change.`;
  }
  if(comparison.alignment==="custom"&&analysis.dayCount!==comparison.dayCount){
    return `Analysis and comparison periods have different lengths (${analysis.dayCount} vs ${comparison.dayCount} days). Absolute totals are authoritative; do not invent per-day causes.`;
  }
  return "Both periods are fully specified by HomeLedger. Explain only causes supported by the supplied totals and selected transactions.";
}

function buildCategoryDeltas(analysis:ReturnType<typeof calculateTransactionReport>,comparison:ReturnType<typeof calculateTransactionReport>):SpendingChangeCategoryDelta[]{
  const keys=new Set([...analysis.categories.map(item=>item.key),...comparison.categories.map(item=>item.key)]);
  const analysisMap=new Map(analysis.categories.map(item=>[item.key,item]));
  const comparisonMap=new Map(comparison.categories.map(item=>[item.key,item]));
  return[...keys].map(key=>{
    const analysisRow=analysisMap.get(key);
    const comparisonRow=comparisonMap.get(key);
    const label=sanitizeCategoryLabel(analysisRow?.label??comparisonRow?.label??"Uncategorized");
    const analysisSpendingMinor=analysisRow?.amountMinor??0;
    const comparisonSpendingMinor=comparisonRow?.amountMinor??0;
    const changeMinor=safeAdd(analysisSpendingMinor,-comparisonSpendingMinor);
    return{
      category:label,
      analysisSpendingMinor,
      comparisonSpendingMinor,
      changeMinor,
      changePercent:percentChange(analysisSpendingMinor,comparisonSpendingMinor)
    };
  }).filter(item=>item.changeMinor!==0||item.analysisSpendingMinor>0||item.comparisonSpendingMinor>0)
    .sort((left,right)=>Math.abs(right.changeMinor)-Math.abs(left.changeMinor)||left.category.localeCompare(right.category));
}

function expenseTransactions(
  accounts:readonly Account[],
  transactions:readonly Transaction[],
  period:SpendingChangePeriodSpec
):Transaction[]{
  const eligible=new Set(accounts.map(item=>item.id));
  return transactions.filter(item=>
    eligible.has(item.accountId)
    &&item.postedDate>=period.fromDate
    &&item.postedDate<=period.toDate
    &&item.amountMinor<0
    &&!item.transferLinkId
    &&item.source!=="transfer"
    &&item.source!=="adjustment"
  );
}

function buildRecurringChanges(
  analysisExpenses:readonly Transaction[],
  comparisonExpenses:readonly Transaction[],
  templates:readonly ScheduledTransaction[]
):SpendingChangeRecurringDelta[]{
  const scheduled=templates.filter(item=>item.kind==="transaction"&&item.enabled&&!item.archived&&item.amountMinor<0);
  const byMerchant=new Map<string,{category:string;analysis:number;comparison:number;frequency:string|null;classification:SpendingChangeRecurringDelta["classification"]}>();

  for(const template of scheduled){
    const key=normalizeMerchantKey(template.payee);
    if(!key)continue;
    const analysisTotal=sumPayee(analysisExpenses,key);
    const comparisonTotal=sumPayee(comparisonExpenses,key);
    if(analysisTotal===0&&comparisonTotal===0)continue;
    byMerchant.set(key,{
      category:sanitizeCategoryLabel(template.category),
      analysis:analysisTotal,
      comparison:comparisonTotal,
      frequency:template.frequency,
      classification:"recurring-structural"
    });
  }

  const merchantCounts=new Map<string,{analysisCount:number;comparisonCount:number;category:string;analysis:number;comparison:number}>();
  for(const item of analysisExpenses){
    const key=normalizeMerchantKey(item.payee);if(!key)continue;
    const row=merchantCounts.get(key)??{analysisCount:0,comparisonCount:0,category:sanitizeCategoryLabel(item.category),analysis:0,comparison:0};
    row.analysisCount++;row.analysis=safeAdd(row.analysis,-item.amountMinor);merchantCounts.set(key,row);
  }
  for(const item of comparisonExpenses){
    const key=normalizeMerchantKey(item.payee);if(!key)continue;
    const row=merchantCounts.get(key)??{analysisCount:0,comparisonCount:0,category:sanitizeCategoryLabel(item.category),analysis:0,comparison:0};
    row.comparisonCount++;row.comparison=safeAdd(row.comparison,-item.amountMinor);merchantCounts.set(key,row);
  }
  for(const [key,row] of merchantCounts){
    if(byMerchant.has(key))continue;
    if(row.analysisCount>=2&&row.comparisonCount>=2&&row.analysis!==row.comparison){
      byMerchant.set(key,{
        category:row.category,
        analysis:row.analysis,
        comparison:row.comparison,
        frequency:null,
        classification:"possible-recurring"
      });
    }
  }

  return[...byMerchant].map(([key,row])=>({
    merchantAlias:merchantAlias(key),
    category:row.category,
    frequency:row.frequency,
    analysisTotalMinor:row.analysis,
    comparisonTotalMinor:row.comparison,
    changeMinor:safeAdd(row.analysis,-row.comparison),
    classification:row.classification
  })).filter(item=>item.changeMinor!==0)
    .sort((left,right)=>Math.abs(right.changeMinor)-Math.abs(left.changeMinor))
    .slice(0,8);
}

function selectNotableTransactions(input:{
  analysisExpenses:readonly Transaction[];
  comparisonExpenses:readonly Transaction[];
  categoryChanges:readonly SpendingChangeCategoryDelta[];
  analysisSpendingMinor:number;
}):SpendingChangeNotableTransaction[]{
  const comparisonMerchants=new Set(input.comparisonExpenses.map(item=>normalizeMerchantKey(item.payee)).filter(Boolean));
  const risingCategories=new Set(input.categoryChanges.filter(item=>item.changeMinor>0).map(item=>item.category.toLocaleLowerCase()));
  const threshold=Math.max(10_000,Math.round(input.analysisSpendingMinor/20));
  const scored=input.analysisExpenses.map(item=>{
    const amount=-item.amountMinor;
    const key=normalizeMerchantKey(item.payee);
    const category=sanitizeCategoryLabel(item.category);
    let reason:SpendingChangeNotableTransaction["reason"]|"skip"="skip";
    let score=0;
    if(amount>=threshold){reason="high-value";score=amount;}
    else if(key&&!comparisonMerchants.has(key)&&amount>=Math.max(5_000,threshold/2)){reason="new-merchant";score=amount;}
    else if(risingCategories.has(category.toLocaleLowerCase())&&amount>=Math.max(5_000,threshold/3)){reason="category-driver";score=amount;}
    return{item,amount,category,key,reason,score};
  }).filter(item=>item.reason!=="skip").sort((left,right)=>right.score-left.score);

  const selected:SpendingChangeNotableTransaction[]=[];
  const seen=new Set<string>();
  for(const row of scored){
    if(selected.length>=MAX_NOTABLE_TRANSACTIONS)break;
    const dedupe=`${row.item.postedDate}:${row.amount}:${row.category}:${row.key}`;
    if(seen.has(dedupe))continue;
    seen.add(dedupe);
    selected.push({
      postedDate:row.item.postedDate,
      amountMinor:row.amount,
      category:row.category,
      merchantAlias:merchantAlias(row.key||row.item.payee.toLocaleLowerCase()),
      reason:row.reason as SpendingChangeNotableTransaction["reason"]
    });
  }
  return selected;
}

function sumPayee(transactions:readonly Transaction[],merchantKey:string):number{
  return transactions.filter(item=>normalizeMerchantKey(item.payee)===merchantKey)
    .reduce((total,item)=>safeAdd(total,-item.amountMinor),0);
}

function sanitizeCategoryLabel(value:string):string{
  const clean=value.trim()||"Uncategorized";
  return SENSITIVE_CATEGORY.test(clean)?"Removed-sensitive":clean;
}

function normalizeMerchantKey(value:string):string{
  return value.toLowerCase().replace(/\d+/g," ").replace(/[^\p{L}]+/gu," ").trim().replace(/\s+/g," ");
}

function merchantAlias(value:string):string{
  return `Merchant-${fnv1a(value).toString(16).toUpperCase().padStart(8,"0")}`;
}

function percentChange(current:number,previous:number):number|null{
  if(previous===0)return current===0?0:null;
  return Math.round(((current-previous)/previous)*1000)/10;
}

function inclusiveDayCount(fromDate:string,toDate:string):number{
  const from=Date.parse(`${fromDate}T00:00:00Z`);
  const to=Date.parse(`${toDate}T00:00:00Z`);
  return Math.floor((to-from)/86_400_000)+1;
}

function monthStartIso(asOfDate:string):string{
  return `${asOfDate.slice(0,7)}-01`;
}

function lastDayOfMonthIso(asOfDate:string):string{
  const year=Number(asOfDate.slice(0,4));
  const month=Number(asOfDate.slice(5,7));
  const date=new Date(Date.UTC(year,month,0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}

function fnv1a(value:string):number{
  let hash=0x811c9dc5;
  for(let index=0;index<value.length;index++){
    hash^=value.charCodeAt(index);
    hash=Math.imul(hash,0x01000193);
  }
  return hash>>>0;
}

function monthlyEquivalent(template:ScheduledTransaction):number{
  const amount=Math.abs(template.amountMinor);
  switch(template.frequency){
    case"weekly":return Math.round(amount*52/12);
    case"biweekly":return Math.round(amount*26/12);
    case"semimonthly":return amount*2;
    case"monthly":return amount;
    case"annual":return Math.round(amount/12);
    case"custom":{
      const count=template.customIntervalCount??1;
      const unit=template.customIntervalUnit??"months";
      if(unit==="days")return Math.round(amount*(365/count)/12);
      if(unit==="weeks")return Math.round(amount*(52/count)/12);
      if(unit==="months")return Math.round(amount/count);
      return Math.round(amount/(12*count));
    }
    default:return amount;
  }
}

function applyProposedMonthlyCost(days:readonly{date:string;balanceMinor:number}[],monthlyCostMinor:number,asOfDate:string){
  const chargedMonths=new Set<string>();
  let lowestBalanceMinor=Number.POSITIVE_INFINITY,lowestBalanceDate=asOfDate,endingBalanceMinor=days.at(-1)?.balanceMinor??0;
  let runningAdjustment=0,appliedMonthCount=0;
  for(const day of days){
    const month=day.date.slice(0,7);
    if(!chargedMonths.has(month)){
      chargedMonths.add(month);
      runningAdjustment=safeAdd(runningAdjustment,-monthlyCostMinor);
      appliedMonthCount++;
    }
    const balance=safeAdd(day.balanceMinor,runningAdjustment);
    if(balance<lowestBalanceMinor){lowestBalanceMinor=balance;lowestBalanceDate=day.date;}
    endingBalanceMinor=balance;
  }
  if(!Number.isFinite(lowestBalanceMinor))lowestBalanceMinor=endingBalanceMinor;
  return{endingBalanceMinor,lowestBalanceMinor,lowestBalanceDate,appliedMonthCount};
}

function shiftMonthStart(asOfDate:string,monthOffset:number):string{
  const [year,month]=asOfDate.slice(0,7).split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1+monthOffset,1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-01`;
}

function divRound(value:number,divisor:number):number{
  return Math.round(value/divisor);
}

function safeAdd(left:number,right:number):number{
  const result=left+right;
  if(!Number.isSafeInteger(result))throw new Error("Affordability total is too large");
  return result;
}

/** Exported for tests that verify horizon helpers stay aligned with forecast math. */
export function affordabilityWindowEnd(asOfDate:string,horizonDays:number):string{
  return addDaysIso(asOfDate,horizonDays-1);
}
