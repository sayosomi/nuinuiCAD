import type { Cell } from "./model";
export const reductions: Cell[] = [
  {
    id: "R-geometry-record", axes: [0, 0, 0], expected: { X: 9 },
    source: "nui 1\nrecord Box(p: point)\nconst P: point = coordinate(x: 9, y: 12)\nconst B: Box = Box(p: @P)\nconst Alias: point = @B.p\nconst X: number = @Alias.x"
  },
  {
    id: "P-geometry-direct", axes: [0, 0, 0], expected: { X: 9 },
    source: "nui 1\nconst P: point = coordinate(x: 9, y: 12)\nconst Alias: point = @P\nconst X: number = @Alias.x"
  },
  {
    id: "R-geometry-export", axes: [0, 0, 1], expected: { X: 9 },
    source: "nui 1\nrecord Box(p: point)\nmodule Make() {\n const P: point = coordinate(x: 9, y: 12)\n const B: Box = Box(p: @P)\n export const out: Box = @B\n}\ninstance Use = Make()\nconst Alias: point = @Use::out.p\nconst X: number = @Alias.x"
  },
  {
    id: "R-field-index", axes: [0, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(xs: number[])\nconst B: Box = Box(xs: [7, 19])\nconst Alias: Box = @B\nconst X: number = @Alias.xs[1]"
  },
  {
    id: "P-field-module", axes: [0, 0, 1], expected: { X: 19 },
    source: "nui 1\nrecord Box(xs: number[])\nmodule Get(b: Box) {\n export const x: number = @b.xs[1]\n}\ninstance Use = Get(b: Box(xs: [7, 19]))\nconst X: number = @Use::x"
  },
  {
    id: "R-field-array", axes: [0, 1, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(xs: number[])\nconst B: Box = Box(xs: [7, 19])\nconst Alias: number[] = @B.xs\nconst X: number = @Alias[1]"
  },
  {
    id: "P-array-alias", axes: [0, 1, 0], expected: { X: 19 },
    source: "nui 1\nconst B: number[] = [7, 19]\nconst Alias: number[] = @B\nconst X: number = @Alias[1]"
  },
  {
    id: "R-record-binder", axes: [1, 1, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst B: Box? = Box(n: 19)\nconst Chosen: Box = match @B { none => Box(n: 7) some held => @held }\nconst X: number = @Chosen.n"
  },
  {
    id: "P-scalar-binder", axes: [0, 1, 0], expected: { X: 19 },
    source: "nui 1\nconst B: number? = 19\nconst X: number = match @B { none => 7 some held => @held }"
  },
  {
    id: "R-record-coalesce-root", axes: [1, 0, 0], expected: { X: 2 },
    source: "nui 1\nrecord Box(xs: number[])\nconst Present: Box = Box(xs: [7, 19])\nconst B: Box? = @Present\nconst Chosen: Box = @B ?? @Present\nconst X: number = @Chosen.xs.length"
  },
  {
    id: "R-record-coalesce-module", axes: [1, 0, 1], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nmodule Make() {\n const Present: Box = Box(n: 19)\n const B: Box? = @Present\n export const Chosen: Box = @B ?? @Present\n}\ninstance Use = Make()\nconst X: number = @Use::Chosen.n"
  },
  {
    id: "R-mapped-record-index", axes: [1, 1, 0], expected: { X: 29 },
    source: "nui 1\nrecord Box(xs: number[])\nconst B: Box = Box(xs: [17, 29])\nconst Items: Box[] = [@B]\nconst Mapped: Box[] = for item in @Items { @item }\nconst I: number = 0\nconst X: number = @Mapped[@I].xs[@I + 1]"
  },
  {
    id: "P-record-index-constant", axes: [1, 0, 0], expected: { X: 29 },
    source: "nui 1\nrecord Box(xs: number[])\nconst B: Box = Box(xs: [17, 29])\nconst Items: Box[] = [@B]\nconst X: number = @Items[0].xs[1]"
  },
  {
    id: "R-record-constructor-array", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst Items: Box[] = [Box(n: 7), Box(n: 19)]\nconst X: number = @Items[1].n"
  },
  {
    id: "R-record-constructor-module", axes: [1, 0, 1], expected: { X: 29, Y: 53 },
    source: "nui 1\nrecord Box(n: number)\nmodule Make(n: number) {\n export const Items: Box[] = [Box(n: @n), Box(n: @n + 10)]\n}\ninstance One = Make(n: 19)\ninstance Two = Make(n: 43)\nconst X: number = @One::Items[1].n\nconst Y: number = @Two::Items[1].n"
  },
  {
    id: "R-record-constructor-nested", axes: [1, 0, 0], expected: { X: 19, Y: 43 },
    source: "nui 1\nrecord Inner(n: number)\nrecord Box(inner: Inner, xs: number[])\nconst Items: Box[] = [Box(inner: Inner(n: 7), xs: [11, 13]), Box(inner: Inner(n: 19), xs: [31, 43])]\nconst X: number = @Items[1].inner.n\nconst Y: number = @Items[1].xs[1]"
  },
  {
    id: "P-record-literal-references", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst A: Box = Box(n: 7)\nconst B: Box = Box(n: 19)\nconst Items: Box[] = [@A, @B]\nconst X: number = @Items[1].n"
  },
  {
    id: "I-record-literal-nominal", axes: [1, 0, 0], expected: {}, expectedCompilerError: "record-nominal-type-mismatch",
    source: "nui 1\nrecord Box(n: number)\nrecord Other(n: number)\nconst Items: Box[] = [Other(n: 19)]"
  },
  {
    id: "R-import-nested", axes: [0, 1, 0], expected: { X: 19 },
    source: 'nui 1\nimport "./library.nui" as lib\ninstance Use = lib::Make()\nconst X: number = @Use::out.inner.n',
    saved: { "library.nui": "nui 1\nrecord Inner(n: number)\nrecord Box(inner: Inner)\nexport module Make() {\n const B: Box = Box(inner: Inner(n: 19))\n export const out: Box = @B\n}" }
  },
  {
    id: "P-local-nested", axes: [0, 1, 0], expected: { X: 19 },
    source: "nui 1\nrecord Inner(n: number)\nrecord Box(inner: Inner)\nmodule Make() {\n const B: Box = Box(inner: Inner(n: 19))\n export const out: Box = @B\n}\ninstance Use = Make()\nconst X: number = @Use::out.inner.n"
  },
  {
    id: "R-import-asymmetric", axes: [1, 1, 1], expected: { X: 19, Y: 43 },
    source: 'nui 1\nimport "./relay.nui" as lib\ninstance One = lib::Make(n: 19)\ninstance Two = lib::Make(n: 43)\nconst X: number = @One::out.inner.n\nconst Y: number = @Two::out.inner.n',
    saved: { "relay.nui": 'nui 1\nimport "./library.nui" as original\nexport @original::Make', "library.nui": "nui 1\nrecord Inner(n: number)\nrecord Box(inner: Inner)\nexport module Make(n: number) {\n const B: Box = Box(inner: Inner(n: @n))\n const Local: Box = @B\n export const out: Box = @Local\n}" }
  },
  {
    id: "R-binder-none", axes: [1, 1, 0], expected: { X: 19 }, expectedNone: ["Absent"],
    source: "nui 1\nrecord Box(n: number)\nconst B: Box? = none\nconst Chosen: Box = match @B { some held => @held none => Box(n: 19) }\nconst X: number = @Chosen.n\nconst Absent: number? = @B?.n"
  },
  {
    id: "R-selected-error", axes: [1, 1, 0], expected: {}, expectedIssues: { X: "evaluation-divide-by-zero" },
    source: "nui 1\nrecord Box(xs: number[])\nconst Zeros: number[] = [0]\nconst Bad: number[] = for zero in @Zeros { 1 / @zero }\nconst B: Box? = none\nconst Fallback: Box = Box(xs: @Bad)\nconst Chosen: Box = match @B { none => @Fallback some held => @held }\nconst X: number = @Chosen.xs[0]"
  },
  {
    id: "R-lazy-constructor-root", axes: [1, 1, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst B: Box? = Box(n: 19)\nconst Chosen: Box = match @B { none => Box(n: 1 / 0) some held => @held }\nconst X: number = @Chosen.n"
  },
  {
    id: "R-lazy-constructor-module", axes: [1, 1, 1], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nmodule Make() {\n const B: Box? = Box(n: 19)\n export const Chosen: Box = match @B { none => Box(n: 1 / 0) some held => @held }\n}\ninstance Use = Make()\nconst X: number = @Use::Chosen.n"
  },
  {
    id: "R-record-if-array", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(xs: number[])\nconst Chosen: Box = if (true) { Box(xs: [7, 19]) } else { Box(xs: [23]) }\nconst X: number = @Chosen.xs[1]"
  },
  {
    id: "R-geometry-asymmetric", axes: [0, 1, 1], expected: { X: 19, Y: 43 },
    source: "nui 1\nrecord Box(p: point)\nmodule Make(n: number) {\n const P: point = coordinate(x: @n, y: 7)\n const B: Box = Box(p: @P)\n const Local: Box = @B\n export const out: Box = @Local\n}\ninstance One = Make(n: 19)\ninstance Two = Make(n: 43)\nconst P: point = @One::out.p\nconst Q: point = @Two::out.p\nconst X: number = @P.x\nconst Y: number = @Q.x"
  },
  {
    id: "R-mapped-tag", axes: [1, 1, 0], expected: { X: 29 },
    source: "nui 1\nrecord Box(n: number)\nconst B: Box = Box(n: 19)\nconst Items: Box[] = [@B]\nconst Mapped: Box[] = for item in @Items { Box(n: @item.n + 10) }\nconst I: number = 0\nconst X: number = @Mapped[@I].n"
  },
  {
    id: "P-mapped-tag-constant", axes: [1, 0, 0], expected: { X: 29 },
    source: "nui 1\nrecord Box(n: number)\nconst B: Box = Box(n: 19)\nconst Items: Box[] = [@B]\nconst Mapped: Box[] = for item in @Items { Box(n: @item.n + 10) }\nconst X: number = @Mapped[0].n"
  },
  {
    id: "P-record-coalesce-source", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst Present: Box = Box(n: 19)\nconst B: Box? = @Present\nconst Chosen: Box = @B ?? @Present\nconst X: number = @Chosen.n"
  },
  {
    id: "P-record-if-scalar", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst Chosen: Box = if (true) { Box(n: 19) } else { Box(n: 23) }\nconst X: number = @Chosen.n"
  },
  {
    id: "P-record-literal-with-module", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nmodule Unrelated() {\n}\nconst A: Box = Box(n: 7)\nconst B: Box = Box(n: 19)\nconst Items: Box[] = [@A, @B]\nconst X: number = @Items[1].n"
  },
  {
    id: "R-direct-constructor-fallback", axes: [1, 0, 0], expected: { X: 19 },
    source: "nui 1\nrecord Box(n: number)\nconst B: Box? = none\nconst Chosen: Box = @B ?? Box(n: 19)\nconst X: number = @Chosen.n"
  },
  {
    id: "R-constructor-dependency-root", axes: [1, 0, 0], expected: { X: 29 },
    source: "nui 1\nrecord Box(n: number)\nconst N: number = 19\nconst B: Box? = none\nconst Chosen: Box = @B ?? Box(n: @N + 10)\nconst X: number = @Chosen.n"
  },
  {
    id: "R-constructor-dependency-module", axes: [1, 0, 1], expected: { X: 29 },
    source: "nui 1\nrecord Box(n: number)\nmodule Make(n: number) {\n const B: Box? = none\n export const Chosen: Box = @B ?? Box(n: @n + 10)\n}\ninstance Use = Make(n: 19)\nconst X: number = @Use::Chosen.n"
  }
];
