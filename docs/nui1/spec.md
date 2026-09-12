# nui1 language specification

## Status and scope

`nui1` is the implemented and final language contract. The production parser,
compiler, source editor, and document format now accept `nui 1` only. This
document is the normative language contract and source of truth for the
completed nui1 migration.

The migration is a destructive replacement. nui1 does not accept ambiguous nui3
compatibility syntax, and the project has no nui3 compatibility parser,
converter, importer, or migration wizard. `docs/dsl.md` documents the
implemented nui1 language.

Each persisted document remains one `.nui` source-text file. Source text is the
durable source of truth, and source edits preserve statement-level identity and
user layout.

## Highest-level principles

The following principles are normative and apply to every nui1 feature:

1. A document is evaluated from top to bottom. Declarations are never hoisted.
2. `@` always means a reference.
3. Every value has a type.
4. `{}` creates a lexical scope.
5. `::` traverses a namespace or container.
6. nui1 does not perform implicit dependencies, implicit capture, or automatic
   reordering.

These rules are language semantics, not formatter preferences or implementation
options.

## Version

The language version is:

```text
nui 1
```

The parser and compiler must not design an ambiguous compatibility grammar that
accepts both nui3 and nui1 spellings. The final supported document format is
nui1, and it is the current production format.

## Multi-document imports

Each `.nui` source file is an independent ordinary `nui 1` document. Documents
are not concatenated. A file may import another `.nui` document with a
top-level import declaration:

```text
import "./path/file.nui" as alias
```

Imports require an alias, are processed in source order, and are not hoisted. An
import path is an importer-relative `./...` or `../...` filesystem path that
must end in `.nui`. nui1 does not provide package search, URL imports,
absolute-path imports, or extension inference.

An import alias participates in the ordinary lexical namespace of the importing
document. The alias is traversed with `::` and the `@` reference marker:

```text
@alias::Name
```

Only the imported document's explicit public API is available through its alias.
Nested imports are supported, but names from a nested dependency are not
transitively visible; each importing document must import a dependency it uses.
A generic file-level re-export uses:

```text
export @alias::Name
```

This re-exports the original declaration identity and does not create a second
declaration. nui1 has no rename-style re-export form and no export-all form.
Semantic and source identity across files is document-qualified, so declarations
with the same name in different documents remain distinct.

Imported dependency semantics use saved disk contents as their authority. A
dirty open dependency buffer does not change the importing document. Missing,
unreadable, invalid, stale, or cyclic dependencies fail closed; the importer
does not use last-good imported semantics.

The Rust evaluator does not parse, load, or resolve `.nui` imports. The
TypeScript source-semantic multi-document layer owns this import foundation and
supplies the resolved document-qualified semantics to its consumers.

## Module documentation comments

Module documentation is an optional source-semantic metadata layer for Module
definitions, Module parameters, and exported declarations in the same `.nui`
source file. It does not alter runtime geometry, evaluation, mutation, or
materialization semantics.

### Documentation comment marker

Only `///` has semantic documentation meaning. It is the documentation subset
of the existing `//` line-comment lexer path; no second comment lexer is
introduced.

- `// ...` remains an ordinary non-semantic line comment.
- `/* ... */` remains an ordinary non-semantic block comment.
- `/// ...` is a documentation comment payload line.
- `#` is ordinary source text, not a nui1 comment marker.
- A trailing same-line `///` does not attach backward to the preceding
declaration.

### Locale sections

A documentation block may contain explicit locale sections selected with
`/// @<locale>`:

```nui
/// @ja
/// ポケットを生成する。
///
/// **縫い代**は含まない。
/// @en
/// Creates a pocket.
///
/// Does not include **seam allowance**.
module Pocket(
  /// @ja
  /// ポケットの幅。
  /// @en
  /// Pocket **width**.
  width: number,
) {
  /// @ja
  /// 公開された基準点。
  /// @en
  /// Exported **reference point**.
  export point Public = coordinate(x: 0, y: 0)
}
```

Locale identifiers are not restricted to `ja` / `en`; VS Code-style values such
as `fr`, `de`, and `pt-br` are preserved as authored. Locale marker lines are
metadata and are not part of the Markdown payload.

For one target:

- repeated non-empty sections for the same locale concatenate in source order;
- empty locale sections are ignored;
- empty `///` payload lines inside a locale section preserve a Markdown blank
  line;
- payload before the first explicit locale marker has no implicit locale;
- malformed or locale-less documentation is treated as absent documentation and
  does not make an otherwise-valid nui1 document invalid.

### Attachment semantics

Documentation attaches forward to the next applicable declaration using the
existing physical source information and semantic identity owners.

- Documentation before a Module definition attaches to that Module definition.
- Documentation inside a Module parameter list attaches to the next parameter.
- Documentation inside a Module body attaches to the next exported declaration.
- Blank lines do not break attachment.
- Ordinary `//` / `/* ... */` comments do not break attachment.
- Multiple documentation groups before one target are combined in source order
  when no real DSL code/declaration intervenes.
- Intervening real DSL code/declaration consumes or breaks the pending
  association; documentation does not skip over real code to reach a later
  target.
- Trailing same-line documentation does not attach backward.

Documentation does not introduce textual `@param` / `@export` tags and does not
create a second Module name registry. Parameter identity remains the existing
semantic parameter slot identity, and export identity remains the existing
owner-definition / exported-statement semantic identity.

### Locale selection

Current VS Code consumers select one authored documentation variant in this
order:

1. exact current VS Code display locale;
2. `en`, if authored;
3. first authored non-empty locale in source order.

There is no base-language fallback. For example, `pt-br` does not implicitly
match `pt`.

This selection rule applies to user-authored documentation and is distinct from
nuinuiCAD-owned UI localization.

### Scope boundary

SAY-18 v1 covers same-file Module definition / parameter / export documentation
and the source-semantic metadata needed by local language-service consumers.
Cross-file/imported Module documentation transport is outside this contract;
the metadata may be transported later by the downstream multi-document
owner without changing the same-file authoring semantics above.

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
@qualifiedName[index]
@qualifiedName.property
@qualifiedName[index].property
```

`::` is namespace/container traversal. It moves from one resolved named
container to a named member, such as `@前身頃::肩線` or
`@foo::頂点`. `.` is property access after the name has been resolved, such as
`@AB.length` or `@写し::縫い線.end`. For a drawable declaration materialized
by a statement-for, `[index]` is an explicit zero-based occurrence selector
after the resolved qualified name; it is not a qualified-path segment. The
index is a typed numeric expression and must evaluate to a finite, integral,
non-negative, in-range occurrence that is available at the reference position.
The optional property is applied after the occurrence selector. Generated
runtime identifiers are not source references and must never be parsed to
recover an occurrence index.

Every value reference, including scalar references, geometry references, derived
points, endpoints, and property references, uses this same `@` form. There is
no geometry-only exception:

```text
line AB = segment(
  start: @A,
  end: @B,
)
```

`from: A` is not a reference in nui1. A bare identifier is a keyword, a choice
literal, the builtin numeric constant `pi`, or another grammar token with a
specifically defined role; it is never silently treated as a value reference.
A missing, disabled, invalid, private, or too-late reference is a diagnostic and
is not repaired by reordering the document.

### Scalar geometry-property reads

A resolved geometry property may be used as a scalar expression when its
property is either a known numeric computed property or a public `choice`
parameter in the target element's parameter schema. Choice reads use the exact
`choice(...)` type supplied by that schema, including option identity and order;
there is no choice subtyping or implicit conversion. String, boolean, and other
schema properties are not scalar geometry-property reads.

```text
arc A = arc(center: (0, 0), radius: 20, start: 0, end: 90, direction: clockwise)
const direction: choice(counterclockwise, clockwise) = @A.direction
const isClockwise: boolean = @A.direction == clockwise
arc B = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: @A.direction)
```

The target identity and property are resolved at the read's source position.
The target must be earlier in document order and available to evaluation there;
hidden elements remain readable, while disabled, invalid, failed, or not-yet-
evaluated elements are unavailable and produce the existing dependency
diagnostic. The read observes the target value materialized at that position;
later mutations do not retroactively change an earlier read.

### Canonical numeric geometry properties

Numeric geometry-property reads use the following public nui1 vocabulary.
Property keys are authored in English; presentation labels are not additional
source aliases. params.*, startTangentAngleDeg, and endTangentAngleDeg are not
public geometry-property paths.

| Static target | Properties |
| --- | --- |
| point | x, y |
| line/path | length, startAngleDeg, endAngleDeg, startPoint.x, startPoint.y, endPoint.x, endPoint.y |
| arc | line/path properties plus radius, sweepAngleDeg, startRadiusAngleDeg, endRadiusAngleDeg, centerPoint.x, centerPoint.y |
| Bezier | line/path properties plus startHandleAngleDeg, startHandleLength, endHandleAngleDeg, endHandleLength, and, for each statically proven authored intermediate point n, intermediatePoints[n].x, intermediatePoints[n].y, intermediatePoints[n].incomingHandleAngleDeg, intermediatePoints[n].incomingHandleLength, intermediatePoints[n].outgoingHandleAngleDeg, intermediatePoints[n].outgoingHandleLength |
| polyline | line/path properties |
| joined path | line/path properties |
| image | originPoint.x, originPoint.y, widthMm, heightMm, scale, angleDeg, naturalWidthPx, naturalHeightPx, sourceDpi, targetPixelsPerMm |
| text | anchorPoint.x, anchorPoint.y, fontSize |

segment, polar, and commonTangent produce the line surface. arc, through, and
corner produce the arc surface. bezier produces the Bezier surface; offset,
join, transformCopy, and mirrorCopy produce the generic path surface. polyline
produces the polyline surface, and join produces the joined path surface. A split preserves a concrete arc or Bezier
surface only when its source target is statically proven; otherwise it exposes
the common path surface. Module point parameters expose x/y, while Module line
and path parameters and exports expose only the common path surface.

startAngleDeg is the normalized direction from the start endpoint into the
path, and endAngleDeg is the normalized direction from the end endpoint into
the path. For an arc, startRadiusAngleDeg and endRadiusAngleDeg are the
normalized directions from the center to the corresponding endpoints;
sweepAngleDeg remains signed and preserves meaningful full turns such as 360
and -360. Bezier handle angles and lengths describe the resulting
endpoint-to-control geometry. Intermediate-point indexes are 1-based in the
current path traversal order, and the values are read from the current
evaluated cubic segments: the incoming handle uses the prior segment's
`control2` and the outgoing handle uses the next segment's `control1`, both
measured from the current join. Thus path reversal and other geometry-
preserving transformations expose current traversal geometry rather than
authored intermediate metadata. Handle angles are normalized Y-up directions
in degrees, and handle lengths are millimetres. At a zero-length intermediate
handle, its angle is derived as 180 degrees opposite the other handle's finite
direction. If both intermediate handles have zero length, both angle
properties are unavailable while both length properties remain 0. If a
direction cannot otherwise be determined, the property remains statically
valid but has no current numeric value.

Arc construction arguments retain their construction spelling, including
start: and end:; those arguments are distinct from the public computed
properties startAngleDeg and endAngleDeg.

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

Every expression has a static and runtime type. nui1 has these scalar types:

- `number`
- `string`
- `boolean`
- `choice(...)`

Every immutable value type `T` also has one canonical optional form, `T?`.
An optional value is either a value of `T` or the absence value `none`; the
optional wrapper is part of the value type and is not Module-specific metadata.
The underlying type is established by the expected type, so `none` is legal in
`const note: string? = none` but is an error in `const x: number = none`.
`none` is reserved and cannot be authored as a `choice(...)` option. Repeated
optional suffixes such as `T??` are invalid. A `T` is assignable to `T?`, but a
`T?` is never implicitly assignable to `T`.

Optionality composes with the existing one-dimensional collection form without
creating nested arrays: `T?[]` is a collection whose members are optional `T?`
values, while `T[]?` is one optional collection value. The same assignability
rule applies to scalar, geometry, nominal-record, and collection value types.

The initial geometry interface types are `point`, `line`, and `path` (see
[Geometry types](#geometry-types)). There is no implicit type conversion. A
number is not silently converted to a string or boolean, a choice is not silently
converted to a string, and a geometry value is not silently converted to a
different geometry type.

Scalar initializers, `set` right-hand sides, runtime-ready numeric construction
fields, module arguments, conditions, property values, array members, and
`layout`, `place`, `print`, and `svg` numeric fields all use one typed expression surface
model. nui1 does not expose separate historical
`NumericValue`, numeric-expression, or property-binding opt-in language features.

The scalar builtin-constant registry defines one canonical numeric constant:
the exact lowercase spelling `pi`, with type `number` and binary64 value
`3.141592653589793`. The scanner lowers bare `pi` to the ordinary
`numberLiteral` representation, so it uses the existing parser, typechecker,
compiler, and evaluator paths. It is not a lexical binding, resolver entry, or
runtime node. `PI` is not an alias and `pi()` is not a builtin function form.
The spelling `@pi` remains an ordinary user-visible binding reference; a
declaration named `pi` therefore remains referencable as `@pi` while bare `pi`
retains the builtin meaning. Because `choice(...)` classifies options through
the shared scalar literal scanner, `pi` is not a valid choice option.

The formal operator set is:

```text
+  -  *  /  %  ^
<  <=  >  >=  ==  !=
??
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
- `lhs ?? rhs` requires `lhs` to have type `T?`, evaluates `rhs` only when
  `lhs` is `none`, and produces the non-optional type `T`. The right side must
  be assignable to `T`; a present left value is returned without evaluating the
  right side.
- Division by zero and other invalid runtime operations are explicit evaluation
  diagnostics. `5 % 0` produces `evaluation-remainder-by-zero`. A non-finite
  power result such as `(-1) ^ 0.5`, `0 ^ -1`, or `10 ^ 10000` produces
  `evaluation-non-finite-result`.

### Scalar, geometry, and nominal-record value control flow

Scalar, geometry, nominal-record, and collection value expressions may use a
conditional. An `else` branch may be omitted only when the expected result type
is optional; the omitted branch is the ordinary `none` value of that type:

```nui
if (@enabled) { @leftPoint } else { coordinate(x: 0, y: 0) }
```

The condition is a typed boolean expression. A geometry-valued conditional must
have the declared geometry interface type in each present branch. Each branch may be
an existing legal `@` geometry reference or one of the implemented pure
geometry value constructions. A nominal-record conditional must have the exact
declared record-definition identity in both branches; its leaves may be a
constructor, whole-record reference, or supported statically indexed member of
a record collection. A collection-valued conditional must have the same
  declared one-dimensional collection type in each present branch; each branch is
recursively resolved as a collection expression. Both branches are resolved
and checked at compile time, but runtime evaluates the condition before
evaluating only the selected branch. A non-optional value-producing conditional
still requires an explicit `else`.

A scalar, geometry, or nominal-record value expression may use the following exhaustive
choice-match form:

```nui
match @size { small => 5 large => 10 }
```

The scrutinee is evaluated as an ordinary typed scalar expression and must
have a concrete `choice(...)` type. The arm list consists of bare choice option
labels followed by `=>` and one scalar or geometry value expression. Every
option declared by the scrutinee must occur exactly once, in any authored order.
A label that is not an option, a duplicate label, or a missing option is an
error. Wildcard and default arms are not part of nui1.

All arm result expressions are parsed and typechecked. Scalar results are one
of `number`, `string`, `boolean`, or an exact `choice(...)` type shared by every
arm; a bare choice literal is resolved against the expected result type.
Geometry results must share the declared `point`, `line`, or `path` interface.
Nominal-record results must share the declared record-definition identity, and
each arm may be a constructor, whole-record reference, or supported statically
indexed member of a record collection. Collection results must share the
declared one-dimensional collection type, and each arm is recursively resolved
as a collection expression. At runtime the scrutinee is evaluated first and
only the arm whose label equals the selected choice value is evaluated.
An optional scrutinee uses the corresponding `none`/`some` form:

```nui
match @piece.note {
  none => "no note"
  some note => @note
}
```

The scrutinee must have type `T?`, and exactly one `none` arm and one
`some <binder>` arm are required. The binder spelling is authored, is visible
only in its own arm, and has the non-optional type `T`. Optional match uses the
same scalar, geometry, nominal-record, and one-dimensional collection result
families as choice match. Only the selected arm is evaluated at runtime; a
present value is bound without introducing a second absence representation.
The standalone `none` literal is available only in an expected optional value
type.

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
style, and mixed positional/named calls are invalid in nui1 v1. Unknown,
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
| `string` | `string(choice(...)) -> string` |
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

`string(choice(...))` is the explicit choice-to-string conversion. Its
parameter is a builtin-only constraint meaning any already-concrete
`choice(...)` type; it is not a new scalar type and does not weaken choice type
identity. The result is the selected choice's canonical option token exactly as
stored in the document/runtime, independent of display labels or locale. The
initial overload accepts choice values only: number, boolean, and string inputs
are type errors. `string(right)` is also invalid because a context-free bare
choice literal has no concrete option set for the builtin to infer. No implicit
choice-to-string conversion is introduced.

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

## Records

Records are immutable, source-only nominal value types for grouping supported
immutable values. A record definition is top-level and uses a named field list:

```nui
record Pair(
  x: number,
  label: string,
)
```

Record fields are named. Each non-optional field is required; an optional field
of type `T?` may be omitted and omission materializes the ordinary `none` value
of that type. Each field uses the shared immutable value
type vocabulary: scalar types (`number`, `string`, `boolean`, and
`choice(...)`), `point`, `line`, `path`, a supported one-dimensional `T[]`
collection whose element type is not an array, one optional wrapper around any
of those, or another named record type.
Record type identity is the identity of the record definition statement; two
definitions with the same field names and types are still different types.
Definitions and values obey the normal non-hoisted source order. Nested arrays
and field defaults are not part of nui1 v1. Optional field omission does not
create field-specific presence state or defaults; it uses the generic `T?` value
type and `none` rules above.

A record value is declared with `const` and either a named-field constructor or
a whole-record reference:

```nui
const first: Pair = Pair(x: 10, label: "first")
const second: Pair = @first
```

Record values may also be produced by the scalar `if` and exhaustive `match`
forms. Conditions and scrutinees use the existing scalar expression owner, and
all branches or arms are statically checked against the declared record's exact
nominal identity:

```nui
const selected: Pair = if (@enabled) {
  Pair(x: 10, label: "left")
} else {
  @first
}
const matched: Pair = match @side {
  left => Pair(x: 11, label: "left")
  right => @first
}
```

Runtime evaluates the condition or scrutinee before evaluating only the
selected record leaf. A record leaf may be a constructor, a whole-record
reference, or a supported statically indexed member of a record collection.
Record values also support the collection value-producing `for` form described
below when the source and result element types are exact nominal record
identities. Optional record fields and optional result values use the same
immutable value model described above.

Constructors are named-only and must provide every non-optional field exactly
once; optional fields may be supplied at most once or omitted. The
constructor name and the declared type must identify the same record definition;
record values cannot be declared with `let`. A record value can be referenced
as a whole with `@name` or read through a scalar field such as `@first.x`.
Record values do not become scalar runtime values and are not a replacement for
geometry elements.

Module parameters may use a record type, and Module locals and exports may use
record values. Module record parameters and record values are read-only. A
record value passed to another Module must have the exact nominal type expected
by that parameter. Optional record parameters use the existing `hasValue`
presence proof before they are read; omitted optional records remain absent.
Exported record values can be read from an instance with a qualified reference,
for example `@front::output.x`.

### Scalar declarations and mutation

The scalar declaration forms are:

```text
const seam: number = 5
let angle: number = 90
set angle = 180
```

`const` is immutable after initialization. `let` may be updated by `set` in its
scope, subject to normal type checking and source-order rules. `var` does not
exist in nui1.

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

### Directed concrete arcs

The concrete `arc(...)` construction accepts the optional named argument
`direction: counterclockwise | clockwise`. Omitting `direction` is semantically
identical to `counterclockwise`; canonical serialization always writes the
argument explicitly. Direction is represented at runtime only by the sign of
`ComputedArcLine.sweepAngleDeg`: counterclockwise uses
`+positiveSweep(start, end)`, while clockwise uses
`-positiveSweep(end, start)`. Equal start and end angles produce zero sweep;
an explicitly authored full turn such as `0 -> 360` produces `+360` or `-360`
according to `direction`.

The direct `arc(...)` radius must resolve to a value greater than zero. A zero
or negative radius produces a deterministic geometry evaluation error and does
not materialize computed geometry, so runtime geometry-property reads for that
arc are unavailable.

`through(...)` and `corner(...)` do not gain a `direction` argument. Bake may
materialize a non-zero evaluated arc exactly when the directed sweep recomputed
from its start angle, end angle, and sign equals the evaluated signed sweep; a
positive sweep serializes as `counterclockwise` and a negative sweep as
`clockwise`.

The public `direction` property of a concrete arc has the choice type
`choice(counterclockwise, clockwise)`. Its effective value follows the sign of
the evaluated sweep: positive is `counterclockwise`, negative is `clockwise`.
For a zero sweep, the effective value falls back to the authored/materialized
direction rather than being inferred from a zero sign.

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

The same `tangentOffset` construction is an implemented identity-free
`point` initializer for `const` geometry values. Its `line` input accepts the
shared line-like `line`/`path` target boundary, its `base` input accepts a
point value or point reference, and omitted `angle`/`curveSide` uses angle `0`.
Curve-side mode accepts computed cubic Bezier geometry, including pure Bezier
path values and Module local/export/imported occurrences. Pure failures are
reported against the value occurrence and do not create a drawable element or
synthetic `ElementId`; the geometry algorithm and validation semantics remain
aligned with the drawable construction.

### Bezier direction extreme points

`bezierExtremePoint` creates a point at the maximum projection of one cubic
Bezier segment in a requested direction:

```nui
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
direction. The result maximizes `dot(B(t), V)` over `0 <= t <= 1`. Candidates
are both endpoints and every interior stationary point satisfying
`dot(B'(t), V) = 0`. If candidate scores are equal, the candidate closest to
`t = 0.5` wins; if that distance is also equal, the smaller `t` wins. A flat
projection returns `t = 0.5`. Canonical serialization always writes the
defaulted `segmentIndex`, including when it was omitted from the input.

### Bezier bulge points

`bezierBulgePoint` creates a point at the maximum unsigned bulge of one cubic
Bezier segment relative to the chord through that segment's endpoints:

```nui
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

`bezierExtremePoint(...)` and `bezierBulgePoint(...)` are also supported as
identity-free pure `point` initializers. Their `source` is a resolved geometry
value target and may be either a drawable Bezier curve or a pure `bezier(...)`
path value, including supported Module local, export, and cross-document value
flows. They use the same segment validation, direction normalization, candidate
selection, and degenerate-chord rules described above; pure failures are stored
on the value occurrence and do not allocate a drawable identity.

## Groups and computation/presentation gates

`group` combines four roles:

- UI hierarchy
- lexical scope
- namespace/container
- computation and presentation container

Nested groups may contain members with names that exist in an outer group. The
same source-order, non-hoisted resolution rules apply in every group.

Every geometry declaration and container may have independent direct gates:

- `enabled: boolean` is the computation gate. `false` is evaluated before the
  declaration's remaining evaluation-driving inputs; the declaration is not
  materialized and later references see the existing unavailable-dependency
  class.
- `visible: boolean` is the presentation gate. `false` still evaluates and may
  be referenced, but is not drawn.

An ancestor's `enabled: false` disables its descendants and an ancestor's
`visible: false` hides its descendants. A child cannot override either direct
ancestor gate. The same rules apply to groups, `if`, `for`, text, image, and
Module instances. Transformation-clause `enabled` remains a stage-local
computation gate.

An invalid dependency is not drawn as normal valid geometry. The application
reports the dependency error and either omits the geometry or displays a clear
warning marker.

## Style declarations, profiles, and presentation properties

Drawing Profiles are top-level, source-ordered declarations in the ordinary
lexical namespace. A profile is referenced with `@name`; references are not
hoisted, so a declaration must appear before its use.

```text
profile 印刷用
profile SVG用

style 型紙線 {
  visible: true,
  width: 1px,
  lineType: solid,
  color: foreground,

  for @印刷用 {
    width: 0.5px,
  }
}
```

The supported Style properties are independent: `visible` is a boolean;
`width` is a positive finite decimal pixel literal; `lineType` is `solid`,
`dashed`, or `dotted`; and `color` is a theme role
(`foreground`, `muted`, `accent`, `info`, `warning`, or `error`) or `#RRGGBB`.
The former compound `stroke:` property is invalid. A Style may contain only
these properties and `for @profile { ... }` blocks; profile blocks may contain
only the same four properties. A Style may be profile-only. Duplicate
properties and duplicate overrides for the same resolved profile are errors.

Effective properties cascade from outer group to inner group to element. Within
each owner, assigned Styles are applied left to right. The cascade merges each
property independently and starts from `1px solid foreground`. A selected
Drawing Profile overlays the common properties with its matching delta.

Style `visible` is presentation-only. It cannot override a direct or ancestor
`visible: false` gate, and profile selection never changes computation or
materialization. Canvas evaluation omits a selected Drawing Profile unless a
host explicitly supplies one.

## Conditional and iteration control

The formal nui1 conditional form is:

```text
if (@condition) {
  ...
}
```

The condition must be a `boolean` typed expression. An `if` body creates a
lexical scope. The nui3 container-name form is not retained; `if (...) as name`
is not part of nui1 v1. Stable identity is tracked by source statement identity,
so an `if` does not require a user-provided name.

The formal iteration form is:

```text
for i in range(min: 0, max: 4, step: 1) {
  ...
}
```

`i` is an immutable `number` binding that exists only in the body scope and is
referenced as `@i`. `min`, `max`, and `step` are required numeric expressions.
Statement-for ranges are ascending only: `min <= max` and `step > 0` are
required. The generated values are exactly `min + n * step`, beginning at
`min`, and only values `<= max` are included. The final value is never clamped;
`max` is included only when the sequence reaches it exactly. Thus `min == max`
produces one iteration, and a step larger than `max - min` still produces one
iteration at `min`. The canonical source spelling uses the exact spacing
`range(min: ..., max: ..., step: ...)`; `showGenerated` may remain in the
statement-for header as a control option and does not change range values.
Non-finite operands, descending bounds, non-positive steps, and ranges that
would generate more than 1000 values are evaluation diagnostics. A loop does
not create an implicit outer binding. Each drawable declaration in a
statement-for has one deterministic, ordered zero-based occurrence collection
across its materialized instances; nested loops retain each occurrence path.
`@Name[index]` addresses one occurrence, while bare `@Name` is valid only when
exactly one occurrence is available and otherwise reports the existing
collection-index-unavailable diagnostic rather than selecting zero.

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

Module arguments are named-only. In a Module call only, an unlabeled simple
caller-side value reference `@name` is shorthand for the same-name named
argument `name: @name`. This is named-argument shorthand, not positional
argument syntax. For example:

```text
instance foo = Foo(
  @base,
  seam: @seam,
)
```

is semantically equivalent to:

```text
instance foo = Foo(
  base: @base,
  seam: @seam,
)
```

The shorthand is valid only for a bare relative one-segment value reference
exactly of the form `@name`. Literals, compound expressions, property access,
qualified/module references, and other unlabeled values are not shorthand.
Shorthand and explicit named arguments may be mixed. Duplicate and unknown
shorthand-derived names use the same semantic validation and diagnostics as
explicit named arguments. Defaults, optionality, lexical binding, and type
checking are unchanged. After validation the shorthand is lowered through the
ordinary named Module parameter binding path; no positional or shorthand kind
exists in the runtime payload.

A parameter may be `point`, `line`, `path`, `number`, `string`, `boolean`,
`choice(...)`, a nominal record type, or a one-dimensional `T[]` whose element
type is one of those non-array value types. Singular geometry
parameters are resolved external targets exposed inside the module as read-only
aliases. A singular geometry parameter cannot be a transformation target. Geometry-array
parameters are immutable ordered values; they may be passed as inline literals or
named array references and do not have defaults.

Any scalar, geometry, record, or collection parameter may be optional by writing
`name?: type`. Optional parameters cannot also have a default. Omission is an
intentional absent value: it is not `none`, `null`, or a runtime value, and an
omitted scalar has no eager initializer or binding. Required, defaulted, and
optional parameters retain their source-order slots; named instance arguments
may be written in any order.

The existing Module `name?: type` and `hasValue(...)` model remains a separate
intermediate feature in this slice. This slice does not migrate Module
parameters to the generic `name: type?` spelling or change their omission
semantics.

Only non-optional scalar parameters may have defaults. A scalar default may
reference only earlier parameters in the same signature, and an optional
parameter cannot be read directly from a default. `hasValue(@parameter)` is
valid in a boolean default and is the only presence test for an optional
parameter.

Inside a module body, `hasValue(@parameter)` accepts exactly one optional scalar,
geometry, record, or collection parameter and returns `boolean`. Its result may
narrow presence in the same lexical descendant: a true `if` branch, the
right-hand side of `and`, and the false branch of `or` prove presence. `not`
reverses the fact. Facts do not escape the branch, do not flow through boolean
aliases, and do not prove presence in the other branch. Scalar reads, geometry
reads and properties, geometry-array reads, builtin operands, construction
values, templates, and passing an optional value to another module require such
proof. Supplying an optional argument materializes the ordinary value with its
declared type; omitting it remains absent.

The existing Module v1 evaluation-limit atomicity is retained: an instance is
evaluated as an atomic module operation within its evaluation limit, and a
failed instance does not leak partially valid materialization as normal output.

### Instance computation and presentation gates

An instance may carry its own direct gates:

```text
instance foo(enabled: true, visible: false) = Foo(
  base: @A,
  seam: @seam,
)
```

`enabled` and `visible` are options on the instance, not callee parameters.
They accept boolean literals or shared boolean references.

### Visibility and exports

Module members are private by default. `export` is a visibility modifier on the
member declaration itself and is valid for geometry, scalars, records, and
immutable collections:

```text
export point 頂点 = tangentOffset(
  ...
)

export const 実高さ: number = @サイド.length
export const 輪郭: path[] = [@サイド, @裾]
```

An exported member is referenced from outside through the instance/container:

```text
@foo::頂点
@foo::実高さ
@foo::輪郭
```

An explicit reference to a private member is a dedicated visibility diagnostic.
`export` is not a statement that aliases an existing member under another name.

### Immutable single-geometry reference values

Typed declarations may create one immutable geometry reference value with
`const` and a reference-form initializer:

```text
const origin: point = @A
const edge: line = @AB
const outline: path = @edge
const sameOrigin: point = @origin
```

The declared type is retained at every alias boundary. Assignability is
directional: `point` accepts only `point`, `line` accepts only `line`, and
`path` accepts `line` or `path`. A `path` value cannot be assigned to `line`,
and a geometry value cannot be assigned to a scalar or record type. Aliases
follow the ordinary lexical namespace, source-order, dependency, module
parameter, and export rules; alias chains are allowed when each step is
assignable.

The initializer may be an existing `@` geometry reference accepted by the
existing geometry resolver, or one of the currently implemented pure
construction forms:

```text
const originPoint: point = coordinate(x: 10, y: 20)
const polarPoint: point = polar(from: @originPoint, angle: 90, distance: 20)
const middlePoint: point = between(start: @originPoint, end: (30, 20), ratio: 0.5)
const edge: line = segment(start: @originPoint, end: (30, 20))
const fromEnd: point = onLine(from: @edge.end, distance: 5)
const polarEdge: line = polar(start: @polarPoint, angle: 30, length: 100)
const polarPath: path = @polarEdge
const outline: path = segment(start: @originPoint, end: (30, 20))
const roundedOutline: path = arc(center: @originPoint, radius: 10, start: 0, end: 90)
const curvedOutline: path = bezier(
  start: @originPoint, end: (30, 20),
  startAngle: 0, startLength: 10, endAngle: 180, endLength: 10
)
const polygon: path = polyline(
  points: [@originPoint, (30, 20), (10, 40)], closed: true
)
```

`coordinate` and point `polar` produce `point`; `segment` and line `polar`
produce strict `line`; and direct
`arc` produces broad `path`. The directional `line -> path` interface rule
also permits the `segment` path form. Direct `arc` accepts the same
`center`, `radius`, `start`, `end`, and optional `direction` values as its
drawable construction; `direction` defaults to `counterclockwise`. A
single-geometry value is `const`-only; `let` receives a focused diagnostic.
These values are source-level immutable values, not drawable elements and not
scalar runtime values. They do not create a new element, computed drawable
geometry entry, or synthetic `ElementId`; direct arc and pure through values
are stored in the immutable geometry-value store with identity-free center,
endpoint, radius, angle, sweep, tangent, and length fields. Pure `through(...)`
is a `path` construction with `point1`, `point2`, and `point3`, plus optional
`start` and `end` angles defaulting to 0 and 90 degrees; it is counterclockwise.
Duplicate or collinear points fail at runtime through the occurrence-owned
geometry-value diagnostic channel. Geometry consumers resolve these values
through the shared runtime target boundary. Pure `bezier(...)` is also a
`path` construction and accepts the drawable Bezier arguments `start`, `end`,
`startAngle`, `startLength`, `endAngle`, `endLength`, and optional
`intermediates`. It stores identity-free cubic segment geometry and its
computed length, supports multiple intermediate segments, and is consumable by
the existing path-compatible readers. Unavailable or non-finite Bezier inputs
fail through the occurrence-owned geometry-value diagnostic channel; they do
not create a drawable identity. Pure `polyline(...)` is also a `path`
construction and accepts the drawable `points` and `closed` arguments. It
stores ordered identity-free line segments, preserves duplicate points, adds a
closing segment only when needed, and requires at least two open points or
three closed points. Unavailable points and invalid cardinality fail through
the occurrence-owned geometry-value diagnostic channel. `join(paths: ..., closed: ...)`
is an implemented path construction for both drawable `line` declarations and
immutable `path` values. Its required `paths` argument has type `path[]`; the
existing directional covariance also accepts `line[]`. The list is evaluated
in authored order and preserves duplicates. A later path is accepted when its
authored start meets the current chain end, or its computed view is reversed
when its authored end meets the chain end. No route search, reordering,
snapping, connector, trimming, simplification, or deduplication occurs. Open
joins validate adjacent connections; `closed: true` additionally validates
the last-to-first connection and never synthesizes a closing segment. Empty
lists, discontinuities, unavailable dependencies, and invalid sources fail
with an actionable evaluation error. The result retains each source's exact
primitive order and geometry, including nested joined paths and degenerate
primitives, and exposes the common path length, endpoints, and first/last
usable tangents. For a drawable declaration the persisted element type is
`joinedPath` with `pathIds` and `closed`; for an immutable value the result has
no drawable identity and runtime failures belong to its value occurrence. Point
`between(start: ..., end: ..., distance: ...)` and
`between(start: ..., end: ..., ratio: ...)` are implemented pure `point`
initializers. Exactly one of `distance` and `ratio` is required: distance is
measured from `start` toward `end`, while ratio `0` is `start` and ratio `1` is
`end`, including directed extrapolation outside that interval. A distance
placement cannot evaluate coincident endpoints, while a ratio placement keeps
the drawable coincident-point behavior. `onLine(from: ..., distance: ...)`
and `onLine(from: ..., ratio: ...)` are likewise pure `point` initializers;
they retain the full line/path value and endpoint direction for path-distance
traversal. Exactly one placement mode is required, and unusable or degenerate
line-like geometry fails through the occurrence-owned geometry-value
diagnostic channel. These pure division forms do not allocate a drawable
identity. Point
`intersection(line1: ..., line2: ..., index: ..., extensions: ...)` is also an
implemented pure `point` initializer. Both inputs resolve through the shared
line-like geometry target boundary and may be drawable or immutable `line`/
`path` values, including Module local, export, and cross-document flows. The
`index` defaults to `0` and `extensions` defaults to `false`; the construction
uses the existing deterministic line-intersection ordering and finite-versus-
extended geometry rules. Same-source inputs, parallel or unavailable inputs,
non-intersections, invalid indexes, and out-of-range indexes fail through the
occurrence-owned geometry-value diagnostic channel. Pure intersection values do
not allocate a drawable identity. Point
`offset(from: ..., dx: ..., dy: ...)` is an implemented pure `point`
initializer using the drawable point-offset semantics and defaults. Point
`polar(from: ..., angle: ..., distance: ...)` is an implemented identity-free
pure `point` initializer using the drawable point-polar geometry and defaults
of `angle: 0` and `distance: 0`. Line
`polar(start: ..., angle: ..., length: ...)` is an implemented identity-free
pure strict-line initializer using the drawable line-polar geometry and
defaults of `angle: 0` and `length: 100`; its strict `line` result participates
in the existing `line -> path` assignability rule. Neither pure polar form
allocates a drawable identity. Line
`commonTangent(first: ..., second: ..., kind: ..., side: ...)` is an implemented
identity-free pure strict `line` initializer and is also assignable to `path`.
The static input boundary accepts `line` or `path` references, but runtime
evaluation requires both inputs to be computed `arcLine` geometry; this includes
drawable arcs and pure `arc(...)` or `through(...)` values. `kind` is required
and accepts `external` or `internal`; `side` is required and accepts `left` or
`right`. The four choices are evaluated from resolved typed expressions, so the
construction introduces no source-name lookup. Missing, disabled, invalid,
non-arc, coincident, concentric, or otherwise impossible inputs fail through
the occurrence-owned geometry-value diagnostic channel. The same target boundary
preserves Module locals, exports, instances, and cross-document flows. Pure
common-tangent values do not allocate a drawable identity. Path
`offset(sources: ..., distance: ..., side: ..., closed: ..., suppressTrimWarnings: ...)`
is an implemented pure `path` initializer using the drawable line-offset
geometry, ordering, defaults, validation, and trimming behavior. Both pure
forms are identity-free and remain consumable by the existing compatible
geometry readers; runtime failures use the occurrence-owned geometry-value
diagnostic channel. `transformCopy(startPoint: ..., endPoint: ..., scale: ...,
angleDeg: ..., mirrorX: ..., baseLines: ...)` and
`mirrorCopy(axis1: ..., axis2: ..., baseLines: ...)` are implemented pure
`path` initializers. Their source list is an ordered, non-empty list of
line-like geometry and is not rewritten or auto-reversed. transformCopy
translates the source start point to `endPoint`, optionally mirrors about the
vertical through `endPoint`, scales about `endPoint`, then rotates by
`angleDeg`; `scale` defaults to 1, `angleDeg` to 0, and `mirrorX` to false.
mirrorCopy reflects across the directed two-point axis and reverses arc sweep.
Both forms transform line endpoints, Bezier controls, and arc radius/sweep,
drop degenerate transformed line/Bezier segments, retain ordered segments and
endpoint tangents, and produce no drawable element identity. Missing,
disabled, invalid, non-line-like, empty, discontinuous, or too-late sources,
non-positive scales, coincident axes, and no-segment results fail through the
occurrence-owned geometry-value diagnostic channel. `corner` and other
deferred constructions remain unsupported.

The same form is available for root declarations, module locals, and exported
members. Module parameters are declared in the Module signature rather than
with this local `const` alias syntax; a parameter whose interface is `point`,
`line`, or `path` can still be used as a geometry reference on the right-hand
side. An exported alias is referenced through its instance with the ordinary
qualified form, for example `@front::outline`.

## Declarative transformation recipes

Transformations are immutable declarative recipes. Their canonical form is an
operation followed by a bare target, an optional named checkpoint, and the
operation arguments:

```text
extend AB.end as extended(
  to: @A,
)

move [AB, C] as moved(
  from: @A,
  to: @B,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
)

reverse AB as reversed()
```

The target slot is not a nui1 value/reference slot. A target is written bare,
for example `A`, `[A, B]`, `A.end`, or `A.moved.end`; it is never written with
`@`. The `@` sigil remains the value/reference syntax, including operation
arguments such as `from: @A` and stage references such as `from:
@A.moved.start`. Endpoint targets use `.start` or `.end`. Module-qualified
targets use their qualified bare path, for example `front::outline`.

At the root, `base` denotes the owner's original geometry and `final` denotes
the owner's resulting geometry. An optional `as name` clause creates an
immutable named checkpoint. A checkpoint is a semantic geometry snapshot, not
an independent drawable Canvas element. `base` is a valid branch target;
`final` is reference-only and is invalid as a transformation target. A stage
name may not be `base` or `final`, and a stage name may not collide with a
geometry property name of its owner.

Recipes are evaluated in root source order. A named stage owns a recursive
branch: a later recipe targeting `A.stage` reads and extends that branch. When
the target is already a stage, the resulting checkpoint remains in that branch;
an empty branch has the implicit `.final` result. The first recipe in a branch
reads the branch's `base` snapshot. Transformation targets must refer to
available geometry in the settled source order; SAY-291's general
forward-reference/global scheduling semantics are not part of this contract.

An operation may target one owner or several coupled owners. Coupled operations
produce independent resulting checkpoints for each owner. Generated geometry
supports both bulk and indexed occurrence targets. An occurrence-first stage
spelling such as `@Mark[2].shifted` is a value/reference to the named stage of
that occurrence. Bulk and indexed matching clauses merge in source order for
each occurrence. A bulk target with zero occurrences is a no-op; an explicit
occurrence that is unavailable is an error.

Each owner and branch may have at most one sibling stage with a given name.
`enabled: false` bypasses only that transformation. The target geometry remains
available, and when the clause declares `as stage`, that stage still exists and
contains the unchanged input geometry. Later transformations continue normally.
The transformation target ownership, module qualification, and visibility
rules remain those of the existing declaration and instance model; module
geometry parameters are not made mutable transformation owners.

The old call-shaped mutation syntax is not accepted and has no compatibility
layer. Forms such as `move(targets: [@AB], ...)`, `extend(end: ..., to: ...)`,
and `reverse(target: @AB)` are invalid nui1. SAY-294's drawable materialization
from stage values is not part of this contract.

## Text interpolation

Text interpolation uses `${...}` with a nui1 reference or typed expression:

```text
text note = label(
  text: "縫い代 ${@seam} mm",
  anchor: @A,
  size: 3,
)
```

The root type of a typed interpolation hole must be `string`, `number`, or
`boolean`. A boolean hole is rendered as the lowercase text `true` or `false`.
This is text-template-local presentation behavior, not a general implicit
boolean-to-string conversion in nui1. Direct `choice(...)` interpolation
remains unsupported. A choice can be interpolated only after explicit
conversion, for example `${string(@side)}`, whose root result type is `string`.

The old `{@name}` interpolation is removed. Ordinary `{` and `}` in text are
literal characters; nui1 does not require a special escape merely to write
literal braces.

## Stop

The document terminator is the bare keyword:

```text
stop
```

`@stop` is not a reference and is not part of nui1. This reserves `@` for
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
non-negative. It is the safe-edge inset / retained glue-tab width for print
assembly. Let `Bw` and `Bh` be the stroke-inclusive rendered bounds width and
height:

```text
usableWidth  = W - 2 * overlap
usableHeight = H - 2 * overlap

columns = max(1, ceil(Bw / usableWidth))
rows    = max(1, ceil(Bh / usableHeight))

strideX = usableWidth
strideY = usableHeight
```

Both usable dimensions must be positive. Page 1 starts at
`x = bounds.minX - overlap`, `y = bounds.minY - overlap`; later page origins
advance by `strideX` and `strideY`. Adjacent physical sheet rectangles therefore
overlap by `2 * overlap` mm; after one side is trimmed, the retained glue
allowance is `overlap` mm.

When `overlap > 0`, every physical page has four inset guide lines:
`left x = overlap`, `right x = W - overlap`, `bottom y = overlap`, and
`top y = H - overlap`. These guides are advisory printer-safety guides only:
geometry may cross them, and they do not clip output or forbid placement. The
corresponding guide lines on adjacent pages coincide in global coordinates.
Joining text labels are present only on page edges with a neighboring page;
outer-edge guides remain unlabeled. When `overlap == 0`, stride is the full
paper width and height and there are no guides or labels. Print declarations do
not accept `margin`; `margin` remains an SVG-only attribute.
Literal scales must be finite and positive. Literal angles are normalized to
`[0, 360)`.

## Choice literals and arrays

`none` is the one reserved absence literal. It is type-directed and is accepted
only where an expected optional type establishes its underlying value type; it
does not have an unrelated scalar or choice type. Consequently, `none` cannot
be a `choice(...)` option.

Bare identifiers such as `left`, `right`, `visible`, `hidden`, and `disabled`
are choice literals when the surrounding typed position expects the
corresponding `choice(...)` type. They are not references. The builtin numeric
constant `pi` is the explicit scanner-level exception and is not a choice
literal. A reference to a named value always includes `@`.

nui1 implements three first-class immutable single-geometry types (`point`,
`line`, and `path`) and one-dimensional immutable collection types `T[]`.
The element type `T` may be any currently valid non-array value type:
`number`, `string`, `boolean`, `choice(...)`, `point`, `line`, `path`, or an
already-valid nominal record type. Named arrays are `const` only, and the
declaration type annotation is mandatory. Nested arrays such as `T[][]` are
rejected; the type model is intentionally one-dimensional.

Optional suffixes compose with collections by precedence: `T?[]` means each
member has optional type `T?`, whereas `T[]?` means the whole `T[]` value is
optional. `T??` is rejected. These forms use the same canonical assignability
rule as their scalar, geometry, and nominal-record counterparts.

```text
const points: point[] = [@A, @B]
const strictLines: line[] = [@AB]
const paths: path[] = [@AB, @curve]
const emptyPaths: path[] = []
const copiedPaths: path[] = @paths
const numbers: number[] = [1, 2, 3]
const labels: string[] = ["front", "back"]
const sides: choice(left, right)[] = [left, right]
const copiedNumbers: number[] = @numbers
```

Array literals preserve source order and duplicates exactly. `[]` is valid when
the expected collection type is known. Every member is validated against the
declared element type using the existing scalar, choice, geometry, and nominal
record assignability rules. Geometry arrays accept the normal
qualified/derived/coordinate point forms; `line[]` remains assignable to
`path[]`. Whole-value array references retain their source identity and use the
ordinary lexical/source-order/private and export rules; references always retain
their `@` marker.

Geometry-array assignability is intentionally narrow: `point[] -> point[]`,
`line[] -> line[]`, `path[] -> path[]`, and `line[] -> path[]` are valid. The
reverse `path[] -> line[]`, point/non-point conversions, and implicit untyped
conversion are invalid.

Module signatures may declare required or optional collection parameters.
They have no defaults. Optional arrays use the same `hasValue(@parameter)`
presence narrowing as other optional Module parameters. Module bodies may
create local immutable arrays and may export them with `export const`; private,
source-order, and instance-member visibility rules are unchanged. Collection
members remain values: pure geometry members are not converted into drawable
identities.

A typed collection declaration may use a value-producing `for` to map an
existing whole-value collection:

```text
const doubled: number[] =
  for x in @numbers {
    @x * 2
  }
```

This is a mapping form only: it produces exactly one result member for each
source member, in the source collection's authored order, preserving
duplicates. An empty source produces an empty result, and a member body is
evaluated only when that result member is requested. The binder is an
immutable lexical value with the exact source element type, visible only in
the body; it is not a statement-for mutation binding and never leaks into the
surrounding scope. The source is a whole-value collection reference resolved
by the ordinary lexical, source-order, alias, Module, privacy, and export
rules. The result remains an immutable one-dimensional `T[]` with its
declared element type, and the body is checked by the existing scalar
expression rules against that result element type. Bare choice literals use
the declared result choice identity and order.

Value-producing collection `for` does not filter, fold, scan, carry, mutate,
or accumulate state. Nested arrays are not introduced. Collection-valued `if` and exhaustive choice `match` select exactly one branch or arm lazily before `.length` or indexing delegates to the existing collection runtime; branches may have different cardinalities and unselected dependencies are not evaluated. The value model uses
this same pure, lazy, one-result-per-input collection shape for geometry
collections as well. Geometry source/result bodies support `point[]`, `line[]`,
and `path[]`, subject to the existing directional assignability rules
(`line[]` may be used where `path[]` is expected, but `path[]` may not be used
where `line[]` is expected). Geometry map members keep occurrence identity
separate from drawable ElementIds, and a selected member is materialized only
at the consuming geometry operation. Nominal-record value-producing collection
`for` uses the same pure, lazy, one-result-per-input shape. Its source and
result element types must be exact nominal record identities; the body is a
record value expression checked against the result identity, and a requested
record member evaluates only the corresponding scalar field body. Optional
match arms and omitted optional-result `else` branches use the same lazy
immutable collection model.

For example:

```text
record Pair(
  x: number,
  label: string,
)
const pairs: Pair[] = [
  Pair(x: 1, label: "one"),
  Pair(x: 2, label: "two"),
]
const shifted: Pair[] = for item in @pairs {
  Pair(x: @item.x + 10, label: @item.label)
}
const selected: Pair = @shifted[1]
const selectedX: number = @selected.x
```

Existing broad line-list consumers treat their list value as `path[]`. This
includes `offset.sources`, `transformCopy.baseLines`, and `mirrorCopy.baseLines`.
These are value/reference list slots, so an inline literal and a named `path[]`
value are semantically equivalent at these sites:

```text
const sources: path[] = [@肩線, @脇線]
```

A named array reference remains a named reference in source; canonical
formatting does not flatten it into an inline literal. Transformation target
lists are separate bare selectors, as specified above, and do not accept a
named `path[]` value. Runtime lowering feeds
the resolved ordered geometry members into the existing geometry-list paths;
scalar and nominal-record collections remain source-semantic values until a
later collection-consumer slice.

Every one-dimensional collection supports the read-only scalar property
`@collection.length` with type `number`. Its value is the resolved collection
cardinality: an empty literal is `0`, a literal counts every authored member
including duplicates, and whole-value aliases preserve the target cardinality.
The property is available for root declarations, Module parameters, locals,
and exports wherever the underlying collection reference is valid. Optional
collection parameters require an established `hasValue(@parameter)` presence
proof before `.length` access. `.length` does not select or materialize a
collection member and does not create a declaration identity.

A declared collection value may also be indexed with a first-class, read-only
`@collection[index]` expression. Indexing is zero-based, and `index` is an
ordinary typed numeric expression, so expressions such as `@marks[0]` and
`@marks[@index + 1]` are valid. The result has exactly the declared element
type, including the nominal identity of a record element. Collection order,
duplicates, aliases, and pure geometry value identity are preserved; indexing
does not create a drawable `ElementId`, and nested arrays are not supported.
The form is available for root collections and through the same lexical,
Module-parameter, local, export, qualified, and cross-document paths as a
whole collection reference. An optional Module collection parameter must first
be proven present with `hasValue(@parameter)`.

The index must evaluate to a finite integer in the inclusive lower bound `0`
and exclusive upper bound `@collection.length`. Negative, fractional,
non-finite, and out-of-range indexes are evaluation errors; the runtime never
clamps, wraps, coerces, or fabricates a member. Statically known invalid
indexes may be reported during semantic checking, but runtime validation
remains authoritative for dynamic expressions.

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

## Explicitly out of scope for nui1 v1

The following are not part of the initial language:

- user-defined function declarations
- classes
- an object model
- inheritance
- package search, URL imports, absolute-path imports, and extension inference
- dependency auto-sorting
- forward references
- module closure or implicit outer capture
- implicit type conversion
- an arbitrary geometry expression system
- a general-purpose collection language

nui1 is a typed, deterministic construction language for sewing pattern drafting,
not a general-purpose programming language.

## Complete example

The following example uses the canonical nui1 spellings. Every value reference
is marked with `@`; the module uses the broad `path` interface type; boolean
logic uses `and`, `or`, and `not`; the module exports declarations directly;
text uses `${...}`; and termination uses `stop`.

```text
nui 1

const seam: number = 5
let angle: number = 90
set angle = 180
const mirror: boolean = false
const isDraft: boolean = true
const showDetail: boolean = @seam > 0 and (not @mirror or @isDraft)
const side: choice(left, right) = left
const sideText: string = string(@side)

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

  for i in range(min: 0, max: 1, step: 1) {
    point notch = coordinate(
      x: @base.x + @i * 10,
      y: @base.y,
    )
  }

  reverse detail ()
}

instance front(visible: false) = Panel(
  base: @A,
  seamLine: @AB,
  seam: @seam,
)

reverse front::outline ()

group 前身頃 {
  line stitching = segment(
    start: @A,
    end: @B,
  )

  if (@showDetail) {
    text label = label(
      text: "${string(@side)} 前身頃 ${@front::actualHeight} mm",
      anchor: @A,
      size: 3,
    )
  }

  for i in range(min: 0, max: 2, step: 1) {
    point notch = coordinate(
      x: @i * 10,
      y: 0,
    )
  }

  mirrorMove stitching(
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
the post-instance transformation targets exported, module-owned geometry.

## nui3 to nui1 mapping

| nui 3 | nui 1 |
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
