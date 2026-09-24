// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetFromHistoryDialog } from "./BudgetFromHistoryDialog";
import { BudgetPage } from "./BudgetPage";
import { financeRepository } from "./repository";
import type { Account, BudgetMonth, Transaction } from "./domain";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const accounts: Account[] = [
  { id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 0, ownerLabel: "Household" },
];

const month: BudgetMonth = {
  month: "2026-09",
  plannedMinor: 30000,
  spentMinor: 0,
  carryInMinor: 0,
  availableMinor: 30000,
  lines: [{ id: "food", category: "Food: Groceries", rolloverEnabled: false, plannedMinor: 30000, spentMinor: 0, carryInMinor: 0, availableMinor: 30000 }],
};

const previous: BudgetMonth = {
  month: "2026-08",
  plannedMinor: 40000,
  spentMinor: 0,
  carryInMinor: 0,
  availableMinor: 40000,
  lines: [{ id: "food", category: "Food: Groceries", rolloverEnabled: true, plannedMinor: 40000, spentMinor: 0, carryInMinor: 0, availableMinor: 40000 }],
};

const transactions: Transaction[] = [
  { id: "a", accountId: "checking", postedDate: "2026-08-10", payee: "Store", category: "Food: Groceries", amountMinor: -22000, status: "cleared" },
  { id: "b", accountId: "checking", postedDate: "2026-07-10", payee: "Store", category: "Food: Groceries", amountMinor: -20000, status: "cleared" },
  { id: "c", accountId: "checking", postedDate: "2026-06-10", payee: "Store", category: "Food: Groceries", amountMinor: -18000, status: "cleared" },
];

describe("Budget from history dialog", () => {
  it("previews a proposal and applies only selected categories", async () => {
    const user = userEvent.setup();
    vi.spyOn(financeRepository, "getBudgetMonth").mockResolvedValue(previous);
    const allocate = vi.spyOn(financeRepository, "setBudgetAllocation").mockResolvedValue();
    const update = vi.spyOn(financeRepository, "updateBudgetCategory").mockResolvedValue({ id: "food", category: "Food: Groceries", rolloverEnabled: true });
    const onApplied = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(
      <BudgetFromHistoryDialog
        month="2026-09"
        currentBudget={month}
        transactions={transactions}
        accounts={accounts}
        schedules={[]}
        occurrences={[]}
        onClose={onClose}
        onApplied={onApplied}
      />,
    );
    expect(await screen.findByRole("dialog", { name: "Plan from history" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Previous month/i }));
    expect(await screen.findByText("$400.00")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Apply 1 selected" }));
    await waitFor(() => expect(allocate).toHaveBeenCalledWith({ budgetCategoryId: "food", month: "2026-09", plannedMinor: 40000 }));
    expect(update).toHaveBeenCalledWith("food", { category: "Food: Groceries", rolloverEnabled: true });
    expect(onApplied).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels without mutating allocations", async () => {
    const user = userEvent.setup();
    vi.spyOn(financeRepository, "getBudgetMonth").mockResolvedValue(previous);
    const allocate = vi.spyOn(financeRepository, "setBudgetAllocation").mockResolvedValue();
    const onClose = vi.fn();
    render(
      <BudgetFromHistoryDialog
        month="2026-09"
        currentBudget={month}
        transactions={transactions}
        accounts={accounts}
        schedules={[]}
        occurrences={[]}
        onClose={onClose}
        onApplied={async () => undefined}
      />,
    );
    await screen.findByRole("dialog", { name: "Plan from history" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(allocate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("BudgetPage history entry", () => {
  it("opens plan-from-history without changing existing budget math controls", async () => {
    const user = userEvent.setup();
    vi.spyOn(financeRepository, "getBudgetMonth").mockResolvedValue(month);
    render(<BudgetPage transactions={transactions} accounts={accounts} />);
    expect(await screen.findByText("Food: Groceries")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Plan from history/ }));
    const dialog = await screen.findByRole("dialog", { name: "Plan from history" });
    expect(within(dialog).getByRole("radio", { name: /3-month average/i })).toBeTruthy();
  });
});
