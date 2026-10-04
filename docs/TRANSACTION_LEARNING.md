# Transaction correction and remembered rules (#67)

## Existing architecture and bounded change

The v0.52 foundations already provide merchant rules, origin/priority precedence,
exact-description remembered import corrections, historical/category suggestions,
payee catalogs, a Rules page, and evidence-based transfer suggestions. Native
repository functions are the accounting authority.

The ordinary transaction editor now saves a correction through updateTransaction
before offering Remember, Just this one, or Customize rule. A rejected update
never offers learning. Remember is a separate opt-in rule write; failure leaves
the saved transaction intact and permits retry without repeating its mutation.
Customize uses the existing RuleDialog and produces a manual rule. Closing it
returns to the choice. Just this one finishes without writing a rule.

Only changed payee/category fields are included in the default correction draft.
Payee-only corrections do not carry the old category into a rule. Uncategorized,
transfer categories and split treatment are not learned as ordinary categories.
The default match is exact normalized original description plus income/expense
direction. Broader matching requires explicit customization.

Import and ordinary correction paths share saveRememberedCorrection, which
updates an existing remembered exact-description/direction rule rather than
creating conflicting duplicate rules. Manual rules are never replaced by this
operation. No migration, alternate recognition engine, or new Rules page exists.
Rules remain visible/editable/disableable/deletable in the existing Rules page.

## Effective precedence

Preserved import behavior: explicit current-row review edits win; source-supplied
categories and split categories remain intact. Among rules, manual origin wins
over remembered origin regardless of numeric priority; within origin, higher
priority wins, then stable rule ID. Exact source-description history is used when
no rule matches; unambiguous catalog payee recognition is used when neither rule
nor history gives a suggestion. Existing scheduled matching and account-transfer
evidence remain separate advisory confirmation workflows. There is no fuzzy
processor-to-category inference. Remembering PAYPAL *ABC123 as PayPal creates no
category knowledge and does not match PAYPAL *DIFFERENT by default.

## Provenance and accounting

A first ordinary payee correction preserves the preceding description in
originalPayee. Later corrections retain it. Imported originalPayee, external ID,
source and batch metadata are not rewritten. The ordinary editor displays an
existing original description. The native SQL mutation retains all existing
reconciled, scheduled-linked, ordinary linked-transfer, cross-domain transfer and
imported-account protections. Demo updates now reuse their existing bulk-edit
protections for scheduled/reconciled/link safety as well.

Remembering rules never rewrites historical records or changes balances. Native
and demo tests cover description preservation and unchanged financial effects.

## Transfer recognition boundary

The existing transfer evidence matcher considers original and normalized payee
text. A taught normalized payee such as Chase Visa can therefore identify a known
account on a future import. It is still an advisory candidate, with ties unresolved,
archived/investment destinations excluded, and currency checks retained. Import
requires explicit acceptance before its existing atomic transfer creation path.
The ordinary editor displays the same advisory evidence and directs confirmation
to the existing transfer workflow; its Save never creates counterpart records.
Rules do not store transfer destinations or convert expenses automatically.
Linked/protected records must continue to use their dedicated accounting paths.

## Validation and deliberate deferrals

Focused learning, editor, merchant-rule, Rules page, reuse and import-review web
tests pass. Full local web suite: 417 tests across 73 files pass. Production
TypeScript/Vite build passes (existing chunk-size warning). Cargo, Rust tests,
Clippy and native compile are not locally runnable in this environment; the PR's
exact-head GitHub Actions gate is required for authoritative Windows validation.
New native tests cover first/subsequent/manual/imported description preservation,
no implicit rule/transfer creation, and scheduled/reconciled mutation rejection.
Existing linked ordinary/investment transfer tests remain in the complete gate.

Deferred: historical bulk rewriting; account/amount rule extensions; persisted
transfer-destination actions; general manual-entry suggestion redesign; #68 polish;
#69/OCR/PDF changes; AI categorization; bank/brokerage/device synchronization.
