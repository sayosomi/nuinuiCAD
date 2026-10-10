import { renderHook } from "@testing-library/react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument, geometryValueOccurrenceKey } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import type { GeometryInputTarget } from "../src/types/geometry";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { useEvaluationEngine } from "../src/geometry/useEvaluationEngine";
import type { RustEvaluationTransport } from "../src/geometry/rustEvaluationRunner";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  type EvaluationFixture
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let rustStdio: ReturnType<typeof createRustStdioParityClient>;

const expectCompiledWithoutErrors = (fixture: EvaluationFixture) => {
  if (!fixture.compiled) throw new Error("fixture has no compiled document");
  expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
};

const evaluateBoth = async (fixture: EvaluationFixture) => {
  const options = optionsFor(fixture);
  const referencePayload = evaluateElementsReferencePayload(fixture.elements, options);
  const rustPayload = await rustStdio.evaluate(fixture.elements, options);
  expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(referencePayload));
  return {
    options,
    referencePayload,
    rustPayload,
    reference: evaluationPayloadToResult(referencePayload),
    rust: evaluationPayloadToResult(rustPayload)
  };
};

const elementNamed = (fixture: EvaluationFixture, name: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`fixture has no element ${name}`);
  return element;
};

const geometryFor = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  name: string
) => result.computedGeometry.get(elementNamed(fixture, name).id);

const geometryTargetsFor = (fixture: EvaluationFixture, consumerName: string): GeometryInputTarget[] => {
  const id = elementNamed(fixture, consumerName).id;
  const parameters = fixture.compiled?.doc.geometryInputTargetsByElementId?.get(id);
  return [...(parameters?.values() ?? [])].flatMap((value) =>
    Array.isArray(value) ? [...value] : [value as GeometryInputTarget]
  );
};

const sourceOrderFor = (fixture: EvaluationFixture, elementName: string) => {
  const id = elementNamed(fixture, elementName).id;
  return optionsFor(fixture).scalarExecutionPositionByElementId?.get(id) ??
    fixture.compiled?.doc.statementMap.byElementId.get(id)?.statementIndex ??
    -1;
};

const occurrenceTargetFor = (fixture: EvaluationFixture, consumerName: string) => {
  const target = geometryTargetsFor(fixture, consumerName).find((candidate) => candidate.kind === "forGroupOccurrence");
  if (!target || target.kind !== "forGroupOccurrence") {
    throw new Error(`${consumerName} has no canonical forGroupOccurrence target`);
  }
  return target;
};

const occurrencePointsFor = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  templateElementId: string
) => result.forGroupGeneratedRows
  .filter((row) => row.templateElementId === templateElementId)
  .map((row) => {
    const geometry = result.computedGeometry.get(row.generatedElementId);
    if (geometry?.kind !== "point") throw new Error("generated point occurrence has no point geometry");
    return { row, point: { x: geometry.x, y: geometry.y } };
  });

const scalarNumberFor = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  name: string
) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === name);
  if (!binding) throw new Error(`fixture has no scalar binding ${name}`);
  return result.computedScalarBindings?.get(binding.id);
};

const recordsWith = (root: unknown, predicate: (record: Record<string, unknown>) => boolean) => {
  const matches: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (predicate(record)) matches.push(record);
    Object.values(record).forEach(visit);
  };
  visit(root);
  return matches;
};

const issueMessagesFor = (result: ReturnType<typeof evaluationPayloadToResult>, elementName: string) =>
  result.errors.filter((error) => error.elementName === elementName).map((error) => error.message);

describe("statement-for drawable occurrence targets through persistent Rust stdio", () => {
  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it("lowers the minimal indexed drawable reproducer and keeps normal host fallback", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point P = coordinate(x: @i, y: 2)",
      "}",
      "line Use = segment(start: @P[1], end: (0, 0))"
    ].join("\n"));
    expectCompiledWithoutErrors(fixture);

    const pointTemplate = elementNamed(fixture, "P");
    const target = occurrenceTargetFor(fixture, "Use");
    const pointSourceOrder = sourceOrderFor(fixture, "P");
    expect(target).toMatchObject({
      templateElementId: pointTemplate.id,
      geometryType: "point",
      sourceText: "@P[1]"
    });
    expect(target.targetSourceOrder).toBe(pointSourceOrder);
    expect(target.index).not.toBeNull();

    const { reference, rust, options } = await evaluateBoth(fixture);
    for (const result of [reference, rust]) {
      expect(result.errors).toEqual([]);
      expect(occurrencePointsFor(fixture, result, pointTemplate.id).map(({ point }) => point)).toEqual([
        { x: 0, y: 2 },
        { x: 1, y: 2 }
      ]);
      expect(geometryFor(fixture, result, "Use")).toMatchObject({
        kind: "line",
        start: { x: 1, y: 2 },
        end: { x: 0, y: 0 }
      });
    }

    // The production host keeps this fixture on its existing reference route;
    // direct Rust stdio above independently verifies Rust's shared input contract.
    expect(isRustEligibleFixture(fixture)).toBe(false);
    const hostTransport = vi.fn<RustEvaluationTransport>((input) => rustStdio.evaluateInput(input));
    const { result: host } = renderHook(() => useEvaluationEngine(fixture.elements, options, 1, hostTransport));
    expect(host.current.rustEligible).toBe(false);
    expect(host.current.source).toBe("reference");
    expect(host.current.evaluation.errors).toEqual([]);
    expect(host.current.evaluation.computedGeometry.get(elementNamed(fixture, "Use").id)).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 0, y: 0 }
    });
    expect(hostTransport).not.toHaveBeenCalled();
  }, 30_000);

  it("selects the requested occurrences for two consumers of a numeric-carry loop", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) carry shift: number = 0 {",
      "  point P = coordinate(x: @i + @shift, y: 4)",
      "  next shift = @shift + 10",
      "}",
      "line First = segment(start: @P[0], end: (-1, 4))",
      "line Second = segment(start: @P[0 + 1], end: (-1, 4))"
    ].join("\n"));
    expectCompiledWithoutErrors(fixture);

    const pointTemplate = elementNamed(fixture, "P");
    const firstTarget = occurrenceTargetFor(fixture, "First");
    const secondTarget = occurrenceTargetFor(fixture, "Second");
    expect(firstTarget).toMatchObject({ kind: "forGroupOccurrence", templateElementId: pointTemplate.id, targetSourceOrder: sourceOrderFor(fixture, "P") });
    expect(firstTarget.index).not.toBeNull();
    expect(secondTarget).toMatchObject({ kind: "forGroupOccurrence", templateElementId: pointTemplate.id, targetSourceOrder: sourceOrderFor(fixture, "P") });
    expect(secondTarget.index).toMatchObject({ kind: expect.any(String) });

    const { reference, rust } = await evaluateBoth(fixture);
    for (const result of [reference, rust]) {
      expect(result.errors).toEqual([]);
      expect(occurrencePointsFor(fixture, result, pointTemplate.id).map(({ point }) => point)).toEqual([
        { x: 0, y: 4 },
        { x: 11, y: 4 }
      ]);
      expect(geometryFor(fixture, result, "First")).toMatchObject({ start: { x: 0, y: 4 } });
      expect(geometryFor(fixture, result, "Second")).toMatchObject({ start: { x: 11, y: 4 } });
    }
  }, 30_000);

  it("keeps no-carry and nested occurrence order in compiler targets and runtime provenance", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  for j in range(min: 0, max: 1, step: 1) {",
      "    point P = coordinate(x: @i * 10 + @j, y: 5)",
      "  }",
      "}",
      "line First = segment(start: @P[0], end: (0, 0))",
      "line Last = segment(start: @P[3], end: (0, 0))"
    ].join("\n"));
    expectCompiledWithoutErrors(fixture);

    const pointTemplate = elementNamed(fixture, "P");
    const firstTarget = occurrenceTargetFor(fixture, "First");
    const lastTarget = occurrenceTargetFor(fixture, "Last");
    expect(firstTarget.templateElementId).toBe(pointTemplate.id);
    expect(lastTarget.templateElementId).toBe(pointTemplate.id);
    expect(firstTarget.targetSourceOrder).toBe(sourceOrderFor(fixture, "P"));
    expect(lastTarget.targetSourceOrder).toBe(sourceOrderFor(fixture, "P"));

    const { reference, rust } = await evaluateBoth(fixture);
    for (const result of [reference, rust]) {
      expect(result.errors).toEqual([]);
      const rows = occurrencePointsFor(fixture, result, pointTemplate.id);
      expect(rows.map(({ row }) => row.occurrencePath.map((step) => step.iterationIndex))).toEqual([
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1]
      ]);
      expect(rows.map(({ point }) => point)).toEqual([
        { x: 0, y: 5 },
        { x: 1, y: 5 },
        { x: 10, y: 5 },
        { x: 11, y: 5 }
      ]);
      expect(geometryFor(fixture, result, "First")).toMatchObject({ start: { x: 0, y: 5 } });
      expect(geometryFor(fixture, result, "Last")).toMatchObject({ start: { x: 11, y: 5 } });
    }
  }, 30_000);

  it("lowers occurrence indexes for derived-point and geometry-property consumers", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  line H = segment(start: (0, @i * 10), end: (10, @i * 10))",
      "}",
      "line Use = segment(start: @H[1].end, end: (0, 0))",
      "point Measure = coordinate(x: @H[1].length, y: 0)"
    ].join("\n"));
    expectCompiledWithoutErrors(fixture);

    const lineTemplate = elementNamed(fixture, "H");
    const loweredOccurrenceNodes = recordsWith([...(fixture.compiled?.doc.numericBindings?.values() ?? [])], (record) =>
      record.forGroupOccurrenceTemplateElementId === lineTemplate.id
    );
    expect(loweredOccurrenceNodes.length).toBeGreaterThan(0);
    expect(loweredOccurrenceNodes.every((record) => record.forGroupOccurrenceIndex !== null)).toBe(true);
    expect(loweredOccurrenceNodes[0]?.targetSourceOrder).toBe(sourceOrderFor(fixture, "H"));
    expect(occurrenceTargetFor(fixture, "Use")).toMatchObject({
      templateElementId: lineTemplate.id,
      pointKey: "end",
      targetSourceOrder: sourceOrderFor(fixture, "H")
    });

    const { reference, rust } = await evaluateBoth(fixture);
    for (const result of [reference, rust]) {
      expect(result.errors).toEqual([]);
      expect(geometryFor(fixture, result, "Use")).toMatchObject({
        kind: "line",
        start: { x: 10, y: 10 },
        end: { x: 0, y: 0 }
      });
      expect(geometryFor(fixture, result, "Measure")).toMatchObject({
        kind: "point",
        x: 10,
        y: 0
      });
    }
  }, 30_000);

  it("keeps canonical diagnostics for invalid, unavailable, and out-of-range selectors", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point P = coordinate(x: @i, y: 2)",
      "}",
      "line Negative = segment(start: @P[-1], end: (0, 0))",
      "line Fractional = segment(start: @P[0.5], end: (0, 0))",
      "line NonFinite = segment(start: @P[1 / 0], end: (0, 0))",
      "line OutOfRange = segment(start: @P[2], end: (0, 0))",
      "line Bare = segment(start: @P, end: (0, 0))"
    ].join("\n"));
    const { reference, rust } = await evaluateBoth(fixture);

    for (const result of [reference, rust]) {
      expect(issueMessagesFor(result, "Negative").join("\n")).toContain("evaluation-collection-index-invalid");
      expect(issueMessagesFor(result, "Fractional").join("\n")).toContain("evaluation-collection-index-invalid");
      expect(issueMessagesFor(result, "OutOfRange").join("\n")).toContain("evaluation-collection-index-invalid");
      expect(issueMessagesFor(result, "NonFinite").join("\n")).toContain("evaluation-divide-by-zero");
      expect(result.errors.some((error) => error.elementName === "Bare" && error.missingDependencyId === "@P")).toBe(true);
      expect(result.errors.some((error) => error.elementName !== "Bare" && error.missingDependencyId.startsWith("@P["))).toBe(false);
    }

    const invalidType = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) {",
      "  point P = coordinate(x: @i, y: 2)",
      "}",
      "line Invalid = segment(start: @P[true], end: (0, 0))"
    ].join("\n"));
    expect(invalidType.status).toBe("fatal");
    expect(invalidType.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(invalidType.diagnostics.some((diagnostic) => diagnostic.code.includes("index"))).toBe(true);
  }, 30_000);

  it("preserves source-position availability and legacy root/map controls", async () => {
    const early = fixtureFromSource([
      "nui 1",
      "line Early = segment(start: @P[0], end: (0, 0))",
      "for i in range(min: 0, max: 0, step: 1) {",
      "  point P = coordinate(x: @i, y: 2)",
      "}"
    ].join("\n"));
    expectCompiledWithoutErrors(early);
    const earlyResults = await evaluateBoth(early);
    for (const result of [earlyResults.reference, earlyResults.rust]) {
      expect(issueMessagesFor(result, "Early").join("\n")).toContain("evaluation-collection-index-unavailable");
      expect(geometryFor(early, result, "Early")).toBeUndefined();
    }

    const singular = fixtureFromSource([
      "nui 1",
      "point P = coordinate(x: 4, y: 6)",
      "line Use = segment(start: @P, end: (0, 0))"
    ].join("\n"));
    expectCompiledWithoutErrors(singular);
    expect(geometryTargetsFor(singular, "Use").some((target) => target.kind === "forGroupOccurrence")).toBe(false);
    const singularResults = await evaluateBoth(singular);
    for (const result of [singularResults.reference, singularResults.rust]) {
      expect(result.errors).toEqual([]);
      expect(geometryFor(singular, result, "Use")).toMatchObject({ start: { x: 4, y: 6 } });
    }

    const immutableMap = fixtureFromSource([
      "nui 1",
      "const points: point[] = [(1, 2), (3, 4)]",
      "line Use = segment(start: @points[1], end: (0, 0))"
    ].join("\n"));
    expectCompiledWithoutErrors(immutableMap);
    const mapResults = await evaluateBoth(immutableMap);
    for (const result of [mapResults.reference, mapResults.rust]) {
      expect(result.errors).toEqual([]);
      expect(geometryFor(immutableMap, result, "Use")).toMatchObject({ start: { x: 3, y: 4 } });
    }

    // SAY-491 control: runtime-generated immutable map values remain published
    // with their compiler-owned occurrence identities through persistent Rust.
    const carriedMap = fixtureFromSource([
      "nui 1",
      "point Seed = coordinate(x: 0, y: 0)",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for p in @points { @p }",
      "for p in @mapped carry last: point = @Seed {",
      "  next last = @p",
      "}",
      "const resultX: number = @last.x"
    ].join("\n"));
    expectCompiledWithoutErrors(carriedMap);
    const carryResults = await evaluateBoth(carriedMap);
    const expectedMapEntries = carriedMap.compiled?.doc.geometryValueProgram?.filter((entry) =>
      entry.occurrence.mappedMemberIndex !== undefined
    ) ?? [];
    expect(expectedMapEntries).toHaveLength(2);
    expect(expectedMapEntries.map((entry) => entry.occurrence.mappedMemberIndex)).toEqual([0, 1]);
    for (const result of [carryResults.reference, carryResults.rust]) {
      const published = expectedMapEntries.map((entry) =>
        result.computedGeometryValues.get(geometryValueOccurrenceKey(entry.occurrence))
      );
      expect(published.map((entry) => entry?.value)).toEqual([
        { kind: "point", x: 1, y: 2 },
        { kind: "point", x: 3, y: 4 }
      ]);
      expect(scalarNumberFor(carriedMap, result, "resultX")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 3 }
      });
    }
  }, 60_000);
});
