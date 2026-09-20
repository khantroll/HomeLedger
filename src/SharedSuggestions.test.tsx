// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TransactionDialog } from "./TransactionDialog";
import * as repositoryModule from "./repository";
import type { Account } from "./domain";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("shared ledger suggestions", () => {
  it("connects remembered payees and hierarchical categories to transaction entry", async () => {
    vi.spyOn(repositoryModule.financeRepository, "listCategories").mockResolvedValue(["Food: Groceries", "Home: Repairs"]);
    vi.spyOn(repositoryModule.financeRepository, "listPayees").mockResolvedValue(["Neighborhood Market"]);
    const accounts: Account[] = [{ id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 0, ownerLabel: "Household" }];

    const { container } = render(<TransactionDialog accounts={accounts} onClose={() => undefined} onSaved={async () => undefined} />);
    const payee = screen.getByLabelText("Payee");
    const category = screen.getByLabelText("Category");
    expect(payee.getAttribute("list")).toBeTruthy();
    expect(category.getAttribute("list")).toBeTruthy();
    await waitFor(() => expect(container.querySelector('option[value="Neighborhood Market"]')).toBeTruthy());
    expect(container.querySelector('option[value="Food: Groceries"]')).toBeTruthy();
  });
});
