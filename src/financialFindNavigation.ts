import type { Account, ScheduledOccurrence, Transaction } from "./domain";
import type { FinancialFindResult } from "./financialFind";
import type { NavigationIntent } from "./navigationIntent";

export type FinancialFindLanding =
  | { kind: "intent"; intent: NavigationIntent }
  | { kind: "accounts" }
  | { kind: "bills" }
  | { kind: "account-destination"; accountId: string };

/**
 * Pure routing for Financial Find selection. Kept outside App.tsx so landings stay
 * testable without mounting the shell, and so focus IDs remain authoritative.
 */
export function resolveFinancialFindLanding(
  result: FinancialFindResult,
  context: {
    accounts: Account[];
    transactions: Transaction[];
    occurrences: ScheduledOccurrence[];
  },
): FinancialFindLanding {
  if (result.kind === "transaction") {
    const source = context.transactions.find((item) => item.id === result.transactionId);
    const account = context.accounts.find((item) => item.id === result.accountId);
    return {
      kind: "intent",
      intent: {
        page: "Transactions",
        status: "all",
        accountId: account && !account.archived ? result.accountId : undefined,
        transactionId: result.transactionId,
        postedDate: source?.postedDate,
      },
    };
  }

  if (result.kind === "schedule") {
    const expected = context.occurrences
      .filter((item) => item.scheduledTransactionId === result.templateId && item.status === "expected")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const due = expected[0]?.dueDate ?? result.dueDate;
    if (!due) return { kind: "bills" };
    return { kind: "intent", intent: { page: "Bills", focus: { kind: "day", dueDate: due } } };
  }

  if (result.kind === "account") {
    if (result.archived) return { kind: "accounts" };
    return { kind: "account-destination", accountId: result.accountId };
  }

  return {
    kind: "intent",
    intent: {
      page: "Portfolio",
      focus: result.accountId
        ? { accountId: result.accountId, securityId: result.securityId }
        : { securityId: result.securityId },
    },
  };
}
