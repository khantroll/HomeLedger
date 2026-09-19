import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeftRight, BarChart3, Bot, CalendarDays, FileInput, Landmark, LayoutDashboard, ListFilter, LockKeyhole, Menu, ReceiptText, Search, Settings, Tags, TrendingUp, WalletCards, X } from "lucide-react";
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
import { addDaysIso,formatDate,occurrenceDisplayState,occurrenceStateLabel,todayIso } from "./scheduledPresentation";

type EditorDialog = "account" | {kind:"transaction";transaction?:Transaction} | {kind:"transfer";transaction?:Transaction} | {kind:"reconciliation";account:Account} | null;

const navItems = [
  ["Overview", LayoutDashboard], ["Accounts", Landmark], ["Transactions", ReceiptText], ["Imports", FileInput], ["Rules", ListFilter],
  ["Budget", Tags], ["Bills", CalendarDays], ["Forecast", TrendingUp], ["Reports", BarChart3], ["AI Insights", Bot], ["Settings", Settings]
] as const;

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [scheduledTemplates,setScheduledTemplates]=useState<ScheduledTransaction[]>([]);
  const [scheduledOccurrences,setScheduledOccurrences]=useState<ScheduledOccurrence[]>([]);
  const [active, setActive] = useState("Overview");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<EditorDialog>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts,nextTransactions,nextTemplates]=await Promise.all([repository.listAccounts(),repository.listTransactions(),repository.listScheduledTransactions()]);
      const fromDate=todayIso(),toDate=addDaysIso(fromDate,90);
      await repository.generateScheduledOccurrences({fromDate,toDate});
      const nextOccurrences=await repository.listScheduledOccurrences({fromDate,toDate});
      setAccounts(nextAccounts);setTransactions(nextTransactions);setScheduledTemplates(nextTemplates);setScheduledOccurrences(nextOccurrences);setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const assets = useMemo(() => sumMoney(accounts.filter(a => a.balanceMinor > 0).map(a => a.balanceMinor)), [accounts]);
  const liabilities = useMemo(() => sumMoney(accounts.filter(a => a.balanceMinor < 0).map(a => a.balanceMinor)), [accounts]);
  const filtered = transactions.filter(t => `${t.payee} ${t.category}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">H</span><div><strong>HomeLedger</strong><small>Local household finance</small></div></div>
      <nav aria-label="Primary navigation">{navItems.map(([label, Icon]) => <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}><Icon size={17}/><span>{label}</span>{!["Overview","Accounts","Transactions","Imports","Rules","Budget","Bills","Forecast","Settings"].includes(label) && <em>Planned</em>}</button>)}</nav>
      <div className="privacy"><LockKeyhole size={16}/><div><strong>Local mode</strong><small>No network activity</small></div></div>
    </aside>
    <main>
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open menu"><Menu/></button><div><h1>{active}</h1><p>{new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(new Date())}</p></div><label className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transactions" aria-label="Search transactions"/></label><button className="lock"><LockKeyhole size={16}/> Lock</button></header>
      <section className="content">
        {active === "Imports" ? <ImportPage accounts={accounts} transactions={transactions} onImported={refresh}/> : active === "Rules" ? <RulesPage/> : active === "Budget" ? <BudgetPage transactions={transactions}/> : active === "Bills" ? <BillsPage accounts={accounts} transactions={transactions} templates={scheduledTemplates} occurrences={scheduledOccurrences} onChanged={refresh}/> : active === "Forecast" ? <ForecastPage accounts={accounts} templates={scheduledTemplates}/> : active === "Settings" ? <BackupPage onRestored={refresh}/> : active !== "Overview" && active !== "Accounts" && active !== "Transactions" ? <Planned title={active}/> : <>
          <div className="notice"><strong>{isNativeApp ? "Local SQLite" : "Browser preview"}</strong><span>{isNativeApp ? "Records are stored on this device. No network service is used." : "Synthetic, in-memory data only. Run through Tauri for durable SQLite storage."}</span></div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <div className="summary-grid">
            <Summary label="Available cash" value={formatMoney(assets)} detail="Positive tracked balances" tone="positive"/>
            <Summary label="Liabilities" value={formatMoney(Math.abs(liabilities))} detail="Credit and loan balances" tone="negative"/>
            <Summary label="Net worth" value={formatMoney(assets + liabilities)} detail="Based on tracked accounts"/>
            <Summary label="Needs review" value={String(transactions.filter(t => t.status === "review").length)} detail="Transactions requiring attention" tone="warning"/>
          </div>
          {active==="Overview"&&<UpcomingScheduled accounts={accounts} templates={scheduledTemplates} occurrences={scheduledOccurrences}/>}
          <div className="workspace-grid">
            <section className="panel accounts-panel"><div className="panel-heading"><div><h2>Accounts</h2><p>Balances as of today</p></div><button onClick={() => setDialog("account")}>+ Add account</button></div>{accounts.length === 0 ? <Empty text="Add your first local account."/> : accounts.map(a => <div className="account-row" key={a.id}><div className={`account-icon ${a.type}`}><WalletCards size={17}/></div><div><strong>{a.name}</strong><small>{[a.institution, a.ownerLabel].filter(Boolean).join(" · ")}</small></div><div className="account-balance"><span className={a.balanceMinor < 0 ? "negative" : ""}>{formatMoney(a.balanceMinor, a.currency)}</span><button onClick={()=>setDialog({kind:"reconciliation",account:a})}>Reconcile</button></div></div>)}</section>
            <section className="panel register-panel"><div className="panel-heading"><div><h2>Recent transactions</h2><p>{filtered.length} shown</p></div><div className="register-actions"><button disabled={accounts.length<2} onClick={() => setDialog({kind:"transfer"})}><ArrowLeftRight size={13}/> Transfer</button><button disabled={!accounts.length} onClick={() => setDialog({kind:"transaction"})}>+ New transaction</button></div></div>{filtered.length === 0 ? <Empty text={accounts.length ? "No matching transactions." : "Create an account before entering transactions."}/> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>{filtered.map(t => <tr key={t.id}><td>{t.postedDate}</td><td><strong>{t.payee}</strong></td><td className="transaction-category">{t.category}{t.transferLinkId?<small><ArrowLeftRight size={11}/> Linked transfer</small>:t.splits?.length?<small>{t.splits.length} splits</small>:null}</td><td><span className={`status ${t.status}`}>{t.status}</span></td><td className={t.amountMinor < 0 ? "amount negative" : "amount positive"}>{formatMoney(t.amountMinor,accounts.find(account=>account.id===t.accountId)?.currency)}</td><td><button className="edit-transaction" onClick={()=>setDialog({kind:t.transferLinkId?"transfer":"transaction",transaction:t})}>{t.transferLinkId?"Transfer":"Edit"}</button></td></tr>)}</tbody></table></div>}</section>
          </div>
        </>}
      </section>
    </main>
    {dialog === "account" && <AccountDialog onClose={() => setDialog(null)} onSaved={async () => {
      setDialog(null); await refresh();
    }}/>}
    {dialog&&dialog!=="account"&&dialog.kind==="transaction" && (<TransactionDialog accounts={accounts} transaction={dialog.transaction} onClose={() => setDialog(null)} onSaved={async () => {
      setDialog(null); await refresh();
    }}/>)}
    {dialog&&dialog!=="account"&&dialog.kind==="transfer" && (<TransferDialog accounts={accounts} transaction={dialog.transaction} onClose={() => setDialog(null)} onSaved={async () => {
      setDialog(null); await refresh();
    }}/>)}
    {dialog&&dialog!=="account"&&dialog.kind==="reconciliation" && <ReconciliationDialog account={dialog.account} onClose={()=>setDialog(null)} onSaved={async()=>{
      setDialog(null);await refresh();
    }}/>}
  </div>;
}

function Summary({label,value,detail,tone=""}:{label:string;value:string;detail:string;tone?:string}) { return <article className={`summary ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Planned({title}:{title:string}) { return <section className="planned panel"><div className="planned-icon"><WalletCards/></div><h2>{title} is planned</h2><p>This area will be implemented as a tested vertical slice after the local ledger foundation is complete.</p></section>; }
function Empty({text}:{text:string}) { return <div className="empty-state">{text}</div>; }

export function UpcomingScheduled({accounts,templates,occurrences}:{accounts:Account[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[]}){
  const today=todayIso();
  const rows=occurrences.filter(item=>item.status==="expected"&&templates.some(template=>template.id===item.scheduledTransactionId&&!template.archived&&template.kind==="transaction")).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5);
  return <section className="panel upcoming-widget"><div className="panel-heading"><div><h2>Upcoming</h2><p>Next scheduled bills and deposits</p></div><CalendarDays size={18}/></div>{rows.length===0?<div className="empty-state">No scheduled events in the next 90 days.</div>:<div className="upcoming-list">{rows.map(occurrence=>{const template=templates.find(item=>item.id===occurrence.scheduledTransactionId)!,account=accounts.find(item=>item.id===template.accountId),state=occurrenceDisplayState(occurrence,today);return <div className="upcoming-row" key={occurrence.id}><span>{formatDate(occurrence.dueDate)}</span><div><strong>{template.payee}</strong><small>{account?.name} · {template.category}</small></div><span className={template.amountMinor<0?"amount negative":"amount positive"}>{formatMoney(template.amountMinor,account?.currency)}</span><span className={`occurrence-state ${state}`}>{occurrenceStateLabel(occurrence,today)}</span></div>;})}</div>}</section>;
}

function AccountDialog({onClose,onSaved}:{onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setError("");const data=new FormData(event.currentTarget);try{await repository.createAccount({name:String(data.get("name")||"").trim(),institution:String(data.get("institution")||"").trim()||undefined,type:String(data.get("type")) as AccountType,currency:"USD",openingBalanceMinor:parseMoney(String(data.get("balance")||"0")),ownerLabel:String(data.get("owner")||"Household").trim()});await onSaved();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));setSaving(false);}}
  return <Dialog title="Add account" onClose={onClose}><form onSubmit={submit} className="entry-form"><label>Account name<input name="name" required maxLength={80} autoFocus/></label><label>Institution<input name="institution" maxLength={80}/></label><div className="form-row"><label>Type<select name="type" defaultValue="checking"><option value="checking">Checking</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="cash">Cash</option><option value="loan">Loan</option><option value="asset">Asset</option></select></label><label>Opening balance<input name="balance" inputMode="decimal" defaultValue="0.00" required/></label></div><label>Owner<input name="owner" defaultValue="Household" required maxLength={80}/></label>{error&&<p className="form-error">{error}</p>}<FormActions onCancel={onClose} saving={saving}/></form></Dialog>;
}

function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) { return <div className="dialog-backdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)onClose();}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div>{children}</section></div>; }
function FormActions({onCancel,saving}:{onCancel:()=>void;saving:boolean}) { return <div className="form-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving}>{saving?"Saving…":"Save"}</button></div>; }
