# Issue #1534 implementation evidence

Implementation checkpoint for [#1534](https://github.com/sayosomi/nuinuiCAD/issues/1534),
including [#1531](https://github.com/sayosomi/nuinuiCAD/issues/1531)'s minimal regression.
Base: `ca53213c6061635b5bce7c422bde96cc9df41506`.
Branch: `sayosomi/issue-1534-geometry-builtins-in-constructions`.
The containing Git commit is the implementation checkpoint; this report does
not certify independent review, CI, or Human Manual E2E.

## Cause and correction

The earliest incorrect producer was construction numeric binding compilation.
It classified measurement operands as ordinary scalar references and did not
produce the typed geometry operand sidecars that typed declarations already
use. Evaluation therefore fell through to the legacy numeric parser, whose
measurement-call argument contract rejected the construction's reference tokens.
Changing that parser alone would lose typed geometry identities and scheduling.

Construction numeric bindings now reuse the existing builtin signature catalog,
typed geometry resolver, typechecker, typed expression lowering, dependency
graph, and TS/Rust typed evaluators. Direct calls are admitted only for numeric
inputs of point, line, path, curve, and arc constructions. No second resolver,
scheduler, parser, production host, or dependency was introduced.

The following additional existing owners were reached by bounded causal repair:

| Owner | Required correction |
| --- | --- |
| `numericBindingCompiler`, `typedDeclarationAnalysis`, `dslDocument` | Admit measurement-only construction consumers even without a scalar declaration; compile canonical operand identities and exact argument diagnostics. |
| `builtinGeometryArgumentResolution`, `typedDependencyGraph` | Preserve stage-only line operands and stage-specific dependencies; suppress superseded legacy final-stage edges. A direct `.base` measurement previously acquired a false cycle while the const control passed. |
| `dslReferences`, `dslParameterSpanScanner` | Reuse the existing structured coordinate-component scanner; nested call commas must not split an inline coordinate. |
| `moduleSemanticAnalysis`, `moduleBodySemanticCore`, `moduleNumericRuntime`, `moduleScalarRuntime` | Lower Module parameters/exports and inline/intermediate numeric sites through existing typed Module lowering; map source record positions to compiled intermediate slot IDs. |
| TS `evaluate`, `numericBindingRuntime`, `scalarProgramEvaluation` | Resolve typed geometry/properties in the current generated frame; validate generated typed sidecars against the canonical source template. |
| Rust `evaluation/mod`, `numeric_binding_runtime`, `scalar_expression_runtime`, `for_group_generic_runtime` | Supply canonical source order and the existing active frame map to the typed numeric evaluator, matching TS. Three scalar caller changes initialize the added optional frame context to `None`. |
| Completion context/query/metadata, scalar position classifier, Module completion owner | Offer the same four catalog functions at numeric construction sites and filter geometry operands by the existing point/strict-line/endpoint/Module interface contracts. Include exclusive numeric arguments such as `between.distance`. |
| Normative spec and implemented DSL Reference | Extend only the authorized call positions and document arithmetic, inline coordinates, intermediate handles, dependencies, and the #1531 example. |

`source-manifest.json` lists every changed implementation, documentation, test,
and reusable evaluation fixture, with SHA-256 hashes of the verified content.
The evidence files in this directory are additional review artifacts.
Architecture ownership and production entry points remain unchanged, so no
architecture-document update is required.

## Base FAIL and corrected PASS

`base-focused.log.gz` was captured before production edits on Base. Four oracle
cases ran: direct Bezier and direct between/ratio failed; both const controls
passed. The direct failures report:

> 関数の引数には要素名または要素IDが必要です。

The final regression source is
`src/geometry/constructionGeometryBuiltins.integration.test.ts`. Its four
baseline cases retain the same independent numeric oracles:

- Bezier: `angle((20,0), (10,40)) = 104.03624346792648°`; compare handle angle,
  full segments, and length with the independently specified angle.
- Between: `distance((0,0), (30,40)) = 50`; `50/3+5 = 65/3`; both distance and
  ratio forms yield `(13, 52/3)` mm. Test both direct and const-carried forms.

`focused-parity.log.gz` records all 28 final regression cases passing with Rust
evaluation enabled. Every evaluation compares the full normalized Rust and TS
payloads before checking the independent oracle. The suite also covers:

- all four builtins, arithmetic, reversed source order, changed dependencies,
  incremental recompilation with retained identity, and no-const consumers;
- inline coordinates and Bezier handle/intermediate numeric values;
- base/final stages, endpoints, a base-stage false-cycle control, Module
  parameters/exports, nested generated frames, explicit occurrence indices,
  and arithmetic combining measurement calls with ordinary geometry properties;
- wrong types/arity, malformed calls, unresolved references, exact physical
  diagnostic spans, disabled/failed/zero-length geometry, and dependency cycles.

The two new `test/fixtures/evaluation/nui1-construction-geometry-builtin*.nui`
fixtures also run through the existing full parity gate. The generated-point
measurement fixture now uses canonical `@` references. Historical evaluator
tests used obsolete bare geometry names and `PR:start`; those inputs were
corrected to canonical references without changing their numeric expectations.
Their evaluation helper now passes the existing production compilation options
instead of omitting typed sidecars. Generated property arithmetic retains the
old numeric oracle and is repaired through current-frame identity mapping.
Completion conformance's previous null expectation was updated only for the
newly authorized construction positions. No numeric expectations were weakened.

## Verification

All commands ran in the registered implementation checkout. New/modified
focused regressions ran before the required full block. Focused results include
28 Rust/TS regression cases, 365 passing neighboring tests (one skipped), 175
existing evaluation tests, and 17 focused Rust numeric-binding tests. See logs.

| Required command | Result |
| --- | --- |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm run docs:dsl:check` | PASS |
| `cargo fmt --manifest-path rust-evaluator/Cargo.toml --check` | PASS |
| `cargo check --manifest-path rust-evaluator/Cargo.toml` | PASS |
| `cargo test --manifest-path rust-evaluator/Cargo.toml` | PASS: 650 tests, 13 ignored |
| `cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings` | PASS |
| `npm run test:parity` | PASS: 209 tests |
| `npm test` | Unchanged rerun PASS: 12,212 passed, 188 skipped; initial launch failure retained below. |

The first full `npm test` run had 12,211 passing tests and one failure:
`bakeSourceRoundtrip.test.ts` B08 could not spawn the shared Rust executable
(`evaluation_stdio ENOENT`). This is a process launch failure, not a geometry
assertion. B08 passed in isolation. Existing suites concurrently build the
shared executable; an existing root-point suite explicitly documents avoiding
that replacement race using a separate target directory. The exact process
that caused this launch failure was not established. No unrelated test
infrastructure or gate was changed. The original failure remains in
`npm-test.log.gz` and isolated result in `bake-diagnosis.log.gz`.

One bounded unchanged-source rerun was performed after explicitly building the
production executable. Its result is retained separately; the initial failure
is not erased or presented as a clean first-pass gate.

The unchanged rerun passed: 731 test files passed, three skipped; 12,212 tests
passed, 188 skipped, zero failed (197.11 seconds). See
`npm-test-repeat.log.gz`, `npm-test-prebuild.log`, and
`npm-test-repeat-status.log`. There was no retry loop and no source or test
change between these two full runs.

Raw command output is retained here, gzip-compressed for large logs. Source
hashes were checked against the pre-gate manifest. `git diff --check` also ran.

## Scope and remaining checkpoints

The newly reached compiler, coordinate scanner, Module lowering, dependency,
frame-runtime, and completion owners above are causally required by the Issue's
accepted numeric sites and identity semantics. There is no expansion to text,
image, layout, output, or unrelated expression sites, no new builtin, no
measurement-semantics change, and no general expression redesign. No separate
#1531 implementation was added. There was no open-ended conformance campaign.

Independent exact-HEAD blocking review and Human VS Code Manual E2E remain
pending. No Human Manual E2E PASS, merge, or Issue closure is claimed. The
transient full-suite process-launch failure is retained as a verification
limitation even if the unchanged rerun passes.
