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

describe("SAY-476 root collection-if iteration binding through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("matches the TypeScript reference for the reduced collection-if reproducer and a renamed asymmetric case", async () => {
    const cases = [
      {
        name: "reduced root collection-if inside statement-for",
        source: [
          "nui 1",
          "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] {",
          "  const selected: number[] = if (@i == 0) { [2] } else { [3] }",
          "  next a = @selected",
          "}",
          "const result: number = @a[0]"
        ].join("\n"),
        expected: 2
      },
      {
        name: "renamed and padded asymmetric collection branches",
        source: [
          "nui 1",
          "// inert source padding",
          "",
          "const unrelated: number = 99",
          "for stepIndex in range(min: 0, max: 2, step: 1) carry escaped: number[] = [0] {",
          "  const branchItems: number[] = if (@stepIndex == 2) { [8, 9] } else { [3, 4, 5] }",
          "  next escaped = @branchItems",
          "}",
          "const finalItem: number = @escaped[0]"
        ].join("\n"),
        expected: 8
      }
    ];

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source);
      const compiled = fixture.compiled?.doc;
      if (!compiled) throw new Error(`${testCase.name}: expected a compiled fixture`);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), testCase.name).toEqual(normalizeParityPayload(tsPayload));

      const tsResult = evaluationPayloadToResult(tsPayload);
      const rustResult = evaluationPayloadToResult(rustPayload);
      expect(tsResult.errors, testCase.name).toEqual([]);
      expect(rustResult.errors, testCase.name).toEqual([]);
      for (const payload of [tsPayload, rustPayload]) {
        expect(scalarFor(fixture, payload, testCase.name === "reduced root collection-if inside statement-for" ? "result" : "finalItem"), testCase.name).toMatchObject({
          status: "ok",
          value: { kind: "number", value: testCase.expected }
        });
      }
    }
  }, 60_000);
});
