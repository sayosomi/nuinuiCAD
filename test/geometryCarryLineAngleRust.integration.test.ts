import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moduleScalarBindingIdFor } from "@nuinuicad/nui-language";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Fixture = ReturnType<typeof fixtureFromSource>;

const rootBindingFor = (fixture: Fixture, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding || binding.kind !== "typed") throw new Error(`typed binding ${name} not found`);
  return binding;
};

const moduleOutputFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`Module instance ${instanceName} not found`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`Module output ${instanceName}::${outputName} not found`);
  return {
    scalar,
    bindingId: moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId)
  };
};

const moduleLineAngleCallFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const bindingId = moduleOutputFor(fixture, instanceName, outputName).bindingId;
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`lineAngle initializer for ${instanceName}::${outputName} not found`);
  }
  return initializer;
};

const moduleScalarInitializerFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const bindingId = moduleOutputFor(fixture, instanceName, outputName).bindingId;
  return fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
};

const rootLineAngleCallFor = (fixture: Fixture, name: string) => {
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === rootBindingFor(fixture, name).id
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`lineAngle initializer for ${name} not found`);
  }
  return initializer;
};

const geometryCarriesFor = (fixture: Fixture) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const expectAccepted = (fixture: Fixture, label: string) => {
  expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), label).toEqual([]);
};

const expectScalar = (
  fixture: Fixture,
  payload: EvaluationPayload,
  bindingId: string,
  expected: { status: "ok"; value: { kind: "number"; value: number } } | { status: "error"; issueCode: string },
  label: string
) => {
  expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId), label).toMatchObject(expected);
};

const expectRootNumber = (fixture: Fixture, payload: EvaluationPayload, name: string, expected: number) =>
  expectScalar(fixture, payload, rootBindingFor(fixture, name).id, {
    status: "ok", value: { kind: "number", value: expected }
  }, `root scalar ${name}`);

const geometryEndpointArgumentsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(geometryEndpointArgumentsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "geometryEndpoint" ? [record] : []),
    ...Object.values(record).flatMap(geometryEndpointArgumentsIn)
  ];
};

describe("Issue #1381 TypeScript geometry-carry lineAngle resolution through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("resolves the Issue module carry and preserves root, parameter, property, and per-instance values", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "curve Curve25 = bezier(start: (0, 0), end: (20, 5), startAngle: 25, startLength: 12, endAngle: 145, endLength: 8)",
      "curve Curve40 = bezier(start: (0, 0), end: (20, 5), startAngle: 40, startLength: 12, endAngle: 145, endLength: 8)",
      "module Measure(source: path) {",
      "  line LocalAxis = segment(start: (30, 30), end: (40, 30))",
      "  const ticks: number[] = [1]",
      "  for i in @ticks carry edge: path = @source {",
      "    next edge = @source",
      "  }",
      "  export const result: number = lineAngle(@edge.start, @LocalAxis.start)",
      "  export const parameterControl: number = lineAngle(@source.start, @LocalAxis.start)",
      "  export const propertyControl: number = @edge.startAngleDeg",
      "}",
      "instance Use = Measure(source: @Curve25)",
      "instance Use40 = Measure(source: @Curve40)",
      "const result: number = @Use::result",
      "const result40: number = @Use40::result",
      "const parameterControl: number = @Use::parameterControl",
      "const propertyControl: number = @Use::propertyControl",
      "const rootTicks: number[] = [1]",
      "for i in @rootTicks carry rootEdge: path = @Curve25 {",
      "  next rootEdge = @Curve25",
      "}",
      "const rootCarryAngle: number = lineAngle(@rootEdge.start, @Axis.start)",
      "const rootPropertyAngle: number = @rootEdge.startAngleDeg"
    ].join("\n"));
    expectAccepted(fixture, "Issue #1381 carry lineAngle source");
    expect(isRustEligibleFixture(fixture), "Issue #1381 Rust host eligibility").toBe(true);

    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    for (const instanceName of ["Use", "Use40"] as const) {
      const call = moduleLineAngleCallFor(fixture, instanceName, "result");
      expect(call.args[0]).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey: "start",
        target: { kind: "geometryCarry", bindingId: expect.any(String), geometryType: "path" }
      });
      const carried = call.args[0];
      if (carried.kind !== "geometryEndpoint" || carried.target?.kind !== "geometryCarry") {
        throw new Error(`Module carry identity missing for ${instanceName}`);
      }
      expect(geometryEndpointArgumentsIn(rustInput)).toContainEqual(carried);
      const parameterCall = moduleLineAngleCallFor(fixture, instanceName, "parameterControl");
      const sourceElement = fixture.elements.find((element) => element.name === (instanceName === "Use" ? "Curve25" : "Curve40"));
      expect(parameterCall.args[0]).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey: "start",
        target: { statementId: sourceElement?.id, geometryType: "path" }
      });
      expect(parameterCall.args[0]).not.toMatchObject({ target: { kind: "geometryCarry" } });
      const propertyBinding = moduleScalarInitializerFor(fixture, instanceName, "propertyControl");
      expect(propertyBinding).toMatchObject({
        kind: "geometryProperty",
        property: "startAngleDeg",
        geometryCarryBindingId: carried.target.bindingId
      });
    }

    const carriedIds = ["Use", "Use40"].map((instanceName) => {
      const argument = moduleLineAngleCallFor(fixture, instanceName, "result").args[0];
      return argument.kind === "geometryEndpoint" && argument.target?.kind === "geometryCarry"
        ? argument.target.bindingId
        : null;
    });
    expect(new Set(carriedIds).size).toBe(2);

    const rootCall = rootLineAngleCallFor(fixture, "rootCarryAngle");
    expect(rootCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { kind: "geometryCarry", geometryType: "path", bindingId: expect.any(String) }
    });
    expect(geometryEndpointArgumentsIn(rustInput)).toContainEqual(rootCall.args[0]);
    const rootCarryId = rootCall.args[0].kind === "geometryEndpoint" && rootCall.args[0].target?.kind === "geometryCarry"
      ? rootCall.args[0].target.bindingId
      : null;
    expect(rootCarryId).not.toBeNull();
    expect(new Set([...carriedIds, rootCarryId])).toEqual(new Set(geometryCarriesFor(fixture).map((carry) => carry.bindingId)));

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "persistent Rust stdio parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      for (const [name, value] of Object.entries({
        result: 25,
        result40: 40,
        parameterControl: 25,
        propertyControl: 25,
        rootCarryAngle: 25,
        rootPropertyAngle: 25
      })) expectRootNumber(fixture, payload, name, value);
      for (const [instanceName, value] of [["Use", 25], ["Use40", 40]] as const) {
        expectScalar(fixture, payload, moduleOutputFor(fixture, instanceName, "result").bindingId, {
          status: "ok", value: { kind: "number", value }
        }, `${instanceName}::result`);
        expectScalar(fixture, payload, moduleOutputFor(fixture, instanceName, "parameterControl").bindingId, {
          status: "ok", value: { kind: "number", value }
        }, `${instanceName}::parameterControl`);
        expectScalar(fixture, payload, moduleOutputFor(fixture, instanceName, "propertyControl").bindingId, {
          status: "ok", value: { kind: "number", value }
        }, `${instanceName}::propertyControl`);
      }
    }
  }, 120_000);

  it("preserves missing, disabled, and zero-tangent carry failures without returning zero", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (0, 0), end: (10, 0))",
      "line Missing = segment(start: (0, 0), end: (1 / 0, 0))",
      "line Disabled = segment(start: (0, 0), end: (10, 0), enabled: false)",
      "line Zero = segment(start: (3, 4), end: (3, 4))",
      "const empty: number[] = []",
      "for n in @empty carry missingCarry: line = @Missing carry disabledCarry: line = @Disabled carry zeroCarry: line = @Zero {",
      "  next missingCarry = @missingCarry",
      "  next disabledCarry = @disabledCarry",
      "  next zeroCarry = @zeroCarry",
      "}",
      "const missingAngle: number = lineAngle(@missingCarry.start, @Axis.start)",
      "const disabledAngle: number = lineAngle(@disabledCarry.start, @Axis.start)",
      "const disabledDirectAngle: number = lineAngle(@Disabled.start, @Axis.start)",
      "const zeroAngle: number = lineAngle(@zeroCarry.start, @Axis.start)"
    ].join("\n"));
    expectAccepted(fixture, "unavailable and undefined carried tangent source");
    expect(isRustEligibleFixture(fixture), "failure fixture Rust host eligibility").toBe(true);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "unavailable carry parity").toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const expectedIssues = {
        missingAngle: "evaluation-geometry-builtin-unavailable",
        disabledAngle: "evaluation-geometry-builtin-unavailable",
        disabledDirectAngle: "evaluation-geometry-builtin-disabled",
        zeroAngle: "evaluation-geometry-endpoint-tangent-unavailable"
      } as const;
      for (const [name, issueCode] of Object.entries(expectedIssues)) {
        const bindingId = rootBindingFor(fixture, name).id;
        expectScalar(fixture, payload, bindingId, { status: "error", issueCode }, name);
        expect(runtimeDiagnosticsFor(fixture, payload)).toContainEqual(expect.objectContaining({
          origin: "runtime",
          severity: "error",
          code: issueCode,
          bindingId
        }));
        expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId)).not.toMatchObject({
          status: "ok",
          value: { kind: "number", value: 0 }
        });
      }
    }
  }, 120_000);
});
