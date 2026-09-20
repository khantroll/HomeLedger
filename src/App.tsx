import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowLeftRight, BarChart3, Bot, CalendarDays, CircleDollarSign, FileInput, Landmark, LayoutDashboard, ListFilter, LockKeyhole, Menu, ReceiptText, Search, Settings, Tags, TrendingUp, WalletCards, X } from "lucide-react";
import { formatMoney, parseMoney, sumMoney, type Account, type AccountType, type ScheduledOccurrence, type ScheduledTransaction, type Transaction } from "./domain";
import { financeRepository as repository, isNativeApp } from "./repository";
import { ImportPage } from "./ImportPage";
import { BackupPage } from "./BackupPage";
import { TransactionDialog } from "./TransactionDialog";
import { TransferDialog } from "./TransferDialog";
import { ReconciliationDialog } from "./ReconciliationDialog";
import "./register.css";
import { RulesPage } from "./RulesPage";
import { BillsPage } from "./BillsPage";
import { BudgetPage } from "./BudgetPage";
import { ForecastPage } from "./ForecastPage";
import { ReportsPage } from "./ReportsPage";
import { DebtPage } from "./DebtPage";
import { AccountRegister, type RegisterDialogRequest } from "./AccountRegister";
import { addDaysIso, formatDate, occurrenceDisplayState, occurrenceStateLabel, todayIso } from "./scheduledPresentation";

type EditorDialog =
  | "account"
  | { kind: "transaction"; transaction?: Transaction; accountId?: string }
  | { kind: "transfer"; transaction?: Transaction; accountId?: string }
  | { kind: "reconciliation"; account: Account }
  | null;

const navItems = [
  ["Overview", LayoutDashboard], ["Accounts", Landmark], ["Transactions", ReceiptText], ["Imports", FileInput], ["Rules", ListFilter],
  ["Budget", Tags], ["Bills", CalendarDays], ["Forecast", TrendingUp], ["Debt", CircleDollarSign], ["Reports", BarChart3], ["AI Insights", Bot], ["Settings", Settings],
] as const;

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [scheduledTemplates, setScheduledTemplates] = useState<ScheduledTransaction[]>([]);
  const [scheduledOccurrences, setScheduledOccurrences] = useState<ScheduledOccurrence[]>([]);
  const [active, setActive] = useState("Overview");
  const [registerAccountId, setRegisterAccountId] = useState<string>();
  const [registerToken, setRegisterToken] = useState(0);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<EditorDialog>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts, nextTransactions, nextTemplates] = await Promise.all([
        repository.listAccounts(),
        repository.listTransactions(),
        repository.listScheduledTransactions(),
      ]);
      const today = todayIso();
      const fromDate = addDaysIso(today, -90);
      const toDate = addDaysIso(today, 90);
      await repository.generateScheduledOccurrences({ fromDate, toDate });
      const nextOccurrences = await repository.listScheduledOccurrences({ fromDate, toDate });
      setAccounts(nextAccounts);
      setTransactions(nextTransactions);
      setScheduledTemplates(nextTemplates);
      setScheduledOccurrences(nextOccurrences);
      setRegisterToken((value) => value + 1);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assets = useMemo(() => sumMoney(accounts.filter((a) => a.balanceMinor > 0).map((a) => a.balanceMinor)), [accounts]);
  const liabilities = useMemo(() => sumMoney(accounts.filter((a) => a.balanceMinor < 0).map((a) => a.balanceMinor)), [accounts]);
  const reviewCount = useMemo(() => transactions.filter((item) => item.status === "review").length, [transactions]);

  function openNav(label: string) {
    setActive(label);
    if (label !== "Accounts") setRegisterAccountId(undefined);
  }

  function openAccountRegister(accountId: string) {
    setRegisterAccountId(accountId);
    setActive("Accounts");
  }

  function handleRegisterDialog(request: RegisterDialogRequest) {
    setDialog(request);
  }

  const topbarSearchVisible = active === "Overview";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">H</span>
          <div>
            <strong>HomeLedger</strong>
            <small>Local household finance</small>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map(([label, Icon]) => (
            <button key={label} className={active === label ? "active" : ""} onClick={() => openNav(label)}>
              <Icon size={17} />
              <span>{label}</span>
              {!["Overview", "Accounts", "Transactions", "Imports", "Rules", "Budget", "Bills", "Forecast", "Debt", "Reports", "Settings"].includes(label) && <em>Planned</em>}
            </button>
          ))}
        </nav>
        <div className="privacy">
          <LockKeyhole size={16} />
          <div>
            <strong>Local mode</strong>
            <small>No network activity</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu">
            <Menu />
          </button>
          <div>
            <h1>{active}</h1>
            <p>{new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(new Date())}</p>
          </div>
          {topbarSearchVisible && (
            <label className="search">
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter overview accounts" aria-label="Filter overview accounts" />
            </label>
          )}
          <button className="lock">
            <LockKeyhole size={16} /> Lock
          </button>
        </header>
        <section className="content">
          {active === "Imports" ? (
            <ImportPage accounts={accounts} transactions={transactions} onImported={refresh} />
          ) : active === "Rules" ? (
            <RulesPage />
          ) : active === "Budget" ? (
            <BudgetPage transactions={transactions} accounts={accounts} />
          ) : active === "Bills" ? (
            <BillsPage accounts={accounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} onChanged={refresh} />
          ) : active === "Forecast" ? (
            <ForecastPage accounts={accounts} templates={scheduledTemplates} />
          ) : active === "Debt" ? (
            <DebtPage accounts={accounts} />
          ) : active === "Reports" ? (
            <ReportsPage accounts={accounts} transactions={transactions} />
          ) : active === "Settings" ? (
            <BackupPage onRestored={refresh} />
          ) : active === "AI Insights" ? (
            <Planned title={active} />
          ) : active === "Transactions" ? (
            <>
              <StorageNotice />
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              <AccountRegister accounts={accounts} refreshToken={registerToken} onRequestDialog={handleRegisterDialog} />
            </>
          ) : active === "Accounts" ? (
            <>
              <StorageNotice />
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              {registerAccountId ? (
                <div className="accounts-page">
                  <div className="register-back">
                    <button onClick={() => setRegisterAccountId(undefined)}>
                      <ArrowLeft size={13} /> Back to accounts
                    </button>
                  </div>
                  <AccountRegister
                    accounts={accounts}
                    lockedAccountId={registerAccountId}
                    refreshToken={registerToken}
                    onRequestDialog={handleRegisterDialog}
                  />
                </div>
              ) : (
                <AccountsPage accounts={accounts} onAdd={() => setDialog("account")} onOpenRegister={openAccountRegister} onReconcile={(account) => setDialog({ kind: "reconciliation", account })} />
              )}
            </>
          ) : (
            <>
              <StorageNotice />
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              <div className="summary-grid">
                <Summary label="Available cash" value={formatMoney(assets)} detail="Positive tracked balances" tone="positive" />
                <Summary label="Liabilities" value={formatMoney(Math.abs(liabilities))} detail="Credit and loan balances" tone="negative" />
                <Summary label="Net worth" value={formatMoney(assets + liabilities)} detail="Based on tracked accounts" />
                <Summary label="Needs review" value={String(reviewCount)} detail="Transactions requiring attention" tone="warning" />
              </div>
              <UpcomingScheduled accounts={accounts} templates={scheduledTemplates} occurrences={scheduledOccurrences} />
              <section className="panel overview-accounts">
                <div className="panel-heading">
                  <div>
                    <h2>Accounts</h2>
                    <p>Open a register to review activity</p>
                  </div>
                  <button onClick={() => setDialog("account")}>+ Add account</button>
                </div>
                {accounts.length === 0 ? (
                  <Empty text="Add your first local account." />
                ) : (
                  accounts
                    .filter((account) => {
                      if (!query.trim()) return true;
                      const haystack = `${account.name} ${account.institution ?? ""} ${account.ownerLabel}`.toLowerCase();
                      return haystack.includes(query.trim().toLowerCase());
                    })
                    .map((account) => (
                      <div className="account-row" key={account.id}>
                        <div className={`account-icon ${account.type}`}>
                          <WalletCards size={17} />
                        </div>
                        <div>
                          <strong>{account.name}</strong>
                          <small>{[account.institution, account.ownerLabel].filter(Boolean).join(" · ")}</small>
                        </div>
                        <div className="account-balance">
                          <span className={account.balanceMinor < 0 ? "negative" : ""}>{formatMoney(account.balanceMinor, account.currency)}</span>
                          <button className="overview-account-button" onClick={() => openAccountRegister(account.id)}>
                            Open register
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </section>
            </>
          )}
        </section>
      </main>
      {dialog === "account" && (
        <AccountDialog
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog && dialog !== "account" && dialog.kind === "transaction" && (
        <TransactionDialog
          accounts={accounts}
          transaction={dialog.transaction}
          defaultAccountId={dialog.accountId}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog && dialog !== "account" && dialog.kind === "transfer" && (
        <TransferDialog
          accounts={accounts}
          transaction={dialog.transaction}
          defaultFromAccountId={dialog.accountId}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog && dialog !== "account" && dialog.kind === "reconciliation" && (
        <ReconciliationDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function StorageNotice() {
  return (
    <div className="notice">
      <strong>{isNativeApp ? "Local SQLite" : "Browser preview"}</strong>
      <span>
        {isNativeApp
          ? "Records are stored on this device. No network service is used."
          : "Synthetic, in-memory data only. Run through Tauri for durable SQLite storage."}
      </span>
    </div>
  );
}

function AccountsPage({
  accounts,
  onAdd,
  onOpenRegister,
  onReconcile,
}: {
  accounts: Account[];
  onAdd: () => void;
  onOpenRegister: (accountId: string) => void;
  onReconcile: (account: Account) => void;
}) {
  return (
    <section className="panel accounts-list">
      <div className="panel-heading">
        <div>
          <h2>Accounts</h2>
          <p>Select an account to open its Money-style register</p>
        </div>
        <button onClick={onAdd}>+ Add account</button>
      </div>
      {accounts.length === 0 ? (
        <Empty text="Add your first local account." />
      ) : (
        accounts.map((account) => (
          <div
            className="account-row"
            key={account.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenRegister(account.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenRegister(account.id);
              }
            }}
          >
            <div className={`account-icon ${account.type}`}>
              <WalletCards size={17} />
            </div>
            <div>
              <strong>{account.name}</strong>
              <small>{[account.institution, account.ownerLabel, accountTypeLabel(account.type)].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="account-balance">
              <span className={account.balanceMinor < 0 ? "negative" : ""}>{formatMoney(account.balanceMinor, account.currency)}</span>
              <div className="account-row-actions">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenRegister(account.id);
                  }}
                >
                  Open register
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onReconcile(account);
                  }}
                >
                  Reconcile
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function Summary({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <article className={`summary ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function Planned({ title }: { title: string }) {
  return (
    <section className="planned panel">
      <div className="planned-icon">
        <WalletCards />
      </div>
      <h2>{title} is planned</h2>
      <p>This area will be implemented as a tested vertical slice after the local ledger foundation is complete.</p>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
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

export function UpcomingScheduled({
  accounts,
  templates,
  occurrences,
}: {
  accounts: Account[];
  templates: ScheduledTransaction[];
  occurrences: ScheduledOccurrence[];
}) {
  const today = todayIso();
  const rows = occurrences
    .filter(
      (item) =>
        item.status === "expected" &&
        templates.some((template) => template.id === item.scheduledTransactionId && !template.archived && template.kind === "transaction"),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);
  return (
    <section className="panel upcoming-widget">
      <div className="panel-heading">
        <div>
          <h2>Upcoming</h2>
          <p>Next scheduled bills and deposits</p>
        </div>
        <CalendarDays size={18} />
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No scheduled events in the next 90 days.</div>
      ) : (
        <div className="upcoming-list">
          {rows.map((occurrence) => {
            const template = templates.find((item) => item.id === occurrence.scheduledTransactionId)!;
            const account = accounts.find((item) => item.id === template.accountId);
            const state = occurrenceDisplayState(occurrence, today);
            return (
              <div className="upcoming-row" key={occurrence.id}>
                <span>{formatDate(occurrence.dueDate)}</span>
                <div>
                  <strong>{template.payee}</strong>
                  <small>
                    {account?.name} · {template.category}
                  </small>
                </div>
                <span className={template.amountMinor < 0 ? "amount negative" : "amount positive"}>
                  {formatMoney(template.amountMinor, account?.currency)}
                </span>
                <span className={`occurrence-state ${state}`}>{occurrenceStateLabel(occurrence, today)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AccountDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await repository.createAccount({
        name: String(data.get("name") || "").trim(),
        institution: String(data.get("institution") || "").trim() || undefined,
        type: String(data.get("type")) as AccountType,
        currency: "USD",
        openingBalanceMinor: parseMoney(String(data.get("balance") || "0")),
        ownerLabel: String(data.get("owner") || "Household").trim(),
      });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }
  return (
    <Dialog title="Add account" onClose={onClose}>
      <form onSubmit={submit} className="entry-form">
        <label>
          Account name
          <input name="name" required maxLength={80} autoFocus />
        </label>
        <label>
          Institution
          <input name="institution" maxLength={80} />
        </label>
        <div className="form-row">
          <label>
            Type
            <select name="type" defaultValue="checking">
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit">Credit card</option>
              <option value="cash">Cash</option>
              <option value="loan">Loan</option>
              <option value="asset">Asset</option>
            </select>
          </label>
          <label>
            Opening balance
            <input name="balance" inputMode="decimal" defaultValue="0.00" required />
          </label>
        </div>
        <label>
          Owner
          <input name="owner" defaultValue="Household" required maxLength={80} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <FormActions onCancel={onClose} saving={saving} />
      </form>
    </Dialog>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function FormActions({ onCancel, saving }: { onCancel: () => void; saving: boolean }) {
  return (
    <div className="form-actions">
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button className="primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
