import { useEffect, useState } from "react";
import { DatabaseBackup, FolderOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { decryptBackup, encryptBackup, parseBackupEnvelope, validateNewPassword, type EncryptedBackupEnvelope } from "./backupCrypto";
import { backupRepository, isNativeApp } from "./repository";
import type { BackupHealth } from "./domain";
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
  const [health,setHealth]=useState<BackupHealth|null>(null);
  const [recoveryConfirmed,setRecoveryConfirmed]=useState<string|null>(null);

  useEffect(()=>{if(isNativeApp)backupRepository.getHealth().then(setHealth).catch(()=>undefined);},[]);

  async function createRecovery(){
    setError("");setMessage("");setBusy("backup");
    try{setHealth(await backupRepository.createRecoverySnapshot());setMessage("Local recovery snapshot created.");}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(null);}
  }

  async function changeRetention(value:number){
    try{setHealth(await backupRepository.setRetention(value));}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }

  async function restoreRecovery(fileName:string){
    if(recoveryConfirmed!==fileName){setRecoveryConfirmed(fileName);return;}
    setBusy("restore");setError("");setMessage("");
    try{
      const result=await backupRepository.restoreRecoverySnapshot(fileName);
      await onRestored();setHealth(await backupRepository.getHealth());
      setMessage(`Recovery complete: ${result.accountCount} accounts and ${result.transactionCount} transactions loaded.`);
      setRecoveryConfirmed(null);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(null);}
  }

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
    <section className="panel backup-card recovery-health">
      <DatabaseBackup size={25}/><div><h2>Automatic recovery</h2><p>HomeLedger keeps rotating local SQLite recovery snapshots in its private application-data folder and creates one before upgrading an older database schema.</p></div>
      {health?<><div className="backup-file"><strong>{health.lastSuccessfulAt?"Protected":"No recovery snapshot yet"}</strong>{health.lastSuccessfulAt&&<span>Last successful {formatTimestamp(health.lastSuccessfulAt)} · {health.lastReason==="pre-migration"?"before migration":"automatic"}</span>}<span>{health.snapshots.length} recovery snapshot{health.snapshots.length===1?"":"s"} retained</span></div>
      <label>Snapshots to keep<select value={health.retention} onChange={e=>changeRetention(Number(e.target.value))}>{[3,5,7,10,14,21,30].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <button disabled={busy!==null} onClick={createRecovery}>Create recovery point now</button>
      {health.snapshots.length>0&&<div className="recovery-list">{health.snapshots.map(snapshot=><div className="backup-file" key={snapshot.fileName}><strong>{snapshot.reason==="pre-migration"?"Pre-migration recovery":"Automatic recovery"}</strong><span>{formatTimestamp(snapshot.createdAt)} · schema {snapshot.schemaVersion} · {formatBytes(snapshot.sizeBytes)}</span><button className={recoveryConfirmed===snapshot.fileName?"danger-action":""} disabled={busy!==null} onClick={()=>restoreRecovery(snapshot.fileName)}>{recoveryConfirmed===snapshot.fileName?"Confirm replace current ledger":"Restore this recovery"}</button></div>)}</div>}</>:<p>Loading recovery status…</p>}
    </section>
    <div className="backup-grid">
      <section className="panel backup-card"><DatabaseBackup size={25}/><div><h2>Create backup</h2><p>Save a consistent snapshot containing accounts, transactions, categories, splits, transfers, and import history.</p></div><label>Backup password<input type="password" autoComplete="new-password" value={backupPassword} onChange={e=>setBackupPassword(e.target.value)} minLength={12} maxLength={1024}/><small>At least 12 characters. There is no password recovery.</small></label><label>Confirm password<input type="password" autoComplete="new-password" value={backupConfirm} onChange={e=>setBackupConfirm(e.target.value)} minLength={12} maxLength={1024}/></label><button className="primary-action" disabled={busy!==null} onClick={createBackup}>{busy==="backup"?"Encrypting…":"Create encrypted backup"}</button></section>
      <section className="panel backup-card restore-card"><FolderOpen size={25}/><div><h2>Restore backup</h2><p>HomeLedger validates the password, encryption tag, SQLite integrity, schema, tables, and record relationships before replacement.</p></div><button disabled={busy!==null} onClick={chooseBackup}>{busy==="choose"?"Opening…":"Choose .hlb backup"}</button>{restoreMetadata&&<div className="backup-file"><strong>Backup ready</strong><span>Created {formatTimestamp(restoreMetadata.createdAt)}</span><span>HomeLedger {restoreMetadata.appVersion}</span></div>}<label>Backup password<input type="password" autoComplete="current-password" value={restorePassword} onChange={e=>setRestorePassword(e.target.value)} disabled={!restoreContents} maxLength={1024}/></label><label className="restore-confirm"><input type="checkbox" checked={replaceConfirmed} onChange={e=>setReplaceConfirmed(e.target.checked)} disabled={!restoreContents}/><span><strong>Replace the current ledger</strong><small>This cannot be undone unless you first create a separate backup of the current data.</small></span></label><button className="danger-action" disabled={busy!==null||!restoreContents||!restorePassword||!replaceConfirmed} onClick={restoreBackup}>{busy==="restore"?"Validating and restoring…":"Restore and replace ledger"}</button></section>
    </div>
    <section className="backup-warning"><TriangleAlert size={18}/><p><strong>Do not lose the password.</strong> HomeLedger cannot decrypt a backup without it. Test important backups on another installation before relying on them as your only copy.</p></section>
  </div>;
}

function formatTimestamp(value:string){return new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
function formatBytes(value:number){return value<1024*1024?`${Math.max(1,Math.round(value/1024))} KB`:`${(value/(1024*1024)).toFixed(1)} MB`;}
