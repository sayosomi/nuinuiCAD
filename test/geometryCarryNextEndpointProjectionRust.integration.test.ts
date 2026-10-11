import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { ComputedGeometry } from "../src/geometry/evaluationTypes";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Fixture = ReturnType<typeof fixtureFromSource>;

const typedBindingFor = (fixture: Fixture, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding || binding.kind !== "typed") throw new Error(`typed binding "${name}" not found`);
  return binding;
};

const geometryCarriesFor = (fixture: Fixture) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const geometryCarryOfType = (fixture: Fixture, geometryType: "line" | "path" | "point") => {
  const carry = geometryCarriesFor(fixture).find((candidate) => candidate.declaredType.kind === geometryType);
  if (!carry) throw new Error(`geometry carry of type "${geometryType}" not found`);
  return carry;
};

const elementByName = (fixture: Fixture, name: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`element "${name}" not found`);
  return element;
};

const geometryFor = (fixture: Fixture, payload: EvaluationPayload, name: string) =>
  evaluationPayloadToResult(payload).computedGeometry.get(elementByName(fixture, name).id);

const scalarFor = (fixture: Fixture, payload: EvaluationPayload, name: string) =>
  evaluationPayloadToResult(payload).computedScalarBindings?.get(typedBindingFor(fixture, name).id);

const summarizeGeometry = (geometry: ComputedGeometry | undefined) => {
  if (!geometry) return null;
  if (geometry.kind === "point") return { kind: geometry.kind, x: geometry.x, y: geometry.y };
  return {
    kind: geometry.kind,
    start: "start" in geometry && geometry.start
      ? { x: geometry.start.x, y: geometry.start.y }
      : null,
    end: "end" in geometry && geometry.end
      ? { x: geometry.end.x, y: geometry.end.y }
      : null,
    length: "length" in geometry ? geometry.length : null
  };
};

const observable = (
  fixture: Fixture,
  payload: EvaluationPayload,
  geometryNames: readonly string[],
  scalarNames: readonly string[]
) => {
  const result = evaluationPayloadToResult(payload);
  return {
    geometryDiagnostics: result.errors,
    scalarDiagnostics: runtimeDiagnosticsFor(fixture, payload),
    geometry: Object.fromEntries(geometryNames.map((name) => [name, summarizeGeometry(geometryFor(fixture, payload, name))])),
    scalars: Object.fromEntries(scalarNames.map((name) => [name, scalarFor(fixture, payload, name)]))
  };
};

describe("SAY-511 geometry carry next endpoint projection through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (
    source: string,
    geometryNames: readonly string[],
    scalarNames: readonly string[] = []
  ) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(observable(fixture, rustPayload, geometryNames, scalarNames))).toEqual(
      normalizeParityPayload(observable(fixture, tsPayload, geometryNames, scalarNames))
    );
    return { fixture, tsPayload, rustPayload };
  };

  const expectPointForBoth = (
    evaluated: Awaited<ReturnType<typeof evaluateBoth>>,
    name: string,
    x: number,
    y: number
  ) => {
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(geometryFor(evaluated.fixture, payload, name)).toMatchObject({ kind: "point", x, y });
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expect(runtimeDiagnosticsFor(evaluated.fixture, payload)).toEqual([]);
    }
  };

  it("projects the canonical carried line end for p21", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: line = segment(start: (1,2), end: (4,6))",
      "const origin: point = coordinate(x: 0, y: 0)",
      "for n in range(min: 0, max: 0, step: 1) carry l: line = @seed carry q: point = @origin {",
      "  next l = @l",
      "  next q = @l.end",
      "}",
      "const x: number = @q.x",
      "const y: number = @q.y",
      "point Out = from(source: @q)"
    ].join("\n"), ["Out"], ["x", "y"]);

    expect(isRustEligibleFixture(evaluated.fixture)).toBe(true);
    const lineCarry = geometryCarryOfType(evaluated.fixture, "line");
    const pointCarry = geometryCarryOfType(evaluated.fixture, "point");
    expect(pointCarry.nextTarget).toMatchObject({
      kind: "geometryCarry",
      bindingId: lineCarry.bindingId,
      geometryType: "line",
      pointKey: "end"
    });
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(scalarFor(evaluated.fixture, payload, "x")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
      expect(scalarFor(evaluated.fixture, payload, "y")).toMatchObject({ status: "ok", value: { kind: "number", value: 6 } });
    }
    expectPointForBoth(evaluated, "Out", 4, 6);
  }, 60_000);

  it("projects the canonical carried path start for p22 over repeated iterations", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: path = polyline(points: [(7,8), (10,8), (10,12)], closed: false)",
      "const origin: point = coordinate(x: -1, y: -2)",
      "const turns: number[] = [3,5]",
      "for n in @turns carry p: path = @seed carry q: point = @origin {",
      "  next p = @p",
      "  next q = @p.start",
      "}",
      "const x: number = @q.x",
      "const y: number = @q.y",
      "point Out = from(source: @q)"
    ].join("\n"), ["Out"], ["x", "y"]);

    expect(isRustEligibleFixture(evaluated.fixture)).toBe(true);
    const pathCarry = geometryCarryOfType(evaluated.fixture, "path");
    const pointCarry = geometryCarryOfType(evaluated.fixture, "point");
    expect(pointCarry.nextTarget).toMatchObject({
      kind: "geometryCarry",
      bindingId: pathCarry.bindingId,
      geometryType: "path",
      pointKey: "start"
    });
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(scalarFor(evaluated.fixture, payload, "x")).toMatchObject({ status: "ok", value: { kind: "number", value: 7 } });
      expect(scalarFor(evaluated.fixture, payload, "y")).toMatchObject({ status: "ok", value: { kind: "number", value: 8 } });
    }
    expectPointForBoth(evaluated, "Out", 7, 8);
  }, 60_000);

  it("keeps the independent point alias control p23 correct", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: line = segment(start: (1,2), end: (4,6))",
      "const endpoint: point = @seed.end",
      "const origin: point = coordinate(x: 0, y: 0)",
      "for n in range(min: 0, max: 0, step: 1) carry q: point = @origin {",
      "  next q = @endpoint",
      "}",
      "const x: number = @q.x",
      "const y: number = @q.y",
      "point Out = from(source: @q)"
    ].join("\n"), ["Out"], ["x", "y"]);

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(scalarFor(evaluated.fixture, payload, "x")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
      expect(scalarFor(evaluated.fixture, payload, "y")).toMatchObject({ status: "ok", value: { kind: "number", value: 6 } });
    }
    expectPointForBoth(evaluated, "Out", 4, 6);
  }, 60_000);

  it("preserves whole line and path carries when pointKey is absent", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: line = segment(start: (1,2), end: (4,6))",
      "for n in range(min: 0, max: 0, step: 1) carry route: path = @seed carry chord: line = @seed {",
      "  next route = @route",
      "  next chord = @chord",
      "}",
      "path PathOut = from(source: @route)",
      "line LineOut = from(source: @chord)"
    ].join("\n"), ["PathOut", "LineOut"]);

    for (const name of ["route", "chord"]) {
      const carry = geometryCarryOfType(evaluated.fixture, name === "route" ? "path" : "line");
      const target = carry.nextTarget;
      expect(target).toMatchObject({ kind: "geometryCarry", bindingId: carry.bindingId });
      expect("pointKey" in target ? target.pointKey : undefined).toBeUndefined();
    }
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(geometryFor(evaluated.fixture, payload, "PathOut")).toMatchObject({
        kind: "line", start: { x: 1, y: 2 }, end: { x: 4, y: 6 }, length: 5
      });
      expect(geometryFor(evaluated.fixture, payload, "LineOut")).toMatchObject({
        kind: "line", start: { x: 1, y: 2 }, end: { x: 4, y: 6 }, length: 5
      });
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
    }
  }, 60_000);

  it("projects from the selected transformation-stage carry snapshot", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line Staged = segment(start: (1,2), end: (5,6))",
      "move Staged as shifted (from: (1,2), to: (10,20))",
      "const origin: point = coordinate(x: 0, y: 0)",
      "for n in range(min: 0, max: 0, step: 1) carry route: line = @Staged.shifted carry cursor: point = @origin {",
      "  next cursor = @route.end",
      "  next route = @route",
      "}",
      "point Out = from(source: @cursor)"
    ].join("\n"), ["Out"]);

    const route = geometryCarryOfType(evaluated.fixture, "line");
    expect(route.initializerTarget).toMatchObject({ stagePath: ["shifted"] });
    expect(geometryCarryOfType(evaluated.fixture, "point").nextTarget).toMatchObject({
      kind: "geometryCarry",
      bindingId: route.bindingId,
      pointKey: "end"
    });
    expectPointForBoth(evaluated, "Out", 14, 24);
  }, 60_000);

  it("fails invalid or unavailable carried endpoints without materializing the whole line", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const seed: line = segment(start: (1,2), end: (4,6))",
      "const origin: point = coordinate(x: 0, y: 0)",
      "for n in range(min: 0, max: 0, step: 1) carry l: line = @seed carry q: point = @origin {",
      "  next l = @l",
      "  next q = @l.end",
      "}",
      "const x: number = @q.x",
      "point Out = from(source: @q)"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const options = optionsFor(fixture);
    const cursor = geometryCarryOfType(fixture, "point");
    const bindingVersions = options.bindingVersions;
    if (!bindingVersions?.immutableForGroups) throw new Error("missing immutable geometry carry plans");
    let targetRewritten = false;
    const immutableForGroups = new Map(bindingVersions.immutableForGroups);
    for (const [ownerStatementId, plan] of immutableForGroups) {
      const geometryCarries = plan.geometryCarries?.map((carry) => {
        if (carry.bindingId !== cursor.bindingId || carry.nextTarget.kind !== "geometryCarry") return carry;
        targetRewritten = true;
        return { ...carry, nextTarget: { ...carry.nextTarget, pointKey: "missing" } };
      });
      if (geometryCarries) immutableForGroups.set(ownerStatementId, { ...plan, geometryCarries });
    }
    expect(targetRewritten).toBe(true);

    const invalidPayload = evaluateElementsReferencePayload(fixture.elements, {
      ...options,
      bindingVersions: { ...bindingVersions, immutableForGroups }
    });
    const invalidResult = evaluationPayloadToResult(invalidPayload);
    expect(invalidResult.computedGeometry.get(elementByName(fixture, "Out").id)).toBeUndefined();
    expect(invalidResult.errors.length).toBeGreaterThan(0);
    expect(runtimeDiagnosticsFor(fixture, invalidPayload).length).toBeGreaterThan(0);

    const unavailableFixture = fixtureFromSource([
      "nui 1",
      "line Hidden = segment(start: (1,2), end: (4,6), enabled: false)",
      "const origin: point = coordinate(x: 0, y: 0)",
      "for n in range(min: 0, max: 0, step: 1) carry route: path = @Hidden carry cursor: point = @origin {",
      "  next route = @route",
      "  next cursor = @route.start",
      "}",
      "point Out = from(source: @cursor)"
    ].join("\n"));
    expect(unavailableFixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const unavailableRoute = geometryCarryOfType(unavailableFixture, "path");
    expect(geometryCarryOfType(unavailableFixture, "point").nextTarget).toMatchObject({
      kind: "geometryCarry",
      bindingId: unavailableRoute.bindingId,
      pointKey: "start"
    });
    const unavailablePayload = evaluateElementsReferencePayload(
      unavailableFixture.elements,
      optionsFor(unavailableFixture)
    );
    const unavailableResult = evaluationPayloadToResult(unavailablePayload);
    expect(unavailableResult.computedGeometry.get(elementByName(unavailableFixture, "Out").id)).toBeUndefined();
    expect(unavailableResult.errors.length).toBeGreaterThan(0);
  });

  it("keeps zero-length endpoint snapshots valid across repeated carry iterations", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: line = segment(start: (2,2), end: (2,2))",
      "const origin: point = coordinate(x: 0, y: 0)",
      "const turns: number[] = [0,1,2]",
      "for n in @turns carry l: line = @seed carry q: point = @origin {",
      "  next q = @l.end",
      "  next l = @l",
      "}",
      "const x: number = @q.x",
      "const y: number = @q.y",
      "const length: number = @l.length",
      "point Out = from(source: @q)"
    ].join("\n"), ["Out"], ["x", "y", "length"]);

    expect(isRustEligibleFixture(evaluated.fixture)).toBe(true);
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expect(scalarFor(evaluated.fixture, payload, "x")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarFor(evaluated.fixture, payload, "y")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarFor(evaluated.fixture, payload, "length")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
    }
    expectPointForBoth(evaluated, "Out", 2, 2);
  }, 60_000);
});
