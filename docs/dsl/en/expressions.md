# Expressions

Expressions are typed and are checked where they are used. References resolve
against the lexical namespace at the source position; forward references and
references to disabled or invalid values are diagnostics.

## Operators

Numeric expressions support `+`, `-`, `*`, `/`, `%`, and `^`. Remainder `%`
shares precedence with multiplication and division. Exponentiation `^` is
right-associative and binds more tightly than unary signs. Logical expressions
use `and`, `or`, and `not`.

Division or remainder by zero, and non-finite numeric results, are evaluation
errors. Angles use degrees. The angle functions normalize results according to
their builtin contracts.

## Geometry properties

Only numeric computed properties and schema-declared choice properties are
available as scalar reads. For example, a line can expose numeric measurement
properties, while an arc's direction is a choice. String and boolean element
properties are not general scalar geometry-property reads.

## Text interpolation

Text templates use `${...}`. A hole may evaluate to a string, number, or
boolean. Booleans render as lowercase `true` or `false` inside a text template;
that rule is local to templates and is not a general implicit conversion.

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
