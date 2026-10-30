# Issue #1507: generated occurrences to physical output

The sealed `manifest.json` contains twelve four-checkpoint source sequences.
Every checkpoint stores exact UTF-8 source, SHA-256, complete ordered generated
line/point identities, and an independently calculated physical oracle sealed
with SHA-256 of `JSON.stringify(oracle)`. Restored checkpoints use the initial
source bytes. `base-results.json` records all dispositions and the unchanged
Base's physical-artifact proof. Final gate results are recorded separately.

The oracle is arithmetic, not captured OutputPlan or encoder output. Per-unit
`oracleDerivation` explains the authored endpoints and Euclidean lengths.
Physical endpoints are calculated by subtracting the explicit origin, mirroring
local X, scaling, applying exact 90/270-degree quadrant rotations, then adding
`at`. Each line has a 2px physical stroke (`2 * 25.4 / 96` mm), independent of
placement scale. Bounds use endpoint extrema plus half that physical width;
SVG expands each side by its authored margin. Paper is A4 210x297 or A3 297x420
mm, with landscape swaps. Tile strides are paper dimensions minus twice overlap;
origins start at bounds.min minus overlap. Every PDF page's clipping rectangle,
full ordered drawing operators, widths, colors, MediaBox and guides are decoded
and checked. Shared global geometry encoded under each page clip is intentional.
P3 expands to 2x2 portrait A4 sheets, then shrinks to one landscape sheet and
restores one portrait sheet.

All sequences include the unchanged 100mm Calibration and 5mm Sibling lines in
an independent Control placement. Authored points and the unselected group
must not affect emitted strokes or physical bounds. P4 also checks computed
hidden geometry and absent disabled geometry under Draft/Cut profiles.

## Existing language support and preparation evidence

`rejected-inline-styles.json`, `rejected-direct-point-binder.json`, and
`rejected-direct-length-condition.json` retain the original proposed source,
exact diagnostics and hashes. They are source-authoring substitutions within
the original primary IDs, not defects, reducers or extensions. Style blocks
require separate physical lines. Existing direct construction/condition
adapters reject the proposed direct point binder and collection.length forms;
the final source uses typed current-member values and a typed numeric count.

As established by #1468, omitted `showGenerated` hides generated strokes while
still computing them. Draft preparation accidentally omitted that option;
its original source/oracles/failed draft run remain untouched outside the
checkout under `/Users/yosomi/.codex/evidence/issue-1507/`. It is not evidence
of a product defect. Final range headers explicitly request `showGenerated`.
Collection-for has no corresponding source option, so C1-C4 use the legal
same-purpose discriminator: collection cardinality drives a visible range,
and each iteration indexes the exact ordered member. C1-C3 protect the empty
case with `count > 0`; C4 materializes the current typed mapped point and
emits a derived line, plus a changing separately selected member. This tests
collection-driven physical output without claiming collection-for syntax can
directly expose visible generated strokes. The independent endpoint/physical
math was unchanged; source and ownership seals were frozen again before
executing these supported equivalents. No test modifies compiled models to
turn visibility on.

## Production path and provenance

The integration test uses canonical incremental/fresh compilation, production
options/lowering, one persistent Cargo-built `evaluation_stdio` process, the
TypeScript reference, `buildOutputPlan`, and genuine `exportOutput` requests.
It checks both formats for both compilation modes at all 48 checkpoints:
192 Rust evaluations, 192 exports and 192 independent artifact inspections
per complete run. Each destination is fresh and initially absent; files are
bounded below 1MiB. Rust requests/closure are bounded at 15s, Cargo at 120s,
and a child-only 512MiB RSS watchdog is installed. Completion/error listeners
precede requests/teardown. The actual binary path respects `CARGO_TARGET_DIR`
and its SHA-256 is recorded. PDF xref/page-tree/stream/operator inspection is
reused unchanged from #1458 through `test/pdfArtifactInspector.ts`.

Large logs, original draft manifests, decoded observations and physical files
remain outside the checkout. Optional `ISSUE1507_RECORD` records run evidence;
`ISSUE1507_KEEP_ARTIFACTS=1` retains only the test-owned temporary directory.
`ISSUE1507_VALIDATE_ONLY=1` is source authoring validation, never physical PASS.

No novel product defect was confirmed. There are no production repairs,
Base-failure families, or repair-removal counterfactuals to claim. All six X
and all six reducer slots are NOT_TRIGGERED. No architecture, language,
production API, output format or dependency changed. Manual E2E is Not Required
for this CLI-only host-neutral verification; GUI, printer fidelity and sewing
fit are untested.
