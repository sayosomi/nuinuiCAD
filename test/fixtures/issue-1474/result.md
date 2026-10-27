# #1474 BLOCKED checkpoint

Execution stopped at 2026-10-27 15:44 JST after the real production Rust process
aborted with stack overflow on C3. This is the Issue's explicit resource
exhaustion stop condition. No restart, reducer, new exploration or production
repair followed. This checkpoint is incomplete and is not a merge-ready result.

Base: `60f54f3ccec505821bc615e516bab8192bd20533`.
Branch: `sayosomi/issue-1474-dependency-topology-hunt`.
Final pushed HEAD is recorded in the Issue checkpoint (avoids a self-referential
commit hash here). No production implementation file differs from Base.

## Admission and seals

Latest GitHub Project Context and routed D1 owners, Issue body/material admission
comment and current product owners were read. The bounded mutation-boundary
fetch found origin/main and clean local main/HEAD exactly at Base, the precise
topic unused locally/remotely, no live ownership/E2E markers or competing
processes, and no superseding admission. Latest #1472 checkout closure and
neighboring completed implementation/E2E evidence were read. Only the approved
branch was created; no worktree or legacy metadata was changed.

`6f1bc727` sealed all sources/hashes/independent integer and mm oracles before
product evaluation. `37f3876f` sealed successful canonical compiler acceptance,
24 revisions and canonical graph metrics before the first discovery request.
The legality preflight is setup, not a performance measurement. The initial
preflight helper passed language version 0 to regenerateCanonicalFromModel and
failed before any fixture compiled; it was corrected to version 1. The initial
runtime comparison adapter read `type` instead of runtime `kind`; its failed
test output remains in evidence/adapter-error.log.gz. Neither harness error is a
product finding, and neither source nor numeric expectation was replaced.

## Exact dispositions

| Units | Semantic result | Performance / overall disposition |
| --- | --- | --- |
| A1, A2, A3, A4 | BASE_PASS, including edit/restoration, all scalar values and geometry | BLOCKED: performance protocol not executed |
| B1, B2, B3, B4 | BASE_PASS, including shared-root edit/restoration and every endpoint | BLOCKED: performance protocol not executed |
| C1, C2 | BASE_PASS, every diamond intermediate and sink | BLOCKED: performance protocol not executed |
| C3 | BLOCKED: Rust stack exhaustion/abort, no result | BLOCKED: safety stop |
| C4 | BLOCKED: compiler-accepted, runtime permutation/restoration not executed | BLOCKED |
| D1, D2, D3, D4 | BLOCKED: compiler-accepted, no runtime evaluation | BLOCKED |
| X1–X8, R1–R8 | NOT_TRIGGERED: safety stop preceded conditional execution | NOT_TRIGGERED |

All 16 predeclared primary units / 24 source revisions are compiler-accepted and
sealed. Runtime discovery attempted 11 distinct units / 15 revisions: 14
revision checkpoints passed in 10 units; the fifteenth request (C3) aborted.
No X/R accepted; 11 runtime exploration units used, 16 source-valid units sealed,
both below the 32-unit ceiling. No claim that legality alone completes a cell.
No performance or final acceptance cell is complete.

## Failure, adjacent PASS and independent controls

C3 is 333 chained scalar diamonds, 1003 semantic declarations / 1666 named
edges; canonical V=1006 / E=1670, 1001 scalar outputs and two drawable points.
The independent recurrence is a=p+1, b=p+2, c=a+b-p=p+3, Root=7; final
Join332=1006 and Result=(1006,-1006)mm. Disjoint controls are scalar 19 and
point (-23,31)mm. Source/hash are in manifest.json, C3-r1.nui and its oracle.
The compiler accepted this exact legal source without diagnostics/cycles and
normal production Rust eligibility passed. The actual persistent stdio emitted:

```text
thread 'main' (1296226) has overflowed its stack
fatal runtime error: stack overflow, aborting
```

The request rejected with `evaluation_stdio stdout closed`. The C3 test duration
was 203ms; this was not a 15s watchdog timeout. The raw focused run reports
10 tests passed / 1 failed; 5 unexecuted after bail. The preceding same-process
C2 (85 diamonds, canonical V=262/E=430, expected sink 262) passed the independent
oracle. This is an adjacent scale PASS, not an independently minimized reducer.
No fault owner was causally proved; no profiling/operation-count attribution,
fix, fixed PASS or repair-removal test is claimed. A sample attempt found the
owned child already gone; its diagnostic is retained, not called profiling.

Every completed revision compared all scalars and point/line coordinates
against the offline Python integer oracle, separately for Rust and TS. The same
assertion rejected a deliberate +1 wrong result; transitions rejected stale
previous expectations and checked the exact analytically changed declaration
set. Source hashes/revisions and stable geometry identity across A/B edits were
checked. TS/Rust agreement was secondary only. The historical #572/#1415/#1454/
#1470/#1472 tests were not rerun after the safety stop and get no new credit.

## Performance, resources and verification

No five-warmup/21-trial block or comparative timing summary was executed.
p50/p95/max and stage CPU attribution are UNAVAILABLE. The observed abort is
localized to the production Rust request (after successful compiler/lowering
eligibility); it is not classified as a proven performance defect. Source bytes,
canonical V/E and successful payload bytes remain in the manifest, graph seal
and base-correctness.json. Do not use whole-run elapsed time as stage timing.

The focused run took 53.81s overall (51.737s test time including setup/reference
checks). One persistent child, 15 requests; sampled peak child RSS 82,704KiB;
worker max RSS 483,696KiB, worker CPU user 19,327,678us/system 330,170us. Samples
are observations, not a guaranteed instantaneous peak. Rust CPU was not recorded
as a reliable cumulative batch measurement before the abort. Process wall/CPU
sampling shortly before exit showed the owned child busy; it was not a hang.

Successful setup: explicit `cargo build --quiet --manifest-path
rust-evaluator/Cargo.toml --bin evaluation_stdio`, exit 0, bounded at 120s.
Binary SHA-256: `8ce18898b0365941c96555c772636333bc6eef592df9149bb9e0337fd94ac7f4`.

Focused command (file subsequently moved to the existing opt-in performance
suite, without changing assertions or fixtures):

```sh
ISSUE1474_RECORD=/tmp/nuinuicad-1474-evidence/base-correctness.json NODE_OPTIONS=--max-old-space-size=2048 npx vitest run test/issue1474DependencyTopology.integration.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --bail=1
```

Actual exit **1**, retained verbatim. Adapter-only preliminary run also exit 1.
Legality preflight exit 0. No required final-gate PASS is claimed:

| Required final command | Result |
| --- | --- |
| npm run build | NOT_RUN: safety stop before implementation/final gate |
| npm run lint | NOT_RUN: safety stop |
| npm test -- --pool=forks --maxWorkers=1 --no-file-parallelism | NOT_RUN: safety stop |
| npm run test:parity | NOT_RUN: safety stop |
| npm run test:performance:binding-analysis | NOT_RUN: safety stop |
| conditional Rust fmt/check/test/clippy | NOT_APPLICABLE: no Rust changes; no such suites run |
| git diff --check 60f54f3ccec505821bc615e516bab8192bd20533 | PASS, exit 0 before final staging; final staged whitespace check initially exit 2 on raw log whitespace, then corrected losslessly |

Raw console logs contained intentional Rust diagnostic trailing whitespace and
terminal blank lines. The first final `git diff --cached --check` returned 2;
commit/push did not run. Logs were archived losslessly as .log.gz (round-trip
verified), preserving every original byte while satisfying patch whitespace
checks. No runtime test was retried for this evidence-format correction.

## Changed owners and remaining work

Only `test/issue1474DependencyTopologySupport.ts`, the opt-in
`test/issue1474DependencyTopology.performance.test.ts`, and
`test/fixtures/issue-1474/**` changed. Support reuses canonical compilation,
buildEvaluationOptions, prepareRustEvaluation, evaluatePreparedRust and the
production RustEvaluationProcess. No new semantic owner, scheduler or evaluator.
The performance filename uses the existing excluded-suite mechanism to retain
the failing diagnostic without running a known stack-aborting workload in
ordinary protected CI. It does not turn the failed run green. Deliberate rerun
requires a separate safe continuation decision after independent review.

Zero novel repaired first-owner families; one unresolved legal workload abort.
Remaining: safety/stack investigation decision, causal owner/reducer and any
authorized repair, C3/C4 and all D runtime work, complete performance protocol
and controls, applicable final gates, independent exact-HEAD review. All frozen
files and initial Base evidence must remain intact. No architecture, API,
dependencies, language specification or native host behavior changed. Manual
GUI E2E was not required or executed. No PR, merge, Issue close, roadmap update
or main restoration was performed.

The owned child close/error listeners preceded all requests and disposal;
afterAll disposed and awaited close. Process inspection confirmed no remaining
Vitest/evaluation_stdio process. Only owned processes were handled. No external
quota readings were supplied: five-hour/weekly Codex quota **UNAVAILABLE**.
