import type { ScheduledOccurrence, ScheduledTransaction } from "./domain";

export type OccurrenceDisplayState="overdue"|"due-soon"|"upcoming"|"posted"|"skipped"|"linked";

export function recurrenceDescription(template:ScheduledTransaction):string{
  const anchorDay=Number(template.anchorDate.slice(-2));
  let description:string;
  switch(template.frequency){
    case"weekly":description="Every week";break;
    case"biweekly":description="Every 2 weeks";break;
    case"semimonthly":description=`Twice monthly on the ${ordinal(anchorDay)} and ${monthDayLabel(template.secondMonthDay!)}`;break;
    case"monthly":description=`Monthly on the ${monthDayLabel(anchorDay)}`;break;
    case"annual":{
      const date=new Date(`${template.anchorDate}T00:00:00Z`);
      description=`Annually on ${new Intl.DateTimeFormat("en-US",{month:"long",day:"numeric",timeZone:"UTC"}).format(date)}`;
      break;
    }
    case"custom":{
      const count=template.customIntervalCount??1,unit=template.customIntervalUnit??"days";
      description=`Every ${count} ${count===1?unit.slice(0,-1):unit}`;
      break;
    }
  }
  return template.endDate?`${description} through ${formatDate(template.endDate)}`:description;
}

export function occurrenceDisplayState(occurrence:ScheduledOccurrence,today:string):OccurrenceDisplayState{
  if(occurrence.status!=="expected")return occurrence.status;
  if(occurrence.dueDate<today)return"overdue";
  return daysBetween(today,occurrence.dueDate)<=7?"due-soon":"upcoming";
}

export function occurrenceStateLabel(occurrence:ScheduledOccurrence,today:string):string{
  const state=occurrenceDisplayState(occurrence,today);
  if(state==="due-soon")return occurrence.dueDate===today?"Due today":"Due soon";
  return state[0].toUpperCase()+state.slice(1);
}

export function nextExpectedOccurrence(templateId:string,occurrences:readonly ScheduledOccurrence[]):ScheduledOccurrence|undefined{
  return occurrences.filter(item=>item.scheduledTransactionId===templateId&&item.status==="expected").sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0];
}

export function todayIso():string{return new Date().toISOString().slice(0,10);}
export function addDaysIso(date:string,days:number):string{const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
export function formatDate(value:string):string{return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));}

function monthDayLabel(day:number):string{return day===31?"last day":ordinal(day);}
function ordinal(value:number):string{const remainder=value%100;return`${value}${remainder>=11&&remainder<=13?"th":value%10===1?"st":value%10===2?"nd":value%10===3?"rd":"th"}`;}
function daysBetween(left:string,right:string):number{return Math.round((Date.parse(`${right}T00:00:00Z`)-Date.parse(`${left}T00:00:00Z`))/86_400_000);}
