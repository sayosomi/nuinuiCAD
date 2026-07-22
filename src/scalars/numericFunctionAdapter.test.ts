// Proves numericFunctionAdapter's result-consistency contract against the
// real, unmodified legacy numeric evaluator - without wiring the adapter
// into expressionEvaluator.ts or any production path.

import { describe, expect, it } from "vitest";
import { evaluateNumericValue } from "../geometry/numericExpressions";
import type { CadElement, ComputedGeometry, ComputedPoint } from "../types/geometry";
import { adaptNumericResult } from "./numericFunctionAdapter";

const freePoint = (id: string, name: string, x: number, y: number): CadElement => ({
  id,
  name,
  type: "freePoint",
  visible: true,
  enabled: true,
  x,
  y
});

const line = (id: string, name: string, startPointId: string, endPointId: string): CadElement => ({
  id,
  name,
  type: "line",
  visible: true,
  enabled: true,
  startPoint: { mode: "reference", pointId: startPointId },
  endPoint: { mode: "reference", pointId: endPointId }
});

const point = (id: string, name: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name,
  x,
  y
});

const computedLine = (id: string, name: string, start: ComputedPoint, end: ComputedPoint, length: number): ComputedGeometry => ({
  kind: "line",
  elementId: id,
  name,
  startPointId: start.elementId,
  endPointId: end.elementId,
  start,
  end,
  length,
  startAngleDeg: null,
  endAngleDeg: null,
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

const a = point("a", "点A", 0, 0);
const b = point("b", "点B", 3, 4);
const origin = point("o", "原点", 0, 0);
const top = point("o2", "終点", 0, 10);
const p = point("p", "点P", 5, 5);
const vline = computedLine("vline", "縦線", origin, top, 10);
const zline = computedLine("zline", "ゼロ線", origin, origin, 0);

const computedGeometry = new Map<string, ComputedGeometry>([
  ["a", a],
  ["b", b],
  ["o", origin],
  ["o2", top],
  ["p", p],
  ["vline", vline],
  ["zline", zline]
]);

const elementsById = new Map<string, CadElement>([
  ["a", freePoint("a", "点A", 0, 0)],
  ["b", freePoint("b", "点B", 3, 4)],
  ["o", freePoint("o", "原点", 0, 0)],
  ["o2", freePoint("o2", "終点", 0, 10)],
  ["p", freePoint("p", "点P", 5, 5)],
  ["vline", line("vline", "縦線", "o", "o2")],
  ["zline", line("zline", "ゼロ線", "o", "o")]
]);

describe("adaptNumericResult / consistency with the legacy numeric evaluator", () => {
  it("wraps a successful distance(a, b) result unchanged", () => {
    const legacy = evaluateNumericValue({
      value: { kind: "expression", expression: "distance(a, b)" },
      computedGeometry,
      elementsById
    });
    expect(legacy.error).toBeUndefined();
    expect(legacy.value).toBe(5);

    const adapted = adaptNumericResult(legacy);
    expect(adapted).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 5 } });
  });

  it("wraps a successful lineDistance(p, vline) result unchanged", () => {
    const legacy = evaluateNumericValue({
      value: { kind: "expression", expression: "lineDistance(p, vline)" },
      computedGeometry,
      elementsById
    });
    expect(legacy.error).toBeUndefined();
    expect(legacy.value).toBe(5);

    const adapted = adaptNumericResult(legacy);
    expect(adapted).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 5 } });
  });

  it("maps a zero-length lineDistance failure (the legacy EPSILON guard) to a typed error", () => {
    const legacy = evaluateNumericValue({
      value: { kind: "expression", expression: "lineDistance(p, zline)" },
      computedGeometry,
      elementsById
    });
    expect(legacy.value).toBeUndefined();
    expect(legacy.error).toBeDefined();

    const adapted = adaptNumericResult(legacy, "binding:zline");
    expect(adapted).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-numeric-adapter-failure",
      bindingId: "binding:zline"
    });
  });
});
