import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { formatMoney, parseMoney, type Account, type Transaction, type TransactionStatus } from "./domain";
import { financeRepository as repository } from "./repository";
import "./transferEditor.css";

export function TransferDialog({accounts,transaction,defaultFromAccountId,onClose,onSaved}:{accounts:Account[];transaction?:Transaction;defaultFromAccountId?:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const initialFrom=transaction?(transaction.amountMinor<0?transaction.accountId:transaction.transferAccountId):defaultFromAccountId??accounts[0]?.id;
  const initialTo=transaction?(transaction.amountMinor<0?transaction.transferAccountId:transaction.accountId):accounts.find(account=>account.id!==initialFrom&&account.currency===accounts.find(item=>item.id===initialFrom)?.currency)?.id;
  const [fromAccountId,setFromAccountId]=useState(initialFrom??"");
  const [toAccountId,setToAccountId]=useState(initialTo??"");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const fromAccount=accounts.find(account=>account.id===fromAccountId);
  const destinations=useMemo(()=>accounts.filter(account=>account.id!==fromAccountId&&(!fromAccount||account.currency===fromAccount.currency)),[accounts,fromAccount,fromAccountId]);

  function changeFrom(nextId:string){
    setFromAccountId(nextId);
    const next=accounts.find(account=>account.id===nextId);
    const currentTo=accounts.find(account=>account.id===toAccountId);
    if(!currentTo||currentTo.id===nextId||currentTo.currency!==next?.currency){
      setToAccountId(accounts.find(account=>account.id!==nextId&&account.currency===next?.currency)?.id??"");
    }
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError("");
    const data=new FormData(event.currentTarget);
    try{
      const amountMinor=Math.abs(parseMoney(String(data.get("amount"))));
      if(!amountMinor)throw new Error("Transfer amount must be greater than zero");
      const input={
        fromAccountId,toAccountId,postedDate:String(data.get("date")),payee:String(data.get("payee")||"").trim(),amountMinor,
        status:String(data.get("status")) as TransactionStatus,memo:String(data.get("memo")||"").trim()||undefined
      };
      if(transaction?.transferLinkId)await repository.updateTransfer(transaction.transferLinkId,input);else await repository.createTransfer(input);
      await onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setSaving(false);}
  }

  async function remove(){
    if(!transaction?.transferLinkId)return;
    if(!confirmDelete){setConfirmDelete(true);return;}
    setSaving(true);setError("");
    try{await repository.deleteTransfer(transaction.transferLinkId);await onSaved();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));setSaving(false);setConfirmDelete(false);}
  }

  const canTransfer=accounts.length>1&&destinations.length>0;
  const currency=fromAccount?.currency??"USD";
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)onClose();}}><section className="dialog transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title"><div className="dialog-header"><h2 id="transfer-title">{transaction?"Edit linked transfer":"New linked transfer"}</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div><form onSubmit={submit} className="entry-form transfer-form">
    <div className="transfer-explainer"><ArrowLeftRight size={18}/><span>HomeLedger writes one withdrawal and one matching deposit, then keeps them synchronized.</span></div>
    <div className="transfer-route"><label>From account<select value={fromAccountId} onChange={event=>changeFrom(event.target.value)} required>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><ArrowLeftRight aria-hidden="true"/><label>To account<select value={toAccountId} onChange={event=>setToAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{destinations.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
    {!canTransfer&&<p className="form-error">Add another active account in {currency} before creating this transfer. Cross-currency transfers are not supported yet.</p>}
    <div className="form-row"><label>Date<input name="date" type="date" defaultValue={transaction?.postedDate??new Date().toISOString().slice(0,10)} required/></label><label>Amount ({currency})<input name="amount" inputMode="decimal" defaultValue={transaction?(Math.abs(transaction.amountMinor)/100).toFixed(2):""} placeholder="0.00" required/></label></div>
    <label>Description / payee<input name="payee" defaultValue={transaction?.payee??"Account transfer"} required maxLength={160} autoFocus/></label>
    <label>Status<select name="status" defaultValue={transaction?.status??"cleared"}><option value="pending">Pending</option><option value="cleared">Cleared</option>{transaction?.status==="reconciled"&&<option value="reconciled" disabled>Reconciled by statement</option>}<option value="review">Needs review</option></select></label>
    <label>Memo<textarea name="memo" defaultValue={transaction?.memo} maxLength={500}/></label>
    {transaction&&<p className="transfer-balance-note">Both sides will be updated together. Current transfer amount: <strong>{formatMoney(Math.abs(transaction.amountMinor),currency)}</strong>.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="transaction-actions">{transaction?<button type="button" className={confirmDelete?"danger-action":"delete-link"} disabled={saving} onClick={remove}>{confirmDelete?"Confirm deletion of both sides":"Delete linked transfer"}</button>:<span/>}<div className="form-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving||!canTransfer}>{saving?"Saving…":transaction?"Save both sides":"Create transfer"}</button></div></div>
    {confirmDelete&&<p className="delete-warning">This permanently removes both linked transactions and updates both account balances.</p>}
  </form></section></div>;
}
