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
    vi.spyOn(repositoryModule.financeRepository, "listCategories").mockResolvedValue(["Food: Groceries", "Housing"]);
    vi.spyOn(repositoryModule.financeRepository, "listPayees").mockResolvedValue(["Utility"]);
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

  it("exports every transaction matching the active register filters",async()=>{
    const user=userEvent.setup(),save=vi.spyOn(repositoryModule.csvExportRepository,"saveCsv").mockResolvedValue(true);
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()}/>);
    await screen.findByText("Utility");
    await user.selectOptions(screen.getByLabelText("Filter register by status"),"review");
    await user.type(screen.getByLabelText("Search register"),"Warehouse");await user.click(screen.getByRole("button",{name:"Search"}));
    await user.click(screen.getByRole("button",{name:"Export matching CSV"}));
    expect(save).toHaveBeenCalledWith(expect.stringContaining('"Warehouse Club"'),expect.stringMatching(/^HomeLedger-Household-Checking-register.*\.csv$/));
    expect(repositoryModule.financeRepository.listTransactionsPage).toHaveBeenLastCalledWith(expect.objectContaining({offset:0,limit:500,newest:false,status:"review",search:"Warehouse"}));
    expect((await screen.findByRole("status")).textContent).toContain("Exported 3 matching transactions");
  });

  it("loads a focused Find landing by posted-date window and highlights that transaction row", async () => {
    const list = vi.mocked(repositoryModule.financeRepository.listTransactionsPage);
    list.mockResolvedValue({
      transactions: [tx({ id: "historic-lowes", postedDate: "2022-03-01", payee: "LOWES #42", category: "Repairs", amountMinor: -12000, status: "reconciled" })],
      totalCount: 1,
      offset: 0,
      limit: REGISTER_PAGE_SIZE,
      priorBalanceMinor: 0,
    });
    render(
      <AccountRegister
        accounts={accounts}
        initialAccountId="checking"
        focusPostedDate="2022-03-01"
        focusTransactionId="historic-lowes"
        onRequestDialog={vi.fn()}
      />,
    );
    const payee = await screen.findByText("LOWES #42");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "checking",
      fromDate: "2022-03-01",
      toDate: "2022-03-01",
      newest: true,
    }));
    expect(payee.closest("tr")?.className).toContain("register-focus");
  });

  it("routes eligible reuse actions into prepared editor drafts", async () => {
    const user = userEvent.setup();
    const onRequestDialog = vi.fn();
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={onRequestDialog} />);
    const utilityRow = (await screen.findByText("Utility")).closest("tr")!;
    expect(within(utilityRow).queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(within(utilityRow).getByRole("button", { name: "Edit" })).toBeTruthy();

    await user.click(within(utilityRow).getByRole("button", { name: "More transaction actions" }));
    const menu = within(utilityRow).getByRole("menu", { name: "Transaction reuse actions" });
    await user.click(within(menu).getByRole("menuitem", { name: "Duplicate" }));
    expect(onRequestDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transaction",
        draft: expect.objectContaining({
          accountId: "checking",
          payee: "Utility",
          category: "Housing",
          amountMinor: -2500,
          status: "cleared",
        }),
      }),
    );
    expect(onRequestDialog.mock.calls.at(-1)![0].draft).not.toHaveProperty("id");

    await user.click(within(utilityRow).getByRole("button", { name: "More transaction actions" }));
    await user.click(within(utilityRow).getByRole("menuitem", { name: "Make recurring" }));
    expect(onRequestDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "schedule",
        draft: expect.objectContaining({
          kind: "transaction",
          accountId: "checking",
          payee: "Utility",
          category: "Housing",
          amountMinor: -2500,
          frequency: "monthly",
          autoPost: false,
          status: "pending",
        }),
      }),
    );

    await user.click(within(utilityRow).getByRole("button", { name: "More transaction actions" }));
    await user.click(within(utilityRow).getByRole("menuitem", { name: "Create rule" }));
    expect(onRequestDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "rule",
        draft: expect.objectContaining({
          name: "Utility rule",
          pattern: "Utility",
          matchType: "contains",
          direction: "expense",
          renameTo: "Utility",
          category: "Housing",
          priority: 100,
          enabled: true,
        }),
      }),
    );
  });

  it("keeps reuse actions in a compact menu and surfaces unavailable reasons accessibly", async () => {
    const user = userEvent.setup();
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    const transferRow = (await screen.findByText("Transfer to savings")).closest("tr")!;
    expect(within(transferRow).queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(within(transferRow).getByRole("button", { name: "Transfer" })).toBeTruthy();

    await user.click(within(transferRow).getByRole("button", { name: "More transaction actions" }));
    const transferMenu = within(transferRow).getByRole("menu", { name: "Transaction reuse actions" });
    const transferDuplicate = within(transferMenu).getByRole("menuitem", { name: "Duplicate" }) as HTMLButtonElement;
    const transferRecurring = within(transferMenu).getByRole("menuitem", { name: "Make recurring" }) as HTMLButtonElement;
    const transferRule = within(transferMenu).getByRole("menuitem", { name: "Create rule" }) as HTMLButtonElement;
    expect(transferDuplicate.disabled).toBe(true);
    expect(transferDuplicate.getAttribute("aria-describedby")).toBeTruthy();
    expect(within(transferMenu).getByText(/stay paired/i)).toBeTruthy();
    expect(transferDuplicate.title || "").not.toMatch(/stay paired/i);
    expect(transferRecurring.disabled).toBe(false);
    expect(transferRule.disabled).toBe(true);
    expect(within(transferMenu).getByText(/merchant import rules/i)).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(within(transferRow).queryByRole("menu")).toBeNull();

    const splitRow = screen.getByText("Warehouse Club").closest("tr")!;
    await user.click(within(splitRow).getByRole("button", { name: "More transaction actions" }));
    const splitMenu = within(splitRow).getByRole("menu", { name: "Transaction reuse actions" });
    expect((within(splitMenu).getByRole("menuitem", { name: "Duplicate" }) as HTMLButtonElement).disabled).toBe(false);
    const splitRecurring = within(splitMenu).getByRole("menuitem", { name: "Make recurring" }) as HTMLButtonElement;
    expect(splitRecurring.disabled).toBe(true);
    expect(within(splitMenu).getByText(/cannot preserve split/i)).toBeTruthy();
    expect(splitRecurring.getAttribute("aria-describedby")).toBeTruthy();
    expect((within(splitMenu).getByRole("menuitem", { name: "Create rule" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("selects only eligible visible rows for a bulk category change", async () => {
    const user = userEvent.setup();
    const bulkCategory = vi.spyOn(repositoryModule.financeRepository, "bulkSetTransactionCategory").mockResolvedValue({
      updatedCount: 1,
      deletedCount: 0,
    });
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    await screen.findByText("Utility");
    await user.click(screen.getByRole("checkbox", { name: /Select Utility/i }));
    expect(await screen.findByText(/1 selected/i)).toBeTruthy();
    const categoryInput = screen.getByLabelText("Bulk category");
    await user.clear(categoryInput);
    await user.type(categoryInput, "Food: Market");
    await user.click(screen.getByRole("button", { name: /Change category \(1\)/i }));
    expect(bulkCategory).toHaveBeenCalledWith({ transactionIds: ["older"], category: "Food: Market" });
  });

  it("refuses mixed bulk category selection without calling the repository", async () => {
    const user = userEvent.setup();
    const bulkCategory = vi.spyOn(repositoryModule.financeRepository, "bulkSetTransactionCategory").mockResolvedValue({
      updatedCount: 1,
      deletedCount: 0,
    });
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    await screen.findByText("Utility");
    await user.click(screen.getByRole("checkbox", { name: /Select Utility/i }));
    await user.click(screen.getByRole("checkbox", { name: /Select Transfer to savings/i }));
    expect(await screen.findByText(/2 selected/i)).toBeTruthy();
    const categoryInput = screen.getByLabelText("Bulk category");
    await user.clear(categoryInput);
    await user.type(categoryInput, "Food: Market");
    await user.click(screen.getByRole("button", { name: /Change category \(1\)/i }));
    expect(bulkCategory).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was changed/i);
    expect(screen.getByText(/2 selected/i)).toBeTruthy();
  });

  it("refuses mixed bulk status selection without calling the repository", async () => {
    const user = userEvent.setup();
    const bulkStatus = vi.spyOn(repositoryModule.financeRepository, "bulkUpdateTransactionStatus").mockResolvedValue({
      updatedCount: 1,
      deletedCount: 0,
    });
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    await screen.findByText("Utility");
    await user.click(screen.getByRole("checkbox", { name: /Select Utility/i }));
    await user.click(screen.getByRole("checkbox", { name: /Select Transfer to savings/i }));
    expect(await screen.findByText(/2 selected/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Set status \(1\)/i }));
    expect(bulkStatus).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was changed/i);
    expect(screen.getByText(/2 selected/i)).toBeTruthy();
  });

  it("refuses mixed bulk delete selection without calling the repository", async () => {
    const user = userEvent.setup();
    const bulkDelete = vi.spyOn(repositoryModule.financeRepository, "bulkDeleteTransactions").mockResolvedValue({
      updatedCount: 0,
      deletedCount: 1,
    });
    render(<AccountRegister accounts={accounts} lockedAccountId="checking" onRequestDialog={vi.fn()} />);
    await screen.findByText("Utility");
    await user.click(screen.getByRole("checkbox", { name: /Select Utility/i }));
    await user.click(screen.getByRole("checkbox", { name: /Select Transfer to savings/i }));
    expect(await screen.findByText(/2 selected/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Delete \(1\)/i }));
    expect(bulkDelete).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was changed/i);
    expect(screen.queryByRole("button", { name: /Confirm delete/i })).toBeNull();
    expect(screen.getByText(/2 selected/i)).toBeTruthy();
  });

  it("clears selection when the register scope changes", async () => {
    const user = userEvent.setup();
    render(<AccountRegister accounts={accounts} onRequestDialog={vi.fn()} />);
    await screen.findByText("Utility");
    await user.click(screen.getByRole("checkbox", { name: /Select Utility/i }));
    expect(await screen.findByText(/1 selected/i)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Filter register by status"), "pending");
    await screen.findByText("Utility");
    expect(screen.queryByText(/selected/i)).toBeNull();
  });
});
