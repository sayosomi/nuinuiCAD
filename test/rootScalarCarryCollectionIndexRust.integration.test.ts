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

const cases = [
  {
    name: "reduced root scalar carry indexes an immutable collection",
    source: [
      "nui 1",
      "const items: number[] = [2]",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @items[0]",
      "}",
      "const result: number = @total"
    ].join("\n"),
    resultName: "result",
    expected: 2
  },
  {
    name: "renamed and padded root bindings preserve scalar carry indexing",
    source: [
      "nui 1",
      "// Inert padding before the renamed program.",
      "const unrelated: number = 99",
      "const sourceValues: number[] = [7, 29]",
      "for cursor in range(min: 0, max: 0, step: 1) carry accumulated: number = 3 {",
      "  next accumulated = @sourceValues[1]",
      "}",
      "const answer: number = @accumulated"
    ].join("\n"),
    resultName: "answer",
    expected: 29
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
    resultName: "result",
    expected: 2
  },
  {
    name: "ordinary collection indexing outside statement-for remains correct",
    source: [
      "nui 1",
      "const items: number[] = [2]",
      "const result: number = @items[0]"
    ].join("\n"),
    resultName: "result",
    expected: 2
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
    resultName: "result",
    expected: 2
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

describe("SAY-477 scalar carry collection indexing through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

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
    expect(normalizeParityPayload(rustPayload), testCase.name).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      if ("expected" in testCase) {
        expect(result.errors, testCase.name).toEqual([]);
        expect(JSON.stringify(payload), testCase.name).not.toContain("evaluation-collection-index-unavailable");
        expect(scalarFor(fixture, payload, testCase.resultName), testCase.name).toMatchObject({
          status: "ok",
          value: { kind: "number", value: testCase.expected }
        });
      } else {
        expect(scalarFor(fixture, payload, testCase.errorName), testCase.name).toMatchObject({
          status: "error",
          issueCode: testCase.expectedIssueCode
        });
      }
    }
  }, 60_000);
});
