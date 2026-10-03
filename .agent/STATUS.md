# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-10-03 — v0.52 closure recovery
- **Source of truth:** GitHub/current code; this checkpoint is secondary.
- **Base main:** `5fbb664c529258084a6ce1187055163f52a26e2a` (#64 squash merge)
- **Open PR:** #65 — `cursor/v052-everyday-money-closure-1f15`, draft, intentionally unmerged.
- **v0.52 scope:** stabilize and honestly document accumulated closure work. OCR/PDF development is frozen.
- **OCR/PDF:** preserve local/no-CDN OCR, source retention/provenance, templates/parsers and fail-closed review. Advanced scanned-statement transaction reconstruction is experimental/deferred; RFCU success is not a v0.52 merge requirement. Future investigation is issue #69.
- **Structured imports:** trusted current path; transaction review/learning foundations in #65 are retained.
- **Roadmap:** #66 Home/Today daily cockpit → #67 general transaction learning/rules → #68 v0.53 daily-driver dogfood/polish. Do not begin these inside #65.
- **Closure rule:** repository truth/docs must be committed before the final exact-head CI. Do not make a STATUS-only tip afterward. Do not merge automatically.

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
