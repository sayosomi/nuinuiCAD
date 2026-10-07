import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const scalarFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  payload: EvaluationPayload,
  name: string
) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding ${name} not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

describe("SAY-473 nested collection carry propagation through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("matches the TypeScript reference for nested direct and named collection carries", async () => {
    const cases = [
      {
        name: "reduced nested collection carry",
        source: [
          "nui 1",
          "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = [1] {",
          "for j in range(min: 0, max: 0, step: 1) carry inner: number[] = @outer {",
          "next inner = [2]",
          "}",
          "next outer = @inner",
          "}",
          "const result: number = @outer[0]"
        ].join("\n")
      },
      {
        name: "named collection replacement",
        source: [
          "nui 1",
          "const initial: number[] = [1]",
          "const replacement: number[] = [2]",
          "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = @initial {",
          "  for j in range(min: 0, max: 0, step: 1) carry inner: number[] = @outer {",
          "    next inner = @replacement",
          "  }",
          "  next outer = @inner",
          "}",
          "const result: number = @outer[0]"
        ].join("\n")
      }
    ];

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source);
      expect(fixture.compiled!.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), testCase.name).toEqual(normalizeParityPayload(tsPayload));

      expect(evaluationPayloadToResult(tsPayload).errors, testCase.name).toEqual([]);
      expect(evaluationPayloadToResult(rustPayload).errors, testCase.name).toEqual([]);
      for (const payload of [tsPayload, rustPayload]) {
        expect(scalarFor(fixture, payload, "result"), testCase.name).toMatchObject({
          status: "ok",
          value: { kind: "number", value: 2 }
        });
      }
    }
  }, 60_000);
});
