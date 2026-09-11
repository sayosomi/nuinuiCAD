# Expressions

Expressions are typed and checked at the place where they are used. There is
no implicit conversion between numbers, strings, booleans, choices, or
geometry. References resolve in the lexical namespace at their source
position; a forward reference, a reference outside the scope, or a reference
to a disabled or invalid value is a diagnostic.

## Operators

Numeric expressions support `+`, `-`, `*`, `/`, `%`, and `^`. Comparisons are
`<`, `<=`, `>`, and `>=`; equality uses `==` and `!=`. Logical expressions use
`and`, `or`, and `not`. Comparisons and equality require compatible operand
types and return `boolean`; equality does not coerce its operands.

Remainder `%` shares multiplicative precedence with `*` and `/`, is
left-associative, and is a remainder rather than a percentage. Exponentiation
`^` is right-associative and binds more tightly than unary signs. Thus
`2 ^ 3 ^ 2` is `512`, `-2 ^ 2` is `-4`, and `-5 % 3` is `-2`.

The canonical lowercase numeric constant `pi` is available wherever a number
operand is valid. It follows the ordinary number-literal path; `PI` is not an
alias, `pi()` is not a function call, and `@pi` refers only to a user binding.

Division or remainder by zero, invalid numeric operations, and non-finite
numeric results are evaluation errors. Examples include `0 ^ -1`, a negative
input to `sqrt`, and a non-integral real result such as `(-1) ^ 0.5`.

## References and properties

A bare `@name` reads a declaration in the current scope. `@instance::name`
reads an exported module value, and `@value.property` reads a property that
the referenced value publishes. Collection values expose the read-only numeric
property `length`; it counts authored members, including duplicates, after
whole-value aliases are resolved. Reads happen at the source position: a
later mutation does not change an earlier scalar read. Hidden geometry remains
readable; disabled, failed, or not-yet-evaluated geometry is unavailable.

Generated drawable occurrences from a `for` statement use an explicit
zero-based occurrence suffix after the resolved source reference:
`@Mark[0]` or `@Mark[@i]`. The bracket expression is a typed numeric scalar;
it must be finite, integral, non-negative, in range, and available at the
reference position. A property follows the occurrence suffix, for example
`@Mark[1].length`. The brackets are not part of a qualified `::` path and are
never recovered from a generated runtime id. A source/template drawable has
one ordered occurrence collection across its materialized loop instances;
nested loops retain their occurrence paths. Bare `@Mark` is valid only when
exactly one occurrence is available, so it cannot silently select occurrence
zero when several exist. The same authored occurrence spelling is used for
geometry targets, scalar geometry-property reads, and generated-candidate
insertion.

## Geometry and collection properties

Only numeric computed properties and schema-declared choice properties are
available as scalar reads. A line can expose measurements such as `.length`,
while an arc's `.direction` is a choice whose exact type is documented by the
construction. Bezier intermediate points use 1-based current traversal
indexes: each proven index exposes `.x`, `.y`, `.incomingHandleAngleDeg`,
`.incomingHandleLength`, `.outgoingHandleAngleDeg`, and
`.outgoingHandleLength`. These handle values come from the current evaluated
cubic controls at the join, in Y-up degrees and millimetres; a zero-length
handle uses the opposite finite direction when available, and both angles are
unavailable when both handles are zero. String and boolean element properties
are not general scalar geometry-property reads. A property must also be valid
for the value's interface and available at the read position.

For every implemented one-dimensional collection type (`number[]`, `string[]`,
`boolean[]`, `choice(...)[]`, `point[]`, `line[]`, `path[]`, and nominal-record
arrays), `.length` is a read-only `number`. Empty literals have length `0`; a
non-empty literal counts every authored member in order, including duplicates.
Whole-value aliases and Module collection parameters/exports preserve the same
cardinality. Optional Module parameters require the established
`hasValue(@parameter)` presence proof before `.length` is read.

Declared collections also support first-class zero-based indexing:
`@collection[index]`. The index is a normal typed numeric expression, so both
`@marks[0]` and `@marks[@index + 1]` are valid. The result has exactly the
collection element type, including nominal record identity. Order, duplicates,
aliases, and pure geometry value identity are preserved; indexing does not
create a drawable element identity, and nested arrays remain unsupported.
Root values, aliases, Module parameters, locals, exports, qualified exports,
and cross-document exports use the same lexical and source-order rules as
whole collection references. An optional collection parameter needs a proven
`hasValue(@parameter)` guard before indexing.

The index must evaluate to a finite integer from `0` through one less than the
collection length. Negative, fractional, non-finite, or out-of-range indexes
are evaluation errors. Runtime validation is authoritative for dynamic
indexes, and never clamps, wraps, coerces, or fabricates a value.

An `if` or exhaustive choice `match` can produce a collection value when all
branches or arms have the same declared one-dimensional collection type. The
selected branch determines `.length` and indexed values; different branches
may have different cardinalities. The condition or scrutinee is evaluated
first, and the unselected branch or arm remains lazy. Collection values keep
their element identity, including geometry assignability and nominal-record
identity.

<!-- dsl-example: compile-success -->
```nui
nui 1
const marks: number[] = [10, 20, 30]
const index: number = 1
const selected: number = @marks[@index + 1]
```

## Function calls and interpolation

Builtin calls use a bare function name followed by typed expressions in
parentheses. Calls may be nested. Existing builtins are positional except for
the named-only `spreadAngle`; see [Builtins](builtins.md) for signatures and
semantics. Named-only calls may reorder their named arguments, but positional
and named arguments cannot be mixed.

Text templates use `${...}`. A hole may evaluate to a string, number, or
boolean. Booleans render as lowercase `true` or `false` inside a template;
that rendering rule is local to templates and is not a general implicit
conversion. A choice must first be converted with `string(...)`.

<!-- dsl-example: compile-success -->
```nui
nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
line AB = segment(start: @A, end: @B)
const length: number = @AB.length
const twice: number = @length * 2
text note = label(text: "length=${@length}", anchor: @A, size: 3)
```
