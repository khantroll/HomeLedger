import type {Account,FinanceRepository,Transaction,TransactionQuery} from "./domain";
import type {TransactionReport} from "./reportMath";
import type {InvestmentReport} from "./investmentReport";

const EXPORT_PAGE_SIZE=500;
const MAX_EXPORT_ROWS=100_000;

export async function loadAllRegisterTransactions(repository:Pick<FinanceRepository,"listTransactionsPage">,query:TransactionQuery):Promise<Transaction[]>{
  const rows:Transaction[]=[];
  let offset=0,totalCount:number|undefined;
  while(totalCount===undefined||offset<totalCount){
    const page=await repository.listTransactionsPage({...query,offset,limit:EXPORT_PAGE_SIZE,newest:false});
    if(page.offset!==offset)throw new Error("Register export pages were not contiguous");
    if(totalCount===undefined){totalCount=page.totalCount;if(totalCount>MAX_EXPORT_ROWS)throw new Error(`Register exports are limited to ${MAX_EXPORT_ROWS.toLocaleString()} rows`);}
    else if(page.totalCount!==totalCount)throw new Error("The register changed during export; please try again");
    if(page.transactions.length===0&&offset<totalCount)throw new Error("Register export ended before every matching row was loaded");
    rows.push(...page.transactions);
    offset+=page.transactions.length;
  }
  if(rows.length!==totalCount||new Set(rows.map(item=>item.id)).size!==rows.length)throw new Error("The register changed during export; please try again");
  return rows;
}

export function buildRegisterCsv(transactions:readonly Transaction[],accounts:readonly Account[]):string{
  const accountMap=new Map(accounts.map(item=>[item.id,item]));
  const headers=["Date","Account","Currency","Payee","Original Payee","Category","Amount","Status","Memo","Source","External ID","Import Batch ID","Transfer Account","Transaction ID","Split Details"];
  const rows=transactions.map(transaction=>{
    const account=accountMap.get(transaction.accountId),transfer=transaction.transferAccountId?accountMap.get(transaction.transferAccountId):undefined;
    const splits=transaction.splits?.map(item=>`${item.category}: ${minorToDecimal(item.amountMinor)}${item.memo?` (${item.memo})`:""}`).join(" | ")??"";
    return [transaction.postedDate,account?.name??"Missing account",account?.currency??"",transaction.payee,transaction.originalPayee??"",transaction.category,raw(minorToDecimal(transaction.amountMinor)),transaction.status,transaction.memo??"",transaction.source??"",transaction.externalId??"",transaction.importBatchId??"",transfer?.name??"",transaction.id,splits];
  });
  return withBom([headers,...rows].map(csvRow).join("\r
")+"\r
");
}

export function buildReportCsv(input:{report:TransactionReport;currency:string;accountLabel:string;fromDate:string;toDate:string}):string{
  const {report,currency,accountLabel,fromDate,toDate}=input;
  const rows:(string|RawCell)[][]=[
    ["HomeLedger report"],
    ["From",fromDate],["Through",toDate],["Currency",currency],["Account",accountLabel],[],
    ["Summary","Value"],
    ["Income",raw(minorToDecimal(report.incomeMinor))],["Spending",raw(minorToDecimal(report.spendingMinor))],["Net cash flow",raw(minorToDecimal(report.netMinor))],["Savings rate",report.savingsRatePercent===null?"":`${report.savingsRatePercent.toFixed(1)}%`],["Ledger entries",raw(String(report.transactionCount))],[],
    ["Monthly cash flow"],["Month","Income","Spending","Net"],
    ...report.months.map(item=>[item.month,raw(minorToDecimal(item.incomeMinor)),raw(minorToDecimal(item.spendingMinor)),raw(minorToDecimal(item.netMinor))]),[],
    ["Spending by category"],["Category","Amount","Transactions"],
    ...report.categories.map(item=>[item.label,raw(minorToDecimal(item.amountMinor)),raw(String(item.transactionCount))]),[],
    ["Spending by payee"],["Payee","Amount","Transactions"],
    ...report.payees.map(item=>[item.label,raw(minorToDecimal(item.amountMinor)),raw(String(item.transactionCount))]),
  ];
  return withBom(rows.map(csvRow).join("\r
")+"\r
");
}

export function buildInvestmentReportCsv(report:InvestmentReport):string{
 const rows:(string|RawCell)[][]=[["HomeLedger investment report"],["As of",report.asOfDate],["Currency",report.currency],[],["Holdings"],["Security","Account","Quantity","Price","Price observation","Market value","Known basis","Basis state","Unrealized gain/loss","Realized known basis","Realized proceeds","Realized gain/loss","Unknown-basis proceeds"],
 ...report.rows.map(item=>[item.symbol??item.securityName,item.accountName,raw(String(item.quantityE8/100000000)),item.priceE8===undefined?"":raw(String(item.priceE8/100000000)),item.priceObservedAt??"",item.marketValueMinor===undefined?"":raw(minorToDecimal(item.marketValueMinor)),raw(minorToDecimal(item.knownBasisMinor)),item.basisPartial?"Partial / Unknown":"Known",item.unrealizedGainMinor===undefined?"":raw(minorToDecimal(item.unrealizedGainMinor)),raw(minorToDecimal(item.realizedKnownBasisMinor)),raw(minorToDecimal(item.realizedProceedsMinor)),item.realizedPartial?"":raw(minorToDecimal(item.realizedGainMinor)),raw(minorToDecimal(item.realizedUnknownBasisProceedsMinor))]),[],
 ["Investment income"],["Dividends",raw(minorToDecimal(report.income.dividendMinor))],["Reinvested dividends (included above)",raw(minorToDecimal(report.income.reinvestedDividendMinor))],["Interest",raw(minorToDecimal(report.income.interestMinor))],["Return of capital (not income)",raw(minorToDecimal(report.income.returnOfCapitalMinor))],["Fees / commissions",raw(minorToDecimal(report.income.feesMinor))],[],
 ["Realized results through as-of"],["Known disposed basis",raw(minorToDecimal(report.realizedKnownBasisMinor))],["Calculable proceeds",raw(minorToDecimal(report.realizedProceedsMinor))],["Calculable gain/loss",report.realizedIncomplete?"":raw(minorToDecimal(report.realizedGainMinor))],["Unknown-basis proceeds",raw(minorToDecimal(report.realizedUnknownBasisProceedsMinor))]];
 return withBom(rows.map(csvRow).join("\r
")+"\r
");
}

export function exportFileName(prefix:string,fromDate?:string,toDate?:string):string{
  const safe=prefix.replace(/[^a-z0-9_-]+/gi,"-").replace(/^-+|-+$/g,"")||"HomeLedger";
  return `${safe}${fromDate?`-${fromDate}`:""}${toDate&&toDate!==fromDate?`-to-${toDate}`:""}.csv`;
}

interface RawCell{raw:string}
function raw(value:string):RawCell{return{raw:value};}
function minorToDecimal(value:number):string{const sign=value<0?"-":"",absolute=Math.abs(value);return`${sign}${Math.floor(absolute/100)}.${String(absolute%100).padStart(2,"0")}`;}
function csvRow(values:readonly (string|RawCell)[]):string{return values.map(value=>typeof value==="string"?csvText(value):value.raw).join(",");}
function csvText(value:string):string{const clean=value.replace(/\0/g,"");const protectedValue=/^[\s]*[=+\-@]/.test(clean)?`'${clean}`:clean;return`"${protectedValue.replace(/"/g,'""')}"`;}
function withBom(value:string):string{return`\uFEFF${value}`;}
