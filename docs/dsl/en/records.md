# Records

## Syntax

`record` defines a nominal, source-only value type. A record definition is
top-level and its fields are required scalar types:

```text
record Name(
  field: type,
)
```

## Parameters and fields

Record constructors are named-only. Every declared field must be supplied
exactly once, with the declared scalar type. Geometry, arrays, nested records,
optional fields, and field defaults are not part of the current record
language. A record definition's name is its type identity: two definitions with
the same fields are still different types, and definitions are not hoisted.

## Description and access

Record values are read-only `const` values. Declare one with the record name and
a named-field constructor, or copy an existing whole record with `@name`. Read
a scalar field with `.`, and export the record from a module when callers need
it. A module parameter or export must use the exact nominal record type; see
[Modules](modules.md).

<!-- dsl-example: compile-success -->
```nui
nui 1
record Pair(
  x: number,
  label: string,
)
const first: Pair = Pair(
  x: 10,
  label: "first",
)
const second: Pair = @first
const name: string = @first.label
```

## Value-producing control flow

Record values may use the shared scalar value-producing `if` and exhaustive
`match` forms. The declaration's record type is nominal: every branch or arm
must resolve to the exact same record definition, even when another record has
the same fields.

<!-- dsl-example: compile-success -->
```nui
nui 1
record Pair(
  x: number,
  label: string,
)
const fallback: Pair = Pair(x: 2, label: "right")
const flag: boolean = true
const side: choice(left, right) = left
const selected: Pair = if (@flag) {
  Pair(x: 10, label: "left")
} else {
  @fallback
}
const matched: Pair = match @side {
  left => Pair(x: 11, label: "left")
  right => @fallback
}
const x: number = @selected.x
```

The condition or scrutinee is checked by the ordinary scalar expression
analyzer. Both record branches are resolved and typechecked, while runtime
evaluates the condition or scrutinee first and evaluates only the selected
record leaf. Record leaves may be constructors, whole-record references, or
supported statically indexed members of a nominal record collection. Collection
values and optional values are not introduced by these forms.

## Collection value-for

Nominal-record collections support the same lazy, value-producing `for` form as
scalar, choice, and geometry collections. The source and result element types
must be exact nominal record identities. The binder has the source record type
and is visible only in the body. A requested result member evaluates only its
corresponding scalar field body.

<!-- dsl-example: compile-success -->
```nui
nui 1
record Pair(
  x: number,
  label: string,
)
const first: Pair = Pair(x: 1, label: "one")
const second: Pair = Pair(x: 2, label: "two")
const pairs: Pair[] = [@first, @second]
const shifted: Pair[] = for item in @pairs {
  Pair(x: @item.x + 10, label: @item.label)
}
const selected: Pair = @shifted[1]
const selectedLabel: string = @selected.label
```

The map preserves source order, duplicates, and empty-source cardinality.
Record collection `.length` does not evaluate field bodies, and indexing is
zero-based with the normal runtime bounds checks. Nested arrays and optional
result values remain unsupported.

## Notes

Record values group scalar data; they do not become geometry elements or a
general-purpose object type. Optional record parameters use the same
`hasValue(...)` presence rules as other optional module parameters.
