import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, History, RotateCcw, Save, Trash2, Undo2, Upload, X } from "lucide-react";
import { buildPreview, headerSignature, parseDelimited, suggestMapping, type ColumnMapping, type ParsedTable } from "./csvImport";
import { buildOfxPreview, parseOfx, type OfxStatement } from "./ofxImport";
import { buildQifPreview, parseQif, type QifStatement } from "./qifImport";
import { financeRepository } from "./repository";
import { formatMoney, type Account, type ImportBatch, type ImportProfile, type Transaction } from "./domain";
import { applyMerchantRules } from "./merchantRules";
import type { MerchantRule } from "./domain";
import "./importHistory.css";
import "./ofxImport.css";

export function ImportPage({accounts,transactions,onImported}:{accounts:Account[];transactions:Transaction[];onImported:()=>Promise<void>}) {
  const [table,setTable]=useState<ParsedTable|null>(null);
  const [ofx,setOfx]=useState<OfxStatement|null>(null);
  const [qif,setQif]=useState<QifStatement|null>(null);
  const [fileName,setFileName]=useState("");
  const [accountId,setAccountId]=useState(accounts[0]?.id??"");
  const [mapping,setMapping]=useState<ColumnMapping>({date:-1,payee:-1,amount:-1,debit:-1,credit:-1});
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);
  const [batches,setBatches]=useState<ImportBatch[]>([]);
  const [pendingUndo,setPendingUndo]=useState<ImportBatch|null>(null);
  const [undoing,setUndoing]=useState(false);
  const [rules,setRules]=useState<MerchantRule[]>([]);
  const [profiles,setProfiles]=useState<ImportProfile[]>([]);
  const [selectedProfileId,setSelectedProfileId]=useState("");
  const [profileName,setProfileName]=useState("");
  const [includedDuplicates,setIncludedDuplicates]=useState<Set<number>>(new Set());
  const showError=(reason:unknown)=>setError(reason instanceof Error?reason.message:String(reason));

  useEffect(()=>{if(!accountId&&accounts[0])setAccountId(accounts[0].id);},[accountId,accounts]);
  useEffect(()=>{void loadHistory();void financeRepository.listMerchantRules().then(setRules).catch(showError);void financeRepository.listImportProfiles().then(setProfiles).catch(showError);},[]);

  const accountTransactions=useMemo(()=>transactions.filter(item=>item.accountId===accountId),[transactions,accountId]);
  const rawPreview=useMemo(()=>qif?buildQifPreview(qif,accountTransactions):ofx?buildOfxPreview(ofx,accountTransactions):table?buildPreview(table,mapping,accountTransactions):[],[qif,ofx,table,mapping,accountTransactions]);
  const applications=useMemo(()=>applyMerchantRules(rawPreview,rules),[rawPreview,rules]);
  const preview=useMemo(()=>applications.map(item=>item.row),[applications]);
  const matchedRules=useMemo(()=>new Map(applications.filter(item=>item.rule).map(item=>[item.row.sourceRow,item.rule!])),[applications]);
  const valid=preview.filter(row=>!row.error&&(!row.duplicate||(row.duplicate.confidence!=="exact"&&includedDuplicates.has(row.sourceRow))));
  const duplicates=preview.filter(row=>row.duplicate).length;
  const duplicateCounts=useMemo(()=>({exact:preview.filter(row=>row.duplicate?.confidence==="exact").length,probable:preview.filter(row=>row.duplicate?.confidence==="probable").length,possible:preview.filter(row=>row.duplicate?.confidence==="possible").length}),[preview]);
  const errors=preview.filter(row=>row.error).length;
  const selectedAccount=accounts.find(account=>account.id===accountId);
  const currencyMismatch=Boolean(ofx&&selectedAccount&&ofx.currency!==selectedAccount.currency);

  async function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]; if(!file)return;
    setError("");setMessage("");
    if(file.size>10*1024*1024){setError("Statement files are limited to 10 MB in this milestone.");return;}
    try{const text=await file.text();setIncludedDuplicates(new Set());if(/<OFX[>\s]/i.test(text)||/\.(ofx|qfx)$/i.test(file.name)){const parsed=parseOfx(text);setOfx(parsed);setQif(null);setTable(null);setSelectedProfileId("");}else if(/^!Type:/im.test(text)||/\.qif$/i.test(file.name)){const parsed=parseQif(text);setQif(parsed);setOfx(null);setTable(null);setSelectedProfileId("");}else{const parsed=parseDelimited(text);setTable(parsed);setOfx(null);setQif(null);const profile=profiles.find(item=>item.headerSignature===headerSignature(parsed.headers));if(profile){applyProfile(profile);setProfileName(profile.name);}else{setMapping(suggestMapping(parsed.headers));setSelectedProfileId("");setProfileName("");}}setFileName(file.name);}
    catch(reason){setTable(null);setOfx(null);setQif(null);setError(reason instanceof Error?reason.message:String(reason));}
    finally{event.target.value="";}
  }

  function applyProfile(profile:ImportProfile){setMapping({date:profile.dateColumn,payee:profile.payeeColumn,amount:profile.amountColumn,debit:profile.debitColumn,credit:profile.creditColumn});setIncludedDuplicates(new Set());if(profile.accountId&&accounts.some(account=>account.id===profile.accountId))setAccountId(profile.accountId);setSelectedProfileId(profile.id);}
  async function saveProfile(){if(!table)return;setError("");try{const saved=await financeRepository.saveImportProfile({name:profileName.trim(),accountId,headerSignature:headerSignature(table.headers),dateColumn:mapping.date,payeeColumn:mapping.payee,amountColumn:mapping.amount,debitColumn:mapping.debit,creditColumn:mapping.credit});const next=await financeRepository.listImportProfiles();setProfiles(next);setSelectedProfileId(saved.id);setMessage(`Saved import profile “${saved.name}”.`);}catch(reason){showError(reason);}}
  async function deleteProfile(){if(!selectedProfileId)return;setError("");try{await financeRepository.deleteImportProfile(selectedProfileId);setProfiles(await financeRepository.listImportProfiles());setSelectedProfileId("");setProfileName("");setMessage("Deleted the saved import profile.");}catch(reason){showError(reason);}}
  function chooseProfile(id:string){setSelectedProfileId(id);const profile=profiles.find(item=>item.id===id);if(profile){applyProfile(profile);setProfileName(profile.name);}else{setMapping(table?suggestMapping(table.headers):mapping);setProfileName("");}}
  function toggleDuplicate(sourceRow:number){setIncludedDuplicates(current=>{const next=new Set(current);if(next.has(sourceRow))next.delete(sourceRow);else next.add(sourceRow);return next;});}

  async function commit(){
    if(!accountId){setError("Choose an account before importing.");return;}
    if(errors){setError("Correct the mapping or source rows before importing.");return;}
    if(currencyMismatch){setError(`The statement uses ${ofx?.currency}, but the selected account uses ${selectedAccount?.currency}.`);return;}
    if(!valid.length){setError("There are no new valid transactions to import.");return;}
    setSaving(true);setError("");
    try{const result=await financeRepository.importTransactions({accountId,sourceName:fileName,rows:valid.map(({postedDate,payee,originalPayee,amountMinor,memo,externalId,category,splits})=>({postedDate,payee,originalPayee,amountMinor,memo,externalId,category,splits}))});setMessage(`Imported ${result.importedCount} transactions as one atomic batch.`);setTable(null);setOfx(null);setQif(null);setFileName("");await onImported();await loadHistory();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setSaving(false);}
  }

  function reset(){setTable(null);setOfx(null);setQif(null);setFileName("");setError("");setMessage("");setSelectedProfileId("");setProfileName("");setIncludedDuplicates(new Set());}
  async function loadHistory(){try{setBatches(await financeRepository.listImportBatches());}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
  async function undo(){if(!pendingUndo)return;setUndoing(true);setError("");try{const result=await financeRepository.undoImportBatch(pendingUndo.id);setMessage(`Removed ${result.removedCount} transactions from ${pendingUndo.sourceName}.`);setPendingUndo(null);await onImported();await loadHistory();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setUndoing(false);}}
  if(!accounts.length)return <section className="panel import-empty"><FileSpreadsheet/><h2>Create an account first</h2><p>Statement transactions must be assigned to a local account.</p></section>;

  return <div className="import-page">
    <section className="panel import-controls">
      <div className="panel-heading"><div><h2>Import a statement</h2><p>CSV, TSV, OFX, QFX, and QIF parsing happens locally; the original file is not retained.</p></div>{(table||ofx||qif)&&<button onClick={reset}><RotateCcw size={14}/> Start over</button>}</div>
      <div className="import-body">
        <label className="file-picker"><Upload size={20}/><span><strong>{fileName||"Choose a statement file"}</strong><small>CSV, TSV, OFX, QFX, or QIF, up to 10 MB</small></span><input type="file" accept=".csv,.tsv,.txt,.ofx,.qfx,.qif,text/csv,text/tab-separated-values,application/x-ofx,application/qif" onChange={chooseFile}/></label>
        {error&&<div className="error-banner" role="alert">{error}</div>}{message&&<div className="success-banner" role="status">{message}</div>}
        {table&&<>
          <div className="profile-controls">
            <label>Saved mapping<select value={selectedProfileId} onChange={event=>chooseProfile(event.target.value)}><option value="">Suggested mapping</option>{profiles.filter(profile=>profile.headerSignature===headerSignature(table.headers)).map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <label>Profile name<input value={profileName} onChange={event=>setProfileName(event.target.value)} maxLength={80} placeholder="Example Credit Union"/></label>
            <button onClick={saveProfile} disabled={!profileName.trim()}><Save size={14}/> Save mapping</button>
            <button onClick={deleteProfile} disabled={!selectedProfileId} aria-label="Delete selected mapping"><Trash2 size={14}/></button>
          </div>
          <div className="mapping-grid">
            <label>Import to account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <MappingSelect label="Date" value={mapping.date} headers={table.headers} onChange={date=>{setMapping({...mapping,date});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Description / payee" value={mapping.payee} headers={table.headers} onChange={payee=>{setMapping({...mapping,payee});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Signed amount" value={mapping.amount} headers={table.headers} onChange={amount=>{setMapping({...mapping,amount});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Debit (optional)" value={mapping.debit} headers={table.headers} onChange={debit=>{setMapping({...mapping,debit});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Credit (optional)" value={mapping.credit} headers={table.headers} onChange={credit=>{setMapping({...mapping,credit});setIncludedDuplicates(new Set());}}/>
          </div>
          <p className="mapping-help">Use either one signed amount column, or separate debit and credit columns. A mapped signed amount takes precedence.</p>
        </>}
        {ofx&&<><div className="ofx-summary"><div><span>Statement type</span><strong>{ofx.accountType==="credit-card"?"Credit card":"Bank account"}</strong></div><div><span>Statement account</span><strong>{ofx.accountIdMasked}</strong></div><div><span>Currency</span><strong>{ofx.currency}</strong></div><div><span>Date range</span><strong>{ofx.dateStart&&ofx.dateEnd?`${ofx.dateStart} – ${ofx.dateEnd}`:"Not supplied"}</strong></div><div><span>Ledger balance</span><strong>{ofx.ledgerBalanceMinor===undefined?"Not supplied":formatMoney(ofx.ledgerBalanceMinor,ofx.currency)}</strong></div></div><label className="ofx-account">Import to account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}</select></label>{currencyMismatch&&<div className="error-banner">Currency mismatch: statement is {ofx.currency}; selected account is {selectedAccount?.currency}.</div>}</>}
        {qif&&<><div className="ofx-summary"><div><span>Statement type</span><strong>{qif.accountType==="credit-card"?"Credit card":qif.accountType==="cash"?"Cash":"Bank account"}</strong></div><div><span>Statement account</span><strong>{qif.accountName||"Not supplied"}</strong></div><div><span>Transactions</span><strong>{qif.rows.length}</strong></div><div><span>Split transactions</span><strong>{qif.rows.filter(row=>row.splits?.length).length}</strong></div></div><label className="ofx-account">Import to account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}</select></label><p className="mapping-help">QIF does not specify currency. Amounts will use the selected account’s {selectedAccount?.currency} currency.</p></>}
      </div>
    </section>
    {(table||ofx||qif)&&<section className="panel import-preview"><div className="panel-heading"><div><h2>Pre-import review</h2><p>{valid.length} ready · {duplicates} matches ({duplicateCounts.exact} exact, {duplicateCounts.probable} probable, {duplicateCounts.possible} possible) · {errors} errors</p></div><button className="primary-action" disabled={saving||errors>0||valid.length===0||currencyMismatch} onClick={commit}>{saving?"Importing…":`Import ${valid.length}`}</button></div><div className="table-wrap"><table><thead><tr><th>Source row</th><th>Date</th><th>Description</th><th>Category / result</th><th>Amount</th><th>Decision</th></tr></thead><tbody>{preview.slice(0,100).map(row=>{const rule=matchedRules.get(row.sourceRow),included=includedDuplicates.has(row.sourceRow);return <tr key={row.sourceRow} className={row.error?"row-error":row.duplicate?`row-duplicate duplicate-${row.duplicate.confidence}`:""}><td>{row.sourceRow}</td><td>{row.postedDate||"—"}</td><td>{row.payee||"—"}{row.originalPayee&&row.originalPayee!==row.payee?<small className="split-count">From: {row.originalPayee}</small>:null}{row.splits?.length?<small className="split-count">{row.splits.length} splits</small>:null}</td><td>{row.error?<span className="import-status error">{row.error}</span>:row.duplicate?<><span className={`import-status duplicate ${row.duplicate.confidence}`}>{row.duplicate.confidence} match</span><small className="duplicate-reason">{row.duplicate.reason}</small></>:<><span className="import-status ready">{row.category??"Uncategorized"}</span>{rule&&<small className="rule-match">Rule: {rule.name}</small>}</>}</td><td className={row.amountMinor<0?"amount negative":"amount positive"}>{row.error?"—":formatMoney(row.amountMinor,ofx?.currency??selectedAccount?.currency)}</td><td>{row.duplicate?(row.duplicate.confidence==="exact"?<span className="exact-skip">Excluded</span>:<button className={included?"include-duplicate active":"include-duplicate"} onClick={()=>toggleDuplicate(row.sourceRow)}>{included?"Import anyway":"Skip"}</button>):"Import"}</td></tr>;})}</tbody></table></div>{preview.length>100&&<p className="preview-limit">Showing the first 100 of {preview.length} rows.</p>}</section>}
    <section className="panel import-history"><div className="panel-heading"><div><h2>Import history</h2><p>Every committed batch remains in the audit history.</p></div><History size={18}/></div>{batches.length===0?<div className="empty-state">No statements have been imported yet.</div>:<div className="table-wrap"><table><thead><tr><th>Imported</th><th>Source</th><th>Account</th><th>Transactions</th><th>Net amount</th><th>Status</th><th></th></tr></thead><tbody>{batches.map(batch=><tr key={batch.id}><td>{formatTimestamp(batch.importedAt)}</td><td><strong>{batch.sourceName}</strong></td><td>{batch.accountName}</td><td>{batch.transactionCount}</td><td className={batch.totalMinor<0?"amount negative":"amount positive"}>{formatMoney(batch.totalMinor)}</td><td>{batch.undoneAt?<span className="import-status duplicate">Undone</span>:<span className="import-status ready">Active</span>}</td><td>{!batch.undoneAt&&<button className="undo-button" onClick={()=>setPendingUndo(batch)}><Undo2 size={13}/> Undo</button>}</td></tr>)}</tbody></table></div>}</section>
    {pendingUndo&&<UndoDialog batch={pendingUndo} busy={undoing} onCancel={()=>setPendingUndo(null)} onConfirm={undo}/>}
  </div>;
}

function MappingSelect({label,value,headers,onChange}:{label:string;value:number;headers:string[];onChange:(value:number)=>void}){return <label>{label}<select value={value} onChange={event=>onChange(Number(event.target.value))}><option value={-1}>Not mapped</option>{headers.map((header,index)=><option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>;}
function formatTimestamp(value:string){const normalized=value.includes("T")?value:`${value.replace(" ","T")}Z`;const date=new Date(normalized);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short"}).format(date);}
function UndoDialog({batch,busy,onCancel,onConfirm}:{batch:ImportBatch;busy:boolean;onCancel:()=>void;onConfirm:()=>void}){return <div className="dialog-backdrop"><section className="dialog undo-dialog" role="alertdialog" aria-modal="true" aria-labelledby="undo-title" aria-describedby="undo-description"><div className="dialog-header"><h2 id="undo-title">Undo this complete import?</h2><button onClick={onCancel} disabled={busy} aria-label="Close"><X size={18}/></button></div><div className="undo-body"><p id="undo-description">This removes all <strong>{batch.transactionCount}</strong> transactions imported from <strong>{batch.sourceName}</strong>. The audit-history record remains, marked as undone.</p><p>This cannot be redone because HomeLedger does not retain the original statement file.</p><div className="form-actions"><button onClick={onCancel} disabled={busy}>Cancel</button><button className="danger-action" onClick={onConfirm} disabled={busy}>{busy?"Undoing…":"Undo complete batch"}</button></div></div></section></div>;}
