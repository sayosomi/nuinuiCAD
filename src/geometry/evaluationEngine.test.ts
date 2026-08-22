import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import {
  evaluationResultsMatch,
  resolveEvaluationEngineMode
} from "./evaluationEngine";

const pointA: CadElement = {
  id: "a",
  name: "A",
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
};

const pointB: CadElement = {
  id: "b",
  name: "B",
  type: "freePoint",
  activity: "visible",
  x: 100,
  y: 0
};

const line: CadElement = {
  id: "line",
  name: "線",
  type: "line",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" }
};

const arcLine: CadElement = {
  id: "arc",
  name: "円弧",
  type: "arcLine",
  activity: "visible",
  centerPoint: { mode: "reference", pointId: "a" },
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90
};

const bezierCurve: CadElement = {
  id: "curve",
  name: "曲線",
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  startHandleAngleDeg: 0,
  startHandleLength: 0,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: "b" },
  endHandleAngleDeg: 180,
  endHandleLength: 0
};

const lineDivisionPoint = (lineId: string): CadElement => ({
  id: `division-${lineId}`,
  name: "線上分点",
  type: "lineDivisionPoint",
  activity: "visible",
  endpoint: { lineId, endpointKey: "start" },
  placement: { kind: "ratio", value: 0.5 }
});

const offsetLine: CadElement = {
  id: "offset",
  name: "オフセット",
  type: "offsetLine",
  activity: "visible",
  baseLineIds: ["line"],
  offset: 10,
  side: "right",
  closed: false
};

const splitLine: CadElement = {
  id: "split",
  name: "分割線",
  type: "splitLine",
  activity: "visible",
  baseLineId: "line",
  splitPoint: { mode: "reference", pointId: "a" }
};

const unsupportedElement = {
  id: "unsupported",
  name: "未対応",
  type: "unsupportedElement",
  activity: "visible"
} as unknown as CadElement;

describe("canUseRustEvaluationForElements", () => {
  it("accepts supported geometry chains", () => {
    const division = lineDivisionPoint("line");
    expect(canUseRustEvaluationForElements([pointA, pointB, line, division])).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, arcLine])).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, pointB, bezierCurve])).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, pointB, line, offsetLine])).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, pointB, line, splitLine])).toBe(true);
  });

  it("rejects supported element kinds when required geometry references are missing", () => {
    expect(canUseRustEvaluationForElements([pointA, lineDivisionPoint("missing")])).toBe(false);
    expect(canUseRustEvaluationForElements([{ ...offsetLine, baseLineIds: ["missing"] }])).toBe(false);
    expect(canUseRustEvaluationForElements([{ ...splitLine, baseLineId: "missing" }])).toBe(false);
  });

  it("rejects unsupported point-anchor dependencies", () => {
    expect(
      canUseRustEvaluationForElements([
        unsupportedElement,
        {
          ...line,
          startPoint: { mode: "derived", elementId: "unsupported", pointKey: "start" }
        }
      ])
    ).toBe(false);
  });

  it("rejects compiled property bindings that are unavailable to Rust", () => {
    expect(
      canUseRustEvaluationForElements([pointA], {
        propertyBindingEntries: [{
          elementId: pointA.id,
          parameterKey: "mirrorX",
          bindingId: "binding:missing",
          expectedType: { kind: "boolean" }
        }]
      })
    ).toBe(false);
  });
});

describe("resolveEvaluationEngineMode", () => {
  it("uses the TypeScript reference evaluator when no Rust transport is available", () => {
    expect(
      resolveEvaluationEngineMode({ rustTransportAvailable: false })
    ).toBe("reference");
  });

  it("uses Rust mode by default when a host supplies a Rust transport", () => {
    expect(
      resolveEvaluationEngineMode({ rustTransportAvailable: true })
    ).toBe("rust");
  });

  it("allows VITE_EVALUATION_ENGINE to override the transport-derived default", () => {
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "reference",
        rustTransportAvailable: true
      })
    ).toBe("reference");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "parity",
        rustTransportAvailable: false
      })
    ).toBe("parity");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "shadow",
        rustTransportAvailable: false
      })
    ).toBe("shadow");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "rust",
        rustTransportAvailable: false
      })
    ).toBe("rust");
  });

  it("ignores invalid configured mode values", () => {
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "invalid",
        rustTransportAvailable: true
      })
    ).toBe("rust");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "invalid",
        rustTransportAvailable: false
      })
    ).toBe("reference");
  });
});

describe("evaluationResultsMatch", () => {
  it("allows small numeric differences but keeps structural differences strict", () => {
    const base = {
      computedGeometry: new Map([
        [
          "a",
          {
            kind: "point" as const,
            elementId: "a",
            name: "点A",
            x: 10.123456789,
            y: -0
          }
        ]
      ]),
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      evaluatedElementIds: new Set(["a"]),
      evaluationLimitIndex: 1,
      effectiveVisibleElementIds: new Set(["a"]),
      effectiveEnabledElementIds: new Set(["a"])
    };

    expect(
      evaluationResultsMatch(base, {
        ...base,
        computedGeometry: new Map([
          [
            "a",
            JSON.parse(
              '{"y":0,"x":10.123456781,"name":"点A","elementId":"a","kind":"point"}'
            )
          ]
        ])
      })
    ).toBe(true);
    expect(
      evaluationResultsMatch(base, {
        ...base,
        computedGeometry: new Map([
          [
            "b",
            {
              kind: "point",
              elementId: "b",
              name: "点B",
              x: 10.123456781,
              y: 0
            }
          ]
        ])
      })
    ).toBe(false);
  });

  it("compares computedScalarBindings returned by Rust", () => {
    const base = {
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      evaluatedElementIds: new Set<string>(),
      evaluationLimitIndex: 0,
      effectiveVisibleElementIds: new Set<string>(),
      effectiveEnabledElementIds: new Set<string>()
    };

    const withBinding = {
      ...base,
      computedScalarBindings: new Map([
        ["binding:a", {
          status: "ok" as const,
          type: { kind: "number" as const },
          value: { kind: "number" as const, value: 1 }
        }]
      ])
    };
    expect(evaluationResultsMatch(base, withBinding)).toBe(false);
    expect(evaluationResultsMatch(withBinding, withBinding)).toBe(true);
  });
});
