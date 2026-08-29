# nuinuiCAD DSL Reference

This is the reference for the implemented `nui 4` language used by nuinuiCAD.
It describes the source language, its deterministic document evaluation model,
and the current geometry and output declarations. The `.nui` source text is
the canonical document representation.

## Language-wide rules

- Lengths and coordinates are expressed in millimetres. Drafting coordinates
  use Y-up: positive Y is upward.
- The first meaningful statement is `nui 4`. Other nui major versions are not
  part of the implemented language.
- Statements are evaluated in document order. A reference must point to an
  earlier, available declaration; the compiler reports dependency problems
  instead of reordering the document.
- Every element and container has `visible`, `hidden`, or `disabled` activity.
  Hidden values still evaluate and can be referenced; disabled values do not
  evaluate and cannot be referenced.
- References use `@`. Qualified module values use `::`, and geometry properties
  use `.`.
- Arguments are normally written as `name: value`, separated by commas. A
  trailing comma is accepted in multiline calls.

## Reference map

- [Syntax](syntax.md) — comments, statement forms, names, and source order.
- [Types](types.md) — scalar, geometry, array, and record types.
- [Expressions](expressions.md) — literals, operators, references, and
  interpolation.
- [Declarations](declarations.md) — `const`, `let`, and `set`.
- [Constructions](constructions.md) — geometry constructions and their
  arguments.
- [Control flow](control-flow.md) — groups, conditions, and ranges.
- [Modules](modules.md) — module definitions, instances, parameters, and
  exports.
- [Records](records.md) — nominal source-only record values.
- [Modifiers](modifiers.md) — drawing modifiers and profiles.
- [Output](output.md) — layouts, print output, SVG output, and `stop`.
- [Builtins](builtins.md) — scalar and geometry measurement functions.

Reference identities in the linked pages are stable language-neutral metadata.
They are not derived from English headings and can be reused by another
localized reference tree.

<!-- dsl-example: compile-success -->
```nui
nui 4
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
line AB = segment(start: @A, end: @B)
```
