import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { GeometryValueProgramEntry } from "@nuinuicad/nui-language";
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

const scalarFor = (fixture: Fixture, payload: EvaluationPayload, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const geometryCarriesFor = (fixture: Fixture) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const expectPathCarryTargets = (fixture: Fixture, expectedCount = 1) => {
  const carries = geometryCarriesFor(fixture).filter((carry) => carry.declaredType.kind === "path");
  expect(carries).toHaveLength(expectedCount);
  for (const carry of carries) {
    expect(carry.initializerTarget.geometryType).toBe("path");
    expect(carry.nextTarget).toMatchObject({ geometryType: "path" });
  }
  return carries;
};

const pathValuesForInstances = (payload: EvaluationPayload) =>
  [...(evaluationPayloadToResult(payload).computedGeometryValues?.values() ?? [])]
    .map((entry) => ({ occurrence: entry.occurrence, value: entry.value }));

describe("SAY-500 Module path carries through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (source: string) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const observable = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      return {
        errors: result.errors,
        geometryValueErrors: result.geometryValueErrors ?? [],
        geometryValues: pathValuesForInstances(payload),
        scalars: (fixture.compiled?.doc.bindingAnalysis?.catalog.bindings ?? [])
          .filter((binding) => binding.kind === "typed")
          .map((binding) => [binding.name, result.computedScalarBindings?.get(binding.id)])
      };
    };
    expect(normalizeParityPayload(observable(rustPayload))).toEqual(
      normalizeParityPayload(observable(tsPayload))
    );
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
    }
    return { fixture, tsPayload, rustPayload };
  };

  it("self-carries a Module polyline and quarter-circle path without flattening primitives", async () => {
    const moduleSource = (seed: string) => [
      "nui 1",
      "module M(input: path) {",
      "  for i in range(min: 0, max: 0, step: 1) carry p: path = @input {",
      "    next p = @p",
      "  }",
      "  export const length: number = @p.length",
      "}",
      seed,
      "instance A = M(input: @seed)",
      "const result: number = @A::length"
    ].join("\n");
    const cases = [
      {
        name: "polyline",
        source: moduleSource("const seed: path = polyline(points: [(0, 0), (3, 0), (3, 4)], closed: false)"),
        expectedLength: 7
      },
      {
        name: "quarter arc",
        source: moduleSource("const seed: path = arc(center: (0, 0), radius: 2, start: 0, end: 90, direction: counterclockwise)"),
        expectedLength: Math.PI
      }
    ];

    for (const testCase of cases) {
      const evaluated = await evaluateBoth(testCase.source);
      expectPathCarryTargets(evaluated.fixture);
      for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
        expect(scalarFor(evaluated.fixture, payload, "result")).toMatchObject({ status: "ok" });
        const result = scalarFor(evaluated.fixture, payload, "result");
        if (result?.status !== "ok" || result.value.kind !== "number") {
          throw new Error(`expected ${testCase.name} length to evaluate as a number`);
        }
        expect(result.value.value).toBeCloseTo(testCase.expectedLength, 10);

        const sourceValue = pathValuesForInstances(payload).find((entry) =>
          testCase.name === "polyline" ? entry.value.kind === "polyline" : entry.value.kind === "arcLine"
        );
        if (testCase.name === "polyline") {
          expect(sourceValue?.value).toMatchObject({
            kind: "polyline",
            closed: false,
            length: 7,
            start: { x: 0, y: 0 },
            end: { x: 3, y: 4 },
            segments: [
              { start: { x: 0, y: 0 }, end: { x: 3, y: 0 }, length: 3 },
              { start: { x: 3, y: 0 }, end: { x: 3, y: 4 }, length: 4 }
            ]
          });
          expect(sourceValue?.occurrence.instancePath).toEqual([]);
        } else {
          expect(sourceValue?.value).toMatchObject({
            kind: "arcLine",
            center: { x: 0, y: 0 },
            radius: 2,
            length: Math.PI
          });
          if (sourceValue?.value.kind !== "arcLine") throw new Error("expected source arc path");
          expect(sourceValue.value.start).toMatchObject({ x: 2, y: 0 });
          expect(sourceValue.value.end.x).toBeCloseTo(0, 10);
          expect(sourceValue.value.end.y).toBeCloseTo(2, 10);
          expect(sourceValue?.occurrence.instancePath).toEqual([]);
        }
      }
    }
  }, 60_000);

  it("keeps asymmetric Module instances on their own path and carry identities", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "module M(input: path) {",
      "  for i in range(min: 0, max: 0, step: 1) carry p: path = @input {",
      "    next p = @p",
      "  }",
      "  export const length: number = @p.length",
      "}",
      "const first: path = polyline(points: [(0, 0), (2, 0), (2, 5)], closed: false)",
      "const second: path = arc(center: (1, 1), radius: 3, start: 0, end: 90, direction: counterclockwise)",
      "instance A = M(input: @first)",
      "instance B = M(input: @second)",
      "const firstLength: number = @A::length",
      "const secondLength: number = @B::length"
    ].join("\n"));

    const carries = expectPathCarryTargets(evaluated.fixture, 2);
    expect(new Set(carries.map((carry) => carry.bindingId)).size).toBe(2);
    const initializerOccurrences = carries.map((carry) =>
      carry.initializerTarget.kind === "geometryValue"
        ? JSON.stringify(carry.initializerTarget.occurrence)
        : ""
    );
    expect(initializerOccurrences.every(Boolean)).toBe(true);
    expect(new Set(initializerOccurrences).size).toBe(2);
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      const firstLength = scalarFor(evaluated.fixture, payload, "firstLength");
      const secondLength = scalarFor(evaluated.fixture, payload, "secondLength");
      expect(firstLength).toMatchObject({ status: "ok" });
      expect(secondLength).toMatchObject({ status: "ok" });
      if (firstLength?.status !== "ok" || firstLength.value.kind !== "number" ||
          secondLength?.status !== "ok" || secondLength.value.kind !== "number") {
        throw new Error("expected both Module path lengths to evaluate as numbers");
      }
      expect(firstLength.value.value).toBeCloseTo(7, 10);
      expect(secondLength.value.value).toBeCloseTo((3 * Math.PI) / 2, 10);

      const sourceValues = pathValuesForInstances(payload).filter((entry) => entry.occurrence.instancePath.length === 0);
      expect(sourceValues.some((entry) => entry.value.kind === "polyline" && entry.value.length === 7)).toBe(true);
      expect(sourceValues.some((entry) => entry.value.kind === "arcLine" && Math.abs(entry.value.length - (3 * Math.PI) / 2) < 1e-10)).toBe(true);
    }
  }, 60_000);

  it("decodes a genuine indexed path target in a Module", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "module M() {",
      "  const first: path = polyline(points: [(0, 0), (1, 0), (1, 1)], closed: false)",
      "  const second: path = polyline(points: [(0, 0), (0, 3), (4, 3)], closed: false)",
      "  const routes: path[] = [@first, @second]",
      "  const selectedPath: path = @routes[1 + 0]",
      "}",
      "instance A = M()"
    ].join("\n"));

    expect(geometryCarriesFor(evaluated.fixture)).toEqual([]);
    const selected = evaluated.fixture.compiled?.doc.moduleSemanticAnalysis?.definitions
      .find((definition) => definition.name === "M")?.localGeometryValues
      .find((value) => value.name === "selectedPath");
    if (!selected) throw new Error("expected the Module's selected path value");
    const program = optionsFor(evaluated.fixture).geometryValueProgram as readonly GeometryValueProgramEntry[];
    const indexedPathEntry = program.find((entry) =>
      entry.sourceStatementId === selected.statementId && entry.occurrence.instancePath.length === 1
    );
    expect(indexedPathEntry?.construction).toMatchObject({
      kind: "reference",
      target: {
        kind: "geometryInputTarget",
        geometryType: "path",
        target: { kind: "collectionIndex" }
      }
    });

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(pathValuesForInstances(payload).find((entry) =>
        entry.occurrence.sourceStatementId === selected.statementId &&
        entry.occurrence.instancePath.length === 1 &&
        entry.value.kind === "polyline" && entry.value.length === 7
      )?.value).toMatchObject({
        kind: "polyline",
        length: 7,
        segments: [
          { start: { x: 0, y: 0 }, end: { x: 0, y: 3 }, length: 3 },
          { start: { x: 0, y: 3 }, end: { x: 4, y: 3 }, length: 4 }
        ]
      });
    }
  }, 60_000);

  it("keeps the no-carry Module path parameter control correct", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "module M(input: path) {",
      "  export const length: number = @input.length",
      "}",
      "const seed: path = polyline(points: [(0, 0), (3, 0), (3, 4)], closed: false)",
      "instance A = M(input: @seed)",
      "const result: number = @A::length"
    ].join("\n"));
    expect(geometryCarriesFor(evaluated.fixture)).toEqual([]);
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      const result = scalarFor(evaluated.fixture, payload, "result");
      expect(result).toMatchObject({ status: "ok" });
      if (result?.status !== "ok" || result.value.kind !== "number") {
        throw new Error("expected no-carry Module path length to evaluate as a number");
      }
      expect(result.value.value).toBeCloseTo(7, 10);
    }
  }, 60_000);

  it("preserves a selected Module input stage and observable carry endpoints", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "module M() {",
      "  line Staged = segment(start: (1, 2), end: (4, 6))",
      "  move Staged as shifted (from: (1, 2), to: (10, 20))",
      "  for i in range(min: 0, max: 0, step: 1) carry p: path = @Staged.shifted {",
      "    next p = @Staged.shifted",
      "  }",
      "  export const length: number = @p.length",
      "  export const startX: number = @p.start.x",
      "  export const endY: number = @p.end.y",
      "}",
      "instance A = M()",
      "const resultLength: number = @A::length",
      "const resultStart: number = @A::startX",
      "const resultEnd: number = @A::endY"
    ].join("\n"));

    const [carry] = expectPathCarryTargets(evaluated.fixture);
    expect(carry?.initializerTarget).toMatchObject({ geometryType: "path", stagePath: ["shifted"] });
    expect(carry?.nextTarget).toMatchObject({ geometryType: "path", stagePath: ["shifted"] });

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      const startX = scalarFor(evaluated.fixture, payload, "resultStart");
      const endY = scalarFor(evaluated.fixture, payload, "resultEnd");
      expect(startX).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
      expect(endY).toMatchObject({ status: "ok", value: { kind: "number", value: 24 } });
      expect(scalarFor(evaluated.fixture, payload, "resultLength")).toMatchObject({
        status: "ok", value: { kind: "number", value: 5 }
      });
    }
  }, 60_000);
});
