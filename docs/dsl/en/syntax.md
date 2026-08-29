# Syntax

The implemented language is a line-oriented document language with nested
blocks. Whitespace and line breaks may be used to format calls. Ordinary
comments begin with `//` and continue to the end of the line; block comments
use `/* ... */`. The `#` character does not start a comment.

The first meaningful statement must be `nui 4`. Names may use the DSL
identifier grammar, including non-ASCII names. A reference always has an `@`
sigil, for example `@Front`, `@Front::Hem`, or `@Line.length`.

## Statement spellings

The following table is generated from the parser-owned statement keyword table.
It is a vocabulary reference, not a second parser schema.

<!-- dsl-ref:generated:start statements -->
<!-- This region is generated from src/dsl/dslStatementKeywords.ts. -->
| Parser spelling | Reference identity |
| --- | --- |
<!-- dsl-ref:statement:stop -->
| `stop` | `dsl-ref:statement:stop` |
<!-- dsl-ref:statement:nui -->
| `nui` | `dsl-ref:statement:nui` |
<!-- dsl-ref:statement:for -->
| `for` | `dsl-ref:statement:for` |
<!-- dsl-ref:statement:place -->
| `place` | `dsl-ref:statement:place` |
<!-- dsl-ref:statement:role -->
| `role` | `dsl-ref:statement:role` |
<!-- dsl-ref:statement:profile -->
| `profile` | `dsl-ref:statement:profile` |
<!-- dsl-ref:statement:view -->
| `view` | `dsl-ref:statement:view` |
<!-- dsl-ref:statement:activeView -->
| `activeView` | `dsl-ref:statement:activeView` |
<!-- dsl-ref:statement:layout -->
| `layout` | `dsl-ref:statement:layout` |
<!-- dsl-ref:statement:print -->
| `print` | `dsl-ref:statement:print` |
<!-- dsl-ref:statement:svg -->
| `svg` | `dsl-ref:statement:svg` |
<!-- dsl-ref:statement:if -->
| `if` | `dsl-ref:statement:if` |
<!-- dsl-ref:statement:const -->
| `const` | `dsl-ref:statement:const` |
<!-- dsl-ref:statement:let -->
| `let` | `dsl-ref:statement:let` |
<!-- dsl-ref:statement:set -->
| `set` | `dsl-ref:statement:set` |
<!-- dsl-ref:statement:reverse -->
| `reverse` | `dsl-ref:statement:reverse` |
<!-- dsl-ref:statement:edge -->
| `edge` | `dsl-ref:statement:edge` |
<!-- dsl-ref:statement:extend -->
| `extend` | `dsl-ref:statement:extend` |
<!-- dsl-ref:statement:move -->
| `move` | `dsl-ref:statement:move` |
<!-- dsl-ref:statement:mirrorMove -->
| `mirrorMove` | `dsl-ref:statement:mirrorMove` |
<!-- dsl-ref:statement:point -->
| `point` | `dsl-ref:statement:point` |
<!-- dsl-ref:statement:line -->
| `line` | `dsl-ref:statement:line` |
<!-- dsl-ref:statement:curve -->
| `curve` | `dsl-ref:statement:curve` |
<!-- dsl-ref:statement:arc -->
| `arc` | `dsl-ref:statement:arc` |
<!-- dsl-ref:statement:text -->
| `text` | `dsl-ref:statement:text` |
<!-- dsl-ref:statement:image -->
| `image` | `dsl-ref:statement:image` |
<!-- dsl-ref:statement:group -->
| `group` | `dsl-ref:statement:group` |
<!-- dsl-ref:statement:module -->
| `module` | `dsl-ref:statement:module` |
<!-- dsl-ref:statement:record -->
| `record` | `dsl-ref:statement:record` |
<!-- dsl-ref:statement:modifier -->
| `modifier` | `dsl-ref:statement:modifier` |
<!-- dsl-ref:statement:instance -->
| `instance` | `dsl-ref:statement:instance` |
<!-- dsl-ref:statement:import -->
| `import` | `dsl-ref:statement:import` |
<!-- dsl-ref:statement:export -->
| `export` | `dsl-ref:statement:export` |
<!-- dsl-ref:generated:end statements -->

Named declarations use a category, a name, an equals sign, and a construction:

```text
point Name = coordinate(x: 0, y: 0)
```

Bare mutation statements such as `move(...)` have no declared name. Blocks use
braces and may contain declarations, nested blocks, and `set` statements where
the enclosing construct permits them. `stop` is a standalone terminator; later
statements are outside the evaluation limit.

<!-- dsl-example: compile-success -->
```nui
nui 4
// Comments preserve source layout and do not change evaluation.
point A = coordinate(
  x: 0,
  y: 0,
)
stop
```

The following is a syntax shape rather than an executable document.

<!-- dsl-example: syntax-fragment -->
```nui
category Name = construction(
  required: value,
  optional: value,
)
```

<!-- dsl-example: expected-diagnostic code=missing-declared-type -->
```nui
nui 4
const missing = 5
```
