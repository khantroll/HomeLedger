import { reconciliationDifference, sumMoney, normalizeTransactionQuery, type Account, type BudgetAllocation, type BudgetAllocationInput, type BudgetCategory, type BudgetCategoryInput, type BudgetMonth, type CompleteReconciliationInput, type CreateAccountInput, type CreateTransactionInput, type CreateTransferInput, type CrossDomainCashTransferResult, type DebtPlan, type DebtPlanInput, type FinanceRepository, type ImportBatch, type ImportProfile, type ImportProfileInput, type ImportResult, type ImportTransactionsInput, type MerchantRule, type MerchantRuleInput, type Reconciliation, type SavingsGoal, type SavingsGoalInput, type ScheduledAutoPostInput, type ScheduledImportMatch, type ScheduledImportMatchInput, type ScheduledOccurrence, type ScheduledOccurrenceQuery, type ScheduledPostResult, type ScheduledTransaction, type ScheduledTransactionInput, type Transaction, type TransactionPage, type TransactionQuery, type TransferResult, type UndoImportResult, type UpdateAccountInput } from "./domain";
import { applyMerchantRules } from "./merchantRules";
import { generateRecurrenceDates } from "./scheduledRecurrence";
import { findScheduledMatches } from "./scheduledMatching";
import { calculateBudgetMonth,validateMonth } from "./budgetMath";

const initialAccounts: Account[] = [
  { id: "checking", name: "Household Checking", institution: "Sample Credit Union", type: "checking", currency: "USD", balanceMinor: 428640, ownerLabel: "Household", sortOrder: 0, archived: false },
  { id: "savings", name: "Emergency Savings", institution: "Sample Credit Union", type: "savings", currency: "USD", balanceMinor: 185000, ownerLabel: "Household", sortOrder: 1, archived: false },
  { id: "credit", name: "Everyday Card", institution: "Sample Bank", type: "credit", currency: "USD", balanceMinor: -143826, ownerLabel: "Household", needsReview: true, sortOrder: 2, archived: false },
  { id: "auto", name: "Vehicle Loan", institution: "Sample Lender", type: "loan", currency: "USD", balanceMinor: -1104755, ownerLabel: "Household", sortOrder: 3, archived: false }
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
  private openingBalances = new Map(initialAccounts.map(account => {
    const activity = initialTransactions.filter(item => item.accountId === account.id).reduce((total, item) => total + item.amountMinor, 0);
    return [account.id, account.balanceMinor - activity] as const;
  }));
  private importBatches: ImportBatch[] = [];
  private importedTransactionIds = new Map<string, string[]>();
  private reconciliations: Reconciliation[] = [];
  private reconciledTransactionIds = new Set<string>();
  private merchantRules: MerchantRule[] = [];
  private importProfiles: ImportProfile[] = [];
  private scheduledTransactions: ScheduledTransaction[] = [];
  private scheduledOccurrences: ScheduledOccurrence[] = [];
  private archivedScheduledIds = new Set<string>();
  private budgetCategories:BudgetCategory[]=[];
  private budgetAllocations:BudgetAllocation[]=[];
  private savingsGoals:SavingsGoal[]=[];
  private debtPlans=new Map<string,DebtPlan>();
  private categoryMemory=new Set(initialTransactions.map(item=>item.category).filter(isRememberedCategory));
  private payeeMemory=new Set(initialTransactions.map(item=>item.payee));
  private crossDomainLinks=new Map<string,{ordinaryTransactionId:string;investmentEventId:string;ordinaryAccountId:string;investmentAccountId:string;investmentCashEffectMinor:number;status:string;amountMinor:number}>();

  async listAccounts(includeArchived = false): Promise<Account[]> {
    return structuredClone(this.accounts
      .filter(account => includeArchived || !account.archived)
      .map(account => ({ ...account, needsReview: this.transactions.some(transaction => transaction.accountId === account.id && transaction.status === "review") }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)));
  }
  async listCategories():Promise<string[]>{
    this.transactions.forEach(item=>{if(isRememberedCategory(item.category))this.categoryMemory.add(item.category.trim());item.splits?.forEach(split=>this.categoryMemory.add(split.category.trim()));});
    this.scheduledTransactions.forEach(item=>{if(item.kind==="transaction"&&isRememberedCategory(item.category))this.categoryMemory.add(item.category.trim());});
    this.budgetCategories.forEach(item=>this.categoryMemory.add(item.category.trim()));
    this.merchantRules.forEach(item=>{if(item.category?.trim())this.categoryMemory.add(item.category.trim());});
    return [...this.categoryMemory].filter(Boolean).sort((a,b)=>a.localeCompare(b));
  }
  async listPayees():Promise<string[]>{
    this.transactions.forEach(item=>this.payeeMemory.add(item.payee.trim()));
    this.scheduledTransactions.forEach(item=>this.payeeMemory.add(item.payee.trim()));
    this.merchantRules.forEach(item=>{if(item.renameTo?.trim())this.payeeMemory.add(item.renameTo.trim());});
    return [...this.payeeMemory].filter(Boolean).sort((a,b)=>a.localeCompare(b));
  }
  async listTransactions(accountId?: string): Promise<Transaction[]> {
    const rows = accountId ? this.transactions.filter((item) => item.accountId === accountId) : this.transactions;
    return structuredClone([...rows].sort((a, b) => b.postedDate.localeCompare(a.postedDate) || b.id.localeCompare(a.id)));
  }
  async listTransactionsPage(query: TransactionQuery = {}): Promise<TransactionPage> {
    const normalized = normalizeTransactionQuery(query);
    if (normalized.accountId && !this.accounts.some(item => item.id === normalized.accountId)) throw new Error("Account does not exist");
    if (normalized.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.fromDate)) throw new Error("From date must be a valid YYYY-MM-DD date");
    if (normalized.toDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.toDate)) throw new Error("To date must be a valid YYYY-MM-DD date");
    if (normalized.fromDate && normalized.toDate && normalized.fromDate > normalized.toDate) throw new Error("From date must be on or before the to date");
    const search = normalized.search?.trim().toLocaleLowerCase();
    const status = normalized.status && normalized.status !== "all" ? normalized.status : undefined;
    const matched = this.transactions.filter(item => {
      if (normalized.accountId && item.accountId !== normalized.accountId) return false;
      if (normalized.fromDate && item.postedDate < normalized.fromDate) return false;
      if (normalized.toDate && item.postedDate > normalized.toDate) return false;
      if (status && item.status !== status) return false;
      if (search) {
        const haystack = `${item.payee} ${item.category} ${item.memo ?? ""} ${item.originalPayee ?? ""}`.toLocaleLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    }).sort((a, b) => a.postedDate.localeCompare(b.postedDate) || a.id.localeCompare(b.id));
    const totalCount = matched.length;
    const offset = normalized.newest ? Math.max(0, totalCount - normalized.limit) : Math.min(normalized.offset, totalCount);
    const transactions = matched.slice(offset, offset + normalized.limit);
    let priorBalanceMinor: number | undefined;
    if (normalized.accountId) {
      const opening = this.openingBalances.get(normalized.accountId) ?? 0;
      const accountRows = this.transactions
        .filter((item) => item.accountId === normalized.accountId)
        .sort((a, b) => a.postedDate.localeCompare(b.postedDate) || a.id.localeCompare(b.id));
      if (transactions.length) {
        const first = transactions[0];
        const earlier = accountRows.filter((item) => item.postedDate < first.postedDate || (item.postedDate === first.postedDate && item.id < first.id));
        priorBalanceMinor = sumMoney([opening, ...earlier.map((item) => item.amountMinor)]);
      } else {
        priorBalanceMinor = sumMoney([opening, ...accountRows.map((item) => item.amountMinor)]);
      }
    }
    return structuredClone({ transactions, totalCount, offset, limit: normalized.limit, priorBalanceMinor });
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
    const details = validateAccountDetails(input);
    const sortOrder = this.accounts.filter(account => !account.archived).reduce((max, account) => Math.max(max, account.sortOrder ?? 0), -1) + 1;
    const account: Account = { id: crypto.randomUUID(), ...details, balanceMinor: input.openingBalanceMinor, needsReview: false, sortOrder, archived: false };
    this.accounts.push(account);
    this.openingBalances.set(account.id, input.openingBalanceMinor);
    return structuredClone(account);
  }
  async updateAccount(id: string, input: UpdateAccountInput): Promise<Account> {
    const account = this.accounts.find(item => item.id === id);
    if (!account) throw new Error("Account does not exist");
    const details = validateAccountDetails(input);
    if (details.currency !== account.currency && this.accountHasHistory(id)) throw new Error("Currency cannot be changed after an account has activity or linked planning data");
    if (details.type !== "savings" && this.savingsGoals.some(goal => goal.accountId === id)) throw new Error("Remove this account's savings goal before changing its type");
    if (!["credit", "loan"].includes(details.type) && [...this.debtPlans.values()].some(plan => plan.terms.some(term => term.accountId === id))) throw new Error("Remove this account from its debt plan before changing its type");
    Object.assign(account, details);
    return structuredClone(account);
  }
  async setAccountArchived(id: string, archived: boolean): Promise<void> {
    const account = this.accounts.find(item => item.id === id);
    if (!account) throw new Error("Account does not exist");
    if (account.archived === archived) return;
    if (archived) {
      if (this.transactions.some(item => item.accountId === id && ["pending", "review"].includes(item.status))) throw new Error("Resolve pending and review transactions before archiving this account");
      if (this.scheduledTransactions.some(item => !this.archivedScheduledIds.has(item.id) && item.enabled && (item.accountId === id || item.transferAccountId === id))) throw new Error("Disable or archive scheduled transactions for this account first");
      if (this.savingsGoals.some(item => item.accountId === id)) throw new Error("Remove this account's savings goal before archiving it");
      if ([...this.debtPlans.values()].some(plan => plan.terms.some(term => term.accountId === id && term.enabled))) throw new Error("Disable this account in its debt plan before archiving it");
    }
    account.archived = archived;
    if (!archived) account.sortOrder = this.accounts.filter(item => !item.archived && item.id !== id).reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1) + 1;
  }
  async reorderAccounts(accountIds: string[]): Promise<void> {
    const activeIds = this.accounts.filter(account => !account.archived).map(account => account.id);
    if (new Set(accountIds).size !== accountIds.length) throw new Error("An account was included more than once");
    if (accountIds.length !== activeIds.length || activeIds.some(id => !accountIds.includes(id))) throw new Error("Account order must include every active account exactly once");
    accountIds.forEach((id, sortOrder) => { this.accounts.find(account => account.id === id)!.sortOrder = sortOrder; });
  }
  private accountHasHistory(id: string): boolean {
    return this.transactions.some(item => item.accountId === id || item.transferAccountId === id)
      || this.reconciliations.some(item => item.accountId === id)
      || this.importBatches.some(item => item.accountId === id)
      || this.scheduledTransactions.some(item => item.accountId === id || item.transferAccountId === id)
      || this.savingsGoals.some(item => item.accountId === id)
      || [...this.debtPlans.values()].some(plan => plan.terms.some(term => term.accountId === id));
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
    if(this.scheduledOccurrences.some(item=>item.transactionId===id))throw new Error("Transactions linked to scheduled occurrences cannot be deleted");
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
  async createOrdinaryInvestmentCashTransfer(input:CreateTransferInput):Promise<CrossDomainCashTransferResult>{
    return this.saveCrossDomainTransfer(undefined,input);
  }
  async updateOrdinaryInvestmentCashTransfer(id:string,input:CreateTransferInput):Promise<CrossDomainCashTransferResult>{
    return this.saveCrossDomainTransfer(id,input);
  }
  async deleteOrdinaryInvestmentCashTransfer(id:string):Promise<void>{
    const link=this.crossDomainLinks.get(id);
    if(!link)throw new Error("Ordinary↔investment cash transfer does not exist");
    if(link.status!=="pending"&&link.status!=="review")throw new Error("Cleared or reconciled investment-linked transfers cannot be rewritten. Record an opposite transfer to reverse the cash movement.");
    if(this.reconciledTransactionIds.has(link.ordinaryTransactionId))throw new Error("A reconciled ordinary↔investment cash transfer cannot be rewritten");
    const ordinary=this.transactions.find(item=>item.id===link.ordinaryTransactionId);
    if(!ordinary)throw new Error("Ordinary transfer leg is incomplete; nothing was deleted");
    const ordinaryAccount=this.accounts.find(item=>item.id===ordinary.accountId);
    if(ordinaryAccount)ordinaryAccount.balanceMinor-=ordinary.amountMinor;
    const investmentAccount=this.accounts.find(item=>item.id===link.investmentAccountId);
    if(investmentAccount)investmentAccount.balanceMinor-=link.investmentCashEffectMinor;
    this.transactions=this.transactions.filter(item=>item.id!==ordinary.id);
    this.crossDomainLinks.delete(id);
  }
  private saveCrossDomainTransfer(existingId:string|undefined,input:CreateTransferInput):CrossDomainCashTransferResult{
    if(input.amountMinor<=0)throw new Error("Transfer amount must be greater than zero");
    if(input.fromAccountId===input.toAccountId)throw new Error("Source and destination accounts must differ");
    const from=this.accounts.find(item=>item.id===input.fromAccountId&&!item.archived);
    const to=this.accounts.find(item=>item.id===input.toAccountId&&!item.archived);
    if(!from||!to)throw new Error("Account does not exist");
    if(from.currency!==to.currency)throw new Error("Ordinary↔investment cash transfers require the same currency; FX accounting is not supported");
    const fromInv=from.type==="investment",toInv=to.type==="investment";
    if(fromInv===toInv){
      if(fromInv)throw new Error("Investment-to-investment cash transfers use the investment activity workflow");
      throw new Error("Ordinary-to-ordinary transfers use the linked transfer workflow");
    }
    if(input.status==="reconciled")throw new Error("Transfers are marked reconciled through account reconciliation");
    const ordinary=fromInv?to:from;
    const investment=fromInv?from:to;
    const ordinaryAmount=fromInv?input.amountMinor:-input.amountMinor;
    const investmentCashEffect=fromInv?-input.amountMinor:input.amountMinor;
    const direction=fromInv?"investment_to_ordinary":"ordinary_to_investment";
    let linkId:string=existingId??crypto.randomUUID();
    let ordinaryTransactionId:string=crypto.randomUUID();
    let investmentEventId:string=crypto.randomUUID();
    if(existingId){
      const existing=this.crossDomainLinks.get(existingId);
      if(!existing)throw new Error("Ordinary↔investment cash transfer does not exist");
      if(existing.investmentAccountId!==investment.id)throw new Error("Cross-domain transfer investment account cannot be changed");
      if(existing.status!=="pending"&&existing.status!=="review")throw new Error("Cleared or reconciled investment-linked transfers cannot be rewritten. Record an opposite transfer to reverse the cash movement.");
      if(this.reconciledTransactionIds.has(existing.ordinaryTransactionId))throw new Error("A reconciled ordinary↔investment cash transfer cannot be rewritten");
      const ordinaryTxn=this.transactions.find(item=>item.id===existing.ordinaryTransactionId);
      if(!ordinaryTxn)throw new Error("Ordinary transfer leg is incomplete; nothing was changed");
      const oldOrdinaryAccount=this.accounts.find(item=>item.id===ordinaryTxn.accountId);
      if(oldOrdinaryAccount)oldOrdinaryAccount.balanceMinor-=ordinaryTxn.amountMinor;
      const oldInvestmentAccount=this.accounts.find(item=>item.id===existing.investmentAccountId);
      if(oldInvestmentAccount)oldInvestmentAccount.balanceMinor-=existing.investmentCashEffectMinor;
      Object.assign(ordinaryTxn,{accountId:ordinary.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${investment.name}`,amountMinor:ordinaryAmount,status:input.status,memo:input.memo,transferAccountId:investment.id});
      ordinaryTransactionId=ordinaryTxn.id;
      investmentEventId=existing.investmentEventId;
      linkId=existingId;
    }else{
      this.transactions.unshift({id:ordinaryTransactionId,accountId:ordinary.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${investment.name}`,amountMinor:ordinaryAmount,status:input.status,memo:input.memo,source:"transfer",transferLinkId:linkId,transferAccountId:investment.id});
    }
    ordinary.balanceMinor+=ordinaryAmount;
    investment.balanceMinor+=investmentCashEffect;
    this.crossDomainLinks.set(linkId,{ordinaryTransactionId,investmentEventId,ordinaryAccountId:ordinary.id,investmentAccountId:investment.id,investmentCashEffectMinor:investmentCashEffect,status:input.status,amountMinor:input.amountMinor});
    return{linkId,ordinaryTransactionId,investmentEventId,direction};
  }
  async listMerchantRules():Promise<MerchantRule[]>{return structuredClone([...this.merchantRules].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)));}
  async createMerchantRule(input:MerchantRuleInput):Promise<MerchantRule>{validateMerchantRule(input);const rule={id:crypto.randomUUID(),...input};this.merchantRules.push(rule);return structuredClone(rule);}
  async updateMerchantRule(id:string,input:MerchantRuleInput):Promise<MerchantRule>{validateMerchantRule(input);const index=this.merchantRules.findIndex(item=>item.id===id);if(index<0)throw new Error("Merchant rule does not exist");const rule={id,...input};this.merchantRules[index]=rule;return structuredClone(rule);}
  async deleteMerchantRule(id:string):Promise<void>{const index=this.merchantRules.findIndex(item=>item.id===id);if(index<0)throw new Error("Merchant rule does not exist");this.merchantRules.splice(index,1);}
  async listImportProfiles():Promise<ImportProfile[]>{return structuredClone(this.importProfiles);}
  async saveImportProfile(input:ImportProfileInput):Promise<ImportProfile>{validateImportProfile(input,this.accounts);const existing=this.importProfiles.find(item=>item.name===input.name&&item.headerSignature===input.headerSignature);const profile={id:existing?.id??crypto.randomUUID(),...input};if(existing)this.importProfiles[this.importProfiles.indexOf(existing)]=profile;else this.importProfiles.unshift(profile);return structuredClone(profile);}
  async deleteImportProfile(id:string):Promise<void>{const index=this.importProfiles.findIndex(item=>item.id===id);if(index<0)throw new Error("Import profile does not exist");this.importProfiles.splice(index,1);}
  async listScheduledTransactions():Promise<ScheduledTransaction[]>{return structuredClone(this.scheduledTransactions.map(item=>({...item,archived:this.archivedScheduledIds.has(item.id)})));}
  async createScheduledTransaction(input:ScheduledTransactionInput):Promise<ScheduledTransaction>{
    validateScheduledTransaction(input,this.accounts);
    const item={id:crypto.randomUUID(),...input};
    this.scheduledTransactions.push(item);
    return structuredClone(item);
  }
  async updateScheduledTransaction(id:string,input:ScheduledTransactionInput):Promise<ScheduledTransaction>{
    validateScheduledTransaction(input,this.accounts);
    const index=this.scheduledTransactions.findIndex(item=>item.id===id);
    if(index<0||this.archivedScheduledIds.has(id))throw new Error("Scheduled transaction does not exist");
    const item={id,...input};
    this.scheduledTransactions[index]=item;
    this.scheduledOccurrences=this.scheduledOccurrences.filter(occurrence=>occurrence.scheduledTransactionId!==id||occurrence.status!=="expected");
    return structuredClone(item);
  }
  async deleteScheduledTransaction(id:string):Promise<void>{
    if(!this.scheduledTransactions.some(item=>item.id===id)||this.archivedScheduledIds.has(id))throw new Error("Scheduled transaction does not exist");
    this.archivedScheduledIds.add(id);
    this.scheduledOccurrences=this.scheduledOccurrences.filter(occurrence=>occurrence.scheduledTransactionId!==id||occurrence.status!=="expected");
  }
  async generateScheduledOccurrences(input:ScheduledOccurrenceQuery):Promise<number>{
    validateOccurrenceQuery(input);
    const templates=this.scheduledTransactions.filter(item=>!this.archivedScheduledIds.has(item.id)&&item.enabled&&(!input.scheduledTransactionId||item.id===input.scheduledTransactionId));
    if(input.scheduledTransactionId&&!templates.length)throw new Error("Scheduled transaction does not exist or is disabled");
    let created=0;
    for(const template of templates)for(const dueDate of generateRecurrenceDates(template,input.fromDate,input.toDate)){
      if(this.scheduledOccurrences.some(item=>item.scheduledTransactionId===template.id&&item.dueDate===dueDate))continue;
      this.scheduledOccurrences.push({id:crypto.randomUUID(),scheduledTransactionId:template.id,dueDate,status:"expected"});
      created++;
    }
    return created;
  }
  async listScheduledOccurrences(input:ScheduledOccurrenceQuery):Promise<ScheduledOccurrence[]>{
    validateOccurrenceQuery(input);
    return structuredClone(this.scheduledOccurrences.filter(item=>item.dueDate>=input.fromDate&&item.dueDate<=input.toDate&&(!input.scheduledTransactionId||item.scheduledTransactionId===input.scheduledTransactionId)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id)));
  }
  async postScheduledOccurrence(id:string):Promise<Transaction>{
    const occurrence=this.expectedOccurrence(id),template=this.scheduledTransactions.find(item=>item.id===occurrence.scheduledTransactionId)!;
    let transaction:Transaction;
    if(template.kind==="transfer"){
      const result=await this.createTransfer({fromAccountId:template.accountId,toAccountId:template.transferAccountId!,postedDate:occurrence.dueDate,payee:template.payee,amountMinor:template.amountMinor,status:template.status,memo:template.memo});
      transaction=this.transactions.find(item=>item.id===result.fromTransactionId)!;
    }else transaction=await this.createTransaction({accountId:template.accountId,postedDate:occurrence.dueDate,payee:template.payee,category:template.category,amountMinor:template.amountMinor,status:template.status,memo:template.memo});
    occurrence.status="posted";occurrence.transactionId=transaction.id;return structuredClone(transaction);
  }
  async processScheduledAutoPost(input:ScheduledAutoPostInput):Promise<ScheduledPostResult>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate))throw new Error("Auto-post date must use YYYY-MM-DD");
    if(!input.occurrenceIds.length)throw new Error("Select at least one scheduled occurrence");
    if(input.occurrenceIds.length>1000)throw new Error("No more than 1,000 occurrences can be posted at once");
    if(new Set(input.occurrenceIds).size!==input.occurrenceIds.length)throw new Error("A scheduled occurrence was selected more than once");
    const snapshot={accounts:structuredClone(this.accounts),transactions:structuredClone(this.transactions),occurrences:structuredClone(this.scheduledOccurrences)};
    try{for(const id of input.occurrenceIds){const occurrence=this.expectedOccurrence(id),template=this.scheduledTransactions.find(item=>item.id===occurrence.scheduledTransactionId)!;if(!template.autoPost||!template.enabled||this.archivedScheduledIds.has(template.id)||occurrence.dueDate>input.asOfDate)throw new Error("A selected occurrence is not eligible for auto-post");await this.postScheduledOccurrence(id);}return{postedCount:input.occurrenceIds.length};}
    catch(reason){this.accounts=snapshot.accounts;this.transactions=snapshot.transactions;this.scheduledOccurrences=snapshot.occurrences;throw reason;}
  }
  async skipScheduledOccurrence(id:string):Promise<ScheduledOccurrence>{
    const occurrence=this.expectedOccurrence(id);
    occurrence.status="skipped";
    return structuredClone(occurrence);
  }
  async linkScheduledOccurrence(id:string,transactionId:string):Promise<ScheduledOccurrence>{
    const occurrence=this.expectedOccurrence(id),template=this.scheduledTransactions.find(item=>item.id===occurrence.scheduledTransactionId)!;
    if(template.kind==="transfer")throw new Error("Recurring transfer linking is not implemented yet");
    if(this.scheduledOccurrences.some(item=>item.transactionId===transactionId))throw new Error("Transaction is already linked to a scheduled occurrence");
    const transaction=this.transactions.find(item=>item.id===transactionId);
    if(!transaction)throw new Error("Transaction does not exist");
    if(transaction.transferLinkId)throw new Error("Linked transfers cannot be matched to a scheduled transaction");
    if(transaction.accountId!==template.accountId||transaction.amountMinor!==template.amountMinor)throw new Error("Transaction account and amount must match the scheduled transaction");
    occurrence.status="linked";occurrence.transactionId=transactionId;
    return structuredClone(occurrence);
  }
  private expectedOccurrence(id:string):ScheduledOccurrence{
    const occurrence=this.scheduledOccurrences.find(item=>item.id===id);
    if(!occurrence)throw new Error("Scheduled occurrence does not exist");
    if(occurrence.status!=="expected")throw new Error("Only expected occurrences can be changed");
    return occurrence;
  }
  async findScheduledOccurrenceMatches(input:ScheduledImportMatchInput):Promise<ScheduledImportMatch[]>{
    if(!this.accounts.some(item=>item.id===input.accountId))throw new Error("Account does not exist");
    return structuredClone(input.rows.map(row=>({sourceRow:row.sourceRow,candidates:findScheduledMatches(row,input.accountId,this.scheduledTransactions,this.scheduledOccurrences)})));
  }
  async listBudgetCategories():Promise<BudgetCategory[]>{return structuredClone([...this.budgetCategories].sort((a,b)=>a.category.localeCompare(b.category)));}
  async createBudgetCategory(input:BudgetCategoryInput):Promise<BudgetCategory>{
    const category=cleanBudgetCategory(input.category);
    if(this.budgetCategories.some(item=>item.category.toLocaleLowerCase()===category.toLocaleLowerCase()))throw new Error("Budget category already exists");
    const item={id:crypto.randomUUID(),category,rolloverEnabled:input.rolloverEnabled};this.budgetCategories.push(item);return structuredClone(item);
  }
  async updateBudgetCategory(id:string,input:BudgetCategoryInput):Promise<BudgetCategory>{
    const index=this.budgetCategories.findIndex(item=>item.id===id);if(index<0)throw new Error("Budget category does not exist");
    const category=cleanBudgetCategory(input.category);
    if(this.budgetCategories.some(item=>item.id!==id&&item.category.toLocaleLowerCase()===category.toLocaleLowerCase()))throw new Error("Budget category already exists");
    const item={id,category,rolloverEnabled:input.rolloverEnabled};this.budgetCategories[index]=item;return structuredClone(item);
  }
  async deleteBudgetCategory(id:string):Promise<void>{
    const index=this.budgetCategories.findIndex(item=>item.id===id);if(index<0)throw new Error("Budget category does not exist");
    this.budgetCategories.splice(index,1);this.budgetAllocations=this.budgetAllocations.filter(item=>item.budgetCategoryId!==id);
  }
  async setBudgetAllocation(input:BudgetAllocationInput):Promise<void>{
    validateMonth(input.month);if(!this.budgetCategories.some(item=>item.id===input.budgetCategoryId))throw new Error("Budget category does not exist");
    if(!Number.isSafeInteger(input.plannedMinor)||input.plannedMinor<0)throw new Error("Budget amount must be zero or greater");
    const index=this.budgetAllocations.findIndex(item=>item.budgetCategoryId===input.budgetCategoryId&&item.month===input.month);
    if(index<0)this.budgetAllocations.push({...input});else this.budgetAllocations[index]={...input};
  }
  async getBudgetMonth(month:string):Promise<BudgetMonth>{return structuredClone(calculateBudgetMonth(month,this.budgetCategories,this.budgetAllocations,this.transactions));}
  async listSavingsGoals():Promise<SavingsGoal[]>{return structuredClone([...this.savingsGoals].sort((a,b)=>a.targetDate.localeCompare(b.targetDate)||a.name.localeCompare(b.name)));}
  async createSavingsGoal(input:SavingsGoalInput):Promise<SavingsGoal>{const item=validateSavingsGoal(input,this.accounts,this.savingsGoals,crypto.randomUUID());this.savingsGoals.push(item);return structuredClone(item);}
  async updateSavingsGoal(id:string,input:SavingsGoalInput):Promise<SavingsGoal>{const index=this.savingsGoals.findIndex(item=>item.id===id);if(index<0)throw new Error("Savings goal does not exist");const item=validateSavingsGoal(input,this.accounts,this.savingsGoals,id);this.savingsGoals[index]=item;return structuredClone(item);}
  async deleteSavingsGoal(id:string):Promise<void>{const index=this.savingsGoals.findIndex(item=>item.id===id);if(index<0)throw new Error("Savings goal does not exist");this.savingsGoals.splice(index,1);}
  async getDebtPlan(currency:string):Promise<DebtPlan>{const normalized=cleanCurrency(currency);return structuredClone(this.debtPlans.get(normalized)??{currency:normalized,strategy:"avalanche",extraPaymentMinor:0,terms:[]});}
  async saveDebtPlan(input:DebtPlanInput):Promise<DebtPlan>{const plan=validateDebtPlan(input,this.accounts);this.debtPlans.set(plan.currency,plan);return structuredClone(plan);}
  async importTransactions(input: ImportTransactionsInput): Promise<ImportResult> {
    const account = this.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("Account does not exist");
    const prepared=applyMerchantRules(input.rows,this.merchantRules).map(item=>item.row);
    const selectedOccurrences=new Set<string>();
    prepared.forEach(row=>{
      if(!row.scheduledOccurrenceId)return;
      if(selectedOccurrences.has(row.scheduledOccurrenceId))throw new Error("A scheduled occurrence was selected more than once");
      selectedOccurrences.add(row.scheduledOccurrenceId);
      const eligible=findScheduledMatches(row,input.accountId,this.scheduledTransactions,this.scheduledOccurrences).some(candidate=>candidate.occurrenceId===row.scheduledOccurrenceId);
      if(!eligible)throw new Error("The selected scheduled occurrence is no longer eligible for this transaction");
    });
    const batchId = crypto.randomUUID();
    const imported = prepared.map(row => ({
      id: crypto.randomUUID(), accountId: input.accountId, postedDate: row.postedDate, payee: row.payee,
      category: row.category ?? "Uncategorized", amountMinor: row.amountMinor, status: "review" as const,
      memo: row.memo, externalId: row.externalId, originalPayee: row.originalPayee,
      splits: row.splits?.map(split => ({ id: crypto.randomUUID(), category: split.category, amountMinor: split.amountMinor, memo: split.memo })),
      source: "import" as const, importBatchId: batchId
    }));
    prepared.forEach((row,index)=>{
      if(!row.scheduledOccurrenceId)return;
      const occurrence=this.scheduledOccurrences.find(item=>item.id===row.scheduledOccurrenceId)!;
      occurrence.status="linked";occurrence.transactionId=imported[index].id;
    });
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
    if([...ids].some(id=>this.scheduledOccurrences.some(item=>item.transactionId===id)))throw new Error("This import contains transactions linked to scheduled occurrences and cannot be undone");
    const removed = this.transactions.filter(item => ids.has(item.id));
    this.transactions = this.transactions.filter(item => !ids.has(item.id));
    const account = this.accounts.find(item => item.id === batch.accountId);
    if (account) account.balanceMinor -= removed.reduce((total, row) => total + row.amountMinor, 0);
    batch.undoneAt = new Date().toISOString();
    return { batchId, removedCount: removed.length };
  }
}

function isRememberedCategory(value:string):boolean{const category=value.trim();return Boolean(category)&&category!=="Split transaction"&&!category.startsWith("Transfer:");}
function validateAccountDetails(input:UpdateAccountInput):Pick<Account,"name"|"institution"|"type"|"currency"|"ownerLabel">{
  const name=input.name.trim(),institution=input.institution?.trim()||undefined,ownerLabel=input.ownerLabel.trim();
  if(!name)throw new Error("Account name is required");if(name.length>80)throw new Error("Account name is too long");
  if(institution&&institution.length>80)throw new Error("Institution is too long");
  if(!["checking","savings","credit","cash","loan","asset","investment"].includes(input.type))throw new Error("Unsupported account type");
  if(!ownerLabel)throw new Error("Owner is required");if(ownerLabel.length>80)throw new Error("Owner is too long");
  return{name,institution,type:input.type,currency:cleanCurrency(input.currency),ownerLabel};
}
function cleanBudgetCategory(value:string):string{const category=value.trim();if(!category)throw new Error("Budget category is required");if(category.length>120)throw new Error("Budget category is too long");return category;}
function validateSavingsGoal(input:SavingsGoalInput,accounts:Account[],goals:SavingsGoal[],id:string):SavingsGoal{
  const name=input.name.trim();if(!name)throw new Error("Savings goal name is required");if(name.length>120)throw new Error("Savings goal name is too long");
  const account=accounts.find(item=>item.id===input.accountId&&item.type==="savings");if(!account)throw new Error("Savings goals require an active savings account");if(goals.some(item=>item.id!==id&&item.accountId===input.accountId))throw new Error("This savings account already has a goal");
  if(!Number.isSafeInteger(input.targetMinor)||input.targetMinor<=0)throw new Error("Savings target must be greater than zero");if(!Number.isSafeInteger(input.plannedMonthlyMinor)||input.plannedMonthlyMinor<0)throw new Error("Planned monthly savings must be zero or greater");
  const target=new Date(`${input.targetDate}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)||Number.isNaN(target.valueOf())||target.toISOString().slice(0,10)!==input.targetDate)throw new Error("Savings target date is invalid");
  return{id,name,accountId:input.accountId,targetMinor:input.targetMinor,targetDate:input.targetDate,plannedMonthlyMinor:input.plannedMonthlyMinor};
}
function cleanCurrency(value:string):string{const currency=value.trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new Error("Currency must be a three-letter code");return currency;}
function validateDebtPlan(input:DebtPlanInput,accounts:Account[]):DebtPlan{
  const currency=cleanCurrency(input.currency);if(!["snowball","avalanche","custom"].includes(input.strategy))throw new Error("Debt strategy is invalid");if(!Number.isSafeInteger(input.extraPaymentMinor)||input.extraPaymentMinor<0)throw new Error("Extra payment must be zero or greater");if(input.terms.length>1000)throw new Error("Debt plan has too many accounts");
  const ids=new Set<string>();for(const term of input.terms){if(ids.has(term.accountId))throw new Error("A debt account was included more than once");ids.add(term.accountId);const account=accounts.find(item=>item.id===term.accountId);if(!account||!["credit","loan"].includes(account.type)||account.currency!==currency)throw new Error("Debt plan accounts must be credit or loan accounts in the selected currency");if(!Number.isInteger(term.annualRateBps)||term.annualRateBps<0||term.annualRateBps>100000)throw new Error("Debt APR is invalid");if(!Number.isSafeInteger(term.minimumPaymentMinor)||term.minimumPaymentMinor<=0)throw new Error("Debt minimum payment must be greater than zero");if(!Number.isInteger(term.customPriority)||term.customPriority<0)throw new Error("Debt priority is invalid");}
  return structuredClone({...input,currency});
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
  if(from.type==="investment"||to.type==="investment")throw new Error("Ordinary↔investment cash transfers must use the dedicated transfer command; investment-to-investment cash transfers use investment activity");
  if(from.currency!==to.currency)throw new Error("Transfers between different currencies are not supported yet");
}

function validateMerchantRule(input:MerchantRuleInput){
  if(!input.name.trim())throw new Error("Rule name is required");
  if(!input.pattern.trim())throw new Error("Match text is required");
  if(!input.renameTo?.trim()&&!input.category?.trim())throw new Error("A rule must rename the payee, assign a category, or both");
  if(!Number.isInteger(input.priority)||input.priority < -10000||input.priority > 10000)throw new Error("Priority must be a whole number between -10000 and 10000");
}

function validateImportProfile(input:ImportProfileInput,accounts:Account[]){
  if(!input.name.trim())throw new Error("Template name is required");
  if(!input.headerSignature.trim())throw new Error("Header signature is required");
  if(input.accountId&&!accounts.some(account=>account.id===input.accountId))throw new Error("Profile account does not exist");
  if(input.dateColumn<0||input.payeeColumn<0)throw new Error("Date and description columns are required");
  if(input.amountColumn<0&&input.debitColumn<0&&input.creditColumn<0)throw new Error("An amount or debit/credit column is required");
  if(!["mdy","dmy"].includes(input.dateOrder)||!["dot","comma"].includes(input.numberFormat))throw new Error("Import profile locale settings are invalid");
  if(!["delimited","workbook","pdf","ocr"].includes(input.sourceKind))throw new Error("Import profile source kind is invalid");
  if((input.sourceKind==="pdf"||input.sourceKind==="ocr")&&(!input.sourceSignature||!input.pdfLayout))throw new Error("PDF and OCR templates require a source signature and statement layout");
  if(input.sourceKind==="workbook"&&(!input.sourceSignature||!input.workbookSheetName||input.workbookHeaderRow===undefined))throw new Error("Workbook templates require a source signature, worksheet, and header row");
}

function validateScheduledTransaction(input:ScheduledTransactionInput,accounts:Account[]){
  const account=accounts.find(item=>item.id===input.accountId);
  if(!account)throw new Error("Scheduled transaction account does not exist");
  if(!input.payee.trim())throw new Error("Payee is required");
  if(!input.category.trim())throw new Error("Category is required");
  if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor===0)throw new Error("Scheduled amount must be a non-zero safe integer");
  if(!["pending","cleared","review"].includes(input.status))throw new Error("Scheduled status is invalid");
  if(input.kind==="transaction"&&input.transferAccountId)throw new Error("Ordinary scheduled transactions cannot have a transfer account");
  if(input.kind==="transfer"){
    const destination=accounts.find(item=>item.id===input.transferAccountId);
    if(!destination||destination.id===account.id)throw new Error("Scheduled transfers require two different accounts");
    if(destination.currency!==account.currency)throw new Error("Scheduled transfer accounts must use the same currency");
    if(input.amountMinor<=0)throw new Error("Scheduled transfer amount must be positive");
  }
  if(input.frequency==="semimonthly"){
    const anchorDay=Number(input.anchorDate.slice(-2));
    if(!Number.isInteger(input.secondMonthDay)||!input.secondMonthDay||input.secondMonthDay<1||input.secondMonthDay>31||input.secondMonthDay===anchorDay)throw new Error("Semimonthly schedules require two different month days");
  }else if(input.secondMonthDay!==undefined)throw new Error("Second month day is only valid for semimonthly schedules");
  if(input.frequency==="custom"){
    if(!Number.isInteger(input.customIntervalCount)||!input.customIntervalCount||input.customIntervalCount<1||!input.customIntervalUnit)throw new Error("Custom schedules require a positive interval and unit");
  }else if(input.customIntervalCount!==undefined||input.customIntervalUnit!==undefined)throw new Error("Custom interval fields are only valid for custom schedules");
  generateRecurrenceDates(input,input.anchorDate,input.anchorDate);
  if(input.endDate&&input.endDate<input.anchorDate)throw new Error("Schedule end date cannot be before its anchor");
}

function validateOccurrenceQuery(input:ScheduledOccurrenceQuery){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate)||!/^\d{4}-\d{2}-\d{2}$/.test(input.toDate)||input.fromDate>input.toDate)throw new Error("Occurrence query dates are invalid");
}
