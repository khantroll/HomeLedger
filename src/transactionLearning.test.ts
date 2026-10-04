import {describe,expect,it} from "vitest";
import {DemoFinanceRepository} from "./demoRepository";
import {rememberedCorrectionDraft,saveRememberedCorrection} from "./transactionLearning";
import {applyMerchantRules} from "./merchantRules";
import {suggestTransferAccountWithEvidence} from "./importReview";
import type {Transaction, ImportTransactionRow} from "./domain";
const before:Transaction={id:"t",accountId:"checking",postedDate:"2026-10-01",payee:"ARKANSAS VALLEY ELEC",category:"Uncategorized",amountMinor:-7995,status:"cleared",source:"manual"};
const corrected={...before,payee:"Arkansas Valley Electric",category:"Utilities: Electric"};
describe("ordinary correction learning uses merchant rules",()=>{
 it("remembers only changed fields and defaults to exact normalized source text",()=>{
  expect(rememberedCorrectionDraft(before,corrected)).toMatchObject({pattern:before.payee,matchType:"exact",origin:"remembered",renameTo:corrected.payee,category:corrected.category});
  expect(rememberedCorrectionDraft({...before,category:"Food"},{...before,category:"Food",payee:"Clean payee"})?.category).toBeUndefined();
  expect(rememberedCorrectionDraft(before,{...before,category:"Food"})?.renameTo).toBeUndefined();
  expect(rememberedCorrectionDraft(before,before)).toBeUndefined();
 });
 it("never learns a linked, reconciled, adjustment or split treatment",()=>{
  for(const patch of [{status:"reconciled" as const},{transferLinkId:"ordinary"},{transferLinkId:"investment"},{source:"adjustment" as const}])expect(rememberedCorrectionDraft({...before,...patch},corrected)).toBeUndefined();
  expect(rememberedCorrectionDraft(before,{...before,category:"Transfer: Chase Visa"})).toBeUndefined();
  expect(rememberedCorrectionDraft(before,{...before,category:"Split transaction",splits:[{category:"A",amountMinor:-7995}]})).toBeUndefined();
 });
 it("saves provenance without creating rules, then remembers explicitly without changing balances",async()=>{
  const repo=new DemoFinanceRepository();
  const tx=await repo.createTransaction({...before});
  const balances=await repo.listAccounts();
  const count=(await repo.listMerchantRules()).length;
  const saved=await repo.updateTransaction(tx.id,corrected);
  expect(saved.originalPayee).toBe(before.payee);
  expect((await repo.listMerchantRules()).length).toBe(count);
  const rule=await saveRememberedCorrection(repo,rememberedCorrectionDraft(tx,corrected)!);
  const recognized=applyMerchantRules([{postedDate:"2026-10-02",payee:before.payee,amountMinor:-7995}],[rule])[0];
  expect(recognized.row).toMatchObject({payee:corrected.payee,category:corrected.category,originalPayee:before.payee});
  expect(await repo.listAccounts()).toEqual(balances);
  expect((await repo.listTransactions()).filter(t=>t.id===tx.id)).toHaveLength(1);
  expect((await repo.updateTransaction(tx.id,{...corrected,payee:"Third label"})).originalPayee).toBe(before.payee);
 });
 it("updates the remembered rule, preserves manual precedence, and supports disable/delete",async()=>{
  const repo=new DemoFinanceRepository(),draft=rememberedCorrectionDraft(before,corrected)!;
  const first=await saveRememberedCorrection(repo,draft);
  const second=await saveRememberedCorrection(repo,{...draft,category:"Utilities"});
  expect(second.id).toBe(first.id);
  const manual=await repo.createMerchantRule({...draft,origin:"manual",priority:-100,category:"Manual"});
  const row:ImportTransactionRow={postedDate:"2026-10-02",payee:before.payee,amountMinor:-7995};
  expect(applyMerchantRules([row],[second,manual])[0].row.category).toBe("Manual");
  await repo.updateMerchantRule(manual.id,{...manual,enabled:false});
  expect(applyMerchantRules([row],await repo.listMerchantRules())[0].row.category).toBe("Utilities");
  await repo.deleteMerchantRule(second.id);
  expect(applyMerchantRules([row],await repo.listMerchantRules())[0].rule).toBeUndefined();
 });
 it("keeps processor learning payee-only and sufficiently specific",()=>{
  const paypal={...before,payee:"PAYPAL *ABC123"};
  const draft=rememberedCorrectionDraft(paypal,{...paypal,payee:"PayPal"})!;
  const rule={id:"paypal",...draft};
  expect(applyMerchantRules<ImportTransactionRow>([{postedDate:"2026-10-02",payee:paypal.payee,amountMinor:-500}],[rule])[0].row.category).toBeUndefined();
  expect(applyMerchantRules([{postedDate:"2026-10-02",payee:"PAYPAL *DIFFERENT",amountMinor:-500}],[rule])[0].rule).toBeUndefined();
 });
 it("recognizes a taught card payee as an advisory transfer without fabricating a counterpart",async()=>{
  const repo=new DemoFinanceRepository();
  const accounts=await repo.listAccounts();
  const card=await repo.createAccount({name:"Chase Visa",type:"credit",currency:"USD",openingBalanceMinor:0,ownerLabel:"Household"});
  const raw={...before,payee:"CHASE CREDIT CRD"};
  const rule={id:"chase",...rememberedCorrectionDraft(raw,{...raw,payee:"Chase Visa"})!};
  const row=applyMerchantRules([{postedDate:raw.postedDate,payee:raw.payee,amountMinor:raw.amountMinor}],[rule])[0].row;
  const prior=await repo.listTransactions();
  expect(suggestTransferAccountWithEvidence(row,"checking",[...accounts,card])?.account.id).toBe(card.id);
  expect(row).not.toHaveProperty("transferAccountId");
  expect(await repo.listTransactions()).toEqual(prior);
 });
});
