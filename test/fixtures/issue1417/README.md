# Issue #1417 — finite control-flow metamorphic Stage 2

Base: `ebb00adfb84cf6a38cba6401a23ad2a0be9daa0e`.
Branch: `sayosomi/issue-1417-metamorphic-stage2`.
Pre-exploration manifest/coverage checkpoint:
`e9130ddaac0553485d5013ad57342076fa773225` (pushed before any novel compilation).
Executable candidate: `f4fd7adbc18e94678b0341d8c63db00f116b28cd`.

All **512 valid pairs PASS**: C=128, V=128, S=128, X=128. There are zero
unresolved, blocked, contract-invalid or ambiguous cells, and no skipped matrix
tests. **Zero confirmed product defect families; no production repairs.**
Independent exact pushed-HEAD blocking review, protected CI, PR/merge and merged
main readback remain subsequent acceptance gates. Human Manual E2E: Not Required.
This finite model does not establish arbitrary DSL-wide correctness.

## Retained evidence

- [manifest.json](manifest.json): immutable Cartesian IDs, 4 suites × 2 shapes ×
  4 transformations × 16 deterministic configurations.
- [coverage.tsv](coverage.tsv) and [coverage.md](coverage.md): per-ID semantic
  dimensions, closest historical evidence and actual assertions, coverage
  classification, and missing interaction. All 512 are PARTIAL; none was
  subtracted as ALREADY-COVERED. The second reconciliation retained those
  classifications and corrected one TS/Rust assertion attribution in V2.
- [dispositions.tsv](dispositions.tsv): all 512 PASS results, native replay
  seeds, SHA-256 of sources A/B, full original model-value map, and original
  per-iteration binder/incoming/next/branch trace. The last two columns are
  hashes, not truncated numeric observations. Reconstruct them using the code
  in the test's `pairEvidence` calculation and `makePair`/`oracle`.
- [generator-rejections.json](generator-rejections.json): every distinct
  rejected exploratory rendering, exact source/hash/diagnostic codes, seed,
  shrink path and two independent minimal reductions.
- [metrics.json](metrics.json): measured request counts, unique accepted-input
  accounting, per-run summaries and final verification results.

## Model and assertions

The generator reuses Stage 1's installed fast-check configuration arbitrary.
`replaySeed(slot)` fixes each configuration independently of test execution
order; every shape/operation asserts 16 distinct original source texts. No
filter/discard or retry-until-green loop is used.

`model.ts` interprets generator nodes with bounded BigInt arithmetic, explicit
boolean/exact-choice selection, ordered whole numeric maps, and a fresh incoming
carry Map for each iteration. Every next value is computed before committing
any state. A hand-calculated two-carry control asserts transitions
`(3,11) -> (13,1) -> (6,8)` for binders `[2,5]`, then checks both evaluators.

Both sources independently match all available scalar values, including
prerequisites, unused insertions, aliases and escaped carries. Every collection
has length and every existing index observed, including intermediate maps and
the transformed input alias. Empty sources have length zero and no invalid
index read. Shapes use lengths 0/1/2/4; zero iteration uses an empty collection,
never an illegal descending numeric range. S also uses inclusive ascending
positive-step ranges. X2 uses exact `choice(left, right)` collection binders.

Compiler assertions compare resolved ASTs and references, unconditional binding
dependencies, guarded conditional dependencies, collection source identities,
analysis-only map binders, synthetic next identities, loop ownership and
production payload projections against generator relationships. IDs are joined
within each compilation; raw source positions/IDs are not compared between A/B.

Both TypeScript reference and the actual production Node→persistent Rust stdio
path must match the independent oracle, with clean runtime diagnostics. C-d and
X-d also run 64 adjacent compiler-accepted selected-error controls, each
independently predicting division by zero. Assertions check exact issue code,
selected binding, escaped result and diagnostic navigation/line attribution.
Unselected error branches must stay lazy. No compiler rejection counts as a
runtime-laziness PASS.

The model retains every iteration's binder, incoming snapshot, simultaneous
next state and selected branch. Public scalar version history exposes the last
execution of a body declaration, rather than an entire iteration archive; tests
compare that last incoming/branch/binder projection and all escaped final values.
Zero-iteration bodies must have no executed/poisoned history. No production
instrumentation was added to invent otherwise inaccessible probes.

The harness reuses canonical compilation, `optionsFor`, `prepareRustEvaluation`
and `RustEvaluationProcess`. One production child serves each run. Cargo build
has a 120-second timeout; requests 10 seconds; each pair 30 seconds with bounded
native shrinking; process lifetime 10 minutes; teardown 5 seconds. Relevant
listeners are installed before requests/teardown. Transport/process failures
stop exploration. Accepted source hashes accumulate outside the checkout and
enforce the 1,400-text ceiling across reruns without a cumulative request quota.

## Generator calibration, separate from product findings

The first renderer put general numeric-expression wrappers inside a collection
literal, for example `[(1)]`. Removing the wrapper then exposed unary-minus
members such as `[-1]`. Current collection grammar accepts literal tokens and
scalar references; the shared literal scanner treats unary minus as an operator,
not part of a number token. Both renderings rejected with `array-invalid-member`.
All eight original rejected texts and both minimal reductions are preserved.
The generator now authors a signed expression in a scalar initializer and uses
its `@reference` as the member, matching the normative collection literal/reference
forms (`docs/nui1/spec.md`, “Choice literals and arrays”). Legal controls observe
`[1]`, a reference to a scalar `-1`, and `[]` completely through both evaluators.
The promised matrix semantics and IDs did not change. These rejected renderings
do not establish a product defect or broader array-expression conformance.

The two rejected-renderer phases each shrank V2-b-03 through five native steps;
independent reduction removed the maps. A corrected replay of the reduced
configuration passed. Other calibration corrections concerned test assumptions:
lazy references are excluded from the unconditional binding graph; match guards
use `match:label`; map binders share a catalog scope but remain preResolvedOnly;
range carries can themselves be preResolvedOnly; and the Vitest environment's
asset URL cannot be passed to a filesystem read. None required a product change.

New product families=0; duplicate/known product-family hits=0; product
shrink-to-minimal successes=0; product families per 100 accepted sources=0.00.
Open #1260 and #1194 ownership was not taken over; geometry historical fixtures
were smoke controls only. Stage 1 remains intact. No architecture, normative
specification, dependency or documentation outside this fixture owner changed.

## Replay

```sh
npx vitest run test/issue1417ControlFlowMetamorphicRust.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

Corrected native replay of the retained rejected-renderer configuration:

```sh
ISSUE1417_IDS=V2-b-03 ISSUE1417_PATH=0:0:0:0:0:0 npx vitest run test/issue1417ControlFlowMetamorphicRust.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

Set `ISSUE1417_EVIDENCE` to an external directory to retain accepted hashes,
source attempts and per-run counters. Large logs remain outside the repository.
The campaign evidence directory is `/tmp/nuinuicad-issue1417-20261019`.

## Verification

The complete required block PASSed: five files / 546 tests; parity 203;
build; lint; serial full suite **662 files passed / 2 skipped, 10,229 tests
passed / 157 skipped, zero failures or unhandled errors**, 507.86 seconds.
The broader focused run passed 1,007 tests in 11 files, with one existing skip.
The new file contributes 515 passing tests (512 matrix cells and three controls).

Campaign totals across 15 bounded runs: **737 / 1,400 distinct accepted texts**,
**4,538 source compiler requests**, **4,460 TypeScript reference requests** and
**4,460 persistent production Rust requests**. This includes calibration,
shrinking, controls, native replay and required verification reruns; unrelated
regression/parity requests and fixed empty-document setup are excluded.
Accepted texts reconcile to 660 unique matrix sources, 64 selected-error
contrasts, four model/grammar controls and nine other calibration configurations.
Rejected texts do not consume accepted-input capacity and were never counted
as passing runtime cases. Sorted accepted-set SHA-256:
`0d9bd559df9f30d42a56c7ec620acf23d7376ce5a0cec4109ae6cb3409a1b454`.
Aggregate measured harness time: 26.449 seconds; last matrix harness: 5.696
seconds. These observed local timings are not a performance claim.

The required final-candidate block runs the five specified regressions, parity,
build, lint and serial full npm suite in order, stopping on failure. Detailed
outcomes and measured counts are recorded in [metrics.json](metrics.json).
The broader focused run includes Stage 1, scalar if/match, immutable carry,
mapped carry and Module numeric statement-for controls. Additional strict
TypeScript checking covers the new test files (the ordinary app build excludes
`test/`). `git diff --check` and artifact/manifest/disposition review are also
required before the final evidence-only push.

Rust production stdio was built and used throughout. Rust fmt/check/test/clippy
are not additional affected-owner gates here: no Rust or production semantic
owner changed. They are not reported as executed. The independent review must
assess the exact final pushed HEAD; this report is not that review's approval.
