# Types

## Scalar types

The scalar types are `number`, `boolean`, `string`, and `choice(...)`. There
are no implicit conversions. A choice type includes its option identities and
their order; a choice value must be one of those options.

Numbers represent physical values unless a declaration explicitly documents a
different unit, such as degrees or pixels. Boolean operators are `and`, `or`,
and `not`.

## Geometry types

The module geometry interfaces are `point`, `line`, and `path`. A `line` is a
strict line value. A `path` accepts line-like geometry such as lines, arcs, and
Bezier curves. Geometry values are referenced with `@` and must be available at
the source position where they are used.

## Geometry arrays

The immutable named geometry array types are exactly `point[]`, `line[]`, and
`path[]`. Arrays are declared with `const`; there is no indexing, spreading,
nested array, or scalar array syntax in this feature. `line[]` can be passed to
a `path[]` parameter, but the reverse conversion is not allowed.

```text
const vertices: point[] = [@A, @B]
const edges: line[] = [@AB]
const outline: path[] = [@AB, @Arc]
```

## Records

Records are nominal source-only types whose fields must be scalar. See
[Records](records.md) for their declaration and constructor syntax.

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
