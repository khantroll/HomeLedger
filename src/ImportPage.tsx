import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, History, RotateCcw, Save, Trash2, Undo2, Upload, X } from "lucide-react";
import { buildPreview, headerSignature, parseDelimited, suggestMapping, suggestParsingOptions, type ColumnMapping, type DelimitedParsingOptions, type ParsedTable } from "./csvImport";
import { buildOfxPreview, parseOfx, type OfxStatement } from "./ofxImport";
import { buildQifPreview, parseQif, type QifStatement } from "./qifImport";
import { financeRepository, pdfRepository, workbookRepository } from "./repository";
import { formatMoney, type Account, type ImportBatch, type ImportProfile, type ScheduledImportMatch, type Transaction } from "./domain";
import { applyMerchantRules } from "./merchantRules";
import type { MerchantRule } from "./domain";
import { decodeStatement, encodingLabel, type StatementEncoding } from "./statementDecoding";
import { bytesToBase64, suggestWorkbookHeaderRow, suggestWorkbookSelection, workbookHeaderChoices, workbookSheetToTable, type ParsedWorkbook } from "./workbookImport";
import { PDF_LAYOUT_OPTIONS, isPdfComplete, pdfTextToTable, suggestPdfLayout, type PdfLayout, type PdfParseResult } from "./pdfImport";
import {extractImageText,isSupportedOcrImage,type OcrProgress} from "./ocrImport";
import {matchingStatementTemplate,statementSourceSignature,type StatementSourceKind} from "./statementTemplates";
import "./importHistory.css";
import "./ofxImport.css";

export function ImportPage({accounts,transactions,onImported}:{accounts:Account[];transactions:Transaction[];onImported:()=>Promise<void>}) {
  const [table,setTable]=useState<ParsedTable|null>(null);
  const [ofx,setOfx]=useState<OfxStatement|null>(null);
  const [qif,setQif]=useState<QifStatement|null>(null);
  const [workbook,setWorkbook]=useState<ParsedWorkbook|null>(null);
  const [workbookSheetIndex,setWorkbookSheetIndex]=useState(0);
  const [workbookHeaderRow,setWorkbookHeaderRow]=useState(0);
  const [pdf,setPdf]=useState<PdfParseResult|null>(null);
  const [pdfText,setPdfText]=useState("");
  const [ocrConfidence,setOcrConfidence]=useState<number|null>(null);
  const [ocrProgress,setOcrProgress]=useState<OcrProgress|null>(null);
  const [fileName,setFileName]=useState("");
  const [accountId,setAccountId]=useState(accounts[0]?.id??"");
  const [mapping,setMapping]=useState<ColumnMapping>({date:-1,payee:-1,amount:-1,debit:-1,credit:-1});
  const [parsingOptions,setParsingOptions]=useState<DelimitedParsingOptions>({dateOrder:"mdy",numberFormat:"dot"});
  const [fileEncoding,setFileEncoding]=useState<StatementEncoding>("utf-8");
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
  const [sourceKind,setSourceKind]=useState<StatementSourceKind>("delimited");
  const [sourceSignature,setSourceSignature]=useState("");
  const [includedDuplicates,setIncludedDuplicates]=useState<Set<number>>(new Set());
  const [scheduledMatches,setScheduledMatches]=useState<Map<number,ScheduledImportMatch>>(new Map());
  const [selectedScheduledMatches,setSelectedScheduledMatches]=useState<Map<number,string>>(new Map());
  const showError=(reason:unknown)=>setError(reason instanceof Error?reason.message:String(reason));

  useEffect(()=>{if(!accountId&&accounts[0])setAccountId(accounts[0].id);},[accountId,accounts]);
  useEffect(()=>{void loadHistory();void financeRepository.listMerchantRules().then(setRules).catch(showError);void financeRepository.listImportProfiles().then(setProfiles).catch(showError);},[]);

  const accountTransactions=useMemo(()=>transactions.filter(item=>item.accountId===accountId),[transactions,accountId]);
  const rawPreview=useMemo(()=>qif?buildQifPreview(qif,accountTransactions):ofx?buildOfxPreview(ofx,accountTransactions):table?buildPreview(table,mapping,accountTransactions,parsingOptions):[],[qif,ofx,table,mapping,parsingOptions,accountTransactions]);
  const applications=useMemo(()=>applyMerchantRules(rawPreview,rules),[rawPreview,rules]);
  const preview=useMemo(()=>applications.map(item=>item.row),[applications]);
  const matchedRules=useMemo(()=>new Map(applications.filter(item=>item.rule).map(item=>[item.row.sourceRow,item.rule!])),[applications]);
  const pdfIncomplete=Boolean(pdf&&!isPdfComplete(pdf));
  const valid=pdfIncomplete?[]:preview.filter(row=>!row.error&&(!row.duplicate||(row.duplicate.confidence!=="exact"&&includedDuplicates.has(row.sourceRow))));
  const duplicates=preview.filter(row=>row.duplicate).length;
  const duplicateCounts=useMemo(()=>({exact:preview.filter(row=>row.duplicate?.confidence==="exact").length,probable:preview.filter(row=>row.duplicate?.confidence==="probable").length,possible:preview.filter(row=>row.duplicate?.confidence==="possible").length}),[preview]);
  const errors=preview.filter(row=>row.error).length;
  const selectedAccount=accounts.find(account=>account.id===accountId);
  const currencyMismatch=Boolean(ofx&&selectedAccount&&ofx.currency!==selectedAccount.currency);

  useEffect(()=>{
    let current=true;
    const rows=preview.filter(row=>!row.error&&!row.duplicate);
    if(!accountId||!rows.length){setScheduledMatches(new Map());setSelectedScheduledMatches(new Map());return()=>{current=false;};}
    void financeRepository.findScheduledOccurrenceMatches({accountId,rows}).then(matches=>{
      if(!current)return;
      setScheduledMatches(new Map(matches.map(match=>[match.sourceRow,match])));
      setSelectedScheduledMatches(selected=>new Map([...selected].filter(([sourceRow,occurrenceId])=>matches.some(match=>match.sourceRow===sourceRow&&match.candidates.some(candidate=>candidate.occurrenceId===occurrenceId)))));
    }).catch(showError);
    return()=>{current=false;};
  },[accountId,preview]);

  function configureWorkbook(parsedWorkbook:ParsedWorkbook,sheetIndex:number,headerRow?:number,preferredProfile?:ImportProfile){
    const sheet=parsedWorkbook.sheets[sheetIndex];
    if(!sheet)throw new Error("Choose a readable worksheet");
    const selectedHeader=headerRow??suggestWorkbookHeaderRow(sheet);
    const parsed=workbookSheetToTable(sheet,selectedHeader);
    setWorkbook(parsedWorkbook);setWorkbookSheetIndex(sheetIndex);setWorkbookHeaderRow(selectedHeader);setTable(parsed);setOfx(null);setQif(null);setPdf(null);setPdfText("");setOcrConfidence(null);setOcrProgress(null);
    const signature=headerSignature(parsed.headers);
    const profile=preferredProfile?.headerSignature===signature?preferredProfile:profiles.find(item=>item.headerSignature===signature&&!item.sourceSignature);
    if(profile){applyProfile(profile);setProfileName(profile.name);}else{const suggested=suggestMapping(parsed.headers);setMapping(suggested);setParsingOptions(suggestParsingOptions(parsed,suggested));setSelectedProfileId("");setProfileName("");}
    setIncludedDuplicates(new Set());
  }

  function configurePdf(text:string,layout:PdfLayout,confidence:number|null=ocrConfidence,preferredProfile?:ImportProfile){
    const parsed=pdfTextToTable(text,layout),suggested=suggestMapping(parsed.table.headers);
    setPdf(parsed);setPdfText(text);setTable(parsed.table);setOfx(null);setQif(null);setWorkbook(null);setOcrConfidence(confidence);
    if(preferredProfile?.headerSignature===headerSignature(parsed.table.headers)){applyProfile(preferredProfile);setProfileName(preferredProfile.name);}else{setMapping(suggested);setParsingOptions(suggestParsingOptions(parsed.table,suggested));setSelectedProfileId("");setProfileName("");}
    setIncludedDuplicates(new Set());
  }

  async function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]; if(!file)return;
    const signature=statementSourceSignature(file.name);
    setError("");setMessage("");setFileName(file.name);setSourceSignature(signature);setOcrProgress(null);
    if(file.size>10*1024*1024){setError("Statement files are limited to 10 MB in this milestone.");return;}
    try{
      setIncludedDuplicates(new Set());
      if(isSupportedOcrImage(file)||file.type.startsWith("image/")){
        setSourceKind("ocr");
        setTable(null);setOfx(null);setQif(null);setWorkbook(null);setPdf(null);setPdfText("");setOcrConfidence(null);
        setOcrProgress({status:"loading local OCR",progress:0});
        const extraction=await extractImageText(file,setOcrProgress);
        const profile=matchingStatementTemplate(profiles,"ocr",signature),layout=profile?.pdfLayout??suggestPdfLayout(extraction.text);
        setOcrProgress(null);configurePdf(extraction.text,layout,extraction.confidence,profile);setFileEncoding("utf-8");if(profile)setMessage(`Applied statement template “${profile.name}”.`);
        return;
      }
      const buffer=await file.arrayBuffer();
      if(/\.(xlsx|xls)$/i.test(file.name)){
        setSourceKind("workbook");
        const parsed=await workbookRepository.parseWorkbook(bytesToBase64(buffer),file.name),profile=matchingStatementTemplate(profiles,"workbook",signature);
        const savedSheetIndex=profile?.workbookSheetName?parsed.sheets.findIndex(sheet=>sheet.name===profile.workbookSheetName):-1;
        let selection=suggestWorkbookSelection(parsed),applicableProfile:ImportProfile|undefined;
        if(savedSheetIndex>=0&&profile?.workbookHeaderRow!==undefined){try{workbookSheetToTable(parsed.sheets[savedSheetIndex],profile.workbookHeaderRow);selection={sheetIndex:savedSheetIndex,headerRow:profile.workbookHeaderRow};applicableProfile=profile;}catch{/* A changed workbook falls back to reviewed suggestions. */}}
        configureWorkbook(parsed,selection.sheetIndex,selection.headerRow,applicableProfile);setFileEncoding("utf-8");if(applicableProfile)setMessage(`Applied statement template “${applicableProfile.name}”.`);
      }else if(/\.pdf$/i.test(file.name)){
        setSourceKind("pdf");
        const extraction=await pdfRepository.extractText(bytesToBase64(buffer),file.name),profile=matchingStatementTemplate(profiles,"pdf",signature),layout=profile?.pdfLayout??suggestPdfLayout(extraction.text);configurePdf(extraction.text,layout,null,profile);setFileEncoding("utf-8");if(profile)setMessage(`Applied statement template “${profile.name}”.`);
      }else{
        setSourceKind("delimited");
        const decoded=decodeStatement(buffer),text=decoded.text;setFileEncoding(decoded.encoding);setWorkbook(null);setPdf(null);setPdfText("");setOcrConfidence(null);
        if(/<OFX[>\s]/i.test(text)||/\.(ofx|qfx)$/i.test(file.name)){const parsed=parseOfx(text);setOfx(parsed);setQif(null);setTable(null);setSelectedProfileId("");}
        else if(/^!Type:/im.test(text)||/\.qif$/i.test(file.name)){const parsed=parseQif(text);setQif(parsed);setOfx(null);setTable(null);setSelectedProfileId("");}
        else{const parsed=parseDelimited(text);setTable(parsed);setOfx(null);setQif(null);const tableSignature=headerSignature(parsed.headers),sourceProfile=matchingStatementTemplate(profiles,"delimited",signature),profile=sourceProfile?.headerSignature===tableSignature?sourceProfile:profiles.find(item=>item.headerSignature===tableSignature&&item.sourceKind==="delimited"&&!item.sourceSignature);if(profile){applyProfile(profile);setProfileName(profile.name);if(sourceProfile===profile)setMessage(`Applied statement template “${profile.name}”.`);}else{const suggested=suggestMapping(parsed.headers);setMapping(suggested);setParsingOptions(suggestParsingOptions(parsed,suggested));setSelectedProfileId("");setProfileName("");}}
      }
    }
    catch(reason){setTable(null);setOfx(null);setQif(null);setWorkbook(null);setPdf(null);setPdfText("");setOcrConfidence(null);setOcrProgress(null);setError(reason instanceof Error?reason.message:String(reason));}
    finally{event.target.value="";}
  }

  function applyProfile(profile:ImportProfile){setMapping({date:profile.dateColumn,payee:profile.payeeColumn,amount:profile.amountColumn,debit:profile.debitColumn,credit:profile.creditColumn});setParsingOptions({dateOrder:profile.dateOrder,numberFormat:profile.numberFormat});setIncludedDuplicates(new Set());if(profile.accountId&&accounts.some(account=>account.id===profile.accountId))setAccountId(profile.accountId);setSelectedProfileId(profile.id);}
  async function saveProfile(){if(!table)return;setError("");try{const saved=await financeRepository.saveImportProfile({name:profileName.trim(),accountId,headerSignature:headerSignature(table.headers),sourceKind,sourceSignature:sourceSignature||undefined,pdfLayout:pdf?.layout,workbookSheetName:workbook?.sheets[workbookSheetIndex]?.name,workbookHeaderRow:workbook?workbookHeaderRow:undefined,dateColumn:mapping.date,payeeColumn:mapping.payee,amountColumn:mapping.amount,debitColumn:mapping.debit,creditColumn:mapping.credit,...parsingOptions});const next=await financeRepository.listImportProfiles();setProfiles(next);setSelectedProfileId(saved.id);setMessage(`Saved statement template “${saved.name}”.`);}catch(reason){showError(reason);}}
  async function deleteProfile(){if(!selectedProfileId)return;setError("");try{await financeRepository.deleteImportProfile(selectedProfileId);setProfiles(await financeRepository.listImportProfiles());setSelectedProfileId("");setProfileName("");setMessage("Deleted the saved statement template.");}catch(reason){showError(reason);}}
  function chooseProfile(id:string){setSelectedProfileId(id);const profile=profiles.find(item=>item.id===id);if(profile){if(pdf&&profile.pdfLayout&&profile.pdfLayout!==pdf.layout){configurePdf(pdfText,profile.pdfLayout,ocrConfidence,profile);return;}if(workbook&&profile.workbookSheetName&&profile.workbookHeaderRow!==undefined){const sheetIndex=workbook.sheets.findIndex(sheet=>sheet.name===profile.workbookSheetName);if(sheetIndex>=0&&(sheetIndex!==workbookSheetIndex||profile.workbookHeaderRow!==workbookHeaderRow)){try{workbookSheetToTable(workbook.sheets[sheetIndex],profile.workbookHeaderRow);configureWorkbook(workbook,sheetIndex,profile.workbookHeaderRow,profile);}catch(reason){setSelectedProfileId("");showError(reason);}return;}}applyProfile(profile);setProfileName(profile.name);}else if(table){const suggested=suggestMapping(table.headers);setMapping(suggested);setParsingOptions(suggestParsingOptions(table,suggested));setProfileName("");}}
  function toggleDuplicate(sourceRow:number){setIncludedDuplicates(current=>{const next=new Set(current);if(next.has(sourceRow))next.delete(sourceRow);else next.add(sourceRow);return next;});}

  async function commit(){
    if(!accountId){setError("Choose an account before importing.");return;}
    if(errors){setError("Correct the mapping or source rows before importing.");return;}
    if(currencyMismatch){setError(`The statement uses ${ofx?.currency}, but the selected account uses ${selectedAccount?.currency}.`);return;}
    if(pdfIncomplete){setError("Choose a statement layout that recognizes every dated transaction row before importing.");return;}
    if(!valid.length){setError("There are no new valid transactions to import.");return;}
    setSaving(true);setError("");
    try{const result=await financeRepository.importTransactions({accountId,sourceName:fileName,rows:valid.map(({sourceRow,postedDate,payee,originalPayee,amountMinor,memo,externalId,category,splits})=>({postedDate,payee,originalPayee,amountMinor,memo,externalId,category,splits,scheduledOccurrenceId:selectedScheduledMatches.get(sourceRow)}))});setMessage(`Imported ${result.importedCount} transactions as one atomic batch.`);setTable(null);setOfx(null);setQif(null);setWorkbook(null);setPdf(null);setPdfText("");setOcrConfidence(null);setOcrProgress(null);setFileName("");setSelectedScheduledMatches(new Map());await onImported();await loadHistory();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setSaving(false);}
  }

  function reset(){setTable(null);setOfx(null);setQif(null);setWorkbook(null);setPdf(null);setPdfText("");setOcrConfidence(null);setOcrProgress(null);setFileName("");setSourceKind("delimited");setSourceSignature("");setError("");setMessage("");setSelectedProfileId("");setProfileName("");setIncludedDuplicates(new Set());setScheduledMatches(new Map());setSelectedScheduledMatches(new Map());setFileEncoding("utf-8");}
  async function loadHistory(){try{setBatches(await financeRepository.listImportBatches());}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
  async function undo(){if(!pendingUndo)return;setUndoing(true);setError("");try{const result=await financeRepository.undoImportBatch(pendingUndo.id);setMessage(`Removed ${result.removedCount} transactions from ${pendingUndo.sourceName}.`);setPendingUndo(null);await onImported();await loadHistory();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setUndoing(false);}}
  if(!accounts.length)return <section className="panel import-empty"><FileSpreadsheet/><h2>Create an account first</h2><p>Statement transactions must be assigned to a local account.</p></section>;

  return <div className="import-page">
    <section className="panel import-controls">
      <div className="panel-heading"><div><h2>Import a statement</h2><p>CSV, TSV, Excel, statement-image OCR, searchable PDF, OFX, QFX, and QIF parsing happens locally; the original file is not retained.</p></div>{(table||ofx||qif)&&<button onClick={reset}><RotateCcw size={14}/> Start over</button>}</div>
      <div className="import-body">
        <label className="file-picker"><Upload size={20}/><span><strong>{fileName||"Choose a statement file"}</strong><small>{ocrProgress?`${ocrProgress.status} · ${Math.round(ocrProgress.progress*100)}%`:fileName?(workbook?"Excel workbook parsed locally":pdf?(ocrConfidence===null?"Searchable PDF parsed locally":"Statement image OCR completed locally"):`${encodingLabel(fileEncoding)} detected locally`):"CSV, TSV, XLS, XLSX, PNG, JPEG, WebP, PDF, OFX, QFX, or QIF, up to 10 MB"}</small></span><input type="file" disabled={Boolean(ocrProgress)} accept=".csv,.tsv,.txt,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.pdf,.ofx,.qfx,.qif,text/csv,text/tab-separated-values,image/png,image/jpeg,image/webp,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/x-ofx,application/qif" onChange={chooseFile}/></label>
        {error&&<div className="error-banner" role="alert">{error}</div>}{message&&<div className="success-banner" role="status">{message}</div>}
        {table&&<>
          {pdf&&<><div className="ofx-summary"><div><span>Document type</span><strong>{ocrConfidence===null?"Searchable PDF":"OCR statement image"}</strong></div>{ocrConfidence!==null&&<div><span>OCR confidence</span><strong>{Math.round(ocrConfidence)}%</strong></div>}<div><span>Dated rows</span><strong>{pdf.candidateRowCount}</strong></div><div><span>Recognized rows</span><strong>{pdf.matchedRowCount}</strong></div><div><span>Unrecognized rows</span><strong>{pdf.unmatchedLineNumbers.length}</strong></div></div><div className="profile-controls workbook-controls"><label>Statement layout<select value={pdf.layout} onChange={event=>{setError("");configurePdf(pdfText,event.target.value as PdfLayout);}}>{PDF_LAYOUT_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}</select></label></div>{pdfIncomplete&&<div className="error-banner" role="alert">{pdf.candidateRowCount===0?"No dated transaction rows were found in the extracted text. Try a clearer image or another source format.":`${pdf.unmatchedLineNumbers.length} of ${pdf.candidateRowCount} dated rows do not match this layout (extracted lines ${pdf.unmatchedLineNumbers.slice(0,8).join(", ")}${pdf.unmatchedLineNumbers.length>8?", …":""}). Import is disabled to prevent a partial statement.`}</div>}</>}
          {workbook&&<div className="profile-controls workbook-controls">
            <label>Worksheet<select value={workbookSheetIndex} onChange={event=>{try{setError("");configureWorkbook(workbook,Number(event.target.value));}catch(reason){showError(reason);}}}>{workbook.sheets.map((sheet,index)=><option key={`${sheet.name}-${index}`} value={index}>{sheet.name}</option>)}</select></label>
            <label>Header row<select value={workbookHeaderRow} onChange={event=>{try{setError("");configureWorkbook(workbook,workbookSheetIndex,Number(event.target.value));}catch(reason){showError(reason);}}}>{workbookHeaderChoices(workbook.sheets[workbookSheetIndex]).map(index=><option key={index} value={index}>Row {workbook.sheets[workbookSheetIndex].firstRow+index}: {workbook.sheets[workbookSheetIndex].rows[index].filter(Boolean).slice(0,3).join(" · ")}</option>)}</select></label>
          </div>}
          <div className="profile-controls">
            <label>Saved template<select value={selectedProfileId} onChange={event=>chooseProfile(event.target.value)}><option value="">Suggested settings</option>{profiles.filter(profile=>profile.headerSignature===headerSignature(table.headers)&&(!profile.sourceSignature||(profile.sourceKind===sourceKind&&profile.sourceSignature===sourceSignature))).map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <label>Template name<input value={profileName} onChange={event=>setProfileName(event.target.value)} maxLength={80} placeholder="Example Credit Union"/></label>
            <button onClick={saveProfile} disabled={!profileName.trim()||!sourceSignature}><Save size={14}/> Save template</button>
            <button onClick={deleteProfile} disabled={!selectedProfileId} aria-label="Delete selected template"><Trash2 size={14}/></button>
          </div>
          <div className="mapping-grid">
            <label>Import to account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <MappingSelect label="Date" value={mapping.date} headers={table.headers} onChange={date=>{setMapping({...mapping,date});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Description / payee" value={mapping.payee} headers={table.headers} onChange={payee=>{setMapping({...mapping,payee});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Signed amount" value={mapping.amount} headers={table.headers} onChange={amount=>{setMapping({...mapping,amount});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Debit (optional)" value={mapping.debit} headers={table.headers} onChange={debit=>{setMapping({...mapping,debit});setIncludedDuplicates(new Set());}}/>
            <MappingSelect label="Credit (optional)" value={mapping.credit} headers={table.headers} onChange={credit=>{setMapping({...mapping,credit});setIncludedDuplicates(new Set());}}/>
            <label>Date order<select value={parsingOptions.dateOrder} onChange={event=>{setParsingOptions({...parsingOptions,dateOrder:event.target.value as DelimitedParsingOptions["dateOrder"]});setIncludedDuplicates(new Set());}}><option value="mdy">Month / day / year</option><option value="dmy">Day / month / year</option></select></label>
            <label>Number format<select value={parsingOptions.numberFormat} onChange={event=>{setParsingOptions({...parsingOptions,numberFormat:event.target.value as DelimitedParsingOptions["numberFormat"]});setIncludedDuplicates(new Set());}}><option value="dot">1,234.56</option><option value="comma">1.234,56</option></select></label>
          </div>
          <p className="mapping-help">{pdf?"Choose the layout that matches the original statement. Credit-card modes deliberately turn every unsigned transaction amount into an expense; use them only when that is how the statement presents charges.":"Use either one signed amount column, or separate debit and credit columns. A mapped signed amount takes precedence."}</p>
        </>}
        {ofx&&<><div className="ofx-summary"><div><span>Statement type</span><strong>{ofx.accountType==="credit-card"?"Credit card":"Bank account"}</strong></div><div><span>Statement account</span><strong>{ofx.accountIdMasked}</strong></div><div><span>Currency</span><strong>{ofx.currency}</strong></div><div><span>Date range</span><strong>{ofx.dateStart&&ofx.dateEnd?`${ofx.dateStart} – ${ofx.dateEnd}`:"Not supplied"}</strong></div><div><span>Ledger balance</span><strong>{ofx.ledgerBalanceMinor===undefined?"Not supplied":formatMoney(ofx.ledgerBalanceMinor,ofx.currency)}</strong></div></div><label className="ofx-account">Import to account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}</select></label>{currencyMismatch&&<div className="error-banner">Currency mismatch: statement is {ofx.currency}; selected account is {selectedAccount?.currency}.</div>}</>}
        {qif&&<><div className="ofx-summary"><div><span>Statement type</span><strong>{qif.accountType==="credit-card"?"Credit card":qif.accountType==="cash"?"Cash":"Bank account"}</strong></div><div><span>Statement account</span><strong>{qif.accountName||"Not supplied"}</strong></div><div><span>Transactions</span><strong>{qif.rows.length}</strong></div><div><span>Split transactions</span><strong>{qif.rows.filter(row=>row.splits?.length).length}</strong></div></div><label className="ofx-account">Import to account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}</select></label><p className="mapping-help">QIF does not specify currency. Amounts will use the selected account’s {selectedAccount?.currency} currency.</p></>}
      </div>
    </section>
    {(table||ofx||qif)&&<section className="panel import-preview"><div className="panel-heading"><div><h2>Pre-import review</h2><p>{valid.length} ready · {duplicates} matches ({duplicateCounts.exact} exact, {duplicateCounts.probable} probable, {duplicateCounts.possible} possible) · {errors} errors</p></div><button className="primary-action" disabled={saving||errors>0||valid.length===0||currencyMismatch} onClick={commit}>{saving?"Importing…":`Import ${valid.length}`}</button></div><div className="table-wrap"><table><thead><tr><th>Source row</th><th>Date</th><th>Description</th><th>Category / result</th><th>Amount</th><th>Decision</th></tr></thead><tbody>{preview.slice(0,100).map(row=>{const rule=matchedRules.get(row.sourceRow),included=includedDuplicates.has(row.sourceRow),schedule=scheduledMatches.get(row.sourceRow),selected=selectedScheduledMatches.get(row.sourceRow);return <tr key={row.sourceRow} className={row.error?"row-error":row.duplicate?`row-duplicate duplicate-${row.duplicate.confidence}`:""}><td>{row.sourceRow}</td><td>{row.postedDate||"—"}</td><td>{row.payee||"—"}{row.originalPayee&&row.originalPayee!==row.payee?<small className="split-count">From: {row.originalPayee}</small>:null}{row.splits?.length?<small className="split-count">{row.splits.length} splits</small>:null}</td><td>{row.error?<span className="import-status error">{row.error}</span>:row.duplicate?<><span className={`import-status duplicate ${row.duplicate.confidence}`}>{row.duplicate.confidence} match</span><small className="duplicate-reason">{row.duplicate.reason}</small></>:<><span className="import-status ready">{row.category??"Uncategorized"}</span>{rule&&<small className="rule-match">Rule: {rule.name}</small>}{schedule?.candidates.length?<label className="schedule-match">Scheduled item<select aria-label={`Scheduled match for row ${row.sourceRow}`} value={selected??""} onChange={event=>setSelectedScheduledMatches(current=>{const next=new Map(current);if(event.target.value)next.set(row.sourceRow,event.target.value);else next.delete(row.sourceRow);return next;})}><option value="">Do not link</option>{schedule.candidates.map(candidate=><option key={candidate.occurrenceId} value={candidate.occurrenceId} disabled={[...selectedScheduledMatches].some(([otherRow,id])=>otherRow!==row.sourceRow&&id===candidate.occurrenceId)}>{candidate.payee} · {candidate.dueDate} · {candidate.confidence}</option>)}</select>{selected&&<small>{schedule.candidates.find(candidate=>candidate.occurrenceId===selected)?.reasons.join(" · ")}</small>}</label>:null}</>}</td><td className={row.amountMinor<0?"amount negative":"amount positive"}>{row.error?"—":formatMoney(row.amountMinor,ofx?.currency??selectedAccount?.currency)}</td><td>{row.duplicate?(row.duplicate.confidence==="exact"?<span className="exact-skip">Excluded</span>:<button className={included?"include-duplicate active":"include-duplicate"} onClick={()=>toggleDuplicate(row.sourceRow)}>{included?"Import anyway":"Skip"}</button>):selected?<span className="import-status ready">Import + link</span>:"Import"}</td></tr>;})}</tbody></table></div>{preview.length>100&&<p className="preview-limit">Showing the first 100 of {preview.length} rows.</p>}</section>}
    <section className="panel import-history"><div className="panel-heading"><div><h2>Import history</h2><p>Every committed batch remains in the audit history.</p></div><History size={18}/></div>{batches.length===0?<div className="empty-state">No statements have been imported yet.</div>:<div className="table-wrap"><table><thead><tr><th>Imported</th><th>Source</th><th>Account</th><th>Transactions</th><th>Net amount</th><th>Status</th><th></th></tr></thead><tbody>{batches.map(batch=><tr key={batch.id}><td>{formatTimestamp(batch.importedAt)}</td><td><strong>{batch.sourceName}</strong></td><td>{batch.accountName}</td><td>{batch.transactionCount}</td><td className={batch.totalMinor<0?"amount negative":"amount positive"}>{formatMoney(batch.totalMinor)}</td><td>{batch.undoneAt?<span className="import-status duplicate">Undone</span>:<span className="import-status ready">Active</span>}</td><td>{!batch.undoneAt&&<button className="undo-button" onClick={()=>setPendingUndo(batch)}><Undo2 size={13}/> Undo</button>}</td></tr>)}</tbody></table></div>}</section>
    {pendingUndo&&<UndoDialog batch={pendingUndo} busy={undoing} onCancel={()=>setPendingUndo(null)} onConfirm={undo}/>}
  </div>;
}

function MappingSelect({label,value,headers,onChange}:{label:string;value:number;headers:string[];onChange:(value:number)=>void}){return <label>{label}<select value={value} onChange={event=>onChange(Number(event.target.value))}><option value={-1}>Not mapped</option>{headers.map((header,index)=><option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>;}
function formatTimestamp(value:string){const normalized=value.includes("T")?value:`${value.replace(" ","T")}Z`;const date=new Date(normalized);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short"}).format(date);}
function UndoDialog({batch,busy,onCancel,onConfirm}:{batch:ImportBatch;busy:boolean;onCancel:()=>void;onConfirm:()=>void}){return <div className="dialog-backdrop"><section className="dialog undo-dialog" role="alertdialog" aria-modal="true" aria-labelledby="undo-title" aria-describedby="undo-description"><div className="dialog-header"><h2 id="undo-title">Undo this complete import?</h2><button onClick={onCancel} disabled={busy} aria-label="Close"><X size={18}/></button></div><div className="undo-body"><p id="undo-description">This removes all <strong>{batch.transactionCount}</strong> transactions imported from <strong>{batch.sourceName}</strong>. The audit-history record remains, marked as undone.</p><p>This cannot be redone because HomeLedger does not retain the original statement file.</p><div className="form-actions"><button onClick={onCancel} disabled={busy}>Cancel</button><button className="danger-action" onClick={onConfirm} disabled={busy}>{busy?"Undoing…":"Undo complete batch"}</button></div></div></section></div>;}
