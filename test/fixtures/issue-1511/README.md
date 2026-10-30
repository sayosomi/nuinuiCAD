# Edge / extend conformance fixtures

Reusable compiler-valid nui1 inputs for #1511. `oracle.py` reproduces the
sources, SHA-256 hashes and independent expectations in `manifest.json` using
Python's standard library and no product imports or observations.

```sh
python3 test/fixtures/issue-1511/oracle.py
npm test -- --maxWorkers=2 test/issue1511EdgeExtendConformance.integration.test.ts
```

`ISSUE1511_VALIDATE_ONLY=1` compiles every revision and checks ordinary Rust
eligibility without evaluating geometry. `ISSUE1511_RECORD=/absolute/path.json`
records source revisions, lowered requests, both engine payloads, comparison
errors/tolerances, binary hash, product diff and process/request counts. Each
matrix run uses one actual persistent Rust stdio process; child completion/error
listeners precede requests and disposal. Requests/teardown have 15s limits;
binary build has 120s, each sequence 60s, and focused harness invocations 240s.

| Unit | Distinct discriminator | Base result |
| --- | --- | --- |
| E1 | Asymmetric straight pair, both ends extend to (67,55) | PASS |
| E2 | Both ends trim; separately sealed reversed directions | PASS |
| E3 | Parallel, same-owner, absent index, valid recovery | PASS |
| E4 | Selected named branch, both owners' checkpoints, base/root reads | PASS |
| T1 | Four start/end interior/exterior moves on directed 120 mm line | PASS |
| T2 | Off-support, zero length, valid recovery | PASS |
| T3 | Open line/arc/line join, interior trim and terminal extension | PASS |
| T4 | Reversed owner; disabled named no-op and subsequent end move | PASS |
| A1 | CCW nonquarter circle arc extended through zero | PASS |
| A2 | CW start trim, end trim, start extension | PASS |
| A3 | Analytic line-circle corner; both ends move | PASS |
| A4 | Nonconcentric circles, separated roots (30,-40)/(30,40), indices 0/1 | PASS |
| B1 | Asymmetric cubic trimmed at independent Bernstein t=.371 | PASS |
| B2 | Endpoint tangent extension and reversed start extension | PASS |
| B3 | Second cubic segment shortened; first segment and neighbor retained | PASS |
| B4 | High-curvature asymmetric cubic representation, roots t=.2/.7 | PASS |
| M1 | Cubic extend then edge; first move changes corner y=37.5 to 25.5 | PASS |
| M2 | Edge then extend, immutable checkpoint, branch, disabled stage/readers | PASS |
| M3 | Two parametric Module instances, recipes and downstream stations | PASS |
| M4 | Two-panel contour, V0→V1→V2→exact V0 width revisions | PASS |
| X1 | First endpoint move succeeds, second arc relocation fails; atomic rollback | PASS |
| X2 | Segmented arc interior trim and curved-terminal tangent append | PASS |
| X3 | Segmented cubic interior trim and curved-terminal tangent append | PASS |

All 20 primaries and 3 evidence-triggered X sequences pass in Rust production
and the TypeScript reference on unchanged product Base
`03ce4e4b5eb28a188ee1904bc1bec36170e938e5`. There are 43 checkpoints per
engine (saved/current variants remain within their declared sequences).
X4–X6 and R1–R6 are NOT_TRIGGERED: **23/32 accepted exploration units**.
No novel product defect or causal repair was confirmed; product Base FAIL,
minimized R, repair-removal FAIL and restored PASS are therefore not applicable.
No production source, specification, DSL reference or architecture was changed.

X1 is justified by A3's additional tangent-extension root and the fact that E3's
negative controls stop before endpoint movement. Its earlier root is
(30, -25√3 + 5/√3), strictly off the arc's supporting circle. The first line
could move there, but the second arc cannot: both original owners must remain,
one recipe-owned diagnostic must occur and no successful Failed stage may
publish. A3 independently supplies the adjacent valid body-root control.
X2/X3 exercise separate arc/cubic subdivision and curved-terminal append arms
not reached by T3's line-terminal cases. These are boundary-directed additions,
not independently confirmed failures or reducers.

Coordinates and angle metadata use 1e-6 mm/degrees; analytic line/arc lengths
use 1e-6 mm. Cubic controls use independent de Casteljau subdivision. Cubic
lengths use Simpson quadrature at 8192 and 16384 panels, agreeing within 1e-8 mm.
For each cubic, five binary de Casteljau subdivisions give 32 chord/control-
polygon bounds on true length. Their gap plus 1e-7 mm is the separate length
allowance for the product's existing 32-chord estimate; it is never applied to
coordinates or handles. Cubic B4 has x=6+120t and y=360(t-.2)(t-.7), represented
by cubic Bernstein controls; its roots are algebraically isolated at .2/.7,
60 mm apart, with nonzero derivatives -180/+180. No tangent, repeated or
near-degenerate root is assigned an invented ordering. A4 uses exact circle
algebra and first-arc directed traversal ordering. All root expectations and
source hashes preceded product execution.

Every case checks the unchanged independent 37 mm Control, finite payloads,
error count/owner, original drawable identity and identity stability on edit.
Line direction/tangents, analytic arc sweep/tangents, cubic controls/handles/
tangents, selected full-stage metadata, Module origin separation, segment
continuity and byte-for-byte retained input primitives are asserted directly.
Pure path aliases carry controls/length only; the full named-stage snapshots
are checked separately for cubic handle/tangent metadata. Arc primitive records
carry center/radius/sweep/endpoints; tangent metadata belongs to the enclosing
computed geometry rather than each primitive record.

Pre-execution seals and original observations are retained in `verification/`.
The first validation rejected M1's `line` alias of a cubic; it was changed to
canonical `path` before product execution, without changing geometry. Initial
harness failures incorrectly inherited an error message into recovery, expected
unpublished primitive/value metadata, and duplicated Module instance names
while traversing synthetic groups. Correcting those adapter assertions did not
change any accepted source or numerical expectation. Those logs are retained
as harness drafts, not product FAIL evidence. Strengthened checks subsequently
cover full stage metadata and exact untouched primitives in both engines.

The finite matrix does not prove every CAD input correct. Sampled cubic length
and projection precision remain established approximations; near-degenerate
roots, unsupported geometry and arbitrary extrapolation policies were not
redefined. No GUI, browser, Canvas host, export, print, garment sewability or
Human Manual E2E result is claimed. Independent exact-pushed-HEAD blocking
review remains required before integration.

The exact required final verification block is preserved in
`verification/final-verification.sh`; its aggregate exit code is 0, with
fail-fast ordering, on tested source commit
`a5b23f4c6cf63b079b3bc742cfcfc503b999680d`. Results: focused TS 181 PASS;
Rust edge 5 PASS; Rust extend/trim 15 PASS; full JS 11,638 PASS / 187 existing
skips (719 files PASS / 2 skipped); parity 207 PASS; full Rust 648 PASS /
9 existing ignored (641 library + 6 stdio + 1 integration). Build, lint,
DSL reference, Rust formatting/check/clippy and diff checks all exited 0.
The eight-file adjacent regression run passed 140 tests. The final full-suite
matrix again used one persistent process, 43 Rust requests and 43 TS evaluations.
No expected values, assertions, skips or ignored tests in existing suites changed.

`verification/tested-source-sha256.json` seals the tested product and harness
inputs. The subsequent evidence commit only archives logs, hashes and this
fixture documentation; it does not change executable inputs. The initial
primary oracle/manifest and adjacent oracle are additionally archived and
verified byte-for-byte against their original pre-execution seals in
`verification/seal-restoration.json`. No product repair was made or removed.
