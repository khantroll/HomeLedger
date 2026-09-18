# HomeLedger

HomeLedger is a privacy-first, local household finance desktop application inspired by the workflows of classic desktop finance software.

## Current status

Milestone 2 transaction-register slice. The React interface, restricted Tauri command boundary, versioned SQLite schema, durable transaction creation/editing/deletion, ordered split editing, atomic linked-account transfers, local CSV/TSV/OFX/QFX/QIF import, and encrypted backup/restore are implemented. A linked transfer creates balanced withdrawal/deposit records, keeps both sides synchronized during edits, and deletes both sides in one database transaction. Imported QIF splits can be reviewed and edited, while direct deletion of imported rows is blocked to preserve complete-batch audit and undo guarantees. Imports also support column mapping where needed, common statement date/amount conventions, provider transaction IDs, duplicate review, currency checks, and atomic commits. Browser development uses synthetic in-memory records; the native Tauri application uses its private local SQLite database. Investment-account OFX/QIF, non-UTF-8 CSV encodings, import redo, live-database encryption, reconciliation workflow, and AI integrations are not yet implemented.

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

## Privacy posture

The current milestone makes no network calls and contains no real financial data. Native records are stored in `homeledger.db` under the operating system's application-data directory. The live SQLite database is not yet encrypted, so use only test data on untrusted or shared devices.

Encrypted `.hlb` backups use AES-256-GCM with authenticated metadata and a PBKDF2-SHA-256 password-derived key. The password is never written to disk or sent to a service, and there is no password recovery. Restore validates authenticated encryption, the SQLite header and integrity check, supported schema version, required tables, and foreign-key relationships before replacing the ledger. A temporary rollback snapshot is used if replacement fails and is removed when the operation completes.

CSV, TSV, OFX, QFX, and QIF files are parsed in application memory. The original file is not copied into the database; only approved normalized transaction fields, categories and splits when supplied, provider transaction ID when supplied, and the source filename are retained. OFX/QFX support covers bank and credit-card statements. QIF support covers bank, cash, and credit-card transactions; QIF does not carry a currency, so amounts use the selected local account's currency. Investment transactions are rejected explicitly rather than misinterpreted.

Undo deletes every transaction still belonging to the selected import batch in one SQLite transaction and then marks the retained batch record as undone. If the batch transaction count no longer matches its original audit value, HomeLedger refuses the undo rather than partially deleting it.

See `HomeLedger_Codex_Build_Spec.md` for the phased product specification.
