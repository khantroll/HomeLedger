import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";

describe("finance repository contract", () => {
  it("creates an account and persists it for the repository lifetime", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({
      name: "Test Account", type: "checking", currency: "USD",
      openingBalanceMinor: 10000, ownerLabel: "Household"
    });
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(10000);
  });

  it("updates the computed account balance after a transaction", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({
      name: "Test Account", type: "checking", currency: "USD",
      openingBalanceMinor: 10000, ownerLabel: "Household"
    });
    await repository.createTransaction({
      accountId: account.id, postedDate: "2026-09-18", payee: "Test Payee",
      category: "Test", amountMinor: -2500, status: "cleared"
    });
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(7500);
  });

  it("retains import history and reverses a complete batch", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Import Account", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const result = await repository.importTransactions({ accountId: account.id, sourceName: "statement.csv", rows: [
      { postedDate: "2026-09-01", payee: "Store", amountMinor: -2500 },
      { postedDate: "2026-09-02", payee: "Payroll", amountMinor: 5000 }
    ] });
    expect((await repository.listImportBatches())[0]).toMatchObject({ transactionCount: 2, totalMinor: 2500 });
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(12500);
    expect((await repository.undoImportBatch(result.batchId)).removedCount).toBe(2);
    expect((await repository.listAccounts()).find(item => item.id === account.id)?.balanceMinor).toBe(10000);
    expect((await repository.listImportBatches())[0].undoneAt).toBeTruthy();
  });

  it("creates, edits, and deletes balanced split transactions", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Split Account", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const transaction = await repository.createTransaction({ accountId: account.id, postedDate: "2026-09-18", payee: "Store", category: "Split transaction", amountMinor: -3000, status: "cleared", splits: [
      { category: "Food", amountMinor: -2000 }, { category: "Household", amountMinor: -1000 }
    ] });
    expect(transaction.splits).toHaveLength(2);
    const updated = await repository.updateTransaction(transaction.id, { accountId: account.id, postedDate: "2026-09-18", payee: "Store", category: "Food", amountMinor: -2500, status: "cleared" });
    expect(updated).toMatchObject({ amountMinor: -2500, category: "Food" });
    await repository.deleteTransaction(transaction.id);
    expect((await repository.listTransactions()).some(item=>item.id===transaction.id)).toBe(false);
    expect((await repository.listAccounts()).find(item=>item.id===account.id)?.balanceMinor).toBe(10000);
  });

  it("creates, synchronizes, and deletes both sides of a linked transfer", async () => {
    const repository = new DemoFinanceRepository();
    const from = await repository.createAccount({ name: "Checking", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const to = await repository.createAccount({ name: "Savings", type: "savings", currency: "USD", openingBalanceMinor: 2000, ownerLabel: "Household" });
    const transfer = await repository.createTransfer({ fromAccountId: from.id, toAccountId: to.id, postedDate: "2026-09-18", payee: "Savings transfer", amountMinor: 2500, status: "cleared" });
    let pair = (await repository.listTransactions()).filter(item=>item.transferLinkId===transfer.linkId);
    expect(pair.map(item=>item.amountMinor).sort((a,b)=>a-b)).toEqual([-2500,2500]);
    expect((await repository.listAccounts()).find(item=>item.id===from.id)?.balanceMinor).toBe(7500);
    expect((await repository.listAccounts()).find(item=>item.id===to.id)?.balanceMinor).toBe(4500);
    await expect(repository.updateTransaction(pair[0].id,{accountId:from.id,postedDate:"2026-09-18",payee:"Bad edit",category:"Transfer",amountMinor:-100,status:"cleared"})).rejects.toThrow("transfer editor");
    await repository.updateTransfer(transfer.linkId,{fromAccountId:from.id,toAccountId:to.id,postedDate:"2026-09-19",payee:"Updated transfer",amountMinor:1000,status:"cleared"});
    pair = (await repository.listTransactions()).filter(item=>item.transferLinkId===transfer.linkId);
    expect(pair.map(item=>item.amountMinor).sort((a,b)=>a-b)).toEqual([-1000,1000]);
    expect(pair.every(item=>item.status==="cleared")).toBe(true);
    await repository.deleteTransfer(transfer.linkId);
    expect((await repository.listTransactions()).some(item=>item.transferLinkId===transfer.linkId)).toBe(false);
    expect((await repository.listAccounts()).find(item=>item.id===from.id)?.balanceMinor).toBe(10000);
    expect((await repository.listAccounts()).find(item=>item.id===to.id)?.balanceMinor).toBe(2000);
  });

  it("rejects cross-currency linked transfers", async () => {
    const repository = new DemoFinanceRepository();
    const usd = await repository.createAccount({ name: "USD", type: "checking", currency: "USD", openingBalanceMinor: 0, ownerLabel: "Household" });
    const eur = await repository.createAccount({ name: "EUR", type: "checking", currency: "EUR", openingBalanceMinor: 0, ownerLabel: "Household" });
    await expect(repository.createTransfer({fromAccountId:usd.id,toAccountId:eur.id,postedDate:"2026-09-18",payee:"FX",amountMinor:100,status:"cleared"})).rejects.toThrow("different currencies");
  });

  it("completes a balanced statement reconciliation and protects its transactions", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Checking", type: "checking", currency: "USD", openingBalanceMinor: 10000, ownerLabel: "Household" });
    const deposit = await repository.createTransaction({ accountId: account.id, postedDate: "2026-09-01", payee: "Deposit", category: "Income", amountMinor: 5000, status: "cleared" });
    const purchase = await repository.createTransaction({ accountId: account.id, postedDate: "2026-09-02", payee: "Store", category: "Food", amountMinor: -1250, status: "review" });
    await expect(repository.completeReconciliation({ accountId: account.id, statementEndDate: "2026-09-30", openingBalanceMinor: 10000, closingBalanceMinor: 14000, transactionIds: [deposit.id, purchase.id] })).rejects.toThrow("closing balance");
    const result = await repository.completeReconciliation({ accountId: account.id, statementEndDate: "2026-09-30", openingBalanceMinor: 10000, closingBalanceMinor: 13750, transactionIds: [deposit.id, purchase.id] });
    expect(result).toMatchObject({ transactionCount: 2, adjustmentTotalMinor: 3750 });
    expect((await repository.listReconciliationTransactions(account.id, "2026-09-30"))).toHaveLength(0);
    expect((await repository.listReconciliations(account.id))).toHaveLength(1);
    await expect(repository.updateTransaction(purchase.id, { accountId: account.id, postedDate: "2026-09-02", payee: "Store", category: "Food", amountMinor: -1250, status: "cleared" })).rejects.toThrow("cannot be edited");
    await expect(repository.deleteTransaction(purchase.id)).rejects.toThrow("cannot be deleted");
  });

  it("applies managed merchant rules during import while retaining the bank description", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({name:"Rules Account",type:"checking",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const rule = await repository.createMerchantRule({name:"Market",pattern:"NEIGHBORHOOD MARKET",matchType:"contains",direction:"expense",renameTo:"Neighborhood Market",category:"Food: Groceries",priority:100,enabled:true});
    await repository.importTransactions({accountId:account.id,sourceName:"rules.csv",rows:[{postedDate:"2026-09-18",payee:"SQ *NEIGHBORHOOD MARKET #42",amountMinor:-1250}]});
    expect((await repository.listTransactions(account.id))[0]).toMatchObject({payee:"Neighborhood Market",originalPayee:"SQ *NEIGHBORHOOD MARKET #42",category:"Food: Groceries"});
    await repository.updateMerchantRule(rule.id,{...rule,name:"Disabled",enabled:false});
    expect((await repository.listMerchantRules())[0]).toMatchObject({name:"Disabled",enabled:false});
    await repository.deleteMerchantRule(rule.id);
    expect(await repository.listMerchantRules()).toHaveLength(0);
  });

  it("saves, updates, and deletes reusable import profiles",async()=>{
    const repository=new DemoFinanceRepository();
    const account=await repository.createAccount({name:"Profile Account",type:"checking",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const input={name:"Credit Union CSV",accountId:account.id,headerSignature:"date\u001fdescription\u001famount",dateColumn:0,payeeColumn:1,amountColumn:2,debitColumn:-1,creditColumn:-1,dateOrder:"mdy" as const,numberFormat:"dot" as const};
    const saved=await repository.saveImportProfile(input);
    expect((await repository.listImportProfiles())[0]).toMatchObject(input);
    const updated=await repository.saveImportProfile({...input,amountColumn:-1,debitColumn:2,creditColumn:3});
    expect(updated.id).toBe(saved.id);
    expect(await repository.listImportProfiles()).toHaveLength(1);
    await repository.deleteImportProfile(saved.id);
    expect(await repository.listImportProfiles()).toHaveLength(0);
  });

  it("creates templates and generates idempotent occurrences across overlapping windows", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name: "Bills", type: "checking", currency: "USD", openingBalanceMinor: 0, ownerLabel: "Household" });
    const template = await repository.createScheduledTransaction({ kind:"transaction", accountId:account.id, payee:"Rent", category:"Housing", amountMinor:-100000, status:"pending", frequency:"monthly", anchorDate:"2026-01-31", enabled:true });
    expect(await repository.generateScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31"})).toBe(3);
    expect(await repository.generateScheduledOccurrences({fromDate:"2026-02-01",toDate:"2026-04-30"})).toBe(1);
    const occurrences=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-04-30",scheduledTransactionId:template.id});
    expect(occurrences.map(item=>item.dueDate)).toEqual(["2026-01-31","2026-02-28","2026-03-31","2026-04-30"]);
    expect(new Set(occurrences.map(item=>`${item.scheduledTransactionId}:${item.dueDate}`)).size).toBe(4);
  });

  it("posts, skips, and links expected scheduled occurrences", async () => {
    const repository = new DemoFinanceRepository();
    const account = await repository.createAccount({ name:"Checking", type:"checking", currency:"USD", openingBalanceMinor:10000, ownerLabel:"Household" });
    const template = await repository.createScheduledTransaction({ kind:"transaction", accountId:account.id, payee:"Utility", category:"Utilities", amountMinor:-2500, status:"pending", frequency:"monthly", anchorDate:"2026-01-15", enabled:true });
    await repository.generateScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:template.id});
    const occurrences=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:template.id});
    const posted=await repository.postScheduledOccurrence(occurrences[0].id);
    expect(posted).toMatchObject({postedDate:"2026-01-15",amountMinor:-2500});
    expect((await repository.listAccounts()).find(item=>item.id===account.id)?.balanceMinor).toBe(7500);
    expect(await repository.skipScheduledOccurrence(occurrences[1].id)).toMatchObject({status:"skipped"});
    const existing=await repository.createTransaction({accountId:account.id,postedDate:"2026-03-16",payee:"Utility payment",category:"Utilities",amountMinor:-2500,status:"cleared"});
    expect(await repository.linkScheduledOccurrence(occurrences[2].id,existing.id)).toMatchObject({status:"linked",transactionId:existing.id});
    await expect(repository.deleteTransaction(existing.id)).rejects.toThrow("scheduled occurrences");
    await expect(repository.postScheduledOccurrence(occurrences[0].id)).rejects.toThrow("expected");
  });

  it("offers scheduled matches and links an explicitly selected import atomically", async()=>{
    const repository=new DemoFinanceRepository();
    const account=await repository.createAccount({name:"Checking",type:"checking",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const template=await repository.createScheduledTransaction({kind:"transaction",accountId:account.id,payee:"Electric Utility",category:"Utilities",amountMinor:-10000,status:"pending",frequency:"monthly",anchorDate:"2026-09-15",enabled:true});
    await repository.generateScheduledOccurrences({fromDate:"2026-09-01",toDate:"2026-09-30",scheduledTransactionId:template.id});
    const [match]=await repository.findScheduledOccurrenceMatches({accountId:account.id,rows:[{sourceRow:2,postedDate:"2026-09-16",payee:"ELECTRIC UTILITY PAYMENT",amountMinor:-10300}]});
    expect(match.candidates[0]).toMatchObject({scheduledTransactionId:template.id,confidence:"probable",dateDifferenceDays:1,amountDifferenceMinor:300});
    const occurrenceId=match.candidates[0].occurrenceId;
    await repository.importTransactions({accountId:account.id,sourceName:"statement.csv",rows:[{postedDate:"2026-09-16",payee:"ELECTRIC UTILITY PAYMENT",amountMinor:-10300,scheduledOccurrenceId:occurrenceId}]});
    const [occurrence]=await repository.listScheduledOccurrences({fromDate:"2026-09-01",toDate:"2026-09-30",scheduledTransactionId:template.id});
    expect(occurrence).toMatchObject({status:"linked"});
    expect(occurrence.transactionId).toBeTruthy();
    await expect(repository.undoImportBatch((await repository.listImportBatches())[0].id)).rejects.toThrow("scheduled occurrences");
  });

  it("rejects a stale or reused scheduled occurrence before changing the demo ledger",async()=>{
    const repository=new DemoFinanceRepository();
    const account=await repository.createAccount({name:"Checking",type:"checking",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const template=await repository.createScheduledTransaction({kind:"transaction",accountId:account.id,payee:"Rent",category:"Housing",amountMinor:-100000,status:"pending",frequency:"monthly",anchorDate:"2026-09-01",enabled:true});
    await repository.generateScheduledOccurrences({fromDate:"2026-09-01",toDate:"2026-09-30",scheduledTransactionId:template.id});
    const [occurrence]=await repository.listScheduledOccurrences({fromDate:"2026-09-01",toDate:"2026-09-30",scheduledTransactionId:template.id});
    await expect(repository.importTransactions({accountId:account.id,sourceName:"bad.csv",rows:[
      {postedDate:"2026-09-01",payee:"Rent",amountMinor:-100000,scheduledOccurrenceId:occurrence.id},
      {postedDate:"2026-09-02",payee:"Rent",amountMinor:-100000,scheduledOccurrenceId:occurrence.id},
    ]})).rejects.toThrow("more than once");
    expect(await repository.listImportBatches()).toHaveLength(0);
    expect((await repository.listScheduledOccurrences({fromDate:"2026-09-01",toDate:"2026-09-30"}))[0].status).toBe("expected");
  });

  it("persists monthly budgets and carries sinking-fund availability",async()=>{
    const repository=new DemoFinanceRepository();
    const account=await repository.createAccount({name:"Budget checking",type:"checking",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const category=await repository.createBudgetCategory({category:"Home: Repairs",rolloverEnabled:true});
    await repository.setBudgetAllocation({budgetCategoryId:category.id,month:"2026-08",plannedMinor:10000});
    await repository.setBudgetAllocation({budgetCategoryId:category.id,month:"2026-09",plannedMinor:10000});
    await repository.createTransaction({accountId:account.id,postedDate:"2026-08-10",payee:"Hardware",category:"Home: Repairs",amountMinor:-2500,status:"cleared"});
    await repository.createTransaction({accountId:account.id,postedDate:"2026-09-10",payee:"Hardware",category:"Home: Repairs",amountMinor:-2000,status:"cleared"});
    expect((await repository.getBudgetMonth("2026-09")).lines[0]).toMatchObject({plannedMinor:10000,spentMinor:2000,carryInMinor:7500,availableMinor:15500});
    await repository.updateBudgetCategory(category.id,{category:"Home: Maintenance",rolloverEnabled:false});
    expect((await repository.listBudgetCategories())[0]).toMatchObject({category:"Home: Maintenance",rolloverEnabled:false});
    await repository.deleteBudgetCategory(category.id);
    expect((await repository.getBudgetMonth("2026-09")).lines).toHaveLength(0);
  });

  it("posts recurring transfers as a balanced linked pair", async () => {
    const repository = new DemoFinanceRepository();
    const from=await repository.createAccount({name:"Checking",type:"checking",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const to=await repository.createAccount({name:"Savings",type:"savings",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
    const template=await repository.createScheduledTransaction({kind:"transfer",accountId:from.id,transferAccountId:to.id,payee:"Monthly savings",category:"Transfer",amountMinor:5000,status:"pending",frequency:"monthly",anchorDate:"2026-01-01",enabled:true,autoPost:true});
    expect(template).toMatchObject({kind:"transfer",accountId:from.id,transferAccountId:to.id});
    await repository.generateScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-02-28",scheduledTransactionId:template.id});
    const [occurrence,nextOccurrence]=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-02-28",scheduledTransactionId:template.id});
    const outgoing=await repository.postScheduledOccurrence(occurrence.id);
    const pair=(await repository.listTransactions()).filter(item=>item.transferLinkId===outgoing.transferLinkId);
    expect(pair).toHaveLength(2);expect(pair.reduce((total,item)=>total+item.amountMinor,0)).toBe(0);
    await expect(repository.processScheduledAutoPost({occurrenceIds:[nextOccurrence.id],asOfDate:"2026-02-01"})).resolves.toEqual({postedCount:1});
    expect((await repository.listTransactions()).filter(item=>item.source==="transfer")).toHaveLength(4);
    expect((await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-02-28"})).every(item=>item.status==="posted")).toBe(true);
  });

  it("reviews auto-post selections atomically and rejects future or stale items",async()=>{
    const repository=new DemoFinanceRepository();
    const account=await repository.createAccount({name:"Checking",type:"checking",currency:"USD",openingBalanceMinor:10000,ownerLabel:"Household"});
    const template=await repository.createScheduledTransaction({kind:"transaction",accountId:account.id,payee:"Membership",category:"Subscriptions",amountMinor:-1000,status:"pending",frequency:"monthly",anchorDate:"2026-01-10",enabled:true,autoPost:true});
    await repository.generateScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-02-28",scheduledTransactionId:template.id});
    const rows=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-02-28"});
    const before=(await repository.listTransactions()).length;
    await expect(repository.processScheduledAutoPost({occurrenceIds:rows.map(item=>item.id),asOfDate:"2026-01-31"})).rejects.toThrow("eligible");
    expect(await repository.listTransactions()).toHaveLength(before);
    expect((await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-02-28"})).every(item=>item.status==="expected")).toBe(true);
    await expect(repository.processScheduledAutoPost({occurrenceIds:[rows[0].id,rows[0].id],asOfDate:"2026-01-31"})).rejects.toThrow("more than once");
    await expect(repository.processScheduledAutoPost({occurrenceIds:[rows[0].id],asOfDate:"2026-01-31"})).resolves.toEqual({postedCount:1});
  });

  it("pauses, resumes, and archives schedules without losing terminal occurrence history",async()=>{
    const repository=new DemoFinanceRepository();
    const account=await repository.createAccount({name:"Checking",type:"checking",currency:"USD",openingBalanceMinor:10000,ownerLabel:"Household"});
    const template=await repository.createScheduledTransaction({kind:"transaction",accountId:account.id,payee:"Membership",category:"Subscriptions",amountMinor:-1000,status:"pending",frequency:"monthly",anchorDate:"2026-01-10",enabled:true});
    await repository.generateScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:template.id});
    let occurrences=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:template.id});
    await repository.postScheduledOccurrence(occurrences[0].id);
    await repository.skipScheduledOccurrence(occurrences[1].id);
    const{id,archived:_archived,...input}=template;
    await repository.updateScheduledTransaction(id,{...input,enabled:false});
    occurrences=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:id});
    expect(occurrences.map(item=>item.status)).toEqual(["posted","skipped"]);
    await repository.updateScheduledTransaction(id,{...input,enabled:true});
    expect(await repository.generateScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:id})).toBe(1);
    await repository.deleteScheduledTransaction(id);
    occurrences=await repository.listScheduledOccurrences({fromDate:"2026-01-01",toDate:"2026-03-31",scheduledTransactionId:id});
    expect(occurrences.map(item=>item.status)).toEqual(["posted","skipped"]);
    expect((await repository.listScheduledTransactions()).find(item=>item.id===id)?.archived).toBe(true);
  });
});
