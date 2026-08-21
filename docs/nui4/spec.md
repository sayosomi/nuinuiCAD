# nui4 language specification

## Status and scope

`nui4` is the implemented and final language contract. The production parser,
compiler, source editor, and document format now accept `nui 4` only. This
document is the normative language contract and source of truth for the
completed nui4 migration.

The migration is a destructive replacement. nui4 does not accept ambiguous nui3
compatibility syntax, and the project has no nui3 compatibility layer,
converter, importer, or migration wizard. `docs/dsl.md` documents the
implemented nui4 language.

The persisted document remains one `.nui` source-text file. Source text is the
durable source of truth, and source edits preserve statement-level identity and
user layout.

## Highest-level principles

The following principles are normative and apply to every nui4 feature:

1. A document is evaluated from top to bottom. Declarations are never hoisted.
2. `@` always means a reference.
3. Every value has a type.
4. `{}` creates a lexical scope.
5. `::` traverses a namespace or container.
6. nui4 does not perform implicit dependencies, implicit capture, or automatic
   reordering.

These rules are language semantics, not formatter preferences or implementation
options.

## Version

The language version is:

```text
nui 4
```

The parser and compiler must not design an ambiguous compatibility grammar that
accepts both nui3 and nui4 spellings. The final supported document format is
nui4, and it is the current production format.

## References and names

### Reference marker

An existing named value is referenced only with `@`:

```text
@A
@seam
@前身頃::肩線
@AB.length
@写し::縫い線.end
```

The conceptual reference grammar is:

```text
@qualifiedName
@qualifiedName.property
```

`::` is namespace/container traversal. It moves from one resolved named
container to a named member, such as `@前身頃::肩線` or
`@foo::頂点`. `.` is property access after the name has been resolved, such as
`@AB.length` or `@写し::縫い線.end`.

Every value reference, including scalar references, geometry references, derived
points, endpoints, and property references, uses this same `@` form. There is
no geometry-only exception:

```text
line AB = segment(
  start: @A,
  end: @B,
)
```

`from: A` is not a reference in nui4. A bare identifier is a keyword, a choice
literal, or another grammar token with a specifically defined role; it is never
silently treated as a value reference. A missing, disabled, invalid, private, or
too-late reference is a diagnostic and is not repaired by reordering the
document.

## Namespace and scope

Named declarations participate in one lexical namespace within their scope.
This includes scalars, geometry, groups, module definitions, and module
instances. A name may be declared only once in one scope. Nested scopes may
reuse a name without changing the meaning of an already-resolved outer binding.

Declarations are non-hoisted and obey source order. A declaration cannot refer to
a later declaration in the same scope. The evaluator does not dependency-sort,
forward-resolve, or otherwise reorder statements to make a reference work.

The following constructs create scopes:

- `group` bodies
- `if` bodies
- `for` bodies
- module definition bodies
- module instance/member containers
- `layout` bodies

A module body is a closed scope. It cannot implicitly capture an outer scalar,
geometry, group member, or control binding. Values needed by a module must be
declared as parameters and passed by the instance.

## Typed values and expressions

Every expression has a static and runtime type. nui4 has these scalar types:

- `number`
- `string`
- `boolean`
- `choice(...)`

The initial geometry interface types are `point`, `line`, and `path` (see
[Geometry types](#geometry-types)). There is no implicit type conversion. A
number is not silently converted to a string or boolean, a choice is not silently
converted to a string, and a geometry value is not silently converted to a
different geometry type.

Scalar initializers, `set` right-hand sides, runtime-ready numeric construction
fields, module arguments, conditions, property values, array members, and
`layout`, `place`, `print`, and `svg` numeric fields all use one typed expression surface
model. nui4 does not expose separate historical
`NumericValue`, numeric-expression, or property-binding opt-in language features.

The formal operator set is:

```text
+  -  *  /  %  ^
<  <=  >  >=  ==  !=
and
or
not
```

The constraints are:

- `+`, `-`, `*`, and `/` operate on `number` values and produce `number`.
- `number ^ number -> number` and `number % number -> number`.
- `^` is right-associative and binds more tightly than unary `+` and `-`.
  `%` has the same multiplicative precedence as `*` and `/` and is
  left-associative. For example, `2 ^ 3 ^ 2 = 512`, `-2 ^ 2 = -4`,
  `2 ^ -2 = 0.25`, and `20 % 6 % 4 = 2`.
- `%` is remainder, not percent. It follows JavaScript / Rust remainder
  semantics: the result has the dividend's sign (`-5 % 3 = -2`,
  `5 % -3 = 2`, `-5 % -3 = -2`).
- Comparisons operate on compatible values and produce `boolean`.
- Equality and inequality require compatible operand types and produce
  `boolean`; there is no coercive equality.
- `and` and `or` require `boolean` operands and produce `boolean`.
- `not` requires a `boolean` operand and produces `boolean`.
- Division by zero and other invalid runtime operations are explicit evaluation
  diagnostics. `5 % 0` produces `evaluation-remainder-by-zero`. A non-finite
  power result such as `(-1) ^ 0.5`, `0 ^ -1`, or `10 ^ 10000` produces
  `evaluation-non-finite-result`.

Named scalar function calls use the following syntax:

```nui
abs(-1)
max(1, 2)
round(@length / 2, 1)
max(abs(@a), round(@b, 2))
```

The call syntax is `functionName(arg1, arg2)`. Its callee is a bare function
name. Zero, one, and multiple arguments are valid syntax, and each argument is
an ordinary typed expression; nested calls are allowed. The parser does not
decide whether the callee names a builtin, so `unknownFunction(10)` is also
syntactically valid. Function resolution, unknown-function diagnostics, arity,
argument types, and return types are determined during the semantic phase.
Future user-defined functions may use this same call syntax, but user-defined
function declarations are not part of the current language surface. Arbitrary
callees, postfix calls, and first-class functions are not part of the current
language surface.

A scalar builtin signature may declare named calling style. Such a signature
uses `name: expression` arguments:

```nui
someFunction(
  second: 2,
  first: 1,
)
```

Named argument order has no semantic meaning. Multiline argument lists may have
a trailing comma. Parameter names, parameter types, and canonical parameter
order are owned by the builtin signature metadata. Positional-only and
named-only signatures are semantically distinct; a call must use the declared
style, and mixed positional/named calls are invalid in nui4 v1. Unknown,
duplicate, or missing named arguments produce diagnostics. The current builtin
catalog is positional-only for existing builtins; `spreadAngle` is the first
production named-only scalar builtin. This syntax does not add named forms to
any other existing builtin. After semantic validation, a valid named call is
lowered to the existing canonical positional `TypedBuiltinArgument[]` runtime
shape; argument names are not part of the runtime payload.

The current builtin catalog is:

| Function | Signature |
| --- | --- |
| `abs` | `abs(number) -> number` |
| `min` | `min(number, number) -> number` |
| `max` | `max(number, number) -> number` |
| `sqrt` | `sqrt(number) -> number` |
| `round` | `round(number) -> number`, `round(number, number) -> number` |
| `floor` | `floor(number) -> number`, `floor(number, number) -> number` |
| `ceil` | `ceil(number) -> number`, `ceil(number, number) -> number` |
| `roundTo` | `roundTo(number, number) -> number` |
| `isClose` | `isClose(number, number, number) -> boolean` |
| `sin` | `sin(number) -> number` |
| `cos` | `cos(number) -> number` |
| `tan` | `tan(number) -> number` |
| `asin` | `asin(number) -> number` |
| `acos` | `acos(number) -> number` |
| `atan` | `atan(number) -> number` |
| `atan2` | `atan2(number, number) -> number` |
| `spreadAngle` | `spreadAngle(length: number, spread: number) -> number` (named-only) |
| `distance` | `distance(point, point) -> number` |
| `angle` | `angle(point, point) -> number` |
| `lineDistance` | `lineDistance(point, line) -> number` |
| `lineAngle` | `lineAngle(line, line) -> number` |

The second argument of `round`, `floor`, and `ceil` is the decimal digit
position and must be an integer. `round` uses an away-from-zero midpoint rule
(`round(1.5)` is `2`, and `round(-1.5)` is `-2`). `roundTo` requires a positive
step, and `isClose` requires a non-negative tolerance. Invalid arguments and
non-finite results are explicit evaluation diagnostics; no implicit numeric
conversion is performed.

The trigonometric builtins use degrees as their public angle unit. `sin`,
`cos`, and `tan` take degree inputs. `asin`, `acos`, and `atan` return degree
outputs. `asin` and `acos` accept only inputs in `[-1, 1]`. `tan` reports an
evaluation error for an exact odd multiple of 90 degrees; values that are not
exactly singular are evaluated normally. `atan2` takes arguments in the order
`atan2(y, x)` and returns a degree in `0 <= result < 360`: right is `0°`, up is
`90°`, left is `180°`, and down is `270°`. `atan2(0, 0)` returns `0`.
Non-finite inputs fail with an invalid-argument evaluation error, and
non-finite results fail with a non-finite-result evaluation error. `atan2` and
the existing `angle(point, point)` builtin share the same direction and
normalization rule.

`spreadAngle(length: number, spread: number)` is named-only. `spread` is a chord
length, not an arc length. The result is defined by
`theta = 2 * asin(spread / (2 * length))` and its public unit is degrees. The
domain is `length > 0` and `0 <= spread <= 2 * length`; the result is in the
inclusive range `0..180` degrees. `spread = 0` returns `0`, and
`spread = 2 * length` returns `180`. Invalid or non-finite arguments produce an
evaluation error. Named source order has no meaning; runtime lowering uses the
canonical `[length, spread]` positional order.

The geometry measurement builtins use the existing geometry interface types.
`distance` returns the Euclidean distance between two points. `angle` returns
the direction from its first point to its second point in degrees, normalized
to `0 <= angle < 360`: right is `0°`, up is `90°`, left is `180°`, and down is
`270°`. When both points are identical, the result is `0`.

`lineDistance` requires the strict `line` interface for its second argument. It
returns the perpendicular distance from the point to the infinite straight
line obtained by extending that line, not the shortest distance to the finite
line segment. For example, the line `(0, 0) -> (1, 0)` and point `(10, 3)`
produce `3`. A zero-length or effectively zero-length line is an error; the
runtime threshold is `length <= 1e-9`.

`lineAngle` requires the strict `line` interface for both arguments. It returns
the directionless smaller angle between the two line direction vectors in
degrees, in the inclusive range `0..90`. The lines do not need to intersect.
Reversing either line, or swapping the arguments, does not change the result;
therefore a directed difference of `135°` returns `45°`. A zero-length or
effectively zero-length line is an evaluation error; the runtime threshold is
`length <= 1e-9`. This is distinct from `angle(point, point)`, which returns a
directed point-to-point direction normalized to `0..360` degrees.

Scalar-only builtins are available anywhere the shared typed-expression
frontend already supports scalar expressions: typed declarations, `set`
right-hand sides, boolean conditions, scalar property values, text-template
holes, and scalar module arguments/body expressions. Geometry-argument builtins
(`distance`, `angle`, `lineDistance`, and `lineAngle`) can be called directly
only where the existing geometry-reference resolution path is available:
typed declaration initializers, `set` right-hand sides, and module scalar
expressions. The same catalog and signatures are used by source completion.

Task 4 does not add a new evaluator or resolver surface. To use a geometry
measurement result in a construction numeric parameter, scalar property,
text-template hole, or layout/output numeric parameter, first assign it to a
typed scalar binding and reference that binding instead, for example
`const measuredAngle: number = lineAngle(@LineA, @LineB)` followed by
`@measuredAngle`.

This is a typed expression surface for CAD construction, not a general-purpose
programming language.

### Scalar declarations and mutation

The scalar declaration forms are:

```text
const seam: number = 5
let angle: number = 90
set angle = 180
```

`const` is immutable after initialization. `let` may be updated by `set` in its
scope, subject to normal type checking and source-order rules. `var` does not
exist in nui4.

## Geometry types

The minimum geometry types usable in module and interface signatures are:

- `point`: a point geometry.
- `line`: a geometry that can be treated as one straight line.
- `path`: the broad line-like type that can accept line, arc, bezier, and other
  supported linear geometry.

The module/interface type `line` must not be confused with the existing element
declaration category `line`. The existing element categories remain unchanged by
this Task 1 specification:

```text
point
line
curve
arc
text
image
```

`path` is an interface type for accepting broad line-like geometry. It does not
require renaming the internal `line` element category or introducing a new
persisted element category.

## Element declarations and construction calls

The basic declaration shape remains category, name, and construction:

```text
point A = coordinate(
  x: 0,
  y: 0,
)

line AB = segment(
  start: @A,
  end: @B,
)
```

The construction call is named-argument-first. In canonical multi-line form,
the final argument has a trailing comma. A single-line call is parseable, but
the Source Editor's canonical formatter emits the stable multi-line shape for a
multi-argument call.

### Tangent offsets by Bezier curvature side

`tangentOffset` supports the existing tangent-angle mode and a curvature-side
mode for computed cubic Bezier geometry:

```text
point outer = tangentOffset(
  line: @curve,
  base: @base,
  curveSide: convex,
  distance: 3,
)
```

`curveSide` is a choice with the options `convex` and `concave`. `angle` and
`curveSide` are mutually exclusive. If neither is supplied, the construction
uses the existing-compatible `angle: 0` mode. Canonical serialization emits
only the active mode's argument: `angle` for angle mode or `curveSide` for
curvature-side mode.

Curvature-side mode is accepted only when the evaluated dependency has
`computedGeometry.kind == "bezierCurve"`. This is determined from computed
geometry rather than the declared source element type, so original, split,
trimmed, extended, and reversed Bezier results are accepted. Lines, arcs,
offset-line results, and other non-Bezier computed geometry are rejected.

The base point is projected using the existing cubic curve projection and must
be within the existing `0.001 mm` on-curve tolerance. For a cubic `B(t)`, with
`T = B'(t)`, `A = B''(t)`, and `speed = |T|`, signed curvature is
`cross(T, A) / speed^3`. The left normal is `(-T.y / speed, T.x / speed)`;
the concave normal is `sign(curvature) * leftNormal`, and the convex normal is
its opposite. This definition preserves the physical side when the path is
reversed. A zero tangent, zero or near-flat curvature, exact inflection,
ambiguous/corner internal join, off-curve base point, invalid `curveSide`
literal, or negative distance is an evaluation error. Distance zero remains
valid after these geometry validations pass.

### Bezier direction extreme points

`bezierExtremePoint` creates a point at the maximum projection of one cubic
Bezier segment in a requested direction:

```text
point 上端 = bezierExtremePoint(
  source: @ベジェ線,
  segmentIndex: 0,
  direction: 90,
)
```

`source` is required and must resolve at runtime to computed geometry whose
`kind` is `bezierCurve`. This is a runtime geometry requirement rather than a
check of the source element type, so a Bezier result produced by a normal split,
trim, or extend evaluation is accepted; straight lines, arcs, and offset-line
results are rejected. `segmentIndex` is an optional numeric value with default
`0`, and must resolve to a finite, non-negative integer within the source's
segment range. `direction` is a required finite numeric degree value. Direction
`0` is right, `90` is up, `180` is left, and `270` is down. Negative values and
values above `360` are normalized using the existing degree normalization rule.

For the selected cubic segment `B(t)`, let `V` be the unit vector for
`direction`. The result maximizes `dot(B(t), V)` over `0 <= t <= 1`. Candidates
are both endpoints and every interior stationary point satisfying
`dot(B'(t), V) = 0`. If candidate scores are equal, the candidate closest to
`t = 0.5` wins; if that distance is also equal, the smaller `t` wins. A flat
projection returns `t = 0.5`. Canonical serialization always writes the
defaulted `segmentIndex`, including when it was omitted from the input.

### Bezier bulge points

`bezierBulgePoint` creates a point at the maximum unsigned bulge of one cubic
Bezier segment relative to the chord through that segment's endpoints:

```text
point 膨らみ点 = bezierBulgePoint(
  source: @ベジェ線,
)
```

`source` is required. `segmentIndex` is an optional numeric value with default
`0`; canonical serialization writes `segmentIndex: 0` when it was omitted.
Exactly one selected cubic segment is evaluated. The value must be finite,
non-negative, integral, and within the source segment range.

For the selected segment `P0, P1, P2, P3`, let `B(t)` be its cubic curve,
`D = P3 - P0`, and `L = |D|`. Interior candidates satisfy
`cross(D, B'(t)) = 0`, where `B'(t)` is quadratic. Candidate scores are the
unsigned perpendicular chord distances
`abs(cross(D, B(t) - P0)) / L`. Thus an S curve compares absolute distances on
both sides of the chord. Endpoints are not added as ordinary candidates. A
flat derivative scalar uses `t = 0.5`; a completely chord-collinear curve
therefore returns its zero-bulge point at parameter `t = 0.5` rather than an
assumed geometric midpoint. Candidate selection uses the common tie-break:
larger score, then closer to `t = 0.5`, then smaller `t`.

If `L <= EPSILON`, the selected segment has a degenerate chord and evaluation
reports a geometry error. The source is accepted based on runtime computed
geometry `kind == "bezierCurve"`, not the declaration type: original Bezier
geometry and Bezier geometry produced by split, trim, or extend are accepted;
other computed kinds such as line, arc, or offset line produce a geometry
error, while missing or disabled sources produce a dependency error.

## Groups and activity

`group` combines four roles:

- UI hierarchy
- lexical scope
- namespace/container
- activity container

Nested groups may contain members with names that exist in an outer group. The
same source-order, non-hoisted resolution rules apply in every group.

Each element or activity container has exactly one activity state:

- `visible`: evaluates and draws normally.
- `hidden`: evaluates and may be referenced, but is not drawn.
- `disabled`: is not evaluated, produces no computed geometry, and cannot be
  referenced by later statements.

An invalid dependency is not drawn as normal valid geometry. The application
reports the dependency error and either omits the geometry or displays a clear
warning marker.

## Drawing modifier profiles and style properties

Drawing Profiles are top-level, source-ordered declarations in the ordinary
lexical namespace. A profile is referenced with `@name`; references are not
hoisted, so a declaration must appear before its use.

```text
profile 印刷用
profile SVG用

modifier 型紙線 {
  state: visible,
  width: 1px,
  style: solid,
  color: foreground,

  for @印刷用 {
    width: 0.5px,
  }
}
```

The supported modifier properties are independent: `state` is `visible`,
`hidden`, or `disabled`; `width` is a positive finite decimal pixel literal;
`style` is `solid`, `dashed`, or `dotted`; and `color` is a theme role
(`foreground`, `muted`, `accent`, `info`, `warning`, or `error`) or `#RRGGBB`.
The former compound `stroke:` property is invalid. A modifier may contain only
these properties and `for @profile { ... }` blocks; profile blocks may contain
only the same four properties. A modifier may be profile-only. Duplicate
properties and duplicate overrides for the same resolved profile are errors.

Effective properties cascade from outer group to inner group to element. Within
each owner, modifier lists are applied left to right. The cascade merges each
property independently and starts from `1px solid foreground`. A selected
Drawing Profile overlays the common properties with its matching delta.

Direct element activity is a hard gate: modifier state is applied only after
direct and ancestor activity resolves to `visible`. `hidden` elements still
evaluate and may be referenced; `disabled` elements do not evaluate and cannot
be referenced by later elements. Canvas evaluation omits a selected Drawing
Profile unless a host explicitly supplies one.

## Conditional and iteration control

The formal nui4 conditional form is:

```text
if (@condition) {
  ...
}
```

The condition must be a `boolean` typed expression. An `if` body creates a
lexical scope. The nui3 container-name form is not retained; `if (...) as name`
is not part of nui4 v1. Stable identity is tracked by source statement identity,
so an `if` does not require a user-provided name.

The formal iteration form is:

```text
for i in range(
  from: 0,
  count: 5,
  step: 1,
) {
  ...
}
```

`i` is an immutable `number` binding that exists only in the body scope and is
referenced as `@i`. The range arguments are typed expressions; invalid ranges
are evaluation diagnostics. A loop does not create an implicit outer binding.

## Modules

### Definitions and instances

A module definition and a module instance use different keywords:

```text
module Foo(
  base: point,
  seam: number,
) {
  ...
}

instance foo = Foo(
  base: @A,
  seam: @seam,
)
```

Module definitions are non-hoisted. A definition must appear before the
instance that uses it. Recursive and mutually recursive module definitions are
forbidden.

Module arguments are named-only. A parameter may be `point`, `line`, `path`,
`number`, `string`, `boolean`, or `choice(...)` as appropriate. Geometry
parameters are resolved external targets exposed inside the module as
read-only aliases. A geometry parameter cannot be a mutation target.

Only scalar parameters may have defaults. A scalar default may reference only
parameters declared earlier in the same module signature. Geometry parameter
defaults are forbidden.

The existing Module v1 evaluation-limit atomicity is retained: an instance is
evaluated as an atomic module operation within its evaluation limit, and a
failed instance does not leak partially valid materialization as normal output.

### Instance activity

An instance may carry its own activity option:

```text
instance foo(state: hidden) = Foo(
  base: @A,
  seam: @seam,
)
```

`state` is an option on the instance, not a callee parameter. Its value is one
of the activity choices `visible`, `hidden`, or `disabled`.

### Visibility and exports

Module members are private by default. `export` is a visibility modifier on the
member declaration itself and is valid for both geometry and scalars:

```text
export point 頂点 = tangentOffset(
  ...
)

export const 実高さ: number = @サイド.length
```

An exported member is referenced from outside through the instance/container:

```text
@foo::頂点
@foo::実高さ
```

An explicit reference to a private member is a dedicated visibility diagnostic.
`export` is not a statement that aliases an existing member under another name.

### Geometry aliases

The initial nui4 language does not introduce a geometry alias declaration such
as:

```text
export point P = @Q
```

`export` belongs on the declaration that creates the member. A general geometry
expression or alias system is outside this specification. This keeps module
origin mapping, materialization, and read-only geometry parameters aligned with
the existing Module v1 architecture.

## Mutations

The existing mutation concepts remain available: `edge`, `extend`, `move`,
`mirrorMove`, and `reverse`, among others already supported by the construction
model. Every target and source operand is a nui4 reference using `@`:

```text
extend(
  end: @AB.start,
  to: @A,
)

move(
  targets: [@AB],
  from: @A,
  to: @B,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
)

reverse(
  target: @AB,
)
```

A mutation cannot target an element that appears later in document order. A
module geometry parameter alias cannot be a mutation target. After an instance
has completed, its exported, module-owned geometry may be a mutation target;
private members and read-only external aliases remain protected by visibility
and mutability diagnostics.

## Text interpolation

Text interpolation uses `${...}` with a nui4 reference or typed expression:

```text
text note = label(
  text: "縫い代 ${@seam} mm",
  anchor: @A,
  size: 3,
)
```

The old `{@name}` interpolation is removed. Ordinary `{` and `}` in text are
literal characters; nui4 does not require a special escape merely to write
literal braces.

## Stop

The document terminator is the bare keyword:

```text
stop
```

`@stop` is not a reference and is not part of nui4. This reserves `@` for
references only.

## Print layout source model

Print layout declarations are ordinary top-level, non-hoisted source
declarations. `layout` owns only direct `place` children; `print` and `svg`
are output declarations without bodies. Their references use the same `@` / `::`
lexical resolver as geometry and scalar declarations.

```text
layout 型紙(
  scale: 1,
) {
  place @前身頃(
    origin: @前身頃::基準点,
    at: (0, 0),
    scale: 1,
    angle: 0,
    mirror: false,
  )
}

print 家庭用A4(
  layout: @型紙,
  profile: @印刷用,
  paper: a4,
  orientation: portrait,
  overlap: 10,
)

svg 型紙SVG(
  layout: @型紙,
  profile: @SVG用,
  margin: 0,
)
```

Defaults are `layout.scale = 1`, target-group local origin, inherited place
scale, `place.angle = 0`, `place.mirror = false`, portrait orientation, and
0 mm SVG margin. `print.overlap` is required and must be finite and
non-negative. It is the physical overlap between adjacent sheets and the
outer inset on an edge without a neighboring sheet. Let `O = overlap`, and let
`Bw` and `Bh` be the stroke-inclusive rendered bounds width and height:

```text
firstUsableWidth  = W - 2O
firstUsableHeight = H - 2O

nx = 1 if Bw <= firstUsableWidth
else 1 + ceil((Bw - firstUsableWidth) / (W - O))

ny = 1 if Bh <= firstUsableHeight
else 1 + ceil((Bh - firstUsableHeight) / (H - O))
```

Both first usable dimensions must be positive. Page 1 starts at
`x = bounds.minX - O`, `y = bounds.minY - O`; later page origins advance by
`W - O` and `H - O`. Each page has physical overlap strips
`left = [0, O]`, `right = [W-O, W]`, `bottom = [0, O]`, and
`top = [H-O, H]`. Joining guides are at `left x = O`, `right x = W-O`,
`bottom y = O`, and `top y = H-O`. Guides and labels exist only on shared
edges; outer edges have none. `O = 0` produces no guides or labels. Print
declarations do not accept `margin`; `margin` remains an SVG-only attribute.
Literal scales must be finite and positive. Literal angles are normalized to
`[0, 360)`.

## Choice literals and arrays

Bare identifiers such as `left`, `right`, `visible`, `hidden`, and `disabled`
are choice literals when the surrounding typed position expects the
corresponding `choice(...)` type. They are not references. A reference to a
named value always includes `@`.

Array literals are part of the typed-expression model:

```text
sources: [
  @肩線,
  @脇線,
  @裾線,
]
```

All members must satisfy the expected element type. nui4 v1 does not introduce
a general-purpose collection API or collection language. The type model should
remain extensible to future `path[]` and `point[]` values without adding an
untyped escape hatch.

## Canonical formatting

Parser input tolerance and canonical formatting are separate concerns. The
parser may accept a single-line call, but the formatter has one stable output
shape. Canonical multi-line calls include a trailing comma on the final
argument:

```text
line AB = segment(
  start: @A,
  end: @B,
)
```

The Source Editor is the source of truth. Formatting must preserve statement
identity and must not silently reorder declarations, resolve a formerly broken
reference, or flatten module materialization into source statements.

## Explicitly out of scope for nui4 v1

The following are not part of the initial language:

- user-defined function declarations
- classes
- an object model
- inheritance
- an import/package system
- dependency auto-sorting
- forward references
- module closure or implicit outer capture
- implicit type conversion
- an arbitrary geometry expression system
- a general-purpose collection language

nui4 is a typed, deterministic construction language for sewing pattern drafting,
not a general-purpose programming language.

## Complete example

The following example uses the canonical nui4 spellings. Every value reference
is marked with `@`; the module uses the broad `path` interface type; boolean
logic uses `and`, `or`, and `not`; the module exports declarations directly;
text uses `${...}`; and termination uses `stop`.

```text
nui 4

const seam: number = 5
let angle: number = 90
set angle = 180
const mirror: boolean = false
const isDraft: boolean = true
const showDetail: boolean = @seam > 0 and (not @mirror or @isDraft)
const side: choice(left, right) = left

point A = coordinate(
  x: 0,
  y: 0,
)

point B = coordinate(
  x: 100,
  y: 0,
)

line AB = segment(
  start: @A,
  end: @B,
)

module Panel(
  base: point,
  seamLine: path,
  seam: number,
) {
  const halfSeam: number = @seam / 2

  export point top = coordinate(
    x: @base.x,
    y: @base.y + @seam,
  )

  export const actualHeight: number = @seam + @halfSeam

  export line outline = segment(
    start: @base,
    end: @top,
  )

  line detail = segment(
    start: @base,
    end: @seamLine.end,
  )

  if (@seam > 0 and not (@halfSeam < 0)) {
    text moduleNote = label(
      text: "module seam ${@seam} mm",
      anchor: @base,
      size: 3,
    )
  }

  for i in range(
    from: 0,
    count: 2,
    step: 1,
  ) {
    point notch = coordinate(
      x: @base.x + @i * 10,
      y: @base.y,
    )
  }

  reverse(
    target: @detail,
  )
}

instance front(state: hidden) = Panel(
  base: @A,
  seamLine: @AB,
  seam: @seam,
)

reverse(
  target: @front::outline,
)

group 前身頃 {
  line stitching = segment(
    start: @A,
    end: @B,
  )

  if (@showDetail) {
    text label = label(
      text: "${@side} 前身頃 ${@front::actualHeight} mm",
      anchor: @A,
      size: 3,
    )
  }

  for i in range(
    from: 0,
    count: 3,
    step: 1,
  ) {
    point notch = coordinate(
      x: @i * 10,
      y: 0,
    )
  }

  mirrorMove(
    targets: [@stitching],
    axis1: @A,
    axis2: @B,
  )
}

layout A4(scale: 1) {
  place @front::outline(at: (10, 10), angle: 0, mirror: false)
}

print 家庭用A4(layout: @A4, paper: a4, orientation: portrait, overlap: 10)
svg 型紙SVG(layout: @A4, margin: 0)

stop
```

The example also demonstrates that `front` is defined before it is referenced,
that the module's `seamLine` is a read-only external geometry alias, and that
the post-instance mutation targets exported, module-owned geometry.

## nui3 to nui4 mapping

| nui 3 | nui 4 |
| --- | --- |
| `var x = 5` | `const x: number = 5` |
| `from: A` | `from: @A` |
| `AB.start` | `@AB.start` |
| `module x = Foo(...)` | `instance x = Foo(...)` |
| broad module `line` parameter | `path` |
| `{@foo}` | `${@foo}` |
| `if Name (@cond)` | `if (@cond)` |
| `for Name (i, ...)` | `for i in range(...)` |
| `@stop` | `stop` |
| property binding opt-in | all typed arguments |
| `&&` / `\|\|` / `!` | `and` / `or` / `not` |

This table is a migration contract, not a request to retain a dual grammar.
