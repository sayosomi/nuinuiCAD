import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { ComputedGeometry } from "../src/geometry/evaluationTypes";
import type { ImmutableGeometryCarryTargetPlan, ScalarExpressionResolvedGeometryTarget } from "@nuinuicad/nui-language";
import {
  createRustStdioParityClient,
  fixtureFromSource,
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

const geometryCarries = (fixture: ReturnType<typeof fixtureFromSource>) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const targetLeaves = (plan: ImmutableGeometryCarryTargetPlan): ScalarExpressionResolvedGeometryTarget[] => {
  if (plan.kind === "if") return [...targetLeaves(plan.thenTarget), ...targetLeaves(plan.elseTarget)];
  if (plan.kind === "match") return plan.arms.flatMap((arm) => targetLeaves(arm.target));
  return [plan];
};

const expectCanonicalTargets = (
  fixture: ReturnType<typeof fixtureFromSource>,
  carry: NonNullable<ReturnType<typeof geometryCarries>[number]>
) => {
  const loop = fixture.elements.find((element) => element.type === "forGroup");
  const statementInfo = loop && fixture.compiled?.currentCompiled.statementMap?.byElementId.get(loop.id);
  const ownerStatementId = statementInfo && fixture.compiled?.currentCompiled.statementMap?.statementIdByStatementIndex
    ?.get(statementInfo.statementIndex);
  expect(loop).toBeDefined();
  expect(ownerStatementId).toBe(carry ? [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .find((plan) => plan.geometryCarries?.includes(carry))?.ownerStatementId : undefined);
  expect(Number.isFinite(carry.nextSourceOrder)).toBe(true);
  expect(carry.nextSourceOrder).toBeGreaterThanOrEqual(0);

  const targetElementIds = new Set(fixture.elements.map((element) => element.id));
  const targetBindingIds = new Set(
    [
      ...(fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.map((binding) => binding.id) ?? []),
      ...geometryCarries(fixture).map((candidate) => candidate.bindingId)
    ]
  );
  const geometryValueOccurrences = new Set(
    (fixture.compiled?.doc.geometryValueProgram ?? []).map((entry) =>
      JSON.stringify(entry.occurrence)
    )
  );
  for (const target of targetLeaves(carry.nextTarget)) {
    if (target.kind === "geometryCarry") expect(targetBindingIds.has(target.bindingId)).toBe(true);
    else if (target.kind === "geometryValueForBinder") expect(targetBindingIds.has(target.binderId)).toBe(true);
    else if (target.kind === "geometryValue") expect(geometryValueOccurrences.has(JSON.stringify(target.occurrence))).toBe(true);
    else if (target.kind === "forGroupOccurrence") expect(targetElementIds.has(target.templateElementId)).toBe(true);
    else expect(targetElementIds.has(target.statementId)).toBe(true);
  }
};

describe("SAY-496 geometry carry conditional next plans through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (source: string) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const observable = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      const summarize = (geometry: ComputedGeometry | undefined) => {
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
        geometry: fixture.elements
          .filter((element) => element.name.length > 0)
          .map((element) => [element.name, summarize(result.computedGeometry.get(element.id))]),
        scalars: (fixture.compiled?.doc.bindingAnalysis?.catalog.bindings ?? [])
          .filter((binding) => binding.kind === "typed")
          .map((binding) => [binding.name, result.computedScalarBindings?.get(binding.id)?.status,
            result.computedScalarBindings?.get(binding.id)?.value]),
        rows: (result.forGroupGeneratedRows ?? []).map((row) => [
          row.elementName,
          summarize(result.computedGeometry.get(row.generatedElementId))
        ])
      };
    };
    expect(normalizeParityPayload(observable(rustPayload))).toEqual(
      normalizeParityPayload(observable(tsPayload))
    );
    return { fixture, tsPayload, rustPayload };
  };

  it("reproduces the audited path match and conditional point cases with complete plans", async () => {
    const matchPath = await evaluateBoth([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "const side: choice(left, right) = left",
      "for i in range(min: 0, max: 0, step: 1) carry p: path = @Seed {",
      " next p = match @side { left => @p right => @Seed }",
      "}",
      "path Use = from(source: @p)",
      "const result: number = @p.length"
    ].join("\n"));
    const pathCarry = geometryCarries(matchPath.fixture)[0];
    expect(pathCarry?.nextTarget.kind).toBe("match");
    expectCanonicalTargets(matchPath.fixture, pathCarry!);
    expect(pathCarry?.nextTarget).toMatchObject({
      kind: "match",
      arms: [{ label: "left", target: { kind: "geometryCarry" } }, { label: "right", target: { statementId: expect.any(String) } }]
    });
    for (const payload of [matchPath.tsPayload, matchPath.rustPayload]) {
      expect(geometryFor(matchPath.fixture, payload, "Use")).toMatchObject({
        kind: "line", start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5
      });
      expect(scalarFor(matchPath.fixture, payload, "result")).toMatchObject({
        status: "ok", value: { kind: "number", value: 5 }
      });
    }

    for (const source of [
      [
        "nui 1",
        "point Seed = coordinate(x: 1, y: 2)",
        "for i in range(min: 0, max: 0, step: 1) carry p: point = @Seed {",
        " next p = if (true) { @p } else { @Seed }",
        "}",
        "point Use = from(source: @p)"
      ].join("\n"),
      [
        "nui 1",
        "const seed: point = coordinate(x: 1, y: 2)",
        "for i in range(min: 0, max: 0, step: 1) carry p: point = @seed {",
        " next p = if (true) { @p } else { @seed }",
        "}",
        "point Use = from(source: @p)"
      ].join("\n")
    ]) {
      const conditionalPoint = await evaluateBoth(source);
      const pointCarry = geometryCarries(conditionalPoint.fixture)[0];
      expect(pointCarry?.nextTarget.kind).toBe("if");
      expectCanonicalTargets(conditionalPoint.fixture, pointCarry!);
      for (const payload of [conditionalPoint.tsPayload, conditionalPoint.rustPayload]) {
        expect(geometryFor(conditionalPoint.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 1, y: 2 });
      }
    }
  }, 60_000);

  it("evaluates only the selected exhaustive match branch and preserves stage and endpoint projections", async () => {
    const selected = await evaluateBoth([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "line Dormant = segment(start: (8, 9), end: (10, 12), enabled: false)",
      "const side: choice(left, right) = right",
      "for i in range(min: 0, max: 0, step: 1) carry route: path = @Seed {",
      "  next route = match @side { left => @Dormant right => @Seed }",
      "}",
      "path Use = from(source: @route)"
    ].join("\n"));
    const carry = geometryCarries(selected.fixture)[0];
    expect(carry?.nextTarget.kind).toBe("match");
    expectCanonicalTargets(selected.fixture, carry!);
    for (const payload of [selected.tsPayload, selected.rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(geometryFor(selected.fixture, payload, "Use")).toMatchObject({
        kind: "line", start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5
      });
    }

    const endpointStage = await evaluateBoth([
      "nui 1",
      "line Staged = segment(start: (1, 2), end: (5, 6))",
      "move Staged as shifted (from: (1, 2), to: (10, 20))",
      "for i in range(min: 0, max: 0, step: 1) carry cursor: point = @Staged.base.start {",
      "  next cursor = if (true) { @Staged.base.start } else { @Staged.shifted.end }",
      "}",
      "point Use = from(source: @cursor)"
    ].join("\n"));
    const pointCarry = geometryCarries(endpointStage.fixture)[0];
    expect(pointCarry?.nextTarget).toMatchObject({
      kind: "if",
      thenTarget: { pointKey: "start", stagePath: ["base"] },
      elseTarget: { pointKey: "end", stagePath: ["shifted"] }
    });
    expectCanonicalTargets(endpointStage.fixture, pointCarry!);
    for (const payload of [endpointStage.tsPayload, endpointStage.rustPayload]) {
      expect(geometryFor(endpointStage.fixture, payload, "Use")).toMatchObject({ kind: "point", x: 1, y: 2 });
    }

    const selectedDisabled = await evaluateBoth([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "line Dormant = segment(start: (8, 9), end: (10, 12), enabled: false)",
      "const side: choice(left, right) = left",
      "for i in range(min: 0, max: 0, step: 1) carry route: path = @Seed {",
      "  next route = match @side { left => @Dormant right => @Seed }",
      "}",
      "path Use = from(source: @route)"
    ].join("\n"));
    for (const payload of [selectedDisabled.tsPayload, selectedDisabled.rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("commits independent geometry carries from one incoming snapshot in either next order", async () => {
    for (const reverseNextOrder of [false, true]) {
      const nextLines = reverseNextOrder
        ? ["  next second = @first", "  next first = @second"]
        : ["  next first = @second", "  next second = @first"];
      const swapped = await evaluateBoth([
        "nui 1",
        "const FirstSeed: point = coordinate(x: 1, y: 1)",
        "const SecondSeed: point = coordinate(x: 2, y: 2)",
        "for i in range(min: 0, max: 0, step: 1) carry first: point = @FirstSeed carry second: point = @SecondSeed {",
        ...nextLines,
        "}",
        "point FirstUse = from(source: @first)",
        "point SecondUse = from(source: @second)"
      ].join("\n"));
      expect(geometryCarries(swapped.fixture)).toHaveLength(2);
      for (const payload of [swapped.tsPayload, swapped.rustPayload]) {
        expect(geometryFor(swapped.fixture, payload, "FirstUse")).toMatchObject({ kind: "point", x: 2, y: 2 });
        expect(geometryFor(swapped.fixture, payload, "SecondUse")).toMatchObject({ kind: "point", x: 1, y: 1 });
      }
    }
  }, 60_000);

  it("retains direct path and point carry controls through the same runtime", async () => {
    const path = await evaluateBoth([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "for i in range(min: 0, max: 0, step: 1) carry p: path = @Seed {",
      " next p = @p",
      "}",
      "path Use = from(source: @p)",
      "const result: number = @p.length"
    ].join("\n"));
    for (const payload of [path.tsPayload, path.rustPayload]) {
      expect(geometryFor(path.fixture, payload, "Use")).toMatchObject({
        kind: "line", start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5
      });
      expect(scalarFor(path.fixture, payload, "result")).toMatchObject({
        status: "ok", value: { kind: "number", value: 5 }
      });
    }

    const point = await evaluateBoth([
      "nui 1",
      "point Seed = coordinate(x: 1, y: 2)",
      "for i in range(min: 0, max: 0, step: 1) carry p: point = @Seed {",
      " next p = @p",
      "}",
      "line Use = segment(start: @p, end: (0, 0))",
      "const result: number = @p.x"
    ].join("\n"));
    for (const payload of [point.tsPayload, point.rustPayload]) {
      expect(geometryFor(point.fixture, payload, "Use")).toMatchObject({
        kind: "line", start: { x: 1, y: 2 }, end: { x: 0, y: 0 }
      });
      expect(scalarFor(point.fixture, payload, "result")).toMatchObject({
        status: "ok", value: { kind: "number", value: 1 }
      });
    }
  }, 60_000);
});
