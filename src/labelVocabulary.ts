import type { BudgetCategory, MerchantRule, ScheduledTransaction, Transaction } from "./domain";

export type LabelKind = "category" | "payee";

export interface LabelUsageRow {
  name: string;
  parent?: string;
  leaf?: string;
  referenceCount: number;
  transactionCount: number;
  splitCount: number;
  scheduleCount: number;
  budgetCount: number;
  ruleCount: number;
  lastUsed?: string;
  memoryOnly: boolean;
}

export function isRememberedCategoryLabel(value: string): boolean {
  const category = value.trim();
  return Boolean(category) && category !== "Split transaction" && !category.startsWith("Transfer:");
}

export function categoryHierarchyParts(name: string): { parent?: string; leaf: string } {
  const trimmed = name.trim();
  const index = trimmed.indexOf(":");
  if (index <= 0) return { leaf: trimmed };
  return { parent: trimmed.slice(0, index).trim(), leaf: trimmed.slice(index + 1).trim() || trimmed };
}

export function buildCategoryUsage(
  labels: readonly string[],
  transactions: readonly Transaction[],
  schedules: readonly ScheduledTransaction[],
  budgets: readonly BudgetCategory[],
  rules: readonly MerchantRule[],
): LabelUsageRow[] {
  return labels
    .filter(isRememberedCategoryLabel)
    .map((name) => {
      const key = name.trim().toLocaleLowerCase();
      let transactionCount = 0;
      let splitCount = 0;
      let lastUsed: string | undefined;
      for (const item of transactions) {
        if (isRememberedCategoryLabel(item.category) && item.category.trim().toLocaleLowerCase() === key) {
          transactionCount += 1;
          if (!lastUsed || item.postedDate > lastUsed) lastUsed = item.postedDate;
        }
        for (const split of item.splits ?? []) {
          if (split.category.trim().toLocaleLowerCase() === key) {
            splitCount += 1;
            if (!lastUsed || item.postedDate > lastUsed) lastUsed = item.postedDate;
          }
        }
      }
      const scheduleCount = schedules.filter(
        (item) => item.kind === "transaction" && item.category.trim().toLocaleLowerCase() === key,
      ).length;
      const budgetCount = budgets.filter((item) => item.category.trim().toLocaleLowerCase() === key).length;
      const ruleCount = rules.filter((item) => item.category?.trim().toLocaleLowerCase() === key).length;
      const referenceCount = transactionCount + splitCount + scheduleCount + budgetCount + ruleCount;
      const parts = categoryHierarchyParts(name);
      return {
        name,
        parent: parts.parent,
        leaf: parts.leaf,
        referenceCount,
        transactionCount,
        splitCount,
        scheduleCount,
        budgetCount,
        ruleCount,
        lastUsed,
        memoryOnly: referenceCount === 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildPayeeUsage(
  labels: readonly string[],
  transactions: readonly Transaction[],
  schedules: readonly ScheduledTransaction[],
  rules: readonly MerchantRule[],
): LabelUsageRow[] {
  return labels
    .map((name) => {
      const key = name.trim().toLocaleLowerCase();
      let transactionCount = 0;
      let lastUsed: string | undefined;
      for (const item of transactions) {
        if (item.payee.trim().toLocaleLowerCase() === key) {
          transactionCount += 1;
          if (!lastUsed || item.postedDate > lastUsed) lastUsed = item.postedDate;
        }
      }
      const scheduleCount = schedules.filter((item) => item.payee.trim().toLocaleLowerCase() === key).length;
      const ruleCount = rules.filter((item) => item.renameTo?.trim().toLocaleLowerCase() === key).length;
      const referenceCount = transactionCount + scheduleCount + ruleCount;
      return {
        name,
        leaf: name,
        referenceCount,
        transactionCount,
        splitCount: 0,
        scheduleCount,
        budgetCount: 0,
        ruleCount,
        lastUsed,
        memoryOnly: referenceCount === 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterLabelUsage(rows: readonly LabelUsageRow[], query: string): LabelUsageRow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle) || row.leaf?.toLocaleLowerCase().includes(needle) || row.parent?.toLocaleLowerCase().includes(needle));
}
