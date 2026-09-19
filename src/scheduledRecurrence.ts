import type { ScheduledTransaction } from "./domain";

type Recurrence = Pick<ScheduledTransaction, "frequency"|"anchorDate"|"endDate"|"secondMonthDay"|"customIntervalCount"|"customIntervalUnit">;

const DAY_MS=86_400_000;
const MAX_OCCURRENCES=10_000;

export function generateRecurrenceDates(recurrence:Recurrence,fromDate:string,toDate:string):string[]{
  const anchor=parseDate(recurrence.anchorDate),from=parseDate(fromDate),requestedEnd=parseDate(toDate);
  const configuredEnd=recurrence.endDate?parseDate(recurrence.endDate):requestedEnd;
  const end=configuredEnd.time<requestedEnd.time?configuredEnd:requestedEnd;
  if(from.time>end.time||anchor.time>end.time)return[];
  const dates=recurrence.frequency==="semimonthly"
    ?generateSemimonthly(recurrence,anchor,from,end)
    :recurrence.frequency==="monthly"
      ?generateMonthly(anchor,from,end,1)
      :recurrence.frequency==="annual"
        ?generateAnnual(anchor,from,end,1)
        :recurrence.frequency==="custom"
          ?generateCustom(recurrence,anchor,from,end)
          :generateByDays(anchor,from,end,recurrence.frequency==="biweekly"?14:7);
  if(dates.length>MAX_OCCURRENCES)throw new Error(`A recurrence window cannot exceed ${MAX_OCCURRENCES} occurrences`);
  return dates;
}

function generateCustom(recurrence:Recurrence,anchor:DateParts,from:DateParts,end:DateParts):string[]{
  const count=recurrence.customIntervalCount;
  const unit=recurrence.customIntervalUnit;
  if(!Number.isInteger(count)||!count||count<1)throw new Error("Custom recurrence interval must be a positive whole number");
  if(unit==="days")return generateByDays(anchor,from,end,count);
  if(unit==="weeks")return generateByDays(anchor,from,end,count*7);
  if(unit==="months")return generateMonthly(anchor,from,end,count);
  if(unit==="years")return generateAnnual(anchor,from,end,count);
  throw new Error("Custom recurrence unit is required");
}

function generateByDays(anchor:DateParts,from:DateParts,end:DateParts,stepDays:number):string[]{
  const firstStep=Math.max(0,Math.ceil((from.time-anchor.time)/(stepDays*DAY_MS)));
  const result:string[]=[];
  for(let step=firstStep;;step++){
    const time=anchor.time+step*stepDays*DAY_MS;
    if(time>end.time)break;
    result.push(formatDate(new Date(time)));
    if(result.length>MAX_OCCURRENCES)break;
  }
  return result;
}

function generateMonthly(anchor:DateParts,from:DateParts,end:DateParts,interval:number):string[]{
  const firstMonth=Math.max(0,Math.floor(monthDifference(anchor,from)/interval)-1);
  const result:string[]=[];
  for(let step=firstMonth;;step++){
    const date=clampedMonthDate(anchor.year,anchor.month+step*interval,anchor.day);
    if(date.time>end.time)break;
    if(date.time>=anchor.time&&date.time>=from.time)result.push(formatDate(new Date(date.time)));
  }
  return result;
}

function generateAnnual(anchor:DateParts,from:DateParts,end:DateParts,interval:number):string[]{
  const firstYear=Math.max(0,Math.floor((from.year-anchor.year)/interval)-1);
  const result:string[]=[];
  for(let step=firstYear;;step++){
    const date=clampedMonthDate(anchor.year+step*interval,anchor.month,anchor.day);
    if(date.time>end.time)break;
    if(date.time>=anchor.time&&date.time>=from.time)result.push(formatDate(new Date(date.time)));
  }
  return result;
}

function generateSemimonthly(recurrence:Recurrence,anchor:DateParts,from:DateParts,end:DateParts):string[]{
  const second=recurrence.secondMonthDay;
  if(!Number.isInteger(second)||!second||second<1||second>31)throw new Error("Semimonthly recurrence requires a second month day from 1 to 31");
  const firstMonth=Math.max(0,monthDifference(anchor,from)-1);
  const unique=new Set<string>();
  for(let offset=firstMonth;;offset++){
    const monthStart=clampedMonthDate(anchor.year,anchor.month+offset,1);
    if(monthStart.time>end.time)break;
    for(const intendedDay of [anchor.day,second]){
      const date=clampedMonthDate(anchor.year,anchor.month+offset,intendedDay);
      if(date.time>=anchor.time&&date.time>=from.time&&date.time<=end.time)unique.add(formatDate(new Date(date.time)));
    }
  }
  return [...unique].sort();
}

interface DateParts{year:number;month:number;day:number;time:number}

function parseDate(value:string):DateParts{
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)throw new Error("Dates must use YYYY-MM-DD");
  const year=Number(match[1]),month=Number(match[2])-1,day=Number(match[3]);
  const time=Date.UTC(year,month,day),date=new Date(time);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month||date.getUTCDate()!==day)throw new Error(`Invalid date: ${value}`);
  return{year,month,day,time};
}

function clampedMonthDate(year:number,month:number,intendedDay:number):DateParts{
  const normalized=new Date(Date.UTC(year,month,1));
  const normalizedYear=normalized.getUTCFullYear(),normalizedMonth=normalized.getUTCMonth();
  const lastDay=new Date(Date.UTC(normalizedYear,normalizedMonth+1,0)).getUTCDate();
  const day=Math.min(intendedDay,lastDay);
  return{year:normalizedYear,month:normalizedMonth,day,time:Date.UTC(normalizedYear,normalizedMonth,day)};
}

function monthDifference(left:DateParts,right:DateParts):number{return(right.year-left.year)*12+right.month-left.month;}
function formatDate(date:Date):string{return`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;}
