import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const elementByName = (fixture: ReturnType<typeof fixtureFromSource>, name: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`element "${name}" not found`);
  return element;
};

const geometryFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  payload: EvaluationPayload,
  name: string
) => evaluationPayloadToResult(payload).computedGeometry.get(elementByName(fixture, name).id);

const scalarFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  payload: EvaluationPayload,
  name: string
) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const observable = (fixture: ReturnType<typeof fixtureFromSource>, payload: EvaluationPayload) => {
  const result = evaluationPayloadToResult(payload);
  const summarizeGeometry = (geometry: ReturnType<typeof geometryFor>) => {
    if (!geometry) return undefined;
    if (geometry.kind === "point") return { kind: geometry.kind, x: geometry.x, y: geometry.y };
    return {
      kind: geometry.kind,
      start: "start" in geometry ? { x: geometry.start?.x, y: geometry.start?.y } : undefined,
      end: "end" in geometry ? { x: geometry.end?.x, y: geometry.end?.y } : undefined,
      length: "length" in geometry ? geometry.length : undefined
    };
  };
  return {
    errors: result.errors,
    geometryValueErrors: result.geometryValueErrors ?? [],
    computedGeometry: fixture.elements.map((element) => [
      element.name,
      summarizeGeometry(result.computedGeometry.get(element.id))
    ]),
    computedGeometryValues: [...(result.computedGeometryValues?.values() ?? [])].map((entry) => ({
      occurrence: entry.occurrence,
      value: entry.value
    })),
    scalarBindings: (fixture.compiled?.doc.bindingAnalysis?.catalog.bindings ?? [])
      .filter((binding) => binding.kind === "typed")
      .map((binding) => [binding.name, result.computedScalarBindings?.get(binding.id)]),
    evaluatedElementIds: [...(result.evaluatedElementIds ?? [])],
    evaluationLimitIndex: result.evaluationLimitIndex
  };
};

describe("Rust geometry-value if/match scalar selectors", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateFixtureBoth = async (
    fixture: ReturnType<typeof fixtureFromSource>,
    evaluationLimitIndex?: number,
    selectorName?: string
  ) => {
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const baseOptions = optionsFor(fixture);
    const options = {
      ...baseOptions,
      ...(evaluationLimitIndex === undefined ? {} : { evaluationLimitIndex })
    };
    const input = buildRustEvaluationInput(fixture.elements, options);
    if (selectorName) {
      const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
        (candidate) => candidate.kind === "typed" && candidate.name === selectorName
      );
      expect(binding).toBeDefined();
      const graphEdges = options.typedDependencyGraph?.edges ?? [];
      const selectorPrerequisites = graphEdges.filter((edge) =>
        edge.from.kind === "geometry-value" && edge.to.kind === "binding" && edge.to.id === binding?.id
      );
      expect(selectorPrerequisites.length).toBeGreaterThan(0);
      expect(input.scalarExpressionPayload?.conditionalDependencyGraph?.edges).toEqual(graphEdges);
      expect(input.bindingVersions?.versions.some((version) => version.bindingId === binding?.id)).toBe(true);
      expect(input.geometryValueProgram?.some((entry) =>
        entry.construction.kind === "if" || entry.construction.kind === "match"
      )).toBe(true);
    }

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(input);
    expect(normalizeParityPayload(observable(fixture, rustPayload))).toEqual(
      normalizeParityPayload(observable(fixture, tsPayload))
    );
    return { fixture, options, tsPayload, rustPayload };
  };

  const evaluateBoth = async (
    source: string,
    evaluationLimitIndex?: number,
    selectorName?: string
  ) => evaluateFixtureBoth(fixtureFromSource(source), evaluationLimitIndex, selectorName);

  it("releases a directly referenced boolean if selector before the one drawable", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const flag: boolean = true",
      "const chosen: point = if (@flag) { coordinate(x: 1, y: 2) } else { coordinate(x: 7, y: 8) }",
      "point Use = from(source: @chosen)"
    ].join("\n"), 1, "flag");

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(evaluated.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 1, y: 2 });
      expect(scalarFor(evaluated.fixture, payload, "flag")).toMatchObject({
        status: "ok",
        value: { kind: "boolean", value: true }
      });
      expect([...((result.computedGeometryValues?.values()) ?? [])].map((entry) => entry.value))
        .toContainEqual({ kind: "point", x: 1, y: 2 });
    }
  }, 60_000);

  it("releases an exhaustive choice-match scrutinee and evaluates only the selected leaf", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const side: choice(left, right) = right",
      "const chosen: point = match @side { left => coordinate(x: 1 / 0, y: 9) right => coordinate(x: 3, y: 4) }",
      "point Use = from(source: @chosen)"
    ].join("\n"), 1, "side");

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(evaluated.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 3, y: 4 });
      expect(scalarFor(evaluated.fixture, payload, "side")).toMatchObject({
        status: "ok",
        value: { kind: "choice", value: "right" }
      });
      expect([...((result.computedGeometryValues?.values()) ?? [])].map((entry) => entry.value))
        .toContainEqual({ kind: "point", x: 3, y: 4 });
    }
  }, 60_000);

  it("keeps literal selectors and earlier scalar-consuming drawables working", async () => {
    const literal = await evaluateBoth([
      "nui 1",
      "const chosen: point = if (true) { coordinate(x: 5, y: 6) } else { coordinate(x: 1 / 0, y: 9) }",
      "point Use = from(source: @chosen)"
    ].join("\n"));
    for (const payload of [literal.tsPayload, literal.rustPayload]) {
      expect(evaluationPayloadToResult(payload).geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(literal.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 5, y: 6 });
    }

    const precedingConsumer = await evaluateBoth([
      "nui 1",
      "const flag: boolean = true",
      "point Earlier = coordinate(x: if (@flag) { 10 } else { 20 }, y: 0)",
      "const chosen: point = if (@flag) { coordinate(x: 1, y: 2) } else { coordinate(x: 7, y: 8) }",
      "point Use = from(source: @chosen)"
    ].join("\n"), undefined, "flag");
    for (const payload of [precedingConsumer.tsPayload, precedingConsumer.rustPayload]) {
      expect(evaluationPayloadToResult(payload).geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(precedingConsumer.fixture, payload, "Earlier")).toMatchObject({ kind: "point", x: 10, y: 0 });
      expect(geometryFor(precedingConsumer.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 1, y: 2 });
    }
  }, 60_000);

  it("preserves failed selector diagnostics instead of suppressing them", async () => {
    const failed = await evaluateBoth([
      "nui 1",
      "const flag: boolean = 1 / 0 > 0",
      "const chosen: point = if (@flag) { coordinate(x: 1, y: 2) } else { coordinate(x: 7, y: 8) }",
      "point Use = from(source: @chosen)"
    ].join("\n"), 1, "flag");

    for (const payload of [failed.tsPayload, failed.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(scalarFor(failed.fixture, payload, "flag")).toMatchObject({ status: "error" });
      expect(result.geometryValueErrors).toHaveLength(1);
      expect(result.geometryValueErrors[0]?.message).toContain("if condition is unavailable or not boolean");
      expect(geometryFor(failed.fixture, payload, "Use")).toBeUndefined();
    }
  }, 60_000);

  it("keeps full-zero-partial-full limits deterministic in one persistent Rust process", async () => {
    const source = [
      "nui 1",
      "const flag: boolean = true",
      "const chosen: point = if (@flag) { coordinate(x: 1, y: 2) } else { coordinate(x: 7, y: 8) }",
      "point Use = from(source: @chosen)",
      "point Later = coordinate(x: 30, y: 40)"
    ].join("\n");
    const fixture = fixtureFromSource(source);
    const fullBefore = await evaluateFixtureBoth(fixture, 2, "flag");
    const zero = await evaluateFixtureBoth(fixture, 0, "flag");
    const partial = await evaluateFixtureBoth(fixture, 1, "flag");
    const fullAfter = await evaluateFixtureBoth(fixture, 2, "flag");

    for (const payload of [zero.tsPayload, zero.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.evaluatedElementIds).toEqual(new Set());
      expect(result.computedGeometry.size).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
    }
    for (const payload of [partial.tsPayload, partial.rustPayload]) {
      expect(geometryFor(partial.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 1, y: 2 });
      expect(geometryFor(partial.fixture, payload, "Later")).toBeUndefined();
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(evaluationPayloadToResult(payload).geometryValueErrors ?? []).toEqual([]);
    }
    for (const payload of [fullBefore.tsPayload, fullBefore.rustPayload, fullAfter.tsPayload, fullAfter.rustPayload]) {
      expect(geometryFor(fullAfter.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 1, y: 2 });
      expect(geometryFor(fullAfter.fixture, payload, "Later")).toMatchObject({ kind: "point", x: 30, y: 40 });
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(evaluationPayloadToResult(payload).geometryValueErrors ?? []).toEqual([]);
    }
    expect(normalizeParityPayload(observable(fullAfter.fixture, fullAfter.rustPayload))).toEqual(
      normalizeParityPayload(observable(fullBefore.fixture, fullBefore.rustPayload))
    );
  }, 60_000);

  it("keeps excluded Module selectors out of terminal release across zero, partial, and full limits", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(x: number) {",
      "  const flag: boolean = @L.length > 5",
      "  const chosen: line = if (@flag) { segment(start: (0, 0), end: (10, 0)) } else { segment(start: (0, 0), end: (5, 0)) }",
      "  export line Use = from(source: @chosen)",
      "  line L = segment(start: (0, 0), end: (@x, 0))",
      "}",
      "instance A = M(x: 4)",
      "instance B = M(x: 9)"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const baseOptions = optionsFor(fixture);
    const snapshots = baseOptions.moduleMaterialization?.instanceBaseGeometrySnapshots;
    if (!snapshots || snapshots.length !== 2) throw new Error("expected two compiler-derived Module boundaries");
    const elementIndexById = new Map(fixture.elements.map((element, index) => [element.id, index]));
    const firstInstanceIndices = snapshots[0]!.descendantIds.map((id) => elementIndexById.get(id));
    const secondInstanceIndices = snapshots[1]!.descendantIds.map((id) => elementIndexById.get(id));
    if (firstInstanceIndices.some((index) => index === undefined) ||
        secondInstanceIndices.some((index) => index === undefined)) {
      throw new Error("Module boundaries must refer to compiled elements");
    }
    const firstInstanceBoundary = Math.max(...firstInstanceIndices as number[]) + 1;
    expect(snapshots[0]!.descendantIds.every((id) => elementIndexById.get(id)! < firstInstanceBoundary)).toBe(true);
    expect(snapshots[1]!.descendantIds.every((id) => elementIndexById.get(id)! >= firstInstanceBoundary)).toBe(true);

    const modulePath = (instanceId: string) => {
      const path = baseOptions.moduleMaterialization?.runtimeIdentityByElementId.get(instanceId)?.path ??
        baseOptions.moduleMaterialization?.originByRuntimeElementId.get(instanceId)?.instancePath;
      if (!path) throw new Error(`Module instance ${instanceId} has no compiler-owned identity path`);
      return path;
    };
    const excludedInstancePath = modulePath(snapshots[1]!.instanceId);
    const errorsForPath = (payload: EvaluationPayload, path: readonly string[]) =>
      (evaluationPayloadToResult(payload).geometryValueErrors ?? []).filter((error) =>
        JSON.stringify(error.occurrence.instancePath) === JSON.stringify(path)
      );
    const fullBefore = await evaluateFixtureBoth(fixture, fixture.elements.length);
    const zero = await evaluateFixtureBoth(fixture, 0);
    const partial = await evaluateFixtureBoth(fixture, firstInstanceBoundary);
    const fullAfter = await evaluateFixtureBoth(fixture, fixture.elements.length);
    const uses = fixture.elements.filter((element) => element.name === "Use");
    const lines = snapshots.map((snapshot) => snapshot.descendantIds
      .map((id) => fixture.elements.find((element) => element.id === id))
      .find((element) => element?.name === "L"));
    expect(uses).toHaveLength(2);
    expect(lines.every(Boolean)).toBe(true);

    for (const payload of [zero.tsPayload, zero.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.evaluatedElementIds).toEqual(new Set());
      expect(result.computedGeometry.size).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
    }
    for (const payload of [partial.tsPayload, partial.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(errorsForPath(payload, excludedInstancePath)).toEqual([]);
      expect(result.computedGeometry.get(uses[0]!.id)).toMatchObject({ kind: "line", end: { x: 5, y: 0 } });
      expect(result.computedGeometry.get(lines[0]!.id)).toMatchObject({ kind: "line", end: { x: 4, y: 0 } });
      expect(result.computedGeometry.size).toBe(snapshots[0]!.descendantIds.length);
      for (const id of snapshots[0]!.descendantIds) expect(result.computedGeometry.has(id)).toBe(true);
      for (const id of snapshots[1]!.descendantIds) {
        expect(result.evaluatedElementIds.has(id)).toBe(false);
        expect(result.computedGeometry.has(id)).toBe(false);
      }
    }
    for (const payload of [fullBefore.tsPayload, fullBefore.rustPayload, fullAfter.tsPayload, fullAfter.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(result.computedGeometry.get(uses[0]!.id)).toMatchObject({ kind: "line", end: { x: 5, y: 0 } });
      expect(result.computedGeometry.get(uses[1]!.id)).toMatchObject({ kind: "line", end: { x: 10, y: 0 } });
      expect(result.computedGeometry.get(lines[0]!.id)).toMatchObject({ kind: "line", end: { x: 4, y: 0 } });
      expect(result.computedGeometry.get(lines[1]!.id)).toMatchObject({ kind: "line", end: { x: 9, y: 0 } });
    }
  }, 60_000);

  it("reports unavailable Module selectors after terminal release makes no scalar progress", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "module M() {",
      "  const flag: boolean = @L.length > 5",
      "  const chosen: line = if (@flag) { segment(start: (0, 0), end: (10, 0)) } else { segment(start: (0, 0), end: (5, 0)) }",
      "  export line Use = from(source: @chosen)",
      "  line L = segment(start: (0, 0), end: (1 / 0, 0))",
      "}",
      "instance A = M()"
    ].join("\n"));

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.geometryValueErrors).toHaveLength(1);
      expect(result.geometryValueErrors[0]?.message).toBe(
        "Geometry value if condition is unavailable or not boolean."
      );
      expect(geometryFor(evaluated.fixture, payload, "Use")).toBeUndefined();
    }
  }, 60_000);
});
