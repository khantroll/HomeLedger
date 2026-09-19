import { reconciliationDifference, sumMoney, type Account, type CompleteReconciliationInput, type CreateAccountInput, type CreateTransactionInput, type CreateTransferInput, type FinanceRepository, type ImportBatch, type ImportProfile, type ImportProfileInput, type ImportResult, type ImportTransactionsInput, type MerchantRule, type MerchantRuleInput, type Reconciliation, type Transaction, type TransferResult, type UndoImportResult } from "./domain";
import { applyMerchantRules } from "./merchantRules";

const initialAccounts: Account[] = [
  { id: "checking", name: "Household Checking", institution: "Sample Credit Union", type: "checking", currency: "USD", balanceMinor: 428640, ownerLabel: "Household" },
  { id: "savings", name: "Emergency Savings", institution: "Sample Credit Union", type: "savings", currency: "USD", balanceMinor: 185000, ownerLabel: "Household" },
  { id: "credit", name: "Everyday Card", institution: "Sample Bank", type: "credit", currency: "USD", balanceMinor: -143826, ownerLabel: "Household", needsReview: true },
  { id: "auto", name: "Vehicle Loan", institution: "Sample Lender", type: "loan", currency: "USD", balanceMinor: -1104755, ownerLabel: "Household" }
];

const initialTransactions: Transaction[] = [
  { id: "t1", accountId: "checking", postedDate: "2026-09-18", payee: "Payroll Deposit", category: "Income: Salary", amountMinor: 240000, status: "cleared" },
  { id: "t2", accountId: "checking", postedDate: "2026-09-17", payee: "Neighborhood Market", category: "Food: Groceries", amountMinor: -12843, status: "review" },
  { id: "t3", accountId: "checking", postedDate: "2026-09-16", payee: "Electric Utility", category: "Housing: Utilities", amountMinor: -19621, status: "cleared" },
  { id: "t4", accountId: "credit", postedDate: "2026-09-15", payee: "Fuel Station", category: "Transportation: Fuel", amountMinor: -6427, status: "pending" },
  { id: "t5", accountId: "checking", postedDate: "2026-09-14", payee: "Vehicle Payment", category: "Transfer: Vehicle Loan", amountMinor: -30800, status: "reconciled" }
];

export class DemoFinanceRepository implements FinanceRepository {
  private accounts = structuredClone(initialAccounts);
  private transactions = structuredClone(initialTransactions);
  private importBatches: ImportBatch[] = [];
  private importedTransactionIds = new Map<string, string[]>();
  private reconciliations: Reconciliation[] = [];
  private reconciledTransactionIds = new Set<string>();
  private merchantRules: MerchantRule[] = [];
  private importProfiles: ImportProfile[] = [];

  async listAccounts(): Promise<Account[]> { return structuredClone(this.accounts); }
  async listTransactions(accountId?: string): Promise<Transaction[]> {
    return structuredClone(accountId ? this.transactions.filter((item) => item.accountId === accountId) : this.transactions);
  }
  async listReconciliationTransactions(accountId: string, statementEndDate: string): Promise<Transaction[]> {
    if (!this.accounts.some(item => item.id === accountId)) throw new Error("Account does not exist");
    return structuredClone(this.transactions.filter(item =>
      item.accountId === accountId && item.postedDate <= statementEndDate &&
      item.status !== "reconciled" && !this.reconciledTransactionIds.has(item.id)
    ));
  }
  async listReconciliations(accountId: string): Promise<Reconciliation[]> {
    return structuredClone(this.reconciliations.filter(item => item.accountId === accountId));
  }
  async completeReconciliation(input: CompleteReconciliationInput): Promise<Reconciliation> {
    if (!this.accounts.some(item => item.id === input.accountId)) throw new Error("Account does not exist");
    if (this.reconciliations.some(item => item.accountId === input.accountId && item.statementEndDate === input.statementEndDate)) throw new Error("This account already has a reconciliation for that statement end date");
    if (new Set(input.transactionIds).size !== input.transactionIds.length) throw new Error("A transaction was selected more than once");
    const selected = input.transactionIds.map(id => {
      const transaction = this.transactions.find(item => item.id === id);
      if (!transaction) throw new Error("A selected transaction does not exist");
      if (transaction.accountId !== input.accountId) throw new Error("Every selected transaction must belong to the reconciled account");
      if (transaction.postedDate > input.statementEndDate) throw new Error("A selected transaction is after the statement end date");
      if (transaction.status === "reconciled" || this.reconciledTransactionIds.has(id)) throw new Error("A selected transaction has already been reconciled");
      return transaction;
    });
    if (reconciliationDifference(input.openingBalanceMinor, input.closingBalanceMinor, selected) !== 0) throw new Error("Selected transactions do not match the statement closing balance");
    const reconciliation: Reconciliation = {
      id: crypto.randomUUID(), accountId: input.accountId, statementEndDate: input.statementEndDate,
      openingBalanceMinor: input.openingBalanceMinor, closingBalanceMinor: input.closingBalanceMinor,
      reconciledAt: new Date().toISOString(), transactionCount: selected.length,
      adjustmentTotalMinor: sumMoney(selected.map(item => item.amountMinor))
    };
    selected.forEach(item => { item.status = "reconciled"; this.reconciledTransactionIds.add(item.id); });
    this.reconciliations.unshift(reconciliation);
    return structuredClone(reconciliation);
  }
  async createAccount(input: CreateAccountInput): Promise<Account> {
    const account: Account = { id: crypto.randomUUID(), name: input.name, institution: input.institution, type: input.type, currency: input.currency, balanceMinor: input.openingBalanceMinor, ownerLabel: input.ownerLabel };
    this.accounts.push(account);
    return structuredClone(account);
  }
  async createTransaction(input: CreateTransactionInput): Promise<Transaction> {
    validateTransactionInput(input);
    const transaction: Transaction = { id: crypto.randomUUID(), ...input, source: "manual", splits: input.splits?.map(split=>({id:crypto.randomUUID(),...split})) };
    this.transactions.unshift(transaction);
    const account = this.accounts.find((item) => item.id === input.accountId);
    if (account) account.balanceMinor += input.amountMinor;
    return structuredClone(transaction);
  }
  async updateTransaction(id: string, input: CreateTransactionInput): Promise<Transaction> {
    validateTransactionInput(input);
    const index = this.transactions.findIndex(item=>item.id===id);
    if(index<0)throw new Error("Transaction does not exist");
    const current=this.transactions[index];
    if(this.reconciledTransactionIds.has(id))throw new Error("Reconciled transactions cannot be edited");
    if(current.transferLinkId)throw new Error("Linked transfers must be edited through the transfer editor");
    const oldAccount=this.accounts.find(item=>item.id===current.accountId);
    const newAccount=this.accounts.find(item=>item.id===input.accountId);
    if(!newAccount)throw new Error("Account does not exist");
    if(oldAccount)oldAccount.balanceMinor-=current.amountMinor;
    newAccount.balanceMinor+=input.amountMinor;
    const updated:Transaction={...current,...input,splits:input.splits?.map(split=>({id:crypto.randomUUID(),...split}))};
    this.transactions[index]=updated;
    return structuredClone(updated);
  }
  async deleteTransaction(id: string): Promise<void> {
    const index=this.transactions.findIndex(item=>item.id===id);
    if(index<0)throw new Error("Transaction does not exist");
    const transaction=this.transactions[index];
    if(this.reconciledTransactionIds.has(id))throw new Error("Reconciled transactions cannot be deleted");
    if(transaction.importBatchId)throw new Error("Imported transactions must be removed by undoing their complete import batch");
    if(transaction.transferLinkId)throw new Error("Linked transfers must be removed through the transfer editor");
    this.transactions.splice(index,1);
    const account=this.accounts.find(item=>item.id===transaction.accountId);
    if(account)account.balanceMinor-=transaction.amountMinor;
  }
  async createTransfer(input: CreateTransferInput): Promise<TransferResult> {
    validateTransferInput(input,this.accounts);
    const linkId=crypto.randomUUID(),fromTransactionId=crypto.randomUUID(),toTransactionId=crypto.randomUUID();
    const from=this.accounts.find(item=>item.id===input.fromAccountId)!,to=this.accounts.find(item=>item.id===input.toAccountId)!;
    this.transactions.unshift(
      {id:fromTransactionId,accountId:from.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${to.name}`,amountMinor:-input.amountMinor,status:input.status,memo:input.memo,source:"transfer",transferLinkId:linkId,transferAccountId:to.id},
      {id:toTransactionId,accountId:to.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${from.name}`,amountMinor:input.amountMinor,status:input.status,memo:input.memo,source:"transfer",transferLinkId:linkId,transferAccountId:from.id}
    );
    from.balanceMinor-=input.amountMinor;to.balanceMinor+=input.amountMinor;
    return{linkId,fromTransactionId,toTransactionId};
  }
  async updateTransfer(id:string,input:CreateTransferInput):Promise<TransferResult>{
    validateTransferInput(input,this.accounts);
    const pair=this.transactions.filter(item=>item.transferLinkId===id);
    if(pair.length!==2)throw new Error("Transfer does not exist or is incomplete");
    if(pair.some(item=>this.reconciledTransactionIds.has(item.id)))throw new Error("A reconciled transfer cannot be edited");
    for(const item of pair){const account=this.accounts.find(account=>account.id===item.accountId);if(account)account.balanceMinor-=item.amountMinor;}
    const from=this.accounts.find(item=>item.id===input.fromAccountId)!,to=this.accounts.find(item=>item.id===input.toAccountId)!;
    const outgoing=pair.find(item=>item.amountMinor<0)??pair[0],incoming=pair.find(item=>item.amountMinor>0)??pair[1];
    Object.assign(outgoing,{accountId:from.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${to.name}`,amountMinor:-input.amountMinor,status:input.status,memo:input.memo,transferAccountId:to.id});
    Object.assign(incoming,{accountId:to.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${from.name}`,amountMinor:input.amountMinor,status:input.status,memo:input.memo,transferAccountId:from.id});
    from.balanceMinor-=input.amountMinor;to.balanceMinor+=input.amountMinor;
    return{linkId:id,fromTransactionId:outgoing.id,toTransactionId:incoming.id};
  }
  async deleteTransfer(id:string):Promise<void>{
    const pair=this.transactions.filter(item=>item.transferLinkId===id);
    if(pair.length!==2)throw new Error("Transfer does not exist or is incomplete");
    if(pair.some(item=>this.reconciledTransactionIds.has(item.id)))throw new Error("A reconciled transfer cannot be deleted");
    for(const item of pair){const account=this.accounts.find(account=>account.id===item.accountId);if(account)account.balanceMinor-=item.amountMinor;}
    this.transactions=this.transactions.filter(item=>item.transferLinkId!==id);
  }
  async listMerchantRules():Promise<MerchantRule[]>{return structuredClone([...this.merchantRules].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)));}
  async createMerchantRule(input:MerchantRuleInput):Promise<MerchantRule>{validateMerchantRule(input);const rule={id:crypto.randomUUID(),...input};this.merchantRules.push(rule);return structuredClone(rule);}
  async updateMerchantRule(id:string,input:MerchantRuleInput):Promise<MerchantRule>{validateMerchantRule(input);const index=this.merchantRules.findIndex(item=>item.id===id);if(index<0)throw new Error("Merchant rule does not exist");const rule={id,...input};this.merchantRules[index]=rule;return structuredClone(rule);}
  async deleteMerchantRule(id:string):Promise<void>{const index=this.merchantRules.findIndex(item=>item.id===id);if(index<0)throw new Error("Merchant rule does not exist");this.merchantRules.splice(index,1);}
  async listImportProfiles():Promise<ImportProfile[]>{return structuredClone(this.importProfiles);}
  async saveImportProfile(input:ImportProfileInput):Promise<ImportProfile>{validateImportProfile(input,this.accounts);const existing=this.importProfiles.find(item=>item.name===input.name&&item.headerSignature===input.headerSignature);const profile={id:existing?.id??crypto.randomUUID(),...input};if(existing)this.importProfiles[this.importProfiles.indexOf(existing)]=profile;else this.importProfiles.unshift(profile);return structuredClone(profile);}
  async deleteImportProfile(id:string):Promise<void>{const index=this.importProfiles.findIndex(item=>item.id===id);if(index<0)throw new Error("Import profile does not exist");this.importProfiles.splice(index,1);}
  async importTransactions(input: ImportTransactionsInput): Promise<ImportResult> {
    const account = this.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("Account does not exist");
    const batchId = crypto.randomUUID();
    const prepared=applyMerchantRules(input.rows,this.merchantRules).map(item=>item.row);
    const imported = prepared.map(row => ({
      id: crypto.randomUUID(), accountId: input.accountId, postedDate: row.postedDate, payee: row.payee,
      category: row.category ?? "Uncategorized", amountMinor: row.amountMinor, status: "review" as const,
      memo: row.memo, externalId: row.externalId, originalPayee: row.originalPayee,
      splits: row.splits?.map(split => ({ id: crypto.randomUUID(), category: split.category, amountMinor: split.amountMinor, memo: split.memo })),
      source: "import" as const, importBatchId: batchId
    }));
    this.transactions.unshift(...imported);
    account.balanceMinor += imported.reduce((total, row) => total + row.amountMinor, 0);
    this.importBatches.unshift({ id: batchId, accountId: account.id, accountName: account.name, sourceName: input.sourceName, importedAt: new Date().toISOString(), transactionCount: imported.length, totalMinor: imported.reduce((total, row) => total + row.amountMinor, 0) });
    this.importedTransactionIds.set(batchId, imported.map(row => row.id));
    return { batchId, importedCount: imported.length };
  }
  async listImportBatches(): Promise<ImportBatch[]> { return structuredClone(this.importBatches); }
  async undoImportBatch(batchId: string): Promise<UndoImportResult> {
    const batch = this.importBatches.find(item => item.id === batchId);
    if (!batch) throw new Error("Import batch does not exist");
    if (batch.undoneAt) throw new Error("This import has already been undone");
    const ids = new Set(this.importedTransactionIds.get(batchId) ?? []);
    if([...ids].some(id=>this.reconciledTransactionIds.has(id)))throw new Error("This import contains reconciled transactions and cannot be undone");
    const removed = this.transactions.filter(item => ids.has(item.id));
    this.transactions = this.transactions.filter(item => !ids.has(item.id));
    const account = this.accounts.find(item => item.id === batch.accountId);
    if (account) account.balanceMinor -= removed.reduce((total, row) => total + row.amountMinor, 0);
    batch.undoneAt = new Date().toISOString();
    return { batchId, removedCount: removed.length };
  }
}

function validateTransactionInput(input:CreateTransactionInput){
  if(input.status==="reconciled")throw new Error("Transactions are marked reconciled through account reconciliation");
  if(!input.splits?.length)return;
  if(input.splits.length<2)throw new Error("A split transaction requires at least two splits");
  if(input.splits.some(split=>!split.category.trim()||split.amountMinor===0))throw new Error("Every split needs a category and non-zero amount");
  if(sumMoney(input.splits.map(split=>split.amountMinor))!==input.amountMinor)throw new Error("Split total does not equal the transaction amount");
}

function validateTransferInput(input:CreateTransferInput,accounts:Account[]){
  if(input.status==="reconciled")throw new Error("Transfers are marked reconciled through account reconciliation");
  if(input.fromAccountId===input.toAccountId)throw new Error("Choose two different accounts");
  if(input.amountMinor<=0)throw new Error("Transfer amount must be greater than zero");
  const from=accounts.find(item=>item.id===input.fromAccountId),to=accounts.find(item=>item.id===input.toAccountId);
  if(!from||!to)throw new Error("Transfer account does not exist");
  if(from.currency!==to.currency)throw new Error("Transfers between different currencies are not supported yet");
}

function validateMerchantRule(input:MerchantRuleInput){
  if(!input.name.trim())throw new Error("Rule name is required");
  if(!input.pattern.trim())throw new Error("Match text is required");
  if(!input.renameTo?.trim()&&!input.category?.trim())throw new Error("A rule must rename the payee, assign a category, or both");
  if(!Number.isInteger(input.priority)||input.priority < -10000||input.priority > 10000)throw new Error("Priority must be a whole number between -10000 and 10000");
}

function validateImportProfile(input:ImportProfileInput,accounts:Account[]){
  if(!input.name.trim())throw new Error("Profile name is required");
  if(!input.headerSignature.trim())throw new Error("Header signature is required");
  if(input.accountId&&!accounts.some(account=>account.id===input.accountId))throw new Error("Profile account does not exist");
  if(input.dateColumn<0||input.payeeColumn<0)throw new Error("Date and description columns are required");
  if(input.amountColumn<0&&input.debitColumn<0&&input.creditColumn<0)throw new Error("An amount or debit/credit column is required");
  if(!["mdy","dmy"].includes(input.dateOrder)||!["dot","comma"].includes(input.numberFormat))throw new Error("Import profile locale settings are invalid");
}
