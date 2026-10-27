# Human-approved B4 continuation

Continuation checkpoint: 9af85cdb7b6a65f6be0986c2a7501881e22d4396.
Fixed Base: c7c6d9bbc8ad2afdb2913fc061ec69360ec6599f.
Human authorization: Issue amendment and comment 6395983182, 2026-10-25.
The original result.md, frozen cases, owner proof and Base observations are
historical evidence and remain intact. The amended scope resolves the prior
App-owner stop; it requires Human Manual GUI E2E after merge.

Only new production edits: positive text-Y zoom in outputPreviewRendering.ts,
and positive local multiline advance in the two ordinary/highlight tspan paths.
A3/F1 is preserved. Original B4 glyphUp=(0,-2) and secondBaseline=(0,12)
assertions/expectations are retained. The baseline probe now uses corrected local
positive line advance; actual DOM tspan values are independently tested.

Before repair observations, supporting B4 verification variants are frozen as
(angle,mirror)=(0,false),(0,true),(90,false),(37,true), all with the same real
source/plan, translation (31,-23), label anchor (12,18), font5mm, line6mm.
They are required repair verification within B4, not new exploratory units.
Independent placement: A=(31,-23)+R(angle)·diag(mirror?-1:1,1)·(12,18).
At zoom z, screen glyph ascent=(-z*sin(angle),-z*cos(angle)); second baseline
=(6z*sin(angle),6z*cos(angle)); glyph right=(m*z*cos(angle),-m*z*sin(angle)).
DOM coverage calls actual compiler/output planner with the TS reference as a
supporting renderer test. The retained B4 numeric test uses normal production
Rust stdio and retains real page/path/guide/inverse controls. No mocked
EvaluationResult/OutputPlan is primary evidence. No GUI automation or GUI PASS.

Current ledger and final verification results follow below.

## Current implementation and ledger

Two novel first-owner families are now repaired with focused fixed-PASS evidence:
A3/F1's Preview source/runtime binding boundary (unchanged from checkpoint) and
B4's text coordinate boundary (transform coupled to ordinary/highlight tspan).
B4's Base FAIL remains in observations.json/B4-base and the original failed
assertion remains in crossSurfaceProjection.issue1460.test.ts. The fixed real
Rust plan gives `translate(403 199) rotate(0) scale(2 2)`, glyphUp=(0,-2) and
secondBaseline=(0,12), with the same original source hash and numeric oracles.
The minimal failing observation is the real Caption's local glyph-up probe;
no synthetic production plan or extra reducer input is used. Adjacent real
joined paths/pages/guides/inverse and baseline had passed at Base and still pass.
The supporting DOM tests assert actual ordinary/highlight transforms and actual
`tspan y=[0,6]` for all frozen repair variants. Those assertions detect either
the original reflected glyph axis or original negative multiline advance.

| Unit | Current disposition | Evidence / limit |
| --- | --- | --- |
| A1 | PASS | Default scalar, matching instance and wrong-sibling sensitivity rechecked. |
| A2 | PASS | Named parameter/source/sibling isolation and value DTO rechecked. |
| A3 | BUG→FIXED→REPASS | Original nested-instance fix preserved and rechecked with real Rust. |
| A4 | CONTRACT_INVALID | Historical rejected attempts retained; no new source or gate coverage claimed. |
| B1 | PASS | Real identity plan, source geometry and numeric screen path rechecked. |
| B2 | PASS | Origin/translation/scale/mirror/rotation endpoints and controls rechecked. |
| B3 | PASS | Independent Canvas/output profile visibility and physical stroke rechecked. |
| B4 | BUG→FIXED→REPASS | Retained glyph-up/baseline numeric oracles pass; actual ordinary/highlight DOM, rotation/mirror and adjacent path/page controls pass. |
| C1 | PASS | Fresh saved MCP requested geometry vs independent source evaluation rechecked. |
| C2 | PASS | Saved fingerprint/revision and actual in-flight stale rejection rechecked. |
| C3 | PASS | Invalid saved source fails closed; repaired source rechecked. |
| C4 | PASS | Unsaved/saved isolation and save convergence rechecked. |
| X1 | NOT_TRIGGERED | No new cross-document hypothesis. |
| X2 | NOT_TRIGGERED | No new in-flight Module projection hypothesis. |
| X3 | NOT_TRIGGERED | Static B4 repair does not establish a profile/viewport revision ambiguity. |
| X4 | NOT_TRIGGERED | No demonstrated MCP dependency selection risk. |
| F1 | BUG→FIXED→REPASS | Original one-point nested reducer rechecked, same A3 family. |
| F2 | NOT_COVERED | No additional reducer accepted. |
| F3 | NOT_COVERED | No additional reducer accepted. |
| F4 | NOT_COVERED | No additional reducer accepted. |

Accepted distinct comparisons remain 12 (11 primary plus F1); A4 is an accurately
rejected contract slot. Amendment-required B4 repair variants and all reruns are
verification of the retained unit, not additional exploration units.
A/C sensitivity results remain intact and were re-executed. A4's generated/gated
Preview coverage remains a residual, not a disproven fault. No new architecture,
DSL, compiler, general evaluator, native adapter, process or encoder change.

## Verification execution notes

- Full retained matrix plus new DOM test: PASS, 18 tests in two files. This
  reran A3/F1 and original B4 through ordinary Rust eligibility/stdio, plus
  four actual App ordinary/highlight DOM variants with real compiler/planner.
- Existing OutputPreviewApp/modulePreviewRoot/modulePreviewValueProjection:
  PASS, 66 tests in three files.
- First required block: focused five-file gate PASS (48 tests), then build
  stopped with TS18048 in the previously unbuilt campaign test: optional
  drawingProfiles was accessed directly. The test now explicitly checks its
  Canvas profile is present before evaluating it; product scope is unchanged.
  Subsequent block execution is a diagnosed repair verification, not an
  unchanged retry-until-green. No test was skipped, disabled, or weakened.
- After that type-shape correction the retained matrix/DOM selection passed
  again (18 tests). Final required block outcomes are recorded below.

The continuation's focused Rust process handled 31 requests, closed after
explicit disposal and awaited completion, and removed its owned temporary MCP
directory. Its record is continuation-observations.json. No guard tripped.
The required block has a 3600s wall timeout, 900s per-process CPU limit,
4GiB Node heap bound, two Cargo build jobs, and the required maxWorkers=2 full
suite; existing per-test/hook bounds and owned lifecycle cleanup remain active.
No extra implementation checkout or executor was used.

Manual GUI E2E: REQUIRED POST-MERGE, NOT RUN. No GUI PASS is claimed.
Independent exact-pushed-HEAD review, protected CI/PR/merge and eventual Issue
completion remain ChatGPT/Human responsibilities. No executor PR or Issue close.
Quota: UNAVAILABLE; no Human weekly/5h readings or reset/interference readings
were supplied, and no estimates were made.

## Final required verification

The final exact block completed with exit **0**, in this order:

```sh
cd /Users/yosomi/Code/nuinuiCAD && npm test -- src/vscode/modulePreviewEvaluation.test.ts src/vscode/useVscodeMultiDocumentRuntimeEvaluation.test.tsx src/vscode/outputPreviewRendering.test.ts src/vscode/outputPreviewViewport.test.ts src/output/outputCore.test.ts --maxWorkers=2 && npm run build && npm run lint && npm test -- --maxWorkers=2 && npm run test:parity && git diff --check
```

| Required command | Final outcome |
| --- | --- |
| Five-file focused `npm test` above | PASS, 48 tests / 5 files |
| `npm run build` | PASS, TypeScript + Language Core typecheck + MCP bundle |
| `npm run lint` | PASS |
| `npm test -- --maxWorkers=2` | PASS, 11,062 passed / 183 existing skipped tests; 689 passed / 2 skipped files |
| `npm run test:parity` | PASS, 203 tests |
| `git diff --check` | PASS |

Full stdout/stderr for the diagnosed initial attempt and successful final block
is retained in continuation-verification.log. No new skip, suppression, retry of
an unchanged failure, fake eligibility or GUI execution was introduced. Final
full-suite/parity processes completed normally; no resource limit tripped.
The A3/F1 product fix, original source fixtures, prior Base observations and
stopped-checkpoint evidence were verified byte-for-byte against 9af85cdb.
The only new product changes are the authorized three lines in the two B4 files.
No automatic-verification blocker remains. A4 remains CONTRACT_INVALID with its
coverage residual; independent review/CI and post-merge Human E2E remain pending.
