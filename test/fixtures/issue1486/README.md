# Issue #1486 reusable conformance corpus

Contract: [Issue #1486](https://github.com/sayosomi/nuinuiCAD/issues/1486).
Fixed Base: `39e653213576707c74e4ad454a52e102106c723c`.

`primary.json` preserves all A1–F4 source bundles, independently authored UTF-16
selections, intended edits, numeric/point observations, unsupported positions,
and named saved/current negative/transition snapshots. `reducers.json` preserves
evidence-triggered controls and reductions. Source/range/hash validation runs
before queries. Expectations come from authored source and nominal ownership,
not another provider or the production query result.

`ledger.json` has every disposition and selection, canonical source-bundle and
scenario hashes, support notes and distinct-unit accounting. There are **36
accepted distinct units: 24 primary + 8 adjacent + 4 distinct reducers**, within
the 40-unit ceiling. R1 replays the already minimal A1 and R4 replays C3;
neither consumes another slot. All 24 primary cells are complete: **21
BUG→FIXED→REPASS, 3 PASS (D1, D2, F1)**. Across distinct units: 30 repaired and
repassed, 6 PASS. Counts describe scenarios, not independent defect families.
No primary cell is BLOCKED or unexecuted. Deliberately invalid controls do not
consume accepted legal-input capacity. `prevalidation.json` retains rejected
syntax and corrected test/oracle assumptions without calling them defects.

`families.json` preserves six independently demonstrated first-owner failures,
exact Base versus candidate observations, source signatures and one-repair-removal
receipts. Each removal ran its subject and nearby control: **1 expected FAIL,
1 PASS**; all candidate bytes were restored. The complete then-frozen Base suite
was **34 FAIL / 12 PASS**; no expected Base failure was treated as final green.

| Family | Earliest incorrect producer | Independent discriminator |
|---|---|---|
| F1 | `moduleSemanticRenameAnalysis.ts` candidate compile | A1/R1 safe local record Rename rejected after losing imported type environment; X1 same-file Rename passes |
| F2 | `multiDocumentModuleLanguage.ts` candidate graph | R3 public Module Rename rejected because its new root artifact lacks bound imported record types; scalar-parameter X3 passes |
| F3 | `dslSemanticOccurrenceIndex.ts` literal traversal | R2 loses `@r` inside `R[]`; expected reference `[96,97)` is absent; ordinary-reference X1 passes |
| F4 | `dslDocument.ts` generalized-record lowering activation | C3/R4 independent Result=(7,17); Base TS and normally eligible persistent Rust both report two missing-box errors; unused-Module numeric neighbor X6 passes |
| F5 | `dslSemanticOccurrenceIndex.ts` inline record occurrences | R5 collection name `[40,44)` gains a synthetic second declaration and becomes ambiguous; no-inline-constructor X7 query passes |
| F6 | `typedRenameAnalysis.ts` supplemental safety adapter | X2 Base “successful” plan edits only declaration `[12,13)` and omits member `[51,52)`; after occurrence repair alone the adapter still omits the edit; X1 passes |

F1 uses the small shared `sourceSemanticRenameCandidate.ts` boundary to rebuild
only the edited root through the canonical parser, artifact/public catalog,
record binder and Module analysis/context. Imports, re-exports, IDs and saved
dependency owners must remain proven. The old root semantics are never reused.
F2 reuses the same established record binder in the existing public Module
candidate path. No second parser, resolver, graph cache or evaluator is added.
F3/F5 repair authored occurrences while excluding inline synthetic declarations;
F6 is the directly affected typed Rename consumer. F4 is an additional causal
compiler owner permitted by the unchanged Issue mission; it changes activation
of existing lowering, not language semantics or Rust math.

The tests call real graph-backed query/proof APIs and canonical source splices.
Successful local/public Module plans are applied to source snapshots, rebuilt,
re-queried and compared with exact independent footprints; public plans from
definition and reference must agree. Numeric and geometry checks compare analytic
expectations with both TS reference and normally eligible persistent Rust,
including after edits. R6 separately observes asymmetric imported instances as
Result=(7,19), rather than relying only on their sum. D4/E4 reject incomplete,
unsafe, fingerprint-incompatible and stale universes atomically. E1–E3 use real
current views/coordinator transitions, including save invalidation and controlled
out-of-order completion; no fabricated successful occurrence indexes are used.

## Support boundary and residuals

Direct foreign record type/constructor/member authoring navigation and Rename
remain **NOT_SUPPORTED** where the established imported-record service contract
provides no original-declaration projection/proof. Local values, collections,
Module calls and graph-owned facade re-export tokens use their existing supported
operations. D1/D2 exercise exact graph-owned public record catalog occurrences;
they do not pretend that unimplemented direct type tokens are known references.
Public record Rename remains rejected because no production record-family
cross-document proof exists. A4 distinguishes import-alias catalog identity from
the public member. It does not add a native alias authoring implementation.

Raw CRLF input to normalized-source query APIs remains rejected; F3 proves the
existing normalized UTF-16 boundary with supplementary characters. No grammar,
dynamic indexing, auto-import, general record Hover, renderer, native VS Code
provider/host, Rust source, or architecture contract changed. The normative and
implemented DSL references already promise the repaired behavior; no spec was
edited to fit implementation. No obsolete plan document was created.

Manual GUI E2E: **Not Required** for these host-neutral changes under #1486.
No Human PASS is claimed. Independent exact-pushed-HEAD blocking review and
protected PR/CI/integration remain required; this corpus is executor evidence,
not independent review or Issue completion.

`verification.json` records the final mandatory block and focused checks,
standard suite skips, conditional Rust disposition and cleanup. Earlier harness
failures and the corrected unused-import lint error remain disclosed separately.
Codex plan quota: **UNAVAILABLE** (no Human readings supplied).
