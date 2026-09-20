import { parseStatementMoney } from "./csvImport";
import type { ImportTransactionRow } from "./domain";
import type { OfxStatement } from "./ofxImport";

interface Tag { name:string; value:string; }

export function isMt940Statement(text:string):boolean{return /(?:^|\r?\n):20:/.test(text)&&/(?:^|\r?\n):61:/.test(text);}

export function parseMt940(text:string):OfxStatement{
  const tags=parseTags(text.replace(/^\uFEFF/,""));
  if(!tags.some(tag=>tag.name==="20")||!tags.some(tag=>tag.name==="61"))throw new Error("This does not appear to be an MT940 statement");
  const accounts=[...new Set(tags.filter(tag=>tag.name==="25").map(tag=>tag.value.trim()).filter(Boolean))];
  if(accounts.length>1)throw new Error("An MT940 file containing multiple accounts must be imported one account at a time");
  const balances=tags.filter(tag=>/^(60|62)[FM]$/.test(tag.name)).map(tag=>parseBalance(tag));
  const currencies=[...new Set(balances.map(balance=>balance.currency))];
  if(!currencies.length)throw new Error("The MT940 statement is missing its account currency");
  if(currencies.length>1)throw new Error("The MT940 statement contains mixed currencies");
  const rows:ImportTransactionRow[]=[];
  for(let index=0;index<tags.length;index++){
    if(tags[index].name!=="61")continue;
    const detail=tags[index+1]?.name==="86"?tags[index+1].value:"";
    rows.push(parseTransaction(tags[index].value,detail,rows.length+1));
  }
  if(!rows.length)throw new Error("No transactions were found in this MT940 statement");
  const dates=rows.map(row=>row.postedDate).sort();
  const closing=[...balances].reverse().find(balance=>/^62[FM]$/.test(balance.tag));
  const account=accounts[0]??"";
  return{format:"MT940",accountIdMasked:account?`••••${account.replace(/\s/g,"").slice(-4)}`:"Not supplied",accountType:"bank",currency:currencies[0],dateStart:dates[0],dateEnd:dates.at(-1),ledgerBalanceMinor:closing?.amountMinor,rows};
}

function parseTags(text:string):Tag[]{
  const tags:Tag[]=[];
  for(const line of text.split(/\r?\n/)){
    if(line.trim()==="-")continue;
    const match=line.match(/^:([0-9]{2}[A-Z]?):(.*)$/);
    if(match)tags.push({name:match[1].toUpperCase(),value:match[2].trim()});
    else if(line.trim()&&tags.length)tags[tags.length-1].value+=` ${line.trim()}`;
  }
  return tags;
}

function parseBalance(tag:Tag){
  const match=tag.value.match(/^([CD])(\d{6})([A-Z]{3})([\d.,]+)$/i);
  if(!match)throw new Error(`Malformed MT940 :${tag.name}: balance`);
  const amount=Math.abs(parseMt940Amount(match[4]));
  return{tag:tag.name,currency:match[3].toUpperCase(),amountMinor:match[1].toUpperCase()==="D"?-amount:amount};
}

function parseTransaction(value:string,description:string,index:number):ImportTransactionRow{
  const match=value.match(/^(\d{6})(?:\d{4})?([RC]{0,2})([DC])(?:[A-Z])?([\d.,]+)([A-Z])([A-Z0-9]{3})(.*)$/i);
  if(!match)throw new Error(`Malformed MT940 :61: transaction ${index}`);
  const reversal=match[2].toUpperCase().includes("R"),debit=match[3].toUpperCase()==="D";
  const signed=(debit!==reversal?-1:1)*Math.abs(parseMt940Amount(match[4]));
  const remainder=match[7].trim(),reference=remainder.match(/\/\/([^\s]+)/)?.[1]?.trim();
  const detail=cleanDescription(description),fallback=remainder.split("//")[0].trim();
  return{postedDate:parseShortDate(match[1]),payee:detail||fallback||`${match[6].toUpperCase()} transaction`,amountMinor:signed,memo:detail&&fallback&&detail!==fallback?fallback:undefined,externalId:cleanExternalId(reference)};
}

function parseMt940Amount(value:string):number{
  const normalized=value.replace(/[\s'’]/g,"").replace(/,(?=\d{1,2}$)/,".");
  if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))throw new Error(`Unsupported MT940 amount: ${value}`);
  return parseStatementMoney(normalized);
}

function parseShortDate(value:string):string{
  const year=Number(value.slice(0,2))+(Number(value.slice(0,2))>=70?1900:2000),month=Number(value.slice(2,4)),day=Number(value.slice(4,6));
  const candidate=new Date(Date.UTC(year,month-1,day));
  if(candidate.getUTCFullYear()!==year||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==day)throw new Error(`Invalid MT940 date: ${value}`);
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function cleanDescription(value:string):string{return value.replace(/\?\d{2}/g," ").replace(/\s+/g," ").trim();}
function cleanExternalId(value?:string):string|undefined{const cleaned=value?.trim();return cleaned?cleaned.slice(0,255):undefined;}
