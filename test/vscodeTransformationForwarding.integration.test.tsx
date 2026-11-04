import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, transformationStageKey } from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { buildRustEvaluationInput, type EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { useEvaluationEngine } from "../src/geometry/useEvaluationEngine";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import { renderHook, waitFor } from "@testing-library/react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const moveFixture = fixtureFromSource([
  "nui 1",
  "line Test = segment(start: (0, 0), end: (100, 0))",
  "move @Test as Shifted(from: (0, 0), to: (50, 0))",
  "point EndProbe = coordinate(x: @Test.endPoint.x, y: 20)"
].join("\n"));

const extendFixture = (targetX: number) => fixtureFromSource([
  "nui 1",
  "line Test = segment(start: (0, 0), end: (100, 0))",
  `point Mid = coordinate(x: ${targetX}, y: 0)`,
  "extend @Test.end(to: @Mid)",
  "point EndProbe = coordinate(x: @Test.endPoint.x, y: 20)"
].join("\n"));

const namedStageFixture = fixtureFromSource([
  "nui 1",
  "line Test = segment(start: (0, 0), end: (100, 0))",
  "move @Test as Shifted(from: (0, 0), to: (50, 0))",
  "line BaseCopy = from(source: @Test.base)",
  "line StageCopy = from(source: @Test.Shifted)",
  "point EndProbe = coordinate(x: @Test.endPoint.x, y: 20)"
].join("\n"));

const elementByName = (elements: { id: string; name: string }[], name: string) => {
  const element = elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing fixture element ${name}`);
  return element;
};

describe("Issue #1543 transformation forwarding through the VS Code evaluation Hook and Rust", () => {
  let rust: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rust = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rust?.dispose());

  it.each([
    {
      name: "move",
      fixture: moveFixture,
      expectedStart: 50,
      expectedEnd: 150
    },
    {
      name: "extend shortens",
      fixture: extendFixture(50),
      expectedStart: 0,
      expectedEnd: 50
    },
    {
      name: "extend lengthens",
      fixture: extendFixture(150),
      expectedStart: 0,
      expectedEnd: 150
    }
  ])("forwards the compiler products for $name into its Rust request", async ({ fixture, expectedStart, expectedEnd }) => {
    const compiled = fixture.compiled;
    if (!compiled) throw new Error("expected a compiled transformation fixture");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    // This is the same production lowering used by the single-document VS Code Canvas.
    const options = buildEvaluationOptions({
      compiledDocument: compiled.doc,
      evaluationLimitIndex: fixture.evaluationLimitIndex
    });
    expect(options.transformationRecipes).toHaveLength(1);
    expect(options.transformationDependencyPlans).toHaveLength(1);
    expect(options.transformationNumericBindingEntries ?? []).toEqual([]);

    const fullInput = buildRustEvaluationInput(fixture.elements, options);
    expect(fullInput.transformationRecipes).toMatchObject({
      recipes: options.transformationRecipes,
      dependencyPlans: options.transformationDependencyPlans,
      numericBindings: []
    });
    const directReference = evaluateElementsReferencePayload(fixture.elements, options);
    const directRust = await rust!.evaluateInput(fullInput);
    expect(normalizeParityPayload(directRust)).toEqual(normalizeParityPayload(directReference));

    const hookRequests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      hookRequests.push(input);
      return rust!.evaluateInput(input);
    };
    const { result } = renderHook(() => useEvaluationEngine(fixture.elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const hookInput = hookRequests.at(-1)!;
    expect.soft(hookInput.transformationRecipes).toEqual(fullInput.transformationRecipes);
    expect.soft(normalizeParityPayload(hookInput)).toEqual(normalizeParityPayload(fullInput));
    expect.soft(result.current.evaluation.errors).toEqual([]);
    expect.soft(result.current.evaluation.geometryValueErrors ?? []).toEqual([]);

    const testLine = result.current.evaluation.computedGeometry.get(elementByName(fixture.elements, "Test").id);
    const endProbe = result.current.evaluation.computedGeometry.get(elementByName(fixture.elements, "EndProbe").id);
    expect.soft(testLine).toMatchObject({
      kind: "line",
      start: { x: expectedStart, y: 0 },
      end: { x: expectedEnd, y: 0 }
    });
    expect.soft(endProbe).toMatchObject({ kind: "point", x: expectedEnd, y: 20 });
  }, 30000);

  it("preserves base geometry and makes the named stage available to a downstream source construction", async () => {
    const compiled = namedStageFixture.compiled;
    if (!compiled) throw new Error("expected a compiled named-stage fixture");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(namedStageFixture);
    expect(options.transformationRecipes).toHaveLength(1);
    expect(options.transformationDependencyPlans).toHaveLength(1);

    const requests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      requests.push(input);
      return rust!.evaluateInput(input);
    };
    const { result } = renderHook(() => useEvaluationEngine(namedStageFixture.elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const test = elementByName(namedStageFixture.elements, "Test");
    expect(requests.at(-1)?.transformationRecipes).toMatchObject({ recipes: options.transformationRecipes });
    expect(result.current.evaluation.errors).toEqual([]);
    expect(result.current.evaluation.preMutationGeometry?.get(test.id)).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 }
    });
    expect(result.current.evaluation.transformationStageGeometry?.get(
      transformationStageKey(test.id, undefined, ["Shifted"])
    )).toMatchObject({
      kind: "line",
      start: { x: 50, y: 0 },
      end: { x: 150, y: 0 }
    });
    expect(result.current.evaluation.computedGeometry.get(elementByName(namedStageFixture.elements, "BaseCopy").id))
      .toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    expect(result.current.evaluation.computedGeometry.get(elementByName(namedStageFixture.elements, "StageCopy").id))
      .toMatchObject({ kind: "line", start: { x: 50, y: 0 }, end: { x: 150, y: 0 } });
    expect(result.current.evaluation.computedGeometry.get(elementByName(namedStageFixture.elements, "EndProbe").id))
      .toMatchObject({ kind: "point", x: 150, y: 20 });

    const fullInput = buildRustEvaluationInput(namedStageFixture.elements, options);
    expect(normalizeParityPayload(requests.at(-1))).toEqual(normalizeParityPayload(fullInput));
    expect(normalizeParityPayload(await rust!.evaluateInput(fullInput))).toEqual(normalizeParityPayload(
      evaluateElementsReferencePayload(namedStageFixture.elements, options)
    ));
  }, 30000);

  it("refreshes a compiler-produced numeric transformation input while drawable elements stay unchanged", async () => {
    const fixtureForShift = (shift: number) => {
      const source = [
        "nui 1",
        `const dx: number = ${shift}`,
        "line Test = segment(start: (0, 0), end: (100, 0))",
        "move @Test as Shifted(from: (0, 0), to: (@dx, 0))",
        "point EndProbe = coordinate(x: @Test.endPoint.x, y: 20)"
      ].join("\n");
      const preparsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
      const compiled = compileDslDocument(source, {
        preparsed,
        sourceRevision: 1,
        assignedStatementIds: new Map(preparsed.statements.map((_, index) => [index, `issue-1543-numeric:${index}`]))
      });
      if (!compiled.document) throw new Error("expected a compiled numeric transformation fixture");
      return {
        elements: compiled.document.elements,
        options: buildEvaluationOptions({
          compiledDocument: compiled as LastGoodDslDocument,
          evaluationLimitIndex: undefined
        })
      };
    };
    const initialFixture = fixtureForShift(50);
    const nextFixture = fixtureForShift(70);
    expect(nextFixture.elements).toEqual(initialFixture.elements);
    const initialOptions = initialFixture.options;
    const nextOptions = nextFixture.options;
    expect(initialOptions.transformationNumericBindingEntries).toHaveLength(1);
    expect(nextOptions.transformationNumericBindingEntries).toEqual(initialOptions.transformationNumericBindingEntries);

    const requests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      requests.push(input);
      return rust!.evaluateInput(input);
    };
    const { result, rerender } = renderHook(
      ({ options }) => useEvaluationEngine(initialFixture.elements, options, 1, transport),
      { initialProps: { options: initialOptions } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const lineId = elementByName(initialFixture.elements, "Test").id;
    const probeId = elementByName(initialFixture.elements, "EndProbe").id;
    expect(result.current.evaluation.computedGeometry.get(lineId)).toMatchObject({
      kind: "line", start: { x: 50, y: 0 }, end: { x: 150, y: 0 }
    });
    expect(result.current.evaluation.computedGeometry.get(probeId)).toMatchObject({ kind: "point", x: 150, y: 20 });

    const firstRequestRevision = result.current.evaluationRequestRevision;
    rerender({ options: nextOptions });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(requests).toHaveLength(2);
    expect(result.current.evaluationRequestRevision).toBeGreaterThan(firstRequestRevision);
    expect(requests[1]?.transformationRecipes).toMatchObject({
      recipes: nextOptions.transformationRecipes,
      dependencyPlans: nextOptions.transformationDependencyPlans,
      numericBindings: nextOptions.transformationNumericBindingEntries
    });
    expect(result.current.evaluation.computedGeometry.get(lineId)).toMatchObject({
      kind: "line", start: { x: 70, y: 0 }, end: { x: 170, y: 0 }
    });
    expect(result.current.evaluation.computedGeometry.get(probeId)).toMatchObject({ kind: "point", x: 170, y: 20 });

    for (const [fixture, options, input] of [
      [initialFixture, initialOptions, requests[0]!],
      [nextFixture, nextOptions, requests[1]!]
    ] as const) {
      expect(normalizeParityPayload(await rust!.evaluateInput(input))).toEqual(normalizeParityPayload(
        evaluateElementsReferencePayload(fixture.elements, options)
      ));
    }
  }, 30000);

  it("keeps an invalid extend actionable through the Rust-backed Hook", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Test = segment(start: (0, 0), end: (100, 0))",
      "point Mid = coordinate(x: 150, y: 10)",
      "extend @Test.end(to: @Mid)"
    ].join("\n"));
    const compiled = fixture.compiled;
    if (!compiled) throw new Error("expected a compiled invalid-input fixture");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = buildEvaluationOptions({
      compiledDocument: compiled.doc,
      evaluationLimitIndex: fixture.evaluationLimitIndex
    });
    expect(options.transformationRecipes).toHaveLength(1);
    expect(options.transformationDependencyPlans).toHaveLength(1);

    const fullInput = buildRustEvaluationInput(fixture.elements, options);
    const directRust = await rust!.evaluateInput(fullInput);
    const directReference = evaluateElementsReferencePayload(fixture.elements, options);
    expect(normalizeParityPayload(directRust)).toEqual(normalizeParityPayload(directReference));

    const requests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      requests.push(input);
      return rust!.evaluateInput(input);
    };
    const { result } = renderHook(() => useEvaluationEngine(fixture.elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const lineId = elementByName(fixture.elements, "Test").id;
    expect(requests.at(-1)?.transformationRecipes).toEqual(fullInput.transformationRecipes);
    expect(result.current.evaluation.errors).toHaveLength(1);
    expect(result.current.evaluation.errors[0]?.message).toContain("Test の終点は");
    expect(result.current.evaluation.computedGeometry.get(lineId)).toMatchObject({
      kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }
    });
  }, 30000);
});
