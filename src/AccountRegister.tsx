import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeftRight, ChevronLeft, Scale, Search } from "lucide-react";
import {
  REGISTER_PAGE_SIZE,
  formatMoney,
  runningBalances,
  type Account,
  type Transaction,
  type TransactionStatus,
  type TransactionStatusFilter,
} from "./domain";
import { financeRepository as repository } from "./repository";
import "./register.css";

export type RegisterDialogRequest =
  | { kind: "transaction"; transaction?: Transaction; accountId?: string }
  | { kind: "transfer"; transaction?: Transaction; accountId?: string }
  | { kind: "reconciliation"; account: Account };

interface AccountRegisterProps {
  accounts: Account[];
  /** When set, lock the register to one account (Accounts → register flow). */
  lockedAccountId?: string;
  /** Optional starting account for the global Transactions view. */
  initialAccountId?: string;
  refreshToken?: number;
  onRequestDialog: (request: RegisterDialogRequest) => void;
  onAccountChange?: (accountId: string | undefined) => void;
}

export function AccountRegister({
  accounts,
  lockedAccountId,
  initialAccountId,
  refreshToken = 0,
  onRequestDialog,
  onAccountChange,
}: AccountRegisterProps) {
  const locked = Boolean(lockedAccountId);
  const [accountId, setAccountId] = useState(lockedAccountId ?? initialAccountId ?? "");
  const [status, setStatus] = useState<TransactionStatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [priorBalanceMinor, setPriorBalanceMinor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (lockedAccountId) setAccountId(lockedAccountId);
  }, [lockedAccountId]);

  useEffect(() => {
    if (!locked && initialAccountId !== undefined) setAccountId(initialAccountId);
  }, [initialAccountId, locked]);

  useEffect(() => {
    if (accountId && !accounts.some((item) => item.id === accountId)) {
      setAccountId(locked ? accounts[0]?.id ?? "" : "");
    }
  }, [accountId, accounts, locked]);

  const selectedAccount = accounts.find((item) => item.id === accountId);
  const showRunningBalance = Boolean(selectedAccount);

  const loadNewest = useCallback(async () => {
    if (locked && !accountId) return;
    setLoading(true);
    setError("");
    try {
      const page = await repository.listTransactionsPage({
        accountId: accountId || undefined,
        limit: REGISTER_PAGE_SIZE,
        newest: true,
        status,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        search: search || undefined,
      });
      setTransactions(page.transactions);
      setOffset(page.offset);
      setTotalCount(page.totalCount);
      setPriorBalanceMinor(page.priorBalanceMinor ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setTransactions([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [accountId, fromDate, locked, search, status, toDate]);

  useEffect(() => {
    void loadNewest();
  }, [loadNewest, refreshToken]);

  async function loadOlder() {
    if (offset <= 0 || loadingOlder) return;
    setLoadingOlder(true);
    setError("");
    try {
      const nextOffset = Math.max(0, offset - REGISTER_PAGE_SIZE);
      const page = await repository.listTransactionsPage({
        accountId: accountId || undefined,
        offset: nextOffset,
        limit: offset - nextOffset,
        status,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        search: search || undefined,
      });
      setTransactions((current) => [...page.transactions, ...current]);
      setOffset(page.offset);
      setPriorBalanceMinor(page.priorBalanceMinor ?? 0);
      setTotalCount(page.totalCount);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingOlder(false);
    }
  }

  const balances = useMemo(
    () => (showRunningBalance ? runningBalances(priorBalanceMinor, transactions) : []),
    [priorBalanceMinor, showRunningBalance, transactions],
  );

  const hasOlder = offset > 0;
  const shownThrough = offset + transactions.length;

  function chooseAccount(next: string) {
    setAccountId(next);
    onAccountChange?.(next || undefined);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearch(draftSearch.trim());
  }

  if (!accounts.length) {
    return <div className="empty-state">Create an account before opening a register.</div>;
  }

  return (
    <div className="account-register">
      <section className="panel register-toolbar">
        <div className="register-identity">
          {selectedAccount ? (
            <>
              <div>
                <h2>{selectedAccount.name}</h2>
                <p>
                  {[selectedAccount.institution, selectedAccount.ownerLabel, accountTypeLabel(selectedAccount.type)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="register-balance">
                <span>Current balance</span>
                <strong className={selectedAccount.balanceMinor < 0 ? "negative" : ""}>
                  {formatMoney(selectedAccount.balanceMinor, selectedAccount.currency)}
                </strong>
              </div>
            </>
          ) : (
            <div>
              <h2>All accounts</h2>
              <p>Browse every ledger entry. Choose one account to see running balances.</p>
            </div>
          )}
        </div>
        <div className="register-actions">
          <button
            disabled={!selectedAccount || accounts.length < 2}
            onClick={() => selectedAccount && onRequestDialog({ kind: "transfer", accountId: selectedAccount.id })}
          >
            <ArrowLeftRight size={13} /> Transfer
          </button>
          <button
            disabled={!selectedAccount}
            onClick={() => selectedAccount && onRequestDialog({ kind: "reconciliation", account: selectedAccount })}
          >
            <Scale size={13} /> Reconcile
          </button>
          <button
            className="primary-action"
            disabled={!accounts.length}
            onClick={() => onRequestDialog({ kind: "transaction", accountId: selectedAccount?.id })}
          >
            + New transaction
          </button>
        </div>
      </section>

      <section className="panel register-filters">
        {!locked && (
          <label>
            Account
            <select
              value={accountId}
              onChange={(event) => chooseAccount(event.target.value)}
              aria-label="Filter register by account"
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as TransactionStatusFilter)}
            aria-label="Filter register by status"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
            <option value="reconciled">Reconciled</option>
            <option value="review">Needs review</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="Filter from date" />
        </label>
        <label>
          Through
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="Filter through date" />
        </label>
        <form className="register-search" onSubmit={applySearch}>
          <Search size={14} />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Payee, category, or memo"
            aria-label="Search register"
          />
          <button type="submit">Search</button>
        </form>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="panel register-ledger">
        <div className="panel-heading">
          <div>
            <h2>Register</h2>
            <p>
              {loading
                ? "Loading…"
                : totalCount === 0
                  ? "No matching transactions"
                  : `Showing ${offset + 1}–${shownThrough} of ${totalCount}`}
            </p>
          </div>
          {hasOlder && (
            <button disabled={loadingOlder} onClick={() => void loadOlder()}>
              <ChevronLeft size={13} />
              {loadingOlder ? "Loading earlier…" : "Load earlier history"}
            </button>
          )}
        </div>
        {loading ? (
          <div className="empty-state">Loading register…</div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            {selectedAccount
              ? "No transactions in this account match the current filters."
              : "No transactions match the current filters."}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  {!selectedAccount && <th>Account</th>}
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Amount</th>
                  {showRunningBalance && <th>Balance</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction, index) => {
                  const account = accounts.find((item) => item.id === transaction.accountId);
                  const currency = account?.currency ?? selectedAccount?.currency;
                  const linked = transaction.transferAccountId
                    ? accounts.find((item) => item.id === transaction.transferAccountId)
                    : undefined;
                  return (
                    <tr key={transaction.id}>
                      {!selectedAccount && <td>{account?.name ?? "Missing account"}</td>}
                      <td>{transaction.postedDate}</td>
                      <td>
                        <strong>{transaction.payee}</strong>
                        {transaction.transferLinkId && (
                          <small className="register-note">
                            <ArrowLeftRight size={11} />
                            {linked ? `Transfer · ${linked.name}` : "Linked transfer"}
                          </small>
                        )}
                      </td>
                      <td className="transaction-category">
                        {transaction.category}
                        {transaction.splits?.length ? <small>{transaction.splits.length} splits</small> : null}
                      </td>
                      <td>
                        <span className={`status ${transaction.status}`}>{statusLabel(transaction.status)}</span>
                      </td>
                      <td className={transaction.amountMinor < 0 ? "amount negative" : "amount positive"}>
                        {formatMoney(transaction.amountMinor, currency)}
                      </td>
                      {showRunningBalance && (
                        <td className={balances[index] < 0 ? "amount negative" : "amount"}>
                          {formatMoney(balances[index], currency)}
                        </td>
                      )}
                      <td>
                        <button
                          className="edit-transaction"
                          onClick={() =>
                            onRequestDialog({
                              kind: transaction.transferLinkId ? "transfer" : "transaction",
                              transaction,
                            })
                          }
                        >
                          {transaction.transferLinkId ? "Transfer" : "Edit"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && hasOlder && (
          <div className="register-pager">
            <button disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading earlier…" : `Load earlier history (${offset} older)`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function accountTypeLabel(type: Account["type"]) {
  switch (type) {
    case "checking":
      return "Checking";
    case "savings":
      return "Savings";
    case "credit":
      return "Credit card";
    case "cash":
      return "Cash";
    case "loan":
      return "Loan";
    case "asset":
      return "Asset";
  }
}

function statusLabel(status: TransactionStatus) {
  return status === "review" ? "Needs review" : status;
}
