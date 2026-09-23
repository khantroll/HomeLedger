import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "./domain";
import {
  duplicateTransactionDraft,
  merchantRuleDraftFromTransaction,
  scheduledDraftFromTransaction,
  transactionReuseEligibility,
} from "./transactionReuse";

const accounts: Account[] = [
  { id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 100000, ownerLabel: "Household" },
  { id: "savings", name: "Savings", type: "savings", currency: "USD", balanceMinor: 50000, ownerLabel: "Household" },
  { id: "invest", name: "Brokerage", type: "investment", currency: "USD", balanceMinor: 0, ownerLabel: "Household" },
];

function tx(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: "original",
    accountId: "checking",
    postedDate: "2026-01-15",
    payee: "Neighborhood Market",
    category: "Food: Groceries",
    amountMinor: -4521,
    status: "cleared",
    memo: "Weekly groceries",
    source: "manual",
    ...patch,
  };
}

describe("transaction reuse", () => {
  it("duplicates a simple expense as a fresh manual-input shape", () => {
    const draft = duplicateTransactionDraft(tx(), "2026-09-23");
    expect(draft).toEqual({
      accountId: "checking",
      postedDate: "2026-09-23",
      payee: "Neighborhood Market",
      category: "Food: Groceries",
      amountMinor: -4521,
      status: "cleared",
      memo: "Weekly groceries",
      splits: undefined,
    });
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("source");
    expect(draft).not.toHaveProperty("importBatchId");
    expect(draft).not.toHaveProperty("externalId");
    expect(draft).not.toHaveProperty("transferLinkId");
  });

  it("duplicates simple income", () => {
    const draft = duplicateTransactionDraft(tx({ payee: "Employer", category: "Salary", amountMinor: 125000 }), "2026-09-23");
    expect(draft.amountMinor).toBe(125000);
    expect(draft.category).toBe("Salary");
  });

  it("duplicates split structure without split identity", () => {
    const draft = duplicateTransactionDraft(tx({
      category: "Split transaction",
      amountMinor: -6000,
      splits: [
        { id: "s1", category: "Food", amountMinor: -4500, memo: "Groceries" },
        { id: "s2", category: "Household", amountMinor: -1500 },
      ],
    }), "2026-09-23");
    expect(draft.splits).toEqual([
      { category: "Food", amountMinor: -4500, memo: "Groceries" },
      { category: "Household", amountMinor: -1500, memo: undefined },
    ]);
    expect(draft.splits?.[0]).not.toHaveProperty("id");
  });

  it("duplicates a paycheck-like mixed-direction split exactly", () => {
    const source = tx({
      payee: "Employer Payroll",
      category: "Split transaction",
      amountMinor: 210000,
      splits: [
        { id: "gross", category: "Salary: Gross", amountMinor: 300000 },
        { id: "tax", category: "Taxes: Withholding", amountMinor: -65000 },
        { id: "insurance", category: "Insurance: Health", amountMinor: -25000, memo: "Employee premium" },
      ],
    });
    const draft = duplicateTransactionDraft(source, "2026-09-23");
    expect(draft.amountMinor).toBe(210000);
    expect(draft.splits?.map(split => split.amountMinor)).toEqual([300000, -65000, -25000]);
  });

  it("drops reconciliation/import/link provenance and never carries reconciled status", () => {
    const imported = tx({
      status: "reconciled",
      source: "import",
      importBatchId: "batch",
      externalId: "bank-id",
      originalPayee: "RAW PAYEE",
    });
    const draft = duplicateTransactionDraft(imported, "2026-09-23");
    expect(draft.status).toBe("cleared");
    expect(draft).not.toHaveProperty("importBatchId");
    expect(draft).not.toHaveProperty("externalId");
    expect(draft).not.toHaveProperty("originalPayee");
  });

  it("rejects naive duplication of a linked transfer leg", () => {
    const source = tx({ source: "transfer", transferLinkId: "link", transferAccountId: "savings" });
    expect(transactionReuseEligibility(source, accounts).duplicate.allowed).toBe(false);
    expect(() => duplicateTransactionDraft(source, "2026-09-23")).toThrow(/stay paired/);
  });

  it("prefills a supported ordinary transaction schedule and leaves recurrence reviewable", () => {
    const draft = scheduledDraftFromTransaction(tx(), accounts, "2026-09-23");
    expect(draft).toMatchObject({
      kind: "transaction",
      accountId: "checking",
      payee: "Neighborhood Market",
      category: "Food: Groceries",
      amountMinor: -4521,
      frequency: "monthly",
      anchorDate: "2026-09-23",
      autoPost: false,
      status: "pending",
    });
  });

  it("uses transfer-aware scheduling for ordinary linked transfers", () => {
    const source = tx({ amountMinor: 10000, source: "transfer", transferLinkId: "link", transferAccountId: "savings" });
    const draft = scheduledDraftFromTransaction(source, accounts, "2026-09-23");
    expect(draft).toMatchObject({ kind: "transfer", accountId: "savings", transferAccountId: "checking", amountMinor: 10000 });
  });

  it("refuses recurring splits and cross-domain transfers honestly", () => {
    const split = tx({ splits: [{ id: "s1", category: "Salary", amountMinor: 1000 }] });
    expect(transactionReuseEligibility(split, accounts).recurring.allowed).toBe(false);
    expect(() => scheduledDraftFromTransaction(split, accounts, "2026-09-23")).toThrow(/cannot preserve split/);

    const crossDomain = tx({ source: "transfer", transferLinkId: "link", transferAccountId: "invest" });
    expect(transactionReuseEligibility(crossDomain, accounts).recurring.allowed).toBe(false);
  });

  it("prefills an existing merchant-rule shape from imported source text", () => {
    const draft = merchantRuleDraftFromTransaction(tx({ originalPayee: "SQ *NEIGHBORHOOD MARKET #42" }));
    expect(draft).toEqual({
      name: "Neighborhood Market rule",
      pattern: "SQ *NEIGHBORHOOD MARKET #42",
      matchType: "contains",
      direction: "expense",
      renameTo: "Neighborhood Market",
      category: "Food: Groceries",
      priority: 100,
      enabled: true,
    });
  });

  it("does not fake a split category when creating a merchant rule", () => {
    const draft = merchantRuleDraftFromTransaction(tx({
      category: "Split transaction",
      splits: [{ id: "s1", category: "Food", amountMinor: -4521 }],
    }));
    expect(draft.category).toBeUndefined();
  });
});
