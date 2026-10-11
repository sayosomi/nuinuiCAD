import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GeometryInputTarget } from "../src/types/geometry";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor,
  type EvaluationFixture
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const reproductions = [
  {
    name: "single Module collection carry",
    source: [
      "nui 1",
      "module M() {",
      "  const seed: point[] = [(3,4)]",
      "  const ticks: number[] = [1]",
      "  for n in @ticks carry pts: point[] = @seed {",
      "    next pts = @pts",
      "  }",
      "  export line Out = segment(start: @pts[0], end: (0,0))",
      "}",
      "instance A = M()"
    ].join("\n"),
    expected: { start: { x: 3, y: 4 }, end: { x: 0, y: 0 } },
    targetIndices: { startPoint: 0 }
  },
  {
    name: "simultaneous Module collection swaps",
    source: [
      "nui 1",
      "module M() {",
      "  const first: point[] = [(2,3), (4,5)]",
      "  const second: point[] = [(8,9)]",
      "  const turns: number[] = [1,2,3]",
      "  for n in @turns carry a: point[] = @first carry b: point[] = @second {",
      "    next a = @b",
      "    next b = @a",
      "  }",
      "  export line Out = segment(start: @a[0], end: @b[1])",
      "}",
      "instance A = M()"
    ].join("\n"),
    expected: { start: { x: 8, y: 9 }, end: { x: 4, y: 5 } },
    targetIndices: { startPoint: 0, endPoint: 1 }
  }
] as const;

const consumerFor = (fixture: EvaluationFixture) => {
  const consumer = fixture.elements.find((element) => element.name === "Out" && element.type === "line");
  if (!consumer) throw new Error("compiled Module consumer Out was not materialized");
  return consumer;
};

const targetFor = (
  fixture: EvaluationFixture,
  elementId: string,
  parameterKey: string
): Extract<GeometryInputTarget, { kind: "collectionIndex" }> => {
  const target = fixture.compiled?.doc.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId
    .get(elementId)?.get(parameterKey);
  if (!target || Array.isArray(target) || target.kind !== "collectionIndex") {
    throw new Error(`compiler omitted the ${parameterKey} collection-index target`);
  }
  return target;
};

const expectSuccessfulEvaluation = (
  fixture: EvaluationFixture,
  payload: EvaluationPayload,
  expected: { start: { x: number; y: number }; end: { x: number; y: number } }
) => {
  const result = evaluationPayloadToResult(payload);
  const consumer = consumerFor(fixture);
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors ?? []).toEqual([]);
  expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
  expect(result.computedGeometry.get(consumer.id)).toMatchObject({
    kind: "line",
    start: expected.start,
    end: expected.end
  });
};

describe("SAY-512 Module geometry collection carries through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it.each(reproductions)("emits indexed consumer targets and evaluates $name in both engines", async (reproduction) => {
    const fixture = fixtureFromSource(reproduction.source);
    expect(fixture.compiled).toBeDefined();
    expect(fixture.compiled?.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const consumer = consumerFor(fixture);
    const options = optionsFor(fixture);
    const runtimeTargets = fixture.compiled!.doc.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId.get(consumer.id);
    expect(runtimeTargets).toBeDefined();
    expect([...runtimeTargets!.keys()].sort()).toEqual(Object.keys(reproduction.targetIndices).sort());
    expect(options.geometryInputTargetsByElementId?.get(consumer.id)).toEqual(runtimeTargets);

    const collectionValueIds: string[] = [];
    for (const [parameterKey, index] of Object.entries(reproduction.targetIndices)) {
      const target = targetFor(fixture, consumer.id, parameterKey);
      expect(target).toMatchObject({
        kind: "collectionIndex",
        collectionValueId: expect.stringMatching(/^carry-collection:module-binding:/),
        collectionLength: null,
        targetSourceOrder: expect.any(Number),
        index: { kind: "numberLiteral", value: index },
        members: []
      });
      collectionValueIds.push(target.collectionValueId);
      const consumerPosition = options.scalarExecutionPositionByElementId?.get(consumer.id);
      expect(consumerPosition).toEqual(expect.any(Number));
      expect(target.targetSourceOrder).toBeLessThan(consumerPosition!);
    }
    expect(new Set(collectionValueIds).size).toBe(collectionValueIds.length);

    // Assert host eligibility independently, then call the persistent Rust
    // client directly so parity does not depend on dispatch behavior.
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);

    expectSuccessfulEvaluation(fixture, tsPayload, reproduction.expected);
    expectSuccessfulEvaluation(fixture, rustPayload, reproduction.expected);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 60_000);

  it("keeps indexed collection targets and snapshots isolated across asymmetric Module instances", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(dx: number) {",
      "  point Seed = coordinate(x: @dx, y: 4)",
      "  const seed: point[] = [@Seed]",
      "  const ticks: number[] = [1]",
      "  for n in @ticks carry pts: point[] = @seed {",
      "    next pts = @pts",
      "  }",
      "  export line Out = segment(start: @pts[0], end: (0,0))",
      "}",
      "instance A = M(dx: 3)",
      "instance B = M(dx: 8)"
    ].join("\n"));
    expect(fixture.compiled?.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const outputs = fixture.elements.filter((element) => element.name === "Out" && element.type === "line");
    expect(outputs).toHaveLength(2);
    const targets = outputs.map((output) => targetFor(fixture, output.id, "startPoint"));
    expect(targets[0]!.collectionValueId).not.toBe(targets[1]!.collectionValueId);
    expect(targets.map((target) => target.collectionValueId)).toEqual([
      expect.stringMatching(/^carry-collection:module-binding:/),
      expect.stringMatching(/^carry-collection:module-binding:/)
    ]);

    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      expect(outputs.map((output) => result.computedGeometry.get(output.id))).toMatchObject([
        { kind: "line", start: { x: 3, y: 4 }, end: { x: 0, y: 0 } },
        { kind: "line", start: { x: 8, y: 4 }, end: { x: 0, y: 0 } }
      ]);
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 60_000);
});
