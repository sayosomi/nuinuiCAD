# Issue #1509: linked curved contour revisions and physical output

Base: `b9b34b89ceae84681d32b531daf35d527493d699`.
No production defect was confirmed. No production source, language contract,
architecture, dependency or historical regression was changed. This fixture
records the complete bounded investigation and supplies permanent regression
coverage for the linked source → contour → allowance → ordinary mark → output
workflow. Repair/removal/restoration proofs are not applicable without a defect.

`freeze.py` imports no product code. It freezes exact UTF-8 source and SHA-256,
normalized authored ownership, directed primitive geometry, offsets, contour
lengths, mark station/tip coordinates, output order, transformed physical bounds,
SVG dimensions and A4 tile origins/counts in `manifest.json`. The canonical
independent oracle JSON and its SHA-256 are sealed separately at each checkpoint.
The test verifies both seals before evaluating. V3 uses V0's exact source bytes.

| Primary | V0 | V1 | V2 | V3 | Interaction |
| --- | --- | --- | --- | --- | --- |
| C1 | PASS | PASS | PASS | PASS | Line + quarter arc; dimension and allowance changes |
| C2 | PASS | PASS | PASS | PASS | Asymmetric cubic handles and body width |
| C3 | PASS | PASS | PASS | PASS | Closed line/arc contour; width/height; two marks |
| C4 | PASS | PASS | PASS | PASS | Authored primitive order/direction reversal |
| N1 | PASS | PASS | PASS | PASS | Fixed 50 mm contour station; radius changes |
| N2 | PASS | PASS | PASS | PASS | Ratios 0.52/0.83; 4/9 mm marks |
| N3 | PASS | PASS | PASS | PASS | Directed tangent-relative mark; reversed path |
| N4 | PASS | PASS | PASS | PASS | Station 0.2 mm beyond the moving line/arc join |
| O1 | PASS | PASS | PASS | PASS | Notch-owned to allowance-owned SVG maximum X |
| O2 | PASS | PASS | PASS | PASS | A4 1 → 2 → 3 → 1 sheet transition |
| O3 | PASS | PASS | PASS | PASS | Mirrored 90°/270° placement, translation and scale |
| O4 | PASS | PASS | PASS | PASS | Draft/Cut profiles and direct mark visibility |

All twelve retain a 100 mm physical control line, a separate unchanged sibling,
unselected geometry, curved contour, seam allowance and at least one ordinary
short `segment` mark. Hidden source primitives remain evaluable. Cut hides both
allowance and marks, preserving the control and sibling. Physical stroke width
is always 2 px × 25.4/96 mm, including scaled placements.

## Independent mathematics and tolerances

Lines and directed circular arcs use analytic length/station/normal formulas.
Cubic controls are hand specified from the authored directed tangent angles.
Independent numerical length integration uses 16,384 and 32,768 trapezoid panels;
the two lengths must agree within 1e-6 mm. Inverse cumulative length determines
stations. The cubic offset oracle samples `B + d*(B'y,-B'x)/|B'|` at 513 points;
it does not copy a fitted production cubic. Both directed Hausdorff distances
between the independently sampled normal curve and the fitted path are checked,
as are endpoint accuracy and continuity. Monotone selected curves keep bound
extrema at the known endpoints. No cusp, self-overlap or trimmed-curve oracle is
claimed.

Predeclared tolerances: analytic/runtime coordinates 1e-7 mm, Bezier station
0.03 mm, Bezier mark tip 0.04 mm, approximated offset/bounds 0.11 mm. SVG/PDF
number quantization allows 0.00051 output units (PDF MediaBoxes/operators are
checked in points or converted to mm). The SVG mark check includes its declared
Bezier station/tip tolerance. Analytic mark checks retain quantization alone.
Measured maxima are recorded in `matrix-results.json`; the offset Hausdorff
maximum includes decoded physical-file quantization. Precision was not relaxed
in response to product failures.

O1 translates Piece by a constant +100 mm so the control cannot mask its maximum
X. V0's 70 mm physical station and 15 mm mark set maximum X; V1/V2's allowance
endpoint sets it. O2's stroke-inclusive widths are approximately 180.529,
200.529 and 390.529 mm. A4 usable width is 210 − 2×10 = 190 mm, predicting
1, 2 and 3 columns. All rows remain one; V3 restores one sheet.

## Production checks and actual files

The colocated `src/output/outputCore.issue1509.integration.test.ts` uses
incremental and fresh canonical compilation, exact current source/revision
proof, stable authored declaration IDs, production lowering, Rust eligibility,
one freshly Cargo-built persistent `evaluation_stdio`, and the eligible TS
reference. Complete geometry is compared across engines/compilation modes.
Compiler-owned identities are normalized by authored owner; synthetic Bezier
endpoint metadata is normalized using the producing geometry's endpoint fields,
without parsing opaque runtime ID text. V3 restores normalized complete geometry
and decoded artifact content, without requiring PDF metadata byte identity.

At all 48 checkpoints, both compilation modes and both output declarations run:
192 Rust evaluations, 192 actual `exportOutput` files, and 192 inspections.
SVG XML checks physical dimensions, viewBox, ordered path commands, arc flags,
Bezier controls, marks, widths and colors. PDF inspection follows xref → Catalog
→ Pages → Kids → Page → Contents, validates stream lengths and MediaBoxes,
decodes every stroke's ordered operators/width/color, verifies page clipping,
tile origins and all four 10 mm inset guides. The independent quarter-circle
PDF expectation uses the standard cubic tangent construction
`k = 4/3*tan(sweep/4)`; it is not read from the Rust encoder or OutputPlan.
Repeated complete global geometry under each page clip is intentional tiling.
Six representative PDFs were also rendered with Poppler and visually inspected;
this was CLI rendering, not GUI automation or printer operation.

Two legal negative source controls (zero arc radius and an off-curve tangent
base) run through incremental/fresh compilation and actual persistent Rust plus
TS: four additional Rust requests. The bad producer has an explicit current
error and no computed geometry; the 100 mm sibling survives. Negative revisions
never enter positive export. Perturbing the frozen tip by +0.1 mm is rejected
by the same current-runtime and actual-SVG detectors used for positive cases.

## Preparation evidence and exploration budget

No unreported replacement test is claimed. Original preparation evidence is
retained outside the checkout under `/Users/yosomi/.codex/evidence/issue-1509/`.

- Initial `join(sources: ...)` was rejected by the compiler: the legal argument
  is `paths`. This syntax-authoring rejection consumed no accepted unit; no
  production execution or product defect is attributed to it.
- **X1 / CONTRACT_INVALID**, conservatively counted: initial C2 used endAngle
  270 while its independently intended monotone geometry required endAngle 90.
  Its source/oracle pair was invalid; the existing trim warning was visible.
  `rejected-c2.json` retains all original source hashes. Only the authored end
  tangent was corrected, then resealed before the valid C2 was evaluated.
- **X2 / COVERAGE_INVALID**, conservatively counted: initial O1's 0–100 mm control
  masked the planned notch maximum. Its passing geometry was insufficient O1
  evidence. `rejected-o1.json` retains that source. A constant Piece placement
  exposes the original intended extremum test, resealed before observation.
- Early harness failures compared raw synthetic IDs and applied encoding-only
  tolerance to approximate Bezier stations. These were detector defects;
  original runs remain external. Numeric tolerances themselves did not change.

Final accepted primary sequences: 12. Conservatively counted preparation
variants: 2. Total 14/24 units; X3–X6 and all six causal reducers NOT_TRIGGERED.
There are no Base FAIL / fix / isolated-removal claims for a product correction.
`matrix-results.json` retains all 48 dispositions, exact source/oracle hashes,
192 real artifact hashes/paths, controls, measured residuals, process closure and
actual Rust executable path/SHA-256. Full raw observations and files are external;
compact verification records are in `verification.json`.
`observations.json.gz` retains the full normalized current/fresh TS/Rust observations
and the exact input/test/binary seals from the final matrix run.

Manual E2E: **Not Required** for this host-neutral CLI-only acceptance. Native
GUI, actual printer fidelity, cloth fit and sewing usability remain untested.
The executor stops after pushing a Draft PR for independent exact-HEAD review.
