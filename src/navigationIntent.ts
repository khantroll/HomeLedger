import type { PortfolioNavigationFocus } from "./PortfolioPage";

/** Focus a Bills calendar day (overdue or upcoming) or the auto-post queue. */
export type BillsNavigationFocus =
  | { kind: "overdue"; dueDate: string }
  | { kind: "day"; dueDate: string }
  | { kind: "autoPost" };

/** Optional Forecast landing context from Overview or planning pages. */
export type ForecastNavigationFocus = {
  horizonDays?: 30 | 60 | 90 | 180 | 365;
  highlightDate?: string;
};

/** Optional Budget landing month from Overview or planning pages. */
export type BudgetNavigationFocus = {
  month: string;
};

/**
 * Small typed navigation intents for Home/Today and the Bills↔Budget↔Forecast bridge.
 * Only fields justified by those workflows; not a general router.
 */
export type NavigationIntent =
  | {
      page: "Transactions";
      status: "review" | "all";
      accountId?: string;
      /** Optional register text filter; focusTransactionId remains authoritative for landing. */
      search?: string;
      transactionId?: string;
      /** When set with transactionId, narrow the register date window so the focused row is loadable. */
      postedDate?: string;
    }
  | { page: "Bills"; focus: BillsNavigationFocus }
  | { page: "Forecast"; focus?: ForecastNavigationFocus }
  | { page: "Budget"; focus?: BudgetNavigationFocus }
  | { page: "Portfolio"; focus?: PortfolioNavigationFocus };
