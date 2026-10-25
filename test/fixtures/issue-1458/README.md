# Issue 1458 actual physical artifact evidence

Fixed Base: `c3ce5409f4124a1d9600ebf3bfb1b84190eb562a`.
One production owner changed: `rust-evaluator/src/output/svg.rs`, the text arm of
`push_drawable`. No planner, evaluation, compiler, transport or host changes.

## Reproduction and frozen oracle

`freeze.py` reads no product code or observed output. It writes `cases.json`:
legal source, SHA-256, independently transformed physical geometry, curve extrema,
stroke-inclusive bounds, paper dimensions, overlap and row/column counts. The
actual-file test checks those fingerprints before any evaluation. Source syntax
was admitted before accepting units: use `lineType`, `//` comments, and explicit
`direction: clockwise` for negative arcs. A literal excessive overlap is rejected
by the compiler; the negative output case uses a legal scalar reference, as in
#1456. Rejected syntax and the incorrect initial assumption that decreasing arc
endpoints imply clockwise motion are not discoveries or accepted extra units.

Run:

```sh
npm test -- src/output/outputCore.issue1458.test.ts --maxWorkers=1
```

Set `ISSUE1458_EVIDENCE` to an owned path to capture full parsed observations.
`evidence.json` contains compact actual Base/fixed observations, artifact/source
hashes, page MediaBoxes/origins/labels and selected parsed text evidence. Base
observations were taken before any tracked production change, at the exact Base.
The final R3 strengthened its source reorder to move an unrelated point across
its dependencies; its updated source and scheduling proof are in fixed evidence.
All family sources and their independent geometric expectations are unchanged
between the Base failure and fixed pass.

The test uses canonical fresh compile, profile-aware `evaluateOutputPlan`, normal
Rust eligibility/lowering and `evaluatePreparedRust`, the existing ordinary
`RustEvaluationProcess`, actual `exportOutput` envelopes and actual temporary
files. TS supplies an additional visibility/error comparison only. All requests
share one ordinary process; R6 exports SVG -> PDF -> revised SVG -> revised PDF
through the same file destination. R7 preserves the immediately previous valid
file through rejection and recovers. R8 actually applies `commitLineSplicePatch`,
checks exact expected source bytes and unchanged element identities, and exports
its newly compiled result. No hand-built payload substitutes for accepted source.

Resources: one test-owned Rust child, 15 s request deadlines, 60 s per-unit and
120 s build limits, 60 s child CPU limit, sampled 512 MiB RSS watchdog. macOS
rejects setting a virtual-memory ulimit, so the watchdog supplies the resident
memory bound. Close/error listeners precede requests/teardown; the child is killed
and awaited, and the isolated temporary directory is removed. No user export
paths or detached processes are used.

## Independent parsed physical assertions

SVG: XML DOM/namespace/element sequence and attributes; mm root dimensions and
viewBox; all line/cubic controls and arc endpoints/flags; reflected/rotated Y-up
geometry; analytic cubic derivative roots evaluated by de Casteljau, swept arc
cardinals; stroke-inclusive bounds/margins; fill closure/opacity and separate
stroke topology; occurrence counts and order; physical stroke/dash; text anchor,
rotation/reflection, glyph ascent axis, every baseline (including blank rows)
and prescribed line advance. Numeric field tolerance: 0.00051 mm.

PDF: byte-offset xref and trailer -> Catalog -> Pages/Kids -> Page/Contents;
actual MediaBox and declared stream byte length; decoded operators, graphics
state stack and paper clip; every path control/continuation/closure and paint
operator in order, per-page global/local mappings; width/dash/cap/join; distinct
opacity resources and restored stroke alpha; all four guides, neighbor labels,
font fitting, rotations, baseline matrices and UCS2/TJ advances. Independent
A4/A3 portrait/landscape geometry uses 72/25.4 pt/mm. Numeric field tolerance:
0.00051 pt. The full drawable appears once per page behind the physical sheet
clip, preserving intended shared overlap without losing or double-emitting a
path within a page. No rasterizer or physical printer claim is made.

Sensitivity assertions reject reversed XML overlap order, wrong cubic controls,
pixel units, false closing strokes, scaled physical strokes, wrong profiles,
inverted glyphs, lost blank baselines, wrong pt/mm, missing sheets, wrong tile
origins, lost curves, omitted fills, wrong dashes and wrong opacity application.
Every changed R artifact is also rejected against the previous bytes; R3 must
instead preserve identical bytes while changing evaluation schedule. These
mutations affect only copied XML or oracle arguments, never product code.

## Confirmed novel family: SVG glyph vertical coordinate conversion

First incorrect owner: SVG text serialization in `push_drawable`, not the
canonical source, Rust geometry evaluation, output planner or PDF encoder.

The planner's Y-up baseline/ascent data and the PDF text matrices are correct.
SVG glyph coordinates already have ascent toward negative local Y. Base adds
`scale(mirror -1)`, turning glyphs upside down; compensating negative `dy` keeps
baseline positions plausible and let the older string-based unit test pass.
The repair uses `scale(mirror 1)` and positive subsequent-line `dy`, retaining
the translated anchor and negative drafting rotation.

Independent reduction F1 has one label `A`, size 4, no placement transform.
Expected root is 8.48 x 10 mm; baseline is (3, 6.2), ascent tip is (3, 3).
Actual Base SVG puts that tip at (3, 9.4): 6.4 mm error. Base PDF from exactly the
same source passes. F1's adjacent vector SVG/PDF pass unchanged. Compound S7
and blank-row X4 fail only SVG on Base; all their PDF controls pass. Fixed SVG
and all neighbors pass the unchanged oracle. See the actual Base XML, source
fingerprints, artifact hashes and parsed fixed elements in `evidence.json`.

The Rust module's previous test encoded the incorrect transform as its expected
string; its expectations are corrected. The cross-language actual-file
regression independently derives and checks the glyph ascent axis and baseline
positions, including isolated inversion sensitivity.

**Novel fixed families: 1.** S1/#1456 authored-order control is excluded. X4 and
F1 are manifestations/reductions of the same text owner, not additional families.

## Complete ledger (29 accepted units of maximum 40)

| Unit | Disposition | Discriminator / evidence |
| --- | --- | --- |
| S1 | PASS | Reversed dependency evaluation versus First/Later actual XML overlap order; historical #1456 control |
| S2 | PASS | Asymmetric cubic, origin/translation/mirror/nonunit scale/37° rotation, interior extrema, 7 mm margin; unmirrored neighbor |
| S3 | PASS | Explicit positive/clockwise/wraparound arcs under reflection/29° rotation; endpoints/flags/swept bounds |
| S4 | PASS | Joined filled triangle plus rectangular offset; filled/stroke neighbor, closure/topology/opacity/order |
| S5 | PASS | Generated occurrences, two independent placements, counts/order/bounds and placement+element identity; single-placement control |
| S6 | PASS | Selected/default profile, visibility, 2px/4px physical width and dash at 1x/2.5x placement scales |
| S7 | BUG→FIXED→REPASS | Compound and upright AB/Japanese multiline SVG; same-source PDF passing controls |
| S8 | PASS | Negative origin, 10,500 mm span, zero/11 mm margins and exact physical dimensions |
| P1 | PASS | Stroke-inclusive 190 mm usable-width threshold and +0.002 mm crossing; one/two actual pages |
| P2 | PASS | Negative-space 2x2 A4, overlap10/zero; every projection, clip, matching guide/label pair |
| P3 | PASS | Same asymmetric polyline, A3/A4 landscape; independent MediaBox/count/stride/projections |
| P4 | PASS | Mirrored rotated cubic crossing sheets/corner; smaller neighbor and every page's uninterrupted path |
| P5 | PASS | Filled/stroked joined triangle across boundary; fill closure before separate open strokes |
| P6 | PASS | Dashed/dotted strokes at .5x/2x; narrow .2 mm strips and rotated multi-digit joining labels (up to 10) |
| P7 | PASS | Actual page-tree count changes with profile visibility; hidden geometry still evaluates |
| P8 | PASS | Legal scalar excessive overlap rejects before writing, sentinel unchanged; valid neighbor; X8 adds encoder rejection |
| R1 | PASS | Scalar Reach changes asymmetric cubic handle and fresh SVG coordinates/extrema |
| R2 | PASS | Source mirror/scale/angle revision; exact fresh SVG/PDF controls |
| R3 | PASS | Unrelated point reorder changes actual schedule; authored drawable order and both file bytes identical |
| R4 | PASS | Profile width revision only; intended physical presentation/bounds change, geometry/control preserved |
| R5 | PASS | Source endpoint crosses one/two-page threshold; fresh page tree/origins |
| R6 | PASS | Persistent process, same destination: SVG -> PDF -> revised SVG -> revised PDF; stale bytes rejected |
| R7 | PASS | Valid -> scalar-driven invalid overlap -> revised valid; previous valid bytes preserved and recovery verified |
| R8 | PASS | Actual exact line splice; unrelated comments/blank lines/declarations and all element identities unchanged; fresh output |
| X1 | NOT_TRIGGERED | No new fault signal beyond S1/S5 and R3's actual order/occurrence assertions |
| X2 | PASS | Hypothesis: non-line path continuation mishandled in filled joined contours. Frozen mixed line/semicircle/cubic, reflected+rotated; filled/unfilled both formats discriminate it |
| X3 | PASS | Hypothesis: opacity graphics state leaks between nested fills/strokes. Different colors/.35/.75 opacities, reversed order, following unfilled stroke; both formats and PDF state restoration checked |
| X4 | BUG→FIXED→REPASS | S7-triggered hypothesis: text-axis problem extends across blank baseline rows. Wi/blank/Japanese at 113°; same family, PDF control passes |
| X5 | NOT_TRIGGERED | P2 already checks all 2x2 corner mappings and paired labels; no additional high-risk observation |
| X6 | NOT_TRIGGERED | Zero/positive overlap covered by P2, threshold by P1 and narrow positive strips by P6; no new signal |
| X7 | NOT_TRIGGERED | Profile and output-kind changes already exercised in the same process by S6/P7/R4/R6 |
| X8 | PASS | Hypothesis: encoder-only text rejection could replace a previous file. Legal emoji source rejects U+1F600 via real exportOutput, exact sentinel preserved; supported Japanese neighbor recovers |
| F1 | BUG→FIXED→REPASS | Independent one-label, no-transform reducer; PDF and vector neighbors pass on Base and fixed candidate |
| F2 | NOT_COVERED | No second independent reduction topology warranted by the single first-owner family |
| F3 | NOT_COVERED | No independent finding requiring this reducer slot |
| F4 | NOT_COVERED | No independent finding requiring this reducer slot |
| F5 | NOT_COVERED | No independent finding requiring this reducer slot |
| F6 | NOT_COVERED | No independent finding requiring this reducer slot |
| F7 | NOT_COVERED | No independent finding requiring this reducer slot |
| F8 | NOT_COVERED | No independent finding requiring this reducer slot |

## Strata and residuals

S: one novel SVG text family, plus four justified conditional probes (X2/X3/X4/X8
scheduled across the artifact boundaries). Order, path geometry, physical units
and profile sensitivity are independently discriminated. No extra reorder or
placement filler is justified.

P: zero additional families; actual page graphs and content operators pass.
Units, missing pages, local projection, topology, dash, profile, guide text and
opacity sensitivity pass. X8 covers a distinct encoder-before-write failure
boundary missing from P8's planner rejection; no disk-write atomicity is claimed.

R: zero additional families; deliberate edits and one persistent ordinary process
produce fresh files. Stale artifacts are rejected, source splice identities are
preserved, and the invalid sequence recovers. No X7 filler is justified.

Residual mechanisms outside these assertions include font rasterizer fidelity,
actual printer/driver accuracy, OS write failures, extreme numeric precision
near encoder quantization and long-label ranges beyond the exercised multi-digit
case. No unresolved confirmed defect or out-of-scope first owner was found.
The completed matrix is not proof that no defects remain.

Human GUI E2E is not required for these host-neutral changes. No PR, merge,
Issue close or main restoration is authorized/performed. Independent exact-pushed-
HEAD blocking review and protected PR/CI belong to ChatGPT. Human-observed weekly
and five-hour usage before/after: **UNAVAILABLE**. Scope deviations: none.
Required final verification results are recorded in `verification.md`.
