import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  geometryValueOccurrenceKey,
  type GeometryValueOccurrence
} from "@nuinuicad/nui-language";
import { compileCanonicalText } from "@nuinuicad/nui-language/document";
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

const mappedEntriesFor = (fixture: EvaluationFixture) =>
  geometryValueProgramFor(fixture).filter((entry) => entry.occurrence.mappedMemberIndex !== undefined);

const occurrenceForMappedTarget = (target: unknown): GeometryValueOccurrence => {
  const findOccurrences = (value: unknown): GeometryValueOccurrence[] => {
    if (Array.isArray(value)) return value.flatMap(findOccurrences);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (
      (record.kind === "geometryValueMap" || record.kind === "geometryValue") &&
      record.occurrence && typeof record.occurrence === "object"
    ) {
      return [record.occurrence as GeometryValueOccurrence];
    }
    return Object.values(record).flatMap(findOccurrences);
  };
  const occurrence = findOccurrences(target)[0];
  if (!occurrence) throw new Error("expected a compiler-authored geometry value target");
  return occurrence;
};

const geometryFor = (fixture: EvaluationFixture, payload: EvaluationPayload, elementName: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === elementName);
  if (!element) throw new Error(`fixture has no element ${elementName}`);
  return evaluationPayloadToResult(payload).computedGeometry.get(element.id);
};

const lineEndpointsFor = (fixture: EvaluationFixture, payload: EvaluationPayload, elementName: string) => {
  const geometry = geometryFor(fixture, payload, elementName);
  if (geometry?.kind !== "line") throw new Error(`${elementName} did not materialize as a line`);
  return {
    start: { x: geometry.start.x, y: geometry.start.y },
    end: { x: geometry.end.x, y: geometry.end.y }
  };
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

  it("materializes an inline Module point map without scalar payloads", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(input: point[]) {",
      "  export const mapped: point[] = for p in @input { @p }",
      "}",
      "instance A = M(input: [(1, 2)])",
      "line Use = segment(start: @A::mapped[0], end: (10, 20))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const request = buildRustEvaluationInput(fixture.elements, options);
    const mapped = mappedEntriesFor(fixture);

    expect(Object.hasOwn(request, "scalarProgram")).toBe(false);
    expect(Object.hasOwn(request, "bindingVersions")).toBe(false);
    expect(mapped).toHaveLength(1);
    const occurrence = mapped[0]!.occurrence;
    expect(occurrence.instancePath.length).toBeGreaterThan(0);
    expect(occurrence.mappedMemberIndex).toBe(0);
    expect(occurrenceForMappedTarget(
      geometryInputTargetsFor(fixture, request, "Use", "startPoint")
    )).toEqual(occurrence);

    const payload = await rustStdio.evaluate(fixture.elements, options);
    const raw = rawEntryForOccurrence(payload, occurrence);
    expect(raw.occurrence).toEqual(occurrence);
    expect(raw.value).toMatchObject({ kind: "point", x: 1, y: 2 });

    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues.get(geometryValueOccurrenceKey(occurrence))?.value)
      .toMatchObject({ kind: "point", x: 1, y: 2 });
    expect(geometryFor(fixture, payload, "Use")).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 10, y: 20 }
    });
  }, 30_000);

  it("preserves both inline Module map members and materializes their consumers", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(input: point[]) {",
      "  export const mapped: point[] = for p in @input { @p }",
      "}",
      "instance A = M(input: [(1, 2), (3, 4)])",
      "line Use = segment(start: @A::mapped[0], end: @A::mapped[1])"
    ].join("\n"));
    const options = optionsFor(fixture);
    const request = buildRustEvaluationInput(fixture.elements, options);
    const mapped = mappedEntriesFor(fixture);

    expect(mapped.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1]);
    expect(mapped[0]!.occurrence.instancePath).toEqual(mapped[1]!.occurrence.instancePath);
    expect(new Set(mapped.map((entry) => geometryValueOccurrenceKey(entry.occurrence))).size).toBe(2);
    expect(mappedMemberIndicesFor(fixture, request, "Use", "startPoint")).toEqual([0]);
    expect(mappedMemberIndicesFor(fixture, request, "Use", "endPoint")).toEqual([1]);

    const payload = await rustStdio.evaluate(fixture.elements, options);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    for (const [entry, point] of mapped.map((entry, index) => [entry, [[1, 2], [3, 4]][index]!] as const)) {
      const raw = rawEntryForOccurrence(payload, entry.occurrence);
      expect(raw.occurrence).toEqual(entry.occurrence);
      expect(raw.value).toMatchObject({ kind: "point", x: point[0], y: point[1] });
      expect(result.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))?.value)
        .toMatchObject({ kind: "point", x: point[0], y: point[1] });
    }
    expect(geometryFor(fixture, payload, "Use")).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 }
    });
  }, 30_000);

  it("keeps an unrelated scalar declaration inert for inline Module maps", async () => {
    const source = [
      "nui 1",
      "module M(input: point[]) {",
      "  export const mapped: point[] = for p in @input { @p }",
      "}",
      "instance A = M(input: [(1, 2), (3, 4)])",
      "line Use = segment(start: @A::mapped[0], end: @A::mapped[1])"
    ];
    const withoutScalar = fixtureFromSource(source.join("\n"));
    const withScalarCompiled = compileCanonicalText(
      withoutScalar.compiled!,
      [...source, "const unused: number = 99"].join("\n")
    );
    if (withScalarCompiled.status === "fatal") throw new Error("scalar variant failed to compile");
    const withScalar: EvaluationFixture = {
      elements: withScalarCompiled.doc.document.elements,
      evaluationLimitIndex: withScalarCompiled.doc.document.evaluationLimitIndex,
      compiled: withScalarCompiled
    };
    const withoutOptions = optionsFor(withoutScalar);
    const withOptions = optionsFor(withScalar);
    const withoutRequest = buildRustEvaluationInput(withoutScalar.elements, withoutOptions);
    const withRequest = buildRustEvaluationInput(withScalar.elements, withOptions);

    expect(Object.hasOwn(withoutRequest, "scalarProgram")).toBe(false);
    expect(Object.hasOwn(withoutRequest, "bindingVersions")).toBe(false);
    expect(Object.hasOwn(withRequest, "scalarProgram")).toBe(false);
    expect(Object.hasOwn(withRequest, "bindingVersions")).toBe(true);
    expect(mappedEntriesFor(withScalar).map((entry) => entry.occurrence))
      .toEqual(mappedEntriesFor(withoutScalar).map((entry) => entry.occurrence));

    const withoutPayload = await rustStdio.evaluate(withoutScalar.elements, withoutOptions);
    const withPayload = await rustStdio.evaluate(withScalar.elements, withOptions);
    const withoutResult = evaluationPayloadToResult(withoutPayload);
    const withResult = evaluationPayloadToResult(withPayload);
    const withoutMapped = mappedEntriesFor(withoutScalar).map((entry) =>
      withoutResult.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))?.value
    );
    const withMapped = mappedEntriesFor(withScalar).map((entry) =>
      withResult.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))?.value
    );

    expect(withoutResult.errors).toEqual([]);
    expect(withResult.errors).toEqual([]);
    expect(withMapped).toEqual(withoutMapped);
    expect(lineEndpointsFor(withScalar, withPayload, "Use")).toEqual(
      lineEndpointsFor(withoutScalar, withoutPayload, "Use")
    );
  }, 30_000);

  it("produces equivalent mapped geometry for named and inline point collections", async () => {
    const moduleLines = [
      "module M(input: point[]) {",
      "  export const mapped: point[] = for p in @input { @p }",
      "}"
    ];
    const inputPoints = "[(1, 2), (3, 4)]";
    const inline = fixtureFromSource([
      "nui 1",
      ...moduleLines,
      `instance A = M(input: ${inputPoints})`,
      "line Use = segment(start: @A::mapped[0], end: @A::mapped[1])"
    ].join("\n"));
    const named = fixtureFromSource([
      "nui 1",
      ...moduleLines,
      `const points: point[] = ${inputPoints}`,
      "instance A = M(input: @points)",
      "line Use = segment(start: @A::mapped[0], end: @A::mapped[1])"
    ].join("\n"));
    const inlinePayload = await evaluateRust(inline);
    const namedPayload = await evaluateRust(named);
    const inlineResult = evaluationPayloadToResult(inlinePayload);
    const namedResult = evaluationPayloadToResult(namedPayload);
    const inlineValues = mappedEntriesFor(inline).map((entry) =>
      inlineResult.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))?.value
    );
    const namedValues = mappedEntriesFor(named).map((entry) =>
      namedResult.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))?.value
    );

    expect(inlineResult.errors).toEqual([]);
    expect(namedResult.errors).toEqual([]);
    expect(inlineValues).toEqual(namedValues);
    expect(lineEndpointsFor(inline, inlinePayload, "Use")).toEqual(
      lineEndpointsFor(named, namedPayload, "Use")
    );
  }, 30_000);

  it("preserves sibling and nested Module mapped occurrence identities", async () => {
    const siblings = fixtureFromSource([
      "nui 1",
      "module M(input: point[]) {",
      "  export const mapped: point[] = for p in @input { @p }",
      "}",
      "instance A = M(input: [(1, 2)])",
      "instance B = M(input: [(3, 4)])",
      "line UseA = segment(start: @A::mapped[0], end: (10, 20))",
      "line UseB = segment(start: @B::mapped[0], end: (10, 20))"
    ].join("\n"));
    const siblingOptions = optionsFor(siblings);
    const siblingRequest = buildRustEvaluationInput(siblings.elements, siblingOptions);
    const siblingEntries = mappedEntriesFor(siblings);
    const useAOccurrence = occurrenceForMappedTarget(
      geometryInputTargetsFor(siblings, siblingRequest, "UseA", "startPoint")
    );
    const useBOccurrence = occurrenceForMappedTarget(
      geometryInputTargetsFor(siblings, siblingRequest, "UseB", "startPoint")
    );

    expect(siblingEntries).toHaveLength(2);
    expect(siblingEntries.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 0]);
    expect(useAOccurrence.instancePath).not.toEqual(useBOccurrence.instancePath);
    expect(siblingEntries.map((entry) => entry.occurrence).sort((left, right) =>
      geometryValueOccurrenceKey(left).localeCompare(geometryValueOccurrenceKey(right))
    )).toEqual([useAOccurrence, useBOccurrence].sort((left, right) =>
      geometryValueOccurrenceKey(left).localeCompare(geometryValueOccurrenceKey(right))
    ));

    const siblingPayload = await rustStdio.evaluate(siblings.elements, siblingOptions);
    const siblingResult = evaluationPayloadToResult(siblingPayload);
    expect(siblingResult.errors).toEqual([]);
    for (const [occurrence, point] of [[useAOccurrence, [1, 2]], [useBOccurrence, [3, 4]]] as const) {
      expect(rawEntryForOccurrence(siblingPayload, occurrence).occurrence).toEqual(occurrence);
      expect(siblingResult.computedGeometryValues.get(geometryValueOccurrenceKey(occurrence))?.value)
        .toMatchObject({ kind: "point", x: point[0], y: point[1] });
    }
    expect(geometryFor(siblings, siblingPayload, "UseA")).toMatchObject({
      kind: "line", start: { x: 1, y: 2 }, end: { x: 10, y: 20 }
    });
    expect(geometryFor(siblings, siblingPayload, "UseB")).toMatchObject({
      kind: "line", start: { x: 3, y: 4 }, end: { x: 10, y: 20 }
    });

    const nested = fixtureFromSource([
      "nui 1",
      "module MapPoints(input: point[]) {",
      "  export const mapped: point[] = for p in @input { @p }",
      "}",
      "module Wrapper(input: point[]) {",
      "  instance Inner = MapPoints(input: @input)",
      "  line Use = segment(start: @Inner::mapped[0], end: (10, 20))",
      "}",
      "instance A = Wrapper(input: [(5, 6)])",
    ].join("\n"));
    const nestedOptions = optionsFor(nested);
    const nestedRequest = buildRustEvaluationInput(nested.elements, nestedOptions);
    const nestedEntries = mappedEntriesFor(nested);
    const nestedOccurrence = nestedEntries.find((entry) => entry.occurrence.instancePath.length > 1)?.occurrence;
    expect(nestedOccurrence).toBeDefined();
    expect(nestedOccurrence!.mappedMemberIndex).toBe(0);
    expect(nestedRequest.geometryValueProgram
      ?.filter((entry) => entry.occurrence.mappedMemberIndex !== undefined)
      .map((entry) => entry.occurrence)).toEqual(nestedEntries.map((entry) => entry.occurrence));

    const nestedPayload = await rustStdio.evaluate(nested.elements, nestedOptions);
    const nestedResult = evaluationPayloadToResult(nestedPayload);
    expect(nestedResult.errors).toEqual([]);
    expect(rawEntryForOccurrence(nestedPayload, nestedOccurrence!).occurrence).toEqual(nestedOccurrence);
    expect(nestedResult.computedGeometryValues.get(geometryValueOccurrenceKey(nestedOccurrence!))?.value)
      .toMatchObject({ kind: "point", x: 5, y: 6 });
    const wrapperInstance = nested.elements.find((element) => element.name === "A");
    expect(wrapperInstance).toBeDefined();
    expect(nestedResult.instanceBaseGeometry.get(wrapperInstance!.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "line",
        start: expect.objectContaining({ x: 5, y: 6 }),
        end: expect.objectContaining({ x: 10, y: 20 })
      })
    ]));
  }, 60_000);

  it("keeps genuine unavailable scalar lookups explicit without a resolver payload", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const index: number = 0",
      "module M(input: point[], delta: number) {",
      "  export const mapped: point[] = for p in @input { coordinate(x: @p.x + @delta, y: @p.y) }",
      "}",
      "instance A = M(input: [(1, 2)], delta: 3)",
      "line MapUse = segment(start: @A::mapped[0], end: (10, 20))",
      "line IndexedUse = segment(start: @A::mapped[@index], end: (10, 20))"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(options.scalarProgram ?? options.bindingVersions).toBeDefined();
    const optionsWithoutScalarContext = { ...options };
    delete optionsWithoutScalarContext.scalarProgram;
    delete optionsWithoutScalarContext.bindingVersions;
    const request = buildRustEvaluationInput(fixture.elements, optionsWithoutScalarContext);
    expect(request.scalarProgram).toBeUndefined();
    expect(request.bindingVersions).toBeUndefined();

    const payload = await rustStdio.evaluate(fixture.elements, optionsWithoutScalarContext);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("evaluation-binding-unavailable") })
    ]));
    expect(geometryFor(fixture, payload, "MapUse")).toBeUndefined();
    expect(geometryFor(fixture, payload, "IndexedUse")).toBeUndefined();
  }, 30_000);
});
