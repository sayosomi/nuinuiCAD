# Stage 7 — four repaired families, polyline owner blocker

[Issue #1428](https://github.com/sayosomi/nuinuiCAD/issues/1428) is **BLOCKED,
not complete or merge-ready**. Base is
`e08ff62174bc461661693173a27108f71c14de35`; the branch is
`sayosomi/issue-1428-targeted-stage7`. The reviewed initial checkpoint was
`0a6b47bef3c5c79395b199ddd74f83fdbe70ab60`. Human explicitly authorized its
continuation on 2026-10-20. No Human admission was repeated, no other checkout
was used, and no merge, Issue closure, dependency, CI or architecture change occurred.

Current disposition: **17/20 frozen sources PASS; three BLOCKED**. Five novel
families are independently confirmed; four are repaired. `families.json` gives
the first incorrect owners, legal minimum reproductions, genuine passing
controls and before/after evidence. The extra pure-seed root ordering failure
is an unresolved, non-equivalent reducer, not a sixth confirmed novel family.
Residual Issue #1260 remains open.

## Frozen sources and original failures

`freeze.json` is unchanged. All 20 original sources were compiler-prevalidated
before freezing and before any primary evaluation. It retains source hashes,
seeds, independent geometry expectations, order and initial product fingerprint.
`checkpoint.json` is the preserved original BLOCKED disposition, not the current
result; `outcomes.json` owns the current per-source results. Original raw/log
hashes remain in `evidence-index.json`; the original source hashes/oracles were
not tuned to the observed results.

The first four scheduled texts are H1-03, H1-07, H2-00, H2-07, then the remaining
16. Seed = `9000 + hypothesisOffset + cellIndex`, offsets H1/H2 = 0/100, indexes
00..07. H1 bits: 4=path rather than line, 2=Module rather than root, 1=two inner
iterations rather than zero. Outer length is two. H2 bits: 4=line rather than
point, 2=exhaustive match rather than if, 1=ancestor gate rather than direct.
Each hypothesis has two distinct-hash controls sharing the cell-00 numeric model.

The normative oracle is `docs/nui1/spec.md`: simultaneous immutable next,
inner-final escape, ordered geometry arrays, immutable stages, lexical/export
identity, lazy selection, enabled-before-input and Module atomic failure.
The H1 oracle is independently unrolled: active final member ends are
`(u+27,22)` and `(u+30,27)`; zero-inner variants preserve their initializer.
It checks whole geometry, endpoints, lengths, generated occurrences, order and
qualified exports. The H2 oracle independently applies one swap, includes only
the successful Module's children and consumer plus the survivor, and requires
selected errors to suppress the failed Module without activating Dormant.

The original harness lost some per-cell rows on observer exceptions. Its
unchanged-product retry hit the H2-00 native stack overflow at 23:28 JST on
2026-10-19. The exact original native wire was not saved; frozen source, product
fingerprint and stderr survive. No missing original native result is invented.
The continuation preserved this incomplete original baseline and diagnosed it
without repeating the native crash, as expressly requested by the Human.

## Diagnosis and repairs

1. **F1, runtime collection snapshots.** Independent root and Module reducers
   throw a bounded TS RangeError after one swap; zero-iteration controls pass.
   TS and Rust capture functions copied local geometry aliases into next
   unchanged. Those aliases subsequently read the new carry, making a cycle.
   The repair captures compiler-resolved indexed member identities against the
   incoming snapshot, using existing collection member selection and canonical
   generated provenance. It does not eagerly evaluate geometry or unselected
   branches. The original native failure plus independent TS reduction establish
   FAIL-before; four normally eligible persistent-Rust/TS reducers establish
   PASS-after. The native stack overflow was never repeated.
2. **F2, indexed line/path alias lowering.** `lowerGeometryValuePath` dropped
   carry-owned indexed aliases because it lacked the existing point path's
   deferred collectionIndex fallback. The legal minimum Module reducer omits
   Out before and passes after. The repair reuses the existing canonical target,
   with root/Module drawable-seed controls and the frozen line matrix passing.
3. **F3, path endpoint interface metadata.** An alias with an endpoint selector
   retained interface path, making a valid point consumer normally Rust-ineligible.
   A path reducer and adjacent line control isolate this from carry execution.
   Lowering now exposes the selected point interface; both are normally eligible
   and produce (8,11) in both engines. Whole-path inputs keep their path interface.
4. **F4, missing immutable point diagnostic.** Rust point-anchor resolution used
   an early None return for a missing geometry value. The consuming Module
   drawable had no error, so Prefix leaked and an external consumer failed.
   The independent invalid/valid Module pair isolates the failure. Emitting the
   existing dependency diagnostic at the missing input lets the existing atomic
   Module/suppression logic operate. Both engines now attribute the error to the
   exact consuming owner and suppress the partial Module.
5. **F5, confirmed but unrepaired polyline projection.** Inline polyline tuple
   coordinates containing Module parameters or geometry properties have no
   canonical numeric bindings. The generic compiler enumerates numeric parameter
   definitions, but polyline exposes only the points list and closed flag;
   coordinate access also lacks indexed-list support. `R-polyline-inline` fails
   while named coordinate points in `R-polyline-named` pass in both engines.
   Required canonical owners `packages/nui-language/src/parameters/parameterDefinitions.ts`
   and `parameterAccess.ts` are outside the Issue's approved paths. The contract
   requires a stop when an expected signal needs excluded owners. No duplicate
   local accessor, frozen-source rewrite or specification change was used.

F5 blocks **H1-05, H1-06, H1-07**. Other current H1 sources and all H2 sources
pass. The old pure immutable seed/root reducer has a separate release-order
problem; it is retained as a non-equivalent reduction and is not assigned F2's
PASS-after or counted as a repaired family. A future separately authorized
probe could prioritize that specific collection-alias dependency-order hypothesis.

## Ownership, diagnostics and sensitivity

Canonical compiler plans and carry collection IDs are checked independently of
runtime agreement, including inner initializer/outer-next identities and lexical
Module owners. Original compiler bindings/dependency edges and final wire plans
are retained externally for inspection. No new resolver, scheduler, evaluator,
transport or production abstraction was introduced. Rust remains the production
semantics owner; TS is the reference/parity boundary.

Selected point-array errors belong to One::Mark and reference Bad's source ID.
For line arrays, the selected unavailable Final1 alias has exactly One's canonical
instance path, and One::Mark references that alias's source ID. Two's unselected
error and Dormant produce no such diagnostics. Poisoned disabled bindings are
bookkeeping, not evaluation of the invalid argument. Exact emitted/suppressed
geometry and non-poisoned diagnostic absence are checked. The original frozen
Chosen label names the selected collection, not a private diagnostic occurrence.
Observer corrections are distinguished from product families.

Test-local cloned carry plans provide actual first-loss calibration:

- H1's two passing nonempty line sources substitute inner initialization for
  outer consumption of inner-final. Both engines detect wrong final Result0.
- All eight H2 primaries and both H2 controls lose their swap in cloned next
  plans. Both engines detect wrong Two::Mark geometry (10/10).
- The five zero-inner/control H1 sources are NOT_COVERED for inner-body loss.
  Three unresolved H1 sources are also NOT_COVERED. No gate/atomicity fault was
  injected, and no sensitivity to every hypothetical H2 fault is claimed.

These 12 output detections are not diagnostic-only noise or novel product
families. No production code was changed to inject a historical fault. Frozen
Stage 3–6 fixtures and historical #1358/#1359/#1360 controls remain unchanged.

## Replay, verification and telemetry

Compiler-only replay is safe:

```sh
ISSUE1428_MODE=prevalidate ISSUE1428_EVIDENCE=/tmp/nuinui-stage7-prevalidate \
  npx vitest run test/issue1428TargetedStage7Rust.integration.test.ts
```

The default strict verification is the required focused command. It currently
fails the three blocked frozen cells and the inline-polyline reducer; do not
turn those into skips or call the Issue complete. `ISSUE1428_IDS` selects exact
IDs for diagnosis; `inspect` records compiler products and bounded TS reducers
without starting Rust. `baseline` requires the original product fingerprint and
will not run against repaired product code or overwrite an existing baseline.
Normal production eligibility is never overridden. Process safeguards remain:
Rust build 120 seconds, request 20 seconds, process ten minutes, teardown five
seconds; close/error listeners precede transitions. Native failure stops later
cells and persists input before dispatch.

`verification.json` records the required build/lint/parity/full-suite/DSL and
conditional Rust checks, plus historical regressions. No repeated full suite is
used for reassurance. Manual E2E is Not Required. This remains a BLOCKED
checkpoint despite the passing checks because frozen acceptance is incomplete.

`telemetry.json` and `summarize.mjs` record the union of accepted/rejected hashes
and instrumented Stage 7 compiler/TS/production requests across retained phases.
34 distinct accepted texts are below 56: 20 frozen, 13 current reducers/controls,
and one retired non-equivalent root reducer. There are 43 rejected original
prototype hashes, no optional primary counterfactuals and no filler inputs.
Historical/parity/Rust unit suite requests are not included in campaign request
counts. Request counts, timings and PASS counts are not quota measurements.
Human before/after quota, reset identities and concurrent-use observations are
UNAVAILABLE; no efficiency ratio is claimed.

Original and continuation raw evidence stays outside the checkout under
`/tmp/nuinui-stage7-1428*`; hashes and counts are committed. Temporary retention
is not an archival guarantee; the frozen sources and reducers are reproducible.
The next action is independent review of the exact pushed HEAD, followed by an
explicit decision on extending the named parameters owner scope before a fresh
same-Task continuation. Do not merge or close #1428/#1260 at this checkpoint.
