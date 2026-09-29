# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-29T15:18:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Windows/Tauri dogfooding verified local OCR but showed the example-teaching UI still lacked semantic field assignment. Real OCR rows use `Date · Description · trailing-minus transaction amount · running balance`, e.g. `6/03/26 AFFINITY GROVE 70.62- 16,159.90`.
- **Corrections:** Existing #65 OCR/import recovery and Vite Cargo-watch fixes are preserved. Representative PDF/OCR rows are now tokenized locally into teachable fields; the user can assign Date, Description/Payee, Signed amount, Debit, Credit, or Ignore/running balance. Valid assignments map back to the existing deterministic PDF layouts and rerun parsing immediately. Trailing-minus amounts are supported, balance-aware layouts are preferred, and migration 022 allows debit/credit PDF layout variants to persist through the existing statement-template workflow.
- **Verification:** Focused web tests cover the real trailing-minus + balance shape, positive amount + balance, semantic role-to-layout teaching, invalid role combinations, recognition counts/fail-closed behavior, and saved layout reuse; native migration/profile coverage verifies taught debit/credit layouts can be stored. Exact-head CI is required before the next Windows dogfood pass.
- **Next action:** Exact-head GitHub CI on the complete #65 example-teaching correction; then Windows/Tauri dogfood the same scanned statement by assigning the displayed fields and saving/reusing the template. Leave #65 open/unmerged. Do not start #66. Do not make a post-CI STATUS-only tip commit.

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
