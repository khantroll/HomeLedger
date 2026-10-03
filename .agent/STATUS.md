# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-10-03 — #66 Home / Today daily financial cockpit.
- **Source of truth:** GitHub/current code; this checkpoint is secondary.
- **Base main:** `08ac9adeafc63853ae8efb5fe63a1ee71020233d` (#65 squash merge).
- **Working branch:** `feature/66-home-today-cockpit`; draft PR #66 to be opened after implementation/documentation is committed.
- **Scope:** replace the old Overview summary + attention + long upcoming feed with one action-first Home/Today cockpit. Reuse existing forecast, budget, schedules, register filters, account-review state, savings-goal math, debt-plan repository and contextual navigation.
- **Boundaries:** ordinary cash is the Home spendable-money boundary; investment value remains in Portfolio. No schema change, AI, bank sync, OCR/PDF, transaction-learning expansion, or financial mutation.
- **Verification:** focused Home tests added; full exact-head CI still required after final repository-native handoff commit.
- **Deferred:** #67 transaction learning/rules, #68 v0.53 dogfood/polish, #69 OCR/layout-aware PDF work.
- **Closure rule:** exact-head CI after this handoff state. Do not make a STATUS-only tip afterward. Do not merge automatically.

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
