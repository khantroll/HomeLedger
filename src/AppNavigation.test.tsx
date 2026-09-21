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
    expect(screen.getByRole("button", { name: /Back to account list/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Register" })).toBeTruthy();
    expect(screen.getByText("Payroll")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Transactions" }));
    expect(await screen.findByRole("heading", { name: "All accounts" })).toBeTruthy();
    expect(screen.getByLabelText("Filter register by account")).toBeTruthy();
  });

  it("shows review and archived account lifecycle controls and saves account edits", async () => {
    const user = userEvent.setup();
    const lifecycleAccounts: Account[] = [
      { ...accounts[0], needsReview: true, sortOrder: 0, archived: false },
      { ...accounts[1], sortOrder: 1, archived: true },
    ];
    vi.spyOn(repositoryModule.financeRepository, "listAccounts").mockResolvedValue(lifecycleAccounts);
    vi.spyOn(repositoryModule.financeRepository, "listTransactions").mockResolvedValue(transactions);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledTransactions").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "generateScheduledOccurrences").mockResolvedValue(0);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledOccurrences").mockResolvedValue([]);
    const update = vi.spyOn(repositoryModule.financeRepository, "updateAccount").mockResolvedValue({ ...lifecycleAccounts[0], name: "Primary Checking" });

    render(<App />);
    await screen.findByRole("heading", { name: "Overview" });
    await screen.findByText("Household Checking");
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(1);
    expect(screen.queryByText("Emergency Savings")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.getByRole("heading", { name: "Archived accounts" })).toBeTruthy();
    expect(screen.getByText("Emergency Savings")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const name = screen.getByLabelText("Account name");
    await user.clear(name);
    await user.type(name, "Primary Checking");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith("checking", expect.objectContaining({ name: "Primary Checking", currency: "USD" }));
  });
  it("guides a fresh ledger without double-counting imported history", async () => {
    const user = userEvent.setup();
    vi.spyOn(repositoryModule.financeRepository, "listAccounts").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "listTransactions").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledTransactions").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository, "generateScheduledOccurrences").mockResolvedValue(0);
    vi.spyOn(repositoryModule.financeRepository, "listScheduledOccurrences").mockResolvedValue([]);
    const create = vi.spyOn(repositoryModule.financeRepository, "createAccount").mockResolvedValue({ id:"new", name:"Checking", type:"checking", currency:"USD", balanceMinor:0, ownerLabel:"Household" });

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Start with the accounts you use today" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add my first account" }));
    expect(screen.getByText("How do you want to start this account?")).toBeTruthy();
    expect(screen.getByLabelText("Current cleared balance")).toBeTruthy();
    await user.click(screen.getByText("I plan to import older history"));
    expect(screen.queryByLabelText("Current cleared balance")).toBeNull();
    expect(screen.getByText(/count those transactions twice/i)).toBeTruthy();
    await user.type(screen.getByLabelText("Account name"), "Checking");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name:"Checking", openingBalanceMinor:0 }));
  });

  it("opens review work with a visible register filter and ordinary navigation resets it", async () => {
    const user=userEvent.setup();
    const reviewTransactions:Transaction[]=[{id:"review",accountId:"checking",postedDate:"2026-09-18",payee:"Imported item",category:"Uncategorized",amountMinor:-1000,status:"review"}];
    vi.spyOn(repositoryModule.financeRepository,"listAccounts").mockResolvedValue(accounts);
    vi.spyOn(repositoryModule.financeRepository,"listTransactions").mockResolvedValue(reviewTransactions);
    vi.spyOn(repositoryModule.financeRepository,"listScheduledTransactions").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository,"generateScheduledOccurrences").mockResolvedValue(0);
    vi.spyOn(repositoryModule.financeRepository,"listScheduledOccurrences").mockResolvedValue([]);
    const list=vi.spyOn(repositoryModule.financeRepository,"listTransactionsPage").mockResolvedValue({transactions:reviewTransactions,totalCount:1,offset:0,limit:100,priorBalanceMinor:0});
    render(<App/>);
    await screen.findByRole("heading",{name:"Overview"});
    await user.click(screen.getByRole("button",{name:/Review transactions/i}));
    expect(await screen.findByRole("heading",{name:"All accounts"})).toBeTruthy();
    expect((screen.getByLabelText("Filter register by status") as HTMLSelectElement).value).toBe("review");
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({status:"review"}));
    await user.click(screen.getByRole("button",{name:"Overview"}));
    await user.click(screen.getByRole("button",{name:"Transactions"}));
    expect((await screen.findByLabelText("Filter register by status") as HTMLSelectElement).value).toBe("all");
  });


});
