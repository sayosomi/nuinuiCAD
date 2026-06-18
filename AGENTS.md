# AGENTS.md

## Project overview

This project is a prototype of a 2D parametric CAD application for sewing pattern drafting.

The goal is not to build a general-purpose CAD application. The goal is to build a practical pattern-drafting editor that can eventually replace workflows currently done in Momoko CAD / [桃CAD](https://xn--6xw240d.net/index.html).

The application should prioritize:

* sewing pattern drafting
* parametric construction steps
* clear dependency errors
* editable geometric elements
* curve length measurement
* fast keyboard-driven operation
* SVG-based 2D editing
* future PDF export and tiled A4 printing

## Core product direction

This application is a parametric pattern drafting editor.

Prefer features useful for clothing pattern work over general mechanical CAD features.

Important future features include:

* free points
* offset points
* construction lines
* line segments
* cubic Bézier curves
* curve handle editing
* curve length measurement
* combined path length measurement
* dimensions and labels
* notches
* seam allowances
* grain lines
* SVG export
* PDF export
* tiled A4 printing

Do not start by implementing a full generic geometric constraint solver.

Instead, start with a deterministic parametric construction engine.

## Evaluation model

Elements are evaluated from top to bottom.

Each element may only reference elements that have already been evaluated earlier in the list.

For example, this is valid:

1. Point A
2. Point B
3. Line AB using Point A and Point B

This is invalid:

1. Point A
2. Line AB using Point A and Point B
3. Point B

In the invalid case, Line AB must report a clear dependency error because Point B is not available at the time Line AB is evaluated.

Do not automatically sort or repair the element order in the initial implementation.

The user should be able to see which element is broken and which dependency is missing or appears too late.

## Dependency error policy

When dependency order is broken, show a clear error.

Errors should include:

* the broken element ID
* the broken element name
* the missing dependency ID
* the missing dependency name if available
* a human-readable message

Example message:

> Line AB references Point B, but Point B is after this element or does not exist. Move Point B before Line AB.

Elements with dependency errors should be visibly marked in the element list.

Invalid geometry should either not be drawn or should be drawn as a clear warning marker.

Prefer understandable errors over automatic correction.

## Display order and evaluation order

For the initial implementation, display order and evaluation order may be the same.

In the future, these may be separated into:

* evaluation order / construction history
* visual layer order

Do not introduce this separation prematurely unless necessary.

## Keyboard-first UI policy

Keyboard operation is a first-class requirement.

One of the major motivations for this project is dissatisfaction with CAD software that requires too much mouse interaction and does not support meaningful keyboard operation outside text and number inputs.

Therefore:

* Do not design mouse-only workflows.
* Major operations must be available through keyboard shortcuts.
* Buttons, menus, and keyboard shortcuts should call the same command implementations.
* Implement actions as commands, not as ad-hoc button-only handlers.
* Keep command definitions centralized enough that a command palette can be added later.
* The UI should expose a shortcut list or help view.
* Do not let global shortcuts interfere with normal text or number entry.

When an `input`, `textarea`, `select`, or `contenteditable` element is focused, ordinary typing and editing shortcuts must continue to work normally.

## Parameter edit mode

Selected element parameters must be operable by keyboard, not only by mouse or direct form focus.

Use an explicit parameter edit mode:

* `Enter`: enter parameter edit mode for the selected element
* `Escape`: leave parameter edit mode
* `ArrowDown` / `ArrowUp`: move between editable parameters
* parameter name keys: jump to parameters only while parameter edit mode is active; define the actual keys in the centralized parameter definition table
* arrow keys: adjust the selected numeric parameter or cycle reference choices when appropriate
* `Space`: toggle the selected boolean parameter

When adding a new element type, also add its editable parameters to the centralized parameter definition table. Each parameter should define:

* stable parameter key
* human-readable label
* direct key used in parameter edit mode
* value kind: text, number, boolean, or reference

Numeric parameters should support per-parameter keyboard step sizes, defaulting to 1 mm.

## Command architecture

Prefer a command-based architecture.

Examples of commands:

* selectNextElement
* selectPreviousElement
* moveSelectedElementUp
* moveSelectedElementDown
* toggleSelectedElementVisibility
* deleteSelectedElement
* addFreePoint
* addOffsetPoint
* addLine
* focusCanvas
* focusElementList

UI buttons and keyboard shortcuts should dispatch the same commands.

Avoid duplicating business logic inside React components.

## Suggested initial keyboard shortcuts

Use `Mod` to mean Command on macOS and Ctrl on Windows/Linux.

Initial shortcuts:

* `ArrowUp`: select previous element
* `ArrowDown`: select next element
* `Mod+ArrowUp`: move selected element up
* `Mod+ArrowDown`: move selected element down
* `Delete` / `Backspace`: delete selected element
* `v`: toggle selected element visibility
* `p`: add free point
* `o`: add offset point
* `l`: add line
* `?`: show or hide shortcut help

These are initial defaults and may be changed later.

## Technical stack

Use:

* Vite
* React
* TypeScript
* SVG rendering
* Zustand if state management becomes useful

## Code organization

Keep the code modular.

Recommended separation:

* types
* geometry evaluation
* validation
* commands
* keyboard shortcuts
* state/store
* React components
* SVG rendering

Avoid mixing geometry computation directly into React rendering components.

Avoid mixing keyboard shortcut handling directly into individual UI buttons.

## Geometry model

The initial geometry model should support:

* free point
* offset point
* line

All elements should have:

* id
* name
* type
* visible
* enabled

`visible` controls whether the element is drawn.

`enabled` controls whether the element is evaluated.

A hidden element may still be evaluated and referenced by other elements.

A disabled element must not produce computed geometry, even if it is visible.


Free point:

* x
* y

Offset point:

* fromPointId
* dx
* dy

Line:

* startPointId
* endPointId

Computed geometry should be derived by evaluating the element list from top to bottom.

## Performance and large document policy

This application must handle sewing patterns and embroidery drawings with many elements.

Target scale:

- approximately 1,000 editable geometry elements
- large reference images used as underlays
- frequent pan and zoom operations
- real-time editing feedback

Do not assume that all geometry should be rendered as React DOM or SVG elements.

Prefer a rendering architecture that can evolve toward:

- Canvas for main geometry rendering
- Canvas for large reference images
- SVG or HTML overlays for selected elements, handles, labels, and editing UI

Large reference images must be treated as assets, not ordinary lightweight elements.

The application should eventually generate reduced-size preview images for display and avoid redrawing full-resolution images unnecessarily.

Undo history must not duplicate large image data. Store image assets separately and refer to them by asset ID.

Curve length calculations should be cached and recomputed only when the curve geometry changes.

## Units and coordinate system

Use millimeters as the conceptual unit.

The SVG canvas may map millimeters to pixels through a scale factor, but geometry values should be treated as millimeters.

Future printing and PDF export depend on predictable physical units.

## Future curve support

Design the architecture so that cubic Bézier curves can be added later.

Future Bézier curve elements should support:

* start point
* end point
* start handle length
* start handle angle
* end handle length
* end handle angle
* real-time curve length measurement

Curve length measurement is a high-priority future feature.

Do not implement curve length constraints first.

The first curve-related goal is:

* draw curves
* edit handles
* show curve length in real time
* show target length and difference if a target is entered

## Solver policy

Do not implement a full general-purpose geometric constraint solver in the initial prototype.

The initial engine should be a parametric construction evaluator, not a SolveSpace-like solver.

Acceptable early features:

* fixed/free points
* offset points
* horizontal/vertical offsets by dx/dy
* lines between existing points
* dependency validation

Future features may include:

* point on line
* intersection point
* midpoint
* perpendicular/horizontal/vertical construction helpers
* simple constraint assists

A full solver can be considered later only if the product needs it.

## Error handling preference

Prefer explicit, readable errors.

Do not silently fix model problems.

Do not hide broken dependencies.

Do not produce geometry from invalid dependencies.

When possible, show what the user should move or edit to fix the issue.

## Testing and quality

When adding geometry or validation logic, prefer small pure functions that can be tested.

If a test setup exists, add tests for:

* valid evaluation order
* missing dependency
* dependency that appears too late
* visibility behavior
* command behavior
* keyboard shortcut mapping

If no test setup exists, keep logic simple and isolated so tests can be added later.

## Implementation style

Use TypeScript types carefully.

Prefer discriminated unions for element types.

Avoid stringly-typed geometry where possible.

Keep IDs stable.

Avoid making large architectural changes unless necessary.

When changing behavior, update this file if the project policy changes.
