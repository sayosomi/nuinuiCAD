# Modifiers

## Modifier properties

`profile` names a top-level drawing profile. A `modifier` defines reusable
drawing properties and can add profile-specific overrides in `for @profile {
... }`. The profile selects a presentation; it does not alter construction
geometry or scalar evaluation.

The common properties are:

- `state`: `visible`, `hidden`, or `disabled`.
- `width`: a positive finite stroke width in pixels.
- `style`: `solid`, `dashed`, or `dotted`.
- `color`: a theme role such as `foreground`, or a literal `#RRGGBB`.

Profile blocks accept these drawing properties only. The older combined
`stroke` syntax is not part of `nui 4`. The normal drawing defaults are `1px`,
`solid`, and `foreground` when no more-specific value overrides them.

## Inheritance and activity

Modifier values cascade from outer group to inner group to element. Multiple
modifier owners are applied in source/list order, and each property merges
independently; a later value overrides only the property it supplies. A
selected profile overlays its matching `for` values after the common values
have been collected.

Activity is a separate gate from styling. Visible content evaluates and draws,
hidden content evaluates and can be referenced but is not drawn, and disabled
content does not evaluate or become available to later references. Ancestor
activity applies before the modifier cascade. See [Control flow](control-flow.md)
and [Expressions](expressions.md).

<!-- dsl-example: compile-success -->
```nui
nui 4
profile Print
modifier SeamLine {
  state: visible,
  width: 1px,
  style: solid,
  color: foreground,
  for @Print {
    width: 0.5px,
  }
}
```

<!-- dsl-example: syntax-fragment -->
```nui
modifier Name {
  state: visible,
  width: 1px,
  style: dashed,
  color: #RRGGBB,
  for @Profile {
    width: 0.5px,
  }
}
```
