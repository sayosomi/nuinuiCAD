# Output

`layout` is a named top-level declaration containing direct `place` entries.
Each placement selects a group and may set an origin, position, scale, angle,
and mirror flag. `print` and `svg` are bodyless output declarations that refer
to a layout.

Print supports `a4` and `a3`, `portrait` and `landscape`, an optional drawing
profile, and non-negative `overlap`. Overlap is the retained glue allowance: it
insets each page's safe edge and reduces the page stride. It does not clip
geometry. SVG uses `margin`; print does not have a `margin` argument.

`stop` is a standalone document terminator. Statements after it remain in the
source but are outside the evaluation limit.

<!-- dsl-example: compile-success -->
```nui
nui 4
group Front {
  point A = coordinate(x: 0, y: 0)
}
layout Pattern {
  place @Front(at: (0, 0), angle: 0, mirror: false)
}
print HomeA4(layout: @Pattern, paper: a4, orientation: portrait, overlap: 10)
svg Preview(layout: @Pattern, margin: 5)
```

<!-- dsl-example: syntax-fragment -->
```nui
layout Name(scale: number) {
  place @Group(origin: @Group::Origin, at: (x, y), angle: 0, mirror: false)
}
```
