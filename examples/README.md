# Official nui 1 examples

Open any `.nui` file below in VS Code with nuinuiCAD, then run **nuinuiCAD: Open Canvas**. Edit the constants near the top to explore the construction. Coordinates and lengths use millimetres; positive Y points upward. Each numbered file is a complete document. Samples 070 and 087 require the adjacent `import-panel-lib.nui`; Sample 088 requires `record-settings-lib.nui`. Keep these relative dependencies beside the downloaded source.

The collection contains Samples **001–088** and two supporting libraries. Samples 001–044 were integrated in [PR #1605](https://github.com/sayosomi/nuinuiCAD/pull/1605). The restored 045–088 slice has compiler/Rust verification; **43 of its 44 samples have an accepted Canvas PNG**. Sample 088 remains **GUI BLOCKED**, as described below. This slice awaits independent pushed-HEAD review and normal PR/CI integration. Download a source file to edit it; an adjacent PNG shows its initial Canvas appearance. [Historical Human feedback](HISTORY.md) and [remaining language coverage](COVERAGE.md) are tracked separately.

## Verification key

**A** = the source compiled successfully through the existing production compiler boundary, evaluated through Rust without evaluation errors or warnings, and has an inspected authentic Canvas PNG. The imported examples use the existing multi-document graph/runtime context. **B** = compiler/Rust verified, but the actual Canvas did not show the expected drawing; no canonical PNG is supplied. It is **agent verification**, not independent review or formal Human Manual E2E. All text declarations are unnamed.

Every accepted capture used **Point Names**, **Geometry Names** and **Direction Arrows** simultaneously ON. A text-only example has no point/path labels or arrows to display; the toggles are still ON. No geometry or labels were painted into the images. All PNGs encode the original captured pixels without resizing, compositing or repainting; decoded pixel equality was checked after JPEG-to-PNG encoding.

For 001–044, five captures were recovered and 39 were taken during the first slice. For 045–088, the 15 preserved original JPEGs were located and inspected: 14 were accepted (045–057 and 059), while the old 058 capture showed the pre-#1606 incorrect value and was excluded. Another **29** accepted captures were taken in the isolated VS Code Extension Development Host during this slice, including corrected 058. Original captures remain outside the repository. 070 and 087 were manually zoomed to make the imported Edge legible. 088's blank-Canvas observation is retained as blocker evidence, not published as a successful example image.

## Index

| No. | Source | Purpose | Expected initial observation | Canvas | Status |
| --- | --- | --- | --- | --- | --- |
| 001 | [coordinate.nui](coordinate.nui) | Point coordinates | A=(0,0), B=(60,0), horizontal AB=60 mm. | [PNG](coordinate.png) | A |
| 002 | [point-offset.nui](point-offset.nui) | Point offset | A=(0,0), B=(40,20); changing dx/dy moves B. | [PNG](point-offset.png) | A |
| 003 | [point-polar.nui](point-polar.nui) | Point polar | B is 60 mm from A at 45 degrees. | [PNG](point-polar.png) | A |
| 004 | [between.nui](between.nui) | Between ratio | A=(0,0), B=(80,0), C=(32,0), ratio=0.4. | [PNG](between.png) | A |
| 005 | [intersection.nui](intersection.nui) | Intersection | AB and CD meet at P=(25,0). | [PNG](intersection.png) | A |
| 006 | [line-polar.nui](line-polar.nui) | Line polar | AB starts at A; length 80 mm, angle 30 degrees. | [PNG](line-polar.png) | A |
| 007 | [line-offset.nui](line-offset.nui) | Line offset | Base at y=0; left Offset at y=10. | [PNG](line-offset.png) | A |
| 008 | [polyline.nui](polyline.nui) | Open polyline | A–B–C is an open L; height=40. | [PNG](polyline.png) | A |
| 009 | [polyline-closed.nui](polyline-closed.nui) | Closed polyline | Closed quadrilateral A=(0,0), B=(80,0), C=(80,70), D=(0,50); D–A closes automatically. | [PNG](polyline-closed.png) | A¹ |
| 010 | [join.nui](join.nui) | Join | Only Joined is drawn over hidden input lines; visible A/B/C. | [PNG](join.png) | A |
| 011 | [arc.nui](arc.nui) | Arc | Radius 40, 0→120 degrees counterclockwise about Center. | [PNG](arc.png) | A |
| 012 | [through.nui](through.nui) | Through arc | Upper semicircle; A=(40,0), B=(24,32), C=(-40,0). | [PNG](through.png) | A |
| 013 | [corner.nui](corner.nui) | Rounded corner | 12 mm corner between Bottom and Right. | [PNG](corner.png) | A |
| 014 | [bezier.nui](bezier.nui) | Bezier endpoint handles | A=(0,0) to B=(100,0), start 60/end 120, 35 mm handles; actual S-like curve. | [PNG](bezier.png) | A |
| 015 | [bezier-knot.nui](bezier-knot.nui) | Bezier knot | Wave passes through Mid=(40,30); endAngle=300/endLength=20. | [PNG](bezier-knot.png) | A |
| 016 | [split.nui](split.nui) | Split | Source retains A→Cut; Far continues Cut→B; cut_x=35. | [PNG](split.png) | A |
| 017 | [transform-copy.nui](transform-copy.nui) | Transform copy | Base at y=0, Copy translated to y=40. | [PNG](transform-copy.png) | A |
| 018 | [mirror-copy.nui](mirror-copy.nui) | Mirror copy | Base reflected across x=0; original retained. | [PNG](mirror-copy.png) | A |
| 019 | [point-on-line.nui](point-on-line.nui) | Point on line | OnLine at x=30 on the 100 mm Base. | [PNG](point-on-line.png) | A |
| 020 | [point-tangent-offset.nui](point-tangent-offset.nui) | Tangent offset | Raised=(30,30) above Anchor; Guide connects them. | [PNG](point-tangent-offset.png) | A |
| 021 | [move.nui](move.nui) | Move | Original y=0, Shifted y=40; both length 80. | [PNG](move.png) | A |
| 022 | [mirror-move.nui](mirror-move.nui) | Mirror move | Original remains right of the vertical axis; Reflected moves left. | [PNG](mirror-move.png) | A |
| 023 | [reverse.nui](reverse.nui) | Reverse | Forward start=(0,0); Reversed start=(80,40), opposite arrows. | [PNG](reverse.png) | A |
| 024 | [extend.nui](extend.nui) | Extend | Base ends at Target=(80,0); original B remains at (50,0). | [PNG](extend.png) | A |
| 025 | [edge.nui](edge.nui) | Edge | Horizontal end and Vertical start meet at (60,0). | [PNG](edge.png) | A |
| 026 | [label.nui](label.nui) | Label | Unnamed text nuinuiCAD at (0,0), size=12. | [PNG](label.png) | A |
| 027 | [label-template.nui](label-template.nui) | Interpolated label | 80 mm Base and Width = 80 mm. | [PNG](label-template.png) | A |
| 028 | [bezier-extreme-point.nui](bezier-extreme-point.nui) | Bezier extreme point | Highest marks the 90-degree extreme of the revised Arch. | [PNG](bezier-extreme-point.png) | A |
| 029 | [bezier-bulge-point.nui](bezier-bulge-point.nui) | Bezier bulge point | Bulge marks maximum unsigned distance from the A–B chord. | [PNG](bezier-bulge-point.png) | A |
| 030 | [common-tangent.nui](common-tangent.nui) | Common tangent | Two full circles at spacing=100; left external tangent. | [PNG](common-tangent.png) | A |
| 031 | [line-from.nui](line-from.nui) | Line from | Copy follows hidden Source, ending at (80,30). | [PNG](line-from.png) | A |
| 032 | [point-from.nui](point-from.nui) | Point from | Copy=(40,20) at the visible Reference endpoint. | [PNG](point-from.png) | A |
| 033 | [path-from.nui](path-from.nui) | Path from | Copy follows the hidden Bezier; Chord shows its endpoints. | [PNG](path-from.png) | A |
| 034 | [distance.nui](distance.nui) | Distance | A=(0,0), B=(30,40), label Distance = 50 mm. | [PNG](distance.png) | A |
| 035 | [angle.nui](angle.nui) | Angle | B=(40,40); label Angle = 45 deg. | [PNG](angle.png) | A |
| 036 | [line-distance.nui](line-distance.nui) | Line distance | Probe 30 mm above Baseline; label Line distance = 30 mm. | [PNG](line-distance.png) | A |
| 037 | [line-angle.nui](line-angle.nui) | Line angle | Horizontal and Sloped meet; label Line angle = 45 deg. | [PNG](line-angle.png) | A |
| 038 | [spread-angle.nui](spread-angle.nui) | Spread angle | Radius=50, chord=50, central angle approximately 60 degrees. | [PNG](spread-angle.png) | A |
| 039 | [round-to.nui](round-to.nui) | Round to step | 42 rounds to 40 in steps of 5; two lines compare lengths. | [PNG](round-to.png) | A |
| 040 | [round.nui](round.nui) | Round | 4.6 rounds to 5; Result length=50. | [PNG](round.png) | A |
| 041 | [floor.nui](floor.nui) | Floor | 4.9 floors to 4; Result length=40. | [PNG](floor.png) | A |
| 042 | [ceil.nui](ceil.nui) | Ceil | 4.1 ceils to 5; Result length=50. | [PNG](ceil.png) | A |
| 043 | [is-close.nui](is-close.nui) | Is close | 53 is within 5 of 50; label true. | [PNG](is-close.png) | A |
| 044 | [abs.nui](abs.nui) | Absolute value | Offset y=-30; magnitude=30; label abs(-30) = 30. | [PNG](abs.png) | A |
| 045 | [min.nui](min.nui) | Minimum of two lengths | Lines 60, 40 and 40 mm; min = 40 mm. | [PNG](min.png) | A |
| 046 | [max.nui](max.nui) | Maximum of two lengths | Lines 40, 60 and 60 mm; max = 60 mm. | [PNG](max.png) | A |
| 047 | [sqrt.nui](sqrt.nui) | Square root | 30 by 40 mm triangle; hypotenuse = 50 mm. | [PNG](sqrt.png) | A |
| 048 | [sin.nui](sin.nui) | Sine in degrees | 40 * sin(30) gives Height = 20 mm. | [PNG](sin.png) | A |
| 049 | [cos.nui](cos.nui) | Cosine in degrees | 40 * cos(60) gives Horizontal = 20 mm. | [PNG](cos.png) | A |
| 050 | [tan.nui](tan.nui) | Tangent in degrees | 40 * tan(45) gives Rise = 40 mm. | [PNG](tan.png) | A |
| 051 | [asin.nui](asin.nui) | Inverse sine | asin(0.5) = 30 degrees; matching arc. | [PNG](asin.png) | A |
| 052 | [acos.nui](acos.nui) | Inverse cosine | acos(0.5) = 60 degrees; matching arc. | [PNG](acos.png) | A |
| 053 | [atan.nui](atan.nui) | Inverse tangent | Slope 1; atan = 45 degrees. | [PNG](atan.png) | A |
| 054 | [atan2.nui](atan2.nui) | Quadrant-aware angle | atan2(40,40) = 45 degrees. | [PNG](atan2.png) | A |
| 055 | [string-choice.nui](string-choice.nui) | Choice to string | Unnamed label side = right. | [PNG](string-choice.png) | A |
| 056 | [pi.nui](pi.nui) | Pi constant | Radius-20 circle; circumference = 125.66 mm, rounded. | [PNG](pi.png) | A |
| 057 | [optional-match.nui](optional-match.nui) | Optional pattern match | Present string selects some; name = front. | [PNG](optional-match.png) | A |
| 058 | [optional-member.nui](optional-member.nui) | Optional geometry property | Present optional path length = 70 mm after #1606. | [PNG](optional-member.png) | A |
| 059 | [input-reference.nui](input-reference.nui) | Construction-input member | B.input.from resolves A; C=(0,30). | [PNG](input-reference.png) | A |
| 060 | [array-index.nui](array-index.nui) | Array indexing | Zero-based index 1 selects width = 20 mm. | [PNG](array-index.png) | A |
| 061 | [array-value-for.nui](array-value-for.nui) | Array mapping | Doubled array [20,40,60]; index 1 gives 40. | [PNG](array-value-for.png) | A |
| 062 | [record.nui](record.nui) | Nominal record fields | selected.x = 30; label front = 30. | [PNG](record.png) | A |
| 063 | [value-if.nui](value-if.nui) | Scalar if expression | wide=true selects width = 80 mm. | [PNG](value-if.png) | A |
| 064 | [value-match.nui](value-match.nui) | Choice match expression | small selects width = 40 mm. | [PNG](value-match.png) | A |
| 065 | [statement-if.nui](statement-if.nui) | Conditional drawing | Baseline and vertical Mark at x=28. | [PNG](statement-if.png) | A |
| 066 | [statement-for.nui](statement-for.nui) | Range and generated occurrences | Five marks at x=0,10,20,30,40; showGenerated=true. | [PNG](statement-for.png) | A |
| 067 | [carry-next.nui](carry-next.nui) | Immutable carry accumulation | Collection [1,2,3] yields total = 6. See lint note below. | [PNG](carry-next.png) | A |
| 068 | [layer.nui](layer.nui) | Named source layers | Construction at y=0; Outline at y=20; separate toggles. | [PNG](layer.png) | A |
| 069 | [module-instance.nui](module-instance.nui) | Module parameters and exports | Tips at x=20 and 50; Spacing = 30 mm. | [PNG](module-instance.png) | A |
| 070 | [import-panel.nui](import-panel.nui) | Relative Module import | Bundled Panel creates Front::Edge = 60 mm. | [PNG](import-panel.png) | A |
| 071 | [style.nui](style.nui) | Reusable drawing Style | Reference solid; Dashed at y=20 dashed. | [PNG](style.png) | A |
| 072 | [extract.nui](extract.nui) | Named path intervals | lower covers 0..40; upper covers 40..100 at y=20. | [PNG](extract.png) | A |
| 073 | [layout-print-svg.nui](layout-print-svg.nui) | Layout and physical outputs | 100 mm Outline; finished layer in SVG and A4 print. | [PNG](layout-print-svg.png) | A |
| 074 | [numeric-step.nui](numeric-step.nui) | Numeric editor metadata | 12.5 mm Result; step=0.5, min=0, max=20. | [PNG](numeric-step.png) | A |
| 075 | [multiline-expression.nui](multiline-expression.nui) | Multiline scalar expressions | length=50, doubled=100; Result = 100 mm. | [PNG](multiline-expression.png) | A |
| 076 | [geometry-properties.nui](geometry-properties.nui) | Length and endpoint properties | AB.length = 50 mm; copied endpoints match AB. | [PNG](geometry-properties.png) | A |
| 077 | [group-namespace.nui](group-namespace.nui) | Qualified group reference | Copy follows hidden Front::Edge; 60 mm. | [PNG](group-namespace.png) | A |
| 078 | [role-view.nui](role-view.nui) | Roles and active view | Draft shows Base; WithSeam also enables Seam. | [PNG](role-view.png) | A |
| 079 | [numeric-operators.nui](numeric-operators.nui) | Arithmetic, remainder and power | 20*2 + (20%3) + 2^3 = 50. | [PNG](numeric-operators.png) | A |
| 080 | [comparison-operators.nui](comparison-operators.nui) | Numeric comparison | 55 >= 50 is true; Width = 55 mm. | [PNG](comparison-operators.png) | A |
| 081 | [logical-operators.nui](logical-operators.nui) | Boolean conjunction and negation | width=60 and enabled=true give acceptable=true. | [PNG](logical-operators.png) | A |
| 082 | [optional-coalescing.nui](optional-coalescing.nui) | Optional fallback | none ?? 50 gives Result = 50 mm. | [PNG](optional-coalescing.png) | A |
| 083 | [array-value-if.nui](array-value-if.nui) | Array-valued if | wide=true selects [40,60]; index 1 gives 60. | [PNG](array-value-if.png) | A |
| 084 | [array-value-match.nui](array-value-match.nui) | Array-valued match | small selects [20,30]; index 1 gives 30. | [PNG](array-value-match.png) | A |
| 085 | [forward-reference.nui](forward-reference.nui) | Dependency-based source order | AB resolves later A/B declarations; length = 70 mm. | [PNG](forward-reference.png) | A |
| 086 | [geometry-value.nui](geometry-value.nui) | Pure geometry and materialization | Const geometry stays non-drawable; Copy = 60 mm. | [PNG](geometry-value.png) | A |
| 087 | [module-reexport.nui](module-reexport.nui) | Imported Module re-export | Re-exports lib::Panel; Front::Edge = 60 mm. | [PNG](module-reexport.png) | A |
| 088 | [record-import.nui](record-import.nui) | Imported nominal record | Compiler/Rust: Seam = 5 mm and label seam width = 5. Actual Canvas blank; GUI BLOCKED. | **Missing — GUI BLOCKED** | B |

¹ Sample 009 now has a sloped top edge so C and the Outline midpoint arrow/name remain separate. Its historical Human PASS belongs to the previous rectangle, not this geometry revision. See [history](HISTORY.md).

## Supporting libraries

[import-panel-lib.nui](import-panel-lib.nui) exports Panel for 070/087; [record-settings-lib.nui](record-settings-lib.nui) exports SeamSettings for 088. They are dependencies, not separately numbered samples or screenshot targets.

## Verification checkpoint

The 045–088 slice uses Base `44c5bc028967b3ad776765198deaa5478966562d`, including merged [#1606 / PR #1607](https://github.com/sayosomi/nuinuiCAD/pull/1607). Verification calls existing compiler, multi-document and Rust APIs directly; no sample-specific parser, evaluator, test framework or coverage generator was added.

- All **88 numbered sources and two libraries** compile and evaluate through the applicable production boundaries without compile errors or evaluation errors/warnings. The current slice contributes **44** numbered samples and two libraries.
- Sample 058 produces the actual text `length = 70 mm`, including on Canvas. Sample 066 explicitly enables `showGenerated` so its five marks appear.
- One source-lint warning remains: 067's `values` is reported unused even though the collection loop reads it. Rust returns total=6; the same warning was observed in VS Code Problems. This is not an evaluation failure and was not suppressed or repaired in product code.
- **87 accepted Canvas PNGs total**, including **43** for this slice. All were visually inspected. 088 has no PNG and is not presented as a completed drawable example.
- Sample 073's existing output planner, supplied with Rust evaluation, produces one 100 mm line in both outputs, a one-page A4 portrait plan with 10 mm overlap, and SVG margin 5 mm. No physical printing or formal Human output test is claimed.
- `npm run docs:dsl:check`, `npm run build`, `npm run lint`, `npm run build:vscode`: PASS.
- Focused #1606 regression: **27 tests PASS**. Snapshot/evaluation/Canvas regression: **137 tests PASS**.
- `npm test`: **757 files / 13,132 tests PASS**; 3 files / 188 tests skipped.
- `npm run test:parity`: **231 tests PASS**. `npm run test:stress:lifecycle`: **20/20 iterations PASS**, 9 tests each.
- Rust `cargo fmt --check`, `cargo check`, `cargo test`, `cargo clippy --all-targets -- -D warnings` with `--manifest-path rust-evaluator/Cargo.toml`: PASS; **666 tests passed**, 13 ignored.
- Existing CI helper tests: **98 PASS**. Example paths select full Node, VS Code, Rust and parity coverage. Required remote CI runs on a PR/main, not topic-branch push; PR CI and independent exact-pushed-HEAD review remain pending.
- Formal Human Manual E2E: **not performed**. Historical dogfood feedback does not establish that result.

## Sample 088 GUI blocker

`record-import.nui` is valid under the existing multi-document compiler and production Rust evaluator, which return a 5 mm Seam and `seam width = 5`. In the actual VS Code Extension Development Host at this Base, its Canvas remained empty with all three required display toggles ON. Reopening from saved source, fitting/resetting/zooming, and reloading the dedicated window did not reveal either drawable; VS Code Problems showed no source error for this file. This is an unresolved host observation, not an established root-cause diagnosis. Its source and bundled library are retained for reproduction, with **no accepted PNG**. Product fixes are outside #1596 sample authoring.

This pushed slice is a reviewable checkpoint, not completion of Issue #1596. Resolve 088's GUI observation, obtain its authentic PNG, complete independent review and required PR CI, and address the public DSL gaps in [COVERAGE.md](COVERAGE.md) through later authorized work.
