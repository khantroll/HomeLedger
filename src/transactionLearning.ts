import type {CreateTransactionInput, FinanceRepository, MerchantRuleInput, Transaction} from "./domain";
import {normalizeMerchant} from "./merchantRules";
import {transactionReuseEligibility} from "./transactionReuse";

/** Only decisions actually changed by the user are candidates for persistent learning. */
export function rememberedCorrectionDraft(before:Transaction, after:CreateTransactionInput):MerchantRuleInput|undefined {
  if(before.status==="reconciled"||!transactionReuseEligibility(before,[]).rule.allowed)return undefined;
  const renameTo=before.payee!==after.payee?after.payee.trim():undefined;
  const category=before.category!==after.category&&!after.splits?.length&&
    after.category!=="Uncategorized"&&after.category!=="Transfer"&&!after.category.startsWith("Transfer:")
    ?after.category.trim():undefined;
  const pattern=before.originalPayee??before.payee;
  if(!normalizeMerchant(pattern)||(!renameTo&&!category))return undefined;
  return{name:`Remember ${after.payee}`.slice(0,80),pattern,matchType:"exact",
    direction:after.amountMinor<0?"expense":"income",renameTo,category,
    priority:1000,enabled:true,origin:"remembered"};
}

/** Share import's exact-description upsert semantics; never replace a manual rule. */
export async function saveRememberedCorrection(repository:Pick<FinanceRepository,"listMerchantRules"|"createMerchantRule"|"updateMerchantRule">, input:MerchantRuleInput){
  const rules=await repository.listMerchantRules();
  const existing=rules.find(rule=>rule.origin==="remembered"&&rule.matchType==="exact"&&
    rule.direction===input.direction&&normalizeMerchant(rule.pattern)===normalizeMerchant(input.pattern));
  return existing?repository.updateMerchantRule(existing.id,{...input,priority:existing.priority}):repository.createMerchantRule(input);
}
