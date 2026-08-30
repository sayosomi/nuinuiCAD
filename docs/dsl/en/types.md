# Types

## Scalar types

The scalar types are `number`, `boolean`, `string`, and `choice(...)`. There
are no implicit conversions. A choice type includes its option identities and
their order; a choice value must be one of those options. Use
[`string`](builtins.md) when a concrete choice must become text.

`number` values are unitless at the expression level, but each API documents
the unit it expects. Ordinary lengths and coordinates are millimetres; angles
are degrees; drawing widths are pixels; image dimensions and source resolution
use pixels and DPI. A numeric type can carry editor metadata:
`number(step: 0.5, min: 0, max: 20)`. `step` must be positive, `min` and `max`
must be finite, and `min` cannot exceed `max`. These options constrain the
typed value editor; they do not round or clamp runtime expressions.

Boolean operators are `and`, `or`, and `not`. A `choice(...)` declaration must
have at least one unique, unquoted option identifier; option order is part of
the type identity, so `choice(left, right)` and `choice(right, left)` are
different types.

## Geometry types

The module geometry interfaces are `point`, `line`, and `path`. A `line` is a
strict line value. A `path` is the broad line-like interface and accepts lines,
arcs, and Bezier curves. The declaration categories `point`, `line`, `curve`,
and `arc` describe what a construction creates; they are not interchangeable
with the module parameter interfaces. For example, a `curve` can be passed to
a `path` parameter but not to a strict `line` parameter.

Geometry values are referenced with `@` and must be available at the source
position where they are used. Geometry properties are separately typed; only
properties documented as numeric or as a specific choice can be read in a
scalar expression. See [Expressions](expressions.md).

## Geometry arrays

The immutable named geometry array types are exactly `point[]`, `line[]`, and
`path[]`. Arrays are declared with `const`; there is no indexing, spreading,
nested array, or scalar array syntax. An array literal preserves its authored
order and duplicates. An empty literal is valid when the expected array type
is known.

Assignability is intentionally narrow: `point[]` to `point[]`, `line[]` to
`line[]`, `path[]` to `path[]`, and `line[]` to `path[]` are valid. The reverse
`path[]` to `line[]` conversion is not. Array values are consumed by existing
list-taking constructions such as `polyline`, `offset`, `transformCopy`,
`mirrorCopy`, `move`, and `mirrorMove`; they do not add general collection
operations to the language.

```text
const vertices: point[] = [@A, @B]
const edges: line[] = [@AB]
const outline: path[] = [@AB, @Arc]
```

## Records

Records are nominal source-only types whose fields must be scalar. See
[Records](records.md) for their declaration and constructor syntax. Modules
may accept and export records, but a record type is still the exact named
record definition rather than structural field matching.

<!-- dsl-example: compile-success -->
```nui
nui 4
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
const points: point[] = [@A, @B]
const label: string = "front"
const visible: boolean = true
const side: choice(left, right) = left
```
