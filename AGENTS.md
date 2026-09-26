# AGENTS.md

## Purpose

This file is the implementation guide for agents working in this repository.
Keep it focused on durable product and engineering rules, not a roadmap, a
history of implementation details, or a duplicate of current source code.

nuinuiCAD is a 2D parametric CAD editor for sewing pattern drafting. It is not
intended to become a general-purpose mechanical CAD system.

Prioritize:

* sewing pattern drafting workflows
* deterministic parametric construction
* clear dependency and evaluation errors
* editable geometric elements
* curve and path length measurement
* keyboard-driven operation
* interactive 2D drafting and physical-unit output
* SVG/PDF output and tiled physical-unit printing

## Product principles

Prefer clothing-pattern features over generic CAD features: pattern lines,
curves, dimensions, labels, notches, seam allowances, grain lines, and printable
physical units.

Do not introduce a full generic geometric constraint solver unless the product
need is explicit. The core engine should remain a deterministic declarative
construction evaluator. Invalid dependencies and cycles are reported rather than
silently repaired.

Use millimeters as the conceptual unit. Rendering may map millimeters to pixels,
but geometry values remain physical units so export and printing stay
predictable.

Use a Y-up drafting coordinate system: positive Y values go upward and negative
Y values go downward. Screen rendering may convert this to browser pixel
coordinates, but stored geometry, evaluation, angles, and user-facing coordinate
values remain Y-up.

## Source of truth

`ARCHITECTURE.md` is the current repository architecture and navigation index.
`docs/nui1/spec.md` is the normative nui1 language contract. `docs/dsl.md` is
the current user-facing documentation for the implemented DSL. Source code is
authoritative for current implementation details and behavior. `AGENTS.md` owns
durable product and engineering policy.

When a task-specific specification or plan exists, respect that Task contract.
Do not duplicate a large architecture map or detailed language specification in
this file.

User-facing DSL syntax, semantics, constructions, builtins, parameters,
properties, modules, records, or output-language changes must keep the
implemented DSL Reference consistent in the same Task and pass the DSL reference
check.

Keep authority roles distinct. A mismatch between implementation and a normative
specification does not by itself authorize changing the specification to match
the code. Treat the implementation as defective unless a newer authoritative
product decision supersedes the specification. If current authorities do not
uniquely establish which side is stale or wrong, resolve the product contract
before implementation.

If behavior changes at the architectural or product-policy level, update the
appropriate durable document. Do not update durable documents merely to mirror
incidental implementation detail.

## Documentation lifecycle

Task plans, implementation notes, migration plans, and task checklists are
working documents, not permanent current documentation by default.

Before a Task or multi-Task line of work is complete, review documentation
created, completed, or superseded by that work. Delete obsolete plan/task
documents that no longer describe current behavior and are not needed for future
implementation; Git history is the archive.

Keep current sources of truth, durable engineering policy, current user
documentation, active specifications, and reusable manual/test fixtures. When
removing a document, update links and comments that point to it. Do not delete
unrelated documentation as incidental cleanup.

## Architecture impact check

If a change materially alters subsystem ownership, primary entry points,
architecture boundaries, or documented data flow, update `ARCHITECTURE.md` in
the same Task to describe the resulting current architecture.

Do not update `ARCHITECTURE.md` for ordinary internal changes that stay within
the same documented ownership boundary, and never describe future or proposed
architecture as current.

## Evaluation and dependencies

Evaluation follows the canonical compiler-resolved dependency graph. Unrelated
source positions do not impose evaluation order. Do not introduce a second
resolver or scheduler, and do not reorder authored source merely to hide
dependency problems.

Dependency and evaluation failures should be explicit and actionable. Invalid
geometry must not be presented as ordinary valid geometry.

The Rust evaluation core owns production CAD evaluation semantics. Production
hosts reuse that evaluator through their host boundary. The TypeScript evaluator
remains the reference/parity/test path and compatibility fallback, not a second
production semantics owner.

Development parity or shadow evaluation may compare Rust behavior with the
TypeScript reference. Treat mismatches as implementation bugs unless the current
Task deliberately changes the contract and updates the relevant specification
and tests.

New user-facing evaluation semantics or dependency forms are not production
ready until their Rust behavior and relevant success/error cases are covered by
focused verification.

## Commands, keyboard, and parameters

Keyboard operation is a first-class product requirement. Do not design
mouse-only workflows.

Major operations must be implemented as commands. Buttons, menus, keyboard
shortcuts, command palette entries, and Canvas interactions should dispatch the
same command implementation instead of duplicating business logic in UI
components.

Every new user-facing VS Code command must declare a Palette scope before
implementation. Allowed scopes are exactly:

* `Global`
* `Source`
* `Canvas`
* `Output Preview`
* `Module Preview`
* `Source+Canvas`
* `Source+Output Preview`
* `Source+Module Preview`

Palette scope is part of the implementation contract. For VS Code commands,
`menus.commandPalette[].when` owns broad surface relevance and must not encode
transient target details. For target-contextual commands,
`contributes.commands[].enablement` owns coarse target availability projected
from the canonical current owner. Do not duplicate semantic resolution inside
manifest conditions or context-key projection. Command execution remains
authoritative and must revalidate exact current state. Surface-only commands
should remain available throughout their broad Palette scope and should not gain
target-based enablement.

Global shortcuts must not interfere with normal text and number entry. When an
`input`, `textarea`, `select`, or `contenteditable` element is focused,
ordinary typing and editing shortcuts continue to work normally.

The Inspector is read-only. Do not restore form-style parameter editing there.
Parameter editing and other editing workflows must remain available through
keyboard-accessible production surfaces such as the Source Editor and commands.

Do not maintain a hand-written shortcut list in this file. Shortcut help should
come from command and shortcut metadata in the application.

## Architecture and code organization

The VS Code extension is the production GUI host. Do not introduce another
shipped GUI host or host-specific product semantics without an explicit
architecture Task.

Production hosts and development/test consumers reuse the same canonical
document, compiler, language semantics, and production evaluator through narrow
boundaries. Do not create a second parser, resolver, evaluator, renderer
semantics, or document model merely for one host.

The current supported saved-document language is `nui 1`. Unsupported or
missing versions fail closed. Do not add backward-compatibility, import, or
migration layers unless the current product contract requires them.

The persisted document is one `.nui` DSL text file, and its source text is
canonical. Preserve authored comments, blank lines, and layout. Model- or
command-driven edits use the established source-edit boundary and
statement-level source-preserving patches; do not add a whole-file
reserialization mutation path.

Keep editor-library-specific APIs behind the Source Editor boundary. Other
subsystems communicate through plain application types and narrow editor
interfaces. Native VS Code language providers remain thin host adapters over
host-neutral production language queries rather than owning parallel language
semantics.

Keep shared UI and state logic independent from host-specific APIs. Call
host-specific capabilities through narrow adapters instead of importing host
APIs throughout shared UI code.

Keep geometry computation out of rendering components. Prefer small pure
functions for geometry, dependency, validation, ordering, and parameter access
logic.

Keep cross-language evaluation payloads and result contracts aligned across
TypeScript and Rust, with parity tests where those boundaries change.

Keep changes local to the relevant subsystem. Avoid broad architectural rewrites
unless the requested feature or bug fix genuinely requires them.

### Parallel-friendly change shape

When independent Tasks may be implemented in parallel, preserve established
ownership instead of optimizing only for textual merge convenience.

- Prefer feature-owned modules, hooks, and pure functions over putting unrelated
  feature logic into shared orchestration when the behavior can be isolated
  without duplicating semantics.
- Do not create or enlarge central switches, registries, or lists merely because
  unrelated features need an easy insertion point. Do not split an intentionally
  centralized source of truth merely to avoid merge conflicts.
- Prefer narrow adapters and additive feature-owned changes over broad edits to
  shared owners when both shapes preserve the same architecture.
- Keep feature-specific tests and fixtures with their semantic owner when they
  can verify behavior independently; use shared tests when the acceptance is
  genuinely cross-cutting.
- Avoid scope-unrelated renames, moves, import reordering, whole-file formatting,
  or cleanup that creates broad diff churn.
- Repeated unrelated edits to the same shared owner are a signal to investigate
  ownership decomposition, not a reason to perform that decomposition inside an
  unrelated Task.

## Rendering and performance

The application should remain viable for roughly 1,000 editable geometry
elements, large reference images used as underlays, frequent pan/zoom, and
real-time editing feedback.

User-facing lists, inspectors, selection tools, visibility controls, and error
navigation must remain usable, scannable, and appropriately searchable or
filterable with three-digit element counts.

Treat large reference images as assets, not ordinary lightweight elements. Undo
history should reference large assets by ID and must not duplicate image data.

## Testing and quality

Add focused tests for changed behavior where executable behavior changes.

Determine verification breadth from affected ownership and dependency breadth,
not textual diff size. A small change to a shared parser, compiler,
document/runtime boundary, evaluator path, or other reused owner can require
broad regression coverage. A larger isolated change may need only focused tests
when its production path is exercised directly and independent features cannot
realistically regress.

For tests that exercise asynchronous lifecycle boundaries such as sockets,
streams, child processes, timers, abort/teardown, or similar event emitters,
install relevant error, close, and completion listeners before triggering the
transition. Explicitly consume or assert allowed teardown errors rather than
letting expected lifecycle behavior become an unhandled rejection. Do not
encode event ordering that the runtime or API does not guarantee. Timing- or
race-sensitive lifecycle changes require repeated focused verification; every
iteration must pass, and retry-until-green is not acceptable verification.

For documentation, comments, or policy-only changes that do not change source
code, configuration, generated artifacts, or runtime behavior,
`git diff --check` and diff review are sufficient. Do not routinely run build,
lint, parity, or Rust suites for such changes unless the Task explicitly
requires them.

For TypeScript, TSX, JavaScript, or executable DSL implementation changes, run
focused tests first. Run `npm run build` when production TypeScript, types, or
bundle/build inputs change. Run `npm run lint` when linted source or lint
configuration changes. Run the full `npm test` suite for broad or cross-cutting
changes, shared parser/compiler/document/runtime infrastructure changes, an
explicit full-regression gate, or a final cutover/regression milestone.

Run `npm run test:parity` when evaluation semantics, evaluation payload
conversion, Rust eligibility, or behavior shared by the TypeScript reference
evaluator and Rust evaluator changes. Do not run it for docs-only, UI-only, or
unrelated source changes.

For Rust changes, run `cargo fmt --check`, `cargo check`, and focused Rust
tests first. Run `cargo test` and
`cargo clippy --all-targets -- -D warnings` for broad Rust changes, shared
evaluation/runtime infrastructure changes, a final regression gate, or when the
Task explicitly requires them.

Run host-specific packaging or native-boundary checks when host configuration,
native command registration, release-build behavior, or an explicit Task gate
requires them.

If a required check cannot be run or fails for an unrelated existing reason,
report that clearly.

## Git / GitHub workflow

Repository execution follows the current nuinuiCAD Project Context and the
workflow documents routed from it. This file does not own execution-lane,
checkout, handoff, integration-checkpoint, PR, merge, or completion lifecycle.

Before repository mutation, verify the current authoritative remote state and
the freshness of the target being changed. Do not assume a local `main`,
branch, checkout, worktree, or state recorded in an earlier chat or Task is
current.

If expected and actual repository state differ, do not silently recover with
reset, stash, rebase, merge, force-switch, force-push, or redesign. Follow the
current routed workflow and fail closed when repository identity, ownership, or
expected state cannot be proven.

Keep repository changes scoped to the current Task and review them against their
authoritative pushed state according to the current project workflow. Do not
delete, overwrite, reset, or otherwise disturb unrelated user work.
