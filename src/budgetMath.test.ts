import {describe,expect,it} from "vitest";
import type {BudgetAllocation,BudgetCategory,Transaction} from "./domain";
import {calculateBudgetMonth,nextMonth,previousMonth,validateMonth,averageMinor} from "./budgetMath";

const categories:BudgetCategory[]=[{id:"food",category:"Food: Groceries",rolloverEnabled:false},{id:"repairs",category:"Home: Repairs",rolloverEnabled:true}];
const allocations:BudgetAllocation[]=[
  {budgetCategoryId:"food",month:"2026-08",plannedMinor:30000},{budgetCategoryId:"food",month:"2026-09",plannedMinor:30000},
  {budgetCategoryId:"repairs",month:"2026-08",plannedMinor:10000},{budgetCategoryId:"repairs",month:"2026-09",plannedMinor:10000},
];
const transactions:Transaction[]=[
  {id:"a",accountId:"checking",postedDate:"2026-08-10",payee:"Store",category:"Food: Groceries",amountMinor:-12000,status:"cleared"},
  {id:"b",accountId:"checking",postedDate:"2026-08-11",payee:"Hardware",category:"Home: Repairs",amountMinor:-2500,status:"cleared"},
  {id:"c",accountId:"checking",postedDate:"2026-09-05",payee:"Split store",category:"Split transaction",amountMinor:-6000,status:"cleared",splits:[{id:"s1",category:"Food: Groceries",amountMinor:-4000},{id:"s2",category:"Home: Repairs",amountMinor:-2000}]},
  {id:"d",accountId:"checking",postedDate:"2026-09-06",payee:"Transfer",category:"Home: Repairs",amountMinor:-5000,status:"cleared",source:"transfer"},
];

describe("monthly budget calculations",()=>{
  it("tracks current spending without rolling ordinary categories",()=>expect(calculateBudgetMonth("2026-09",categories,allocations,transactions).lines[0]).toMatchObject({category:"Food: Groceries",plannedMinor:30000,spentMinor:4000,carryInMinor:0,availableMinor:26000}));
  it("carries prior sinking-fund availability into the next month",()=>expect(calculateBudgetMonth("2026-09",categories,allocations,transactions).lines[1]).toMatchObject({category:"Home: Repairs",plannedMinor:10000,spentMinor:2000,carryInMinor:7500,availableMinor:15500}));
  it("counts split categories once and excludes linked transfers",()=>expect(calculateBudgetMonth("2026-09",categories,allocations,transactions)).toMatchObject({plannedMinor:40000,spentMinor:6000,carryInMinor:7500,availableMinor:41500}));
  it("validates and advances calendar months",()=>{expect(nextMonth("2026-12")).toBe("2027-01");expect(previousMonth("2026-01")).toBe("2025-12");expect(()=>validateMonth("2026-13")).toThrow("YYYY-MM");expect(averageMinor([100,200,300])).toBe(200);});
});
