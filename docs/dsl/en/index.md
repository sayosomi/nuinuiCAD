# nuinuiCAD DSL Reference

This is the user-facing reference for the implemented `nui 1` language used by
nuinuiCAD. It explains the source language, its deterministic evaluation model,
and the geometry and output declarations that are currently available. The
`.nui` source text is the canonical document representation.

## Language-wide rules

- Lengths and coordinates are expressed in millimetres. Drafting coordinates
  use Y-up: positive Y is upward.
- The first meaningful statement is `nui 1`. Other nui major versions are not
  part of the implemented language.
- Statements are evaluated in document order. A reference must point to an
  earlier, available declaration; the compiler reports dependency problems
  instead of reordering the document.
- Every element and container has `visible`, `hidden`, or `disabled` activity.
  Visible values evaluate and draw, hidden values evaluate and can be
  referenced but do not draw, and disabled values do not evaluate or become
  available to later references.
- References use `@`. Qualified module values use `::`, and geometry properties
  use `.`.
- Arguments are normally written as `name: value`, separated by commas. A
  trailing comma is accepted in multiline calls. The generated catalogs on
  the construction and builtin pages own exact signatures and parameter
  metadata; the prose around them explains behavior and restrictions.

## Reference map

- [Syntax](syntax.md) — document structure, comments, names, and source order.
- [Types](types.md) — scalar, geometry, array, and record types.
- [Expressions](expressions.md) — literals, operators, references, and
  interpolation.
- [Declarations](declarations.md) — `const`, `let`, and `set`.
- [Constructions](constructions.md) — geometry constructions, mutations, and
  their argument behavior.
- [Control flow](control-flow.md) — groups, conditions, and ranges.
- [Modules](modules.md) — module definitions, instances, parameters, and
  exports.
- [Records](records.md) — nominal source-only record values.
- [Modifiers](modifiers.md) — drawing modifiers and profiles.
- [Output](output.md) — layouts, print output, SVG output, and `stop`.
- [Builtins](builtins.md) — scalar and geometry measurement functions.

Reference identities in the linked pages are stable language-neutral metadata.
They are not derived from English headings and can be reused by another
localized reference tree. Generated tables remain machine-owned; edit the
surrounding explanations when the user-facing wording needs improvement.

<!-- dsl-example: compile-success -->
```nui
nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
line AB = segment(start: @A, end: @B)
```
