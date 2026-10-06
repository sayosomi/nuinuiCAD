import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const twoNestedInstancesSource = (reordered: boolean, outerExportBeforeNested = false) => [
  "nui 1",
  "module Inner(width: number) {",
  "  line Shape = segment(start: (0, 0), end: (@width, 0))",
  "  export const value: number = @Shape.length",
  "}",
  "module Outer(width: number) {",
  ...(outerExportBeforeNested
    ? [
        "  export const value: number = @Nested::value",
        "  instance Nested = Inner(width: @width)"
      ]
    : [
        "  instance Nested = Inner(width: @width)",
        "  export const value: number = @Nested::value"
      ]),
  "}",
  ...(reordered
    ? [
        "instance Sibling = Outer(width: 40)",
        "instance Root = Outer(width: 20)",
        "const SiblingValue: number = @Sibling::value",
        "const Got: number = @Root::value"
      ]
    : [
        "instance Root = Outer(width: 20)",
        "instance Sibling = Outer(width: 40)",
        "const Got: number = @Root::value",
        "const SiblingValue: number = @Sibling::value"
      ])
].join("\n");

const twoScalarNestedInstancesSource = (reordered: boolean) => [
  "nui 1",
  "module Inner(width: number) {",
  "  export const value: number = @width",
  "}",
  "module Outer(width: number) {",
  "  export const forwarded: number = @Nested::value",
  "  instance Nested = Inner(width: @width)",
  "}",
  ...(reordered
    ? [
        "instance Sibling = Outer(width: 40)",
        "instance Root = Outer(width: 20)",
        "const SiblingValue: number = @Sibling::forwarded",
        "const Got: number = @Root::forwarded"
      ]
    : [
        "instance Root = Outer(width: 20)",
        "instance Sibling = Outer(width: 40)",
        "const Got: number = @Root::forwarded",
        "const SiblingValue: number = @Sibling::forwarded"
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

describe("SAY-464/SAY-465 nested Module scalar export forwarding through persistent Rust stdio", () => {
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
      const rootOuterBindingId = forwardedBindingId(bindingIdForName("Got"));
      const siblingOuterBindingId = forwardedBindingId(bindingIdForName("SiblingValue"));
      const rootInnerBindingId = forwardedBindingId(rootOuterBindingId);
      const siblingInnerBindingId = forwardedBindingId(siblingOuterBindingId);
      expect(rootOuterBindingId).not.toBe(siblingOuterBindingId);
      expect(rootInnerBindingId).not.toBe(siblingInnerBindingId);

      const input = buildRustEvaluationInput(fixture.elements, options);
      const dependencyEdges = input.scalarExpressionPayload?.conditionalDependencyGraph?.edges ?? [];
      for (const [enclosingBindingId, childBindingId] of [
        [rootOuterBindingId, rootInnerBindingId],
        [siblingOuterBindingId, siblingInnerBindingId]
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

      for (const [childBindingId, enclosingBindingId] of [
        [rootInnerBindingId, rootOuterBindingId],
        [siblingInnerBindingId, siblingOuterBindingId]
      ] as const) {
        for (const payload of [tsPayload, rustPayload]) {
          const history = payload.computedScalarBindingVersions ?? [];
          const executedVersionIndex = (bindingId: string) => history.findIndex((version) =>
            version.bindingId === bindingId && version.status === "executed"
          );
          const childIndex = executedVersionIndex(childBindingId);
          const enclosingIndex = executedVersionIndex(enclosingBindingId);
          expect(childIndex).toBeGreaterThanOrEqual(0);
          expect(enclosingIndex).toBeGreaterThan(childIndex);
        }
      }

      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors).toEqual([]);
        expect(result.geometryValueErrors ?? []).toEqual([]);
        expect(JSON.stringify(payload)).not.toContain("evaluation-binding-unavailable");
        expect(numberValue(fixture, payload, "Got")).toBeCloseTo(20, 10);
        expect(numberValue(fixture, payload, "SiblingValue")).toBeCloseTo(40, 10);
      }

      return {
        got: numberValue(fixture, rustPayload, "Got"),
        sibling: numberValue(fixture, rustPayload, "SiblingValue")
      };
    };

    const authoredOrder = await evaluateSource(twoNestedInstancesSource(false));
    const reordered = await evaluateSource(twoNestedInstancesSource(true));
    const forwardedBeforeNested = await evaluateSource(twoNestedInstancesSource(false, true));
    const forwardedBeforeNestedReordered = await evaluateSource(twoNestedInstancesSource(true, true));
    expect(authoredOrder).toEqual({ got: 20, sibling: 40 });
    expect(reordered).toEqual(authoredOrder);
    expect(forwardedBeforeNested).toEqual(authoredOrder);
    expect(forwardedBeforeNestedReordered).toEqual(authoredOrder);
  }, 30000);

  it("keeps scalar-only nested forwarding available", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Inner(width: number) {",
      "  export const value: number = @width",
      "}",
      "module Outer(width: number) {",
      "  instance Nested = Inner(width: @width)",
      "  export const forwarded: number = @Nested::value",
      "}",
      "instance Root = Outer(width: 20)",
      "const Got: number = @Root::forwarded"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled scalar-only nested export fixture");
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
    const referencedBindingId = (bindingId: string) => {
      const initializer = options.bindingVersions?.versions.find((version) => version.bindingId === bindingId)?.initializer;
      if (initializer?.kind !== "reference" || !initializer.bindingId) {
        throw new Error(`expected binding ${bindingId} to reference an exported scalar`);
      }
      return initializer.bindingId;
    };
    const outerBindingId = referencedBindingId(bindingIdForName("Got"));
    const childBindingId = referencedBindingId(outerBindingId);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain("evaluation-binding-unavailable");
      expect(numberValue(fixture, payload, "Got")).toBeCloseTo(20, 10);
      const history = payload.computedScalarBindingVersions ?? [];
      const childIndex = history.findIndex((version) => version.bindingId === childBindingId && version.status === "executed");
      const outerIndex = history.findIndex((version) => version.bindingId === outerBindingId && version.status === "executed");
      expect(childIndex).toBeGreaterThanOrEqual(0);
      expect(outerIndex).toBeGreaterThan(childIndex);
    }
  }, 30000);

  it("schedules scalar-only forward nested exports before their enclosing exports", async () => {
    const exactFixture = fixtureFromSource([
      "nui 1",
      "module Inner() {",
      "  export const Value: number = 20",
      "}",
      "module Outer() {",
      "  export const Forwarded: number = @Nested::Value",
      "  instance Nested = Inner()",
      "}",
      "instance Root = Outer()",
      "const Got: number = @Root::Forwarded"
    ].join("\n"));
    if (!exactFixture.compiled) throw new Error("expected compiled scalar-only forward nested export fixture");
    const exactOptions = optionsFor(exactFixture);
    expect(exactFixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(exactFixture)).toBe(true);

    const bindingIdForName = (fixture: ReturnType<typeof fixtureFromSource>, name: string) => {
      const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
        (candidate) => candidate.kind === "typed" && candidate.name === name
      );
      if (!binding) throw new Error(`typed binding "${name}" not found`);
      return binding.id;
    };
    const referencedBindingId = (fixture: ReturnType<typeof fixtureFromSource>, options: ReturnType<typeof optionsFor>, bindingId: string) => {
      const initializer = options.bindingVersions?.versions.find((version) => version.bindingId === bindingId)?.initializer;
      if (initializer?.kind !== "reference" || !initializer.bindingId) {
        throw new Error(`expected binding ${bindingId} to reference an exported scalar`);
      }
      return initializer.bindingId;
    };
    const assertForwardedHistory = (
      fixture: ReturnType<typeof fixtureFromSource>,
      options: ReturnType<typeof optionsFor>,
      payload: EvaluationPayload,
      observationName: string,
      expectedValue: number
    ) => {
      const outerBindingId = referencedBindingId(fixture, options, bindingIdForName(fixture, observationName));
      const childBindingId = referencedBindingId(fixture, options, outerBindingId);
      expect(options.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          from: expect.objectContaining({ kind: "binding", id: outerBindingId }),
          to: expect.objectContaining({ kind: "binding", id: childBindingId }),
          requiredness: "required"
        })
      ]));
      const evaluation = evaluationPayloadToResult(payload);
      expect(evaluation.errors).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain("evaluation-binding-unavailable");
      expect(numberValue(fixture, payload, observationName)).toBeCloseTo(expectedValue, 10);
      const history = payload.computedScalarBindingVersions ?? [];
      const childIndex = history.findIndex((version) => version.bindingId === childBindingId && version.status === "executed");
      const outerIndex = history.findIndex((version) => version.bindingId === outerBindingId && version.status === "executed");
      expect(childIndex).toBeGreaterThanOrEqual(0);
      expect(outerIndex).toBeGreaterThan(childIndex);
      return { outerBindingId, childBindingId };
    };

    const exactTsPayload = evaluateElementsReferencePayload(exactFixture.elements, exactOptions);
    const exactRustPayload = await rustStdio!.evaluate(exactFixture.elements, exactOptions);
    expect(normalizeParityPayload(exactRustPayload)).toEqual(normalizeParityPayload(exactTsPayload));
    assertForwardedHistory(exactFixture, exactOptions, exactTsPayload, "Got", 20);
    assertForwardedHistory(exactFixture, exactOptions, exactRustPayload, "Got", 20);

    const evaluateTwoInstances = async (reordered: boolean) => {
      const fixture = fixtureFromSource(twoScalarNestedInstancesSource(reordered));
      if (!fixture.compiled) throw new Error("expected compiled two-instance scalar-only forwarding fixture");
      const options = optionsFor(fixture);
      expect(fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const root = assertForwardedHistory(fixture, options, payload, "Got", 20);
        const sibling = assertForwardedHistory(fixture, options, payload, "SiblingValue", 40);
        expect(root.outerBindingId).not.toBe(sibling.outerBindingId);
        expect(root.childBindingId).not.toBe(sibling.childBindingId);
      }
      return {
        got: numberValue(fixture, rustPayload, "Got"),
        sibling: numberValue(fixture, rustPayload, "SiblingValue")
      };
    };
    const authoredOrder = await evaluateTwoInstances(false);
    const reordered = await evaluateTwoInstances(true);
    expect(authoredOrder).toEqual({ got: 20, sibling: 40 });
    expect(reordered).toEqual(authoredOrder);
  }, 30000);

  it("preserves explicit runtime failure for a failed nested prerequisite", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Inner() {",
      "  export const value: number = 1 / 0",
      "}",
      "module Outer() {",
      "  export const forwarded: number = @Nested::value",
      "  instance Nested = Inner()",
      "}",
      "instance Root = Outer()",
      "const Got: number = @Root::forwarded"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled failed nested prerequisite fixture");
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
    const referencedBindingId = (bindingId: string) => {
      const initializer = options.bindingVersions?.versions.find((version) => version.bindingId === bindingId)?.initializer;
      if (initializer?.kind !== "reference" || !initializer.bindingId) {
        throw new Error(`expected binding ${bindingId} to reference an exported scalar`);
      }
      return initializer.bindingId;
    };
    const outerBindingId = referencedBindingId(bindingIdForName("Got"));
    const childBindingId = referencedBindingId(outerBindingId);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBinding(fixture, payload, "Got").status).toBe("error");
      expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(childBindingId)).toMatchObject({
        status: "error",
        issueCode: "evaluation-divide-by-zero"
      });
      expect(JSON.stringify(payload)).toContain("evaluation-divide-by-zero");
    }
  }, 30000);

  it("keeps a true nested scalar dependency cycle in the canonical dependency diagnostics", () => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "module Inner() {",
      "  export const First: number = @Second",
      "  export const Second: number = @First",
      "}",
      "instance Root = Inner()",
      "const Got: number = @Root::First"
    ].join("\n"));
    expect(compiled.status).toBe("fatal");
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dependency-cycle", severity: "error" })
    ]));
  });

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
