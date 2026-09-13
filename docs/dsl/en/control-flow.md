# Control flow

Control-flow blocks preserve source order and introduce lexical scopes. A
`group` creates a named container, and named group/container members can be
reached through a qualified namespace path such as `@Front::Hem`, subject to
the usual source-order and activity rules. `if` and `for` create unnamed
lexical scopes; their children have no user-visible `::` path and follow the
normal block-scope rules. Modules are closed scopes: callers can reach only
declarations marked `export`, through an instance path such as `@front::Hem`.

```text
group Front {
  ...
}

if (condition) {
  ...
} else {
  ...
}

for i in range(min: 0, max: 2, step: 1) {
  ...
}
```

The `if` condition is a boolean expression. Its true branch is evaluated when
the condition is true; an `else` branch, when present, is evaluated otherwise.
The branches are separate scopes, and a declaration in one branch is not
available in the other.

The `for` iteration variable is an immutable, body-only `number` binding and is
referenced as `@i` in typed expressions. `min`, `max`, and `step` are required
numeric expressions. The range is ascending only: `min` must be less than or
equal to `max`, and `step` must be greater than zero. Values are generated as
`min + n * step` while they are less than or equal to `max`; the final value is
never clamped to `max`, so `max` is included only when the sequence reaches it
exactly. Equal bounds produce one value, and a step larger than the interval
still produces `min` once. Invalid, non-finite, or over-limit ranges are
evaluation diagnostics. The canonical spacing is `range(min: ..., max: ...,
step: ...)`. The variable is not added to the surrounding scope.
`showGenerated` remains a for-control option; it controls whether generated
rows are shown and does not change the range values.

Drawable declarations inside a `for` create ordered runtime occurrences under
their source/template declaration. Use `@Name[index]` to address one
occurrence, where `index` is a finite, integral, non-negative numeric
expression; `@Name[index].property` reads a property from that occurrence.
Nested statement-for expansions preserve the complete occurrence path. A bare
`@Name` is accepted only when exactly one occurrence is available and otherwise
reports an unavailable/ambiguous occurrence rather than choosing zero.

Containers inherit their ancestors' `enabled`/`visible` gates and Styles. A
disabled container prevents child evaluation and later references; a hidden
container still evaluates children but does not draw them. See [Styles](modifiers.md).

<!-- dsl-example: compile-success -->
```nui
nui 1
const show: boolean = true
group Front {
  point A = coordinate(x: 0, y: 0)
}
if (@show) {
  point B = coordinate(x: 10, y: 0)
}
for i in range(min: 0, max: 1, step: 1) {
  point Notch = coordinate(x: @i * 10, y: 5)
}
```

The following is a non-executable shape for an optional branch.

<!-- dsl-example: syntax-fragment -->
```nui
if (condition) {
  declarations
} else {
  declarations
}
```
