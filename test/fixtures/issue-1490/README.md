# Issue #1490 reusable Rename-to-artifact corpus

Contract: [#1490](https://github.com/sayosomi/nuinuiCAD/issues/1490).
Fixed Base: `0c4c2df0f6694645a857734373fb8a3d986a7d41`.
Topic: `sayosomi/issue-1490-public-module-rename-record-artifact-hunt`.

`freeze.mjs` independently writes all twelve complete saved/current bundles,
UTF-16 Rename edit sets, after-edit texts and integer/Y-up/mm physical oracles
to `matrix.json`, without importing production code. Sources, edits and numeric
oracles were sealed before numeric evaluation. `reducers.mjs` freezes the five
evidence-triggered adjacent/reducer inputs in `reducers.json`; their expected
point is independently (10,16). No oracle was changed to fit product results.

| Primary family | S0 | S1 | S2 |
| --- | --- | --- | --- |
| R1 direct Module | BASE_PASS | BASE_PASS | BASE_PASS |
| R2 facade Module | BASE_PASS | BASE_PASS | BASE_PASS |
| R3 asymmetric grouped instances | BASE_PASS | BASE_PASS | BASE_PASS |
| R4 two importing roots and legal wrapper | BUG→FIXED→REPASS | BUG→FIXED→REPASS | BUG→FIXED→REPASS |

There are **17 accepted new units**: twelve primary, X1/X2 and M1/M2/M3.
X1 (inline array member) and all three reducers are repaired/repassed; X2
(nested scalar record member without an array) is the neighboring BASE_PASS.
X3–X8 and M4–M8 are NOT_TRIGGERED. No source draft was prevalidation-invalid
or replaced. Twenty deliberate negative controls are separate: incomplete
discovery, invalid new name, unsupported public-record Rename and reused edit
plan for each root, plus four invalid-saved-dependency/recovery controls.
Sixty-three fault-seeded assertions check wrong token range, omitted importer,
nominal origin, stale saved-state geometry, instance, output and SVG/PDF units.
Reruns, format variants and historical tests consume no exploration slots.

## Independent causal findings

1. **F1 — root record constructor scalar projection.**
   `dslDocument.ts`'s existing additional record-property resolver used the
   whole field path as collection contents for `@wrapped.rows[0].x`. The
   existing producer instead supplies the rows contents and a scalar projection
   across its record members. Reuse the existing `indexedRecordFieldPaths`
   helper to split the path and select that exact projection. M1 and all R4
   states expose this error; X2 passes. This is not an alias-only limitation.
2. **F2 — absent catalog slot.**
   `recordScalarLowering.ts` reserved source slot zero for every inline record
   array member, including an array-valued field with no named-array binding.
   An array-only wrapper therefore crashed the binding catalog. Reserve the
   slot only for an actual named collection. X1/M2 demonstrate the exception;
   X2 passes.
3. **F3 — document-to-runtime source positions.**
   `moduleScalarRuntime.ts` retained authored source positions when carrying
   synthetic record scalar initializers into its runtime program. For M3,
   collection reads in a record constructor passed TS but failed ordinary Rust
   eligibility-path evaluation. Reuse the existing source-position remapper
   alongside the existing collection-ID remapper. X2 passes. M1/M2/X1 also
   expose this second producer once earlier defects are corrected.

These are three distinct first producers. No downstream encoder or Rust bypass
was added. The narrow cross-file helper export reuses existing semantics rather
than adding a resolver. Human confirmed actual upper-tier selection in the UI
before mutation outside anticipated owner-guide paths. No specification,
architecture, syntax, dependency or native production host/save path changed.
The implemented records reference documents the corrected supported behavior.

`evidence/causal.json` records exact production hashes and genuine Base/fixed/
individual-removal/restored runs. The exact Base run fails five tests and passes
six; every individual removal fails its original independent reproducer with
the neighboring X2 still passing. Every restored run passes all eleven tests
then present, including all twelve primary states. Later added assertions check
direct/facade byte equivalence and invalid-current publication; no production
correction changed after the causal runs.

## Production-path and physical evidence

The integration uses the existing graph coordinator, saved artifact cache,
Module compilation/query/proof owners, real `planMultiDocumentRename`, canonical
`buildSourceSemanticRenameSplices`/`applyLineSplices`, actual saved temporary files,
ordinary Rust eligibility and one controlled persistent Rust stdio process.
It compares reference and Rust values with independent numeric expectations.
`multiDocumentHost.test.ts` replays the same four frozen families through the
actual production provider/discovery implementation with its existing mocked
VS Code filesystem and workspace-search boundary, including the saved second
importer, facade and foreign same-name owner. This is not GUI E2E or a claim of
native file-save behavior.

All primary outputs use real selected `evaluateOutputPlan` and Rust
`exportOutput`. The existing #1488 physical inspectors were extracted unchanged
to `test/patternArtifactAssertions.ts` and reused by both suites: XML dimensions,
viewBox, every ordered path coordinate and physical stroke; PDF xref, page tree,
stream lengths, MediaBox, drawing operators, tile origins and guides. The
unselected output has different geometry/paper. Pure Rename preserves bytes;
R1 and R2 have identical physical bytes for every state. Saved provider
(17,-23) becomes (31,-37), dirty dependency stays (71,-83), current root adds 5,
and root-only restoration matches its separate saved-S2 oracle. Unaffected
independent and foreign-root file hashes remain identical. Old snapshots are
re-evaluated against their own prior expectations.

`evidence/summary.json` holds every primary disposition, source/oracle/edit
hash, actual edit plan/source ownership, nominal identity, numeric observations,
affected roots and artifact hashes. `evidence/artifacts.tar.gz` retains **46
actual files**: all primary, second-root and restoration/recovery outputs;
`artifacts.json` names and hashes each member. The final matrix process handled
142 evaluation requests and 86 file exports with one spawn and explicit close.
Counts are execution diagnostics, not Codex quota usage.

Compact compressed failure/success logs and original reducer payloads are
retained. Earlier harness-only failures are disclosed: workspace enumeration
rebuilt the unaffected root before a reference-equality assertion; preserving
the coordinator's unchanged exact-current graph corrected that assertion. The
first inline neighbor exposed F2, rather than serving as a passing control.
The subsequent independent X2 supplied that control. No unexplained failure was
retried for green, and no assertion/deadline was waived.

Final verification results and the exact mandatory command block are in
`evidence/verification.json`. External raw executor evidence remains at
`/Users/yosomi/.codex/issue-1490-evidence`; repository evidence is independently
usable. Documentation review found no obsolete task plans to remove.

Human Manual GUI E2E: **Not Required** for this host-neutral repair. No GUI PASS
is claimed. Independent pushed-HEAD review, protected PR/CI, merge, Issue
acceptance and Human guarded clean-main restoration remain outside this
implementation handoff. Human weekly/five-hour quota readings: **UNAVAILABLE**.
