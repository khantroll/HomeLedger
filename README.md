# HomeLedger

[![CI](https://github.com/khantroll/HomeLedger/actions/workflows/ci.yml/badge.svg)](https://github.com/khantroll/HomeLedger/actions/workflows/ci.yml)

HomeLedger is a privacy-first, local household finance desktop application inspired by the workflows of classic desktop finance software.

## Current status

HomeLedger v0.47 is a local-first desktop household-finance application. In the native Tauri application, the authoritative financial database is a private, versioned SQLite database on the user's device; browser development uses synthetic in-memory data. The implemented product includes accounts and registers, splits and linked transfers, reconciliation, statement import and review, merchant rules, scheduled bills/income/transfers, budgets and savings goals, cash-flow forecasting, debt planning, reports, backup/recovery, and optional AI interpretation.

Accounts support lifecycle editing, ordering, review indicators, guarded archive/restore, per-account Microsoft Money-style registers, and a global transaction register. Registers provide status/date/search filtering, running balances when filters preserve ledger continuity, pagination, CSV export, and contextual transaction, transfer, and reconciliation actions. Reconciliation requires an exact zero difference and protects completed entries from later mutation. Linked transfers remain balanced and synchronized atomically.

Statement ingestion supports CSV/TSV, OFX/QFX/QIF, XLS/XLSX, searchable PDF, scanned PDF and image OCR, MT940, and ISO 20022 CAMT.052/.053/.054. The import pipeline includes reusable mappings/templates, local decoding/OCR, duplicate review, merchant rules, scheduled-occurrence matching, currency and structured-statement validation, atomic commits, and guarded batch undo. Investment transactions are rejected rather than interpreted as ordinary banking activity.

Bills manages scheduled expenses, deposits, and same-currency transfers with flexible recurrence, posting/skipping/linking, reviewed auto-post batches, and deterministic subscription detection. Budget provides monthly allocations, rollover, and account-linked savings goals. Forecast provides deterministic 30/60/90/180/365-day scenarios. Debt compares snowball, avalanche, and custom payoff strategies without posting transactions. Reports provide currency-safe income, spending, net cash flow, savings rate, monthly trends, category/payee analysis, transaction drill-down, and CSV export.

Daily-driver trust and workflow features are integrated into the product. HomeLedger maintains rotating local SQLite recovery snapshots, creates a validated snapshot before schema migration, exposes recovery health and retention controls, and supports guarded recovery restore alongside password-encrypted .hlb backups. A fresh ledger receives progressive first-run guidance for account creation, trustworthy opening-balance semantics, and optional historical import. Overview acts as an attention center for overdue scheduled items, due auto-post work, transactions needing review, negative forecast conditions, and budget issues. Contextual navigation carries users into the relevant existing workflow: review items open the register with the visible Needs review filter, bill alerts can focus the relevant due date or auto-post queue, and account references can open the appropriate register. Ordinary sidebar and Accounts → register → Back navigation remain available.

AI Insights is optional and separated from authoritative financial calculations. HomeLedger locally builds deterministic task contexts for Affordability Analysis, Spending Change Analysis, Budget Review, and Debt Strategy. The Privacy Firewall shows the exact payload and destination before transmission. Verified loopback providers such as Ollama, LM Studio, and compatible local OpenAI-style servers can receive permitted local disclosures; arbitrary remote endpoints are rejected. Cloud AI supports OpenAI, Anthropic, and Gemini through provider-specific native HTTPS adapters. Cloud sends require explicit per-request confirmation after exact payload review, use purpose-built sanitized task contexts, and retrieve API credentials in the native process from operating-system credential storage. Full Local Context remains restricted to verified local providers.

AI providers never query the financial repository directly. Internal/provider identifiers, import provenance, and authentication data are excluded from AI payloads; cloud task contexts use deterministic HomeLedger facts rather than raw database access. A local AI audit records task/provider/model/trust/success metadata without storing prompts or responses. Model output is untrusted advisory text only: it has no repository access and cannot create, edit, delete, post, or otherwise mutate ledger data.

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

## Privacy and security

HomeLedger's ordinary financial storage and calculations are local. Native accounts, transactions, planning data, rules, import history, and other authoritative records live in homeledger.db under the operating system's application-data directory. Import parsing, OCR, duplicate detection, merchant rules, scheduled matching, budgeting, forecasting, reporting, debt projections, subscription detection, savings-goal calculations, backup creation, and recovery snapshots are performed locally. The live SQLite database is not encrypted at rest, so operating-system account security and full-disk/device encryption remain important on shared or untrusted machines.

HomeLedger is not a zero-network application. Normal ledger use does not require a hosted HomeLedger service or bank connection, but AI Insights can make network requests when the user explicitly chooses a provider and sends a reviewed payload. Local AI networking is restricted to verified loopback destinations. Cloud AI networking is limited to supported OpenAI, Anthropic, and Gemini adapters, requires exact Privacy Firewall payload review plus explicit per-request consent, and uses native HTTPS. Cloud credentials are stored through the operating system's credential facility and are read by the native process at request time; secrets are not included in AI payloads or returned to the frontend after storage. AI responses remain advisory and cannot mutate the ledger.

The Privacy Firewall minimizes disclosure according to the selected workflow. Task-specific cloud contexts contain deterministic financial facts assembled by HomeLedger rather than granting the provider access to the database. Internal record IDs, provider transaction IDs, import provenance, and authentication data are never included. Full Local Context, which can include ledger descriptions, is available only to verified localhost providers. The local AI audit stores operational metadata such as task, provider, model, trust level, and success state without retaining prompts or responses.

XLS/XLSX workbooks are decoded by the native Rust process with bounded file, worksheet, row, column, cell, and text limits. Searchable PDFs are text-extracted on a blocking native worker with bounded input and extracted-text sizes. Image and scanned-PDF OCR use packaged PDF.js, Tesseract WASM, and English language data rather than uploading statements or fetching OCR assets from a CDN. PDF pages are rasterized and recognized sequentially. The user reviews normalized rows before import, and original workbook, PDF, or image contents are not retained as ledger attachments.

CSV, TSV, OFX, QFX, QIF, MT940, and CAMT files are parsed locally. The original file is not copied into the database; approved normalized fields and applicable audit/provenance metadata are retained. Structured bank formats are validated conservatively, and unsupported investment activity is rejected rather than silently converted. Duplicate detection, merchant rules, scheduled matching, reports, budgets, forecasts, debt plans, subscription detection, and savings-goal calculations are deterministic local operations.

Encrypted .hlb backups use AES-256-GCM with authenticated metadata and a PBKDF2-SHA-256 password-derived key. Backup passwords are neither written to disk nor transmitted, and there is no password recovery. Restore validates authenticated encryption, SQLite integrity, supported schema, required tables, and relationships before replacing the ledger. HomeLedger also keeps rotating local recovery snapshots in its private application-data area, creates a validated pre-migration recovery point before upgrading an older schema, applies configurable retention, and uses guarded restore behavior. Recovery snapshots are local protection rather than password-encrypted portable backups.

See `HomeLedger_Codex_Build_Spec.md` for the phased product specification.
