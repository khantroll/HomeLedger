import { invoke } from "@tauri-apps/api/core";
import { DemoFinanceRepository } from "./demoRepository";
import type { Account, BackupHealth, BackupRepository, BudgetAllocationInput, BudgetCategory, BudgetCategoryInput, BudgetMonth, CompleteReconciliationInput, CreateAccountInput, CreateTransactionInput, CreateTransferInput, DebtPlan, DebtPlanInput, FinanceRepository, ImportBatch, ImportProfile, ImportProfileInput, ImportResult, ImportTransactionsInput, MerchantRule, MerchantRuleInput, Reconciliation, RestoreResult, SavingsGoal, SavingsGoalInput, ScheduledAutoPostInput, ScheduledImportMatch, ScheduledImportMatchInput, ScheduledOccurrence, ScheduledOccurrenceQuery, ScheduledPostResult, ScheduledTransaction, ScheduledTransactionInput, Transaction, TransactionPage, TransactionQuery, TransferResult, UndoImportResult, UpdateAccountInput } from "./domain";
import type { ParsedWorkbook, WorkbookRepository } from "./workbookImport";
import type { PdfExtraction, PdfRepository } from "./pdfImport";

class TauriFinanceRepository implements FinanceRepository {
  listAccounts(includeArchived=false): Promise<Account[]> { return invoke("list_accounts", { includeArchived }); }
  listCategories():Promise<string[]>{return invoke("list_categories");}
  listPayees():Promise<string[]>{return invoke("list_payees");}
  listTransactions(accountId?: string): Promise<Transaction[]> { return invoke("list_transactions", { accountId: accountId ?? null }); }
  listTransactionsPage(query: TransactionQuery = {}): Promise<TransactionPage> { return invoke("list_transactions_page", { request: query }); }
  listReconciliationTransactions(accountId: string, statementEndDate: string): Promise<Transaction[]> { return invoke("list_reconciliation_transactions", { accountId, statementEndDate }); }
  listReconciliations(accountId: string): Promise<Reconciliation[]> { return invoke("list_reconciliations", { accountId }); }
  completeReconciliation(input: CompleteReconciliationInput): Promise<Reconciliation> { return invoke("complete_reconciliation", { request: input }); }
  createAccount(input: CreateAccountInput): Promise<Account> { return invoke("create_account", { request: input }); }
  updateAccount(id: string,input: UpdateAccountInput): Promise<Account> { return invoke("update_account", { accountId:id,request:input }); }
  setAccountArchived(id:string,archived:boolean):Promise<void>{return invoke("set_account_archived",{accountId:id,archived});}
  reorderAccounts(accountIds:string[]):Promise<void>{return invoke("reorder_accounts",{accountIds});}
  createTransaction(input: CreateTransactionInput): Promise<Transaction> { return invoke("create_transaction", { request: input }); }
  updateTransaction(id: string, input: CreateTransactionInput): Promise<Transaction> { return invoke("update_transaction", { transactionId: id, request: input }); }
  deleteTransaction(id: string): Promise<void> { return invoke("delete_transaction", { transactionId: id }); }
  createTransfer(input: CreateTransferInput): Promise<TransferResult> { return invoke("create_transfer", { request: input }); }
  updateTransfer(id: string, input: CreateTransferInput): Promise<TransferResult> { return invoke("update_transfer", { transferId: id, request: input }); }
  deleteTransfer(id: string): Promise<void> { return invoke("delete_transfer", { transferId: id }); }
  listMerchantRules(): Promise<MerchantRule[]> { return invoke("list_merchant_rules"); }
  createMerchantRule(input: MerchantRuleInput): Promise<MerchantRule> { return invoke("create_merchant_rule", { request: input }); }
  updateMerchantRule(id: string, input: MerchantRuleInput): Promise<MerchantRule> { return invoke("update_merchant_rule", { ruleId: id, request: input }); }
  deleteMerchantRule(id: string): Promise<void> { return invoke("delete_merchant_rule", { ruleId: id }); }
  listImportProfiles(): Promise<ImportProfile[]> { return invoke("list_import_profiles"); }
  saveImportProfile(input: ImportProfileInput): Promise<ImportProfile> { return invoke("save_import_profile", { request: input }); }
  deleteImportProfile(id: string): Promise<void> { return invoke("delete_import_profile", { profileId: id }); }
  listScheduledTransactions(): Promise<ScheduledTransaction[]> { return invoke("list_scheduled_transactions"); }
  createScheduledTransaction(input: ScheduledTransactionInput): Promise<ScheduledTransaction> { return invoke("create_scheduled_transaction", { request: input }); }
  updateScheduledTransaction(id: string, input: ScheduledTransactionInput): Promise<ScheduledTransaction> { return invoke("update_scheduled_transaction", { scheduledTransactionId: id, request: input }); }
  deleteScheduledTransaction(id: string): Promise<void> { return invoke("delete_scheduled_transaction", { scheduledTransactionId: id }); }
  generateScheduledOccurrences(input: ScheduledOccurrenceQuery): Promise<number> { return invoke("generate_scheduled_occurrences", { request: input }); }
  listScheduledOccurrences(input: ScheduledOccurrenceQuery): Promise<ScheduledOccurrence[]> { return invoke("list_scheduled_occurrences", { request: input }); }
  postScheduledOccurrence(id: string): Promise<Transaction> { return invoke("post_scheduled_occurrence", { occurrenceId: id }); }
  processScheduledAutoPost(input:ScheduledAutoPostInput):Promise<ScheduledPostResult>{return invoke("process_scheduled_auto_post",{request:input});}
  skipScheduledOccurrence(id: string): Promise<ScheduledOccurrence> { return invoke("skip_scheduled_occurrence", { occurrenceId: id }); }
  linkScheduledOccurrence(id: string, transactionId: string): Promise<ScheduledOccurrence> { return invoke("link_scheduled_occurrence", { occurrenceId: id, transactionId }); }
  findScheduledOccurrenceMatches(input: ScheduledImportMatchInput): Promise<ScheduledImportMatch[]> { return invoke("find_scheduled_occurrence_matches", { request: input }); }
  listBudgetCategories():Promise<BudgetCategory[]>{return invoke("list_budget_categories");}
  createBudgetCategory(input:BudgetCategoryInput):Promise<BudgetCategory>{return invoke("create_budget_category",{request:input});}
  updateBudgetCategory(id:string,input:BudgetCategoryInput):Promise<BudgetCategory>{return invoke("update_budget_category",{budgetCategoryId:id,request:input});}
  deleteBudgetCategory(id:string):Promise<void>{return invoke("delete_budget_category",{budgetCategoryId:id});}
  setBudgetAllocation(input:BudgetAllocationInput):Promise<void>{return invoke("set_budget_allocation",{request:input});}
  getBudgetMonth(month:string):Promise<BudgetMonth>{return invoke("get_budget_month",{month});}
  listSavingsGoals():Promise<SavingsGoal[]>{return invoke("list_savings_goals");}
  createSavingsGoal(input:SavingsGoalInput):Promise<SavingsGoal>{return invoke("create_savings_goal",{request:input});}
  updateSavingsGoal(id:string,input:SavingsGoalInput):Promise<SavingsGoal>{return invoke("update_savings_goal",{savingsGoalId:id,request:input});}
  deleteSavingsGoal(id:string):Promise<void>{return invoke("delete_savings_goal",{savingsGoalId:id});}
  getDebtPlan(currency:string):Promise<DebtPlan>{return invoke("get_debt_plan",{currency});}
  saveDebtPlan(input:DebtPlanInput):Promise<DebtPlan>{return invoke("save_debt_plan",{request:input});}
  importTransactions(input: ImportTransactionsInput): Promise<ImportResult> { return invoke("import_transactions", { request: input }); }
  listImportBatches(): Promise<ImportBatch[]> { return invoke("list_import_batches"); }
  undoImportBatch(batchId: string): Promise<UndoImportResult> { return invoke("undo_import_batch", { batchId }); }
}

export const isNativeApp = "__TAURI_INTERNALS__" in window;
export const financeRepository: FinanceRepository = isNativeApp ? new TauriFinanceRepository() : new DemoFinanceRepository();

export interface CsvExportRepository { saveCsv(contents:string,fileName:string):Promise<boolean>; }
class TauriCsvExportRepository implements CsvExportRepository { saveCsv(contents:string,fileName:string):Promise<boolean>{return invoke("save_csv_file",{contents,fileName});} }
class BrowserCsvExportRepository implements CsvExportRepository {
  async saveCsv(contents:string,fileName:string):Promise<boolean>{
    const url=URL.createObjectURL(new Blob([contents],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");
    link.href=url;link.download=fileName;link.style.display="none";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);return true;
  }
}
export const csvExportRepository:CsvExportRepository=isNativeApp?new TauriCsvExportRepository():new BrowserCsvExportRepository();

class TauriBackupRepository implements BackupRepository {
  exportSnapshot(): Promise<string> { return invoke("export_backup_snapshot"); }
  saveEncryptedFile(contents: string): Promise<boolean> { return invoke("save_backup_file", { contents }); }
  chooseEncryptedFile(): Promise<string | null> { return invoke("choose_backup_file"); }
  restoreSnapshot(snapshotBase64: string): Promise<RestoreResult> { return invoke("restore_backup_snapshot", { snapshotBase64 }); }
  getHealth(): Promise<BackupHealth> { return invoke("get_backup_health"); }
  setRetention(retention:number): Promise<BackupHealth> { return invoke("set_recovery_retention",{retention}); }
  createRecoverySnapshot(): Promise<BackupHealth> { return invoke("create_automatic_recovery_snapshot"); }
  restoreRecoverySnapshot(fileName:string): Promise<RestoreResult> { return invoke("restore_recovery_snapshot",{fileName}); }
}

class UnavailableBackupRepository implements BackupRepository {
  private unavailable(): never { throw new Error("Encrypted backup and restore are available in the native desktop app"); }
  exportSnapshot(): Promise<string> { return Promise.reject(this.unavailable()); }
  saveEncryptedFile(): Promise<boolean> { return Promise.reject(this.unavailable()); }
  chooseEncryptedFile(): Promise<string | null> { return Promise.reject(this.unavailable()); }
  restoreSnapshot(): Promise<RestoreResult> { return Promise.reject(this.unavailable()); }
  getHealth(): Promise<BackupHealth> { return Promise.reject(this.unavailable()); }
  setRetention(): Promise<BackupHealth> { return Promise.reject(this.unavailable()); }
  createRecoverySnapshot(): Promise<BackupHealth> { return Promise.reject(this.unavailable()); }
  restoreRecoverySnapshot(): Promise<RestoreResult> { return Promise.reject(this.unavailable()); }
}

export const backupRepository: BackupRepository = isNativeApp ? new TauriBackupRepository() : new UnavailableBackupRepository();

class TauriWorkbookRepository implements WorkbookRepository {
  parseWorkbook(contentsBase64:string,fileName:string):Promise<ParsedWorkbook>{return invoke("parse_workbook",{contentsBase64,fileName});}
}

class UnavailableWorkbookRepository implements WorkbookRepository {
  parseWorkbook():Promise<ParsedWorkbook>{return Promise.reject(new Error("Excel workbook import is available in the native desktop app"));}
}

export const workbookRepository:WorkbookRepository=isNativeApp?new TauriWorkbookRepository():new UnavailableWorkbookRepository();

class TauriPdfRepository implements PdfRepository {
  extractText(contentsBase64:string,fileName:string):Promise<PdfExtraction>{return invoke("extract_pdf_text",{contentsBase64,fileName});}
}

class UnavailablePdfRepository implements PdfRepository {
  extractText():Promise<PdfExtraction>{return Promise.reject(new Error("PDF statement import is available in the native desktop app"));}
}

export const pdfRepository:PdfRepository=isNativeApp?new TauriPdfRepository():new UnavailablePdfRepository();

export interface LocalAiQuery { endpoint:string;model:string;payload:string; }
export interface LocalAiAnswer { answer:string; }
export interface CloudAiQuery { provider:"openai"|"anthropic"|"gemini";endpoint:string;model:string;payload:string;accountId:string;confirmed:boolean; }
export interface AiCredentialStatus { accountId:string;configured:boolean; }
export interface AiRepository {
  testConnection(endpoint:string):Promise<void>;
  queryLocal(input:LocalAiQuery):Promise<LocalAiAnswer>;
  queryCloud(input:CloudAiQuery):Promise<LocalAiAnswer>;
  credentialStatus(accountId:string):Promise<AiCredentialStatus>;
  saveCredential(accountId:string,secret:string):Promise<AiCredentialStatus>;
  clearCredential(accountId:string):Promise<AiCredentialStatus>;
}
class TauriAiRepository implements AiRepository {
  testConnection(endpoint:string):Promise<void>{return invoke("test_local_ai",{endpoint});}
  queryLocal(input:LocalAiQuery):Promise<LocalAiAnswer>{return invoke("query_local_ai",{request:input});}
  queryCloud(input:CloudAiQuery):Promise<LocalAiAnswer>{
    if(input.provider==="openai")return invoke("query_openai_ai",{request:{endpoint:input.endpoint,model:input.model,payload:input.payload,accountId:input.accountId,confirmed:input.confirmed}});
    if(input.provider==="anthropic")return invoke("query_anthropic_ai",{request:{endpoint:input.endpoint,model:input.model,payload:input.payload,accountId:input.accountId,confirmed:input.confirmed}});
    if(input.provider==="gemini")return invoke("query_gemini_ai",{request:{endpoint:input.endpoint,model:input.model,payload:input.payload,accountId:input.accountId,confirmed:input.confirmed}});
    return Promise.reject(new Error("Unsupported cloud AI provider"));
  }
  credentialStatus(accountId:string):Promise<AiCredentialStatus>{return invoke("ai_provider_credential_status",{accountId});}
  saveCredential(accountId:string,secret:string):Promise<AiCredentialStatus>{return invoke("set_ai_provider_credential",{accountId,secret});}
  clearCredential(accountId:string):Promise<AiCredentialStatus>{return invoke("clear_ai_provider_credential",{accountId});}
}
class UnavailableAiRepository implements AiRepository {
  testConnection():Promise<void>{return Promise.reject(new Error("Local AI connections are available in the native desktop app"));}
  queryLocal():Promise<LocalAiAnswer>{return Promise.reject(new Error("Local AI connections are available in the native desktop app"));}
  queryCloud():Promise<LocalAiAnswer>{return Promise.reject(new Error("Cloud AI analysis is available in the native desktop app"));}
  credentialStatus():Promise<AiCredentialStatus>{return Promise.reject(new Error("AI credential vault access is available in the native desktop app"));}
  saveCredential():Promise<AiCredentialStatus>{return Promise.reject(new Error("AI credential vault access is available in the native desktop app"));}
  clearCredential():Promise<AiCredentialStatus>{return Promise.reject(new Error("AI credential vault access is available in the native desktop app"));}
}
export const aiRepository:AiRepository=isNativeApp?new TauriAiRepository():new UnavailableAiRepository();
