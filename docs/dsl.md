# nuinuiCAD DSL Reference

This is the stable, language-neutral landing page for the implemented `nui 1`
DSL. Read the [English DSL Reference](dsl/en/index.md) for the complete
user-facing reference, organized by language concept.

[`docs/nui1/spec.md`](nui1/spec.md) is the normative `nui 1` language contract.
The `.nui` source document is canonical. The English pages describe the
behavior implemented by nuinuiCAD. Repository implementation is authoritative
for actual implementation details.

Lengths and coordinates use millimetres with Y-up drafting coordinates.
Declarations are evaluated in document order, and unavailable or invalid
dependencies are reported rather than repaired. References use `@`, module
exports use `::`, and geometry properties use `.`.

Numeric geometry properties use canonical English source keys and are
target-aware. Points expose x/y; lines, paths, and polylines expose length,
endpoint directions (startAngleDeg and endAngleDeg), and endpoint coordinates;
arcs add radius, signed sweep, radial endpoint angles, and center coordinates;
Beziers add current endpoint handle angles/lengths and, for each statically
proven authored intermediate point in current traversal order, x/y plus
incoming/outgoing handle angles and lengths. Intermediate handle values come
from the current evaluated cubic controls; angles are Y-up degrees, lengths
are millimetres, and both angles are unavailable when both handles are zero.
Images expose their origin, dimensions, scale, angle, and pixel/DPI
metadata; text exposes its anchor and font size. Label/text size must be finite
and strictly greater than zero; zero or negative size produces an evaluation
error and no computed Text geometry. startAngleDeg/endAngleDeg
mean endpoint-to-path-interior directions, while startRadiusAngleDeg/
endRadiusAngleDeg mean center-to-endpoint directions. startTangentAngleDeg,
endTangentAngleDeg, params.*, and Japanese presentation labels are not authored
nui1 property aliases. See the canonical numeric geometry-property contract in
[nui1/spec.md](nui1/spec.md#canonical-numeric-geometry-properties) for fixed
construction and Module interface rules.

The reference covers the current implemented language:

- syntax and statement spellings
- scalar, geometry, array, and record types
- expressions, declarations, control flow, and modules
- geometry constructions, parameters, and drawing modifiers
- layouts, print/SVG output, and builtin functions

The English pages contain stable, language-neutral reference identities so
future localized reference trees can reuse the same entries.
