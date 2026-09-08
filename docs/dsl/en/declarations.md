# Declarations

## Typed values

Typed scalar declarations use an explicit type annotation and initializer:

- `const name: type = expression` creates a read-only scalar, geometry value, nominal record value, or one-dimensional `T[]` collection.
- `const name: point|line|path = @reference` creates a read-only, non-drawable
  geometry value. The initializer may be an existing geometry reference or, in
  the implemented pure-value subset, `coordinate(x: ..., y: ...)` for `point`,
  `segment(start: ..., end: ...)` for `line` or `path`, and direct
  `arc(center: ..., radius: ..., start: ..., end: ..., direction: ...)` for
  `path`. `direction` defaults to `counterclockwise`.
- `let name: type = expression` creates a mutable scalar binding.
- `set name = expression` creates a new source-order version of an existing
  `let` binding.

Geometry declarations have their own category-and-construction form and are
described in [Constructions](constructions.md). Records are also `const`-only;
see [Records](records.md). A declaration is visible only after its source
position and only within its lexical scope. Names cannot be used to reorder
evaluation.

`let` is not allowed for single-geometry values. `line` aliases can be used
where `path` is expected, but a `path` alias cannot be used where `line` is
required.

Collection declarations require an explicit element type and use `const`:
`number[]`, `string[]`, `boolean[]`, `choice(...)[]`, `point[]`, `line[]`,
`path[]`, and arrays of already-valid nominal record values are supported.
Array literals preserve order and duplicates; `[]` uses the declared element
type, and a whole-value `@reference` keeps its resolved collection identity.
Nested arrays such as `T[][]` are rejected.

Pure geometry constructions are source values, not drawable declarations. They
do not create an element or drawable identity. `through` is an implemented pure
`path` initializer taking `point1`, `point2`, and `point3`, with optional
`start` and `end` angles defaulting to 0 and 90 degrees and using a
counterclockwise sweep. Duplicate or collinear points fail at runtime through
the occurrence-owned geometry-value diagnostic channel. Direct arc values
continue to expose the common path geometry surface and preserve their
evaluated center, endpoints, radius, directed sweep, and length without a
drawable identity. Pure `bezier(...)` is also a `path` initializer with the
drawable constructor's `start`, `end`, endpoint handle, and optional
intermediate-point arguments. It produces identity-free cubic segments and
remains consumable by existing path-compatible readers. Pure `offset`,
`corner`, `polyline`, and other deferred constructions remain unsupported as
pure value initializers.

`set` does not create a geometry element or a new binding. Its target must be a
mutable scalar in scope, and its right-hand side is checked against that
binding's scalar type. A `set` is evaluated in document order, so a later
version can use the value produced by the previous version.

### Scalar and choice value-if

Scalar and choice declarations may use a value-producing conditional with a
required `else` branch:

<!-- dsl-example: syntax-fragment -->
```nui
const amount: number = if (@flag) { 10 } else { 20 }
const side: choice(left, right) =
  if (@flag) {
    left
  } else {
    right
  }
```

The condition must be boolean. Both branches are parsed, resolved, and
typechecked against the declaration's scalar or choice type; bare choice
literals are resolved using that exact declared choice type. At runtime the
condition is evaluated first and only the selected branch is evaluated. The
current value-if surface does not produce geometry, record, or collection
values.

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
nui 1
const allowance: number = 5
const width: number(step: 0.5, min: 0, max: 20) = 5
let angle: number = 90
set angle = @angle + 15
const showDetail: boolean = true
const side: choice(left, right) = right
```
