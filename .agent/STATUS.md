# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-23T16:05:00Z
- **Updated by:** Cursor cloud agent (PR #57/#58 reconcile review)
- **Canonical main (verified):** `9902227bd783b71ef3ae4927c6c7a28071bd020d` — includes merged #56 transaction reuse
- **Open product/coordination PRs (verified):**
  - **PR #57** — Add repository-native agent handoff memory (`chore/agent-project-memory`); coordination-only; mergeable; CI green; STATUS reconciled in this update
  - **PR #58** — Home / Today + Planning Bridge (`cursor/home-today-planning-bridge-1f15` @ `e51c199`); draft; mergeable; CI green; integrity review in progress with small Forecast-focus / due-soon fixes expected on that branch
- **State:** #56 is merged into main. #57 and #58 are open and intentionally unmerged. Do not renumber, recreate, or duplicate either PR.
- **Next action:** Finish integrity fixes on #58 if any clear blockers remain; leave #57/#58 open for human/architect merge review. Do not start PR #59 / next Everyday Money feature until both are decided.

## Handoff protocol

Every agent or human making meaningful project changes should:

1. Inspect current Git/GitHub state first.
2. Read this file and reconcile it against GitHub; prefer GitHub when they disagree.
3. Continue existing valid branches/PRs; do not restart work because STATUS is stale.
4. Do the work, appending ACTIVITY checkpoints at meaningful transitions when practical.
5. Before handing off, update **Current checkpoint** with:
   - agent/tool;
   - timestamp/date;
   - branch and HEAD;
   - task attempted/completed;
   - important files/components changed;
   - tests/build/CI actually run and their results;
   - unresolved issues;
   - exact recommended next action.
6. Append one JSON object as a single line to `.agent/ACTIVITY.jsonl`.
7. Commit these handoff changes with the work when practical.

## Rules

- Never claim work is complete solely because an agent said so; verify repository state.
- Distinguish **observed**, **reported**, and **verified** facts when they differ.
- Do not overwrite useful unresolved context with a generic “done.”
- Keep this file concise. Detailed history belongs in `ACTIVITY.jsonl`, commits, PRs, and issues.
- If multiple agents are active, re-check the remote before updating this file to avoid clobbering a newer handoff.
- Do not commit secrets, huge logs, command dumps, or generated output into `.agent/`.
