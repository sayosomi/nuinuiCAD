import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const forwardQualifiedNestedSource = `nui 1
const result: number = lineAngle(@Use::out[@selectors[0]].start, @Axis.end)
line Axis = segment(start: (30, 30), end: (40, 30))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selectors: number[] = [1]
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)`;

const lateQualifiedNestedSource = `nui 1
line Axis = segment(start: (30, 30), end: (40, 30))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selectors: number[] = [1]
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)
const result: number = lineAngle(@Use::out[@selectors[0]].start, @Axis.end)`;

const forwardPlainBindingSource = `nui 1
const result: number = lineAngle(@Use::out[@selector].start, @Axis.end)
line Axis = segment(start: (30, 30), end: (40, 30))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selectors: number[] = [1]
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)
const selector: number = 1`;

const forwardLiftedIndexSource = `nui 1
const result: number = lineAngle(@Use::out[@chosen].start, @Axis.end)
line Axis = segment(start: (30, 30), end: (40, 30))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selectors: number[] = [1]
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)
const chosen: number = @selectors[0]`;

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

const expectAccepted = (fixture: Fixture, label: string) => {
  expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), label).toEqual([]);
};

const expectScalar = (
  fixture: Fixture,
  payload: EvaluationPayload,
  name: string,
  expected: { status: "ok"; value: { kind: "number"; value: number } } | { status: "error"; issueCode: string }
) => expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(rootBindingFor(fixture, name).id)).toMatchObject(expected);

const callsNamed = (value: unknown, name: string): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => callsNamed(entry, name));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "call" && record.name === name ? [record] : []),
    ...Object.values(record).flatMap((entry) => callsNamed(entry, name))
  ];
};

describe("Issue #1392 forward qualified nested endpoint indexes through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it.each([
    ["retained forward qualified nested-index reproducer", forwardQualifiedNestedSource],
    ["identical late-source control", lateQualifiedNestedSource],
    ["forward plain numeric binding control", forwardPlainBindingSource],
    ["forward lifted nested-index control", forwardLiftedIndexSource]
  ])("preserves TypeScript and Rust parity for the %s", async (_label, source) => {
    const fixture = fixtureFromSource(source);
    expectAccepted(fixture, `Issue #1392 ${_label} compiler diagnostics`);
    expect(isRustEligibleFixture(fixture), `Issue #1392 ${_label} Rust host eligibility`).toBe(true);

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "production persistent Rust stdio parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      expectScalar(fixture, payload, "result", { status: "ok", value: { kind: "number", value: 45 } });
    }
  }, 120_000);

  it("preserves the qualified Module identity and nested typed index on the Rust wire", () => {
    const fixture = fixtureFromSource(forwardQualifiedNestedSource);
    expectAccepted(fixture, "Issue #1392 retained source compiler diagnostics");

    const endpoint = rootLineAngleCallFor(fixture, "result").args[0];
    if (endpoint.kind !== "geometryEndpoint" || endpoint.target?.kind !== "geometryCollectionIndex") {
      throw new Error("qualified nested geometry collection endpoint target missing");
    }
    const instance = fixture.compiled?.doc.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === "Use");
    if (!instance) throw new Error("Module instance Use not found");
    const expectedCollectionId = JSON.stringify(["module-array-export", instance.statementId, "out"]);
    const selectorBinding = rootBindingFor(fixture, "selectors");
    const selectorCollectionValueId = selectorBinding.id.replace(/^binding:/, "");

    expect(endpoint.endpointKey).toBe("start");
    expect(endpoint.target.collectionValueId).toBe(expectedCollectionId);
    expect(endpoint.target.statementId).toBe(expectedCollectionId);
    expect(endpoint.target.index).toMatchObject({
      kind: "collectionIndex",
      collectionValueId: selectorCollectionValueId,
      collectionLength: 1,
      index: { kind: "numberLiteral", value: 0, type: { kind: "number" } },
      type: { kind: "number" }
    });

    const options = optionsFor(fixture);
    expect(options.geometryCollectionNodesByValueId?.has(expectedCollectionId)).toBe(true);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const calls = callsNamed(rustInput, "lineAngle");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      args: [
        {
          kind: "geometryEndpoint",
          endpointKey: "start",
          target: {
            kind: "geometryCollectionIndex",
            statementId: expectedCollectionId,
            collectionValueId: expectedCollectionId,
            index: {
              kind: "collectionIndex",
              collectionValueId: selectorCollectionValueId,
              index: { kind: "numberLiteral", value: 0, type: { kind: "number" } }
            }
          }
        },
        { kind: "geometryEndpoint", endpointKey: "end" }
      ]
    });
    expect(rustInput.geometryCollectionNodes?.some((node) => node.collectionValueId === expectedCollectionId)).toBe(true);
  });

  it("keeps #1382 dynamic and #1388 qualified-literal results and reports invalid or unavailable indexes", async () => {
    const source = `${lateQualifiedNestedSource}\nconst literalResult: number = lineAngle(@Use::out[1].start, @Axis.end)\nconst dynamicResult: number = lineAngle(@Use::out[@selected].start, @Axis.end)\nconst selected: number = 1\nconst invalidResult: number = lineAngle(@Use::out[2].start, @Axis.end)`;
    const fixture = fixtureFromSource(source);
    expectAccepted(fixture, "Issue #1392 compatibility and diagnostic compiler diagnostics");
    expect(isRustEligibleFixture(fixture), "Issue #1392 compatibility Rust host eligibility").toBe(true);

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "#1382/#1388 compatibility parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalar(fixture, payload, "result", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "literalResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "dynamicResult", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "invalidResult", { status: "error", issueCode: "evaluation-collection-index-invalid" });
    }
    expect(runtimeDiagnosticsFor(fixture, rustPayload).map(({ bindingId, code }) => ({ bindingId, code }))).toContainEqual({
      bindingId: rootBindingFor(fixture, "invalidResult").id,
      code: "evaluation-collection-index-invalid"
    });

    const qualifiedEndpoint = rootLineAngleCallFor(fixture, "result").args[0];
    if (qualifiedEndpoint.kind !== "geometryEndpoint" || qualifiedEndpoint.target?.kind !== "geometryCollectionIndex") {
      throw new Error("qualified endpoint for unavailable-index check missing");
    }
    if (qualifiedEndpoint.target.index?.kind !== "collectionIndex") {
      throw new Error("nested selector collection identity missing for unavailable-index check");
    }
    const input = buildRustEvaluationInput(fixture.elements, options);
    if (!input.bindingVersions?.collectionValues) {
      throw new Error("compiled selector collection values missing from Rust payload");
    }
    input.bindingVersions.collectionValues = input.bindingVersions.collectionValues.filter(
      (value) => value.valueId !== qualifiedEndpoint.target.index!.collectionValueId
    );
    const unavailablePayload = await rustStdio!.evaluateInput(input);
    expectScalar(fixture, unavailablePayload, "result", {
      status: "error",
      issueCode: "evaluation-collection-index-unavailable"
    });
    expect(runtimeDiagnosticsFor(fixture, unavailablePayload).map(({ bindingId, code }) => ({ bindingId, code }))).toContainEqual({
      bindingId: rootBindingFor(fixture, "result").id,
      code: "evaluation-collection-index-unavailable"
    });
  }, 120_000);
});
