# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-29T15:18:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Windows/Tauri dogfooding exposed a serious RFCU statement misparse: transaction amount was being absorbed into Description while running balance was imported as Amount. Example teaching also failed on rows whose numeric fields were tokenized as one span. Exact-head CI on ae034ed also failed (web PDF regressions + Rust test imports), so no closure claim is valid.
- **Corrections:** Existing OCR runtime and Vite Cargo-watch fixes are preserved. PDF parsing now tokenizes monetary fields independently, explicitly models Running balance, parses RFCU-style `Date · Description · transaction amount · running balance` from the transaction amount first, handles trailing-minus and positive Deposit Transfer amounts, validates adjacent running-balance continuity when deterministically possible, marks teachable rows, exposes Date/Description/Signed amount/Debit/Credit/Running balance/Ignore controls, and provides a Pre-import-review action to jump an exceptional source row back into teaching. Existing saved-template reuse remains the persistence path.
- **Verification:** Focused tests now cover RFCU-equivalent AFFINITY/CITI/PAYPAL rows, trailing-minus amounts, positive Deposit Transfer + balance, explicit field-role teaching, recognition rerun, running-balance continuity, malformed exceptional rows remaining fail-closed, and saved-template reuse. Native test imports were corrected after CI #455 exposed missing symbols. Exact-head CI is still required.
- **Next action:** Exact-head GitHub CI on the complete #65 misparse/teaching correction; then Windows/Tauri dogfood the same RFCU scanned statement, verify correct Pre-import amounts/descriptions, exercise the exceptional Deposit Transfer recovery route, save/reload the template, and confirm repeated `tauri dev` remains stable. Leave #65 open/unmerged. Do not start #66. No post-CI STATUS-only tip.

## Handoff protocol

Every agent or human making meaningful project changes should:

1. Inspect current Git/GitHub state first.
2. Read this file and reconcile it against GitHub; prefer GitHub when they disagree.
3. Continue existing valid branches/PRs; do not restart work because STATUS is stale.
4. Do the work, appending ACTIVITY checkpoints at meaningful transitions when practical.
5. Before handing off, update **Current checkpoint** with agent/tool, timestamp, branch/HEAD, task, important changes, verification, unresolved issues, and exact next action.
6. Append one JSON object as a single line to `.agent/ACTIVITY.jsonl`.
7. Commit these handoff changes with the work when practical.

## Rules

- Never claim work is complete solely because an agent said so; verify repository state.
- Distinguish **observed**, **reported**, and **verified** facts when they differ.
- Do not overwrite useful unresolved context with a generic “done.”
- Keep this file concise. Detailed history belongs in `ACTIVITY.jsonl`, commits, PRs, and issues.
- If multiple agents are active, re-check the remote before updating this file to avoid clobbering a newer handoff.
- Do not commit secrets, huge logs, command dumps, or generated output into `.agent/`.
