import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  geometryValueOccurrenceKey,
  type GeometryValueOccurrence
} from "@nuinuicad/nui-language";
import {
  evaluationPayloadToResult,
  type EvaluationPayload
} from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  optionsFor,
  type EvaluationFixture
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let rustStdio: ReturnType<typeof createRustStdioParityClient>;

const geometryValueProgramFor = (fixture: EvaluationFixture) => {
  if (!fixture.compiled) throw new Error("fixture has no compiled document");
  expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const program = fixture.compiled.doc.geometryValueProgram;
  if (!program) throw new Error("fixture has no compiler-authored geometry value program");
  return program;
};

const rawEntryForOccurrence = (
  payload: EvaluationPayload,
  occurrence: GeometryValueOccurrence
) => {
  const key = geometryValueOccurrenceKey(occurrence);
  const entry = payload.computedGeometryValues?.find((candidate) =>
    geometryValueOccurrenceKey(candidate.occurrence) === key
  );
  if (!entry) throw new Error(`Rust payload omitted compiler-authored occurrence ${key}`);
  return entry;
};

const evaluateRust = (fixture: EvaluationFixture) =>
  rustStdio.evaluate(fixture.elements, optionsFor(fixture));

const geometryInputTargetsFor = (
  fixture: EvaluationFixture,
  request: ReturnType<typeof buildRustEvaluationInput>,
  elementName: string,
  parameterKey: string
) => {
  const element = fixture.elements.find((candidate) => candidate.name === elementName);
  if (!element) throw new Error(`fixture has no element ${elementName}`);
  const parameter = request.geometryInputTargets
    ?.find((entry) => entry.elementId === element.id)
    ?.parameters.find((entry) => entry.parameterKey === parameterKey);
  if (!parameter) throw new Error(`${elementName} request omitted ${parameterKey}`);
  return Array.isArray(parameter.target) ? parameter.target : [parameter.target];
};

const mappedMemberIndicesFor = (
  fixture: EvaluationFixture,
  request: ReturnType<typeof buildRustEvaluationInput>,
  elementName: string,
  parameterKey: string
) => geometryInputTargetsFor(fixture, request, elementName, parameterKey).map((target) => {
  if (target.kind !== "geometryValueMap" && target.kind !== "geometryValue") {
    throw new Error(`${elementName}.${parameterKey} contained a non-value target`);
  }
  return target.occurrence.mappedMemberIndex;
});

const geometryFor = (fixture: EvaluationFixture, payload: EvaluationPayload, elementName: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === elementName);
  if (!element) throw new Error(`fixture has no element ${elementName}`);
  return evaluationPayloadToResult(payload).computedGeometry.get(element.id);
};

describe("Rust mapped geometry occurrence identity", () => {
  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  });

  afterAll(() => {
    rustStdio?.dispose();
  });

  it("preserves root mapped point occurrences through persistent evaluation_stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for item in @points { coordinate(x: @item.x + 10, y: @item.y) }",
      "line Selected = segment(start: @mapped[0], end: @mapped[1])"
    ].join("\n"));
    const expected = geometryValueProgramFor(fixture)
      .filter((entry) => entry.occurrence.mappedMemberIndex !== undefined)
      .sort((left, right) => left.occurrence.mappedMemberIndex! - right.occurrence.mappedMemberIndex!);

    expect(expected.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1]);

    const payload = await evaluateRust(fixture);
    const rawEntries = expected.map((entry) => rawEntryForOccurrence(payload, entry.occurrence));

    expect(rawEntries.map((entry) => entry.occurrence)).toEqual(expected.map((entry) => entry.occurrence));
    expect(rawEntries.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1]);

    const result = evaluationPayloadToResult(payload);
    expect(result.computedGeometryValues.size).toBe(2);
    for (const [entry, point] of expected.map((entry, index) => [entry, [[11, 2], [13, 4]][index]!] as const)) {
      const key = geometryValueOccurrenceKey(entry.occurrence);
      const decoded = result.computedGeometryValues.get(key);
      expect(decoded?.occurrence).toEqual(entry.occurrence);
      expect(decoded?.value).toMatchObject({ kind: "point", x: point[0], y: point[1] });
    }
  }, 30_000);

  it("preserves every mapped offset source in order through persistent evaluation_stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (10, 0), end: (20, 0))",
      "const lines: line[] = [@A, @B]",
      "const mapped: path[] = for item in @lines { @item }",
      "line Combined = offset(sources: [@mapped[0], @mapped[1]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "line FirstOnly = offset(sources: [@mapped[0]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "line SecondOnly = offset(sources: [@mapped[1]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const options = optionsFor(fixture);
    const request = buildRustEvaluationInput(fixture.elements, options);
    const expected = request.geometryValueProgram?.filter((entry) => entry.occurrence.mappedMemberIndex !== undefined) ?? [];

    expect(expected.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1]);
    expect(mappedMemberIndicesFor(fixture, request, "Combined", "baseLineIds")).toEqual([0, 1]);
    expect(mappedMemberIndicesFor(fixture, request, "FirstOnly", "baseLineIds")).toEqual([0]);
    expect(mappedMemberIndicesFor(fixture, request, "SecondOnly", "baseLineIds")).toEqual([1]);

    const payload = await rustStdio.evaluate(fixture.elements, options);
    const rawEntries = expected.map((entry) => rawEntryForOccurrence(payload, entry.occurrence));
    expect(rawEntries.map((entry) => entry.occurrence)).toEqual(expected.map((entry) => entry.occurrence));

    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    for (const entry of expected) {
      expect(result.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))?.occurrence)
        .toEqual(entry.occurrence);
    }
    const combined = geometryFor(fixture, payload, "Combined");
    expect(combined).toMatchObject({ kind: "offsetLine", length: 20 });
    if (combined?.kind !== "offsetLine") throw new Error("expected the complete offset path");
    expect(combined.segments).toHaveLength(2);
    expect(combined.segments[0]?.start).toMatchObject({ x: 0, y: 1 });
    expect(combined.segments[0]?.end).toMatchObject({ x: 10, y: 1 });
    expect(combined.segments[1]?.start).toMatchObject({ x: 10, y: 1 });
    expect(combined.segments[1]?.end).toMatchObject({ x: 20, y: 1 });
  }, 30_000);

  it("preserves indexed line targets and reversed mapped path order through Rust", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (10, 0), end: (20, 0))",
      "const lines: line[] = [@A, @B]",
      "line Indexed = offset(sources: [@lines[0], @lines[1]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "line Square = polyline(points: [(0, 0), (10, 0), (10, 10), (0, 10)], closed: true)",
      "line Triangle = polyline(points: [(0, 0), (4, 0), (0, 4)], closed: true)",
      "const loops: path[] = [@Square, @Triangle]",
      "const mapped: path[] = for item in @loops { @item }",
      "line CopiedForward = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@mapped[0], @mapped[1]])",
      "line CopiedReverse = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@mapped[1], @mapped[0]])"
    ].join("\n"));
    const options = optionsFor(fixture);
    const request = buildRustEvaluationInput(fixture.elements, options);
    const indexedTargets = geometryInputTargetsFor(fixture, request, "Indexed", "baseLineIds");
    const a = fixture.elements.find((element) => element.name === "A");
    const b = fixture.elements.find((element) => element.name === "B");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(indexedTargets.map((target) => target.kind === "drawable" ? target.elementId : undefined))
      .toEqual([a!.id, b!.id]);
    const forwardTargets = geometryInputTargetsFor(fixture, request, "CopiedForward", "baseLineIds");
    const reverseTargets = geometryInputTargetsFor(fixture, request, "CopiedReverse", "baseLineIds");
    expect(forwardTargets).toHaveLength(2);
    expect(reverseTargets).toHaveLength(2);
    expect(reverseTargets).toEqual([...forwardTargets].reverse());
    expect(mappedMemberIndicesFor(fixture, request, "CopiedForward", "baseLineIds")).toEqual([0, 1]);
    expect(mappedMemberIndicesFor(fixture, request, "CopiedReverse", "baseLineIds")).toEqual([1, 0]);
    const expected = request.geometryValueProgram?.filter((entry) => entry.occurrence.mappedMemberIndex !== undefined) ?? [];
    expect(expected.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1]);

    const payload = await rustStdio.evaluate(fixture.elements, options);
    const rawEntries = expected.map((entry) => rawEntryForOccurrence(payload, entry.occurrence));
    expect(rawEntries.map((entry) => entry.occurrence)).toEqual(expected.map((entry) => entry.occurrence));
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues.size).toBe(2);
    expect(geometryFor(fixture, payload, "Indexed")).toMatchObject({ kind: "offsetLine", length: 20 });
    const forward = geometryFor(fixture, payload, "CopiedForward");
    expect(forward).toMatchObject({ kind: "offsetLine" });
    if (forward?.kind !== "offsetLine") throw new Error("expected the forward copied path");
    expect(forward.segments).toHaveLength(7);
    expect(forward.segments[0]).toMatchObject({ start: { x: 10, y: 0 }, end: { x: 20, y: 0 } });
    const copied = geometryFor(fixture, payload, "CopiedReverse");
    expect(copied).toMatchObject({ kind: "offsetLine" });
    if (copied?.kind !== "offsetLine") throw new Error("expected the reversed copied path");
    expect(copied.segments).toHaveLength(7);
    expect(copied.segments[0]).toMatchObject({ start: { x: 10, y: 0 }, end: { x: 14, y: 0 } });
  }, 30_000);

  it("keeps equal duplicate paths as two construction-list entries", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Loop = polyline(points: [(0, 0), (10, 0), (10, 10), (0, 10)], closed: true)",
      "const loops: path[] = [@Loop]",
      "const mapped: path[] = for item in @loops { @item }",
      "line Duplicated = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@mapped[0], @mapped[0]])"
    ].join("\n"));
    const options = optionsFor(fixture);
    const request = buildRustEvaluationInput(fixture.elements, options);
    const loop = fixture.elements.find((element) => element.name === "Loop");
    expect(loop).toBeDefined();
    const targets = geometryInputTargetsFor(fixture, request, "Duplicated", "baseLineIds");
    expect(targets.map((target) => {
      if (target.kind !== "geometryValueMap" && target.kind !== "geometryValue") {
        throw new Error("expected mapped duplicate path entries");
      }
      return target.occurrence.mappedMemberIndex;
    })).toEqual([0, 0]);

    const payload = await rustStdio.evaluate(fixture.elements, options);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    const duplicated = geometryFor(fixture, payload, "Duplicated");
    expect(duplicated).toMatchObject({ kind: "offsetLine" });
    if (duplicated?.kind !== "offsetLine") throw new Error("expected the duplicate copied path");
    expect(duplicated.segments).toHaveLength(8);
  }, 30_000);

  it("omits mappedMemberIndex for an ordinary immutable point occurrence", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const pointValue: point = coordinate(x: 7, y: 9)"
    ].join("\n"));
    const program = geometryValueProgramFor(fixture);
    expect(program).toHaveLength(1);
    const expected = program[0]!.occurrence;
    expect(expected.mappedMemberIndex).toBeUndefined();

    const payload = await evaluateRust(fixture);
    const raw = rawEntryForOccurrence(payload, expected);

    expect(raw.occurrence.sourceStatementId).toBe(expected.sourceStatementId);
    expect(raw.occurrence.instancePath).toEqual(expected.instancePath);
    expect(Object.hasOwn(raw.occurrence, "mappedMemberIndex")).toBe(false);

    const result = evaluationPayloadToResult(payload);
    const decoded = result.computedGeometryValues.get(geometryValueOccurrenceKey(expected));
    expect(decoded?.occurrence).toEqual(expected);
    expect(decoded?.value).toMatchObject({ kind: "point", x: 7, y: 9 });
  }, 30_000);

  it("keeps mapped occurrences distinct across Module instance paths", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module MapPoints(input: point[]) {",
      "  export const mapped: point[] = for item in @input { coordinate(x: @item.x + 1, y: @item.y) }",
      "}",
      "const first: point[] = [(1, 2), (3, 4)]",
      "const second: point[] = [(10, 20), (30, 40)]",
      "instance A = MapPoints(input: @first)",
      "instance B = MapPoints(input: @second)",
      "line UseA = segment(start: @A::mapped[0], end: @A::mapped[1])",
      "line UseB = segment(start: @B::mapped[0], end: @B::mapped[1])"
    ].join("\n"));
    const expected = geometryValueProgramFor(fixture)
      .filter((entry) => entry.occurrence.mappedMemberIndex !== undefined);
    const paths = [...new Map(expected.map((entry) => [
      JSON.stringify(entry.occurrence.instancePath), entry.occurrence.instancePath
    ])).values()];

    expect(expected).toHaveLength(4);
    expect(paths).toHaveLength(2);
    expect(expected.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1, 0, 1]);

    const payload = await evaluateRust(fixture);
    const rawEntries = expected.map((entry) => rawEntryForOccurrence(payload, entry.occurrence));

    expect(rawEntries.map((entry) => entry.occurrence)).toEqual(expected.map((entry) => entry.occurrence));
    expect(new Set(rawEntries.map((entry) => JSON.stringify(entry.occurrence.instancePath))).size).toBe(2);

    const result = evaluationPayloadToResult(payload);
    expect(result.computedGeometryValues.size).toBe(4);
    const expectedPointsByCompilerPath = new Map([
      [JSON.stringify(paths[0]), [[2, 2], [4, 4]]],
      [JSON.stringify(paths[1]), [[11, 20], [31, 40]]]
    ]);
    const memberPositionByPath = new Map<string, number>();
    for (const entry of expected) {
      const pathKey = JSON.stringify(entry.occurrence.instancePath);
      const memberIndex = entry.occurrence.mappedMemberIndex!;
      const point = expectedPointsByCompilerPath.get(pathKey)?.[memberIndex];
      if (!point) throw new Error(`missing expected point for compiler-authored path ${pathKey}`);
      const decoded = result.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence));
      expect(decoded?.occurrence).toEqual(entry.occurrence);
      expect(decoded?.value).toMatchObject({ kind: "point", x: point[0], y: point[1] });
      memberPositionByPath.set(pathKey, (memberPositionByPath.get(pathKey) ?? 0) + 1);
    }
    expect([...memberPositionByPath.values()]).toEqual([2, 2]);
  }, 30_000);
});
