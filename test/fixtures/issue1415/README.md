# Issue #1415 — scalar metamorphic Stage 1

Base: `5a7ad367f1da5cbebe61ed9af31479311cb5e589`.
Branch: `sayosomi/issue-1415-metamorphic-stage1`.
Pre-exploration manifest checkpoint: `db355371` (all 256 IDs, before the first novel compilation).

All **256 valid pairs passed** at `ceb8ff15`: R = 128, M = 128.
**Stage 1 is not declared complete:** the required full suite hit an unexpected
Rust process kill and unhandled pipe error (see below). The final checkpoint also
contains the subsequently verified public-import boundary correction; matrix
sources, model and semantic assertions are unchanged by that correction.
[dispositions.tsv](dispositions.tsv) lists every full ID and its explicit final disposition;
[manifest.json](manifest.json) is the unchanged pre-execution list. Each ID is an
individual Vitest test. No production defect was confirmed or production source changed.

The generator builds 2–5 dependency declarations, bounded integer expressions
using `+`, `-`, `*`, and sixteen fixed configurations for each shape/operation.
R1 is a forward-reference chain; R2 fans out and rejoins. M1 has one numeric
parameter and computed export; M2 observes both asymmetric instances separately.
M-a reorders independent locals, inputs, observations and instances; M-d uses
caller-argument aliases on even seeds and exported-value aliases on odd seeds.

`model.ts` computes a separate BigInt oracle from the generator graph. Every
model binding (including each parameter, private local, unused declaration and
instance export) must exactly match both evaluator results. Compiler checks
compare resolved expression trees, initializer references, binding graph edges,
typed dependency edges and their production payload projections to model names
and relationships. Module source targets, call/callee identities, distinct
materialization paths, parameter scopes and export identities are also checked.
Raw statement IDs are never compared across separate compilations.

The tests reuse `compileCanonicalText`, `optionsFor` from
`test/evaluationParitySupport.ts`, `prepareRustEvaluation`, and the same
production `RustEvaluationProcess` stdio boundary as #1412. One child serves all
pairs per run. Cargo build, individual requests, test cases, process lifetime
and teardown have timeouts; completion/error listeners precede requests and
teardown. Hash deduplication enforces the 640 accepted exploratory source ceiling,
without compiler/request quotas. Transient hashes and per-run counters live
outside the checkout; no permanent ledger service is introduced.

## Generator finding retained, no product repair

The initial R-d formatter placed a newline after bare `=`. All 32 R-d IDs were
rejected with `empty-declaration-initializer` / `missing-statement-keyword`.
The other 224 pairs passed. This was a generator legality error: the implemented
[syntax](../../../docs/dsl/en/syntax.md) is line-oriented; ordinary expression
continuation uses an open delimiter in `logicalStatementSourceMap.ts`.
The normative lexical/dependency principles do not make every line break legal.

Independent structural reduction:

```nui
nui 1
const result: number =
  (1)
```

Adjacent controls, both with model expectation `result = 1`:

```nui
nui 1
const result: number = (1)
```

```nui
nui 1
const result: number = (
  (1)
)
```

The deterministic formatting regression retains rejection of the minimal
candidate and checks both controls through compiler, TS and persistent Rust.
R-d now inserts whitespace/comments between statements and newlines inside an
explicitly open expression parenthesis. All original and transformed R-d
programs were rerun, with unchanged IDs. No rejected specimen was counted as a
passing pair or silently discarded. Native shrinking reduced all 32 candidate
configurations (168 successful shrink steps); independent reduction then
removed the graph entirely. This is **not** a confirmed DSL defect or a product
shrink-to-minimal success. The same initial candidate repeated in 31 additional
matrix cells; confirmed/known product-family hits remain zero.

## Replay

Run the complete matrix:

```sh
npx vitest run test/issue1415ScalarMetamorphicRust.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

Re-execute one previously shrunk formatting configuration on the corrected generator:

```sh
ISSUE1415_IDS=R1-d-00 ISSUE1415_PATH=0:0:0:0:0 npx vitest run test/issue1415ScalarMetamorphicRust.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

This replay passed. `replaySeed(slot)` fixes the native fast-check seed;
failures print ID, native seed, counterexample path, configuration and shrink
count. Set `ISSUE1415_EVIDENCE` to an external directory to accumulate deduplicated
accepted hashes and compact per-run counters across bounded runs.

## Measured execution and verification

- Unique compiler-accepted exploratory source texts: **439/640**.
  The fixed matrix contributes **320** unique sources (64 shared originals plus
  256 variants); the other **119** are calibration/shrink probes and controls.
  Reconstructing all matrix source hashes from the fixed seeds confirmed every
  one belonged to the executed accepted set.
- Instrumented pilot totals across **9** bounded runs:
  **2,463 source compiler requests**, **2,231 TypeScript reference requests**,
  **2,204 production persistent-Rust requests**. These include failed harness
  calibration, candidate shrinking, controls, native replay and verification
  reruns. Empty-document setup happened once per run and is excluded from source
  submissions. Existing regression/parity requests are outside this pilot counter;
  their test counts are reported separately below. No cumulative request quota
  was imposed.
- Confirmed new product defect families: **0**. Duplicate/known product-family
  hits: **0**. Product shrink-to-minimal successes: **0** (no product defect).
  New product defects per 100 accepted source texts: **0.00**.
- Generator legality finding: **1 family / 32 cells**, including **31 duplicate
  candidate hits**; **32 native configuration reductions / 168 successful steps**,
  **1 independent structural reduction**, **1 successful corrected replay**.
  These are kept separate from product defect yield.
- Aggregate measured pilot harness time: **15.916 s**.
  Last full-matrix harness run: **2.509 s**. The standalone
  completed-matrix run took **5.34 s** including Vitest startup/transform;
  harness time was **2.881 s**. Timing is observed local cost, not a benchmark.
- Sorted accepted-hash-set SHA-256: `4b77e658ea74d728dbbb31615d285468307574f3e6c2212b9ee668b6ebcb30e4`.

| Check | Observed result |
| --- | --- |
| Generated matrix and formatting controls | 258/258 passed; all 256 pair IDs PASS |
| Relevant scalar/Module/binding/source-map regressions | 12 files, 603 tests passed |
| Native corrected R-d replay | 3 tests passed |
| `npm run test:parity` | 203 passed, 70.68 s |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| Narrow additional TypeScript check of new test files | PASS |
| Rust `cargo fmt --check`, `cargo check` | PASS |
| Rust `cargo test` | 619 passed, 9 existing ignored |
| Rust `cargo clippy --all-targets -- -D warnings` | PASS |
| Full `npm test -- --maxWorkers=2` | **FAIL**: 2 failed, 9,712 passed, 157 skipped; 1 unhandled error; 276.53 s |
| Import-boundary correction verification | 6/6 passed after using existing public exports |
| `git diff --check` | PASS |

The initial full run found this test helper's direct package-internal imports.
They were replaced with the already-exported public
`@nuinuicad/nui-language` entries; no package API was added. The boundary test and
additional TypeScript check passed after that correction.

The other full-suite failure was in the **unchanged**
`test/moduleCollectionStatementForRust.integration.test.ts`: its
`evaluation_stdio` child unexpectedly exited with `code=null, signal=SIGKILL`,
followed by an unhandled `write EPIPE` from `src/node/rustEvaluationProcess.ts:60`.
A diagnostic isolated execution had passed (1 test, 2.97 s) before the full run
finished and revealed the process failure. This does not establish its cause or
turn the failed full gate into a pass. No OOM diagnosis is inferred from SIGKILL.

On seeing the complete failure evidence, execution stopped under #1415's actual
resource/safety-failure rule. There was **no retry-until-green full run**, transport
repair, or additional exploration. The remaining blocker is diagnosis of that
unexpected process failure, followed by required final-candidate full verification.
The final public-import correction also needs its complete matrix rerun when
execution is safely resumed. Independent pushed-HEAD blocking review, PR,
protected CI and merge remain for the subsequent phase; Human Manual E2E is not
required. No normative spec, production owner, dependency, architecture or
Human E2E checkout was changed. No Stage-2 work or other scope expansion occurred.

## Stage 2 recommendation

After resolving the verification blocker, independent review and merge, define a separate bounded Stage-2 Issue.
The final matrix is cheap enough for ordinary regression (about three seconds
of harness execution) and validates this oracle/projection method. Zero product
defects in this finite sample is not scalar-wide or DSL-wide correctness evidence.
For conditional/loop/carry transformations, first establish legal source
transformations and independent branch/snapshot oracles from fresh normative
specifications, subtract #1260 coverage, and retain a finite manifest and source
ceiling. Stage 2 has not been started.
