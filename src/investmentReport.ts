import type {Account,HoldingSnapshot,InvestmentEventRevision,PortfolioSnapshot,Security} from "./domain";

export interface InvestmentHoldingReportRow{
  accountId:string;
  accountName:string;
  securityId:string;
  securityName:string;
  symbol?:string;
  currency:string;
  quantityE8:number;
  priceE8?:number;
  priceObservedAt?:string;
  marketValueMinor?:number;
  knownBasisMinor:number;
  unknownBasisQuantityE8:number;
  unrealizedGainMinor?:number;
  basisPartial:boolean;
  realizedKnownBasisMinor:number;
  realizedProceedsMinor:number;
  realizedGainMinor:number;
  realizedUnknownBasisQuantityE8:number;
  realizedUnknownBasisProceedsMinor:number;
  realizedPartial:boolean;
}

export interface InvestmentIncomeReport{
  dividendMinor:number;
  interestMinor:number;
  returnOfCapitalMinor:number;
  feesMinor:number;
  reinvestedDividendMinor:number;
}

export interface InvestmentReport{
  asOfDate:string;
  currency:string;
  rows:InvestmentHoldingReportRow[];
  income:InvestmentIncomeReport;
  cashMinor:number;
  marketValueKnownMinor:number;
  knownBasisMinor:number;
  unrealizedGainKnownMinor:number;
  unrealizedIncomplete:boolean;
  realizedKnownBasisMinor:number;
  realizedProceedsMinor:number;
  realizedGainMinor:number;
  realizedUnknownBasisProceedsMinor:number;
  realizedIncomplete:boolean;
}

export function calculateInvestmentReport(input:{
  snapshot:PortfolioSnapshot;
  events:readonly InvestmentEventRevision[];
  accounts:readonly Account[];
  securities:readonly Security[];
  currency:string;
}):InvestmentReport{
  const accountMap=new Map(input.accounts.map(a=>[a.id,a]));
  const securityMap=new Map(input.securities.map(s=>[s.id,s]));
  const rows:InvestmentHoldingReportRow[]=[];
  let cash=0,market=0,basis=0,unrealized=0,unrealizedIncomplete=false;
  let realizedBasis=0,realizedProceeds=0,realizedGain=0,unknownProceeds=0,realizedIncomplete=false;

  for(const accountSnapshot of input.snapshot.accounts){
    const account=accountMap.get(accountSnapshot.accountId);
    if(!account||account.archived||account.type!=="investment"||account.currency!==input.currency)continue;
    cash=add(cash,accountSnapshot.cashMinor);
    for(const holding of accountSnapshot.holdings){
      const security=securityMap.get(holding.securityId);
      const basisPartial=holding.incompleteUnknownBasis||holding.unknownBasisQuantityE8>0;
      const realizedPartial=holding.realized.incompleteUnknownBasis||holding.realized.unknownBasisQuantityE8>0;
      rows.push(row(account,holding,security));
      basis=add(basis,holding.knownBasisMinor);
      if(holding.marketValueMinor===undefined)unrealizedIncomplete=true;
      else market=add(market,holding.marketValueMinor);
      if(holding.unrealizedGainMinor===undefined)unrealizedIncomplete=true;
      else unrealized=add(unrealized,holding.unrealizedGainMinor);
      if(basisPartial)unrealizedIncomplete=true;
      realizedBasis=add(realizedBasis,holding.realized.knownDisposedBasisMinor);
      realizedProceeds=add(realizedProceeds,holding.realized.calculableProceedsMinor);
      realizedGain=add(realizedGain,holding.realized.calculableGainMinor);
      unknownProceeds=add(unknownProceeds,holding.realized.unknownBasisProceedsMinor);
      if(realizedPartial)realizedIncomplete=true;
    }
  }

  const income:InvestmentIncomeReport={dividendMinor:0,interestMinor:0,returnOfCapitalMinor:0,feesMinor:0,reinvestedDividendMinor:0};
  const eligible=new Set(input.accounts.filter(a=>!a.archived&&a.type==="investment"&&a.currency===input.currency).map(a=>a.id));
  for(const event of input.events){
    if(!eligible.has(event.accountId))continue;
    const incomeAmount=Math.abs(event.incomeMinor);
    if(event.eventType==="dividend")income.dividendMinor=add(income.dividendMinor,incomeAmount);
    else if(event.eventType==="reinvest_dividend"){
      income.dividendMinor=add(income.dividendMinor,incomeAmount);
      income.reinvestedDividendMinor=add(income.reinvestedDividendMinor,incomeAmount);
    }else if(event.eventType==="interest")income.interestMinor=add(income.interestMinor,incomeAmount);
    else if(event.eventType==="return_of_capital"){
      income.returnOfCapitalMinor=add(income.returnOfCapitalMinor,Math.abs(event.cashEffectMinor||event.grossCashMinor||0));
    }
    if(event.eventType==="fee")income.feesMinor=add(income.feesMinor,Math.abs(event.feeMinor||event.cashEffectMinor));
    else if(event.feeMinor)income.feesMinor=add(income.feesMinor,Math.abs(event.feeMinor));
  }

  return{
    asOfDate:input.snapshot.asOfDate,
    currency:input.currency,
    rows:rows.sort((a,b)=>a.accountName.localeCompare(b.accountName)||a.securityName.localeCompare(b.securityName)),
    income,
    cashMinor:cash,
    marketValueKnownMinor:market,
    knownBasisMinor:basis,
    unrealizedGainKnownMinor:unrealized,
    unrealizedIncomplete,
    realizedKnownBasisMinor:realizedBasis,
    realizedProceedsMinor:realizedProceeds,
    realizedGainMinor:realizedGain,
    realizedUnknownBasisProceedsMinor:unknownProceeds,
    realizedIncomplete,
  };
}

function row(account:Account,holding:HoldingSnapshot,security?:Security):InvestmentHoldingReportRow{
  return{
    accountId:account.id,
    accountName:account.name,
    securityId:holding.securityId,
    securityName:security?.name??"Unknown security",
    symbol:security?.symbol,
    currency:account.currency,
    quantityE8:holding.quantityE8,
    priceE8:holding.priceE8,
    priceObservedAt:holding.priceObservedAt,
    marketValueMinor:holding.marketValueMinor,
    knownBasisMinor:holding.knownBasisMinor,
    unknownBasisQuantityE8:holding.unknownBasisQuantityE8,
    unrealizedGainMinor:holding.unrealizedGainMinor,
    basisPartial:holding.incompleteUnknownBasis||holding.unknownBasisQuantityE8>0,
    realizedKnownBasisMinor:holding.realized.knownDisposedBasisMinor,
    realizedProceedsMinor:holding.realized.calculableProceedsMinor,
    realizedGainMinor:holding.realized.calculableGainMinor,
    realizedUnknownBasisQuantityE8:holding.realized.unknownBasisQuantityE8,
    realizedUnknownBasisProceedsMinor:holding.realized.unknownBasisProceedsMinor,
    realizedPartial:holding.realized.incompleteUnknownBasis||holding.realized.unknownBasisQuantityE8>0,
  };
}

function add(a:number,b:number){
  const n=a+b;
  if(!Number.isSafeInteger(n))throw new Error("Investment report total is too large");
  return n;
}
