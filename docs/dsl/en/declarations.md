# Declarations

## Typed values

Typed scalar declarations use an explicit type annotation and initializer:

- `const name: type = expression` creates a read-only scalar or geometry array.
- `let name: type = expression` creates a mutable scalar binding.
- `set name = expression` creates a new source-order version of an existing
  `let` binding.

Geometry declarations have their own category-and-construction form and are
described in [Constructions](constructions.md). Records are also `const`-only;
see [Records](records.md). A declaration is visible only after its source
position and only within its lexical scope. Names cannot be used to reorder
evaluation.

`set` does not create a geometry element or a new binding. Its target must be a
mutable scalar in scope, and its right-hand side is checked against that
binding's scalar type. A `set` is evaluated in document order, so a later
version can use the value produced by the previous version.

## Numeric editor metadata

`number` may include positive `step` and finite `min`/`max` metadata, for
example `number(step: 0.5, min: 0, max: 20)`. `min` cannot exceed `max`.
These options describe the typed value editor. They do not implicitly round,
clamp, or convert an expression at runtime. Units still come from the API
that consumes the number: ordinary construction distances are millimetres,
angles are degrees, and drawing widths are pixels.

## Examples

<!-- dsl-example: compile-success -->
```nui
nui 4
const allowance: number = 5
const width: number(step: 0.5, min: 0, max: 20) = 5
let angle: number = 90
set angle = @angle + 15
const showDetail: boolean = true
const side: choice(left, right) = right
```
