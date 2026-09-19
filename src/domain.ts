export type AccountType = "checking" | "savings" | "credit" | "cash" | "loan" | "asset";
export type TransactionStatus = "pending" | "cleared" | "reconciled" | "review";
export type ScheduledTemplateKind = "transaction" | "transfer";
export type RecurrenceFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "annual" | "custom";
export type CustomIntervalUnit = "days" | "weeks" | "months" | "years";
export type ScheduledOccurrenceStatus = "expected" | "posted" | "skipped" | "linked";

export interface Account {
  id: string;
  name: string;
  institution?: string;
  type: AccountType;
  currency: string;
  balanceMinor: number;
  ownerLabel: string;
  needsReview?: boolean;
}

export interface TransactionSplit {
  id: string;
  category: string;
  amountMinor: number;
  memo?: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  postedDate: string;
  payee: string;
  originalPayee?: string;
  category: string;
  amountMinor: number;
  status: TransactionStatus;
  memo?: string;
  externalId?: string;
  splits?: TransactionSplit[];
  source?: "manual" | "import" | "transfer" | "adjustment";
  importBatchId?: string;
  transferLinkId?: string;
  transferAccountId?: string;
}

export interface FinanceRepository {
  listAccounts(): Promise<Account[]>;
  listTransactions(accountId?: string): Promise<Transaction[]>;
  listReconciliationTransactions(accountId: string, statementEndDate: string): Promise<Transaction[]>;
  listReconciliations(accountId: string): Promise<Reconciliation[]>;
  completeReconciliation(input: CompleteReconciliationInput): Promise<Reconciliation>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  createTransaction(input: CreateTransactionInput): Promise<Transaction>;
  updateTransaction(id: string, input: CreateTransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  createTransfer(input: CreateTransferInput): Promise<TransferResult>;
  updateTransfer(id: string, input: CreateTransferInput): Promise<TransferResult>;
  deleteTransfer(id: string): Promise<void>;
  listMerchantRules(): Promise<MerchantRule[]>;
  createMerchantRule(input: MerchantRuleInput): Promise<MerchantRule>;
  updateMerchantRule(id: string, input: MerchantRuleInput): Promise<MerchantRule>;
  deleteMerchantRule(id: string): Promise<void>;
  listImportProfiles(): Promise<ImportProfile[]>;
  saveImportProfile(input: ImportProfileInput): Promise<ImportProfile>;
  deleteImportProfile(id: string): Promise<void>;
  listScheduledTransactions(): Promise<ScheduledTransaction[]>;
  createScheduledTransaction(input: ScheduledTransactionInput): Promise<ScheduledTransaction>;
  updateScheduledTransaction(id: string, input: ScheduledTransactionInput): Promise<ScheduledTransaction>;
  deleteScheduledTransaction(id: string): Promise<void>;
  generateScheduledOccurrences(input: ScheduledOccurrenceQuery): Promise<number>;
  listScheduledOccurrences(input: ScheduledOccurrenceQuery): Promise<ScheduledOccurrence[]>;
  postScheduledOccurrence(id: string): Promise<Transaction>;
  skipScheduledOccurrence(id: string): Promise<ScheduledOccurrence>;
  linkScheduledOccurrence(id: string, transactionId: string): Promise<ScheduledOccurrence>;
  findScheduledOccurrenceMatches(input: ScheduledImportMatchInput): Promise<ScheduledImportMatch[]>;
  importTransactions(input: ImportTransactionsInput): Promise<ImportResult>;
  listImportBatches(): Promise<ImportBatch[]>;
  undoImportBatch(batchId: string): Promise<UndoImportResult>;
}

export interface ScheduledTransaction {
  id: string;
  kind: ScheduledTemplateKind;
  accountId: string;
  transferAccountId?: string;
  payee: string;
  category: string;
  amountMinor: number;
  status: Exclude<TransactionStatus, "reconciled">;
  memo?: string;
  frequency: RecurrenceFrequency;
  anchorDate: string;
  endDate?: string;
  secondMonthDay?: number;
  customIntervalCount?: number;
  customIntervalUnit?: CustomIntervalUnit;
  enabled: boolean;
  archived?: boolean;
}

export type ScheduledTransactionInput = Omit<ScheduledTransaction, "id"|"archived">;

export interface ScheduledOccurrence {
  id: string;
  scheduledTransactionId: string;
  dueDate: string;
  status: ScheduledOccurrenceStatus;
  transactionId?: string;
}

export interface ScheduledOccurrenceQuery {
  fromDate: string;
  toDate: string;
  scheduledTransactionId?: string;
}

export interface Reconciliation {
  id: string;
  accountId: string;
  statementEndDate: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  reconciledAt: string;
  transactionCount: number;
  adjustmentTotalMinor: number;
}

export interface CompleteReconciliationInput {
  accountId: string;
  statementEndDate: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  transactionIds: string[];
}

export interface ImportTransactionRow {
  postedDate: string;
  payee: string;
  originalPayee?: string;
  amountMinor: number;
  memo?: string;
  externalId?: string;
  category?: string;
  splits?: ImportTransactionSplit[];
  scheduledOccurrenceId?: string;
}

export type ScheduledMatchConfidence = "exact" | "probable" | "possible";

export interface ScheduledMatchCandidate {
  occurrenceId: string;
  scheduledTransactionId: string;
  payee: string;
  dueDate: string;
  amountMinor: number;
  confidence: ScheduledMatchConfidence;
  score: number;
  reasons: string[];
  dateDifferenceDays: number;
  amountDifferenceMinor: number;
}

export interface ScheduledImportMatch {
  sourceRow: number;
  candidates: ScheduledMatchCandidate[];
}

export interface ScheduledImportMatchInput {
  accountId: string;
  rows: Array<ImportTransactionRow & {sourceRow:number}>;
}

export interface ImportTransactionSplit {
  category: string;
  amountMinor: number;
  memo?: string;
}

export interface ImportTransactionsInput {
  accountId: string;
  sourceName: string;
  rows: ImportTransactionRow[];
}

export interface ImportResult {
  batchId: string;
  importedCount: number;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  accountName: string;
  sourceName: string;
  importedAt: string;
  undoneAt?: string;
  transactionCount: number;
  totalMinor: number;
}

export interface UndoImportResult {
  batchId: string;
  removedCount: number;
}

export interface RestoreResult {
  accountCount: number;
  transactionCount: number;
}

export interface BackupRepository {
  exportSnapshot(): Promise<string>;
  saveEncryptedFile(contents: string): Promise<boolean>;
  chooseEncryptedFile(): Promise<string | null>;
  restoreSnapshot(snapshotBase64: string): Promise<RestoreResult>;
}

export interface CreateAccountInput {
  name: string;
  institution?: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  ownerLabel: string;
}

export interface CreateTransactionInput {
  accountId: string;
  postedDate: string;
  payee: string;
  category: string;
  amountMinor: number;
  status: TransactionStatus;
  memo?: string;
  splits?: CreateTransactionSplit[];
}

export interface CreateTransactionSplit {
  category: string;
  amountMinor: number;
  memo?: string;
}

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  postedDate: string;
  payee: string;
  amountMinor: number;
  status: TransactionStatus;
  memo?: string;
}

export interface TransferResult {
  linkId: string;
  fromTransactionId: string;
  toTransactionId: string;
}

export type MerchantRuleMatchType = "contains" | "starts_with" | "exact";
export type MerchantRuleDirection = "any" | "expense" | "income";

export interface MerchantRule {
  id: string;
  name: string;
  pattern: string;
  matchType: MerchantRuleMatchType;
  direction: MerchantRuleDirection;
  renameTo?: string;
  category?: string;
  priority: number;
  enabled: boolean;
}

export type MerchantRuleInput = Omit<MerchantRule,"id">;

export interface ImportProfile {
  id: string;
  name: string;
  accountId?: string;
  headerSignature: string;
  dateColumn: number;
  payeeColumn: number;
  amountColumn: number;
  debitColumn: number;
  creditColumn: number;
  dateOrder: "mdy"|"dmy";
  numberFormat: "dot"|"comma";
}

export type ImportProfileInput = Omit<ImportProfile,"id">;
export function formatMoney(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export function parseMoney(value: string): number {
  const normalized = value.trim().replaceAll(",", "").replace(/^\$/, "");
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("Enter a valid amount with no more than two decimal places");
  const [, sign, whole, fraction = ""] = match;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Amount is too large");
  return sign === "-" ? -minor : minor;
}

export function sumMoney(values: readonly number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value)) throw new Error("Money values must be safe integers");
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new Error("Money total exceeds safe integer range");
    return next;
  }, 0);
}

export function validateSplits(transaction: Pick<Transaction, "amountMinor" | "splits">): boolean {
  if (!transaction.splits?.length) return true;
  return sumMoney(transaction.splits.map((split) => split.amountMinor)) === transaction.amountMinor;
}

export function runningBalances(openingMinor: number, transactions: readonly Transaction[]): number[] {
  let running = openingMinor;
  return transactions.map((transaction) => (running = sumMoney([running, transaction.amountMinor])));
}

export function reconciliationBalance(openingMinor: number, transactions: readonly Pick<Transaction, "amountMinor">[]): number {
  return sumMoney([openingMinor, ...transactions.map((transaction) => transaction.amountMinor)]);
}

export function reconciliationDifference(openingMinor: number, closingMinor: number, transactions: readonly Pick<Transaction, "amountMinor">[]): number {
  return sumMoney([closingMinor, -reconciliationBalance(openingMinor, transactions)]);
}
