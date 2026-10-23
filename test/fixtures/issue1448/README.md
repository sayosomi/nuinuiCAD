# Issue #1448 Rename semantic-preservation fixtures

Base: `7a31489d69aadbf1fafcdef9f68b64c491633ba3`.

`cases.json` contains twelve primary source/rename pairs (nine distinct source
texts). `controls.json` contains four additional accepted sources, below the
eight-source ceiling. Sources, exact expected UTF-16 edits and arithmetic/point
oracles were authored and persisted before plan/evaluation comparisons. The
corresponding `freeze.json` and `controls-freeze.json` retain compiler legality,
source SHA-256, actual Rename targets and semantic identities from Base.
`prevalidation.json` retains the rejected point-move candidate: points are not
legal transformation targets. G4 was replaced, before comparisons, with the
allowed geometry-property discriminator. There are no remaining unsupported
primary cases. Named transformation stages are not claimed as tested coverage.

Run the executable regression:

```sh
npx vitest run test/issue1448RenameSemanticPreservation.integration.test.ts
```

Set `ISSUE1448_RECORD=/tmp/issue1448-candidate.json` on that command to retain
raw current-run plans, compiled observations and per-case failures outside the
checkout. The compact historical evidence is not rewritten by ordinary tests.

The test uses the real query/planner, projects its actual physical edits through
`buildSourceSemanticRenameSplices` / `applyLineSplices`, and recompiles through
`compileCanonicalText` with normal statement reconciliation. It checks every
edit and its old text, declaration/reference target equivalence, every untouched
source interval, declaration/element identities, physical occurrence mapping,
dependency edges and Module instance origins. Version headers and closing braces
are not source-defined declarations; map insertion order is not identity.

Every original and edited program is checked against the authored point/scalar
oracle using the TypeScript reference evaluator and `prepareRustEvaluation` →
`RustEvaluationProcess` persistent stdio route. Eligibility is never forced. The
point array and number array cases distinguish their indexed members. T3 also
checks the immutable point value separately from its drawable output. Asymmetric
Module instances check independent Tip/Observer/Control coordinates. There is
no evaluator, payload, Rust, syntax or public API change.

## Results and first incorrect owners

| Cases | Disposition |
| --- | --- |
| G1, G2, G3, G4 | PASS |
| T1, T3, T4 | PASS |
| T2 | BUG→FIXED→REPASS (F1 + F2) |
| M1, M2, M3, M4 | PASS |
| R1 | BUG→FIXED→REPASS (F1 minimal reducer) |
| R2 | BUG→FIXED→REPASS (F2 minimal numeric consumer; also needs F1) |
| C1 | PASS (nearby unreferenced-array positive control) |
| C2 | BUG→FIXED→REPASS; positive array rename plus collision/capture rejection |

Two independently separable defect families were confirmed and repaired:

- **F1 — document typed Rename analysis:** `analyzeTypedBindingRenameInDocument`
  treated scalar dependency references as a complete source occurrence inventory.
  Indexed collection container names are intentionally absent from those
  dependency references. R1's source occurrence index already had the reference,
  but the adapter constructed a declaration-only candidate and rejected the safe
  rename as capture. Reusing the existing source occurrence identities repairs
  R1. An additional collection-identity comparison rejects capture into another
  array even when the resulting source is valid.
- **F2 — shared semantic occurrence index:** `addTypedOccurrences` ignored root
  collection-index numeric inputs lowered into `materializedNumericBindings`.
  The compiler and both evaluators retained the correct collection identity,
  source span and values. The index omitted the coordinate argument reference.
  After F1 alone, R1 passed while R2 and combined T2 still failed. Consuming the
  existing lowered typed expressions in the index completes the footprint and
  repairs R2/T2. The index walks resolved collection IDs, without another parser
  or name resolver.

Base results were 11/12 primary PASS, T2 FAIL; R1/R2/C2 FAIL and C1 PASS.
All four failing sources first passed their independent original-program TS and
persistent-Rust oracles. The repaired candidate passes all sixteen pairs.
`evidence.json` retains actual Base rejection plans, staged owner isolation,
actual final plans/source diffs, compiled occurrences/dependencies/instance
origins, and independently checked observations. Repeated identical engine
observations use matching SHA-256 values; unchanged candidate input observations
refer to the retained Base observations. This is an execution record, not a
second test oracle.

Sensitivity runs only in tests: removing a required edit fails the independently
frozen footprint check; incorrect coordinates/scalars fail the authored oracle.
Specific projected faults select the wrong collection member (G2/T2), the inner
capturing array (C2), or the other instance (T4). The unmodified projection and
unaffected Control remain positive controls. Invalid names and stale snapshots
reject atomically for every case; C2 additionally rejects same-scope collision
and a compiler-valid nested capture.

## Historical coverage subtraction and scope

Existing `renameAnalysis.contract.test.ts` checks source preservation, inherited
IDs, qualification and capture at its analysis/model-patch boundary.
`typedRenameAnalysis.module.test.ts` checks Module defaults/argument splice
coverage. `typedRenameAnalysis.property.test.ts` compares scalar fan-out analyses
with separately generated renamed documents. Native `renameProvider.test.ts`
checks exact WorkspaceEdit ranges, labels, Unicode, current-source authority and
atomic rejection. Existing path-array and Module planner successes are retained
as regressions, not counted as newly found defects. The existing References
assertion for `number[]` checks its base identity inside a scalar initializer;
that already-correct index behavior is not F1's discovery. F1 is the planner's
failure to consume it, and F2 is the distinct lowered numeric argument route.

Issue #1404's R1 variants construct already-renamed source text in the fixture
generator; they never execute the production Rename plan. Its lineAngle repairs
are not counted here. This campaign adds actual-plan → actual source patch →
independent semantic observation checks. No historical fixture or disposition
ledger was changed, and no Human GUI E2E is required for this host-neutral scope.

## Verification on the repaired candidate

- Focused Rename / Module / typed-binding / native provider Vitest run:
  10 files PASS; 102 tests PASS, one existing skip.
- References, Module argument shorthand and this integration regression:
  three files PASS; 63 tests PASS.
- Final dedicated integration run: 16 tests PASS; the full suite also includes
  the final source-preservation and fault-sensitivity assertions.
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm test -- --maxWorkers=2`: PASS; 683 files PASS, two skipped;
  10,927 tests PASS, 183 skipped. One full-suite execution, no retry-to-green.
- `git diff --check`: PASS, with final intended-diff inspection.
- `npm run test:parity` is not required: evaluation/payload semantics and Rust
  eligibility were not changed. The dedicated test directly exercises ordinary
  persistent Rust for every retained source before and after Rename.

No remaining in-scope blocker or scope deviation. Independent exact-pushed-HEAD
review, PR/CI, merge and Issue closure remain with ChatGPT. The implementation
checkout stays on the authorized topic branch.
