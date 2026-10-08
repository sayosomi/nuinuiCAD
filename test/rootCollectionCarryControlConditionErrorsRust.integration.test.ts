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
  name = "result"
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
  return {
    ...record,
    computedScalarBindings: [...computedScalarBindings].sort((left, right) =>
      String((left as { bindingId?: unknown }).bindingId ?? "")
        .localeCompare(String((right as { bindingId?: unknown }).bindingId ?? ""))
    )
  };
};

type CarryCase = {
  name: string;
  source: string;
  error?: string;
  expectedValue?: number;
  resultBinding?: string;
};

const cases: CarryCase[] = [
  {
    name: "minimal selected collection-if carry decision preserves remainder-by-zero",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const b: number[] = if (5 % 0 > 0) { [1] } else { [2] }",
      "  next a = @b",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    error: "evaluation-remainder-by-zero"
  },
  {
    name: "the equivalent collection-if failure without carry keeps its diagnostic",
    source: [
      "nui 1",
      "const b: number[] = if (5 % 0 > 0) { [1] } else { [2] }",
      "const result: number = @b[0]"
    ].join("\n"),
    error: "evaluation-remainder-by-zero"
  },
  {
    name: "a successful selected condition carries its selected value through an alias",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = if (@i == 0) { [11, 12] } else { [21] }",
      "  const alias: number[] = @selected",
      "  next a = @alias",
      "}",
      "const result: number = @a[1]"
    ].join("\n"),
    expectedValue: 12
  },
  {
    name: "an unselected failing collection branch remains lazy",
    source: [
      "nui 1",
      "const source: number[] = [1]",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const failing: number[] = for x in @source { @x / 0 }",
      "  const selected: number[] = if (@i == 0) { [2] } else { @failing }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValue: 2
  },
  {
    name: "a selected collection member body failure survives carry resolution",
    source: [
      "nui 1",
      "const source: number[] = [1]",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const failing: number[] = for x in @source { @x / 0 }",
      "  const selected: number[] = if (@i == 0) { @failing } else { [2] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    error: "evaluation-divide-by-zero"
  },
  {
    name: "an optional match scrutinee failure survives carry snapshot materialization",
    source: [
      "nui 1",
      "const selector: number? = 5 % 0",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [] {",
      "  const selected: number[] = match @selector { none => [0] some value => [@value] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    error: "evaluation-remainder-by-zero"
  },
  {
    name: "a choice match scrutinee failure survives carry snapshot materialization",
    source: [
      "nui 1",
      "const selector: choice(left, right) = if (5 % 0 > 0) { left } else { right }",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [] {",
      "  const selected: number[] = match @selector { left => [1] right => [2] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    error: "evaluation-remainder-by-zero"
  },
  {
    name: "a nested carry propagates an inner committed decision failure",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry outer: number[] = [] {",
      "  for j in range(min: 0, max: 0, step: 1) carry inner: number[] = [] {",
      "    const selected: number[] = if (5 % 0 > 0) { [4] } else { [5] }",
      "    next inner = @selected",
      "  }",
      "  next outer = @inner",
      "}",
      "const result: number = @outer[0]"
    ].join("\n"),
    error: "evaluation-remainder-by-zero"
  },
  {
    name: "a Module-local optional match preserves a failed scrutinee through its carry",
    source: [
      "nui 1",
      "module Select() {",
      "  const localSelector: number? = 5 % 0",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    const branch: number[] = match @localSelector { none => [31] some value => [@value] }",
      "    next selected = @branch",
      "  }",
      "  export const first: number = @selected[0]",
      "}",
      "instance Example = Select()",
      "const result: number = @Example::first"
    ].join("\n"),
    error: "evaluation-remainder-by-zero"
  },
  {
    name: "a successful Module-local optional match retains its selected binder",
    source: [
      "nui 1",
      "module Select(p: number?) {",
      "  const localSelector: number? = @p",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    const branch: number[] = match @localSelector { none => [0] some value => [@value] }",
      "    next selected = @branch",
      "  }",
      "  export const first: number = @selected[0]",
      "}",
      "instance Example = Select(p: 17)",
      "const result: number = @Example::first"
    ].join("\n"),
    expectedValue: 17
  }
];

describe("SAY-484 collection carry control-condition errors through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it.each(cases)("$name", async (testCase) => {
    const fixture = fixtureFromSource(testCase.source);
    const compiled = fixture.compiled?.doc;
    if (!compiled) throw new Error(`${testCase.name}: expected a compiled fixture`);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);

    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizePersistentParityPayload(rustPayload), testCase.name).toEqual(
      normalizePersistentParityPayload(tsPayload)
    );

    for (const payload of [tsPayload, rustPayload]) {
      const value = scalarFor(fixture, payload, testCase.resultBinding);
      if (testCase.error) {
        expect(value, testCase.name).toMatchObject({ status: "error", issueCode: testCase.error });
        expect(JSON.stringify(payload), testCase.name).not.toContain("evaluation-collection-index-unavailable");
        expect(JSON.stringify(payload), testCase.name).toContain(testCase.error);
      } else {
        expect(value, testCase.name).toMatchObject({
          status: "ok",
          value: { kind: "number", value: testCase.expectedValue }
        });
      }
    }
  }, 60_000);
});
