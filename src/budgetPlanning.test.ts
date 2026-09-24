import { describe, expect, it } from "vitest";
import type { Account, BudgetMonth, ScheduledOccurrence, ScheduledTransaction, Transaction } from "./domain";
import { averageMinor, previousMonth, shiftBudgetMonth } from "./budgetMath";
import { applyBudgetPlanSelection, buildBudgetPlanProposal } from "./budgetPlanning";

const accounts: Account[] = [
  { id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 0, ownerLabel: "Household" },
  { id: "old", name: "Old Checking", type: "checking", currency: "USD", balanceMinor: 0, ownerLabel: "Household", archived: true },
  { id: "brokerage", name: "Brokerage", type: "investment", currency: "USD", balanceMinor: 0, ownerLabel: "Household" },
];

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "postedDate" | "category" | "amountMinor">): Transaction {
  return {
    accountId: "checking",
    payee: "Merchant",
    status: "cleared",
    ...partial,
  };
}

const history: Transaction[] = [
  tx({ id: "j1", postedDate: "2026-06-10", category: "Food: Groceries", amountMinor: -30000 }),
  tx({ id: "j2", postedDate: "2026-07-10", category: "Food: Groceries", amountMinor: -45000 }),
  tx({ id: "j3", postedDate: "2026-08-10", category: "Food: Groceries", amountMinor: -60000 }),
  tx({ id: "u1", postedDate: "2026-06-15", category: "Utilities", amountMinor: -10000 }),
  tx({ id: "u2", postedDate: "2026-07-15", category: "Utilities", amountMinor: -12000 }),
  tx({ id: "u3", postedDate: "2026-08-15", category: "Utilities", amountMinor: -14000 }),
  tx({ id: "split", postedDate: "2026-08-20", category: "Split transaction", amountMinor: -5000, splits: [
    { id: "s1", category: "Food: Groceries", amountMinor: -3000 },
    { id: "s2", category: "Household", amountMinor: -2000 },
  ]}),
  tx({ id: "income", postedDate: "2026-08-01", category: "Salary", amountMinor: 200000, payee: "Employer" }),
  tx({ id: "xfer", postedDate: "2026-08-05", category: "Transfer: Savings", amountMinor: -50000, source: "transfer" }),
  tx({ id: "cross", postedDate: "2026-08-06", category: "Transfer: Brokerage", amountMinor: -25000, source: "transfer", transferAccountId: "brokerage" }),
  tx({ id: "arch", accountId: "old", postedDate: "2026-08-12", category: "Food: Groceries", amountMinor: -1000 }),
  tx({ id: "ly", postedDate: "2025-09-08", category: "Food: Groceries", amountMinor: -55500 }),
  tx({ id: "jan-edge", postedDate: "2025-12-20", category: "Utilities", amountMinor: -9000 }),
];

const currentBudget: BudgetMonth = {
  month: "2026-09",
  plannedMinor: 60000,
  spentMinor: 0,
  carryInMinor: 0,
  availableMinor: 60000,
  lines: [
    { id: "food", category: "Food: Groceries", rolloverEnabled: false, plannedMinor: 50000, spentMinor: 0, carryInMinor: 0, availableMinor: 50000 },
    { id: "util", category: "Utilities", rolloverEnabled: true, plannedMinor: 10000, spentMinor: 0, carryInMinor: 0, availableMinor: 10000 },
  ],
};

const previousBudget: BudgetMonth = {
  month: "2026-08",
  plannedMinor: 70000,
  spentMinor: 0,
  carryInMinor: 0,
  availableMinor: 70000,
  lines: [
    { id: "food", category: "Food: Groceries", rolloverEnabled: false, plannedMinor: 55000, spentMinor: 0, carryInMinor: 0, availableMinor: 55000 },
    { id: "util", category: "Utilities", rolloverEnabled: true, plannedMinor: 15000, spentMinor: 0, carryInMinor: 0, availableMinor: 15000 },
  ],
};

const schedules: ScheduledTransaction[] = [
  { id: "rent", kind: "transaction", accountId: "checking", payee: "Landlord", category: "Housing", amountMinor: -180000, status: "pending", frequency: "monthly", anchorDate: "2026-09-01", enabled: true },
  { id: "paycheck", kind: "transaction", accountId: "checking", payee: "Payroll", category: "Salary", amountMinor: 250000, status: "pending", frequency: "monthly", anchorDate: "2026-09-15", enabled: true },
  { id: "xfer-sched", kind: "transfer", accountId: "checking", transferAccountId: "brokerage", payee: "Brokerage funding", category: "Transfer", amountMinor: 10000, status: "pending", frequency: "monthly", anchorDate: "2026-09-05", enabled: true },
];

const occurrences: ScheduledOccurrence[] = [
  { id: "o-rent", scheduledTransactionId: "rent", dueDate: "2026-09-01", status: "expected" },
  { id: "o-pay", scheduledTransactionId: "paycheck", dueDate: "2026-09-15", status: "expected" },
  { id: "o-xfer", scheduledTransactionId: "xfer-sched", dueDate: "2026-09-05", status: "expected" },
  { id: "o-rent-posted", scheduledTransactionId: "rent", dueDate: "2026-08-01", status: "posted", transactionId: "posted-rent" },
];

describe("budgetPlanning", () => {
  it("averages three completed months with split allocation and excludes income/transfers", () => {
    const proposal = buildBudgetPlanProposal("average-3", {
      targetMonth: "2026-09",
      currentBudget,
      previousBudget,
      transactions: history,
      accounts,
      schedules,
      occurrences,
    });
    expect(proposal.label).toBe("3-month average");
    expect(proposal.monthsUsed).toEqual(["2026-08", "2026-07", "2026-06"]);
    const food = proposal.lines.find((line) => line.category === "Food: Groceries");
    // June 30000 + July 45000 + August 60000 + August split 3000 + archived Aug 1000 = per-month: 30000, 45000, 64000
    expect(food?.suggestedPlannedMinor).toBe(averageMinor([30000, 45000, 64000]));
    expect(food?.currentPlannedMinor).toBe(50000);
    expect(proposal.lines.some((line) => line.category === "Salary")).toBe(false);
    expect(proposal.lines.some((line) => /Transfer/.test(line.category))).toBe(false);
  });

  it("averages an intermittent category across every valid household-history month", () => {
    const intermittent = [
      tx({ id: "repair-june", postedDate: "2026-06-10", category: "Car Repair", amountMinor: -30000 }),
      tx({ id: "grocery-june", postedDate: "2026-06-12", category: "Food: Groceries", amountMinor: -40000 }),
      tx({ id: "grocery-july", postedDate: "2026-07-12", category: "Food: Groceries", amountMinor: -45000 }),
      tx({ id: "grocery-august", postedDate: "2026-08-12", category: "Food: Groceries", amountMinor: -50000 }),
    ];
    const proposal = buildBudgetPlanProposal("average-3", {
      targetMonth: "2026-09",
      transactions: intermittent,
      accounts,
      schedules: [],
      occurrences: [],
    });
    expect(proposal.label).toBe("3-month average");
    expect(proposal.monthsUsed).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(proposal.lines.find((line) => line.category === "Car Repair")?.suggestedPlannedMinor).toBe(10000);
    expect(proposal.lines.find((line) => line.category === "Car Repair")?.basis).toBe("3-month average");
  });

  it("labels a shorter average honestly when history is incomplete", () => {
    const shortHistory = history.filter((item) => item.postedDate >= "2026-07-01");
    const proposal = buildBudgetPlanProposal("average-3", {
      targetMonth: "2026-09",
      currentBudget,
      transactions: shortHistory,
      accounts,
      schedules: [],
      occurrences: [],
    });
    expect(proposal.label).toBe("2-month average");
    expect(proposal.detail).toMatch(/Only 2 of the prior 3 months/);
    expect(proposal.monthsUsed).toEqual(["2026-08", "2026-07"]);
  });

  it("supports six-month averages and same-month-last-year including January boundaries", () => {
    const six = buildBudgetPlanProposal("average-6", {
      targetMonth: "2026-09",
      currentBudget,
      transactions: history,
      accounts,
      schedules: [],
      occurrences: [],
    });
    expect(six.source).toBe("average-6");
    expect(six.monthsUsed[0]).toBe("2026-08");
    expect(shiftBudgetMonth("2026-01", -1)).toBe("2025-12");

    const same = buildBudgetPlanProposal("same-month-last-year", {
      targetMonth: "2026-09",
      currentBudget,
      transactions: history,
      accounts,
      schedules: [],
      occurrences: [],
    });
    expect(same.monthsUsed).toEqual(["2025-09"]);
    expect(same.lines.find((line) => line.category === "Food: Groceries")?.suggestedPlannedMinor).toBe(55500);

    const january = buildBudgetPlanProposal("same-month-last-year", {
      targetMonth: "2026-01",
      transactions: [tx({ id: "prev-jan", postedDate: "2025-01-12", category: "Utilities", amountMinor: -11000 }), ...history],
      accounts,
      schedules: [],
      occurrences: [],
    });
    expect(january.monthsUsed).toEqual(["2025-01"]);
    expect(january.lines[0]?.suggestedPlannedMinor).toBe(11000);
  });

  it("copies previous month planned amounts and rollover without spent/available", () => {
    const proposal = buildBudgetPlanProposal("previous-plan", {
      targetMonth: "2026-09",
      currentBudget,
      previousBudget,
      transactions: history,
      accounts,
      schedules: [],
      occurrences: [],
    });
    expect(previousMonth("2026-09")).toBe("2026-08");
    expect(proposal.lines).toEqual([
      expect.objectContaining({ category: "Food: Groceries", suggestedPlannedMinor: 55000, rolloverEnabled: false, currentPlannedMinor: 50000 }),
      expect.objectContaining({ category: "Utilities", suggestedPlannedMinor: 15000, rolloverEnabled: true, currentPlannedMinor: 10000 }),
    ]);
  });

  it("proposes scheduled ordinary expenses and ignores income/transfers", () => {
    const proposal = buildBudgetPlanProposal("scheduled", {
      targetMonth: "2026-09",
      currentBudget,
      transactions: history,
      accounts,
      schedules,
      occurrences,
    });
    expect(proposal.lines).toEqual([
      expect.objectContaining({ category: "Housing", suggestedPlannedMinor: 180000, basis: "1 scheduled item" }),
    ]);
  });

  it("keeps selection state inspectable until explicit apply", () => {
    const proposal = buildBudgetPlanProposal("previous-plan", {
      targetMonth: "2026-09",
      currentBudget,
      previousBudget,
      transactions: history,
      accounts,
      schedules: [],
      occurrences: [],
    });
    const none = applyBudgetPlanSelection(proposal.lines, new Set());
    expect(none.every((line) => !line.selected)).toBe(true);
    const one = applyBudgetPlanSelection(proposal.lines, new Set(["food: groceries"]));
    expect(one.find((line) => line.key === "food: groceries")?.selected).toBe(true);
    expect(one.find((line) => line.key === "utilities")?.selected).toBe(false);
  });

  it("rounds averages in integer minor units", () => {
    expect(averageMinor([100, 100, 101])).toBe(100);
    expect(averageMinor([100, 101])).toBe(101);
    expect(averageMinor([1, 2])).toBe(2);
  });
});
