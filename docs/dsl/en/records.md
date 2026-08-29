# Records

`record` defines a nominal source-only value type. A record must be declared at
top level, and every field must be a required scalar type. Geometry, arrays,
nested records, optional fields, and field defaults are not supported in the
current record language.

Record constructors are named-only: every field must be supplied exactly once.
Two records with the same field shapes still have different nominal types.
Record values are read-only `const` values. Fields are read with `.` and can be
exported through a module instance.

<!-- dsl-example: compile-success -->
```nui
nui 4
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
