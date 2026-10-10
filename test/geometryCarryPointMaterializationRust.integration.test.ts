import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { ComputedGeometry } from "../src/geometry/evaluationTypes";
import {
  createRustStdioParityClient,
  fixtureFromSource,
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

const scalarFor = (fixture: Fixture, payload: EvaluationPayload, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const summarizeGeometry = (geometry: ComputedGeometry | undefined) => {
  if (!geometry) return null;
  if (geometry.kind === "point") {
    return {
      kind: geometry.kind,
      elementId: geometry.elementId,
      name: geometry.name,
      x: geometry.x,
      y: geometry.y
    };
  }
  return {
    kind: geometry.kind,
    elementId: geometry.elementId,
    name: geometry.name,
    start: "start" in geometry && geometry.start
      ? { x: geometry.start.x, y: geometry.start.y }
      : null,
    end: "end" in geometry && geometry.end
      ? { x: geometry.end.x, y: geometry.end.y }
      : null,
    length: "length" in geometry ? geometry.length : null
  };
};

const observable = (
  fixture: Fixture,
  payload: EvaluationPayload,
  geometryNames: readonly string[],
  scalarNames: readonly string[]
) => {
  const result = evaluationPayloadToResult(payload);
  return {
    errors: result.errors,
    geometry: Object.fromEntries(geometryNames.map((name) => [
      name,
      summarizeGeometry(geometryFor(fixture, payload, name))
    ])),
    scalars: Object.fromEntries(scalarNames.map((name) => [name, scalarFor(fixture, payload, name)]))
  };
};

describe("SAY-497 escaped point geometry carry materialization through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (
    source: string,
    geometryNames: readonly string[],
    scalarNames: readonly string[] = []
  ) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(observable(fixture, rustPayload, geometryNames, scalarNames))).toEqual(
      normalizeParityPayload(observable(fixture, tsPayload, geometryNames, scalarNames))
    );
    return { fixture, tsPayload, rustPayload };
  };

  const expectPointForBoth = (
    evaluated: Awaited<ReturnType<typeof evaluateBoth>>,
    name: string,
    x: number,
    y: number
  ) => {
    const destination = elementByName(evaluated.fixture, name);
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(geometryFor(evaluated.fixture, payload, name)).toMatchObject({
        kind: "point",
        elementId: destination.id,
        name,
        x,
        y
      });
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
    }
  };

  it("matches audited case 016 for a drawable point initializer", async () => {
    const evaluated = await evaluateBoth(
      `nui 1
point Seed = coordinate(x: 1, y: 2)
for i in range(min: 0, max: 0, step: 1) carry p: point = @Seed {
 next p = @p
}
point Use = from(source: @p)
`,
      ["Seed", "Use"]
    );

    expectPointForBoth(evaluated, "Use", 1, 2);
  }, 60_000);

  it("matches audited case 017 for an empty loop and pure point initializer", async () => {
    const evaluated = await evaluateBoth(
      `nui 1
const seed: point = coordinate(x: 7, y: 8)
const empty: number[] = []
for i in @empty carry p: point = @seed {
 next p = @p
}
point Use = from(source: @p)
`,
      ["Use"]
    );

    expectPointForBoth(evaluated, "Use", 7, 8);
  }, 60_000);

  it("matches the independent audited pure point reference case 011", async () => {
    const evaluated = await evaluateBoth(
      `nui 1
const seed: point = coordinate(x: 1, y: 2)
for i in range(min: 0, max: 0, step: 1) carry p: point = @seed {
 next p = @p
}
point Use = from(source: @p)
`,
      ["Use"]
    );

    expectPointForBoth(evaluated, "Use", 1, 2);
  }, 60_000);

  it("materializes the final point selected by a nonempty loop", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: point = coordinate(x: 1, y: 2)",
      "for i in range(min: 0, max: 2, step: 1) carry p: point = @seed {",
      "  next p = if (@i == 0) { coordinate(x: 3, y: 4) } else { coordinate(x: 7, y: 8) }",
      "}",
      "point Use = from(source: @p)"
    ].join("\n"), ["Use"]);

    expectPointForBoth(evaluated, "Use", 7, 8);
  }, 60_000);

  it("preserves an already selected stage snapshot and gives the destination its own identity", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line Staged = segment(start: (1, 2), end: (5, 6))",
      "move Staged as shifted (from: (1, 2), to: (10, 20))",
      "for i in range(min: 0, max: 1, step: 1) carry cursor: point = @Staged.base.start {",
      "  next cursor = @Staged.shifted.end",
      "}",
      "point Use = from(source: @cursor)"
    ].join("\n"), ["Use"]);
    const carry = [...(evaluated.fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.geometryCarries ?? [])[0];
    expect(carry?.initializerTarget).toMatchObject({ stagePath: ["base"], pointKey: "start" });
    expect(carry?.nextTarget).toMatchObject({ stagePath: ["shifted"], pointKey: "end" });

    expectPointForBoth(evaluated, "Use", 14, 24);
  }, 60_000);

  it("materializes a direct path carry through from(source:)", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "for i in range(min: 0, max: 0, step: 1) carry route: path = @Seed {",
      "  next route = @route",
      "}",
      "path Use = from(source: @route)"
    ].join("\n"), ["Use"]);

    expect(geometryFor(evaluated.fixture, evaluated.tsPayload, "Use")).toMatchObject({
      kind: "line",
      elementId: elementByName(evaluated.fixture, "Use").id,
      name: "Use",
      start: { x: 0, y: 0 },
      end: { x: 3, y: 4 },
      length: 5
    });
  }, 60_000);

  it("keeps point carries available to segment anchors and point properties", async () => {
    const evaluated = await evaluateBoth(
      `nui 1
point Seed = coordinate(x: 1, y: 2)
for i in range(min: 0, max: 0, step: 1) carry p: point = @Seed {
 next p = @p
}
line Use = segment(start: @p, end: (0, 0))
const result: number = @p.x
`,
      ["Seed", "Use"],
      ["result"]
    );

    expect(geometryFor(evaluated.fixture, evaluated.tsPayload, "Use")).toMatchObject({
      kind: "line",
      elementId: elementByName(evaluated.fixture, "Use").id,
      name: "Use",
      start: { x: 1, y: 2 },
      end: { x: 0, y: 0 },
      length: Math.sqrt(5)
    });
    expect(scalarFor(evaluated.fixture, evaluated.tsPayload, "result")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 1 }
    });
  }, 60_000);

  it("preserves ordinary point source materialization without a carry", async () => {
    const evaluated = await evaluateBoth(
      `nui 1
const seed: point = coordinate(x: 1, y: 2)
point Use = from(source: @seed)
`,
      ["Use"]
    );

    expectPointForBoth(evaluated, "Use", 1, 2);
  }, 60_000);

  it("omits an invalid final carry source and preserves its unavailable-source diagnostic", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: point = coordinate(x: 1, y: 2)",
      "for i in range(min: 0, max: 2, step: 1) carry p: point = @seed {",
      "  next p = if (@i == 0) { coordinate(x: 3, y: 4) } else { coordinate(x: 1 / 0, y: 9) }",
      "}",
      "point Use = from(source: @p)"
    ].join("\n"), ["Use"]);
    const use = elementByName(evaluated.fixture, "Use");
    const tsResult = evaluationPayloadToResult(evaluated.tsPayload);

    expect(geometryFor(evaluated.fixture, evaluated.tsPayload, "Use")).toBeUndefined();
    expect(tsResult.errors).toContainEqual(expect.objectContaining({
      elementId: use.id,
      elementName: "Use",
      missingDependencyId: use.id,
      missingDependencyName: "Use",
      message: "Use の source geometry が利用できません。依存先を確認してください。"
    }));
  }, 60_000);
});
