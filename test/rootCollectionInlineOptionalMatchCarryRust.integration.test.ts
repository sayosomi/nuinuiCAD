import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
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
  expectedValues: Record<string, number | string>;
}[] = [
  {
    name: "inline optional match selects the some arm",
    source: [
      "nui 1",
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  next a = match @p { none => [2] some x => [1] }",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "inline optional match selects the none arm and preserves its collection length",
    source: [
      "nui 1",
      "const p: number? = none",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  next a = match @p { none => [31, 32] some x => [@x] }",
      "}",
      "const first: number = @a[0]",
      "const second: number = @a[1]",
      "const length: number = @a.length"
    ].join("\n"),
    expectedValues: { first: 31, second: 32, length: 2 }
  },
  {
    name: "an error-producing unselected inline collection arm remains lazy",
    source: [
      "nui 1",
      "const p: number? = 5",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  next a = match @p { none => if (1 / 0 > 0) { [90] } else { [91] } some x => [@x] }",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 5 }
  },
  {
    name: "the equivalent named collection match remains valid",
    source: [
      "nui 1",
      "const p: number? = 7",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const selected: number[] = match @p { none => [8] some x => [1] }",
      "  next a = @selected",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "literal and collection-reference carry next forms remain valid",
    source: [
      "nui 1",
      "const replacement: number[] = [9, 8]",
      "for i in range(min: 0, max: 0, step: 1) carry literal: number[] = [0] carry referenced: number[] = [1] {",
      "  next literal = [2]",
      "  next referenced = @replacement",
      "}",
      "const literalResult: number = @literal[0]",
      "const referenceResult: number = @referenced[0]"
    ].join("\n"),
    expectedValues: { literalResult: 2, referenceResult: 9 }
  },
  {
    name: "inline optional match preserves nominal record collection elements",
    source: [
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "first")',
      'const fallback: Pair = Pair(x: 2, label: "fallback")',
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry items: Pair[] = [@fallback] {",
      "  next items = match @p { none => [@fallback] some x => [@first] }",
      "}",
      "const result: number = @items.length"
    ].join("\n"),
    expectedValues: { result: 1 }
  }
];

describe("SAY-483 inline collection optional-match carries through persistent Rust stdio", () => {
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
          value: { kind: typeof expected, value: expected }
        });
      }
    }
  }, 60_000);

  it("keeps an incompatible inline collection arm under the carry diagnostic contract", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      '  next a = match @p { none => ["wrong"] some x => [1] }',
      "}"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "carry-collection-expression-invalid" })
    ]));
  });

  it("rejects a nominally different record element in an inline carry match", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "record Pair(x: number)",
      "record Other(x: number)",
      "const pair: Pair = Pair(x: 1)",
      "const other: Other = Other(x: 2)",
      "const p: number? = 1",
      "for i in range(min: 0, max: 0, step: 1) carry items: Pair[] = [@pair] {",
      "  next items = match @p { none => [@other] some x => [@pair] }",
      "}"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "carry-collection-expression-invalid" })
    ]));
  });
});
