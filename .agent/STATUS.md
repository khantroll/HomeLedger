# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-24T14:30:00Z
- **Updated by:** Cursor cloud agent
- **Canonical main (verified):** `7e8fb082681018b92b1419c544a5bf8f8fdd44ba` — #61 Category & Payee Management merged
- **Open PRs (verified):** PR #62 — Register Bulk Actions (`cursor/register-bulk-actions-1f15`), draft, intentionally unmerged
- **Scope delivered:** Atomic bulk category/status/delete for ordinary register rows; visible-only selection; transfer/split/reconciled/import protections
- **Next action:** Exact-head GitHub CI, then architecture/integrity review of PR #62. Do not merge automatically. Do not start PR #63.

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
