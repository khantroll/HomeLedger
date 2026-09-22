import {describe,expect,it} from "vitest";
import type {Account,Transaction} from "./domain";
import {calculateTransactionReport,reportMonths,reportRange} from "./reportMath";

const accounts:Account[]=[
  {id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
  {id:"credit",name:"Card",type:"credit",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
  {id:"cad",name:"CAD",type:"cash",currency:"CAD",balanceMinor:0,ownerLabel:"Household"},
  {id:"investment",name:"Brokerage",type:"investment",currency:"USD",balanceMinor:250000,ownerLabel:"Household"},
];
const transactions:Transaction[]=[
  {id:"income",accountId:"checking",postedDate:"2026-08-31",payee:"Payroll",category:"Income",amountMinor:200000,status:"cleared",source:"manual"},
  {id:"split",accountId:"credit",postedDate:"2026-09-02",payee:"Market",category:"Split transaction",amountMinor:-6000,status:"cleared",source:"import",splits:[{id:"s1",category:"Food",amountMinor:-4000},{id:"s2",category:"Household",amountMinor:-2000}]},
  {id:"rent",accountId:"checking",postedDate:"2026-09-05",payee:"Landlord",category:"Housing",amountMinor:-80000,status:"cleared",source:"manual"},
  {id:"transfer",accountId:"checking",postedDate:"2026-09-06",payee:"Savings",category:"Transfer",amountMinor:-10000,status:"cleared",source:"transfer",transferLinkId:"link"},
  {id:"adjustment",accountId:"checking",postedDate:"2026-09-07",payee:"Balance adjustment",category:"Reconciliation",amountMinor:500,status:"reconciled",source:"adjustment"},
  {id:"cad",accountId:"cad",postedDate:"2026-09-08",payee:"Canada",category:"Food",amountMinor:-5000,status:"cleared",source:"manual"},
  {id:"investment-ordinary-shaped",accountId:"investment",postedDate:"2026-09-09",payee:"Broker activity",category:"Investments",amountMinor:500000,status:"cleared",source:"manual"},
];

describe("transaction reports",()=>{
  it("totals one currency while excluding transfers and balance adjustments",()=>expect(calculateTransactionReport({fromDate:"2026-08-01",toDate:"2026-09-30",currency:"USD",accounts,transactions})).toMatchObject({incomeMinor:200000,spendingMinor:86000,netMinor:114000,savingsRatePercent:57,transactionCount:3}));
  it("uses split categories without double-counting their parent",()=>{const report=calculateTransactionReport({fromDate:"2026-09-01",toDate:"2026-09-30",currency:"USD",accounts,transactions});expect(report.categories.map(item=>[item.label,item.amountMinor])).toEqual([["Housing",80000],["Food",4000],["Household",2000]]);expect(report.payees.map(item=>[item.label,item.amountMinor])).toEqual([["Landlord",80000],["Market",6000]]);});
  it("keeps exact transaction contributions for drill-down",()=>{const report=calculateTransactionReport({fromDate:"2026-09-01",toDate:"2026-09-30",currency:"USD",accounts,transactions});expect(report.categories.find(item=>item.label==="Food")?.contributions).toEqual([{transactionId:"split",amountMinor:4000}]);});
  it("filters one account and returns zero-filled months",()=>{const report=calculateTransactionReport({fromDate:"2026-08-01",toDate:"2026-10-31",currency:"USD",accountId:"checking",accounts,transactions});expect(report.months).toEqual([{month:"2026-08",incomeMinor:200000,spendingMinor:0,netMinor:200000},{month:"2026-09",incomeMinor:0,spendingMinor:80000,netMinor:-80000},{month:"2026-10",incomeMinor:0,spendingMinor:0,netMinor:0}]);});
  it("does not treat investment account value as ordinary household income or spending",()=>{const report=calculateTransactionReport({fromDate:"2026-08-01",toDate:"2026-09-30",currency:"USD",accounts,transactions});expect(report).toMatchObject({incomeMinor:200000,spendingMinor:86000,netMinor:114000,transactionCount:3});expect(report.categories.some(item=>item.label==="Investments")).toBe(false);});
  it("excludes ordinary↔investment cash transfers from household income and spending",()=>{
    const crossDomain:Transaction[]=[
      ...transactions,
      {id:"to-brokerage",accountId:"checking",postedDate:"2026-09-10",payee:"Account transfer",category:"Transfer: Brokerage",amountMinor:-100000,status:"cleared",source:"transfer",transferLinkId:"oict-1",transferAccountId:"investment"},
      {id:"from-brokerage",accountId:"checking",postedDate:"2026-09-11",payee:"Account transfer",category:"Transfer: Brokerage",amountMinor:50000,status:"cleared",source:"transfer",transferLinkId:"oict-2",transferAccountId:"investment"},
    ];
    const report=calculateTransactionReport({fromDate:"2026-08-01",toDate:"2026-09-30",currency:"USD",accounts,transactions:crossDomain});
    expect(report).toMatchObject({incomeMinor:200000,spendingMinor:86000,netMinor:114000,transactionCount:3});
  });
  it("builds calendar presets and validates report spans",()=>{expect(reportRange("quarter","2026-09-19")).toEqual({fromDate:"2026-07-01",toDate:"2026-09-19"});expect(reportRange("year","2026-09-19")).toEqual({fromDate:"2026-01-01",toDate:"2026-09-19"});expect(reportMonths("2026-11-01","2027-02-01")).toEqual(["2026-11","2026-12","2027-01","2027-02"]);expect(()=>calculateTransactionReport({fromDate:"2026-09-31",toDate:"2026-10-01",currency:"USD",accounts,transactions})).toThrow("invalid");});
});
