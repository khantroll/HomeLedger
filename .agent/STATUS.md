# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-29T19:34:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Latest Windows/Tauri dogfood confirms transaction amounts now look plausible, including RFCU trailing-minus withdrawals and positive Deposit Transfer, but example teaching was still confusing and dated continuation/detail rows were counted as unresolved blockers. CI #470 also failed on one stale PDF expectation plus schema-version test fallout from migration 022.
- **Corrections:** Preserve the validated OCR/runtime, amount-vs-balance, source retention, and Vite watcher fixes. The teaching tokenizer now uses the same amount/balance segmentation semantics as the successful parser, including OCR-separated `150.00 - 15,929.95` -> `150.00-` + `15,929.95`. Teaching edits are proposals until an explicit Apply teaching action reruns the current statement; Save/update template is a separate persistence action. Dated rows are now classified as transaction, continuation/detail, or unresolved; no-amount dated rows become continuation only when surrounding running-balance continuity deterministically proves no financial change was skipped. Other non-dated statement lines are counted separately. Import review now states why Import 0 is disabled. Schema-version checks/tests are aligned with migration 022.
- **Verification:** Focused tests cover exact and OCR-separated trailing-minus segmentation, RFCU AFFINITY/CITI/PAYPAL amounts, positive Deposit Transfer, explicit semantic role assignment, recognition rerun, deterministic continuation classification via balance continuity, ambiguous no-amount rows remaining unresolved/fail-closed, running-balance mismatch blocking, saved-template reuse, and schema-version 22 backup/migration expectations. Exact-head CI is required before another Windows dogfood pass.
- **Next action:** Wait for exact-head GitHub CI on the complete #65 teaching/classification correction; then Windows/Tauri dogfood the same RFCU statement. Verify four-field teaching segmentation, explicit Apply vs Save/update behavior, continuation/detail counts, a clear import-blocking explanation for any unresolved candidates, correct transaction amounts, saved-template reuse, and stable repeated `tauri dev`. Leave #65 open/unmerged. Do not start #66. No post-CI STATUS-only tip.

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
