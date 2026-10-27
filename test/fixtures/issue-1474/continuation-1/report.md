# #1474 staged continuation: Rust corrected, TS reference stack BLOCKED

Stop time: 2026-10-27 16:19 JST. The one isolated corrected C3 attempt passed
the production Rust assertions and then exhausted the TypeScript reference
call stack. The continuation's explicit resource-exhaustion stop condition
therefore applies again. No retry, remaining exploration or broad final gate
followed. This is an incomplete checkpoint, not merge-ready acceptance.

Base: `60f54f3ccec505821bc615e516bab8192bd20533`.
Previous checkpoint: `21466dc8358e79940442b9f0ab6a265c42cc48da`.
Branch: `sayosomi/issue-1474-dependency-topology-hunt`.
Exact final pushed HEAD is recorded in the Issue checkpoint.

## Admission and immutable evidence

Latest GitHub Project Context/router, unchanged routed D1 owners, current Issue
and independent review/safe continuation decision `6435758252`, and fresh Human
continuation admission `6435808249` were read. Immediate fetch/prune and bounded
volatile checks matched exact main/topic/local HEAD, clean tracked/untracked
state, registered implementation path and branch; no conflicting implementation,
audit or native E2E marker/process appeared. No new checkout, branch or legacy
metadata was created. Human's earlier new-task proof was not reused.

All 60 original fixture/report/evidence files from the previous checkpoint are
byte-identical (`preservation.json`). Original Base crash evidence and numerical
oracles were never overwritten. All new evidence is additive in continuation-1.

## First incorrect Rust owner and causal evidence

The canonical C2 lowering was inspected without evaluating C3: ordinary
`rustEligible=true`, 257 scalarProgram statements, no bindingVersions path.
The reversed declaration order puts Join84 first, whose initializer references
Left84, then Join83, and so on. C3 has the identical bounded-depth AST shape,
extended to 333 diamonds. Individual arithmetic ASTs are shallow; payload
decoding depth does not grow with the inter-binding chain. There are no lazy
activation guards in this fixture. Teardown follows evaluation and cannot
cause the original mid-request native stack abort.

`ScalarBindingResolver::resolve -> evaluate_typed_expression ->
ResolvingEnvironment::lookup_binding -> resolve` retained one native frame per
demanded binding, despite the AST evaluator's iterative work stack. `finalize`
uses this same resolver, so changing only finalization order would hide rather
than correct out-of-order demand. A safe eight-diamond validated-program unit
discriminator returned the correct integer 31 but measured native resolver
depth **17** on unchanged Base production logic with test-only depth counters.
Its assertion failed normally (exit101), without a process abort, geometry,
JSON decoding, graph activation or teardown. This localizes the chain-growth
mechanism to the existing Rust binding resolver. The saved Base C3 crash is
the destructive Base FAIL; it was not deliberately reproduced.

## Narrow correction and controls

Changed production owners:

- `rust-evaluator/src/evaluation/scalars/bindings.rs`: resolve only references
  actually demanded at runtime with a heap stack of initializer frames. Stable
  memoized results and cycle/missing diagnostics retain their existing owner.
  Transient geometry-unavailable results are shared only within the current
  resolve/state view, then discarded so later geometry progress can retry.
- `rust-evaluator/src/evaluation/scalars/expression_evaluator.rs`: retain the
  existing AST work/output stack while the resolver supplies a demanded binding.
  Environment-calling work items checkpoint at most one consumed output slot;
  they resume after the binding is ready. Nested local/match/record/map helpers
  retain their existing semantics. No dependency scan activates inactive arms.
  The supporting API is internal to the existing scalar evaluator ownership.
- `rust-evaluator/src/evaluation/scalars/bindings_tests.rs`: deterministic
  depth/memoization, chain, missing binding, inactive-cycle branch, cache-isolation
  and transient-unavailable/recovery regressions. Test-only counters count actual
  native resolve entries and initializer starts, not source-size proxies.

Eight-diamond corrected value remains 31, native depth is **2**, and all 25
bindings start once even after finalization/shared-prerequisite cache reads.
The constant two includes the lookup entry that defers immediately; Base's 17
is above that bound. The original instrumentation assertion expected one entry;
the corrected deterministic contract is <=2 native entries independent of chain
length, with exact numeric behavior unchanged. A 64-link chain and 32 nested
selected conditional dependencies also stay at <=2. Cycles in inactive branches
are not activated. Two failed geometry reads remain retryable; after geometry
appears the dependent scalar resolves to 17. An independent resolver for another
document returns 29 rather than the first document's cached 13.

Safe negative sensitivity: saved Base depth17 violates the final <=2 bound;
the numeric oracle and original C3 abort remain unchanged. There was no destructive
repair-removal replay or stack-size increase. A smallest source-backed reducer
and full final-gate acceptance remain incomplete; the eight-diamond Rust unit is
a focused mechanism discriminator, not a new compiler-accepted exploration unit.

## Staged verification, in order

All commands used the declared implementation checkout. The external watchdog
(`watchdog.py`) owns its process group only, checks wall/no-output deadlines and
aggregate RSS, and records exit/resource results. Rust stdio retains the existing
15s request/close deadline, child error/close listeners before transitions, and
explicit dispose/close wait. No C3 was run on Base or with a larger stack.

| Stage | Actual result |
| --- | --- |
| Base mechanism instrumentation compilation | Initial test typo `Subtract` exit101; corrected test used existing `Sub` |
| Safe Base eight-diamond depth discriminator | exit101 assertion; correct value31, measured depth17; no abort |
| Initial corrected bindings_tests | exit0, 8 PASS, depth2 |
| Added controls compilation | Test helper shadowing error exit101; corrected local construction, no production change |
| Corrected bindings_tests and added controls | exit0, 11 PASS |
| cargo test --manifest-path rust-evaluator/Cargo.toml evaluation::scalars:: -- --test-threads=1 | exit0, 268 PASS / 1 existing ignored |
| cargo check --manifest-path rust-evaluator/Cargo.toml | exit0 |
| cargo fmt --manifest-path rust-evaluator/Cargo.toml --check | exit0 |
| Filtered existing C2 production source/geometry check | exit0, 1 PASS / 15 intentionally unselected; one child/request |
| Single filtered corrected C3 attempt | exit1, TS RangeError after Rust oracle/sensitivity assertions; 15 intentionally unselected |
| Complete topology/performance suite | NOT_RUN: new stack-exhaustion stop |
| Consolidated final gate | NOT_RUN: staged safety did not complete |
| Final git diff --check Base | PASS exit0 |

The two TypeScript invocations used:

```sh
VITE_RUN_PERFORMANCE_GATES=1 NODE_OPTIONS=--max-old-space-size=2048 npx vitest run test/issue1474DependencyTopology.performance.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --bail=1 -t '\bC2\b'
VITE_RUN_PERFORMANCE_GATES=1 NODE_OPTIONS=--max-old-space-size=2048 npx vitest run test/issue1474DependencyTopology.performance.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --bail=1 -t '\bC3\b'
```

Each ran through the external 120s watchdog with an ISSUE1474_RECORD output path;
the command/result JSON files retain exact argv and resources. Each suite hook
explicitly built the corrected production `evaluation_stdio` with a 120s timeout
before spawning it. Candidate binary SHA-256:
`1b65fb95fb1ab75c53bf70f418ad5242c45447b4ae387c34f9c98dc0e8ba2204`.

## Corrected C3 and newly exposed stop

The original frozen C3 source/oracle SHA values and canonical V=1006/E=1670
were checked by the unchanged harness. One persistent disposable production
process made exactly one request. `evaluatePreparedRust` returned normally;
`actualValues`, `checkValues` (every expected scalar and point), and wrong-result
`sensitivity` completed before the next statement entered the TS reference path.
Thus Join332=1006, Result=(1006,-1006)mm and both unrelated controls passed for
Rust. No unexpected Rust diagnostics, abort or deadline occurred.

The following TS reference call then threw:

```text
RangeError: Maximum call stack size exceeded
evaluateBinary -> evaluateTypedExpressionNode -> evaluateTypedExpression
-> resolve (src/scalars/declarationEvaluator.ts:665)
-> lookupBinding (:574) -> evaluateReference -> evaluateTypedExpression...
```

This is a second path's resource-exhaustion failure, not a repaired TS finding.
No TS source was changed and no retry followed. The harness appends its PASS
observation only after both engines pass, so isolated-c3.json correctly contains
one request but an empty observations list. Rust PASS is established by the
unchanged executable statement order and the later TS stack trace, not a
fabricated PASS record or retained raw payload (none was archived for C3).

C3 test time528ms; command wall3.643s; sampled aggregate owned RSS903,584KiB.
Child sampled peak47,104KiB, worker max363,472KiB. All timeout/RSS watchdog
thresholds stayed untriggered; the caught TS native-call-stack limit was the
actual stop. Both the C2 and C3 owned children were disposed and close awaited;
post-stop inspection found no Vitest/evaluation_stdio/cargo-test process.

## Current matrix and remaining acceptance

All 16 primary / 24 source revisions remain independently sealed and legal.
Previously attempted 11 units/15 revisions are unchanged; C2 and C3 were required
reruns, not new units. No X/R source unit was added. The Rust unit regressions
are verification, not green exploration filler. Original X1-X8/R1-R8 remain
NOT_TRIGGERED. No exploration ceiling was exceeded.

| Units | Current disposition |
| --- | --- |
| A1-A4, B1-B4, C1 | Earlier Base semantic PASS, corrected reruns/performance pending: BLOCKED overall |
| C2 | Corrected Rust + TS semantic PASS; performance pending: BLOCKED overall |
| C3 | Original Rust abort -> corrected Rust numeric PASS; TS stack exhaustion: BLOCKED |
| C4, D1-D4 | No new runtime execution: BLOCKED |
| X1-X8, R1-R8 | NOT_TRIGGERED |

One Rust first-owner correction now has causal mechanism evidence, safe negative
sensitivity and corrected production C3 PASS. **Zero fully accepted/completed
repair families** until required final verification and remaining contract work
are complete. The TS reference recursion is an unresolved additional observation,
not an independently proven/repaired first-owner family.

No five-warmup/21-trial performance block, p50/p95/max, V+E-normalized stage
comparison or reliable child CPU attribution was performed. All remain
UNAVAILABLE. No optimization/performance-cliff claim is made from the abort or
the faster-looking corrected run. Historical #572/#1415/#1454/#1470/#1472 broad
controls, full Rust tests/clippy, build/lint/serial full npm/parity/binding-analysis
final commands remain NOT_RUN after this safety stop. The stage-specific
fmt/check/scalar tests above are not substituted for that consolidated gate.

Next safe action: independent exact-pushed-HEAD review and an explicit safe
continuation decision for the TS reference stack failure. Preserve the Rust fix
and all Base evidence. Remaining work includes source-backed reduction, any
authorized TS repair, staged C3 stabilization, C4/D runtime work, contaminated
matrix reruns, full performance protocol/controls and consolidated final gates.

No architecture/public API/dependency/language contract changed; no DSL reference
or architecture documentation update is triggered by this internal repair.
Manual GUI E2E remains Not Required for the planned host-neutral scope. No PR,
merge, Issue closure, roadmap write, main restoration or new checkout occurred.
Codex five-hour/weekly quota readings: UNAVAILABLE (none supplied by Human).
