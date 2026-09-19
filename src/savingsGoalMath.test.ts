import {describe,expect,it} from "vitest";
import {calculateSavingsGoal} from "./savingsGoalMath";
import type {SavingsGoal} from "./domain";

const goal=(changes:Partial<SavingsGoal>={}):SavingsGoal=>({id:"goal",name:"Emergency fund",accountId:"savings",targetMinor:1000000,targetDate:"2027-09-19",plannedMonthlyMinor:75000,...changes});

describe("calculateSavingsGoal",()=>{
  it("derives progress and an on-track monthly plan from the linked balance",()=>{expect(calculateSavingsGoal(goal(),250000,"2026-09-19")).toEqual({currentMinor:250000,remainingMinor:750000,progressPercent:25,monthsRemaining:12,requiredMonthlyMinor:62500,projectedMonth:"2027-07",status:"on-track"});});
  it("marks an underfunded plan at risk",()=>{expect(calculateSavingsGoal(goal({plannedMonthlyMinor:10000}),250000,"2026-09-19")).toMatchObject({requiredMonthlyMinor:62500,status:"at-risk",projectedMonth:"2032-12"});});
  it("marks reached and overdue goals explicitly",()=>{expect(calculateSavingsGoal(goal(),1200000,"2026-09-19").status).toBe("complete");expect(calculateSavingsGoal(goal({targetDate:"2026-09-01"}),250000,"2026-09-19")).toMatchObject({status:"overdue",monthsRemaining:0,requiredMonthlyMinor:750000});});
  it("clamps an overdrawn savings balance to zero",()=>{expect(calculateSavingsGoal(goal(),-500,"2026-09-19")).toMatchObject({currentMinor:0,remainingMinor:1000000,progressPercent:0});});
});
