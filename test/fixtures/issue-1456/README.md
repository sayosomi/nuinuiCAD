# Issue 1456 reusable conformance evidence

Base: `b91f4237b16e35a52649c738ad4e9e0562cc40ad`.
Branch: `sayosomi/issue-1456-physical-output-hunt`.
The candidate is the containing commit; there is no circular self-SHA field.

`cases.json` contains the exact compiler-valid sources, selected output/profile,
compiler element IDs, evaluated/drawable identities, placement inputs, independent
expected segments, curve critical points, bounds, SVG and physical page metadata.
`observations.ndjson` retains separate immutable Base and fixed TS/Rust observations,
source hashes, source geometry, ordered output geometry, plan metadata and payload
projection. Floating point expectations use absolute tolerance 1e-8 mm; exact
IDs, names, counts, order and label text are compared without tolerance.

## Frozen oracle and admission

The Human's exact Issue/Base/branch LOCAL CHECK PASS was consumed once. Immediately
before branch creation, fetch/prune, remote main, clean local main/HEAD, absent
local/remote topic, current Issue/PR/coordination evidence and volatile ownership
markers all passed. No worktree, legacy lifecycle or metadata repair was used.

Geometry expectations were calculated with a separate Python math calculation
before planner evaluation, then grammar and identities were frozen through the
actual compiler. Product outputCore.ts remained byte-identical to Base throughout
the Base discovery and independent R1 reduction. Base observations were retained
before the only production edit. No planner helper supplied expected geometry.

- Point: translate the origin to zero, reflect local X, uniformly scale, rotate,
  then add `at`. O1 independently gives `(29,-27)` and `(11,-51)`.
- Arcs: transform center; radius times positive scale; reflected start direction
  `angle + 180 - start`; negate signed sweep on reflection. Test unwrapped
  cardinal angles within the actual directed interval, including wraparound.
  O2 positive becomes start 180/sweep -120; clockwise control becomes 60/+120;
  wraparound becomes 270/-120, all with radius 15.
- Cubic source controls are `(0,0),(0,40),(-30,5),(10,5)`. In Bernstein form,
  differentiate each transformed coordinate; solve its quadratic (linear when
  appropriate), retain roots strictly inside (0,1), then evaluate the cubic at
  roots and endpoints. The frozen `critical` arrays retain those evaluated points.
  O4 unions the preceding line with every cubic critical point in segment order.
- Each path bounds expands by half final physical stroke width: 2px is
  0.5291666666666667mm, 4px is 1.0583333333333333mm. Placement does not scale
  these resolved strokes again. The page-threshold stroke is 96px = 25.4mm.
- O5 independently unions both transformed instances, preserving authored
  drawable order within each placement and distinct placement IDs. R1 reduces
  this to one group, two lines and one unrotated unit-scale placement. Removing
  the forward reference while keeping identical source geometry is a Base PASS
  control in both O5 and R1.
- O7 uses the established fixed output-font contract from #240 and its existing
  TS/Rust text fixtures: Latin advance 0.62em, Japanese advance 1em, ascent
  0.8em, descent 0.2em, line spacing 1.2em. Source size 4 at scale 1.5 gives
  font size 6; advances `[3.72,3.72]` and `[6,6]`, baselines 0 and -7.2;
  local vertical corners [-1.2,4.8] and [-8.4,-2.4]. Independently rotate and
  reflect all eight corners about the transformed anchor. The oracle never
  calls deterministicTextLayout or outputDrawableBounds.
- SVG adds margin to every side of stroke-inclusive renderedBounds. O8 uses
  7mm, so width/height each increase 14mm; contentOrigin is the expanded minimum,
  and viewBox starts at zero with the physical width/height.
- Print uses oriented A4 210x297 / A3 297x420 mm, positive usable dimensions
  `W-2o,H-2o`, ceil counts, and page origins `min-o+(column,row)*stride`.
  O9 crosses thresholds by 0.001mm. O10 has genuine 2x2 grids for A4 portrait
  and A3 landscape, with negative origins and both 10mm and 0mm inset controls.
  At 10mm inset, shared physical sheets overlap by 20mm and global shared
  guide positions coincide. Expected centers, rotations, advances, edge-only
  joining labels and page ordering are frozen independently. Zero inset has
  no guides or joining labels.

## Deduplication, scope and trials

Existing outputCore tests and historical #240/#277 were compared by assertions:
ordinary transform/arc presence, repeated placement, physical stroke, palette,
text presence/broad bounds, margin, generic page dimensions and thresholds,
labels and overlap were already covered. These are controls, not novel defects.
The new failure specifically couples canonical dependency evaluation with output
presentation order. Neither historical issue nor existing output tests asserted
forward-dependent drawable ordering inside independently transformed placements.
Current nui1 overlap semantics supersede the historical #277 formulas; no old
formula was treated as a newly discovered defect.

Twelve accepted units: O1-O10 plus R1 (reducer) and R2 (generated-occurrence
counterfactual protecting the sort). There are 23 narrow numeric/directional/
nearby PASS control variants; these are not 23 new exploration topologies.
Four of the six additional-unit slots remain unused because the closed matrix
completed, not because a family target or request quota was reached.

Before acceptance, an origin outside its target group was rejected by grammar
and moved to the group's nonzero point. Literal overlap 105 is compiler-invalid;
the legal typed runtime control exercises planner rejection. The initial negative
arc trial omitted clockwise and correctly evaluated counterclockwise; its source
was corrected to `direction: clockwise` while retaining the independent negative
sweep oracle. R2 requires `showGenerated: true`; its default-hidden trial was
replaced before acceptance. These are construction/oracle corrections, not bugs.
No specification, compiler, evaluator, Rust encoder, host or UI was edited.

Execution-order deviation: initial Base observations ran in matrix enumeration
order. Final regression replay uses deterministic SHA256 unit ordering with seed
1456; compilation stays in frozen identity order before any evaluation. This
ordering difference does not change the accepted inputs, math or Base results.

## First-owner family and regression

One new family: `resolvedPlacement` used computedGeometry Map insertion order,
which follows dependency evaluation rather than authored presentation. Base O5
and independently reduced R1 emit Later before First (both TS and real Rust);
their source geometry and bounds are correct. The smallest owner-correct repair
sorts output geometry by compiled document order and canonical generated
occurrence paths; it neither reschedules evaluation nor reorders source text.

A separate compiler-only read-back also verified that every successful retained
Base/fixed TS/Rust placement ID exactly equals its compiled place declaration ID.

Fixed O5/R1 emit First,Later within each placement. R2 remains First0,Later0,
First1,Later1,After, preserving runtime identities. Reversing the input evaluation
Map in isolated controls also produces the same fixed plan. All contaminated
units were rerun after repair. There is no new architecture or parallel planner.

## Unit ledger

For PASS rows, both Base and fixed TS/Rust values match the frozen expectation
within tolerance. The exact independent expected values are in cases.json, and
separate exact Base/fixed numeric observations are in observations.ndjson. The
bounds below are `[minX,minY,maxX,maxY]` in mm, rounded only for readability.

| Unit / control | Expected bounds | Base -> fixed | Disposition |
| --- | --- | --- | --- |
| O1 / compound | 10.735416667,-51.264583333,29.264583333,-26.735416667 | matches -> matches | PASS |
| O2 / positive | 25.485416667,18.436378561,48.514583333,33.965545228 | matches -> matches | PASS |
| O2 / negative | 25.485416667,18.436378561,48.514583333,33.965545228 | matches -> matches | PASS |
| O2 / wraparound | 25.485416667,3.436378561,41.014583333,26.465545228 | matches -> matches | PASS |
| O3 / interior | 24.892149927,-16.823240382,46.290631876,15.576780496 | matches -> matches | PASS |
| O4 / joined | 24.892149927,-16.823240382,55.152078707,15.576780496 | matches -> matches | PASS |
| O5 / forward | -57.264583333,-51.264583333,29.264583333,14.264583333 | Later,First -> First,Later; bounds match | BUG→FIXED→REPASS |
| O5 / independent | -57.264583333,-51.264583333,29.264583333,14.264583333 | matches -> matches | PASS |
| O6 / profile | -4.529166667,-65.529166667,23.529166667,-28.470833333 | matches -> matches | PASS |
| O7 / text | 24.709618943,-29.980384758,38.101923789,-12.548849428 | matches -> matches | PASS |
| O8 / svg | 14.065388767,-12.793595082,49.905914237,41.382828604 | matches -> matches | PASS |
| O9 / a4-portrait-threshold | -46.700000000,-55.700000000,143.300000000,-30.300000000 | matches -> matches; 1x1 | PASS |
| O9 / a4-portrait-crossing | -46.700000000,-55.700000000,143.301000000,-30.300000000 | matches -> matches; 2x1 | PASS |
| O9 / a3-landscape-threshold | -46.700000000,-55.700000000,353.300000000,-30.300000000 | matches -> matches; 1x1 | PASS |
| O9 / a3-landscape-crossing | -46.700000000,-55.700000000,353.301000000,-30.300000000 | matches -> matches; 2x1 | PASS |
| O9 / invalid-usable | 32.735416667,-19.264583333,33.264583333,-16.735416667 | reject unusable width -> same rejection | PASS |
| O10 / a4-portrait-overlap10 | -83.264583333,-86.264583333,167.264583333,254.264583333 | matches -> matches; 2x2 | PASS |
| O10 / a4-portrait-overlap0 | -83.264583333,-86.264583333,167.264583333,254.264583333 | matches -> matches; 2x2 | PASS |
| O10 / a3-landscape-overlap10 | -83.264583333,-86.264583333,367.264583333,264.264583333 | matches -> matches; 2x2 | PASS |
| O10 / a3-landscape-overlap0 | -83.264583333,-86.264583333,367.264583333,264.264583333 | matches -> matches; 2x2 | PASS |
| R1 / forward | 1.735416667,5.735416667,14.264583333,15.264583333 | Later,First -> First,Later; bounds match | BUG→FIXED→REPASS |
| R1 / independent | 1.735416667,5.735416667,14.264583333,15.264583333 | matches -> matches | PASS |
| R2 / generated-order | -3.264583333,3.735416667,57.264583333,14.264583333 | matches -> matches | PASS |

## Sensitivity and actual Rust coverage

Isolated copied plans are deliberately corrupted and must fail the independent
assertions: mirror/rotation order, omitted arc cardinal/cubic interior extrema,
reversed joined segments, omitted half-stroke, double-scaled physical stroke,
profile-hidden leakage, lost text reflection, omitted SVG margin/dimensions or
content origin, floor page count, missing tile inset, incorrect overlap stride,
noncoincident shared guides and mismatched joining labels. These are test
controls, never faults injected into product source.

All 12 units / all 23 accepted variants are normally Rust-eligible and exercised
both actual Rust evaluate_document (the existing evaluate_fixture transport) and
TS reference evaluation, with the production context, prepareRustEvaluation,
evaluateOutputPlan and buildOutputPlan boundaries. O6 additionally compares
common/profile source geometry and visibility in both engines. Rust calls are
per-process finite invocations with 30s timeouts, bounded buffers and synchronous
process cleanup; the cargo build has a 120s limit. No persistent process is left.

This does not verify final Rust SVG/PDF encoding. No native GUI E2E was performed
or required. No dependencies or tests/lint rules were weakened.

Focused tests: 26 existing plus 23 campaign variants PASS, including real Rust.
The settled executable candidate passed the supplied final block verbatim and in
order (exit 0):

1. `npm test -- src/output/outputCore.test.ts --maxWorkers=2`: 26 PASS.
2. `npm run build`: PASS.
3. `npm run lint`: PASS.
4. `npm run test:parity`: 203 PASS.
5. `npm test -- --maxWorkers=2`: 686 files PASS, 2 files skipped;
   11,015 tests PASS, 183 skipped (repository-authored gates).
6. `git diff --check`: PASS.

No required command was omitted. Full parity is regression coverage, not final
Rust encoder verification. This results-only documentation update follows those
checks; no executable source or fixture inputs changed afterward.

Replay the campaign including actual Rust evaluation with:

```sh
ISSUE1456_RUST=1 npm test -- src/output/outputCore.issue1456.test.ts --maxWorkers=1
```

Ordinary full-suite execution also runs the 23 campaign variants through TS;
Rust is explicitly enabled for the dedicated campaign replay above.

Residual findings: none within the closed scope. Skipped owner checks: Rust
fmt/check/test/clippy and native packaging/GUI are not required because no such
source or boundary changed. Required TypeScript gates are not skipped.
Human-observed weekly remaining-plan readings and usage per fixed family:
UNAVAILABLE (no before/after Human observations supplied).
