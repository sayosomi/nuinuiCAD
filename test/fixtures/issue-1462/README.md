# Issue #1462 — BLOCKED checkpoint

Base: `179718b09eb113d4f4895f56f321657f027c706a`.
Topic: `sayosomi/issue-1462-bake-source-roundtrip-hunt`.
No production changes. This checkpoint deliberately retains four failing tests.
It is not an implementation-complete or merge-ready result.

## Mandatory owner stop

B06 independently predicts an open left offset of a counterclockwise quarter
circle: centre (10,5), radius 5 minus distance 1 = radius 4. The tangent line
remains (0,1)→(10,1), and the arc runs 270°→360° with +90° sweep. Instead,
production Rust returns radius 6, trims the line to x=5.52786404500042,
and emits arc start 221.8103148957786°, sweep +138.1896851042214°.
Actual Bake patches canonically compile and reproduce this incorrect geometry.
The error exists before the Bake planner receives its input.

R01 removes mixed-path joining from the failing core:

```nui
nui 1
arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)
line O = offset(sources: [@A], distance: 1, side: left, closed: false, suppressTrimWarnings: false)
```

At the start, the source tangent points upward. In Y-up coordinates its left
normal points toward the centre. Expected offset start=(4,0), end=(0,4),
radius=4, sweep=+90°. Both original and canonically recompiled baked geometry
instead start at (6,0), end at (0,6), radius=6, sweep=+90°.
The executed R01 fixture also contains an unchanged straight-line offset control:
left of (0,0)→(10,0) is correctly (0,1)→(10,1).

First incorrect production owner:
`rust-evaluator/src/evaluation/offset_paths.rs::offset_arc_segment`, next-radius
calculation, together with the signed-offset input from
`offset_line_evaluator.rs`. Right offset is positive; for CCW circles it should
increase radius. The current helper subtracts it. The reference counterpart
`src/geometry/offsetPaths.ts::offsetArcSegment` has the same sign error.
Agreement between these implementations is not independent confirmation.
The independent oracle is the tangent/normal calculation above, consistent with
Y-up mm geometry and the documented offset side-of-source-direction contract
(`docs/dsl/en/constructions.md`, offset).

These owners are outside the Issue's two writable production files. The Issue
explicitly requires preserving a reducer and returning for a scope decision.
No downstream compensation, eligibility relaxation, specification change, new
feature, native host work, GUI operation, PR, merge, or Issue closure was made.

## Other unresolved findings

- **B12:** Legal source declares `const C_bake_1: number = 99` alongside a
  two-segment curve C. Bake requests `C_bake_1` anyway. Canonical recompile
  returns fatal `source-namespace-collision` between typedDeclaration and
  geometry. `bakeGeometry.ts` allocates names from `CadElement[]` rather than
  all declarations in the compiler-owned lexical namespace. B04 provides the
  passing two-segment curve control without this collision. This is a distinct
  in-scope naming family, but it was not independently reduced or repaired
  after the mandatory owner stop.
- **B16:** Plan a Bake, commit a new source revision, then `applyBakePlan(plan)`.
  Expected rejection without a source/history write; actual result `applied`
  adds P_bake and one history entry. `BakePlan`/`applyBakePlan` in
  `bakeGeometry.ts` carry/check no source snapshot proof. Safe retry and
  undo/redo assertions remain after the failure and have not been reached.
  This is another distinct in-scope candidate, unreduced and unrepaired.

No repaired-family credit is claimed: **0 fixed**, one reduced out-of-scope
family, two unresolved in-scope findings. Historical #1456–#1460 findings are
not recounted.

## Frozen inputs, controls, and limits

`cases.json` preserves 16 primary inputs/actions and one reducer (17 source/action
units). No X exploration input was started. Initial numerical predictions were
computed analytically before candidate execution: explicit mm points, cubic
handles from authored angles/lengths, rotation T(x,y)=(10+x cos30−y sin30,
−7+x sin30+y cos30), reflection T(x,y)=(−x,y), distinct Module parameters,
and reversed/translated Current versus untouched Base snapshots. Expectations
never come from generated Bake text. Insertion footprints were additionally
made explicit from the original authored statement lines before final replay.

The harness uses the real canonical compiler, ordinary Rust eligibility check,
production lowering and freshly built `evaluation_stdio`, actual `applyLineSplices`,
canonical recompile, and Rust reevaluation. TypeScript is a secondary reference.
For Preview it compiles the canonical ephemeral root, selects its exact target
runtime IDs, inserts after the real Inner::L authored declaration, and rejects
the synthetic root as a source target. No duplicate parser/evaluator/model was
introduced. Runtime identity metadata is excluded only from comparisons between
fresh independently compiled documents; geometry and source are still checked.

Every passing primary checks unchanged original geometry/activity/style,
unchanged original text after removing exactly the insertion footprint,
statement-ordered splices, valid canonical references, generated count/order,
reproducible generated text, and the frozen numerical geometry. Hidden/disabled
cases also check default filtering and copied presentation/activity fields.
A source-level fault removes the last emitted declaration, recompiles and
reevaluates it, and must fail the independent count/geometry assertion. This
catches dropped second cubics, dropped mixed-path primitives, omitted targets,
and false success with no new geometry. These are mutations of the Bake output,
not additional inputs/actions passed into Bake. No direction-specific source
mutant or CRLF coverage is claimed. Arc assertions constrain centre/radius,
endpoint angles and signed sweep; direct assertions on the returned endpoint
coordinate fields remain NOT_COVERED. Numerical PASS rows must not be promoted
to complete acceptance for that unchecked representation field. R01 additionally rejects a seeded radius-6
result against the radius-4 oracle. For B06/B12/B16, assertions after their
recorded failure, including downstream detectors, are **NOT_COVERED**.

## Complete disposition ledger

PASS below means the recorded frozen host-neutral roundtrip and controls passed;
it does not close the Issue or imply complete GUI/host coverage. There is no
BUG→FIXED→REPASS entry because no production fix was authorized after the stop.

| Unit | Disposition | Observation / residual |
| --- | --- | --- |
| B01 | PASS | Point (2.25,−3.5) and oblique line endpoint (13.5,7.25); original references stable |
| B02 | PASS | CCW radius12, centre(3,−4), 30°→150°, signed +120° |
| B03 | PASS | CW radius7, centre(−2,5), 30°→300°, signed −90° across zero |
| B04 | PASS | Both ordered cubic control quadruples and continuity |
| B05 | PASS | Open line + two cubic segments in exact order |
| B06 | BLOCKED | Original evaluator wrong arc-offset side; post-Bake preserves wrong radius/trim |
| B07 | PASS | 30° rotation + translation, analytical world coordinates |
| B08 | PASS | Asymmetric reflected arc/cubics; chirality and signed sweep preserved |
| B09 | PASS | Module values4/19; independent coordinates and two call-site insertions |
| B10 | PASS | Nested Preview leaf inserted at actual Inner body; synthetic root has no target |
| B11 | PASS | Two insertion sites, reversed input selection, untouched comment/point |
| B12 | BLOCKED | Typed declaration/generated-name collision; canonical recompile fails |
| B13 | PASS | Current (18,9)→(9,2); Base (2,−3)→(11,4), same frozen source |
| B14 | PASS | Hidden styled point opt-in; default filter and untouched neighbor |
| B15 | PASS | Disabled sandbox uses explicit allowed IDs; default filter and enabled neighbor unchanged |
| B16 | BLOCKED | Stale apply accepted; safe retry/undo/redo remain unexecuted |
| X01 | NOT_TRIGGERED | No adjacent exploration input allocated before mandatory stop |
| X02 | NOT_TRIGGERED | Unused |
| X03 | NOT_TRIGGERED | Unused |
| X04 | NOT_TRIGGERED | Unused |
| X05 | NOT_TRIGGERED | Unused |
| X06 | NOT_TRIGGERED | Unused |
| X07 | NOT_TRIGGERED | Unused |
| X08 | NOT_TRIGGERED | Unused |
| R01 | BLOCKED | Reduced single CCW arc offset; radius4 expected, radius6 observed before and after Bake |
| R02 | NOT_TRIGGERED | Unused; B12 reduction remains pending scope decision |
| R03 | NOT_TRIGGERED | Unused; B16 reduction remains pending scope decision |
| R04 | NOT_TRIGGERED | Unused |
| R05 | NOT_TRIGGERED | Unused |
| R06 | NOT_TRIGGERED | Unused |
| R07 | NOT_TRIGGERED | Unused |
| R08 | NOT_TRIGGERED | Unused |

Residual acceptance: scope decision for the evaluator owner; repairs and fresh
verification for B06/R01, B12, B16; B12/B16 independent reduction; B16 safe
retry/undo/redo; independent exact-pushed-HEAD review and later PR/CI/merge
routing. Do not infer these from the passing cells.

## Reproduction and verification

Run `cargo build --quiet --manifest-path rust-evaluator/Cargo.toml --bin evaluation_stdio`
first (exit 0 here). Tests intentionally require that binary; there is no skip
when missing and no Rust eligibility bypass. Every attempted original and
post-patch evaluation in the hunt passed ordinary eligibility. Disabled
geometry uses only the explicitly authorized per-target sandbox override.
Each direct Rust process has a 15-second timeout and 8 MiB output bound; each
new test has a 30-second timeout. Verification launchers own process groups and
terminate only their own group on timeout. No timeout occurred.

`ISSUE1462_EVIDENCE=1 npm test -- --maxWorkers=2 src/commands/bakeSourceRoundtrip.test.ts`
records exact failed source/patch/numerical/revision observations in
`base-confirmed.log`; `observations.json` extracts its compact structured records.
The product remains exactly Base, so this is exact Base FAIL evidence.

The required final block was executed verbatim, under an outer 600-second guard.
It exited **1** at its first test command: **43 PASS / 4 FAIL / 0 skipped**,
three test files (two passed, one failed). Its later commands were not reached
because the required block says `|| exit 1`. `required-final-block.log` preserves
that result. Separate checkpoint checks are recorded below; they do not turn
the failed block into PASS.

Separate final-source checks completed: build exit0; lint exit0; full test
exit1 (11,075 passed, the same four failures, 183 skipped; 689 files passed,
one failed, two skipped); parity exit0 (203 passed, no skips).
Verification completion results are in `verification.json`. All owned processes
exited normally and final process inspection found no remaining test/Rust
executables; no temporary child or directory cleanup is pending.

## Resources, scope, and handoff

All retained harness/fixture/evidence files are inside the Issue's authorized
paths. No product source was written; existing Bake test files are unchanged.
No new dependency, parser, evaluator, model, worktree, legacy lifecycle command,
Human-test mutation, GUI session, or foreign process cleanup was used.
The temporary generator and initial harness-error log were removed as owned
scratch files. Retained logs are intentional evidence. Native GUI E2E #1460
remains separate and was not run.

Codex weekly remaining quota: **UNAVAILABLE**.
Codex five-hour remaining quota: **UNAVAILABLE**.
No Human UI quota readings were supplied.
