import type {DebtStrategy,DebtTerm} from "./domain";

export interface DebtProjectionInput{
  strategy:DebtStrategy;
  extraPaymentMinor:number;
  startMonth:string;
  debts:readonly (DebtTerm&{balanceMinor:number})[];
}

export interface DebtProjectionLine{
  accountId:string;
  payoffMonth?:string;
  months:number;
  interestMinor:number;
  paidMinor:number;
}

export interface DebtProjectionMonth{
  month:string;
  balanceMinor:number;
  interestMinor:number;
  paymentMinor:number;
}

export interface DebtProjection{
  strategy:DebtStrategy;
  complete:boolean;
  months:number;
  debtFreeMonth?:string;
  startingBalanceMinor:number;
  monthlyPaymentMinor:number;
  totalInterestMinor:number;
  totalPaidMinor:number;
  payoffOrder:string[];
  debts:DebtProjectionLine[];
  timeline:DebtProjectionMonth[];
}

export function calculateDebtProjection(input:DebtProjectionInput):DebtProjection{
  validateMonth(input.startMonth);
  if(!["snowball","avalanche","custom"].includes(input.strategy))throw new Error("Debt strategy is invalid");
  if(!Number.isSafeInteger(input.extraPaymentMinor)||input.extraPaymentMinor<0)throw new Error("Extra payment must be zero or greater");
  const selected=input.debts.filter(item=>item.enabled&&item.balanceMinor>0).map(item=>{
    if(!Number.isSafeInteger(item.balanceMinor)||item.balanceMinor<0)throw new Error("Debt balance is invalid");
    if(!Number.isInteger(item.annualRateBps)||item.annualRateBps<0||item.annualRateBps>100_000)throw new Error("Debt APR is invalid");
    if(!Number.isSafeInteger(item.minimumPaymentMinor)||item.minimumPaymentMinor<=0)throw new Error("Debt minimum payment must be greater than zero");
    if(!Number.isInteger(item.customPriority)||item.customPriority<0)throw new Error("Debt priority is invalid");
    return{...item,balance:item.balanceMinor,interest:0,paid:0,months:0,payoffMonth:undefined as string|undefined};
  });
  if(new Set(selected.map(item=>item.accountId)).size!==selected.length)throw new Error("A debt account was included more than once");
  const startingBalanceMinor=sum(selected.map(item=>item.balance)),minimums=sum(selected.map(item=>item.minimumPaymentMinor)),monthlyPaymentMinor=add(minimums,input.extraPaymentMinor);
  const timeline:DebtProjectionMonth[]=[],payoffOrder:string[]=[];
  for(let index=0;index<1200&&selected.some(item=>item.balance>0);index++){
    const month=shiftMonth(input.startMonth,index);let interestMinor=0,paymentMinor=0,remaining=monthlyPaymentMinor;
    for(const debt of selected.filter(item=>item.balance>0)){const interest=monthlyInterest(debt.balance,debt.annualRateBps);debt.balance=add(debt.balance,interest);debt.interest=add(debt.interest,interest);interestMinor=add(interestMinor,interest);debt.months++;}
    for(const debt of selected.filter(item=>item.balance>0)){const payment=Math.min(debt.balance,debt.minimumPaymentMinor,remaining);debt.balance=add(debt.balance,-payment);debt.paid=add(debt.paid,payment);paymentMinor=add(paymentMinor,payment);remaining=add(remaining,-payment);}
    while(remaining>0){const target=ordered(selected.filter(item=>item.balance>0),input.strategy)[0];if(!target)break;const payment=Math.min(target.balance,remaining);target.balance=add(target.balance,-payment);target.paid=add(target.paid,payment);paymentMinor=add(paymentMinor,payment);remaining=add(remaining,-payment);}
    for(const debt of selected.filter(item=>item.balance===0&&!item.payoffMonth)){debt.payoffMonth=month;payoffOrder.push(debt.accountId);}
    timeline.push({month,balanceMinor:sum(selected.map(item=>item.balance)),interestMinor,paymentMinor});
  }
  const complete=selected.every(item=>item.balance===0),months=timeline.length,totalInterestMinor=sum(selected.map(item=>item.interest)),totalPaidMinor=sum(selected.map(item=>item.paid));
  return{strategy:input.strategy,complete,months,debtFreeMonth:complete&&months?timeline.at(-1)?.month:complete?input.startMonth:undefined,startingBalanceMinor,monthlyPaymentMinor,totalInterestMinor,totalPaidMinor,payoffOrder,debts:selected.map(item=>({accountId:item.accountId,payoffMonth:item.payoffMonth,months:item.months,interestMinor:item.interest,paidMinor:item.paid})),timeline};
}

function ordered<T extends {accountId:string;balance:number;annualRateBps:number;customPriority:number}>(debts:T[],strategy:DebtStrategy):T[]{
  return[...debts].sort((left,right)=>strategy==="snowball"?left.balance-right.balance||right.annualRateBps-left.annualRateBps||left.accountId.localeCompare(right.accountId):strategy==="avalanche"?right.annualRateBps-left.annualRateBps||left.balance-right.balance||left.accountId.localeCompare(right.accountId):left.customPriority-right.customPriority||right.annualRateBps-left.annualRateBps||left.accountId.localeCompare(right.accountId));
}
function monthlyInterest(balance:number,annualRateBps:number):number{const value=(BigInt(balance)*BigInt(annualRateBps)+60_000n)/120_000n,result=Number(value);if(!Number.isSafeInteger(result))throw new Error("Debt interest is too large");return result;}
function validateMonth(value:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new Error("Debt start month must use YYYY-MM");}
function shiftMonth(value:string,offset:number):string{validateMonth(value);const [year,month]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1+offset,1));return`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;}
function add(...values:number[]):number{const result=values.reduce((total,value)=>total+value,0);if(!Number.isSafeInteger(result))throw new Error("Debt projection total is too large");return result;}
function sum(values:number[]):number{return add(...values);}
