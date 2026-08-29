# Constructions

A named geometry declaration normally has the form `category Name =
construction(...)`. The construction registry below is generated from the
implemented semantic construction and parameter authorities. Its `Syntax`,
`Parameters`, and `Arguments` data is intentionally limited to facts those
authorities own. Descriptions, examples, and notes in the sections below are
human-authored language reference prose.

<!-- dsl-ref:generated:start constructions -->
<!-- This region is generated from src/dsl/dslConstructions.ts and src/parameters/parameterDefinitions.ts. -->
<!-- dsl-ref:construction:point/coordinate -->
### `point / coordinate`

**Syntax**: `point Name = coordinate(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `x` | number |
| `y` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `x` | `x` | no | no | — |
| `y` | `y` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/offset -->
### `point / offset`

**Syntax**: `point Name = offset(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `fromPoint` | reference |
| `dx` | number |
| `dy` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `from` | `fromPoint` | yes | no | — |
| `dx` | `dx` | no | no | — |
| `dy` | `dy` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/polar -->
### `point / polar`

**Syntax**: `point Name = polar(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `fromPoint` | reference |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `distance` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `from` | `fromPoint` | yes | no | — |
| `angle` | `angleDeg` | no | no | — |
| `distance` | `distance` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/between -->
### `point / between`

**Syntax**: `point Name = between(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `startPoint` | reference |
| `endPoint` | reference |
| `placementMode` | choice; choices: distance, ratio |
| `distance` | number |
| `ratio` | number; steps: 0.01, 0.1, 1, 10 |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | `startPoint` | yes | no | — |
| `end` | `endPoint` | yes | no | — |
| `distance` | `distance` | no | no | — |
| `ratio` | `ratio` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/onLine -->
### `point / onLine`

**Syntax**: `point Name = onLine(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `endpoint` | lineEndpointReference |
| `placementMode` | choice; choices: distance, ratio |
| `distance` | number |
| `ratio` | number; steps: 0.01, 0.1, 1, 10 |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `from` | `endpoint` | yes | no | — |
| `distance` | `distance` | no | no | — |
| `ratio` | `ratio` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/intersection -->
### `point / intersection`

**Syntax**: `point Name = intersection(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `line1Id` | lineReference |
| `line2Id` | lineReference |
| `intersectionIndex` | number |
| `useExtensions` | boolean |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `line1` | `line1Id` | yes | no | — |
| `line2` | `line2Id` | yes | no | — |
| `index` | `intersectionIndex` | no | no | — |
| `extensions` | `useExtensions` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/tangentOffset -->
### `point / tangentOffset`

**Syntax**: `point Name = tangentOffset(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `baseLineId` | lineReference |
| `basePoint` | reference |
| `tangentAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `curveSide` | choice; choices: convex, concave |
| `distance` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `line` | `baseLineId` | yes | no | — |
| `base` | `basePoint` | yes | no | — |
| `angle` | `tangentAngleDeg` | no | no | — |
| `curveSide` | `curveSide` | no | no | — |
| `distance` | `distance` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/bezierExtremePoint -->
### `point / bezierExtremePoint`

**Syntax**: `point Name = bezierExtremePoint(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `baseLineId` | lineReference |
| `segmentIndex` | number |
| `directionDeg` | number; steps: 0.1, 1, 15, 60, 90 |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | `baseLineId` | yes | no | — |
| `segmentIndex` | `segmentIndex` | no | no | — |
| `direction` | `directionDeg` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:point/bezierBulgePoint -->
### `point / bezierBulgePoint`

**Syntax**: `point Name = bezierBulgePoint(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `baseLineId` | lineReference |
| `segmentIndex` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | `baseLineId` | yes | no | — |
| `segmentIndex` | `segmentIndex` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/segment -->
### `line / segment`

**Syntax**: `line Name = segment(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `startPoint` | reference; coordinates allowed |
| `endPoint` | reference; coordinates allowed |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | `startPoint` | yes | no | — |
| `end` | `endPoint` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/polar -->
### `line / polar`

**Syntax**: `line Name = polar(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `startPoint` | reference; coordinates allowed |
| `startPoint:x` | number |
| `startPoint:y` | number |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `length` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | `startPoint` | yes | no | — |
| `angle` | `angleDeg` | no | no | — |
| `length` | `length` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/commonTangent -->
### `line / commonTangent`

**Syntax**: `line Name = commonTangent(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `firstLineId` | lineReference |
| `secondLineId` | lineReference |
| `kind` | choice; choices: external, internal |
| `side` | choice; choices: left, right |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `first` | `firstLineId` | yes | no | — |
| `second` | `secondLineId` | yes | no | — |
| `kind` | `kind` | yes | no | — |
| `side` | `side` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/offset -->
### `line / offset`

**Syntax**: `line Name = offset(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `baseLineIds` | lineReferenceList |
| `offset` | number |
| `side` | choice; choices: right, left |
| `closed` | boolean |
| `suppressTrimWarnings` | boolean |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `sources` | `baseLineIds` | yes | no | — |
| `distance` | `offset` | no | no | — |
| `side` | `side` | no | no | — |
| `closed` | `closed` | no | no | — |
| `suppressTrimWarnings` | `suppressTrimWarnings` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/polyline -->
### `line / polyline`

**Syntax**: `line Name = polyline(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `closed` | boolean |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `points` | — | yes | no | points |
| `closed` | `closed` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/split -->
### `line / split`

**Syntax**: `line Name = split(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `baseLineId` | lineReference |
| `splitPoint` | reference |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | `baseLineId` | yes | no | — |
| `at` | `splitPoint` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/transformCopy -->
### `line / transformCopy`

**Syntax**: `line Name = transformCopy(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `startPoint` | reference |
| `endPoint` | reference |
| `scale` | number; steps: 0.01, 0.1, 1, 10 |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `mirrorX` | boolean |
| `baseLineIds` | lineReferenceList |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `startPoint` | `startPoint` | yes | no | — |
| `endPoint` | `endPoint` | yes | no | — |
| `scale` | `scale` | no | no | — |
| `angleDeg` | `angleDeg` | no | no | — |
| `mirrorX` | `mirrorX` | no | no | — |
| `baseLines` | `baseLineIds` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:line/mirrorCopy -->
### `line / mirrorCopy`

**Syntax**: `line Name = mirrorCopy(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `axisPoint1` | reference |
| `axisPoint2` | reference |
| `baseLineIds` | lineReferenceList |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `axis1` | `axisPoint1` | yes | no | — |
| `axis2` | `axisPoint2` | yes | no | — |
| `baseLines` | `baseLineIds` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:curve/bezier -->
### `curve / bezier`

**Syntax**: `curve Name = bezier(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `startPoint` | reference; coordinates allowed |
| `startHandleAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `startHandleLength` | number |
| `endPoint` | reference; coordinates allowed |
| `endHandleAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `endHandleLength` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `start` | `startPoint` | yes | no | — |
| `end` | `endPoint` | yes | no | — |
| `startAngle` | `startHandleAngleDeg` | no | no | — |
| `startLength` | `startHandleLength` | no | no | — |
| `endAngle` | `endHandleAngleDeg` | no | no | — |
| `endLength` | `endHandleLength` | no | no | — |
| `intermediates` | — | no | no | intermediates |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:arc/arc -->
### `arc / arc`

**Syntax**: `arc Name = arc(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `centerPoint` | reference; coordinates allowed |
| `radius` | number |
| `startAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `endAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `direction` | choice; choices: counterclockwise, clockwise |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `center` | `centerPoint` | yes | no | — |
| `radius` | `radius` | no | no | — |
| `start` | `startAngleDeg` | no | no | — |
| `end` | `endAngleDeg` | no | no | — |
| `direction` | `direction` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:arc/through -->
### `arc / through`

**Syntax**: `arc Name = through(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `point1` | reference; coordinates allowed |
| `point2` | reference; coordinates allowed |
| `point3` | reference; coordinates allowed |
| `startAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `endAngleDeg` | number; steps: 0.1, 1, 15, 60, 90 |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `point1` | `point1` | yes | no | — |
| `point2` | `point2` | yes | no | — |
| `point3` | `point3` | yes | no | — |
| `start` | `startAngleDeg` | no | no | — |
| `end` | `endAngleDeg` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:arc/corner -->
### `arc / corner`

**Syntax**: `arc Name = corner(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `endpoint1` | lineEndpointReference |
| `endpoint2` | lineEndpointReference |
| `radius` | number |
| `intersectionIndex` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `end1` | `endpoint1` | yes | no | — |
| `end2` | `endpoint2` | yes | no | — |
| `radius` | `radius` | no | no | — |
| `index` | `intersectionIndex` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:text/label -->
### `text / label`

**Syntax**: `text Name = label(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `text` | text |
| `anchor` | reference; coordinates allowed; none allowed |
| `fontSize` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `text` | `text` | yes | no | — |
| `anchor` | `anchor` | no | no | — |
| `size` | `fontSize` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:image/image -->
### `image / image`

**Syntax**: `image Name = image(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `sourcePath` | text |
| `originPoint` | reference; coordinates allowed |
| `originPoint:x` | number |
| `originPoint:y` | number |
| `naturalWidthPx` | number |
| `naturalHeightPx` | number |
| `sourceDpi` | number |
| `targetPixelsPerMm` | number |
| `scale` | number; steps: 0.01, 0.1, 1, 10 |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `mirrorX` | boolean |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `source` | `sourcePath` | yes | no | — |
| `origin` | `originPoint` | yes | no | — |
| `naturalWidthPx` | `naturalWidthPx` | no | no | — |
| `naturalHeightPx` | `naturalHeightPx` | no | no | — |
| `sourceDpi` | `sourceDpi` | no | no | — |
| `targetPixelsPerMm` | `targetPixelsPerMm` | no | no | — |
| `scale` | `scale` | no | no | — |
| `angleDeg` | `angleDeg` | no | no | — |
| `mirrorX` | `mirrorX` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:group -->
### `group`

**Syntax**: `group Name { … }`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `roles` | — | no | no | roles |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:if -->
### `if`

**Syntax**: `if (condition) { … }`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `condition` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `condition` | `condition` | yes | yes | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:for -->
### `for`

**Syntax**: `for variable in range(...) { … }`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `name` | text |
| `variableName` | text |
| `start` | number |
| `count` | number |
| `step` | number |
| `showGenerated` | boolean |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `variable` | `variableName` | yes | yes | — |
| `from` | `start` | yes | no | — |
| `count` | `count` | yes | no | — |
| `step` | `step` | no | no | — |
| `showGenerated` | `showGenerated` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/edge -->
### `mutation / edge`

**Syntax**: `edge(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `endpoint1` | lineEndpointReference |
| `endpoint2` | lineEndpointReference |
| `intersectionIndex` | number |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `end1` | `endpoint1` | yes | no | — |
| `end2` | `endpoint2` | yes | no | — |
| `index` | `intersectionIndex` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/extend -->
### `mutation / extend`

**Syntax**: `extend(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `endpoint` | lineEndpointReference |
| `point` | reference |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `end` | `endpoint` | yes | no | — |
| `to` | `point` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/move -->
### `mutation / move`

**Syntax**: `move(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `startPoint` | reference |
| `endPoint` | reference |
| `scale` | number; steps: 0.01, 0.1, 1, 10 |
| `angleDeg` | number; steps: 0.1, 1, 15, 60, 90 |
| `mirrorX` | boolean |
| `baseLineIds` | lineReferenceList |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `targets` | `baseLineIds` | yes | no | — |
| `from` | `startPoint` | yes | no | — |
| `to` | `endPoint` | yes | no | — |
| `scale` | `scale` | no | no | — |
| `angleDeg` | `angleDeg` | no | no | — |
| `mirrorX` | `mirrorX` | no | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/mirrorMove -->
### `mutation / mirrorMove`

**Syntax**: `mirrorMove(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `axisPoint1` | reference |
| `axisPoint2` | reference |
| `baseLineIds` | lineReferenceList |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `targets` | `baseLineIds` | yes | no | — |
| `axis1` | `axisPoint1` | yes | no | — |
| `axis2` | `axisPoint2` | yes | no | — |
| `state` | `state` | no | no | — |
| `steps` | — | no | no | steps |
| `id` | — | no | no | id |
| `roles` | — | no | no | roles |
| `parent` | — | no | no | parent |
| `branch` | — | no | no | branch |

<!-- dsl-ref:construction:mutation/reverse -->
### `mutation / reverse`

**Syntax**: `reverse(...)`

**Parameters**:

| Name | Kind and constraints |
| --- | --- |
| `targetLineId` | lineReference |

**Arguments**:

| Spelling | Parameter key | Required | Positional | Special |
| --- | --- | --- | --- | --- |
| `target` | `targetLineId` | yes | no | — |
| `state` | `state` | no | no | — |
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
