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
    const payee=edit.payee?.trim()||row.payee;
    const category=edit.transferAccountId
      ? row.category
      : Object.prototype.hasOwnProperty.call(edit,"category")
        ? (edit.category?.trim()||"Uncategorized")
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

export function suggestTransferAccount(row:Pick<PreviewRow,"payee"|"originalPayee"|"amountMinor">,sourceAccountId:string,accounts:Account[]):Account|undefined{
  if(row.amountMinor===0)return undefined;
  const text=normalizeMerchant(row.originalPayee??row.payee);
  const candidates=accounts.filter(account=>
    account.id!==sourceAccountId&&!account.archived&&account.type!=="investment"&&
    accountTokens(account).some(token=>text.includes(token))
  );
  return candidates.length===1?candidates[0]:undefined;
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
