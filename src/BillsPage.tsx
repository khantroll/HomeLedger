import { useEffect,useMemo,useState,type FormEvent } from "react";
import { ArrowLeftRight,CalendarClock,CheckCircle2,ChevronLeft,ChevronRight,Link2,Pause,Play,Plus,SkipForward,Trash2,X } from "lucide-react";
import { formatMoney,parseMoney,type Account,type RecurrenceFrequency,type ScheduledOccurrence,type ScheduledTransaction,type ScheduledTransactionInput,type Transaction } from "./domain";
import { financeRepository as repository } from "./repository";
import { formatDate,nextExpectedOccurrence,occurrenceDisplayState,occurrenceStateLabel,recurrenceDescription,todayIso } from "./scheduledPresentation";
import {detectSubscriptions,type SubscriptionCandidate} from "./subscriptionDetection";
import {SuggestionLists,useLedgerSuggestions} from "./useLedgerSuggestions";
import {calendarDays,monthBounds,monthLabel,shiftMonth} from "./billsCalendar";
import type { BillsNavigationFocus, NavigationIntent } from "./navigationIntent";
import "./bills.css";

export type { BillsNavigationFocus };

export function BillsPage({accounts,transactions,templates,occurrences,onChanged,onMonthChange,today=todayIso(),navigationFocus,onNavigate}:{accounts:Account[];transactions:Transaction[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[];onChanged:()=>Promise<void>;onMonthChange?:(fromDate:string,toDate:string)=>Promise<void>;today?:string;navigationFocus?:BillsNavigationFocus;onNavigate?:(intent:NavigationIntent)=>void}){
  const [editing,setEditing]=useState<ScheduledTransaction|"new"|null>(null);
  const [confirmDelete,setConfirmDelete]=useState<string>();
  const [linking,setLinking]=useState<ScheduledOccurrence>();
  const [reviewingAutoPost,setReviewingAutoPost]=useState(navigationFocus?.kind==="autoPost");
  const [suggested,setSuggested]=useState<SubscriptionCandidate>();
  const initialFocusDate=navigationFocus&&("dueDate" in navigationFocus)?navigationFocus.dueDate:undefined;
  const [calendarMonth,setCalendarMonth]=useState(initialFocusDate?.slice(0,7)??today.slice(0,7));
  const [selectedDate,setSelectedDate]=useState<string|undefined>(initialFocusDate);
  const [error,setError]=useState("");
  const active=templates.filter(item=>!item.archived);
  const occurrenceRows=[...occurrences].sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const monthRows=occurrenceRows.filter(item=>item.dueDate.startsWith(`${calendarMonth}-`)&&(selectedDate===undefined||item.dueDate===selectedDate));
  const calendar=useMemo(()=>calendarDays(calendarMonth),[calendarMonth]);
  const autoPostRows=occurrenceRows.filter(item=>item.status==="expected"&&item.dueDate<=today&&templates.some(template=>template.id===item.scheduledTransactionId&&template.autoPost&&template.enabled&&!template.archived));
  const subscriptionCandidates=useMemo(()=>detectSubscriptions(transactions,templates,today),[transactions,templates,today]);

  useEffect(()=>{if(!onMonthChange)return;const bounds=monthBounds(calendarMonth);void onMonthChange(bounds.fromDate,bounds.toDate).catch(reason=>setError(message(reason)));},[calendarMonth,onMonthChange]);
  useEffect(()=>{
    if(navigationFocus?.kind==="overdue"||navigationFocus?.kind==="day"){
      setCalendarMonth(navigationFocus.dueDate.slice(0,7));
      setSelectedDate(navigationFocus.dueDate);
    }else if(navigationFocus?.kind==="autoPost")setReviewingAutoPost(true);
  },[navigationFocus]);

  function moveCalendar(offset:number){setCalendarMonth(value=>shiftMonth(value,offset));setSelectedDate(undefined);}
  function returnToToday(){setCalendarMonth(today.slice(0,7));setSelectedDate(today);}
  async function changed(){await onChanged();if(onMonthChange){const bounds=monthBounds(calendarMonth);await onMonthChange(bounds.fromDate,bounds.toDate);}}

  async function toggle(template:ScheduledTransaction){
    setError("");
    try{const{id:_id,archived:_archived,...input}=template;await repository.updateScheduledTransaction(template.id,{...input,enabled:!template.enabled});await changed();}
    catch(reason){setError(message(reason));}
  }
  async function remove(template:ScheduledTransaction){
    if(confirmDelete!==template.id){setConfirmDelete(template.id);return;}
    setError("");
    try{await repository.deleteScheduledTransaction(template.id);setConfirmDelete(undefined);await changed();}
    catch(reason){setError(message(reason));}
  }
  async function act(action:()=>Promise<unknown>){setError("");try{await action();await changed();}catch(reason){setError(message(reason));}}

  return <div className="bills-page">
    <section className="panel bills-intro"><div className="panel-heading"><div><h2>Scheduled transactions</h2><p>Bills, deposits, and transfers are planned here; balances change only after an explicit post or reviewed batch.</p></div><div className="bills-header-actions">{onNavigate&&<button type="button" className="planning-bridge-link" onClick={()=>onNavigate({page:"Forecast",focus:{horizonDays:30}})}>See cash forecast</button>}{autoPostRows.length>0&&<button className="auto-post-action" onClick={()=>setReviewingAutoPost(true)}><CheckCircle2 size={14}/> Review auto-post ({autoPostRows.length})</button>}<button disabled={!accounts.length} onClick={()=>setEditing("new")}><Plus size={14}/> New schedule</button></div></div><div className="bills-explainer"><CalendarClock size={20}/><div><strong>Calendar planning without surprise posting</strong><span>Automatic posting is opt-in and always requires reviewing the exact due items before one atomic commit.</span></div></div></section>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    <section className="panel bills-calendar-panel"><div className="panel-heading calendar-heading"><div><h2>{monthLabel(calendarMonth)}</h2><p>All scheduled bills, deposits, and transfers</p></div><div className="calendar-controls"><button aria-label="Previous month" onClick={()=>moveCalendar(-1)}><ChevronLeft size={14}/></button><button onClick={returnToToday}>Today</button><button aria-label="Next month" onClick={()=>moveCalendar(1)}><ChevronRight size={14}/></button></div></div>
      <div className="bills-calendar" role="grid" aria-label={`${monthLabel(calendarMonth)} scheduled transactions`}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day=><div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}
        {calendar.map(day=>{const dayRows=occurrenceRows.filter(item=>item.dueDate===day.date);return <button type="button" role="gridcell" aria-selected={selectedDate===day.date} aria-label={`${formatDate(day.date)}, ${dayRows.length} scheduled event${dayRows.length===1?"":"s"}`} className={`calendar-day${day.inCurrentMonth?"":" outside-month"}${day.date===today?" today":""}${selectedDate===day.date?" selected":""}`} key={day.date} onClick={()=>{setCalendarMonth(day.date.slice(0,7));setSelectedDate(day.date);}}><span className="calendar-day-number">{day.dayNumber}{day.date===today&&<small>Today</small>}</span><span className="calendar-events">{dayRows.slice(0,3).map(occurrence=>{const template=templates.find(item=>item.id===occurrence.scheduledTransactionId),account=accounts.find(item=>item.id===template?.accountId),state=occurrenceDisplayState(occurrence,today);return <span className={`calendar-event ${state}${template?.kind==="transfer"?" transfer":""}`} key={occurrence.id}><span className="calendar-event-name">{template?.kind==="transfer"?<ArrowLeftRight size={10}/>:<span aria-hidden="true">{stateSymbol(state)}</span>}{template?.payee??"Archived schedule"}</span><span>{template?formatMoney(template.amountMinor,account?.currency):"—"}</span><span className="sr-only">{occurrenceStateLabel(occurrence,today)}</span></span>;})}{dayRows.length>3&&<span className="calendar-more">+{dayRows.length-3} more</span>}</span></button>;})}
      </div>
      <div className="calendar-legend" aria-label="Calendar status legend"><span><i className="overdue"/>Overdue</span><span><i className="due-soon"/>Due soon</span><span><i className="upcoming"/>Upcoming</span><span><i className="posted"/>Completed</span><span><i className="transfer"/>Transfer</span></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Schedules</h2><p>{active.length} active or paused schedule{active.length===1?"":"s"}</p></div></div>
      {active.length===0?<div className="empty-state">No scheduled bills, deposits, or transfers yet.</div>:<div className="table-wrap"><table className="schedule-table"><thead><tr><th>Payee</th><th>Account</th><th>Category</th><th>Expected amount</th><th>Repeats</th><th>Next due</th><th>Status</th><th></th></tr></thead><tbody>{active.map(template=>{
        const account=accounts.find(item=>item.id===template.accountId),destination=accounts.find(item=>item.id===template.transferAccountId),next=nextExpectedOccurrence(template.id,occurrences),typeLabel=template.kind==="transfer"?"Transfer":template.amountMinor>0?"Deposit / income":"Bill / expense";
        return <tr key={template.id}><td><strong>{template.payee}</strong><small>{typeLabel}{template.autoPost?" · Auto-post queue":""}</small></td><td>{template.kind==="transfer"?`${account?.name??"Missing account"} → ${destination?.name??"Missing account"}`:account?.name??"Missing account"}</td><td>{template.kind==="transfer"?"Transfer":template.category}</td><td className={template.kind==="transaction"?(template.amountMinor<0?"amount negative":"amount positive"):"amount"}>{formatMoney(template.amountMinor,account?.currency)}</td><td>{recurrenceDescription(template)}</td><td>{next?formatDate(next.dueDate):template.enabled?"No occurrence generated":"Paused"}</td><td><span className={`schedule-state ${template.enabled?"active":"paused"}`}>{template.enabled?"Active":"Paused"}</span></td><td><div className="row-actions"><button onClick={()=>setEditing(template)}>Edit</button><button onClick={()=>void toggle(template)}>{template.enabled?<><Pause size={12}/> Pause</>:<><Play size={12}/> Resume</>}</button><button className={confirmDelete===template.id?"danger-action":""} onClick={()=>void remove(template)}><Trash2 size={12}/>{confirmDelete===template.id?"Confirm delete":"Delete"}</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
    <section className="panel subscription-panel"><div className="panel-heading"><div><h2>Detected subscriptions</h2><p>Stable recurring expenses found from local transaction history; nothing is scheduled automatically.</p></div><span className="candidate-count">{subscriptionCandidates.length} candidate{subscriptionCandidates.length===1?"":"s"}</span></div>
      {subscriptionCandidates.length===0?<div className="empty-state">No unscheduled recurring expenses have enough consistent history yet.</div>:<div className="table-wrap"><table className="subscription-table"><thead><tr><th>Payee</th><th>Account</th><th>Typical amount</th><th>Pattern</th><th>Next expected</th><th>Evidence</th><th></th></tr></thead><tbody>{subscriptionCandidates.map(candidate=>{const account=accounts.find(item=>item.id===candidate.accountId);return <tr key={candidate.id}><td><strong>{candidate.payee}</strong><small>{candidate.category}</small></td><td>{account?.name??"Missing account"}</td><td className="amount negative">{formatMoney(candidate.amountMinor,account?.currency)}</td><td>{frequencyLabel(candidate.frequency)}</td><td>{formatDate(candidate.nextDueDate)}</td><td><span className={`candidate-confidence ${candidate.confidence}`}>{candidate.confidence}</span><small>{candidate.occurrenceCount} payments · {candidate.medianIntervalDays}-day median · ±{formatMoney(candidate.amountVariationMinor,account?.currency)}</small></td><td><button onClick={()=>{setSuggested(candidate);setEditing("new");}}>Review and schedule</button></td></tr>;})}</tbody></table></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>{selectedDate?formatDate(selectedDate):`${monthLabel(calendarMonth)} agenda`}</h2><p>{selectedDate?"Scheduled events on the selected day":"Expected and completed events for the selected month"}</p></div>{selectedDate&&<button onClick={()=>setSelectedDate(undefined)}>Show whole month</button>}</div>
      {monthRows.length===0?<div className="empty-state">No scheduled events {selectedDate?"on this day":"in this month"}.</div>:<div className="table-wrap"><table className="occurrence-table"><thead><tr><th>Due date</th><th>Payee</th><th>Account</th><th>Amount</th><th>State</th><th></th></tr></thead><tbody>{monthRows.map(occurrence=>{
        const template=templates.find(item=>item.id===occurrence.scheduledTransactionId),account=accounts.find(item=>item.id===template?.accountId),state=occurrenceDisplayState(occurrence,today);
        const destination=accounts.find(item=>item.id===template?.transferAccountId);
        return <tr key={occurrence.id}><td>{formatDate(occurrence.dueDate)}</td><td><strong>{template?.payee??"Archived schedule"}</strong>{template?.kind==="transfer"&&<small><ArrowLeftRight size={11}/> {account?.name} to {destination?.name}</small>}{template?.archived&&<small>Deleted schedule</small>}</td><td>{account?.name??"—"}</td><td className={template?.kind==="transaction"&&template.amountMinor<0?"amount negative":"amount positive"}>{template?formatMoney(template.amountMinor,account?.currency):"—"}</td><td><span className={`occurrence-state ${state}`}><span aria-hidden="true">{stateSymbol(state)}</span>{occurrenceStateLabel(occurrence,today)}</span></td><td>{occurrence.status==="expected"&&template&&!template.archived?<div className="row-actions"><button onClick={()=>void act(()=>repository.postScheduledOccurrence(occurrence.id))}>Post Now</button><button onClick={()=>void act(()=>repository.skipScheduledOccurrence(occurrence.id))}><SkipForward size={12}/> Skip</button>{template.kind==="transaction"&&<button onClick={()=>setLinking(occurrence)}><Link2 size={12}/> Link</button>}</div>:occurrence.transactionId?<small className="linked-reference">{template?.kind==="transfer"?"Linked transfer posted":"Ledger transaction linked"}</small>:null}</td></tr>;
      })}</tbody></table></div>}
    </section>
    {editing&&<ScheduleDialog accounts={accounts} template={editing==="new"?undefined:editing} draft={editing==="new"&&suggested?suggestedDraft(suggested):undefined} onClose={()=>{setEditing(null);setSuggested(undefined);}} onSaved={async()=>{setEditing(null);setSuggested(undefined);await changed();}}/>}
    {linking&&<LinkDialog occurrence={linking} template={templates.find(item=>item.id===linking.scheduledTransactionId)!} transactions={transactions} accounts={accounts} onClose={()=>setLinking(undefined)} onLinked={async transactionId=>{await repository.linkScheduledOccurrence(linking.id,transactionId);setLinking(undefined);await changed();}}/>}
    {reviewingAutoPost&&<AutoPostDialog rows={autoPostRows} templates={templates} accounts={accounts} asOfDate={today} onClose={()=>setReviewingAutoPost(false)} onPosted={async()=>{setReviewingAutoPost(false);await changed();}}/>}
  </div>;
}

export function ScheduleDialog({accounts,template,draft,onClose,onSaved}:{accounts:Account[];template?:ScheduledTransaction;draft?:ScheduledTransactionInput;onClose:()=>void;onSaved:()=>Promise<void>}){
  const suggestions=useLedgerSuggestions();
  const seed=template??draft;
  const [frequency,setFrequency]=useState<RecurrenceFrequency>(seed?.frequency??"monthly");
  const [direction,setDirection]=useState<"expense"|"deposit"|"transfer">(seed?.kind==="transfer"?"transfer":(seed?.amountMinor??-1)>0?"deposit":"expense");
  const [fromAccountId,setFromAccountId]=useState(seed?.accountId??accounts[0]?.id??"");
  const sourceAccount=accounts.find(item=>item.id===fromAccountId),transferDestinations=accounts.filter(item=>item.id!==fromAccountId&&item.currency===sourceAccount?.currency);
  const [toAccountId,setToAccountId]=useState(seed?.transferAccountId??transferDestinations[0]?.id??"");
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError("");
    const data=new FormData(event.currentTarget);
    try{
      const raw=Math.abs(parseMoney(String(data.get("amount")))),anchorDate=String(data.get("anchorDate"));
      if(!raw)throw new Error("Expected amount must be greater than zero");
      const input:ScheduledTransactionInput={kind:direction==="transfer"?"transfer":"transaction",accountId:String(data.get("accountId")),transferAccountId:direction==="transfer"?String(data.get("transferAccountId")):undefined,payee:String(data.get("payee")||"").trim(),category:direction==="transfer"?"Transfer":String(data.get("category")||"").trim(),amountMinor:direction==="expense"?-raw:raw,status:"pending",memo:String(data.get("memo")||"").trim()||undefined,frequency,anchorDate,endDate:String(data.get("endDate")||"")||undefined,secondMonthDay:frequency==="semimonthly"?Number(data.get("secondMonthDay")):undefined,customIntervalCount:frequency==="custom"?Number(data.get("customIntervalCount")):undefined,customIntervalUnit:frequency==="custom"?String(data.get("customIntervalUnit")) as ScheduledTransactionInput["customIntervalUnit"]:undefined,enabled:seed?.enabled??true,autoPost:data.get("autoPost")==="on"};
      if(template)await repository.updateScheduledTransaction(template.id,input);else await repository.createScheduledTransaction(input);
      await onSaved();
    }catch(reason){setError(message(reason));setSaving(false);}
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target&&!saving)onClose();}}><section className="dialog schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-title"><div className="dialog-header"><h2 id="schedule-title">{template?"Edit scheduled transaction":"New scheduled transaction"}</h2><button onClick={onClose} disabled={saving} aria-label="Close"><X size={18}/></button></div><form className="entry-form" onSubmit={submit}>
    <div className="form-row"><label>Type<select value={direction} onChange={event=>setDirection(event.target.value as typeof direction)}><option value="expense">Bill or expense</option><option value="deposit">Deposit or income</option><option value="transfer">Account transfer</option></select></label><label>{direction==="transfer"?"From account":"Account"}<select name="accountId" value={fromAccountId} onChange={event=>{const next=event.target.value,nextCurrency=accounts.find(item=>item.id===next)?.currency,nextDestinations=accounts.filter(item=>item.id!==next&&item.currency===nextCurrency);setFromAccountId(next);if(!nextDestinations.some(item=>item.id===toAccountId))setToAccountId(nextDestinations[0]?.id??"");}} required>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
    {direction==="transfer"&&<label>To account<select name="transferAccountId" value={toAccountId} onChange={event=>setToAccountId(event.target.value)} required>{transferDestinations.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>{transferDestinations.length===0&&<small>Add another {sourceAccount?.currency} account before scheduling this transfer.</small>}</label>}
    <label>Payee or source<input name="payee" list={suggestions.payeeListId} defaultValue={seed?.payee} required maxLength={160} autoFocus placeholder={direction==="expense"?"Electric utility":"Employer payroll"}/></label>
    <div className="form-row">{direction!=="transfer"&&<label>Category<input name="category" list={suggestions.categoryListId} defaultValue={seed?.category??"Uncategorized"} required maxLength={120}/></label>}<label>Expected amount<input name="amount" inputMode="decimal" defaultValue={seed?(Math.abs(seed.amountMinor)/100).toFixed(2):""} required placeholder="0.00"/></label></div>
    <div className="form-row"><label>Repeats<select value={frequency} onChange={event=>setFrequency(event.target.value as RecurrenceFrequency)}><option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option><option value="semimonthly">Twice each month</option><option value="monthly">Every month</option><option value="annual">Every year</option><option value="custom">Custom interval</option></select></label><label>First due date<input name="anchorDate" type="date" defaultValue={seed?.anchorDate??todayIso()} required/></label></div>
    {frequency==="semimonthly"&&<label>Second day each month<input name="secondMonthDay" type="number" min="1" max="31" defaultValue={seed?.secondMonthDay??15} required/><small>Use 31 for the last day in shorter months.</small></label>}
    {frequency==="custom"&&<div className="form-row"><label>Repeat every<input name="customIntervalCount" type="number" min="1" max="10000" defaultValue={seed?.customIntervalCount??1} required/></label><label>Interval<select name="customIntervalUnit" defaultValue={seed?.customIntervalUnit??"months"}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></label></div>}
    <label>End date (optional)<input name="endDate" type="date" defaultValue={seed?.endDate}/></label>
    <label>Memo<textarea name="memo" defaultValue={seed?.memo} maxLength={500}/></label>
    <label className="auto-post-choice"><input name="autoPost" type="checkbox" defaultChecked={seed?.autoPost}/><span><strong>Add due items to the auto-post queue</strong><small>Nothing posts until you review and confirm the queue.</small></span></label>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving||(direction==="transfer"&&!toAccountId)}>{saving?"Saving…":"Save schedule"}</button></div>
    <SuggestionLists {...suggestions}/>
  </form></section></div>;
}

function LinkDialog({occurrence,template,transactions,accounts,onClose,onLinked}:{occurrence:ScheduledOccurrence;template:ScheduledTransaction;transactions:Transaction[];accounts:Account[];onClose:()=>void;onLinked:(id:string)=>Promise<void>}){
  const candidates=useMemo(()=>transactions.filter(item=>item.accountId===template.accountId&&item.amountMinor===template.amountMinor&&!item.transferLinkId),[template,transactions]);
  const [transactionId,setTransactionId]=useState(candidates[0]?.id??""),[saving,setSaving]=useState(false),[error,setError]=useState("");
  async function link(){setSaving(true);setError("");try{await onLinked(transactionId);}catch(reason){setError(message(reason));setSaving(false);}}
  const account=accounts.find(item=>item.id===template.accountId);
  return <div className="dialog-backdrop"><section className="dialog link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-title"><div className="dialog-header"><h2 id="link-title">Link existing transaction</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div><div className="entry-form"><p className="mapping-help">Choose an existing {formatMoney(template.amountMinor,account?.currency)} transaction in {account?.name} for the {formatDate(occurrence.dueDate)} occurrence.</p>{candidates.length?<label>Matching transaction<select value={transactionId} onChange={event=>setTransactionId(event.target.value)}>{candidates.map(item=><option key={item.id} value={item.id}>{item.postedDate} · {item.payee} · {formatMoney(item.amountMinor,account?.currency)}</option>)}</select></label>:<p className="form-error">No unlinked transaction has the same account and amount.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button onClick={onClose} disabled={saving}>Cancel</button><button className="primary" onClick={()=>void link()} disabled={saving||!transactionId}>{saving?"Linking…":"Link transaction"}</button></div></div></section></div>;
}

function AutoPostDialog({rows,templates,accounts,asOfDate,onClose,onPosted}:{rows:ScheduledOccurrence[];templates:ScheduledTransaction[];accounts:Account[];asOfDate:string;onClose:()=>void;onPosted:()=>Promise<void>}){
  const [posting,setPosting]=useState(false),[error,setError]=useState("");
  async function post(){setPosting(true);setError("");try{await repository.processScheduledAutoPost({occurrenceIds:rows.map(item=>item.id),asOfDate});await onPosted();}catch(reason){setError(message(reason));setPosting(false);}}
  return <div className="dialog-backdrop"><section className="dialog auto-post-dialog" role="dialog" aria-modal="true" aria-labelledby="auto-post-title"><div className="dialog-header"><div><h2 id="auto-post-title">Review auto-post queue</h2><small>{rows.length} due item{rows.length===1?"":"s"} will be committed together</small></div><button onClick={onClose} disabled={posting} aria-label="Close"><X size={18}/></button></div><div className="auto-post-list">{rows.map(occurrence=>{const template=templates.find(item=>item.id===occurrence.scheduledTransactionId)!,source=accounts.find(item=>item.id===template.accountId),destination=accounts.find(item=>item.id===template.transferAccountId);return <article key={occurrence.id}><span><strong>{template.payee}</strong><small>{formatDate(occurrence.dueDate)} · {template.kind==="transfer"?`${source?.name} → ${destination?.name}`:source?.name}</small></span><strong className={template.kind==="transaction"&&template.amountMinor<0?"negative":""}>{formatMoney(template.amountMinor,source?.currency)}</strong></article>;})}</div><p className="auto-post-warning">HomeLedger will revalidate every item, create any transfer pairs, and update the occurrences in one database transaction. If one item changed, nothing posts.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions auto-post-controls"><button onClick={onClose} disabled={posting}>Cancel</button><button className="primary" onClick={()=>void post()} disabled={posting}>{posting?"Posting…":`Confirm and post ${rows.length}`}</button></div></section></div>;
}

function stateSymbol(state:string){return state==="overdue"?"!":state==="due-soon"?"●":state==="upcoming"?"○":state==="posted"?"✓":state==="skipped"?"→":"↗";}
function frequencyLabel(value:SubscriptionCandidate["frequency"]){return value==="weekly"?"Weekly":value==="biweekly"?"Every 2 weeks":value==="monthly"?"Monthly":"Annual";}
function suggestedDraft(candidate:SubscriptionCandidate):ScheduledTransactionInput{return{kind:"transaction",accountId:candidate.accountId,payee:candidate.payee,category:candidate.category,amountMinor:candidate.amountMinor,status:"pending",frequency:candidate.frequency,anchorDate:candidate.nextDueDate,enabled:true,autoPost:false,memo:`Detected from ${candidate.occurrenceCount} consistent local transactions; review before scheduling.`};}
function message(reason:unknown){return reason instanceof Error?reason.message:String(reason);}
