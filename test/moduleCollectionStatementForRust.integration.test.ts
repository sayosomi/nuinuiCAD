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

const normalizeModuleCollectionPayload = (payload: EvaluationPayload) => normalizeParityPayload({
  ...payload,
  ...(payload.computedScalarBindings
    ? {
        // Rust serializes this map from its runtime binding index; compare the
        // keyed values rather than depending on that map's insertion order.
        computedScalarBindings: [...payload.computedScalarBindings].sort((left, right) =>
          left.bindingId.localeCompare(right.bindingId)
        )
      }
    : {})
});

describe("SAY-482 Module collection statement-for sources through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("matches TypeScript for direct parameters, aliases, local collections, and empty collections", async () => {
    const cases = [
      {
        name: "reduced direct number[] parameter loop",
        source: [
          "nui 1",
          "module M(items: number[]) {",
          " for item in @items carry a: number = 0 {",
          "  next a = @a + 1",
          " }",
          " export const output: number = @a",
          "}",
          "instance A = M(items: [2])",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 1 }
      },
      {
        name: "asymmetric direct parameter instances",
        source: [
          "nui 1",
          "module M(items: number[]) {",
          " for item in @items carry count: number = 0 {",
          "  next count = @count + 1",
          " }",
          " export const output: number = @count",
          "}",
          "instance A = M(items: [10, 11])",
          "instance B = M(items: [20, 21, 22])",
          "const countA: number = @A::output",
          "const countB: number = @B::output"
        ].join("\n"),
        expected: { countA: 2, countB: 3 }
      },
      {
        name: "empty direct parameter preserves carry initialization",
        source: [
          "nui 1",
          "module M(items: number[]) {",
          " for item in @items carry count: number = 7 {",
          "  next count = @count + 1",
          " }",
          " export const output: number = @count",
          "}",
          "instance A = M(items: [])",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 7 }
      },
      {
        name: "typed local alias source reads the collection binder",
        source: [
          "nui 1",
          "module M(items: number[]) {",
          " const localItems: number[] = @items",
          " for item in @localItems carry total: number = 0 {",
          "  next total = @total + @item",
          " }",
          " export const output: number = @total",
          "}",
          "instance A = M(items: [2, 3])",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 5 }
      },
      {
        name: "Module-local collection source remains supported",
        source: [
          "nui 1",
          "module M() {",
          " const values: number[] = [2, 3]",
          " for item in @values carry total: number = 0 {",
          "  next total = @total + @item",
          " }",
          " export const output: number = @total",
          "}",
          "instance A = M()",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 5 }
      }
    ];

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source);
      expect(fixture.compiled!.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);

      expect(evaluationPayloadToResult(tsPayload).errors, testCase.name).toEqual([]);
      expect(evaluationPayloadToResult(rustPayload).errors, testCase.name).toEqual([]);
      for (const payload of [tsPayload, rustPayload]) {
        for (const [name, expected] of Object.entries(testCase.expected)) {
          expect(scalarFor(fixture, payload, name), `${testCase.name}: ${name}`).toMatchObject({
            status: "ok",
            value: { kind: "number", value: expected }
          });
        }
      }

      expect(normalizeModuleCollectionPayload(rustPayload), testCase.name).toEqual(normalizeModuleCollectionPayload(tsPayload));
    }
  }, 60_000);
});
