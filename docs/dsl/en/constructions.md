# Constructions

A named geometry declaration has the form `category Name = construction(...)`.
The generated catalog below is the authoritative syntax and argument reference
for every implemented construction. Its tables intentionally contain only
machine-owned signatures and parameter metadata. The human-authored sections
after the catalog explain what each construction does, how its values are
interpreted, and where its restrictions matter.

<!-- dsl-ref:generated:start constructions -->
<!-- This region is generated from src/dsl/dslConstructions.ts and src/parameters/parameterDefinitions.ts. -->
<!-- dsl-ref:construction:point/coordinate -->
### `point / coordinate`

**Syntax**: `point Name = coordinate(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `x` | number | no | no | — |
| `y` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/offset -->
### `point / offset`

**Syntax**: `point Name = offset(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `from` | reference | yes | no | — |
| `dx` | number | no | no | — |
| `dy` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/polar -->
### `point / polar`

**Syntax**: `point Name = polar(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `from` | reference | yes | no | — |
| `angle` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `distance` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/between -->
### `point / between`

**Syntax**: `point Name = between(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | reference | yes | no | — |
| `end` | reference | yes | no | — |
| `distance` | number | no | no | — |
| `ratio` | number; steps: 0.01, 0.1, 1, 10 | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/onLine -->
### `point / onLine`

**Syntax**: `point Name = onLine(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `from` | lineEndpointReference | yes | no | — |
| `distance` | number | no | no | — |
| `ratio` | number; steps: 0.01, 0.1, 1, 10 | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/intersection -->
### `point / intersection`

**Syntax**: `point Name = intersection(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `line1` | lineReference | yes | no | — |
| `line2` | lineReference | yes | no | — |
| `index` | number | no | no | — |
| `extensions` | boolean | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/tangentOffset -->
### `point / tangentOffset`

**Syntax**: `point Name = tangentOffset(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `line` | lineReference | yes | no | — |
| `base` | reference | yes | no | — |
| `angle` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `curveSide` | choice; choices: convex, concave | no | no | — |
| `distance` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/bezierExtremePoint -->
### `point / bezierExtremePoint`

**Syntax**: `point Name = bezierExtremePoint(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | lineReference | yes | no | — |
| `segmentIndex` | number | no | no | — |
| `direction` | number; steps: 0.1, 1, 15, 60, 90 | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/bezierBulgePoint -->
### `point / bezierBulgePoint`

**Syntax**: `point Name = bezierBulgePoint(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | lineReference | yes | no | — |
| `segmentIndex` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/segment -->
### `line / segment`

**Syntax**: `line Name = segment(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | reference; coordinates allowed | yes | no | — |
| `end` | reference; coordinates allowed | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/polar -->
### `line / polar`

**Syntax**: `line Name = polar(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | reference; coordinates allowed | yes | no | — |
| `angle` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `length` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/commonTangent -->
### `line / commonTangent`

**Syntax**: `line Name = commonTangent(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `first` | lineReference | yes | no | — |
| `second` | lineReference | yes | no | — |
| `kind` | choice; choices: external, internal | yes | no | — |
| `side` | choice; choices: left, right | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/offset -->
### `line / offset`

**Syntax**: `line Name = offset(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `sources` | lineReferenceList | yes | no | — |
| `distance` | number | no | no | — |
| `side` | choice; choices: right, left | no | no | — |
| `closed` | boolean | no | no | — |
| `suppressTrimWarnings` | boolean | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/polyline -->
### `line / polyline`

**Syntax**: `line Name = polyline(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `points` | — | yes | no | points |
| `closed` | boolean | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/split -->
### `line / split`

**Syntax**: `line Name = split(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | lineReference | yes | no | — |
| `at` | reference | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/transformCopy -->
### `line / transformCopy`

**Syntax**: `line Name = transformCopy(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `startPoint` | reference | yes | no | — |
| `endPoint` | reference | yes | no | — |
| `scale` | number; steps: 0.01, 0.1, 1, 10 | no | no | — |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `mirrorX` | boolean | no | no | — |
| `baseLines` | lineReferenceList | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/mirrorCopy -->
### `line / mirrorCopy`

**Syntax**: `line Name = mirrorCopy(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `axis1` | reference | yes | no | — |
| `axis2` | reference | yes | no | — |
| `baseLines` | lineReferenceList | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:curve/bezier -->
### `curve / bezier`

**Syntax**: `curve Name = bezier(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | reference; coordinates allowed | yes | no | — |
| `end` | reference; coordinates allowed | yes | no | — |
| `startAngle` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `startLength` | number | no | no | — |
| `endAngle` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `endLength` | number | no | no | — |
| `intermediates` | — | no | no | intermediates |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:arc/arc -->
### `arc / arc`

**Syntax**: `arc Name = arc(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `center` | reference; coordinates allowed | yes | no | — |
| `radius` | number | no | no | — |
| `start` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `end` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `direction` | choice; choices: counterclockwise, clockwise | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:arc/through -->
### `arc / through`

**Syntax**: `arc Name = through(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `point1` | reference; coordinates allowed | yes | no | — |
| `point2` | reference; coordinates allowed | yes | no | — |
| `point3` | reference; coordinates allowed | yes | no | — |
| `start` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `end` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:arc/corner -->
### `arc / corner`

**Syntax**: `arc Name = corner(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `end1` | lineEndpointReference | yes | no | — |
| `end2` | lineEndpointReference | yes | no | — |
| `radius` | number | no | no | — |
| `index` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:text/label -->
### `text / label`

**Syntax**: `text Name = label(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `text` | text | yes | no | — |
| `anchor` | reference; coordinates allowed; none allowed | no | no | — |
| `size` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:image/image -->
### `image / image`

**Syntax**: `image Name = image(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | text | yes | no | — |
| `origin` | reference; coordinates allowed | yes | no | — |
| `naturalWidthPx` | number | no | no | — |
| `naturalHeightPx` | number | no | no | — |
| `sourceDpi` | number | no | no | — |
| `targetPixelsPerMm` | number | no | no | — |
| `scale` | number; steps: 0.01, 0.1, 1, 10 | no | no | — |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `mirrorX` | boolean | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/edge -->
### `mutation / edge`

**Syntax**: `edge(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `end1` | lineEndpointReference | yes | no | — |
| `end2` | lineEndpointReference | yes | no | — |
| `index` | number | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/extend -->
### `mutation / extend`

**Syntax**: `extend(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `end` | lineEndpointReference | yes | no | — |
| `to` | reference | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/move -->
### `mutation / move`

**Syntax**: `move(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `targets` | lineReferenceList | yes | no | — |
| `from` | reference | yes | no | — |
| `to` | reference | yes | no | — |
| `scale` | number; steps: 0.01, 0.1, 1, 10 | no | no | — |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 | no | no | — |
| `mirrorX` | boolean | no | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/mirrorMove -->
### `mutation / mirrorMove`

**Syntax**: `mirrorMove(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `targets` | lineReferenceList | yes | no | — |
| `axis1` | reference | yes | no | — |
| `axis2` | reference | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/reverse -->
### `mutation / reverse`

**Syntax**: `reverse(...)`

**Arguments**:

| Spelling | Kind and constraints | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `target` | lineReference | yes | no | — |
| `state` | — | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:generated:end constructions -->

## How to use the catalog

Each generated entry above supplies the exact **Syntax** and **Arguments** (the
construction's parameter list) for one construction. The following sections
supply the user-facing **Description**, **Example**, and **Notes** without
repeating generated signatures or editor-owned parameter metadata.
Construction arguments are
named unless the catalog marks a positional argument. Common `state` and
drawing metadata are described in [Modifiers](modifiers.md).

## Points

### `coordinate`, `offset`, and `polar`

**Description:** `coordinate` creates a free point at its `x` and `y`
coordinates. `offset` adds `dx` and `dy` millimetres to an earlier point.
`polar` adds a distance at an angle in degrees from an earlier point.

**Notes:** Point references are valid inputs to later constructions. Angles are
measured in the Y-up drafting coordinate system; ordinary distances are in
millimetres.

### `between` and `onLine`

**Description:** `between` places a point along the directed segment from
`start` to `end`. Supply exactly one of `distance` or `ratio`: distance is a
millimetre offset from `start`, while ratio `0` is `start` and ratio `1` is
`end`. Ratios outside that interval continue along the same line. `onLine`
does the corresponding operation from a referenced line endpoint; its
`distance` or `ratio` also selects exactly one mode.

**Notes:** A missing or simultaneous `distance` and `ratio` is invalid. The
referenced endpoint must be available at the source position.

### `intersection`

**Description:** `intersection` returns one intersection of two referenced
lines. `index` chooses among multiple intersections when the line-like
geometry provides them. `extensions: true` permits the infinite extensions of
the two lines; otherwise the construction uses the supported finite geometry
intersection rules.

**Notes:** Parallel, unavailable, or otherwise non-intersecting inputs produce
an invalid point rather than a guessed result.

### `tangentOffset`

**Description:** `tangentOffset` starts at `base` on `line` and creates a point
at the requested `distance` along a tangent direction. Use `angle` for an
explicit tangent angle, or `curveSide: convex` / `concave` for a curvature-side
offset on a computed cubic Bezier.

**Notes:** `angle` and `curveSide` are mutually exclusive. With neither, the
construction uses the existing angle mode with angle `0`. Curvature-side mode
requires a computed Bezier result (including a split, trim, extend, or reverse
result); lines, arcs, and offset lines are rejected. The base point must lie on
the curve within the implemented `0.001 mm` tolerance. Degenerate, ambiguous,
or off-curve cases are errors; distance `0` is valid after those checks.

### `bezierExtremePoint` and `bezierBulgePoint`

**Description:** These constructions inspect a computed cubic Bezier. The
extreme-point form returns the point with the greatest projection in the
requested direction. The bulge-point form returns the point with the greatest
unsigned distance from the curve's chord, considering both sides.

**Notes:** `segmentIndex` defaults to `0` and must select a valid segment. The
source must be Bezier geometry at runtime, not merely a declaration whose
category once happened to be `curve`. A degenerate chord is invalid for the
bulge calculation. Ties use the point nearest the segment midpoint, then the
smaller curve parameter.

**Example:**

<!-- dsl-example: compile-success -->
```nui
nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
point C = coordinate(x: 100, y: 80)
line AB = segment(start: @A, end: @B)
line BC = segment(start: @B, end: @C)
point Offset = offset(from: @A, dx: 10, dy: 5)
point Polar = polar(from: @A, angle: 90, distance: 20)
point Mid = between(start: @A, end: @B, ratio: 0.5)
point On = onLine(from: @AB.start, ratio: 0.5)
point Cross = intersection(line1: @AB, line2: @BC)
point Tangent = tangentOffset(line: @AB, base: @A, angle: 90, distance: 10)
curve Bow = bezier(start: @A, end: @C, startAngle: 90, startLength: 20, endAngle: 180, endLength: 20)
point High = bezierExtremePoint(source: @Bow, direction: 90)
point Bulge = bezierBulgePoint(source: @Bow)
```

## Lines and curves

### `segment` and line `polar`

**Description:** `segment` joins two points with a strict straight line.
Line `polar` starts at a point and extends for a millimetre `length` at a
degree `angle`. A zero-length result is not a usable strict line for line
measurements.

### `commonTangent`

**Description:** `commonTangent` constructs a tangent line between two
computed arcs. `kind` chooses an external or internal tangent and `side`
chooses the left or right solution.

**Notes:** Both inputs must be valid arcs with positive radii. Concentric,
degenerate, or otherwise unavailable tangent solutions are errors.

### `offset`

**Description:** `offset` offsets one or more ordered line-like sources by a
millimetre `distance`. `side: right` and `side: left` select the side of the
source direction. `closed` closes the resulting chain when requested.

**Notes:** Sources are supplied as a `path[]`-compatible list, so lines, arcs,
and Bezier paths may participate. Offset trimming can produce warnings;
`suppressTrimWarnings` controls those warnings, not the geometry calculation.

### `polyline`

**Description:** `polyline` connects an ordered `point[]` into a line-like
path. With `closed: true`, it adds the final-to-first connection when needed.

**Notes:** An open polyline requires at least two points; a closed polyline
requires at least three. The authored order and duplicate points are retained.

### `split`

**Description:** `split` divides an earlier line-like value at an available
point and returns the resulting split line value. The split point must satisfy
the source geometry's supported split rules.

### `transformCopy` and `mirrorCopy`

**Description:** `transformCopy` copies an ordered line-like list by mapping
its source start point to `endPoint`, then applying the optional positive
`scale`, rotation in degrees, and `mirrorX` reflection. `mirrorCopy` reflects
the list across the axis from `axis1` to `axis2`.

**Notes:** The source list is not rewritten. The axis must be defined by two
distinct available points, and a non-positive or non-finite scale is invalid.

### `bezier`

**Description:** `bezier` creates a cubic Bezier path between its start and end
points. Handle angles are in degrees and handle lengths are millimetres.
Optional intermediate points split the path into ordered cubic segments, each
with its own handle data.

**Notes:** Bezier geometry is broad `path` geometry. It can be consumed by
`path[]` operations and by the Bezier-specific point constructions when the
computed result remains a Bezier.

### `arc`

**Description:** `arc` creates a directed circular arc from a center, radius,
start angle, and end angle. Angles are degrees. `direction` may be
`counterclockwise` or `clockwise`; omitting it is the same as
`counterclockwise`.

**Notes:** `radius` must resolve to a value greater than zero. Zero or negative
values produce a deterministic geometry evaluation error and no computed arc;
runtime geometry properties such as `.radius`, `.length`, and endpoint or center
coordinates are consequently unavailable. Equal start and end angles produce
zero sweep. An explicitly authored full turn such as `0` to `360` produces a
full positive or negative turn according to direction. The readable
`.direction` property is the corresponding choice value; see
[Expressions](expressions.md).

### `through`

**Description:** `through` creates a circular arc through three points. The
points determine the circle and the optional start/end angles select its
directed portion.

**Notes:** Collinear or duplicate defining points cannot determine a circle and
produce an invalid arc. This construction has no `direction` argument; its
geometry determines the resulting sweep.

### `corner`

**Description:** `corner` creates a radius arc at the intersection of two
referenced line endpoints. `radius` controls the fillet size and `index`
selects the relevant intersection when the inputs provide alternatives.

**Notes:** The source lines must provide a valid corner and enough room for the
requested radius. The construction trims the adjoining geometry as part of
the corner result; impossible, parallel, or degenerate corners are errors.

**Example:**

<!-- dsl-example: compile-success -->
```nui
nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
point C = coordinate(x: 100, y: 80)
point D = coordinate(x: 0, y: 80)
point Mid = between(start: @A, end: @B, ratio: 0.5)
line Bottom = segment(start: @A, end: @B)
line Right = segment(start: @B, end: @C)
curve Sweep = bezier(start: @A, end: @C, startAngle: 90, startLength: 20, endAngle: 0, endLength: 20)
arc Quarter = arc(center: @A, radius: 40, start: 0, end: 90, direction: counterclockwise)
arc Through = through(point1: @A, point2: @B, point3: @C, start: 0, end: 90)
line Shifted = offset(sources: [@Bottom], distance: 5, side: right, closed: false)
line Outline = polyline(points: [@A, @B, @C, @D], closed: true)
line Half = split(source: @Bottom, at: @Mid)
line Copy = transformCopy(startPoint: @A, endPoint: @D, baseLines: [@Bottom])
line Mirror = mirrorCopy(axis1: @A, axis2: @D, baseLines: [@Bottom])
```

## Text and images

### `label`

**Description:** `label` creates a text element. Its `text` may be a literal
or a template using `${...}` holes. `anchor` may be an available point or
`none`; `size` is the font size used for drawing.

**Notes:** A template hole accepts a string, number, or boolean. Choices must
be made explicit with `string(...)`; see [Expressions](expressions.md).

### `image`

**Description:** `image` places an image asset from `source` at `origin`.
Optional natural width/height and source DPI describe the asset's physical
size; `targetPixelsPerMm` can specify a target resolution. `scale`, `angleDeg`,
and `mirrorX` control display transformation.

**Notes:** Natural dimensions, DPI, target resolution, and scale must be
positive when supplied. The DSL stores the source and display parameters; it
does not turn image data into geometry.

## Mutations

Mutation statements have no declared name. They operate on earlier line-like
geometry in document order and do not create a new referenceable element.
Every target and source is still an `@` reference or a typed geometry array.

### `edge`

**Description:** `edge` trims or joins geometry at the intersection selected by
two line endpoints. `index` selects an alternative intersection when one is
available.

**Notes:** The endpoints must be available line endpoints and the requested
intersection must be geometrically valid.

### `extend`

**Description:** `extend` extends or trims the selected line endpoint toward a
point. The point is used as the target on the line or its supported extension.

**Notes:** The operation reports an invalid geometry result when the endpoint,
target, or source type cannot support the requested extension.

### `move`

**Description:** `move` rewrites one or more earlier line-like targets by
mapping `from` to `to` and applying optional positive `scale`, rotation
`angleDeg`, and `mirrorX` settings. The targets retain their source order.

### `mirrorMove`

**Description:** `mirrorMove` rewrites the target list by reflecting it across
the axis from `axis1` to `axis2`. The axis points must be distinct and
available.

### `reverse`

**Description:** `reverse` reverses the direction of an earlier line-like
target in place. Later constructions observe the reversed value; earlier
scalar reads do not change retroactively.

**Example:**

<!-- dsl-example: compile-success -->
```nui
nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
line Base = segment(start: @A, end: @B)
reverse(target: @Base)
```

The following shows the shape of a list-consuming mutation without claiming a
particular geometric result.

<!-- dsl-example: syntax-fragment -->
```nui
move(
  targets: [@EarlierLine],
  from: @A,
  to: @B,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
)
```
