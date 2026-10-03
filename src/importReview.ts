import type {Account,Transaction} from "./domain";
import type {PreviewRow} from "./csvImport";
import {normalizeMerchant} from "./merchantRules";

export interface ImportReviewEdit {
  payee?: string;
  category?: string;
  transferAccountId?: string;
}

export function applyImportReviewEdits(rows:PreviewRow[],edits:ReadonlyMap<number,ImportReviewEdit>):PreviewRow[]{
  return rows.map(row=>{
    const edit=edits.get(row.sourceRow);
    if(!edit)return row;
    const originalPayee=row.originalPayee??row.payee;
    const hasPayee=Object.prototype.hasOwnProperty.call(edit,"payee");
    const payee=hasPayee?(edit.payee??""):row.payee;
    const category=edit.transferAccountId
      ? row.category
      : Object.prototype.hasOwnProperty.call(edit,"category")
        ? (edit.category??"")
        : row.category;
    const transferAccountId=Object.prototype.hasOwnProperty.call(edit,"transferAccountId")?edit.transferAccountId:row.transferAccountId;
    return{...row,originalPayee,payee,category,transferAccountId};
  });
}

function accountTokens(account:Account):string[]{
  const stop=new Set(["account","card","credit","checking","savings","bank","the","my","household"]);
  return normalizeMerchant([account.name,account.institution??""].join(" ")).split(" ")
    .filter(token=>token.length>=4&&!stop.has(token));
}

export interface TransferAccountSuggestion { account:Account; reasons:string[]; }

function dateDistanceDays(left:string,right:string):number|undefined{
  const a=Date.parse(`${left}T00:00:00Z`),b=Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(a)&&Number.isFinite(b)?Math.abs(Math.round((a-b)/86_400_000)):undefined;
}

export function suggestTransferAccountWithEvidence(
  row:Pick<PreviewRow,"payee"|"originalPayee"|"amountMinor"|"postedDate">,
  sourceAccountId:string,
  accounts:Account[],
  history:Transaction[]=[]
):TransferAccountSuggestion|undefined{
  if(row.amountMinor===0)return undefined;
  const sourceAccount=accounts.find(account=>account.id===sourceAccountId);
  const text=normalizeMerchant(row.originalPayee??row.payee);
  const scored=accounts.filter(account=>
    account.id!==sourceAccountId&&!account.archived&&account.type!=="investment"&&
    (!sourceAccount||account.currency===sourceAccount.currency)
  ).map(account=>{
    const reasons:string[]=[];
    let score=0;
    if(accountTokens(account).some(token=>text.includes(token))){score+=2;reasons.push("description matches account identity");}
    const opposite=history.some(item=>{
      if(item.accountId!==account.id||item.amountMinor!==-row.amountMinor)return false;
      const days=dateDistanceDays(item.postedDate,row.postedDate);
      return days!==undefined&&days<=7;
    });
    if(opposite){score+=4;reasons.push("opposite amount found in that account within 7 days");}
    return{account,reasons,score};
  }).filter(candidate=>candidate.score>0).sort((a,b)=>b.score-a.score||a.account.id.localeCompare(b.account.id));
  if(!scored.length||(scored.length>1&&scored[0].score===scored[1].score))return undefined;
  return{account:scored[0].account,reasons:scored[0].reasons};
}

export function suggestTransferAccount(row:Pick<PreviewRow,"payee"|"originalPayee"|"amountMinor"|"postedDate">,sourceAccountId:string,accounts:Account[],history:Transaction[]=[]):Account|undefined{
  return suggestTransferAccountWithEvidence(row,sourceAccountId,accounts,history)?.account;
}

export interface CatalogPayeeSuggestion { payee:string; source:"catalog"; }

export function catalogPayeeSuggestion(row:Pick<PreviewRow,"payee"|"originalPayee">,knownPayees:string[]):CatalogPayeeSuggestion|undefined{
  const raw=normalizeMerchant(row.originalPayee??row.payee);
  if(!raw)return undefined;
  const candidates=knownPayees.map(payee=>({payee,norm:normalizeMerchant(payee)}))
    .filter(item=>item.norm.length>=4&&item.norm!==raw&&raw.startsWith(item.norm+" "));
  const unique=[...new Map(candidates.map(item=>[item.norm,item])).values()].sort((a,b)=>b.norm.length-a.norm.length);
  if(!unique.length||(unique.length>1&&unique[0].norm.length===unique[1].norm.length))return undefined;
  return{payee:unique[0].payee,source:"catalog"};
}

export function applyCatalogPayeeSuggestion(row:PreviewRow,suggestion:CatalogPayeeSuggestion|undefined):PreviewRow{
  if(!suggestion)return row;
  return{...row,originalPayee:row.originalPayee??row.payee,payee:suggestion.payee};
}

export function matchingReviewSourceRows(rows:PreviewRow[],sourceRow:number):number[]{
  const selected=rows.find(row=>row.sourceRow===sourceRow);
  if(!selected)return[];
  const key=normalizeMerchant(selected.originalPayee??selected.payee);
  return rows.filter(row=>normalizeMerchant(row.originalPayee??row.payee)===key).map(row=>row.sourceRow);
}

export function importBlockingReason(input:{unresolved:number;balanceMismatches:number;errors:number;currencyMismatch:boolean;ready:number}):string{
  if(input.unresolved>0)return `Import is disabled because ${input.unresolved} transaction candidate${input.unresolved===1?"":"s"} still need review.`;
  if(input.balanceMismatches>0)return `Import is disabled because ${input.balanceMismatches} running-balance continuity check${input.balanceMismatches===1?"":"s"} failed.`;
  if(input.errors>0)return `Import is disabled because ${input.errors} parsed row${input.errors===1?" has":"s have"} errors.`;
  if(input.currencyMismatch)return "Import is disabled because the statement currency does not match the selected account.";
  if(input.ready===0)return "There are no new approved transactions ready to import.";
  return "";
}


export interface HistoricalImportSuggestion {
  payee?: string;
  category?: string;
  source: "history";
}

export function historicalImportSuggestion(row:Pick<PreviewRow,"payee"|"originalPayee"|"category">,history:Transaction[]):HistoricalImportSuggestion|undefined{
  const key=normalizeMerchant(row.originalPayee??row.payee);
  if(!key)return undefined;
  const matches=history.filter(item=>normalizeMerchant(item.originalPayee??item.payee)===key);
  if(!matches.length)return undefined;
  const payees=[...new Set(matches.map(item=>item.payee.trim()).filter(Boolean))];
  const categories=[...new Set(matches.map(item=>item.category.trim()).filter(value=>value&&value!=="Uncategorized"&&!value.startsWith("Transfer:")))];
  const suggestion:HistoricalImportSuggestion={source:"history"};
  if(payees.length===1&&normalizeMerchant(payees[0])!==normalizeMerchant(row.payee))suggestion.payee=payees[0];
  if((!row.category||row.category==="Uncategorized")&&categories.length===1)suggestion.category=categories[0];
  return suggestion.payee||suggestion.category?suggestion:undefined;
}

export function applyHistoricalImportSuggestion(row:PreviewRow,suggestion:HistoricalImportSuggestion|undefined):PreviewRow{
  if(!suggestion)return row;
  const originalPayee=row.originalPayee??row.payee;
  return{
    ...row,
    originalPayee,
    payee:suggestion.payee??row.payee,
    category:suggestion.category??row.category
  };
}
