import type {SavingsGoal} from "./domain";

export type SavingsGoalStatus="complete"|"on-track"|"at-risk"|"overdue";

export interface SavingsGoalProjection{
  currentMinor:number;
  remainingMinor:number;
  progressPercent:number;
  monthsRemaining:number;
  requiredMonthlyMinor:number;
  projectedMonth?:string;
  status:SavingsGoalStatus;
}

export function calculateSavingsGoal(goal:SavingsGoal,currentBalanceMinor:number,asOfDate:string):SavingsGoalProjection{
  const target=parseDate(goal.targetDate),asOf=parseDate(asOfDate);
  if(!Number.isSafeInteger(goal.targetMinor)||goal.targetMinor<=0)throw new Error("Savings target must be greater than zero");
  if(!Number.isSafeInteger(goal.plannedMonthlyMinor)||goal.plannedMonthlyMinor<0)throw new Error("Planned monthly savings must be zero or greater");
  if(!Number.isSafeInteger(currentBalanceMinor))throw new Error("Savings balance is invalid");
  const currentMinor=Math.max(0,currentBalanceMinor),remainingMinor=Math.max(0,goal.targetMinor-currentMinor),progressPercent=Math.min(100,Math.floor(currentMinor/goal.targetMinor*100));
  if(remainingMinor===0)return{currentMinor,remainingMinor,progressPercent,monthsRemaining:0,requiredMonthlyMinor:0,status:"complete"};
  if(target<=asOf)return{currentMinor,remainingMinor,progressPercent,monthsRemaining:0,requiredMonthlyMinor:remainingMinor,status:"overdue"};
  const monthsRemaining=Math.max(1,(target.getUTCFullYear()-asOf.getUTCFullYear())*12+target.getUTCMonth()-asOf.getUTCMonth());
  const requiredMonthlyMinor=Math.ceil(remainingMinor/monthsRemaining),status=goal.plannedMonthlyMinor*monthsRemaining>=remainingMinor?"on-track":"at-risk";
  const projectedMonth=goal.plannedMonthlyMinor>0?shiftMonth(asOfDate,Math.ceil(remainingMinor/goal.plannedMonthlyMinor)).slice(0,7):undefined;
  return{currentMinor,remainingMinor,progressPercent,monthsRemaining,requiredMonthlyMinor,projectedMonth,status};
}

function parseDate(value:string):Date{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("Savings goal dates must use YYYY-MM-DD");const date=new Date(`${value}T00:00:00Z`);if(Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==value)throw new Error("Savings goal date is invalid");return date;}
function shiftMonth(value:string,offset:number):string{const date=parseDate(value),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+offset);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.toISOString().slice(0,10);}
