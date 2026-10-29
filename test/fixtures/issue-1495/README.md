# #1495 seam-offset conformance fixtures

Base: `39fdfd677813bb2fdc13b29232a621e6f6f9dbac`.
These are reusable CLI regression fixtures and retained causal evidence.
`freeze.py` independently derives the numerical oracles using Python's standard
library, with no production geometry imports. `manifest.json` records directed
inputs, millimeter expectations, tolerances, rationale and source SHA-256.
The integration test uses the canonical compiler, TS reference and actual
production persistent Rust stdio, checks Rust eligibility, and closes its owned
process. Each complete matrix run uses one spawn / 18 requests (A4 has an edit).

## Result and scope

One novel defect family: the offset path owner passed a signed **right** distance
directly to the cubic fitter's **left** normal convention. This reversed Bezier
side and curvature trimming, including mixed joins, pure values and Module
instances. The smallest correction negates the argument at the existing TS and
Rust path-to-fitter boundaries. Fitting, sampling, trim thresholds, source order,
primitive identity, and join selection algorithms are unchanged.

R1 is the independently exact reduced witness: an eastbound straight cubic from
(0,0) to (50,0), distance 3 right, must have y=-3 and length 50. Base gives y=+3
in both evaluators. The neighboring line control remains y=-110, length 37.
Controlled removal of only the two argument negations makes B1–B4, C1, C2 and R1
fail in both paths (seven units), while L1–L4, A1–A4, C3 and C4 remain passing.
The focused Rust exact regression also fails on removal. Exact source bytes are
restored, followed by a complete passing matrix and focused regression run.

| Primary | Final disposition / independent discriminator |
| --- | --- |
| L1 | PASS — perpendicular right normals and miter |
| L2 | PASS — explicit reversal, side swap, ordered locus |
| L3 | PASS — non-square rectangle, four joins and closure |
| L4 | PASS — oblique and well-conditioned nearly parallel miters |
| A1 | PASS — analytic line-circle roots / near-junction choice |
| A2 | PASS — clockwise arc-line, reversed right vs original left |
| A3 | PASS — nonconcentric circles / radical-axis roots |
| A4 | PASS — mixed triple, discontinuous sibling withheld, edit clears error |
| B1 / X1 | REPAIRED PASS — line-cubic miter, free endpoint and body residual |
| B2 / X2 | REPAIRED PASS — cubic-line, reversal and tangent-control preservation |
| B3 / X3 | REPAIRED PASS — two cubics, finite ordered connected leaves |
| B4 / X4 | REPAIRED PASS — interior curvature trim, low-distance contrast, warning-only suppression |
| C1 / X5 | REPAIRED PASS — pure/drawable geometry, identity and failure channels |
| C2 / X6 | REPAIRED PASS — two Module runtime identities, differing distances/sides |
| C3 | PASS — translated/rotated reflection with side inversion |
| C4 | PASS — downstream path traversal from both ends in mm |

## Oracle corrections retained transparently

The first generator mistakenly encoded endAngle as the outward handle angle.
The established builder uses the incoming traversal tangent, with
control2=end-length*(cos(angle),sin(angle)). Initial six curve-containing legal
sources, their frozen manifest and raw Base results are retained in `initial/`.
Their whole-curve oracles are rejected, rather than counted as proof. Valid
start-normal failures remain informative, but R1 and the corrected pre-execution
X1–X6 sources establish the actual causal finding. The six variants restore the
intended control points; they are conservatively charged as six additional
distinct legal inputs. Total: 16 primary + six variants + R1 = **23/28**;
R2–R6 NOT_TRIGGERED. No additional distinct input is hidden in reruns.

An earlier C1 `line Copy = from(source: @Pure)` draft was compiler-invalid
(a broad path cannot be materialized as strict line). It is retained as
`C1-contract-invalid.nui`, with the diagnostic in `validation-initial.json`.
Before any production evaluation it was replaced by direct pure-value geometry
comparison. It is not a compiler-accepted exploration unit. The initial
validation's A4 failure was a harness canonical-document wrapper mistake,
corrected before product execution; its legal source did not change.

The independent cubic body mesh uses de Casteljau subdivision at 8192 intervals
and analytic derivative normals, with a predeclared 0.16 mm residual allowance.
The first harness used a parameter cutoff to exclude join adjustments, which
incorrectly included parts of a deliberately translated join leaf. The failed
fixed-run observations are retained in `fixed-initial.json.gz`. The corrected
harness identifies only the adjusted boundary leaf per source, reports its
residual separately, and keeps the original body tolerance. Additional analytic
tangent-miter/control-direction assertions cover these leaves. They are **not**
claimed to approximate an exact offset to 0.16 mm: join extension intentionally
departs from that locus. No production approximation algorithm was changed.
Additional tangent assertions were derived after the first product run; the
original frozen endpoint/body and R1 oracles remain the causal evidence.

Historical regression updates are caused by the same correction: an eastbound
straight cubic's intersection changes y=+10 to y=-10. Existing continuity and
trim-warning tests swap their side input to preserve the physical geometry and
their original assertions. Neither assertions nor required checks are skipped.

## Evidence and verification

`results-summary.json` contains per-host Base/removal/restored dispositions,
residuals and rejection of a deliberately wrong-side oracle. Larger raw JSON
is losslessly gzip-compressed; `repair-removal*.log` retains both negative runs.
`focused-verification.json` records 6 TS files / 225 tests and Rust offset
controls (45 library + 1 integration passed, 1 existing ignored performance
test). All ten final gates passed with exit 0 on committed source
`6bc8f01617655eba2d4f92203a0dd58e1268798b`; exact commands, bounded durations
and logs are in `verification/results.json`:

- build, lint, DSL reference, diff check: PASS;
- full npm test: 711 files passed / 2 existing skipped; 11,481 tests passed /
  187 existing skipped;
- parity: 207/207 passed;
- Rust fmt/check/clippy with warnings denied: PASS;
- Rust tests: 638 library + 6 stdio + 1 integration passed; 9 existing ignored
  performance tests; 0 doc tests.

The subsequent evidence commit only records reports/logs and this README.
`verification/verified-source-sha256.json` pins every changed executable source
and `.nui` fixture byte covered by the passing gate revision.

This repair implements the already documented directed-side contract. No new
language, architecture, host or UI behavior was introduced; DSL reference and
architecture ownership remain unchanged. GUI operations and Human Manual E2E
were not performed. No visual correctness, physical sewability, universal
numerical accuracy, or independent blocking-review PASS is claimed. Epsilon,
tangent and nonunique root boundaries beyond the frozen cases remain untested.
