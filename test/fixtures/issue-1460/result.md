# Issue 1460 — blocked implementation checkpoint

Base: `c7c6d9bbc8ad2afdb2913fc061ec69360ec6599f`.
Branch: `sayosomi/issue-1460-cross-surface-projection-hunt`.
Status: **BLOCKED / incomplete, not merge-ready**. This checkpoint deliberately
retains B4's failing assertion. No test suppression, spec change, GUI automation,
PR, merge, Issue closure or main restoration occurred.

## Required stop and remaining decision

B4's real eligible production Rust print plan has correct joined segment order,
physical page origins/guides, text anchor/size, screen coordinates and inverse.
`outputPreviewTextTransformFor` returns
`translate(403 199) rotate(0) scale(2 -2)` for the real multiline label.
SVG glyph ascent `(0,-1)` therefore becomes **(0,+2)** screen pixels; the
independently frozen expected upright vector is **(0,-2)**. The second-line
baseline correctly projects to `(0,+12)` with the existing App's local `y=-6`.

First incorrect projection: `src/vscode/outputPreviewRendering.ts`, text Y
scale. However, changing its Y sign alone sends that baseline to `(0,-12)`.
The ordinary and highlight text renderers in `OutputPreviewApp.tsx` both set
`tspan y={-index * drawable.lineHeightMm}` (lines 181 and 241 at Base).
A single affine transform cannot make local glyph ascent and local negative
line advance point in opposite directions. A coherent repair requires changing
those App-owned line coordinates too. `*App.tsx` / interactive UI is explicitly
excluded; the Issue requires stopping for a separate owner/Manual E2E decision.
No such files were changed. This is a distinct Preview owner from #1458's
already-fixed Rust SVG serialization. It is **UNRESOLVED**, not a fixed family.
`owner-proof.json` proves all B4 production owners are byte-identical to Base.

The hard stop occurred immediately after B4 failure/owner diagnosis. No further
exploration, production fix, or test/build/lint/parity execution followed.
Only evidence preservation, test option type-shape correction, diff review and
Git checkpoint operations followed. The exact mandatory verification block is
**NOT RUN because of this hard stop**. Independent review, PR/CI/integration and
completion remain with ChatGPT.

## Novel fixed first-owner family: 1

**Nested Module Preview carries orphaned authored runtime bindings.**
A3 canonical Rust Left P=(10,-9), Q=(-3,18) and Right P=(22,-9), Q=(-3,42)
pass. Preview option construction throws `bindingVersions: missing control
metadata` for two old authored Child width scopes. A1/A2 are genuine adjacent
Base PASS controls. Base reproduction was repeated using the same A3 input
and independently checked canonical geometry, not retry-until-green.

F1 reduces this to Outer(scale=18), Inner(width=@scale), one P=(19,-9), and
one real Outer/Child instance. Canonical Rust passes; Preview throws for one
old Child width scope. No production source differed from Base during A3/F1
FAIL establishment. See `observations.json` A3-boundary-base and F1-base.

`compileModulePreviewRoot` passes aggregate `compiled.bindingAnalysis` as the
source-only scalar input after ancestor projection replaces authored children.
That aggregate already contains runtime bindings from the removed instances.
The minimal repair projects source-scope bindings with existing canonical
`buildBindingCatalog` / `analyzeBindings` before the ordinary fresh Module
lowering. No new resolver, evaluator, parser or source identity scheme was
introduced. Canonical source and compiler/evaluator/spec remain untouched.

Fixed A1/A2/A3 and F1 pass normal Rust eligibility, stdio and independent
coordinates. The focused root/evaluation/F1 selection passes 16 tests across
three files. A3's different-valued Right instance fails Left's numeric oracle,
proving wrong-instance sensitivity. F1-fixed records zero orphan scopes and
passes P=(19,-9). Scope-filter robustness beyond these focused tests still
requires the blocked full regression gates.

## Complete ledger

| Unit | Disposition | Evidence / residual |
| --- | --- | --- |
| A1 | PASS | Actual default Preview vs Left Rust; P/Q/Edge coordinates; Right negative and Outside exclusion. |
| A2 | PASS | Preview session width→19 matches authored revision; Right/Outside unchanged; value DTO/summary explicit; canonical hash unchanged. |
| A3 | BUG→FIXED→REPASS | Two asymmetric real instances, exact nested Inner target, explicit ancestor scale and local half argument; Base throw, fixed independent coordinates. |
| A4 | CONTRACT_INVALID | Initial loop-bearing compiler-valid source returns null from Preview root. One nearest gate replacement was compiler-accepted but parenthesized declaration text became ordinary names rather than gates. No third source; neither attempt is a gate/occurrence PASS or a proven product bug. Evidence retained in unsupported-attempts.json/cases.json and A-repass. |
| B1 | PASS | Real Canvas/TS/Rust cubic and identity OutputPlan, authored order, screen path numeric projection; point omitted from output intentionally. |
| B2 | PASS | Nonzero origin + translate + scale2 + mirror + rotation90: T(x,y)=(33−2y,−17−2x); all endpoints/controls and projected paths pass. |
| B3 | PASS | Paper suppresses Hidden, owns dashed #aabbcc 4px physical stroke; independently selected Canvas keeps Hidden and solid #334455 3px. |
| B4 | UNRESOLVED | Joined/path/page/guide/inverse controls PASS; real multiline glyph ascent FAIL; coherent repair crosses excluded App owner. STOP. |
| C1 | PASS | Fresh saved snapshot IDs, requested numeric geometry and same-source Rust/TS independently match; ordinary DTO omits geometry as contracted. |
| C2 | PASS | Saved13→19, changed byte fingerprint, fresh numeric geometry; real old-source request followed by save returns stale with no evaluation. |
| C3 | PASS | Valid→unknown binding→repaired23; invalid reports source-unavailable, no last-good evaluation; repaired independent geometry. |
| C4 | PASS | Unsaved29 vs saved13 isolation, then save/reload convergence with advanced hash. |
| X1 | NOT_TRIGGERED | A3 is same-file; no supported saved-dependency novel distinction beyond #1452 established. |
| X2 | NOT_TRIGGERED | No new projection-specific in-flight ambiguity beyond current stale-hook/#1454 controls. |
| X3 | NOT_TRIGGERED | B4's static glyph-axis failure is not a source/profile/viewport revision hypothesis. |
| X4 | NOT_TRIGGERED | C revisions show no dependency-bearing selection/identity risk requiring a new unit. |
| F1 | BUG→FIXED→REPASS | One nested target/point/real instance reducer for A3; canonical Base PASS, Preview Base FAIL, fixed PASS. Same family. |
| F2 | NOT_COVERED | No additional reducer accepted before B4 hard stop. |
| F3 | NOT_COVERED | No additional reducer accepted before B4 hard stop. |
| F4 | NOT_COVERED | No additional reducer accepted before B4 hard stop. |

**Accepted distinct comparison units: 12 = 11 primary + F1.** A4 has a final
contract-invalid disposition and retained unsupported attempts, not an accepted
successful gate comparison. All 12 primary slots are dispositioned. X accepted=0;
F accepted=1. No ceiling was approached. Reruns and historical tests are controls.

## Stratum checkpoints and sensitivity

- **A:** 1 novel fixed family. A1–A3 reject a genuinely evaluated different-valued
  sibling against the intended-instance oracle. F1's real Preview evaluates
  after the fix. A4's initial generated source and invalid replacement leave
  generated occurrence/gate projection risk unverified; do not infer coverage.
- **C (executed before B):** 0 new families. Corrupting a copy of real requested
  P geometry by +1 fails; old numeric result fails revised oracle; intermediate
  saved13 result fails unsaved29 oracle as intended. Invalid result has no
  evaluation, and actual mid-request save is stale. Cross-document dependency
  changes during evaluation remain untested; no X4 hypothesis was accepted.
- **B:** 0 fixed families in this stratum; 1 unresolved Preview text finding.
  Test-only wrong control, reversed order, leaked suppressed drawable and doubled
  physical stroke are rejected by the independent assertions. B4's reversed
  joined segments change its real projected numeric path. Its baseline is an
  adjacent PASS while glyph ascent FAILS. Revision/mirror/rotation glyph variants
  were not explored after stop.

## Verification outcomes

| Command / selection | Outcome |
| --- | --- |
| Compiler-only freeze selection | PASS after documented fixture syntax admission corrections; all initial 12 sources + 4 valid revisions, then F1, compile. |
| New A Base focused selection | A1/A2 PASS; A3 FAIL. First A1 harness attempt mistakenly compared display name with statement identity; corrected without product change. |
| A3 independent boundary rerun | Canonical numeric control PASS; same Preview missing-control FAIL. |
| F1 Base focused | Canonical numeric control PASS; Preview missing-control FAIL. |
| Fixed root/evaluation/F1 focused selection | PASS: 16 tests, 3 files. |
| Fixed A selection | A1/A2/A3 PASS; A4 rejected/null then replacement discriminator failure; retained CONTRACT_INVALID, no suppression. |
| C1–C4 final focused | PASS: 4 tests. Initial C1 end-control oracle error preserved in oracle-corrections.json; corrected from existing end-handle construction and historical frozen oracles. |
| B1–B3 focused | PASS: 3 tests, real Rust + TS source controls and actual OutputPlan/path projections. |
| B4 focused | FAIL: +2 vs −2 glyph ascent. All preceding path/page/guide/baseline/inverse assertions PASS. Hard stop. |
| Required `npm test -- src/vscode/modulePreviewEvaluation.test.ts src/vscode/useVscodeMultiDocumentRuntimeEvaluation.test.tsx src/vscode/outputPreviewRendering.test.ts src/vscode/outputPreviewViewport.test.ts src/output/outputCore.test.ts --maxWorkers=2` | NOT RUN: hard stop. Earlier root/evaluation subset above is not this gate. |
| Required `npm run build` | NOT RUN: hard stop. |
| Required `npm run lint` | NOT RUN: hard stop. |
| Required `npm test -- --maxWorkers=2` | NOT RUN: hard stop; B4 is deliberately still failing. |
| Required `npm run test:parity` | NOT RUN: hard stop. |
| Required block's trailing `git diff --check` | Block NOT RUN. Standalone checkpoint `git diff --check` PASS. |

No test was retried unchanged until green. Harness fixes and the one product
repair are distinguished above. B4 remains a real failing test in this checkpoint.
A test-only required-option type-shape correction was made during checkpoint
preservation and has not been re-executed; no build/typecheck/lint PASS is claimed.

## Execution hygiene and authority

Every evaluation is ordinarily Rust-eligible and crosses the production
`evaluation_stdio` runner; no fake eligible flag or mocked result is primary
evidence. Cargo binary preparation is bounded at 120s; requests at 15s, unit
runs at 30s, one worker per discovery run; Rust CPU at 60s and resident memory
watchdog at 512 MiB. Completion/error listeners precede requests/teardown.
Each owned child was disposed and its close awaited; each temporary MCP directory
outside both checkouts was removed. The retained observations record childClosed
and temporaryDirectoryRemoved=true. No resource guard tripped or unrelated process
was killed. No extra worktree, parallel implementation executor or legacy operation.

Relevant #1450/#1452 tests and #1454/#1456/#1458 fixtures/proofs were inspected as
historical controls. No historical defect is counted as newly fixed. Current
architecture/language contracts did not change, so no architecture/spec/reference
rewrite is appropriate. Evidence/fixtures remain reusable and active, not obsolete
roadmap documentation.

Manual E2E: **NOT RUN, no GUI PASS**. The current production edit is strictly
host-neutral, so Manual E2E is not required for that edit. Completing B4 needs a
separate App scope and Manual E2E decision before further work.

Quota observations: **UNAVAILABLE**. Human supplied no weekly/5h UI readings;
no token/runtime/count estimate, reset assumption, or cost-per-family inference.
