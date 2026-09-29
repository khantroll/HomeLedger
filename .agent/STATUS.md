# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-29T15:18:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Windows/Tauri dogfooding has now verified the local Tesseract runtime fix, exposed the statement-teachability blocker, and then found a fifth closure blocker: Vite intermittently watched locked Cargo DLLs under `src-tauri/target`, causing `EBUSY` during `npm run tauri dev`.
- **Corrections:** All prior OCR/import-recovery work is preserved. Vite 7 dev-server watch configuration now ignores only `**/src-tauri/target/**`, keeping normal frontend HMR/watch behavior intact while preventing Cargo build output from being watched. A focused config regression locks the exclusion and confirms watch remains enabled.
- **Verification:** Vite 7 documents `server.watch` as Chokidar watcher options and supports `ignored`; exact-head CI is required on the complete correction tip. Human Windows/Tauri retest of `npm run tauri dev`, the same scanned-PDF mapping flow, and standalone image OCR remains required before merge.
- **Next action:** Exact-head GitHub CI on the complete #65 Cargo-watch correction tip; then human Windows/Tauri retest of repeated `npm run tauri dev` plus the pending OCR/import dogfood paths. Leave #65 open/unmerged. Do not start #66. Do not make a post-CI STATUS-only tip commit.

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
