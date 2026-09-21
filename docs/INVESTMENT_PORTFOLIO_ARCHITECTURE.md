# HomeLedger Investment / Portfolio Architecture

**Status:** design proposal only  
**Baseline audited:** HomeLedger v0.47, main `be753bdf22b5002494eb7f0e63e1ac40ec95a212`  
**Product guidepost:** Microsoft Money 2005-era Portfolio Manager  
**Implementation status:** no production code, schema, migration, provider, or version changes are part of this document.

## Executive decision

HomeLedger should add investments as an **investment-specific domain inside the existing household ledger**, not force securities into ordinary expense transactions and not create a separate trading application.

The conceptual model should be:

```
Household
  └─ Investment account (brokerage / retirement)
       ├─ cash balance
       └─ investment events
            ├─ security references
            └─ lot allocations when basis matters

Security master ── price history
Investment events ──> derived lots ──> derived holdings
Account holdings + cash + prices ──> portfolio valuation / performance
```

The authoritative record is event history. Holdings, open lots, basis, gains, income, and portfolio values are deterministic projections from that history plus separately stored prices. Broker positions and market quotes are observations used to enrich or reconcile that record; they do not silently replace it.

---

## 1. Microsoft Money Portfolio Manager reconstruction

### 1.1 Product shape

Money treated a brokerage as an **investment account containing multiple investments**, rather than making each security look like a household bank account. Contemporary guidance describes creating a Fidelity-style account and then recording Microsoft/Walmart holdings and buy/sell/dividend activity inside it. Money also distinguished the account's securities from its cash portion; Money 2005 let users set an opening cash balance and switch an investment register to a Cash Transactions view. This separation is central to the HomeLedger design.

Portfolio Manager then provided the cross-account investment view. Microsoft described Money 2003's Portfolio Manager as supporting unlimited saved personalized portfolio views plus Portfolio Highlights, while the 2005 release shared the Portfolio Manager with MSN Money and supported direct brokerage downloads. Historical screenshots show grouping by account, an as-of date, selectable views such as Performance, security rows plus Cash and Total Account Value, and bottom-line portfolio totals/performance.

### 1.2 Securities and holdings

Money kept an investment/security identity distinct from the account that held it. Investment setup covered stocks, mutual funds, bonds, precious metals, CDs, retirement accounts, employee stock options, and watch-only securities. Portfolio Manager could retain closed positions and expose investment details; Money's own support guidance warned that investment transaction history was necessary for accurate balances and gains.

Holdings were transaction-backed. Historical Microsoft material explicitly described support for multiple purchase dates, stock splits, and commissions. Money could show a closed position after shares had been sold and could show investment activities beneath a security.

### 1.3 Investment activities

The documented Money workflow included ordinary stock/mutual-fund purchases and sales, cash and reinvested dividends, bond interest, commissions, special activities such as splits/spin-offs, and Add Shares / Remove Shares / transfers. Money's OFX mapping handled buy/sell variants, income, investment expense, reinvestment, return of capital, splits, and transfers; investment transfers could become Add Shares or Remove Shares.

Money made common activities approachable by presenting them as named actions rather than exposing double-entry mechanics. That is the behavior HomeLedger should preserve: users choose **Buy**, **Sell**, **Dividend**, **Reinvest dividend**, **Interest**, **Fee**, **Split**, **Return of capital**, or **Transfer shares** and see fields relevant to that action.

### 1.4 Cash inside brokerage accounts

Money explicitly modeled a cash portion associated with an investment account. Cash could have an opening balance and ordinary cash transactions, and investment activities could transfer money to or from cash. This is preferable to pretending a buy is household “spending”: buying shares changes the composition of assets, while a commission is an expense and a dividend is investment income.

HomeLedger should modernize this by making cash an intrinsic balance of the investment account rather than exposing a confusing second account unless there is a compelling accounting reason later.

### 1.5 Lots and cost basis

Money tracked multiple acquisition dates and cost basis and used transaction history for capital-gain reporting. Later Money Plus also integrated GainsKeeper for deeper lot/tax analysis. The key UX lesson is not to expose a permanent “lots editor” to every user; ordinary buys create lots automatically, and lot detail becomes visible when entering/reviewing a sale or investigating basis.

A modern HomeLedger should do this more cleanly than Money: maintain lots internally from acquisition events and support FIFO by default plus explicit lot allocation where the user/broker supplies it.

### 1.6 Prices and valuation

Money separated price history from investment transaction history. Users could download stock/mutual-fund quotes or update prices manually, and Microsoft support material treated retained price history as a key element of portfolio management. Historical portfolio reports could calculate value as of a chosen past date.

This is the right separation for HomeLedger: a new quote changes current valuation; it must not rewrite acquisition history or basis.

### 1.7 Performance and reports

Money exposed Portfolio Highlights, customizable portfolio columns/views, market value, cost basis, gains, daily changes, and annualized/total return. Its Investment Performance Report and Portfolio annualized-return column attempted to show annualized percentage return. Historical reports also included portfolio value by account and as-of-date valuation.

HomeLedger should retain the approachable layers:
- **Portfolio:** what is it worth now?
- **Holding:** what do I own, what did I pay, what is my gain/loss?
- **Activity:** what happened?
- **Income:** what dividends/interest did it produce?
- **Performance:** how did the investment/account/portfolio perform over a period?
- **Tax-lot detail:** only when basis/sale investigation needs it.

### 1.8 Historical / starting positions

Money could initialize an investment account with existing holdings using statement information such as shares, acquisition dates, cost and commissions, and could maintain opening cash. The important distinction is between “I own these shares as of today” and “here is their historical basis.”

HomeLedger should therefore offer two starting paths:
1. **Complete history** — enter/import historical investment events.
2. **Starting position** — establish shares and, when known, acquisition date and basis without fabricating a cash purchase today.

Unknown basis must remain explicitly unknown rather than defaulting to zero.

### 1.9 Brokerage downloads

Money 2005 supported direct brokerage downloads and OFX investment data. OFX itself separates transactions, complete current positions, balances/cash, open orders, and security metadata. That separation is valuable: a downloaded position is a reconciliation observation, not automatically a replacement for transaction history.

### 1.10 Why Money was approachable

Money's strength was progressive disclosure. A household user could start from account → investment → recognizable activity, see a portfolio table, and drill into history or analysis only when needed. It kept the user's questions in the foreground and the accounting machinery behind them.

**HomeLedger should copy that philosophy, not Money's obsolete web services or every historical edge-case wizard.**

---

## 2. Product principles derived from Money

1. **Portfolio first, accounting underneath.** Lead with ownership, value, basis, gain/loss, income and activity.
2. **Investment account ≠ security.** A brokerage/retirement account holds cash and securities; a security may be held in multiple accounts.
3. **Buy ≠ household expense; sell ≠ household income.** Asset conversion must not pollute ordinary spending reports or budgets.
4. **History is authoritative.** Holdings and lots derive from events; current broker positions are reconciliation evidence.
5. **Prices are observations, not transactions.** Price history can change valuation without changing shares or basis.
6. **Lots are automatic until they matter.** Common users see average/open basis; sale workflows can expose FIFO/specific lots.
7. **Unknown is better than invented.** Unknown basis, acquisition date, price, or broker mapping stays visibly unknown.
8. **Cash belongs in the investment account experience.** It participates in net worth and portfolio value without becoming a fake security.
9. **Online enrichment is optional.** Manual securities, prices and complete offline portfolios remain first-class.
10. **No trading-platform drift.** Portfolio management remains household financial recordkeeping and understanding.

---

## 3. Current HomeLedger integration audit

### Accounts

v0.47 account types are checking, savings, credit, cash, loan and asset. Accounts have one currency and one opening money balance. The account/register model assumes the balance is the sum of currency-denominated transactions.

**Implication:** add an `investment` account type eventually, but do not represent each security as an `asset` account. An investment account needs an investment workspace and a cash balance alongside derived security holdings.

### Transactions and registers

The ordinary `Transaction` model is currency-only: payee/category/amount/status/splits plus transfer/import metadata. It is excellent for cash-ledger activity but cannot faithfully represent units, security identity, trade/settlement dates, unit price, lots, splits, or basis adjustments.

**Decision:** do not overload `transactions` with fake categories such as “Buy AAPL.” Introduce investment events. Where an investment event moves brokerage cash, its cash effect should be reflected through the investment domain's derived cash ledger or a tightly linked cash posting—not duplicated as an unrelated ordinary expense/income row.

### Repository interfaces / native SQLite

`FinanceRepository` is currently a broad household-finance interface backed by Tauri commands and SQLite. Investment operations should be a cohesive typed repository surface, preferably an `InvestmentRepository` composed beside `FinanceRepository`, so ordinary transaction APIs do not accumulate security-specific optional fields.

SQLite is appropriate for authoritative events, securities, prices, lot allocations and import/reconciliation audit. Derived holdings should normally be queried/calculated, not manually persisted as mutable truth.

### Reports

Current transaction reports intentionally interpret positive ordinary transactions as income and negative ones as spending, excluding linked transfers/adjustments. Feeding buys/sells into that model would corrupt household spending and savings-rate reports.

**Decision:** existing cash-flow reports should exclude investment asset-conversion events. Investment income and investment fees may be surfaced in investment reports and, later, optionally mapped into household income/expense reporting with explicit semantics. Portfolio reports are a new report family sharing the Reports workspace/navigation rather than a separate app.

### Overview / net worth

Current Overview derives assets/liabilities from account money balances. Investment accounts need a derived total value:

`investment account value = cash + Σ(holding units × selected as-of price)`

That value can feed household net worth. Overview should initially show the investment account's total value and stale/missing-price attention only after portfolio foundations are trustworthy; detailed market movement belongs in Portfolio.

### Imports

Current QIF explicitly rejects `!Type:Invst`; current OFX support is bank/credit-card oriented. This is good defensive behavior until the investment domain exists.

Investment import should be a distinct parser/review path. OFX investment statements are a strong first structured target because they separate securities, investment transactions, positions and balances. Import must compare statement positions to derived HomeLedger holdings instead of overwriting them.

### Reconciliation

Current reconciliation proves a cash closing balance from ordinary transactions. Investment reconciliation is multidimensional:
- cash balance,
- each security quantity,
- optionally statement price/market value,
- transaction/activity completeness,
- basis when the statement supplies it.

It needs its own statement reconciliation model. A position mismatch should create a review item; never silently create or delete shares.

### Backup / migrations

The encrypted backup exports the SQLite database, and automatic recovery snapshots protect the local database/pre-migration state. Once investment tables exist, they naturally belong in those same database snapshots, but restore validation/tests must be extended to require and validate the new schema at the migration that introduces it.

### Contextual navigation

v0.47 already uses small App-owned typed navigation intents and account-register deep links. Portfolio should extend that pattern (e.g. account → portfolio account; report → security detail) rather than introduce a router solely for investments.

### AI Privacy Firewall

The existing pattern is already correct: deterministic HomeLedger task context → exact Privacy Firewall review → provider. Investment AI must consume a computed portfolio-analysis DTO, never query events/prices/broker APIs directly and never calculate authoritative basis/gains itself.

---

## 4. Proposed user experience

### 4.1 Accounts

Investment accounts appear with checking/savings/etc. in Accounts and household net worth.

Opening one uses an investment-specific account workspace with tabs/sections conceptually like:

**Portfolio | Activity | Cash | Reconcile**

The top answers:
- Total account value
- Cash
- Investments
- Cost basis (when known)
- Unrealized gain/loss
- Investment income YTD

### 4.2 Portfolio Manager

Add a top-level **Portfolio** workspace inspired by Money.

Default holdings table:
- Security
- Account (or grouped account heading)
- Shares/units
- Last price + as-of time/date
- Market value
- Cost basis
- Gain/loss ($ / %)
- Portfolio weight

Useful selectable views later:
- Overview
- Performance
- Income
- Cost basis

Do not begin with Money's dozens of configurable columns. A small set of saved/default views can evolve later.

Portfolio summary should include cash and account totals. Closed positions are hidden by default but viewable.

### 4.3 Security detail

Selecting a holding opens:
- name / symbol / security type
- current holding and market value
- average/open basis summary
- unrealized gain/loss
- price chart if price history exists
- investment income
- activity timeline
- expandable lots

Modern presentation can borrow Robinhood's clarity—shares, market value, average cost, portfolio weight, today/total return—but HomeLedger must distinguish display average cost from tax-lot basis and label unavailable basis honestly.

### 4.4 Enter activity

**New investment activity** starts with a plain-language action chooser. Each action asks only relevant fields. Advanced fields (settlement date, external ID, lot allocation, basis adjustment) stay collapsed unless needed.

### 4.5 Starting an existing account

Wizard:
- account identity/currency/tax label (taxable, tax-deferred, tax-free/other informational label)
- current cash
- “Do you have transaction history?”:
  - import/enter history, or
  - establish current holdings
- for each starting holding: security, units, acquisition date if known, total basis if known
- review calculated account value using manual/imported prices if available

Starting positions are explicit opening events, not fake current-day buys.

---

## 5. Proposed minimal investment domain model

### InvestmentAccount

Use the existing Account identity with future `type="investment"`; add investment-specific settings in a companion record rather than stuffing brokerage fields into every account.

Design fields:
- account_id
- account_kind: brokerage | retirement | education | other
- tax_treatment: taxable | tax_deferred | tax_exempt | unknown
- default_lot_method: fifo initially; specific allocations allowed per sale
- optional broker connection reference (later, not credential material)

Currency remains the account's base/reporting currency for the first phase.

### Security

A household-level identity, reusable across accounts:
- id
- security_type: stock | etf | mutual_fund | bond | cash_equivalent | other
- name
- symbol nullable
- exchange / MIC nullable
- currency
- stable external identifiers when known (CUSIP/ISIN/provider IDs), stored as identifiers not identity truth
- archived/inactive metadata

Do not key securities by ticker alone: tickers change and can collide across exchanges.

### InvestmentEvent

Immutable-ish authoritative economic event (editable through guarded correction workflows):
- id
- account_id
- event_type
- trade/effective date
- settlement date nullable
- security_id nullable according to type
- quantity in fixed decimal units
- unit_price in fixed decimal money
- gross amount / net cash effect in integer minor units
- commission/fee minor units
- memo
- status: pending | cleared | reconciled | review
- source: manual | import | broker
- external/provider ID nullable
- import batch / broker sync provenance nullable
- linked event/group ID for compound events

**Precision:** share quantities and prices need fixed decimal storage, not IEEE floating point. Choose integer-scaled decimals (e.g. units at 10^-8 or 10^-9; prices at a documented scale) or validated decimal strings converted to exact Rust decimal arithmetic. Ordinary currency cash remains integer minor units.

### Lot

Prefer a deterministic projection from acquisition events plus basis adjustments. Persist only data that cannot be recovered from events:
- stable lot identity (can be acquisition event ID)
- acquisition date override if transferred/opening lot
- original/adjusted basis when externally supplied
- basis provenance: calculated | imported | user_supplied | unknown

### LotAllocation

For a sale:
- sale_event_id
- acquisition_lot_id
- quantity disposed

If absent, deterministic default FIFO allocation is calculated and can be materialized/locked when the sale is reconciled. Specific identification is explicit.

### PricePoint

- security_id
- price date/time
- price exact decimal
- currency
- source: manual | import | market_provider
- provider key nullable
- adjusted/unadjusted classification where applicable
- observed_at

Transaction execution price is part of the event; market price history is separate.

### BrokerObservation (later)

Do not store broker position as a holding. Store/read a timestamped observation:
- provider connection
- broker account external ID
- observed_at
- cash/equity
- positions (security mapping + units + broker market value)
- activities/fills cursor metadata

It exists for reconciliation/audit and can be refreshed/discarded without changing HomeLedger history.

---

## 6. Investment event semantics

| Event | Quantity | Cash | Basis / income effect |
|---|---:|---:|---|
| Buy | + | - | creates lot; basis includes capitalizable commission/fees |
| Sell | - | + | consumes lots; realized gain = net proceeds - disposed adjusted basis |
| Dividend | 0 | + | investment income; does not change basis unless classified otherwise |
| Reinvest dividend | + | net 0 | compound event: dividend income + buy/new lot |
| Interest | 0 | + | investment income |
| Commission / fee | 0 | - | investment expense unless attached/capitalized to trade according to event semantics |
| Split | ratio change | 0 | units change; total basis preserved across affected lots |
| Reverse split | ratio change | 0 | same; fractional cash-in-lieu may require linked sale/cash event |
| Return of capital | 0 | + | reduces adjusted basis; quantity unchanged; excess-over-basis tax treatment is a later jurisdictional concern |
| Cash transfer in/out | 0 | +/- | movement between investment cash and another HomeLedger account/external source; not investment performance |
| Security transfer in/out | +/- | 0 | preserves acquisition date/basis when known; no realized gain merely from transfer |
| Opening position | + | 0 | establishes preexisting units with known/unknown acquisition date and basis without fabricating a purchase |
| Basis adjustment | 0 | 0 | guarded expert/import correction with provenance; not a cash event |

A reinvested dividend should be presented as one user action but stored so both income and acquisition semantics remain recoverable. Money's historical one-entry shortcut sometimes obscured reporting; HomeLedger should avoid that ambiguity.

---

## 7. Lots and cost-basis requirements

Minimum correctness:

- Every buy/reinvestment/opening/transfer-in can establish a lot.
- Partial sales consume a quantity from one or more open lots.
- Default disposal: FIFO for the initial implementation.
- User/import may specify lots; specific allocation overrides FIFO.
- Basis includes acquisition costs according to HomeLedger's documented calculation.
- Sale proceeds are net of sale costs for realized-gain calculation.
- Splits adjust units per lot while preserving total lot basis.
- Return of capital reduces basis without changing units.
- Transfer between accounts preserves acquisition date and basis; it must not become sell + buy.
- Unknown incoming basis remains unknown; unrealized/realized gain displays “basis unavailable” for affected quantities rather than a false number.
- Reconciled sales lock their lot allocations from casual edits.

GnuCash is useful here as a correctness reference: it links buys and sells through lots to determine the actual cost of disposed securities, and its return-of-capital semantics reduce basis without changing shares. Modern Robinhood similarly treats each acquisition as a tax lot and allows partial selection of specific lots. Neither UI model should be copied wholesale.

### Deferred tax complexity

Do **not** promise tax-return-grade automation in foundation:
- wash-sale computation across external accounts,
- average-cost elections,
- jurisdiction-specific pooling,
- gifted/inherited basis rules,
- complex option basis,
- partnership/K-1 basis.

Design basis provenance/adjustments so these can be added without rewriting event history.

---

## 8. Price history and market-data abstraction

Define a provider-neutral interface conceptually:

```
MarketDataProvider
  searchSecurities(query)
  getQuote(securityRef)
  getPriceHistory(securityRef, range)
  getSecurityMetadata(securityRef)
```

Provider results are **candidates/observations**, not authoritative security identity. The user or deterministic mapping associates a provider instrument with a HomeLedger Security.

Rules:
- portfolio works with manual prices only;
- imported statement prices may seed price history;
- provider quotes carry source + timestamp;
- stale/missing prices are visible;
- quote refresh never edits investment events;
- historical adjusted prices must be distinguished from raw transaction-era prices;
- corporate actions should not be inferred solely from adjusted quote series.

A yfinance/Yahoo-like source is acceptable as one future adapter, but no domain field should be named after it.

---

## 9. Portfolio valuation, performance and reporting

### Valuation

For as-of date D:
- derive units held through D from events;
- select latest valid price on/before D according to price-source policy;
- holding value = units × price;
- account value = cash through D + holding values;
- portfolio value = sum selected investment accounts.

Missing price => holding value is incomplete/unknown, not silently zero.

### Gains

- open adjusted basis from remaining lots
- unrealized gain = market value - known open basis
- realized gain = net sale proceeds - allocated adjusted basis
- if basis is partly unknown, report known and unknown components explicitly.

### Performance

Do not confuse gain/loss with investment performance. External contributions/withdrawals are not returns.

Recommended sequence:
1. foundation: value, basis, realized/unrealized gain, investment income;
2. UI phase: period change with cash-flow attribution;
3. performance phase: deterministic money-weighted return (XIRR-style) and/or time-weighted return with clearly documented semantics.

Money's annualized-return concept is worth preserving in spirit, but HomeLedger should publish the calculation definition and avoid a mysterious single percentage.

### Reports

Initial investment reports:
- Portfolio value by account/security
- Holdings & cost basis
- Realized gains/losses
- Investment income (dividends/interest)
- Investment activity
- Portfolio performance by period

Later:
- allocation/concentration
- income history
- price/performance charts
- closed positions

Investment reports should live inside the existing Reports area with contextual links into Portfolio/security/account detail.

---

## 10. Investment import and reconciliation

### Import architecture

Create a separate `InvestmentImportBatch`/review pipeline or extend batch provenance at the domain level without coercing investment rows into ordinary `ImportTransactionRow`.

Recommended order:
1. investment QIF (`!Type:Invst`) and/or OFX investment support after event model stabilizes;
2. brokerage CSV mapping only after representative samples exist;
3. broker API activity import later.

OFX is especially valuable because the standard explicitly separates:
- security list,
- investment transactions,
- positions,
- balances/cash,
- open orders.

OFX 2.3 does **not** provide tax lots, so imported current positions cannot reconstruct basis by themselves.

### Review

Import review should map:
- external security → existing/new HomeLedger Security,
- external activity → typed InvestmentEvent,
- duplicates via provider FITID/external ID plus conservative economic matching,
- statement positions → reconciliation observations.

No partial silent import of unsupported event types. Unknown/unsupported actions block or remain review items.

### Reconciliation

Investment statement reconciliation result should show:

**Cash**
- HomeLedger cash
- statement/broker cash
- difference

**Positions**
- security
- HomeLedger derived units
- observed units
- difference
- price/market value informational comparison

**Activity**
- imported/matched/unmatched events

Actions are explicit:
- match existing event,
- import missing event,
- enter opening/transfer adjustment with provenance,
- leave unresolved.

Never provide “make HomeLedger match broker” as a one-click destructive position overwrite.

---

## 11. Optional brokerage read/sync architecture

AgentTrade was audited only for Alpaca boundary lessons. Its useful patterns are:
- a narrow authenticated HTTP client;
- explicit account, positions, open orders and recent-fill retrieval;
- bounded timeouts and surfaced HTTP errors;
- a live account snapshot separated from persisted application state;
- paper/live endpoint consistency checks;
- reconciliation before execution;
- post-order refresh.

HomeLedger should **not** inherit AgentTrade's agent, screening, strategy, bucket, risk, LLM, or automated execution systems.

Provider-neutral boundary:

```
BrokerProvider
  connectionStatus()
  fetchAccountSnapshot()
  fetchPositions()
  fetchActivities(cursor/range)
  fetchOrders(optional)
  mapSecurityIdentifiers()
```

A `BrokerSnapshot` is broker operational truth **at a point in time**. HomeLedger events/lots remain accounting/history truth. Sync produces a reconciliation proposal, not mutation.

Credentials belong in OS credential storage using the same security principle as cloud AI credentials; database records store only non-secret connection identifiers/configuration.

Paper/live is provider metadata and must be unmistakable. Read-only connection should be the first Alpaca capability.

---

## 12. Possible future manually confirmed trade boundary

Design now, implement much later:

```
TradeIntent (HomeLedger UI)
   ↓
deterministic validation
   ↓
BrokerProvider.previewOrder()
   ↓
exact human review: account, symbol, side, quantity/notional,
order type, estimated price/cost, time-in-force, paper/live
   ↓
explicit confirmation
   ↓
BrokerProvider.submitOrder()
   ↓
BrokerOrderReceipt (broker order id/status)
   ↓
later fills/activity sync
   ↓
reconcile/import filled economic event into HomeLedger
```

Important: submitting an order does **not** create an authoritative buy/sell event. A fill (or reconciled broker activity) does. Partial fills can create one grouped event with fill detail or multiple linked fill events depending on later design.

Trading permission must be separate from read permission. No AI task may call `submitOrder`.

---

## 13. AI-analysis boundary

Future investment AI follows the existing HomeLedger pattern:

```
local investment events + prices
  → deterministic holdings/lots/gains/performance/concentration calculations
  → task-specific PortfolioAnalysisContext
  → Privacy Firewall exact payload
  → user-approved provider
  → advisory explanation only
```

Possible deterministic contexts:
- portfolio performance explanation
- concentration/exposure summary
- investment-income summary
- portfolio change summary
- security/sector exposure explanation

The LLM does not calculate basis, lots, gains, return, valuation, reconciliation differences or orders. Market metadata can be included only as explicitly identified external context. No new AI provider is required.

---

## 14. Privacy and security implications

- Investment events, lots, prices, mappings and reconciliations remain in the local authoritative database.
- Market-data calls reveal requested symbols/instruments and network metadata to the configured provider; provider configuration and refresh should be opt-in.
- Broker connectivity is substantially more sensitive than quote retrieval. API secrets must live in OS credential storage, not SQLite or logs.
- Prefer read-only broker credentials/scopes initially.
- Provider responses are untrusted input: bound size/time, validate numeric precision/enums/dates, reject redirects where appropriate, and never log secrets.
- Paper/live state must be explicit in UI and audit metadata.
- Broker snapshots must not silently mutate history.
- Future trade submission requires a distinct permission and explicit confirmation.
- Backups will contain investment history and locally cached market/broker observations once those tables exist; documentation should say so.
- Investment AI contexts should default to aggregated/sanitized portfolio facts and follow existing Privacy Firewall consent.

---

## 15. Design-level repository and schema implications

No migration is created by this design. A likely future schema family is:

- `investment_account_settings`
- `securities`
- `security_identifiers`
- `investment_events`
- `investment_event_components` or explicit compound-event links
- `investment_lot_allocations`
- `security_prices`
- `investment_import_batches` / provenance
- `investment_reconciliations` + observed positions
- later: `market_provider_mappings`
- later: `broker_connections` (non-secret metadata)
- later: `broker_sync_runs` / observations

Avoid a mutable `holdings` table as the primary truth. If performance later requires cached projections, caches must be rebuildable from events/prices and clearly non-authoritative.

Repository shape:

```ts
interface InvestmentRepository {
  listSecurities(...)
  create/updateSecurity(...)
  listInvestmentEvents(...)
  create/update/deleteInvestmentEvent(...)
  deriveHoldings(...)
  listOpenLots(...)
  allocateSaleLots(...)
  listPrices(...)
  upsertManual/importedPrices(...)
  calculatePortfolioSnapshot(...)
  calculateInvestmentPerformance(...)
  // later import/reconciliation methods
}
```

The Rust/native layer should own validation and authoritative calculations just as it owns ledger integrity today. TypeScript can share pure presentation calculations/tests where useful, but persistence invariants must be enforced natively.

---

## 16. Edge cases and unresolved decisions

### Must decide before foundation migration

1. **Decimal scale:** exact share/unit and price precision. Recommend fixed-scale integers or a decimal library, never float.
2. **Investment account cash implementation:** intrinsic derived cash balance vs linked ordinary cash subledger. Recommendation: intrinsic investment cash projection with explicit HomeLedger account-transfer links, because exposing a second account recreates Money's complexity without user benefit.
3. **Trade vs settlement date:** store both; define holdings/basis by trade/effective date and cash settlement behavior explicitly.
4. **Commission basis treatment:** define buy/sell formulas and keep fee fields explicit.
5. **Default lot method:** FIFO initially; specific identification supported. Do not implement every tax method in foundation.
6. **Security identity:** stable internal ID plus multiple external identifiers; ticker is metadata.
7. **Multi-currency:** foundation should probably require security/event cash in account currency unless foreign-currency accounting is designed explicitly. Do not fake FX.
8. **Starting holdings:** formal opening-position event with unknown-basis support.

### Important later edge cases

- fractional shares
- cash-in-lieu after splits
- symbol/name/exchange changes
- mergers, spin-offs and basis allocation
- mutual-fund capital-gain distributions
- bonds/par pricing/accrued interest
- options/shorts/margin
- worthless securities
- delistings
- transfer-in with delayed basis
- corrected/reclassified dividends
- return of capital exceeding basis
- wash sales
- DRIP fractional quantities
- broker activity corrections/cancellations
- duplicate fills / partial fills
- stale or conflicting quote providers
- adjusted vs unadjusted historical prices
- closed accounts with retained holdings/history

Money supported some advanced activities and had workarounds for others. HomeLedger should not block the schema from representing corporate actions eventually, but the first release should not expose a sprawling “special activities” system before ordinary stock/ETF/fund workflows are excellent.

---

## 17. Recommended phased implementation roadmap

### Phase I — Portfolio foundation

Goal: accounting truth before market polish.

- investment account type/settings
- Security master
- exact-decimal investment event model
- intrinsic investment cash
- buy/sell/dividend/reinvest/interest/fee/split/return-of-capital/cash transfer/security transfer/opening position
- deterministic holdings
- FIFO + specific lot allocation
- basis provenance/unknown basis
- manual prices and price history
- core Rust invariants/tests
- backup/restore/recovery coverage

**Exit criterion:** a fully offline user can accurately reconstruct a brokerage account and derive cash, shares, lots, basis, realized/unrealized gain and value.

### Phase II — Money-style Portfolio Manager UI

- Portfolio workspace
- investment account Portfolio/Activity/Cash/Reconcile shell
- security detail
- closed positions
- manual activity workflows
- starting-position wizard
- portfolio/account/security valuation
- initial investment reports
- Overview/net-worth integration
- contextual navigation

**Why before imports:** it gives imported data a mature review destination and lets us dogfood accounting manually.

### Phase III — Investment imports and statement reconciliation

- investment OFX and/or QIF
- security mapping
- investment import review/duplicates
- positions/balance comparison
- investment reconciliation
- CSV mapping only with real samples

### Phase IV — Market-data enrichment

- provider-neutral MarketDataProvider
- security search/metadata
- current quotes
- historical prices
- refresh/staleness UX
- charts
- no-provider/manual mode remains complete

This comes after accounting/import because quotes should enrich a trustworthy portfolio, not become its source of truth.

### Phase V — Optional broker read/reconciliation

- provider-neutral BrokerProvider
- Alpaca read-only adapter first
- OS-vault credentials
- account/position/activity/fill snapshots
- paper/live labeling
- reconcile broker observations against HomeLedger history
- explicit import proposals

### Phase VI — Optional AI portfolio analysis

Only after deterministic performance/concentration/income calculations are stable:
- portfolio analysis task contexts
- Privacy Firewall
- existing local/cloud providers
- advisory explanations only

### Phase VII — Possible manually confirmed broker trading

Only if still desirable:
- separate trade permission
- preview/confirmation
- submit ordinary manual order
- status/fill retrieval
- fills reconcile back into HomeLedger
- no autonomous path

**Roadmap change from the initial hypothesis:** keep market-data enrichment *after* investment import/reconciliation unless UI usability proves basic quote lookup is needed earlier. Manual/imported prices are sufficient to validate the foundation, while import work tests the harder accounting model before network enrichment adds another variable.

---

## Not Yet

The Investment/Portfolio phase explicitly does **not** include:

- autonomous trading agents
- algorithmic strategies
- strategy buckets
- stock-picking agents
- LLM-generated orders
- unattended order placement
- autonomous rebalancing
- AgentTrade's research/analysis/risk/execution pipeline
- options, short selling or margin in the initial foundation
- tax-return preparation or guaranteed tax-lot reporting
- wash-sale automation
- cryptocurrency exchange connectivity
- banking aggregation/bank sync
- social/community investing
- market news feeds as a product pillar
- a mobile-first trading interface
- investment AI tasks or new AI providers during foundation
- a hard dependency on Yahoo Finance/yfinance
- a hard dependency on Alpaca
- v0.48 implementation as part of this design PR

---

## Research notes / references

Primary Money reconstruction used Microsoft historical material and archived Money documentation. Microsoft described the Portfolio Manager's saved/custom views and highlights in Money 2003, and Money 2005's shared Portfolio Manager plus brokerage downloads. Archived Microsoft KB material documents investment cash, closed positions, price history, special activities and the importance of retaining investment history. The Money 2005-era book table of contents independently confirms the workflow breadth: account setup, stocks, funds, bonds, buys/sells, dividends/reinvestment, splits, prices and investment analysis.

Accounting edge-case cross-checks used current GnuCash documentation for brokerage cash/security separation, lots, partial sales, return of capital, dividends and splits. OFX 2.3 was used to validate the import/reconciliation distinction between transactions, positions, balances, orders and securities. Robinhood documentation was used only as a modern presentation/tax-lot reference. AgentTrade main was inspected for Alpaca API/reconciliation lessons, not product design.

Key public references:
- Microsoft Money 2005 announcement: https://news.microsoft.com/source/2004/09/21/microsoft-unveils-simplified-approach-to-financial-management-and-helps-people-make-sense-of-their-money/
- Microsoft Money 2003 announcement: https://news.microsoft.com/source/2002/08/01/new-edition-of-microsoft-money-offers-premium-financial-services-for-free-expands-integration-of-timely-web-based-tools-and-information/
- Microsoft Investor Portfolio Manager history: https://news.microsoft.com/source/1996/10/10/microsoft-announces-availability-of-microsoft-investor-2-0/
- GnuCash Investments guide: https://www.gnucash.org/docs/v5/C/gnucash-guide/chapter_invest.html
- GnuCash lots: https://www.gnucash.org/docs/v5/C/gnucash-manual/tool-lots.html
- GnuCash return of capital: https://www.gnucash.org/docs/v5/C/gnucash-guide/invest-retofcap.html
- OFX 2.3 Investment specification: https://financialdataexchange.org/common/Uploaded%20files/OFX%20files/OFX%20Banking%20Specification%20v2.3.pdf
- Robinhood tax lots: https://robinhood.com/us/en/support/articles/tax-lots/
- Robinhood stock detail presentation: https://robinhood.com/us/en/support/articles/viewing-stock-detail-pages/

