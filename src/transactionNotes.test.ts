import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";
import { financialFind } from "./financialFind";
import { TRANSACTION_NOTE_MAX_LENGTH } from "./domain";

describe("transaction notes and flags", () => {
  it("creates, edits, clears notes and toggles flags without changing balances", async () => {
    const repository = new DemoFinanceRepository();
    const before = (await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor;
    const created = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-20",
      payee: "Hardware",
      category: "Home",
      amountMinor: -2500,
      status: "cleared",
      memo: "Ask about warranty",
      flagged: true,
    });
    expect(created.memo).toBe("Ask about warranty");
    expect(created.flagged).toBe(true);

    const annotated = await repository.updateTransactionAnnotation(created.id, {
      updateMemo: true,
      memo: "  Called store  ",
      flagged: false,
    });
    expect(annotated.memo).toBe("Called store");
    expect(annotated.flagged).toBe(false);

    const updated = await repository.updateTransaction(created.id, {
      accountId: "checking",
      postedDate: "2026-09-20",
      payee: "Hardware Store",
      category: "Home: Repairs",
      amountMinor: -2500,
      status: "pending",
      memo: "Called store",
      flagged: true,
    });
    expect(updated.payee).toBe("Hardware Store");
    expect(updated.memo).toBe("Called store");
    expect(updated.flagged).toBe(true);

    const cleared = await repository.updateTransactionAnnotation(created.id, {
      updateMemo: true,
      memo: "   ",
    });
    expect(cleared.memo).toBeUndefined();
    expect(cleared.flagged).toBe(true);

    const after = (await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor;
    expect(after).toBe(before - 2500);
  });

  it("finds note-only matches and filters flagged rows", async () => {
    const repository = new DemoFinanceRepository();
    const noted = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-18",
      payee: "Quiet Merchant",
      category: "Misc",
      amountMinor: -100,
      status: "cleared",
      memo: "zebra-only-note-phrase",
      flagged: true,
    });
    await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-19",
      payee: "Other",
      category: "Misc",
      amountMinor: -50,
      status: "cleared",
    });

    const page = await repository.listTransactionsPage({ search: "zebra-only-note-phrase", newest: true });
    expect(page.totalCount).toBe(1);
    expect(page.transactions[0].id).toBe(noted.id);

    const flagged = await repository.listTransactionsPage({ flaggedOnly: true, newest: true });
    expect(flagged.totalCount).toBe(1);
    expect(flagged.transactions[0].id).toBe(noted.id);

    const accounts = await repository.listAccounts();
    const transactions = await repository.listTransactions();
    const hits = financialFind("zebra-only-note-phrase", {
      accounts,
      transactions,
      schedules: [],
      securities: [],
    });
    expect(hits.some((hit) => hit.kind === "transaction" && hit.transactionId === noted.id)).toBe(true);
  });

  it("rejects oversized notes and keeps import provenance when annotating", async () => {
    const repository = new DemoFinanceRepository();
    await expect(
      repository.createTransaction({
        accountId: "checking",
        postedDate: "2026-09-20",
        payee: "Long",
        category: "Misc",
        amountMinor: -10,
        status: "cleared",
        memo: "x".repeat(TRANSACTION_NOTE_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow(/too long/i);

    const imported = await repository.importTransactions({
      accountId: "checking",
      sourceName: "statement.csv",
      rows: [
        {
          postedDate: "2026-09-21",
          payee: "UTILITY",
          originalPayee: "UTILITY CO",
          amountMinor: -3300,
          memo: "bank memo",
          externalId: "ext-note-1",
        },
      ],
    });
    expect(imported.importedCount).toBe(1);
    const row = (await repository.listTransactions("checking")).find((item) => item.externalId === "ext-note-1")!;
    expect(row.originalPayee).toBe("UTILITY CO");
    expect(row.memo).toBe("bank memo");
    expect(row.flagged).toBeFalsy();

    const annotated = await repository.updateTransactionAnnotation(row.id, {
      updateMemo: true,
      memo: "User follow-up",
      flagged: true,
    });
    expect(annotated.memo).toBe("User follow-up");
    expect(annotated.flagged).toBe(true);
    expect(annotated.originalPayee).toBe("UTILITY CO");
    expect(annotated.externalId).toBe("ext-note-1");
    expect(annotated.importBatchId).toBeTruthy();

    await expect(
      repository.importTransactions({
        accountId: "checking",
        sourceName: "statement.csv",
        rows: [
          {
            postedDate: "2026-09-21",
            payee: "UTILITY",
            originalPayee: "UTILITY CO",
            amountMinor: -3300,
            memo: "should not overwrite",
            externalId: "ext-note-1",
          },
        ],
      }),
    ).rejects.toThrow(/already exists/i);

    const preserved = (await repository.listTransactions("checking")).find((item) => item.id === row.id)!;
    expect(preserved.memo).toBe("User follow-up");
    expect(preserved.flagged).toBe(true);
    expect(preserved.originalPayee).toBe("UTILITY CO");
  });
});
