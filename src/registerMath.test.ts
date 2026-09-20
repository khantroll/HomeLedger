import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";
import { REGISTER_PAGE_SIZE, runningBalances } from "./domain";
import {
  assertRegisterPageContinuity,
  filteredBalanceUnavailableReason,
  latestRegisterBalanceEqualsAccount,
  mergeOlderRegisterPage,
  newerBalancesUnchanged,
  nextOlderRegisterOffset,
  registerRunningBalances,
  registerShowsLedgerBalance,
} from "./registerMath";

describe("registerMath", () => {
  it("shows ledger balance only for contiguous account history", () => {
    expect(registerShowsLedgerBalance({ status: "all" })).toBe(true);
    expect(registerShowsLedgerBalance({ status: "all", search: "  " })).toBe(true);
    expect(registerShowsLedgerBalance({ status: "review" })).toBe(false);
    expect(registerShowsLedgerBalance({ status: "all", search: "Utility" })).toBe(false);
    expect(filteredBalanceUnavailableReason({ status: "pending" })).toMatch(/status filter/);
    expect(filteredBalanceUnavailableReason({ status: "all", search: "x" })).toMatch(/search/);
  });

  it("keeps newer running balances stable when earlier history is prepended", () => {
    const newer = {
      priorBalanceMinor: 10_000,
      transactions: [
        { amountMinor: -100 },
        { amountMinor: 250 },
        { amountMinor: -50 },
      ],
    };
    const olderAmounts = [{ amountMinor: 500 }, { amountMinor: -200 }];
    const after = {
      priorBalanceMinor: 9_700,
      transactions: [...olderAmounts, ...newer.transactions],
    };
    expect(newerBalancesUnchanged(newer, after)).toBe(true);
    expect(registerRunningBalances(after.priorBalanceMinor, after.transactions).slice(2)).toEqual(
      registerRunningBalances(newer.priorBalanceMinor, newer.transactions),
    );
  });
});

describe("multi-page register history", () => {
  async function seedDeepLedger(count = 250) {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({
      name: "Paging Checking",
      type: "checking",
      currency: "USD",
      openingBalanceMinor: 500_000,
      ownerLabel: "Household",
    });
    for (let index = 0; index < count; index += 1) {
      const day = String((index % 28) + 1).padStart(2, "0");
      const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, "0");
      const year = 2010 + Math.floor(index / (28 * 12));
      await repository.createTransaction({
        accountId: account.id,
        postedDate: `${year}-${month}-${day}`,
        payee: `History ${String(index).padStart(4, "0")}`,
        category: index % 5 === 0 ? "Income" : "Archive",
        amountMinor: index % 5 === 0 ? 25 : -1,
        status: index % 3 === 0 ? "pending" : "cleared",
      });
    }
    const accounts = await repository.listAccounts();
    const current = accounts.find((item) => item.id === account.id)!;
    return { repository, account: current };
  }

  it("pages without gaps or duplicates and stays oldest→newest across Load earlier", async () => {
    const { repository, account } = await seedDeepLedger(250);
    const newest = await repository.listTransactionsPage({ accountId: account.id, limit: 100, newest: true });
    assertRegisterPageContinuity(newest);
    expect(newest.offset).toBe(150);
    expect(newest.transactions).toHaveLength(100);
    expect(newest.transactions[0]?.payee).toBe("History 0150");
    expect(newest.transactions.at(-1)?.payee).toBe("History 0249");

    const olderRequest = nextOlderRegisterOffset(newest.offset);
    const older = await repository.listTransactionsPage({
      accountId: account.id,
      offset: olderRequest.offset,
      limit: olderRequest.limit,
    });
    assertRegisterPageContinuity(older);
    expect(older.transactions.at(-1)?.payee).toBe("History 0149");

    const merged = mergeOlderRegisterPage(
      {
        transactions: newest.transactions,
        offset: newest.offset,
        priorBalanceMinor: newest.priorBalanceMinor ?? 0,
        totalCount: newest.totalCount,
      },
      older,
    );
    expect(merged.transactions).toHaveLength(200);
    expect(new Set(merged.transactions.map((item) => item.id)).size).toBe(200);
    expect(merged.transactions[0]?.payee).toBe("History 0050");
    expect(merged.transactions.at(-1)?.payee).toBe("History 0249");
    for (let index = 1; index < merged.transactions.length; index += 1) {
      expect(merged.transactions[index - 1].postedDate <= merged.transactions[index].postedDate).toBe(true);
    }
  });

  it("keeps running balances correct across page boundaries and equal to the account balance at the end", async () => {
    const { repository, account } = await seedDeepLedger(250);
    const newest = await repository.listTransactionsPage({ accountId: account.id, limit: REGISTER_PAGE_SIZE, newest: true });
    const before = {
      priorBalanceMinor: newest.priorBalanceMinor ?? 0,
      transactions: newest.transactions,
    };
    const beforeBalances = runningBalances(before.priorBalanceMinor, before.transactions);
    expect(latestRegisterBalanceEqualsAccount(before.priorBalanceMinor, before.transactions, account.balanceMinor)).toBe(true);

    const olderRequest = nextOlderRegisterOffset(newest.offset);
    const older = await repository.listTransactionsPage({
      accountId: account.id,
      offset: olderRequest.offset,
      limit: olderRequest.limit,
    });
    const merged = mergeOlderRegisterPage(
      {
        transactions: newest.transactions,
        offset: newest.offset,
        priorBalanceMinor: newest.priorBalanceMinor ?? 0,
        totalCount: newest.totalCount,
      },
      older,
    );
    expect(
      newerBalancesUnchanged(before, {
        priorBalanceMinor: merged.priorBalanceMinor,
        transactions: merged.transactions,
      }),
    ).toBe(true);
    const afterBalances = runningBalances(merged.priorBalanceMinor, merged.transactions);
    expect(afterBalances.slice(older.transactions.length)).toEqual(beforeBalances);
    expect(latestRegisterBalanceEqualsAccount(merged.priorBalanceMinor, merged.transactions, account.balanceMinor)).toBe(true);

    const earliest = await repository.listTransactionsPage({ accountId: account.id, offset: 0, limit: merged.offset });
    const full = mergeOlderRegisterPage(
      {
        transactions: merged.transactions,
        offset: merged.offset,
        priorBalanceMinor: merged.priorBalanceMinor,
        totalCount: merged.totalCount,
      },
      earliest,
    );
    expect(full.transactions).toHaveLength(250);
    expect(full.offset).toBe(0);
    expect(latestRegisterBalanceEqualsAccount(full.priorBalanceMinor, full.transactions, account.balanceMinor)).toBe(true);
    expect(full.priorBalanceMinor).toBe(500_000);
  });

  it("does not treat status-filtered pages as contiguous ledger balances", async () => {
    const { repository, account } = await seedDeepLedger(120);
    expect(registerShowsLedgerBalance({ status: "pending" })).toBe(false);
    const pending = await repository.listTransactionsPage({
      accountId: account.id,
      status: "pending",
      newest: true,
      limit: 40,
    });
    assertRegisterPageContinuity(pending);
    // Prior is still the true ledger balance before the first visible row, but applying
    // runningBalances only across pending rows would skip intervening cleared activity.
    const misleading = runningBalances(pending.priorBalanceMinor ?? 0, pending.transactions);
    expect(misleading.at(-1)).not.toBe(account.balanceMinor);
  });

  it("keeps date-filtered contiguous windows as true ledger balances through the visible span", async () => {
    const { repository, account } = await seedDeepLedger(80);
    const page = await repository.listTransactionsPage({
      accountId: account.id,
      fromDate: "2010-02-01",
      toDate: "2010-03-28",
      newest: true,
      limit: 100,
    });
    expect(registerShowsLedgerBalance({ status: "all" })).toBe(true);
    assertRegisterPageContinuity(page);
    const balances = runningBalances(page.priorBalanceMinor ?? 0, page.transactions);
    // First visible balance equals true ledger after that row.
    const all = (await repository.listTransactions(account.id)).reverse();
    const first = page.transactions[0];
    const earlier = all.filter((item) => item.postedDate < first.postedDate || (item.postedDate === first.postedDate && item.id < first.id));
    const expectedFirst = 500_000 + earlier.reduce((total, item) => total + item.amountMinor, 0) + first.amountMinor;
    expect(balances[0]).toBe(expectedFirst);
  });
});
