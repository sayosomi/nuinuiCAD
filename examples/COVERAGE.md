# Coverage and remaining work

This is a manually maintained reconciliation of Samples 001–044 with the current [normative nui 1 specification](../docs/nui1/spec.md), [DSL landing page](../docs/dsl.md), [English reference](../docs/dsl/en/index.md) and production compiler at Base `6e14aa4a6fd3511fdb59031869407f52bea89005`. It is not a generated completeness assertion. See the [index](README.md) for usable sources and the [history](HISTORY.md) for Human feedback.

## Current slice

| Public construction family | Samples | What is demonstrated |
| --- | --- | --- |
| point/coordinate, offset, polar, between, intersection | 001–005 | Coordinates, scalar inputs, relative/angle-distance construction, ratio and intersection |
| line/polar, offset, polyline, join | 006–010 | Straight polar line, left parallel offset, open/closed polyline, joined path with hidden inputs |
| arc/arc, through, corner | 011–013 | Counterclockwise arc, three-point semicircle, rounded connection |
| curve/bezier | 014–015 | Endpoint handles and ordered intermediate knot |
| line/split, transformCopy, mirrorCopy | 016–018 | Mutating split and independent translated/reflected copies |
| point/onLine, tangentOffset | 019–020 | Ratio on a line and explicit tangent-angle offset |
| move, mirrorMove, reverse, extend, edge | 021–025 | Translation, reflection, reversed traversal, endpoint extension and coupled trimming |
| text/label | 026–027 | Unnamed text, size and scalar interpolation |
| point/bezierExtremePoint, bezierBulgePoint | 028–029 | Default cubic segment's direction extreme and maximum unsigned chord bulge |
| line/commonTangent | 030 | External common tangent, left side |
| line/from, point/from, path/from | 031–033 | Materialized geometry references, endpoint reference and generic path reference |

These sources exercise **31 of the reference's 32 construction catalog entries by form**: all ten point forms, all ten line forms, path/from, curve/bezier, all three arc forms, text/label and five transformations. **image/image is absent.** A catalog entry occurring once does not cover every mode, overload or parameter combination.

The dedicated calculation examples are distance (034), angle (035), lineDistance (036), lineAngle with explicit endpoints (037), spreadAngle (038), roundTo (039), round (040), floor (041), ceil (042), isClose (043) and abs (044). sin/cos occur incidentally in 038. Thus **13 of 22 builtin function names** occur; min, max, sqrt, tan, asin, acos, atan, atan2 and string do not. The builtin constant pi is also absent.

The files also exercise `nui 1`, ordinary comments, multiline named arguments, typed number/boolean constants, arithmetic, `@` references, endpoint selectors, text interpolation and `visible: false`. This is not dedicated coverage of all syntax, types, expression rules or statements.

## Existing later drafts — not implemented here

All later numbers remain **AUTHOR_DRAFT / NOT_RUN**. No draft is promoted to Human PASS, compiler success or exhaustive coverage merely because it was proposed.

| Numbers | Proposed themes | Existing source proposals |
| --- | --- | --- |
| 045–056 | min, max, sqrt, sin, cos, tan, asin, acos, atan, atan2, string(choice), pi | [Issue batch](https://github.com/sayosomi/nuinuiCAD/issues/1596#issuecomment-6877118664) |
| 057–068 | optional match/member, input reference, array index/value-for, record, value-if/match, statement-if/for, carry/next, layer | [Issue batch](https://github.com/sayosomi/nuinuiCAD/issues/1596#issuecomment-6877144104) |
| 069–076 | module/instance, relative import, style, extract, layout/print/svg, numeric step, multiline expression, geometry properties | [Issue batch](https://github.com/sayosomi/nuinuiCAD/issues/1596#issuecomment-6877171498) |
| 077–088 | group namespace, role/view, numeric/comparison/logical operators, optional coalescing, array-if/match, forward reference, geometry value, re-export, imported record | [Issue batch](https://github.com/sayosomi/nuinuiCAD/issues/1596#issuecomment-6877193481) |

The proposed `import-panel-lib.nui` and `record-settings-lib.nui` are supporting dependencies, not extra independent sample numbers. They are not included in this first slice. 045 min() has no Human verdict.

## Remaining reference reconciliation

The old [inventory](https://github.com/sayosomi/nuinuiCAD/issues/1596#issuecomment-6875137168) counted 33 statement spellings, 32 construction entries, 22 functions and pi. The current reference also documents `layer` separately. Those identities are a starting inventory, not an 88-file limit or proof that draft numbers 001–088 exhaust the public language. The old proposal's special coverage generator and sample oracle CI were superseded by the current Issue contract.

| Reference surface | Remaining normal-example coverage |
| --- | --- |
| [Syntax](../docs/dsl/en/syntax.md) | Forward declarations, Unicode names, block/documentation comments, multiline scalar continuations and namespace/import boundaries |
| [Types](../docs/dsl/en/types.md), [expressions](../docs/dsl/en/expressions.md), [declarations](../docs/dsl/en/declarations.md) | String/choice/optional types, arrays/indexes/length, all operators and control-flow expressions, numeric editor metadata, immutable pure geometry and directional line→path assignability |
| [Control flow](../docs/dsl/en/control-flow.md), [records](../docs/dsl/en/records.md) | Statement and value if/match/for; range and collection loops; carry/next; generated occurrences; nominal records and optional/collection flows |
| [Modules](../docs/dsl/en/modules.md) | Params, instances, exports, relative imports/re-exports and bundled dependencies, geometry interfaces, nested scopes and Module documentation locale rules |
| [Constructions](../docs/dsl/en/constructions.md) | Image with bundled non-private asset; between/onLine distance modes; intersection index/extensions; curved/closed offsets and trim settings; transform scale/rotation/mirror; clockwise arcs; multiple knots and non-default segment/direction; tangentOffset curveSide; supported concrete arc/Bezier split/extend/edge variants |
| [Modifiers](../docs/dsl/en/modifiers.md) | Layers/default membership, style cascade, fill/opacity and visible/enabled distinctions, including ancestor/instance gates |
| [Output](../docs/dsl/en/output.md) | role/view/activeView, layout/place and output observations, layer selection, print paper/orientation/overlap and SVG/print variants |
| [Normative geometry properties and recipes](../docs/nui1/spec.md) | Numeric properties, input-member references, explicit generated selectors and immutable recipe-prefix capture before/after transformations |

No specific mode is silently removed from scope because a normal example has not been demonstrated. Unsupported or contradictory behavior discovered in a future slice must be reported, not repaired inside sample authoring without its own authorization.

## Sequential boundary

This slice ends at **001–044** and its exact pushed-HEAD review checkpoint. Independent review and normal PR/CI integration remain required. Later slices require a newly reconciled contract/base, integration checkpoint and fresh applicable D1 admission. They must not begin on this branch as implicit follow-on work.
