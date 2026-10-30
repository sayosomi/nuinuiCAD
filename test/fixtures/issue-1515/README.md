# Issue #1515 — BLOCKED investigation checkpoint

This is an incomplete D1 investigation and a retained failed check, **not** a
completed performance matrix, a confirmed product defect, or review PASS.

- Base: `7fe9b0d3a39131c5bf39ea0e13e87d26caf52e28`.
- Branch: `sayosomi/issue-1515-incremental-pattern-evaluation-perf`.
- Registered implementation checkout: `/Users/yosomi/Code/nuinuiCAD`.
- Startup volatile check: PASS at **2026-10-31 08:14:47 JST**, following
  `git fetch origin --prune`; clean main at the exact admitted SHA, unused
  local/remote topic, no conflicting workload or active ownership/E2E marker.
- Tier: no upper-tier authority inferred; strict Issue writable boundaries used.
- Exact pushed checkpoint and Draft PR are reported in the executor's final
  handoff. This file does not invent its own containing commit hash.

## Precise blocker

I froze a `0.02 mm` absolute tolerance for Bezier length before execution.
The independent mathematical length is correct, but that tolerance is an
executor-selected precision requirement that the current normative language
contract does not establish. The existing production evaluator approximates
this length with 32 uniform parameter intervals. It fails the frozen assertion:

| Same frozen `ControlCurve` | Length, mm |
| --- | ---: |
| Elementary composite Simpson integral (8,192 intervals) | 47.58444656596879 |
| Independent De Casteljau lower bound (depth 12) | 47.5844452588656 |
| Independent De Casteljau upper bound (depth 12) | 47.58444787307181 |
| Actual persistent production Rust | 47.56302173814437 |
| Elementary 32-chord sum, calculated after failure | 47.56302173814437 |
| Absolute difference from frozen oracle | 0.021424827824418458 |

The cubic has controls `(0,20), (0,32), (40,32), (40,20)`. Its actual segment
controls match the oracle before the length assertion fails. The post-failure
chord sum characterizes the existing approximation; it is **not** a replacement
oracle or a relaxed assertion. Independent subdivision bounds also bracket the
original integral. See [length-classification.json](verification/length-classification.json).

Production provenance: `rust-evaluator/src/evaluation/bezier_evaluator.rs`
uses `BEZIER_LENGTH_STEPS = 32` and calls `approximate_segment_length` in
`bezier_path.rs`. The TypeScript reference's `evaluateGeometryPrimitives.ts`
also uses 32 steps. Normative `docs/nui1/spec.md` exposes computed lengths
but does not prescribe this absolute approximation error. Agreement on a
32-chord sum does not independently establish adequate mathematical accuracy.

Consequently this is an **unsettled oracle/precision contract**, not proof of a
new implementation defect or an avoidable-work producer. No production repair
is justified by the evidence. Loosening the failed check, replacing it with a
32-chord expected value, or changing the length algorithm to satisfy an
unsupported precision requirement would violate this Task's evidence/semantic
boundary. The original assertion is retained and still fails.

The next owner must settle the admissible Bezier measurement oracle/precision
for this investigation and authorize any necessary resealing before execution
resumes. A production accuracy change would additionally need its own causal,
semantic, owner and regression review; this checkpoint does not authorize one.

## Frozen units and dispositions

`freeze.py` performed only elementary Python arithmetic and file writes, before
any compiler or evaluator invocation. All 27 literal revision sources and
per-source SHA-256 values are retained. `manifest.json.gz` is a lossless gzip of
the original JSON; its decoded SHA-256 is
`10cb0193c09a2da0f2e322fdcf8b65f78e320ff6219d243fad5598ed611a5f6a`.
Source bytes, expected values and tolerances were not revised after failure.

The workload is eight independent root drawables plus 3/15/63 Module instances
of eight drawables each: coordinate/offset points, segment, curved cubic,
measured straight seam offset and notch. Runtime drawables are 32/128/512;
Module containers and source-only scalar declarations are counted separately.
Runtime drawable counts do not assert Canvas visibility or editability.

| Primary | Initial fresh/incremental compile and materialized count | Initial Rust | Ordered edits | Final disposition |
| --- | --- | --- | --- | --- |
| S-P | PASS, 32 drawables / 3 instances | length assertion FAIL | not reached | BLOCKED |
| S-M | PASS, 32 / 3 | same FAIL | not reached | BLOCKED |
| S-C | PASS, 32 / 3 | same FAIL | not reached | BLOCKED |
| S-R | PASS, 32 / 3 | same FAIL | not reached | BLOCKED |
| M-P | PASS, 128 / 15 | same FAIL | not reached | BLOCKED |
| M-M | PASS, 128 / 15 | same FAIL | not reached | BLOCKED |
| M-C | PASS, 128 / 15 | same FAIL | not reached | BLOCKED |
| M-R | PASS, 128 / 15 | same FAIL | not reached | BLOCKED |
| L-P | PASS, 512 / 63 | same FAIL | not reached | BLOCKED |
| L-M | PASS, 512 / 63 | same FAIL | not reached | BLOCKED |
| L-C | PASS, 512 / 63 | same FAIL | not reached | BLOCKED |
| L-R | PASS, 512 / 63 | same FAIL | not reached | BLOCKED |

12 distinct units accepted / 20 maximum. X1–X4 and R1–R4 remain unused;
there are no new adjacent or minimized-reproducer sequences. The S-P replay is
the identical initial source, solely to retain its raw request and response.
It is not another exploratory unit. No full primary sequence completed.
Machine-readable dispositions: [matrix-dispositions.json](matrix-dispositions.json).

The first bounded focused invocation attempted all 12 tests. Each failed at
the same initial-revision assertion before ordered edits, secondary reference
evaluation, or later geometry/scalar assertions. This invocation completed
before the executor read the failures; no further primary exploration followed
the ambiguity diagnosis. The raw S-P payload is complete but must not be
misrepresented as a full geometry oracle PASS.

## Retained execution and verification

- `verification/initial-focused.log.gz` and `.result.json`: all 12 tests FAIL;
  subprocess exit 1, bounded to 300 seconds. The recorded whole harness elapsed
  time is not a performance sample or an edit-to-result metric.
- `verification/base-S-P-retention.log.gz`, `.result.json`, and
  `base-S-P-observation.json.gz`: one unchanged evidence-retention replay FAIL;
  11 other tests not selected. Same assertion and tolerance, no `.skip`, waiver
  or retry-until-green. It retains the exact input/payload, runtime/source owner
  identities, source and compiled revisions, binary path and SHA-256.
- Both invocations use the ordinary `RustEvaluationProcess` and normal
  `cargo build --bin evaluation_stdio` output, with one persistent process per
  invocation. Error/close listeners precede requests/disposal; requests and
  teardown are bounded to 15 seconds. The normal Cargo build succeeded.
- `verification/lint.log.gz` and `.result.json`: `npm run lint` PASS.
- The first staged whitespace check rejected trailing blank lines in the raw
  logs. They were losslessly gzipped (decoded hashes in `archive-index.json`),
  preserving all original output bytes; no check was weakened.
- Staged `git diff --cached --check` and change review are performed before
  commit; final result is included in the executor handoff.

No executable production repair occurred. Full JavaScript, build, parity,
Rust fmt/check/test/clippy, DSL reference and historical #1493/#1474/#1476/#1503
reruns were **not reached** after the semantic stop; they are not claimed PASS.
The broad repair gates are conditional on a repair/shared production change.
Existing historical controls and their repairs remain byte-for-byte untouched.

Stage instrumentation, five warm-ups/21 measured trials, p50/p95/max,
deterministic work counters, overhead controls and before/after measurements
were **not run**. They depend on a settled semantic oracle. No causal repair,
Base defect claim, repair-removal or restoration claim is made. Those proof
steps are not applicable to this blocked, zero-repair checkpoint.

## Scope and residuals

Only Task fixtures, evidence and focused test consumers were added. No product
source/configuration, dependencies, DSL/spec, architecture, historical control,
host, Human-test checkout or second worktree was modified. No GUI/headless GUI
operation occurred; no Canvas/frame/GUI performance or dogfood readiness claim
is made. The intentional failed test makes this Draft PR unsuitable for merge.

The test code after the first failed assertion is prepared but unverified.
Independent exact-pushed-HEAD review, oracle resolution and the entire ordered
matrix/performance/conditional repair verification remain outstanding. Do not
merge, close #1515 or self-certify independent blocking review from this report.
