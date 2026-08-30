# Control flow

Control-flow blocks preserve source order and introduce lexical scopes. A
`group` creates a named container; `if` and `for` create unnamed containers
whose children are evaluated in place. A child cannot be referenced from
outside its block unless it is exposed through a supported module export.

```text
group Front {
  ...
}

if (condition) {
  ...
} else {
  ...
}

for i in range(from: 0, count: 3, step: 1) {
  ...
}
```

The `if` condition is a boolean expression. Its true branch is evaluated when
the condition is true; an `else` branch, when present, is evaluated otherwise.
The branches are separate scopes, and a declaration in one branch is not
available in the other.

The `for` iteration variable is an immutable, body-only `number` binding and is
referenced as `@i` in typed expressions. `from`, `count`, and `step` are
numeric expressions; `step` defaults to `1`. Invalid range values are
evaluation diagnostics. The variable is not added to the surrounding scope.
`showGenerated` controls whether generated rows are shown; it does not change
the values produced by the loop.

Containers inherit their ancestors' activity and drawing modifiers. A visible
container evaluates and draws eligible children, a hidden container evaluates
children without drawing them, and a disabled container prevents child
evaluation and later references. See [Modifiers](modifiers.md).

<!-- dsl-example: compile-success -->
```nui
nui 4
const show: boolean = true
group Front {
  point A = coordinate(x: 0, y: 0)
}
if (@show) {
  point B = coordinate(x: 10, y: 0)
}
for i in range(from: 0, count: 2, step: 1) {
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
