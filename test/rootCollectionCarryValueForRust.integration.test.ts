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
    name: "identity map reads an incoming number collection carry",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] {",
      "  const mapped: number[] = for x in @a { @x }",
      "  next a = @mapped",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "each map generation reads the previous iteration snapshot",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number[] = [1] {",
      "  const mapped: number[] = for x in @a { @x + 1 }",
      "  next a = @mapped",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 4 }
  },
  {
    name: "lazy map bodies share the incoming snapshot across collection carries",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry a: number[] = [1] carry b: number[] = [10] {",
      "  const mappedA: number[] = for x in @a { @x + @b[0] }",
      "  const mappedB: number[] = for y in @b { @y + 1 }",
      "  next a = @mappedA",
      "  next b = @mappedB",
      "}",
      "const resultA: number = @a[0]",
      "const resultB: number = @b[0]"
    ].join("\n"),
    expectedValues: { resultA: 34, resultB: 13 }
  },
  {
    name: "ordinary named collections remain valid value-for sources",
    source: [
      "nui 1",
      "const values: number[] = [4]",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [0] {",
      "  const mapped: number[] = for x in @values { @x + 1 }",
      "  next a = @mapped",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 5 }
  },
  {
    name: "direct collection carry self-assignment remains valid",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] {",
      "  next a = @a",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 1 }
  },
  {
    name: "two collection carries swap from one simultaneous snapshot",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [1] carry b: number[] = [2] {",
      "  next a = @b",
      "  next b = @a",
      "}",
      "const resultA: number = @a[0]",
      "const resultB: number = @b[0]"
    ].join("\n"),
    expectedValues: { resultA: 2, resultB: 1 }
  },
  {
    name: "a body-local alias of the incoming carry remains a lazy map source",
    source: [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry a: number[] = [2] {",
      "  const alias: number[] = @a",
      "  const mapped: number[] = for x in @alias { @x * 2 }",
      "  next a = @mapped",
      "}",
      "const result: number = @a[0]"
    ].join("\n"),
    expectedValues: { result: 4 }
  },
  {
    name: "Module instances retain separate collection carry snapshots",
    source: [
      "nui 1",
      "module Mapper(items: number[]) {",
      "  for i in range(min: 0, max: 2, step: 1) carry a: number[] = @items {",
      "    const mapped: number[] = for x in @a { @x + 1 }",
      "    next a = @mapped",
      "  }",
      "  export const first: number = @a[0]",
      "  export const count: number = @a.length",
      "}",
      "const left: number[] = [1]",
      "const right: number[] = [10, 20]",
      "instance A = Mapper(items: @left)",
      "instance B = Mapper(items: @right)",
      "const aFirst: number = @A::first",
      "const aCount: number = @A::count",
      "const bFirst: number = @B::first",
      "const bCount: number = @B::count"
    ].join("\n"),
    expectedValues: { aFirst: 4, aCount: 1, bFirst: 13, bCount: 2 }
  },
  {
    name: "nominal record carry maps preserve the record map identity",
    source: [
      "nui 1",
      "record Pair(x: number, label: string)",
      'const initial: Pair = Pair(x: 1, label: "kept")',
      "for i in range(min: 0, max: 0, step: 1) carry pairs: Pair[] = [@initial] {",
      "  const mapped: Pair[] = for item in @pairs { @item }",
      "  next pairs = @mapped",
      "}",
      "const selected: Pair = @pairs[0]",
      "const result: number = @selected.x"
    ].join("\n"),
    expectedValues: { result: 1 }
  }
];

describe("SAY-485 generic collection carry value-for through persistent Rust stdio", () => {
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

  it("lowers the minimal map with the canonical immutable carry collection identity", () => {
    const fixture = fixtureFromSource(cases[0]!.source);
    const map = fixture.compiled?.doc.scalarProgram?.collectionValues?.find((value) => value.kind === "map");
    expect(map).toMatchObject({
      kind: "map",
      sourceValueId: expect.stringMatching(/^carry-collection:binding:/),
      sourceElementType: { kind: "number" }
    });
  });

  it("keeps the record map nominal identity equal to the carried Pair identity", () => {
    const fixture = fixtureFromSource(cases[8]!.source);
    const found: unknown[] = [];
    const visited = new WeakSet<object>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if ((value as { kind?: unknown }).kind === "recordMap") found.push(value);
      for (const nested of Object.values(value)) visit(nested);
    };
    visit(fixture.compiled?.doc);
    const recordMap = fixture.compiled?.doc.scalarProgram?.collectionValues?.find(
      (value) => value.kind === "recordMap" && value.sourceValueId.startsWith("carry-collection:")
    );
    if (!recordMap || recordMap.kind !== "recordMap") {
      throw new Error(`expected a record map over the carry; found=${JSON.stringify(found)}`);
    }
    expect(recordMap.sourceTypeIdentity).toBe(recordMap.resultTypeIdentity);
    expect(recordMap.fields.map((field) => field.recordStatementId)).toEqual(
      expect.arrayContaining([recordMap.resultTypeIdentity])
    );
  });
});
