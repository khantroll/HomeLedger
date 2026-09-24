import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatMoney, type Account, type BudgetMonth, type ScheduledOccurrence, type ScheduledTransaction, type Transaction } from "./domain";
import {
  SOURCE_LABELS,
  buildBudgetPlanProposal,
  type BudgetHistorySource,
  type BudgetPlanProposal,
  type BudgetPlanProposalLine,
} from "./budgetPlanning";
import { previousMonth } from "./budgetMath";
import { financeRepository as repository } from "./repository";
import "./budgetPlanning.css";

const SOURCES: BudgetHistorySource[] = [
  "average-3",
  "average-6",
  "same-month-last-year",
  "previous-plan",
  "scheduled",
];

export function BudgetFromHistoryDialog({
  month,
  currentBudget,
  transactions,
  accounts,
  schedules,
  occurrences,
  onClose,
  onApplied,
}: {
  month: string;
  currentBudget?: BudgetMonth;
  transactions: Transaction[];
  accounts: Account[];
  schedules: ScheduledTransaction[];
  occurrences: ScheduledOccurrence[];
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [source, setSource] = useState<BudgetHistorySource>("average-3");
  const [previousBudget, setPreviousBudget] = useState<BudgetMonth>();
  const [lines, setLines] = useState<BudgetPlanProposalLine[]>([]);
  const [proposalMeta, setProposalMeta] = useState<Pick<BudgetPlanProposal, "label" | "detail" | "monthsUsed">>({
    label: SOURCE_LABELS["average-3"],
    detail: "",
    monthsUsed: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void repository
      .getBudgetMonth(previousMonth(month))
      .then((value) => {
        if (!cancelled) setPreviousBudget(value);
      })
      .catch(() => {
        if (!cancelled) setPreviousBudget(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  useEffect(() => {
    const proposal = buildBudgetPlanProposal(source, {
      targetMonth: month,
      currentBudget,
      previousBudget,
      transactions,
      accounts,
      schedules,
      occurrences,
    });
    setProposalMeta({ label: proposal.label, detail: proposal.detail, monthsUsed: proposal.monthsUsed });
    setLines(proposal.lines);
  }, [source, month, currentBudget, previousBudget, transactions, accounts, schedules, occurrences]);

  const selectedCount = useMemo(() => lines.filter((line) => line.selected).length, [lines]);

  function toggle(key: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, selected: !line.selected } : line)));
  }

  function toggleAll(selected: boolean) {
    setLines((current) => current.map((line) => ({ ...line, selected })));
  }

  async function apply() {
    const selected = lines.filter((line) => line.selected);
    if (!selected.length) {
      setError("Choose at least one category to apply.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const line of selected) {
        let budgetCategoryId = line.budgetCategoryId;
        if (!budgetCategoryId) {
          const created = await repository.createBudgetCategory({
            category: line.category,
            rolloverEnabled: Boolean(line.rolloverEnabled),
          });
          budgetCategoryId = created.id;
        } else if (source === "previous-plan" && line.rolloverEnabled !== undefined) {
          await repository.updateBudgetCategory(budgetCategoryId, {
            category: line.category,
            rolloverEnabled: line.rolloverEnabled,
          });
        }
        await repository.setBudgetAllocation({
          budgetCategoryId,
          month,
          plannedMinor: line.suggestedPlannedMinor,
        });
      }
      await onApplied();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog budget-history-dialog" role="dialog" aria-modal="true" aria-labelledby="budget-history-title">
        <div className="dialog-header">
          <div>
            <h2 id="budget-history-title">Plan from history</h2>
            <small>Deterministic suggestions from your local ledger — review before applying.</small>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close plan from history">
            <X size={18} />
          </button>
        </div>

        <div className="budget-history-sources" role="radiogroup" aria-label="History source">
          {SOURCES.map((item) => (
            <label key={item} className={source === item ? "active" : undefined}>
              <input
                type="radio"
                name="budget-history-source"
                value={item}
                checked={source === item}
                onChange={() => setSource(item)}
                disabled={busy}
              />
              <span>{SOURCE_LABELS[item]}</span>
            </label>
          ))}
        </div>

        <p className="budget-history-detail">{proposalMeta.detail}</p>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {lines.length === 0 ? (
          <div className="empty-state">No suggestions for this source.</div>
        ) : (
          <>
            <div className="budget-history-toolbar">
              <span>
                {selectedCount} of {lines.length} selected
              </span>
              <div>
                <button type="button" disabled={busy} onClick={() => toggleAll(true)}>
                  Select all
                </button>
                <button type="button" disabled={busy} onClick={() => toggleAll(false)}>
                  Select none
                </button>
              </div>
            </div>
            <div className="table-wrap budget-history-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Apply</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="amount">
                      Current plan
                    </th>
                    <th scope="col" className="amount">
                      Suggested
                    </th>
                    <th scope="col">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={line.selected}
                          onChange={() => toggle(line.key)}
                          disabled={busy}
                          aria-label={`Apply suggested plan for ${line.category}`}
                        />
                      </td>
                      <td>
                        <strong>{line.category}</strong>
                        {!line.budgetCategoryId && <small>New category</small>}
                      </td>
                      <td className="amount">{formatMoney(line.currentPlannedMinor)}</td>
                      <td className="amount">
                        <strong>{formatMoney(line.suggestedPlannedMinor)}</strong>
                      </td>
                      <td>
                        <small>{line.basis}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy || selectedCount === 0} onClick={() => void apply()}>
            {busy ? "Applying…" : `Apply ${selectedCount} selected`}
          </button>
        </div>
      </section>
    </div>
  );
}
