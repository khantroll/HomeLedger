# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-24T05:19:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `0fdcaa77168b5bf77873386823ccf0e9d9751f31` — #59 Financial Find merged
- **Open PRs (verified):** PR #60 — Budget From History (`cursor/budget-from-history-1f15`), draft, intentionally unmerged
- **Correctness correction:** Average proposals now use one shared `monthsUsed` denominator; category absence in a valid history month contributes zero while unavailable household-history months remain excluded.
- **Validation:** Regression test added for $300 Car Repair in one of three valid months => $100 suggestion. Exact-head GitHub CI is required after handoff commits.
- **Next action:** Verify exact-head CI, inspect final diff, leave #60 open/unmerged. Do not start #61 / v0.53.

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
