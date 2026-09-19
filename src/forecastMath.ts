import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction} from "./domain";
import {addDaysIso} from "./scheduledPresentation";

export type ForecastScenario="expected"|"conservative"|"optimistic";

export interface ForecastDay{
  date:string;
  inflowMinor:number;
  outflowMinor:number;
  balanceMinor:number;
  scheduledCount:number;
}

export interface CashFlowForecast{
  scenario:ForecastScenario;
  currency:string;
  horizonDays:number;
  startBalanceMinor:number;
  endingBalanceMinor:number;
  lowestBalanceMinor:number;
  lowestBalanceDate:string;
  totalInflowsMinor:number;
  totalOutflowsMinor:number;
  budgetReserveMinor:number;
  days:ForecastDay[];
}

export interface ForecastInput{
  today:string;
  horizonDays:number;
  currency:string;
  scenario:ForecastScenario;
  accounts:readonly Account[];
  templates:readonly ScheduledTransaction[];
  occurrences:readonly ScheduledOccurrence[];
  budgets:readonly BudgetMonth[];
}

const scenarioFactors:Record<ForecastScenario,{incomePercent:number;expensePercent:number;budgetPercent:number}>={
  expected:{incomePercent:100,expensePercent:100,budgetPercent:100},
  conservative:{incomePercent:90,expensePercent:110,budgetPercent:110},
  optimistic:{incomePercent:105,expensePercent:95,budgetPercent:90},
};

export function calculateCashFlowForecast(input:ForecastInput):CashFlowForecast{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.today))throw new Error("Forecast date must use YYYY-MM-DD");
  if(![30,60,90,180,365].includes(input.horizonDays))throw new Error("Unsupported forecast horizon");
  const cashAccounts=input.accounts.filter(item=>["checking","savings","cash"].includes(item.type)&&item.currency===input.currency);
  const accountIds=new Set(cashAccounts.map(item=>item.id));
  const startBalanceMinor=sum(cashAccounts.map(item=>item.balanceMinor));
  const endDate=addDaysIso(input.today,input.horizonDays-1);
  const templates=new Map(input.templates.filter(item=>item.enabled&&!item.archived&&(accountIds.has(item.accountId)||(item.kind==="transfer"&&item.transferAccountId&&accountIds.has(item.transferAccountId)))).map(item=>[item.id,item]));
  const factors=scenarioFactors[input.scenario];
  const daily=new Map<string,{inflowMinor:number;outflowMinor:number;scheduledCount:number}>();
  for(let offset=0;offset<input.horizonDays;offset++)daily.set(addDaysIso(input.today,offset),{inflowMinor:0,outflowMinor:0,scheduledCount:0});

  const expected=input.occurrences.filter(item=>item.status==="expected"&&item.dueDate>=input.today&&item.dueDate<=endDate&&templates.has(item.scheduledTransactionId));
  for(const occurrence of expected){
    const template=templates.get(occurrence.scheduledTransactionId)!;
    const amount=template.kind==="transfer"?transferCashAmount(template,accountIds):scenarioAmount(template.amountMinor,factors.incomePercent,factors.expensePercent);
    if(amount===0)continue;
    const value=daily.get(occurrence.dueDate)!;
    if(amount>=0)value.inflowMinor=add(value.inflowMinor,amount);else value.outflowMinor=add(value.outflowMinor,-amount);
    value.scheduledCount++;
  }

  let budgetReserveMinor=0;
  for(const budget of input.budgets){
    const monthStart=`${budget.month}-01`,monthEnd=monthEndIso(budget.month);
    const planningStart=monthStart>input.today?monthStart:input.today;
    const activeStart=planningStart,activeEnd=monthEnd<endDate?monthEnd:endDate;
    if(activeStart>activeEnd)continue;
    const activeDates=[...daily.keys()].filter(date=>date>=activeStart&&date<=activeEnd);
    const planningDayCount=daysInclusive(planningStart,monthEnd);
    for(const line of budget.lines){
      const scheduledExpense=expected.reduce((total,occurrence)=>{
        const template=templates.get(occurrence.scheduledTransactionId);
        return occurrence.dueDate.startsWith(`${budget.month}-`)&&template?.kind==="transaction"&&template.category.toLocaleLowerCase()===line.category.toLocaleLowerCase()&&template.amountMinor<0?add(total,-template.amountMinor):total;
      },0);
      const unspentPlan=Math.max(0,add(line.plannedMinor,-line.spentMinor));
      const activePlan=proratedPrefix(unspentPlan,planningDayCount,activeDates.length);
      const reserve=scaleMinor(Math.max(0,activePlan-scheduledExpense),factors.budgetPercent,"ceil");
      budgetReserveMinor=add(budgetReserveMinor,reserve);
      spreadExpense(reserve,activeDates,daily);
    }
  }

  let balance=startBalanceMinor,totalInflowsMinor=0,totalOutflowsMinor=0,lowestBalanceMinor=startBalanceMinor,lowestBalanceDate=input.today;
  const days:ForecastDay[]=[];
  for(const [date,value] of daily){
    totalInflowsMinor=add(totalInflowsMinor,value.inflowMinor);totalOutflowsMinor=add(totalOutflowsMinor,value.outflowMinor);
    balance=add(balance,value.inflowMinor,-value.outflowMinor);
    if(balance<lowestBalanceMinor){lowestBalanceMinor=balance;lowestBalanceDate=date;}
    days.push({date,...value,balanceMinor:balance});
  }
  return{scenario:input.scenario,currency:input.currency,horizonDays:input.horizonDays,startBalanceMinor,endingBalanceMinor:balance,lowestBalanceMinor,lowestBalanceDate,totalInflowsMinor,totalOutflowsMinor,budgetReserveMinor,days};
}

export function forecastMonths(today:string,horizonDays:number):string[]{
  const end=addDaysIso(today,horizonDays-1),months:string[]=[];
  let cursor=today.slice(0,7);
  while(cursor<=end.slice(0,7)){months.push(cursor);cursor=nextMonth(cursor);}
  return months;
}

function scenarioAmount(amount:number,incomePercent:number,expensePercent:number):number{return amount>=0?scaleMinor(amount,incomePercent,"floor"):-scaleMinor(-amount,expensePercent,"ceil");}
function transferCashAmount(template:ScheduledTransaction,accountIds:Set<string>):number{const from=accountIds.has(template.accountId),to=Boolean(template.transferAccountId&&accountIds.has(template.transferAccountId));return from===to?0:from?-template.amountMinor:template.amountMinor;}
function scaleMinor(amount:number,percent:number,round:"floor"|"ceil"):number{
  const product=BigInt(amount)*BigInt(percent),whole=product/100n,remainder=product%100n,result=whole+(round==="ceil"&&remainder?1n:0n),value=Number(result);
  if(!Number.isSafeInteger(value))throw new Error("Forecast total is too large");
  return value;
}
function spreadExpense(amount:number,dates:string[],daily:Map<string,{inflowMinor:number;outflowMinor:number;scheduledCount:number}>){
  if(!amount||!dates.length)return;
  const base=Math.floor(amount/dates.length),remainder=amount%dates.length;
  dates.forEach((date,index)=>{const value=daily.get(date)!;value.outflowMinor=add(value.outflowMinor,base+(index<remainder?1:0));});
}
function proratedPrefix(amount:number,totalDays:number,activeDays:number):number{const base=Math.floor(amount/totalDays),remainder=amount%totalDays;return add(base*activeDays,Math.min(remainder,activeDays));}
function daysInclusive(left:string,right:string):number{return Math.round((Date.parse(`${right}T00:00:00Z`)-Date.parse(`${left}T00:00:00Z`))/86_400_000)+1;}
function monthEndIso(month:string):string{const [year,value]=month.split("-").map(Number);return new Date(Date.UTC(year,value,0)).toISOString().slice(0,10);}
function nextMonth(month:string):string{const [year,value]=month.split("-").map(Number),date=new Date(Date.UTC(year,value,1));return`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;}
function add(...values:number[]):number{const result=values.reduce((total,value)=>total+value,0);if(!Number.isSafeInteger(result))throw new Error("Forecast total is too large");return result;}
function sum(values:number[]):number{return add(...values);}
