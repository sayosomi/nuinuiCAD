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
the referenced geometry publishes. Reads happen at the source position: a
later mutation does not change an earlier scalar read. Hidden geometry remains
readable; disabled, failed, or not-yet-evaluated geometry is unavailable.

## Geometry properties

Only numeric computed properties and schema-declared choice properties are
available as scalar reads. A line can expose measurements such as `.length`,
while an arc's `.direction` is a choice whose exact type is documented by the
construction. String and boolean element properties are not general scalar
geometry-property reads. A property must also be valid for the value's
interface and available at the read position.

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
nui 4
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
line AB = segment(start: @A, end: @B)
const length: number = @AB.length
const twice: number = @length * 2
text note = label(text: "length=${@length}", anchor: @A, size: 3)
```
