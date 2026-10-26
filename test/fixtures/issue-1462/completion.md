# Issue 1462 — final implementation verification

Current continuation starts from `3ad3d9bb3f2269ef984000fa3db5fcfa8b12d821`.
Base remains `179718b09eb113d4f4895f56f321657f027c706a`; topic remains
`sayosomi/issue-1462-bake-source-roundtrip-hunt` in the same declared checkout.
The updated Issue and Human cause-based scope decision authorize directly
caused regression corrections. All prior checkpoint reports, frozen sources,
Base/candidate failures and verification logs are retained unchanged as history.
This report and `closure-*` artifacts record the latest verification.

## Fixture correction and independent oracle

Only two source literals changed in
`test/issue1406LineAngleResidualRust.integration.test.ts`:

- H-singular-arc-offset: right → left.
- H-nearby-valid-arc-offset: left → right.

Both cases retain CCW radius10, centre(0,0), angles10°→100°, distance10 and the
same horizontal Axis. The tangent to the source at10° points100°. Its left
normal points inward, so left/distance10 gives radius0 and an unavailable
geometry/lineAngle result. Right gives radius20 and the unchanged tangent
axis100°, whose smaller angle to the horizontal axis is80°. These expectations
come from the directed Y-up normal and tangent, not evaluator agreement.

The existing `evaluation-geometry-builtin-unavailable` assertion and expected80
assertion, all other fixture statements, the ten-case H cardinality, Rust
eligibility checks, source compilation, TS/Rust runtime checks, diagnostic
checks, skip behavior and timeouts remain unchanged. The original H test
independently exercises both outcomes through the TS reference and production
Rust. No production code change or compensating special case was needed.
The prior exact failure is retained in `residual-regression-failure.log` and
`final-full-test.log`; corrected focused results are recorded in
`closure-focused-historical.log` and `closure-focused.log`.

This is the directly caused regression correction for B06/R01, not a fourth
product defect family. The three repaired families remain: directed arc-offset
radius polarity, Bake lexical naming/reference capture, and stale Bake source
plan application. Their reductions, independent predictions, source-level
mutation detectors, fixed observations and detailed 32-row ledger remain in
`result.md`, `continuation-cases.json`, and `fixed-observations.log`.

## Matrix and evidence continuity

All 27 accepted hunt units are replayed by the focused and complete suites:
16 B +8 X +3 R, within the unchanged32-unit ceiling. R04–R08 remain
NOT_TRIGGERED. B06/B12/B16 and R01–R03 retain BUG→FIXED→REPASS dispositions;
all remaining accepted primary/control dispositions are unchanged. X02 retains
its four supported zero/negative-radius rejection controls. No new exploratory
program, unsupported syntax, eligibility relaxation or GUI evidence was added.

The canonical compiler, host-neutral source splices/store commit, production
Rust evaluation, secondary TS reference, original and post-patch geometry,
direct arc endpoints/signed sweeps, ordered cubic controls, authored insertion,
lexical uniqueness/reference stability, hidden/disabled sandbox controls, and
stale rejection/fresh retry/undo/redo verification remain in the accepted
roundtrip regression. Source-level missing-declaration and reversed-arc faults
remain sensitive. Historical failure artifacts are retained rather than being
rewritten as passing outcomes.

## Verification and handoff

`closure-gates.json` records each exact required command, actual exit, duration
and per-process bound, in execution order. New logs use the `closure-` prefix;
prior failed gate records are not overwritten. The 27-unit source/action
inventory has not increased. Existing historical regression replays consume no
new exploration capacity. Final results and cleanup are in
`closure-verification.json`.

Only the historical test and Issue-owned evidence change in this continuation.
No product architecture, DSL contract, host, export or UI change is introduced.
The original source owners and shared evaluation/patch APIs are preserved;
no new parser, evaluator, resolver, document model or abstraction was added.
Prior working reports are retained because they are the required exact failed
checkpoint evidence, not current implementation instructions.

Independent exact-pushed-HEAD review, PR creation, protected CI and merge routing
remain with ChatGPT. No PR, merge or Issue closure is performed by this agent.
#1460's deferred Human GUI E2E remains separate and was not run. Human-observed
weekly and five-hour remaining quota readings remain UNAVAILABLE.

## Final gate results

All commands in `closure-gates.json` exited **0**, with no timeout:

| Gate | Result |
| --- | --- |
| Production Rust binary rebuild | exit 0 |
| Focused H + Bake + offset + canonical source tests | exit 0; 156 passed |
| Standalone original H regression | exit 0; 4 passed |
| Rust fmt / check | exit 0 / 0 |
| Focused Rust offset tests | exit 0; 11 passed |
| Full Rust tests | exit 0; 625 passed, 9 existing ignored |
| Rust clippy, all targets, warnings denied | exit 0 |
| Build / lint | exit 0 / 0 |
| Full JavaScript suite, maxWorkers=2 | exit 0; 11,101 passed, 187 skipped, zero failed |
| Rust/TypeScript parity | exit 0; 207 passed, zero skipped/failed |
| DSL reference / diff whitespace | exit 0 / 0 |

No implementation blocker remains from the historical fixture correction.
All accepted units retain their dispositions in `closure-verification.json`;
R04–R08 remain NOT_TRIGGERED. The current run made no eligibility or skip changes.
The 187 JavaScript skips and nine ignored Rust cases are reported as such,
not credited as covered. Every prior tracked Issue-owned evidence file was
verified byte-identical to the starting checkpoint.

The bounded verification runner finished without timeouts or leftover evaluation
or Vitest child processes. No temporary directory was created in this
continuation. New logs are intentional evidence; ordinary ignored build outputs
are retained. The final commit contains only the reviewed two-line fixture
correction and new Issue-owned evidence.
