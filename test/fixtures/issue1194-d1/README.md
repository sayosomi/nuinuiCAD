# Issue 1194: structured-value D1 checkpoint

This is the completed initial 40-cell slice, not completion of Issue 1194 or
an overall DSL correctness claim. The Issue remains open for the residuals
below and independent review, protected integration, and Human checkout return.

Base: `21a270d8dafd1fd1c3b012f4f206fb62ee67d367`.
Branch: `sayosomi/issue-1194-structured-d1`.

## Reproduction and oracle

Run `npx vitest run test/issue1194StructuredD1Rust.integration.test.ts` from
the repository root. The normal mode verifies 40 matrix cells and 35 reduced
examples/controls: 74 accepted inputs must meet the independent oracle through
both TS and normally eligible persistent production Rust stdio; one deliberately
wrong nominal record constructor must be rejected.

Optional runner variables:

- `ISSUE1194_IDS`: comma-separated cell/reducer IDs for focused reproduction.
- `ISSUE1194_MODE=discover`: collect failures without treating them as PASS.
- `ISSUE1194_MODE=prevalidate`: compiler-only admission, with no runtime calls.
- `ISSUE1194_EVIDENCE`: external directory for compiler products, prepared wire
  input, raw stdout chunks, decoded TS/Rust payloads, counters, and source hashes.
- `ISSUE1194_PHASE`: a label for an experiment's run identity.

`model.ts` is the deterministic seed-1194 source/bundle model; `oracles.ts`
contains authored numeric expectations and imports no compiler or evaluator.
`assertions.ts` checks exact values, expected none/error behavior, unexpected
diagnostics, and A's ordered producer/alias edges. Parity uses the existing
`evaluationParitySupport.ts` normalizer as an additional check, not the oracle.
`reductions.ts` preserves the small sources named in the family table.

The runner uses canonical compilation, production evaluation options and normal
Rust eligibility. It directly instruments the existing `RustEvaluationProcess`
because the convenience parity client does not expose the child streams needed
for wire evidence, bounded requests, and observed cleanup. This is a test
adapter around the production transport, not another evaluator or transport.
Cargo build, each request, process lifetime, and teardown are bounded; lifecycle
listeners are installed before transitions. The input actually written to Rust
is checked against the normal prepared input. Both normal Node projection and
raw wire output are retained externally.

## Closed matrix

`freeze.json` records the final 40 bundle hashes, three binary axes, and
expectations frozen before their first actual TS/Rust execution. Authoring and
compiler-only prototypes preceded that freeze. The final matrix bytes were not
weakened after observing runtime failures. Rejected prototypes remain explicitly
inventoried rather than being relabeled as evaluator PASS.
The initial compiler-only harness also omitted the canonical stable-ID setup;
those harness failures are not product findings. That setup was corrected before
the first actual runtime experiment.

| Stratum | Base PASS | Repaired then PASS | Invalid/blocked/unresolved final cells |
| --- | ---: | ---: | ---: |
| A: named/inline × direct/local alias × one/asymmetric instances | 8 | 0 | 0 |
| B: collection/record × if/whole some-binder × root/Module | 4 | 4 | 0 |
| C: array field/record array × constant/computed with map × root/Module | 3 | 5 | 0 |
| D: point/line × direct/forward alias × root/Module | 0 | 8 | 0 |
| E: import/re-export × array/nested field × direct/local alias | 4 | 4 | 0 |
| Total | 19 | 21 | 0 |

B includes present, absent, selected-error and unselected-danger observations;
the if route resolves its optional result through ordinary coalesce. C's
computed group contains value-producing `for`. D uses point and line, not an
unimplemented path variant. E uses saved dependency snapshots and explicit
Module re-export, with no live editor/watch lifecycle.

`dispositions.json` records each cell/reducer's hash, authored expectation,
before compiler/diagnostic/runtime observation, after status, eligibility and
source-tree/run identity. A `P-` reducer prefix describes its intended control
role, not proof of baseline PASS: `P-local-nested` and
`P-record-literal-references` actually fail at base and are marked repaired.

## Confirmed repair families

The count is 11 conservatively grouped producer-loss families, not a count of
assertions, scalar properties, or previously repaired historical issues.
`families.json` supplies the exact owners, affected cells and regression IDs;
`dispositions.json` supplies the matching before/after observations and hashes.

| Family | Minimal failing source | Genuine neighboring base PASS | First incorrect producer / repair owner |
| --- | --- | --- | --- |
| F01 | R-geometry-record | P-geometry-direct | Module semantic geometry-property target drops the resolved occurrence |
| F02 | R-geometry-export | P-geometry-direct | Geometry runtime record forwarding drops the owning instance path |
| F03 | R-field-index | P-field-module | Root record collection-field index routing/producer execution position |
| F04 | R-field-array | P-array-alias | Canonical array reference admission misses collection-valued record fields |
| F05 | R-record-binder | P-scalar-binder | Record semantic whole optional some-binder is unresolved |
| F06 | R-record-coalesce-root | P-record-coalesce-source | Root/Module selected record contents and lazy constructor producers |
| F07 | R-mapped-record-index | P-record-index-constant | Mapped record collection-field producer/selector forwarding |
| F08 | R-mapped-tag | P-mapped-tag-constant | Scalar semantic typecheck retains resolutions for a replaced index AST |
| F09 | R-import-nested | E00 | Nested export field path and defining-document record catalog |
| F10 | R-record-constructor-array | P-record-literal-with-module | Inline collection constructor occurrences, seed order and canonical record access routing |
| F11 | R-record-if-array | P-record-if-scalar | Record control-flow shell parses collection-valued constructor arguments as scalar arguments |

F06 deliberately groups related descriptor/producer manifestations rather than
inflating the count for root, Module, none, selected error and lazy fallback.
F09 includes local full-path and saved defining-catalog loss. F10 includes the
previous dependence on an unrelated Module to activate scalar-record indexing.

Exact base replay runs are `base-replay-1792497394243` (67 cases) and
`base-late-controls-1792497869048` (8 cases), both with source-tree digest
`07e85a36ea804bf320d2eeaa43b9bf9d074ddeab7eb35b7c5e6567995ffd559f`.
All ten production files were read from the fixed base for these controlled
experiments, then candidate bytes were restored exactly, without switching,
resetting, stashing or rewriting Git history.

F02 has an additional independent counterfactual:
`isolate-geometry-forwarding-1792497872784`. With only its production owner
restored to base, R-geometry-export and R-geometry-asymmetric fail, while
R-geometry-record and P-geometry-direct pass. Its baseline runtime failure is
otherwise masked by F01's earlier malformed property target.

Historical #1376, #1166, #1168, #1173 and Stage 1–7 assertions are excluded from
novelty. Existing record/Module regressions were reused unchanged as controls.
No Rust evaluation or transport defect was claimed: the original malformed
payload is emitted by the compiler and correctly rejected at the Rust boundary.

## Input capacity, calls and evidence

`input-registry.json` contains 74 accepted distinct hashes, below the ceiling of
112, and 24 distinct rejected hashes: 22 pre-freeze compound prototypes, one
deliberate nominal mismatch, and one corrected empty-Module authoring typo.
No rejected prototype is counted as a novel confirmed family merely because
the compiler rejected it. Exact unreplayed compound shapes retain their
unresolved/not-replayed disposition, even when reduced equivalents are fixed.

`telemetry.json` contains actual instrumented top-level compiler attempts, TS
calls and production persistent Rust requests, including failures and replays.
It explicitly excludes estimates of internal compiler recursion, blank setup
compiles before setup instrumentation and historical suite internals. Two
additional campaign reruns without external counter output are separately
accounted for from their saved test/counter logs and identical instrumented
replay: 68 compiler attempts and 66 TS/Rust calls. The combined campaign total
is 1,043 authored compiler attempts and 799 TS / 799 persistent Rust calls;
14 tracked blank setup compiles are separate. Thus these are campaign counts, not an invented
complete evaluator-call total for `npm test`. Successful counters are not
quota measurements. Weekly and five-hour remaining percentages are UNAVAILABLE:
the Human supplied no readings or reset identities.

Large evidence is outside Git at
`/tmp/nuinuicad-1194-d1-20261020/`, notably `compiler.ndjson`, `raw.ndjson`,
`transport.ndjson`, `runs.ndjson` and `accepted.sha256`. This temporary directory
is local evidence, not a durable cross-machine artifact. The committed sources,
oracle, reduced examples and compact observations support independent replay;
`evidence-manifest.json` records raw file digests at checkpoint time.

## Verification and scope review

The first exact mandatory block passed 238 focused tests, build, lint and 203
parity tests, then full regression exposed three geometry routing assertions
and an independently SIGKILLed Rust child/EPIPE. The geometry regressions came
from an overbroad record-collection activation check; the final fix consults
the canonical resolved record target instead. The missing empty-document guard
in that correction was caught and fixed immediately. The four affected files
then passed all 84 focused tests, including the previously killed test. The
required final block was rerun because production source changed, not as an
unchanged retry-until-green. Final results are recorded in `verification.json`.
The DSL reference check also passes; existing supported syntax/semantics are
repaired, so no reference/spec change is needed.

Production changes stay in ten allowed language semantic/lowering files.
The shared field accessor was moved from its existing Module owner to the
existing record semantic owner and reused; there is no second resolver,
accessor, scheduler, evaluator, document model or runtime name lookup.
Only existing collection/recordMap/alias/field descriptor variants are emitted.
No Rust validator weakening, new payload schema, GUI, dependencies, CI,
packaging, architecture or normative-spec change is included. Internal owner
boundaries remain those documented in ARCHITECTURE.md. The fixture documents
are reusable regression evidence, not an obsolete implementation plan.

## Remaining original Issue rows

| Original domain | Disposition of this slice |
| --- | --- |
| Root/named/inline record collection fields through Module parameter, local, alias and export | Completed for A's eight routes and reduced root/direct cases; #1376 is an unchanged control |
| Optional values, none, lazy selection, record/collection results | Completed for B and the reduced whole-binder/coalesce, none and selected-error cases |
| Nested record/collection indexing and value-for | Completed for C's eight routes, scalar nested indexing, mapped field forwarding and inline record collection constructors |
| Geometry-valued record transport | Completed for point/line root/Module and asymmetric forwarding examples; arbitrary path/transformation-stage/geometry-heavy collection combinations not covered |
| Imported/re-exported structured identities | Completed for E's saved Module bundles, nested field catalogs and asymmetric re-export example; arbitrary same-named cross-document collisions and longer mixed identity chains not covered |
| General record some-binder reconstruction and other optional shapes | Not covered beyond exact whole-binder return; not claimed repaired by the narrow normalization |
| Direct record-field value-for source spelling; arithmetic scalar array-literal member spelling | Pre-freeze rejection observations retained UNRESOLVED for contract/admission triage; no invalid-syntax or correctness claim |
| Compound pre-freeze inline-constructor and file-public record/type bundle prototypes | Exact compound shapes not replayed; reduced legal constructor equivalents fixed; file-public/qualified-type spelling not admitted in this matrix |
| Source dependency permutations, deep nesting, stress and combinations beyond these representatives | Not covered by the bounded slice; no general correctness claim |
| Live document edits, saved/dirty watcher transitions and language-service providers | Not covered and outside the authorized implementation surface |
| Carry/control/gate and diagnostic eight-row campaign | Delegated by the current Issue/roadmap to #1260; not duplicated here |
| Independent exact-HEAD review, protected CI/merge and Human clean latest-main return | Pending; no PR, merge or Issue close is performed by this agent |

All 40 initial cells have final justified dispositions and were rerun after the
repairs. Full Issue acceptance is incomplete for the residual and integration
rows above. Next safe action is independent ChatGPT review of the exact pushed
topic HEAD, retaining Issue 1194 open.
