# Constructions

A named geometry declaration normally has the form `category Name =
construction(...)`. The construction registry below is generated from the
implemented semantic construction and parameter authorities. Its `Syntax` and
`Arguments` data is intentionally limited to facts those authorities own.
Descriptions, examples, and notes in the sections below are human-authored
language reference prose.

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

## Points

Point constructions create free points, offsets, polar offsets, divisions,
intersections, tangent offsets, and measurements on Bezier curves. Point
references are valid inputs to later constructions. A `between` point selects
exactly one of `distance` or `ratio`; `tangentOffset` selects `angle` or
`curveSide` when that mode is used.

## Lines and curves

Line constructions include straight and polar lines, common tangents, offsets,
polylines, splits, transforms, and mirrors. `path[]` is the broad line-like
collection used by offset and copy/move operations. `bezier` creates a cubic
Bezier path and may include intermediate points. Arc constructions include a
center-based arc, a three-point arc, and a corner-radius arc. `arc` supports
`counterclockwise` and `clockwise` directions; omitted direction has the
counterclockwise meaning.

The mutation constructions `edge`, `extend`, `move`, `mirrorMove`, and
`reverse` operate on earlier geometry without introducing a named declaration.
They preserve document-order dependency rules and report invalid geometry.

## Text and images

`text Name = label(...)` creates a label. Its `text` argument accepts a text
template, and its anchor may be a point or `none`. The image construction uses
a source path, an origin, and optional natural-size, DPI, scale, rotation, and
mirror values. Image data is an asset; the DSL stores its source and display
parameters.

<!-- dsl-example: compile-success -->
```nui
nui 4
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
point Mid = between(start: @A, end: @B, ratio: 0.5)
line AB = segment(start: @A, end: @B)
curve Shape = bezier(start: @A, end: @B, startAngle: 90, startLength: 20, endAngle: -90, endLength: 20)
```

<!-- dsl-example: syntax-fragment -->
```nui
point Name = construction(
  start: @EarlierPoint,
  end: @AnotherPoint,
)
```
