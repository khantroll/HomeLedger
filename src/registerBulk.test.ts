import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";
import { normalizeBulkStatus, registerBulkEligibility, selectedIdsEligibleFor } from "./registerBulk";
import type { Transaction } from "./domain";

describe("registerBulk eligibility", () => {
  it("protects transfers, splits, reconciled, and imported rows", () => {
    const rows: Transaction[] = [
      { id: "ok", accountId: "checking", postedDate: "2026-09-17", payee: "Market", category: "Food: Groceries", amountMinor: -100, status: "review" },
      { id: "xfer", accountId: "checking", postedDate: "2026-09-14", payee: "Move", category: "Transfer: Savings", amountMinor: -50, status: "cleared", transferLinkId: "link", source: "transfer" },
      { id: "split", accountId: "checking", postedDate: "2026-09-13", payee: "Trip", category: "Split transaction", amountMinor: -150, status: "cleared", splits: [{ id: "s1", category: "Food", amountMinor: -80 }, { id: "s2", category: "Travel", amountMinor: -70 }] },
      { id: "rec", accountId: "checking", postedDate: "2026-09-12", payee: "Old", category: "Housing", amountMinor: -20, status: "reconciled" },
      { id: "imp", accountId: "checking", postedDate: "2026-09-11", payee: "Import", category: "Food", amountMinor: -30, status: "cleared", importBatchId: "batch" },
    ];
    expect(registerBulkEligibility(rows[0])).toMatchObject({ category: true, status: true, delete: true });
    expect(registerBulkEligibility(rows[1]).category).toBe(false);
    expect(registerBulkEligibility(rows[2]).category).toBe(false);
    expect(registerBulkEligibility(rows[2]).status).toBe(true);
    expect(registerBulkEligibility(rows[3]).status).toBe(false);
    expect(registerBulkEligibility(rows[4]).delete).toBe(false);
    const selected = selectedIdsEligibleFor(rows, new Set(["ok", "xfer", "split"]), "category");
    expect(selected.eligibleIds).toEqual(["ok"]);
    expect(selected.blocked.map((item) => item.id).sort()).toEqual(["split", "xfer"]);
    expect(normalizeBulkStatus("review")).toBe("review");
  });
});

describe("DemoFinanceRepository bulk register actions", () => {
  it("updates category and status for eligible rows and rolls back when a protected member is included", async () => {
    const repository = new DemoFinanceRepository();
    const before = await repository.listTransactions("checking");
    const groceries = before.find((item) => item.id === "t2")!;
    const utilities = before.find((item) => item.id === "t3")!;
    await repository.bulkUpdateTransactionStatus({ transactionIds: [groceries.id, utilities.id], status: "cleared" });
    expect((await repository.listTransactions()).find((item) => item.id === "t2")?.status).toBe("cleared");

    await repository.bulkSetTransactionCategory({ transactionIds: [groceries.id, utilities.id], category: "Food: Market" });
    expect((await repository.listCategories())).toContain("Food: Market");

    const balanceBefore = (await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor;
    await expect(repository.bulkSetTransactionCategory({
      transactionIds: [groceries.id, "t5"],
      category: "Housing",
    })).rejects.toThrow(/Reconciled|Transfer|transfer/i);
    expect((await repository.listTransactions()).find((item) => item.id === "t2")?.category).toBe("Food: Market");
    expect((await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor).toBe(balanceBefore);

    await expect(repository.bulkDeleteTransactions({ transactionIds: [utilities.id, "t5"] })).rejects.toThrow(/Reconciled|Transfer|transfer|Imported/i);
    expect((await repository.listTransactions()).some((item) => item.id === "t3")).toBe(true);

    await repository.bulkDeleteTransactions({ transactionIds: [utilities.id] });
    expect((await repository.listTransactions()).some((item) => item.id === "t3")).toBe(false);
    expect((await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor).toBe(balanceBefore - utilities.amountMinor);
  });

  it("rejects bulk category changes for split transactions without mutating earlier ids", async () => {
    const repository = new DemoFinanceRepository();
    const split = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-10",
      payee: "Trip",
      category: "Split transaction",
      amountMinor: -1500,
      status: "cleared",
      splits: [
        { category: "Food: Groceries", amountMinor: -900 },
        { category: "Travel", amountMinor: -600 },
      ],
    });
    const ordinary = (await repository.listTransactions()).find((item) => item.id === "t2")!;
    await expect(repository.bulkSetTransactionCategory({
      transactionIds: [ordinary.id, split.id],
      category: "Housing",
    })).rejects.toThrow(/Split/);
    expect((await repository.listTransactions()).find((item) => item.id === ordinary.id)?.category).toBe("Food: Groceries");
  });
});
