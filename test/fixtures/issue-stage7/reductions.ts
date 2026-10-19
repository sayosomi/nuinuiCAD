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
export const reductions = [...snapshots, ...indexed, minimalIndexedModule, ...endpoints, ...failures, ...polylines];
