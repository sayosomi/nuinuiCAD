# Coverage and remaining work

This is a manual reconciliation of Samples 001–088 against the current [normative nui 1 specification](../docs/nui1/spec.md), [DSL landing page](../docs/dsl.md), [English reference](../docs/dsl/en/index.md) and implementation at Base `44c5bc028967b3ad776765198deaa5478966562d`. It is not generated completeness evidence. The [index](README.md) separates compiler/Rust verification, actual Canvas observations and outstanding acceptance; [history](HISTORY.md) preserves Human feedback.

## Implemented examples

| Public surface | Samples | Demonstrated forms |
| --- | --- | --- |
| Point coordinate, offset, polar, between, intersection | 001–005 | Coordinates, scalar inputs, relative/angle-distance construction, ratio, intersection |
| Line polar, offset, polyline, join | 006–010 | Straight polar line, left parallel offset, open/closed polyline, joined path with hidden inputs |
| Arc and Bezier | 011–015 | Counterclockwise arc, three-point arc, rounded corner, endpoint handles and intermediate knot |
| Split, copies and transformations | 016–025 | Split, translated/reflected copies, onLine ratio, tangent offset, move, mirrorMove, reverse, extend and edge |
| Labels and geometry queries | 026–033, 059, 076, 086 | Anonymous text/interpolation, Bezier extreme/bulge, external common tangent, point/line/path from, input-member and length/endpoint properties, pure geometry materialization |
| Numeric builtins | 034–054 | distance, angle, lineDistance, lineAngle, spreadAngle, roundTo, round, floor, ceil, isClose, abs, min, max, sqrt, sin, cos, tan, asin, acos, atan, atan2 |
| Choice conversion and constant | 055–056 | string(choice), pi |
| Optional values | 057–058, 082 | some/none match branches, present optional path member, null coalescing; 058 returns 70 after #1606 |
| Collections and records | 060–062, 083–084, 088 | Indexing, number-array value-for, nominal record fields, array-valued if/match, imported record; **088 GUI remains blocked** |
| Scalar and statement control flow | 063–067 | Scalar if/choice-match, conditional drawables, inclusive range-for with visible generated marks, collection carry/next accumulation |
| Layers, groups, Modules and imports | 068–070, 077, 085, 087 | Named source layers, Module parameters/exports/two instances, relative Module import, group namespace, source-order-independent dependencies, Module re-export |
| Styles and extract | 071–072 | Dashed Style, named line intervals with one translated part |
| Output and views | 073, 078 | Layout/place, print/svg selecting finished, A4 portrait/overlap and SVG margin, role/view/activeView |
| Authoring syntax and metadata | 074–075 | Number step/min/max, multiline scalar continuations |
| Operators and pure values | 079–082, 086 | Representative arithmetic, remainder/power, comparisons, conjunction/negation, optional fallback and pure geometry |

The collection uses **31 of 32 construction catalog entries by form**; `image/image` is absent. It uses **all 22 builtin function names and pi**, but not every overload, branch or parameter mode. These are name/form counts, not an assertion of complete language coverage. The supporting `import-panel-lib.nui` and `record-settings-lib.nui` are bundled dependencies, not two extra independent samples.

All 33 generated statement spellings except `image` occur across the examples/dependencies; `layer` is also demonstrated. A spelling occurring once does not exercise all of its legal contexts or semantics. 088's imported-record source compiles and evaluates, but its actual Canvas is empty, so this feature does not have a completed GUI example.

## Remaining public DSL gaps

These are still in Issue #1596's public-language scope, but outside the authorized 045–088 restoration slice. They require future normal examples and existing verification, not a new sample framework.

| Reference surface | Remaining normal-example coverage |
| --- | --- |
| [Syntax](../docs/dsl/en/syntax.md) | Unicode identifiers, block/documentation comments, import/re-export chains and additional namespace boundaries; quoted/string escape forms |
| [Types](../docs/dsl/en/types.md), [expressions](../docs/dsl/en/expressions.md) | Empty/optional collections and collections nested in record fields, array length, non-number collections, geometry/choice/record collection values, additional optional none/member paths, exact nominal typing and line-to-path assignability |
| [Operators and builtins](../docs/dsl/en/builtins.md) | Full operator set/precedence and short-circuit branches (including `or`), negative/quadrant variants, two-argument floor/ceil precision forms and other non-default valid modes; name coverage alone is insufficient |
| [Control flow](../docs/dsl/en/control-flow.md), [declarations](../docs/dsl/en/declarations.md) | Statement else, empty and non-unit range behavior, nested loops/scopes, explicit occurrence selectors, geometry/record value-if/match, non-number maps, multiple/nested carries and optional/collection carries |
| [Records](../docs/dsl/en/records.md) | Defaults and metadata/descriptions, nested record/optional/collection fields, record-valued control flow and mapped records; **088 actual Canvas/PNG acceptance unresolved** |
| [Modules](../docs/dsl/en/modules.md) | Geometry and structured-value parameters/exports, default and optional arguments, nested Modules/scopes, chained re-export consumers, instance activity, documentation locale/access rules |
| [Constructions](../docs/dsl/en/constructions.md) | Image with bundled non-private asset; between/onLine distance modes; intersection index/extensions; curved/closed offsets and trim settings; transform rotation/scale/mirror; clockwise arcs; multiple knots/non-default segment/direction; tangentOffset curveSide; supported concrete arc/Bezier split/extend/edge variants |
| [Modifiers](../docs/dsl/en/modifiers.md) | Default-layer membership behavior, multi-Style/ancestor cascade, dotted/color/fill/opacity variants, direct versus inherited visible/enabled gates and instance gates |
| [Output](../docs/dsl/en/output.md) | Non-default layout/place origins, transforms and scale; multiple placements/layer selectors and empty selection; A3/landscape, tiled multi-page and zero-overlap print, SVG/print variants and physical output inspection |
| [Geometry properties and recipes](../docs/nui1/spec.md) | Remaining numeric/geometry properties, generated selectors and immutable captured recipe prefixes before/after transformations |

No public mode is removed from scope because it lacks an example. Intentional error fixtures are not official examples. A mismatch with the normative contract must be reported and resolved in its own authorized product work; sample authoring does not authorize changing evaluation semantics.

## Acceptance boundary

001–044 were integrated in PR #1605. This next slice restores 045–088 and two libraries, verifies their current source, and adds **43** authentic PNGs. The old incorrect 058 image is excluded and replaced by an actual 70 mm capture. Sample 066 enables `showGenerated` to display its five marks. 088 remains a reproducible, compiler/Rust-verified **GUI BLOCKED** candidate with no canonical PNG.

Independent exact-pushed-HEAD review and required PR CI remain outstanding for this slice. Formal Human Manual E2E has not been performed. Further examples must use a separately reconciled slice and applicable admission; neither this checkpoint nor the 88 sample numbers completes Issue #1596.
