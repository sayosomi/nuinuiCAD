# Stage 6 mutation-sensitive evaluator discovery and repair

[Issue #1426](https://github.com/sayosomi/nuinuiCAD/issues/1426) was a bounded
D1 implementation campaign at Base `38a00dc7d3b8f6cf90633b87f3fc383561bb85b7`.
It found **zero novel confirmed defect families**, and therefore made no product
repair. All 24 S/T cells (48 sources) and three controls pass independently in
the TypeScript reference and normal eligible production persistent Rust runtime.
This does not establish absence of bugs outside these sources or a globally
optimal discovery strategy. Independent exact pushed-HEAD review is still required.

## Replay and retained evidence

From the repository root, with installed dependencies and the Rust toolchain:

```sh
ISSUE1426_MODE=prevalidate ISSUE1426_EVIDENCE=/tmp/nuinui-stage6-replay \
  npx vitest run test/issue1426MutationSensitiveRust.integration.test.ts
ISSUE1426_MODE=baseline ISSUE1426_EVIDENCE=/tmp/nuinui-stage6-replay \
  npx vitest run test/issue1426MutationSensitiveRust.integration.test.ts
ISSUE1426_MODE=verify ISSUE1426_EVIDENCE=/tmp/nuinui-stage6-replay \
  npx vitest run test/issue1426MutationSensitiveRust.integration.test.ts
node test/fixtures/issue-stage6/summarize.mjs /tmp/nuinui-stage6-replay
```

Choose a fresh external directory. `baseline` refuses to overwrite an initial
baseline and requires the original product-owner fingerprint. `verify` requires
the frozen sources/oracles; it may run on a later product tree. This campaign's
reducer intentionally requires the unchanged original fingerprint because no
product repair occurred. The reducer writes compact tracked evidence, so replay
it only in an admitted task-owned checkout and review the resulting diff.

`ISSUE1426_IDS=S-00-S,O-07-T` restricts an exact-source verification replay.
For a new campaign, `freeze` is compiler-only and refuses to overwrite an
existing `freeze.json`; it is not a way to regenerate this campaign's evidence.
The default phase is strict `verify`. Baseline collection preserves unresolved
assertions without aborting the remaining initial sources; a green baseline
runner exit is not a semantic PASS. Inspect its per-source dispositions.

The canonical compiler, Stage 3 compiler/value assertions and `optionsFor`,
`prepareRustEvaluation`, and the production `RustEvaluationProcess` are reused.
No new evaluator, resolver, scheduler, transport, or production abstraction was
introduced. The lifecycle follows Stage 5: Rust build 120 seconds, request 20
seconds, process ten minutes, teardown five seconds. Close/error listeners are
installed before transitions, and allowed teardown stream errors are consumed.
No mock, fallback, one-shot runtime, or eligibility override is used.

Historical external evidence is `/tmp/nuinui-stage6-1426`; `evidence-index.json`
records file hashes. `raw.ndjson` retains exact wire payloads and both runtime
results; `mutations.ndjson` retains cloned-payload injection results;
`attempts.ndjson` retains each observation and initial instrumentation failures.
`baseline.json` retains original observer dispositions and corrected original-tree
semantic observations. `outcomes.json` records final independently checked
results, canonical bindings/dependencies, diagnostic codes and owner identities,
private geometry occurrences, survivors and limit effects. Proof hashes link
compact records to the complete external data. Large raw traces are not copied
into Git. `/tmp` retention is local and not a portable artifact guarantee;
reviewers can replay the committed corpus if those raw files are unavailable.

## Frozen corpus and independent oracles

`freeze.json` was written before any primary evaluator execution. It contains
all 51 accepted sources, SHA-256 hashes, seeds, exact execution order, method and
fault-model assignments, source-derived expectations, separately recalculated
oracles, initial revision and product-owner fingerprint. `source-ledger.json`
indexes the 48 primary sources and three controls. Accepted total: **51/160**;
extra counterfactuals and reductions: **0**. Eight initial negative-array-literal
attempts were compiler-rejected and retained in `rejections.json` as
CONTRACT-INVALID; legal unary Module arguments replaced them before freezing.
Rejected attempts are neither product defects nor semantic PASS cases.

Seed = `8000 + stratumOffset + cellIndex`; offsets S/O/X = `0/100/200`, cell
indexes `00..07`. S/T share a seed. T alpha-renames all generator-owned names,
forwards through a typed alias, and swaps two unrelated prerequisite declarations.
The primary members remain distinct source texts with identical intended values.
The three controls share their stratum's cell-00 numeric model and have distinct
source hashes. No Stage 3–5 source is counted as new exploration.

The normative oracle is `docs/nui1/spec.md`: immutable loop state, simultaneous
next, lazy selected branches, lexical dependencies, Module privacy/export and
instance atomicity, enabled gates and evaluation limits. Neither compiler
payload nor current or historical evaluator output defines an expected value.

| Stratum | Exact axes | Independent oracle and activation |
| --- | --- | --- |
| S | 2/3 iterations × scalar-next first/array-next first × selected if/exhaustive match | Incoming scalar and both asymmetric array members at every iteration; final scalar, indexes and geometry; exact canonical carry IDs and observer dependencies |
| O | 2/3 iterations × private if/match × positive/negative selected branch | One lexical Module call per body; exact Module/export/consumer occurrence paths, private frame identity/value, exports/consumer coordinates and external survivor |
| X | first/second active failure × directly/ancestor disabled third Module × selected if/match error | Before-first, through-first, through-second, through-independent limits; exact successful/failed owners, diagnostic code and binding IDs, atomic omission, suppressed consumer and independent survivor |

S uses `s'=s+b+t`, `a'=a+s+t`, `b'=b+s+t`, where `(a,b)` is the two-element
array and `t=1..n`. The authored generator calculates the recurrence. The
separate oracle uses `a=b-d`, `b-s=0` after the first iteration and
`b+s = 2^i*(u+d+f) + 2*(2^(i+1)-i-2)`; at iteration zero `b-s=u+d-f`.
It validates every incoming and final state before evaluation. Two independent
incorrect models update the scalar first or the array first. Every active
source's final state differs from each incorrect model. Actual exact outputs
are checked against the simultaneous oracle, not just against TS/Rust parity.
The empty-loop control preserves every initializer and records body NOT_COVERED.

O directly calculates each signed seed plus the authored offset; the other
branch divides by zero. Both branches remain statically legal. Exact generated
rows, one canonical private conditional occurrence under the Module frame and
its final executed value prove activation. Cache occurrence identity is shared
across iterations; rows distinguish iterations. No per-iteration private cache
identity is invented. The zero-loop control has no Module rows/private value
execution and retains only the external survivor.

X calculates each owner's result independently from Fail, selected branch,
gate and limit. The Prefix drawable precedes Mark inside the Module; a selected
Risk error must remove Prefix and Mark together and suppress UseOne/UseTwo.
The other active owner retains both points and its consumer. The dormant Module
contains an invalid argument, so its control verifies gate-before-input behavior.
The adjacent control executes both active instances with the erroneous branch
unselected and the third Module disabled. Thus it demonstrates nonactivation
alongside real successful output, rather than just absent geometry.

Private Module scalar error codes are read from exact canonical computed
bindings, because the UI diagnostic projection omits Module-local source rows.
An empty disabled-instance snapshot is bookkeeping, not drawable output or
argument activation. Private scalar cache values can be populated outside the
drawable limit; they are retained explicitly and are not counted as emitted
Module failures. The observable limit oracle checks actual geometry/errors,
completed nonempty snapshots and dependent suppression. These distinctions were
observer corrections; no frozen source or independent semantic expectation
changed. Original failed assertions remain in the baseline evidence.

## Fault sensitivity and retained false negatives

| Fault model | Outcome |
| --- | --- |
| S scalar-updated-first | 16 active sources distinguish it; KILLED in both runtimes' actual output comparisons |
| S array-updated-first | 16 active sources distinguish it; KILLED in both runtimes' actual output comparisons |
| O private lazy first loss | 16 test-local cloned payloads per runtime change only the owned conditional's `lazy:true` to false; all lose exactly the 2*n exported/consumer points while the external survivor remains |
| S/O zero iterations | NOT_COVERED for body fault activation; initializers/external survivor verified |
| X atomicity/gate/selected branch/limit faults | Semantically activated and checked; mutation sensitivity NOT_COVERED because no X fault injection was performed |

For O, a changed diagnostic alone never counts as downstream detection. Both
runtimes detect real output loss in all 16 active sources; zero active cases are
BOUNDARY_DETECTED / OUTPUT_NOT_DETECTED. The zero-loop TS injection may add
private diagnostic noise while drawable output remains identical. That is a
retained false positive for a diagnostic-only detector, not Module activation.
Injected F04 and historical Stage 3/4 defects contribute **zero** novel families.
S uses explicit countermodels, not a production evaluator mutation. X assertions
should not be described as measured sensitivity to every hypothetical defect.

## Diagnosis, repairs and continue/switch/stop rules

Original genuine product FAIL-before: **none**. Confirmed/fixed novel families:
**0/0**. First-producer repair, minimized failure, adjacent repair control and
repaired-baseline claims are therefore inapplicable. Original and final product
fingerprints are identical. All final sources pass in both runtimes. Stage 3–5
fixtures and the Stage 4 forward-dependent suspect remain unchanged.

Continue until every frozen source/limit and required sensitivity check is
classified, even after a discovery. Reproduce a new mismatch independently,
preserve its FAIL-before, reduce to a legal source, establish an adjacent true
PASS, and trace compiler → dependencies/payload → TS → production persistent
Rust to the first incorrect producer. Repair only the authorized owner, add a
deterministic regression, verify both runtimes and rerun all contaminated cases.
Deduplicate downstream symptoms by that first producer.

Switch attention to a different frozen boundary when a countermodel survives,
activation is absent, or first-producer ambiguity remains. Only actual such
evidence authorizes an optional extra text: at most one per primary source,
using one authorized transformation, within the global 160 accepted-text ceiling.
Do not fill unused capacity after a resolved zero-family matrix. Exact-source
reruns and historical regressions do not consume new capacity; request counts
are telemetry, not stop limits. Never tune the oracle from evaluator output.

Stop with a safe pushed checkpoint on ambiguous normative oracle/first owner,
uninstantiable legal shape, contaminated original baseline, source-ceiling
exhaustion before completion, actual hang/resource failure, stale admission or
conflicting implementation/audit/E2E ownership, or required excluded-owner,
product/spec/architecture change. Preserve the exact blocker and relevant
UNRESOLVED/BLOCKED/CONTRACT-INVALID disposition. Do not weaken assertions,
reset/stash/rebase/force-repair Git state, add worktrees or broaden this matrix.

## Telemetry, quota and comparison

`telemetry.json` records accepted/rejected hashes, compiler/TS/Rust requests,
32 killed S countermodels, O mutation detections, coverage and observer overhead.
One complete matrix performs 102 normal evaluations plus 17 cloned-payload
injections per runtime. X contributes 68 limit placements, including 40 selected
failure placements. Counts include original observer reruns; no cumulative
request cap prevents required retesting.

There were eight rejected source attempts, one generator syntax correction and
four observation/projection corrections. They are agent overhead, not new
families. A useful next-campaign improvement is to validate observer projections
against existing schema/control evidence and reproject saved raw data before
rerunning all unchanged sources. Load task context once and use bounded batches;
spend reasoning on discriminatory oracles, sensitivity and first-producer loss.
No token-metering infrastructure was built.

Human weekly/five-hour remaining percentages, observation times/reset displays,
UI precision and overlapping-use evidence were **not supplied**. Quota cost,
attributable weekly denominator and fixed-family/quota rate are **UNAVAILABLE**.
There are no method-isolated observations. No efficiency winner is claimed;
method comparison is INCONCLUSIVE. A displayed zero delta would not be a valid
denominator. Request counts, PASS counts, source counts, milliseconds or estimated
tokens never substitute for actual plan quota.

| Method | Mechanism and finding |
| --- | --- |
| RISK | S and X target carry snapshots, canonical ownership, gates and limits; no novel family |
| OWNER | O verifies lexical loop/Module occurrence and actual first-loss output sensitivity; no novel family |
| MODEL | Independently derived values and explicit S countermodels across the frozen strata; no novel family |

These labels overlap and are not equal-sized experimental arms. Stage 4 found
six families in 88 accepted texts without quota attribution; Stage 5 found zero
in 87 and established F04 output detection, while retaining the scalar-first
countermodel blind spot. Stage 6 finds zero in 51, closes that explicit S model
gap and extends O polarity/iteration and X failure/gate/limit intersections.
Those differences do not rank quota efficiency or prove a universal improvement.

A separately authorized next campaign could add test-local X first-loss
mutations, require actual independent survivor/error discrimination, and examine
additional legal iteration/ownership shapes. Retain the S two-model standard and
O drawable-loss detector. Collect attributable enclosing quota observations if
available; otherwise continue to report UNAVAILABLE. Nominal records, optionals,
transport redesign, imports, #1260's matrix and the historical Stage 4 suspect
remain excluded. No additional product boundary is authorized by this guide.
