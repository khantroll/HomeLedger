import { sumMoney, type Account, type CreateAccountInput, type CreateTransactionInput, type CreateTransferInput, type FinanceRepository, type ImportBatch, type ImportResult, type ImportTransactionsInput, type Transaction, type TransferResult, type UndoImportResult } from "./domain";

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

  async listAccounts(): Promise<Account[]> { return structuredClone(this.accounts); }
  async listTransactions(accountId?: string): Promise<Transaction[]> {
    return structuredClone(accountId ? this.transactions.filter((item) => item.accountId === accountId) : this.transactions);
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
    for(const item of pair){const account=this.accounts.find(account=>account.id===item.accountId);if(account)account.balanceMinor-=item.amountMinor;}
    this.transactions=this.transactions.filter(item=>item.transferLinkId!==id);
  }
  async importTransactions(input: ImportTransactionsInput): Promise<ImportResult> {
    const account = this.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("Account does not exist");
    const batchId = crypto.randomUUID();
    const imported = input.rows.map(row => ({
      id: crypto.randomUUID(), accountId: input.accountId, postedDate: row.postedDate, payee: row.payee,
      category: row.category ?? "Uncategorized", amountMinor: row.amountMinor, status: "review" as const,
      memo: row.memo, externalId: row.externalId,
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
    const removed = this.transactions.filter(item => ids.has(item.id));
    this.transactions = this.transactions.filter(item => !ids.has(item.id));
    const account = this.accounts.find(item => item.id === batch.accountId);
    if (account) account.balanceMinor -= removed.reduce((total, row) => total + row.amountMinor, 0);
    batch.undoneAt = new Date().toISOString();
    return { batchId, removedCount: removed.length };
  }
}

function validateTransactionInput(input:CreateTransactionInput){
  if(!input.splits?.length)return;
  if(input.splits.length<2)throw new Error("A split transaction requires at least two splits");
  if(input.splits.some(split=>!split.category.trim()||split.amountMinor===0))throw new Error("Every split needs a category and non-zero amount");
  if(sumMoney(input.splits.map(split=>split.amountMinor))!==input.amountMinor)throw new Error("Split total does not equal the transaction amount");
}

function validateTransferInput(input:CreateTransferInput,accounts:Account[]){
  if(input.fromAccountId===input.toAccountId)throw new Error("Choose two different accounts");
  if(input.amountMinor<=0)throw new Error("Transfer amount must be greater than zero");
  const from=accounts.find(item=>item.id===input.fromAccountId),to=accounts.find(item=>item.id===input.toAccountId);
  if(!from||!to)throw new Error("Transfer account does not exist");
  if(from.currency!==to.currency)throw new Error("Transfers between different currencies are not supported yet");
}
