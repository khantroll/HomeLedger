import {describe,expect,it} from "vitest";
import {calculateDebtProjection} from "./debtMath";
import type {DebtStrategy} from "./domain";

const debts=[
  {accountId:"small",balanceMinor:100000,annualRateBps:500,minimumPaymentMinor:4000,customPriority:2,enabled:true},
  {accountId:"large",balanceMinor:300000,annualRateBps:2000,minimumPaymentMinor:7000,customPriority:1,enabled:true},
];
const run=(strategy:DebtStrategy)=>calculateDebtProjection({strategy,extraPaymentMinor:10000,startMonth:"2026-10",debts});

describe("debt payoff projections",()=>{
  it("applies snowball to the smallest balance first",()=>{const result=run("snowball");expect(result.complete).toBe(true);expect(result.payoffOrder[0]).toBe("small");expect(result.totalPaidMinor).toBe(result.startingBalanceMinor+result.totalInterestMinor);});
  it("applies avalanche to the highest APR and reduces interest",()=>{const avalanche=run("avalanche"),snowball=run("snowball");expect(avalanche.payoffOrder[0]).toBe("large");expect(avalanche.totalInterestMinor).toBeLessThan(snowball.totalInterestMinor);});
  it("respects explicit custom priority",()=>expect(run("custom").payoffOrder[0]).toBe("large"));
  it("rolls freed minimum payments into the fixed monthly plan",()=>{const result=run("snowball");expect(result.monthlyPaymentMinor).toBe(21000);expect(result.timeline.slice(0,-1).every(item=>item.paymentMinor===21000)).toBe(true);});
  it("reports a bounded incomplete plan when payments cannot amortize the debt",()=>{const result=calculateDebtProjection({strategy:"avalanche",extraPaymentMinor:0,startMonth:"2026-10",debts:[{accountId:"bad",balanceMinor:100000,annualRateBps:1200,minimumPaymentMinor:100,customPriority:1,enabled:true}]});expect(result).toMatchObject({complete:false,months:1200});});
  it("validates money, dates, and duplicate accounts",()=>{expect(()=>calculateDebtProjection({strategy:"snowball",extraPaymentMinor:-1,startMonth:"2026-10",debts})).toThrow("Extra");expect(()=>calculateDebtProjection({strategy:"snowball",extraPaymentMinor:0,startMonth:"2026-13",debts})).toThrow("YYYY-MM");expect(()=>calculateDebtProjection({strategy:"snowball",extraPaymentMinor:0,startMonth:"2026-10",debts:[debts[0],debts[0]]})).toThrow("more than once");});
});
