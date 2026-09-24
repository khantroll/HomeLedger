import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, BarChart3, Bot, BriefcaseBusiness, CalendarDays, CircleDollarSign, FileInput, Landmark, LayoutDashboard, ListFilter, LockKeyhole, Menu, ReceiptText, Search, Settings, Tags, TrendingDown, TrendingUp, WalletCards, X } from "lucide-react";
import { formatMoney, parseMoney, type Account, type AccountType, type BudgetMonth, type CreateTransactionInput, type MerchantRuleInput, type ScheduledOccurrence, type ScheduledTransaction, type ScheduledTransactionInput, type Security, type Transaction } from "./domain";
import { financeRepository as repository, investmentRepository, isNativeApp } from "./repository";
import { calculateHouseholdValuation, householdCurrencies } from "./householdValuation";
import type { PortfolioSnapshot } from "./domain";
import { ImportPage } from "./ImportPage";
import { BackupPage } from "./BackupPage";
import { TransactionDialog } from "./TransactionDialog";
import { TransferDialog } from "./TransferDialog";
import { ReconciliationDialog } from "./ReconciliationDialog";
import "./register.css";
import "./accountLifecycle.css";
import { RuleDialog, RulesPage } from "./RulesPage";
import { BillsPage, ScheduleDialog } from "./BillsPage";
import { BudgetPage } from "./BudgetPage";
import { ForecastPage } from "./ForecastPage";
import { ReportsPage } from "./ReportsPage";
import { DebtPage } from "./DebtPage";
import { AiInsightsPage } from "./AiInsightsPage";
import { AccountRegister, type RegisterDialogRequest } from "./AccountRegister";
import { addDaysIso, formatDate, occurrenceDisplayState, occurrenceStateLabel, todayIso } from "./scheduledPresentation";
import {calculateCashFlowForecast,forecastMonths} from "./forecastMath";
import type { NavigationIntent } from "./navigationIntent";
import "./overviewCommand.css";
import "./onboarding.css";
import { PortfolioPage } from "./PortfolioPage";
import { InvestmentAccountDialog } from "./InvestmentEditors";
import { FinancialFindDialog } from "./FinancialFindDialog";
import type { FinancialFindResult } from "./financialFind";
import { resolveFinancialFindLanding } from "./financialFindNavigation";

type EditorDialog =
  | { kind: "account"; account?: Account }
  | { kind: "investmentAccount" }
  | { kind: "transaction"; transaction?: Transaction; accountId?: string; draft?: CreateTransactionInput }
  | { kind: "transfer"; transaction?: Transaction; accountId?: string }
  | { kind: "reconciliation"; account: Account }
  | { kind: "schedule"; draft: ScheduledTransactionInput }
  | { kind: "rule"; draft: MerchantRuleInput }
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
  const [findSecurities, setFindSecurities] = useState<Security[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [overviewBudgets, setOverviewBudgets] = useState<BudgetMonth[]>([]);
  const [active, setActive] = useState("Overview");
  const [navigationIntent, setNavigationIntent] = useState<NavigationIntent>();
  const [registerAccountId, setRegisterAccountId] = useState<string>();
  const [registerToken, setRegisterToken] = useState(0);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<EditorDialog>(null);
  const [error, setError] = useState("");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [overviewPortfolio, setOverviewPortfolio] = useState<PortfolioSnapshot>();
  const [valuationCurrency, setValuationCurrency] = useState("");

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
      if(isNativeApp) investmentRepository.listSecurities(true).then(setFindSecurities).catch(()=>setFindSecurities([]));
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
  const valuationCurrencies = useMemo(() => householdCurrencies(activeAccounts), [activeAccounts]);
  useEffect(() => { if (!valuationCurrencies.includes(valuationCurrency)) setValuationCurrency(valuationCurrencies[0] ?? "USD"); }, [valuationCurrencies, valuationCurrency]);
  useEffect(() => { if (active !== "Overview") return; const ids=activeAccounts.filter(a=>a.type==="investment").map(a=>a.id); if(!ids.length){setOverviewPortfolio({asOfDate:todayIso(),accounts:[]});return;} let cancelled=false; investmentRepository.calculatePortfolioSnapshot(ids,todayIso()).then(value=>{if(!cancelled)setOverviewPortfolio(value);}).catch(reason=>{if(!cancelled){setOverviewPortfolio(undefined);setError(reason instanceof Error?reason.message:String(reason));}}); return()=>{cancelled=true}; }, [active, activeAccounts]);
  const household = useMemo(() => calculateHouseholdValuation(activeAccounts, overviewPortfolio, valuationCurrency || valuationCurrencies[0] || "USD"), [activeAccounts, overviewPortfolio, valuationCurrency, valuationCurrencies]);
  const reviewCount = useMemo(() => transactions.filter((item) => item.status === "review").length, [transactions]);


  useEffect(() => {
    const openFind = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "f" && key !== "k") return;
      // Ctrl/Cmd+K always opens Find. Ctrl/Cmd+F opens Find unless the user is typing in a
      // field that still benefits from the host find/replace shortcut (e.g. multi-line notes).
      if (key === "f") {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement) return;
        if (target instanceof HTMLElement && target.isContentEditable) return;
      }
      event.preventDefault();
      setFindOpen(true);
    };
    window.addEventListener("keydown", openFind);
    return () => window.removeEventListener("keydown", openFind);
  }, []);

  function openFindResult(result: FinancialFindResult) {
    setFindOpen(false);
    const landing = resolveFinancialFindLanding(result, {
      accounts,
      transactions,
      occurrences: scheduledOccurrences,
    });
    if (landing.kind === "accounts") {
      setRegisterAccountId(undefined);
      setNavigationIntent(undefined);
      setActive("Accounts");
      return;
    }
    if (landing.kind === "bills") {
      setRegisterAccountId(undefined);
      setNavigationIntent(undefined);
      setActive("Bills");
      return;
    }
    if (landing.kind === "account-destination") {
      openAccountDestination(landing.accountId);
      return;
    }
    setRegisterAccountId(undefined);
    setNavigationIntent(landing.intent);
    setActive(landing.intent.page);
  }

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
          <button type="button" className="search" onClick={()=>setFindOpen(true)} aria-label="Open Financial Find"><Search size={16}/><span>Financial Find</span><kbd>Ctrl K</kbd></button>
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
            <BudgetPage transactions={transactions} accounts={activeAccounts} navigationFocus={navigationIntent?.page==="Budget"?navigationIntent.focus:undefined} onNavigate={openIntent} />
          ) : active === "Bills" ? (
            <BillsPage accounts={activeAccounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} onChanged={refresh} onMonthChange={loadOccurrenceMonth} navigationFocus={navigationIntent?.page==="Bills"?navigationIntent.focus:undefined} onNavigate={openIntent} />
          ) : active === "Forecast" ? (
            <ForecastPage accounts={activeAccounts} templates={scheduledTemplates} navigationFocus={navigationIntent?.page==="Forecast"?navigationIntent.focus:undefined} onNavigate={openIntent} />
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
              <AccountRegister accounts={accounts} initialAccountId={navigationIntent?.page==="Transactions"?navigationIntent.accountId:undefined} initialStatus={navigationIntent?.page==="Transactions"?navigationIntent.status:"all"} initialSearch={navigationIntent?.page==="Transactions"?navigationIntent.search:undefined} focusPostedDate={navigationIntent?.page==="Transactions"?navigationIntent.postedDate:undefined} focusTransactionId={navigationIntent?.page==="Transactions"?navigationIntent.transactionId:undefined} refreshToken={registerToken} onRequestDialog={handleRegisterDialog} />
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
                            <div className="overview-valuation-scope"><label>Household currency <select aria-label="Household valuation currency" value={household.currency} onChange={event=>setValuationCurrency(event.target.value)}>{valuationCurrencies.length?valuationCurrencies.map(currency=><option key={currency}>{currency}</option>):<option>USD</option>}</select></label>{household.incompleteInvestment&&<span className="notice">Net worth is incomplete because some investment holdings have no eligible price.</span>}</div>
              <div className="summary-grid">
                <Summary label="Available cash" value={formatMoney(household.availableCashMinor,household.currency)} detail="Positive checking, savings, and cash balances" tone="positive" />
                <Summary label="Liabilities" value={formatMoney(Math.abs(household.liabilitiesMinor),household.currency)} detail="Credit and loan balances" tone="negative" />
                <Summary label="Net worth" value={formatMoney(household.netWorthKnownMinor,household.currency)} detail={household.incompleteInvestment?`Known subtotal · ${household.unvaluedHoldingCount} unvalued investment${household.unvaluedHoldingCount===1?"":"s"}`:"Ordinary + investment value"} />
                <Summary label="Needs review" value={String(reviewCount)} detail="Transactions requiring attention" tone="warning" />
              </div>
              <OverviewCommandCenter accounts={activeAccounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} budgets={overviewBudgets} onNavigate={openIntent}/>
              <UpcomingScheduled accounts={activeAccounts} templates={scheduledTemplates} occurrences={scheduledOccurrences} onNavigate={openIntent} />
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
          draft={dialog.draft}
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
      {dialog?.kind === "schedule" && (
        <ScheduleDialog
          accounts={activeAccounts}
          draft={dialog.draft}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.kind === "rule" && (
        <RuleDialog
          draft={dialog.draft}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {findOpen&&<FinancialFindDialog accounts={accounts} transactions={transactions} schedules={scheduledTemplates} securities={findSecurities} onClose={()=>setFindOpen(false)} onSelect={openFindResult}/>}
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
                <span className={account.balanceMinor < 0 ? "negative" : ""}>{account.type === "investment" ? "Investment portfolio" : formatMoney(account.balanceMinor, account.currency)}</span>
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
    case "investment":
      return "Investment";
  }
}

export function UpcomingScheduled({
  accounts,
  templates,
  occurrences,
  onNavigate,
}: {
  accounts: Account[];
  templates: ScheduledTransaction[];
  occurrences: ScheduledOccurrence[];
  onNavigate?: (intent: NavigationIntent) => void;
}) {
  const today = todayIso();
  const rows = occurrences
    .filter(
      (item) =>
        item.status === "expected" &&
        templates.some((template) => template.id === item.scheduledTransactionId && template.enabled && !template.archived),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const openDay = (dueDate: string) => onNavigate?.({ page: "Bills", focus: { kind: "day", dueDate } });
  const openCalendar = () => openDay(rows[0]?.dueDate ?? today);
  return (
    <section className="panel upcoming-widget">
      <div className="panel-heading">
        <div>
          <h2>Coming up</h2>
          <p>Expected bills, deposits, and transfers — open any row to see it on the Bills calendar</p>
        </div>
        {onNavigate ? (
          <button type="button" onClick={openCalendar}>
            <CalendarDays size={14} /> Open calendar
          </button>
        ) : (
          <CalendarDays size={18} />
        )}
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
            const body = (
              <>
                <span>{formatDate(occurrence.dueDate)}</span>
                <div>
                  <strong>{template.payee}</strong>
                  <small>
                    {template.kind === "transfer" ? (
                      <>
                        <ArrowLeftRight size={10} /> {account?.name} → {destination?.name}
                      </>
                    ) : (
                      <>
                        {account?.name} · {template.category}
                      </>
                    )}
                  </small>
                </div>
                <span className={template.kind === "transfer" ? "amount" : template.amountMinor < 0 ? "amount negative" : "amount positive"}>
                  {formatMoney(template.amountMinor, account?.currency)}
                </span>
                <span className={`occurrence-state ${state}`}>{occurrenceStateLabel(occurrence, today)}</span>
              </>
            );
            return onNavigate ? (
              <button
                type="button"
                className="upcoming-row upcoming-row-button"
                key={occurrence.id}
                onClick={() => openDay(occurrence.dueDate)}
                aria-label={`Open ${template.payee} on ${formatDate(occurrence.dueDate)} on the bills calendar`}
              >
                {body}
              </button>
            ) : (
              <div className="upcoming-row" key={occurrence.id}>
                {body}
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
  const dueSoon=occurrences.filter(item=>item.status==="expected"&&item.dueDate>=today&&item.dueDate<=addDaysIso(today,7)&&activeTemplates.has(item.scheduledTransactionId)&&!dueAutoPost.some(auto=>auto.id===item.id));
  const reviewCount=transactions.filter(item=>item.status==="review").length;
  const currency=accounts.find(item=>["checking","savings","cash"].includes(item.type))?.currency??accounts[0]?.currency??"USD";
  const hasCashAccounts=accounts.some(item=>["checking","savings","cash"].includes(item.type));
  const currentBudget=budgets.find(item=>item.month===today.slice(0,7));
  const forecast=calculateCashFlowForecast({today,horizonDays:30,currency,scenario:"expected",accounts,templates,occurrences,budgets});
  const attention:Array<{key:string;priority:number;tone:"negative"|"warning"|"quiet";icon:ReactNode;title:string;detail:string;action:string;intent:NavigationIntent}>=[];
  if(overdue.length){
    const oldestDue=overdue.map(item=>item.dueDate).sort()[0];
    const oldest=overdue.find(item=>item.dueDate===oldestDue)!;
    const oldestTemplate=activeTemplates.get(oldest.scheduledTransactionId);
    attention.push({
      key:"overdue",
      priority:10,
      tone:"negative",
      icon:<AlertTriangle size={16}/>,
      title:oldestTemplate?`${oldestTemplate.payee} is overdue`:`${overdue.length} overdue scheduled ${overdue.length===1?"item":"items"}`,
      detail:overdue.length>1?`${overdue.length} overdue items · oldest was due ${formatDate(oldestDue)}.`:`Due ${formatDate(oldestDue)}.`,
      action:"Review bills",
      intent:{page:"Bills",focus:{kind:"overdue",dueDate:oldestDue}},
    });
  }
  if(dueAutoPost.length)attention.push({key:"autopost",priority:20,tone:"warning",icon:<CalendarDays size={16}/>,title:`${dueAutoPost.length} automatic ${dueAutoPost.length===1?"posting is":"postings are"} due`,detail:"These expected occurrences are ready for the reviewed auto-post queue.",action:"Review scheduled items",intent:{page:"Bills",focus:{kind:"autoPost"}}});
  if(reviewCount)attention.push({key:"review",priority:30,tone:"warning",icon:<ReceiptText size={16}/>,title:`${reviewCount} ${reviewCount===1?"transaction needs":"transactions need"} review`,detail:"Confirm imported or uncategorized activity before treating the ledger as settled.",action:"Review transactions",intent:{page:"Transactions",status:"review"}});
  if(forecast.lowestBalanceMinor<0)attention.push({key:"forecast",priority:40,tone:"negative",icon:<TrendingDown size={16}/>,title:"Cash is projected to go negative",detail:`30-day low: ${formatMoney(forecast.lowestBalanceMinor,currency)} on ${formatDate(forecast.lowestBalanceDate)}.`,action:"Open forecast",intent:{page:"Forecast",focus:{horizonDays:30,highlightDate:forecast.lowestBalanceDate}}});
  if(currentBudget?.availableMinor!==undefined&&currentBudget.availableMinor<0)attention.push({key:"budget",priority:50,tone:"negative",icon:<Tags size={16}/>,title:"This month’s budget is over plan",detail:`${formatMoney(Math.abs(currentBudget.availableMinor),currency)} over the available plan; ${formatMoney(currentBudget.spentMinor,currency)} spent.`,action:"Review budget",intent:{page:"Budget",focus:{month:today.slice(0,7)}}});
  if(!overdue.length&&dueSoon.length){
    const nextDue=dueSoon.map(item=>item.dueDate).sort()[0];
    const next=dueSoon.find(item=>item.dueDate===nextDue)!;
    const nextTemplate=activeTemplates.get(next.scheduledTransactionId);
    attention.push({
      key:"due-soon",
      priority:60,
      tone:"quiet",
      icon:<CalendarDays size={16}/>,
      title:nextTemplate?`${nextTemplate.payee} is due soon`:`${dueSoon.length} scheduled ${dueSoon.length===1?"item is":"items are"} due soon`,
      detail:dueSoon.length>1?`${dueSoon.length} items in the next 7 days · next on ${formatDate(nextDue)}.`:`Due ${formatDate(nextDue)}.`,
      action:"Open bills",
      intent:{page:"Bills",focus:{kind:"day",dueDate:nextDue}},
    });
  }
  if(!currentBudget||currentBudget.lines.length===0)attention.push({key:"budget-setup",priority:90,tone:"quiet",icon:<Tags size={16}/>,title:"No current budget plan",detail:"Optional: add a monthly budget if you want spending-plan alerts here.",action:"Set up budget",intent:{page:"Budget",focus:{month:today.slice(0,7)}}});
  attention.sort((a,b)=>a.priority-b.priority);
  const urgent=attention.filter(item=>item.tone!=="quiet"),setup=attention.filter(item=>item.tone==="quiet");
  return <section className="panel command-center"><div className="panel-heading"><div><h2>Today</h2><p>{urgent.length?`${urgent.length} ${urgent.length===1?"area needs":"areas need"} a look.`:"Your ledger has no urgent attention items."}</p></div></div>
    {urgent.length===0&&<div className="attention-clear"><span className="command-icon positive">✓</span><span><strong>You're caught up</strong><small>No overdue scheduled items, review transactions, negative 30-day forecast, or budget overage detected.</small></span></div>}
    {attention.length>0&&<div className="attention-list">{[...urgent,...setup].map(item=><button key={item.key} className={`attention-item ${item.tone}`} onClick={()=>onNavigate(item.intent)}><span className={`command-icon ${item.tone}`}>{item.icon}</span><span className="attention-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="attention-action">{item.action} →</span></button>)}</div>}
    {hasCashAccounts&&forecast.lowestBalanceMinor>=0&&<div className="today-cash-peek"><span><strong>Near-term cash</strong><small>Lowest projected cash in 30 days: {formatMoney(forecast.lowestBalanceMinor,currency)} on {formatDate(forecast.lowestBalanceDate)}.</small></span><button type="button" onClick={()=>onNavigate({page:"Forecast",focus:{horizonDays:30,highlightDate:forecast.lowestBalanceDate}})}>See forecast →</button></div>}
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
