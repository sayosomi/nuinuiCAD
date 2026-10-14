import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument, moduleScalarBindingIdFor } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Fixture = ReturnType<typeof fixtureFromSource>;

const rootBindingId = (fixture: Fixture, name: string): string => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`missing root binding ${name}`);
  return binding.id;
};

const moduleBindingId = (fixture: Fixture, instanceName: string, outputName: string): string => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`missing instance ${instanceName}`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`missing Module output ${instanceName}::${outputName}`);
  return moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId);
};

const lineAngleCall = (fixture: Fixture, bindingId: string) => {
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`missing lineAngle call for ${bindingId}`);
  }
  return initializer;
};

const endpointArgumentsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(endpointArgumentsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "geometryEndpoint" ? [record] : []),
    ...Object.values(record).flatMap(endpointArgumentsIn)
  ];
};

const expectNumber = (payload: EvaluationPayload, bindingId: string, expected: number) => {
  const result = evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId);
  expect(result, bindingId).toMatchObject({ status: "ok", value: { kind: "number" } });
  if (result?.status !== "ok" || result.value.kind !== "number") throw new Error(`invalid scalar ${bindingId}`);
  expect(result.value.value, bindingId).toBeCloseTo(expected, 7);
};

describe("Issue #1386 alias-selected lineAngle endpoint stages", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (source: string) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "production persistent-Rust parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) expect(evaluationPayloadToResult(payload).errors).toEqual([]);
    return { fixture, rustInput, payloads: [tsPayload, rustPayload] };
  };

  it("reproduces the exact audited c19 source with independent direct and numeric-property controls", async () => {
    const { fixture, rustInput, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as turned (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const Base: path = @L.base",
      "const bad: number = lineAngle(@Base.start, @Axis.start)",
      "const direct: number = lineAngle(@L.base.start, @Axis.start)",
      "const final: number = lineAngle(@L.final.start, @Axis.start)",
      "const property: number = @Base.startAngleDeg"
    ].join("\n") + "\n");
    const lineId = fixture.elements.find((element) => element.name === "L")?.id;
    expect(lineId).toBeDefined();
    expect(fixture.compiled?.doc.geometryValueProgram?.[0]).toMatchObject({
      construction: { kind: "reference", target: { statementId: lineId, stagePath: ["base"] } }
    });
    const aliased = lineAngleCall(fixture, rootBindingId(fixture, "bad")).args[0];
    expect(aliased).toEqual({
      kind: "geometryEndpoint", endpointKey: "start", target: {
        statementId: lineId, statementIndex: 1, geometryType: "path", stagePath: ["base"]
      }
    });
    expect(endpointArgumentsIn(rustInput)).toContainEqual(aliased);
    expect(lineAngleCall(fixture, rootBindingId(fixture, "direct")).args[0]).toMatchObject({
      target: { statementId: lineId, stagePath: ["base"] }
    });
    expect(lineAngleCall(fixture, rootBindingId(fixture, "final")).args[0]).toMatchObject({
      target: { statementId: lineId, stagePath: ["final"] }
    });
    for (const payload of payloads) {
      for (const [name, expected] of Object.entries({ bad: 0, direct: 0, final: 30, property: 0 })) {
        expectNumber(payload, rootBindingId(fixture, name), expected);
      }
    }
  }, 120_000);

  it("keeps the independent materialized from(source:) control on the base stage", async () => {
    const { fixture, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as turned (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "path Base = from(source: @L.base)",
      "const bad: number = lineAngle(@Base.start, @Axis.start)",
      "const direct: number = lineAngle(@L.base.start, @Axis.start)",
      "const final: number = lineAngle(@L.final.start, @Axis.start)",
      "const property: number = @Base.startAngleDeg"
    ].join("\n"));
    const materializedId = fixture.elements.find((element) => element.name === "Base")?.id;
    expect(lineAngleCall(fixture, rootBindingId(fixture, "bad")).args[0]).toMatchObject({
      kind: "geometryEndpoint", endpointKey: "start", target: { statementId: materializedId }
    });
    for (const payload of payloads) {
      for (const [name, expected] of Object.entries({ bad: 0, direct: 0, final: 30, property: 0 })) {
        expectNumber(payload, rootBindingId(fixture, name), expected);
      }
    }
  }, 120_000);

  it("retains base, named non-final, and final stages through multiple immutable aliases", async () => {
    const { fixture, rustInput, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "move L as turned (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const Base: path = @L.base",
      "const Base2: path = @Base",
      "const Named: path = @L.tilted",
      "const Named2: path = @Named",
      "const Final: path = @L.final",
      "const baseAngle: number = lineAngle(@Base2.start, @Axis.start)",
      "const namedAngle: number = lineAngle(@Named2.start, @Axis.start)",
      "const finalAngle: number = lineAngle(@Final.start, @Axis.start)",
      "const directBase: number = lineAngle(@L.base.start, @Axis.start)",
      "const directNamed: number = lineAngle(@L.tilted.start, @Axis.start)",
      "const directFinal: number = lineAngle(@L.final.start, @Axis.start)"
    ].join("\n"));
    const lineId = fixture.elements.find((element) => element.name === "L")?.id;
    for (const [name, stagePath] of [
      ["baseAngle", ["base"]], ["namedAngle", ["tilted"]], ["finalAngle", ["final"]]
    ] as const) {
      const endpoint = lineAngleCall(fixture, rootBindingId(fixture, name)).args[0];
      expect(endpoint).toMatchObject({
        kind: "geometryEndpoint", endpointKey: "start", target: { statementId: lineId, stagePath }
      });
      expect(endpointArgumentsIn(rustInput)).toContainEqual(endpoint);
    }
    for (const payload of payloads) {
      for (const [name, expected] of Object.entries({
        baseAngle: 0, namedAngle: 15, finalAngle: 45,
        directBase: 0, directNamed: 15, directFinal: 45
      })) expectNumber(payload, rootBindingId(fixture, name), expected);
    }
  }, 120_000);

  it("forwards selected alias values through a collection and its immutable alias", async () => {
    const { fixture, rustInput, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "move L as turned (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const Base: path = @L.base",
      "const Named: path = @L.tilted",
      "const paths: path[] = [@Base, @Named]",
      "const AliasPaths: path[] = @paths",
      "const selected: number = 1",
      "const indexedBase: number = lineAngle(@paths[0].start, @Axis.start)",
      "const indexedNamed: number = lineAngle(@AliasPaths[@selected].start, @Axis.start)",
      "const directBase: number = lineAngle(@Base.start, @Axis.start)",
      "const directNamed: number = lineAngle(@Named.start, @Axis.start)"
    ].join("\n"));
    for (const name of ["indexedBase", "indexedNamed"]) {
      const endpoint = lineAngleCall(fixture, rootBindingId(fixture, name)).args[0];
      expect(endpoint).toMatchObject({
        kind: "geometryEndpoint", endpointKey: "start",
        target: { kind: "geometryCollectionIndex", collectionValueId: expect.any(String) }
      });
      expect(endpointArgumentsIn(rustInput)).toContainEqual(endpoint);
    }
    for (const payload of payloads) {
      for (const [name, expected] of Object.entries({
        indexedBase: 0, indexedNamed: 15, directBase: 0, directNamed: 15
      })) expectNumber(payload, rootBindingId(fixture, name), expected);
    }
  }, 120_000);

  it("forwards selected aliases through Module parameters and Module-local aliases", async () => {
    const { fixture, rustInput, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "move L as turned (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const Base: path = @L.base",
      "const Named: path = @L.tilted",
      "module Measure(source: path) {",
      "  line LocalAxis = segment(start: (0, 0), end: (10, 0))",
      "  const Local: path = @source",
      "  export const value: number = lineAngle(@Local.start, @LocalAxis.start)",
      "}",
      "instance UseBase = Measure(source: @Base)",
      "instance UseNamed = Measure(source: @Named)",
      "const moduleBase: number = @UseBase::value",
      "const moduleNamed: number = @UseNamed::value"
    ].join("\n"));
    const lineId = fixture.elements.find((element) => element.name === "L")?.id;
    for (const [instanceName, stagePath] of [["UseBase", ["base"]], ["UseNamed", ["tilted"]]] as const) {
      const endpoint = lineAngleCall(fixture, moduleBindingId(fixture, instanceName, "value")).args[0];
      expect(endpoint).toMatchObject({
        kind: "geometryEndpoint", endpointKey: "start", target: { statementId: lineId, stagePath }
      });
      expect(endpointArgumentsIn(rustInput)).toContainEqual(endpoint);
    }
    for (const payload of payloads) {
      expectNumber(payload, rootBindingId(fixture, "moduleBase"), 0);
      expectNumber(payload, rootBindingId(fixture, "moduleNamed"), 15);
    }
  }, 120_000);

  it("keeps invalid endpoint arguments diagnostic instead of lowering a final-stage fallback", () => {
    const source = [
      "nui 1",
      "line Axis = segment(start: (0, 0), end: (10, 0))",
      "point P = coordinate(x: 0, y: 0)",
      "const missing: number = lineAngle(@Missing.start, @Axis.start)",
      "const oldForm: number = lineAngle(@Axis, @Axis.start)",
      "const unsupported: number = lineAngle(@P.start, @Axis.start)",
      "const wrongMember: number = lineAngle(@Axis.middle, @Axis.start)"
    ].join("\n");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    expect(compiled.status).toBe("fatal");
    expect(compiled.diagnostics.filter((diagnostic) =>
      diagnostic.severity === "error" && diagnostic.code === "builtin-geometry-argument-invalid"
    )).toHaveLength(4);
  });
});
