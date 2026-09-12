# Styles

## Style properties

`profile` names a top-level drawing profile. A `style` defines reusable
drawing properties and can add profile-specific overrides in `for @profile {
... }`. The profile selects a presentation; it does not alter construction
geometry or scalar evaluation.

The common properties are:

- `visible`: a boolean presentation value.
- `width`: a positive finite stroke width in pixels.
- `lineType`: `solid`, `dashed`, or `dotted`.
- `color`: a theme role such as `foreground`, or a literal `#RRGGBB`.

Profile blocks accept these drawing properties only. The older combined
`stroke` syntax is not part of `nui 1`. The normal drawing defaults are `1px`,
`solid`, and `foreground` when no more-specific value overrides them.

## Inheritance and activity

Style values cascade from outer group to inner group to element. Multiple
Style owners are applied in source/list order, and each property merges
independently; a later value overrides only the property it supplies. A
selected profile overlays its matching `for` values after the common values
have been collected.

Computation and presentation are separate from styling. `enabled: false`
prevents evaluation/materialization; `visible: false` evaluates but is not
drawn. Ancestor gates cannot be overridden by children, and Style `visible`
cannot override a direct or ancestor `visible: false`. See [Control flow](control-flow.md)
and [Expressions](expressions.md).

<!-- dsl-example: compile-success -->
```nui
nui 1
profile Print
style SeamLine {
  visible: true,
  width: 1px,
  lineType: solid,
  color: foreground,
  for @Print {
    width: 0.5px,
  }
}
```

<!-- dsl-example: syntax-fragment -->
```nui
style Name {
  visible: true,
  width: 1px,
  lineType: dashed,
  color: #RRGGBB,
  for @Profile {
    width: 0.5px,
  }
}
```
