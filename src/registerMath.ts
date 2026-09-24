import {
  REGISTER_PAGE_SIZE,
  runningBalances,
  sumMoney,
  type Transaction,
  type TransactionPage,
  type TransactionQuery,
  type TransactionStatusFilter,
} from "./domain";

/** True ledger Balance column only when the visible rows are contiguous account history. */
export function registerShowsLedgerBalance(query: Pick<TransactionQuery, "status" | "search" | "flaggedOnly">): boolean {
  const status = (query.status ?? "all") as TransactionStatusFilter;
  const search = query.search?.trim();
  return status === "all" && !search && !query.flaggedOnly;
}

export function compareRegisterOrder(a: Pick<Transaction, "postedDate" | "id">, b: Pick<Transaction, "postedDate" | "id">): number {
  return a.postedDate.localeCompare(b.postedDate) || a.id.localeCompare(b.id);
}

export function assertRegisterPageContinuity(page: TransactionPage): void {
  const ids = new Set<string>();
  for (let index = 0; index < page.transactions.length; index += 1) {
    const row = page.transactions[index];
    if (ids.has(row.id)) throw new Error(`Duplicate transaction ${row.id} in register page`);
    ids.add(row.id);
    if (index === 0) continue;
    if (compareRegisterOrder(page.transactions[index - 1], row) > 0) {
      throw new Error("Register page is not ordered oldest→newest");
    }
  }
  if (page.offset < 0 || page.limit < 1) throw new Error("Register page bounds are invalid");
  if (page.offset + page.transactions.length > page.totalCount) throw new Error("Register page extends past totalCount");
}

export function mergeOlderRegisterPage(
  current: { transactions: Transaction[]; offset: number; priorBalanceMinor: number; totalCount: number },
  older: TransactionPage,
): { transactions: Transaction[]; offset: number; priorBalanceMinor: number; totalCount: number } {
  assertRegisterPageContinuity(older);
  if (older.offset + older.transactions.length !== current.offset) {
    throw new Error("Older register page does not abut the current window");
  }
  const seen = new Set(current.transactions.map((item) => item.id));
  for (const row of older.transactions) {
    if (seen.has(row.id)) throw new Error(`Duplicate transaction ${row.id} when merging register pages`);
  }
  const transactions = [...older.transactions, ...current.transactions];
  for (let index = 1; index < transactions.length; index += 1) {
    if (compareRegisterOrder(transactions[index - 1], transactions[index]) > 0) {
      throw new Error("Merged register is not ordered oldest→newest");
    }
  }
  return {
    transactions,
    offset: older.offset,
    priorBalanceMinor: older.priorBalanceMinor ?? 0,
    totalCount: older.totalCount,
  };
}

export function registerRunningBalances(priorBalanceMinor: number, transactions: readonly Pick<Transaction, "amountMinor">[]): number[] {
  return runningBalances(priorBalanceMinor, transactions);
}

/** Verify newer-row balances are unchanged after prepending an older page. */
export function newerBalancesUnchanged(
  before: { priorBalanceMinor: number; transactions: readonly Pick<Transaction, "amountMinor">[] },
  after: { priorBalanceMinor: number; transactions: readonly Pick<Transaction, "amountMinor">[] },
): boolean {
  const beforeBalances = registerRunningBalances(before.priorBalanceMinor, before.transactions);
  const afterBalances = registerRunningBalances(after.priorBalanceMinor, after.transactions);
  const shift = after.transactions.length - before.transactions.length;
  if (shift < 0) return false;
  return beforeBalances.every((balance, index) => balance === afterBalances[index + shift]);
}

export function latestRegisterBalanceEqualsAccount(
  priorBalanceMinor: number,
  transactions: readonly Pick<Transaction, "amountMinor">[],
  accountBalanceMinor: number,
): boolean {
  if (!transactions.length) return priorBalanceMinor === accountBalanceMinor;
  const balances = registerRunningBalances(priorBalanceMinor, transactions);
  return balances[balances.length - 1] === accountBalanceMinor;
}

export function nextOlderRegisterOffset(currentOffset: number, pageSize = REGISTER_PAGE_SIZE): { offset: number; limit: number } {
  const offset = Math.max(0, currentOffset - pageSize);
  return { offset, limit: currentOffset - offset };
}

export function filteredBalanceUnavailableReason(query: Pick<TransactionQuery, "status" | "search" | "flaggedOnly">): string | undefined {
  if (registerShowsLedgerBalance(query)) return undefined;
  if (query.search?.trim()) return "Running balance hides while search is active so skipped rows cannot distort the ledger.";
  if (query.flaggedOnly) return "Running balance hides while the flagged filter is active so skipped rows cannot distort the ledger.";
  return "Running balance hides while a status filter is active so skipped rows cannot distort the ledger.";
}

export function sumAmounts(transactions: readonly Pick<Transaction, "amountMinor">[]): number {
  return sumMoney(transactions.map((item) => item.amountMinor));
}
