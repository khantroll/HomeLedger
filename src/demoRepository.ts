import { reconciliationDifference, sumMoney, normalizeTransactionQuery, ATTACHMENT_ALLOWED_EXTENSIONS, ATTACHMENT_MAX_BYTES, TRANSACTION_NOTE_MAX_LENGTH, type Account, type AttachBytesInput, type BudgetAllocation, type BudgetAllocationInput, type BudgetCategory, type BudgetCategoryInput, type BudgetMonth, type BulkMutationResult, type BulkSetTransactionCategoryInput, type BulkTransactionIdsInput, type BulkUpdateTransactionStatusInput, type CompleteReconciliationInput, type CreateAccountInput, type CreateTransactionInput, type CreateTransferInput, type CrossDomainCashTransferResult, type DebtPlan, type DebtPlanInput, type FinanceRepository, type ImportBatch, type ImportProfile, type ImportProfileInput, type ImportResult, type ImportTransactionsInput, type LabelRewriteResult, type MerchantRule, type MerchantRuleInput, type PickedAttachmentFile, type Reconciliation, type RetainImportSourceInput, type SavingsGoal, type SavingsGoalInput, type ScheduledAutoPostInput, type ScheduledImportMatch, type ScheduledImportMatchInput, type ScheduledOccurrence, type ScheduledOccurrenceQuery, type ScheduledPostResult, type ScheduledTransaction, type ScheduledTransactionInput, type Transaction, type TransactionAnnotationInput, type TransactionAttachment, type TransactionPage, type TransactionQuery, type TransferResult, type UndoImportResult, type UpdateAccountInput } from "./domain";
import { isRememberedCategoryLabel } from "./labelVocabulary";
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
  private attachments=new Map<string,{meta:TransactionAttachment;contentBase64:string}>();
  private transactionAttachmentIds=new Map<string,Set<string>>();
  private batchAttachmentIds=new Map<string,Set<string>>();

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
  async renameCategory(from:string,to:string):Promise<LabelRewriteResult>{
    return this.withAtomicLabelRewrite(()=>this.rewriteCategory(from,to,"rename"));
  }
  async mergeCategories(from:string,into:string):Promise<LabelRewriteResult>{
    return this.withAtomicLabelRewrite(()=>this.rewriteCategory(from,into,"merge"));
  }
  async removeUnusedCategory(name:string):Promise<void>{
    const label=name.trim();
    if(!label)throw new Error("Category is required");
    if(!isRememberedCategory(label))throw new Error("Split and transfer categories cannot be removed");
    if(this.categoryReferenceCount(label)>0)throw new Error("Category is still referenced by ledger or planning data");
    const key=label.toLocaleLowerCase();
    let removed=false;
    for(const item of [...this.categoryMemory])if(item.toLocaleLowerCase()===key){this.categoryMemory.delete(item);removed=true;}
    if(!removed)throw new Error("Category does not exist in autocomplete memory");
  }
  async renamePayee(from:string,to:string):Promise<LabelRewriteResult>{
    return this.withAtomicLabelRewrite(()=>this.rewritePayee(from,to,"rename"));
  }
  async mergePayees(from:string,into:string):Promise<LabelRewriteResult>{
    return this.withAtomicLabelRewrite(()=>this.rewritePayee(from,into,"merge"));
  }
  async removeUnusedPayee(name:string):Promise<void>{
    const label=name.trim();
    if(!label)throw new Error("Payee is required");
    if(this.payeeReferenceCount(label)>0)throw new Error("Payee is still referenced by ledger or planning data");
    const key=label.toLocaleLowerCase();
    let removed=false;
    for(const item of [...this.payeeMemory])if(item.toLocaleLowerCase()===key){this.payeeMemory.delete(item);removed=true;}
    if(!removed)throw new Error("Payee does not exist in autocomplete memory");
  }
  async bulkUpdateTransactionStatus(input:BulkUpdateTransactionStatusInput):Promise<BulkMutationResult>{
    const ids=validateBulkIds(input.transactionIds);
    if(!["pending","cleared","review"].includes(input.status))throw new Error("Unsupported transaction status");
    return this.withAtomicBulk(()=>{
      for(const id of ids){
        const transaction=this.requireBulkEditable(id);
        transaction.status=input.status;
      }
      return{updatedCount:ids.length,deletedCount:0};
    });
  }
  async bulkSetTransactionCategory(input:BulkSetTransactionCategoryInput):Promise<BulkMutationResult>{
    const ids=validateBulkIds(input.transactionIds);
    const category=input.category.trim();
    if(!category)throw new Error("Category is required");
    if(category.length>120)throw new Error("Category is too long");
    if(!isRememberedCategoryLabel(category))throw new Error("Split and transfer categories cannot be assigned through bulk edit");
    return this.withAtomicBulk(()=>{
      for(const id of ids){
        const transaction=this.requireBulkEditable(id);
        if(transaction.splits?.length||transaction.category==="Split transaction"){
          throw new Error("Split transactions cannot receive a bulk category change; edit their split lines individually");
        }
        if(!isRememberedCategoryLabel(transaction.category)){
          throw new Error("Transfer and split parent categories cannot be rewritten through bulk category edit");
        }
        transaction.category=category;
        this.categoryMemory.add(category);
      }
      return{updatedCount:ids.length,deletedCount:0};
    });
  }
  async bulkDeleteTransactions(input:BulkTransactionIdsInput):Promise<BulkMutationResult>{
    const ids=validateBulkIds(input.transactionIds);
    return this.withAtomicBulk(()=>{
      for(const id of ids)this.deleteTransactionSync(id);
      return{updatedCount:0,deletedCount:ids.length};
    });
  }
  private withAtomicBulk<T>(run:()=>T):T{
    const snapshot={
      accounts:structuredClone(this.accounts),
      transactions:structuredClone(this.transactions),
      categoryMemory:new Set(this.categoryMemory),
      payeeMemory:new Set(this.payeeMemory),
      attachments:new Map([...this.attachments.entries()].map(([id,value])=>[id,{meta:structuredClone(value.meta),contentBase64:value.contentBase64}])),
      transactionAttachmentIds:new Map([...this.transactionAttachmentIds.entries()].map(([id,set])=>[id,new Set(set)])),
      batchAttachmentIds:new Map([...this.batchAttachmentIds.entries()].map(([id,set])=>[id,new Set(set)])),
    };
    try{return run();}
    catch(error){
      this.accounts=snapshot.accounts;
      this.transactions=snapshot.transactions;
      this.categoryMemory=snapshot.categoryMemory;
      this.payeeMemory=snapshot.payeeMemory;
      this.attachments=snapshot.attachments;
      this.transactionAttachmentIds=snapshot.transactionAttachmentIds;
      this.batchAttachmentIds=snapshot.batchAttachmentIds;
      throw error;
    }
  }
  private requireBulkEditable(id:string):Transaction{
    const transaction=this.transactions.find(item=>item.id===id);
    if(!transaction)throw new Error(`Transaction ${id} does not exist`);
    if(this.reconciledTransactionIds.has(id)||transaction.status==="reconciled")throw new Error("Reconciled transactions cannot be edited");
    if(this.scheduledOccurrences.some(item=>item.transactionId===id))throw new Error("Transactions linked to scheduled occurrences cannot be edited");
    if(transaction.transferLinkId||transaction.source==="transfer")throw new Error("Linked transfers must be edited through the transfer editor");
    return transaction;
  }
  private deleteTransactionSync(id:string):void{
    const index=this.transactions.findIndex(item=>item.id===id);
    if(index<0)throw new Error("Transaction does not exist");
    const transaction=this.transactions[index];
    if(this.reconciledTransactionIds.has(id)||transaction.status==="reconciled")throw new Error("Reconciled transactions cannot be deleted");
    if(this.scheduledOccurrences.some(item=>item.transactionId===id))throw new Error("Transactions linked to scheduled occurrences cannot be deleted");
    if(transaction.importBatchId)throw new Error("Imported transactions must be removed by undoing their complete import batch");
    if(transaction.transferLinkId)throw new Error("Linked transfers must be removed through the transfer editor");
    this.transactions.splice(index,1);
    const account=this.accounts.find(item=>item.id===transaction.accountId);
    if(account)account.balanceMinor-=transaction.amountMinor;
    this.clearTransactionAttachmentLinks(id);
  }
  private clearTransactionAttachmentLinks(transactionId:string):void{
    const linked=this.transactionAttachmentIds.get(transactionId);
    if(!linked)return;
    const ids=[...linked];
    this.transactionAttachmentIds.delete(transactionId);
    for(const attachmentId of ids)this.garbageCollectAttachment(attachmentId);
  }
  private attachmentCountFor(transactionId:string):number{
    return this.transactionAttachmentIds.get(transactionId)?.size??0;
  }
  private withAttachmentCount(transaction:Transaction):Transaction{
    return{...transaction,attachmentCount:this.attachmentCountFor(transaction.id)};
  }
  private garbageCollectAttachment(attachmentId:string):boolean{
    let refs=0;
    for(const set of this.transactionAttachmentIds.values())if(set.has(attachmentId))refs+=1;
    for(const set of this.batchAttachmentIds.values())if(set.has(attachmentId))refs+=1;
    if(refs>0)return false;
    return this.attachments.delete(attachmentId);
  }
  private linkTransactionAttachment(transactionId:string,attachmentId:string):void{
    let set=this.transactionAttachmentIds.get(transactionId);
    if(!set){set=new Set();this.transactionAttachmentIds.set(transactionId,set);}
    set.add(attachmentId);
  }
  private linkBatchAttachment(batchId:string,attachmentId:string):void{
    let set=this.batchAttachmentIds.get(batchId);
    if(!set){set=new Set();this.batchAttachmentIds.set(batchId,set);}
    set.add(attachmentId);
  }
  private async insertAttachmentBytes(originalFilename:string,mediaType:string|undefined,contentBase64:string,sourceKind:string):Promise<TransactionAttachment>{
    const filename=sanitizeAttachmentFilename(originalFilename);
    const bytes=decodeAttachmentBase64(contentBase64);
    if(!bytes.length)throw new Error("Attachment content is empty");
    if(bytes.length>ATTACHMENT_MAX_BYTES)throw new Error("Attachment exceeds the 10 MB size limit");
    validateAttachmentExtension(filename);
    const media=inferAttachmentMediaType(filename,mediaType);
    const hash=await sha256Hex(bytes);
    for(const stored of this.attachments.values()){
      if(stored.meta.sha256Hex===hash)return structuredClone(stored.meta);
    }
    const id=crypto.randomUUID();
    const meta:TransactionAttachment={
      id,
      storageKey:id,
      originalFilename:filename,
      mediaType:media,
      byteSize:bytes.length,
      sha256Hex:hash,
      sourceKind,
      createdAt:new Date().toISOString(),
    };
    this.attachments.set(id,{meta,contentBase64:contentBase64.trim()});
    return structuredClone(meta);
  }
  private withAtomicLabelRewrite(run:()=>LabelRewriteResult):LabelRewriteResult{
    const snapshot={
      transactions:structuredClone(this.transactions),
      scheduledTransactions:structuredClone(this.scheduledTransactions),
      budgetCategories:structuredClone(this.budgetCategories),
      budgetAllocations:structuredClone(this.budgetAllocations),
      merchantRules:structuredClone(this.merchantRules),
      categoryMemory:new Set(this.categoryMemory),
      payeeMemory:new Set(this.payeeMemory),
    };
    try{return run();}
    catch(error){
      this.transactions=snapshot.transactions;
      this.scheduledTransactions=snapshot.scheduledTransactions;
      this.budgetCategories=snapshot.budgetCategories;
      this.budgetAllocations=snapshot.budgetAllocations;
      this.merchantRules=snapshot.merchantRules;
      this.categoryMemory=snapshot.categoryMemory;
      this.payeeMemory=snapshot.payeeMemory;
      throw error;
    }
  }
  private categoryExists(label:string):boolean{
    const key=label.trim().toLocaleLowerCase();
    if([...this.categoryMemory].some(item=>item.toLocaleLowerCase()===key))return true;
    if(this.budgetCategories.some(item=>item.category.toLocaleLowerCase()===key))return true;
    if(this.merchantRules.some(item=>item.category?.toLocaleLowerCase()===key))return true;
    return this.transactions.some(item=>item.category.toLocaleLowerCase()===key||item.splits?.some(split=>split.category.toLocaleLowerCase()===key))
      ||this.scheduledTransactions.some(item=>item.kind==="transaction"&&item.category.toLocaleLowerCase()===key);
  }
  private payeeExists(label:string):boolean{
    const key=label.trim().toLocaleLowerCase();
    if([...this.payeeMemory].some(item=>item.toLocaleLowerCase()===key))return true;
    if(this.merchantRules.some(item=>item.renameTo?.toLocaleLowerCase()===key))return true;
    return this.transactions.some(item=>item.payee.toLocaleLowerCase()===key)
      ||this.scheduledTransactions.some(item=>item.payee.toLocaleLowerCase()===key);
  }
  private categoryReferenceCount(label:string):number{
    const key=label.trim().toLocaleLowerCase();
    let count=0;
    for(const item of this.transactions){
      if(item.category.toLocaleLowerCase()===key)count+=1;
      for(const split of item.splits??[])if(split.category.toLocaleLowerCase()===key)count+=1;
    }
    count+=this.scheduledTransactions.filter(item=>item.kind==="transaction"&&item.category.toLocaleLowerCase()===key).length;
    count+=this.budgetCategories.filter(item=>item.category.toLocaleLowerCase()===key).length;
    count+=this.merchantRules.filter(item=>item.category?.toLocaleLowerCase()===key).length;
    return count;
  }
  private payeeReferenceCount(label:string):number{
    const key=label.trim().toLocaleLowerCase();
    return this.transactions.filter(item=>item.payee.toLocaleLowerCase()===key).length
      +this.scheduledTransactions.filter(item=>item.payee.toLocaleLowerCase()===key).length
      +this.merchantRules.filter(item=>item.renameTo?.toLocaleLowerCase()===key).length;
  }
  private rewriteCategory(fromRaw:string,toRaw:string,operation:"rename"|"merge"):LabelRewriteResult{
    const from=fromRaw.trim(),to=toRaw.trim();
    if(!from||!to)throw new Error("Category is required");
    if(from.length>120||to.length>120)throw new Error("Category is too long");
    if(!isRememberedCategory(from)||!isRememberedCategory(to))throw new Error("Split and transfer categories cannot be renamed through category management");
    if(!this.categoryExists(from))throw new Error(operation==="merge"?"Source category does not exist":"Category does not exist");
    const same=from.toLocaleLowerCase()===to.toLocaleLowerCase();
    if(operation==="rename"){
      if(same&&from===to)throw new Error("Category is already named that way");
      if(!same&&this.categoryExists(to))throw new Error("Category already exists; use merge instead");
    }else{
      if(same)throw new Error("Choose two different categories to merge");
      if(!this.categoryExists(to))throw new Error("Target category does not exist");
    }
    const target=operation==="merge"
      ?([...this.categoryMemory].find(item=>item.toLocaleLowerCase()===to.toLocaleLowerCase())
        ??this.budgetCategories.find(item=>item.category.toLocaleLowerCase()===to.toLocaleLowerCase())?.category
        ??this.transactions.find(item=>item.category.toLocaleLowerCase()===to.toLocaleLowerCase())?.category
        ??to)
      :to;
    let transactions=0,splits=0,schedules=0,merchantRules=0;
    for(const item of this.transactions){
      if(isRememberedCategory(item.category)&&item.category.toLocaleLowerCase()===from.toLocaleLowerCase()){item.category=target;transactions+=1;}
      for(const split of item.splits??[])if(split.category.toLocaleLowerCase()===from.toLocaleLowerCase()){split.category=target;splits+=1;}
    }
    for(const item of this.scheduledTransactions){
      if(item.kind==="transaction"&&item.category.toLocaleLowerCase()===from.toLocaleLowerCase()){item.category=target;schedules+=1;}
    }
    for(const rule of this.merchantRules){
      if(rule.category?.toLocaleLowerCase()===from.toLocaleLowerCase()){rule.category=target;merchantRules+=1;}
    }
    const budgetCategories=this.mergeBudgetCategoryLabels(from,target);
    for(const item of [...this.categoryMemory])if(item.toLocaleLowerCase()===from.toLocaleLowerCase())this.categoryMemory.delete(item);
    this.categoryMemory.add(target);
    return{from,to:target,operation,transactions,splits,schedules,budgetCategories,merchantRules,catalogRemoved:!same};
  }
  private mergeBudgetCategoryLabels(from:string,to:string):number{
    const source=this.budgetCategories.find(item=>item.category.toLocaleLowerCase()===from.toLocaleLowerCase());
    if(!source)return 0;
    const target=this.budgetCategories.find(item=>item.category.toLocaleLowerCase()===to.toLocaleLowerCase());
    if(!target||target.id===source.id){
      source.category=to;
      return 1;
    }
    for(const allocation of this.budgetAllocations.filter(item=>item.budgetCategoryId===source.id)){
      const existing=this.budgetAllocations.find(item=>item.budgetCategoryId===target.id&&item.month===allocation.month);
      if(existing)existing.plannedMinor=sumMoney([existing.plannedMinor,allocation.plannedMinor]);
      else this.budgetAllocations.push({budgetCategoryId:target.id,month:allocation.month,plannedMinor:allocation.plannedMinor});
    }
    this.budgetAllocations=this.budgetAllocations.filter(item=>item.budgetCategoryId!==source.id);
    this.budgetCategories=this.budgetCategories.filter(item=>item.id!==source.id);
    return 1;
  }
  private rewritePayee(fromRaw:string,toRaw:string,operation:"rename"|"merge"):LabelRewriteResult{
    const from=fromRaw.trim(),to=toRaw.trim();
    if(!from||!to)throw new Error("Payee is required");
    if(from.length>160||to.length>160)throw new Error("Payee is too long");
    if(!this.payeeExists(from))throw new Error(operation==="merge"?"Source payee does not exist":"Payee does not exist");
    const same=from.toLocaleLowerCase()===to.toLocaleLowerCase();
    if(operation==="rename"){
      if(same&&from===to)throw new Error("Payee is already named that way");
      if(!same&&this.payeeExists(to))throw new Error("Payee already exists; use merge instead");
    }else{
      if(same)throw new Error("Choose two different payees to merge");
      if(!this.payeeExists(to))throw new Error("Target payee does not exist");
    }
    const target=operation==="merge"
      ?([...this.payeeMemory].find(item=>item.toLocaleLowerCase()===to.toLocaleLowerCase())
        ??this.transactions.find(item=>item.payee.toLocaleLowerCase()===to.toLocaleLowerCase())?.payee
        ??to)
      :to;
    let transactions=0,schedules=0,merchantRules=0;
    for(const item of this.transactions){
      if(item.payee.toLocaleLowerCase()===from.toLocaleLowerCase()){item.payee=target;transactions+=1;}
    }
    for(const item of this.scheduledTransactions){
      if(item.payee.toLocaleLowerCase()===from.toLocaleLowerCase()){item.payee=target;schedules+=1;}
    }
    for(const rule of this.merchantRules){
      if(rule.renameTo?.toLocaleLowerCase()===from.toLocaleLowerCase()){rule.renameTo=target;merchantRules+=1;}
    }
    for(const item of [...this.payeeMemory])if(item.toLocaleLowerCase()===from.toLocaleLowerCase())this.payeeMemory.delete(item);
    this.payeeMemory.add(target);
    return{from,to:target,operation,transactions,splits:0,schedules,budgetCategories:0,merchantRules,catalogRemoved:!same};
  }
  async listTransactions(accountId?: string): Promise<Transaction[]> {
    const rows = accountId ? this.transactions.filter((item) => item.accountId === accountId) : this.transactions;
    return structuredClone([...rows].sort((a, b) => b.postedDate.localeCompare(a.postedDate) || b.id.localeCompare(a.id)).map((item) => this.withAttachmentCount(item)));
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
      if (normalized.flaggedOnly && !item.flagged) return false;
      if (search) {
        const haystack = `${item.payee} ${item.category} ${item.memo ?? ""} ${item.originalPayee ?? ""}`.toLocaleLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    }).sort((a, b) => a.postedDate.localeCompare(b.postedDate) || a.id.localeCompare(b.id));
    const totalCount = matched.length;
    const offset = normalized.newest ? Math.max(0, totalCount - normalized.limit) : Math.min(normalized.offset, totalCount);
    const transactions = matched.slice(offset, offset + normalized.limit).map((item) => this.withAttachmentCount(item));
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
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      ...input,
      flagged: Boolean(input.flagged),
      source: "manual",
      splits: input.splits?.map(split=>({id:crypto.randomUUID(),...split})),
    };
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
    const updated:Transaction={...current,...input,flagged:Boolean(input.flagged),splits:input.splits?.map(split=>({id:crypto.randomUUID(),...split}))};
    this.transactions[index]=updated;
    return structuredClone(updated);
  }
  async updateTransactionAnnotation(id: string, input: TransactionAnnotationInput): Promise<Transaction> {
    const index = this.transactions.findIndex(item => item.id === id);
    if (index < 0) throw new Error("Transaction does not exist");
    if (!input.updateMemo && input.flagged === undefined) throw new Error("Annotation update requires a note and/or flag change");
    const current = this.transactions[index];
    const next = { ...current };
    if (input.updateMemo) {
      const memo = (input.memo ?? "").trim();
      if (memo.length > TRANSACTION_NOTE_MAX_LENGTH) throw new Error("Memo is too long");
      next.memo = memo || undefined;
    }
    if (input.flagged !== undefined) next.flagged = Boolean(input.flagged);
    this.transactions[index] = next;
    return structuredClone(next);
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
    this.clearTransactionAttachmentLinks(id);
  }
  async createTransfer(input: CreateTransferInput): Promise<TransferResult> {
    validateTransferInput(input,this.accounts);
    const linkId=crypto.randomUUID(),fromTransactionId=crypto.randomUUID(),toTransactionId=crypto.randomUUID();
    const from=this.accounts.find(item=>item.id===input.fromAccountId)!,to=this.accounts.find(item=>item.id===input.toAccountId)!;
    this.transactions.unshift(
      {id:fromTransactionId,accountId:from.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${to.name}`,amountMinor:-input.amountMinor,status:input.status,memo:input.memo,flagged:Boolean(input.flagged),source:"transfer",transferLinkId:linkId,transferAccountId:to.id},
      {id:toTransactionId,accountId:to.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${from.name}`,amountMinor:input.amountMinor,status:input.status,memo:input.memo,flagged:Boolean(input.flagged),source:"transfer",transferLinkId:linkId,transferAccountId:from.id}
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
    Object.assign(outgoing,{accountId:from.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${to.name}`,amountMinor:-input.amountMinor,status:input.status,memo:input.memo,flagged:Boolean(input.flagged),transferAccountId:to.id});
    Object.assign(incoming,{accountId:to.id,postedDate:input.postedDate,payee:input.payee,category:`Transfer: ${from.name}`,amountMinor:input.amountMinor,status:input.status,memo:input.memo,flagged:Boolean(input.flagged),transferAccountId:from.id});
    from.balanceMinor-=input.amountMinor;to.balanceMinor+=input.amountMinor;
    return{linkId:id,fromTransactionId:outgoing.id,toTransactionId:incoming.id};
  }
  async deleteTransfer(id:string):Promise<void>{
    const pair=this.transactions.filter(item=>item.transferLinkId===id);
    if(pair.length!==2)throw new Error("Transfer does not exist or is incomplete");
    if(pair.some(item=>this.reconciledTransactionIds.has(item.id)))throw new Error("A reconciled transfer cannot be deleted");
    for(const item of pair){const account=this.accounts.find(account=>account.id===item.accountId);if(account)account.balanceMinor-=item.amountMinor;}
    this.transactions=this.transactions.filter(item=>item.transferLinkId!==id);
    for(const item of pair)this.clearTransactionAttachmentLinks(item.id);
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
    this.clearTransactionAttachmentLinks(ordinary.id);
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
    for (const row of prepared) {
      const originalPayee = (row.originalPayee ?? row.payee).trim().toLocaleLowerCase();
      const duplicate = this.transactions.some((item) => {
        if (item.accountId !== input.accountId) return false;
        if (row.externalId && item.externalId === row.externalId) return true;
        return item.postedDate === row.postedDate
          && item.amountMinor === row.amountMinor
          && ((item.originalPayee ?? item.payee).trim().toLocaleLowerCase() === originalPayee || item.payee.trim().toLocaleLowerCase() === originalPayee);
      });
      if (duplicate) throw new Error(`A matching transaction already exists for ${row.postedDate}. Nothing was imported.`);
    }
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
      memo: row.memo, flagged: false, externalId: row.externalId, originalPayee: row.originalPayee,
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
    const transactionIds = imported.map(row => row.id);
    this.importedTransactionIds.set(batchId, transactionIds);
    return { batchId, importedCount: imported.length, transactionIds };
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
    for (const id of ids) this.clearTransactionAttachmentLinks(id);
    const batchLinks = this.batchAttachmentIds.get(batchId);
    if (batchLinks) {
      const attachmentIds = [...batchLinks];
      this.batchAttachmentIds.delete(batchId);
      for (const attachmentId of attachmentIds) this.garbageCollectAttachment(attachmentId);
    }
    return { batchId, removedCount: removed.length };
  }
  async listTransactionAttachments(transactionId: string): Promise<TransactionAttachment[]> {
    if (!this.transactions.some((item) => item.id === transactionId)) throw new Error("Transaction does not exist");
    const ids = [...(this.transactionAttachmentIds.get(transactionId) ?? [])];
    return ids
      .map((id) => this.attachments.get(id)?.meta)
      .filter((item): item is TransactionAttachment => Boolean(item))
      .map((item) => structuredClone(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async attachBytesToTransaction(input: AttachBytesInput): Promise<TransactionAttachment> {
    const transactionId = input.transactionId.trim();
    if (!transactionId) throw new Error("Transaction is required");
    if (!this.transactions.some((item) => item.id === transactionId)) throw new Error("Transaction does not exist");
    const sourceKind = input.sourceKind ?? "manual";
    if (sourceKind !== "manual" && sourceKind !== "import_retention") throw new Error("Unsupported attachment source");
    const attachment = await this.insertAttachmentBytes(input.originalFilename, input.mediaType, input.contentBase64, sourceKind);
    this.linkTransactionAttachment(transactionId, attachment.id);
    return attachment;
  }
  async detachTransactionAttachment(transactionId: string, attachmentId: string): Promise<void> {
    const linked = this.transactionAttachmentIds.get(transactionId);
    if (!linked?.has(attachmentId)) throw new Error("Attachment is not linked to this transaction");
    linked.delete(attachmentId);
    if (!linked.size) this.transactionAttachmentIds.delete(transactionId);
    this.garbageCollectAttachment(attachmentId);
  }
  async openAttachment(attachmentId: string): Promise<void> {
    if (!this.attachments.has(attachmentId)) throw new Error("Attachment does not exist");
  }
  async retainImportSourceAttachment(input: RetainImportSourceInput): Promise<TransactionAttachment> {
    const batchId = input.importBatchId.trim();
    if (!batchId) throw new Error("Import batch is required");
    const batch = this.importBatches.find((item) => item.id === batchId);
    if (!batch || batch.undoneAt) throw new Error("Import batch does not exist");
    if (!input.transactionIds.length) throw new Error("Select at least one imported transaction");
    for (const transactionId of input.transactionIds) {
      const row = this.transactions.find((item) => item.id === transactionId);
      if (!row || row.importBatchId !== batchId) throw new Error("A selected transaction does not belong to this import batch");
    }
    const attachment = await this.insertAttachmentBytes(input.originalFilename, input.mediaType, input.contentBase64, "import_retention");
    this.linkBatchAttachment(batchId, attachment.id);
    for (const transactionId of input.transactionIds) this.linkTransactionAttachment(transactionId, attachment.id);
    return attachment;
  }
  async pickAndReadAttachmentFile(): Promise<PickedAttachmentFile | null> {
    return null;
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
  if((input.memo??"").length>TRANSACTION_NOTE_MAX_LENGTH)throw new Error("Memo is too long");
  if(!input.splits?.length)return;
  if(input.splits.length<2)throw new Error("A split transaction requires at least two splits");
  if(input.splits.some(split=>!split.category.trim()||split.amountMinor===0))throw new Error("Every split needs a category and non-zero amount");
  if(sumMoney(input.splits.map(split=>split.amountMinor))!==input.amountMinor)throw new Error("Split total does not equal the transaction amount");
}

function validateBulkIds(ids:string[]):string[]{
  if(!ids.length)throw new Error("Select at least one transaction");
  if(ids.length>1000)throw new Error("Bulk actions are limited to 1,000 transactions");
  const seen=new Set<string>();
  const cleaned:string[]=[];
  for(const id of ids){
    const value=id.trim();
    if(!value)throw new Error("Transaction is required");
    if(seen.has(value))throw new Error("A transaction was selected more than once");
    seen.add(value);
    cleaned.push(value);
  }
  return cleaned;
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

function sanitizeAttachmentFilename(value:string):string{
  const name=value.trim().replace(/[\\/]/g,"_").replace(/^\.+|\.+$/g,"").trim();
  if(!name)throw new Error("Original filename is required");
  if([...name].length>260)throw new Error("Original filename is too long");
  if(name.includes("\0"))throw new Error("Original filename is invalid");
  return name;
}

function attachmentExtension(filename:string):string{
  const idx=filename.lastIndexOf(".");
  if(idx<0)return "";
  return filename.slice(idx+1).toLocaleLowerCase();
}

function validateAttachmentExtension(filename:string):void{
  const ext=attachmentExtension(filename);
  if(!(ATTACHMENT_ALLOWED_EXTENSIONS as readonly string[]).includes(ext)){
    throw new Error(`Unsupported attachment type .${ext}`);
  }
}

function inferAttachmentMediaType(filename:string,provided?:string):string{
  const value=provided?.trim();
  if(value){
    if([...value].length>120)throw new Error("Media type is too long");
    return value;
  }
  switch(attachmentExtension(filename)){
    case"pdf":return"application/pdf";
    case"png":return"image/png";
    case"jpg":case"jpeg":return"image/jpeg";
    case"tif":case"tiff":return"image/tiff";
    case"webp":return"image/webp";
    case"xls":return"application/vnd.ms-excel";
    case"xlsx":return"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case"csv":return"text/csv";
    case"tsv":return"text/tab-separated-values";
    case"txt":return"text/plain";
    case"ofx":case"qfx":return"application/x-ofx";
    case"qif":return"application/qif";
    case"xml":return"application/xml";
    default:return"application/octet-stream";
  }
}

function decodeAttachmentBase64(contentBase64:string):Uint8Array{
  try{
    const binary=atob(contentBase64.trim());
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);
    return bytes;
  }catch{
    throw new Error("Attachment content is not valid base64");
  }
}

async function sha256Hex(bytes:Uint8Array):Promise<string>{
  if(globalThis.crypto?.subtle){
    const copy=new Uint8Array(bytes);
    const digest=await crypto.subtle.digest("SHA-256",copy);
    return[...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");
  }
  return `len-${bytes.length}-${bytes[0]??0}-${bytes[bytes.length-1]??0}`;
}
