import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Scale, X } from "lucide-react";
import { formatMoney, parseMoney, reconciliationBalance, reconciliationDifference, type Account, type Reconciliation, type Transaction } from "./domain";
import { financeRepository as repository } from "./repository";
import "./reconciliation.css";
import "./focus.css";

export function ReconciliationDialog({account,onClose,onSaved}:{account:Account;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [statementEndDate,setStatementEndDate]=useState(new Date().toISOString().slice(0,10));
  const [opening,setOpening]=useState("0.00");
  const [closing,setClosing]=useState("");
  const [transactions,setTransactions]=useState<Transaction[]>([]);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [history,setHistory]=useState<Reconciliation[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    let current=true;
    repository.listReconciliations(account.id).then(reconciliations=>{
      if(!current)return;
      setHistory(reconciliations);
      if(reconciliations.length)setOpening((reconciliations[0].closingBalanceMinor/100).toFixed(2));
    }).catch(reason=>current&&setError(reason instanceof Error?reason.message:String(reason)));
    return()=>{current=false;};
  },[account.id]);

  useEffect(()=>{
    let current=true;
    setLoading(true);
    repository.listReconciliationTransactions(account.id,statementEndDate).then(rows=>{
      if(!current)return;
      setTransactions(rows);
      setSelected(new Set(rows.filter(row=>row.status==="cleared").map(row=>row.id)));
      setError("");
    }).catch(reason=>current&&setError(reason instanceof Error?reason.message:String(reason))).finally(()=>current&&setLoading(false));
    return()=>{current=false;};
  },[account.id,statementEndDate]);

  useEffect(()=>{
    function closeOnEscape(event:KeyboardEvent){if(event.key==="Escape"&&!saving)onClose();}
    window.addEventListener("keydown",closeOnEscape);
    return()=>window.removeEventListener("keydown",closeOnEscape);
  },[onClose,saving]);

  const checked=useMemo(()=>transactions.filter(transaction=>selected.has(transaction.id)),[selected,transactions]);
  const difference=useMemo(()=>{
    try{return reconciliationDifference(parseMoney(opening),parseMoney(closing),checked);}
    catch{return null;}
  },[checked,closing,opening]);
  const calculated=useMemo(()=>{
    try{return reconciliationBalance(parseMoney(opening),checked);}
    catch{return null;}
  },[checked,opening]);

  function toggle(transactionId:string){
    setSelected(current=>{
      const next=new Set(current);
      if(next.has(transactionId))next.delete(transactionId);else next.add(transactionId);
      return next;
    });
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setSaving(true);setError("");
    try{
      const openingBalanceMinor=parseMoney(opening);
      const closingBalanceMinor=parseMoney(closing);
      if(reconciliationDifference(openingBalanceMinor,closingBalanceMinor,checked)!==0)throw new Error("The difference must be zero before reconciliation can be completed");
      await repository.completeReconciliation({
        accountId:account.id,statementEndDate,openingBalanceMinor,closingBalanceMinor,
        transactionIds:checked.map(transaction=>transaction.id)
      });
      await onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setSaving(false);}
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target&&!saving)onClose();}}>
    <section className="dialog reconciliation-dialog" role="dialog" aria-modal="true" aria-labelledby="reconciliation-title">
      <div className="dialog-header"><div><h2 id="reconciliation-title">Reconcile {account.name}</h2><small>Match HomeLedger to a statement closing balance</small></div><button onClick={onClose} disabled={saving} aria-label="Close"><X size={18}/></button></div>
      <form onSubmit={submit}>
        <div className="reconciliation-balances">
          <label>Statement end<input type="date" value={statementEndDate} onChange={event=>setStatementEndDate(event.target.value)} required/></label>
          <label>Opening balance<input value={opening} onChange={event=>setOpening(event.target.value)} inputMode="decimal" placeholder="0.00" required/></label>
          <label>Closing balance<input value={closing} onChange={event=>setClosing(event.target.value)} inputMode="decimal" placeholder="0.00" required/></label>
        </div>
        <div className="reconciliation-proof" aria-live="polite">
          <div><span>Checked transactions</span><strong>{checked.length}</strong></div>
          <div><span>Calculated balance</span><strong>{calculated===null?"—":formatMoney(calculated,account.currency)}</strong></div>
          <div className={difference===0?"balanced":"unbalanced"}><span>Difference</span><strong>{difference===null?"—":formatMoney(difference,account.currency)}</strong></div>
        </div>
        <div className="reconciliation-list">
          <div className="reconciliation-list-heading"><div><h3>Statement transactions</h3><p>Cleared items are checked initially. Check every item shown on this statement.</p></div><Scale size={19}/></div>
          {loading?<div className="empty-state">Loading account transactions…</div>:transactions.length===0?<div className="empty-state">No unreconciled transactions exist through this statement date.</div>:<div className="table-wrap"><table>
            <thead><tr><th><span className="sr-only">Checked</span></th><th>Date</th><th>Payee</th><th>Status</th><th>Amount</th></tr></thead>
            <tbody>{transactions.map(transaction=><tr key={transaction.id} className={selected.has(transaction.id)?"reconciliation-selected":""}>
              <td><input type="checkbox" checked={selected.has(transaction.id)} onChange={()=>toggle(transaction.id)} aria-label={`Include ${transaction.payee} from ${transaction.postedDate}`}/></td>
              <td>{transaction.postedDate}</td><td><strong>{transaction.payee}</strong><small>{transaction.category}</small></td>
              <td><span className={`status ${transaction.status}`}>{transaction.status}</span></td>
              <td className={transaction.amountMinor<0?"amount negative":"amount positive"}>{formatMoney(transaction.amountMinor,account.currency)}</td>
            </tr>)}</tbody>
          </table></div>}
        </div>
        {error&&<p className="form-error reconciliation-error" role="alert">{error}</p>}
        <div className="reconciliation-actions"><p><CheckCircle2 size={15}/> Completing locks checked transactions into this statement record.</p><div className="form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving||loading||difference!==0}>{saving?"Completing…":"Complete reconciliation"}</button></div></div>
      </form>
      {history.length>0&&<section className="reconciliation-history"><h3>Previous statements</h3>{history.slice(0,5).map(item=><div key={item.id}><span>{item.statementEndDate} · {item.transactionCount} transactions</span><strong>{formatMoney(item.closingBalanceMinor,account.currency)}</strong></div>)}</section>}
    </section>
  </div>;
}
