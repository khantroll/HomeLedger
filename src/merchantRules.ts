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

export function applyMerchantRules<T extends ImportTransactionRow>(rows:T[],rules:MerchantRule[]):RuleApplication<T>[] {
  const ordered=[...rules].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  return rows.map(source=>{
    const originalPayee=source.originalPayee??source.payee;
    const rule=ordered.find(item=>ruleMatches(item,originalPayee,source.amountMinor));
    if(!rule)return{row:{...source,originalPayee} as T};
    const hasSourceCategory=Boolean(source.splits?.length||(source.category&&source.category!=="Uncategorized"));
    return{rule,row:{...source,originalPayee,payee:rule.renameTo??source.payee,category:hasSourceCategory?source.category:rule.category??source.category} as T};
  });
}
