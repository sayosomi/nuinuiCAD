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
  it.each(["@missing", "@Off"])("retains successful Module siblings after isolated boundary %s fails", bound => {
    const { result } = run(`nui 1\nmodule M() {\n  line L = segment(start: (0,0), end: (100,0))\n  point Off = coordinate(x: 40, y: 10)\n  extract E(source: @L, parts: [bad: ${bound}..end, good: start..end])\n}\ninstance One = M()\ninstance Two = M()`, bound === "@missing" ? 1 : 0);
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
extract E(source: @L, parts: [lower: start..@Cut, upper: @Cut..end])
move @E::upper(from: (0,0), to: (0,20))`);
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
move @L(from: (0,0), to: (0,10))
const Frozen: path = @L
point Left = coordinate(x: 40, y: 10)
point Right = coordinate(x: 70, y: 10)
extract E(source: @Frozen, parts: [middle: @Left..@Right])
const PartPrefix: path = @E::middle
move @L(from: (0,0), to: (0,30))
reverse @E::middle()
path Captured = from(source: @PartPrefix)`);
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
  extract E(source: @source, parts: [lower: start..@Cut, upper: @Cut..end])
  move @E::upper(from: (0,0), to: (0,@shift))
}
line L = segment(start: (0,0), end: (100,0))
instance One = M(source: @L, shift: 10)
instance Two = M(source: @L, shift: 30)`);
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
  extract E(source: @L, parts: [lower: start..@Cut, upper: @Cut..end])
  move @E::upper(from: (0,0), to: (0,10*@i))
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
extract Off(source: @L, enabled: false, parts: [whole: start..end])
if (false) {
  extract Inactive(source: @L, parts: [whole: start..end])
}`);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter(g => g.kind === "joinedPath")).toHaveLength(0);
    expect(result.computedGeometry.get(fixture.elements.find(e => e.name === "L")!.id)).toMatchObject({ length:100 });
  });

  it("retains a precise invalid-boundary diagnostic while publishing healthy siblings", () => {
    const { fixture, result } = run(`nui 1
line L = segment(start: (0,0), end: (100,0))
point Cut = coordinate(x: 40, y: 0)
extract E(source: @L, parts: [lower: start..@Cut, upper: @missing..end])`, 1);
    expect(fixture.compiled!.diagnostics[0].isolatedExtractPart?.boundary).toBe("left");
    const lower = fixture.elements.find(e => e.name === "lower")!, upper = fixture.elements.find(e => e.name === "upper")!;
    expect(result.computedGeometry.get(lower.id)).toMatchObject({ length: 40 });
    expect(result.computedGeometry.has(upper.id)).toBe(false);
    expect(result.errors.some(error => error.elementId === upper.id)).toBe(true);
  });

  it("binds an outer-loop source to nested extract occurrences without matching occurrence paths", () => {
    const { result } = run(`nui 1
for outer in range(min: 0, max: 1, step: 1) {
  line L = segment(start: (0,0), end: (100 + 10 * @outer,0))
  point Cut = coordinate(x: 40, y: 0)
  for inner in range(min: 0, max: 2, step: 1) {
    extract E(source: @L, parts: [upper: @Cut..end])
    move @E::upper(from: (0,0), to: (0,20 * @outer + 5 * @inner))
  }
}`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const parts = [...result.computedGeometry.values()].filter(g => g.kind === "joinedPath");
    expect(parts).toHaveLength(6);
    expect(parts.map(g => g.length).sort()).toEqual([60,60,60,70,70,70]);
    expect(parts.map(g => g.kind === "joinedPath" ? g.start?.y : null).sort((a,b) => a!-b!)).toEqual([0,5,10,20,25,30]);
  });

});
