import type { ImportTransactionRow, MerchantRule } from "./domain";

export interface RuleApplication<T extends ImportTransactionRow> { row:T; rule?:MerchantRule; }

export function normalizeMerchant(value:string):string{
  let normalized="",spacing=false;
  for(const char of value.toLocaleLowerCase()){
    if(/[\p{L}\p{N}]/u.test(char)){normalized+=char;spacing=false;}
    else if(normalized&&!spacing){normalized+=" ";spacing=true;}
  }
  return normalized.trim();
}

export function ruleMatches(rule:MerchantRule,payee:string,amountMinor:number):boolean{
  if(!rule.enabled)return false;
  if(rule.direction==="expense"&&amountMinor>=0)return false;
  if(rule.direction==="income"&&amountMinor<=0)return false;
  const value=normalizeMerchant(payee),pattern=normalizeMerchant(rule.pattern);
  if(!pattern)return false;
  return rule.matchType==="exact"?value===pattern:rule.matchType==="starts_with"?value.startsWith(pattern):value.includes(pattern);
}

export function merchantRulePrecedenceCompare(a:MerchantRule,b:MerchantRule):number{
  const aRank=(a.origin??"manual")==="manual"?0:1;
  const bRank=(b.origin??"manual")==="manual"?0:1;
  return aRank-bRank||b.priority-a.priority||a.id.localeCompare(b.id);
}

export function applyMerchantRules<T extends ImportTransactionRow>(rows:T[],rules:MerchantRule[]):RuleApplication<T>[] {
  const ordered=[...rules].sort(merchantRulePrecedenceCompare);
  return rows.map(source=>{
    const originalPayee=source.originalPayee??source.payee;
    // originalPayee marks a row that has already entered the reviewed import pipeline.
    // Do not re-apply a weaker rule over an explicit review correction.
    if(source.originalPayee!==undefined)return{row:{...source,originalPayee} as T};
    const rule=ordered.find(item=>ruleMatches(item,originalPayee,source.amountMinor));
    if(!rule)return{row:{...source,originalPayee} as T};
    const hasSourceCategory=Boolean(source.splits?.length||(source.category&&source.category!=="Uncategorized"));
    return{rule,row:{...source,originalPayee,payee:rule.renameTo??source.payee,category:hasSourceCategory?source.category:rule.category??source.category} as T};
  });
}
