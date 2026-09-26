import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  geometryValueOccurrenceKey,
  type GeometryInputCollectionNode,
  type GeometryInputTarget,
  type GeometryValueOccurrence,
  type GeometryValueProgramEntry
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

const geometryValueProgramFor = (fixture: EvaluationFixture): readonly GeometryValueProgramEntry[] => {
  if (!fixture.compiled) throw new Error("fixture has no compiled document");
  expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return optionsFor(fixture).geometryValueProgram ?? [];
};

const valueEntryFor = (fixture: EvaluationFixture, name: string): GeometryValueProgramEntry => {
  if (!fixture.compiled) throw new Error("fixture has no compiled document");
  const semantic = fixture.compiled.doc.moduleSemanticAnalysis?.geometryValues.find((value) =>
    value.ownerModuleDefinitionStatementId === null && value.name === name
  );
  if (!semantic) throw new Error(`compiler omitted geometry value semantic for ${name}`);
  const entry = geometryValueProgramFor(fixture).find((candidate) =>
    candidate.sourceStatementId === semantic.statementId &&
    candidate.occurrence.instancePath.length === 0 &&
    candidate.occurrence.mappedMemberIndex === undefined
  );
  if (!entry) throw new Error(`compiler omitted the ordinary geometry value occurrence for ${name}`);
  return entry;
};

const rawEntryForOccurrence = (payload: EvaluationPayload, occurrence: GeometryValueOccurrence) => {
  const key = geometryValueOccurrenceKey(occurrence);
  const entry = payload.computedGeometryValues?.find((candidate) => geometryValueOccurrenceKey(candidate.occurrence) === key);
  if (!entry) throw new Error(`Rust payload omitted compiler-authored occurrence ${key}`);
  return entry;
};

const evaluateRust = (fixture: EvaluationFixture) => rustStdio.evaluate(fixture.elements, optionsFor(fixture));

const geometryFor = (fixture: EvaluationFixture, payload: EvaluationPayload, elementName: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === elementName);
  if (!element) throw new Error(`fixture has no element ${elementName}`);
  return evaluationPayloadToResult(payload).computedGeometry.get(element.id);
};

const geometryOccurrencesInNode = (node: GeometryInputCollectionNode): GeometryValueOccurrence[] => {
  if (node.kind === "none") return [];
  if (node.kind === "leaf") return node.targets.flatMap(geometryOccurrencesInTarget);
  if (node.kind === "if") return [...geometryOccurrencesInNode(node.thenBranch), ...geometryOccurrencesInNode(node.elseBranch)];
  if (node.kind === "coalesce") return [...geometryOccurrencesInNode(node.leftBranch), ...geometryOccurrencesInNode(node.rightBranch)];
  return node.arms.flatMap((arm) => geometryOccurrencesInNode(arm.value));
};

const geometryOccurrencesInTarget = (target: GeometryInputTarget): GeometryValueOccurrence[] => {
  if (target.kind === "geometryValue" || target.kind === "geometryValueMap") return [target.occurrence];
  if (target.kind === "collectionIndex") {
    return target.value ? geometryOccurrencesInNode(target.value) : target.members.flatMap(geometryOccurrencesInTarget);
  }
  if (target.kind === "collectionValue") return geometryOccurrencesInNode(target.value);
  return [];
};

const selectedOccurrenceForAlias = (entry: GeometryValueProgramEntry): GeometryValueOccurrence => {
  if (entry.construction.kind !== "reference") throw new Error("expected an indexed immutable geometry reference");
  const target = entry.construction.target;
  if (target.kind === "geometryInputTarget") {
    const indexed = target.target;
    const index = indexed.index.kind === "numberLiteral" ? indexed.index.value : undefined;
    if (index === undefined || !Number.isInteger(index) || index < 0) {
      throw new Error("expected a literal indexed collection target");
    }
    const occurrences = indexed.value
      ? geometryOccurrencesInNode(indexed.value)
      : indexed.members.flatMap(geometryOccurrencesInTarget);
    const occurrence = occurrences[index];
    if (!occurrence) throw new Error(`indexed target omitted member ${index}`);
    return occurrence;
  }
  if (target.kind === "geometryValue") return target.occurrence;
  throw new Error(`expected a geometry value indexed member, got ${target.kind}`);
};

describe("indexed immutable geometry collection aliases through Rust", () => {
  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  });

  afterAll(() => {
    rustStdio?.dispose();
  });

  it("defines and evaluates a literal indexed point alias with direct and ordinary alias controls", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const points: point[] = [(1, 2)]",
      "const chosen: point = @points[0]",
      "const ordinary: point = coordinate(x: 7, y: 9)",
      "line Use = segment(start: @chosen, end: (20, 20))",
      "line Direct = segment(start: @points[0], end: (20, 20))",
      "line OrdinaryUse = segment(start: @ordinary, end: (20, 20))"
    ].join("\n"));
    const request = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const chosen = valueEntryFor(fixture, "chosen");
    const ordinary = valueEntryFor(fixture, "ordinary");
    expect(request.geometryValueProgram?.some((entry) => geometryValueOccurrenceKey(entry.occurrence) === geometryValueOccurrenceKey(chosen.occurrence))).toBe(true);
    expect(chosen.construction).toMatchObject({
      kind: "coordinate",
      x: { kind: "numberLiteral", value: 1 },
      y: { kind: "numberLiteral", value: 2 }
    });

    const payload = await evaluateRust(fixture);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(rawEntryForOccurrence(payload, chosen.occurrence).value).toMatchObject({ kind: "point", x: 1, y: 2 });
    expect(result.computedGeometryValues.get(geometryValueOccurrenceKey(ordinary.occurrence))?.value)
      .toMatchObject({ kind: "point", x: 7, y: 9 });
    expect(geometryFor(fixture, payload, "Use")).toMatchObject({ kind: "line", start: { x: 1, y: 2 }, end: { x: 20, y: 20 } });
    expect(geometryFor(fixture, payload, "Direct")).toMatchObject({ kind: "line", start: { x: 1, y: 2 }, end: { x: 20, y: 20 } });
    expect(geometryFor(fixture, payload, "OrdinaryUse")).toMatchObject({ kind: "line", start: { x: 7, y: 9 }, end: { x: 20, y: 20 } });
  }, 30_000);

  it("preserves mapped member order, duplicates, and runtime index selection", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const points: point[] = [(1, 2), (3, 4), (1, 2)]",
      "const mapped: point[] = for item in @points { coordinate(x: @item.x + 10, y: @item.y) }",
      "const chosen: point = @mapped[2]",
      "const runtimeChosen: point = @mapped[1 + 1]",
      "line UseChosen = segment(start: @chosen, end: (0, 0))",
      "line UseRuntime = segment(start: @runtimeChosen, end: (0, 0))",
      "line Direct = segment(start: @mapped[2], end: (0, 0))"
    ].join("\n"));
    const request = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const mappedEntries = request.geometryValueProgram?.filter((entry) => entry.occurrence.mappedMemberIndex !== undefined) ?? [];
    expect(mappedEntries.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1, 2]);
    const chosen = valueEntryFor(fixture, "chosen");
    const chosenOccurrence = selectedOccurrenceForAlias(chosen);
    expect(chosenOccurrence.mappedMemberIndex).toBe(2);
    expect(chosenOccurrence).toEqual(mappedEntries[2]!.occurrence);
    const runtimeChosen = valueEntryFor(fixture, "runtimeChosen");
    expect(runtimeChosen.construction).toMatchObject({ kind: "reference", target: { kind: "geometryInputTarget" } });
    if (runtimeChosen.construction.kind !== "reference" || runtimeChosen.construction.target.kind !== "geometryInputTarget") {
      throw new Error("non-literal index was not retained in the geometry-value program");
    }
    expect(runtimeChosen.construction.target.target.index.kind).not.toBe("numberLiteral");

    const payload = await evaluateRust(fixture);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(rawEntryForOccurrence(payload, chosen.occurrence).value).toMatchObject({ kind: "point", x: 11, y: 2 });
    expect(rawEntryForOccurrence(payload, runtimeChosen.occurrence).value).toMatchObject({ kind: "point", x: 11, y: 2 });
    expect(geometryFor(fixture, payload, "UseChosen")).toMatchObject({ kind: "line", start: { x: 11, y: 2 } });
    expect(geometryFor(fixture, payload, "UseRuntime")).toMatchObject({ kind: "line", start: { x: 11, y: 2 } });
    expect(geometryFor(fixture, payload, "Direct")).toMatchObject({ kind: "line", start: { x: 11, y: 2 } });
  }, 30_000);

  it("evaluates indexed line and path aliases while direct line indexing remains correct", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (20, 0), end: (30, 0))",
      "const lines: line[] = [@A, @B]",
      "const chosenLine: line = @lines[1]",
      "line DirectLine = offset(sources: [@lines[1]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "line UseLine = offset(sources: [@chosenLine], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "line Square = polyline(points: [(0, 0), (10, 0), (10, 10), (0, 10)], closed: true)",
      "line Triangle = polyline(points: [(20, 0), (24, 0), (20, 4)], closed: true)",
      "const paths: path[] = [@Square, @Triangle]",
      "const chosenPath: path = @paths[1]",
      "line UsePath = offset(sources: [@chosenPath], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const request = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const lineAlias = valueEntryFor(fixture, "chosenLine");
    const pathAlias = valueEntryFor(fixture, "chosenPath");
    expect(request.geometryValueProgram?.some((entry) => entry.occurrence.sourceStatementId === lineAlias.occurrence.sourceStatementId)).toBe(true);
    expect(request.geometryValueProgram?.some((entry) => entry.occurrence.sourceStatementId === pathAlias.occurrence.sourceStatementId)).toBe(true);
    expect(lineAlias.declaredInterfaceType).toBe("line");
    expect(pathAlias.declaredInterfaceType).toBe("path");

    const payload = await evaluateRust(fixture);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(rawEntryForOccurrence(payload, lineAlias.occurrence).value).toMatchObject({ kind: "line", start: { x: 20, y: 0 }, end: { x: 30, y: 0 } });
    expect(rawEntryForOccurrence(payload, pathAlias.occurrence).value).toMatchObject({ kind: "polyline", start: { x: 20, y: 0 } });
    for (const name of ["DirectLine", "UseLine", "UsePath"]) {
      expect(geometryFor(fixture, payload, name)).toMatchObject({ kind: "offsetLine" });
    }
    expect(geometryFor(fixture, payload, "UseLine")).toMatchObject({ segments: [{ start: { x: 20, y: 1 }, end: { x: 30, y: 1 } }] });
  }, 30_000);

  it("keeps the existing same-source intersection error for an indexed mapped member", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@Base]",
      "const mapped: path[] = for item in @lines { @item }",
      "const Same: point = intersection(line1: @mapped[0], line2: @mapped[0])"
    ].join("\n"));
    const request = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const same = valueEntryFor(fixture, "Same");
    expect(request.geometryValueProgram?.some((entry) =>
      geometryValueOccurrenceKey(entry.occurrence) === geometryValueOccurrenceKey(same.occurrence)
    )).toBe(true);

    const payload = await evaluateRust(fixture);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([{
      occurrence: same.occurrence,
      message: "intersection geometry value cannot intersect the same source geometry twice."
    }]);
    expect(result.computedGeometryValues.has(geometryValueOccurrenceKey(same.occurrence))).toBe(false);
  }, 30_000);

  it("keeps indexed mapped aliases distinct across Module instance paths", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module MapPoints(input: point[]) {",
      "  export const mapped: point[] = for item in @input { coordinate(x: @item.x + 1, y: @item.y) }",
      "}",
      "const first: point[] = [(1, 2), (3, 4)]",
      "const second: point[] = [(10, 20), (30, 40)]",
      "instance A = MapPoints(input: @first)",
      "instance B = MapPoints(input: @second)",
      "const chosenA: point = @A::mapped[1]",
      "const chosenB: point = @B::mapped[1]",
      "line UseA = segment(start: @chosenA, end: (0, 0))",
      "line UseB = segment(start: @chosenB, end: (0, 0))"
    ].join("\n"));
    const request = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const mapped = request.geometryValueProgram?.filter((entry) => entry.occurrence.mappedMemberIndex !== undefined) ?? [];
    expect(mapped).toHaveLength(4);
    const aliasA = valueEntryFor(fixture, "chosenA");
    const aliasB = valueEntryFor(fixture, "chosenB");
    const selectedA = selectedOccurrenceForAlias(aliasA);
    const selectedB = selectedOccurrenceForAlias(aliasB);
    expect(selectedA.mappedMemberIndex).toBe(1);
    expect(selectedB.mappedMemberIndex).toBe(1);
    expect(selectedA.instancePath).not.toEqual(selectedB.instancePath);
    expect(mapped).toContainEqual(expect.objectContaining({ occurrence: selectedA }));
    expect(mapped).toContainEqual(expect.objectContaining({ occurrence: selectedB }));

    const payload = await evaluateRust(fixture);
    const result = evaluationPayloadToResult(payload);
    expect(result.errors).toEqual([]);
    expect(rawEntryForOccurrence(payload, aliasA.occurrence).value).toMatchObject({ kind: "point", x: 4, y: 4 });
    expect(rawEntryForOccurrence(payload, aliasB.occurrence).value).toMatchObject({ kind: "point", x: 31, y: 40 });
    expect(geometryFor(fixture, payload, "UseA")).toMatchObject({ kind: "line", start: { x: 4, y: 4 } });
    expect(geometryFor(fixture, payload, "UseB")).toMatchObject({ kind: "line", start: { x: 31, y: 40 } });
  }, 30_000);
});
