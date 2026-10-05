import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const twoNestedInstancesSource = (reordered: boolean) => [
  "nui 1",
  "module Inner(width: number) {",
  "  line Shape = segment(start: (0, 0), end: (@width, 0))",
  "  export const value: number = @Shape.length",
  "}",
  "module Outer(width: number) {",
  "  instance Nested = Inner(width: @width)",
  "  export const value: number = @Nested::value",
  "}",
  ...(reordered
    ? [
        "instance Second = Outer(width: 40)",
        "instance First = Outer(width: 20)",
        "const SecondValue: number = @Second::value",
        "const FirstValue: number = @First::value"
      ]
    : [
        "instance First = Outer(width: 20)",
        "instance Second = Outer(width: 40)",
        "const FirstValue: number = @First::value",
        "const SecondValue: number = @Second::value"
      ])
].join("\n");

const scalarBinding = (fixture: ReturnType<typeof fixtureFromSource>, payload: EvaluationPayload, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const numberValue = (fixture: ReturnType<typeof fixtureFromSource>, payload: EvaluationPayload, name: string) => {
  const value = scalarBinding(fixture, payload, name);
  expect(value?.status).toBe("ok");
  if (value?.status !== "ok" || value.value.kind !== "number") {
    throw new Error(`expected ${name} to be a numeric scalar success, got ${JSON.stringify(value)}`);
  }
  return value.value.value;
};

describe("SAY-464 nested Module scalar export forwarding through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("keeps per-instance geometry-derived exports available through nested forwarding and reordering", async () => {
    const evaluateSource = async (source: string) => {
      const fixture = fixtureFromSource(source);
      if (!fixture.compiled) throw new Error("expected compiled nested scalar export fixture");
      const options = optionsFor(fixture);
      expect(fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const bindingIdForName = (name: string) => {
        const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
          (candidate) => candidate.kind === "typed" && candidate.name === name
        );
        if (!binding) throw new Error(`typed binding "${name}" not found`);
        return binding.id;
      };
      const forwardedBindingId = (bindingId: string) => {
        const initializer = options.bindingVersions?.versions.find((version) => version.bindingId === bindingId)?.initializer;
        if (initializer?.kind !== "reference" || !initializer.bindingId) {
          throw new Error(`expected binding ${bindingId} to reference an exported scalar`);
        }
        return initializer.bindingId;
      };
      const firstOuterBindingId = forwardedBindingId(bindingIdForName("FirstValue"));
      const secondOuterBindingId = forwardedBindingId(bindingIdForName("SecondValue"));
      const firstInnerBindingId = forwardedBindingId(firstOuterBindingId);
      const secondInnerBindingId = forwardedBindingId(secondOuterBindingId);
      expect(firstOuterBindingId).not.toBe(secondOuterBindingId);
      expect(firstInnerBindingId).not.toBe(secondInnerBindingId);

      const input = buildRustEvaluationInput(fixture.elements, options);
      const dependencyEdges = input.scalarExpressionPayload?.conditionalDependencyGraph?.edges ?? [];
      for (const [enclosingBindingId, childBindingId] of [
        [firstOuterBindingId, firstInnerBindingId],
        [secondOuterBindingId, secondInnerBindingId]
      ] as const) {
        expect(dependencyEdges).toContainEqual(expect.objectContaining({
          kind: "initializer",
          from: expect.objectContaining({ kind: "binding", id: enclosingBindingId }),
          to: expect.objectContaining({ kind: "binding", id: childBindingId }),
          requiredness: "required"
        }));
      }

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

      const history = rustPayload.computedScalarBindingVersions ?? [];
      const executedVersionIndex = (bindingId: string) => history.findIndex((version) =>
        version.bindingId === bindingId && version.status === "executed"
      );
      for (const [childBindingId, enclosingBindingId] of [
        [firstInnerBindingId, firstOuterBindingId],
        [secondInnerBindingId, secondOuterBindingId]
      ] as const) {
        const childIndex = executedVersionIndex(childBindingId);
        const enclosingIndex = executedVersionIndex(enclosingBindingId);
        expect(childIndex).toBeGreaterThanOrEqual(0);
        expect(enclosingIndex).toBeGreaterThan(childIndex);
      }

      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors).toEqual([]);
        expect(result.geometryValueErrors ?? []).toEqual([]);
        expect(JSON.stringify(payload)).not.toContain("evaluation-binding-unavailable");
        expect(numberValue(fixture, payload, "FirstValue")).toBeCloseTo(20, 10);
        expect(numberValue(fixture, payload, "SecondValue")).toBeCloseTo(40, 10);
      }

      return {
        first: numberValue(fixture, rustPayload, "FirstValue"),
        second: numberValue(fixture, rustPayload, "SecondValue")
      };
    };

    const authoredOrder = await evaluateSource(twoNestedInstancesSource(false));
    const reordered = await evaluateSource(twoNestedInstancesSource(true));
    expect(authoredOrder).toEqual({ first: 20, second: 40 });
    expect(reordered).toEqual(authoredOrder);
  }, 30000);

  it("keeps a direct Module scalar export root read available", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Inner(width: number) {",
      "  line Shape = segment(start: (0, 0), end: (@width, 0))",
      "  export const value: number = @Shape.length",
      "}",
      "instance Direct = Inner(width: 20)",
      "const DirectValue: number = @Direct::value"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled direct Module scalar export fixture");
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain("evaluation-binding-unavailable");
      expect(numberValue(fixture, payload, "DirectValue")).toBeCloseTo(20, 10);
    }
  }, 30000);
});
