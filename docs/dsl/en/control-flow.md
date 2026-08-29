# Control flow

Control-flow blocks are unnamed. A group creates a named container; `if` and
`for` create unnamed containers whose children remain in source order.

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

The `if` condition is boolean after typed checking. A `for` iteration variable
is a body-only numeric binding and is referenced as `@i` in typed expressions.
`from`, `count`, and `step` are numeric; `step` defaults to `1` and
`showGenerated` controls whether generated rows are shown. Containers inherit
activity and drawing modifiers, while their dependency and evaluation rules
remain deterministic.

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
