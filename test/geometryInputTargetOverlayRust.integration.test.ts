import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type Fixture = ReturnType<typeof fixtureFromSource>;

const elementByName = (fixture: Fixture, name: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`element "${name}" not found`);
  return element;
};

const geometryFor = (fixture: Fixture, payload: EvaluationPayload, name: string) =>
  evaluationPayloadToResult(payload).computedGeometry.get(elementByName(fixture, name).id);

const reproductions = [
  {
    name: "an empty point carry beside an indexed generated point",
    source: `nui 1
const seed: point[] = [(3, 4)]
const empty: number[] = []
for n in @empty carry pts: point[] = @seed {
  next pts = @pts
}
for i in range(min: 0, max: 0, step: 1) {
  point Mark = coordinate(x: 1, y: 2)
}
line Use = segment(start: @Mark[0], end: @pts[0])`,
    start: { x: 1, y: 2 },
    end: { x: 3, y: 4 }
  },
  {
    name: "a mapped carry beside an indexed generated line endpoint",
    source: `nui 1
const seed: point[] = [(6, 7), (8, 9)]
for i in range(min: 0, max: 1, step: 1) carry pts: point[] = @seed {
  const shifted: point[] = for p in @pts { coordinate(x: @p.x + 1, y: @p.y + 2) }
  line Edge = segment(start: (0,0), end: (@i + 2, 5))
  next pts = @shifted
}
line Use = segment(start: @pts[1], end: @Edge[1].end)`,
    start: { x: 10, y: 13 },
    end: { x: 3, y: 5 }
  }
] as const;

describe("SAY-509 geometry input target overlays through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  it.each(reproductions)("preserves $name in the TypeScript and Rust evaluators", async (reproduction) => {
    const fixture = fixtureFromSource(reproduction.source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(false);

    const rootTargetsByElementId = fixture.compiled?.doc.geometryInputTargetsByElementId;
    const runtimeTargetsByElementId =
      fixture.compiled?.doc.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId;
    const expectedElementIds = new Set([
      ...(rootTargetsByElementId?.keys() ?? []),
      ...(runtimeTargetsByElementId?.keys() ?? [])
    ]);
    expect([...options.geometryInputTargetsByElementId?.keys() ?? []]).toEqual([...expectedElementIds]);

    const use = elementByName(fixture, "Use");
    const rootTargets = rootTargetsByElementId?.get(use.id);
    const runtimeTargets = runtimeTargetsByElementId?.get(use.id);
    const mergedTargets = options.geometryInputTargetsByElementId?.get(use.id);
    const expectedParameterKeys = new Set([
      ...(rootTargets?.keys() ?? []),
      ...(runtimeTargets?.keys() ?? [])
    ]);
    expect([...mergedTargets?.keys() ?? []]).toEqual([...expectedParameterKeys]);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    // This directly exercises production stdio even though normal host dispatch rejects the fixture.
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const observables = [tsPayload, rustPayload].map((payload) => {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(fixture, payload, "Use")).toMatchObject({
        kind: "line",
        start: reproduction.start,
        end: reproduction.end
      });
      return {
        errors: result.errors,
        geometryValueErrors: result.geometryValueErrors ?? [],
        geometry: geometryFor(fixture, payload, "Use")
      };
    });
    expect(normalizeParityPayload(observables[1])).toEqual(normalizeParityPayload(observables[0]));
  });
});
