import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const bindingIdForName = (fixture: ReturnType<typeof fixtureFromSource>, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return binding.id;
};

const scalarNumberById = (payload: EvaluationPayload, bindingId: string) => {
  const evaluation = evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId);
  expect(evaluation?.status).toBe("ok");
  if (evaluation?.status !== "ok" || evaluation.value.kind !== "number") {
    throw new Error(`expected ${bindingId} to be a numeric scalar success, got ${JSON.stringify(evaluation)}`);
  }
  return evaluation.value.value;
};

const scalarNumber = (fixture: ReturnType<typeof fixtureFromSource>, payload: EvaluationPayload, name: string) =>
  scalarNumberById(payload, bindingIdForName(fixture, name));

const referencedBindingId = (
  fixture: ReturnType<typeof fixtureFromSource>,
  options: ReturnType<typeof optionsFor>,
  name: string
) => {
  const bindingId = bindingIdForName(fixture, name);
  const initializer = options.bindingVersions?.versions.find((version) => version.bindingId === bindingId)?.initializer;
  if (initializer?.kind !== "reference" || !initializer.bindingId) {
    throw new Error(`expected ${name} to reference an exported scalar`);
  }
  return initializer.bindingId;
};

describe("SAY-467 pending Module scalar prerequisites over persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("preserves the reduced reproducer and existing source-order controls", async () => {
    const cases = [
      {
        name: "scalar consumer authored before its geometry prerequisite",
        expectMeasured: true,
        source: [
          "nui 1",
          "module M() {",
          "  const measured: number = @L.length",
          "  export const value: number = @measured",
          "  line L = segment(start: (0, 0), end: (5, 0))",
          "}",
          "instance A = M()",
          "const result: number = @A::value"
        ].join("\n")
      },
      {
        name: "producer-first control",
        expectMeasured: true,
        source: [
          "nui 1",
          "module M() {",
          "  line L = segment(start: (0, 0), end: (5, 0))",
          "  const measured: number = @L.length",
          "  export const value: number = @measured",
          "}",
          "instance A = M()",
          "const result: number = @A::value"
        ].join("\n")
      },
      {
        name: "direct forward geometry-property control",
        expectMeasured: false,
        source: [
          "nui 1",
          "module M() {",
          "  export const value: number = @L.length",
          "  line L = segment(start: (0, 0), end: (5, 0))",
          "}",
          "instance A = M()",
          "const result: number = @A::value"
        ].join("\n")
      }
    ];

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source);
      if (!fixture.compiled) throw new Error(`expected compiled ${testCase.name} fixture`);
      const options = optionsFor(fixture);
      const valueBindingId = referencedBindingId(fixture, options, "result");
      expect(fixture.compiled.doc.diagnostics, testCase.name).toEqual([]);
      expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), testCase.name).toEqual(normalizeParityPayload(tsPayload));

      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors, testCase.name).toEqual([]);
        expect(JSON.stringify(payload), testCase.name).not.toContain("evaluation-binding-unavailable");
        expect(runtimeDiagnosticsFor(fixture, payload), testCase.name).toEqual([]);
        if (testCase.expectMeasured) {
          expect(scalarNumber(fixture, payload, "measured"), testCase.name).toBeCloseTo(5, 10);
        }
        expect(scalarNumberById(payload, valueBindingId), testCase.name).toBeCloseTo(5, 10);
        expect(scalarNumber(fixture, payload, "result"), testCase.name).toBeCloseTo(5, 10);
      }
    }
  }, 30000);

  it("waits for a pending scalar reached through the selected lazy value branch", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(flag: boolean) {",
      "  const measured: number = @L.length",
      "  export const value: number = if (@flag) { @measured } else { 17 }",
      "  line L = segment(start: (0, 0), end: (5, 0))",
      "}",
      "instance A = M(flag: true)",
      "const result: number = @A::value"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled selected lazy Module fixture");
    const options = optionsFor(fixture);
    const valueBindingId = referencedBindingId(fixture, options, "result");
    expect(fixture.compiled.doc.diagnostics).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain("evaluation-binding-unavailable");
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      expect(scalarNumber(fixture, payload, "measured")).toBeCloseTo(5, 10);
      expect(scalarNumberById(payload, valueBindingId)).toBeCloseTo(5, 10);
      expect(scalarNumber(fixture, payload, "result")).toBeCloseTo(5, 10);
    }
  }, 30000);
});
