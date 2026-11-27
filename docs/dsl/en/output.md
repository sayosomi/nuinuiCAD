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

Print supports paper sizes `a4` and `a3`, orientations `portrait` and
`landscape`, and a required finite,
non-negative `overlap`. Both print and SVG require a nonempty `layers: [layer,
...]` selector. Layer references resolve through the ordinary lexical namespace
to declaration identities; `default` is selectable explicitly. A drawable is
included only when its source layer is selected, independently of Canvas
visibility. A valid selector that matches no drawable produces an explicit
empty output. Missing, malformed, empty, unresolved, inaccessible, ambiguous,
and non-layer references are source errors. Legacy `profile:` output arguments
are rejected. `overlap` is the retained glue allowance / safe-edge inset in
millimetres. For paper width `W` and height `H`, the usable dimensions are
`W - 2 * overlap` and `H - 2 * overlap`; both must be positive. The page stride
uses those usable dimensions, so overlap reduces the stride and adjacent
sheets physically overlap.

For nonempty print output, positive rendered coordinates determine the page
count. The first usable-area origin is always global `(0, 0)` and page origins
never move with the rendered minimum bounds:

```text
strideX = W - 2 * overlap
strideY = H - 2 * overlap
columns = max(1, ceil(bounds.maxX / strideX))
rows    = max(1, ceil(bounds.maxY / strideY))
pageOriginX = column * strideX - overlap
pageOriginY = row * strideY - overlap
```

Page indices start at zero and are ordered left-to-right, then bottom-to-top.
The first physical sheet starts at `(-overlap, -overlap)`. For A4 portrait
with 10 mm overlap, the stride is 190 by 277 mm and the second column starts
at `(180, -10)`. Negative coordinates do not add pages in the negative
direction. A nonempty output has at least one page per axis, including when
all selected geometry is negative; empty output still has zero pages.

The stroke-inclusive rendered bounds of selected print geometry drive a
non-blocking Output Preview warning when `minX < 0` or `minY < 0`. It explains
that geometry extends beyond the usable print origin and portions outside
physical paper may be omitted from PDF output. The warning does not block
editing, PDF export, or printing, and disappears when rendered bounds return
to nonnegative coordinates. Geometry is not clipped at the usable-area origin
or at inset guides. Negative geometry within a physical page's overlap strip
remains printable. The PDF output clips to each physical sheet rectangle, and
portions beyond that rectangle may be omitted. Output Preview keeps off-paper
geometry visible for placement correction. Inset guides are advisory only.

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
  place Front(at: (0, 0), angle: 0, mirror: false)
}
print HomeA4(layout: Pattern, layers: [finished, markings], paper: a4, orientation: portrait, overlap: 10)
svg Preview(layout: Pattern, layers: [finished], margin: 5)
```

<!-- dsl-example: syntax-fragment -->
```nui
layout Name(scale: number) {
  place Group(origin: Group::Origin, at: (x, y), angle: 0, mirror: false)
}
```
