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
  return {
    ...record,
    computedScalarBindings: [...computedScalarBindings].sort((left, right) =>
      String((left as { bindingId?: unknown }).bindingId ?? "")
        .localeCompare(String((right as { bindingId?: unknown }).bindingId ?? ""))
    )
  };
};

const cases: {
  name: string;
  source: string;
  expectedValues: Record<string, number>;
}[] = [
  {
    name: "reduced choice match is committed before the iteration binder retires",
    source: [
      "nui 1",
      "const sides: choice(left, right)[] = [right]",
      "for side in @sides carry a: number[] = [0] {",
      "  const selected: number[] = match @side { left => [1] right => [2] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 2 }
  },
  {
    name: "canonical arm order selects the final asymmetric two-iteration collection",
    source: [
      "nui 1",
      "const sides: choice(left, right)[] = [left, right]",
      "for side in @sides carry a: number[] = [0] {",
      "  const selected: number[] = match @side { left => [11, 12] right => [21, 22, 23] }",
      "  next a = @selected",
      "}",
      "const first: number = @a[0]",
      "const second: number = @a[1]",
      "const third: number = @a[2]",
      "const length: number = @a.length"
    ].join("\n"),
    expectedValues: { first: 21, second: 22, third: 23, length: 3 }
  },
  {
    name: "aliases, renamed bindings, inert padding, unrelated declarations, and reversed arms preserve selection",
    source: [
      "nui 1",
      "// inert source padding",
      "",
      "const unrelated: number = 99",
      "const choices: choice(left, right)[] = [left, right]",
      "for selector in @choices carry escaped: number[] = [0] {",
      "  const chosen: number[] = match @selector { right => [21, 22, 23] left => [11, 12] }",
      "  const chosenAlias: number[] = @chosen",
      "  next escaped = @chosenAlias",
      "}",
      "const first: number = @escaped[0]",
      "const second: number = @escaped[1]",
      "const third: number = @escaped[2]",
      "const length: number = @escaped.length"
    ].join("\n"),
    expectedValues: { first: 21, second: 22, third: 23, length: 3 }
  },
  {
    name: "a static exhaustive collection match remains correct when carried",
    source: [
      "nui 1",
      "const side: choice(left, right) = right",
      "const selected: number[] = match @side { left => [4] right => [7, 8] }",
      "for i in range(min: 0, max: 0, step: 1) carry escaped: number[] = [0] {",
      "  next escaped = @selected",
      "}",
      "const first: number = @escaped[0]",
      "const second: number = @escaped[1]",
      "const length: number = @escaped.length"
    ].join("\n"),
    expectedValues: { first: 7, second: 8, length: 2 }
  },
  {
    name: "SAY-478 iteration-selected collection indexing inside scalar next remains correct",
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
    name: "SAY-476 binder-dependent collection if remains correct when carried",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry escaped: number[] = [1] {",
      "  const selected: number[] = if (@i == 0) { [2] } else { [3] }",
      "  next escaped = @selected",
      "}",
      "const result: number = @escaped[0]",
      "const length: number = @escaped.length"
    ].join("\n"),
    expectedValues: { result: 2, length: 1 }
  },
  {
    name: "a direct literal collection carry remains correct",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry escaped: number[] = [0] {",
      "  next escaped = [31, 32]",
      "}",
      "const first: number = @escaped[0]",
      "const second: number = @escaped[1]",
      "const length: number = @escaped.length"
    ].join("\n"),
    expectedValues: { first: 31, second: 32, length: 2 }
  },
  {
    name: "an unselected collection match arm with a failing condition stays lazy",
    source: [
      "nui 1",
      "const sides: choice(left, right)[] = [left]",
      "for side in @sides carry escaped: number[] = [0] {",
      "  const selected: number[] = match @side {",
      "    left => [2]",
      "    right => if (1 / 0 > 0) { [90] } else { [91] }",
      "  }",
      "  next escaped = @selected",
      "}",
      "const result: number = @escaped[0]"
    ].join("\n"),
    expectedValues: { result: 2 }
  }
];

describe("SAY-479 root collection choice-match carry snapshots through persistent Rust stdio", () => {
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
      const result = evaluationPayloadToResult(payload);
      expect(result.errors, testCase.name).toEqual([]);
      expect(JSON.stringify(payload), testCase.name).not.toContain("evaluation-binding-unavailable");
      for (const [name, expected] of Object.entries(testCase.expectedValues)) {
        expect(scalarFor(fixture, payload, name), `${testCase.name}: ${name}`).toMatchObject({
          status: "ok",
          value: { kind: "number", value: expected }
        });
      }
    }
  }, 60_000);
});
