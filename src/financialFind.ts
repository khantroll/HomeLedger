import type { Account, ScheduledTransaction, Security, Transaction } from "./domain";

export type FinancialFindResult =
  | { kind:"transaction"; id:string; title:string; detail:string; meta:string; accountId:string; transactionId:string; archived:boolean; score:number }
  | { kind:"schedule"; id:string; title:string; detail:string; meta:string; templateId:string; dueDate?:string; archived:boolean; score:number }
  | { kind:"account"; id:string; title:string; detail:string; meta:string; accountId:string; archived:boolean; score:number }
  | { kind:"security"; id:string; title:string; detail:string; meta:string; securityId:string; accountId?:string; archived:boolean; score:number };

export interface FinancialFindData {
  accounts: Account[];
  transactions: Transaction[];
  schedules: ScheduledTransaction[];
  securities: Security[];
  securityAccountIds?: ReadonlyMap<string,string>;
}

function textScore(value:string|undefined, query:string):number {
  if(!value)return 0;
  const v=value.toLocaleLowerCase(),q=query.toLocaleLowerCase();
  if(v===q)return 100;
  if(v.startsWith(q))return 70;
  if(v.includes(q))return 40;
  return 0;
}
function amountText(amountMinor:number){return (Math.abs(amountMinor)/100).toFixed(2);}
function best(...values:number[]){return Math.max(0,...values);}

export function financialFind(rawQuery:string,data:FinancialFindData):FinancialFindResult[] {
  const query=rawQuery.trim();
  if(!query)return [];
  const accountById=new Map(data.accounts.map(account=>[account.id,account]));
  const results:FinancialFindResult[]=[];

  for(const transaction of data.transactions){
    const account=accountById.get(transaction.accountId);
    const score=best(
      textScore(transaction.payee,query),
      textScore(transaction.originalPayee,query)-2,
      textScore(transaction.category,query)-4,
      textScore(transaction.memo,query)-6,
      textScore(account?.name,query)-8,
      textScore(amountText(transaction.amountMinor),query)-10,
      ...(transaction.splits??[]).flatMap(split=>[textScore(split.category,query)-5,textScore(split.memo,query)-7]),
    );
    if(score>0)results.push({kind:"transaction",id:`transaction:${transaction.id}`,title:transaction.payee,detail:`${transaction.category} · ${account?.name??"Unknown account"}`,meta:`${transaction.postedDate} · ${amountText(transaction.amountMinor)}`,accountId:transaction.accountId,transactionId:transaction.id,archived:Boolean(account?.archived),score});
  }

  for(const schedule of data.schedules){
    const account=accountById.get(schedule.accountId),destination=accountById.get(schedule.transferAccountId??"");
    const score=best(textScore(schedule.payee,query),textScore(schedule.category,query)-4,textScore(account?.name,query)-6,textScore(destination?.name,query)-7);
    if(score>0)results.push({kind:"schedule",id:`schedule:${schedule.id}`,title:schedule.payee,detail:schedule.kind==="transfer"?`${account?.name??"Unknown"} → ${destination?.name??"Unknown"}`:`${schedule.category} · ${account?.name??"Unknown account"}`,meta:schedule.archived?"Archived schedule":schedule.enabled?"Scheduled":"Paused schedule",templateId:schedule.id,dueDate:schedule.anchorDate,archived:Boolean(schedule.archived),score});
  }

  for(const account of data.accounts){
    const score=textScore(account.name,query);
    if(score>0)results.push({kind:"account",id:`account:${account.id}`,title:account.name,detail:account.institution??account.ownerLabel,meta:account.archived?"Archived account":account.type==="investment"?"Investment account":"Account",accountId:account.id,archived:Boolean(account.archived),score});
  }

  for(const security of data.securities){
    const score=best(textScore(security.name,query),textScore(security.symbol,query)+5);
    if(score>0)results.push({kind:"security",id:`security:${security.id}`,title:security.name,detail:security.symbol??security.securityType,meta:security.archived?"Inactive security":"Security",securityId:security.id,accountId:data.securityAccountIds?.get(security.id),archived:security.archived,score});
  }

  const kindOrder={transaction:0,schedule:1,account:2,security:3};
  return results.sort((a,b)=>b.score-a.score||kindOrder[a.kind]-kindOrder[b.kind]||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}

export function groupFinancialFindResults(results:FinancialFindResult[]){
  return [
    {kind:"transaction" as const,label:"Transactions",results:results.filter(r=>r.kind==="transaction")},
    {kind:"schedule" as const,label:"Bills & deposits",results:results.filter(r=>r.kind==="schedule")},
    {kind:"account" as const,label:"Accounts",results:results.filter(r=>r.kind==="account")},
    {kind:"security" as const,label:"Securities",results:results.filter(r=>r.kind==="security")},
  ].filter(group=>group.results.length>0);
}
