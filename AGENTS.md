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

`ARCHITECTURE.md` is the current repository architecture and navigation index.
`docs/nui4/spec.md` is the normative nui4 language contract. `docs/dsl.md` is
the current user-facing documentation for the implemented DSL. Source code is
the final authority for implementation details and behavior. `AGENTS.md` is the
durable product, engineering, and workflow policy. When a task-specific
specification or plan exists, respect that Task contract. Do not duplicate a
large architecture map in this file.

Keep the authority roles distinct: source code is authoritative for **what the
current implementation actually does**; a normative specification is
authoritative for **what the product or language is intended to do**. A mismatch
does not by itself authorize changing the normative spec to match the code.
Treat the implementation as defective unless a newer authoritative product
decision supersedes the spec. If current authorities do not uniquely establish
which side is stale or wrong, stop and resolve the product contract rather than
silently choosing one.

If behavior changes at the architectural or product-policy level, update the
appropriate durable document. If only a shortcut, label, parameter, or element
field changes, update the source of truth instead.

## Documentation lifecycle

Task-specific plans, implementation notes, migration plans, and task checklists
are working documents, not permanent current documentation by default.

For a multi-Task line of work, perform a Documentation cleanup check during the
final Task before the line of work is considered complete or its final PR/merge,
as applicable. For single-Task work, perform the same check before the Task is
considered complete.

Review the documentation created, completed, or superseded by that work.
Delete completed plan/task documents that no longer describe current behavior
and are not needed for future implementation. Do not keep completed plans in the
current tree only for historical record; Git history is the archive.

Keep current sources of truth, durable engineering policy, current user
documentation, active specifications, and reusable manual/test fixtures.

When deleting a document, update or remove repository links and source/test
comments that point to it. Preserve useful current rationale by rewriting it
against current behavior or a current source of truth instead of a historical
Task document.

Do not delete unrelated documentation as incidental cleanup. If a document may
still be authoritative and that cannot be determined from the current Task
contract and current implementation, do not delete it; report it for review.

## Architecture impact check

Before committing repository changes, check semantically whether the task changes:

- Subsystem ownership
- Primary entry points
- Architecture boundaries
- Documented data flow

If yes, update `ARCHITECTURE.md` in the same Task and describe the changed
current code. If no, do not change it solely to create documentation churn.
Ordinary bug fixes and internal implementation changes that remain within the
same ownership boundary normally do not require an architecture index update.
Never describe a future architecture or proposed design as current architecture.

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
evaluation. Production hosts that evaluate documents must reuse the same Rust
evaluator through their host-specific adapter or transport. Keep the TypeScript
evaluator as the reference/parity/test path and compatibility fallback, not a
second production semantics owner.

Where supported, development shadow evaluation may compare Rust output against
the TypeScript reference. Treat mismatches as implementation bugs unless a
deliberate Rust-first behavior change is being made and covered by updated
tests. Do not make a user-facing element type or dependency form production
ready until its Rust behavior, geometry output, errors, warnings, and
per-activity-state evaluation/draw behavior are covered by focused fixtures.

Keep the Tauri command boundary stable. The public Rust command for document
evaluation should remain `evaluate_document(input)` unless a deliberate
architecture change is requested. Host transport payloads must use JSON-friendly
arrays and objects, not JavaScript `Map` or `Set`; convert to `Map` / `Set` only
on the TypeScript side when needed.

## Commands, keyboard, and parameters

Keyboard operation is a first-class product requirement. Do not design
mouse-only workflows.

Major operations must be implemented as commands. Buttons, menus, keyboard
shortcuts, command palette entries, and canvas interactions should dispatch the
same command implementations instead of duplicating business logic in React
components.

Every new user-facing VS Code command must declare a Palette scope before
implementation. Allowed scopes are exactly:

* `Global`
* `Source`
* `Canvas`
* `Output Preview`
* `Source+Canvas`
* `Source+Output Preview`

Palette scope is part of the implementation contract. Palette visibility
represents the relevant surface, not fine-grained transient executability. Do
not make Palette visibility depend on transient state such as Canvas
selection, single or multi selection, cursor or token position, drawable
geometry availability, or whether the command can succeed at that exact
moment. Keep those checks in command execution semantics. Do not pre-design
Print Preview or other unconfirmed surfaces.

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

Use Vite, React, TypeScript, SVG/Canvas rendering, and Zustand where shared state
is useful. Use Tauri v2 for the Tauri desktop host and VS Code extension APIs for
the VS Code host.

The VS Code extension is an actively maintained production host alongside the
existing Tauri desktop host. Web/browser deployment of the app is discontinued
and must not be treated as a shipped target when making product or architecture
decisions. The Vite/browser environment is kept only as a local dev and test
harness (fast iteration, unit tests, the TypeScript reference evaluator) and
must not gate or block host-specific production behavior.

Tauri and VS Code must reuse the same production document, compiler, evaluation,
and Canvas semantics through narrow host adapters. Host authority and lifecycle
may differ where the platform requires it, but do not create a second parser,
resolver, evaluator, renderer, or document semantics merely for one host.

Production hosts should use Rust evaluation through the established evaluation
boundary by default. Tauri and VS Code may use different host transports while
reusing the same Rust evaluator. Development may run shadow/parity evaluation
to keep Rust output checked against the TypeScript reference; the TypeScript
evaluator remains the reference/parity/test path and compatibility fallback,
not a product target in its own right.

The Tauri macOS app is for local use only and is not distributed to other users.
Do not add or require Apple notarization for normal builds; notarization
warnings from `npm run desktop:build` are expected when Apple credentials are
not configured.

The product has not started production use yet. When improving the document
model or saved file format, prefer the cleanest durable shape over backward
compatibility with earlier local drafts. Breaking saved-format changes are
acceptable unless the user explicitly asks for a compatibility layer.

The current and only supported saved-document language is `nui 4`. Missing or
unsupported versions fail closed. A nui3 compatibility parser, converter,
importer, or migration layer does not currently exist; do not add old-format
compatibility without an explicit Task.

The persisted document is one `.nui` DSL text file. `.nui` `sourceText` is
canonical. Document-order deterministic evaluation, no automatic dependency
sorting, Rust-first evaluation, and statement-level source editing are current
rules. Keep document edits on the established canonical source-edit boundary.
Canvas and command model edits must use statement-level text splices through the
document bridge. Do not add a whole-file reserialization mutation path that can
damage comments, blank lines, or user layout.

Keep CodeMirror types and direct CodeMirror APIs inside `src/editor/` and
`SourceEditorPane.tsx`. Other components communicate through source-editor
handles and plain application types. VS Code native language providers should
remain thin host adapters over host-neutral production language queries rather
than introducing CodeMirror dependencies or parallel language semantics.

Prefer Rust for deterministic, CPU-heavy, or platform-adjacent work:

* CAD document evaluation and dependency checks
* curve/path measurement, offset geometry, and other performance-sensitive math
* large file, image asset, SVG/PDF, and tiled A4 export workflows
* local filesystem and desktop integration behind explicit host boundaries

Keep React components and Zustand stores independent from host-specific APIs.
Frontend code should call small adapters such as the evaluation engine rather
than importing Tauri or VS Code APIs directly throughout the UI.

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

### Parallel-friendly change shape

When independent Tasks may be implemented in parallel, preserve the established
architecture instead of optimizing solely for textual merge convenience. These
rules refine the ownership and narrow-adapter rules above; they do not override
an existing source-of-truth or ordering contract.

- Prefer feature-owned modules, hooks, and pure functions over adding
  feature-specific logic to shared orchestration or composition roots when the
  behavior can be isolated without duplicating semantics.
- Avoid creating or enlarging a central switch, registry, or list that every
  unrelated feature must edit when the same authority can be partitioned by
  semantic owner or exposed through an existing narrow contribution boundary.
  Conversely, do not split an intentionally centralized source of truth merely
  to avoid merge conflicts; centralized ordering, validation, identity, or
  semantics stay centralized unless the Task justifies a real architecture
  change.
- Prefer additive feature-owned files plus stable narrow adapters/contracts over
  broad edits to shared owners when both shapes preserve the same architecture.
  New files are not a goal by themselves; do not add indirection that obscures
  the actual owner.
- Keep feature-specific tests and fixtures with their semantic owner when they
  can verify the behavior independently. Use shared tests or fixtures when the
  acceptance is genuinely cross-cutting; do not duplicate a shared oracle merely
  to reduce textual overlap.
- Avoid scope-unrelated renames, moves, import reordering, whole-file formatting,
  and cleanup that create broad diff churn. If such a refactor is actually
  required for the Task, make that change explicit in the Task scope rather than
  mixing it into unrelated feature work.
- Repeated unrelated edits to the same shared file, symbol, registry, fixture, or
  contract are a signal to investigate ownership decomposition. Do not perform
  that decomposition opportunistically inside an unrelated feature Task.

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

Determine verification breadth from **affected ownership and dependency breadth,
not diff size**. A small textual diff in a shared parser primitive, compiler,
document/runtime boundary, evaluator path, or other reused owner can require a
broad regression suite. A larger change can remain focused when it is isolated
to one owner, the production path is exercised directly, and focused tests can
reasonably cover the regression surface. Run the broader suite when a change can
realistically break independent existing features even while the focused tests
for the edited behavior still pass.

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
* Before implementation or branch/base changes, run `git fetch origin --prune`
  and compare the expected remote commit/branch with the actual remote state.
  Do not assume a local `main`, branch, or worktree is current.
* If the expected and actual remote state differ, do not continue from stale
  local state and do not silently rebase, reset, merge, or redesign. Report the
  mismatch as a blocking point unless the current Task explicitly defines how to
  proceed.
* Each Task that changes repository files uses its assigned branch, commits only
  its intended changes, pushes those commits to `origin`, and is reviewed against
  pushed GitHub state. A local-only commit is not complete.
* Blocking fixes remain on the same Task branch unless the current Task plan says
  otherwise; commit and push the fixes before re-review.
* The next step after blocking-review PASS follows the current development-track
  plan. Depending on that plan, either start the next Task from the reviewed
  remote commit or create/merge a PR. Do not hard-code either one PR per Task or
  one final PR for an entire multi-Task line of work.
* Independent new work normally starts from latest remote `main`. Chained work
  may start from the previous Task's blocking-review-approved pushed commit when
  the current plan specifies that base.
* Do not create a PR unless the user explicitly requests it.
* Do not merge unless the user explicitly requests it.
* Push is mandatory unless the user explicitly says not to push.
* Worktrees are optional. Reuse an appropriate existing repository/worktree when
  it is safe to do so. Create another worktree only when parallel work, unrelated
  user changes, unfinished work, or different simultaneous bases require
  isolation.
* Do not switch the current worktree to `main` without instruction.
* Do not delete unrelated worktrees or branches without instruction.
* Do not delete, overwrite, reset, or otherwise disturb unrelated user changes.