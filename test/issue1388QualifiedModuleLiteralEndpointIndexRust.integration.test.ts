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

const retainedC39 = `nui 1
const result: number = lineAngle(@Use::out[1].start, @Axis.end)
line Axis = segment(start: (30, 30), end: (40, 30))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selected: number = 1
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)`;

const retainedC40 = `nui 1
line Axis = segment(start: (30, 30), end: (40, 30))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selected: number = 1
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)
const result: number = lineAngle(@Use::out[1].start, @Axis.end)`;

const retainedC39WithReversedEndpointDeclarations = retainedC39.replace(
  "line Axis = segment(start: (30, 30), end: (40, 30))\nline Diagonal = segment(start: (0, 0), end: (10, 10))",
  "line Diagonal = segment(start: (0, 0), end: (10, 10))\nline Axis = segment(start: (30, 30), end: (40, 30))"
);

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

const callsNamed = (value: unknown, name: string): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => callsNamed(entry, name));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "call" && record.name === name ? [record] : []),
    ...Object.values(record).flatMap((entry) => callsNamed(entry, name))
  ];
};

const expectScalar = (
  fixture: Fixture,
  payload: EvaluationPayload,
  name: string,
  expected: { status: "ok"; value: { kind: "number"; value: number } } | { status: "error"; issueCode: string }
) => expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(rootBindingFor(fixture, name).id)).toMatchObject(expected);

describe("Issue #1388 qualified Module literal endpoint indexes through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it.each([
    ["c39 early declaration", retainedC39],
    ["c40 late declaration", retainedC40],
    ["c39 with reversed endpoint declarations", retainedC39WithReversedEndpointDeclarations]
  ])("types and evaluates the retained %s program", async (_label, source) => {
    const fixture = fixtureFromSource(source);
    expectAccepted(fixture, `Issue #1388 ${_label} compiler diagnostics`);
    expect(isRustEligibleFixture(fixture), `Issue #1388 ${_label} Rust host eligibility`).toBe(true);

    const call = rootLineAngleCallFor(fixture, "result");
    expect(call.type).toEqual({ kind: "number" });
    expect(call.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: {
        kind: "geometryCollectionIndex",
        collectionLength: null,
        index: { kind: "numberLiteral", value: 1, type: { kind: "number" } }
      }
    });
    const endpoint = call.args[0];
    if (endpoint.kind !== "geometryEndpoint" || endpoint.target?.kind !== "geometryCollectionIndex") {
      throw new Error("qualified Module collection endpoint target missing");
    }
    const instance = fixture.compiled?.doc.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === "Use");
    if (!instance) throw new Error("Module instance Use not found");
    const expectedCollectionId = JSON.stringify(["module-array-export", instance.statementId, "out"]);
    expect(endpoint.target.collectionValueId).toBe(expectedCollectionId);
    expect(endpoint.target.statementId).toBe(expectedCollectionId);
    expect(endpoint.target.index).toMatchObject({ kind: "numberLiteral", value: 1, type: { kind: "number" } });
    expect(call.args[1]).toMatchObject({ kind: "geometryEndpoint", endpointKey: "end" });

    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const serializedCalls = callsNamed(rustInput, "lineAngle");
    expect(serializedCalls).toHaveLength(1);
    expect(serializedCalls[0]).toMatchObject({
      type: { kind: "number" },
      args: [
        {
          kind: "geometryEndpoint",
          endpointKey: "start",
          target: {
            kind: "geometryCollectionIndex",
            statementId: expectedCollectionId,
            collectionValueId: expectedCollectionId,
            collectionLength: null,
            index: { kind: "numberLiteral", value: 1, type: { kind: "number" } }
          }
        },
        { kind: "geometryEndpoint", endpointKey: "end" }
      ]
    });

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "actual production persistent Rust stdio parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      expectScalar(fixture, payload, "result", { status: "ok", value: { kind: "number", value: 45 } });
    }
  }, 120_000);

  it("preserves per-instance and nested qualified indexes and reports an invalid literal index at runtime", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]",
      "const selectors: number[] = [1]",
      "module Forward(paths: path[]) {",
      "  export const out: path[] = @paths",
      "}",
      "instance UseA = Forward(paths: @Paths)",
      "instance UseB = Forward(paths: @Paths)",
      "const literalA: number = lineAngle(@UseA::out[1].start, @Axis.end)",
      "const literalB: number = lineAngle(@UseB::out[1].start, @Axis.end)",
      "const nested: number = lineAngle(@UseA::out[@selectors[0]].start, @Axis.end)",
      "const invalidLiteral: number = lineAngle(@UseA::out[2].start, @Axis.end)"
    ].join("\n"));
    expectAccepted(fixture, "Issue #1388 per-instance and nested-index compiler diagnostics");
    expect(isRustEligibleFixture(fixture), "Issue #1388 per-instance Rust host eligibility").toBe(true);

    const literalA = rootLineAngleCallFor(fixture, "literalA").args[0];
    const literalB = rootLineAngleCallFor(fixture, "literalB").args[0];
    const nested = rootLineAngleCallFor(fixture, "nested").args[0];
    const invalidLiteral = rootLineAngleCallFor(fixture, "invalidLiteral").args[0];
    for (const endpoint of [literalA, literalB, nested, invalidLiteral]) {
      expect(endpoint).toMatchObject({ kind: "geometryEndpoint", endpointKey: "start", target: { kind: "geometryCollectionIndex" } });
    }
    if (literalA.kind !== "geometryEndpoint" || literalA.target?.kind !== "geometryCollectionIndex" ||
      literalB.kind !== "geometryEndpoint" || literalB.target?.kind !== "geometryCollectionIndex" ||
      nested.kind !== "geometryEndpoint" || nested.target?.kind !== "geometryCollectionIndex" ||
      invalidLiteral.kind !== "geometryEndpoint" || invalidLiteral.target?.kind !== "geometryCollectionIndex") {
      throw new Error("qualified collection endpoint targets missing");
    }
    expect(literalA.target.collectionValueId).not.toBe(literalB.target.collectionValueId);
    expect(literalA.target.index).toMatchObject({ kind: "numberLiteral", value: 1, type: { kind: "number" } });
    expect(nested.target.index?.kind).toBe("collectionIndex");
    expect(invalidLiteral.target.index).toMatchObject({ kind: "numberLiteral", value: 2, type: { kind: "number" } });
    for (const name of ["literalA", "literalB", "nested", "invalidLiteral"] as const) {
      expect(rootLineAngleCallFor(fixture, name).type).toEqual({ kind: "number" });
    }

    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const serializedCalls = callsNamed(rustInput, "lineAngle");
    expect(serializedCalls).toHaveLength(4);
    expect(serializedCalls.every((call) => (call.type as { kind?: string } | null)?.kind === "number")).toBe(true);
    expect(JSON.stringify(serializedCalls)).toContain("module-array-export");
    expect(JSON.stringify(serializedCalls)).toContain('"value":2');

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "actual production persistent Rust stdio parity including invalid index").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(runtimeDiagnosticsFor(fixture, payload).filter((diagnostic) => diagnostic.bindingId !== rootBindingFor(fixture, "invalidLiteral").id)).toEqual([]);
      expectScalar(fixture, payload, "literalA", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "literalB", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "nested", { status: "ok", value: { kind: "number", value: 45 } });
      expectScalar(fixture, payload, "invalidLiteral", { status: "error", issueCode: "evaluation-collection-index-invalid" });
    }
  }, 120_000);
});
