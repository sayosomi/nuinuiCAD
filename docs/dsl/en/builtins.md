# Builtins

Builtin names, signatures, calling styles, parameter types, and return types
below are generated from `BUILTIN_FUNCTION_DEFINITIONS`. Positional and
named-only calling styles are distinct. `spreadAngle` is currently named-only;
the other listed signatures are positional.

<!-- dsl-ref:generated:start builtins -->
<!-- This region is generated from src/scalars/builtinFunctions.ts. -->
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
<!-- dsl-ref:generated:end builtins -->

Scalar-only builtins can be used in typed declarations, `set` expressions,
conditions, text-template holes, scalar properties, and module scalar
expressions. Geometry measurement builtins resolve geometry operands through
the existing geometry-reference path and return numbers:

- `distance(point, point)` measures point-to-point distance.
- `angle(point, point)` measures the direction from the first point to the
  second.
- `lineDistance(point, line)` measures point-to-line distance.
- `lineAngle(line, line)` measures the angle between lines.

`round`, `floor`, and `ceil` accept an optional integer precision. `roundTo`
requires a positive step, and `isClose` requires a non-negative tolerance.
Trigonometric inputs and outputs use degrees. `asin` and `acos` require inputs
in `[-1, 1]`; `atan2(y, x)` returns a normalized degree angle. `string` accepts
a concrete `choice(...)` value and returns its canonical option token; it does
not convert numbers or booleans.

<!-- dsl-example: compile-success -->
```nui
nui 4
const seam: number = 5
const rounded: number = round(@seam, 1)
const closeEnough: boolean = isClose(@seam, 5, 0.5)
const side: choice(left, right) = right
const sideText: string = string(@side)
const turn: number = atan2(1, 0)
```
