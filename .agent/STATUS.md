# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-23T19:51:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `9e8c590dd0b082df3c4774b878d0c93c20dca3be` — merged #57/#58 state
- **Open PRs (verified at task start):** none
- **Current work:** PR #59 — Financial Find (`feat/financial-find`), open draft and intentionally unmerged
- **Scope:** local deterministic search across transactions, accounts, scheduled items, and securities; focused navigation through existing workspaces; no native index or AI
- **Validation:** exact-head GitHub CI must be green before review handoff
- **Next action:** Review PR #59 after exact-head CI. Do not merge automatically and do not begin the next v0.52 slice.

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
