import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput, type EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const sourceFor = (lines: readonly string[]) => lines.join("\n");

const scalarFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  payload: ReturnType<typeof evaluateElementsReferencePayload>,
  name: string
) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding ${name} not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

describe("SAY-470 root record fields with ordered binding versions through persistent Rust", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (source: string) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled!.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const input = buildRustEvaluationInput(fixture.elements, options);
    const repeatedInput = buildRustEvaluationInput(fixture.elements, options);
    expect(JSON.stringify(repeatedInput.bindingVersions)).toBe(JSON.stringify(input.bindingVersions));
    const sourceOrders = (input.bindingVersions?.versions ?? []).map((version) => version.sourceOrder);
    expect(sourceOrders.every((sourceOrder) => Number.isInteger(sourceOrder))).toBe(true);
    for (let index = 1; index < sourceOrders.length; index += 1) {
      expect(sourceOrders[index]).toBeGreaterThan(sourceOrders[index - 1] as number);
    }

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toEqual([]);
    expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
    return { fixture, input, tsPayload, rustPayload };
  };

  it("evaluates the two-field record carry reproducer with one iteration", async () => {
    const { fixture, tsPayload, rustPayload } = await evaluateBoth(sourceFor([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "for i in range(min: 0, max: 0, step: 1) carry last: Pair = @first {",
      '  next last = Pair(x: @last.x + 1, label: @last.label)',
      "}",
      "const result: number = @last.x"
    ]));

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarFor(fixture, payload, "last.x")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarFor(fixture, payload, "last.label")).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
      expect(scalarFor(fixture, payload, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    }
  }, 60_000);

  it("accepts a two-field root record alongside an unrelated scalar carry", async () => {
    const { fixture, tsPayload, rustPayload } = await evaluateBoth(sourceFor([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @first.x + @total"
    ]));

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarFor(fixture, payload, "first.x")).toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
      expect(scalarFor(fixture, payload, "first.label")).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
      expect(scalarFor(fixture, payload, "total")).toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
      expect(scalarFor(fixture, payload, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    }
  }, 60_000);

  it("preserves one-field record carries", async () => {
    const { fixture, tsPayload, rustPayload } = await evaluateBoth(sourceFor([
      "nui 1",
      "record Single(amount: number)",
      "const first: Single = Single(amount: 1)",
      "for i in range(min: 0, max: 0, step: 1) carry last: Single = @first {",
      "  next last = Single(amount: @last.amount + 1)",
      "}",
      "const result: number = @last.amount"
    ]));

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarFor(fixture, payload, "last.amount")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarFor(fixture, payload, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    }
  }, 60_000);

  it("keeps two-field records correct without ordered-evaluation activation", async () => {
    const { fixture, tsPayload, rustPayload, input } = await evaluateBoth(sourceFor([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "const result: number = @first.x"
    ]));

    expect(fixture.compiled!.doc.scalarExecutionPositionByRuntimeElementId).toBeUndefined();
    expect(input.bindingVersions?.requiresExecutionOrdering).toBeUndefined();
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarFor(fixture, payload, "first.x")).toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
      expect(scalarFor(fixture, payload, "first.label")).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
      expect(scalarFor(fixture, payload, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
    }
  }, 60_000);

  it("keeps independent ordinary scalar carry transitions correct", async () => {
    const { fixture, tsPayload, rustPayload } = await evaluateBoth(sourceFor([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1)",
      "carry total: number = 0",
      "carry count: number = 0 {",
      "  next total = @total + @i + 1",
      "  next count = @count + 1",
      "}",
      "const result: number = @total + @count"
    ]));

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarFor(fixture, payload, "total")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarFor(fixture, payload, "count")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarFor(fixture, payload, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
    }
  }, 60_000);

  it("preserves ordering with comments, blank lines, and unrelated declarations", async () => {
    const { fixture, tsPayload, rustPayload } = await evaluateBoth(sourceFor([
      "nui 1",
      "// record declaration remains source-owned",
      "record Pair(x: number, label: string)",
      "",
      "const unrelated: number = 99",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "",
      "for i in range(min: 0, max: 0, step: 1) carry last: Pair = @first {",
      '  next last = Pair(x: @last.x + 1, label: @last.label)',
      "}",
      "const result: number = @last.x + @unrelated - 99"
    ]));

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarFor(fixture, payload, "last.x")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarFor(fixture, payload, "last.label")).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
      expect(scalarFor(fixture, payload, "result")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
    }
  }, 60_000);

  it("continues rejecting duplicate and non-increasing external binding-version positions", async () => {
    const fixture = fixtureFromSource(sourceFor([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "ok")',
      "for i in range(min: 0, max: 0, step: 1) carry last: Pair = @first {",
      '  next last = Pair(x: @last.x + 1, label: @last.label)',
      "}",
      "const result: number = @last.x"
    ]));
    const input = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const clone = () => JSON.parse(JSON.stringify(input)) as EvaluateDocumentInput;
    for (const sourceOrderForSecond of [
      (first: number) => first,
      (first: number) => first - 1
    ]) {
      const malformed = clone();
      const versions = malformed.bindingVersions?.versions as Array<Record<string, unknown>> | undefined;
      if (!versions || versions.length < 2) throw new Error("expected at least two serialized binding versions");
      versions[1]!.sourceOrder = sourceOrderForSecond(Number(versions[0]!.sourceOrder));
      await expect(rustStdio!.evaluateInput(malformed)).rejects.toThrow(
        /scalar-payload-invalid-source-order.*binding versions must be in strict source order/
      );
    }
  }, 60_000);
});
