# nuinuiCAD

**nuinuiCAD is a parametric 2D CAD system that treats geometry and patterns as source code.**

> **nuinuiCAD is currently under active development and is not yet ready for general use.**

**TODO: Add a screenshot here.**
<!-- ![nuinuiCAD screenshot](docs/images/nuinuicad-screenshot-placeholder.png) -->

The `.nui` source file is the document itself, not an export format or a secondary representation.

nuinuiCAD is source-first. The GUI is designed to assist source editing, not to hide or replace it.

Geometry is defined by expressions and references, so changes propagate through the document deterministically.

`.nui` documents are source files written in nuinuiCAD's own DSL. The language is designed specifically for constructing and editing 2D geometry parametrically.

nuinuiCAD currently runs as a VS Code extension.

nuinuiCAD grew out of sewing pattern drafting, but its 2D geometry model is not limited to sewing.

## Core capabilities

- Parametric construction of 2D geometry
- Parameters, expressions, and references for reusable, connected geometry
- Direct source editing with the `.nui` DSL
- Canvas preview and editing assistance
- Multiple print layouts with SVG and PDF output

## The `.nui` language

The `.nui` language includes:

- Explicitly typed values
- `const`, mutable `let`, and `set`
- Expressions and geometry references
- `if` / `else` and `for` control flow
- Modules with parameters and exports

**TODO: Add a hand-written .nui example here.**

## VS Code integration

- Theme-aware Canvas that adapts to the active VS Code color theme while preserving drawing contrast
- Editor tooling for `.nui`, including diagnostics, completion, navigation, rename, and reference search
- Bidirectional Source–Canvas navigation, including picking geometry references directly from the Canvas
- Keyboard-driven value stepping directly in `.nui` source

## Installation

nuinuiCAD is not yet distributed for general use. Development currently targets the VS Code extension host.

## Development status

Current development work is publicly mirrored in [GitHub Issues](https://github.com/sayosomi/nuinuiCAD/issues).

## Documentation

- [`.nui` DSL Reference](docs/dsl.md)

## Development

All production code is written by AI coding agents.

I use ChatGPT as the project coordinator, separately from the coding agents that implement the code.

The human role focuses on product decisions, supervision, and final UI/UX judgment.

The rules and project context used by ChatGPT are maintained in the [`dev-context`](https://github.com/sayosomi/dev-context/tree/main/projects/nuinuiCAD) repository.

## Third-party licenses

Icons from [Lucide](https://lucide.dev/) are used under the ISC License.
