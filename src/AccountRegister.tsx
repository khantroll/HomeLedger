import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeftRight, ChevronLeft, Download, Flag, MoreHorizontal, Paperclip, Scale, Search, StickyNote, Tags, Trash2 } from "lucide-react";
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
import { normalizeBulkStatus, registerBulkEligibility, selectedIdsEligibleFor } from "./registerBulk";
import { SuggestionLists, useLedgerSuggestions } from "./useLedgerSuggestions";
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
  /** Optional posted-date window used with focusTransactionId so Find landings are not lost to pagination. */
  focusPostedDate?: string;
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
  focusPostedDate,
  focusTransactionId,
  refreshToken = 0,
  onRequestDialog,
  onAccountChange,
}: AccountRegisterProps) {
  const locked = Boolean(lockedAccountId);
  const [accountId, setAccountId] = useState(lockedAccountId ?? initialAccountId ?? "");
  const [status, setStatus] = useState<TransactionStatusFilter>(initialStatus);
  const [fromDate, setFromDate] = useState(focusPostedDate ?? "");
  const [toDate, setToDate] = useState(focusPostedDate ?? "");
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"pending" | "cleared" | "review">("cleared");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const suggestions = useLedgerSuggestions();

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
    if (!locked && focusPostedDate) {
      setFromDate(focusPostedDate);
      setToDate(focusPostedDate);
    }
  }, [focusPostedDate, locked]);

  useEffect(() => {
    if (!focusTransactionId || loading) return;
    const row = document.querySelector<HTMLElement>(`tr.register-focus`);
    row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [focusTransactionId, loading, transactions]);

  useEffect(() => {
    if (accountId && !accounts.some((item) => item.id === accountId)) {
      setAccountId(locked ? accounts[0]?.id ?? "" : "");
    }
  }, [accountId, accounts, locked]);

  const selectedAccount = accounts.find((item) => item.id === accountId);
  const showLedgerBalance = Boolean(selectedAccount) && registerShowsLedgerBalance({ status, search, flaggedOnly });
  const balanceHiddenReason = selectedAccount ? filteredBalanceUnavailableReason({ status, search, flaggedOnly }) : undefined;

  const loadNewest = useCallback(async () => {
    if (locked && !accountId) return;
    setLoading(true);
    setError("");
    setSelectedIds(new Set());
    setConfirmDelete(false);
    try {
      const page = await repository.listTransactionsPage({
        accountId: accountId || undefined,
        limit: REGISTER_PAGE_SIZE,
        newest: true,
        status,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        search: search || undefined,
        flaggedOnly: flaggedOnly || undefined,
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
  }, [accountId, flaggedOnly, fromDate, locked, search, status, toDate]);

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
        flaggedOnly: flaggedOnly || undefined,
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
  const visibleIds = useMemo(() => transactions.map((item) => item.id), [transactions]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const categorySelection = useMemo(() => selectedIdsEligibleFor(transactions, selectedIds, "category"), [selectedIds, transactions]);
  const statusSelection = useMemo(() => selectedIdsEligibleFor(transactions, selectedIds, "status"), [selectedIds, transactions]);
  const deleteSelection = useMemo(() => selectedIdsEligibleFor(transactions, selectedIds, "delete"), [selectedIds, transactions]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.includes(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (confirmDelete) { setConfirmDelete(false); return; }
      if (selectedIds.size) setSelectedIds(new Set());
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmDelete, selectedIds.size]);

  function chooseAccount(next: string) {
    setAccountId(next);
    onAccountChange?.(next || undefined);
  }

  function toggleRow(id: string) {
    setConfirmDelete(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectVisible() {
    setConfirmDelete(false);
    setSelectedIds((current) => {
      if (allVisibleSelected) return new Set();
      return new Set(visibleIds);
    });
  }

  function onRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key !== " ") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "BUTTON" || target.tagName === "A" || target.isContentEditable) return;
    event.preventDefault();
    toggleRow(id);
  }

  async function toggleFlag(transaction: Transaction) {
    setError("");
    try {
      await repository.updateTransactionAnnotation(transaction.id, { flagged: !transaction.flagged });
      setTransactions((current) => current.map((item) => item.id === transaction.id ? { ...item, flagged: !transaction.flagged } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

    async function applyBulkCategory() {
    const category = bulkCategory.trim();
    // All-or-none: refuse mixed selections so protected rows are never silently skipped.
    if (categorySelection.blocked.length > 0) {
      setError("Selected batch includes protected or ineligible transactions (transfers, splits, reconciled, or reserved). Nothing was changed.");
      return;
    }
    if (!categorySelection.eligibleIds.length) {
      setError("Select eligible transactions first.");
      return;
    }
    if (!category) { setError("Category is required"); return; }
    setBulkBusy(true); setError("");
    try {
      await repository.bulkSetTransactionCategory({ transactionIds: categorySelection.eligibleIds, category });
      setSelectedIds(new Set());
      setBulkCategory("");
      await loadNewest();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkStatus() {
    if (statusSelection.blocked.length > 0) {
      setError("Selected batch includes protected or ineligible transactions (transfers, reconciled, or scheduled). Nothing was changed.");
      return;
    }
    if (!statusSelection.eligibleIds.length) {
      setError("Select eligible transactions first.");
      return;
    }
    setBulkBusy(true); setError("");
    try {
      await repository.bulkUpdateTransactionStatus({ transactionIds: statusSelection.eligibleIds, status: normalizeBulkStatus(bulkStatus) });
      setSelectedIds(new Set());
      await loadNewest();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkDelete() {
    if (deleteSelection.blocked.length > 0) {
      setError("Selected batch includes protected or ineligible transactions (transfers, reconciled, imported, or scheduled). Nothing was changed.");
      setConfirmDelete(false);
      return;
    }
    if (!deleteSelection.eligibleIds.length) {
      setError("Select eligible transactions first.");
      return;
    }
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBulkBusy(true); setError("");
    try {
      await repository.bulkDeleteTransactions({ transactionIds: deleteSelection.eligibleIds });
      setSelectedIds(new Set());
      setConfirmDelete(false);
      await loadNewest();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setConfirmDelete(false);
    } finally {
      setBulkBusy(false);
    }
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
              {accounts.filter((account) => !account.archived).map((account) => (
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
        <label className="register-flagged-filter">
          <span>Flagged</span>
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(event) => setFlaggedOnly(event.target.checked)}
            aria-label="Show only flagged transactions"
          />
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
            placeholder="Payee, category, or note"
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

      {selectedIds.size > 0 && (
        <section className="panel register-bulk-bar" aria-label="Bulk register actions">
          <div className="register-bulk-summary">
            <strong>{selectedIds.size} selected</strong>
            <span>
              {categorySelection.blocked.length || statusSelection.blocked.length || deleteSelection.blocked.length
                ? "Selection includes protected rows. Bulk actions require every selected transaction to be eligible; mixed batches change nothing."
                : "Apply one explicit action to the selected rows."}
            </span>
          </div>
          <div className="register-bulk-controls">
            <label>
              Category
              <input list={suggestions.categoryListId} value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)} placeholder="Food: Groceries" maxLength={120} aria-label="Bulk category" />
            </label>
            <button type="button" disabled={bulkBusy || !categorySelection.eligibleIds.length} onClick={() => void applyBulkCategory()}>
              <Tags size={13} /> Change category ({categorySelection.eligibleIds.length})
            </button>
            <label>
              Status
              <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as "pending" | "cleared" | "review")} aria-label="Bulk status">
                <option value="pending">Pending</option>
                <option value="cleared">Cleared</option>
                <option value="review">Needs review</option>
              </select>
            </label>
            <button type="button" disabled={bulkBusy || !statusSelection.eligibleIds.length} onClick={() => void applyBulkStatus()}>
              Set status ({statusSelection.eligibleIds.length})
            </button>
            <button type="button" className={confirmDelete ? "danger-action" : "delete-link"} disabled={bulkBusy || !deleteSelection.eligibleIds.length} onClick={() => void applyBulkDelete()}>
              <Trash2 size={13} />
              {confirmDelete ? `Confirm delete ${deleteSelection.eligibleIds.length}` : `Delete (${deleteSelection.eligibleIds.length})`}
            </button>
            <button type="button" disabled={bulkBusy} onClick={() => { setSelectedIds(new Set()); setConfirmDelete(false); }}>Clear selection</button>
          </div>
          <SuggestionLists {...suggestions} />
        </section>
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
                  <th className="register-select-col">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectVisible}
                      aria-label="Select all visible transactions"
                    />
                  </th>
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
                  const eligibility = registerBulkEligibility(transaction);
                  const selected = selectedIds.has(transaction.id);
                  return (
                    <tr
                      key={transaction.id}
                      className={[
                        transaction.id===focusTransactionId?"register-focus":"",
                        selected?"register-selected":"",
                        transaction.flagged?"register-flagged-row":"",
                      ].filter(Boolean).join(" ") || undefined}
                      tabIndex={0}
                      onKeyDown={(event) => onRowKeyDown(event, transaction.id)}
                    >
                      <td className="register-select-col">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRow(transaction.id)}
                          aria-label={`Select ${transaction.payee} on ${transaction.postedDate}`}
                          title={eligibility.reasons.length ? `Protected: ${eligibility.reasons.join(", ")}` : undefined}
                        />
                      </td>
                      {!selectedAccount && <td>{account?.name ?? "Missing account"}</td>}
                      <td>{transaction.postedDate}</td>
                      <td>
                        <strong>{transaction.payee}</strong>
                        <span className="register-meta-icons">
                          {transaction.flagged ? (
                            <span className="register-flag-badge" title="Flagged for follow-up" aria-label="Flagged for follow-up">
                              <Flag size={11} aria-hidden="true" />
                              <span>Flagged</span>
                            </span>
                          ) : null}
                          {transaction.memo?.trim() ? (
                            <span className="register-note-badge" title={transaction.memo} aria-label="Has note">
                              <StickyNote size={11} aria-hidden="true" />
                              <span>Note</span>
                            </span>
                          ) : null}
                          {(transaction.attachmentCount ?? 0) > 0 ? (
                            <span
                              className="register-attachment-badge"
                              title={`${transaction.attachmentCount} attachment${transaction.attachmentCount === 1 ? "" : "s"}`}
                              aria-label={transaction.attachmentCount === 1 ? "1 attachment" : `${transaction.attachmentCount} attachments`}
                            >
                              <Paperclip size={11} aria-hidden="true" />
                              <span>{transaction.attachmentCount}</span>
                            </span>
                          ) : null}
                        </span>
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
                            type="button"
                            className={transaction.flagged ? "register-flag-toggle is-flagged" : "register-flag-toggle"}
                            aria-pressed={Boolean(transaction.flagged)}
                            aria-label={transaction.flagged ? `Clear flag on ${transaction.payee}` : `Flag ${transaction.payee} for follow-up`}
                            title={transaction.flagged ? "Clear flag" : "Flag for follow-up"}
                            onClick={() => void toggleFlag(transaction)}
                          >
                            <Flag size={12} aria-hidden="true" />
                          </button>
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
