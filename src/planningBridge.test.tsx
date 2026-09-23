// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillsPage } from "./BillsPage";
import { BudgetPage } from "./BudgetPage";
import { ForecastPage } from "./ForecastPage";
import { financeRepository } from "./repository";
import type { Account, ScheduledOccurrence, ScheduledTransaction, Transaction } from "./domain";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const accounts: Account[] = [{ id: "checking", name: "Checking", type: "checking", currency: "USD", balanceMinor: 100000, ownerLabel: "Household" }];
const templates: ScheduledTransaction[] = [
  { id: "bill", kind: "transaction", accountId: "checking", payee: "Electric Utility", category: "Utilities", amountMinor: -2500, status: "pending", frequency: "monthly", anchorDate: "2026-09-15", enabled: true, autoPost: true },
];
const occurrences: ScheduledOccurrence[] = [{ id: "overdue", scheduledTransactionId: "bill", dueDate: "2026-09-15", status: "expected" }];
const transactions: Transaction[] = [];

describe("planning bridge navigation", () => {
  it("opens a Bills agenda day from day focus and links out to Forecast", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <BillsPage
        accounts={accounts}
        transactions={transactions}
        templates={templates}
        occurrences={occurrences}
        onChanged={async () => undefined}
        today="2026-09-18"
        navigationFocus={{ kind: "day", dueDate: "2026-09-15" }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByRole("heading", { name: "Sep 15, 2026" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "See cash forecast" }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "Forecast", focus: { horizonDays: 30 } });
  });

  it("applies Forecast focus horizon and links back to Bills and Budget", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    vi.spyOn(financeRepository, "generateScheduledOccurrences").mockResolvedValue(0);
    vi.spyOn(financeRepository, "listScheduledOccurrences").mockResolvedValue([]);
    vi.spyOn(financeRepository, "getBudgetMonth").mockResolvedValue({
      month: "2026-09",
      plannedMinor: 0,
      spentMinor: 0,
      carryInMinor: 0,
      availableMinor: 0,
      lines: [],
    });
    render(
      <ForecastPage
        accounts={accounts}
        templates={templates}
        today="2026-09-18"
        navigationFocus={{ horizonDays: 30, highlightDate: "2026-09-18" }}
        onNavigate={onNavigate}
      />,
    );
    expect(await screen.findByRole("button", { name: "30d" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "30d" }).className).toContain("active"));
    await user.click(screen.getByRole("button", { name: "Open bills calendar" }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "Bills", focus: { kind: "day", dueDate: "2026-09-18" } });
    await user.click(screen.getByRole("button", { name: "Review this month’s budget" }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "Budget", focus: { month: "2026-09" } });
  });

  it("opens Budget on a focused month and links to Forecast and Bills", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    vi.spyOn(financeRepository, "getBudgetMonth").mockResolvedValue({
      month: "2026-08",
      plannedMinor: 10000,
      spentMinor: 2000,
      carryInMinor: 0,
      availableMinor: 8000,
      lines: [{ id: "food", category: "Food", rolloverEnabled: false, plannedMinor: 10000, spentMinor: 2000, carryInMinor: 0, availableMinor: 8000 }],
    });
    render(<BudgetPage transactions={[]} accounts={accounts} navigationFocus={{ month: "2026-08" }} onNavigate={onNavigate} />);
    expect(await screen.findByText("August 2026")).toBeTruthy();
    expect(screen.getByText("Food")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "See cash forecast" }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "Forecast", focus: { horizonDays: 30 } });
    await user.click(screen.getByRole("button", { name: "Open bills for this month" }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "Bills", focus: { kind: "day", dueDate: "2026-08-01" } });
  });
});
