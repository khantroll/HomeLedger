# HomeLedger Agent Status

> Shared handoff checkpoint for humans and AI agents. **GitHub/repository state is authoritative**; this file is a concise continuity aid, not a substitute for inspecting code, PRs, or CI. Never restart valid work because this checkpoint is stale.

## Current checkpoint

- **Updated:** 2026-09-29T15:18:00Z
- **Updated by:** ChatGPT
- **Canonical main (verified):** `5fbb664c529258084a6ce1187055163f52a26e2a` — #64 Transaction Attachments & Receipt Retention squash-merged
- **Open PRs (in progress):** PR #65 — v0.52 Everyday Money Milestone Audit & Closure (`cursor/v052-everyday-money-closure-1f15`), draft, intentionally unmerged
- **Closure status:** NOT CLOSED. Native Windows/Tauri dogfooding found a third v0.52 closure blocker: Tesseract.js 7 selected a Relaxed SIMD LSTM core loader that the old four-file OCR packaging list omitted.
- **Correction:** `prepare:ocr` now packages every browser WASM loader shipped by installed `tesseract.js-core` 7.0.0 and fails closed on installed/packaged drift; `npm test` prepares assets first; regression asserts exact runtime-loader parity including Relaxed SIMD variants. Existing local `corePath`/`workerPath`/`langPath` architecture and CSP remain unchanged.
- **Verification:** Previous exact-head CI #405 was green on `165afc836501f556a3610d1e36f8a339ad163835`, but that run predates this truthful handoff update and human Windows dogfood retest is still required. Do not treat v0.52 as closed until corrected #65 tip is green and the real Windows scanned-PDF/image OCR path is retested.
- **Next action:** Run exact-head CI on the complete PR #65 correction/handoff tip; then human dogfood scanned-PDF OCR and standalone image OCR on Windows/Tauri. Leave #65 open/unmerged. Do not start the next milestone. Do not make a post-CI STATUS-only tip commit.

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
