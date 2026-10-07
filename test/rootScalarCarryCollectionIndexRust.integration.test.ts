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

const normalizePersistentParityPayload = (payload: EvaluationPayload): unknown => {
  const normalized = normalizeParityPayload(payload);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
  const record = normalized as Record<string, unknown>;
  const computedScalarBindings = record.computedScalarBindings;
  if (!Array.isArray(computedScalarBindings)) return normalized;
  // Rust emits for-group carry entries from a HashMap; compare the keyed
  // bindings by ID without treating their output order as evaluation state.
  return {
    ...record,
    computedScalarBindings: [...computedScalarBindings].sort((left, right) =>
      String((left as { bindingId?: unknown }).bindingId ?? "")
        .localeCompare(String((right as { bindingId?: unknown }).bindingId ?? ""))
    )
  };
};

const cases = [
  {
    name: "SAY-477 root direct collection indexing remains correct",
    source: [
      "nui 1",
      "const items: number[] = [2]",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @items[0]",
      "}",
      "const result: number = @total"
    ].join("\n"),
    expectedValues: { result: 2 }
  },
  {
    name: "reduced root scalar carry indexes an iteration-selected collection",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  const selected: number[] = if (@i == 0) { [2] } else { [7] }",
      "  next total = @selected[0]",
      "}",
      "const result: number = @total"
    ].join("\n"),
    expectedValues: { result: 2 }
  },
  {
    name: "alias, padding, unrelated insertion, and renamed root bindings preserve indexing",
    source: [
      "nui 1",
      "// Inert padding before the renamed program.",
      "const unrelated: number = 99",
      "for stepIndex in range(min: 0, max: 2, step: 1) carry accumulated: number = 0 {",
      "  const selectedValues: number[] = if (@stepIndex == 2) { [8, 9] } else { [3, 4, 5] }",
      "  const aliasedValues: number[] = @selectedValues",
      "  next accumulated = @accumulated + @aliasedValues[0]",
      "}",
      "const answer: number = @accumulated"
    ].join("\n"),
    expectedValues: { answer: 14 }
  },
  {
    name: "constant-selected collection remains indexable in scalar next",
    source: [
      "nui 1",
      "const selected: number[] = if (true) { [12, 13] } else { [99] }",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @selected[0]",
      "}",
      "const result: number = @total"
    ].join("\n"),
    expectedValues: { result: 12 }
  },
  {
    name: "body-local literal collection remains indexable in scalar next",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  const selected: number[] = [17, 19]",
      "  next total = @selected[1]",
      "}",
      "const result: number = @total"
    ].join("\n"),
    expectedValues: { result: 19 }
  },
  {
    name: "Module-local scalar carry index materializes its exported result",
    source: [
      "nui 1",
      "module Reader(values: number[]) {",
      "  for step in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "    next total = @values[1]",
      "  }",
      "  export const output: number = @total",
      "}",
      "instance Read = Reader(values: [7, 2])",
      "const result: number = @Read::output"
    ].join("\n"),
    expectedValues: { result: 2 }
  },
  {
    name: "asymmetric Module instances keep iteration-selected scalar and collection carry snapshots",
    source: [
      "nui 1",
      "module Reader(first: number, second: number) {",
      "  for i in range(min: 0, max: 1, step: 1) carry total: number = 0 carry lastValues: number[] = [0] {",
      "    const selected: number[] = if (@i == 0) { [@first, 10] } else { [@second, 20, 30] }",
      "    next total = @total + @selected[0]",
      "    next lastValues = @selected",
      "  }",
      "  export const scalarTotal: number = @total",
      "  export const finalFirst: number = @lastValues[0]",
      "  export const finalSecond: number = @lastValues[1]",
      "  export const finalThird: number = @lastValues[2]",
      "  export const finalLength: number = @lastValues.length",
      "}",
      "instance A = Reader(first: 7, second: 51)",
      "instance B = Reader(first: 88, second: 120)",
      "const totalA: number = @A::scalarTotal",
      "const firstA: number = @A::finalFirst",
      "const secondA: number = @A::finalSecond",
      "const thirdA: number = @A::finalThird",
      "const lengthA: number = @A::finalLength",
      "const totalB: number = @B::scalarTotal",
      "const firstB: number = @B::finalFirst",
      "const secondB: number = @B::finalSecond",
      "const thirdB: number = @B::finalThird",
      "const lengthB: number = @B::finalLength"
    ].join("\n"),
    expectedValues: {
      totalA: 58,
      firstA: 51,
      secondA: 20,
      thirdA: 30,
      lengthA: 3,
      totalB: 208,
      firstB: 120,
      secondB: 20,
      thirdB: 30,
      lengthB: 3
    }
  },
  {
    name: "ordinary collection indexing outside statement-for remains correct",
    source: [
      "nui 1",
      "const items: number[] = [2]",
      "const result: number = @items[0]"
    ].join("\n"),
    expectedValues: { result: 2 }
  },
  {
    name: "a scalar pre-read before statement-for remains usable in next",
    source: [
      "nui 1",
      "const items: number[] = [2]",
      "const selected: number = @items[0]",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @selected",
      "}",
      "const result: number = @total"
    ].join("\n"),
    expectedValues: { result: 2 }
  },
  {
    name: "an out-of-range runtime index keeps the collection-index diagnostic",
    source: [
      "nui 1",
      "const items: number[] = [2]",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @items[1]",
      "}",
      "const result: number = @total"
    ].join("\n"),
    errorName: "total",
    expectedIssueCode: "evaluation-collection-index-invalid"
  }
] as const;

describe("SAY-478 scalar carry collection indexing through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("keeps the source-order fence for an index into a later collection", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @items[0]",
      "}",
      "const items: number[] = [2]",
      "const result: number = @total"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected a compiled source-order fixture");
    expect(fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, optionsFor(fixture));
    expect(scalarFor(fixture, rustPayload, "total")).toMatchObject({
      status: "error",
      issueCode: "evaluation-collection-index-unavailable"
    });
  }, 60_000);

  it.each(cases)("$name", async (testCase) => {
    const fixture = fixtureFromSource(testCase.source);
    if (!fixture.compiled) throw new Error(`expected a compiled fixture: ${testCase.name}`);
    expect(
      fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      testCase.name
    ).toEqual([]);

    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizePersistentParityPayload(rustPayload), testCase.name).toEqual(
      normalizePersistentParityPayload(tsPayload)
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      if ("expectedValues" in testCase) {
        expect(result.errors, testCase.name).toEqual([]);
        expect(JSON.stringify(payload), testCase.name).not.toContain("evaluation-collection-index-unavailable");
        for (const [name, expected] of Object.entries(testCase.expectedValues)) {
          expect(scalarFor(fixture, payload, name), `${testCase.name}: ${name}`).toMatchObject({
            status: "ok",
            value: { kind: "number", value: expected }
          });
        }
      } else {
        expect(scalarFor(fixture, payload, testCase.errorName), testCase.name).toMatchObject({
          status: "error",
          issueCode: testCase.expectedIssueCode
        });
      }
    }
  }, 60_000);
});
