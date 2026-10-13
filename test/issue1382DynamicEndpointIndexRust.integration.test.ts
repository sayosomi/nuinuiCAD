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

const rootLineAngleCallFor = (fixture: Fixture, name: string) => {
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === rootBindingFor(fixture, name).id
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`lineAngle initializer for ${name} not found`);
  }
  return initializer;
};

const moduleOutputBindingIdFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`Module instance ${instanceName} not found`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`Module output ${instanceName}::${outputName} not found`);
  return moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId);
};

const moduleLineAngleCallFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const bindingId = moduleOutputBindingIdFor(fixture, instanceName, outputName);
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`lineAngle initializer for ${instanceName}::${outputName} not found`);
  }
  return initializer;
};

const expectAccepted = (fixture: Fixture, label: string) => {
  expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), label).toEqual([]);
};

const expectScalar = (
  fixture: Fixture,
  payload: EvaluationPayload,
  name: string,
  expected: { status: "ok"; value: { kind: "number"; value: number } } | { status: "error"; issueCode: string }
) => expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(rootBindingFor(fixture, name).id)).toMatchObject(expected);

describe("Issue #1382 dynamic geometry endpoint indexes through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("evaluates runtime, expression, literal, and zero indexes without losing the selected member", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]",
      "const PathsAlias: path[] = @Paths",
      "const selected: number = 1",
      "const selectedZero: number = 0",
      "const dynamicResult: number = lineAngle(@Paths[@selected].start, @Axis.end)",
      "const expressionResult: number = lineAngle(@Paths[@selected + 0].start, @Axis.end)",
      "const literalResult: number = lineAngle(@Paths[1].start, @Axis.end)",
      "const zeroResult: number = lineAngle(@Paths[0].start, @Axis.end)",
      "const aliasResult: number = lineAngle(@PathsAlias[@selected].start, @Axis.end)",
      "module Measure(paths: path[], selected: number, axis: line) {",
      "  const LocalPaths: path[] = @paths",
      "  const LocalSelected: number = @selected",
      "  export const result: number = lineAngle(@LocalPaths[@LocalSelected].start, @axis.end)",
      "  export const outputPaths: path[] = @LocalPaths",
      "}",
      "instance Use = Measure(paths: @Paths, selected: @selected, axis: @Axis)",
      "instance UseZero = Measure(paths: @Paths, selected: 0, axis: @Axis)",
      "const moduleResult: number = @Use::result",
      "const moduleZeroResult: number = @UseZero::result",
      "const qualifiedResult: number = lineAngle(@Use::outputPaths[@selected].start, @Axis.end)",
      "const qualifiedZeroResult: number = lineAngle(@UseZero::outputPaths[@selectedZero].start, @Axis.end)"
    ].join("\n"));
    expectAccepted(fixture, "Issue #1382 root geometry collection source");
    expect(isRustEligibleFixture(fixture), "Issue #1382 Rust host eligibility").toBe(true);

    const selectedBindingId = rootBindingFor(fixture, "selected").id;
    for (const [name, call] of [
      ["dynamicResult", rootLineAngleCallFor(fixture, "dynamicResult")],
      ["expressionResult", rootLineAngleCallFor(fixture, "expressionResult")],
      ["aliasResult", rootLineAngleCallFor(fixture, "aliasResult")]
    ] as const) {
      const argument = call.args[0];
      expect(argument).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey: "start",
        target: {
          kind: "geometryCollectionIndex",
          collectionValueId: expect.any(String),
          collectionLength: 2,
          targetSourceOrder: expect.any(Number)
        }
      });
      if (argument.kind !== "geometryEndpoint" || argument.target?.kind !== "geometryCollectionIndex") {
        throw new Error(`dynamic collection endpoint target missing for ${name}`);
      }
      expect(JSON.stringify(argument.target.index)).toContain(selectedBindingId);
    }
    const literalTarget = rootLineAngleCallFor(fixture, "literalResult").args[0];
    if (literalTarget.kind !== "geometryEndpoint" || literalTarget.target?.kind === "geometryCollectionIndex") {
      throw new Error("A statically resolvable literal endpoint must keep its existing static target");
    }
    expect(literalTarget.endpointKey).toBe("start");
    for (const instanceName of ["Use", "UseZero"] as const) {
      const argument = moduleLineAngleCallFor(fixture, instanceName, "result").args[0];
      expect(argument).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey: "start",
        target: {
          kind: "geometryCollectionIndex",
          collectionValueId: expect.any(String),
          targetSourceOrder: expect.any(Number)
        }
      });
      if (argument.kind !== "geometryEndpoint" || argument.target?.kind !== "geometryCollectionIndex") {
        throw new Error(`dynamic collection endpoint target missing for ${instanceName}`);
      }
      expect(argument.target.collectionLength).toBeNull();
    }
    const useTarget = moduleLineAngleCallFor(fixture, "Use", "result").args[0];
    const useZeroTarget = moduleLineAngleCallFor(fixture, "UseZero", "result").args[0];
    expect(useTarget).toMatchObject({ target: { kind: "geometryCollectionIndex" } });
    expect(useZeroTarget).toMatchObject({ target: { kind: "geometryCollectionIndex" } });
    if (useTarget.kind !== "geometryEndpoint" || useTarget.target?.kind !== "geometryCollectionIndex" ||
      useZeroTarget.kind !== "geometryEndpoint" || useZeroTarget.target?.kind !== "geometryCollectionIndex") {
      throw new Error("Module instance dynamic endpoint identities missing");
    }
    expect(useTarget.target.collectionValueId).not.toBe(useZeroTarget.target.collectionValueId);
    const qualifiedTarget = rootLineAngleCallFor(fixture, "qualifiedResult").args[0];
    const qualifiedZeroTarget = rootLineAngleCallFor(fixture, "qualifiedZeroResult").args[0];
    expect(qualifiedTarget).toMatchObject({ target: { kind: "geometryCollectionIndex" } });
    expect(qualifiedZeroTarget).toMatchObject({ target: { kind: "geometryCollectionIndex" } });
    if (qualifiedTarget.kind !== "geometryEndpoint" || qualifiedTarget.target?.kind !== "geometryCollectionIndex" ||
      qualifiedZeroTarget.kind !== "geometryEndpoint" || qualifiedZeroTarget.target?.kind !== "geometryCollectionIndex") {
      throw new Error("Qualified Module collection endpoint identities missing");
    }
    expect(qualifiedTarget.target.collectionValueId).not.toBe(qualifiedZeroTarget.target.collectionValueId);
    const rustInput = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    expect(JSON.stringify(rustInput)).toContain("geometryCollectionIndex");
    expect(JSON.stringify(rustInput)).toContain(selectedBindingId);

    const options = optionsFor(fixture);
    expect(options.geometryCollectionNodesByValueId?.has(qualifiedTarget.target.collectionValueId)).toBe(true);
    expect(options.geometryCollectionNodesByValueId?.has(qualifiedZeroTarget.target.collectionValueId)).toBe(true);
    const rootDynamicTarget = rootLineAngleCallFor(fixture, "dynamicResult").args[0];
    if (rootDynamicTarget.kind !== "geometryEndpoint" || rootDynamicTarget.target?.kind !== "geometryCollectionIndex") {
      throw new Error("root dynamic endpoint target missing before runtime");
    }
    expect(options.geometryCollectionNodesByValueId?.has(rootDynamicTarget.target.collectionValueId)).toBe(true);
    for (const instanceName of ["Use", "UseZero"] as const) {
      const argument = moduleLineAngleCallFor(fixture, instanceName, "result").args[0];
      if (argument.kind !== "geometryEndpoint" || argument.target?.kind !== "geometryCollectionIndex") {
        throw new Error(`dynamic collection endpoint target missing for ${instanceName}`);
      }
      expect(options.geometryCollectionNodesByValueId?.has(argument.target.collectionValueId), `${instanceName} collection node`).toBe(true);
    }
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "persistent production Rust stdio parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      expectScalar(fixture, payload, "dynamicResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "expressionResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "literalResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "zeroResult", { status: "ok", value: { kind: "number", value: 0 } });
      expectScalar(fixture, payload, "aliasResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "moduleResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "moduleZeroResult", { status: "ok", value: { kind: "number", value: 0 } });
      expectScalar(fixture, payload, "qualifiedResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "qualifiedZeroResult", { status: "ok", value: { kind: "number", value: 0 } });
    }
  }, 120_000);

  it("keeps unsupported dynamic geometry-property indexing as a structured diagnostic", () => {
    const source = [
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]",
      "const selected: number = 1",
      "const angle: number = @Paths[@selected].startAngleDeg"
    ].join("\n");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "geometry-property-invalid")).toBe(true);

    const unresolvedEndpointIndex = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]",
      "const result: number = lineAngle(@Paths[@missing].start, @Axis.end)"
    ].join("\n"));
    expect(unresolvedEndpointIndex.bindingIssueDiagnostics.some((diagnostic) => diagnostic.code === "undefined-binding")).toBe(true);

    const unresolvedPropertyIndex = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]",
      "const angle: number = @Paths[@missing].startAngleDeg"
    ].join("\n"));
    expect(unresolvedPropertyIndex.bindingIssueDiagnostics.some((diagnostic) => diagnostic.code === "undefined-binding")).toBe(true);
  });

  it("reports invalid runtime indexes without fabricating a selected geometry result", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "line Disabled = segment(start: (30, 30), end: (40, 30), enabled: false)",
      "const Paths: path[] = [@Axis, @Diagonal]",
      "const DisabledPaths: path[] = [@Disabled, @Diagonal]",
      "const negative: number = -1",
      "const fractional: number = 0.5",
      "const outside: number = 2",
      "const disabledIndex: number = 0",
      "const nonFiniteIndex: number = 10 ^ 10000",
      "const negativeResult: number = lineAngle(@Paths[@negative].start, @Axis.end)",
      "const fractionalResult: number = lineAngle(@Paths[@fractional].start, @Axis.end)",
      "const outsideResult: number = lineAngle(@Paths[@outside].start, @Axis.end)",
      "const nonFiniteResult: number = lineAngle(@Paths[@nonFiniteIndex].start, @Axis.end)",
      "const unavailableGeometryResult: number = lineAngle(@DisabledPaths[@disabledIndex].start, @Axis.end)"
    ].join("\n"));
    expectAccepted(fixture, "Issue #1382 invalid dynamic index source is statically typed");
    expect(isRustEligibleFixture(fixture), "Issue #1382 invalid-index Rust host eligibility").toBe(true);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "persistent Rust invalid-index parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      for (const name of ["negativeResult", "fractionalResult", "outsideResult"] as const) {
        expectScalar(fixture, payload, name, { status: "error", issueCode: "evaluation-collection-index-invalid" });
      }
      expectScalar(fixture, payload, "nonFiniteResult", { status: "error", issueCode: "evaluation-non-finite-result" });
      expectScalar(fixture, payload, "unavailableGeometryResult", { status: "error", issueCode: "evaluation-geometry-builtin-disabled" });
    }
  }, 120_000);
});
