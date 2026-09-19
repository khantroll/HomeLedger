import type {RecurrenceFrequency,ScheduledTransaction,Transaction} from "./domain";

export interface SubscriptionCandidate{
  id:string;
  accountId:string;
  payee:string;
  category:string;
  amountMinor:number;
  frequency:Exclude<RecurrenceFrequency,"semimonthly"|"custom">;
  nextDueDate:string;
  occurrenceCount:number;
  medianIntervalDays:number;
  amountVariationMinor:number;
  confidence:"high"|"medium";
  transactionIds:string[];
}

const cadence=[
  {frequency:"weekly",days:7,tolerance:2},
  {frequency:"biweekly",days:14,tolerance:3},
  {frequency:"monthly",days:30,tolerance:5},
  {frequency:"annual",days:365,tolerance:16},
] as const;

export function detectSubscriptions(transactions:readonly Transaction[],templates:readonly ScheduledTransaction[],asOfDate:string):SubscriptionCandidate[]{
  const asOf=parseDate(asOfDate),groups=new Map<string,Transaction[]>();
  for(const transaction of transactions){
    if(transaction.amountMinor>=0||transaction.transferLinkId||transaction.source==="transfer"||transaction.source==="adjustment"||transaction.status==="review")continue;
    const date=parseDate(transaction.postedDate),age=daysBetween(date,asOf);
    if(age<0||age>1_100)continue;
    const payee=normalizePayee(transaction.payee);if(!payee)continue;
    const key=`${transaction.accountId}:${payee}`;groups.set(key,[...(groups.get(key)??[]),transaction]);
  }
  const existing=new Set(templates.filter(item=>item.kind==="transaction"&&!item.archived).map(item=>`${item.accountId}:${normalizePayee(item.payee)}`));
  const candidates:SubscriptionCandidate[]=[];
  for(const [id,items] of groups){
    if(existing.has(id)||items.length<3)continue;
    const sorted=[...items].sort((left,right)=>left.postedDate.localeCompare(right.postedDate)||left.id.localeCompare(right.id));
    const gaps=sorted.slice(1).map((item,index)=>daysBetween(parseDate(sorted[index].postedDate),parseDate(item.postedDate))).filter(value=>value>0);
    if(gaps.length<2)continue;
    const inferred=cadence.map(item=>({...item,matches:gaps.filter(gap=>Math.abs(gap-item.days)<=item.tolerance).length})).sort((left,right)=>right.matches-left.matches||Math.abs(median(gaps)-left.days)-Math.abs(median(gaps)-right.days))[0];
    const consistency=inferred.matches/gaps.length;if(consistency<0.75)continue;
    const amounts=sorted.map(item=>Math.abs(item.amountMinor)),expected=median(amounts),variation=Math.max(...amounts.map(value=>Math.abs(value-expected)));
    if(variation>Math.max(100,Math.round(expected*0.1)))continue;
    const latest=sorted.at(-1)!;if(daysBetween(parseDate(latest.postedDate),asOf)>inferred.days*2)continue;
    const frequency=inferred.frequency,nextDueDate=nextDue(latest.postedDate,frequency,asOfDate);
    candidates.push({id,accountId:latest.accountId,payee:latest.payee,category:mode(sorted.map(item=>item.category))||"Uncategorized",amountMinor:-expected,frequency,nextDueDate,occurrenceCount:sorted.length,medianIntervalDays:median(gaps),amountVariationMinor:variation,confidence:consistency===1&&variation<=Math.max(100,Math.round(expected*0.02))?"high":"medium",transactionIds:sorted.map(item=>item.id)});
  }
  return candidates.sort((left,right)=>left.nextDueDate.localeCompare(right.nextDueDate)||left.payee.localeCompare(right.payee));
}

export function normalizePayee(value:string):string{return value.toLowerCase().replace(/\d+/g," ").replace(/[^\p{L}]+/gu," ").trim().replace(/\s+/g," ");}

function nextDue(latest:string,frequency:SubscriptionCandidate["frequency"],asOf:string):string{let next=latest;do{next=frequency==="weekly"?shiftDays(next,7):frequency==="biweekly"?shiftDays(next,14):frequency==="monthly"?shiftMonths(next,1):shiftMonths(next,12);}while(next<=asOf);return next;}
function shiftDays(value:string,count:number):string{const date=parseDate(value);date.setUTCDate(date.getUTCDate()+count);return iso(date);}
function shiftMonths(value:string,count:number):string{const date=parseDate(value),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+count);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return iso(date);}
function parseDate(value:string):Date{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("Subscription dates must use YYYY-MM-DD");const date=new Date(`${value}T00:00:00Z`);if(Number.isNaN(date.valueOf())||iso(date)!==value)throw new Error("Subscription date is invalid");return date;}
function iso(value:Date):string{return value.toISOString().slice(0,10);}
function daysBetween(left:Date,right:Date):number{return Math.round((right.valueOf()-left.valueOf())/86_400_000);}
function median(values:number[]):number{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:Math.round((sorted[middle-1]+sorted[middle])/2);}
function mode(values:string[]):string{return[...new Set(values)].sort((left,right)=>values.filter(value=>value===right).length-values.filter(value=>value===left).length||left.localeCompare(right))[0]??"";}
