import { describe, expect, it } from "vitest";
import type { Account, ScheduledOccurrence, Transaction } from "./domain";
import { resolveFinancialFindLanding } from "./financialFindNavigation";

describe("Financial Find landing integrity", () => {
  const accounts: Account[] = [
    { id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 0, ownerLabel: "Household" },
    { id: "old", name: "Old Checking", type: "checking", currency: "USD", balanceMinor: 0, ownerLabel: "Household", archived: true },
  ];
  const transactions: Transaction[] = [
    { id: "active", accountId: "checking", postedDate: "2026-09-12", payee: "Lowes", category: "Home", amountMinor: -1000, status: "cleared" },
    { id: "historic", accountId: "old", postedDate: "2022-03-01", payee: "LOWES #42", category: "Repairs", amountMinor: -12000, status: "reconciled" },
  ];
  const occurrences: ScheduledOccurrence[] = [
    { id: "later", scheduledTransactionId: "bill", dueDate: "2026-11-01", status: "expected" },
    { id: "next", scheduledTransactionId: "bill", dueDate: "2026-10-01", status: "expected" },
    { id: "done", scheduledTransactionId: "bill", dueDate: "2026-09-01", status: "posted" },
  ];

  it("lands active transactions on the owning account with posted-date focus", () => {
    expect(
      resolveFinancialFindLanding(
        { kind: "transaction", id: "transaction:active", title: "Lowes", detail: "", meta: "", accountId: "checking", transactionId: "active", archived: false, score: 1 },
        { accounts, transactions, occurrences },
      ),
    ).toEqual({
      kind: "intent",
      intent: { page: "Transactions", status: "all", accountId: "checking", transactionId: "active", postedDate: "2026-09-12" },
    });
  });

  it("lands archived-account transactions in the global register without a live archived accountId", () => {
    expect(
      resolveFinancialFindLanding(
        { kind: "transaction", id: "transaction:historic", title: "LOWES #42", detail: "", meta: "", accountId: "old", transactionId: "historic", archived: true, score: 1 },
        { accounts, transactions, occurrences },
      ),
    ).toEqual({
      kind: "intent",
      intent: { page: "Transactions", status: "all", accountId: undefined, transactionId: "historic", postedDate: "2022-03-01" },
    });
  });

  it("prefers the next expected schedule occurrence and falls back to the template anchor", () => {
    expect(
      resolveFinancialFindLanding(
        { kind: "schedule", id: "schedule:bill", title: "Electric", detail: "", meta: "", templateId: "bill", dueDate: "2026-01-01", archived: false, score: 1 },
        { accounts, transactions, occurrences },
      ),
    ).toEqual({ kind: "intent", intent: { page: "Bills", focus: { kind: "day", dueDate: "2026-10-01" } } });

    expect(
      resolveFinancialFindLanding(
        { kind: "schedule", id: "schedule:bill", title: "Electric", detail: "", meta: "", templateId: "bill", dueDate: "2025-06-01", archived: true, score: 1 },
        { accounts, transactions, occurrences: [] },
      ),
    ).toEqual({ kind: "intent", intent: { page: "Bills", focus: { kind: "day", dueDate: "2025-06-01" } } });
  });

  it("sends archived accounts to Accounts and keeps securities account-optional", () => {
    expect(
      resolveFinancialFindLanding(
        { kind: "account", id: "account:old", title: "Old Checking", detail: "", meta: "", accountId: "old", archived: true, score: 1 },
        { accounts, transactions, occurrences },
      ),
    ).toEqual({ kind: "accounts" });

    expect(
      resolveFinancialFindLanding(
        { kind: "security", id: "security:sec", title: "Microsoft", detail: "MSFT", meta: "", securityId: "sec", archived: false, score: 1 },
        { accounts, transactions, occurrences },
      ),
    ).toEqual({ kind: "intent", intent: { page: "Portfolio", focus: { securityId: "sec" } } });
  });
});
