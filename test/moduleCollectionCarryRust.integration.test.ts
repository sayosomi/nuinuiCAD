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
        name: "direct Module parameter self-carry with inline literal argument",
        source: [
          "nui 1",
          "module M(items: number[]) {",
          "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
          "    next a = @a",
          "  }",
          "  export const output: number = @a[0]",
          "}",
          "instance A = M(items: [1])",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 1 }
      },
      {
        name: "direct Module parameter shadows same-named root collection",
        source: [
          "nui 1",
          "const items: number[] = [99]",
          "module M(items: number[]) {",
          "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
          "    next a = @a",
          "  }",
          "  export const output: number = @a[0]",
          "}",
          "instance A = M(items: [1])",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 1 }
      },
      {
        name: "direct Module parameter self-carry with named root collection argument",
        source: [
          "nui 1",
          "const initial: number[] = [5, 6]",
          "module M(items: number[]) {",
          "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
          "    next a = @a",
          "  }",
          "  export const output: number = @a[1]",
          "}",
          "instance A = M(items: @initial)",
          "const result: number = @A::output"
        ].join("\n"),
        expected: { result: 6 }
      },
      {
        name: "asymmetric direct Module parameter self-carry instances",
        source: [
          "nui 1",
          "const longer: number[] = [20, 21, 22]",
          "module M(items: number[]) {",
          "  for i in range(min: 0, max: 0, step: 1) carry a: number[] = @items {",
          "    next a = @a",
          "  }",
          "  export const first: number = @a[0]",
          "  export const itemCount: number = @a.length",
          "}",
          "instance A = M(items: [10, 11])",
          "instance B = M(items: @longer)",
          "const firstA: number = @A::first",
          "const countA: number = @A::itemCount",
          "const firstB: number = @B::first",
          "const countB: number = @B::itemCount"
        ].join("\n"),
        expected: { firstA: 10, countA: 2, firstB: 20, countB: 3 }
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

  it("preserves named optional-match collection carries across Module instances", async () => {
    const module = [
      "module Select(p: number?, items: number[]) {",
      "  const selector: number? = @p",
      "  const localItems: number[] = @items",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    const chosen: number[] = match @selector {",
      "      none => @localItems",
      "      some x => [@x]",
      "    }",
      "    next selected = @chosen",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}"
    ];
    const values = [
      "const presentFirst: number = @Present::first",
      "const presentLength: number = @Present::length",
      "const absentFirst: number = @Absent::first",
      "const absentLength: number = @Absent::length"
    ];
    const document = (instances: string[], outputs: string[]) => [
      "nui 1",
      ...module,
      ...instances,
      ...outputs
    ].join("\n");
    const cases = [
      {
        name: "two instances in authored order",
        source: document([
          "instance Present = Select(p: 4, items: [7])",
          "instance Absent = Select(p: none, items: [9, 8])"
        ], values),
        expected: { presentFirst: 4, presentLength: 1, absentFirst: 9, absentLength: 2 }
      },
      {
        name: "two instances in reversed order",
        source: document([
          "instance Absent = Select(p: none, items: [9, 8])",
          "instance Present = Select(p: 4, items: [7])"
        ], values),
        expected: { presentFirst: 4, presentLength: 1, absentFirst: 9, absentLength: 2 }
      },
      {
        name: "single-instance control",
        source: document(
          ["instance Present = Select(p: 4, items: [7])"],
          values.slice(0, 2)
        ),
        expected: { presentFirst: 4, presentLength: 1 }
      },
      {
        name: "unselected failing some arm stays lazy",
        source: document(
          ["instance Absent = Select(p: none, items: [9, 8])"],
          [
            "const absentFirst: number = @Absent::first",
            "const absentLength: number = @Absent::length"
          ]
        )
          .replace(
            "const localItems: number[] = @items",
            "const localItems: number[] = @items\n  const failingItems: number[] = for y in @localItems { @y / 0 }"
          )
          .replace("some x => [@x]", "some x => @failingItems"),
        expected: { absentFirst: 9, absentLength: 2 }
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

      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors, testCase.name).toEqual([]);
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
