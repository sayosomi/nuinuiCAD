# Modules

`module` defines a reusable lexical body. `instance` creates a module
occurrence. A module does not implicitly capture outer values; required values
must be parameters.

Module parameters may be scalar types, `point`, `line`, `path`, or the three
geometry array types. Scalar, geometry, and array parameters may be optional
with `?`. Optional parameters cannot also have defaults. Defaults are written
with `=` and are evaluated in the module's parameter context.

Arguments are named and may be supplied in any order. A simple relative
reference such as `@width` is shorthand for the named argument `width: @width`.
It is not a positional argument. Explicit named form is required for qualified
references, properties, literals, and expressions.

Module bodies may export geometry, arrays, scalar values, and records. An
export is referenced through an instance with `@instance::export`. Module
instances have their own activity option: `visible`, `hidden`, or `disabled`.

For an optional parameter, `hasValue(@parameter)` returns presence. The value
may be read only in a branch whose condition proves presence, including the
corresponding short-circuit branch of `and` or `or`.

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
