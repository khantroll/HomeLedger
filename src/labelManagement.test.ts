import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";
import { buildCategoryUsage, buildPayeeUsage, categoryHierarchyParts, filterLabelUsage } from "./labelVocabulary";
import { calculateTransactionReport } from "./reportMath";
import type { MerchantRule, ScheduledTransaction, Transaction } from "./domain";

describe("labelVocabulary", () => {
  it("exposes colon hierarchy parts without inventing parent rollups", () => {
    expect(categoryHierarchyParts("Food: Groceries")).toEqual({ parent: "Food", leaf: "Groceries" });
    expect(categoryHierarchyParts("Housing")).toEqual({ leaf: "Housing" });
  });

  it("counts split, schedule, budget, and rule references for categories", () => {
    const transactions: Transaction[] = [
      { id: "t1", accountId: "a", postedDate: "2026-08-02", payee: "Market", category: "Food: Groceries", amountMinor: -1000, status: "cleared" },
      {
        id: "t2",
        accountId: "a",
        postedDate: "2026-08-03",
        payee: "Trip",
        category: "Split transaction",
        amountMinor: -1500,
        status: "cleared",
        splits: [
          { id: "s1", category: "Food: Groceries", amountMinor: -900 },
          { id: "s2", category: "Food: Dining", amountMinor: -600 },
        ],
      },
    ];
    const schedules: ScheduledTransaction[] = [
      {
        id: "sched",
        kind: "transaction",
        accountId: "a",
        payee: "Market",
        category: "Food: Groceries",
        amountMinor: -500,
        status: "cleared",
        frequency: "monthly",
        anchorDate: "2026-08-01",
        enabled: true,
      },
    ];
    const rules: MerchantRule[] = [
      {
        id: "r1",
        name: "Market",
        pattern: "MARKET",
        matchType: "contains",
        direction: "expense",
        category: "Food: Groceries",
        priority: 10,
        enabled: true,
      },
    ];
    const rows = buildCategoryUsage(["Food: Groceries", "Food: Dining"], transactions, schedules, [{ id: "b1", category: "Food: Groceries", rolloverEnabled: false }], rules);
    const groceries = rows.find((row) => row.name === "Food: Groceries");
    expect(groceries).toMatchObject({ transactionCount: 1, splitCount: 1, scheduleCount: 1, budgetCount: 1, ruleCount: 1, referenceCount: 5, lastUsed: "2026-08-03" });
    expect(filterLabelUsage(rows, "dining").map((row) => row.name)).toEqual(["Food: Dining"]);
  });

  it("counts payee usage without treating originalPayee as a rename target", () => {
    const transactions: Transaction[] = [
      { id: "t1", accountId: "a", postedDate: "2026-08-01", payee: "Corner Cafe", originalPayee: "CORNER BAKERY", category: "Food", amountMinor: -100, status: "cleared" },
    ];
    const rows = buildPayeeUsage(["Corner Cafe", "Unused"], transactions, [], []);
    expect(rows.find((row) => row.name === "Corner Cafe")?.referenceCount).toBe(1);
    expect(rows.find((row) => row.name === "Unused")?.memoryOnly).toBe(true);
  });
});

describe("DemoFinanceRepository label management", () => {
  it("renames and merges categories across splits, schedules, budgets, and rules", async () => {
    const repository = new DemoFinanceRepository();
    await repository.createBudgetCategory({ category: "Food: Groceries", rolloverEnabled: true });
    await repository.createBudgetCategory({ category: "Food: Dining", rolloverEnabled: false });
    const groceries = (await repository.listBudgetCategories()).find((item) => item.category === "Food: Groceries")!;
    const dining = (await repository.listBudgetCategories()).find((item) => item.category === "Food: Dining")!;
    await repository.setBudgetAllocation({ budgetCategoryId: groceries.id, month: "2026-08", plannedMinor: 4000 });
    await repository.setBudgetAllocation({ budgetCategoryId: dining.id, month: "2026-08", plannedMinor: 2000 });
    await repository.createScheduledTransaction({
      kind: "transaction",
      accountId: "checking",
      payee: "Market",
      category: "Food: Groceries",
      amountMinor: -500,
      status: "cleared",
      frequency: "monthly",
      anchorDate: "2026-08-01",
      enabled: true,
    });
    await repository.createMerchantRule({
      name: "Market groceries",
      pattern: "MARKET",
      matchType: "contains",
      direction: "expense",
      renameTo: "Neighborhood Market",
      category: "Food: Groceries",
      priority: 20,
      enabled: true,
    });
    await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-08-04",
      payee: "Trip",
      category: "Split transaction",
      amountMinor: -1500,
      status: "cleared",
      splits: [
        { category: "Food: Groceries", amountMinor: -900 },
        { category: "Food: Dining", amountMinor: -600 },
      ],
    });

    const accounts = await repository.listAccounts();
    const beforeBalances = Object.fromEntries(accounts.map((item) => [item.id, item.balanceMinor]));
    const renamed = await repository.renameCategory("Food: Groceries", "Food: Market");
    expect(renamed.operation).toBe("rename");
    expect(renamed.splits).toBeGreaterThan(0);
    await expect(repository.renameCategory("Food: Market", "Food: Dining")).rejects.toThrow(/use merge/i);
    const merged = await repository.mergeCategories("Food: Market", "Food: Dining");
    expect(merged.operation).toBe("merge");

    const categories = await repository.listCategories();
    expect(categories).toContain("Food: Dining");
    expect(categories.some((item) => item.toLocaleLowerCase() === "food: market")).toBe(false);
    const month = await repository.getBudgetMonth("2026-08");
    const diningLine = month.lines.find((line) => line.category === "Food: Dining");
    expect(diningLine?.plannedMinor).toBe(6000);
    const afterBalances = Object.fromEntries((await repository.listAccounts()).map((item) => [item.id, item.balanceMinor]));
    expect(afterBalances).toEqual(beforeBalances);

    const report = calculateTransactionReport({
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      currency: "USD",
      accounts,
      transactions: await repository.listTransactions(),
    });
    expect(report.categories.some((row) => row.label === "Food: Dining")).toBe(true);
    expect(report.categories.some((row) => row.label.toLocaleLowerCase() === "food: market")).toBe(false);
  });

  it("renames and merges payees while preserving originalPayee and merchant patterns", async () => {
    const repository = new DemoFinanceRepository();
    await repository.createMerchantRule({
      name: "Bakery",
      pattern: "CORNER BAKERY",
      matchType: "contains",
      direction: "expense",
      renameTo: "Corner Bakery",
      category: "Food: Dining",
      priority: 5,
      enabled: true,
    });
    await repository.createScheduledTransaction({
      kind: "transaction",
      accountId: "checking",
      payee: "Corner Bakery",
      category: "Food: Dining",
      amountMinor: -800,
      status: "cleared",
      frequency: "monthly",
      anchorDate: "2026-08-01",
      enabled: true,
    });
    const imported = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-08-05",
      payee: "Corner Bakery",
      category: "Food: Dining",
      amountMinor: -450,
      status: "cleared",
    });
    (repository as unknown as { transactions: Transaction[] }).transactions.find((item) => item.id === imported.id)!.originalPayee = "CORNER BAKERY #9";

    await repository.renamePayee("Corner Bakery", "Neighborhood Bakery");
    const renamedTxn = (await repository.listTransactions()).find((item) => item.id === imported.id)!;
    expect(renamedTxn.payee).toBe("Neighborhood Bakery");
    expect(renamedTxn.originalPayee).toBe("CORNER BAKERY #9");
    const rule = (await repository.listMerchantRules())[0];
    expect(rule.renameTo).toBe("Neighborhood Bakery");
    expect(rule.pattern).toBe("CORNER BAKERY");

    await repository.mergePayees("Neighborhood Bakery", "Neighborhood Market");
    expect(await repository.listPayees()).toContain("Neighborhood Market");
    expect((await repository.listPayees()).some((item) => /bakery/i.test(item))).toBe(false);
  });

  it("rolls back a failed category rewrite and removes unused memory-only labels", async () => {
    const repository = new DemoFinanceRepository();
    const before = await repository.listCategories();
    await expect(repository.mergeCategories("Food: Groceries", "Does Not Exist")).rejects.toThrow(/Target category/);
    expect(await repository.listCategories()).toEqual(before);

    (repository as unknown as { categoryMemory: Set<string> }).categoryMemory.add("Stale: Memory");
    await repository.removeUnusedCategory("Stale: Memory");
    expect(await repository.listCategories()).not.toContain("Stale: Memory");
    await expect(repository.removeUnusedCategory("Food: Groceries")).rejects.toThrow(/still referenced/);
  });

  it("does not treat transfer categories as renamable vocabulary", async () => {
    const repository = new DemoFinanceRepository();
    await expect(repository.renameCategory("Transfer: Vehicle Loan", "Housing")).rejects.toThrow(/Split and transfer/);
  });
});
