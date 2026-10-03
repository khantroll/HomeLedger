# Deferred scanned-statement / OCR investigation

**Status: DEFERRED / FUTURE EXPERIMENT. Do not reopen as part of v0.52 closure.**

v0.52 preserves useful local document-processing infrastructure: packaged local Tesseract/PDF assets, no-CDN privacy behavior, scanned-PDF/image extraction, source retention/provenance, existing templates/parsers, and fail-closed review. Structured CSV/Excel and other structured financial formats remain the trusted import path.

## Dogfood findings to preserve

The RFCU experiment exposed structural problems that should not be papered over with more regex/layout variants:

- trailing-sign values such as `15.50-` can be reconstructed inconsistently by OCR;
- one physical statement row can become duplicate logical rows with incorrect amounts;
- identical physical schemas can reach parsing/teaching with incompatible token structures;
- teaching/tagging cannot reliably repair damage introduced before a trustworthy physical row exists.

## Architectural direction when deliberately reopened

Future scanned-statement work should converge on one pipeline:

OCR words/tokens + coordinates/bounding boxes
→ physical row reconstruction
→ column inference across multiple rows
→ canonical Date / Description / Amount / Running Balance representation
→ deterministic balance-continuity validation where evidence exists
→ trustworthy structured transaction rows
→ the existing HomeLedger review/categorization/import pipeline.

The parser and teaching UI must consume the same reconstructed row model; they must not independently tokenize the same OCR row.

## Safety bar

- Never fabricate missing dates, signs, amounts, balances, or transactions.
- Ambiguous/unresolved transaction candidates remain fail-closed.
- Running balance is validation evidence, not a substitute transaction amount.
- No LLM/AI authoritative parsing.
- No automatic transfer creation from OCR text.
- Do not make successful import of the RFCU dogfood statement a v0.52 requirement.
