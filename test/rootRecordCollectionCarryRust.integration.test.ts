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

const successfulCases = [
  {
    name: "nested record field selected from an ordinary collection index",
    source: [
      "nui 1",
      "record Size(value: number)",
      "record Pair(size: Size)",
      "const seed: Pair = Pair(size: Size(value: 42))",
      "const pairs: Pair[] = [@seed]",
      "const chosen: Pair = @pairs[0]",
      "const result: number = @chosen.size.value"
    ].join("\n"),
    expectedValues: { result: 42 }
  },
  {
    name: "nested constructor access and whole-record aliases retain their field backing",
    source: [
      "nui 1",
      "record Size(value: number)",
      "record Pair(size: Size)",
      "const seed: Pair = Pair(size: Size(value: 42))",
      "const alias: Pair = @seed",
      "const directResult: number = @seed.size.value",
      "const aliasResult: number = @alias.size.value"
    ].join("\n"),
    expectedValues: { directResult: 42, aliasResult: 42 }
  },
  {
    name: "simple record indexing keeps its scalar field identity",
    source: [
      "nui 1",
      "record Pair(value: number)",
      "const seed: Pair = Pair(value: 42)",
      "const pairs: Pair[] = [@seed]",
      "const chosen: Pair = @pairs[0]",
      "const result: number = @chosen.value"
    ].join("\n"),
    expectedValues: { result: 42 }
  },
  {
    name: "empty statement-for source preserves its nominal-record initializer",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "const empty: number[] = []",
      "for i in @empty carry a: Pair[] = [@seed] {",
      "  next a = @a",
      "}",
      "const chosen: Pair = @a[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "direct record literal field access remains correct",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const chosen: Pair = Pair(x: 1)",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "record map without carry keeps nominal field identity",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "const pairs: Pair[] = [@seed]",
      "const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + 10) }",
      "const chosen: Pair = @mapped[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 11 }
  },
  {
    name: "two-field record map preserves field identity and both mapped values",
    source: [
      "nui 1",
      "record Pair(x: number, y: number)",
      "const seed: Pair = Pair(x: 1, y: 2)",
      "const pairs: Pair[] = [@seed]",
      "const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + 10, y: @item.y + 20) }",
      "const chosen: Pair = @mapped[0]",
      "const resultX: number = @chosen.x",
      "const resultY: number = @chosen.y"
    ].join("\n"),
    expectedValues: { resultX: 11, resultY: 22 }
  },
  {
    name: "if-selected root record carry reference retains the incoming collection",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@seed] {",
      "  next a = if (true) { @a } else { [@seed] }",
      "}",
      "const chosen: Pair = @a[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "exhaustive match can select a root record carry reference",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "const selector: choice(left, right) = left",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@seed] {",
      "  next a = match @selector { left => @a right => [@seed] }",
      "}",
      "const chosen: Pair = @a[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "if and match collection carries swap from one incoming record snapshot",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const first: Pair = Pair(x: 1)",
      "const second: Pair = Pair(x: 2)",
      "const selector: choice(left, right) = left",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@first] carry b: Pair[] = [@second] {",
      "  next a = if (true) { @b } else { [@first] }",
      "  next b = match @selector { left => @a right => @b }",
      "}",
      "const chosenA: Pair = @a[0]",
      "const chosenB: Pair = @b[0]",
      "const resultA: number = @chosenA.x",
      "const resultB: number = @chosenB.x"
    ].join("\n"),
    expectedValues: { resultA: 2, resultB: 1 }
  },
  {
    name: "unselected error-producing if record branch remains lazy",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@seed] {",
      "  next a = if (true) { @a } else { if (1 / 0 > 0) { [@seed] } else { [@seed] } }",
      "}",
      "const chosen: Pair = @a[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "unselected error-producing exhaustive match record arm remains lazy",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "const selector: choice(left, right) = left",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@seed] {",
      "  next a = match @selector { left => @a right => if (1 / 0 > 0) { [@seed] } else { [@seed] } }",
      "}",
      "const chosen: Pair = @a[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "a selected record literal branch keeps nominal field lowering",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const seed: Pair = Pair(x: 1)",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@seed] {",
      "  next a = if (true) { [@seed] } else { @a }",
      "}",
      "const chosen: Pair = @a[0]",
      "const result: number = @chosen.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "direct root record carry swaps retain both incoming fields",
    source: [
      "nui 1",
      "record Pair(x: number)",
      "const first: Pair = Pair(x: 1)",
      "const second: Pair = Pair(x: 2)",
      "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@first] carry b: Pair[] = [@second] {",
      "  next a = @b",
      "  next b = @a",
      "}",
      "const chosenA: Pair = @a[0]",
      "const chosenB: Pair = @b[0]",
      "const resultA: number = @chosenA.x",
      "const resultB: number = @chosenB.x"
    ].join("\n"),
    expectedValues: { resultA: 2, resultB: 1 }
  }
] as const;

const escapedRecordCarrySource = [
  "nui 1",
  "record Pair(x: number)",
  "const seed: Pair = Pair(x: 1)",
  "for i in range(min: 0, max: 0, step: 1) carry a: Pair[] = [@seed] {",
  "  next a = @a",
  "}",
  "const chosen: Pair = @a[0]",
  "const result: number = @chosen.x"
].join("\n");

const forwardCollectionSource = [
  "nui 1",
  "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
  "  next total = @items[0]",
  "}",
  "const items: number[] = [2]",
  "const result: number = @total"
].join("\n");

describe("SAY-488 record collection carry indexing through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("allows same-source-order escaped carry access and preserves the forward-reference error", async () => {
    const legalFixture = fixtureFromSource(escapedRecordCarrySource);
    const legalCompiled = legalFixture.compiled?.doc;
    if (!legalCompiled) throw new Error("expected a compiled escaped-record-carry fixture");
    expect(legalCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(legalFixture)).toBe(true);

    const legalOptions = optionsFor(legalFixture);
    const legalTsPayload = evaluateElementsReferencePayload(legalFixture.elements, legalOptions);
    const legalRustPayload = await rustStdio!.evaluate(legalFixture.elements, legalOptions);
    expect(normalizePersistentParityPayload(legalRustPayload)).toEqual(
      normalizePersistentParityPayload(legalTsPayload)
    );
    for (const payload of [legalTsPayload, legalRustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(scalarFor(legalFixture, payload, "result")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 1 }
      });
    }

    const forwardFixture = fixtureFromSource(forwardCollectionSource);
    const forwardCompiled = forwardFixture.compiled?.doc;
    if (!forwardCompiled) throw new Error("expected a compiled forward-reference fixture");
    expect(forwardCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(forwardFixture)).toBe(true);
    const forwardOptions = optionsFor(forwardFixture);
    const forwardRustPayload = await rustStdio!.evaluate(forwardFixture.elements, forwardOptions);
    expect(scalarFor(forwardFixture, forwardRustPayload, "total")).toMatchObject({
      status: "error",
      issueCode: "evaluation-collection-index-unavailable"
    });
    expect(JSON.stringify(forwardRustPayload)).toContain("evaluation-collection-index-unavailable");
  }, 60_000);

  it.each(successfulCases)("$name", async (testCase) => {
    const fixture = fixtureFromSource(testCase.source);
    const compiled = fixture.compiled?.doc;
    if (!compiled) throw new Error(`${testCase.name}: expected a compiled fixture`);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
    expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizePersistentParityPayload(rustPayload), testCase.name).toEqual(
      normalizePersistentParityPayload(tsPayload)
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors, testCase.name).toEqual([]);
      expect(JSON.stringify(payload), testCase.name).not.toContain("evaluation-collection-index-unavailable");
      for (const [name, expected] of Object.entries(testCase.expectedValues)) {
        expect(scalarFor(fixture, payload, name), `${testCase.name}: ${name}`).toMatchObject({
          status: "ok",
          value: { kind: "number", value: expected }
        });
      }
    }
  }, 60_000);
});
