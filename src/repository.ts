import { invoke } from "@tauri-apps/api/core";
import { DemoFinanceRepository } from "./demoRepository";
import type { Account, BackupRepository, CompleteReconciliationInput, CreateAccountInput, CreateTransactionInput, CreateTransferInput, FinanceRepository, ImportBatch, ImportProfile, ImportProfileInput, ImportResult, ImportTransactionsInput, MerchantRule, MerchantRuleInput, Reconciliation, RestoreResult, Transaction, TransferResult, UndoImportResult } from "./domain";

class TauriFinanceRepository implements FinanceRepository {
  listAccounts(): Promise<Account[]> { return invoke("list_accounts"); }
  listTransactions(accountId?: string): Promise<Transaction[]> { return invoke("list_transactions", { accountId: accountId ?? null }); }
  listReconciliationTransactions(accountId: string, statementEndDate: string): Promise<Transaction[]> { return invoke("list_reconciliation_transactions", { accountId, statementEndDate }); }
  listReconciliations(accountId: string): Promise<Reconciliation[]> { return invoke("list_reconciliations", { accountId }); }
  completeReconciliation(input: CompleteReconciliationInput): Promise<Reconciliation> { return invoke("complete_reconciliation", { request: input }); }
  createAccount(input: CreateAccountInput): Promise<Account> { return invoke("create_account", { request: input }); }
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
  importTransactions(input: ImportTransactionsInput): Promise<ImportResult> { return invoke("import_transactions", { request: input }); }
  listImportBatches(): Promise<ImportBatch[]> { return invoke("list_import_batches"); }
  undoImportBatch(batchId: string): Promise<UndoImportResult> { return invoke("undo_import_batch", { batchId }); }
}

export const isNativeApp = "__TAURI_INTERNALS__" in window;
export const financeRepository: FinanceRepository = isNativeApp ? new TauriFinanceRepository() : new DemoFinanceRepository();

class TauriBackupRepository implements BackupRepository {
  exportSnapshot(): Promise<string> { return invoke("export_backup_snapshot"); }
  saveEncryptedFile(contents: string): Promise<boolean> { return invoke("save_backup_file", { contents }); }
  chooseEncryptedFile(): Promise<string | null> { return invoke("choose_backup_file"); }
  restoreSnapshot(snapshotBase64: string): Promise<RestoreResult> { return invoke("restore_backup_snapshot", { snapshotBase64 }); }
}

class UnavailableBackupRepository implements BackupRepository {
  private unavailable(): never { throw new Error("Encrypted backup and restore are available in the native desktop app"); }
  exportSnapshot(): Promise<string> { return Promise.reject(this.unavailable()); }
  saveEncryptedFile(): Promise<boolean> { return Promise.reject(this.unavailable()); }
  chooseEncryptedFile(): Promise<string | null> { return Promise.reject(this.unavailable()); }
  restoreSnapshot(): Promise<RestoreResult> { return Promise.reject(this.unavailable()); }
}

export const backupRepository: BackupRepository = isNativeApp ? new TauriBackupRepository() : new UnavailableBackupRepository();
