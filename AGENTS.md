# AGENTS.md

## Purpose

This file is the implementation guide for agents working in this repository.
Keep it focused on durable product and engineering rules, not a complete
roadmap or a duplicate of the current source code.

This project is a 2D parametric CAD editor for sewing pattern drafting. It is
not intended to become a general-purpose mechanical CAD system.

Prioritize:

* sewing pattern drafting workflows
* deterministic parametric construction
* clear dependency and evaluation errors
* editable geometric elements
* curve and path length measurement
* keyboard-driven operation
* SVG/Canvas-based 2D editing
* future SVG/PDF export and tiled A4 printing

## Product principles

Prefer clothing-pattern features over generic CAD features: pattern lines,
curves, dimensions, labels, notches, seam allowances, grain lines, and printable
physical units.

Do not introduce a full generic geometric constraint solver unless the product
need is explicit. The core engine should remain a deterministic construction
evaluator: elements are evaluated in document order, and invalid dependencies
are reported rather than silently repaired.

Use millimeters as the conceptual unit. Rendering may map millimeters to pixels,
but geometry values should remain physical units so export and printing stay
predictable.

Use a Y-up drafting coordinate system: positive Y values go upward, and
negative Y values go downward. Screen rendering may convert this to browser
pixel coordinates, but stored geometry, evaluation, angles, and user-facing
coordinate values should remain Y-up.

## Source of truth

When updating behavior, prefer these source files over duplicating details here:

* Element and geometry types: `src/types/geometry.ts`
* Rust/Tauri evaluation core: `src-tauri/src/evaluation/`
* TypeScript evaluation adapter, payload conversion, reference evaluator, and
  parity helpers: `src/geometry/`
* Tauri desktop shell and commands: `src-tauri/`
* Dependency and document ordering logic: `src/model/`
* DSL parsing, compilation, serialization, and completion: `src/dsl/`
* Canonical document persistence and text patches: `src/document/`
* CodeMirror adapter and source-edit session boundary: `src/editor/`
* Commands and command palette data: `src/commands/`
* Keyboard shortcut mapping: `src/keyboard/shortcuts.ts`
* Editable parameter definitions: `src/parameters/parameterDefinitions.ts`
* Store state and undo behavior: `src/state/`
* Rendering and interaction components: `src/components/`

If behavior changes at the architectural or product-policy level, update this
file. If only a shortcut, label, parameter, or element field changes, update the
source of truth instead.

## Evaluation and dependencies

Elements are evaluated from top to bottom. An element may only reference
geometry that has already been evaluated earlier in the document order. Do not
automatically sort, repair, or reorder elements to hide dependency problems.

Dependency errors should be explicit and actionable. Include the broken element
ID/name, the missing or unavailable dependency ID/name when known, and a
human-readable message explaining whether the dependency is missing, disabled,
invalid, or appears too late.

Elements with dependency errors should be visibly marked in the UI. Invalid
geometry should not be drawn as normal valid geometry; either omit it or render
a clear warning marker.

Each element has a single `activity` state: `visible`, `hidden`, or `disabled`.
`visible` evaluates and draws normally. `hidden` still evaluates and may be
referenced, but is not drawn. `disabled` is not evaluated and must not produce
computed geometry or be referenced by later elements.

For now, document order can continue to serve as both evaluation order and
display order unless a change explicitly introduces separate visual layering.

The Rust evaluation core is the production source of truth for CAD document
evaluation in the Tauri desktop app. Keep production Tauri evaluation
Rust-first through the evaluation engine adapter, and keep the TypeScript
evaluator as the browser/test reference and compatibility fallback.

For Tauri development, shadow evaluation may compare Rust output against the
TypeScript reference. Treat mismatches as implementation bugs unless a
deliberate Rust-first behavior change is being made and covered by updated
tests. Do not make a user-facing element type or dependency form production
ready until its Rust behavior, geometry output, errors, warnings, and
per-activity-state evaluation/draw behavior are covered by focused fixtures.

Keep the Tauri command boundary stable. The public Rust command for document
evaluation should remain `evaluate_document(input)` unless a deliberate
architecture change is requested. IPC payloads must use JSON-friendly arrays and
objects, not JavaScript `Map` or `Set`; convert to `Map` / `Set` only on the
TypeScript side when needed.

## Commands, keyboard, and parameters

Keyboard operation is a first-class product requirement. Do not design
mouse-only workflows.

Major operations must be implemented as commands. Buttons, menus, keyboard
shortcuts, command palette entries, and canvas interactions should dispatch the
same command implementations instead of duplicating business logic in React
components.

Global shortcuts must not interfere with normal text and number entry. When an
`input`, `textarea`, `select`, or `contenteditable` element is focused,
ordinary typing and editing shortcuts should continue to work normally.

Do not choose geometry references from large static dropdowns. Pattern documents
can grow to hundreds or thousands of elements, so references should use scalable
selection UI such as canvas picking, searchable construction lists,
command-driven candidate selection, or keyboard navigation.

Selected element parameters must remain operable by keyboard through Inspector
row navigation and Source Editor value-span editing. When adding a parameter,
define it in the centralized parameter definition table with a stable key,
label, and value kind. Numeric parameters should support per-parameter keyboard
step sizes in the Source Editor, defaulting to 1 mm unless the parameter needs
domain-specific levels such as ratios or angles.

The Inspector is read-only. Parameter changes happen through Source Editor
value spans (`Alt+←` / `Alt+→` for step changes where available) or the
command-line creation flow; do not restore form-style parameter editing UI.
`editorTransaction` is the established narrow Source Editor exception: it owns
the `Alt+←` / `Alt+→` value-step chords without Mod and the modifier-free F2
rename chord. Do not broaden this exception to other shortcut owners.

Safe propagated rename is an explicit command-only operation. It must flush
the Source Editor, reject unsafe name collisions or reference-resolution
changes, patch only affected statements, and make one rename one Undo step.
Direct DSL text edits do not trigger rename propagation; normal diagnostics
remain responsible for dangling references.

Do not maintain a hand-written shortcut list in this file. Shortcut help should
come from command and shortcut metadata in the application.

## Architecture and code organization

Use Vite, React, TypeScript, SVG/Canvas rendering, Zustand where shared state
is useful, and Tauri v2 for the desktop application shell.

The Tauri desktop app is the only maintained product target. Web/browser
deployment of the app is discontinued and must not be treated as a shipped
target when making product or architecture decisions. The Vite/browser
environment is kept only as a local dev and test harness (fast iteration, unit
tests, the TypeScript reference evaluator) and must not gate or block
Tauri-only behavior.

Tauri production should use Rust evaluation through the evaluation engine
adapter by default. Tauri development may run shadow evaluation to keep Rust
output checked against the TypeScript reference; the TypeScript evaluator
remains the browser/test reference and compatibility fallback, not a product
target in its own right.

The macOS app is for local use only and is not distributed to other users.
Do not add or require Apple notarization for normal builds; notarization
warnings from `npm run desktop:build` are expected when Apple credentials are
not configured.

The product has not started production use yet. When improving the document
model or saved file format, prefer the cleanest durable shape over backward
compatibility with earlier local drafts. Breaking saved-format changes are
acceptable unless the user explicitly asks for a migration path or compatibility
layer.

The target final saved-document format is `nui 4`. Until the nui4 migration is
complete, the current production implementation and current document format
remain `nui 3`. nui4 is a destructive replacement. Do not add a nui3-to-nui4
compatibility layer, converter, importer, or migration wizard. Compatibility
with old local documents must not distort the nui4 architecture; prefer precise
diagnostics and a manually repairable `.nui` source file during the transition.

The nui4 migration does not preserve legacy-only parser, serializer, importer,
adapter, fallback, bridge, fixture, or conditional branches. Do not proactively
extend old-format compatibility or add automatic migration.

The persisted document is one `.nui` DSL text file. `sourceText` is the
canonical, durable state. Document-order deterministic evaluation, no automatic
dependency sorting, Rust-first evaluation, and statement-level source editing
remain in force throughout the migration. Existing local drafts are not a
reason to preserve obsolete language shapes or create a second save target.
Keep document edits on the central `sourceEditSession`/`commitText` boundary.
Canvas and command changes must use statement-level text splices through the
document bridge: do not add whole-file reserialization as a mutation path
because comments, blank lines, and user layout must remain intact.

Keep CodeMirror types and direct CodeMirror APIs inside `src/editor/` and
`SourceEditorPane.tsx`. Other components communicate through source-editor
handles and plain application types.

Prefer Rust for deterministic, CPU-heavy, or platform-adjacent work:

* CAD document evaluation and dependency checks
* curve/path measurement, offset geometry, and other performance-sensitive math
* large file, image asset, SVG/PDF, and tiled A4 export workflows
* local filesystem and desktop integration behind explicit Tauri commands

Keep React components and Zustand stores independent from Tauri-specific APIs.
Frontend code should call small adapters such as the evaluation engine rather
than importing Tauri APIs directly throughout the UI.

Keep geometry computation out of React rendering components. Prefer small pure
functions for geometry, dependency, validation, ordering, and parameter access
logic.

Use TypeScript discriminated unions for element types. Avoid stringly-typed
geometry where reasonable, and keep element IDs stable.

Keep the TypeScript element JSON shape and Rust `serde` handling aligned. Until
type generation is introduced, maintain this manually with parity tests. When a
document slice cannot yet be evaluated by Rust, the TypeScript Rust-eligibility
check must account for referenced element types and dependency forms, not just
the element's own `type`; treat that as a compatibility fallback, not the
desired production path for new user-facing behavior.

Keep changes local to the relevant subsystem. Avoid broad architectural
rewrites unless the requested feature or bug fix genuinely requires them.

## Rendering and performance

The application should remain viable for roughly 1,000 editable geometry
elements, large reference images used as underlays, frequent pan/zoom, and
real-time editing feedback.

Always design UI workflows with three-digit element counts in mind. Element
lists, inspectors, reference pickers, selection tools, visibility controls, and
error navigation must remain searchable, filterable, keyboard-friendly, and
scannable once a document has more than 100 elements.

Do not assume all geometry should always be rendered as React DOM or individual
SVG elements. Keep the rendering architecture able to evolve toward:

* Canvas for main geometry and large reference images
* SVG or HTML overlays for selected elements, handles, labels, and editing UI
* cached curve/path measurements recomputed only when geometry changes

Treat large reference images as assets, not ordinary lightweight elements. Undo
history should reference large assets by ID and must not duplicate image data.

## Testing and quality

When adding geometry, dependency, command, parameter, or keyboard behavior, add
focused tests for the pure logic and the user-facing command behavior.

Important scenarios include:

* valid evaluation order
* missing, disabled, invalid, or too-late dependencies
* visible/hidden/disabled activity behavior
* command dispatch behavior
* keyboard shortcut mapping and form-input exclusion
* parameter definition and keyboard edit behavior
* geometry measurement behavior when relevant

Choose verification based on the surface actually changed. Use the smallest
check that can meaningfully detect regressions caused by the change. Do not run
an expensive full suite merely by habit when the change cannot be meaningfully
verified by it. Task-specific gates and gates explicitly requested by the user
take precedence.

For documentation, comments, or policy-only changes that do not change source
code, configuration, generated artifacts, or runtime behavior, `git diff --check`
and diff review are sufficient. Do not routinely run `npm run build`, `npm run
lint`, `npm test`, `npm run test:parity`, `cargo check`, `cargo test`, `cargo
clippy`, or `npm run desktop:build` for such changes; run them only when the task
explicitly requires them.

For TypeScript, TSX, JavaScript, or executable DSL implementation changes, first
run focused tests that directly cover the changed behavior. When production
TypeScript, types, or bundle/build inputs change, run `npm run build`. When
linted source or lint configuration changes, run `npm run lint`. Run the full
`npm test` suite for broad or cross-cutting changes, shared parser/compiler/
document/runtime infrastructure changes, an explicitly requested full
regression gate, or a final cutover/regression milestone. Do not require the
full suite by habit for a small isolated change with sufficient focused
coverage.

Run `npm run test:parity` when evaluation semantics, evaluation payload
conversion, Rust eligibility, or behavior shared by the TypeScript reference
evaluator and Rust evaluator changes. Do not run it for docs-only, UI-only, or
unrelated source changes.

For Rust changes, first run `cargo fmt --check`, `cargo check`, and focused Rust
tests covering the changed code. Run `cargo test` and
`cargo clippy --all-targets -- -D warnings` for broad Rust changes, shared
evaluation/runtime infrastructure changes, a final regression gate, or when the
task explicitly requires them.

Run `npm run desktop:build` when Tauri packaging, app configuration, native
command registration or boundaries, release-build behavior, or an explicit task
gate requires it. It is not a routine gate for documentation, pure logic, or
unrelated frontend changes.

If a check cannot be run or fails for unrelated existing reasons, report that
clearly.

## Adding a new element type

When adding a new CAD element type, update the complete path for that element:

* type definitions and display labels
* factory/default creation behavior
* dependency extraction and ordering behavior
* geometry evaluator and error reporting
* parameter definitions and parameter access
* creation/edit commands and command palette metadata when user-facing
* rendering, hit testing, selection, and canvas interaction as needed
* tests for valid evaluation, broken dependencies, commands, and parameters

Prefer clear errors and simple deterministic construction over automatic
correction. If a model problem exists, show the user what to move or edit rather
than hiding the issue.

## Git / GitHub workflow

* In plan mode, only plan Git/GitHub actions; execute them after approval.
* Follow the branch and worktree workflow specified by the task.
* Do not require a new branch or worktree for every task as a repository-wide
  rule.
* A long-running migration or multi-task plan may continue using the same branch
  and worktree when the task specifies that workflow.
* Do not switch the current worktree to `main` without instruction.
* Do not delete unrelated worktrees or branches without instruction.
* Do not create a PR or merge without the user's explicit request.
* Follow the task or user instruction for branch/worktree cleanup.
* Never merge a PR without explicit approval.
