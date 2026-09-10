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

Typed declarations may hold one immutable geometry value:

```text
const origin: point = @A
const edge: line = @AB
const outline: path = @edge
const originPoint: point = coordinate(x: 0, y: 0)
const measuredEdge: line = segment(start: @originPoint, end: (10, 0))
const broadEdge: path = segment(start: @originPoint, end: (10, 0))
const polarPoint: point = polar(from: @originPoint, angle: 90, distance: 20)
const middlePoint: point = between(start: @originPoint, end: (10, 0), ratio: 0.5)
const polarLine: line = polar(start: @polarPoint, angle: 30, length: 100)
const fromEnd: point = onLine(from: @polarLine.end, distance: 25)
const polarPath: path = @polarLine
const roundedEdge: path = arc(center: @originPoint, radius: 10, start: 0, end: 90)
const throughEdge: path = through(point1: @originPoint, point2: (10, 10), point3: (20, 0))
const selectedPoint: point = if (@enabled) { @originPoint } else { coordinate(x: 0, y: 0) }
const selectedPath: path = match @side { left => @edge right => segment(start: @originPoint, end: (10, 0)) }
```

The initializer may be an existing legal `@` geometry reference or one of the
implemented pure construction forms: `coordinate`, `between`, `onLine`, and
`intersection`
produce `point`, `segment` and line `polar` produce strict `line`, direct `arc` produces broad `path`, and `through`
produces an immutable non-drawable `path` by fitting a circle through
`point1`, `point2`, and `point3`. `through` accepts optional `start` and `end`
angles, defaulting to 0 and 90 degrees, and is counterclockwise. Duplicate or
collinear points fail at runtime through the value-owned geometry diagnostic
channel. A strict `line` is also assignable to `path`. These values are
source-level values, not drawable elements or scalar runtime values. The
declared type remains the public type through alias chains: `point` accepts
only `point`, `line` accepts only `line`, and `path` accepts `line` or `path`.
Single-geometry values are `const`-only. Pure `bezier(...)` is a supported
`path` initializer and stores identity-free cubic segments. Pure
`polyline(...)` is also a `path` initializer using the drawable `points` and
`closed` arguments; it stores ordered identity-free line segments, preserves
duplicate points, and requires at least two open points or three closed points.
`transformCopy(...)` and `mirrorCopy(...)` are also immutable, non-drawable
`path` initializers. `transformCopy` first translates every source point by
`endPoint - startPoint`; when `mirrorX` is true it mirrors about the vertical
axis through `endPoint`, then scales about `endPoint`, and finally rotates
about `endPoint` by `angleDeg`. Its defaults are `scale: 1`, `angleDeg: 0`,
and `mirrorX: false`; `startPoint` is an explicit transform reference, not an
implicit source-list endpoint. `mirrorCopy` reflects across the axis from
`axis1` to `axis2`.
Both preserve ordered structural line, arc, and Bezier segments and record
all source references without creating a drawable identity.
Invalid runtime inputs fail through the occurrence-owned geometry-value
diagnostic channel. Point and path `offset(...)` are also implemented pure
initializers; they reuse the corresponding drawable offset geometry and remain
consumable by existing point/path-compatible readers. Pure point and line
`polar(...)` initializers likewise share the drawable polar geometry and
defaults; the strict pure line participates in the existing `line` to `path`
assignability rule. Pure `between(...)` requires exactly one `distance` or
`ratio`; distance advances from `start` toward `end`, and ratio `0`/`1` denote
the endpoints while allowing directed extrapolation. Pure `onLine(...)`
requires exactly one of the same modes and retains the full line/path target
plus the referenced endpoint direction. Missing or simultaneous modes are
invalid, and these pure forms allocate no drawable identity. `corner` and other
deferred constructions remain unsupported.

Geometry values also support expression-local value control flow. `if` requires
a boolean condition, an `else` branch, and a geometry-compatible result in
both branches. `match` requires an exhaustive `choice(...)` scrutinee; every
case is resolved and checked, while only the selected branch is evaluated at
runtime. Branches may use existing `@` geometry references or the pure
construction forms listed above. Records, collections, and optional values are
not supported as geometry-valued results in nui1.

Pure `intersection(line1: ..., line2: ..., index: ..., extensions: ...)` is an
identity-free `point` initializer accepting line-like `line` or `path` inputs.
`index` defaults to `0` and `extensions` defaults to `false`; same-source,
parallel, unavailable, and out-of-range cases fail through the occurrence-owned
geometry-value diagnostic channel.

Pure `tangentOffset(line: ..., base: ..., angle: ..., curveSide: ..., distance: ...)`
is an identity-free `point` initializer. Angle mode accepts line-like `line` or
`path` inputs and defaults `angle` to `0` when neither mode is supplied.
`curveSide` accepts `convex` or `concave` only for computed cubic Bezier paths,
including pure Bezier values; the base must be on the curve within `0.001 mm`
and the distance must be nonnegative. Runtime failures are occurrence-owned.

`bezierExtremePoint(source: ..., segmentIndex: ..., direction: ...)` and
`bezierBulgePoint(source: ..., segmentIndex: ...)` are identity-free pure
`point` initializers. Their source must be a computed Bezier curve, either
drawable or a pure `bezier(...)` path value. `segmentIndex` defaults to `0`;
extreme directions use the existing normalized degree semantics, and a bulge
segment with coincident endpoints fails through the occurrence-owned diagnostic
channel.

## One-dimensional arrays

The immutable named collection type is one-dimensional `T[]`. `T` may be
`number`, `string`, `boolean`, `choice(...)`, `point`, `line`, `path`, or an
already-valid nominal record type. Arrays require an explicit declaration type
and `const`; nested arrays such as `T[][]` are rejected.

Assignability is intentionally narrow: `point[]` to `point[]`, `line[]` to
`line[]`, `path[]` to `path[]`, and `line[]` to `path[]` are valid. The reverse
`path[]` to `line[]` conversion is not. Array literals preserve authored order
and duplicates. Empty literals use the declared element type, and whole-value
references retain their resolved source identity. Scalar, choice, geometry, and
nominal-record members use the existing element assignability rules. Scalar and
record collections are source-semantic values in this slice.

```text
const vertices: point[] = [@A, @B]
const edges: line[] = [@AB]
const outline: path[] = [@AB, @Arc]
const widths: number[] = [10, 20]
const labels: string[] = ["front", "back"]
const sides: choice(left, right)[] = [left, right]
const copiedWidths: number[] = @widths
```

Scalar and choice arrays also support a lazy value-for mapping from an
existing whole-value collection. The result type remains the explicit
one-dimensional declaration type:

<!-- dsl-example: syntax-fragment -->
```nui
const doubled: number[] = for value in @widths { @value * 2 }
```

The binder is immutable and body-local, has the exact source element type, and
produces one result for every source member in source order. Duplicates and
empty sources are preserved. `.length` reads source cardinality without
evaluating the body; indexing evaluates only the requested mapped member.
Geometry and nominal-record value-for are not part of the current DSL
Reference surface.

Every collection exposes the read-only numeric property `.length`. It reports
the authored member count, including duplicates, for literals and for all
whole-value alias chains. It does not project or materialize a selected member.

Collections support first-class zero-based indexing with `@collection[index]`.
The index is a normal typed `number` expression, for example
`@marks[0]` or `@marks[@index + 1]`, and the result has the collection's exact
element type. This preserves order, duplicates, aliases, nominal record
identity, and pure geometry value identity without creating a drawable element
identity. Optional Module collection parameters require a preceding
`hasValue(@parameter)` proof. The index must be finite, integral, at least `0`,
and less than the collection length; invalid dynamic indexes are evaluation
errors and are never clamped or wrapped.

## Records

Records are nominal source-only types whose fields must be scalar. See
[Records](records.md) for their declaration and constructor syntax. Modules
may accept and export records, but a record type is still the exact named
record definition rather than structural field matching.

<!-- dsl-example: compile-success -->
```nui
nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
const points: point[] = [@A, @B]
const label: string = "front"
const visible: boolean = true
const side: choice(left, right) = left
```
