# Builtins

The generated catalog below is the source of truth for builtin function names,
scalar constant spellings, signatures, calling styles, parameter types, and
return types. The sections after it describe what each argument means, its
units, and its runtime restrictions. Positional and named-only calling styles are distinct;
`spreadAngle` is currently named-only and every other listed builtin is
positional.

<!-- dsl-ref:generated:start builtins -->
<!-- This region is generated from src/scalars/builtinFunctions.ts and src/scalars/builtinConstants.ts. -->
| Builtin | Signatures | Reference identity |
| --- | --- | --- |
<!-- dsl-ref:builtin:abs -->
| `abs` | abs(number) -> number | `dsl-ref:builtin:abs` |
<!-- dsl-ref:builtin:min -->
| `min` | min(number, number) -> number | `dsl-ref:builtin:min` |
<!-- dsl-ref:builtin:max -->
| `max` | max(number, number) -> number | `dsl-ref:builtin:max` |
<!-- dsl-ref:builtin:sqrt -->
| `sqrt` | sqrt(number) -> number | `dsl-ref:builtin:sqrt` |
<!-- dsl-ref:builtin:round -->
| `round` | round(number) -> number \| round(number, number) -> number | `dsl-ref:builtin:round` |
<!-- dsl-ref:builtin:floor -->
| `floor` | floor(number) -> number \| floor(number, number) -> number | `dsl-ref:builtin:floor` |
<!-- dsl-ref:builtin:ceil -->
| `ceil` | ceil(number) -> number \| ceil(number, number) -> number | `dsl-ref:builtin:ceil` |
<!-- dsl-ref:builtin:roundTo -->
| `roundTo` | roundTo(number, number) -> number | `dsl-ref:builtin:roundTo` |
<!-- dsl-ref:builtin:isClose -->
| `isClose` | isClose(number, number, number) -> boolean | `dsl-ref:builtin:isClose` |
<!-- dsl-ref:builtin:sin -->
| `sin` | sin(number) -> number | `dsl-ref:builtin:sin` |
<!-- dsl-ref:builtin:cos -->
| `cos` | cos(number) -> number | `dsl-ref:builtin:cos` |
<!-- dsl-ref:builtin:tan -->
| `tan` | tan(number) -> number | `dsl-ref:builtin:tan` |
<!-- dsl-ref:builtin:asin -->
| `asin` | asin(number) -> number | `dsl-ref:builtin:asin` |
<!-- dsl-ref:builtin:acos -->
| `acos` | acos(number) -> number | `dsl-ref:builtin:acos` |
<!-- dsl-ref:builtin:atan -->
| `atan` | atan(number) -> number | `dsl-ref:builtin:atan` |
<!-- dsl-ref:builtin:atan2 -->
| `atan2` | atan2(number, number) -> number | `dsl-ref:builtin:atan2` |
<!-- dsl-ref:builtin:spreadAngle -->
| `spreadAngle` | spreadAngle(length: number, spread: number) -> number | `dsl-ref:builtin:spreadAngle` |
<!-- dsl-ref:builtin:string -->
| `string` | string(choice(...)) -> string | `dsl-ref:builtin:string` |
<!-- dsl-ref:builtin:distance -->
| `distance` | distance(point, point) -> number | `dsl-ref:builtin:distance` |
<!-- dsl-ref:builtin:angle -->
| `angle` | angle(point, point) -> number | `dsl-ref:builtin:angle` |
<!-- dsl-ref:builtin:lineDistance -->
| `lineDistance` | lineDistance(point, line) -> number | `dsl-ref:builtin:lineDistance` |
<!-- dsl-ref:builtin:lineAngle -->
| `lineAngle` | lineAngle(line, line) -> number | `dsl-ref:builtin:lineAngle` |

### Scalar constants

| Constant | Type | Value | Reference identity |
| --- | --- | --- | --- |
<!-- dsl-ref:builtin-constant:pi -->
| `pi` | number | 3.141592653589793 | `dsl-ref:builtin-constant:pi` |
<!-- dsl-ref:generated:end builtins -->

`pi` is the canonical lowercase numeric constant. It is a number literal in
expressions and evaluates to the binary64 value `3.141592653589793`. `PI` is
not an alias, `pi()` is not a function call, and `@pi` is an ordinary reference
to a user binding named `pi` when one exists.

## Scalar arithmetic

**Description:** `abs`, `min`, `max`, and `sqrt` operate on finite numbers and
return numbers. `sqrt` rejects a negative input. Invalid arguments and
non-finite results are evaluation errors; there is no numeric coercion.

**Parameters:** `min` and `max` compare their two values. `sqrt` takes one
value. `abs` returns the non-negative magnitude of its value.

**Example:**

```text
const magnitude: number = abs(-12)
const lower: number = min(@magnitude, 20)
const root: number = sqrt(@lower)
```

## Rounding and comparison

**Description:** `round`, `floor`, and `ceil` take an optional integer decimal
digit position. With no second argument they operate at the unit position.
`round` uses an away-from-zero midpoint rule, so `round(1.5)` is `2` and
`round(-1.5)` is `-2`. `roundTo(value, step)` rounds to a positive step, using
the same away-from-zero midpoint rule. `isClose(a, b, tolerance)` returns
whether `abs(a - b) <= tolerance`.

**Parameters and errors:** The precision argument must be an integer; `step`
must be positive; and `tolerance` must be non-negative. Finite inputs are
required and non-finite results are evaluation errors.

## Trigonometry

**Description:** `sin`, `cos`, and `tan` take degree inputs. `asin`, `acos`,
and `atan` return degree outputs. `asin` and `acos` accept only `[-1, 1]`.
`tan` reports an evaluation error for an exact odd multiple of `90` degrees.

`atan2(y, x)` returns a normalized degree in `0 <= result < 360`: right is
`0`, up is `90`, left is `180`, and down is `270`. `atan2(0, 0)` returns `0`.
Non-finite inputs are invalid and non-finite results are evaluation errors.

## `spreadAngle`

**Description:** `spreadAngle(length: ..., spread: ...)` returns the central
angle subtended by a chord. `spread` is a chord length, not an arc length. The
result is `2 * asin(spread / (2 * length))` in degrees.

**Parameters:** `length` must be positive and `spread` must satisfy
`0 <= spread <= 2 * length`. The result is in `0..180` degrees; the endpoints
map to `0` and `180`. Arguments are named-only, may be supplied in either
order, and are evaluated using the canonical `length`, then `spread` order.
Invalid or non-finite arguments are evaluation errors.

## Choices and geometry measurements

`string(choiceValue)` is the explicit choice-to-string conversion. It returns
the selected canonical option token exactly as stored by the choice type. A
number, boolean, string, or context-free bare choice literal is not accepted.
Choice types remain nominal by option identity and order; see
[Types](types.md).

The measurement builtins use the geometry interfaces described in
[Types](types.md):

- `distance(first, second)` returns the Euclidean distance between two points
  in millimetres.
- `angle(first, second)` returns the directed point-to-point angle in degrees,
  normalized to `0 <= result < 360`. Identical points return `0`.
- `lineDistance(point, line)` returns the perpendicular distance to the
  infinite extension of a strict line, not the finite segment. A line whose
  length is at most `1e-9` mm is invalid.
- `lineAngle(first, second)` returns the directionless smaller angle between
  two strict lines, in the inclusive range `0..90` degrees. The lines need not
  intersect; reversing or swapping them does not change the result. A line
  whose length is at most `1e-9` mm is invalid.

## Where calls are valid

Scalar-only builtins can be used in typed declarations, `set` expressions,
conditions, text-template holes, scalar properties, and scalar module
expressions. Geometry measurement builtins can be called directly in typed
declaration initializers, `set` right-hand sides, and module scalar
expressions. To use a measurement in a construction numeric argument, a scalar
property, a text hole, or a layout/output numeric field, first assign it to a
typed `number` and reference that binding.

<!-- dsl-example: compile-success -->
```nui
nui 4
const seam: number = 5
const rounded: number = round(@seam, 1)
const closeEnough: boolean = isClose(@seam, 5, 0.5)
const side: choice(left, right) = right
const sideText: string = string(@side)
const turn: number = atan2(1, 0)
const chordAngle: number = spreadAngle(length: 20, spread: 10)
```
