export type AccountType = "checking" | "savings" | "credit" | "cash" | "loan" | "asset" | "investment";
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
  sortOrder?: number;
  archived?: boolean;
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

/** Default register page size; large enough for daily use, small enough to stay responsive. */
export const REGISTER_PAGE_SIZE = 100;
/** Hard ceiling for a single page request so clients cannot ask for unbounded windows. */
export const REGISTER_PAGE_SIZE_MAX = 500;

export type TransactionStatusFilter = TransactionStatus | "all";

export interface TransactionQuery {
  accountId?: string;
  /** Chronological offset from the oldest matching row (0 = oldest). */
  offset?: number;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  status?: TransactionStatusFilter;
  search?: string;
  /**
   * When true, ignore `offset` and return the newest matching window
   * (still ordered oldest→newest within the page for running balances).
   */
  newest?: boolean;
}

export interface TransactionPage {
  transactions: Transaction[];
  totalCount: number;
  offset: number;
  limit: number;
  /**
   * True ledger balance immediately before the first returned row:
   * opening balance plus every account transaction that sorts earlier.
   * Present when `accountId` is set. Meaningful for the Balance column only when
   * the query is contiguous (status=all and no search); date filters remain contiguous.
   */
  priorBalanceMinor?: number;
}

export interface FinanceRepository {
  listAccounts(includeArchived?: boolean): Promise<Account[]>;
  listCategories(): Promise<string[]>;
  listPayees(): Promise<string[]>;
  renameCategory(from: string, to: string): Promise<LabelRewriteResult>;
  mergeCategories(from: string, into: string): Promise<LabelRewriteResult>;
  removeUnusedCategory(name: string): Promise<void>;
  renamePayee(from: string, to: string): Promise<LabelRewriteResult>;
  mergePayees(from: string, into: string): Promise<LabelRewriteResult>;
  removeUnusedPayee(name: string): Promise<void>;
  listTransactions(accountId?: string): Promise<Transaction[]>;
  listTransactionsPage(query?: TransactionQuery): Promise<TransactionPage>;
  listReconciliationTransactions(accountId: string, statementEndDate: string): Promise<Transaction[]>;
  listReconciliations(accountId: string): Promise<Reconciliation[]>;
  completeReconciliation(input: CompleteReconciliationInput): Promise<Reconciliation>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  updateAccount(id: string, input: UpdateAccountInput): Promise<Account>;
  setAccountArchived(id: string, archived: boolean): Promise<void>;
  reorderAccounts(accountIds: string[]): Promise<void>;
  createTransaction(input: CreateTransactionInput): Promise<Transaction>;
  updateTransaction(id: string, input: CreateTransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  createTransfer(input: CreateTransferInput): Promise<TransferResult>;
  updateTransfer(id: string, input: CreateTransferInput): Promise<TransferResult>;
  deleteTransfer(id: string): Promise<void>;
  createOrdinaryInvestmentCashTransfer(input: CreateTransferInput): Promise<CrossDomainCashTransferResult>;
  updateOrdinaryInvestmentCashTransfer(id: string, input: CreateTransferInput): Promise<CrossDomainCashTransferResult>;
  deleteOrdinaryInvestmentCashTransfer(id: string): Promise<void>;
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
  processScheduledAutoPost(input: ScheduledAutoPostInput): Promise<ScheduledPostResult>;
  skipScheduledOccurrence(id: string): Promise<ScheduledOccurrence>;
  linkScheduledOccurrence(id: string, transactionId: string): Promise<ScheduledOccurrence>;
  findScheduledOccurrenceMatches(input: ScheduledImportMatchInput): Promise<ScheduledImportMatch[]>;
  listBudgetCategories(): Promise<BudgetCategory[]>;
  createBudgetCategory(input: BudgetCategoryInput): Promise<BudgetCategory>;
  updateBudgetCategory(id: string, input: BudgetCategoryInput): Promise<BudgetCategory>;
  deleteBudgetCategory(id: string): Promise<void>;
  setBudgetAllocation(input: BudgetAllocationInput): Promise<void>;
  getBudgetMonth(month: string): Promise<BudgetMonth>;
  listSavingsGoals(): Promise<SavingsGoal[]>;
  createSavingsGoal(input: SavingsGoalInput): Promise<SavingsGoal>;
  updateSavingsGoal(id: string,input: SavingsGoalInput): Promise<SavingsGoal>;
  deleteSavingsGoal(id: string): Promise<void>;
  getDebtPlan(currency: string): Promise<DebtPlan>;
  saveDebtPlan(input: DebtPlanInput): Promise<DebtPlan>;
  importTransactions(input: ImportTransactionsInput): Promise<ImportResult>;
  listImportBatches(): Promise<ImportBatch[]>;
  undoImportBatch(batchId: string): Promise<UndoImportResult>;
}

/** Result of an atomic category/payee rename or merge across ledger surfaces. */
export interface LabelRewriteResult {
  from: string;
  to: string;
  operation: "rename" | "merge" | string;
  transactions: number;
  splits: number;
  schedules: number;
  budgetCategories: number;
  merchantRules: number;
  catalogRemoved: boolean;
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
  autoPost?: boolean;
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

export interface ScheduledAutoPostInput {
  occurrenceIds: string[];
  asOfDate: string;
}

export interface ScheduledPostResult {
  postedCount: number;
}

export interface BudgetCategory {
  id: string;
  category: string;
  rolloverEnabled: boolean;
}

export type BudgetCategoryInput = Omit<BudgetCategory,"id">;

export interface BudgetAllocation {
  budgetCategoryId: string;
  month: string;
  plannedMinor: number;
}

export type BudgetAllocationInput = BudgetAllocation;

export interface BudgetMonthLine extends BudgetCategory {
  plannedMinor: number;
  spentMinor: number;
  carryInMinor: number;
  availableMinor: number;
}

export interface BudgetMonth {
  month: string;
  plannedMinor: number;
  spentMinor: number;
  carryInMinor: number;
  availableMinor: number;
  lines: BudgetMonthLine[];
}

export interface SavingsGoal {
  id: string;
  name: string;
  accountId: string;
  targetMinor: number;
  targetDate: string;
  plannedMonthlyMinor: number;
}

export type SavingsGoalInput = Omit<SavingsGoal,"id">;

export type DebtStrategy = "snowball"|"avalanche"|"custom";

export interface DebtTerm {
  accountId: string;
  annualRateBps: number;
  minimumPaymentMinor: number;
  customPriority: number;
  enabled: boolean;
}

export interface DebtPlan {
  currency: string;
  strategy: DebtStrategy;
  extraPaymentMinor: number;
  terms: DebtTerm[];
}

export type DebtPlanInput = DebtPlan;

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

export interface RecoverySnapshotInfo {
  fileName: string;
  createdAt: string;
  reason: "automatic" | "pre-migration";
  schemaVersion: number;
  sizeBytes: number;
}

export interface BackupHealth {
  lastSuccessfulAt?: string;
  lastReason?: string;
  lastError?: string;
  retention: number;
  snapshots: RecoverySnapshotInfo[];
}

export interface BackupRepository {
  exportSnapshot(): Promise<string>;
  saveEncryptedFile(contents: string): Promise<boolean>;
  chooseEncryptedFile(): Promise<string | null>;
  restoreSnapshot(snapshotBase64: string): Promise<RestoreResult>;
  getHealth(): Promise<BackupHealth>;
  setRetention(retention: number): Promise<BackupHealth>;
  createRecoverySnapshot(): Promise<BackupHealth>;
  restoreRecoverySnapshot(fileName: string): Promise<RestoreResult>;
}

export interface CreateAccountInput {
  name: string;
  institution?: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  ownerLabel: string;
}

export type UpdateAccountInput = Omit<CreateAccountInput, "openingBalanceMinor">;

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

export interface CrossDomainCashTransferResult {
  linkId: string;
  ordinaryTransactionId: string;
  investmentEventId: string;
  direction: "ordinary_to_investment" | "investment_to_ordinary" | string;
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
  sourceKind: "delimited"|"workbook"|"pdf"|"ocr";
  sourceSignature?: string;
  pdfLayout?: "signed-last"|"signed-before-balance"|"expenses-last"|"expenses-before-balance";
  workbookSheetName?: string;
  workbookHeaderRow?: number;
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

export function runningBalances(openingMinor: number, transactions: readonly Pick<Transaction, "amountMinor">[]): number[] {
  let running = openingMinor;
  return transactions.map((transaction) => (running = sumMoney([running, transaction.amountMinor])));
}

/** Normalize a register page request before calling the repository. */
export function normalizeTransactionQuery(query: TransactionQuery = {}): Required<Pick<TransactionQuery, "offset" | "limit" | "newest">> & TransactionQuery {
  const limit = Math.min(REGISTER_PAGE_SIZE_MAX, Math.max(1, Math.trunc(query.limit ?? REGISTER_PAGE_SIZE)));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  return { ...query, offset, limit, newest: Boolean(query.newest) };
}

export function reconciliationBalance(openingMinor: number, transactions: readonly Pick<Transaction, "amountMinor">[]): number {
  return sumMoney([openingMinor, ...transactions.map((transaction) => transaction.amountMinor)]);
}

export function reconciliationDifference(openingMinor: number, closingMinor: number, transactions: readonly Pick<Transaction, "amountMinor">[]): number {
  return sumMoney([closingMinor, -reconciliationBalance(openingMinor, transactions)]);
}


// Portfolio Foundation domain. Investment arithmetic is authoritative in Rust; *_E8 values are exact 8-decimal fixed-point integers.
export type InvestmentAccountKind="brokerage"|"retirement"|"education"|"other";
export type InvestmentTaxTreatment="taxable"|"tax_deferred"|"tax_exempt"|"unknown";
export type SecurityType="stock"|"etf"|"mutual_fund"|"bond"|"cash_equivalent"|"other";
export type InvestmentEventType="buy"|"sell"|"dividend"|"reinvest_dividend"|"interest"|"fee"|"split"|"return_of_capital"|"cash_transfer"|"security_transfer"|"opening_position"|"basis_adjustment";
export type InvestmentEventSource="manual"|"import"|"broker";
export interface InvestmentAccountSettings{accountId:string;accountKind:InvestmentAccountKind;taxTreatment:InvestmentTaxTreatment;defaultLotMethod:"fifo";openingCashMinor:number;openingDate:string;}
export interface CreateInvestmentAccountInput{name:string;institution?:string;currency:string;ownerLabel:string;openingCashMinor:number;openingDate:string;accountKind:InvestmentAccountKind;taxTreatment:InvestmentTaxTreatment;}
export interface Security{id:string;securityType:SecurityType;name:string;symbol?:string;exchangeMic?:string;currency:string;archived:boolean;}
export type SecurityInput=Omit<Security,"id"|"archived">;
export interface SecurityIdentifier{securityId:string;namespace:string;value:string;}
export interface InvestmentEventInput{accountId:string;eventType:InvestmentEventType;tradeDate:string;settlementDate?:string;acquisitionDate?:string;securityId?:string;relatedAccountId?:string;quantityE8?:number;unitPriceE8?:number;grossCashMinor?:number;cashEffectMinor:number;incomeMinor:number;acquisitionFundingMinor:number;feeMinor:number;basisEffectMinor:number;splitNumerator?:number;splitDenominator?:number;status:TransactionStatus;source:InvestmentEventSource;memo?:string;externalId?:string;provenance?:string;groupId?:string;}
export interface InvestmentEventRevision extends InvestmentEventInput{id:string;eventId:string;revisionNumber:number;supersedesRevisionId?:string;correctionReason?:string;}
export interface LotAllocation{acquisitionEventId:string;quantityE8:number;}
export interface SecurityPrice{id:string;securityId:string;observedAt:string;priceE8:number;currency:string;source:"manual"|"import"|"market_provider";provenance?:string;}
export interface SecurityPriceInput{securityId:string;observedAt:string;priceE8:number;currency:string;provenance?:string;}
export interface RealizedResult{knownBasisQuantityE8:number;knownDisposedBasisMinor:number;calculableProceedsMinor:number;calculableGainMinor:number;unknownBasisQuantityE8:number;unknownBasisProceedsMinor:number;incompleteUnknownBasis:boolean;}
export interface LotSnapshot{acquisitionEventId:string;acquisitionDate?:string;quantityE8:number;basisMinor?:number;}
export interface HoldingSnapshot{accountId:string;securityId:string;quantityE8:number;knownBasisMinor:number;unknownBasisQuantityE8:number;priceE8?:number;priceObservedAt?:string;marketValueMinor?:number;unrealizedGainMinor?:number;incompleteUnknownBasis:boolean;lots:LotSnapshot[];realized:RealizedResult;}
export interface PortfolioAccountSnapshot{accountId:string;cashMinor:number;holdingsValueMinor?:number;totalValueMinor?:number;holdings:HoldingSnapshot[];}
export interface PortfolioSnapshot{asOfDate:string;accounts:PortfolioAccountSnapshot[];}
export interface InvestmentRepository{
 createInvestmentAccount(input:CreateInvestmentAccountInput):Promise<InvestmentAccountSettings>;
 getInvestmentAccountSettings(accountId:string):Promise<InvestmentAccountSettings|undefined>;
 saveInvestmentAccountSettings(input:InvestmentAccountSettings):Promise<InvestmentAccountSettings>;
 listSecurities(includeArchived?:boolean):Promise<Security[]>;createSecurity(input:SecurityInput):Promise<Security>;updateSecurity(id:string,input:SecurityInput):Promise<Security>;setSecurityArchived(id:string,archived:boolean):Promise<void>;
 addSecurityIdentifier(securityId:string,namespace:string,value:string):Promise<SecurityIdentifier>;listSecurityIdentifiers(securityId:string):Promise<SecurityIdentifier[]>;removeSecurityIdentifier(securityId:string,namespace:string,value:string):Promise<void>;
 createInvestmentEvent(input:InvestmentEventInput):Promise<InvestmentEventRevision>;updatePendingInvestmentEvent(eventId:string,input:InvestmentEventInput):Promise<InvestmentEventRevision>;correctHistoricalInvestmentEvent(eventId:string,replacement:InvestmentEventInput,reason:string):Promise<InvestmentEventRevision>;getInvestmentEventHistory(eventId:string):Promise<InvestmentEventRevision[]>;listInvestmentEvents(accountId:string,fromDate?:string,toDate?:string):Promise<InvestmentEventRevision[]>;
 setSpecificLotAllocations(saleEventId:string,allocations:LotAllocation[]):Promise<void>;deriveInvestmentHoldings(accountId:string,asOfDate:string):Promise<HoldingSnapshot[]>;calculatePortfolioSnapshot(accountIds:string[]|undefined,asOfDate:string):Promise<PortfolioSnapshot>;
 addManualSecurityPrice(input:SecurityPriceInput):Promise<SecurityPrice>;addMarketProviderSecurityPrice(input:SecurityPriceInput):Promise<SecurityPrice>;deleteManualSecurityPrice(priceId:string):Promise<void>;listSecurityPrices(securityId:string,fromDate?:string,toDate?:string):Promise<SecurityPrice[]>;
}
