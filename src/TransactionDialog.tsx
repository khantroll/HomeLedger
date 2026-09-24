import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Paperclip, Plus, Trash2, X } from "lucide-react";
import { formatMoney, parseMoney, sumMoney, TRANSACTION_NOTE_MAX_LENGTH, type Account, type CreateTransactionInput, type CreateTransactionSplit, type Transaction, type TransactionAttachment, type TransactionSplit, type TransactionStatus } from "./domain";
import { financeRepository as repository } from "./repository";
import { SuggestionLists, useLedgerSuggestions } from "./useLedgerSuggestions";
import "./transactionEditor.css";

interface SplitDraft { key:string; category:string; direction:"expense"|"income"; amount:string; memo:string; }

export function TransactionDialog({accounts,transaction,draft,defaultAccountId,onClose,onSaved}:{accounts:Account[];transaction?:Transaction;draft?:CreateTransactionInput;defaultAccountId?:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const suggestions=useLedgerSuggestions();
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [attachments,setAttachments]=useState<TransactionAttachment[]>([]);
  const [attachmentsLoading,setAttachmentsLoading]=useState(false);
  const [attachmentBusy,setAttachmentBusy]=useState(false);
  const seed=transaction??draft;
  const [splitMode,setSplitMode]=useState(Boolean(seed?.splits?.length));
  const [splits,setSplits]=useState<SplitDraft[]>(()=>seed?.splits?.map(toDraft)??[]);
  const splitTotal=useMemo(()=>{
    try{return sumMoney(splits.map(split=>signedAmount(split)));}catch{return null;}
  },[splits]);

  useEffect(()=>{
    if(!transaction){setAttachments([]);return;}
    let cancelled=false;
    setAttachmentsLoading(true);
    void repository.listTransactionAttachments(transaction.id)
      .then((rows)=>{if(!cancelled)setAttachments(rows);})
      .catch((reason)=>{if(!cancelled)setError(reason instanceof Error?reason.message:String(reason));})
      .finally(()=>{if(!cancelled)setAttachmentsLoading(false);});
    return()=>{cancelled=true;};
  },[transaction]);

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
        status:String(data.get("status")) as TransactionStatus,
        memo:String(data.get("memo")||"").trim()||undefined,
        flagged:data.get("flagged")==="on",
        splits:preparedSplits
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

  async function attachFile(){
    if(!transaction)return;
    setAttachmentBusy(true);setError("");
    try{
      const picked=await repository.pickAndReadAttachmentFile();
      if(!picked)return;
      const attached=await repository.attachBytesToTransaction({
        transactionId:transaction.id,
        originalFilename:picked.originalFilename,
        mediaType:picked.mediaType,
        contentBase64:picked.contentBase64,
        sourceKind:"manual",
      });
      setAttachments(await repository.listTransactionAttachments(transaction.id).catch(()=>[...attachments.filter((item)=>item.id!==attached.id),attached]));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setAttachmentBusy(false);}
  }

  async function openAttached(attachment:TransactionAttachment){
    setAttachmentBusy(true);setError("");
    try{await repository.openAttachment(attachment.id);}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setAttachmentBusy(false);}
  }

  async function removeAttached(attachment:TransactionAttachment){
    if(!transaction)return;
    if(!window.confirm(`Remove “${attachment.originalFilename}” from this transaction?`))return;
    setAttachmentBusy(true);setError("");
    try{
      await repository.detachTransactionAttachment(transaction.id,attachment.id);
      setAttachments((current)=>current.filter((item)=>item.id!==attachment.id));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setAttachmentBusy(false);}
  }

  const imported=Boolean(transaction?.importBatchId);
  const defaultDirection=seed&&seed.amountMinor>=0?"income":"expense";
  const defaultAmount=seed?(Math.abs(seed.amountMinor)/100).toFixed(2):"";
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)onClose();}}><section className="dialog transaction-dialog" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="dialog-header"><h2 id="transaction-title">{transaction?"Edit transaction":draft?"Duplicate transaction":"New transaction"}</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div><form onSubmit={submit} className="entry-form transaction-form">
    <label>Account<select name={imported?undefined:"accountId"} defaultValue={seed?.accountId??defaultAccountId??accounts[0]?.id} disabled={imported}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>{imported&&<input type="hidden" name="accountId" value={transaction?.accountId}/>}</label>
    <div className="form-row"><label>Date<input name="date" type="date" defaultValue={seed?.postedDate??new Date().toISOString().slice(0,10)} required/></label>{!splitMode&&<label>Type<select name="direction" defaultValue={defaultDirection}><option value="expense">Expense</option><option value="income">Income</option></select></label>}</div>
    <label>Payee<input name="payee" list={suggestions.payeeListId} defaultValue={seed?.payee} required maxLength={160} autoFocus/></label>
    {!splitMode?<div className="form-row"><label>Category<input name="category" list={suggestions.categoryListId} defaultValue={seed?.category??"Uncategorized"} required maxLength={120}/></label><label>Amount<input name="amount" inputMode="decimal" defaultValue={defaultAmount} placeholder="0.00" required/></label></div>:<section className="split-editor"><div className="split-heading"><div><strong>Transaction splits</strong><small>Each line has its own income/expense direction.</small></div><button type="button" onClick={()=>setSplits(current=>[...current,blankSplit()])}><Plus size={13}/> Add line</button></div>{splits.map((split,index)=><div className="split-row" key={split.key}><label>Category<input list={suggestions.categoryListId} value={split.category} onChange={event=>updateSplit(split.key,{category:event.target.value})} maxLength={120} placeholder={`Split ${index+1}`}/></label><label>Type<select value={split.direction} onChange={event=>updateSplit(split.key,{direction:event.target.value as SplitDraft["direction"]})}><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Amount<input value={split.amount} onChange={event=>updateSplit(split.key,{amount:event.target.value})} inputMode="decimal" placeholder="0.00"/></label><label>Memo<input value={split.memo} onChange={event=>updateSplit(split.key,{memo:event.target.value})} maxLength={500}/></label><button type="button" className="split-remove" onClick={()=>setSplits(current=>current.filter(item=>item.key!==split.key))} aria-label={`Remove split ${index+1}`}><Trash2 size={14}/></button></div>)}<div className="split-total"><span>Calculated transaction total</span><strong className={(splitTotal??0)<0?"negative":""}>{splitTotal===null?"Check split amounts":formatMoney(splitTotal)}</strong></div></section>}
    <button type="button" className="split-toggle" onClick={enableSplits}>{splitMode?"Use one category":"Split among categories"}</button>
    <label>Status<select name="status" defaultValue={seed?.status??"cleared"}><option value="pending">Pending</option><option value="cleared">Cleared</option>{transaction?.status==="reconciled"&&<option value="reconciled" disabled>Reconciled by statement</option>}<option value="review">Needs review</option></select></label>
    <label>Note<textarea name="memo" defaultValue={seed?.memo} maxLength={TRANSACTION_NOTE_MAX_LENGTH} placeholder="Optional context for this transaction" aria-label="Transaction note"/></label>
    <label className="flag-toggle"><input type="checkbox" name="flagged" defaultChecked={Boolean(seed?.flagged)}/> Flag for follow-up</label>
    {transaction&&<section className="attachment-editor" aria-label="Attachments">
      <div className="attachment-heading"><div><strong>Attachments</strong><small>Receipts and retained import documents. Does not change balances.</small></div>
        <button type="button" disabled={attachmentBusy||saving} onClick={()=>void attachFile()}><Paperclip size={13}/> Attach receipt/document…</button>
      </div>
      {attachmentsLoading?<p className="attachment-empty">Loading attachments…</p>:attachments.length===0?<p className="attachment-empty">No attachments yet.</p>:
        <ul className="attachment-list">{attachments.map((item)=><li key={item.id}><div className="attachment-meta"><strong title={item.originalFilename}>{item.originalFilename}</strong><small>{formatByteSize(item.byteSize)}</small></div><div className="attachment-actions"><button type="button" disabled={attachmentBusy||saving} onClick={()=>void openAttached(item)}>Open</button><button type="button" className="attachment-remove" disabled={attachmentBusy||saving} onClick={()=>void removeAttached(item)}>Remove</button></div></li>)}</ul>}
    </section>}
    {imported&&<p className="imported-note">This transaction came from an import batch. You can edit it, but deletion stays with the complete-batch Undo command.</p>}
    {error&&<p className="form-error">{error}</p>}
    <div className="transaction-actions">{transaction&&!imported?<button type="button" className={confirmDelete?"danger-action":"delete-link"} disabled={saving} onClick={remove}>{confirmDelete?"Confirm permanent deletion":"Delete transaction"}</button>:<span/>}<div className="form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving||Boolean(splitMode&&splitTotal===null)}>{saving?"Saving…":"Save"}</button></div></div>
    {confirmDelete&&<p className="delete-warning">Deleting this manual transaction changes its account balance and cannot be undone.</p>}
    <SuggestionLists {...suggestions}/>
  </form></section></div>;
}

function blankSplit():SplitDraft{return{key:crypto.randomUUID(),category:"",direction:"expense",amount:"",memo:""};}
function toDraft(split:TransactionSplit|CreateTransactionSplit):SplitDraft{return{key:"id" in split?split.id:crypto.randomUUID(),category:split.category,direction:split.amountMinor>=0?"income":"expense",amount:(Math.abs(split.amountMinor)/100).toFixed(2),memo:split.memo??""};}
function signedAmount(split:SplitDraft):number{const amount=parseMoney(split.amount);return split.direction==="expense"?-Math.abs(amount):Math.abs(amount);}
function formatByteSize(bytes:number):string{
  if(bytes<1024)return`${bytes} B`;
  if(bytes<1024*1024)return`${(bytes/1024).toFixed(bytes%1024===0?0:1)} KB`;
  return`${(bytes/(1024*1024)).toFixed(1)} MB`;
}
