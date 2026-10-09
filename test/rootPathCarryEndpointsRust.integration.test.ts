import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
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

const targetFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  name: string,
  parameter = "source"
) => {
  const target = fixture.compiled?.doc.geometryInputTargetsByElementId
    ?.get(elementByName(fixture, name).id)
    ?.get(parameter);
  if (!target || Array.isArray(target)) throw new Error(`single target "${name}.${parameter}" not found`);
  return target;
};

describe("SAY-490 root path carry endpoints through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  it("resolves escaped path carry endpoints and keeps path and point controls", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "const PathAlias: path = @Seed",
      "point AliasStart = from(source: @PathAlias.start)",
      "point AliasEnd = from(source: @PathAlias.end)",
      "for i in range(min: 0, max: 0, step: 1) carry route: path = @Seed {",
      "  next route = @Seed",
      "}",
      "path WholeCarry = from(source: @route)",
      "point CarryStart = from(source: @route.start)",
      "point CarryEnd = from(source: @route.end)",
      "const CarryLength: number = @route.length",
      "point PointSeed = coordinate(x: 8, y: 9)",
      "for i in range(min: 0, max: 0, step: 1) carry cursor: point = @PointSeed {",
      "  next cursor = @PointSeed",
      "}",
      "line PointCarryUse = segment(start: @cursor, end: (11, 9))"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const aliasStart = targetFor(fixture, "AliasStart");
    expect(aliasStart).toMatchObject({
      kind: "geometryValue",
      geometryType: "path",
      pointKey: "start",
      occurrence: { sourceStatementId: expect.any(String), instancePath: [] }
    });
    expect(targetFor(fixture, "CarryStart")).toMatchObject({
      kind: "geometryCarry", geometryType: "path", pointKey: "start"
    });
    expect(targetFor(fixture, "CarryEnd")).toMatchObject({
      kind: "geometryCarry", geometryType: "path", pointKey: "end"
    });
    expect(targetFor(fixture, "WholeCarry")).toMatchObject({ kind: "geometryCarry", geometryType: "path" });
    expect(targetFor(fixture, "WholeCarry").pointKey).toBeUndefined();
    expect(targetFor(fixture, "PointCarryUse", "startPoint")).toMatchObject({ kind: "geometryCarry", geometryType: "point" });

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const observable = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      return {
        errors: result.errors,
        geometry: ["WholeCarry", "AliasStart", "AliasEnd", "CarryStart", "CarryEnd", "PointCarryUse"]
          .map((name) => {
            const value = result.computedGeometry.get(elementByName(fixture, name).id);
            if (!value) return undefined;
            if (value.kind === "point") return { kind: value.kind, x: value.x, y: value.y };
            return {
              kind: value.kind,
              start: "start" in value ? { x: value.start?.x, y: value.start?.y } : undefined,
              end: "end" in value ? { x: value.end?.x, y: value.end?.y } : undefined,
              length: value.length
            };
          }),
        carryLength: scalarFor(fixture, payload, "CarryLength")
      };
    };
    expect(normalizeParityPayload(observable(rustPayload))).toEqual(
      normalizeParityPayload(observable(tsPayload))
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(fixture, payload, "WholeCarry")).toMatchObject({
        kind: "line", start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5
      });
      expect(geometryFor(fixture, payload, "AliasStart")).toMatchObject({ kind: "point", x: 0, y: 0 });
      expect(geometryFor(fixture, payload, "AliasEnd")).toMatchObject({ kind: "point", x: 3, y: 4 });
      expect(geometryFor(fixture, payload, "CarryStart")).toMatchObject({ kind: "point", x: 0, y: 0 });
      expect(geometryFor(fixture, payload, "CarryEnd")).toMatchObject({ kind: "point", x: 3, y: 4 });
      expect(geometryFor(fixture, payload, "PointCarryUse")).toMatchObject({
        kind: "line", start: { x: 8, y: 9 }, end: { x: 11, y: 9 }
      });
      expect(scalarFor(fixture, payload, "CarryLength")).toMatchObject({
        status: "ok", value: { kind: "number", value: 5 }
      });
    }
  }, 30_000);

  it("keeps root base, named, and final stage geometry snapshots when carried as paths", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Staged = segment(start: (10, 20), end: (13, 24))",
      "move Staged as shifted (from: (10, 20), to: (30, 40))",
      "move Staged as finished (from: (30, 40), to: (70, 100))",
      "for i in range(min: 0, max: 0, step: 1) carry basePath: path = @Staged.base carry namedPath: path = @Staged.shifted carry finalPath: path = @Staged {",
      "  next basePath = @Staged.base",
      "  next namedPath = @Staged.shifted",
      "  next finalPath = @Staged",
      "}",
      "point BaseStart = from(source: @basePath.start)",
      "point BaseEnd = from(source: @basePath.end)",
      "point NamedStart = from(source: @namedPath.start)",
      "point NamedEnd = from(source: @namedPath.end)",
      "point FinalStart = from(source: @finalPath.start)",
      "point FinalEnd = from(source: @finalPath.end)"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const options = optionsFor(fixture);
    const carries = [...(options.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.geometryCarries ?? []);
    const expectedStages = [
      ["BaseStart", ["base"]],
      ["NamedStart", ["shifted"]],
      ["FinalStart", ["final"]]
    ] as const;
    for (const [consumer, stagePath] of expectedStages) {
      const target = targetFor(fixture, consumer);
      expect(target).toMatchObject({
        kind: "geometryCarry",
        bindingId: expect.any(String),
        geometryType: "path",
        pointKey: "start"
      });
      if (target.kind !== "geometryCarry") throw new Error("expected a geometry carry target");
      const carry = carries.find((candidate) => candidate.bindingId === target.bindingId);
      expect(carry?.initializerTarget).toMatchObject({ stagePath });
      expect(carry?.nextTarget).toMatchObject({ stagePath });
    }

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const observable = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      return {
        errors: result.errors,
        geometry: ["BaseStart", "BaseEnd", "NamedStart", "NamedEnd", "FinalStart", "FinalEnd"]
          .map((name) => result.computedGeometry.get(elementByName(fixture, name).id))
      };
    };
    expect(normalizeParityPayload(observable(rustPayload))).toEqual(
      normalizeParityPayload(observable(tsPayload))
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(geometryFor(fixture, payload, "BaseStart")).toMatchObject({ kind: "point", x: 10, y: 20 });
      expect(geometryFor(fixture, payload, "BaseEnd")).toMatchObject({ kind: "point", x: 13, y: 24 });
      expect(geometryFor(fixture, payload, "NamedStart")).toMatchObject({ kind: "point", x: 30, y: 40 });
      expect(geometryFor(fixture, payload, "NamedEnd")).toMatchObject({ kind: "point", x: 33, y: 44 });
      expect(geometryFor(fixture, payload, "FinalStart")).toMatchObject({ kind: "point", x: 70, y: 100 });
      expect(geometryFor(fixture, payload, "FinalEnd")).toMatchObject({ kind: "point", x: 73, y: 104 });
    }
  }, 30_000);

  it("does not accept a line or path without an endpoint selector as a point anchor", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Seed = segment(start: (0, 0), end: (3, 4))",
      "for i in range(min: 0, max: 0, step: 1) carry route: path = @Seed {",
      "  next route = @Seed",
      "}",
      "line PointConsumer = segment(start: @route, end: (10, 0))"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const pointConsumer = elementByName(fixture, "PointConsumer");
    const consumerTargets = fixture.compiled?.doc.geometryInputTargetsByElementId?.get(pointConsumer.id);
    expect(consumerTargets?.size ?? 0).toBe(0);
    expect(pointConsumer).toMatchObject({ startPoint: { mode: "reference", pointId: "@route" } });

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).not.toEqual([]);
      expect(result.computedGeometry.has(pointConsumer.id)).toBe(false);
    }
  }, 30_000);
});
