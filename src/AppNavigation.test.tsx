// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import * as repositoryModule from "./repository";
import type { Account, Transaction } from "./domain";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const accounts: Account[] = [
  { id: "checking", name: "Household Checking", institution: "Sample CU", type: "checking", currency: "USD", balanceMinor: 10000, ownerLabel: "Household" },
  { id: "savings", name: "Emergency Savings", type: "savings", currency: "USD", balanceMinor: 20000, ownerLabel: "Household" },
];

const transactions: Transaction[] = [
  { id: "t1", accountId: "checking", postedDate: "2026-09-18", payee: "Payroll", category: "Income", amountMinor: 1000, status: "cleared" },
];

describe("App navigation shell", () => {
  it("keeps Overview summary-only and opens an account register from Accounts", async () => {
    const user = userEvent.setup();
    vi.spyOn(repositoryModule.financeRepository, "listAccounts").mockResolvedValue(accounts);
    vi.spyOn(repositoryModule.financeRepository, "listTransactions").mockResolvedValue(transactions);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledTransactions").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "generateScheduledOccurrences").mockResolvedValue(0);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledOccurrences").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "listTransactionsPage").mockResolvedValue({
      transactions,
      totalCount: 1,
      offset: 0,
      limit: 100,
      priorBalanceMinor: 9000,
    });

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Available cash")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Recent transactions" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.getByText(/Select an account to open its Money-style register/)).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Open register" })[0]);
    expect(await screen.findByRole("heading", { name: "Household Checking" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Register" })).toBeTruthy();
    expect(screen.getByText("Payroll")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Transactions" }));
    expect(await screen.findByRole("heading", { name: "All accounts" })).toBeTruthy();
    expect(screen.getByLabelText("Filter register by account")).toBeTruthy();
  });
});
