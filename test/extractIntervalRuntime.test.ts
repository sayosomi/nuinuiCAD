import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTypedDependencyGraph, geometryValueOccurrenceKey, type GeometryValueProgramEntry, type GeometryValueProgramPoint, type GeometryValueProgramTarget } from "@nuinuicad/nui-language";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateWithRustOptions, fixtureFromSource, normalizeParityPayload, optionsFor } from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const parity = import.meta.env.VITE_RUN_RUST_PARITY === "1";
const targetFor = (entry: GeometryValueProgramEntry, geometryType: "point" | "path"): GeometryValueProgramTarget => ({
  kind: "geometryValue", occurrence: entry.occurrence, statementId: entry.sourceStatementId, statementIndex: entry.sourceStatementIndex, geometryType
});

/** Replace only compiler-produced value leaves to exercise the new internal
 * lowering before the extract declaration syntax is connected. All document,
 * dependency, materialization and Rust transport behavior remains production. */
const run = (sourceExpression: string, a: [number, number], b: [number, number], extra = "", preamble = "") => {
  const fixture = fixtureFromSource(`nui 1
${preamble}
const Source: path = ${sourceExpression}
const Left: point = coordinate(x: ${a[0]}, y: ${a[1]})
const Right: point = coordinate(x: ${b[0]}, y: ${b[1]})
const Interval: path = join(paths: [@Source], closed: false)
path Part = from(source: @Interval)
path Original = from(source: @Source)
${extra}`);
  const doc = fixture.compiled!.doc;
  const original = doc.geometryValueProgram!;
  const entryFor = (name: string) => {
    const entry = original.find(entry => doc.statements[entry.sourceStatementIndex]?.name === name);
    if (!entry) throw new Error(`missing ${name} entry`);
    return entry;
  };
  const interval = { ...entryFor("Interval"), construction: {
    kind: "extractInterval" as const,
    source: { kind: "target" as const, target: targetFor(entryFor("Source"), "path") },
    left: { kind: "target" as const, target: targetFor(entryFor("Left"), "point") },
    right: { kind: "target" as const, target: targetFor(entryFor("Right"), "point") }
  } };
  const program = original.map(entry => entry.sourceStatementId === interval.sourceStatementId ? interval : entry);
  return { ...evaluateProgram(fixture, program), interval };
};

const evaluateProgram = (fixture: ReturnType<typeof fixtureFromSource>, program: GeometryValueProgramEntry[]) => {
  const doc = fixture.compiled!.doc;
  const initial = optionsFor(fixture);
  const graph = buildTypedDependencyGraph({
    ...doc, elements: fixture.elements,
    elementIdByStatementIndex: doc.statementMap!.elementIdByStatementIndex,
    statementIdByStatementIndex: doc.statementMap!.statementIdByStatementIndex,
    geometryInputTargets: initial.geometryInputTargetsByElementId,
    geometryValueProgram: program
  });
  expect(graph.cycles).toEqual([]);
  const options = { ...initial, geometryValueProgram: program, typedDependencyGraph: graph, evaluationOrder: graph.evaluationOrder, transformationDependencyPlans: graph.transformationPlans };
  const payload = evaluateElementsReferencePayload(fixture.elements, options);
  if (parity) expect(normalizeParityPayload(evaluateWithRustOptions(repoRoot, fixture.elements, options))).toEqual(normalizeParityPayload(payload));
  const result = evaluationPayloadToResult(payload);
  const named = (name: string) => result.computedGeometry.get(fixture.elements.find(e => e.name === name)!.id);
  return { fixture, program, graph, payload, result, named, options };
};

describe("internal extract interval production runtime lowering", () => {
  it.each([[40, 70], [70, 40]])("materializes an independent line interval %s→%s and retains the original", (a, b) => {
    const { result, named, graph, program } = run("segment(start: (0, 0), end: (100, 0))", [a, 0], [b, 0]);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const part = named("Part"), original = named("Original");
    expect(part).toMatchObject({ kind: "joinedPath", start: { x: a, y: 0 }, end: { x: b, y: 0 }, length: 30 });
    expect(original).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, length: 100 });
    expect(part!.elementId).not.toBe(original!.elementId);
    expect(result.computedGeometryValues?.get(geometryValueOccurrenceKey(program[3]!.occurrence))?.value).toMatchObject({
      extractionStations: { left: { segmentIndex: 0, t: a / 100 }, right: { segmentIndex: 0, t: b / 100 } }
    });
    const id = `geometry-value:${geometryValueOccurrenceKey(program[3]!.occurrence)}`;
    const dependencies = graph.directByEndpointId.get(id)!;
    for (const prerequisite of program.slice(0, 3)) expect(dependencies.some(edge => edge.to.id === geometryValueOccurrenceKey(prerequisite.occurrence))).toBe(true);
  }, 30000);
  it("preserves the independent subcubic controls through Rust transport and materialization", () => {
    const { result, named } = run("bezier(start: (0, 0), startAngle: 90, startLength: 40, end: (100, 0), endAngle: 270, endLength: 40)", [15.625, 22.5], [84.375, 22.5]);
    expect(result.geometryValueErrors).toEqual([]);
    const g = named("Part"); if (g?.kind !== "joinedPath") throw new Error("part unavailable");
    const s = g.segments[0]; if (s.kind !== "bezier") throw new Error("cubic lost");
    for (const [key, x, y] of [["start", 15.625, 22.5], ["control1", 34.375, 32.5], ["control2", 65.625, 32.5], ["end", 84.375, 22.5]] as const) {
      expect(s[key].x).toBeCloseTo(x, 9); expect(s[key].y).toBeCloseTo(y, 9);
    }
  }, 30000);
  it("retains structured boundary diagnostics and never publishes a failed interval as geometry", () => {
    const { result, named } = run("segment(start: (0, 0), end: (100, 0))", [40, 5], [70, 0]);
    expect(named("Part")).toBeUndefined();
    expect(named("Original")).toMatchObject({ length: 100 });
    expect(result.geometryValueErrors).toMatchObject([{ extract: { code: "off-source", boundary: "left" } }]);
  }, 30000);
  it("keeps later transforms of the materialized part independent from the source", () => {
    const { result, named } = run("segment(start: (0, 0), end: (100, 0))", [40, 0], [70, 0], "move @Part(from: (0, 0), to: (0, 20))");
    expect(result.errors).toEqual([]);
    expect(named("Original")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    expect(named("Part")).toMatchObject({ start: { x: 40, y: 20 }, end: { x: 70, y: 20 } });
  }, 30000);
  it("accepts explicit traversal endpoint sentinels and reports a missing station target", () => {
    const first = run("segment(start: (0, 0), end: (100, 0))", [40, 0], [70, 0]);
    const replace = (left: "start" | "end" | GeometryValueProgramPoint, right: "start" | "end" | GeometryValueProgramPoint) => {
      const entry = first.program[3]!;
      if (entry.construction.kind !== "extractInterval") throw new Error("extract node unavailable");
      const program = [...first.program.slice(0, 3), { ...entry, construction: { ...entry.construction, left, right } }];
      const options = { ...first.options, geometryValueProgram: program };
      const payload = evaluateElementsReferencePayload(first.fixture.elements, options);
      if (parity) expect(normalizeParityPayload(evaluateWithRustOptions(repoRoot, first.fixture.elements, options))).toEqual(normalizeParityPayload(payload));
      return evaluationPayloadToResult(payload);
    };
    const whole = replace("end", "start");
    expect(whole.geometryValueErrors).toEqual([]);
    expect(whole.computedGeometryValues?.get(geometryValueOccurrenceKey(first.program[3]!.occurrence))?.value).toMatchObject({ length: 100, start: { x: 100, y: 0 } });
    const missing = replace({ kind: "target", target: { kind: "drawable", statementId: "missing", statementIndex: 20, geometryType: "point" } }, "end");
    expect(missing.geometryValueErrors).toMatchObject([{ extract: { code: "unavailable-boundary", boundary: "left" } }]);
  }, 30000);
  it("uses an authored drawable prefix captured before a later source move", () => {
    const { result, named } = run("@Live", [40, 10], [70, 10], "move @Live(from: (0, 0), to: (0, 40))", `line Live = segment(start: (0, 0), end: (100, 0))
move @Live(from: (0, 0), to: (0, 10))`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    expect(named("Live")).toMatchObject({ start: { x: 0, y: 50 } });
    expect(named("Original")).toMatchObject({ start: { x: 0, y: 10 }, end: { x: 100, y: 10 } });
    expect(named("Part")).toMatchObject({ start: { x: 40, y: 10 }, end: { x: 70, y: 10 }, length: 30 });
  }, 30000);
  it("matches the analytic signed arc interval and retains its circular representation", () => {
    const { result, named } = run("arc(center: (0, 0), radius: 100, start: 0, end: 180, direction: counterclockwise)", [50 * Math.sqrt(3), 50], [-50, 50 * Math.sqrt(3)]);
    expect(result.geometryValueErrors).toEqual([]);
    const part = named("Part"); if (part?.kind !== "joinedPath") throw new Error("missing arc interval");
    expect(part.length).toBeCloseTo(50 * Math.PI, 10);
    expect(part.segments[0]).toMatchObject({ kind: "arc", radius: 100 });
    if (part.segments[0].kind !== "arc") throw new Error("arc lost");
    expect(part.segments[0].startAngleDeg).toBeCloseTo(30, 10);
    expect(part.segments[0].sweepAngleDeg).toBeCloseTo(90, 10);
  }, 30000);
  it("evaluates joined-path intervals over the canonical multi-value dependency graph", () => {
    const { result, named } = run("join(paths: [@First, @Second], closed: false)", [40, 0], [100, 70], "", `const First: path = segment(start: (0, 0), end: (100, 0))
const Second: path = segment(start: (100, 0), end: (100, 100))`);
    expect(result.errors).toEqual([]); expect(result.geometryValueErrors).toEqual([]);
    const part = named("Part"); if (part?.kind !== "joinedPath") throw new Error("missing joined interval");
    expect(part.segments).toHaveLength(2); expect(part.length).toBeCloseTo(130, 10);
  }, 30000);

  it("isolates a bad sibling and keeps identical intervals as distinct materialized owners", () => {
    const base = run("segment(start: (0, 0), end: (100, 0))", [40, 0], [70, 0], `const Outside: point = coordinate(x: 50, y: 10)
const Equal: path = join(paths: [@Source], closed: false)
const Bad: path = join(paths: [@Source], closed: false)
path EqualPart = from(source: @Equal)
path BadPart = from(source: @Bad)`);
    const outside = base.program.find(entry => base.fixture.compiled!.doc.statements[entry.sourceStatementIndex]?.name === "Outside")!;
    const program = base.program.map(entry => {
      const name = base.fixture.compiled!.doc.statements[entry.sourceStatementIndex]?.name;
      if (name === "Equal") return { ...entry, construction: base.interval.construction };
      if (name === "Bad") return { ...entry, construction: { ...base.interval.construction, right: { kind: "target" as const, target: targetFor(outside, "point") } } };
      return entry;
    });
    const { result, named } = evaluateProgram(base.fixture, program);
    expect(named("BadPart")).toBeUndefined();
    expect(named("Part")).toMatchObject({ length: 30 });
    expect(named("EqualPart")).toMatchObject({ length: 30 });
    expect(named("Part")!.elementId).not.toBe(named("EqualPart")!.elementId);
    expect(named("Original")).toMatchObject({ length: 100 });
    expect(result.geometryValueErrors).toHaveLength(1);
    expect(result.geometryValueErrors![0].extract).toEqual({ code: "off-source", boundary: "right" });
  }, 30000);

});
