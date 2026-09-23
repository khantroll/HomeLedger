# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-23T16:12:00Z
- **Updated by:** Cursor cloud agent (PR #57/#58 reconcile review)
- **Canonical main (verified):** `9902227bd783b71ef3ae4927c6c7a28071bd020d` — includes merged #56 transaction reuse
- **Open PRs (verified):**
  - **PR #57** — Agent handoff memory (`chore/agent-project-memory`); coordination-only; mergeable; protocol reconciled
  - **PR #58** — Home / Today + Planning Bridge (`cursor/home-today-planning-bridge-1f15` @ `f67936f`); draft; integrity fixes pushed (forecast highlight + due-soon dedupe); local validation green; CI re-checking
- **State:** Both PRs open and intentionally unmerged. Do not renumber/recreate either. Do not start #59 / next Everyday Money feature until merge review decides.
- **Next action:** Human/architect merge review of #57 and #58. Prefer GitHub over this file if anything disagrees.

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
