import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, BarChart3, Bot, BriefcaseBusiness, CalendarDays, CircleDollarSign, FileInput, Landmark, LayoutDashboard, ListFilter, LockKeyhole, Menu, ReceiptText, Search, Settings, Tags, TrendingDown, TrendingUp, WalletCards, X } from "lucide-react";
import { formatMoney, parseMoney, sumMoney, type Account, type AccountType, type BudgetMonth, type ScheduledOccurrence, type ScheduledTransaction, type Transaction } from "./domain";
import { financeRepository as repository, isNativeApp } from "./repository";
import { ImportPage } from "./ImportPage";
import { BackupPage } from "./BackupPage";
import { TransactionDialog } from "./TransactionDialog";
import { TransferDialog } from "./TransferDialog";
import { ReconciliationDialog } from "./ReconciliationDialog";
import "./register.css";
import "./accountLifecycle.css";
import { RulesPage } from "./RulesPage";
import { BillsPage, type BillsNavigationFocus } from "./BillsPage";
import { BudgetPage } from "./BudgetPage";
import { ForecastPage } from "./ForecastPage";
import { ReportsPage } from "./ReportsPage";
import { DebtPage } from "./DebtPage";
import { AiInsightsPage } from "./AiInsightsPage";
import { AccountRegister, type RegisterDialogRequest } from "./AccountRegister";
import { addDaysIso, formatDate, occurrenceDisplayState, occurrenceStateLabel, todayIso } from "./scheduledPresentation";
import {calculateCashFlowForecast,forecastMonths} from "./forecastMath";
import "./overviewCommand.css";
import "./onboarding.css";
import { PortfolioPage, type PortfolioNavigationFocus } from "./PortfolioPage";
import { InvestmentAccountDialog } from "./InvestmentEditors";

type NavigationIntent =
  | { page: "Transactions"; status: "review" }
  | { page: "Bills"; focus: BillsNavigationFocus }
  | { page: "Forecast" }
  | { page: "Budget" }
  | { page: "Portfolio"; focus?: PortfolioNavigationFocus };

type EditorDialog =
  | { kind: "account"; account?: Account }
  | { kind: "investmentAccount" }
  | { kind: "transaction"; transaction?: Transaction; accountId?: string }
  | { kind: "transfer"; transaction?: Transaction; accountId?: string }
  | { kind: "reconciliation"; account: Account }
  | null;

const navItems = [
  ["Overview", LayoutDashboard], ["Accounts", Landmark], ["Portfolio", BriefcaseBusiness], ["Transactions", ReceiptText], ["Imports", FileInput], ["Rules", ListFilter],
  ["Budget", Tags], ["Bills", CalendarDays], ["Forecast", TrendingUp], ["Debt", CircleDollarSign], ["Reports", BarChart3], ["AI Insights", Bot], ["Settings", Settings],
] as const;

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [scheduledTemplates, setScheduledTemplates] = useState<ScheduledTransaction[]>([]);
  const [scheduledOccurrences, setScheduledOccurrences] = useState<ScheduledOccurrence[]>([]);
  const [overviewBudgets, setOverviewBudgets] = useState<BudgetMonth[]>([]);
  const [active, setActive] = useState("Overview");
  const [navigationIntent, setNavigationIntent] = useState<NavigationIntent>();
  const [registerAccountId, setRegisterAccountId] = useState<string>();
  const [registerToken, setRegisterToken] = useState(0);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<EditorDialog>(null);
  const [error, setError] = useState("");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const today = todayIso();
      const [nextAccounts, nextTransactions, nextTemplates, nextBudgets] = await Promise.all([
        repository.listAccounts(true),
        repository.listTransactions(),
        repository.listScheduledTransactions(),
        Promise.all(forecastMonths(today,30).map(month=>repository.getBudgetMonth(month))),
      ]);
      const fromDate = addDaysIso(today, -90);
      const toDate = addDaysIso(today, 90);
      await repository.generateScheduledOccurrences({ fromDate, toDate });
      const nextOccurrences = await repository.listScheduledOccurrences({ fromDate, toDate });
      setAccounts(nextAccounts);
      setTransactions(nextTransactions);
      setScheduledTemplates(nextTemplates);
      setScheduledOccurrences(nextOccurrences);
      setOverviewBudgets(nextBudgets);
      setRegisterToken((value) => value + 1);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const loadOccurrenceMonth = useCallback(async (fromDate:string,toDate:string) => {
    await repository.generateScheduledOccurrences({fromDate,toDate});
    const rows=await repository.listScheduledOccurrences({fromDate,toDate});
    setScheduledOccurrences(current=>[...current.filter(item=>item.dueDate<fromDate||item.dueDate>toDate),...rows].sort((a,b)=>a.dueDate.localeCompare(b.dueDate)));
  },[]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeAccounts = useMemo(() => accounts.filter(account => !account.archived), [accounts]);
  const assets = useMemo(() => sumMoney(activeAccounts.filter((a) => a.balanceMinor > 0).map((a) => a.balanceMinor)), [activeAccounts]);
  const liabilities = useMemo(() => sumMoney(activeAccounts.filter((a) => a.balanceMinor < 0).map((a) => a.balanceMinor)), [activeAccounts]);
  const reviewCount = useMemo(() => transactions.filter((item) => item.status === "review").length, [transactions]);

  function openNav(label: string, intent?: NavigationIntent) {
    setActive(label);
    setNavigationIntent(intent);
    if (label !== "Accounts") setRegisterAccountId(undefined);
  }

  function openIntent(intent: NavigationIntent) {
    openNav(intent.page, intent);
  }

  function openAccountDestination(accountId: string) {
    const account = accounts.find(item => item.id === accountId);
    if (account?.type === "investment") {
      setRegisterAccountId(undefined);
      setNavigationIntent({ page: "Portfolio", focus: { accountId } });
      setActive("Portfolio");
      return;
    }
    setNavigationIntent(undefined);
    setRegisterAccountId(accountId);
    setActive("Accounts");
  }

  function openPortfolioSecurity(accountId: string, securityId: string) {
    setNavigationIntent({ page: "Portfolio", focus: { accountId, securityId } });
    setActive("Portfolio");
    setRegisterAccountId(undefined);
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
              {!["Overview", "Accounts", "Portfolio", "Transactions", "Imports", "Rules", "Budget", "Bills", "Forecast", "Debt", "Reports", "AI Insights", "Settings"].includes(label) && <em>Planned</em>}
            </button>
          ))}
        </nav>
        <div className="privacy">
          <LockKeyhole size={16} />
          <div>
            <strong>Local mode</strong>
            <small>Core records stay local</small>
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
          {active === "Portfolio" ? (
            <PortfolioPage
              accounts={activeAccounts}
              focus={navigationIntent?.page === "Portfolio" ? navigationIntent.focus : undefined}
              onShowAll={() => openNav("Portfolio", { page: "Portfolio" })}
              onOpenSecurity={openPortfolioSecurity}
            />
          ) : active === "Imports" ? (
            <ImportPage accounts={activeAccounts} transactions={transactions} onImported={refresh} />
          ) : active === "Rules" ? (
            <RulesPage />
          ) : active === "Budget" ? (
            <BudgetPage transactions={transactions} accounts={activeAccounts} />
          ) : active === "Bills" ? (
            <BillsPage accounts={activeAccounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} onChanged={refresh} onMonthChange={loadOccurrenceMonth} navigationFocus={navigationIntent?.page==="Bills"?navigationIntent.focus:undefined} />
          ) : active === "Forecast" ? (
            <ForecastPage accounts={activeAccounts} templates={scheduledTemplates} />
          ) : active === "Debt" ? (
            <DebtPage accounts={activeAccounts} />
          ) : active === "Reports" ? (
            <ReportsPage accounts={accounts} transactions={transactions} onOpenAccount={openAccountDestination} />
          ) : active === "Settings" ? (
            <BackupPage onRestored={refresh} />
          ) : active === "AI Insights" ? (
            <AiInsightsPage accounts={activeAccounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} budgets={overviewBudgets} />
          ) : active === "Transactions" ? (
            <>
              <StorageNotice />
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              <AccountRegister accounts={activeAccounts} initialStatus={navigationIntent?.page==="Transactions"?navigationIntent.status:"all"} refreshToken={registerToken} onRequestDialog={handleRegisterDialog} />
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
                      <ArrowLeft size={13} /> Back to account list
                    </button>
                  </div>
                  <AccountRegister
                    accounts={activeAccounts}
                    lockedAccountId={registerAccountId}
                    refreshToken={registerToken}
                    onRequestDialog={handleRegisterDialog}
                  />
                </div>
              ) : (
                <AccountsPage accounts={accounts} onAdd={() => setDialog({ kind: "account" })} onAddInvestment={() => setDialog({ kind: "investmentAccount" })} onEdit={(account) => setDialog({ kind: "account", account })} onChanged={refresh} onOpenRegister={openAccountDestination} onReconcile={(account) => setDialog({ kind: "reconciliation", account })} />
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
              {activeAccounts.length === 0 && !onboardingDismissed && (
                <FirstRunOnboarding
                  onAddAccount={() => setDialog({ kind: "account" })}
                  onDismiss={() => setOnboardingDismissed(true)}
                />
              )}
                            <div className="summary-grid">
                <Summary label="Available cash" value={formatMoney(assets)} detail="Positive tracked balances" tone="positive" />
                <Summary label="Liabilities" value={formatMoney(Math.abs(liabilities))} detail="Credit and loan balances" tone="negative" />
                <Summary label="Net worth" value={formatMoney(assets + liabilities)} detail="Based on tracked accounts" />
                <Summary label="Needs review" value={String(reviewCount)} detail="Transactions requiring attention" tone="warning" />
              </div>
              <OverviewCommandCenter accounts={activeAccounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} budgets={overviewBudgets} onNavigate={openIntent}/>
              <UpcomingScheduled accounts={activeAccounts} templates={scheduledTemplates} occurrences={scheduledOccurrences} onOpenBills={()=>openNav("Bills")} />
              <section className="panel overview-accounts">
                <div className="panel-heading">
                  <div>
                    <h2>Accounts</h2>
                    <p>Open a register to review activity</p>
                  </div>
                  <button onClick={() => setDialog({ kind: "account" })}>+ Add account</button>
                </div>
                {activeAccounts.length === 0 ? (
                  <Empty text="Add your first local account." />
                ) : (
                  activeAccounts
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
                          <strong>{account.name} {account.needsReview && <span className="review-badge">Needs review</span>}</strong>
                          <small>{[account.institution, account.ownerLabel].filter(Boolean).join(" · ")}</small>
                        </div>
                        <div className="account-balance">
                          <span className={account.balanceMinor < 0 ? "negative" : ""}>{account.type === "investment" ? "Investment portfolio" : formatMoney(account.balanceMinor, account.currency)}</span>
                          <button className="overview-account-button" onClick={() => openAccountDestination(account.id)}>
                            {account.type === "investment" ? "Open portfolio" : "Open register"}
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
      {dialog?.kind === "investmentAccount" && (
        <InvestmentAccountDialog
          onClose={() => setDialog(null)}
          onSaved={async (accountId) => {
            setDialog(null);
            await refresh();
            setRegisterAccountId(undefined);
            setNavigationIntent({ page: "Portfolio", focus: { accountId } });
            setActive("Portfolio");
          }}
        />
      )}
      {dialog?.kind === "account" && (
        <AccountDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.kind === "transaction" && (
        <TransactionDialog
          accounts={activeAccounts}
          transaction={dialog.transaction}
          defaultAccountId={dialog.accountId}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.kind === "transfer" && (
        <TransferDialog
          accounts={activeAccounts}
          transaction={dialog.transaction}
          defaultFromAccountId={dialog.accountId}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.kind === "reconciliation" && (
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


function FirstRunOnboarding({onAddAccount,onDismiss}:{onAddAccount:()=>void;onDismiss:()=>void}) {
  return <section className="panel first-run" aria-labelledby="first-run-title">
    <div className="first-run-copy">
      <span className="eyebrow">Welcome to HomeLedger</span>
      <h2 id="first-run-title">Start with the accounts you use today</h2>
      <p>HomeLedger keeps your financial history on this computer. Add one account now; you can add the rest, import old statements, budgets, and bills whenever you are ready.</p>
      <div className="first-run-actions"><button className="primary" onClick={onAddAccount}>Add my first account</button><button onClick={onDismiss}>Explore HomeLedger first</button></div>
    </div>
    <div className="first-run-steps" aria-label="Getting started">
      <div><strong>1</strong><span><b>Add an account</b><small>Checking, savings, card, loan, cash, or another asset.</small></span></div>
      <div><strong>2</strong><span><b>Choose a starting point</b><small>Use today’s balance for a clean start, or start at zero before importing older history.</small></span></div>
      <div><strong>3</strong><span><b>Bring in history when useful</b><small>Existing statement import stays optional. Nothing has to connect to your bank.</small></span></div>
    </div>
  </section>;
}

function StorageNotice() {
  return (
    <div className="notice">
      <strong>{isNativeApp ? "Local SQLite" : "Browser preview"}</strong>
      <span>
        {isNativeApp
          ? "Authoritative records stay on this device. Network access occurs only for explicit configured features such as AI or user-requested market prices."
          : "Synthetic, in-memory data only. Run through Tauri for durable SQLite storage."}
      </span>
    </div>
  );
}

function AccountsPage({
  accounts,
  onAdd,
  onAddInvestment,
  onEdit,
  onChanged,
  onOpenRegister,
  onReconcile,
}: {
  accounts: Account[];
  onAdd: () => void;
  onAddInvestment: () => void;
  onEdit: (account: Account) => void;
  onChanged: () => Promise<void>;
  onOpenRegister: (accountId: string) => void;
  onReconcile: (account: Account) => void;
}) {
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");
  const activeAccounts = accounts.filter(account => !account.archived);
  const archivedAccounts = accounts.filter(account => account.archived);

  async function move(accountId: string, direction: -1 | 1) {
    const index = activeAccounts.findIndex(account => account.id === accountId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= activeAccounts.length) return;
    const ids = activeAccounts.map(account => account.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await runAction(accountId, () => repository.reorderAccounts(ids));
  }

  async function runAction(accountId: string, action: () => Promise<void>) {
    setBusyId(accountId);
    setActionError("");
    try {
      await action();
      await onChanged();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="account-management">
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}
      <section className="panel accounts-list">
        <div className="panel-heading">
          <div>
            <h2>Accounts</h2>
            <p>Select an account to open its Money-style register or investment portfolio</p>
          </div>
          <div className="account-row-actions"><button onClick={onAdd}>+ Add account</button><button onClick={onAddInvestment}>+ Investment</button></div>
        </div>
        {activeAccounts.length === 0 ? <Empty text="Add your first local account." /> : activeAccounts.map((account, index) => (
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
              <strong>{account.name} {account.needsReview && <span className="review-badge">Needs review</span>}</strong>
              <small>{[account.institution, account.ownerLabel, accountTypeLabel(account.type)].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="account-balance">
              <span className={account.balanceMinor < 0 ? "negative" : ""}>{account.type === "investment" ? "Investment portfolio" : formatMoney(account.balanceMinor, account.currency)}</span>
              <div className="account-row-actions">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenRegister(account.id);
                  }}
                >
                  {account.type === "investment" ? "Open portfolio" : "Open register"}
                </button>
                {account.type !== "investment" && <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onReconcile(account);
                  }}
                >
                  Reconcile
                </button>}
                <button onClick={(event) => { event.stopPropagation(); onEdit(account); }}>Edit</button>
                <button disabled={busyId === account.id || index === 0} aria-label={`Move ${account.name} up`} onClick={(event) => { event.stopPropagation(); void move(account.id, -1); }}>↑</button>
                <button disabled={busyId === account.id || index === activeAccounts.length - 1} aria-label={`Move ${account.name} down`} onClick={(event) => { event.stopPropagation(); void move(account.id, 1); }}>↓</button>
                <button
                  className="danger-link"
                  disabled={busyId === account.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (window.confirm(`Archive ${account.name}? Its history will remain in reports.`)) void runAction(account.id, () => repository.setAccountArchived(account.id, true));
                  }}
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>
      {archivedAccounts.length > 0 && (
        <section className="panel accounts-list archived-accounts">
          <div className="panel-heading"><div><h2>Archived accounts</h2><p>History remains available in reports and backups</p></div></div>
          {archivedAccounts.map(account => (
            <div className="account-row archived" key={account.id}>
              <div className={`account-icon ${account.type}`}><WalletCards size={17} /></div>
              <div><strong>{account.name}</strong><small>{[account.institution, account.ownerLabel, accountTypeLabel(account.type)].filter(Boolean).join(" · ")}</small></div>
              <div className="account-balance">
                <span className={account.balanceMinor < 0 ? "negative" : ""}>{formatMoney(account.balanceMinor, account.currency)}</span>
                <div className="account-row-actions">
                  <button onClick={() => onEdit(account)}>Edit</button>
                  <button disabled={busyId === account.id} onClick={() => void runAction(account.id, () => repository.setAccountArchived(account.id, false))}>Restore</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
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
  onOpenBills,
}: {
  accounts: Account[];
  templates: ScheduledTransaction[];
  occurrences: ScheduledOccurrence[];
  onOpenBills?:()=>void;
}) {
  const today = todayIso();
  const rows = occurrences
    .filter(
      (item) =>
        item.status === "expected" &&
        templates.some((template) => template.id === item.scheduledTransactionId && template.enabled && !template.archived),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <section className="panel upcoming-widget">
      <div className="panel-heading">
        <div>
          <h2>Upcoming</h2>
          <p>All expected bills, deposits, and transfers in the planning window</p>
        </div>
        {onOpenBills?<button onClick={onOpenBills}><CalendarDays size={14}/> Open calendar</button>:<CalendarDays size={18} />}
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No scheduled events in the next 90 days.</div>
      ) : (
        <div className="upcoming-list">
          {rows.map((occurrence) => {
            const template = templates.find((item) => item.id === occurrence.scheduledTransactionId)!;
            const account = accounts.find((item) => item.id === template.accountId);
            const destination = accounts.find((item) => item.id === template.transferAccountId);
            const state = occurrenceDisplayState(occurrence, today);
            return (
              <div className="upcoming-row" key={occurrence.id}>
                <span>{formatDate(occurrence.dueDate)}</span>
                <div>
                  <strong>{template.payee}</strong>
                  <small>
                    {template.kind==="transfer"?<><ArrowLeftRight size={10}/> {account?.name} → {destination?.name}</>:<>{account?.name} · {template.category}</>}
                  </small>
                </div>
                <span className={template.kind==="transfer"?"amount":template.amountMinor < 0 ? "amount negative" : "amount positive"}>
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

export function OverviewCommandCenter({accounts,transactions,templates,occurrences,budgets,onNavigate,today=todayIso()}:{accounts:Account[];transactions:Transaction[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[];budgets:BudgetMonth[];onNavigate:(intent:NavigationIntent)=>void;today?:string}){
  const activeTemplates=new Map(templates.filter(item=>item.enabled&&!item.archived).map(item=>[item.id,item]));
  const overdue=occurrences.filter(item=>item.status==="expected"&&item.dueDate<today&&activeTemplates.has(item.scheduledTransactionId));
  const dueAutoPost=occurrences.filter(item=>item.status==="expected"&&item.dueDate<=today&&activeTemplates.get(item.scheduledTransactionId)?.autoPost);
  const reviewCount=transactions.filter(item=>item.status==="review").length;
  const currency=accounts.find(item=>["checking","savings","cash"].includes(item.type))?.currency??accounts[0]?.currency??"USD";
  const currentBudget=budgets.find(item=>item.month===today.slice(0,7));
  const forecast=calculateCashFlowForecast({today,horizonDays:30,currency,scenario:"expected",accounts,templates,occurrences,budgets});
  const attention:Array<{key:string;priority:number;tone:"negative"|"warning"|"quiet";icon:ReactNode;title:string;detail:string;action:string;intent:NavigationIntent}>=[];
  if(overdue.length)attention.push({key:"overdue",priority:10,tone:"negative",icon:<AlertTriangle size={16}/>,title:`${overdue.length} overdue scheduled ${overdue.length===1?"item":"items"}`,detail:`Oldest was due ${formatDate(overdue.map(item=>item.dueDate).sort()[0])}.`,action:"Review bills",intent:{page:"Bills",focus:{kind:"overdue",dueDate:overdue.map(item=>item.dueDate).sort()[0]}}});
  if(dueAutoPost.length)attention.push({key:"autopost",priority:20,tone:"warning",icon:<CalendarDays size={16}/>,title:`${dueAutoPost.length} automatic ${dueAutoPost.length===1?"posting is":"postings are"} due`,detail:"These expected occurrences are due to be posted automatically.",action:"Review scheduled items",intent:{page:"Bills",focus:{kind:"autoPost"}}});
  if(reviewCount)attention.push({key:"review",priority:30,tone:"warning",icon:<ReceiptText size={16}/>,title:`${reviewCount} ${reviewCount===1?"transaction needs":"transactions need"} review`,detail:"Confirm imported or uncategorized activity before treating the ledger as settled.",action:"Review transactions",intent:{page:"Transactions",status:"review"}});
  if(forecast.lowestBalanceMinor<0)attention.push({key:"forecast",priority:40,tone:"negative",icon:<TrendingDown size={16}/>,title:"Cash is projected to go negative",detail:`30-day low: ${formatMoney(forecast.lowestBalanceMinor,currency)} on ${formatDate(forecast.lowestBalanceDate)}.`,action:"Open forecast",intent:{page:"Forecast"}});
  if(currentBudget?.availableMinor!==undefined&&currentBudget.availableMinor<0)attention.push({key:"budget",priority:50,tone:"negative",icon:<Tags size={16}/>,title:"This month’s budget is over plan",detail:`${formatMoney(Math.abs(currentBudget.availableMinor),currency)} over the available plan; ${formatMoney(currentBudget.spentMinor,currency)} spent.`,action:"Review budget",intent:{page:"Budget"}});
  if(!currentBudget||currentBudget.lines.length===0)attention.push({key:"budget-setup",priority:90,tone:"quiet",icon:<Tags size={16}/>,title:"No current budget plan",detail:"Optional: add a monthly budget if you want spending-plan alerts here.",action:"Set up budget",intent:{page:"Budget"}});
  attention.sort((a,b)=>a.priority-b.priority);
  const urgent=attention.filter(item=>item.tone!=="quiet"),setup=attention.filter(item=>item.tone==="quiet");
  return <section className="panel command-center"><div className="panel-heading"><div><h2>What needs my attention today?</h2><p>{urgent.length?`${urgent.length} ${urgent.length===1?"area needs":"areas need"} a look.`:"Your ledger has no urgent attention items."}</p></div></div>
    {urgent.length===0&&<div className="attention-clear"><span className="command-icon positive">✓</span><span><strong>You're caught up</strong><small>No overdue scheduled items, review transactions, negative 30-day forecast, or budget overage detected.</small></span></div>}
    {attention.length>0&&<div className="attention-list">{[...urgent,...setup].map(item=><button key={item.key} className={`attention-item ${item.tone}`} onClick={()=>onNavigate(item.intent)}><span className={`command-icon ${item.tone}`}>{item.icon}</span><span className="attention-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="attention-action">{item.action} →</span></button>)}</div>}
  </section>;
}

function AccountDialog({ account, onClose, onSaved }: { account?: Account; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [startingPoint, setStartingPoint] = useState<"current"|"history">("current");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const details = {
        name: String(data.get("name") || "").trim(),
        institution: String(data.get("institution") || "").trim() || undefined,
        type: String(data.get("type")) as AccountType,
        currency: String(data.get("currency") || "").trim().toUpperCase(),
        ownerLabel: String(data.get("owner") || "Household").trim(),
      };
      if (account) await repository.updateAccount(account.id, details);
      else await repository.createAccount({ ...details, openingBalanceMinor: startingPoint === "history" ? 0 : parseMoney(String(data.get("balance") || "0")) });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }
  return (
    <Dialog title={account ? "Edit account" : "Add account"} onClose={onClose}>
      <form onSubmit={submit} className="entry-form">
        <label>
          Account name
          <input name="name" required maxLength={80} defaultValue={account?.name} autoFocus />
        </label>
        <label>
          Institution
          <input name="institution" maxLength={80} defaultValue={account?.institution} />
        </label>
        <div className="form-row">
          <label>
            Type
            <select name="type" defaultValue={account?.type ?? "checking"}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit">Credit card</option>
              <option value="cash">Cash</option>
              <option value="loan">Loan</option>
              <option value="asset">Asset</option>
              {account?.type === "investment" && <option value="investment">Investment</option>}
            </select>
          </label>
          {account ? (
            <label>
              Currency
              <input name="currency" list="currency-codes" defaultValue={account.currency} required maxLength={3} pattern="[A-Za-z]{3}" autoCapitalize="characters" />
            </label>
          ) : (
            <label>
              Currency
              <input name="currency" list="currency-codes" defaultValue="USD" required maxLength={3} pattern="[A-Za-z]{3}" autoCapitalize="characters" />
            </label>
          )}
        </div>
        {!account && <fieldset className="starting-point"><legend>How do you want to start this account?</legend>
          <label className="choice-card"><input type="radio" name="startingPoint" checked={startingPoint==="current"} onChange={()=>setStartingPoint("current")}/><span><strong>Start with what it is worth today</strong><small>Best if you mainly want to track from now on. Enter the current cleared balance; older statements can stay outside HomeLedger.</small></span></label>
          <label className="choice-card"><input type="radio" name="startingPoint" checked={startingPoint==="history"} onChange={()=>setStartingPoint("history")}/><span><strong>I plan to import older history</strong><small>Starts at zero so imported transactions build the balance. Use this only when your imported history reaches the account’s true beginning.</small></span></label>
          {startingPoint==="current" && <div className="balance-field"><label htmlFor="opening-balance">Current cleared balance</label><input id="opening-balance" name="balance" inputMode="decimal" defaultValue="0.00" required aria-describedby="opening-balance-help"/><small id="opening-balance-help" className="field-help">For credit cards and loans, enter what you owe as a negative amount (for example, -1250.00).</small></div>}
          {startingPoint==="history" && <div className="history-guidance"><strong>Important</strong><span>Do not enter today’s balance and then import transactions that happened before today; that would count those transactions twice. After saving, use Imports to add the history you want.</span></div>}
        </fieldset>}
        <datalist id="currency-codes"><option value="USD" /><option value="CAD" /><option value="EUR" /><option value="GBP" /><option value="AUD" /></datalist>
        <label>
          Owner
          <input name="owner" defaultValue={account?.ownerLabel ?? "Household"} required maxLength={80} />
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
