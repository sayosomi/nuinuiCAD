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

describe("SAY-474 Module collection carry indexing through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("matches TypeScript for single-instance self, swap, and asymmetric collection carries", async () => {
    const cases = [
      {
        name: "reduced self-carry",
        source: [
          "nui 1",
          "module M() {",
          "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] {",
          "    next a = @a",
          "  }",
          "  export const output: number = @a[0]",
          "}",
          "instance A = M()",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 1 }
      },
      {
        name: "simultaneous collection swap",
        source: [
          "nui 1",
          "module M() {",
          "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] carry b: number[] = [2] {",
          "    next a = @b",
          "    next b = @a",
          "  }",
          "  export const output: number = @a[0]",
          "}",
          "instance A = M()",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 2 }
      },
      {
        name: "asymmetric renamed collection swap",
        source: [
          "nui 1",
          "const unrelatedRoot: number = 99",
          "module CollectionBox() {",
          "  const unrelatedLocal: number = 7",
          "  for stepIndex in range(min: 0, max: 0, step: 1) carry leftItems: number[] = [10, 11] carry rightItems: number[] = [20, 21, 22] {",
          "    next leftItems = @rightItems",
          "    next rightItems = @leftItems",
          "  }",
          "  export const selected: number = @leftItems[2]",
          "  export const itemCount: number = @leftItems.length",
          "}",
          "instance RenamedInstance = CollectionBox()",
          "const result: number = @RenamedInstance::selected",
          "const count: number = @RenamedInstance::itemCount"
        ].join("\n"),
        expected: { result: 22, count: 3 }
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
        for (const [name, value] of Object.entries(testCase.expected)) {
          expect(scalarFor(fixture, payload, name), `${testCase.name}: ${name}`).toMatchObject({
            status: "ok",
            value: { kind: "number", value }
          });
        }
      }
    }
  }, 60_000);
});
