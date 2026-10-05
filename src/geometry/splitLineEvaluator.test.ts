import { describe, expect, it } from "vitest";
import type { CadElement, ComputedGeometry, ComputedLine, ComputedPoint, DependencyError, GeometryInputTarget } from "../types/geometry";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { evaluateSplitLineElement } from "./splitLineEvaluator";

const point = (elementId: string, name: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x,
  y
});

const line = (startY: number): ComputedLine => ({
  kind: "line",
  elementId: "owner",
  name: "L",
  startPointId: "start",
  endPointId: "end",
  start: point("start", "Start", 0, startY),
  end: point("end", "End", 20, startY),
  length: 20,
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
});

describe("split line evaluator", () => {
  it("splits the selected stage snapshot and publishes its near side to the drawable owner", () => {
    const selectedBase = line(0);
    const ownerFinal = line(10);
    const source: GeometryInputTarget = {
      kind: "drawable",
      elementId: "owner",
      geometryType: "line",
      stagePath: ["base"]
    };
    const split = {
      id: "part",
      name: "Part",
      type: "splitLine" as const,
      activity: "visible" as const,
      baseLineId: "owner",
      splitPoint: { mode: "reference" as const, pointId: "cut" }
    };
    const computedGeometry = new Map<string, ComputedGeometry>([
      ["owner", ownerFinal],
      ["cut", point("cut", "Cut", 5, 0)]
    ]);
    const errors: DependencyError[] = [];
    const context: ElementEvaluationContext = {
      computedGeometry,
      resolveGeometrySnapshot: (elementId: string, stagePath?: readonly string[]) =>
        elementId === "owner" && stagePath?.join(".") === "base" ? selectedBase : undefined,
      geometryInputTargets: new Map([["baseLineId", source]]),
      elementsById: new Map<string, CadElement>([["part", split]]),
      errors,
      warnings: [],
      disabledByGroupId: new Map(),
      localVariables: { localVariableValues: new Map(), localVariableNames: new Map() }
    };

    expect(evaluateSplitLineElement(split, context)).toBe(true);
    expect(errors).toEqual([]);
    expect(computedGeometry.get("owner")).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 },
      length: 5
    });
    expect(computedGeometry.get("part")).toMatchObject({
      kind: "line",
      start: { x: 5, y: 0 },
      end: { x: 20, y: 0 },
      length: 15
    });
  });
});
