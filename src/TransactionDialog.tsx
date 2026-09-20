import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { formatMoney, parseMoney, sumMoney, type Account, type CreateTransactionSplit, type Transaction, type TransactionSplit, type TransactionStatus } from "./domain";
import { financeRepository as repository } from "./repository";
import "./transactionEditor.css";

interface SplitDraft { key:string; category:string; direction:"expense"|"income"; amount:string; memo:string; }

export function TransactionDialog({accounts,transaction,defaultAccountId,onClose,onSaved}:{accounts:Account[];transaction?:Transaction;defaultAccountId?:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [splitMode,setSplitMode]=useState(Boolean(transaction?.splits?.length));
  const [splits,setSplits]=useState<SplitDraft[]>(()=>transaction?.splits?.map(toDraft)??[]);
  const splitTotal=useMemo(()=>{
    try{return sumMoney(splits.map(split=>signedAmount(split)));}catch{return null;}
  },[splits]);

  function enableSplits(){
    if(splitMode){setSplitMode(false);return;}
    setSplitMode(true);
    if(!splits.length)setSplits([blankSplit(),blankSplit()]);
  }
  function updateSplit(key:string,patch:Partial<SplitDraft>){setSplits(current=>current.map(split=>split.key===key?{...split,...patch}:split));}

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError("");
    const data=new FormData(event.currentTarget);
    try{
      let amountMinor:number;
      let preparedSplits:CreateTransactionSplit[]|undefined;
      if(splitMode){
        if(splits.length<2)throw new Error("Add at least two split lines");
        preparedSplits=splits.map(split=>{
          if(!split.category.trim())throw new Error("Every split needs a category");
          const amount=signedAmount(split);
          if(amount===0)throw new Error("Split amounts cannot be zero");
          return {category:split.category.trim(),amountMinor:amount,memo:split.memo.trim()||undefined};
        });
        amountMinor=sumMoney(preparedSplits.map(split=>split.amountMinor));
        if(amountMinor===0)throw new Error("The split transaction total cannot be zero");
      }else{
        const raw=parseMoney(String(data.get("amount")));
        const direction=String(data.get("direction"));
        amountMinor=direction==="expense"?-Math.abs(raw):Math.abs(raw);
      }
      const input={
        accountId:String(data.get("accountId")),postedDate:String(data.get("date")),payee:String(data.get("payee")||"").trim(),
        category:splitMode?"Split transaction":String(data.get("category")||"Uncategorized").trim(),amountMinor,
        status:String(data.get("status")) as TransactionStatus,memo:String(data.get("memo")||"").trim()||undefined,splits:preparedSplits
      };
      if(transaction)await repository.updateTransaction(transaction.id,input);else await repository.createTransaction(input);
      await onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setSaving(false);}
  }

  async function remove(){
    if(!transaction)return;
    if(!confirmDelete){setConfirmDelete(true);return;}
    setSaving(true);setError("");
    try{await repository.deleteTransaction(transaction.id);await onSaved();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));setSaving(false);setConfirmDelete(false);}
  }

  const imported=Boolean(transaction?.importBatchId);
  const defaultDirection=transaction&&transaction.amountMinor>=0?"income":"expense";
  const defaultAmount=transaction?(Math.abs(transaction.amountMinor)/100).toFixed(2):"";
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)onClose();}}><section className="dialog transaction-dialog" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="dialog-header"><h2 id="transaction-title">{transaction?"Edit transaction":"New transaction"}</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div><form onSubmit={submit} className="entry-form transaction-form">
    <label>Account<select name={imported?undefined:"accountId"} defaultValue={transaction?.accountId??defaultAccountId??accounts[0]?.id} disabled={imported}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>{imported&&<input type="hidden" name="accountId" value={transaction?.accountId}/>}</label>
    <div className="form-row"><label>Date<input name="date" type="date" defaultValue={transaction?.postedDate??new Date().toISOString().slice(0,10)} required/></label>{!splitMode&&<label>Type<select name="direction" defaultValue={defaultDirection}><option value="expense">Expense</option><option value="income">Income</option></select></label>}</div>
    <label>Payee<input name="payee" defaultValue={transaction?.payee} required maxLength={160} autoFocus/></label>
    {!splitMode?<div className="form-row"><label>Category<input name="category" defaultValue={transaction?.category??"Uncategorized"} required maxLength={120}/></label><label>Amount<input name="amount" inputMode="decimal" defaultValue={defaultAmount} placeholder="0.00" required/></label></div>:<section className="split-editor"><div className="split-heading"><div><strong>Transaction splits</strong><small>Each line has its own income/expense direction.</small></div><button type="button" onClick={()=>setSplits(current=>[...current,blankSplit()])}><Plus size={13}/> Add line</button></div>{splits.map((split,index)=><div className="split-row" key={split.key}><label>Category<input value={split.category} onChange={event=>updateSplit(split.key,{category:event.target.value})} maxLength={120} placeholder={`Split ${index+1}`}/></label><label>Type<select value={split.direction} onChange={event=>updateSplit(split.key,{direction:event.target.value as SplitDraft["direction"]})}><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Amount<input value={split.amount} onChange={event=>updateSplit(split.key,{amount:event.target.value})} inputMode="decimal" placeholder="0.00"/></label><label>Memo<input value={split.memo} onChange={event=>updateSplit(split.key,{memo:event.target.value})} maxLength={500}/></label><button type="button" className="split-remove" onClick={()=>setSplits(current=>current.filter(item=>item.key!==split.key))} aria-label={`Remove split ${index+1}`}><Trash2 size={14}/></button></div>)}<div className="split-total"><span>Calculated transaction total</span><strong className={(splitTotal??0)<0?"negative":""}>{splitTotal===null?"Check split amounts":formatMoney(splitTotal)}</strong></div></section>}
    <button type="button" className="split-toggle" onClick={enableSplits}>{splitMode?"Use one category":"Split among categories"}</button>
    <label>Status<select name="status" defaultValue={transaction?.status??"cleared"}><option value="pending">Pending</option><option value="cleared">Cleared</option>{transaction?.status==="reconciled"&&<option value="reconciled" disabled>Reconciled by statement</option>}<option value="review">Needs review</option></select></label>
    <label>Memo<textarea name="memo" defaultValue={transaction?.memo} maxLength={500}/></label>
    {imported&&<p className="imported-note">This transaction came from an import batch. You can edit it, but deletion stays with the complete-batch Undo command.</p>}
    {error&&<p className="form-error">{error}</p>}
    <div className="transaction-actions">{transaction&&!imported?<button type="button" className={confirmDelete?"danger-action":"delete-link"} disabled={saving} onClick={remove}>{confirmDelete?"Confirm permanent deletion":"Delete transaction"}</button>:<span/>}<div className="form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving||Boolean(splitMode&&splitTotal===null)}>{saving?"Saving…":"Save"}</button></div></div>
    {confirmDelete&&<p className="delete-warning">Deleting this manual transaction changes its account balance and cannot be undone.</p>}
  </form></section></div>;
}

function blankSplit():SplitDraft{return{key:crypto.randomUUID(),category:"",direction:"expense",amount:"",memo:""};}
function toDraft(split:TransactionSplit):SplitDraft{return{key:split.id,category:split.category,direction:split.amountMinor>=0?"income":"expense",amount:(Math.abs(split.amountMinor)/100).toFixed(2),memo:split.memo??""};}
function signedAmount(split:SplitDraft):number{const amount=parseMoney(split.amount);return split.direction==="expense"?-Math.abs(amount):Math.abs(amount);}
