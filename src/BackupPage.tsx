import { useState } from "react";
import { DatabaseBackup, FolderOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { decryptBackup, encryptBackup, parseBackupEnvelope, validateNewPassword, type EncryptedBackupEnvelope } from "./backupCrypto";
import { backupRepository, isNativeApp } from "./repository";
import "./backupPage.css";

export function BackupPage({onRestored}:{onRestored:()=>Promise<void>}) {
  const [backupPassword,setBackupPassword]=useState("");
  const [backupConfirm,setBackupConfirm]=useState("");
  const [restorePassword,setRestorePassword]=useState("");
  const [restoreContents,setRestoreContents]=useState<string|null>(null);
  const [restoreMetadata,setRestoreMetadata]=useState<EncryptedBackupEnvelope|null>(null);
  const [replaceConfirmed,setReplaceConfirmed]=useState(false);
  const [busy,setBusy]=useState<"backup"|"restore"|"choose"|null>(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function createBackup(){
    setError("");setMessage("");
    try{
      validateNewPassword(backupPassword);
      if(backupPassword!==backupConfirm)throw new Error("The backup passwords do not match");
      setBusy("backup");
      const snapshot=await backupRepository.exportSnapshot();
      const encrypted=await encryptBackup(snapshot,backupPassword);
      const saved=await backupRepository.saveEncryptedFile(encrypted);
      if(saved){setMessage("Encrypted backup saved successfully. Keep its password somewhere separate and secure.");setBackupPassword("");setBackupConfirm("");}
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(null);}
  }

  async function chooseBackup(){
    setError("");setMessage("");setBusy("choose");
    try{
      const contents=await backupRepository.chooseEncryptedFile();
      if(!contents)return;
      const metadata=parseBackupEnvelope(contents);
      setRestoreContents(contents);setRestoreMetadata(metadata);setRestorePassword("");setReplaceConfirmed(false);
    }catch(reason){setRestoreContents(null);setRestoreMetadata(null);setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(null);}
  }

  async function restoreBackup(){
    if(!restoreContents||!restoreMetadata){setError("Choose an encrypted HomeLedger backup first");return;}
    if(!replaceConfirmed){setError("Confirm that you understand the current ledger will be replaced");return;}
    setBusy("restore");setError("");setMessage("");
    try{
      const snapshot=await decryptBackup(restoreContents,restorePassword);
      const result=await backupRepository.restoreSnapshot(snapshot);
      await onRestored();
      setMessage(`Restore complete: ${result.accountCount} accounts and ${result.transactionCount} transactions loaded.`);
      setRestoreContents(null);setRestoreMetadata(null);setRestorePassword("");setReplaceConfirmed(false);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(null);}
  }

  if(!isNativeApp)return <section className="panel backup-unavailable"><DatabaseBackup/><h2>Desktop backup and restore</h2><p>Open HomeLedger through Tauri to create or restore encrypted local backups. Browser preview data is synthetic and is not saved.</p></section>;

  return <div className="backup-page">
    <section className="panel backup-intro"><div><ShieldCheck size={22}/><div><h2>Encrypted local backups</h2><p>Backups are encrypted before they are written. HomeLedger never stores or transmits the password.</p></div></div><span>AES-256-GCM · PBKDF2-SHA-256</span></section>
    {error&&<div className="error-banner" role="alert">{error}</div>}{message&&<div className="success-banner" role="status">{message}</div>}
    <div className="backup-grid">
      <section className="panel backup-card"><DatabaseBackup size={25}/><div><h2>Create backup</h2><p>Save a consistent snapshot containing accounts, transactions, categories, splits, transfers, and import history.</p></div><label>Backup password<input type="password" autoComplete="new-password" value={backupPassword} onChange={e=>setBackupPassword(e.target.value)} minLength={12} maxLength={1024}/><small>At least 12 characters. There is no password recovery.</small></label><label>Confirm password<input type="password" autoComplete="new-password" value={backupConfirm} onChange={e=>setBackupConfirm(e.target.value)} minLength={12} maxLength={1024}/></label><button className="primary-action" disabled={busy!==null} onClick={createBackup}>{busy==="backup"?"Encrypting…":"Create encrypted backup"}</button></section>
      <section className="panel backup-card restore-card"><FolderOpen size={25}/><div><h2>Restore backup</h2><p>HomeLedger validates the password, encryption tag, SQLite integrity, schema, tables, and record relationships before replacement.</p></div><button disabled={busy!==null} onClick={chooseBackup}>{busy==="choose"?"Opening…":"Choose .hlb backup"}</button>{restoreMetadata&&<div className="backup-file"><strong>Backup ready</strong><span>Created {formatTimestamp(restoreMetadata.createdAt)}</span><span>HomeLedger {restoreMetadata.appVersion}</span></div>}<label>Backup password<input type="password" autoComplete="current-password" value={restorePassword} onChange={e=>setRestorePassword(e.target.value)} disabled={!restoreContents} maxLength={1024}/></label><label className="restore-confirm"><input type="checkbox" checked={replaceConfirmed} onChange={e=>setReplaceConfirmed(e.target.checked)} disabled={!restoreContents}/><span><strong>Replace the current ledger</strong><small>This cannot be undone unless you first create a separate backup of the current data.</small></span></label><button className="danger-action" disabled={busy!==null||!restoreContents||!restorePassword||!replaceConfirmed} onClick={restoreBackup}>{busy==="restore"?"Validating and restoring…":"Restore and replace ledger"}</button></section>
    </div>
    <section className="backup-warning"><TriangleAlert size={18}/><p><strong>Do not lose the password.</strong> HomeLedger cannot decrypt a backup without it. Test important backups on another installation before relying on them as your only copy.</p></section>
  </div>;
}

function formatTimestamp(value:string){return new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
