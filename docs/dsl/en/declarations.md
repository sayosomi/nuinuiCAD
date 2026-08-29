# Declarations

Typed scalar and array declarations use an explicit type annotation and
initializer.

- `const name: type = expression` creates a read-only value.
- `let name: type = expression` creates a mutable scalar value.
- `set name = expression` creates a later version of an existing `let` value.

Geometry declarations are separate from scalar declarations and are described
in [Constructions](constructions.md). `const` is required for geometry arrays
and records. A declaration is visible only after its source position, subject
to normal module and block scope.

`set` does not create a new geometry element. Its target must resolve to a
mutable scalar binding, and each version is evaluated in source order.

Numeric type options such as `step` and `min` are declaration metadata used by
the typed value editor; they do not add implicit numeric conversions.

<!-- dsl-example: compile-success -->
```nui
nui 4
const allowance: number = 5
let angle: number = 90
set angle = @angle + 15
const showDetail: boolean = true
const side: choice(left, right) = right
```
