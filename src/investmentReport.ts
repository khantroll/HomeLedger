import type {Account,HoldingSnapshot,InvestmentEventRevision,PortfolioSnapshot,Security} from "./domain";

export interface InvestmentHoldingReportRow{
 accountId:string;accountName:string;securityId:string;securityName:string;symbol?:string;currency:string;quantityE8:number;
 priceE8?:number;priceObservedAt?:string;marketValueMinor?:number;knownBasisMinor:number;unknownBasisQuantityE8:number;unrealizedGainMinor?:number;basisPartial:boolean;
 realizedKnownBasisMinor:number;realizedProceedsMinor:number;realizedGainMinor:number;realizedUnknownBasisQuantityE8:number;realizedUnknownBasisProceedsMinor:number;realizedPartial:boolean;
}
export interface InvestmentIncomeReport{dividendMinor:number;interestMinor:number;returnOfCapitalMinor:number;feesMinor:number;reinvestedDividendMinor:number;}
export interface InvestmentReport{
 asOfDate:string;currency:string;rows:InvestmentHoldingReportRow[];income:InvestmentIncomeReport;
 marketValueKnownMinor:number;knownBasisMinor:number;unrealizedGainKnownMinor:number;unrealizedIncomplete:boolean;
 realizedKnownBasisMinor:number;realizedProceedsMinor:number;realizedGainMinor:number;realizedUnknownBasisProceedsMinor:number;realizedIncomplete:boolean;
}
export function calculateInvestmentReport(input:{snapshot:PortfolioSnapshot;events:readonly InvestmentEventRevision[];accounts:readonly Account[];securities:readonly Security[];currency:string}):InvestmentReport{
 const accountMap=new Map(input.accounts.map(a=>[a.id,a])),securityMap=new Map(input.securities.map(s=>[s.id,s]));
 const rows:InvestmentHoldingReportRow[]=[];let market=0,basis=0,unrealized=0,unrealizedIncomplete=false,realizedBasis=0,realizedProceeds=0,realizedGain=0,unknownProceeds=0,realizedIncomplete=false;
 for(const accountSnapshot of input.snapshot.accounts){
  const account=accountMap.get(accountSnapshot.accountId);if(!account||account.archived||account.type!=="investment"||account.currency!==input.currency)continue;
  for(const h of accountSnapshot.holdings){const security=securityMap.get(h.securityId);const basisPartial=h.incompleteUnknownBasis||h.unknownBasisQuantityE8>0,realizedPartial=h.realized.incompleteUnknownBasis||h.realized.unknownBasisQuantityE8>0;
   rows.push(row(account,h,security));basis=add(basis,h.knownBasisMinor);if(h.marketValueMinor===undefined)unrealizedIncomplete=true;else market=add(market,h.marketValueMinor);if(h.unrealizedGainMinor===undefined||basisPartial)unrealizedIncomplete=true;else unrealized=add(unrealized,h.unrealizedGainMinor);
   realizedBasis=add(realizedBasis,h.realized.knownDisposedBasisMinor);realizedProceeds=add(realizedProceeds,h.realized.calculableProceedsMinor);realizedGain=add(realizedGain,h.realized.calculableGainMinor);unknownProceeds=add(unknownProceeds,h.realized.unknownBasisProceedsMinor);if(realizedPartial)realizedIncomplete=true;
  }
 }
 const income:InvestmentIncomeReport={dividendMinor:0,interestMinor:0,returnOfCapitalMinor:0,feesMinor:0,reinvestedDividendMinor:0};
 const eligible=new Set(input.accounts.filter(a=>!a.archived&&a.type==="investment"&&a.currency===input.currency).map(a=>a.id));
 for(const e of input.events){if(!eligible.has(e.accountId))continue;const incomeAmount=Math.abs(e.incomeMinor);if(e.eventType==="dividend")income.dividendMinor=add(income.dividendMinor,incomeAmount);else if(e.eventType==="reinvest_dividend"){income.dividendMinor=add(income.dividendMinor,incomeAmount);income.reinvestedDividendMinor=add(income.reinvestedDividendMinor,incomeAmount);}else if(e.eventType==="interest")income.interestMinor=add(income.interestMinor,incomeAmount);else if(e.eventType==="return_of_capital")income.returnOfCapitalMinor=add(income.returnOfCapitalMinor,Math.abs(e.cashEffectMinor||e.grossCashMinor||0));if(e.feeMinor)income.feesMinor=add(income.feesMinor,Math.abs(e.feeMinor));}
 return{asOfDate:input.snapshot.asOfDate,currency:input.currency,rows:rows.sort((a,b)=>a.accountName.localeCompare(b.accountName)||a.securityName.localeCompare(b.securityName)),income,marketValueKnownMinor:market,knownBasisMinor:basis,unrealizedGainKnownMinor:unrealized,unrealizedIncomplete,realizedKnownBasisMinor:realizedBasis,realizedProceedsMinor:realizedProceeds,realizedGainMinor:realizedGain,realizedUnknownBasisProceedsMinor:unknownProceeds,realizedIncomplete};
}
function row(account:Account,h:HoldingSnapshot,security?:Security):InvestmentHoldingReportRow{return{accountId:account.id,accountName:account.name,securityId:h.securityId,securityName:security?.name??"Unknown security",symbol:security?.symbol,currency:account.currency,quantityE8:h.quantityE8,priceE8:h.priceE8,priceObservedAt:h.priceObservedAt,marketValueMinor:h.marketValueMinor,knownBasisMinor:h.knownBasisMinor,unknownBasisQuantityE8:h.unknownBasisQuantityE8,unrealizedGainMinor:h.unrealizedGainMinor,basisPartial:h.incompleteUnknownBasis||h.unknownBasisQuantityE8>0,realizedKnownBasisMinor:h.realized.knownDisposedBasisMinor,realizedProceedsMinor:h.realized.calculableProceedsMinor,realizedGainMinor:h.realized.calculableGainMinor,realizedUnknownBasisQuantityE8:h.realized.unknownBasisQuantityE8,realizedUnknownBasisProceedsMinor:h.realized.unknownBasisProceedsMinor,realizedPartial:h.realized.incompleteUnknownBasis||h.realized.unknownBasisQuantityE8>0};}
function add(a:number,b:number){const n=a+b;if(!Number.isSafeInteger(n))throw new Error("Investment report total is too large");return n;}
