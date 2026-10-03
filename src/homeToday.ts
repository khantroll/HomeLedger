import type {Account,BudgetMonth,DebtPlan,SavingsGoal,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import type {NavigationIntent} from "./navigationIntent";
import {calculateCashFlowForecast,type CashFlowForecast} from "./forecastMath";
import {calculateSavingsGoal,type SavingsGoalProjection} from "./savingsGoalMath";
import {calculateDebtProjection,type DebtProjection} from "./debtMath";
import {addDaysIso} from "./scheduledPresentation";

export type HomeAttentionTone="negative"|"warning";
export interface HomeAttentionItem{
  key:string;
  priority:number;
  tone:HomeAttentionTone;
  title:string;
  detail:string;
  action:string;
  intent:NavigationIntent;
}
export type HomeUpcomingKind="bill"|"income"|"transfer";
export interface HomeUpcomingItem{
  occurrenceId:string;
  templateId:string;
  dueDate:string;
  payee:string;
  amountMinor:number;
  kind:HomeUpcomingKind;
  accountId:string;
  transferAccountId?:string;
  intent:NavigationIntent;
}
export interface HomeGoalStatus{
  goal:SavingsGoal;
  account?:Account;
  projection:SavingsGoalProjection;
}
export interface HomeDebtStatus{
  plan:DebtPlan;
  projection:DebtProjection;
}
export interface HomeNextCashFlow{
  date:string;
  title:string;
  amountMinor:number;
  balanceAfterMinor:number;
  safeThrough:boolean;
  intent:NavigationIntent;
}
export interface HomeTodayModel{
  currency:string;
  forecast:CashFlowForecast;
  attention:HomeAttentionItem[];
  upcoming:HomeUpcomingItem[];
  goals:HomeGoalStatus[];
  debts:HomeDebtStatus[];
  currentBudget?:BudgetMonth;
  nextCashFlow?:HomeNextCashFlow;
}

export interface HomeTodayInput{
  today:string;
  currency:string;
  accounts:Account[];
  transactions:Transaction[];
  templates:ScheduledTransaction[];
  occurrences:ScheduledOccurrence[];
  budgets:BudgetMonth[];
  goals:SavingsGoal[];
  debtPlans:DebtPlan[];
}

export function buildHomeTodayModel(input:HomeTodayInput):HomeTodayModel{
  const activeAccounts=input.accounts.filter(account=>!account.archived);
  const activeTemplates=new Map(input.templates.filter(item=>item.enabled&&!item.archived).map(item=>[item.id,item]));
  const currentBudget=input.budgets.find(item=>item.month===input.today.slice(0,7));
  const forecast=calculateCashFlowForecast({
    today:input.today,horizonDays:30,currency:input.currency,scenario:"expected",
    accounts:activeAccounts,templates:input.templates,occurrences:input.occurrences,budgets:input.budgets,
  });

  const attention:HomeAttentionItem[]=[];
  const overdue=input.occurrences
    .filter(item=>item.status==="expected"&&item.dueDate<input.today&&activeTemplates.has(item.scheduledTransactionId))
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id));
  if(overdue.length){
    const oldest=overdue[0],template=activeTemplates.get(oldest.scheduledTransactionId);
    attention.push({
      key:"overdue",priority:10,tone:"negative",
      title:template?\`\${template.payee} is overdue\`:\`\${overdue.length} overdue scheduled \${overdue.length===1?"item":"items"}\`,
      detail:overdue.length===1?\`Due \${oldest.dueDate}.\`:\`\${overdue.length} overdue items · oldest was due \${oldest.dueDate}.\`,
      action:"Review bills",intent:{page:"Bills",focus:{kind:"overdue",dueDate:oldest.dueDate}},
    });
  }

  const dueAutoPost=input.occurrences.filter(item=>item.status==="expected"&&item.dueDate<=input.today&&activeTemplates.get(item.scheduledTransactionId)?.autoPost);
  if(dueAutoPost.length)attention.push({
    key:"autopost",priority:20,tone:"warning",
    title:\`\${dueAutoPost.length} automatic \${dueAutoPost.length===1?"posting is":"postings are"} due\`,
    detail:"Review the scheduled auto-post queue before these entries are added.",
    action:"Review scheduled items",intent:{page:"Bills",focus:{kind:"autoPost"}},
  });

  const reviewCount=input.transactions.filter(item=>item.status==="review").length;
  if(reviewCount)attention.push({
    key:"review",priority:30,tone:"warning",
    title:\`\${reviewCount} \${reviewCount===1?"transaction needs":"transactions need"} review\`,
    detail:"Confirm imported or uncategorized activity before treating the ledger as settled.",
    action:"Review transactions",intent:{page:"Transactions",status:"review"},
  });

  const flaggedCount=input.transactions.filter(item=>item.flagged).length;
  if(flaggedCount)attention.push({
    key:"flagged",priority:35,tone:"warning",
    title:\`\${flaggedCount} flagged \${flaggedCount===1?"transaction":"transactions"} to follow up\`,
    detail:"These were deliberately marked for later attention.",
    action:"Open flagged transactions",intent:{page:"Transactions",status:"all",flaggedOnly:true},
  });

  if(forecast.lowestBalanceMinor<0)attention.push({
    key:"forecast",priority:40,tone:"negative",
    title:"Cash is projected to go negative",
    detail:\`30-day low: \${forecast.lowestBalanceMinor} minor units on \${forecast.lowestBalanceDate}.\`,
    action:"Open forecast",intent:{page:"Forecast",focus:{horizonDays:30,highlightDate:forecast.lowestBalanceDate}},
  });

  if(currentBudget?.availableMinor!==undefined&&currentBudget.availableMinor<0)attention.push({
    key:"budget",priority:50,tone:"negative",
    title:"This month’s budget is over plan",
    detail:\`\${Math.abs(currentBudget.availableMinor)} minor units over the available plan.\`,
    action:"Review budget",intent:{page:"Budget",focus:{month:input.today.slice(0,7)}},
  });

  const goals=input.goals.map(goal=>{
    const account=activeAccounts.find(item=>item.id===goal.accountId);
    return{goal,account,projection:calculateSavingsGoal(goal,account?.balanceMinor??0,input.today)};
  }).sort((a,b)=>goalRank(a.projection.status)-goalRank(b.projection.status)||a.goal.targetDate.localeCompare(b.goal.targetDate)||a.goal.name.localeCompare(b.goal.name));
  const riskyGoal=goals.find(item=>item.projection.status==="overdue"||item.projection.status==="at-risk");
  if(riskyGoal)attention.push({
    key:\`goal-\${riskyGoal.goal.id}\`,priority:60,tone:riskyGoal.projection.status==="overdue"?"negative":"warning",
    title:riskyGoal.projection.status==="overdue"?\`\${riskyGoal.goal.name} goal is past its target date\`:\`\${riskyGoal.goal.name} goal is at risk\`,
    detail:\`\${riskyGoal.projection.progressPercent}% funded with \${riskyGoal.projection.remainingMinor} minor units remaining.\`,
    action:"Review savings goals",intent:{page:"Budget",focus:{month:input.today.slice(0,7)}},
  });
  attention.sort((a,b)=>a.priority-b.priority||a.key.localeCompare(b.key));

  const endDate=addDaysIso(input.today,30);
  const upcoming=input.occurrences
    .filter(item=>item.status==="expected"&&item.dueDate>=input.today&&item.dueDate<=endDate&&activeTemplates.has(item.scheduledTransactionId))
    .map(item=>{
      const template=activeTemplates.get(item.scheduledTransactionId)!;
      const kind:HomeUpcomingKind=template.kind==="transfer"?"transfer":template.amountMinor>=0?"income":"bill";
      return{
        occurrenceId:item.id,templateId:template.id,dueDate:item.dueDate,payee:template.payee,amountMinor:template.amountMinor,kind,
        accountId:template.accountId,transferAccountId:template.transferAccountId,
        intent:{page:"Bills",focus:{kind:"day",dueDate:item.dueDate}} as NavigationIntent,
      };
    })
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||upcomingRank(a.kind)-upcomingRank(b.kind)||a.payee.localeCompare(b.payee)||a.occurrenceId.localeCompare(b.occurrenceId));

  const debts=input.debtPlans.filter(plan=>plan.terms.some(term=>term.enabled)).map(plan=>{
    const projection=calculateDebtProjection({
      strategy:plan.strategy,extraPaymentMinor:plan.extraPaymentMinor,startMonth:input.today.slice(0,7),
      debts:plan.terms.map(term=>({...term,balanceMinor:Math.abs(activeAccounts.find(account=>account.id===term.accountId)?.balanceMinor??0)})),
    });
    return{plan,projection};
  }).sort((a,b)=>a.plan.currency.localeCompare(b.plan.currency));

  const nextDay=forecast.days.find(day=>day.scheduledCount>0);
  const dayEvents=nextDay?upcoming.filter(item=>item.dueDate===nextDay.date):[];
  const nextCashFlow=nextDay?{
    date:nextDay.date,
    title:dayEvents.length===1?dayEvents[0].payee:\`\${dayEvents.length||nextDay.scheduledCount} scheduled events\`,
    amountMinor:nextDay.inflowMinor-nextDay.outflowMinor,
    balanceAfterMinor:nextDay.balanceMinor,
    safeThrough:forecast.days.filter(day=>day.date<=nextDay.date).every(day=>day.balanceMinor>=0),
    intent:{page:"Bills",focus:{kind:"day",dueDate:nextDay.date}} as NavigationIntent,
  }:undefined;

  return{currency:input.currency,forecast,attention,upcoming,goals,debts,currentBudget,nextCashFlow};
}

function goalRank(status:SavingsGoalProjection["status"]):number{
  return status==="overdue"?0:status==="at-risk"?1:status==="on-track"?2:3;
}
function upcomingRank(kind:HomeUpcomingKind):number{return kind==="bill"?0:kind==="income"?1:2;}
