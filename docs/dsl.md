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
exports use `::`, ordinary geometry properties use `.`, optional member access
uses `?.`, and generated drawable
occurrences use an explicit zero-based suffix such as `@Mark[1]` or
`@Mark[@i]`. The suffix is an occurrence expression after the resolved source
reference, not part of a qualified path; bare `@Mark` is not allowed to
silently choose occurrence zero when multiple loop occurrences are available.

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

Immutable single-geometry values use `const name: point|line|path = ...`.
The initializer may be an existing geometry reference or an implemented pure
geometry construction: `coordinate(...)` produces a non-drawable `point`,
`segment(...)` produces a non-drawable `line` and may initialize `path` through
the existing directional `line -> path` assignability rule, and direct
`arc(...)` produces a non-drawable `path`, and `through(...)` produces an
identity-free `arcLine` path value from three point inputs. `through` defaults
`start` and `end` to 0 and 90 degrees and fails duplicate or collinear points
through the occurrence-owned geometry-value diagnostic channel. These remain
source-level immutable geometry values, not drawable elements. Pure `bezier(...)`
also produces an identity-free `bezierCurve` path value using the drawable
constructor's endpoint handles and optional intermediate records; its runtime
controls and length are available to existing path-compatible consumers. Pure
`bezierExtremePoint(source: ..., segmentIndex: ..., direction: ...)` and
`bezierBulgePoint(source: ..., segmentIndex: ...)` produce identity-free
`point` values. Their source must evaluate to Bezier geometry, including a pure
Bezier path value; the optional segment index defaults to `0`, extreme direction
uses the existing normalized degree semantics, and a bulge with coincident
segment endpoints fails through the occurrence-owned geometry-value channel.
Pure `intersection(line1: ..., line2: ..., index: ..., extensions: ...)` also
produces an identity-free `point` from line-like geometry. `index` defaults to
`0` and `extensions` to `false`; parallel, unavailable, same-source, and
out-of-range cases fail through the occurrence-owned geometry-value channel.
Pure `commonTangent(first: ..., second: ..., kind: ..., side: ...)` produces a
strict identity-free `line` (also assignable to `path`). Both inputs are
line/path-compatible at the language boundary but must evaluate to arc geometry;
`kind` is `external` or `internal` and `side` is `left` or `right`. The same
construction accepts drawable arcs and pure direct/through arc values, including
Module and instance flows. Invalid or unavailable tangent solutions fail through
the occurrence-owned geometry-value channel.
Pure `tangentOffset(line: ..., base: ..., angle: ..., curveSide: ..., distance: ...)`
also produces an identity-free `point`. Angle mode accepts line-like geometry
and defaults `angle` to `0` when both modes are omitted; `curveSide` accepts
`convex` or `concave` only for computed cubic Bezier geometry, including pure
Bezier values, and requires a nonnegative distance and an on-curve base point.
Failures are occurrence-owned and do not create a drawable identity.
`polyline(...)` also produces an identity-free `polyline` path value using the
drawable constructor's ordered `points` and optional `closed` arguments; open
values require at least two points and closed values at least three. Pure
`join(paths: ..., closed: ...)` produces an identity-free joined `path` value
or a drawable `joinedPath` line element. `paths` accepts a `path[]` value (and
the existing directional `line[]` to `path[]` covariance); authored order and
duplicates are preserved. Each later path must meet the current chain end at
either authored endpoint, reversing only the computed view when its authored
end matches. `closed: true` validates the final-to-first connection without
adding a closing segment. Discontinuities and empty path lists are errors.
The joined result preserves source primitives and exposes the common path
length, endpoint, and tangent measurements. Pure
`offset(from: ..., dx: ..., dy: ...)` produces an identity-free `point` using
the drawable point offset semantics, and
`offset(sources: ..., distance: ..., side: ..., closed: ..., suppressTrimWarnings: ...)`
produces an identity-free `path` using the drawable line offset geometry and
validation. Both forms remain consumable by existing geometry readers; runtime
failures are owned by the value occurrence and do not create a drawable
identity. `transformCopy(startPoint: ..., endPoint: ..., scale: ..., angleDeg: ..., mirrorX: ..., baseLines: ...[])`
and `mirrorCopy(axis1: ..., axis2: ..., baseLines: ...[])` are also immutable,
non-drawable pure `path` initializers. They reuse the ordered line-like source
boundary and copy geometry: transformCopy translates, mirrors about the
destination vertical, scales about the destination, then rotates; mirrorCopy
reflects across its two-point axis. Pure results retain structural line, arc,
and Bezier segments without drawable identity. `corner` and other deferred
constructors remain unsupported.

The reference covers the current implemented language:

- syntax and statement spellings
- scalar, geometry, array, and record types
- expressions, declarations, control flow, and modules
- geometry constructions, parameters, and drawing modifiers
- layouts, print/SVG output, and builtin functions

The English pages contain stable, language-neutral reference identities so
future localized reference trees can reuse the same entries.
