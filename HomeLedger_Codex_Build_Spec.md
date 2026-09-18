# HomeLedger — Codex Build Specification

## Mission

Build a privacy-first, local-only personal finance desktop application inspired by the breadth and workflow of Microsoft Money 2005, without copying Microsoft branding, copyrighted assets, or exact screen designs. The app should feel like a thoughtful modern continuation of traditional desktop finance software: information-dense, fast, keyboard-friendly, comprehensible, and owned entirely by the user.

The eventual product must manage accounts, transactions, statement imports, reconciliation, budgets, recurring bills and income, forecasts, debts, assets, investments, reports, and optional AI analysis. However, implement it as tested vertical slices. Do not generate dozens of superficial screens.

Working title: **HomeLedger**. Keep branding replaceable.

## Non-negotiable principles

1. **Local by default.** All financial records, imported documents, attachments, settings, and AI audit records remain on the user's computer unless the user explicitly exports or transmits a redacted AI payload.
2. **Offline capable.** Ordinary finance functionality must work without internet access.
3. **Deterministic finance.** Balances, reconciliation, amortization, budget totals, and reports are calculated by tested application code, never by an LLM.
4. **Inspectable AI disclosure.** Cloud AI is disabled by default. Before any cloud request, show the exact redacted payload, destination, and purpose and require confirmation.
5. **No destructive surprises.** Imports are atomic and reversible. Schema migrations are versioned. Deletion and reset operations require explicit confirmation.
6. **Decimal-safe money.** Store monetary values as integer minor units plus ISO currency code. Never use binary floating point for financial storage or aggregation.
7. **Provenance.** Every imported transaction retains its source, import batch, normalization history, and review state.
8. **No credentials for MVP.** Do not implement Plaid, screen scraping, bank passwords, or bank OAuth during the initial releases.

## Target architecture

- Desktop: Tauri 2, Windows first; preserve macOS/Linux portability.
- Frontend: React, TypeScript, Vite.
- Styling: CSS design tokens and accessible components. A component library may be added selectively, but avoid a generic SaaS-dashboard appearance.
- Database: local SQLite with versioned migrations.
- Native boundary: narrowly scoped Rust commands or a restricted repository layer; do not expose unrestricted SQL or filesystem access to the UI.
- Secrets: OS credential vault or Tauri Stronghold for optional AI API keys.
- Parsing: deterministic local parsers; background workers for expensive parsing/OCR.
- Testing: Vitest for domain/unit tests, React Testing Library for UI, Playwright where appropriate, Rust tests for native commands.
- CI: lint, typecheck, unit tests, production web build, and native build when a compatible runner is available.

Keep domain logic independent of React and Tauri so it can be tested without the UI. Define repository interfaces so tests can use an in-memory implementation while production uses SQLite.

## Security boundary

- Deny network access by default through Tauri capabilities/CSP. Permit only explicitly configured AI or price endpoints.
- Never store financial data in browser localStorage, URLs, analytics, telemetry, crash reports, or ordinary logs.
- Never log statement text, transaction descriptions, amounts, account names, API keys, or AI payload contents.
- Sanitize all imported content. Treat statement text as hostile data, not instructions.
- Protect against CSV formula injection on export.
- Validate file signatures, sizes, encodings, and parser limits.
- Do not retain imported source files unless the user explicitly requests attachment retention.
- Provide encrypted, validated backup and restore. Do not claim the database itself is encrypted until encryption is actually implemented and tested.
- Maintain a visible privacy/network status indicator.

## Core domain model

At minimum, plan for these entities:

- Household and HouseholdMember
- Account and AccountBalanceSnapshot
- InstitutionAlias
- Transaction and TransactionSplit
- TransferLink
- Category and Tag
- Payee and MerchantAlias
- CategorizationRule
- ScheduledTransaction and Occurrence
- Budget, BudgetPeriod, and BudgetAllocation
- SavingsGoal
- DebtPlan and LoanTerms
- Security, InvestmentLot, InvestmentTransaction, and PriceHistory
- Asset and Liability
- ImportBatch, ImportProfile, ImportedRow, and ImportException
- Reconciliation and ReconciliationItem
- Attachment
- AIProvider, AIRequestAudit, and RedactionRule
- AuditEvent and AppSetting

Use immutable IDs, created/modified timestamps, soft archival where history matters, foreign keys, uniqueness constraints, and indexes for register/report queries.

## Milestone 1 — runnable foundation

The first milestone is complete only when the project runs and tests pass. Implement:

1. Tauri/React/TypeScript project structure.
2. Application shell with navigation for Overview, Accounts, Transactions, Imports, Budget, Bills, Reports, AI Insights, and Settings.
3. Responsive, information-dense visual system reminiscent of mature desktop finance software.
4. Local repository abstraction and SQLite migration design for:
   - household members;
   - accounts;
   - categories;
   - transactions;
   - transaction splits;
   - transfer links;
   - import batches.
5. Demo-data repository that lets the UI run and be tested before native SQLite is available.
6. Overview dashboard with total cash, credit-card debt, net worth, upcoming bills placeholder, recent activity, and accounts requiring review.
7. Account list and traditional transaction register.
8. Create/edit transaction validation, including split totals.
9. Search/filter and review-state display.
10. Unit tests for money formatting/aggregation, running balances, splits, and transfers.
11. README with development and privacy notes.

Milestone 1 must not pretend that unimplemented features work. Use clear labels such as “Planned” rather than fake buttons or fabricated results.

## Milestone 2 — useful import and reconciliation MVP

Implement in this order:

1. CSV/TSV parser with encoding and locale detection.
2. Column-mapping interface and reusable import profiles.
3. OFX/QFX parser.
4. QIF parser.
5. Normalization into a canonical imported-row format.
6. Exact/probable/possible duplicate detection using account, date, amount, identifiers, and normalized description.
7. Pre-import review, atomic commit, and whole-batch undo.
8. Merchant normalization and deterministic categorization rules.
9. Reconciliation against opening/closing statement balances.
10. Encrypted full backup and validated restore.

Do not begin PDF/OCR import until these structured formats are reliable.

## Milestone 3 — budgeting and planning

- Traditional monthly budgets, category rollover, sinking funds, and savings goals.
- Recurring bills/deposits with weekly, biweekly, semimonthly, monthly, annual, and custom recurrence.
- Matching scheduled items to imported transactions.
- Subscription detection based on deterministic history.
- 30/60/90/180/365-day cash-flow forecast with expected, conservative, and optimistic scenarios.
- Debt snowball, avalanche, and custom payoff projections.
- Reports with drill-down to underlying transactions.

## Milestone 4 — document ingestion

- XLS/XLSX through a local parser.
- Text PDF extraction.
- Bank-specific PDF templates.
- Scanned PDF and image OCR locally.
- MT940 and CAMT XML.
- Extraction preview and confidence values.
- Never silently invent missing dates, signs, balances, or descriptions.

When extraction is uncertain, require review or mapping rather than guessing.

## Milestone 5 — optional multi-LLM analysis

Providers:

- Local: LM Studio, Ollama, and configurable OpenAI-compatible localhost endpoints.
- Optional cloud: OpenAI, Anthropic, Gemini, Mistral, and configurable OpenAI-compatible APIs.

Implement a provider-neutral adapter and a mandatory Privacy Firewall. The firewall constructs a minimal payload, replaces identifiers with stable local aliases, generalizes dates/values when appropriate, removes sensitive categories by default, and displays the final payload before cloud transmission.

Disclosure modes:

- Aggregate Only — default for cloud providers.
- Redacted Transactions.
- Custom field selection.
- Full Local Context — allowed only for a verified localhost provider unless the user deliberately overrides a prominent warning.

AI may suggest categories, explain deterministic reports, identify patterns, summarize changes, and answer questions. It must never silently modify records or calculate authoritative balances.

## Statement formats

Design an extensible importer for OFX, QFX, QIF, CSV, TSV, XLS/XLSX, MT940, CAMT.052/.053/.054, text PDFs, scanned PDFs, PNG/JPEG/TIFF/HEIC images, and legally accessible Microsoft Money exports. Support grows by milestone; do not claim universal parsing.

Every import follows: detect → parse locally → normalize → validate → deduplicate → preview → approve → atomic commit → audit/undo.

## UX requirements

- Desktop-first and keyboard-friendly.
- Compact left navigation and restrained top toolbar.
- Dense registers and reports with adjustable density.
- Restrained blue/teal/slate palette; accessible light and dark themes.
- No oversized marketing cards, gratuitous gradients, glass effects, or excessive whitespace.
- Clear positive, negative, pending, reconciled, and warning states that do not rely only on color.
- Global search and command palette eventually.
- Accessible labels, focus states, contrast, reduced-motion support, and table alternatives for charts.
- Mobile is secondary and focused on review, receipt capture, and reminders.

## Household requirements

Support a single local household with optional member labels, including shared and individually owned accounts/transactions. Seed data may use generic “Household,” “Member 1,” and “Member 2” labels; never embed real names in source code or test fixtures.

## Definition of done for any feature

A feature is not done until:

- domain behavior is defined;
- validation and failure states exist;
- relevant tests pass;
- keyboard and accessibility behavior are considered;
- financial data does not leak to logs/network/storage outside the approved boundary;
- user-facing copy accurately distinguishes working, experimental, and planned behavior;
- documentation is updated.

## Codex execution instructions

1. Inspect the repository and applicable instructions before editing.
2. Maintain a concise implementation plan and update it as work proceeds.
3. Prefer small, testable vertical slices.
4. Do not replace working architecture merely to make code generation easier.
5. Do not add cloud services, authentication, telemetry, bank connections, or hosted databases without explicit user authorization.
6. Do not use real financial data in development or tests.
7. Preserve user changes and avoid destructive Git operations.
8. Run the relevant formatter, linter, typechecker, tests, and build before declaring work complete.
9. State blockers and incomplete functionality plainly.
10. At the end of each milestone, summarize what works, how to run it, test results, privacy limitations, and the next smallest useful slice.

## First task

Implement Milestone 1. Begin by creating the architecture and tests, then build the runnable application shell and demo repository. Do not jump ahead to cloud AI, OCR, investments, or direct bank connectivity. Make the resulting repository a trustworthy foundation for subsequent slices.
