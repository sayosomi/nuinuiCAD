# Issue #1421 — product repair checkpoint

This continuation starts at pushed harness checkpoint
`612cde2981a8bc99af14c624c96450eabb0876c8`, on the same branch and checkout.
The original product baseline remains
`bab8313ae08f5e354a6cfd9d7b2ffb8177a15bc2`.

Three baseline defect families were independently reproduced and fixed. This
count follows the distinct defective producers and isolated repair results; it
was not inferred from the three original observation labels. One required repair
follow-on was also fixed and adds zero baseline families. No adaptive discovery,
method selection, PR, merge, or Issue closure is part of this checkpoint.

## Reproductions, authority, and repairs

| Family | Independent reduction and passing contrast | First defective producer | Repair |
| --- | --- | --- | --- |
| Stage 4 F1 / P1 | Two asymmetric Module contexts, a geometry-valued conditional, and a separately guarded failing point reproduce the missing fault and leaked export/consumer. Removing the value conditional makes the contrast PASS. Single-instance reductions did not activate the failure. | `packages/nui-language/src/scalars/typedDependencyGraph.ts` omitted required conditional-owner prerequisites. Runtime lazy-branch activation could place a child before its statement condition, even though the later condition trace correctly reported true. | Add required ancestor-condition edges to the existing canonical graph. TS and Rust consume that same graph; no second scheduler or source reordering is introduced. |
| Stage 4 F2 / P2 | A root one-member `number[]`, an indexed coordinate value, and one drawable consumer suffice. A literal-coordinate contrast passes. Modules, aliases, and conditional collection sources are unnecessary for the failure. | `src/geometry/evaluate.ts` built an incomplete expression context for geometry values, omitting collection lookup callbacks. The compiler retains the index and Rust already evaluates the same wire correctly. | Reuse the existing complete typed-expression evaluation boundary, retaining the active geometry-value binding lookup. Numeric, boolean, choice, and match reads use the same context. |
| Stage 4 F3 / P3 | One disabled one-parameter Module followed by three scalar declarations causes a poisoned parameter's catalog rank to collide with another declaration's event order. Enabling the Module, or reducing the following declarations to two, passes. | `packages/nui-language/src/dsl/dslDocument.ts` did not pass Module event positions to binding-version lowering. A poisoned binding has no executable scalar initializer, so it fell back to catalog rank. | Expose and pass the existing per-binding event-position map from `moduleScalarRuntime.ts`. The parameter keeps event position 1, not catalog rank 3. Rust's strict wire validation remains unchanged. |

The normative nui1 contract establishes the expectations: statement `if`
conditions are typed booleans with lexical body ownership; value conditionals
and collections preserve selected dependencies and ordinary indexing; disabled
owners do not evaluate their body; and a failed Module does not expose partial
valid materialization. The tests retain exact coordinates, source/error owners,
disabled-export absence, complete snapshots, and normal host Rust eligibility.
No specification or expected pilot value was changed.

The three producers differ from Stage 3's frame lookup, lost geometry-collection
index, retired-frame capture, unexecuted loop ownership, generated export ID,
and version-completion repair follow-on. In particular, F2 reproduces without a
loop/frame, and F3 fixes source event projection rather than weakening Rust's
append/catalog validation.

## Required repair follow-on

After the producer fixes, E-A/B/C-01 T exposed an atomic-completion problem:
private alias programs could remain pending after a drawable child failed, and
the failed-instance fact was postponed with them. An external `UseFailed`
consumer could therefore survive even though the failed export itself was
eventually removed.

`P1-alias-completion` independently reduces this to a healthy Module, a failed
Module, private alias forwarding, and one healthy exported alias. Both TS and
Rust fail before the follow-on fix. Their existing Module completion owners now
publish failure immediately after a completed body failure, while preserving
ordinary private-value completion and atomic cleanup. The same source then
passes through the real persistent Rust boundary.

This observation arose after repairs and is retained as contamination/repair
follow-on R1, not a fourth baseline discovery. It is not added to method yield.

## FAIL-before / PASS-after evidence

- `repairs.ts` contains three hand-authored reproducer/control pairs and the
  alias-completion follow-on, with independent source-derived expectations.
- `repair-proof.json` retains exact source/hash/expectation, before/after actual
  results for both runtimes, normal eligibility, and useful producer evidence:
  missing control edges, the retained collection index, and catalog/event-order
  differences. Controls pass on the original product implementation.
- Repairs were applied separately: fixing F1 left F2/F3 failing; fixing F2 left
  F3 failing; fixing F3 made the six reduced tests pass. R1 was then reproduced
  and fixed separately.
- `pilot-results.json`, `pilot.json`, `model.ts`, and `oracles.ts` are byte-for-byte
  unchanged from the harness checkpoint. The historical report and failed
  comparable pilot remain available and are not replaced by post-repair data.
- Frozen pilot hash remains
  `008a55cfd0732f03ce8d891623b1421a80ca8554bff3b58bdc220073611db7b1`.
- Final Stage 4 verification: all **18 pilot cells / 36 sources PASS**, plus all
  **7 reduced regressions/controls PASS**; **26/26 tests PASS** including the
  freeze/oracle consistency check. Every request uses the ordinary production
  eligibility and persistent stdio path.

## Exploration accounting and verification

`repair-exploration.json` attributes every newly accepted reduction/control to
its originating method and stratum, retaining unsuccessful reductions as
non-activated contrasts. There were 13 distinct new accepted texts, zero
compiler rejections, and no adaptive cells. The global accepted ledger is now
**61 / 200**: the previous 48 plus those 13. Exact reruns and existing mandatory
regressions add no novel capacity.

Completed gates:

- Focused #1412/#1415/#1417/#1419, Module lowering, condition, and geometry
  regressions: **2,210 tests PASS across 9 files**, including existing Stage 3
  calibration.
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm run test:parity`: **203/203 PASS**.
- Rust fmt/check and focused Module tests: PASS.
- Rust full tests: **619 PASS**, 9 ignored; clippy all targets with warnings
  denied: PASS.
- DSL reference consistency: PASS. No new syntax or semantics/documentation
  contract was introduced.
- Full serial `npm test`: **10,330 PASS**, 157 skipped; **664 files PASS**,
  2 skipped. Duration 521.53 seconds.
- `git diff --check`: PASS.

No new architectural abstraction is introduced. The compiler's dependency graph
and event projection, existing TS expression context, Rust evaluator, and shared
production stdio client are reused. Subsystem ownership and architectural data
flow do not change, so no architecture document update is needed.

Raw logs and requests are outside the checkout under
`/tmp/issue1421-product-*` and `/tmp/issue1421-*.log`. Test runs retain measured
request counts and durations; complete generation/diagnosis/editing effort and
agent token usage are unavailable. Passing-case counts or differing probe
durations are not a claim that one discovery method is optimal.

## Review boundary

Stop at the normally pushed clean repair checkpoint for independent review.
All currently observed product failures in this phase are resolved. Full
Issue #1421 completion still requires its separately authorized sensitivity,
adaptive-selection/exploration, method-comparison, review, and integration work.
No adaptive operating policy or method winner is selected here. No platform
operation was blocked or bypassed. No Human Manual E2E is required by the
compiler/evaluator-only contract.
