import type { Account, BudgetMonth, ScheduledOccurrence, ScheduledTransaction, Transaction } from "./domain";
import { sumMoney } from "./domain";
import {
  averageMinor,
  monthlyExpenseByCategory,
  previousMonth,
  shiftBudgetMonth,
  validateMonth,
} from "./budgetMath";

export type BudgetHistorySource =
  | "average-3"
  | "average-6"
  | "same-month-last-year"
  | "previous-plan"
  | "scheduled";

export interface BudgetPlanProposalLine {
  key: string;
  category: string;
  currentPlannedMinor: number;
  suggestedPlannedMinor: number;
  basis: string;
  /** Existing budget category id when the label already has a line. */
  budgetCategoryId?: string;
  /** Rollover preference when copying a prior plan or creating a new category. */
  rolloverEnabled?: boolean;
  selected: boolean;
}

export interface BudgetPlanProposal {
  source: BudgetHistorySource;
  targetMonth: string;
  label: string;
  detail: string;
  monthsUsed: string[];
  lines: BudgetPlanProposalLine[];
}

export interface BudgetPlanInput {
  targetMonth: string;
  currentBudget?: BudgetMonth;
  previousBudget?: BudgetMonth;
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  schedules: readonly ScheduledTransaction[];
  occurrences: readonly ScheduledOccurrence[];
}

const SOURCE_LABELS: Record<BudgetHistorySource, string> = {
  "average-3": "3-month average",
  "average-6": "6-month average",
  "same-month-last-year": "Same month last year",
  "previous-plan": "Previous month’s plan",
  scheduled: "Scheduled obligations",
};

function ordinaryAccountIds(accounts: readonly Account[]): Set<string> {
  // Investment accounts do not hold ordinary spending; archived ordinary accounts may still
  // contribute legitimate historical household expense.
  return new Set(accounts.filter((item) => item.type !== "investment").map((item) => item.id));
}

function currentByCategory(budget?: BudgetMonth): Map<string, { id: string; plannedMinor: number; rolloverEnabled: boolean; category: string }> {
  const map = new Map<string, { id: string; plannedMinor: number; rolloverEnabled: boolean; category: string }>();
  for (const line of budget?.lines ?? []) {
    map.set(line.category.trim().toLocaleLowerCase(), {
      id: line.id,
      plannedMinor: line.plannedMinor,
      rolloverEnabled: line.rolloverEnabled,
      category: line.category,
    });
  }
  return map;
}

function completedHistoryMonths(targetMonth: string, count: number): string[] {
  validateMonth(targetMonth);
  const months: string[] = [];
  for (let i = 1; i <= count; i++) months.push(shiftBudgetMonth(targetMonth, -i));
  return months;
}

function monthHasExpense(month: string, transactions: readonly Transaction[], accountIds: ReadonlySet<string>): boolean {
  return monthlyExpenseByCategory(month, transactions, accountIds).size > 0;
}

function buildAverageProposal(
  source: "average-3" | "average-6",
  input: BudgetPlanInput,
): BudgetPlanProposal {
  const requested = source === "average-3" ? 3 : 6;
  const accountIds = ordinaryAccountIds(input.accounts);
  const candidateMonths = completedHistoryMonths(input.targetMonth, requested);
  const monthsUsed = candidateMonths.filter((month) => monthHasExpense(month, input.transactions, accountIds));
  const current = currentByCategory(input.currentBudget);
  const totals = new Map<string, { category: string; totalMinor: number }>();

  for (const month of monthsUsed) {
    const byCategory = monthlyExpenseByCategory(month, input.transactions, accountIds);
    for (const [key, row] of byCategory) {
      const entry = totals.get(key) ?? { category: row.category, totalMinor: 0 };
      // Every category uses the same valid household-history window. If this category is
      // absent from another month in monthsUsed, that month contributes zero implicitly.
      entry.totalMinor = sumMoney([entry.totalMinor, row.spentMinor]);
      // Prefer an existing budget label casing when present.
      entry.category = current.get(key)?.category ?? entry.category;
      totals.set(key, entry);
    }
  }

  const actualCount = monthsUsed.length;
  const label =
    actualCount === 0
      ? SOURCE_LABELS[source]
      : actualCount === requested
        ? SOURCE_LABELS[source]
        : `${actualCount}-month average`;
  const detail =
    actualCount === 0
      ? `No completed spending history was found in the prior ${requested} months.`
      : actualCount < requested
        ? `Only ${actualCount} of the prior ${requested} months had ordinary spending, so this is a ${actualCount}-month average.`
        : `Average ordinary spending across ${monthsUsed.join(", ")}.`;

  const lines: BudgetPlanProposalLine[] = [...totals.entries()]
    .map(([key, entry]) => {
      const existing = current.get(key);
      const suggested = actualCount > 0 ? averageMinor([entry.totalMinor, ...Array(actualCount - 1).fill(0)]) : 0;
      return {
        key,
        category: existing?.category ?? entry.category,
        currentPlannedMinor: existing?.plannedMinor ?? 0,
        suggestedPlannedMinor: suggested,
        basis: actualCount === requested ? SOURCE_LABELS[source] : `${actualCount}-month average`,
        budgetCategoryId: existing?.id,
        rolloverEnabled: existing?.rolloverEnabled,
        selected: suggested > 0,
      };
    })
    .filter((line) => line.suggestedPlannedMinor > 0)
    .sort((a, b) => a.category.localeCompare(b.category));

  return { source, targetMonth: input.targetMonth, label, detail, monthsUsed, lines };
}

function buildSameMonthLastYear(input: BudgetPlanInput): BudgetPlanProposal {
  const accountIds = ordinaryAccountIds(input.accounts);
  const historyMonth = shiftBudgetMonth(input.targetMonth, -12);
  const byCategory = monthlyExpenseByCategory(historyMonth, input.transactions, accountIds);
  const current = currentByCategory(input.currentBudget);
  const lines: BudgetPlanProposalLine[] = [...byCategory.entries()]
    .map(([key, row]) => {
      const existing = current.get(key);
      return {
        key,
        category: existing?.category ?? row.category,
        currentPlannedMinor: existing?.plannedMinor ?? 0,
        suggestedPlannedMinor: row.spentMinor,
        basis: `Spent ${historyMonth}`,
        budgetCategoryId: existing?.id,
        rolloverEnabled: existing?.rolloverEnabled,
        selected: row.spentMinor > 0,
      };
    })
    .filter((line) => line.suggestedPlannedMinor > 0)
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    source: "same-month-last-year",
    targetMonth: input.targetMonth,
    label: SOURCE_LABELS["same-month-last-year"],
    detail: lines.length
      ? `Ordinary spending from ${historyMonth}.`
      : `No ordinary spending was found for ${historyMonth}.`,
    monthsUsed: lines.length ? [historyMonth] : [],
    lines,
  };
}

function buildPreviousPlan(input: BudgetPlanInput): BudgetPlanProposal {
  const priorMonth = previousMonth(input.targetMonth);
  const prior = input.previousBudget;
  const current = currentByCategory(input.currentBudget);
  const lines: BudgetPlanProposalLine[] = (prior?.lines ?? [])
    .filter((line) => line.plannedMinor > 0)
    .map((line) => {
      const key = line.category.trim().toLocaleLowerCase();
      const existing = current.get(key);
      return {
        key,
        category: existing?.category ?? line.category,
        currentPlannedMinor: existing?.plannedMinor ?? 0,
        suggestedPlannedMinor: line.plannedMinor,
        basis: `Planned ${priorMonth}`,
        budgetCategoryId: existing?.id,
        rolloverEnabled: line.rolloverEnabled,
        selected: true,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    source: "previous-plan",
    targetMonth: input.targetMonth,
    label: SOURCE_LABELS["previous-plan"],
    detail: lines.length
      ? `Copies planned amounts and rollover settings from ${priorMonth}. Spent and available amounts are not copied.`
      : `No planned budget lines were found for ${priorMonth}.`,
    monthsUsed: lines.length ? [priorMonth] : [],
    lines,
  };
}

function buildScheduled(input: BudgetPlanInput): BudgetPlanProposal {
  const accountIds = ordinaryAccountIds(input.accounts);
  const templates = new Map(
    input.schedules
      .filter((item) => !item.archived && item.enabled && item.kind === "transaction" && item.amountMinor < 0 && accountIds.has(item.accountId))
      .map((item) => [item.id, item]),
  );
  const monthPrefix = `${input.targetMonth}-`;
  const byCategory = new Map<string, { category: string; amountMinor: number; count: number }>();

  for (const occurrence of input.occurrences) {
    if (!occurrence.dueDate.startsWith(monthPrefix)) continue;
    // Posted/linked occurrences already appear in transaction history for other sources.
    // For the scheduled source, count every due obligation once via the template amount so a
    // matching posted payment does not invent a second proposal line.
    if (occurrence.status !== "expected" && occurrence.status !== "posted" && occurrence.status !== "linked") continue;
    const template = templates.get(occurrence.scheduledTransactionId);
    if (!template) continue;
    const label = template.category.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const current = byCategory.get(key) ?? { category: label, amountMinor: 0, count: 0 };
    current.amountMinor = sumMoney([current.amountMinor, -template.amountMinor]);
    current.count += 1;
    byCategory.set(key, current);
  }

  const current = currentByCategory(input.currentBudget);
  const lines: BudgetPlanProposalLine[] = [...byCategory.entries()]
    .map(([key, row]) => {
      const existing = current.get(key);
      return {
        key,
        category: existing?.category ?? row.category,
        currentPlannedMinor: existing?.plannedMinor ?? 0,
        suggestedPlannedMinor: row.amountMinor,
        basis: `${row.count} scheduled ${row.count === 1 ? "item" : "items"}`,
        budgetCategoryId: existing?.id,
        rolloverEnabled: existing?.rolloverEnabled,
        selected: row.amountMinor > 0,
      };
    })
    .filter((line) => line.suggestedPlannedMinor > 0)
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    source: "scheduled",
    targetMonth: input.targetMonth,
    label: SOURCE_LABELS.scheduled,
    detail: lines.length
      ? `Ordinary expense schedules due in ${input.targetMonth}. Transfers and deposits are excluded.`
      : `No ordinary expense schedules are due in ${input.targetMonth}.`,
    monthsUsed: lines.length ? [input.targetMonth] : [],
    lines,
  };
}

export function buildBudgetPlanProposal(source: BudgetHistorySource, input: BudgetPlanInput): BudgetPlanProposal {
  validateMonth(input.targetMonth);
  switch (source) {
    case "average-3":
    case "average-6":
      return buildAverageProposal(source, input);
    case "same-month-last-year":
      return buildSameMonthLastYear(input);
    case "previous-plan":
      return buildPreviousPlan(input);
    case "scheduled":
      return buildScheduled(input);
  }
}

export function applyBudgetPlanSelection(
  lines: readonly BudgetPlanProposalLine[],
  selectedKeys: ReadonlySet<string>,
): BudgetPlanProposalLine[] {
  return lines.map((line) => ({ ...line, selected: selectedKeys.has(line.key) }));
}

export { SOURCE_LABELS };
