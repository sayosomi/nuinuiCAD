import { describe, expect, it } from "vitest";
import { fixtureFromSource, optionsFor, evaluateWithRustOptions, normalizeParityPayload } from "./evaluationParitySupport";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (source: string, diagnosticCount = 0) => {
  const fixture = fixtureFromSource(source), options = optionsFor(fixture);
  expect(fixture.compiled!.diagnostics).toHaveLength(diagnosticCount);
  const ts = evaluateElementsReferencePayload(fixture.elements, options);
  if (import.meta.env.VITE_RUN_RUST_PARITY === "1") expect(normalizeParityPayload(evaluateWithRustOptions(root, fixture.elements, options))).toEqual(normalizeParityPayload(ts));
  return { fixture, result: evaluationPayloadToResult(ts) };
};

describe("authored extract declarations", () => {
  it.each(["missing", "Off"])("retains successful Module siblings after isolated boundary %s fails", bound => {
    const { result } = run(`nui 1\nmodule M() {\n  line L = segment(start: (0,0), end: (100,0))\n  point Off = coordinate(x: 40, y: 10)\n  extract E(source: L, parts: [bad: ${bound}..end, good: start..end])\n}\ninstance One = M()\ninstance Two = M()`, bound === "missing" ? 1 : 0);
    const good = [...result.computedGeometry.values()].filter(g => g.kind === "joinedPath");
    expect(good).toHaveLength(2);
    expect(good.map(g => g.length)).toEqual([100,100]);
    expect(result.instanceBaseGeometry?.size ?? 0).toBe(0);
    expect(result.errors).toHaveLength(2);
  });
  it("publishes independent source and part drawables with qualified transforms", () => {
    const { fixture, result } = run(`nui 1
line L = segment(start: (0,0), end: (100,0))
point Cut = coordinate(x: 40, y: 0)
extract E(source: L, parts: [lower: start..Cut, upper: Cut..end])
move E::upper(from: (0,0), to: (0,20))`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find(e => e.name === name)!.id);
    expect(geometry("L")).toMatchObject({ length: 100, start: { x: 0, y: 0 } });
    expect(geometry("lower")).toMatchObject({ length: 40, end: { x: 40, y: 0 } });
    expect(geometry("upper")).toMatchObject({ length: 60, start: { x: 40, y: 20 }, end: { x: 100, y: 20 } });
    expect(fixture.elements.some(e => e.name === "E")).toBe(false);
  });
  it("keeps source and part prefixes captured before later source and part transforms", () => {
    const { fixture, result } = run(`nui 1
line L = segment(start: (0,0), end: (100,0))
move L(from: (0,0), to: (0,10))
const Frozen: path = L
point Left = coordinate(x: 40, y: 10)
point Right = coordinate(x: 70, y: 10)
extract E(source: Frozen, parts: [middle: Left..Right])
const PartPrefix: path = E::middle
move L(from: (0,0), to: (0,30))
reverse E::middle()
path Captured = from(source: PartPrefix)`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find(e => e.name === name)!.id);
    expect(geometry("middle")).toMatchObject({ length: 30, start: { x: 70, y: 10 }, end: { x: 40, y: 10 } });
    expect(geometry("Captured")).toMatchObject({ length: 30, start: { x: 40, y: 10 }, end: { x: 70, y: 10 } });
    expect(geometry("L")).toMatchObject({ start: { x: 0, y: 40 } });
  });
  it("isolates two Module instances with the same extract and part names", () => {
    const { result } = run(`nui 1
module M(source: path, shift: number) {
  point Cut = coordinate(x: 40, y: 0)
  extract E(source: source, parts: [lower: start..Cut, upper: Cut..end])
  move E::upper(from: (0,0), to: (0,shift))
}
line L = segment(start: (0,0), end: (100,0))
instance One = M(source: L, shift: 10)
instance Two = M(source: L, shift: 30)`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const parts = [...result.computedGeometry.values()].filter(g => g.kind === "joinedPath");
    expect(parts).toHaveLength(4);
    expect(new Set(parts.map(g => g.elementId)).size).toBe(4);
    const uppers = parts.filter(g => g.kind === "joinedPath" && g.start?.x === 40);
    expect(uppers.map(g => g.kind === "joinedPath" ? g.start?.y : null).sort((a,b) => a!-b!)).toEqual([10,30]);
  });
  it("creates three isolated for occurrences from one root source", () => {
    const { result } = run(`nui 1
line L = segment(start: (0,0), end: (100,0))
point Cut = coordinate(x: 40, y: 0)
for i in range(min: 0, max: 2, step: 1) {
  extract E(source: L, parts: [lower: start..Cut, upper: Cut..end])
  move E::upper(from: (0,0), to: (0,10*i))
}`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const parts = [...result.computedGeometry.values()].filter(g => g.kind === "joinedPath");
    expect(parts).toHaveLength(6);
    expect(new Set(parts.map(g => g.elementId)).size).toBe(6);
    const uppers = parts.filter(g => g.kind === "joinedPath" && g.start?.x === 40);
    expect(uppers.map(g => g.kind === "joinedPath" ? g.start?.y : null).sort((a,b) => a!-b!)).toEqual([0,10,20]);
  });
  it("does not publish inactive or disabled parts or alter the source", () => {
    const { fixture, result } = run(`nui 1
line L = segment(start: (0,0), end: (100,0))
extract Off(source: L, enabled: false, parts: [whole: start..end])
if (false) {
  extract Inactive(source: L, parts: [whole: start..end])
}`);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter(g => g.kind === "joinedPath")).toHaveLength(0);
    expect(result.computedGeometry.get(fixture.elements.find(e => e.name === "L")!.id)).toMatchObject({ length:100 });
  });

  it("retains a precise invalid-boundary diagnostic while publishing healthy siblings", () => {
    const { fixture, result } = run(`nui 1
line L = segment(start: (0,0), end: (100,0))
point Cut = coordinate(x: 40, y: 0)
extract E(source: L, parts: [lower: start..Cut, upper: missing..end])`, 1);
    expect(fixture.compiled!.diagnostics[0].isolatedExtractPart?.boundary).toBe("left");
    const lower = fixture.elements.find(e => e.name === "lower")!, upper = fixture.elements.find(e => e.name === "upper")!;
    expect(result.computedGeometry.get(lower.id)).toMatchObject({ length: 40 });
    expect(result.computedGeometry.has(upper.id)).toBe(false);
    expect(result.errors.some(error => error.elementId === upper.id)).toBe(true);
  });

  it("binds an outer-loop source to nested extract occurrences without matching occurrence paths", () => {
    const { result } = run(`nui 1
for outer in range(min: 0, max: 1, step: 1) {
  line L = segment(start: (0,0), end: (100 + 10 * outer,0))
  point Cut = coordinate(x: 40, y: 0)
  for inner in range(min: 0, max: 2, step: 1) {
    extract E(source: L, parts: [upper: Cut..end])
    move E::upper(from: (0,0), to: (0,20 * outer + 5 * inner))
  }
}`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const parts = [...result.computedGeometry.values()].filter(g => g.kind === "joinedPath");
    expect(parts).toHaveLength(6);
    expect(parts.map(g => g.length).sort()).toEqual([60,60,60,70,70,70]);
    expect(parts.map(g => g.kind === "joinedPath" ? g.start?.y : null).sort((a,b) => a!-b!)).toEqual([0,5,10,20,25,30]);
  });

});

// Cubic controls (0,0), (0,10), (10,10), (10,0) give B(1/2)=(5,7.5),
// B'(1/2)=(15,0), B''(1/2)=(0,-60): concave is down, convex is up.
const curveSideSource = `curve C = bezier(start: (0,0), startAngle: 90, startLength: 10, end: (10,0), endAngle: 270, endLength: 10)`;

describe("curveSide on authored Bezier extracts", () => {
  it.each([
    ["forward", "Left..Right", ""],
    ["reverse extraction", "Right..Left", ""],
    ["reversed traversal", "Left..Right", "reverse E::part()"],
    ["reverse extraction and traversal", "Right..Left", "reverse E::part()"]
  ])("preserves physical normals for %s in drawable and pure points", (_label, interval, transform) => {
    const { fixture, result } = run(`nui 1
${curveSideSource}
point Left = coordinate(x: 1.5625, y: 5.625)
point Right = coordinate(x: 8.4375, y: 5.625)
extract E(source: C, parts: [part: ${interval}])
${transform}
point Convex = tangentOffset(line: E::part, base: (5,7.5), curveSide: @convex, distance: 1)
point Concave = tangentOffset(line: E::part, base: (5,7.5), curveSide: @concave, distance: 1)
const Pure: point = tangentOffset(line: E::part, base: (5,7.5), curveSide: @concave, distance: 1)
point PureResult = from(source: Pure)
point Zero = tangentOffset(line: E::part, base: (5,7.5), curveSide: @convex, distance: 0)`);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find(e => e.name === name)!.id);
    const part = geometry("part");
    expect(part).toMatchObject({ kind: "joinedPath", segments: [{ kind: "bezier" }] });
    for (const [name, y] of [["Convex", 8.5], ["Concave", 6.5], ["PureResult", 6.5], ["Zero", 7.5]] as const) {
      const g = geometry(name);
      if (g?.kind !== "point") throw new Error(`missing ${name}`);
      expect(g.x).toBeCloseTo(5, 8);
      expect(g.y).toBeCloseTo(y, 8);
    }
    const purePoints = [...(result.computedGeometryValues?.values() ?? [])].filter(entry => entry.value.kind === "point");
    expect(purePoints).toHaveLength(1);
    expect(purePoints[0].value).toMatchObject({ x: expect.closeTo(5, 8), y: expect.closeTo(6.5, 8) });
    expect(purePoints[0].value).not.toHaveProperty("elementId");
    // The production compiler resolves the qualified part reference, rather
    // than the test replacing its geometry input or authored declaration type.
    const convex = fixture.elements.find(e => e.name === "Convex")!;
    expect(optionsFor(fixture).geometryInputTargetsByElementId?.get(convex.id)?.get("baseLineId")).toMatchObject({ kind: "drawable", elementId: part!.elementId });
  });

  it.each([false, true])("accepts multi-segment extracts at endpoints, smooth joins and interiors (reverse=%s)", reverse => {
    const { fixture, result } = run(`nui 1
curve C = bezier(start: (0,0), startAngle: 90, startLength: 5, intermediates: [knot(point: (5,7.5), angle: 0, incoming: 2.5, outgoing: 2.5)], end: (10,0), endAngle: 270, endLength: 5)
extract E(source: C, parts: [part: ${reverse ? "end..start" : "start..end"}])
point Join = tangentOffset(line: E::part, base: (5,7.5), curveSide: @concave, distance: 1)
const Start: point = tangentOffset(line: E::part, base: (0,0), curveSide: @convex, distance: 1)
point StartResult = from(source: Start)
point End = tangentOffset(line: E::part, base: (10,0), curveSide: @concave, distance: 1)
point Interior = tangentOffset(line: E::part, base: (1.5625,5.625), curveSide: @convex, distance: 1)`);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find(e => e.name === name)!.id);
    const part = geometry("part");
    if (part?.kind !== "joinedPath") throw new Error("missing extracted path");
    expect(part.segments.map(s => s.kind)).toEqual(["bezier", "bezier"]);
    expect(geometry("Join")).toMatchObject({ kind: "point", x: 5, y: 6.5 });
    expect(geometry("StartResult")).toMatchObject({ kind: "point", x: expect.closeTo(-1, 8), y: expect.closeTo(0, 8) });
    const end = geometry("End");
    if (end?.kind !== "point") throw new Error("missing endpoint");
    expect(end.x).toBeCloseTo(9, 8); expect(end.y).toBeCloseTo(0, 8);
    // At the first cubic midpoint B'=(5.625,7.5), hence the
    // outward unit normal is (-0.8,0.6), independently of traversal.
    expect(geometry("Interior")).toMatchObject({ x: expect.closeTo(0.7625, 8), y: expect.closeTo(6.225, 8) });
  });

  it.each([
    ["off-curve", curveSideSource, "(5,8)", "convex", 1, "曲線上にありません"],
    ["off-curve zero", curveSideSource, "(5,8)", "convex", 0, "曲線上にありません"],
    ["outside tolerance", curveSideSource, "(5,7.5011)", "convex", 0, "曲線上にありません"],
    ["negative", curveSideSource, "(5,7.5)", "concave", -1, "0以上"],
    ["zero tangent", "curve C = bezier(start: (0,0), startAngle: 90, startLength: 0, end: (10,0), endAngle: 270, endLength: 10)", "(0,0)", "convex", 0, "接線または曲率"],
    ["zero curvature", "curve C = bezier(start: (0,0), startAngle: 0, startLength: 3, end: (10,0), endAngle: 180, endLength: 3)", "(5,0)", "convex", 0, "接線または曲率"],
    ["near-flat curvature", "curve C = bezier(start: (0,0), startAngle: 90, startLength: 0.0000000001, end: (10,0), endAngle: 270, endLength: 0.0000000001)", "(5,0)", "convex", 0, "接線または曲率"],
    ["ambiguous join", "curve C = bezier(start: (0,0), startAngle: 90, startLength: 10, intermediates: [knot(point: (10,0), angle: 90, incoming: 5, outgoing: 5)], end: (20,0), endAngle: 270, endLength: 10)", "(10,0)", "convex", 0, "曖昧な内部 join"],
    ["corner", "const A: path = bezier(start: (0,0), startAngle: 90, startLength: 10, end: (10,0), endAngle: 270, endLength: 10)\nconst B: path = bezier(start: (10,0), startAngle: 0, startLength: 10, end: (20,10), endAngle: 180, endLength: 10)\nconst C: path = join(paths: [A,B], closed: false)", "(10,0)", "convex", 0, "曖昧な内部 join"],
    ["mixed line", "const A: path = bezier(start: (0,0), startAngle: 90, startLength: 10, end: (10,0), endAngle: 270, endLength: 10)\nconst B: path = segment(start: (10,0), end: (20,0))\nconst C: path = join(paths: [A,B], closed: false)", "(5,7.5)", "convex", 1, "ベジェ曲線"],
    ["mixed arc", "const A: path = bezier(start: (0,0), startAngle: 90, startLength: 10, end: (10,0), endAngle: 270, endLength: 10)\nconst B: path = arc(center: (20,0), radius: 10, start: 180, end: 90, direction: @clockwise)\nconst C: path = join(paths: [A,B], closed: false)", "(5,7.5)", "concave", 1, "ベジェ曲線"]
  ])("reports %s through the drawable and pure diagnostic channels", (_label, source, base, side, distance, message) => {
    const { fixture, result } = run(`nui 1
${source}
extract E(source: C, parts: [part: start..end])
point Bad = tangentOffset(line: E::part, base: ${base}, curveSide: @${side}, distance: ${distance})
const BadPure: point = tangentOffset(line: E::part, base: ${base}, curveSide: @${side}, distance: ${distance})`);
    const bad = fixture.elements.find(e => e.name === "Bad")!;
    expect(result.computedGeometry.has(bad.id)).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].elementId).toBe(bad.id);
    expect(result.errors[0].message).toContain(message);
    expect(result.geometryValueErrors).toHaveLength(1);
    expect(result.geometryValueErrors![0].message).toContain(message);
  });

  it("accepts bases within 0.001 mm even at distance zero", () => {
    const { result } = run(`nui 1
${curveSideSource}
extract E(source: C, parts: [part: start..end])
point Near = tangentOffset(line: E::part, base: (5,7.5009), curveSide: @convex, distance: 0)
const NearPure: point = tangentOffset(line: E::part, base: (5,7.5009), curveSide: @concave, distance: 0)`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
  });
});

describe("unsupported curveSide evaluated geometry controls", () => {
  it.each([
    ["line", "line Unsupported = segment(start: (0,0), end: (10,0))", "line"],
    ["arc", "arc Unsupported = arc(center: (0,0), radius: 10, start: 0, end: 90, direction: @counterclockwise)", "arcLine"],
    ["polyline", "line Unsupported = polyline(points: [(0,0),(10,0)], closed: false)", "polyline"],
    ["cubic offsetLine", `${curveSideSource}\nline Unsupported = offset(sources: [C], distance: 1, side: @left, closed: false)`, "offsetLine"]
  ])("rejects %s in drawable and pure paths", (_label, source, kind) => {
    const { fixture, result } = run(`nui 1
${source}
point Bad = tangentOffset(line: Unsupported, base: Unsupported.start, curveSide: @convex, distance: 0)
const BadPure: point = tangentOffset(line: Unsupported, base: Unsupported.start, curveSide: @convex, distance: 0)`);
    const unsupported = result.computedGeometry.get(fixture.elements.find(e => e.name === "Unsupported")!.id);
    expect(unsupported?.kind).toBe(kind);
    if (unsupported?.kind === "offsetLine") {
      expect(unsupported.segments.length).toBeGreaterThan(0);
      expect(unsupported.segments.some(s => s.kind === "bezier")).toBe(true);
    }
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("ベジェ曲線");
    expect(result.geometryValueErrors).toHaveLength(1);
    expect(result.geometryValueErrors![0].message).toContain("ベジェ曲線");
  });
});
