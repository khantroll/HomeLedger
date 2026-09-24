import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FolderTree, Merge, Pencil, Search, Tags, Trash2, Users, X } from "lucide-react";
import type { BudgetCategory, LabelRewriteResult, MerchantRule, ScheduledTransaction, Transaction } from "./domain";
import { financeRepository as repository } from "./repository";
import {
  buildCategoryUsage,
  buildPayeeUsage,
  filterLabelUsage,
  type LabelKind,
  type LabelUsageRow,
} from "./labelVocabulary";
import "./categories.css";

type EditorMode = { kind: "rename" | "merge"; labelKind: LabelKind; source: string } | null;

export function CategoriesPage() {
  const [tab, setTab] = useState<LabelKind>("category");
  const [categories, setCategories] = useState<string[]>([]);
  const [payees, setPayees] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [schedules, setSchedules] = useState<ScheduledTransaction[]>([]);
  const [budgets, setBudgets] = useState<BudgetCategory[]>([]);
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<EditorMode>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [nextCategories, nextPayees, nextTransactions, nextSchedules, nextBudgets, nextRules] = await Promise.all([
        repository.listCategories(),
        repository.listPayees(),
        repository.listTransactions(),
        repository.listScheduledTransactions(),
        repository.listBudgetCategories(),
        repository.listMerchantRules(),
      ]);
      setCategories(nextCategories);
      setPayees(nextPayees);
      setTransactions(nextTransactions);
      setSchedules(nextSchedules);
      setBudgets(nextBudgets);
      setRules(nextRules);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const categoryRows = useMemo(
    () => filterLabelUsage(buildCategoryUsage(categories, transactions, schedules, budgets, rules), query),
    [categories, transactions, schedules, budgets, rules, query],
  );
  const payeeRows = useMemo(
    () => filterLabelUsage(buildPayeeUsage(payees, transactions, schedules, rules), query),
    [payees, transactions, schedules, rules, query],
  );
  const rows = tab === "category" ? categoryRows : payeeRows;

  async function applyRewrite(result: LabelRewriteResult) {
    setNotice(
      `${result.operation === "merge" ? "Merged" : "Renamed"} “${result.from}” → “${result.to}” (${summarizeRewrite(result)}).`,
    );
    setEditor(null);
    await load();
  }

  async function removeUnused(row: LabelUsageRow) {
    if (!row.memoryOnly) return;
    setBusy(true);
    setError("");
    try {
      if (tab === "category") await repository.removeUnusedCategory(row.name);
      else await repository.removeUnusedPayee(row.name);
      setNotice(`Removed unused ${tab} “${row.name}” from autocomplete memory.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="categories-page">
      <section className="panel categories-intro">
        <div className="panel-heading">
          <div>
            <h2>Categories &amp; payees</h2>
            <p>Inspect and maintain the vocabulary HomeLedger has accumulated from your ledger and planning data.</p>
          </div>
        </div>
        <div className="categories-explainer">
          <FolderTree size={20} />
          <div>
            <strong>Deterministic bookkeeping labels</strong>
            <span>
              Rename or merge updates transactions, splits, schedules, budgets, and merchant-rule actions in one atomic
              step. Import provenance (`original payee`) is preserved. Colon names like Food: Groceries stay lightweight —
              no parent rollups.
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading categories-toolbar">
          <div className="categories-tabs" role="tablist" aria-label="Label kind">
            <button type="button" role="tab" aria-selected={tab === "category"} className={tab === "category" ? "active" : undefined} onClick={() => setTab("category")}>
              <Tags size={14} /> Categories ({categoryRows.length})
            </button>
            <button type="button" role="tab" aria-selected={tab === "payee"} className={tab === "payee" ? "active" : undefined} onClick={() => setTab("payee")}>
              <Users size={14} /> Payees ({payeeRows.length})
            </button>
          </div>
          <label className="categories-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "category" ? "Filter categories" : "Filter payees"}
              aria-label={tab === "category" ? "Filter categories" : "Filter payees"}
            />
          </label>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {notice && <p className="categories-notice">{notice}</p>}

        {rows.length === 0 ? (
          <div className="empty-state">No {tab === "category" ? "categories" : "payees"} match this filter.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tab === "category" ? "Category" : "Payee"}</th>
                  {tab === "category" && <th>Group</th>}
                  <th>References</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.memoryOnly && <span className="memory-only">Memory only</span>}
                    </td>
                    {tab === "category" && <td>{row.parent ?? "—"}</td>}
                    <td>
                      <span title={referenceDetail(row)}>{row.referenceCount}</span>
                    </td>
                    <td>{row.lastUsed ?? "—"}</td>
                    <td className="categories-actions">
                      <button type="button" className="edit-transaction" disabled={busy} onClick={() => setEditor({ kind: "rename", labelKind: tab, source: row.name })}>
                        <Pencil size={12} /> Rename
                      </button>
                      <button type="button" className="edit-transaction" disabled={busy} onClick={() => setEditor({ kind: "merge", labelKind: tab, source: row.name })}>
                        <Merge size={12} /> Merge
                      </button>
                      {row.memoryOnly && (
                        <button type="button" className="delete-link" disabled={busy} onClick={() => void removeUnused(row)}>
                          <Trash2 size={12} /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editor && (
        <LabelEditorDialog
          mode={editor}
          categoryOptions={categories}
          payeeOptions={payees}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setEditor(null)}
          onError={setError}
          onApplied={applyRewrite}
        />
      )}
    </div>
  );
}

function LabelEditorDialog({
  mode,
  categoryOptions,
  payeeOptions,
  busy,
  onBusy,
  onClose,
  onError,
  onApplied,
}: {
  mode: Exclude<EditorMode, null>;
  categoryOptions: string[];
  payeeOptions: string[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onError: (value: string) => void;
  onApplied: (result: LabelRewriteResult) => Promise<void>;
}) {
  const [target, setTarget] = useState(mode.kind === "rename" ? mode.source : "");
  const [confirmImpact, setConfirmImpact] = useState(false);
  const options = (mode.labelKind === "category" ? categoryOptions : payeeOptions).filter(
    (item) => item.trim().toLocaleLowerCase() !== mode.source.trim().toLocaleLowerCase(),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = target.trim();
    if (!value) {
      onError(`${mode.labelKind === "category" ? "Category" : "Payee"} is required`);
      return;
    }
    if (!confirmImpact) {
      setConfirmImpact(true);
      return;
    }
    onBusy(true);
    onError("");
    try {
      let result: LabelRewriteResult;
      if (mode.labelKind === "category") {
        result = mode.kind === "rename"
          ? await repository.renameCategory(mode.source, value)
          : await repository.mergeCategories(mode.source, value);
      } else {
        result = mode.kind === "rename"
          ? await repository.renamePayee(mode.source, value)
          : await repository.mergePayees(mode.source, value);
      }
      await onApplied(result);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (mode.kind === "rename" && /use merge instead/i.test(message)) {
        onError(`${message} Pick Merge and choose the existing label.`);
      } else {
        onError(message);
      }
      setConfirmImpact(false);
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="dialog categories-dialog" role="dialog" aria-modal="true" aria-labelledby="label-editor-title">
        <div className="dialog-header">
          <h2 id="label-editor-title">
            {mode.kind === "rename" ? "Rename" : "Merge"} {mode.labelKind}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form className="entry-form" onSubmit={submit}>
          <p className="mapping-help">
            Source: <strong>{mode.source}</strong>. This rewrites authoritative references in one step and does not change amounts, balances, transfers, or import provenance.
          </p>
          {mode.kind === "rename" ? (
            <label>
              New {mode.labelKind} name
              <input value={target} onChange={(event) => { setTarget(event.target.value); setConfirmImpact(false); }} required maxLength={mode.labelKind === "category" ? 120 : 160} autoFocus />
            </label>
          ) : (
            <label>
              Merge into
              <input list="label-merge-targets" value={target} onChange={(event) => { setTarget(event.target.value); setConfirmImpact(false); }} required maxLength={mode.labelKind === "category" ? 120 : 160} autoFocus placeholder="Choose an existing label" />
              <datalist id="label-merge-targets">
                {options.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
          )}
          {confirmImpact && (
            <p className="categories-confirm" role="status">
              Confirm {mode.kind} of “{mode.source}” {mode.kind === "merge" ? "into" : "to"} “{target.trim()}”. Click again to apply.
            </p>
          )}
          <div className="form-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary" disabled={busy}>{busy ? "Working…" : confirmImpact ? `Confirm ${mode.kind}` : mode.kind === "rename" ? "Preview rename" : "Preview merge"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function referenceDetail(row: LabelUsageRow): string {
  const parts = [
    row.transactionCount ? `${row.transactionCount} txn` : "",
    row.splitCount ? `${row.splitCount} split` : "",
    row.scheduleCount ? `${row.scheduleCount} schedule` : "",
    row.budgetCount ? `${row.budgetCount} budget` : "",
    row.ruleCount ? `${row.ruleCount} rule` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "No ledger references";
}

function summarizeRewrite(result: LabelRewriteResult): string {
  return [
    result.transactions ? `${result.transactions} txn` : "",
    result.splits ? `${result.splits} split` : "",
    result.schedules ? `${result.schedules} schedule` : "",
    result.budgetCategories ? `${result.budgetCategories} budget` : "",
    result.merchantRules ? `${result.merchantRules} rule` : "",
  ].filter(Boolean).join(", ") || "catalog only";
}
