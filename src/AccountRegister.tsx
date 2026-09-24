import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, ChevronLeft, Download, MoreHorizontal, Scale, Search } from "lucide-react";
import {
  REGISTER_PAGE_SIZE,
  formatMoney,
  type Account,
  type CreateTransactionInput,
  type MerchantRuleInput,
  type ScheduledTransactionInput,
  type Transaction,
  type TransactionStatus,
  type TransactionStatusFilter,
} from "./domain";
import { csvExportRepository,financeRepository as repository } from "./repository";
import {buildRegisterCsv,exportFileName,loadAllRegisterTransactions} from "./csvExport";
import {
  filteredBalanceUnavailableReason,
  mergeOlderRegisterPage,
  nextOlderRegisterOffset,
  registerRunningBalances,
  registerShowsLedgerBalance,
} from "./registerMath";
import {
  duplicateTransactionDraft,
  merchantRuleDraftFromTransaction,
  scheduledDraftFromTransaction,
  transactionReuseEligibility,
} from "./transactionReuse";
import { todayIso } from "./scheduledPresentation";
import "./register.css";
import "./registerExport.css";

export type RegisterDialogRequest =
  | { kind: "transaction"; transaction?: Transaction; accountId?: string; draft?: CreateTransactionInput }
  | { kind: "transfer"; transaction?: Transaction; accountId?: string }
  | { kind: "reconciliation"; account: Account }
  | { kind: "schedule"; draft: ScheduledTransactionInput }
  | { kind: "rule"; draft: MerchantRuleInput };

interface AccountRegisterProps {
  accounts: Account[];
  /** When set, lock the register to one account (Accounts → register flow). */
  lockedAccountId?: string;
  /** Optional starting account for the global Transactions view. */
  initialAccountId?: string;
  /** Optional starting status for contextual entry into the global register. */
  initialStatus?: TransactionStatusFilter;
  initialSearch?: string;
  focusTransactionId?: string;
  refreshToken?: number;
  onRequestDialog: (request: RegisterDialogRequest) => void;
  onAccountChange?: (accountId: string | undefined) => void;
}

export function AccountRegister({
  accounts,
  lockedAccountId,
  initialAccountId,
  initialStatus = "all",
  initialSearch = "",
  focusTransactionId,
  refreshToken = 0,
  onRequestDialog,
  onAccountChange,
}: AccountRegisterProps) {
  const locked = Boolean(lockedAccountId);
  const [accountId, setAccountId] = useState(lockedAccountId ?? initialAccountId ?? "");
  const [status, setStatus] = useState<TransactionStatusFilter>(initialStatus);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [draftSearch, setDraftSearch] = useState(initialSearch);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [priorBalanceMinor, setPriorBalanceMinor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exporting,setExporting]=useState(false);
  const [exportNotice,setExportNotice]=useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (lockedAccountId) setAccountId(lockedAccountId);
  }, [lockedAccountId]);

  useEffect(() => {
    if (!locked && initialAccountId !== undefined) setAccountId(initialAccountId);
  }, [initialAccountId, locked]);

  useEffect(() => {
    if (!locked) setStatus(initialStatus);
  }, [initialStatus, locked]);

  useEffect(() => {
    if (!locked) { setSearch(initialSearch); setDraftSearch(initialSearch); }
  }, [initialSearch, locked]);

  useEffect(() => {
    if (!focusTransactionId || loading) return;
    const row = document.querySelector<HTMLElement>(`tr.register-focus`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusTransactionId, loading, transactions]);

  useEffect(() => {
    if (accountId && !accounts.some((item) => item.id === accountId)) {
      setAccountId(locked ? accounts[0]?.id ?? "" : "");
    }
  }, [accountId, accounts, locked]);

  const selectedAccount = accounts.find((item) => item.id === accountId);
  const showLedgerBalance = Boolean(selectedAccount) && registerShowsLedgerBalance({ status, search });
  const balanceHiddenReason = selectedAccount ? filteredBalanceUnavailableReason({ status, search }) : undefined;

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
      const { offset: nextOffset, limit } = nextOlderRegisterOffset(offset);
      const page = await repository.listTransactionsPage({
        accountId: accountId || undefined,
        offset: nextOffset,
        limit,
        status,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        search: search || undefined,
      });
      const merged = mergeOlderRegisterPage(
        { transactions, offset, priorBalanceMinor, totalCount },
        page,
      );
      setTransactions(merged.transactions);
      setOffset(merged.offset);
      setPriorBalanceMinor(merged.priorBalanceMinor);
      setTotalCount(merged.totalCount);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingOlder(false);
    }
  }

  const balances = useMemo(
    () => (showLedgerBalance ? registerRunningBalances(priorBalanceMinor, transactions) : []),
    [priorBalanceMinor, showLedgerBalance, transactions],
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

  async function exportRegister(){
    setExporting(true);setExportNotice("");setError("");
    try{
      const rows=await loadAllRegisterTransactions(repository,{accountId:accountId||undefined,status,fromDate:fromDate||undefined,toDate:toDate||undefined,search:search||undefined});
      const prefix=`HomeLedger-${selectedAccount?.name??"all-accounts"}-register`;
      const saved=await csvExportRepository.saveCsv(buildRegisterCsv(rows,accounts),exportFileName(prefix,fromDate||undefined,toDate||undefined));
      if(saved)setExportNotice(`Exported ${rows.length.toLocaleString()} matching transaction${rows.length===1?"":"s"}.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setExporting(false);}
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
              <p>Browse every ledger entry. Choose one account to transfer, reconcile, or see running balances.</p>
            </div>
          )}
        </div>
        <div className="register-actions">
          {selectedAccount ? (
            <>
              <button
                disabled={accounts.length < 2}
                onClick={() => onRequestDialog({ kind: "transfer", accountId: selectedAccount.id })}
              >
                <ArrowLeftRight size={13} /> Transfer
              </button>
              <button onClick={() => onRequestDialog({ kind: "reconciliation", account: selectedAccount })}>
                <Scale size={13} /> Reconcile
              </button>
            </>
          ) : null}
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
          <Search size={14} aria-hidden="true" />
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
      {exportNotice&&<div className="success-banner" role="status">{exportNotice}</div>}

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
              {balanceHiddenReason ? ` · ${balanceHiddenReason}` : showLedgerBalance ? " · Balance is true ledger balance" : ""}
            </p>
          </div>
          <div className="register-heading-actions"><button disabled={loading||exporting||totalCount===0} onClick={()=>void exportRegister()}><Download size={13}/>{exporting?"Preparing export…":"Export matching CSV"}</button>{hasOlder && (
            <button disabled={loadingOlder||exporting} onClick={() => void loadOlder()}>
              <ChevronLeft size={13} />
              {loadingOlder ? "Loading earlier…" : "Load earlier history"}
            </button>
          )}</div>
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
                  {showLedgerBalance && <th>Balance</th>}
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
                    <tr key={transaction.id} className={transaction.id===focusTransactionId?"register-focus":undefined}>
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
                      {showLedgerBalance && (
                        <td className={balances[index] < 0 ? "amount negative" : "amount"}>
                          {formatMoney(balances[index], currency)}
                        </td>
                      )}
                      <td>
                        <div className="register-row-actions">
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
                          <ReuseActions transaction={transaction} accounts={accounts} onRequestDialog={onRequestDialog} />
                        </div>
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

function ReuseActions({
  transaction,
  accounts,
  onRequestDialog,
}: {
  transaction: Transaction;
  accounts: Account[];
  onRequestDialog: (request: RegisterDialogRequest) => void;
}) {
  const eligibility = transactionReuseEligibility(transaction, accounts);
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const duplicateReasonId = useId();
  const recurringReasonId = useId();
  const ruleReasonId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function runAction(action: () => void) {
    try {
      action();
      setOpen(false);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="register-reuse-menu" ref={rootRef}>
      <button
        type="button"
        className="reuse-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="More transaction actions"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
        <span aria-hidden="true">More</span>
      </button>
      {open && (
        <div className="register-reuse-popover" role="menu" id={menuId} aria-label="Transaction reuse actions">
          <div className="reuse-menu-item-wrap">
            <button
              type="button"
              role="menuitem"
              className="reuse-action"
              disabled={!eligibility.duplicate.allowed}
              aria-describedby={!eligibility.duplicate.allowed && eligibility.duplicate.reason ? duplicateReasonId : undefined}
              onClick={() =>
                runAction(() =>
                  onRequestDialog({ kind: "transaction", draft: duplicateTransactionDraft(transaction, today) }),
                )
              }
            >
              Duplicate
            </button>
            {!eligibility.duplicate.allowed && eligibility.duplicate.reason && (
              <span id={duplicateReasonId} className="reuse-unavailable-reason" role="note">
                {eligibility.duplicate.reason}
              </span>
            )}
          </div>
          <div className="reuse-menu-item-wrap">
            <button
              type="button"
              role="menuitem"
              className="reuse-action"
              disabled={!eligibility.recurring.allowed}
              aria-describedby={!eligibility.recurring.allowed && eligibility.recurring.reason ? recurringReasonId : undefined}
              onClick={() =>
                runAction(() =>
                  onRequestDialog({ kind: "schedule", draft: scheduledDraftFromTransaction(transaction, accounts, today) }),
                )
              }
            >
              Make recurring
            </button>
            {!eligibility.recurring.allowed && eligibility.recurring.reason && (
              <span id={recurringReasonId} className="reuse-unavailable-reason" role="note">
                {eligibility.recurring.reason}
              </span>
            )}
          </div>
          <div className="reuse-menu-item-wrap">
            <button
              type="button"
              role="menuitem"
              className="reuse-action"
              disabled={!eligibility.rule.allowed}
              aria-describedby={!eligibility.rule.allowed && eligibility.rule.reason ? ruleReasonId : undefined}
              onClick={() =>
                runAction(() =>
                  onRequestDialog({ kind: "rule", draft: merchantRuleDraftFromTransaction(transaction) }),
                )
              }
            >
              Create rule
            </button>
            {!eligibility.rule.allowed && eligibility.rule.reason && (
              <span id={ruleReasonId} className="reuse-unavailable-reason" role="note">
                {eligibility.rule.reason}
              </span>
            )}
          </div>
        </div>
      )}
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
