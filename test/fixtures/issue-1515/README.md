# Issue #1515 — v2 matrix and Base performance evidence

The Bezier oracle blocker is resolved. All 12 primary edit sequences and the
R1/X1 controls pass the adjudicated semantic oracle. All 36 primary comparable
measurement blocks completed. **Implementation remains BLOCKED** before a
confirmed scope-partition producer can be repaired: the first owner is outside
the Issue's strict writable list, and explicit expansion has been requested but
not received. This is not independent review PASS or Issue completion.

- Production Base: `7fe9b0d3a39131c5bf39ea0e13e87d26caf52e28`.
- Continuation checkpoint: `3eff02ab819065fba914c2cea07d42263278ba37`.
- Branch: `sayosomi/issue-1515-incremental-pattern-evaluation-perf`.
- Continuation volatile check: PASS, **2026-10-31 08:44:59 JST**: fetched
  origin/main and topic exact; clean registered implementation checkout; no
  conflicting workload or active ownership/E2E marker; current Human admission.
- Draft PR: https://github.com/sayosomi/nuinuiCAD/pull/1516.
- The final exact pushed HEAD is recorded in the PR/executor handoff, without
  inventing this document's containing commit hash.

## Oracle versions and source identity

The [oracle-resolution decision](https://github.com/sayosomi/nuinuiCAD/issues/1515#issuecomment-6535672873)
owns acceptance v2. `seal-v2.py` independently evaluates the analytically fixed
cubic polynomial at i/32 and sums 32 Euclidean chords, before product execution.
Bezier control coordinates retain 1e-6 mm tolerance. Both drawable length and
the same geometry's scalar length use the independently computed discrete
value with **1e-6 mm** tolerance. Exact straight/seam geometry and all identity,
diagnostic and revision requirements are preserved. Every Module-local seam
and curve scalar is checked through the canonical public binding-identity API.

`acceptance-v2.json.gz` decoded SHA-256:
`fdf511c4489d2f8768a3b1423706f932158e14a991b1e1743f12f329829bcd1e`.
The continuous integral and its independent bounds remain separate, non-gating
accuracy observations in `accuracy-v2.json.gz`. No production Bezier algorithm
or user-facing accuracy policy changed.

The original 27 literal revision sources, source hashes, original manifest,
freeze generator, all 12 FAIL logs and original blocked dispositions remain
unaltered. Exact original helper/test assertions and the original report are
losslessly archived under `original-v1/` and hash-indexed against the admitted
checkpoint. Original accuracy-assumption failures are never represented as PASS.

The authored primary sources each have 16 drawable declarations (eight root,
eight in the Module definition), plus 3/15/63 authored instance declarations.
They produce 32/128/512 runtime drawables and 3/15/63 separate runtime containers,
35/143/575 runtime entries total. Runtime counts do not imply editability or
Canvas visibility.

## Full primary and conditional dispositions

Each primary checks initial and edited incremental compilation against fresh
compilation, ordinary persistent production Rust and secondary TS reference,
with independent numeric/control-point/scalar/origin expectations. P changes
the shared dimension; M changes only I0's argument; C preserves all geometry,
typed dependencies and provenance across a comment change; R retains fatal
current diagnostics/last-good separation and restores source revision 3 with
new current geometry and stable source/runtime identity. Invalid revisions
make no Rust request and are never published as valid current geometry.

All 12 sequences PASS. Each has 5 warm-ups and 21 measured trials in **three**
separate same-machine blocks: normal production client/core, memory-instrumented
JS stages, and normal client with a separately built passively timed Rust core.
The table is normal warm edit-to-ready wall time, in milliseconds; R rows show
recovery, with the invalid diagnostic-only phase retained separately in JSON.
Rust p50 comes from the independent Rust timer block, so it is not a subtractive
component of the normal block's median.

| Case | Semantics | Normal p50 | Normal p95 | Normal max | Rust evaluation p50 |
| --- | --- | ---: | ---: | ---: | ---: |
| S-P | PASS | 26.031 | 27.213 | 30.815 | 13.194 |
| S-M | PASS | 26.564 | 28.764 | 30.726 | 13.413 |
| S-C | PASS | 26.179 | 27.440 | 30.172 | 13.600 |
| S-R | PASS | 26.488 | 27.815 | 27.859 | 13.175 |
| M-P | PASS | 163.546 | 167.127 | 167.294 | 136.118 |
| M-M | PASS | 154.594 | 157.212 | 157.413 | 108.500 |
| M-C | PASS | 154.896 | 161.441 | 164.932 | 108.522 |
| M-R | PASS | 154.756 | 156.396 | 159.173 | 108.549 |
| L-P | PASS | 1556.222 | 1567.364 | 1568.571 | 1335.181 |
| L-M | PASS | 1563.766 | 1595.737 | 1605.737 | 1337.866 |
| L-C | PASS | 1559.565 | 1570.307 | 1582.435 | 1337.260 |
| L-R | PASS | 1560.175 | 1574.747 | 1577.293 | 1332.125 |

- **R1:** presealed minimal two-point/one-instance legal reducer, including an
  independent unaffected root point. Both revisions × fresh/incremental ×
  TS/persistent Rust PASS; repeated scope filtering is 12 visits versus six
  output-sized visits. `conditional-v2.json.gz` and its seal retain its source,
  elementary point/origin oracles and motivation.
- **X1:** presealed nearby one-scope control retaining the same root pattern and
  legal unused Module definition, with no instances. Its comment sequence PASS;
  two filters visit 16 entries, exactly the two-partition output size (PASS).
  `adjacent-v2.json.gz` and its seal retain all bytes/oracles.
- **14/20 distinct units consumed.** X2–X4 and R2–R4 unused, no budget transfer.
  Reruns, probes and unchanged historical verification fixtures are not new units.

[Machine-readable summary](summary-v2.json.gz) retains full p50/p95/max, every
stage's wall/Node CPU statistics, work sizes, overhead ratios and dispositions.
All 5+21 raw records per comparable block are in `measurements-v2/`. Seals and
literal files retain all 31 revision hashes. `summarize-v2.py` independently
checks sample counts/percentiles, source hashes, all semantic outcomes and exact
predicted scope-filter visits before emitting the report.

## Stage growth and independently confirmed producer

Representative P stage medians (instrumented block), milliseconds. Stages are
**nested/inclusive, not additive**; Node process CPU and all other cases'
statistics are retained alongside these wall observations.

| Stage / deterministic size | S | M | L |
| --- | ---: | ---: | ---: |
| Parse | 0.416 | 0.631 | 0.925 |
| Reconcile | 0.049 | 0.069 | 0.095 |
| Whole semantic compile | 4.375 | 17.636 | 101.283 |
| Module materialization | 0.069 | 0.284 | 0.865 |
| Materialized execution compiler | 0.454 | 2.361 | 14.727 |
| Module scalar lowering | 0.696 | 4.743 | 45.290 |
| Dependency graph building | 1.142 | 6.065 | 31.809 |
| Production context lowering | 0.048 | 0.118 | 0.285 |
| Rust request lowering | 0.100 | 0.278 | 0.760 |
| Actual frame serialization | 0.345 | 1.425 | 4.893 |
| Actual response JSON parsing | 0.251 | 1.005 | 3.466 |
| Source statements | 27 | 39 | 87 |
| Runtime entries | 35 | 143 | 575 |
| Canonical graph edges | 154 | 658 | 2674 |
| Input JSON bytes (excluding envelope) | 133834 | 599945 | 2461616 |

First unnecessarily repeated owner:
`packages/nui-language/src/dsl/moduleExecutionCompiler.ts`, original lines
145/177. For both preliminary and final scope maps it filters every runtime
element for every scope. Existing compiler-owned scope keys already determine
mutually exclusive membership and stable within-scope order; each state can be
partitioned in one ordered pass. No cache, new namespace owner or scheduler is
needed. Exact Base owner bytes/hash and stack/work traces are retained.

| Unit | Scopes | Entries | Actual filter visits | Two ordered partition output visits |
| --- | ---: | ---: | ---: | ---: |
| S (all edit classes) | 4 | 35 | 280 | 70 |
| M (all edit classes) | 16 | 143 | 4576 | 286 |
| L (all edit classes) | 64 | 575 | 73600 | 1150 |
| R1 | 2 | 3 | 12 | 6 |
| X1 | 1 | 8 | 16 | 16 |

These are exactly `2 * scopes * entries`, with source-line traces for every
valid edited/recovered primary. The unchanged two-partition baseline `2 * entries`
was sealed before observation. It demonstrates avoidable unrelated-scope work;
timing growth alone does not. Fatal invalid revisions do not reach this owner.

**Repair boundary:** the Issue's lower-tier rule says “STOP/escalate before
writing another production owner”; upper-tier authority was not inferred. This
file is not named in its strict writable list. A minimal correction using the
existing keys has been described, but no production correction, repair-removal,
restoration or repaired before/after measurements have been performed. Explicit
scope expansion remains pending. No other defect is claimed from timing alone;
large Rust/scalar-lowering costs remain unadjudicated causal follow-up inside
the bounded mission.

The new whole-owner callback test also contains an independently identified
**harness mistake**: its presealed four-pass bound omitted the already existing
selected-ID output projection at original line 231. Its four actual failures
are retained unchanged (385/5005/75325/21 visits). The scope-filter counts above
and their two-partition baseline are unaffected. A separately versioned five-pass
whole-owner counter oracle, retaining the failed four-pass test/evidence, was
included in the explicit authorization request. No threshold has been silently
widened and that experimental check is not claimed as a valid repaired gate.

## Verification and measurement limits

- Primary v2 functional suite: **12/12 PASS**; R1 and X1 separately PASS through
  the same incremental/fresh/reference/persistent-Rust test. The final combined
  suite is **14/14 PASS**, recorded in `verification-v2/final-all-fourteen.result.json`.
- Historical #1474 C3 safety control: **1 PASS**; source-backed B2/B3: **2 PASS**.
- #1493 Module/reconciler, #1476 graph/text, #1503 revision/recovery and persistent
  process lifecycle controls: **six files / 92 tests PASS**.
- New experimental whole-owner work test: **four FAIL**, with the counter-oracle
  mistake and independently proven producer distinguished above; no waiver.
- Initial lint FAIL on a redundant benchmark variable initialization; corrected
  without changing execution semantics. Subsequent and final exact-source lint PASS; all logs retained.
- The v2 first functional attempt FAIL on reading `ScalarEvaluation` as a number;
  the adapter now requires successful numeric evaluation and extracts its value.
  No expected scalar or source/oracle byte was changed. The corrected full suite
  and independent scalar checks PASS.
- Rust-timer metadata correction clears a resolved cold-start promise. Only the
  first intentionally invalid warm-up could inherit that annotation; all 21
  measured statistics were unaffected. Original data remain central. Corrected
  R replays are supplementary; one overlapped lint and is explicitly labelled.
- Initial S-P smoke measured samples remain in its raw log; its warm-up records
  were superseded by the final block. Every comparable block retains all 26
  records. Setup/cold observations include baseline compile and are excluded
  from warm edit statistics.

The real production process/JSON protocol is used throughout. JS stage calls are
inserted only in memory while bundling, with exact executed bundles/source maps
losslessly archived under `verification-v2/measurement-build/`. Array work probes
are separate diagnostic runs, never benchmark timings. A single passive
`Instant` timer around actual Rust `evaluate_document` was built to an external
Task-owned target; the production stdio source was restored to exact Base bytes
in `finally`. The ordinary binary is separately hashed. Each invocation uses
one persistent child, preinstalled stream/error/close listeners and 15-second
request/teardown deadlines; outer subprocess groups are bounded and Task-owned.

Instrumentation ratios are retained, including nonuniform observations (for
M-P, staged/normal p50 is 1.095 and Rust-probe/normal is 1.180). No millisecond
PASS threshold, dedicated-CPU claim or subtraction of independent medians is
used. These are CLI/debug-Rust observations, not VS Code/Canvas/monitor latency.

There is no lasting production source/configuration/dependency change, no
architecture/DSL policy change, no Human-test checkout operation, no second
worktree and no GUI/headless GUI operation. Original #1493/#1474/#1476/#1503
repairs are unchanged. Build/full JavaScript/parity/Rust full-core/clippy/DSL
repair gates are not claimed PASS: no production repair occurred and their
repair/shared-infrastructure trigger has not been reached. Relevant focused
production and historical controls ran instead. No Human GUI validation or
global responsiveness/dogfood readiness is claimed.

Next: resolve the explicit first-owner/counter-oracle authorization, apply and
causally verify the minimal repair if authorized, then perform the required
repair gates and independent exact-pushed-HEAD review. Do not merge, close the
Issue, self-approve independent review, or treat this checkpoint as completion.
