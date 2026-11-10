# Styles

## Style properties

`style` defines reusable drawing properties. Properties cascade independently
from outer groups to inner groups and elements, with later assigned Styles
overriding only the properties they provide.

The common properties are:

- `visible`: a boolean presentation value.
- `width`: a positive finite stroke width in pixels.
- `lineType`: `solid`, `dashed`, or `dotted`.
- `color`: a theme role such as `foreground`, or a literal `#RRGGBB`.
- `fill`: a theme role, a literal `#RRGGBB`, or `none`; `none` clears an inherited fill.
- `fillOpacity`: a finite number from `0` through `1`.

The older combined `stroke` syntax is not part of `nui 1`. The normal drawing
defaults are `1px`, `solid`, and `foreground` when no more-specific value
overrides them. Legacy `profile` declarations and `for @Profile` blocks are
rejected.

## Inheritance and activity

Multiple Style owners cascade from outer group to inner group to element in
source/list order. Each property merges independently; a later value overrides
only the property it supplies.

Computation and presentation are separate from styling. `enabled: false`
prevents evaluation/materialization; `visible: false` evaluates but is not
drawn. Ancestor gates cannot be overridden by children, and Style `visible`
cannot override a direct or ancestor `visible: false`. See [Control flow](control-flow.md)
and [Expressions](expressions.md).

<!-- dsl-example: compile-success -->
```nui
nui 1
style SeamLine {
  visible: true,
  width: 1px,
  lineType: solid,
  color: foreground,
  fill: none,
  fillOpacity: 1,
}
```

<!-- dsl-example: syntax-fragment -->
```nui
style Name {
  visible: true,
  width: 1px,
  lineType: dashed,
  color: #RRGGBB,
  fill: accent,
  fillOpacity: 0.5,
}
```
