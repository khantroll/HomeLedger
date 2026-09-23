import type { Account, CreateTransactionInput, MerchantRuleInput, ScheduledTransactionInput, Transaction } from "./domain";

export interface ReuseEligibility {
  duplicate: { allowed: boolean; reason?: string };
  recurring: { allowed: boolean; reason?: string };
  rule: { allowed: boolean; reason?: string };
}

function isAdjustment(transaction: Transaction) {
  return transaction.source === "adjustment";
}

function linkedTransferReason(transaction: Transaction) {
  return transaction.transferLinkId ? "Linked transfers must stay paired and cannot be duplicated as a standalone transaction." : undefined;
}

export function transactionReuseEligibility(transaction: Transaction, accounts: Account[]): ReuseEligibility {
  const linkedReason = linkedTransferReason(transaction);
  const adjustmentReason = isAdjustment(transaction) ? "Balance adjustments are historical ledger corrections, not reusable transactions." : undefined;
  const splitReason = transaction.splits?.length
    ? "Scheduled transactions cannot preserve split lines yet. Duplicate this transaction instead."
    : undefined;

  let recurringTransferReason: string | undefined;
  if (transaction.transferLinkId) {
    const source = accounts.find(account => account.id === transaction.accountId);
    const destination = accounts.find(account => account.id === transaction.transferAccountId);
    if (!transaction.transferAccountId || !source || !destination) {
      recurringTransferReason = "The linked transfer destination is unavailable.";
    } else if (source.type === "investment" || destination.type === "investment") {
      recurringTransferReason = "Ordinary↔investment cash transfers do not have a scheduled-transfer model yet.";
    }
  }

  return {
    duplicate: {
      allowed: !linkedReason && !adjustmentReason,
      reason: linkedReason ?? adjustmentReason,
    },
    recurring: {
      allowed: !adjustmentReason && !splitReason && !recurringTransferReason,
      reason: adjustmentReason ?? splitReason ?? recurringTransferReason,
    },
    rule: {
      allowed: !transaction.transferLinkId && !adjustmentReason,
      reason: transaction.transferLinkId
        ? "Transfer descriptions should not become merchant import rules."
        : adjustmentReason,
    },
  };
}

export function duplicateTransactionDraft(transaction: Transaction, postedDate: string): CreateTransactionInput {
  const eligibility = transactionReuseEligibility(transaction, []);
  if (!eligibility.duplicate.allowed) throw new Error(eligibility.duplicate.reason);

  return {
    accountId: transaction.accountId,
    postedDate,
    payee: transaction.payee,
    category: transaction.splits?.length ? "Split transaction" : transaction.category,
    amountMinor: transaction.amountMinor,
    status: transaction.status === "reconciled" ? "cleared" : transaction.status,
    memo: transaction.memo,
    splits: transaction.splits?.map(split => ({
      category: split.category,
      amountMinor: split.amountMinor,
      memo: split.memo,
    })),
  };
}

export function scheduledDraftFromTransaction(
  transaction: Transaction,
  accounts: Account[],
  anchorDate: string,
): ScheduledTransactionInput {
  const eligibility = transactionReuseEligibility(transaction, accounts);
  if (!eligibility.recurring.allowed) throw new Error(eligibility.recurring.reason);

  if (transaction.transferLinkId) {
    const otherAccountId = transaction.transferAccountId!;
    const fromAccountId = transaction.amountMinor < 0 ? transaction.accountId : otherAccountId;
    const toAccountId = transaction.amountMinor < 0 ? otherAccountId : transaction.accountId;
    return {
      kind: "transfer",
      accountId: fromAccountId,
      transferAccountId: toAccountId,
      payee: transaction.payee,
      category: "Transfer",
      amountMinor: Math.abs(transaction.amountMinor),
      status: "pending",
      memo: transaction.memo,
      frequency: "monthly",
      anchorDate,
      enabled: true,
      autoPost: false,
    };
  }

  return {
    kind: "transaction",
    accountId: transaction.accountId,
    payee: transaction.payee,
    category: transaction.category,
    amountMinor: transaction.amountMinor,
    status: "pending",
    memo: transaction.memo,
    frequency: "monthly",
    anchorDate,
    enabled: true,
    autoPost: false,
  };
}

export function merchantRuleDraftFromTransaction(transaction: Transaction): MerchantRuleInput {
  const eligibility = transactionReuseEligibility(transaction, []);
  if (!eligibility.rule.allowed) throw new Error(eligibility.rule.reason);

  const matchText = transaction.originalPayee?.trim() || transaction.payee.trim();
  return {
    name: `${transaction.payee} rule`,
    pattern: matchText,
    matchType: "contains",
    direction: transaction.amountMinor < 0 ? "expense" : "income",
    renameTo: transaction.payee,
    category: transaction.splits?.length ? undefined : transaction.category,
    priority: 100,
    enabled: true,
  };
}
