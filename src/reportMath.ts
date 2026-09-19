import type {Account,Transaction} from "./domain";

export type ReportPreset="month"|"quarter"|"year"|"twelve"|"custom";

export interface ReportContribution{
  transactionId:string;
  amountMinor:number;
}

export interface ReportGroup{
  key:string;
  label:string;
  amountMinor:number;
  transactionCount:number;
  contributions:ReportContribution[];
}

export interface ReportMonth{
  month:string;
  incomeMinor:number;
  spendingMinor:number;
  netMinor:number;
}

export interface TransactionReport{
  fromDate:string;
  toDate:string;
  incomeMinor:number;
  spendingMinor:number;
  netMinor:number;
  savingsRatePercent:number|null;
  transactionCount:number;
  categories:ReportGroup[];
  payees:ReportGroup[];
  months:ReportMonth[];
}

export interface TransactionReportInput{
  fromDate:string;
  toDate:string;
  currency:string;
  accountId?:string;
  accounts:readonly Account[];
  transactions:readonly Transaction[];
}

export function calculateTransactionReport(input:TransactionReportInput):TransactionReport{
  parseDate(input.fromDate);parseDate(input.toDate);
  if(input.fromDate>input.toDate)throw new Error("Report start date must not be after its end date");
  const eligibleAccounts=new Set(input.accounts.filter(item=>item.currency===input.currency&&(!input.accountId||item.id===input.accountId)).map(item=>item.id));
  if(input.accountId&&!eligibleAccounts.has(input.accountId))throw new Error("The selected report account is not available in this currency");
  const transactions=input.transactions.filter(item=>eligibleAccounts.has(item.accountId)&&item.postedDate>=input.fromDate&&item.postedDate<=input.toDate&&!item.transferLinkId&&item.source!=="transfer"&&item.source!=="adjustment");
  const categoryMap=new Map<string,{label:string;amountMinor:number;items:Map<string,number>}>(),payeeMap=new Map<string,{label:string;amountMinor:number;items:Map<string,number>}>();
  const monthMap=new Map(reportMonths(input.fromDate,input.toDate).map(month=>[month,{month,incomeMinor:0,spendingMinor:0,netMinor:0}]));
  let incomeMinor=0,spendingMinor=0;
  for(const transaction of transactions){
    const month=monthMap.get(transaction.postedDate.slice(0,7));
    if(!month)throw new Error("Transaction date is outside the report calendar");
    if(transaction.amountMinor>=0){incomeMinor=add(incomeMinor,transaction.amountMinor);month.incomeMinor=add(month.incomeMinor,transaction.amountMinor);}
    else{
      const spent=-transaction.amountMinor;spendingMinor=add(spendingMinor,spent);month.spendingMinor=add(month.spendingMinor,spent);
      addGroup(payeeMap,transaction.payee,transaction.id,spent);
      const expenseSplits=transaction.splits?.filter(item=>item.amountMinor<0);
      if(expenseSplits?.length)for(const split of expenseSplits)addGroup(categoryMap,split.category,transaction.id,-split.amountMinor);
      else addGroup(categoryMap,transaction.category,transaction.id,spent);
    }
  }
  const netMinor=add(incomeMinor,-spendingMinor);
  for(const month of monthMap.values())month.netMinor=add(month.incomeMinor,-month.spendingMinor);
  return{fromDate:input.fromDate,toDate:input.toDate,incomeMinor,spendingMinor,netMinor,savingsRatePercent:incomeMinor?Math.round(netMinor*1000/incomeMinor)/10:null,transactionCount:transactions.length,categories:groups(categoryMap),payees:groups(payeeMap),months:[...monthMap.values()]};
}

export function reportRange(preset:Exclude<ReportPreset,"custom">,today:string):{fromDate:string;toDate:string}{
  const {year,month}=parseDate(today),monthStart=`${year}-${pad(month)}-01`;
  if(preset==="month")return{fromDate:monthStart,toDate:today};
  if(preset==="year")return{fromDate:`${year}-01-01`,toDate:today};
  const months=preset==="quarter"?2:11;
  return{fromDate:shiftMonth(monthStart,-months),toDate:today};
}

export function reportMonths(fromDate:string,toDate:string):string[]{
  const from=parseDate(fromDate),to=parseDate(toDate),months:string[]=[];
  let year=from.year,month=from.month;
  while(year<to.year||(year===to.year&&month<=to.month)){
    months.push(`${year}-${pad(month)}`);
    if(month===12){year++;month=1;}else month++;
    if(months.length>120)throw new Error("Reports cannot span more than 120 months");
  }
  return months;
}

function addGroup(map:Map<string,{label:string;amountMinor:number;items:Map<string,number>}>,label:string,transactionId:string,amountMinor:number){
  const clean=label.trim()||"Uncategorized",key=clean.toLocaleLowerCase(),current=map.get(key)??{label:clean,amountMinor:0,items:new Map<string,number>()};
  current.amountMinor=add(current.amountMinor,amountMinor);current.items.set(transactionId,add(current.items.get(transactionId)??0,amountMinor));map.set(key,current);
}

function groups(map:Map<string,{label:string;amountMinor:number;items:Map<string,number>}>):ReportGroup[]{
  return[...map].map(([key,item])=>({key,label:item.label,amountMinor:item.amountMinor,transactionCount:item.items.size,contributions:[...item.items].map(([transactionId,amountMinor])=>({transactionId,amountMinor}))})).sort((left,right)=>right.amountMinor-left.amountMinor||left.label.localeCompare(right.label));
}

function parseDate(value:string):{year:number;month:number;day:number}{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)throw new Error("Report dates must use YYYY-MM-DD");
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new Error("Report date is invalid");
  return{year,month,day};
}
function shiftMonth(value:string,offset:number):string{const {year,month}=parseDate(value),date=new Date(Date.UTC(year,month-1+offset,1));return`${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-01`;}
function pad(value:number){return String(value).padStart(2,"0");}
function add(...values:number[]):number{const result=values.reduce((total,value)=>total+value,0);if(!Number.isSafeInteger(result))throw new Error("Report total is too large");return result;}
