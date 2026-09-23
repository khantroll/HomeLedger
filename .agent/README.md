# Agent Project Memory

HomeLedger uses a tiny repository-native continuity protocol so work can move between ChatGPT, Cursor, Claude, Gemini, local terminals, and other agents without reconstructing project state from conversation history.

## Start of a session

Read `.agent/STATUS.md`, then verify its claims against current Git/GitHub state before acting. Git, tests, CI, PRs, and the code remain authoritative.

## End of a meaningful work unit

Update `.agent/STATUS.md` with the latest concise checkpoint and append one single-line JSON object to `.agent/ACTIVITY.jsonl`.

Recommended event fields:

```json
{"timestamp":"ISO-8601 timestamp","agent":"tool/agent name","event":"short-event-name","branch":"branch","head":"commit SHA if known","task":"what was attempted","changes":["important changes"],"verification":["tests/build/CI actually run"],"unresolved":["remaining issue"],"next":"exact next action"}
```

Fields may be omitted when genuinely unknown. Do not invent values.

## Design intent

`STATUS.md` answers **“where should the next worker start?”**

`ACTIVITY.jsonl` answers **“what happened over time?”**

The repository answers **“what is actually true?”**

This is deliberately lightweight. It can later feed a dashboard, API, MCP server, or other project-continuity service without making HomeLedger depend on one AI vendor.
