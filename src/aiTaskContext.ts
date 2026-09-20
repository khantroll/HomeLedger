import type {Account,BudgetMonth,DebtPlan,SavingsGoal,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import {calculateCashFlowForecast} from "./forecastMath";
import {calculateTransactionReport} from "./reportMath";
import {calculateSavingsGoal} from "./savingsGoalMath";
import {addDaysIso} from "./scheduledPresentation";

export type AiTaskKind="affordability-analysis";

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

export type AiTaskContext=AffordabilityAnalysisContext;

const PROHIBITED_CONTEXT_KEYS=new Set([
  "id","accountId","transferAccountId","externalId","importBatchId","providerId","routingNumber",
  "accountNumber","filename","fileName","memo","payee","name","ownerLabel","institution","auth",
  "password","token","apiKey","secret","transactionId","scheduledTransactionId"
]);

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
