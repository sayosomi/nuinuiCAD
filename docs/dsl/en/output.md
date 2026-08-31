# Output

## Layouts and placement

`layout` is a named top-level declaration containing direct `place` entries.
Each `place` selects an earlier group and can set an origin, position, scale,
angle, and mirror flag. Layouts are non-hoisted and cannot contain arbitrary
geometry declarations. `print` and `svg` are bodyless output declarations that
refer to an earlier layout.

The defaults are layout scale `1`, the selected group's local origin, place
scale inherited from the layout, angle `0`, and `mirror: false`. Literal scales
must be finite and positive. Literal angles are normalized to `[0, 360)`.
Placement activity and drawing modifiers still apply to the placed group; see
[Modifiers](modifiers.md).

## Print and SVG

Print supports `a4` and `a3`, `portrait` and `landscape`, an optional drawing
profile, and a required finite, non-negative `overlap`. `overlap` is the
retained glue allowance / safe-edge inset in millimetres. For paper width `W`
and height `H`, the usable dimensions are `W - 2 * overlap` and
`H - 2 * overlap`; both must be positive. The page stride uses those usable
dimensions, so overlap reduces the stride and adjacent sheets physically
overlap. Geometry is not clipped, and inset guides are advisory only.

When overlap is zero, the stride is the full paper size and no joining guides
or labels are emitted. With positive overlap, guides are placed at the inset
safe edges and joining labels appear only where a neighboring page exists.
Print does not accept `margin`.

SVG uses `margin` in millimetres, defaulting to `0`. Its margin affects the SVG
canvas around the rendered bounds; it is independent of print overlap.

## Terminator

`stop` is a standalone document terminator. Statements after it remain in the
source but are outside the evaluation limit.

<!-- dsl-example: compile-success -->
```nui
nui 1
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
