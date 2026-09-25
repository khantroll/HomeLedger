# HomeLedger

[![CI](https://github.com/khantroll/HomeLedger/actions/workflows/ci.yml/badge.svg)](https://github.com/khantroll/HomeLedger/actions/workflows/ci.yml)

HomeLedger is a privacy-first, local-first household finance desktop application inspired by the workflows of classic desktop finance software. Microsoft Money is the primary product guidepost: the goal is an approachable personal-finance application that keeps the user's authoritative financial data on their own computer while taking advantage of worthwhile modern capabilities.

## Current status

HomeLedger v0.52 closes the Everyday Money milestone: a coherent local-first household-finance daily driver on top of the v0.51 investment foundation.

- **Accounts and registers:** checking, savings, cash, credit-card and loan accounts; Money-style per-account registers; a global transaction register; true running balances; splits; linked transfers; filtering, search, flagged-only views, and explicit pagination. Registers support transaction reuse (duplicate / schedule / merchant-rule drafts), notes and follow-up flags, receipt/document attachments, and all-or-none bulk status, category, and delete actions with protected-row guards.
- **Finding and correcting history:** Financial Find searches ordinary and investment history and lands on the owning register, Bills, Accounts, or Portfolio destination with focus. Shared category and payee management supports rename, merge, and unused cleanup while preserving import provenance.
- **Account lifecycle and reconciliation:** editing, ordering, guarded archive/restore, review indicators, statement reconciliation, retained reconciliation history and protection of reconciled entries. Notes, flags, and attachments remain metadata on protected rows and do not weaken accounting guards.
- **Bills and recurring activity:** scheduled expenses, income and transfers; deterministic recurrence; calendar and agenda views; posting/skipping/linking; reviewed auto-post; and local recurring-subscription detection.
- **Planning:** monthly category budgets with rollover and Budget From History proposals; account-linked savings goals; deterministic 30/60/90/180/365-day cash-flow forecasting; debt payoff plans comparing snowball, avalanche and custom ordering; and an Overview/Today attention bridge into the work that needs action.
- **Reports:** local income, spending, net cash flow, savings-rate, monthly-trend, category and payee reporting with transaction drill-down and contextual links back to contributing account registers, plus investment-aware household valuation.
- **Imports:** CSV/TSV, OFX/QFX/QIF, MT940, CAMT.052/.053/.054, XLS/XLSX, searchable PDF, scanned PDF and image OCR. Imports share mapping, duplicate review, merchant rules, scheduled-occurrence matching and atomic commit/undo safeguards. An optional setting can retain the original source document in the managed attachment store and link it to the import batch and imported transactions without duplicating file bytes; retention is all-or-none with the import. Investment transactions are currently rejected rather than being misinterpreted as ordinary ledger activity.
- **Statement memory:** reusable account-specific delimited profiles and source-aware statement templates for workbook/PDF/OCR layouts.
- **Backup and recovery:** portable password-encrypted `.hlb` backups include the SQLite ledger and managed attachments, with restore validation and legacy database-only backup compatibility. Rotating machine-local automatic recovery snapshots remain database-only and validate against the live attachment store rather than duplicating the attachment library into every snapshot.
- **First-run experience:** guided account setup distinguishes starting from today's cleared balance from reconstructing complete historical activity, avoiding accidental double counting.
- **Overview attention center:** deterministic, prioritized attention for overdue scheduled activity, due auto-posts, review transactions, negative cash forecasts and budget pressure, with a quiet all-clear/setup state.
- **Contextual workflows:** Overview attention can enter Transactions with Needs Review selected, focus Bills on the relevant overdue date or auto-post queue, report drill-down can open the contributing account destination, and investment accounts route to their Portfolio workspace. Ordinary sidebar navigation clears contextual state.
- **Investments and Portfolio:** Portfolio Foundation and Portfolio Manager workflows with dedicated investment accounts, securities, account/security drill-down, manual activity entry, event history, intrinsic cash, FIFO/specific lots, known/unknown basis, deterministic historical as-of holdings, manual/historical price observations, local price history, guarded historical corrections, and investment-aware household valuation/reporting. Portfolio activity remains separate from ordinary spending/income semantics.
- **Optional market prices:** an explicit, provider-neutral Refresh prices workflow can map a security and save validated price observations. Portfolio opening/navigation never requires a network request, saved/manual observations remain usable offline, and missing/stale observations are surfaced rather than silently treated as current market value.
- **Cross-domain cash transfers:** ordinary ↔ investment cash movement is written atomically as linked ordinary-ledger and investment-event legs. The bridge is the mutation boundary, so one side cannot be independently edited, reconciled, corrected, or deleted through generic domain workflows.

Shared category and payee memory supplies one local autocomplete catalog across transaction, split, scheduled-item, merchant-rule and budget editors. Colon-delimited categories such as `Food: Groceries` provide lightweight hierarchy without rewriting historical transaction text.

Filtered registers and reports can export complete CSV datasets rather than only the visible page. Native exports use an explicit save dialog, preserve exact decimal amounts and provenance fields, and neutralize untrusted spreadsheet-formula text.

Browser development uses synthetic in-memory records. The native Tauri application stores authoritative financial records in its private local SQLite database.

### AI Insights

HomeLedger includes four bounded AI-assisted workflows: **Affordability Analysis, Spending Change Analysis, Budget Review and Debt Strategy**. HomeLedger first assembles deterministic financial facts locally, then builds a task-specific context for review. AI output is advisory and has no repository or ledger mutation path.

Local AI supports Ollama, LM Studio and OpenAI-compatible **loopback** providers through a narrow native adapter. Loopback endpoints are constrained, redirects and proxies are refused, request/response sizes and timeouts are bounded, and payload/response contents are not logged. A separate connection test sends no ledger data.

Cloud AI supports **OpenAI, Anthropic and Gemini**. Cloud transmission is never implicit: HomeLedger constructs the Privacy Firewall payload locally, shows the exact payload for review, and requires explicit per-request confirmation before the native HTTPS adapter sends it. Provider credentials are stored in the operating-system credential vault and read by Rust only at request time. Provider adapters cannot query the financial repository. Full Local Context remains restricted to verified local providers, and arbitrary remote/self-hosted endpoints fail closed.

A privacy-preserving local AI audit records task/provider/model/trust/success metadata without storing prompts or responses.

## Privacy and security

HomeLedger is **local-first, not network-isolated**. Authoritative ledger and investment history, imports, OCR, calculations, reports, budgets, forecasts, debt projections, recovery snapshots and other core financial processing remain local. Network access is explicit: configured AI analysis uses verified loopback providers or a supported cloud provider after payload review/consent, and Portfolio market-price retrieval occurs only when the user explicitly searches/maps a security or chooses Refresh prices. No market-price request is required to open or navigate Portfolio.

Native financial records are stored in `homeledger.db` under the operating system's application-data directory. The live SQLite database is not encrypted by HomeLedger, so operating-system full-disk/device encryption remains the expected at-rest protection for the live database.

### Backup and recovery

Portable `.hlb` backups use AES-256-GCM with authenticated metadata and a PBKDF2-SHA-256 password-derived key. The password is never written to disk or sent to a service, and there is no password recovery. Restore validates authenticated encryption, the SQLite header and integrity check, supported schema version, required tables and foreign-key relationships before replacing the ledger, with rollback protection if replacement fails.

HomeLedger also maintains rotating automatic recovery snapshots in its private application-data area. These are machine-local SQLite recovery copies protected by the operating-system/application-data boundary; they are intentionally distinct from portable password-encrypted `.hlb` files. Recovery snapshots are created on a bounded cadence and before applicable schema migrations, with configurable retention and visible recovery health.

### Imports and local document processing

XLS/XLSX workbooks are decoded by the native Rust process with bounded file, worksheet, row, column, cell and text limits. Searchable PDFs are extracted locally with bounded input and text sizes. Image and scanned-PDF OCR use packaged PDF.js, Tesseract WASM and English language data without uploading statements or fetching processing assets from a CDN. PDF pages are rasterized and recognized sequentially.

The user reviews normalized rows before commit. By default, original workbook, PDF or image contents are not retained as ledger attachments. An optional import setting can keep the source document in HomeLedger’s managed attachment store and link it to the import batch and imported transactions without duplicating file bytes. Delimited and structured financial files are parsed locally; approved normalized transaction data and supported provenance are retained according to the import format.

Duplicate detection, merchant rules and scheduled-occurrence matching are deterministic. Scheduled matching never weakens duplicate detection and never links without an explicit choice. Native import commands revalidate applicable rules and matching constraints before atomic commit.

### Deterministic financial calculations

Budget totals, cash-flow forecasts, debt payoff projections, subscription detection, savings-goal status and transaction reports are calculated locally. These calculations do not require AI and do not permit an AI provider to mutate financial records.

Cash-flow forecasting accounts for scheduled activity, remaining monthly plans and transfer boundaries while avoiding known double counting. Debt projections use entered balances/APRs/minimums and deterministic payoff strategies. Reports exclude linked transfers and reconciliation adjustments from expense totals and use split categories in place of their parent category where applicable.

## Development

Requirements for the web interface: Node.js 20 or newer.

```sh
npm install
npm run dev
npm test
npm run build
```

Native desktop development also requires the Tauri 2 prerequisites, Rust, and platform webview/build tools. On Windows, install the Microsoft C++ Build Tools and WebView2 as described by Tauri, then run:

```sh
npm run tauri dev
```

Every push to a development branch and every pull request runs the browser tests and production web build on Linux. CI also treats Rust Clippy warnings as errors, runs the native tests, and compiles the Windows desktop application without creating an installer bundle.

## Investment import boundary

Investment activity remains separate from ordinary spending transactions. HomeLedger has a dedicated investment model for securities, event history, intrinsic cash, lots/cost basis, price history and Portfolio valuation. Investment-account file import is not yet implemented; unsupported investment records are rejected rather than being misclassified as ordinary transactions. Manual investment setup and activity entry are implemented. Investment-account file import remains intentionally out of scope for this milestone.

See `HomeLedger_Codex_Build_Spec.md` for the phased product specification.
