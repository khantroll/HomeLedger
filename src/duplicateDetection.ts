import type { ImportTransactionRow, Transaction } from "./domain";

export type DuplicateConfidence = "exact" | "probable" | "possible";

export interface DuplicateMatch {
  confidence: DuplicateConfidence;
  reason: string;
  existingTransactionId?: string;
}

export interface DuplicateCandidate extends ImportTransactionRow {
  sourceRow: number;
  error?: string;
}

export function classifyDuplicates<T extends DuplicateCandidate>(rows:T[],existing:Transaction[]):Array<T&{duplicate?:DuplicateMatch}>{
  const prior: Array<Pick<Transaction,"id"|"postedDate"|"payee"|"originalPayee"|"amountMinor"|"externalId">> = [...existing];
  return rows.map(row=>{
    if(row.error)return row;
    const duplicate=bestMatch(row,prior);
    prior.push({id:`source-${row.sourceRow}`,postedDate:row.postedDate,payee:row.payee,originalPayee:row.originalPayee,amountMinor:row.amountMinor,externalId:row.externalId});
    return duplicate?{...row,duplicate}:row;
  });
}

function bestMatch(row:ImportTransactionRow,candidates:Array<Pick<Transaction,"id"|"postedDate"|"payee"|"originalPayee"|"amountMinor"|"externalId">>):DuplicateMatch|undefined{
  let best:DuplicateMatch|undefined;
  for(const candidate of candidates){
    const match=compare(row,candidate);
    if(!match)continue;
    if(!best||rank(match.confidence)>rank(best.confidence))best={...match,existingTransactionId:candidate.id.startsWith("source-")?undefined:candidate.id};
    if(best.confidence==="exact")break;
  }
  return best;
}

function compare(row:ImportTransactionRow,candidate:Pick<Transaction,"postedDate"|"payee"|"originalPayee"|"amountMinor"|"externalId">):Omit<DuplicateMatch,"existingTransactionId">|undefined{
  if(row.externalId&&candidate.externalId&&row.externalId===candidate.externalId)return{confidence:"exact",reason:"Same provider transaction ID"};
  if(row.amountMinor!==candidate.amountMinor)return undefined;
  const days=Math.abs(dayNumber(row.postedDate)-dayNumber(candidate.postedDate));
  if(days>3)return undefined;
  const left=normalizeDescription(row.originalPayee??row.payee),right=normalizeDescription(candidate.originalPayee??candidate.payee);
  if(days===0&&left===right)return{confidence:"exact",reason:"Same date, amount, and normalized description"};
  if(days===0)return{confidence:"probable",reason:"Same date and amount"};
  if(days<=1&&descriptionSimilarity(left,right)>=0.6)return{confidence:"probable",reason:"Same amount, nearby date, and similar description"};
  return{confidence:"possible",reason:`Same amount within ${days} day${days===1?"":"s"}`};
}

export function normalizeDescription(value:string):string{return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();}

function descriptionSimilarity(left:string,right:string):number{
  if(left===right)return 1;
  const a=new Set(left.split(" ").filter(Boolean)),b=new Set(right.split(" ").filter(Boolean));
  if(!a.size||!b.size)return 0;
  let shared=0;for(const token of a)if(b.has(token))shared++;
  return shared/new Set([...a,...b]).size;
}

function dayNumber(value:string):number{return Math.floor(Date.parse(`${value}T00:00:00Z`)/86_400_000);}
function rank(value:DuplicateConfidence):number{return value==="exact"?3:value==="probable"?2:1;}
