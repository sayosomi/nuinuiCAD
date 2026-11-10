# Output

## Layouts and placement

`layout` is a named top-level declaration containing direct `place` entries.
Each `place` selects a group and can set an origin, position, scale, angle, and
mirror flag. Layouts cannot contain arbitrary geometry declarations. `print`
and `svg` are bodyless output declarations that refer to a layout in the same
legal lexical scope.

The defaults are layout scale `1`, the selected group's local origin, place
scale inherited from the layout, angle `0`, and `mirror: false`. Literal scales
must be finite and positive. Literal angles are normalized to `[0, 360)`.
Placement `enabled`/`visible` gates and drawing Styles still apply to the placed
group; see [Styles](modifiers.md).

## Print and SVG

Print supports `a4` and `a3`, `portrait` and `landscape`, and a required finite,
non-negative `overlap`. Both print and SVG require a nonempty `layers: [@layer,
...]` selector. Layer references resolve through the ordinary lexical namespace
to declaration identities; `@default` is selectable explicitly. A drawable is
included only when its source layer is selected, independently of Canvas
visibility. A valid selector that matches no drawable produces an explicit
empty output. Missing, malformed, empty, unresolved, inaccessible, ambiguous,
and non-layer references are source errors. Legacy `profile:` output arguments
are rejected. `overlap` is the retained glue allowance / safe-edge inset in
millimetres. For paper width `W` and height `H`, the usable dimensions are `W - 2 * overlap` and
`H - 2 * overlap`; both must be positive. The page stride uses those usable
dimensions, so overlap reduces the stride and adjacent sheets physically
overlap. Geometry is not clipped, and inset guides are advisory only.

When overlap is zero, the stride is the full paper size and no joining guides
or labels are emitted. With positive overlap, guides are placed at the inset
safe edges and joining labels appear only where a neighboring page exists.
Print does not accept `margin`.

An output with no drawable in the selected layers has zero bounds and no print
pages. It does not select another layer or add geometry.

SVG uses `margin` in millimetres, defaulting to `0`. Its margin affects the SVG
canvas around the rendered bounds; it is independent of print overlap.

<!-- dsl-example: compile-success -->
```nui
nui 1
layer finished
layer markings
group Front {
  point A = coordinate(x: 0, y: 0)
}
layout Pattern {
  place @Front(at: (0, 0), angle: 0, mirror: false)
}
print HomeA4(layout: @Pattern, layers: [@finished, @markings], paper: a4, orientation: portrait, overlap: 10)
svg Preview(layout: @Pattern, layers: [@finished], margin: 5)
```

<!-- dsl-example: syntax-fragment -->
```nui
layout Name(scale: number) {
  place @Group(origin: @Group::Origin, at: (x, y), angle: 0, mirror: false)
}
```
