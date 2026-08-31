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

## Notes

Record values group scalar data; they do not become geometry elements or a
general-purpose object type. Optional record parameters use the same
`hasValue(...)` presence rules as other optional module parameters.
