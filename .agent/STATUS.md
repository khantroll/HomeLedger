# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-29T15:18:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Native Windows/Tauri dogfooding confirmed the local Tesseract runtime fix works on the previously failing 2-page scanned statement (84% OCR confidence), then exposed a fourth closure usability blocker: all 52 dated rows were safely rejected but the UI did not show enough extracted structure to teach the statement layout.
- **Corrections:** The validated local OCR runtime fix is preserved. PDF/OCR recovery now exposes representative rejected/recognized dated lines plus expandable raw extracted text, adds deterministic separate debit/credit layout support, immediately reruns recognition counts on structure changes, preserves all-or-none fail-closed import semantics, and saves the selected PDF layout through the existing statement-template profile path.
- **Verification:** Windows/Tauri dogfood confirmed Tesseract initialization and scanned-PDF OCR now work on the previously failing statement. Exact-head CI is required for the new teachability correction. Human dogfood retest of the same scanned PDF and a standalone image remains required before merge.
- **Next action:** Exact-head GitHub CI on the complete #65 teachability correction tip; then human Windows/Tauri retest of the same scanned PDF mapping/recovery workflow and standalone image OCR. Leave #65 open/unmerged. Do not start the next milestone. Do not make a post-CI STATUS-only tip commit.

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
