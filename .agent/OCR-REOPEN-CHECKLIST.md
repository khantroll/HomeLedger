# OCR reopen checklist (frozen until structured import dogfood passes)

## Stay frozen while
- Exact-head CI on #65 is red, or
- Structured Excel/CSV Import Review dogfood is incomplete, or
- OCR is still required for everyday import

## Primary path
- Structured CSV/Excel is the product path for everyday money.
- OCR is best-effort assist only; never the Import gate.

## If reopening OCR later — fix these first
1. Section-aware parse (HISTORY vs DEPOSITS / similar regions; no double-count).
2. Amount grammar: leading decimals (`.45`), trailing minus (`15.00-`), separate debit/credit vs signed-amount tokenizers; never teach Signed amount on Debit/Credit layouts.
3. Balance column sacred: balance-aware continuity; fail closed when amount↔balance math breaks.
4. Teaching = proposal until Apply; Save/update template is separate; never auto-link transfers from OCR text.
5. No Tesseract training / LLM classification. Optional preprocess (deskew/contrast) only after 1–3 fail on a *new* scan.

## Acceptance bar (one frozen RFCU fixture)
- CITI / AFFINITY / similar: transaction amounts are amounts; running balances are not imported.
- Continuation/detail lines separated from unresolved candidates; disabled Import explains blockers.
- Apply teaching vs Save template semantics clear.

## Out of scope on reopen spike
- New milestone, AI categorizer, visual region editor, CDN OCR.
