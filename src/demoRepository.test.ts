import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";

describe("finance repository contract", () => {
  it("creates an account and persists it for the repository lifetime", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({
      name: "Test Account", type: "checking", currency: "USD",
      openingBalanceMinor: 10000, ownerLabel: "Household"
    });
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(10000);
  });

  it("updates the computed account balance after a transaction", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({
      name: "Test Account", type: "checking", currency: "USD",
      openingBalanceMinor: 10000, ownerLabel: "Household"
    });
    await repository.createTransaction({
      accountId: account.id, postedDate: "2026-09-18", payee: "Test Payee",
      category: "Test", amountMinor: -2500, status: "cleared"
    });
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(7500);
  });

  it("retains import history and reverses a complete batch", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Import Account", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const result = await repository.importTransactions({ accountId: account.id, sourceName: "statement.csv", rows: [
      { postedDate: "2026-09-01", payee: "Store", amountMinor: -2500 },
      { postedDate: "2026-09-02", payee: "Payroll", amountMinor: 5000 }
    ] });
    expect((await repository.listImportBatches())[0]).toMatchObject({ transactionCount: 2, totalMinor: 2500 });
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(12500);
    expect((await repository.undoImportBatch(result.batchId)).removedCount).toBe(2);
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(10000);
    expect((await repository.listImportBatches())[0].undoneAt).toBeTruthy();
  });

  it("creates, edits, and deletes balanced split transactions", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Split Account", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const transaction = await repository.createTransaction({ accountId: account.id, postedDate: "2026-09-18", payee: "Store", category: "Split transaction", amountMinor: -3000, status: "cleared", splits: [
      { category: "Food", amountMinor: -2000 }, { category: "Household", amountMinor: -1000 }
    ] });
    expect(transaction.splits).toHaveLength(2);
    const updated = await repository.updateTransaction(transaction.id, { accountId: account.id, postedDate: "2026-09-18", payee: "Store", category: "Food", amountMinor: -2500, status: "cleared" });
    expect(updated).toMatchObject({ amountMinor: -2500, category: "Food" });
    await repository.deleteTransaction(transaction.id);
    expect((await repository.listTransactions()).some(item=>item.id===transaction.id)).toBe(false);
    expect((await repository.listAccounts()).find(item=>item.id===account.id)?.balanceMinor).toBe(10000);
  });

  it("creates, synchronizes, and deletes both sides of a linked transfer", async () => {
    const repository = new DemoFinanceRepository();
    const from = await repository.createAccount({ name: "Checking", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const to = await repository.createAccount({ name: "Savings", type: "savings", currency: "USD", openingBalanceMinor: 2000, ownerLabel: "Household" });
    const transfer = await repository.createTransfer({ fromAccountId: from.id, toAccountId: to.id, postedDate: "2026-09-18", payee: "Savings transfer", amountMinor: 2500, status: "cleared" });
    let pair = (await repository.listTransactions()).filter(item=>item.transferLinkId===transfer.linkId);
    expect(pair.map(item=>item.amountMinor).sort((a,b)=>a-b)).toEqual([-2500,2500]);
    expect((await repository.listAccounts()).find(item=>item.id===from.id)?.balanceMinor).toBe(7500);
    expect((await repository.listAccounts()).find(item=>item.id===to.id)?.balanceMinor).toBe(4500);
    await expect(repository.updateTransaction(pair[0].id,{accountId:from.id,postedDate:"2026-09-18",payee:"Bad edit",category:"Transfer",amountMinor:-100,status:"cleared"})).rejects.toThrow("transfer editor");
    await repository.updateTransfer(transfer.linkId,{fromAccountId:from.id,toAccountId:to.id,postedDate:"2026-09-19",payee:"Updated transfer",amountMinor:1000,status:"cleared"});
    pair = (await repository.listTransactions()).filter(item=>item.transferLinkId===transfer.linkId);
    expect(pair.map(item=>item.amountMinor).sort((a,b)=>a-b)).toEqual([-1000,1000]);
    expect(pair.every(item=>item.status==="cleared")).toBe(true);
    await repository.deleteTransfer(transfer.linkId);
    expect((await repository.listTransactions()).some(item=>item.transferLinkId===transfer.linkId)).toBe(false);
    expect((await repository.listAccounts()).find(item=>item.id===from.id)?.balanceMinor).toBe(10000);
    expect((await repository.listAccounts()).find(item=>item.id===to.id)?.balanceMinor).toBe(2000);
  });

  it("rejects cross-currency linked transfers", async () => {
    const repository = new DemoFinanceRepository();
    const usd = await repository.createAccount({ name: "USD", type: "checking", currency: "USD", openingBalanceMinor: 0, ownerLabel: "Household" });
    const eur = await repository.createAccount({ name: "EUR", type: "checking", currency: "EUR", openingBalanceMinor: 0, ownerLabel: "Household" });
    await expect(repository.createTransfer({fromAccountId:usd.id,toAccountId:eur.id,postedDate:"2026-09-18",payee:"FX",amountMinor:100,status:"cleared"})).rejects.toThrow("different currencies");
  });

  it("completes a balanced statement reconciliation and protects its transactions", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Checking", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const deposit = await repository.createTransaction({ accountId: account.id, postedDate: "2026-09-01", payee: "Deposit", category: "Income", amountMinor: 5000, status: "cleared" });
    const purchase = await repository.createTransaction({ accountId: account.id, postedDate: "2026-09-02", payee: "Store", category: "Food", amountMinor: -1250, status: "review" });
    await expect(repository.completeReconciliation({ accountId: account.id, statementEndDate: "2026-09-30", openingBalanceMinor: 10000, closingBalanceMinor: 14000, transactionIds: [deposit.id, purchase.id] })).rejects.toThrow("closing balance");
    const result = await repository.completeReconciliation({ accountId: account.id, statementEndDate: "2026-09-30", openingBalanceMinor: 10000, closingBalanceMinor: 13750, transactionIds: [deposit.id, purchase.id] });
    expect(result).toMatchObject({ transactionCount: 2, adjustmentTotalMinor: 3750 });
    expect((await repository.listReconciliationTransactions(account.id, "2026-09-30"))).toHaveLength(0);
    expect((await repository.listReconciliations(account.id))).toHaveLength(1);
    await expect(repository.updateTransaction(purchase.id, { accountId: account.id, postedDate: "2026-09-02", payee: "Store", category: "Food", amountMinor: -1250, status: "cleared" })).rejects.toThrow("cannot be edited");
    await expect(repository.deleteTransaction(purchase.id)).rejects.toThrow("cannot be deleted");
  });
});
