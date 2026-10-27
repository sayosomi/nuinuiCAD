// Source-derived reducers: expected order is [B,A] after one swap, [A,B]
// after zero iterations. Values are calculated without compiler/runtime output.
const snapshots = ([false,true] as const).flatMap(module => [1,0].map(n => ({
  id: `R-snapshot-${module ? "module" : "root"}-${n}`,
  source: ["nui 1", ...(module ? ["module Box() {"] : []),
    "const Seed: point[] = [(2,3),(8,11)]", `const Ticks: number[] = [${n ? "1" : ""}]`,
    "for Tick in @Ticks carry Pts: point[] = @Seed {", "const A: point = @Pts[0]", "const B: point = @Pts[1]",
    "const Swap: point[] = [@B,@A]", "next Pts = @Swap", "}",
    `${module ? "export " : ""}line Out = segment(start: @Pts[0], end: @Pts[1])`, ...(module ? ["}","instance Live = Box()"] : [])].join("\n")+"\n",
  expected: { start: n ? { x:8,y:11 } : { x:2,y:3 }, end: n ? { x:2,y:3 } : { x:8,y:11 } }
})));

const indexed = [false,true].map(module => ({
  seedDrawable: true,
  id: `R-indexed-drawable-${module ? "module" : "root"}`,
  source: ["nui 1", ...(module ? ["module Box() {"] : []),
    "line Seed = segment(start: (2,3), end: (8,11))", "const Seeds: line[] = [@Seed]", "const Ticks: number[] = []",
    "for Tick in @Ticks carry Lines: line[] = @Seeds {", "next Lines = @Lines", "}", "const Pick: line = @Lines[0]",
    `${module ? "export " : ""}line Out = from(source: @Pick)`, ...(module ? ["}","instance Live = Box()"] : [])].join("\n")+"\n",
  expected: { start: { x:2,y:3 }, end: { x:8,y:11 } }
}));
const endpoints = ["path","line"].map(type => ({
  id: `R-endpoint-${type}`,
  source: `nui 1\nconst Seed: ${type} = segment(start: (2,3), end: (8,11))\npoint Out = from(source: @Seed.end)\n`,
  expected: { x:8,y:11 }
}));
const failures = [true,false].map(fail => ({
  id: `R-failure-${fail ? "invalid" : "valid"}`,
  source: ["nui 1","module Box() {","export point Prefix = coordinate(x: 3, y: 4)",
    `const Bad: point = coordinate(x: ${fail ? "1 / 0" : "2"}, y: 3)`,
    "export line Out = segment(start: @Bad, end: (8,11))", "}","instance Live = Box()","point Survivor = coordinate(x: 17, y: 19)"].join("\n")+"\n",
  fail,
  expected: { x:17,y:19 }
}));
const polylines = [false,true].map(named => ({
  id: `R-polyline-${named ? "named" : "inline"}`,
  source: ["nui 1", "module Box(Origin: number) {",
    ...(named ? ["point A = coordinate(x: @Origin, y: 2)", "point B = coordinate(x: @Origin + 3, y: 6)"] : []),
    `export line Out = polyline(points: ${named ? "[@A,@B]" : "[(@Origin,2),(@Origin + 3,6)]"}, closed: false)`,
    "}", "instance Live = Box(Origin: 7)"].join("\n")+"\n",
  named, expected: { start:{ x:7,y:2 },end:{ x:10,y:6 } }
}));
const minimalIndexedModule = {
  ...indexed[1], id:"R-indexed-line-module", seedDrawable:false,
  source:indexed[1].source.replace("line Seed =", "const Seed: line =")
};
const minimalIndexedRoot = {
  ...indexed[0], id:"R-indexed-line-root", seedDrawable:false,
  source:indexed[0].source.replace("line Seed =", "const Seed: line =")
};
const lazySnapshots = [false,true].map(module => {
  const base = snapshots.find(c => c.id === `R-snapshot-${module ? "module" : "root"}-1`)!;
  return { ...base, id:`R-snapshot-lazy-${module ? "match-module" : "if-root"}`,
    source:base.source.replace("const Swap: point[] = [@B,@A]", [
      "const Missing: point = @Pts[9]",
      ...(module ? ["const Side: choice(good,bad) = good"] : []),
      `const Swap: point[] = ${module ? "match @Side { good => [@B,@A] bad => [@Missing,@A] }" : "if (true) { [@B,@A] } else { [@Missing,@A] }"}`
    ].join("\n")) };
});
const polylineValueAnchor = {
  ...polylines[0], id:"R-polyline-value-anchor",
  source:"nui 1\nmodule Box() {\nconst P: path = segment(start: (2,3), end: (8,11))\nexport line Out = polyline(points: [@P.end,(10,13)], closed: false)\n}\ninstance Live = Box()\n",
  expected:{ start:{ x:8,y:11 }, end:{ x:10,y:13 } }
};
const lazyElse = { ...lazySnapshots[0], id:"R-snapshot-lazy-else-root",
  source:lazySnapshots[0].source.replace("if (true) { [@B,@A] } else { [@Missing,@A] }", "if (false) { [@Missing,@A] } else { [@B,@A] }") };
const twice = { ...snapshots[0], id:"R-snapshot-root-2",
  source:snapshots[0].source.replace("Ticks: number[] = [1]", "Ticks: number[] = [1,2]"), expected:snapshots[1].expected };
export const reductions = [...snapshots, twice, ...indexed, minimalIndexedModule, minimalIndexedRoot, ...endpoints, ...failures, ...polylines, polylineValueAnchor, ...lazySnapshots, lazyElse];
