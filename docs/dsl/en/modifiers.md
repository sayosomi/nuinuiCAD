# Modifiers

`profile` declares a top-level drawing profile. A `modifier` declares reusable
drawing properties and may provide profile-specific overrides with `for
@profile { ... }`.

The common properties are `state` (`visible`, `hidden`, or `disabled`),
positive finite `width` in pixels, `style` (`solid`, `dashed`, or `dotted`),
and `color` as a theme role or `#RRGGBB`. Profile blocks may contain only
these properties. The old combined `stroke` syntax is not part of nui 4.

Modifiers are applied in owner order and inherited from outer group to inner
group to element. Values merge by property. A disabled owner is not evaluated
or available as a reference; a hidden owner still evaluates but is not drawn.

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
