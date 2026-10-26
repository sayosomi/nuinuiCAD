# Issue 1462 continuation — three repairs, BLOCKED full-suite checkpoint

Base remains `179718b09eb113d4f4895f56f321657f027c706a`.
Continuation began at `1ee2679564993ee0d23d13878b0e818d99747c46`, on the same
`sayosomi/issue-1462-bake-source-roundtrip-hunt` branch and declared checkout.
The updated Issue and Human scope-decision comment authorized only the two
arc-offset producing helpers in addition to the original Bake owners.

`README.md`, `verification.json`, `cases.json`, `observations.json` and the
initial Base logs remain unchanged historical evidence of the first checkpoint.
This file, `continuation-cases.json`, `fixed-observations.log`, and the `final-*`
logs/records describe the continuation. This is not a merge-ready checkpoint.

## Repaired first-owner families

1. **Directed arc-offset radius polarity — B06/R01.** Right signed offset is
   positive at the existing helper interface. It increases the radius of a
   counterclockwise arc and decreases that of a clockwise arc. Changed only
   `offset_arc_segment` in Rust `offset_paths.rs` and `offsetArcSegment` in
   TypeScript `offsetPaths.ts`. The signed-offset producer, joining/trimming,
   compiler and other evaluator owners are unchanged. Original R01 failed at
   radius6 instead of4. Fixed original evaluation and recompiled Bake output
   both have centre(0,0), radius4, start(4,0), end(0,4), signed sweep+90°.
   B06 now preserves line(0,1)→(10,1), then radius4 arc centred(10,5), start
   (10,1), end(14,5), sweep+90°. X01 covers both directions and both sides.
   X02 covers radius0.001, zero and negative inward limits for both directions;
   zero/negative cases fail closed and generate only skip comments. Focused
   raw Rust/TS regressions additionally cover zero offset and outward limits.
   The old Rust unit test's radius5 expectation for a right CCW offset was
   corrected to15; its inward error control now selects left.
2. **Bake lexical name allocation — B12/R02.** `bakeGeometry.ts` previously
   checked only drawable elements. It now reserves compiler-owned declarations
   in the authored insertion scope, the compiler's scope chain, Module parameter
   metadata, and canonical iteration slots, plus names emitted by this plan.
   Deterministic `_2`, `_3`, … suffixes avoid occupied names. No new parser,
   resolver or namespace model was introduced. R02 reduces to one point whose
   requested P_bake name is occupied by a typed constant; the unchanged control
   still reads that constant. B12 emits C_bake_1_2 and C_bake_2_2, preserving
   the original const/point references. X03 checks occupied suffixes and
   separate scopes; X04 checks nested Preview insertion. X07/X08 caught gaps
   in the first candidate: ancestor-reference capture and Module-parameter
   collision. The completed allocator fixes these at the same first owner;
   they are not counted as additional families. Exact candidate failures are
   retained in `naming-capture-candidate-fail.log`.
3. **Bake stale plan application — B16/R03.** `BakePlan` now carries the existing
   SourceSnapshot type, populated from the canonical compiler source/revision.
   `applyBakePlan` validates both against current source before committing any
   splice. It returns rejected/invalid-change without source, history or
   selection mutation on a mismatch. R03 reduces to a single-point document.
   Base accepted a stale plan and added a history entry. Fixed results reject
   it without either write; a fresh retry adds exactly one history entry and
   valid declaration. Reapplying that consumed plan is rejected. Undo restores
   the changed pre-Bake source; redo restores the baked source, whose store
   document reevaluates to the frozen geometry. X05 independently checks a
   restored identical text at a newer canonical revision; X06 checks different
   text at the same canonical source-map revision. The store notification
   revision and canonical source-map revision are distinct counters; X06
   explicitly asserts the latter equality before attempting application.

Exact Base failures for R02/R03 and the initial continuation controls were
recorded before production edits in `continuation-base-fail.log` (9 FAIL / 13
PASS). The initial B06/B12/B16/R01 failures remain in `base-confirmed.log`.
Product production files at the starting topic were identical to Base.

## New blocking regression owner

The full suite finds `test/issue1406LineAngleResidualRust.integration.test.ts`,
its H historical-fixture test, inconsistent with the approved radius repair:

```nui
arc Arc = arc(center: (0, 0), radius: 10, start: 10, end: 100)
const Offset: path = offset(sources: [@Arc], distance: 10, side: right, closed: false, suppressTrimWarnings: false)
```

`H-singular-arc-offset` expects `lineAngle(@Offset.start, @Axis.start)` to fail.
The approved Y-up/directed-side contract gives radius20 and a valid tangent;
production and reference correctly return scalar status=ok. The adjacent
`H-nearby-valid-arc-offset` instead uses left/distance10 (radius0) while
expecting the valid angle80. That second stale expectation is visible in the
existing source; its assertion is not reached after the first failure.

The minimum correction would exchange those two fixture side literals, keeping
the singular/valid meanings and existing expected error/angle80. This test file
is outside the explicit writable regression list. It was read only. No waiver,
skip, production special case, downstream compensation or unauthorized test
change was made. `residual-regression-failure.log` preserves the exact focused
failure (1 failed / 3 passed). This existing regression replay consumes no new
exploration capacity. A narrow test-scope decision is required to finish the
full gate. All three requested product families are repaired, but the Issue's
verification acceptance remains BLOCKED.

## Independent oracles and complete ledger

Original 16 B sources and R01 are unchanged. Ten continuation units (X01–X08,
R02–R03) were frozen before their first candidate execution. Total accepted:
**16 B + 8 X + 3 R = 27**, within32. No further exploratory source was added.
Existing regression replays and output fault injections are not new Bake
source/action units.

Every accepted hunt unit now compiles normally and passes ordinary Rust
eligibility. The harness checks independently predicted geometry in the
original selected snapshot before planning, applies real source splices,
canonically recompiles, and independently checks the new declarations under
production Rust. TS is secondary. Arc endpoints are computed analytically
from the frozen centre, radius and angles before candidate execution and
compared directly, together with the signed sweep. Ordered cubic controls,
world transforms, Module instances and Current/Base snapshots retain their
initial independent predictions.

Unchanged-source geometry and references are checked through reevaluation;
original authored text is restored exactly by removing only the frozen insertion
footprint. Generated count/order, source insertion positions, copied activity/
style, default hidden/disabled filtering and deterministic names are asserted.
Every roundtrip recompiles and reevaluates a fault-injected output with a
missing generated declaration and proves the oracle fails. Every arc-containing
unit additionally flips the emitted direction: identical endpoint locations
cannot hide the wrong signed sweep. R01 also rejects seeded radius6. Stale
acceptance sensitivity is established by exact Base FAIL and by independent
same-text/new-revision and same-revision/new-text controls; fresh retry and
consumed-plan reapplication distinguish rejection from unconditional failure.

| Unit | Disposition | Evidence |
| --- | --- | --- |
| B01 | PASS | Point and oblique line; independent declarations and original references |
| B02 | PASS | Positive arc centre/radius/direct endpoints/+120° sweep; direction mutant rejected |
| B03 | PASS | Clockwise crossing-zero direct endpoints/−90° sweep; direction mutant rejected |
| B04 | PASS | Both ordered cubic control quadruples and continuity |
| B05 | PASS | Open mixed line/two-cubic topology and order |
| B06 | BUG→FIXED→REPASS | Correct left arc offset and joined line endpoint; original and committed source |
| B07 | PASS | Analytical 30° rotation/translation world coordinates |
| B08 | PASS | Reflected asymmetric arc/cubics, direct endpoints and chirality |
| B09 | PASS | Two Module parameter values, both call-site insertions, no leakage |
| B10 | PASS | Nested Preview leaf authored owner; synthetic root rejected |
| B11 | PASS | Multiple statement-ordered source insertions and unchanged neighbor/comment |
| B12 | BUG→FIXED→REPASS | Typed/geometry collisions avoided, original references stable |
| B13 | PASS | Analytically distinct Base and final Current geometry |
| B14 | PASS | Hidden opt-in, style/activity copied, default filter and neighbor stable |
| B15 | PASS | Disabled sandbox, selected-ID opt-in, default filter and enabled control |
| B16 | BUG→FIXED→REPASS | Atomic stale rejection, fresh retry, one history entry, undo/redo reevaluation |
| X01 | BUG→FIXED→REPASS | Four direction/side combinations and direct endpoints |
| X02 | BUG→FIXED→REPASS | Near-positive inward radii; four SUPPORTED_REJECTION controls at/beyond zero |
| X03 | BUG→FIXED→REPASS | Typed/geometry occupied suffixes, separate scopes, stable references |
| X04 | PASS | Preview Module-local typed-name collision avoided |
| X05 | PASS | ABA: same text, newer canonical revision rejected; retry/undo/redo |
| X06 | PASS | Different source, same canonical revision rejected; retry/undo/redo |
| X07 | PASS | Ancestor typed reference preserved after naming counterfactual repair |
| X08 | PASS | Module parameter preserved after naming counterfactual repair |
| R01 | BUG→FIXED→REPASS | Reduced CCW radius5 left1 → radius4; line-offset control unchanged |
| R02 | BUG→FIXED→REPASS | Reduced single point versus typed-name collision |
| R03 | BUG→FIXED→REPASS | Reduced single-point stale plan; atomic retry/undo/redo |
| R04 | NOT_TRIGGERED | No independent fourth family reduced |
| R05 | NOT_TRIGGERED | Unused |
| R06 | NOT_TRIGGERED | Unused |
| R07 | NOT_TRIGGERED | Unused |
| R08 | NOT_TRIGGERED | Unused |

No contract-invalid syntax, Rust fallback or eligibility relaxation was used.
No CRLF-specific Bake coverage or native GUI/host claim is made; existing
canonical source-patch regressions were included. #1460 E2E remains separate.

## Verification and handoff

`final-gates.json` records actual commands, bounds, durations and exits. The
pipeline stops at a failed gate. Independent remaining parity/reference checks
are recorded in `final-remaining-gates.json`; they cannot waive the full-suite
failure. All new Rust requests are bounded to15 seconds/8MiB; hunt tests to30
seconds. Command launchers own process groups and terminate only their own
children on timeout. There is no cumulative invocation ceiling or family-count
stop. Current results and cleanup are finalized in `final-verification.json`.
Final statuses: focused152 PASS; Rust fmt/check/Clippy exit0; complete Rust
618 library +6 stdio +1 integration PASS,9 pre-existing ignored; build/lint
exit0; full JavaScript exit1 (11,100 PASS /1 FAIL /187 skipped,690 files
passed /1 failed /2 skipped); parity exit0 (207 PASS,0 skipped); DSL reference
exit0. Diff and staged-diff checks exit0. No timeout occurred.

Full parity first exposed one stale radius8 expectation for a radius10 CCW arc
with right offset2. That focused assertion was corrected to radius12 and
endpoints(12,0)/(0,12), inside the explicitly authorized parity file; full
parity then passed207. `parity-stale-expectation-fail.log` retains the initial
failure. Build/lint were rerun after that assertion correction and passed.
This does not waive the separate unauthorized historical-fixture failure.

The initial required-block failure remains historical, unchanged. Final focused
Bake/source-patch tests, complete Rust tests, formatting/checking/Clippy, build,
and lint have passed. The full JavaScript suite remains blocked by the
unauthorized stale regression fixture above. Independent exact-pushed-HEAD
review, a future passing full gate, PR/CI/merge and Issue closure remain with
ChatGPT; none is claimed here. No production owner beyond the four explicitly
allowed files was changed; bakeCommands.ts needed no change. No architecture
boundary, public DSL contract, parser, resolver, document model or host was
replaced. Documentation/specification semantics already describe the corrected
side-of-directed-path behavior.

Human-observed weekly and five-hour remaining quota: **UNAVAILABLE**.
