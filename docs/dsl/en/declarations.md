# Declarations

## Typed values

Typed scalar declarations use an explicit type annotation and initializer:

- `const name: type = expression` creates a read-only scalar, geometry value, nominal record value, or one-dimensional `T[]` collection.
- `const name: point|line|path = @reference` creates a read-only, non-drawable
  geometry value. The initializer may be an existing geometry reference or, in
  the implemented pure-value subset, `coordinate(x: ..., y: ...)` for `point`,
  `polar(from: ..., angle: ..., distance: ...)` for `point`,
  `between(start: ..., end: ..., distance: ...)` or `between(start: ..., end: ..., ratio: ...)` for `point`,
  `onLine(from: ..., distance: ...)` or `onLine(from: ..., ratio: ...)` for `point`,
  `intersection(line1: ..., line2: ..., index: ..., extensions: ...)` for `point`,
  `tangentOffset(line: ..., base: ..., angle: ..., curveSide: ..., distance: ...)` for `point`,
  `segment(start: ..., end: ...)` for `line` or `path`, `polar(start: ...,
  angle: ..., length: ...)` for `line` or `path`, and
  `commonTangent(first: ..., second: ..., kind: ..., side: ...)` for `line`
  or `path`, and direct
  `arc(center: ..., radius: ..., start: ..., end: ..., direction: ...)` for
  `path`. `bezierExtremePoint(source: ..., segmentIndex: ..., direction: ...)`
  and `bezierBulgePoint(source: ..., segmentIndex: ...)` are also pure `point`
  initializers. Their source must evaluate to Bezier geometry, including a pure
  `bezier(...)` path value; `segmentIndex` defaults to `0`, extreme direction
  uses normalized degree semantics, and coincident bulge endpoints fail through
  the occurrence-owned geometry-value diagnostic channel. `direction` defaults
  to `counterclockwise` only for direct `arc`.
  `commonTangent` requires both inputs and both choices: `kind` is `external`
  or `internal`, and `side` is `left` or `right`. Its inputs must evaluate to
  arcs at runtime, including direct or through pure arc values; failures are
  reported through the occurrence-owned geometry-value diagnostic channel.
  `tangentOffset` angle mode uses a line-like source and defaults `angle` to
  `0` when both modes are omitted. Its `curveSide` mode accepts `convex` or
  `concave` only for computed cubic Bezier geometry and requires an on-curve
  base point and nonnegative distance; failures remain occurrence-owned.
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
remains consumable by existing path-compatible readers. `polyline(...)` is an
implemented pure `path` initializer using the drawable `points` and `closed`
arguments; it preserves authored order and requires at least two open points
or three closed points. Point `offset(...)` is an implemented pure `point`
initializer, and path `offset(...)` is an implemented pure `path` initializer;
both reuse the corresponding drawable offset geometry and preserve the same
defaults and validation. Runtime failures remain owned by the value occurrence
and do not create a drawable identity. `corner` and other deferred
constructions remain unsupported as pure value initializers.

Point `polar(...)` is an identity-free pure point initializer with the same
degree-angle and `distance` semantics and defaults (`angle: 0`, `distance: 0`)
as drawable point `polar`. Line `polar(...)` is an identity-free pure strict
line initializer with the same semantics and defaults (`angle: 0`,
`length: 100`) as drawable line `polar`; its `line` result is also assignable to
`path`. Neither pure form creates a drawable element or identity.

Point `between(...)` and `onLine(...)` are also identity-free pure point
initializers. Each requires exactly one of `distance` or `ratio`; omitting both
or supplying both is invalid. `between` measures distance from `start` toward
`end`, while `onLine` measures from the referenced `start` or `end` endpoint
using the complete line/path geometry. Pure forms do not create a drawable
element, computed drawable entry, or synthetic identity.

Pure `intersection(...)` accepts line-like `line` or `path` inputs and uses
`index: 0` and `extensions: false` when omitted. It returns an identity-free
point; same-source, parallel, unavailable, and out-of-range inputs remain
occurrence-owned geometry-value runtime errors.

`set` does not create a geometry element or a new binding. Its target must be a
mutable scalar in scope, and its right-hand side is checked against that
binding's scalar type. A `set` is evaluated in document order, so a later
version can use the value produced by the previous version.

### Scalar, choice, geometry, and record value-if

Scalar, choice, geometry, and nominal-record declarations may use a
value-producing conditional with a required `else` branch:

<!-- dsl-example: syntax-fragment -->
```nui
const amount: number = if (@flag) { 10 } else { 20 }
const side: choice(left, right) =
  if (@flag) {
    left
  } else {
    right
  }
const selectedPoint: point = if (@flag) { @origin } else { coordinate(x: 0, y: 0) }
const selectedPair: Pair = if (@flag) { Pair(x: 10, label: "left") } else { @fallback }
```

The condition must be boolean. Both branches are parsed, resolved, and
typechecked against the declaration's scalar, choice, geometry interface, or
exact nominal record type; bare choice literals are resolved using that exact
declared choice type. Record branches must each be a constructor, whole-record
reference, or supported indexed record-collection member of the same nominal
type. At runtime the condition is evaluated first and only the selected branch
is evaluated. Geometry branches may be existing `@` references or implemented
pure geometry constructions. Collection-valued `if` and exhaustive `match` are
supported; optional result values remain deferred.

### Exhaustive choice value-match

Scalar, choice, geometry, and nominal-record declarations may also select a
value with an exhaustive
`match` over a concrete `choice(...)` expression:

<!-- dsl-example: syntax-fragment -->
```nui
const amount: number = match @size { small => 5 large => 10 }
const side: choice(left, right) =
  match @size {
    small => left
    large => right
  }
const selectedPath: path = match @side {
  left => @edge
  right => segment(start: @origin, end: (10, 0))
}
const selectedPair: Pair = match @side {
  left => Pair(x: 10, label: "left")
  right => @fallback
}
```

The scrutinee must have a concrete `choice(...)` type. Each declared option
must appear exactly once as a bare case label: impossible labels, duplicate
labels, and missing labels are deterministic diagnostics. There is no wildcard
or default arm. Every arm result is parsed and typechecked; results may be
`number`, `string`, `boolean`, or `choice(...)` and must share the declaration's
exact type. Bare choice result literals use the declaration's exact choice type.
At runtime the scrutinee is evaluated first and only the matching arm is
evaluated. Geometry arms must share the declaration's `point`, `line`, or
`path` interface and may contain existing references or implemented pure
constructions. Record arms must share the declared record definition's exact
nominal identity and may use constructors, whole-record references, or
supported indexed record-collection members. Collection match values are
supported recursively; optional `none`/`some` match values remain deferred.

### Collection value-if and value-match

An `if` or exhaustive choice `match` may produce a one-dimensional collection
when every branch or arm has the same declared collection type:

<!-- dsl-example: syntax-fragment -->
```nui
const widths: number[] = if (@wide) { [20, 30] } else { [10] }
const sideMarks: choice(left, right)[] = match @side {
  left => [left]
  right => [right, right]
}
```

The selected branch or arm determines `.length` and indexed members. A
conditional collection may feed existing point, line, or path consumers when
its element type is assignable to the required geometry interface. Nominal
record collections preserve their declared record identity and indexed field
consumption. Collection control flow is lazy: the unselected branch or arm is
not evaluated. Nested arrays and optional result values remain outside the
current language surface.

### Collection value-for

An immutable one-dimensional scalar, choice, geometry, or nominal-record
collection can be produced by mapping an existing whole-value collection:

<!-- dsl-example: syntax-fragment -->
```nui
const doubled: number[] =
  for x in @values {
    @x * 2
  }

const sides: choice(left, right)[] =
  for value in @choices {
    left
  }

const points: point[] = for item in @origins { @item }
const paths: path[] = for edge in @edges { @edge }

record Pair(
  x: number,
  label: string,
)
const first: Pair = Pair(x: 1, label: "one")
const pairs: Pair[] = [@first]
const shifted: Pair[] = for item in @pairs {
  Pair(x: @item.x + 10, label: @item.label)
}
```

The source must be a collection already declared and visible at this source
position. The immutable binder has the source element's exact scalar, choice,
geometry, or nominal-record type and is visible only in the body. The body is
checked against the declared result element type, so scalar kinds may change,
geometry interfaces must be assignable, bare choice literals use the declared
result choice identity and order, and record source/result types must retain
exact nominal identity. Mapping emits one member per source member in authored
order, preserves duplicates, and maps an empty source to an empty result. It is
lazy: `.length` reports source cardinality without evaluating the body, and
indexing evaluates only the requested member or record field.

Whole-value aliases, Module locals, exports, parameters, and per-instance
namespace rules retain the collection identity. This implemented surface does
not support nested arrays, filtering, folding, scanning, or mutable
accumulation. Geometry mapping supports `point[]`,
`line[]`, and `path[]`, including the existing `line[] -> path[]`
assignability; a `path` result is not assignable to `line`.

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
