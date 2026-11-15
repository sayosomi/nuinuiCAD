# Official nui 1 examples

Open any `.nui` file below in VS Code with nuinuiCAD, then run **nuinuiCAD: Open Canvas**. Edit the constants near the top to explore the construction. Coordinates and lengths use millimetres; positive Y points upward. Each file is a complete, independent document with no external dependencies.

This first slice contains Samples **001–044**. Download a source file to edit it; the adjacent PNG shows its initial Canvas appearance. The collection is still awaiting independent review and normal PR/CI integration. [Historical Human feedback](HISTORY.md) and [remaining language coverage](COVERAGE.md) are tracked separately.

## Verification key

**A** = the current source compiled successfully through the existing production document boundary, evaluated through Rust without errors or warnings, and has an inspected authentic Canvas PNG. It is **agent verification**, not independent review or formal Human Manual E2E. All text declarations are unnamed.

Every capture used **Point Names**, **Geometry Names** and **Direction Arrows** simultaneously ON. A text-only example has no point/path labels or arrows to display; the toggles are still ON. No geometry or labels were painted into the images. Five valid screenshots (001–005) were reused from the Human-designated backup; the remaining 39 were captured in the resumed implementation session. The recovered 006 image was retaken because its endpoint was behind the Layers panel. The screenshot API supplied JPEG-encoded captures, including the recovered files; all final files are PNG encodings of those captured pixels, with decoded pixel equality checked. No resizing, compositing or repainting was performed.

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

¹ Sample 009 now has a sloped top edge so C and the Outline midpoint arrow/name remain separate. Its historical Human PASS belongs to the previous rectangle, not this geometry revision. See [history](HISTORY.md).

## Verification checkpoint

Validation uses the repository's existing compiler, production Rust document evaluation, normal tests/build and CI helpers; no sample-specific parser, evaluator, test framework or coverage generator is introduced. The snapshot/evaluation API was called directly for these files without adding a new test harness.

- Sources: **44 valid**, production Rust evaluation **44 successful**, no diagnostics/errors/warnings.
- Canvas images: **44 present and visually inspected**.
- `npm run docs:dsl:check`, `npm run build`, `npm run lint`: PASS.
- `npm test -- --maxWorkers=2`: PASS, 756 files / 13,105 tests; 3 files / 188 tests skipped. This normal full suite limits worker concurrency without changing assertions or timeouts.
- `npm run test:parity -- --maxWorkers=1`: PASS, 3 files / 231 tests.
- `npm run test:stress:lifecycle`: PASS, 20/20 iterations, 9 tests each.
- Rust `cargo fmt --check`, `cargo check`, `cargo test`, `cargo clippy --all-targets -- -D warnings` (all with `--manifest-path rust-evaluator/Cargo.toml`): PASS; 665 tests passed, 13 ignored.
- The literal script `npm run docs:dsl` does not exist; the repository's supported `docs:dsl:check` was used. No reference generation or DSL implementation change was needed.
- CI's change classifier selects full Node, VS Code, Rust and parity coverage for the new example paths. Local classifier/notification helper tests passed. The CI `nextest` runner is unavailable locally; ordinary Cargo tests passed. Remote required CI remains a PR gate.
- Independent blocking review and formal Human Manual E2E: **not performed**. Historical dogfood feedback must not be used as either result.

This slice does not complete Issue #1596. Samples 045–088 and additional uncovered modes remain sequential follow-up work after the integration checkpoint and fresh applicable admission.
