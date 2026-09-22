# Post-Investment Milestone Audit

Base audited: `de821ffcf60f011103ab47f95d1c70856077da91` (main after PR #49)

## Audit frame

This audit asks whether the current implementation works as a coherent, local-first successor to Microsoft Money rather than whether it resembles a modern fintech service. Microsoft Money 2005 remains the product/UX authority; HomeLedger's local-first architecture is the implementation constraint; GnuCash is useful mainly for accounting edge cases.

The implementation was walked across Overview, account management/registers, ordinary transactions and transfers, reconciliation, Bills, Budget, Forecast, debt/savings planning, Reports, Imports, Portfolio, backup/settings, and AI Insights, including their repository/native boundaries and cross-feature navigation.

## Blocking daily use

### Investment data exists below the UI but cannot be entered through the product

**Current behavior.** The Portfolio workspace can display deterministic holdings, Activity and intrinsic Cash; security detail can show lots, manual prices and local price history; provider mappings and explicit price refresh are available. The native/repository layer can create investment accounts, securities and every Foundation investment event. The ordinary Add account dialog, however, does not offer Investment, and Portfolio has no UI for creating securities or entering/editing investment activity.

**Evidence.** `AccountDialog` only offers checking, savings, credit, cash, loan and asset and calls the ordinary `FinanceRepository.createAccount`. `InvestmentRepository` exposes `createInvestmentAccount`, `createSecurity`, `createInvestmentEvent`, pending-event editing and guarded historical correction, but `PortfolioPage` is presentation/price oriented and never calls those creation/event APIs.

**Why it matters.** A Money-style user cannot build or maintain the investment portfolio that #45–#49 implemented without an external/dev path. This is a genuine workflow hole, not a missing convenience.

**Smallest sensible remediation.** Add a dedicated investment-account creation path and modest security/activity editors using the existing Foundation vocabulary. Prefer recognizable Money-style activities (Buy, Sell, Dividend, Reinvest dividend, Interest, Fee, Split, Return of capital, Transfer, Opening position, Basis adjustment) with progressive fields. Route corrections through the existing pending-edit/historical-correction APIs rather than inventing new accounting.

**Dependencies.** Existing Foundation and Portfolio workspace only.

**Schema/native changes required?** No expected schema change. Native validation already owns the semantics; only narrowly missing read/write helpers discovered during implementation should be added.

### Overview/net worth is wrong or incomplete once investment accounts exist

**Current behavior.** App-level Overview computes assets and liabilities directly from `Account.balanceMinor`. Investment accounts deliberately have ordinary opening balance zero and their value lives in Foundation intrinsic cash + holdings snapshots. AccountsPage avoids displaying their ordinary balance and says “Investment portfolio,” but Overview still feeds them into generic balance aggregation and reports “Net worth — Based on tracked accounts.”

**Evidence.** `App.tsx` derives `assets` and `liabilities` from active `balanceMinor` values. Native `create_investment_account` inserts the ordinary account with `opening_balance_minor=0`; `calculatePortfolioSnapshot` is the valuation authority. Portfolio already surfaces Unknown when valuation is incomplete.

**Why it matters.** Net worth is a central Money-style daily-driver number. Once a user adds retirement/brokerage assets, a confidently displayed total that omits them is materially misleading.

**Smallest sensible remediation.** Build one deterministic household valuation projection for Overview: ordinary account balances plus same-currency investment intrinsic cash/valued holdings, with explicit incomplete/Unknown treatment when an investment cannot be valued. Do not coerce missing prices to zero. Keep cash-flow “available cash” separate from investment value.

**Dependencies.** Foundation snapshot API and existing account currency grouping.

**Schema/native changes required?** Probably no schema change. A small repository/native aggregate may be justified if it prevents TypeScript from becoming a second valuation engine; otherwise compose existing authoritative snapshots without recalculating investment arithmetic.

### Product privacy/status copy now contradicts deliberate market-data networking

**Current behavior.** The sidebar says “Local mode — No network activity,” and `StorageNotice` says native records are stored locally and “No network service is used.” PR #49 deliberately permits an explicit Alpha Vantage request, while AI can also use explicit local/cloud network adapters.

**Evidence.** `App.tsx` contains both statements; `MarketRefreshPanel` is an explicit network-backed price workflow and the README already describes AI networking.

**Why it matters.** Local-first is a trust promise. “No network activity” is no longer true even though automatic/background networking remains absent.

**Smallest sensible remediation.** Replace absolute network claims with precise local-first language: authoritative records remain local; network use occurs only for explicit/configured AI or user-requested market-data operations.

**Dependencies.** None.

**Schema/native changes required?** No.

## High-value next

### Investment-aware household reporting is missing

**Current behavior.** Reports are explicitly “Income and spending reports” over ordinary `Transaction` rows. This correctly avoids misclassifying buys/sells as household spending/income, but it also means investment income, realized results, portfolio value/performance and investment-account history have no reporting surface. Reports' account selector includes accounts by currency, including investment accounts, although ordinary transaction reports have nothing authoritative to say about their investment activity.

**Evidence.** `calculateTransactionReport` consumes only `Account[]` + ordinary `Transaction[]`, excludes transfers/adjustments, and classifies signs as income/spending. Foundation separately stores recoverable investment income, basis and realized-result projections.

**Why it matters.** Money's Portfolio Manager and reports complemented one another. HomeLedger should preserve ordinary household income/spending semantics while offering investment-specific reporting rather than folding securities activity into the ordinary report engine.

**Smallest sensible remediation.** First make Reports' ordinary scope explicit and exclude investment accounts from selectors that imply ordinary ledger reporting. Then add bounded investment reports from Foundation facts: account/portfolio value, investment income, realized/calculable gain with incomplete-basis flags, and basic performance only where the deterministic data supports it.

**Dependencies.** Investment entry UX is useful before reports become a primary workflow, but report correctness cleanup can precede it.

**Schema/native changes required?** No schema expected. Deterministic native projection helpers may be warranted for performance/return calculations; do not derive tax-grade results in React.

### Account list and archived investment presentation are inconsistent

**Current behavior.** Active investment accounts intentionally show “Investment portfolio” instead of the meaningless ordinary `balanceMinor`. Archived accounts use the generic money balance display, so an archived investment account can appear as $0 even when its retained Foundation history has value. `accountTypeLabel` also has no investment case.

**Evidence.** Both branches are in `AccountsPage`; the active row special-cases investment, the archived row does not. The switch currently ends at asset.

**Why it matters.** Archiving should change lifecycle visibility, not reinterpret the account.

**Smallest sensible remediation.** Use the same investment-aware label/value policy for active and archived rows and add the missing type label. If archived valuation is intentionally not loaded, say “Investment portfolio” rather than $0.

**Dependencies.** None; household valuation work can later enrich this further.

**Schema/native changes required?** No.

### Savings goals need an explicit investment-account boundary

**Current behavior.** Savings goals are account-linked. The audit found no product-level policy saying whether an investment account may be selected. Investment accounts do not have an authoritative ordinary `balanceMinor`, so a generic account-linked goal that reads that field can silently produce the wrong progress.

**Evidence.** `SavingsGoal.accountId` is generic while investment value is only authoritative through Foundation snapshots.

**Why it matters.** Planning features should not accidentally treat the ordinary investment account row as its value.

**Smallest sensible remediation.** Until a deliberate investment-goal model exists, restrict ordinary savings goals to appropriate ordinary asset/cash accounts and explain the boundary. Later support investment-linked goals only through Foundation valuation with Unknown semantics.

**Dependencies.** Household valuation decision if investment-linked goals are desired.

**Schema/native changes required?** No for restriction; possibly none for later valuation-aware support.

### Investment transfer boundary remains intentionally incomplete

**Current behavior.** Foundation supports investment-to-investment intrinsic cash/security transfers. The Foundation deliberately rejects one-sided investment-to-ordinary cash transfers until an atomic ordinary-ledger linkage exists.

**Evidence.** This was encoded as a Foundation safety invariant; ordinary transfers use linked ordinary transactions while investment events are a separate authoritative history.

**Why it matters.** A real user commonly moves cash between checking and brokerage. Today that journey cannot be represented as one coherent linked transfer without either duplication or an unsupported one-sided record.

**Smallest sensible remediation.** After investment entry UX, design one atomic cross-ledger transfer command that writes the ordinary linked side and investment cash event together, with rollback and correction semantics.

**Dependencies.** Investment activity UI; ordinary transfer invariants.

**Schema/native changes required?** Possibly a small linkage/provenance field or group relationship if existing `group_id`/transfer metadata cannot express the durable relationship. Do not assume a migration until the native design proves it necessary.

## Polish / later

### Portfolio setup/empty states do not guide a new user into a usable portfolio

Portfolio empty states can explain missing holdings/prices, but because account/security/activity creation is absent they cannot provide a complete next action. Once entry UX exists, empty states should become a short progression: create investment account → add/identify security → enter opening position/activity → optionally add/refresh price. No schema change.

### Market-data configuration is deliberately minimal

PR #49 uses an explicit session-only API key and user-confirmed mapping. That is safe and local-first, but repeated key entry is friction. A later bounded settings integration could use the existing OS credential-vault pattern used by AI. This is convenience, not a blocker, and should not precede investment entry/net-worth correctness. No financial schema change; native credential adapter work would be required.

### Portfolio performance remains intentionally thin

Holdings, basis, gains and price history exist, but Money-style performance views are not yet present. Add them only from deterministic event/price facts, with clear treatment of external cash flows and missing prices. Native calculation helpers are preferable; no schema is necessarily required.

### Desktop shell controls need a truth/behavior pass

The shell displays Lock and a mobile-menu control, but the audit should not treat decorative shell affordances as security features. If Lock does not actually lock local data, either implement a meaningful desktop lock boundary or relabel/remove the affordance. This is polish unless the product claims it as protection. No schema change.

### Import remains ordinary-ledger only

Investment OFX/QIF is still rejected, correctly, rather than being misclassified. Once manual investment entry is coherent, investment import becomes a useful throughput feature, not a prerequisite for daily usability. It must map into Foundation events and review rather than ordinary transactions.

## Explicitly deferred

The following remain outside the immediate post-milestone sequence unless a later, evidence-based dependency changes the decision:

- brokerage/Alpaca connectivity;
- order submission and trading UI;
- autonomous trading or algorithmic strategies;
- LLM stock picking or automatic rebalancing;
- Watchlist as a prerequisite for Portfolio usefulness;
- social/community features and market-news feeds;
- mobile-first redesign;
- bank sync as a prerequisite for usability;
- device/cloud sync as a prerequisite for usability;
- FX accounting/conversion;
- options, shorts and margin;
- tax-return-grade calculations.

## Architecture observations

### App.tsx has crossed the point where bounded extraction is justified

This is not a line-count complaint. `App.tsx` currently owns global data loading, scheduled-occurrence generation, Overview planning inputs, page routing, typed contextual navigation, account/register routing, investment routing, all modal editor state, first-run onboarding, account-management UI, Overview UI and shell trust/status copy. Investment navigation added another special destination while household valuation now needs asynchronous Foundation state that does not belong in the ordinary account balance model.

The concrete pressure is that fixing Overview investment valuation in-place would make App responsible for coordinating two repositories and Unknown valuation state while it already owns unrelated dialogs and page implementations. That increases the chance that future navigation/refresh changes accidentally couple ordinary and investment models.

**Bounded remediation:** extract the page/shell orchestration and the embedded account/Overview components without changing routing semantics. A sensible boundary is:
- `App.tsx`: shell + selected page + high-level refresh/navigation;
- `OverviewPage.tsx`: Overview summaries, command center, upcoming widget, valuation presentation;
- `AccountsPage.tsx` and account dialog/onboarding component: account lifecycle UI;
- keep the existing typed `NavigationIntent` centrally owned rather than introducing a router.

Do this only alongside/after the household valuation correction, not as a broad rewrite.

**Schema/native changes required?** No.

### Repository ownership is mostly healthy

The ordinary `FinanceRepository` and `InvestmentRepository` separation prevents buys/sells from leaking into household spending. Investment arithmetic and corrections remain native; Portfolio presentation consumes projections. Market-data retrieval is separate from persistence, and accepted observations enter through the investment repository.

The main pressure is cross-domain composition: Overview/net worth and a future ordinary↔investment transfer need an explicit orchestration boundary. Do not solve this by merging the repositories or by teaching ordinary transaction reports to interpret investment events.

### Portfolio presentation has small duplicated policy that should stay bounded

Portfolio owns date/source formatting and presentation helpers while native code owns accounting. This is appropriate. Continue centralizing only policies that must agree (for example account-perspective transfer display movement and price observation labels); do not move Foundation arithmetic into TypeScript.

### Currency boundaries are locally sound but household summaries are not

Portfolio is account-currency based and Foundation refuses FX. Reports and Forecast explicitly scope by currency. Overview's current `assets/liabilities/net worth` calculation formats totals with default USD and does not establish a single-currency scope, so a mixed-currency household can be summed numerically without conversion. Investment integration makes this more visible but did not create it.

**Smallest remediation:** make Overview currency-scoped (or present per-currency totals) until FX exists. Never add currencies 1:1.

**Schema/native changes required?** No.

## Documentation/version drift

### README is materially stale

The README calls the product v0.47 and says investment management is the “Next major domain,” describing dedicated securities/holdings/lots/prices/performance as not yet implemented. Current main contains the Portfolio Foundation, Portfolio/account/security views, historical As-of valuation, manual prices, local price history, provider-neutral market data, explicit mapping and explicit refresh.

The privacy section also says network access occurs only for AI analysis. PR #49 adds explicit user-requested market-data networking. Core storage remains local, so the wording should be corrected rather than weakened.

The Imports section remains correct that investment transactions are rejected rather than misinterpreted; it should now clarify that manual investment Foundation support exists while investment-file import remains deferred.

### Version metadata is stale

Both `package.json` and `src-tauri/Cargo.toml` still report `0.47.0` despite PRs #45–#49 establishing a substantial investment milestone. The repository has effectively been developing beyond the declared release version.

For this audit PR, synchronize both manifests to **0.50.0** as a milestone/development version and describe the current implemented scope accurately. This is metadata truth, not a claim that every post-audit remediation is complete.

### Product status copy is stale

README/privacy copy and in-app “No network activity/service” language must distinguish local-first authoritative storage from explicit network actions. The audit PR should correct documentation; the in-app copy is a tiny milestone truth correction and is justified here because it otherwise contradicts #49.

## Next bounded development sequence

### PR #51 — Investment setup and manual activity entry

Expose the Foundation that already exists: dedicated investment-account creation, security creation/selection, Money-style activity entry, pending edits and guarded historical corrections. Improve Portfolio empty states to lead into these actions. No investment accounting redesign.

### PR #52 — Household valuation and investment-aware Overview

Make Overview/net worth currency-safe and investment-aware using authoritative Portfolio snapshots, with explicit Unknown/incomplete treatment. Fix active/archived investment account presentation and define the ordinary savings-goal boundary. This should also move Overview out of `App.tsx` if doing so is the smallest safe way to contain asynchronous valuation state.

### PR #53 — Reports boundary and investment reports

Keep ordinary income/spending reports ordinary-ledger only and remove misleading investment-account selectors. Add bounded Foundation-backed portfolio/account value, investment income and realized/calculable gain reporting with incomplete-basis semantics. Add performance only if deterministic external-flow treatment is ready.

### PR #54 — Cross-ledger investment cash transfer

Design and implement atomic ordinary-account ↔ investment-account cash transfer linkage so the common checking-to-brokerage workflow is represented once and cannot half-commit. Reuse existing correction/provenance rules.

### PR #55 — Milestone daily-driver polish

Consolidate remaining post-investment empty states, desktop shell affordances, terminology, contextual navigation and settings friction. Consider secure saved market-provider credentials here. Reassess Watchlist only after the daily investment workflow, household totals and reports are coherent.

Watchlist is therefore not the immediate next feature; brokerage remains outside this sequence.
