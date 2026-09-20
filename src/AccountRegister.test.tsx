// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountRegister } from "./AccountRegister";
import { REGISTER_PAGE_SIZE, type Account, type Transaction, type TransactionPage } from "./domain";
import * as repositoryModule from "./repository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const accounts: Account[] = [
  { id: "checking", name: "Household Checking", institution: "Sample CU", type: "checking", currency: "USD", balanceMinor: 50000, ownerLabel: "Household" },
  { id: "savings", name: "Emergency Savings", type: "savings", currency: "USD", balanceMinor: 200000, ownerLabel: "Household" },
];

function tx(changes: Partial<Transaction>): Transaction {
  return {
    id: changes.id ?? "t",
    accountId: changes.accountId ?? "checking",
    postedDate: changes.postedDate ?? "2026-09-01",
    payee: changes.payee ?? "Payee",
    category: changes.category ?? "Category",
    amountMinor: changes.amountMinor ?? -100,
    status: changes.status ?? "cleared",
    ...changes,
  };
}

describe("AccountRegister", () => {
  beforeEach(() => {
    vi.spyOn(repositoryModule.financeRepository, "listTransactionsPage").mockResolvedValue({
      transactions: [
        tx({ id: "older", postedDate: "2026-09-01", payee: "Utility", category: "Housing", amountMinor: -2500, status: "cleared" }),
        tx({
          id: "transfer",
          postedDate: "2026-09-02",
          payee: "Transfer to savings",
          category: "Transfer",
          amountMinor: -5000,
          status: "pending",
          transferLinkId: "link-1",
          transferAccountId: "savings",
          source: "transfer",
        }),
        tx({
          id: "split",
          postedDate: "2026-09-03",
          payee: "Warehouse Club",
          category: "Split transaction",
          amountMinor: -8000,
          status: "review",
          splits: [
            { id: "s1", category: "Food", amountMinor: -5000 },
            { id: "s2", category: "Household", amountMinor: -3000 },
          ],
        }),
      ],
      totalCount: 3,
      offset: 0,
      limit: REGISTER_PAGE_SIZE,
      priorBalanceMinor: 65500,
    });
  });

  it("opens a locked account register with balance, running balances, transfers, and splits", async () => {
    const onRequestDialog = vi.fn();
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={onRequestDialog} />);
    expect(await screen.findByRole("heading", { name: "Household Checking" })).toBeTruthy();
    expect(screen.getAllByText("$500.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Utility")).toBeTruthy();
    expect(screen.getByText(/Transfer · Emergency Savings/)).toBeTruthy();
    expect(screen.getByText("2 splits")).toBeTruthy();
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(screen.getByText("$630.00")).toBeTruthy();
    expect(screen.getByText("$580.00")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" }).at(-1)!);
    expect(onRequestDialog).toHaveBeenCalledWith(expect.objectContaining({ kind: "transaction", transaction: expect.objectContaining({ id: "split" }) }));
    await userEvent.click(screen.getAllByRole("button", { name: "Transfer" })[0]);
    expect(onRequestDialog).toHaveBeenCalledWith(expect.objectContaining({ kind: "transfer" }));
    await userEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    expect(onRequestDialog).toHaveBeenCalledWith(expect.objectContaining({ kind: "reconciliation", account: expect.objectContaining({ id: "checking" }) }));
    await userEvent.click(screen.getByRole("button", { name: "+ New transaction" }));
    expect(onRequestDialog).toHaveBeenCalledWith(expect.objectContaining({ kind: "transaction", accountId: "checking" }));
  });

  it("filters the register by status and search", async () => {
    const user = userEvent.setup();
    const list = vi.mocked(repositoryModule.financeRepository.listTransactionsPage);
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    await screen.findByText("Utility");
    await user.selectOptions(screen.getByLabelText("Filter register by status"), "review");
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "review", accountId: "checking", newest: true }));
    await user.type(screen.getByLabelText("Search register"), "Warehouse");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Warehouse", status: "review" }));
  });

  it("loads earlier history beyond the current page", async () => {
    const user = userEvent.setup();
    const older = Array.from({ length: 100 }, (_, index) =>
      tx({
        id: `old-${String(index).padStart(3, "0")}`,
        postedDate: `2025-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
        payee: `Older ${index}`,
        amountMinor: -100,
      }),
    );
    const newer = Array.from({ length: 100 }, (_, index) =>
      tx({
        id: `new-${String(index).padStart(3, "0")}`,
        postedDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
        payee: `Newer ${index}`,
        amountMinor: -100,
      }),
    );
    const list = vi.spyOn(repositoryModule.financeRepository, "listTransactionsPage").mockImplementation(async (query = {}) => {
      if (query.newest) {
        return { transactions: newer, totalCount: 200, offset: 100, limit: 100, priorBalanceMinor: 10000 } satisfies TransactionPage;
      }
      return { transactions: older, totalCount: 200, offset: 0, limit: 100, priorBalanceMinor: 0 } satisfies TransactionPage;
    });
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    expect(await screen.findByText("Newer 0")).toBeTruthy();
    expect(screen.getByText(/Showing 101–200 of 200/)).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: /Load earlier history/ })[0]);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 100 }));
    expect(await screen.findByText("Older 0")).toBeTruthy();
    expect(screen.getByText("Newer 99")).toBeTruthy();
  });

  it("supports the global transactions view without a locked account", async () => {
    render(<AccountRegister accounts={accounts} onRequestDialog={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "All accounts" })).toBeTruthy();
    const accountFilter = screen.getByLabelText("Filter register by account");
    expect(within(accountFilter).getByRole("option", { name: "All accounts" })).toBeTruthy();
    await userEvent.selectOptions(accountFilter, "savings");
    expect(repositoryModule.financeRepository.listTransactionsPage).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "savings", newest: true }));
  });

  it("hides the Balance column under status filters that skip ledger rows", async () => {
    const user = userEvent.setup();
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    expect(await screen.findByRole("columnheader", { name: "Balance" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Filter register by status"), "review");
    expect(await screen.findByText(/Running balance hides while a status filter is active/)).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Balance" })).toBeNull();
  });

  it("hides Transfer and Reconcile in the global all-accounts view", async () => {
    render(<AccountRegister accounts={accounts} onRequestDialog={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "All accounts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
    const toolbar = screen.getByRole("heading", { name: "All accounts" }).closest(".register-toolbar");
    expect(toolbar).toBeTruthy();
    expect(within(toolbar as HTMLElement).queryByRole("button", { name: /^Transfer$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "+ New transaction" })).toBeTruthy();
    expect(screen.getByText(/Choose one account to transfer, reconcile, or see running balances/)).toBeTruthy();
  });
});
