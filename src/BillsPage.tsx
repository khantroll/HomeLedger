import { useMemo,useState,type FormEvent } from "react";
import { CalendarClock,Link2,Pause,Play,Plus,SkipForward,Trash2,X } from "lucide-react";
import { formatMoney,parseMoney,type Account,type RecurrenceFrequency,type ScheduledOccurrence,type ScheduledTransaction,type ScheduledTransactionInput,type Transaction } from "./domain";
import { financeRepository as repository } from "./repository";
import { formatDate,nextExpectedOccurrence,occurrenceDisplayState,occurrenceStateLabel,recurrenceDescription,todayIso } from "./scheduledPresentation";
import "./bills.css";

export function BillsPage({accounts,transactions,templates,occurrences,onChanged,today=todayIso()}:{accounts:Account[];transactions:Transaction[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[];onChanged:()=>Promise<void>;today?:string}){
  const [editing,setEditing]=useState<ScheduledTransaction|"new"|null>(null);
  const [confirmDelete,setConfirmDelete]=useState<string>();
  const [linking,setLinking]=useState<ScheduledOccurrence>();
  const [error,setError]=useState("");
  const active=templates.filter(item=>!item.archived&&item.kind==="transaction");
  const occurrenceRows=occurrences.filter(item=>templates.find(template=>template.id===item.scheduledTransactionId)?.kind==="transaction").sort((a,b)=>a.dueDate.localeCompare(b.dueDate));

  async function toggle(template:ScheduledTransaction){
    setError("");
    try{const{id:_id,archived:_archived,...input}=template;await repository.updateScheduledTransaction(template.id,{...input,enabled:!template.enabled});await onChanged();}
    catch(reason){setError(message(reason));}
  }
  async function remove(template:ScheduledTransaction){
    if(confirmDelete!==template.id){setConfirmDelete(template.id);return;}
    setError("");
    try{await repository.deleteScheduledTransaction(template.id);setConfirmDelete(undefined);await onChanged();}
    catch(reason){setError(message(reason));}
  }
  async function act(action:()=>Promise<unknown>){setError("");try{await action();await onChanged();}catch(reason){setError(message(reason));}}

  return <div className="bills-page">
    <section className="panel bills-intro"><div className="panel-heading"><div><h2>Scheduled transactions</h2><p>Bills and deposits are planned here; account balances change only when an occurrence is posted or linked.</p></div><button disabled={!accounts.length} onClick={()=>setEditing("new")}><Plus size={14}/> New schedule</button></div><div className="bills-explainer"><CalendarClock size={20}/><div><strong>Next 90 days</strong><span>Each occurrence is independent. Skipping one does not pause the schedule, and posting one does not change future due dates.</span></div></div></section>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    <section className="panel"><div className="panel-heading"><div><h2>Schedules</h2><p>{active.length} bill{active.length===1?"":"s"} or deposit{active.length===1?"":"s"}, including paused items</p></div></div>
      {active.length===0?<div className="empty-state">No scheduled bills or deposits yet.</div>:<div className="table-wrap"><table className="schedule-table"><thead><tr><th>Payee</th><th>Account</th><th>Category</th><th>Expected amount</th><th>Repeats</th><th>Next due</th><th>Status</th><th></th></tr></thead><tbody>{active.map(template=>{
        const account=accounts.find(item=>item.id===template.accountId),next=nextExpectedOccurrence(template.id,occurrences);
        return <tr key={template.id}><td><strong>{template.payee}</strong><small>{template.amountMinor>0?"Deposit / income":"Bill / expense"}</small></td><td>{account?.name??"Missing account"}</td><td>{template.category}</td><td className={template.amountMinor<0?"amount negative":"amount positive"}>{formatMoney(template.amountMinor,account?.currency)}</td><td>{recurrenceDescription(template)}</td><td>{next?formatDate(next.dueDate):template.enabled?"No occurrence generated":"Paused"}</td><td><span className={`schedule-state ${template.enabled?"active":"paused"}`}>{template.enabled?"Active":"Paused"}</span></td><td><div className="row-actions"><button onClick={()=>setEditing(template)}>Edit</button><button onClick={()=>void toggle(template)}>{template.enabled?<><Pause size={12}/> Pause</>:<><Play size={12}/> Resume</>}</button><button className={confirmDelete===template.id?"danger-action":""} onClick={()=>void remove(template)}><Trash2 size={12}/>{confirmDelete===template.id?"Confirm delete":"Delete"}</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Upcoming and recent occurrences</h2><p>Expected and completed events in the 90-day planning window</p></div></div>
      {occurrenceRows.length===0?<div className="empty-state">No occurrences in this window.</div>:<div className="table-wrap"><table className="occurrence-table"><thead><tr><th>Due date</th><th>Payee</th><th>Account</th><th>Amount</th><th>State</th><th></th></tr></thead><tbody>{occurrenceRows.map(occurrence=>{
        const template=templates.find(item=>item.id===occurrence.scheduledTransactionId),account=accounts.find(item=>item.id===template?.accountId),state=occurrenceDisplayState(occurrence,today);
        return <tr key={occurrence.id}><td>{formatDate(occurrence.dueDate)}</td><td><strong>{template?.payee??"Archived schedule"}</strong>{template?.archived&&<small>Deleted schedule</small>}</td><td>{account?.name??"—"}</td><td className={(template?.amountMinor??0)<0?"amount negative":"amount positive"}>{template?formatMoney(template.amountMinor,account?.currency):"—"}</td><td><span className={`occurrence-state ${state}`}><span aria-hidden="true">{stateSymbol(state)}</span>{occurrenceStateLabel(occurrence,today)}</span></td><td>{occurrence.status==="expected"&&template&&!template.archived?<div className="row-actions"><button onClick={()=>void act(()=>repository.postScheduledOccurrence(occurrence.id))}>Post Now</button><button onClick={()=>void act(()=>repository.skipScheduledOccurrence(occurrence.id))}><SkipForward size={12}/> Skip</button><button onClick={()=>setLinking(occurrence)}><Link2 size={12}/> Link</button></div>:occurrence.transactionId?<small className="linked-reference">Ledger transaction linked</small>:null}</td></tr>;
      })}</tbody></table></div>}
    </section>
    {editing&&<ScheduleDialog accounts={accounts} template={editing==="new"?undefined:editing} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await onChanged();}}/>}
    {linking&&<LinkDialog occurrence={linking} template={templates.find(item=>item.id===linking.scheduledTransactionId)!} transactions={transactions} accounts={accounts} onClose={()=>setLinking(undefined)} onLinked={async transactionId=>{await repository.linkScheduledOccurrence(linking.id,transactionId);setLinking(undefined);await onChanged();}}/>}
  </div>;
}

function ScheduleDialog({accounts,template,onClose,onSaved}:{accounts:Account[];template?:ScheduledTransaction;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [frequency,setFrequency]=useState<RecurrenceFrequency>(template?.frequency??"monthly");
  const [direction,setDirection]=useState<"expense"|"deposit">((template?.amountMinor??-1)>0?"deposit":"expense");
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError("");
    const data=new FormData(event.currentTarget);
    try{
      const raw=Math.abs(parseMoney(String(data.get("amount")))),anchorDate=String(data.get("anchorDate"));
      if(!raw)throw new Error("Expected amount must be greater than zero");
      const input:ScheduledTransactionInput={kind:"transaction",accountId:String(data.get("accountId")),payee:String(data.get("payee")||"").trim(),category:String(data.get("category")||"").trim(),amountMinor:direction==="expense"?-raw:raw,status:"pending",memo:String(data.get("memo")||"").trim()||undefined,frequency,anchorDate,endDate:String(data.get("endDate")||"")||undefined,secondMonthDay:frequency==="semimonthly"?Number(data.get("secondMonthDay")):undefined,customIntervalCount:frequency==="custom"?Number(data.get("customIntervalCount")):undefined,customIntervalUnit:frequency==="custom"?String(data.get("customIntervalUnit")) as ScheduledTransactionInput["customIntervalUnit"]:undefined,enabled:template?.enabled??true};
      if(template)await repository.updateScheduledTransaction(template.id,input);else await repository.createScheduledTransaction(input);
      await onSaved();
    }catch(reason){setError(message(reason));setSaving(false);}
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target&&!saving)onClose();}}><section className="dialog schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-title"><div className="dialog-header"><h2 id="schedule-title">{template?"Edit scheduled transaction":"New scheduled transaction"}</h2><button onClick={onClose} disabled={saving} aria-label="Close"><X size={18}/></button></div><form className="entry-form" onSubmit={submit}>
    <div className="form-row"><label>Type<select value={direction} onChange={event=>setDirection(event.target.value as typeof direction)}><option value="expense">Bill or expense</option><option value="deposit">Deposit or income</option></select></label><label>Account<select name="accountId" defaultValue={template?.accountId} required>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
    <label>Payee or source<input name="payee" defaultValue={template?.payee} required maxLength={160} autoFocus placeholder={direction==="expense"?"Electric utility":"Employer payroll"}/></label>
    <div className="form-row"><label>Category<input name="category" defaultValue={template?.category??"Uncategorized"} required maxLength={120}/></label><label>Expected amount<input name="amount" inputMode="decimal" defaultValue={template?(Math.abs(template.amountMinor)/100).toFixed(2):""} required placeholder="0.00"/></label></div>
    <div className="form-row"><label>Repeats<select value={frequency} onChange={event=>setFrequency(event.target.value as RecurrenceFrequency)}><option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option><option value="semimonthly">Twice each month</option><option value="monthly">Every month</option><option value="annual">Every year</option><option value="custom">Custom interval</option></select></label><label>First due date<input name="anchorDate" type="date" defaultValue={template?.anchorDate??todayIso()} required/></label></div>
    {frequency==="semimonthly"&&<label>Second day each month<input name="secondMonthDay" type="number" min="1" max="31" defaultValue={template?.secondMonthDay??15} required/><small>Use 31 for the last day in shorter months.</small></label>}
    {frequency==="custom"&&<div className="form-row"><label>Repeat every<input name="customIntervalCount" type="number" min="1" max="10000" defaultValue={template?.customIntervalCount??1} required/></label><label>Interval<select name="customIntervalUnit" defaultValue={template?.customIntervalUnit??"months"}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></label></div>}
    <label>End date (optional)<input name="endDate" type="date" defaultValue={template?.endDate}/></label>
    <label>Memo<textarea name="memo" defaultValue={template?.memo} maxLength={500}/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving}>{saving?"Saving…":"Save schedule"}</button></div>
  </form></section></div>;
}

function LinkDialog({occurrence,template,transactions,accounts,onClose,onLinked}:{occurrence:ScheduledOccurrence;template:ScheduledTransaction;transactions:Transaction[];accounts:Account[];onClose:()=>void;onLinked:(id:string)=>Promise<void>}){
  const candidates=useMemo(()=>transactions.filter(item=>item.accountId===template.accountId&&item.amountMinor===template.amountMinor&&!item.transferLinkId),[template,transactions]);
  const [transactionId,setTransactionId]=useState(candidates[0]?.id??""),[saving,setSaving]=useState(false),[error,setError]=useState("");
  async function link(){setSaving(true);setError("");try{await onLinked(transactionId);}catch(reason){setError(message(reason));setSaving(false);}}
  const account=accounts.find(item=>item.id===template.accountId);
  return <div className="dialog-backdrop"><section className="dialog link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-title"><div className="dialog-header"><h2 id="link-title">Link existing transaction</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div><div className="entry-form"><p className="mapping-help">Choose an existing {formatMoney(template.amountMinor,account?.currency)} transaction in {account?.name} for the {formatDate(occurrence.dueDate)} occurrence.</p>{candidates.length?<label>Matching transaction<select value={transactionId} onChange={event=>setTransactionId(event.target.value)}>{candidates.map(item=><option key={item.id} value={item.id}>{item.postedDate} · {item.payee} · {formatMoney(item.amountMinor,account?.currency)}</option>)}</select></label>:<p className="form-error">No unlinked transaction has the same account and amount.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button onClick={onClose} disabled={saving}>Cancel</button><button className="primary" onClick={()=>void link()} disabled={saving||!transactionId}>{saving?"Linking…":"Link transaction"}</button></div></div></section></div>;
}

function stateSymbol(state:string){return state==="overdue"?"!":state==="due-soon"?"●":state==="upcoming"?"○":state==="posted"?"✓":state==="skipped"?"→":"↗";}
function message(reason:unknown){return reason instanceof Error?reason.message:String(reason);}
