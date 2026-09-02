# Syntax

The implemented language is a line-oriented document language with nested
blocks. Whitespace and line breaks may format calls, so a long construction can
be written across several lines without changing its meaning. Ordinary
comments begin with `//` and continue to the end of the line; block comments
use `/* ... */`. The `#` character does not start a comment.

The first meaningful statement must be `nui 1`; comments and blank lines may
come before it. Names follow the DSL identifier grammar, including non-ASCII
names. A reference always has an `@` sigil: `@Front` names a declaration,
`@Front::Hem` selects a module export, and `@Line.length` reads an available
numeric property. See [Expressions](expressions.md) for the rules that make a
reference available.

## Statement spellings

The following table lists the statement words currently recognized by the
language. It is generated from the parser's vocabulary, so it is a spelling
reference rather than a second place to edit parser behavior.

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

## Document structure

Named geometry declarations use a category, a name, an equals sign, and a
construction. The category determines the value interface exposed to later
expressions; the construction determines how the value is computed:

```text
point Name = coordinate(x: 0, y: 0)
```

Bare mutation statements such as `move(...)` have no declared name. A `group`
has a name and contains declarations; `if`, `for`, `module`, and `layout`
introduce their own block rules. Blocks use braces and preserve source order.
Declarations are not hoisted: a later statement cannot be referenced from an
earlier one, even when both statements are in the same block.

`set` is allowed only where a mutable scalar binding is in scope. Geometry
construction calls and builtin calls use named arguments unless the generated
catalog or the relevant page says otherwise. Named arguments may be reordered;
duplicate, missing, or unknown names are errors.

`stop` is a standalone document terminator. The source after it remains text
in the file but is outside the evaluated document.

## File imports and cross-file names

Each `.nui` file is an independent `nui 1` document; imported files are not
concatenated. A top-level import requires an alias:

<!-- dsl-example: syntax-fragment -->
```nui
nui 1
import "./shared/measurements.nui" as measurements

const width: number = @measurements::width
export @measurements::Panel
```

Import paths are filesystem paths relative to the importing file. They must
start with `./` or `../` and end with `.nui`; package search, URLs, absolute
paths, and extension inference are not supported. Imports are source-ordered
and non-hoisted, so an alias cannot be referenced before its import. The alias
is an ordinary lexical name, and `@alias::Name` traverses an imported public
name.

Only explicitly exported declarations are public to importers. Nested imports
are supported, but their names are not transitively visible; import each
dependency directly when it is used. The generic re-export spelling is
`export @alias::Name`. It preserves the original declaration identity rather
than creating another declaration. Rename-style re-exports and export-all are
not supported. Declarations in different files retain document-qualified
identities even when their names are the same.

Imported semantics come from the dependency's saved disk contents. A dirty open
dependency buffer does not change an importer. Missing, unreadable, invalid,
stale, or cyclic dependencies fail closed, without using last-good imported
semantics.

## Source order and formatting

Blank lines and comments do not create statements. A comma separates call
arguments, and a trailing comma is accepted in a multiline call. Parentheses,
brackets, and braces must balance; strings and comments may contain punctuation
without changing that structure. A reference must resolve to an earlier value
that is available in the current lexical scope. A hidden value is available;
an invalid, disabled, or not-yet-evaluated value is not.

<!-- dsl-example: compile-success -->
```nui
nui 1
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
nui 1
const missing = 5
```
