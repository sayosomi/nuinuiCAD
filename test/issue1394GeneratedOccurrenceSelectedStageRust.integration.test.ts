import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
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
const rustTargetDirectory = join(repoRoot, "rust-evaluator", "target", "issue1394-generated-occurrence-stage-endpoint");

const rootBindingId = (fixture: ReturnType<typeof fixtureFromSource>, name: string): string => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`missing root binding ${name}`);
  return binding.id;
};

const lineAngleCall = (fixture: ReturnType<typeof fixtureFromSource>, name: string) => {
  const bindingId = rootBindingId(fixture, name);
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`missing lineAngle call for ${name}`);
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

const expectNumber = (payload: EvaluationPayload, fixture: ReturnType<typeof fixtureFromSource>, name: string, expected: number) => {
  const bindingId = rootBindingId(fixture, name);
  const value = evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId);
  expect(value, name).toMatchObject({ status: "ok", value: { kind: "number" } });
  if (value?.status !== "ok" || value.value.kind !== "number") throw new Error(`invalid scalar ${name}`);
  expect(value.value.value, name).toBeCloseTo(expected, 7);
};

describe("Issue #1394 generated occurrence selected-stage lineAngle endpoint", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot, { targetDirectory: rustTargetDirectory });
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("preserves the selected occurrence and base stage through compilation and production Rust stdio", async () => {
    const source = [
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  line L = polar(start: (@i * 20, 0), angle: 25 + @i * 10, length: 10)",
      "  move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "}",
      "const result: number = lineAngle(@L[1].base.start, @Axis.start)",
      "const final: number = lineAngle(@L[1].start, @Axis.start)",
      "const occurrence: number = 1",
      "const typed: number = lineAngle(@L[@occurrence].base.start, @Axis.start)",
      "line Ordinary = polar(start: (20, 0), angle: 35, length: 10)",
      "move Ordinary as tilted (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const ordinary: number = lineAngle(@Ordinary.base.start, @Axis.start)"
    ].join("\n") + "\n";
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const referencePayload = evaluateElementsReferencePayload(fixture.elements, options);
    const productionRustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(productionRustPayload), "production persistent-Rust parity").toEqual(
      normalizeParityPayload(referencePayload)
    );
    for (const payload of [referencePayload, productionRustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
    }

    const generatedLineId = fixture.elements.find((element) => element.name === "L")?.id;
    expect(generatedLineId).toBeDefined();
    const literalEndpoint = lineAngleCall(fixture, "result").args[0];
    expect(literalEndpoint).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: {
        kind: "forGroupOccurrence",
        templateElementId: generatedLineId,
        stagePath: ["base"],
        index: { kind: "numberLiteral", value: 1, type: { kind: "number" } }
      }
    });
    expect(endpointArgumentsIn(rustInput)).toContainEqual(literalEndpoint);

    const typedEndpoint = lineAngleCall(fixture, "typed").args[0];
    expect(typedEndpoint).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: {
        kind: "forGroupOccurrence",
        templateElementId: generatedLineId,
        stagePath: ["base"],
        index: { kind: "reference", name: "occurrence", type: { kind: "number" } }
      }
    });
    expect(endpointArgumentsIn(rustInput)).toContainEqual(typedEndpoint);

    const finalEndpoint = lineAngleCall(fixture, "final").args[0];
    expect(finalEndpoint).toMatchObject({
      kind: "geometryEndpoint",
      target: {
        kind: "forGroupOccurrence",
        templateElementId: generatedLineId,
        index: { kind: "numberLiteral", value: 1, type: { kind: "number" } }
      }
    });
    expect(endpointArgumentsIn(rustInput)).toContainEqual(finalEndpoint);

    for (const payload of [referencePayload, productionRustPayload]) {
      for (const [name, expected] of Object.entries({ result: 35, typed: 35, final: 65, ordinary: 35 })) {
        expectNumber(payload, fixture, name, expected);
      }
    }
  }, 120_000);

  it("continues to reject a nonnumeric generated occurrence selector", () => {
    const invalid = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  line L = polar(start: (@i * 20, 0), angle: 25 + @i * 10, length: 10)",
      "  move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "}",
      "const occurrence: string = \"one\"",
      "const result: number = lineAngle(@L[@occurrence].base.start, @Axis.start)"
    ].join("\n"));
    expect(invalid.status).toBe("fatal");
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.severity === "error" && /index|number|numeric|型/.test(diagnostic.message))).toBe(true);
  });
});
