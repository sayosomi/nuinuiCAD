# Modules

## Definition and instance

`module` defines a reusable, closed lexical body. `instance` creates a module
occurrence from that definition. A module never implicitly captures an outer
scalar, geometry value, group member, or loop binding; anything it needs must
be declared as a parameter. Definitions and instances are non-hoisted and are
resolved in document order.

Module parameters may use scalar types, `point`, `line`, `path`, record types,
or the geometry arrays `point[]`, `line[]`, and `path[]`. The singular geometry
interfaces are read-only inside a module. Geometry arrays are immutable and
can be forwarded to the existing list-taking constructions; see
[Types](types.md).

Append `?` to make a parameter optional. An optional parameter has no value
until supplied and cannot also have a default. Only non-optional scalar
parameters (`number`, `boolean`, `string`, or `choice(...)`) may declare a
default with `=`. Geometry parameters, geometry-array parameters, and record
parameters do not gain default-value support. Scalar defaults are evaluated in
source order in the module's parameter context and do not capture values from
the module's caller.

## Arguments and exports

Module arguments are named and may be supplied in any order. A simple relative
reference such as `@width` is shorthand for `width: @width`; it is still a
named argument. Use explicit `name: value` form for qualified references,
properties, literals, and compound expressions. Positional arguments are not
supported. Unknown, duplicate, missing, or mixed-style arguments are errors.

Module bodies can export geometry, geometry arrays, scalar values, and records.
Exports are private to the instance until explicitly declared with `export`.
An external reference uses `@instance::export`; an exported record field can
then be read with `.`, for example `@front::measure.height`. A module instance
has its own `state` option: visible content evaluates and draws, hidden content
evaluates without drawing, and disabled content does not evaluate or provide
exports to later references.

## Library modules

Use `export module` at the document top level to publish a Module from a `.nui`
library file:

<!-- dsl-example: compile-success -->
```nui
nui 4
export module Panel(width: number = 40) {
}
module Helper() {
}
```

An ordinary top-level `module` is private to its defining document. Nested
Module definitions are never file declarations, and `export module` inside a
Module body is rejected. Import a library with an alias and call a public
Module by its qualified name:

<!-- dsl-example: syntax-fragment -->
```nui
nui 4
import "./library.nui" as lib
instance front = lib::Panel(width: 60)
```

Imports and Module definitions are resolved in source order. Private, missing,
wrong-family, invalid, stale, or cyclic dependency targets fail closed. A
file-level `export @lib::Panel` re-exports the original public Module identity;
it does not create a second Module declaration. Imported Module arguments are
checked in the caller's lexical context, while defaults, body names, private
helpers, exports, and nested calls remain owned by the defining document.

For an optional parameter, `hasValue(@parameter)` returns whether the caller
supplied a value. The optional value itself may be read only in a branch whose
condition proves presence. The proof is available in the true branch of
`if (hasValue(...))`, in the right-hand side of `and`, and in the false branch
of `or`. `not` reverses the presence fact. Facts do not flow through an
arbitrary boolean alias or into the opposite branch.

## Documentation comments

A `///` documentation group can document the following module definition, the
following parameter inside a module parameter list, or the following export
declaration inside a module body. Association is forward. Blank lines and
ordinary `//` or `/* ... */` comments do not break it, but intervening DSL code
or a declaration consumes or terminates the pending association; documentation
never jumps over code. Multiple groups for one declaration are concatenated in
source order. A trailing `///` on a declaration does not attach backward.

`/// @<locale>` starts an explicit locale section. Locale identifiers are
arbitrary supported IDs, not a fixed `en`/`ja` list. Repeated non-empty sections
for the same locale are concatenated in source order; empty sections are
ignored. Payload before the first explicit locale marker does not receive an
inferred locale. Malformed or locale-less documentation metadata is ignored and
does not make an otherwise-valid document fail compilation or evaluation.

The payload is source-semantic Markdown metadata. It does not change runtime
geometry, module arguments, or evaluation behavior.

<!-- dsl-example: compile-success -->
```nui
nui 4
point A = coordinate(x: 0, y: 0)
/// @en
/// Creates a **marker** from an origin point.
/// @ja
/// 原点からマーカーを作ります。
module Marker(
  /// @en
  /// The marker origin.
  origin: point,
  /// @ja
  /// 表示用ラベル。
  label?: string
) {
  /// @en
  /// The exported **tip** point.
  export point Tip = offset(from: @origin, dx: 10, dy: 0)
}
instance Front = Marker(origin: @A)
```

<!-- dsl-example: compile-success -->
```nui
nui 4
point A = coordinate(x: 0, y: 0)
module Marker(origin: point, label?: string) {
  export point Tip = offset(from: @origin, dx: 10, dy: 0)
}
instance Front = Marker(origin: @A)
```

<!-- dsl-example: syntax-fragment -->
```nui
module Name(
  required: type,
  optional?: type,
  defaulted: type = value,
) {
  export declaration
}
```
