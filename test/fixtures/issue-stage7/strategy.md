# Stage 7 checkpoint — BLOCKED, acceptance incomplete

[Issue #1428](https://github.com/sayosomi/nuinuiCAD/issues/1428), base
`e08ff62174bc461661693173a27108f71c14de35`, branch
`sayosomi/issue-1428-targeted-stage7`. This is a stopped D1 implementation
checkpoint, **not a completed campaign or merge candidate**. No product code,
normative specification, historical fixture, dependency or CI input changed.
Confirmed novel families: **0**; fixed families: **0**. This does not mean that
no defects exist: failures remain unclassified and no independent reduction,
genuine passing adjacent control or first-incorrect-producer proof was completed.

## Mandatory resource stop

At 2026-10-19 23:28 JST the normally eligible **H2-00** request terminated the
real persistent `evaluation_stdio` process with **SIGABRT**, stderr:
`thread 'main' ... has overflowed its stack; fatal runtime error: stack overflow, aborting`.
Its TypeScript reference evaluation also threw
`RangeError: Maximum call stack size exceeded`.
The Issue requires a safe stop on actual resource failure. No evaluator request,
product repair, reducer or sensitivity injection was run after recognizing this
hard stop. All owned processes have ended.

The first harness pass failed to retain per-cell rows when TS threw or normal
eligibility was false. Its exact outputs remain external. A second, unchanged
product-tree attempt caught TS errors and honored normal eligibility; that
attempt exposed the native abort. Vitest then attempted 13 calls against the
already unavailable process; these are **not** native executions. The checkpoint
harness now records inputs before dispatch, preserves exceptions and stops all
subsequent cells after native failure. This guard was statically checked; it
was **not** exercised by another native crash after the stop.

## Frozen matrix and oracle

`freeze.json` retains all 20 accepted sources, their SHA-256 hashes, stable IDs,
seeds, independent expectations, order, base, timestamp and initial product-owner
fingerprint. It was written only after compiler-only acceptance of every source,
before the first primary evaluator test. There is no final corrected corpus.

Seed = `9000 + offset + cell`; H1/H2 offsets = 0/100. Cell indexes 00..07.
H1 bits: 4=path (otherwise line), 2=Module (otherwise root), 1=two inner
iterations (otherwise zero). Outer loop always has two iterations.
H2 bits: 4=line (otherwise point), 2=exhaustive match (otherwise if),
1=ancestor gate (otherwise direct gate). Each source has distinct One/Two
inputs, a dormant invalid-input instance, one selected failure, one success,
an unselected error and an independent survivor. Each hypothesis has two
adjacent controls using cell-00 numeric inputs, distinct hashes and the two
element types. Controls are **candidate controls**, not established passing
controls; their current outputs also fail.

Order starts H1-03, H1-07, H2-00, H2-07, followed by the other 16 sources.
The first four were scheduled in that order, but initial observer exceptions
prevented complete execution; do not claim that the ordered baseline finished.
`checkpoint.json` gives an explicit BLOCKED_UNRESOLVED disposition for every
source (20 unresolved; zero completed semantic PASS dispositions).

The normative oracle is `docs/nui1/spec.md`: shared incoming snapshots,
inner final escape, ordered geometry arrays, immutable stage selection,
lexical/private/export identity, lazy selection, enabled-before-input and
atomic Module failure. Oracles consume only authored inputs, never observations.
For H1, each inner step moves previous member 1 to slot 0 and rebuilds slot 1
from previous member 0's end and authored tick coordinates. The independently
unrolled final active pair has ends `(u+27,22)` and `(u+30,27)`; zero-inner
sources preserve the initial staged pair. Both member endpoints, whole geometry,
length, generated occurrences and qualified Module export are specified.
Module path reconstruction uses a constant middle ordinate to stay within
accepted syntax. Indexed endpoints are observed through legal typed aliases.
For H2, one swap makes member order [1,0]; expected geometry includes only
successful Module children/consumer plus the independent survivor. The selected
collection is Chosen; causal private-value diagnostic ownership and propagation
still need first-producer analysis. The frozen `diagnostic.owner` names the
selected collection and must not be mistaken for a proven private error-row ID.

Compiler-only rejected prototypes are indexed by hash/code in `rejections.json`.
They include invalid direct array constructor/member forms, arithmetic without
reference delimiters, and endpoint/property forms that the compiler rejected.
Rejection is neither a runtime PASS nor proof of a novel defect. No compiler
change was made to admit a source. 100 prevalidation compiler calls produced
20 distinct accepted hashes and 43 distinct rejected hashes; repeated attempts
are not distinct accepted exploration. All accepted hashes equal the frozen set.

## Observations and limits

- H1 line sources: both evaluators return only seed drawables and omit expected
  carry observers/results. The stored input lacks executable indexed-alias
  geometry value programs. This is an unresolved lowering hypothesis.
- H1 path sources: TS output mismatches; normal Rust eligibility is false.
  Stored materialized-point source targets retain geometryType=path with
  pointKey=start/end, while the eligibility predicate requires geometryType=point.
  No eligibility override, forced Rust input or fallback parity claim was made.
- H2 line sources: TS/Rust output mismatches, including successful-instance
  loss and Rust Prefix leakage. They are potentially downstream symptoms;
  no independent family count is assigned.
- H2 point sources: TS recursive stack exceptions; H2-00 additionally aborts the
  native evaluator. Other point sources have no completed native result.

Two observer errors are retained separately: dormant instances retain canonical
carry plans (three plans, not two active plans), and indexed targets can appear
inside value programs rather than only drawable input maps. An ineligible
prepared input can omit bindingVersions. These instrumentation errors are not
product defects. Raw reprojection should precede any costly identical rerun.

H1/H2 first-loss sensitivity: **NOT_COVERED**, resource stop before calibration.
No mutation was injected, no historical repair was counted as new, no required
historical regression was rerun. Original failures and final results are not
conflated: final corrected results are **NOT_RUN**.

## Replay and verification

Safe compiler-only replay from the implementation checkout:

```sh
ISSUE1428_MODE=prevalidate ISSUE1428_EVIDENCE=/tmp/nuinui-stage7-prevalidation \
  npx vitest run test/issue1428TargetedStage7Rust.integration.test.ts
```

After an independently reviewed recovery contract and fresh same-Task D1
continuation admission, the existing frozen source can be selected with
`ISSUE1428_IDS=H2-00`. Runtime replay uses `ISSUE1428_MODE=baseline` with a fresh
external evidence directory; the default `verify` is strict. **Do not run native
replays or the full suite under this stopped admission.** `freeze` refuses to
overwrite the original corpus. Required complete ordered baseline, independent
reduction/control, repair, affected-cell retest and sensitivity gates remain.

The original external evidence directories are `/tmp/nuinui-stage7-1428` and
`/tmp/nuinui-stage7-1428-complete`; `evidence-index.json` records hashes of the
retained raw payloads, logs and reports. Raw traces stay outside the checkout.
Temporary retention is not an archival guarantee. The frozen inputs are portable.
The original harness did not persist the exact H2-00 native wire before abort;
its exact source, product fingerprint and native stderr survive. Do not claim
that an independently reproduced or minimized crash request was retained.
Lifecycle safeguards reuse Stage 6: build 120 seconds, request 20 seconds,
process ten minutes, teardown five seconds, listeners before transitions.

Compiler prevalidation: PASS 20/20. Original baseline invocation: FAIL, 10/21
test cases failed (plus semantic failures captured in other cases). Resource
attempt: FAIL, 14/21 cases failed and the Rust child aborted. A baseline runner
exit or a capture-only test-case PASS never establishes semantic acceptance.
Scoped ESLint and final repository lint: see `verification.json`. `git diff --check`
and diff review cover the stopped checkpoint. The exact final focused test,
build, parity, full npm test, DSL reference check and Stage 3–6/#1358–#1360 gates
are NOT_RUN after the stop; final implementation never stabilized. Rust
fmt/check/test/clippy condition is NOT_APPLICABLE: no Rust source changed.
Human Manual E2E: Not Required.

## Counts, quota and next action

Exploratory accepted texts **20/56**; rejected distinct hashes **43**;
compiler calls **160** (including 20 final compiler-only checkpoint calls); TS attempts **35**; production wrapper calls **25**,
of which actual native requests **12** (11 completed, one aborted) and
post-abort unavailable calls **13**. No adaptive text/reducer was generated.
Request/source counts are not quota measurements. Human before/after weekly
and five-hour quota, reset identities, precision and overlap observations are
**UNAVAILABLE**; no attributable efficiency ratio or Stage 6 ranking is claimed.

Independent review must inspect the exact pushed checkpoint, especially H2-00
and the fail-stop evidence. The next concrete hypothesis is that loop-local
indexed geometry aliases retained in Swap are evaluated against the escaped
Carried collection, causing recursive whole-collection materialization instead
of reading the incoming snapshot. This is a hypothesis, **not** a demonstrated
first incorrect producer or a confirmed novel family. Review should settle a
bounded recovery procedure before a new same-Task continuation admission.
The rest of the frozen matrix and Issue #1260 remain open; no PR, merge,
Issue closure, architecture change or unrelated cleanup is part of this stop.
