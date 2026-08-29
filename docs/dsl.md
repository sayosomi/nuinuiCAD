# nuinuiCAD DSL Reference

This page is the stable landing page for the implemented `nui 4` DSL. The
complete English reference is maintained in the structured
pages under [`docs/dsl/en/`](dsl/en/index.md).

[`docs/nui4/spec.md`](nui4/spec.md) is the normative `nui 4` language contract.
`docs/dsl.md` and [`docs/dsl/en/`](dsl/en/index.md) are the user-facing
reference for currently implemented DSL behavior. Repository implementation is
authoritative for actual implementation details.

The `.nui` source text is the canonical document representation. The language
uses millimetres and Y-up drafting coordinates, evaluates declarations in
document order, and reports invalid or unavailable dependencies instead of
silently repairing them. `visible`, `hidden`, and `disabled` activity states
control whether geometry is drawn and evaluated. References use `@`, module
exports use `::`, and geometry properties use `.`.

The reference covers the current implemented language only:

- syntax and statement spellings
- scalar, geometry, array, and record types
- expressions, declarations, control flow, and modules
- geometry constructions, parameters, and drawing modifiers
- layouts, print/SVG output, and builtin functions

Use the [English DSL Reference](dsl/en/index.md) for the current implemented
behavior. The English pages contain stable, language-neutral reference
identities so future localized reference trees can reuse the same entries.
