import type { Transaction, TransactionStatus } from "./domain";
import { isRememberedCategoryLabel } from "./labelVocabulary";

export type BulkEditableStatus = Exclude<TransactionStatus, "reconciled">;

export interface RegisterBulkEligibility {
  category: boolean;
  status: boolean;
  delete: boolean;
  reasons: string[];
}

/** Frontend soft eligibility — native/demo commands revalidate authoritatively. */
export function registerBulkEligibility(transaction: Transaction, scheduledLinkedIds?: ReadonlySet<string>): RegisterBulkEligibility {
  const reasons: string[] = [];
  const reconciled = transaction.status === "reconciled";
  const transfer = Boolean(transaction.transferLinkId) || transaction.source === "transfer";
  const split = Boolean(transaction.splits?.length) || transaction.category === "Split transaction";
  const imported = Boolean(transaction.importBatchId);
  const scheduled = scheduledLinkedIds?.has(transaction.id) ?? false;
  const reserved = !isRememberedCategoryLabel(transaction.category) && !split;

  if (reconciled) reasons.push("Reconciled");
  if (transfer) reasons.push("Transfer");
  if (scheduled) reasons.push("Scheduled link");
  if (imported) reasons.push("Imported");
  if (split) reasons.push("Split");

  return {
    category: !reconciled && !transfer && !scheduled && !split && !reserved,
    status: !reconciled && !transfer && !scheduled,
    delete: !reconciled && !transfer && !scheduled && !imported,
    reasons,
  };
}

export function selectedIdsEligibleFor(
  transactions: readonly Transaction[],
  selectedIds: ReadonlySet<string>,
  action: "category" | "status" | "delete",
): { eligibleIds: string[]; blocked: Transaction[] } {
  const eligibleIds: string[] = [];
  const blocked: Transaction[] = [];
  for (const transaction of transactions) {
    if (!selectedIds.has(transaction.id)) continue;
    const eligibility = registerBulkEligibility(transaction);
    if (eligibility[action]) eligibleIds.push(transaction.id);
    else blocked.push(transaction);
  }
  return { eligibleIds, blocked };
}

export function normalizeBulkStatus(value: string): BulkEditableStatus {
  if (value === "pending" || value === "cleared" || value === "review") return value;
  throw new Error("Unsupported transaction status");
}
