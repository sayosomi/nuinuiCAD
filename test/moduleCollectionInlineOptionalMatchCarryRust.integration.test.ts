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
  expectedValues: Record<string, number>;
}[] = [
  {
    name: "Module-local optional scalar can select a local collection alias",
    source: [
      "nui 1",
      "module Select(p: number?, items: number[]) {",
      "  const selector: number? = @p",
      "  const localItems: number[] = @items",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @selector { none => @localItems some x => [@x] }",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}",
      "instance Absent = Select(p: none, items: [9, 8])",
      "const absentFirst: number = @Absent::first",
      "const absentLength: number = @Absent::length"
    ].join("\n"),
    expectedValues: { absentFirst: 9, absentLength: 2 }
  },
  {
    name: "direct optional Module parameter scrutinees select present and none arms",
    source: [
      "nui 1",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @p { none => [31, 32] some x => [@x] }",
      "  }",
      "  export const first: number = @selected[0]",
      "  export const length: number = @selected.length",
      "}",
      "instance Present = Select(p: 4)",
      "instance Absent = Select(p: none)",
      "const presentFirst: number = @Present::first",
      "const presentLength: number = @Present::length",
      "const absentFirst: number = @Absent::first",
      "const absentLength: number = @Absent::length"
    ].join("\n"),
    expectedValues: { presentFirst: 4, presentLength: 1, absentFirst: 31, absentLength: 2 }
  },
  {
    name: "an error-producing unselected Module collection arm remains lazy",
    source: [
      "nui 1",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: number[] = [] {",
      "    next selected = match @p { none => if (1 / 0 > 0) { [90] } else { [91] } some x => [@x] }",
      "  }",
      "  export const result: number = @selected[0]",
      "}",
      "instance Present = Select(p: 5)",
      "const result: number = @Present::result"
    ].join("\n"),
    expectedValues: { result: 5 }
  },
  {
    name: "nominal record collection elements retain their Module carry type",
    source: [
      "nui 1",
      "record Pair(value: number)",
      "const pair: Pair = Pair(value: 12)",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: Pair[] = [] {",
      "    next selected = match @p { none => [] some x => [@pair] }",
      "  }",
      "  export const length: number = @selected.length",
      "}",
      "instance Present = Select(p: 1)",
      "const length: number = @Present::length"
    ].join("\n"),
    expectedValues: { length: 1 }
  }
];

describe("SAY-483 Module inline collection optional-match carries through persistent Rust stdio", () => {
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

  it("keeps an incompatible inline Module collection arm under the carry diagnostic contract", () => {
    const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "record Pair(value: number)",
      "record Other(value: number)",
      "const pair: Pair = Pair(value: 1)",
      "const other: Other = Other(value: 2)",
      "module Select(p: number?) {",
      "  for i in range(min: 0, max: 0, step: 1) carry selected: Pair[] = [] {",
      "    next selected = match @p { none => [@other] some x => [@pair] }",
      "  }",
      "}",
      "instance Present = Select(p: 1)"
    ].join("\n"));
    expect(result.status).toBe("fatal");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "carry-collection-expression-invalid" })
    ]));
  });
});
