import {normalizeDescription} from "./duplicateDetection";
import type {ImportTransactionRow,ScheduledMatchCandidate,ScheduledOccurrence,ScheduledTransaction} from "./domain";

export const SCHEDULED_MATCHING={maximumDateDifferenceDays:7,maximumAmountRatio:0.35,minimumMerchantSimilarity:0.45,minimumScore:50} as const;

export function findScheduledMatches(row:ImportTransactionRow,accountId:string,templates:ScheduledTransaction[],occurrences:ScheduledOccurrence[]):ScheduledMatchCandidate[]{
  const candidates:ScheduledMatchCandidate[]=[];
  for(const occurrence of occurrences){
    if(occurrence.status!=="expected"||occurrence.transactionId)continue;
    const template=templates.find(item=>item.id===occurrence.scheduledTransactionId);
    if(!template||template.archived||!template.enabled||template.kind!=="transaction"||template.accountId!==accountId)continue;
    const candidate=compareScheduled(row,template,occurrence);
    if(candidate)candidates.push(candidate);
  }
  return candidates.sort((left,right)=>right.score-left.score||left.dateDifferenceDays-right.dateDifferenceDays||left.occurrenceId.localeCompare(right.occurrenceId)).slice(0,3);
}

function compareScheduled(row:ImportTransactionRow,template:ScheduledTransaction,occurrence:ScheduledOccurrence):ScheduledMatchCandidate|undefined{
  if(Math.sign(row.amountMinor)!==Math.sign(template.amountMinor))return undefined;
  const dateDifferenceDays=Math.abs(dayNumber(row.postedDate)-dayNumber(occurrence.dueDate));
  if(dateDifferenceDays>SCHEDULED_MATCHING.maximumDateDifferenceDays)return undefined;
  const amountDifferenceMinor=Math.abs(row.amountMinor-template.amountMinor),expected=Math.abs(template.amountMinor);
  const amountRatio=expected?amountDifferenceMinor/expected:Number.POSITIVE_INFINITY;
  if(amountDifferenceMinor>500&&amountRatio>SCHEDULED_MATCHING.maximumAmountRatio)return undefined;
  const merchantSimilarity=Math.max(descriptionSimilarity(row.payee,template.payee),descriptionSimilarity(row.originalPayee??row.payee,template.payee));
  if(merchantSimilarity<SCHEDULED_MATCHING.minimumMerchantSimilarity)return undefined;

  const merchantScore=merchantSimilarity===1?50:merchantSimilarity>=0.7?40:30;
  const dateScore=dateDifferenceDays===0?25:dateDifferenceDays<=2?20:dateDifferenceDays<=4?12:5;
  const amountScore=amountDifferenceMinor===0?25:amountRatio<=0.05?20:amountRatio<=0.15?14:7;
  const score=merchantScore+dateScore+amountScore;
  if(score<SCHEDULED_MATCHING.minimumScore)return undefined;
  const confidence=merchantSimilarity===1&&dateDifferenceDays===0&&amountDifferenceMinor===0?"exact":score>=70?"probable":"possible";
  const reasons=[merchantSimilarity===1?"Same normalized merchant":`Similar merchant (${Math.round(merchantSimilarity*100)}%)`,dateDifferenceDays===0?"Same date":`${dateDifferenceDays} day${dateDifferenceDays===1?"":"s"} from due date`,amountDifferenceMinor===0?"Same amount":`${formatMinor(amountDifferenceMinor)} amount difference`];
  return{occurrenceId:occurrence.id,scheduledTransactionId:template.id,payee:template.payee,dueDate:occurrence.dueDate,amountMinor:template.amountMinor,confidence,score,reasons,dateDifferenceDays,amountDifferenceMinor};
}

function descriptionSimilarity(leftValue:string,rightValue:string):number{
  const left=normalizeDescription(leftValue),right=normalizeDescription(rightValue);
  if(left===right&&left)return 1;
  if(!left||!right)return 0;
  if((left.includes(right)||right.includes(left))&&Math.min(left.length,right.length)>=4)return 0.85;
  const a=new Set(left.split(" ").filter(Boolean)),b=new Set(right.split(" ").filter(Boolean));
  let shared=0;for(const token of a)if(b.has(token))shared++;
  return shared/new Set([...a,...b]).size;
}

function dayNumber(value:string):number{return Math.floor(Date.parse(`${value}T00:00:00Z`)/86_400_000);}
function formatMinor(value:number):string{return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value/100);}
