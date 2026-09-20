import { parseStatementMoney } from "./csvImport";
import type { ImportTransactionRow } from "./domain";
import type { OfxStatement } from "./ofxImport";

export function isCamtStatement(text:string):boolean{return /<(?:(?:\w+):)?Document\b/i.test(text)&&/camt\.05[234]/i.test(text);}

export function parseCamt(text:string):OfxStatement{
  const content=text.replace(/^\uFEFF/,"");
  if(!isCamtStatement(content))throw new Error("This does not appear to be a CAMT.052, CAMT.053, or CAMT.054 statement");
  if(/<!DOCTYPE|<!ENTITY/i.test(content))throw new Error("CAMT files containing document types or entities are not supported");
  const document=new DOMParser().parseFromString(content,"application/xml");
  if(document.getElementsByTagName("parsererror").length)throw new Error("The CAMT XML is malformed");
  const containers=all(document,"Stmt").concat(all(document,"Ntfctn"),all(document,"Rpt"));
  if(containers.length!==1)throw new Error("A CAMT file must contain exactly one account report, statement, or notification");
  const container=containers[0],account=first(container,"Acct"),accountId=textAt(account,"IBAN")||textAt(first(account,"Othr"),"Id")||"";
  const entries=all(container,"Ntry");
  if(!entries.length)throw new Error("No transactions were found in this CAMT statement");
  const rows:ImportTransactionRow[]=[],currencies=new Set<string>();
  const accountCurrency=textAt(account,"Ccy").toUpperCase();if(accountCurrency)currencies.add(accountCurrency);
  for(const [index,entry] of entries.entries()){
    const details=all(first(entry,"NtryDtls"),"TxDtls");
    if(details.length>1)throw new Error(`CAMT entry ${index+1} aggregates multiple transactions and cannot be imported safely`);
    const amountElement=first(entry,"Amt");
    if(!amountElement)throw new Error(`CAMT entry ${index+1} is missing its amount`);
    const currency=(amountElement.getAttribute("Ccy")||accountCurrency).toUpperCase();
    if(!currency)throw new Error(`CAMT entry ${index+1} is missing its currency`);currencies.add(currency);
    const direction=textAt(entry,"CdtDbtInd").toUpperCase();
    if(direction!=="CRDT"&&direction!=="DBIT")throw new Error(`CAMT entry ${index+1} has an unsupported credit/debit indicator`);
    const dateNode=first(entry,"BookgDt"),rawDate=textAt(dateNode,"Dt")||textAt(dateNode,"DtTm").slice(0,10);
    if(!rawDate)throw new Error(`CAMT entry ${index+1} is missing its booking date`);
    const detail=details[0],payee=counterpartyName(detail,direction)||textAt(first(detail,"RmtInf"),"Ustrd")||textAt(entry,"AddtlNtryInf")||textAt(detail,"AddtlTxInf")||"CAMT transaction";
    const memo=[textAt(first(detail,"RmtInf"),"Ustrd"),textAt(detail,"AddtlTxInf"),textAt(entry,"AddtlNtryInf")].find(value=>value&&value!==payee);
    const externalId=[textAt(entry,"AcctSvcrRef"),textAt(entry,"NtryRef"),textAt(detail,"TxId"),textAt(detail,"EndToEndId")].find(value=>value&&!/^NOTPROVIDED$/i.test(value));
    const amount=Math.abs(parseStatementMoney(amountElement.textContent?.trim()||""));
    rows.push({postedDate:parseIsoDate(rawDate,index+1),payee:clean(payee),amountMinor:direction==="DBIT"?-amount:amount,memo:memo?clean(memo):undefined,externalId:externalId?.slice(0,255)});
  }
  if(currencies.size!==1)throw new Error("The CAMT statement contains mixed or ambiguous currencies");
  const dates=rows.map(row=>row.postedDate).sort(),closing=all(container,"Bal").map(parseBalance).filter(Boolean).reverse().find(balance=>balance!.code==="CLBD"||balance!.code==="ITBD");
  return{format:"CAMT",accountIdMasked:accountId?`••••${accountId.replace(/\s/g,"").slice(-4)}`:"Not supplied",accountType:"bank",currency:[...currencies][0],dateStart:dates[0],dateEnd:dates.at(-1),ledgerBalanceMinor:closing?.amountMinor,rows};
}

function parseBalance(element:Element){
  const code=textAt(first(first(element,"Tp"),"CdOrPrtry"),"Cd").toUpperCase(),amount=first(element,"Amt"),direction=textAt(element,"CdtDbtInd").toUpperCase();
  if(!code||!amount||!amount.textContent)return undefined;
  const minor=Math.abs(parseStatementMoney(amount.textContent.trim()));return{code,amountMinor:direction==="DBIT"?-minor:minor};
}
function counterpartyName(detail:Element|undefined,direction:string):string{
  const parties=first(detail,"RltdPties");return direction==="DBIT"?textAt(first(parties,"Cdtr"),"Nm"):textAt(first(parties,"Dbtr"),"Nm");
}
function all(root:Document|Element|undefined,name:string):Element[]{return root?[...root.getElementsByTagName("*")].filter(element=>element.localName===name):[];}
function first(root:Document|Element|undefined,name:string):Element|undefined{return all(root,name)[0];}
function textAt(root:Document|Element|undefined,name:string):string{return clean(first(root,name)?.textContent||"");}
function clean(value:string):string{return value.replace(/\s+/g," ").trim();}
function parseIsoDate(value:string,index:number):string{const match=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)throw new Error(`CAMT entry ${index} has an unsupported booking date`);const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new Error(`CAMT entry ${index} has an invalid booking date`);return value;}
