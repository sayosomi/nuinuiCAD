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

const scalarValue = (
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

describe("SAY-466 from(source:) endpoint materialization through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("projects joined, line, alias, and selected-stage endpoints before materialization", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Head = segment(start: (2, 3), end: (12, 3))",
      "curve Bend = bezier(start: (12, 3), end: (32, 15), startAngle: 0, startLength: 6, endAngle: 0, endLength: 8)",
      "line Route = join(paths: [@Head, @Bend], closed: false)",
      "point RouteEnd = from(source: @Route.end)",
      "point RouteStart = from(source: @Route.start)",
      "const RouteAlias: path = @Route",
      "point AliasPathEnd = from(source: @RouteAlias.end)",
      "const EndpointAlias: point = @Route.end",
      "point AliasPointCopy = from(source: @EndpointAlias)",
      "line Segment = segment(start: (40, 5), end: (55, 10))",
      "point SegmentEnd = from(source: @Segment.end)",
      "line Staged = segment(start: (60, 5), end: (70, 10))",
      "move Staged as shifted (from: (0, 0), to: (100, -20))",
      "point BaseEnd = from(source: @Staged.base.end)",
      "point DrawablePoint = coordinate(x: 80, y: 9)",
      "point DrawablePointCopy = from(source: @DrawablePoint)",
      "const PurePoint: point = coordinate(x: 90, y: 11)",
      "point PurePointCopy = from(source: @PurePoint)",
      "path WholeRoute = from(source: @Route)",
      "point OnRouteEnd = onLine(from: @Route.end, ratio: 0)",
      "const EndX: number = @RouteEnd.x",
      "const EndY: number = @RouteEnd.y"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const compiled = fixture.compiled!.doc;
    const element = (name: string) => fixture.elements.find((candidate) => candidate.name === name)!;
    const sourceTarget = (name: string) => compiled.geometryInputTargetsByElementId
      ?.get(element(name).id)
      ?.get("source");
    expect(sourceTarget("RouteEnd")).toMatchObject({
      kind: "drawable", geometryType: "line", pointKey: "end", stagePath: ["final"]
    });
    expect(sourceTarget("BaseEnd")).toMatchObject({
      kind: "drawable", geometryType: "line", pointKey: "end", stagePath: ["base"]
    });
    expect(sourceTarget("AliasPathEnd")).toMatchObject({
      kind: "geometryValue", geometryType: "path", pointKey: "end"
    });
    expect(sourceTarget("AliasPointCopy")).toMatchObject({ kind: "geometryValue", geometryType: "point" });

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const geometryNames = [
      "RouteEnd", "RouteStart", "AliasPathEnd", "AliasPointCopy", "SegmentEnd", "BaseEnd",
      "Staged", "DrawablePointCopy", "PurePointCopy", "WholeRoute", "OnRouteEnd"
    ];
    const observableResult = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      return {
        errors: result.errors,
        geometry: geometryNames.map((name) => {
          const value = result.computedGeometry.get(element(name).id);
          if (!value) return undefined;
          if (value.kind === "point") return { kind: value.kind, x: value.x, y: value.y };
          return {
            kind: value.kind,
            start: "start" in value ? { x: value.start?.x, y: value.start?.y } : undefined,
            end: "end" in value ? { x: value.end?.x, y: value.end?.y } : undefined,
            length: value.length
          };
        }),
        scalars: ["EndX", "EndY"].map((name) => scalarValue(fixture, payload, name))
      };
    };
    expect(normalizeParityPayload(observableResult(rustPayload))).toEqual(
      normalizeParityPayload(observableResult(tsPayload))
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      const geometry = (name: string) => result.computedGeometry.get(element(name).id);
      expect(geometry("RouteEnd")).toMatchObject({ kind: "point", x: 32, y: 15 });
      expect(geometry("RouteStart")).toMatchObject({ kind: "point", x: 2, y: 3 });
      expect(geometry("AliasPathEnd")).toMatchObject({ kind: "point", x: 32, y: 15 });
      expect(geometry("AliasPointCopy")).toMatchObject({ kind: "point", x: 32, y: 15 });
      expect(geometry("SegmentEnd")).toMatchObject({ kind: "point", x: 55, y: 10 });
      expect(geometry("BaseEnd")).toMatchObject({ kind: "point", x: 70, y: 10 });
      expect(geometry("Staged")).toMatchObject({ kind: "line", end: { x: 170, y: -10 } });
      expect(geometry("DrawablePointCopy")).toMatchObject({ kind: "point", x: 80, y: 9 });
      expect(geometry("PurePointCopy")).toMatchObject({ kind: "point", x: 90, y: 11 });
      expect(geometry("WholeRoute")).toMatchObject({ kind: "joinedPath", segments: expect.any(Array) });
      expect(geometry("OnRouteEnd")).toMatchObject({ kind: "point", x: 32, y: 15 });
      expect(scalarValue(fixture, payload, "EndX")).toMatchObject({
        status: "ok", value: { kind: "number", value: 32 }
      });
      expect(scalarValue(fixture, payload, "EndY")).toMatchObject({
        status: "ok", value: { kind: "number", value: 15 }
      });
    }
  }, 30000);
});
