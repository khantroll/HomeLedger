# HomeLedger Portfolio Foundation Specification

**Status:** implementation specification proposal; documentation only  
**Architecture authority:** `docs/INVESTMENT_PORTFOLIO_ARCHITECTURE.md` as merged by PR #43  
**Implementation status:** no production code, migrations, dependencies, schema changes, provider integration, or version bump are part of this specification.

## 1. Purpose and scope

Portfolio Foundation is the accounting/domain substrate for investments. It must make a fully offline investment account reconstructable from authoritative dated events and manual prices before Portfolio UI, import, network market data, broker connectivity, AI analysis, or trading depend on it.

The invariant remains:

`Investment account → investment events → securities/lots → derived holdings → portfolio`

Foundation includes:
- investment-account settings and intrinsic investment cash;
- reusable securities;
- exact investment quantities/prices;
- authoritative investment events;
- deterministic holdings and open lots;
- FIFO default plus explicit specific-lot allocation;
- known/unknown basis provenance;
- manual price history;
- deterministic as-of snapshots;
- guarded historical correction semantics;
- persistence/repository contracts and native invariants;
- backup/recovery compatibility and tests.

Foundation explicitly excludes Portfolio/Watchlist UI, market providers, investment OFX/QIF import, brokerage sync, AI tasks, and trading.

## 2. Decisions locked for implementation

### 2.1 Numeric representation

Do not use IEEE floating point for authoritative investment arithmetic.

- Currency cash, fees, gross/net cash effects and total basis remain signed integer minor units in the account currency.
- Security quantities use signed fixed-scale integers with **8 decimal places** (`quantity_scale = 100,000,000`).
- Unit/security prices use signed fixed-scale integers with **8 decimal places** (`price_scale = 100,000,000`).
- Multiplication/division uses checked wide-integer or exact-decimal intermediate arithmetic in Rust and an explicitly documented rounding step when converting a calculated cash value to currency minor units.
- Persisted scale is a schema/domain contract; display precision is independent.
- Inputs exceeding supported scale are rejected rather than silently rounded unless the user is explicitly shown and accepts a rounding operation.

Eight decimal places accommodates ordinary fractional securities while keeping the initial model simple. A future migration can add a per-security precision contract if a real instrument requires more; Foundation must not infer precision from UI formatting.

### 2.2 Account currency and multi-currency

Foundation investment accounts have exactly one account/reporting currency inherited from `Account`.

All event cash amounts and Foundation security prices used for valuation must be denominated in that account currency. A security may retain descriptive currency metadata, but Foundation does not perform FX conversion.

If an event/price requires unsupported foreign-currency conversion, reject or mark it unsupported; never assume 1:1 FX.

### 2.3 Intrinsic investment cash

Investment cash is an intrinsic derived balance of the investment account, not a visible synthetic checking/cash account and not a fake security.

Define:

`cash(asOf) = opening_cash + Σ(event cash effects effective for cash through asOf)`

Investment account settings therefore need an explicit opening cash amount and opening/as-of date semantics.

Transfers between an investment account and another HomeLedger account must eventually be linked so the household sees one transfer rather than income/expense. Foundation must reserve stable linkage semantics, but ordinary-account UI integration can land with the Portfolio/account workflow.

Cash must participate in account value and net worth while remaining separate from security holdings.

### 2.4 Trade date and settlement date

Store both `trade_date` (the economic/effective event date) and nullable `settlement_date`.

Foundation rules:
- holdings, lots, acquisition/disposal dates, basis and realized-gain chronology use **trade date**;
- investment income recognition uses the event's effective/trade date;
- cash projection uses **settlement date when supplied, otherwise trade date**;
- an as-of snapshot may therefore show a trade in holdings before its cash settles;
- UI later must be able to explain unsettled cash rather than hiding the distinction.

This rule is deterministic and avoids changing ownership history merely because settlement conventions change.

### 2.5 Fees, commissions and basis

Foundation calculation rules:
- **Buy:** lot basis = gross acquisition cost + capitalizable trade commission/fees. Cash effect = negative net amount paid.
- **Sell:** realized gain/loss = net sale proceeds after trade commission/fees − adjusted basis disposed.
- **Standalone account/service fee:** cash decreases and the amount is an investment expense; it does not change security basis unless the user/import explicitly represents a supported basis adjustment.
- **Dividend/interest:** cash income; no basis change.
- **Reinvest dividend:** compound event semantics preserve both income and acquisition. New-lot basis equals reinvested acquisition amount plus any acquisition fee represented by the event.
- **Return of capital:** cash increases and adjusted basis decreases; Foundation must not silently drive basis below zero. Amount beyond known remaining basis becomes an unresolved/advanced tax treatment rather than fabricated negative basis.

Tax-law edge cases remain outside Foundation; these rules define HomeLedger accounting projections, not tax advice.

### 2.6 Lot method

Account default is **FIFO**.

- Acquisition/opening events establish lots.
- A sale without explicit allocations consumes eligible lots FIFO by acquisition date, with a stable tie-breaker by event/lot ID.
- A sale may carry explicit specific-lot allocations; those override FIFO for allocated quantity.
- Allocation quantity must equal disposed quantity before a sale can become cleared/reconciled.
- Reconciled sale allocations are protected by guarded correction.
- Foundation does not implement average cost, LIFO, wash-sale optimization, or jurisdiction-specific pooling.

### 2.7 Security identity

Security identity is a HomeLedger-generated immutable internal ID.

Ticker/symbol, name, exchange/MIC, currency and external identifiers are attributes/mappings, never primary identity. Multiple external identifiers may map to one Security, with uniqueness enforced within an identifier namespace where appropriate.

A symbol change does not create a new holding. A genuinely different legal/security instrument does.

### 2.8 Opening positions

Existing holdings are represented by explicit `opening_position` events, not fake buys.

An opening position records:
- account/security;
- units;
- effective/as-of date;
- acquisition date when known;
- total basis when known;
- basis provenance;
- memo/source/provenance.

It has **no cash effect**. Known acquisition date controls lot chronology; otherwise the opening-position effective date is used operationally while acquisition date remains visibly unknown.

Unknown basis is nullable/unknown and must never become zero.

### 2.9 Historical correction representation

Use **superseding event revisions**, preserving stable logical event identity.

Design contract:
- each economic event has a stable logical `event_id`;
- persisted event revisions have their own immutable revision identity/version;
- pending/review current revisions may be replaced by direct-edit semantics without requiring a historical correction reason;
- once cleared or reconciled, a revision is never destructively overwritten;
- correcting it creates a new revision linked to the prior revision with correction timestamp, reason, actor/source and provenance;
- the newest valid revision is the effective representation of that logical event;
- prior revisions remain queryable for audit/recovery but are excluded from normal economic projections;
- cancellation/void of protected history is represented by a superseding revision/state, not physical deletion;
- any correction invalidates/rebuilds dependent holdings, lots, allocations, basis, gains and as-of snapshots from the earliest affected effective date.

This is not a general-purpose double-entry append-only journal. It is a narrowly defined provenance-preserving revision model for investment history.

## 3. Account and security contracts

### InvestmentAccountSettings

Conceptual fields:
- `account_id` FK to existing Account with `type=investment`;
- `account_kind`: brokerage | retirement | education | other;
- `tax_treatment`: taxable | tax_deferred | tax_exempt | unknown;
- `default_lot_method`: fifo (Foundation);
- `opening_cash_minor`;
- `opening_date`;
- created/updated metadata.

Account deletion/closure must obey existing guarded account lifecycle behavior. Investment history cannot be orphaned.

### Security

Conceptual fields:
- internal ID;
- security type: stock | etf | mutual_fund | bond | cash_equivalent | other;
- display name;
- symbol nullable;
- exchange/MIC nullable;
- descriptive currency;
- archived/inactive state;
- created/updated metadata.

Separate identifier records support namespace/value mappings such as CUSIP, ISIN, FIGI or future provider IDs. No market provider field belongs in core Security.

## 4. Investment event contract

Foundation event types:
- buy
- sell
- dividend
- reinvest_dividend
- interest
- fee
- split
- return_of_capital
- cash_transfer
- security_transfer
- opening_position
- basis_adjustment

Every event has:
- stable logical event ID;
- immutable revision identity/version;
- account ID;
- event type;
- trade/effective date;
- settlement date nullable;
- security ID nullable only when the event type permits;
- exact quantity where applicable;
- exact unit price where applicable;
- gross/net cash fields and fee fields where applicable;
- status: review | pending | cleared | reconciled;
- source: manual | import | broker;
- memo;
- external/source identifier nullable;
- source/import/sync provenance nullable;
- compound/group linkage nullable;
- correction/revision metadata.

### Status rules

- `review`: incomplete or requires human resolution; cannot contribute ambiguous economics to trusted totals.
- `pending`: complete enough to project but not cleared; directly editable.
- `cleared`: accepted economic history; guarded correction required.
- `reconciled`: matched to external statement/evidence; guarded correction required and reconciliation relationship preserved.

A status transition must validate all event-type invariants.

## 5. Event semantics and invariants

### Buy
Requires security, positive quantity and nonnegative acquisition amounts. Adds quantity, creates a lot, decreases cash at settlement/effective cash date.

### Sell
Requires security and positive disposed quantity. Decreases quantity and increases cash. Cannot dispose more units than available as of trade date unless a future short-selling model explicitly allows it. Lot allocation must resolve exactly before cleared/reconciled status.

### Dividend
Requires security when attributable to one; quantity unchanged; increases cash and investment income.

### Reinvest dividend
One user action with compound recoverable semantics: records investment income and an acquisition/new lot while net cash is normally zero. The model must not lose the income component merely because cash did not remain in the account.

### Interest
Quantity unchanged; increases cash and investment income.

### Fee
Quantity unchanged unless explicitly part of trade economics; standalone fee decreases cash.

### Split / reverse split
Requires security and a positive exact ratio representation. Changes lot/holding quantities while preserving total basis. Fractional cash-in-lieu is not silently invented; it requires an explicit linked economic event later.

### Return of capital
Quantity unchanged; increases cash and reduces known adjusted basis proportionally/according to deterministic lot policy. Unknown basis remains unknown.

### Cash transfer
Changes intrinsic investment cash. It is not investment performance or income. Cross-account linkage must prevent household double counting.

### Security transfer
Moves units without realizing gain. Transfer linkage must preserve acquisition date and basis where known. Foundation must not model it as sell + buy.

### Opening position
Adds units with no cash effect and creates opening lot information. Basis/date may be unknown.

### Basis adjustment
No cash or quantity effect. Requires explicit reason/provenance and guarded treatment once history is cleared/reconciled.

## 6. Derived lots and holdings

Authoritative state is event history plus protected allocation/provenance data.

A holding snapshot for `account/security/asOfDate` contains:
- units;
- open lots;
- known adjusted basis;
- quantity whose basis is unknown;
- selected/manual price if available;
- price timestamp/source;
- market value when price is available;
- unrealized gain only for quantities with sufficient basis/price information;
- completeness flags.

Do not persist a mutable authoritative holdings balance.

A lot is derived from buy, reinvest, opening-position or transferred-in acquisition history. Stable lot identity should derive from its originating acquisition event/revision or an explicit stable lot ID whose provenance is recoverable.

Corrections before a later sale can change FIFO allocation; therefore correcting protected historical acquisitions/sales requires downstream recalculation and an explicit impact preview in later UI.

## 7. Manual price history and valuation

Foundation supports local manual price points without network access.

A price point has:
- security;
- observation date/time;
- exact fixed-scale price;
- currency;
- source = manual for Foundation (schema may reserve import/provider source enum);
- provenance/created metadata.

For an as-of snapshot:
1. derive event state through the requested date;
2. derive cash using settlement/effective-cash rule;
3. select the latest eligible price on or before the requested as-of time/date;
4. value units at that price;
5. surface price date/source;
6. mark missing/stale data explicitly according to later UI policy.

A missing price is unknown, never zero.

Foundation APIs must accept `asOfDate`; “today” is not baked into the domain. This preserves future `Portfolio as of: Today ▾` reconstruction without a second historical model.

Price edits never change event history, lots or basis.

## 8. Repository/service boundary

Use an investment-specific native/repository surface rather than widening ordinary transactions with security fields.

Conceptual operations:

```text
InvestmentRepository
  getInvestmentAccountSettings(accountId)
  create/updateInvestmentAccountSettings(...)

  list/get/create/update/archiveSecurity(...)
  list/add/removeSecurityIdentifier(...)

  createInvestmentEvent(...)
  updatePendingOrReviewInvestmentEvent(...)
  correctHistoricalInvestmentEvent(eventId, replacement, reason)
  getInvestmentEventHistory(eventId)
  listInvestmentEvents(accountId, range/status)

  deriveHoldings(accountId?, asOfDate)
  listOpenLots(accountId, securityId, asOfDate)
  setSpecificLotAllocation(saleEventId, allocations)

  add/update/deleteManualPrice(...)
  listPrices(securityId, range)

  calculatePortfolioSnapshot(accountIds?, asOfDate)
```

The Rust/native layer owns validation, exact arithmetic, event correction invariants, lot allocation and authoritative projections. TypeScript may format/present results but must not become a second accounting engine.

## 9. Design-level persistence plan

The first implementation migration is expected to add a coherent table family, names subject to implementation review:

- `investment_account_settings`
- `securities`
- `security_identifiers`
- `investment_events` (stable logical identity/current revision metadata)
- `investment_event_revisions` or an equivalent normalized revision representation
- `investment_lot_allocations`
- `security_prices`

Important constraints:
- foreign keys enforced;
- account referenced by investment settings/events must be an investment account at the domain/native validation boundary;
- exact quantity/price stored without REAL/float;
- revision chain cannot be cyclic or silently overwritten;
- protected event revision history cannot be physically deleted by ordinary UI actions;
- allocation quantities must be positive and cannot exceed lot/sale quantities;
- price source/date/security uniqueness policy must be explicit;
- external identifiers are namespace-scoped;
- all derived caches, if any are introduced for performance, are disposable/rebuildable.

This section specifies the intended implementation shape but creates no migration in this PR.

## 10. Correction workflow contract

Later UI for correcting a cleared/reconciled event must:
1. show the current economic event and protected status;
2. explain that changing it may alter later holdings/basis/performance;
3. collect replacement values and a correction reason;
4. deterministically validate the proposed replacement;
5. calculate/identify affected downstream range (at minimum account/security from earliest affected date);
6. require explicit confirmation;
7. persist a superseding revision and provenance;
8. rebuild/recalculate dependent projections;
9. preserve reconciliation provenance and mark any now-invalid reconciliation/allocation for review rather than pretending it remains valid.

Foundation service tests must prove old revisions remain recoverable and only the current effective revision participates in ordinary projections.

## 11. Backup, restore and recovery

Investment authoritative tables are ordinary local HomeLedger database state and therefore must be included in encrypted backups and automatic recovery snapshots.

When the implementation migration lands:
- pre-migration recovery behavior remains intact;
- restore validation recognizes the new schema version;
- restored investment events/revisions/allocations/prices must reproduce the same deterministic snapshots;
- correction provenance must survive backup/restore;
- no provider/network connection is needed to restore a usable manually priced portfolio.

## 12. Foundation test specification

### Arithmetic and precision
- fractional quantity round-trip at 8 decimals;
- price round-trip at 8 decimals;
- checked multiplication to currency minor units;
- deterministic documented rounding;
- reject overflow and unsupported precision.

### Event semantics
- buy creates correct units/lot/basis/cash;
- partial/full sell consumes FIFO;
- explicit specific-lot sale overrides FIFO;
- dividend/interest change income/cash but not units;
- reinvest preserves income plus new lot with zero/appropriate net cash;
- fee treatment;
- split/reverse split preserves total basis;
- return of capital reduces basis without negative fabricated basis;
- cash transfer excluded from return/income;
- security transfer preserves known basis/date;
- opening position has no cash effect;
- basis adjustment changes basis only.

### Unknown basis
- unknown opening basis remains unknown;
- mixed known/unknown lots do not produce false aggregate gain;
- sell of unknown-basis quantity reports incomplete realized gain.

### Dates/as-of
- trade appears in holdings on trade date;
- cash moves on settlement date when supplied;
- snapshots before/after trade and settlement are deterministic;
- historical price selection uses latest eligible observation on/before as-of;
- future events/prices cannot leak into past snapshots.

### Integrity/corrections
- pending/review edit allowed;
- cleared/reconciled destructive update rejected;
- correction creates superseding revision;
- prior revision remains retrievable;
- corrected acquisition recalculates later FIFO/basis;
- corrected sale recalculates realized/open lots;
- impacted reconciliations/allocations are invalidated or flagged deterministically.

### Isolation from household reports
- buy/sell asset conversions do not become ordinary spending/income;
- investment account total can feed net worth without double counting security value/cash;
- transfers do not create household income/expense.

### Persistence/recovery
- schema constraints;
- round-trip all event types;
- backup/restore reproduces portfolio snapshot and revision history.

## 13. Implementation sequence after approval

This is the proposed order for the eventual implementation PRs; approval of this specification does not authorize implementation by itself.

1. **Domain primitives + migration**
   - investment account type/settings;
   - exact quantity/price primitives;
   - Security/identifiers;
   - event/revision tables and types;
   - manual price persistence.

2. **Native event engine**
   - event validation/status rules;
   - intrinsic cash effects;
   - guarded correction/revision service;
   - event-type semantics.

3. **Lots and deterministic projections**
   - lot derivation;
   - FIFO;
   - specific allocation;
   - basis provenance/unknown basis;
   - as-of holdings/cash.

4. **Valuation/snapshot**
   - manual price selection;
   - account/portfolio as-of snapshot;
   - gain/value completeness flags.

5. **Recovery/integration hardening**
   - backup/restore validation;
   - ordinary-report isolation;
   - net-worth integration contract;
   - comprehensive native tests.

Only after Foundation is trustworthy should the Money-style Portfolio UI and minimal read-only market-data slice begin.

## 14. Acceptance criteria for Portfolio Foundation

Foundation is complete when, without any network service, HomeLedger can:
- create an investment account with intrinsic cash;
- identify securities independently of accounts/tickers;
- record the supported Foundation event set with exact arithmetic;
- reconstruct holdings and cash for today or an arbitrary past date;
- derive open lots using FIFO and explicit specific allocation;
- preserve known and unknown basis correctly;
- calculate realized/unrealized gain only where data is sufficient;
- value holdings from manual historical prices without treating missing price as zero;
- correct protected historical events without destructive history rewrite;
- reproduce results after backup/restore;
- keep investment asset conversions out of ordinary household spending/income;
- expose deterministic repository/native outputs suitable for the later Portfolio UI.

## 15. Deferred beyond Foundation

Not part of Foundation:
- Portfolio Manager UI and security-detail UI;
- Watchlist;
- automatic market-data provider/search/quotes;
- richer charts/metadata;
- investment OFX/QIF/CSV import;
- investment statement reconciliation UI;
- broker connectivity/Alpaca;
- AI portfolio analysis;
- order preview/submission;
- autonomous trading/rebalancing;
- options, shorts or margin;
- wash-sale automation/average-cost elections;
- tax-return-grade calculations;
- FX/multi-currency investment accounting;
- complex corporate actions beyond the Foundation event semantics;
- news/social/community features.

## 16. Questions intentionally deferred

These do not block Foundation:
- exact first market-data provider;
- Watchlist persistence/UI details;
- richer provider cache/fallback policy;
- broker adapter selection beyond preserving the provider-neutral boundary;
- performance methodology beyond Foundation gains/value primitives;
- complex tax/corporate-action policy;
- trading support.

No unresolved architectural question remains that requires changing the approved PR #43 architecture before Foundation implementation. Implementation review may still refine physical table names/indexes and API ergonomics without changing these contracts.
