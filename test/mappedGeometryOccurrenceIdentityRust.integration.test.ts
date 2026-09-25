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
