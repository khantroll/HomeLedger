// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoriesPage } from "./CategoriesPage";
import * as repositoryModule from "./repository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CategoriesPage", () => {
  beforeEach(() => {
    vi.spyOn(repositoryModule.financeRepository, "listCategories").mockResolvedValue(["Food: Groceries", "Food: Dining", "Stale: Memory"]);
    vi.spyOn(repositoryModule.financeRepository, "listPayees").mockResolvedValue(["Neighborhood Market", "Corner Cafe"]);
    vi.spyOn(repositoryModule.financeRepository, "listTransactions").mockResolvedValue([
      { id: "t1", accountId: "checking", postedDate: "2026-08-02", payee: "Neighborhood Market", category: "Food: Groceries", amountMinor: -1200, status: "cleared" },
      { id: "t2", accountId: "checking", postedDate: "2026-08-03", payee: "Corner Cafe", category: "Food: Dining", amountMinor: -800, status: "cleared" },
    ]);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledTransactions").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "listBudgetCategories").mockResolvedValue([
      { id: "b1", category: "Food: Groceries", rolloverEnabled: false },
    ]);
    vi.spyOn(repositoryModule.financeRepository, "listMerchantRules").mockResolvedValue([]);
  });

  it("lists category usage and applies a confirmed rename", async () => {
    const user = userEvent.setup();
    const rename = vi.spyOn(repositoryModule.financeRepository, "renameCategory").mockResolvedValue({
      from: "Food: Groceries",
      to: "Food: Market",
      operation: "rename",
      transactions: 1,
      splits: 0,
      schedules: 0,
      budgetCategories: 1,
      merchantRules: 0,
      catalogRemoved: true,
    });
    render(<CategoriesPage />);
    expect(await screen.findByRole("heading", { name: /Categories & payees/i })).toBeTruthy();
    expect(screen.getByText("Food: Groceries")).toBeTruthy();
    expect(screen.getByText("Memory only")).toBeTruthy();

    await user.click(screen.getByText("Food: Groceries").closest("tr")!.querySelector("button")!);
    const input = screen.getByLabelText(/New category name/i);
    await user.clear(input);
    await user.type(input, "Food: Market");
    await user.click(screen.getByRole("button", { name: /Preview rename/i }));
    await user.click(screen.getByRole("button", { name: /Confirm rename/i }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("Food: Groceries", "Food: Market"));
    expect(await screen.findByText(/Renamed “Food: Groceries” → “Food: Market”/i)).toBeTruthy();
  });

  it("cancels without calling merge", async () => {
    const user = userEvent.setup();
    const merge = vi.spyOn(repositoryModule.financeRepository, "mergeCategories").mockResolvedValue({
      from: "Food: Dining",
      to: "Food: Groceries",
      operation: "merge",
      transactions: 1,
      splits: 0,
      schedules: 0,
      budgetCategories: 0,
      merchantRules: 0,
      catalogRemoved: true,
    });
    render(<CategoriesPage />);
    await screen.findByText("Food: Dining");
    await user.click(screen.getAllByRole("button", { name: /Merge/i })[1]);
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(merge).not.toHaveBeenCalled();
  });
});
