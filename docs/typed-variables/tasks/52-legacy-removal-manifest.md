# Task 52 legacy removal manifest

Scan date: 2026-08-02

This manifest records the pre-nui 3 owners found before Task 52 implementation.
Every listed owner must be deleted or have its remaining nui 3 responsibility
moved to a neutrally named owner. Retaining a legacy adapter is not allowed.

## Delete

| Owner | Evidence / production path | Task 52 action |
| --- | --- | --- |
| `src/document/legacyDsl/` | Reached only through `legacyV1Import` | Delete frozen v1 parser and tests. |
| `src/document/legacyImport.ts`, `legacyV1Import.ts` | File-open/import boundary | Delete JSON/v1 import paths and UI entrypoints. |
| `src/dsl/dslV2Settings.ts`, `dslV2RoundTripHarness.ts` | v2 serializer/round-trip tests | Delete with v2 settings, harness, fixtures, and tests. |
| `src/dsl/dslVersion.ts` v2 support and upgrade APIs | Parser/compiler/serializer/store feature gates | Replace with fixed nui 3 boundary; remove upgrade and feature gates. |
| `var` construction, `VariableElement`, `variable` evaluator | Legacy document binding and measurement syntax | Delete parser/compiler/serializer/evaluator paths and fixtures. |
| legacy lanes in binding catalog/resolution and scalar external resolvers | Typed-to-legacy binding bridge | Remove; typed/iteration/element-local resolution remains. |
| `visible` / `enabled` activity flags and TS/Rust conversions | v2 model/IPC activity bridge | Store and evaluate only `activity`. |
| legacy-only fixtures, golden/parity tests, and performance scripts | Test-only compatibility coverage | Delete rather than retain compatibility assertions. |

## `var` owner classification from the production import graph

### A. Legacy-only — delete

| Owner | Production reference evidence | Action |
| --- | --- | --- |
| `var` call/short syntax (`dslCallParser`, constructions, parser/compiler/serializer) | Produces only `DslStatement.kind === "variable"` or `CadElement.type === "variable"`. | Remove the syntax, statement handling, and serializer branch. |
| `VariableElement`, factory/creation/parameter/dependency/duplication support | The only element kind with legacy document numeric binding semantics. | Remove with `variable` from the geometry union and commands. |
| `variableEvaluator`, `variableScope`, document-order variable lookup | Only evaluates or scopes a `VariableElement` into `computedVariables`. | Delete; no replacement. |
| legacy binding records/lanes (`legacyVariablesByScope`, `legacyBindings`, activation sweep) | `dsl/bindingCatalogAdapter` seeds `kind: "legacy"`; catalog/resolution activate it after each statement. | Remove the record, seed input, lane, and activation flow. |
| TS/Rust `binding:<element-id>` external resolver | Reads `computedVariables` from `VariableElement` evaluation. | Remove; unresolved external IDs remain unavailable. |
| v1/v2 import and round-trip owners | Reachable only from file-open/import compatibility paths or compatibility tests. | Delete. |

### B. Nui 3 generic responsibility — retain after neutral move/rename

| Existing owner | Nui 3 responsibility and production consumers | Target |
| --- | --- | --- |
| `geometry/variableReferenceOptions.ts` | Its `NumericVariableReferenceOption` type and element-local candidate builder are used by CodeMirror, expression tray, command line, and print UI. The top-level `VariableElement` candidate builder is legacy-only. | Move the generic type and element-local candidate functions to a neutral numeric-reference owner; drop the top-level-variable portion. |
| template numeric-input synthetic `VariableElement` | Its persisted numeric input was exclusively backed by the deleted document `VariableElement`; no nui 3 typed source consumes it. | Delete the numeric template input surface rather than retaining a synthetic element or adapter. |
| print candidate presentation | Print-layout numeric variables remain valid; global variable-element candidates do not. | Retain print-layout candidates and connect typed binding candidates directly. |
| text-template numeric-expression holes | A nui 3 label may still interpolate a geometry measurement or element-local numeric value without a document binding. The old implementation called this a “legacy hole” only because it shared the numeric-expression evaluator. | Keep the behavior, but rename the segment/evaluator boundary to a neutral numeric-expression hole owner. |

### C. Explicit nui 3 survivors — do not migrate into a legacy lane

| Owner | Required behavior |
| --- | --- |
| `forGroup` iteration binding | Remains a readonly structural binding in the catalog/resolution path. |
| element-local `numericVariables` | Remain an element-owned local numeric namespace, outside the document binding catalog. |
| print-layout numeric variables | Remain block-local print-layout state and completion candidates, outside the document binding catalog. |

## Reviewed nui 3 exceptions

| Code / term | Why it remains |
| --- | --- |
| `numericVariables` on geometry and print-layout records | Existing element-local and print-layout numeric namespaces, still used by nui 3 production evaluation. It is not a document `var` binding. |
| `forGroup` iteration bindings | Required read-only numeric binding in nui 3 lexical scope. |
| settings objects with `version: 1` | Independent UI preference file schema, not `.nui` document format. |
| `legacyCreationRecipes` naming | Current command recipe IDs used by the command palette/shortcuts, unrelated to nui format compatibility. |
| `legacyBindingIdMap` in shortcut settings | Migration of independent keyboard-preference binding IDs; it does not read or write `.nui` source or evaluation payloads. |
| CSS `var(--...)` | Standard CSS custom-property syntax, unrelated to DSL `var` statements. |

## Implementation status

- A: removed the document `var` syntax, `VariableElement`, v1/v2 import and
  serializer paths, legacy binding catalog records/activation, the external
  binding bridge, activity-flag conversions, and legacy fixtures.
- B: moved local numeric-reference candidates to
  `geometry/numericReferenceOptions`; retained text numeric-expression holes
  under that neutral name; removed synthetic template numeric inputs.
- C: kept forGroup iteration catalog bindings and kept element-local and
  print-layout `numericVariables` outside the catalog.
- The production source scan has no document `var`, `VariableElement`,
  legacy binding-lane, old activity-conversion, or old nui-version hits.
  The only `var` matches are reviewed CSS custom-property calls.

### Measured final-scan results (2026-08-04)

All three required scans below were re-run over `src src-tauri test` after the
nui 3-only activation and full test-suite migration. **Zero hits in
non-test production source** for all three patterns. Every remaining hit is
one of:

- a reviewed exception from the tables above,
- a genuinely version-neutral or syntax-neutral low-level test (the parser,
  tokenizer, settings statement, or comment-merge layer under test does not
  itself validate DSL version or `var`/`activity` semantics — confirmed by
  reading each call site), a deliberately fatal/malformed fixture where the
  header or keyword content is incidental to what is asserted, or a
  historical/explanatory code comment,
- CSS `var(--...)` custom-property syntax,
- build output under `src-tauri/target/` (gitignored cargo build artifacts —
  not source, excluded from review), or
- a stale test-only fixture, fixed during this review (see below).

**Scan 1** (`nui[12]`/legacy-DSL patterns): 42 hits, all in test files, 0
production hits. One fix applied: [imageFilePaths.test.ts](../../../src/document/imageFilePaths.test.ts)
had a `"nui 2"` header plus space-separated call args; `rebaseImageSourcePathsInText`
is version-agnostic (pure regex rewrite), but the test's own `parseDsl(...).diagnostics`
assertions require a real nui 3-conformant body once the header reads `"nui 3"` —
updated headers and added the missing argument commas, updated the stale
"v2 canonical" wording in one test title.

**Scan 2** (`var`/`VariableElement`/`legacyBindings` patterns): 78 hits.
0 production hits. Two stale test-only fixtures found and fixed, both outside
the original TS worklist because `tsconfig.app.json`'s `include` is `["src"]`
only — `test/` is not covered by `npx tsc -b --noEmit` or `npm run build`, so
these were invisible to every earlier gate:
  - [test/typedVariablesPureNui3BindingAnalysisProfile.test.ts](../../../test/typedVariablesPureNui3BindingAnalysisProfile.test.ts)
    passed a dead `legacyBindings: adapter.legacyBindings` field to
    `buildBindingCatalog(...)`; neither the adapter's return type nor
    `BuildBindingCatalogInput` has had this field since the legacy lane was
    removed. Deleted the line (this file only runs under the opt-in
    `npm run test:profile:binding-analysis`, not any required gate).
  - [test/elementActivityPerformance.test.ts](../../../test/elementActivityPerformance.test.ts)
    built its fixture elements with the old `visible`/`enabled` boolean pair
    instead of `activity`. This one runs under plain `npm test` and passed
    silently because the object literal reached `effectiveElementActivityById`
    as an untyped `CadElement[]` cast with `activity` simply `undefined` on
    every element — the test only measures timing/counts, not resolved
    activity values, so a wrong fixture shape produced no assertion failure.
    Rewritten to build a real 3-way `activity` mix (`visible`/`hidden`/`disabled`)
    preserving the original ratios.
  A follow-up `test/`-inclusive ad hoc `tsc --noEmit` sweep (temporary
  tsconfig with `include: ["src", "test"]`, discarded after use) found no
  further hits beyond these two and one unrelated, pre-existing, out-of-scope
  type-strictness nit in the same profile file (`Record<Stage, ...>` cast
  inference, unrelated to nui 2/3 or `var`/`activity`; left untouched).

**Scan 3** (`visible`/`enabled` patterns): 1,173 raw hits — this pattern
matches common English words throughout UI copy, comments, and unrelated
boolean fields (`printEnabled`, palette keywords, `effective_visible_element_ids`
Rust bookkeeping derived from `activity`, etc.), so it was narrowed for
review: 117 hits in non-test production files (`grep -v '\.test\.' | grep -v
'_tests\.rs'`), all reviewed individually. Targeted greps confirmed zero
hits for the legacy bridge symbols themselves
(`activity_from_legacy_flags`, `legacyFlagsForElementActivity`,
`elementActivityFromLegacyFlags`, `LegacyElementActivityFlags`) and zero
`element.visible`/`element.enabled`-style member access in production. One
genuine fixture-shape issue found and fixed:
  - [src-tauri/src/evaluation/edge_extend_test_support.rs](../../../src-tauri/src/evaluation/edge_extend_test_support.rs),
    a shared Rust test-fixture builder used by `line_copy_move_tests.rs`,
    `corner_radius_tests.rs`, `edge_tests.rs`, and `extend_trim_tests.rs`,
    built element JSON with `"visible": true, "enabled": true` instead of
    `"activity": "visible"`. `activity_from_element` (`src-tauri/src/evaluation/activity.rs:31`)
    defaults any element with a missing/unrecognized `activity` key to
    `Visible`, so this fixture was evaluating correctly by coincidence of the
    default, not because the shape was right. Fixed to `"activity": "visible"`;
    `cargo test` (305 passed / 0 failed / 10 ignored, unchanged), `cargo fmt --check`,
    and `cargo clippy --all-targets -- -D warnings` all still pass.

### Rust per-test inline fixtures cleanup (2026-08-04, follow-up)

The 18 individual `src-tauri/src/evaluation/*_tests.rs` files that had been
recorded as an accepted exception (inline element JSON with `"visible":
true, "enabled": true` instead of `"activity": "visible"`, coincidentally
correct only because `activity_from_element` defaults an absent/unrecognized
`activity` key to `Visible`) have been fixed. There is no remaining
accepted exception for this pattern.

Every occurrence across all 18 files was enumerated and checked before
editing rather than blind-replaced: `rg -c '"visible":\s*true'` /
`'"enabled":\s*true'` / `'"visible":\s*false'` / `'"enabled":\s*false'`
confirmed all 184 occurrences (across `property_binding_runtime_tests.rs`,
`extend_trim_tests.rs`, `split_line_tests.rs`, `line_copy_move_tests.rs`,
`corner_radius_tests.rs`, `linear_mutation_integration_tests.rs`,
`path_mutation_tests.rs`, `line_tangent_offset_point_tests.rs`,
`scalar_expression_payload_compat_tests.rs`,
`incomplete_numeric_expression_tests.rs`, `bezier_curve_tests.rs`,
`control_boolean_runtime_tests.rs`, `text_template_runtime_tests.rs`,
`performance_tests.rs`, `offset_line_tests.rs`, `edge_tests.rs`,
`three_point_arc_line_tests.rs`, `intersection_point_tests.rs`) were
unconditionally `visible: true, enabled: true` — zero `false` values
anywhere in any of the 18 files. Every occurrence therefore maps to
`"activity": "visible"` with no ambiguity; there was no fixture requiring
`"hidden"` or `"disabled"`. Applied across both formatting styles present
(indented multi-line and compact single-line JSON) and verified a
post-edit re-scan finds zero remaining `"visible":`/`"enabled":` hits
anywhere under `src-tauri/src` (excluding `target/`).

`cargo test` (305 passed / 0 failed / 10 ignored, unchanged from baseline),
`cargo fmt --check`, and `cargo clippy --all-targets -- -D warnings` all
pass after the change. No production source was touched.

## Required final scans

- `rg -n -i '(nui[ _-]?[12]|nui 2|nui 1|DslV2|legacyDsl|legacyV1|LEGACY_IMPORT|typed-syntax-requires-nui3)' src src-tauri test`
- `rg -n '\bvar\b|type: "variable"|VariableElement|legacyBindings|LEGACY_BINDING_PREFIX' src src-tauri test`
- `rg -n 'visible|enabled|activity_from_legacy_flags|legacyFlagsForElementActivity' src/types src/model src/dsl src/geometry src/commands src-tauri/src/evaluation`

The only accepted hits are the reviewed exceptions above, unrelated historical
names, and this manifest/documentation. Each remaining hit is reviewed against
the nui 3 production import graph before being accepted.
