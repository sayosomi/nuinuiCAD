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
    name: "present optional collection arm is committed before the iteration retires",
    source: [
      "nui 1",
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = match @p {",
      "    none => [8]",
      "    some x => [1]",
      "  }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "absent optional commits and keeps the none collection arm indexable",
    source: [
      "nui 1",
      "const p: number? = none",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = match @p {",
      "    none => [31, 32]",
      "    some x => [@x]",
      "  }",
      "  next a = @selected",
      "}",
      "const first: number = @a[0]",
      "const second: number = @a[1]",
      "const length: number = @a.length"
    ].join("\n"),
    expectedValues: { first: 31, second: 32, length: 2 }
  },
  {
    name: "selected scalar some binder remains available in the committed collection",
    source: [
      "nui 1",
      "const p: number? = 17",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = match @p {",
      "    none => [0]",
      "    some x => [@x]",
      "  }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 17 }
  },
  {
    name: "aliases and renamed declarations preserve the selected binder snapshot",
    source: [
      "nui 1",
      "const p: number? = 23",
      "for i in range(min: 0, max: 0, step: 1) carry escaped: number[] = [0] {",
      "  const chosen: number[] = match @p { none => [2] some x => [@x] }",
      "  const renamed: number[] = @chosen",
      "  next escaped = @renamed",
      "}",
      "const result: number = @escaped[0]",
      "const length: number = @escaped.length"
    ].join("\n"),
    expectedValues: { result: 23, length: 1 }
  },
  {
    name: "unselected optional arm with a failing collection expression remains lazy",
    source: [
      "nui 1",
      "const p: number? = 5",
      "for i in range(min: 0, max: 0, step: 1) carry escaped: number[] = [0] {",
      "  const chosen: number[] = match @p {",
      "    none => if (1 / 0 > 0) { [90] } else { [91] }",
      "    some x => [@x]",
      "  }",
      "  next escaped = @chosen",
      "}",
      "const result: number = @escaped[0]"
    ].join("\n"),
    expectedValues: { result: 5 }
  },
  {
    name: "ordinary optional collection match without collection carry remains correct",
    source: [
      "nui 1",
      "const p: number? = none",
      "const selected: number[] = match @p { none => [4, 6] some x => [@x] }",
      "const first: number = @selected[0]",
      "const second: number = @selected[1]",
      "const length: number = @selected.length"
    ].join("\n"),
    expectedValues: { first: 4, second: 6, length: 2 }
  },
  {
    name: "optional match used through a declaration remains valid in scalar next",
    source: [
      "nui 1",
      "const p: number? = 9",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  const selected: number = match @p { none => 0 some x => @x }",
      "  next total = @selected",
      "}",
      "const result: number = @total"
    ].join("\n"),
    expectedValues: { result: 9 }
  },
  {
    name: "SAY-479 exhaustive choice match collection carry remains correct",
    source: [
      "nui 1",
      "const side: choice(left, right) = right",
      "for i in range(min: 0, max: 0, step: 1) carry escaped: number[] = [0] {",
      "  const chosen: number[] = match @side { left => [4] right => [7, 8] }",
      "  next escaped = @chosen",
      "}",
      "const first: number = @escaped[0]",
      "const second: number = @escaped[1]",
      "const length: number = @escaped.length"
    ].join("\n"),
    expectedValues: { first: 7, second: 8, length: 2 }
  }
];

describe("SAY-480 root collection optional-match carry snapshots through persistent Rust stdio", () => {
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
