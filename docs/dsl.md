# nuinuiCAD DSL Reference

This is the stable, language-neutral landing page for the implemented `nui 4`
DSL. Read the [English DSL Reference](dsl/en/index.md) for the complete
user-facing reference, organized by language concept.

[`docs/nui4/spec.md`](nui4/spec.md) is the normative `nui 4` language contract.
The `.nui` source document is canonical. The English pages describe the
behavior implemented by nuinuiCAD. Repository implementation is authoritative
for actual implementation details.

Lengths and coordinates use millimetres with Y-up drafting coordinates.
Declarations are evaluated in document order, and unavailable or invalid
dependencies are reported rather than repaired. References use `@`, module
exports use `::`, and geometry properties use `.`.

The reference covers the current implemented language:

- syntax and statement spellings
- scalar, geometry, array, and record types
- expressions, declarations, control flow, and modules
- geometry constructions, parameters, and drawing modifiers
- layouts, print/SVG output, and builtin functions

The English pages contain stable, language-neutral reference identities so
future localized reference trees can reuse the same entries.
