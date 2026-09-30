# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-30T18:47:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Latest Windows dogfood established that RFCU OCR/parser/teaching can produce plausible transactions, but the workflow still lacked an editable review-draft state between parser output and the atomic repository import. Valid teaching therefore did not provide a complete correction/remember/transfer-confirm/import path.
- **Corrections:** Preserve all validated OCR/runtime, amount-vs-balance, continuation classification, source retention, and Vite watcher fixes. Import review now has an explicit local draft layer over deterministic parser/rule/history output: Payee and Category are editable without losing original statement description; explicit review edits outrank weaker persisted merchant rules; exact-description corrections can be remembered through the existing merchant-rule repository; repeated matching candidates can be deliberately updated in the current review; consistent ledger history can suggest payee/category only when unambiguous; PayPal-like ambiguous history stays Uncategorized. Account-name/institution matching can surface a possible transfer, but no transfer is created until the user explicitly selects/accepts the counter-account. Confirmed ordinary-account transfers are carried through the existing atomic import command, create both linked transfer legs, preserve the statement-side originalPayee/importBatch provenance, and undo both legs atomically. Scheduled-item linking is mutually exclusive with a confirmed transfer.
- **Verification:** Added focused web tests for review edits/provenance, explicit Uncategorized, deterministic history suggestions, repeated-row application, transfer suggestion without auto-linking, and component-level correct/remember/import plus explicit transfer acceptance. Added native tests for reviewed fields outranking rules and confirmed linked-transfer import/undo. Full exact-head web/build/Rust/Clippy/Windows CI is still required on the final tip.
- **Next action:** Wait for exact-head GitHub CI on the complete #65 end-to-end statement-import correction. If green, Windows/Tauri dogfood `STATEMENT-2026-08-31.pdf`: teach/apply; save/update RFCU template separately; review/edit Payee and Category; verify actionable blockers only for unresolved/invalid candidates; exercise Remember exact description; accept/reject Citi/Chase transfer suggestions; import atomically with source retention; verify imported provenance and undo. Leave #65 open/unmerged. Do not start #66. No post-CI STATUS-only tip.

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
