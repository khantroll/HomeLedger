import {describe,expect,it} from "vitest";
import type {Account,HoldingSnapshot,InvestmentEventRevision,PortfolioSnapshot,Security} from "./domain";
import {calculateInvestmentReport} from "./investmentReport";

const accounts:Account[]=[
  {id:"inv",name:"Brokerage",type:"investment",currency:"USD",balanceMinor:999999,ownerLabel:"Household"},
  {id:"eur",name:"Euro",type:"investment",currency:"EUR",balanceMinor:0,ownerLabel:"Household"},
  {id:"old",name:"Old",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:true},
];
const securities:Security[]=[{id:"sec",name:"Example",symbol:"EX",securityType:"stock",currency:"USD",archived:false}];
const realized={
  knownBasisQuantityE8:100000000,
  knownDisposedBasisMinor:7000,
  calculableProceedsMinor:9000,
  calculableGainMinor:2000,
  unknownBasisQuantityE8:0,
  unknownBasisProceedsMinor:0,
  incompleteUnknownBasis:false,
};
const holding=(patch:Partial<HoldingSnapshot>={}):HoldingSnapshot=>({
  accountId:"inv",
  securityId:"sec",
  quantityE8:200000000,
  knownBasisMinor:10000,
  unknownBasisQuantityE8:0,
  priceE8:6000000000,
  priceObservedAt:"2026-09-20",
  marketValueMinor:12000,
  unrealizedGainMinor:2000,
  incompleteUnknownBasis:false,
  lots:[],
  realized,
  ...patch,
});
const event=(eventType:InvestmentEventRevision["eventType"],patch:Partial<InvestmentEventRevision>={}):InvestmentEventRevision=>({
  id:eventType,
  eventId:eventType,
  revisionNumber:1,
  accountId:"inv",
  eventType,
  tradeDate:"2026-09-10",
  cashEffectMinor:0,
  incomeMinor:0,
  acquisitionFundingMinor:0,
  feeMinor:0,
  basisEffectMinor:0,
  status:"cleared",
  source:"manual",
  ...patch,
});

function report(h=holding(),events:InvestmentEventRevision[]=[]){
  const snapshot:PortfolioSnapshot={
    asOfDate:"2026-09-22",
    accounts:[
      {accountId:"inv",cashMinor:500,holdings:[h]},
      {accountId:"eur",cashMinor:0,holdings:[{...holding(),accountId:"eur",marketValueMinor:50000}]},
      {accountId:"old",cashMinor:0,holdings:[{...holding(),accountId:"old",marketValueMinor:80000}]},
    ],
  };
  return calculateInvestmentReport({snapshot,events,accounts,securities,currency:"USD"});
}

describe("investment report",()=>{
  it("reports priced holdings, known cash/basis and Foundation realized/unrealized results",()=>{
    expect(report()).toMatchObject({
      cashMinor:500,
      marketValueKnownMinor:12000,
      knownBasisMinor:10000,
      unrealizedGainKnownMinor:2000,
      unrealizedIncomplete:false,
      realizedKnownBasisMinor:7000,
      realizedProceedsMinor:9000,
      realizedGainMinor:2000,
      realizedIncomplete:false,
    });
  });

  it("keeps unpriced and partial basis explicitly incomplete without fabricating gains",()=>{
    const result=report(holding({
      marketValueMinor:undefined,
      unrealizedGainMinor:undefined,
      unknownBasisQuantityE8:50000000,
      incompleteUnknownBasis:true,
      realized:{...realized,unknownBasisQuantityE8:50000000,unknownBasisProceedsMinor:3000,incompleteUnknownBasis:true},
    }));
    expect(result).toMatchObject({
      marketValueKnownMinor:0,
      unrealizedIncomplete:true,
      realizedGainMinor:2000,
      realizedUnknownBasisProceedsMinor:3000,
      realizedIncomplete:true,
    });
    expect(result.rows[0].basisPartial).toBe(true);
    expect(result.rows[0].unrealizedGainMinor).toBeUndefined();
  });

  it("preserves calculable unrealized gain when only part of basis is known",()=>{
    const result=report(holding({
      unknownBasisQuantityE8:50000000,
      incompleteUnknownBasis:true,
      marketValueMinor:12000,
      unrealizedGainMinor:1500,
    }));
    expect(result).toMatchObject({unrealizedGainKnownMinor:1500,unrealizedIncomplete:true});
  });

  it("separates dividends, interest, return of capital and fees without treating buys, sells or transfers as income",()=>{
    const result=report(holding(),[
      event("dividend",{incomeMinor:500}),
      event("reinvest_dividend",{incomeMinor:300}),
      event("interest",{incomeMinor:200}),
      event("return_of_capital",{cashEffectMinor:150}),
      event("fee",{feeMinor:25,cashEffectMinor:-25}),
      event("buy",{cashEffectMinor:-10000,feeMinor:10}),
      event("sell",{cashEffectMinor:9000}),
      event("cash_transfer",{cashEffectMinor:4000}),
      event("security_transfer"),
    ]);
    expect(result.income).toEqual({
      dividendMinor:800,
      interestMinor:200,
      returnOfCapitalMinor:150,
      feesMinor:35,
      reinvestedDividendMinor:300,
    });
  });

  it("counts standalone fee cash effects when feeMinor is unset",()=>{
    expect(report(holding(),[event("fee",{cashEffectMinor:-125})]).income.feesMinor).toBe(125);
  });

  it("does not aggregate unlike currencies or archived investment accounts",()=>{
    expect(report().rows.map(r=>r.accountId)).toEqual(["inv"]);
    expect(report().cashMinor).toBe(500);
  });

  it("includes Foundation realized results for fully disposed zero-quantity holdings",()=>{
    const result=report(holding({
      quantityE8:0,
      priceE8:undefined,
      priceObservedAt:undefined,
      marketValueMinor:0,
      unrealizedGainMinor:0,
      knownBasisMinor:0,
    }));
    expect(result).toMatchObject({
      marketValueKnownMinor:0,
      realizedKnownBasisMinor:7000,
      realizedProceedsMinor:9000,
      realizedGainMinor:2000,
    });
  });
});
