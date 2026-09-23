// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduleDialog } from "./BillsPage";
import { RuleDialog } from "./RulesPage";
import { TransactionDialog } from "./TransactionDialog";
import {
  duplicateTransactionDraft,
  merchantRuleDraftFromTransaction,
  scheduledDraftFromTransaction,
} from "./transactionReuse";
import type { Account, Transaction } from "./domain";
import * as repositoryModule from "./repository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const accounts: Account[] = [
  { id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 100000, ownerLabel: "Household" },
  { id: "savings", name: "Savings", type: "savings", currency: "USD", balanceMinor: 50000, ownerLabel: "Household" },
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

describe("transaction reuse editor workflows", () => {
  it("opens the transaction editor with a duplicate draft and saves a new transaction", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(repositoryModule.financeRepository, "createTransaction").mockResolvedValue(tx({ id: "copy" }));
    const draft = duplicateTransactionDraft(tx(), "2026-09-23");
    const onSaved = vi.fn(async () => undefined);

    render(<TransactionDialog accounts={accounts} draft={draft} onClose={() => undefined} onSaved={onSaved} />);
    expect(screen.getByRole("heading", { name: "Duplicate transaction" })).toBeTruthy();
    expect((screen.getByLabelText("Payee") as HTMLInputElement).value).toBe("Neighborhood Market");
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("Food: Groceries");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("45.21");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-23");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "checking",
        postedDate: "2026-09-23",
        payee: "Neighborhood Market",
        category: "Food: Groceries",
        amountMinor: -4521,
        status: "cleared",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("opens the schedule editor with a prepared recurring draft and saves the template", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(repositoryModule.financeRepository, "createScheduledTransaction").mockResolvedValue({
      id: "sched-1",
      kind: "transaction",
      accountId: "checking",
      payee: "Neighborhood Market",
      category: "Food: Groceries",
      amountMinor: -4521,
      status: "pending",
      frequency: "monthly",
      anchorDate: "2026-09-23",
      enabled: true,
      autoPost: false,
      archived: false,
    });
    const draft = scheduledDraftFromTransaction(tx(), accounts, "2026-09-23");
    const onSaved = vi.fn(async () => undefined);

    render(<ScheduleDialog accounts={accounts} draft={draft} onClose={() => undefined} onSaved={onSaved} />);
    expect(screen.getByRole("heading", { name: "New scheduled transaction" })).toBeTruthy();
    expect((screen.getByLabelText("Payee or source") as HTMLInputElement).value).toBe("Neighborhood Market");
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("Food: Groceries");
    expect((screen.getByLabelText("Expected amount") as HTMLInputElement).value).toBe("45.21");
    expect((screen.getByLabelText("First due date") as HTMLInputElement).value).toBe("2026-09-23");

    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transaction",
        accountId: "checking",
        payee: "Neighborhood Market",
        category: "Food: Groceries",
        amountMinor: -4521,
        frequency: "monthly",
        anchorDate: "2026-09-23",
        autoPost: false,
        status: "pending",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("opens the merchant-rule editor with a prepared draft and saves the rule", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(repositoryModule.financeRepository, "createMerchantRule").mockResolvedValue({
      id: "rule-1",
      name: "Neighborhood Market rule",
      pattern: "SQ *NEIGHBORHOOD MARKET #42",
      matchType: "contains",
      direction: "expense",
      renameTo: "Neighborhood Market",
      category: "Food: Groceries",
      priority: 100,
      enabled: true,
    });
    const draft = merchantRuleDraftFromTransaction(tx({ originalPayee: "SQ *NEIGHBORHOOD MARKET #42" }));
    const onSaved = vi.fn(async () => undefined);

    render(<RuleDialog draft={draft} onClose={() => undefined} onSaved={onSaved} />);
    expect(screen.getByRole("heading", { name: "Create merchant rule" })).toBeTruthy();
    expect((screen.getByLabelText("Rule name") as HTMLInputElement).value).toBe("Neighborhood Market rule");
    expect((screen.getByLabelText("Bank description contains") as HTMLInputElement).value).toBe("SQ *NEIGHBORHOOD MARKET #42");
    expect((screen.getByLabelText("Rename merchant to") as HTMLInputElement).value).toBe("Neighborhood Market");
    expect((screen.getByLabelText("Assign category") as HTMLInputElement).value).toBe("Food: Groceries");
    expect((screen.getByLabelText("Apply to") as HTMLSelectElement).value).toBe("expense");

    await user.click(screen.getByRole("button", { name: "Save rule" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Neighborhood Market rule",
        pattern: "SQ *NEIGHBORHOOD MARKET #42",
        matchType: "contains",
        direction: "expense",
        renameTo: "Neighborhood Market",
        category: "Food: Groceries",
        priority: 100,
        enabled: true,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
