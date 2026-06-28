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

## Source of truth

When updating behavior, prefer these source files over duplicating details here:

* Element and geometry types: `src/types/geometry.ts`
* Geometry evaluation: `src/geometry/`
* Rust/Tauri evaluation core: `src-tauri/src/evaluation/`
* Tauri desktop shell and commands: `src-tauri/`
* Dependency and document ordering logic: `src/model/`
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

`visible` controls drawing. `enabled` controls evaluation. A hidden element may
still be evaluated and referenced. A disabled element must not produce computed
geometry, even if it is visible.

For now, document order can continue to serve as both evaluation order and
display order unless a change explicitly introduces separate visual layering.

The Rust evaluation core is the intended long-term source of truth for CAD
document evaluation. During migration, keep the TypeScript evaluator as a
reference implementation and compare Rust output against it for supported
element ranges. Do not switch an element type to Rust-first evaluation until
its dependency behavior, geometry output, errors, warnings, and visibility /
enabled masks match the TypeScript reference for focused fixtures.

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

Selected element parameters must remain operable by keyboard through explicit
parameter edit mode. When adding a parameter, define it in the centralized
parameter definition table with a stable key, label, direct key, and value kind.
Numeric parameters should support per-parameter keyboard step sizes, defaulting
to 1 mm unless the parameter needs domain-specific levels such as ratios or
angles.

Do not maintain a hand-written shortcut list in this file. Shortcut help should
come from command and shortcut metadata in the application.

## Architecture and code organization

Use Vite, React, TypeScript, SVG/Canvas rendering, Zustand where shared state
is useful, and Tauri v2 for the desktop application shell.

The app should continue to work as a browser/Vite app for tests and frontend
development, while also being packaged as a Tauri desktop app for local macOS
use. Browser and test environments should use the TypeScript reference
evaluator. Tauri runtime may call Rust evaluation through the evaluation engine
adapter when the current document slice is within the Rust-supported element
set.

Prefer Rust for deterministic, CPU-heavy, or platform-adjacent work:

* CAD document evaluation and dependency checks as element coverage matures
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
type generation is introduced, maintain this manually with parity tests. When
Rust supports only a subset of an element's possible dependencies, the
TypeScript Rust-eligibility check must account for referenced element types, not
just the element's own `type`.

Keep changes local to the relevant subsystem. Avoid broad architectural
rewrites unless the requested feature or bug fix genuinely requires them.

## Rendering and performance

The application should remain viable for roughly 1,000 editable geometry
elements, large reference images used as underlays, frequent pan/zoom, and
real-time editing feedback.

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
* visibility versus enabled behavior
* command dispatch behavior
* keyboard shortcut mapping and form-input exclusion
* parameter definition and keyboard edit behavior
* geometry measurement behavior when relevant

Run the relevant checks before handing work back:

* `npm test`
* `npm run build`
* `npm run lint`
* `cargo fmt --check` in `src-tauri` when Rust code changed
* `cargo test` in `src-tauri` when Rust code changed
* `cargo clippy --all-targets -- -D warnings` in `src-tauri` when Rust code changed
* `npm run desktop:build` when Tauri packaging, commands, or Rust evaluation changed

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
