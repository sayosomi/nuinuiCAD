// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { emptyDocument, queryDslSignatureHelp, queryDslCompletion } from "@nuinuicad/nui-language";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateWithRustFixture, fixtureFromSource, normalizeParityPayload, optionsFor } from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const parity = import.meta.env.VITE_RUN_RUST_PARITY === "1";
const run = (source: string) => {
  const fixture = fixtureFromSource(source.startsWith("nui 1") ? source : `nui 1\n${source}`);
  expect(fixture.compiled!.diagnostics).toEqual([]);
  const payload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
  if (parity) expect(normalizeParityPayload(evaluateWithRustFixture(repoRoot, fixture))).toEqual(normalizeParityPayload(payload));
  const result = evaluationPayloadToResult(payload);
  const named = (name: string) => result.computedGeometry.get(fixture.elements.find(e => e.name === name)!.id);
  const scalar = (name: string) => {
    const binding = fixture.compiled!.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === name)!;
    return result.computedScalarBindings?.get(binding.id);
  };
  return { fixture, result, named, scalar };
};

describe("pathDistance through canonical compilation and production evaluation", () => {
  it("existing pure-point measurement operands work in construction arguments", () => {
    const { result, named } = run(`const B: point = coordinate(x:20,y:0)
const C: point = coordinate(x:70,y:0)
point Control = coordinate(x:distance(@B,@C), y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Control")).toMatchObject({ x:50 });
  }, 30000);

  it("existing typed-point collection operands retain their numeric selector", () => {
    const { result, named } = run(`point B = coordinate(x:20,y:0)
point C = coordinate(x:70,y:0)
const points: point[] = [@B,@C]
const pick: number = 1
const d: number = distance(@points[0],@points[@pick])
point Control = coordinate(x:@d,y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Control")).toMatchObject({ x:50 });
  }, 30000);

  it("existing joined Bezier metadata retains its segment identity", () => {
    const { result } = run(`line L = segment(start:(-10,0), end:(0,0))
arc A = arc(center:(0,10), radius:10, start:270, end:360, direction:counterclockwise)
curve B = bezier(start:(10,10), startAngle:0, startLength:3, end:(20,10), endAngle:0, endLength:3)
line Mixed = join(paths:[@L,@A,@B], closed:false)`);
    expect(result.errors).toEqual([]);
  }, 30000);

  it("existing pure Bezier endpoints resolve to typed point operands", () => {
    const { result, named } = run(`const C: path = bezier(start:(0,0), startAngle:90, startLength:40, end:(100,0), endAngle:270, endLength:40)
const chord: number = distance(@C.start,@C.end)
point Control = coordinate(x:@chord,y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Control")).toMatchObject({ x:100 });
  }, 30000);

  it("accepts unique pure Bezier points and coordinate collections with dynamic selectors", () => {
    const { result, named } = run(`const C: path = bezier(start:(0,0), startAngle:90, startLength:40, end:(100,0), endAngle:270, endLength:40)
const points: point[] = [(15.625,22.5),(84.375,22.5)]
const index: number = 1
const d: number = pathDistance(point2:@points[@index], point1:@points[0], path:@C)
point Result = coordinate(x:@d,y:pathDistance(path:@C, point1:@C.start, point2:@C.start))`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:expect.closeTo(71.03548120464426,1), y:0 });
  }, 30000);

  it("measures the 50 mm interval in either order and canonicalizes named arguments", () => {
    const { result, named } = run(`line A = segment(start: (0,0), end: (100,0))
point B = coordinate(x:20, y:0)
point C = coordinate(x:70, y:0)
const d: number = pathDistance(path: @A, point1: @B, point2: @C)
point Result = coordinate(x: @d, y: pathDistance(point2: @B, path: @A, point1: @C))`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:50, y:50 });
  }, 30000);

  it.each([
    [90, "counterclockwise", 5 * Math.PI], [270, "counterclockwise", 15 * Math.PI],
    [90, "clockwise", 15 * Math.PI], [270, "clockwise", 5 * Math.PI]
  ])("measures the analytic %s° arc in direction %s", (end, direction, length) => {
    const { result, named } = run(`arc A = arc(center: (0,0), radius:10, start:0, end:${end}, direction:${direction})
const d: number = pathDistance(path:@A, point1:@A.start, point2:@A.end)
reverse @A()
point Result = coordinate(x:@d, y:pathDistance(path:@A, point1:@A.start, point2:@A.end))`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:expect.closeTo(length, 9), y:expect.closeTo(length, 9) });
    expect(length).not.toBeCloseTo(Math.sqrt(200), 5);
  }, 30000);

  it("resolves interior arc points by coordinates", () => {
    const { named, result } = run(`arc A = arc(center:(0,0), radius:10, start:0, end:270, direction:counterclockwise)
point B = coordinate(x:0, y:10)
point C = coordinate(x:-10, y:0)
point Result = coordinate(x:pathDistance(path:@A, point1:@B, point2:@C), y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:expect.closeTo(5*Math.PI, 9) });
  }, 30000);

  it("takes the shorter closed route and collapses the seam and adjacent corners", () => {
    const { result, named } = run(`line A = polyline(points:[(0,0),(30,0),(30,20),(0,20)], closed:true)
point B = coordinate(x:30, y:0)
point C = coordinate(x:0, y:0)
point D = coordinate(x:0, y:20)
point Result = coordinate(x:pathDistance(path:@A, point1:@B, point2:@C), y:pathDistance(path:@A, point1:@C, point2:@B))
point Seam = coordinate(x:pathDistance(path:@A, point1:@A.start, point2:@A.end), y:pathDistance(path:@A, point1:@B, point2:@B))
point Half = coordinate(x:pathDistance(path:@A, point1:@B, point2:@D), y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:30, y:30 });
    expect(named("Seam")).toMatchObject({ x:0, y:0 });
    expect(named("Half")).toMatchObject({ x:50 });
  }, 30000);

  it("supports a closed full circle and a closed joined path", () => {
    const { result, named } = run(`arc Circle = arc(center:(0,0), radius:10, start:0, end:360, direction:counterclockwise)
point Top = coordinate(x:0, y:10)
point Result = coordinate(x:pathDistance(path:@Circle, point1:@Circle.start, point2:@Top), y:pathDistance(path:@Circle, point1:@Circle.start, point2:@Circle.end))
line First = segment(start:(0,0), end:(30,0))
line Rest = polyline(points:[(30,0),(30,20),(0,20),(0,0)], closed:false)
line Loop = join(paths:[@First,@Rest], closed:true)
point Joined = coordinate(x:pathDistance(path:@Loop, point1:@First.end, point2:@Rest.end), y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:expect.closeTo(5*Math.PI, 9), y:0 });
    expect(named("Joined")).toMatchObject({ x:30 });
  }, 30000);

  it("measures a nonuniform Bezier interior interval against independent Simpson integration", () => {
    // Controls (0,0),(0,40),(100,40),(100,0); endpoints at t=.25 and .75.
    const n = 10000, from = .25, h = .5/n;
    const speed = (t: number) => Math.hypot(600*t*(1-t), 120*(1-2*t));
    let integral = speed(from) + speed(.75);
    for (let i=1;i<n;i++) integral += (i%2 ? 4 : 2)*speed(from+i*h);
    integral *= h/3;
    const { result, named } = run(`curve A = bezier(start:(0,0), startAngle:90, startLength:40, end:(100,0), endAngle:270, endLength:40)
point B = coordinate(x:15.625, y:22.5)
point C = coordinate(x:84.375, y:22.5)
point Result = coordinate(x:pathDistance(path:@A, point1:@B, point2:@C), y:pathDistance(path:@A, point1:@C, point2:@B))`);
    expect(result.errors).toEqual([]);
    const g = named("Result"); if (g?.kind !== "point") throw new Error("missing result");
    // Existing cubic rule: 32 chords on the exact subcubic, independent of Canvas.
    expect(Math.abs(g.x-integral)).toBeLessThan(.02);
    expect(g.y).toBeCloseTo(g.x, 10);
    expect(g.x).toBeGreaterThan(68.75);
  }, 30000);

  it("measures multiple Bezier segments at their knot and mixed line/arc/Bezier joins", () => {
    const { result, named } = run(`point Mid = coordinate(x:40, y:30)
curve Wave = bezier(start:(0,0), startAngle:30, startLength:25, end:(100,0), endAngle:300, endLength:20, intermediates:[knot(point:@Mid, angle:0, incoming:15, outgoing:15)])
const left: number = pathDistance(path:@Wave, point1:@Wave.start, point2:@Mid)
const right: number = pathDistance(path:@Wave, point1:@Mid, point2:@Wave.end)
point Knot = coordinate(x:@left + @right, y:@Wave.length)
line L = segment(start:(-10,0), end:(0,0))
arc A = arc(center:(0,10), radius:10, start:270, end:360, direction:counterclockwise)
curve B = bezier(start:(10,10), startAngle:0, startLength:3, end:(20,10), endAngle:0, endLength:3)
line Mixed = join(paths:[@L,@A,@B], closed:false)
point Result = coordinate(x:pathDistance(path:@Mixed, point1:@L.start, point2:@B.end), y:pathDistance(path:@Mixed, point1:@L.end, point2:@A.end))`);
    expect(result.errors).toEqual([]);
    const knot = named("Knot"); if (knot?.kind !== "point") throw new Error("missing knot");
    expect(knot.x).toBeCloseTo(knot.y, 9);
    expect(named("Result")).toMatchObject({ x:expect.closeTo(20+5*Math.PI, 8), y:expect.closeTo(5*Math.PI, 8) });
  }, 30000);

  it("retains move/reverse/extract/offset prefixes and supports extended lines", () => {
    const { result, named } = run(`line L = segment(start:(0,0), end:(100,0))
const frozen: path = @L
point B = coordinate(x:20, y:0)
point C = coordinate(x:70, y:0)
const before: number = pathDistance(path:@L, point1:@B, point2:@C)
move @L(from:(0,0), to:(0,10))
reverse @L()
const after: number = pathDistance(path:@L, point1:@L.start, point2:@L.end)
line O = offset(sources:[@L], distance:5)
extract E(source:@frozen, parts:[part:@B..@C])
point Result = coordinate(x:@before, y:@after)
point Derived = coordinate(x:pathDistance(path:@O, point1:@O.start, point2:@O.end), y:pathDistance(path:@E::part, point1:@E::part.start, point2:@E::part.end))
extend @L.end(to:(-20,10))
point Extended = coordinate(x:pathDistance(path:@L, point1:@L.start, point2:@L.end), y:pathDistance(path:@frozen, point1:@B, point2:@C))`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:50, y:100 });
    expect(named("Derived")).toMatchObject({ x:100, y:50 });
    expect(named("Extended")).toMatchObject({ x:120, y:50 });
  }, 30000);

  it("accepts onLine/intersection origins, forward dependencies, Module and collection values", () => {
    const { result, named } = run(`point Result = coordinate(x:@measured, y:@One::d)
module Measure(p:path, a:point, b:point) {
  export const d: number = pathDistance(point2:@b, path:@p, point1:@a)
}
line L = segment(start:(0,0), end:(100,0))
point B = onLine(from:@L, distance:20)
line V = segment(start:(70,-10), end:(70,10))
point C = intersection(line1:@L, line2:@V)
const points: point[] = [@B,@C]
const paths: path[] = [@L]
const measured: number = pathDistance(path:@paths[0], point1:@points[0], point2:@points[1])
instance One = Measure(p:@L, a:@B, b:@C)`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:50, y:50 });
  }, 30000);

  it.each([["point1",20,5,70,0],["point2",20,0,70,5]])("identifies off-path %s and keeps a valid control", (boundary,bx,by,cx,cy) => {
    const { scalar, named } = run(`line L = segment(start:(0,0), end:(100,0))
const B: point = coordinate(x:${bx}, y:${by})
const C: point = coordinate(x:${cx}, y:${cy})
const bad: number = pathDistance(path:@L, point1:@B, point2:@C)
point Control = coordinate(x:pathDistance(path:@L, point1:@L.start, point2:@L.end), y:0)`);
    expect(scalar("bad")).toMatchObject({ status:"error", issueCode:`evaluation-path-distance-off-source-${boundary}` });
    expect(named("Control")).toMatchObject({ x:100 });
  }, 30000);

  it.each([
    ["[(0,0),(10,10),(0,10),(10,0)]",5,5], ["[(0,0),(10,0),(0,0)]",5,0]
  ])("rejects ambiguous crossings/backtracking even with identical input points", (points,x,y) => {
    const { scalar } = run(`line L = polyline(points:${points}, closed:false)
point P = coordinate(x:${x}, y:${y})
const bad: number = pathDistance(path:@L, point1:@P, point2:@P)`);
    expect(scalar("bad")).toMatchObject({ status:"error", issueCode:"evaluation-path-distance-ambiguous-station-point1" });
  }, 30000);

  it("rejects degenerate paths", () => {
    const { scalar } = run(`line L = segment(start:(0,0), end:(0,0))
point P = coordinate(x:0,y:0)
const bad: number = pathDistance(path:@L, point1:@P, point2:@P)`);
    expect(scalar("bad")).toMatchObject({ status:"error", issueCode:"evaluation-path-distance-invalid-source" });
  }, 30000);

  it("keeps typed collection arguments scoped to each Module instance", () => {
    const { result, named } = run(`module Measure(p:path, points:point[], pick:number) {
  export const d: number = pathDistance(point2:@points[@pick], path:@p, point1:@points[0])
}
line L = segment(start:(0,0),end:(100,0))
const points: point[] = [(20,0),(70,0),(80,0)]
instance One = Measure(p:@L, points:@points, pick:1)
instance Two = Measure(p:@L, points:@points, pick:2)
point Result = coordinate(x:@One::d,y:@Two::d)`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({ x:50, y:60 });
  }, 30000);

  it("rejects a repeated cubic station and keeps ordinary unique endpoints", () => {
    const { scalar, named } = run(`const Loop: path = bezier(start:(0,0), startAngle:0, startLength:10, end:(0,0), endAngle:0, endLength:10)
point P = coordinate(x:0,y:0)
const bad: number = pathDistance(path:@Loop,point1:@P,point2:@P)
line L = segment(start:(0,10),end:(100,10))
point Control = coordinate(x:pathDistance(path:@L,point1:@L.start,point2:@L.start),y:pathDistance(path:@L,point1:@L.start,point2:@L.end))`);
    expect(scalar("bad")).toMatchObject({status:"error",issueCode:"evaluation-path-distance-ambiguous-station-point1"});
    expect(named("Control")).toMatchObject({x:0,y:100});
  }, 30000);

  it.each(["L", "P"])("preserves the disabled diagnostic for %s", disabled => {
    const { scalar, named } = run(`line L = segment(start:(0,0),end:(100,0),enabled:${disabled === "L" ? "false" : "true"})
point P = coordinate(x:20,y:0,enabled:${disabled === "P" ? "false" : "true"})
point Q = coordinate(x:70,y:0)
const bad: number = pathDistance(path:@L,point1:@P,point2:@Q)
point Control = coordinate(x:10,y:0)`);
    expect(scalar("bad")).toMatchObject({status:"error",issueCode:"evaluation-geometry-builtin-disabled"});
    expect(named("Control")).toMatchObject({x:10});
  }, 30000);

  it.each(["1 / 0", "1e308 * 1e308"])("preserves dependency failure for nonfinite point input %s", expression => {
    const { scalar, named } = run(`line L = segment(start:(0,0),end:(100,0))
point P = coordinate(x:${expression},y:0)
const bad: number = pathDistance(path:@L,point1:@P,point2:@L.end)
point Control = coordinate(x:pathDistance(path:@L,point1:@L.start,point2:@L.end),y:0)`);
    expect(scalar("bad")).toMatchObject({status:"error",issueCode:"evaluation-geometry-builtin-unavailable"});
    expect(named("Control")).toMatchObject({x:100});
  }, 30000);

  it("preserves the selected disabled point identity in a collection diagnostic", () => {
    const { scalar, fixture } = run(`line L = segment(start:(0,0),end:(100,0))
point P = coordinate(x:20,y:0,enabled:false)
point Q = coordinate(x:70,y:0)
const points: point[] = [@P,@Q]
const bad: number = pathDistance(path:@L,point1:@points[0],point2:@points[1])`);
    expect(scalar("bad")).toMatchObject({status:"error",issueCode:"evaluation-geometry-builtin-disabled",context:{kind:"geometryBuiltinTarget",targetElementId:fixture.elements.find(e => e.name === "P")!.id}});
  }, 30000);

  // Retained failing acceptance: the read-only scalar boundary cannot currently
  // request lazy mapped geometry materialization from the canonical scheduler.
  it("selects generated typed points through the existing occurrence boundary", () => {
    const { result, named } = run(`line L = segment(start:(0,0),end:(100,0))
const seeds: point[] = [(20,0),(70,0)]
const points: point[] = for p in @seeds {
  offset(from:@p,dx:0,dy:0)
}
const d: number = pathDistance(path:@L,point1:@points[0],point2:@points[1])
point Result = coordinate(x:@d,y:0)`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({x:50});
  }, 30000);

  it("keeps a failed selected point as a dependency error", () => {
    const { scalar } = run(`line L = segment(start:(0,0),end:(100,0))
point P = coordinate(x:1 / 0,y:0)
point Q = coordinate(x:70,y:0)
const points: point[] = [@P,@Q]
const bad: number = pathDistance(path:@L,point1:@points[0],point2:@points[1])`);
    expect(scalar("bad")).toMatchObject({status:"error",issueCode:"evaluation-geometry-builtin-unavailable"});
  }, 30000);

  it.each([-1, 9, .5])("reports invalid dynamic collection selector %s", pick => {
    const { scalar } = run(`line L = segment(start:(0,0),end:(100,0))
const points: point[] = [(20,0),(70,0)]
const pick: number = ${pick}
const bad: number = pathDistance(path:@L,point1:@points[0],point2:@points[@pick])`);
    expect(scalar("bad")).toMatchObject({status:"error",issueCode:"evaluation-collection-index-invalid"});
  }, 30000);

  it("uses the captured prefix when a later move depends on the measurement", () => {
    const { result, named } = run(`line L = segment(start:(0,0),end:(100,0))
const d: number = pathDistance(path:@L,point1:@L.start,point2:@L.end)
point Result = coordinate(x:pathDistance(path:@L,point1:@L.start,point2:@L.end),y:@d)
move @L(from:(0,0),to:(@Result.x,0))`);
    expect(result.errors).toEqual([]);
    expect(named("Result")).toMatchObject({x:100,y:100});
    expect(named("L")).toMatchObject({start:{x:100,y:0},end:{x:200,y:0}});
  }, 30000);

  it("retains dependency-cycle and lexical-scope failures", () => {
    for (const source of [
      `nui 1\nline L = segment(start:(0,0),end:(100,0))\npoint P = coordinate(x:pathDistance(path:@L,point1:@P,point2:@L.end),y:0)`,
      `nui 1\nline L = segment(start:(0,0),end:(100,0))\ngroup G {\n  point P = coordinate(x:20,y:0)\n}\nconst d: number = pathDistance(path:@L,point1:@P,point2:@L.end)`
    ]) {
      const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(),1),source);
      expect(compiled.diagnostics.some(d => d.severity === "error")).toBe(true);
    }
  });

  it.each(["measurements", "errors"])("executes the reusable Human fixture %s", name => {
    const { result, scalar } = run(readFileSync(join(repoRoot,"docs/testing/path-distance",`${name}.nui`),"utf8"));
    expect(result.errors).toEqual([]);
    if (name === "measurements") {
      for (const [binding,value] of [["openDistance",50],["swapped",50],["arcDistance",5*Math.PI],["closedDistance",30],["seamDistance",0]] as const) {
        expect(scalar(binding)).toMatchObject({status:"ok",value:{kind:"number",value:expect.closeTo(value,8)}});
      }
      expect(scalar("curveDistance")).toMatchObject({status:"ok",value:{kind:"number",value:expect.closeTo(71.03548120464426,1)}});
    } else {
      for (const [binding,code] of [["offFirst","off-source-point1"],["offSecond","off-source-point2"],["ambiguous","ambiguous-station-point1"]]) expect(scalar(binding)).toMatchObject({status:"error",issueCode:`evaluation-path-distance-${code}`});
      expect(scalar("healthy")).toMatchObject({status:"ok",value:{kind:"number",value:100}});
    }
  }, 30000);

  it.each([
    "pathDistance(@L,@P,@P)", "pathDistance(path:@L, point1:@P)",
    "pathDistance(path:@L, point1:@P, point1:@P, point2:@P)",
    "pathDistance(path:@L, point1:@P, other:@P)", "pathDistance(path:@P, point1:@P, point2:@P)",
    "pathDistance(path:@L, point1:1, point2:@P)", "pathDistance(@L, point1:@P, point2:@P)",
    "pathDistance(path:@L, point1:@Missing, point2:@P)"
  ])("rejects invalid language input: %s", call => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(),1), `nui 1\nline L = segment(start:(0,0), end:(100,0))\npoint P = coordinate(x:20,y:0)\nconst d: number = ${call}`);
    expect(compiled.status).toBe("fatal");
    expect(compiled.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("offers the builtin and its named arguments through completion", () => {
    for (const [source, labels] of [
      ["nui 1\nconst d: number = pathD", ["pathDistance"]],
      ["nui 1\nconst d: number = pathDistance(", ["path", "point1", "point2"]]
    ] as const) {
      const result = queryDslCompletion({source:{normalizedSource:source,sourceRevision:1},position:source.length});
      expect(result?.candidates.map(c => c.label)).toEqual(expect.arrayContaining(labels));
    }
  });

  it("serves signature help from the same named builtin metadata", () => {
    const source = "nui 1\nconst d: number = pathDistance(point2: ";
    const result = queryDslSignatureHelp({ source:{ normalizedSource:source, sourceRevision:1 }, position:source.length });
    expect(result?.signatures[0]).toMatchObject({ name:"pathDistance", returnType:"number", parameters:[{name:"path",type:"path"},{name:"point1",type:"point"},{name:"point2",type:"point"}] });
    expect(result?.activeParameter).toBe(2);
  });
});
