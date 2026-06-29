import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  canUseRustEvaluationForElements,
  evaluationResultsMatch,
  resolveEvaluationEngineMode
} from "./evaluationEngine";

const pointA: CadElement = {
  id: "a",
  name: "A",
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 0,
  y: 0
};

const pointB: CadElement = {
  id: "b",
  name: "B",
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 100,
  y: 0
};

const line: CadElement = {
  id: "line",
  name: "線",
  type: "line",
  visible: true,
  enabled: true,
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" }
};

const arcLine: CadElement = {
  id: "arc",
  name: "円弧",
  type: "arcLine",
  visible: true,
  enabled: true,
  centerPoint: { mode: "reference", pointId: "a" },
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90
};

const threePointArcLine: CadElement = {
  id: "three-point-arc",
  name: "三点円弧",
  type: "threePointArcLine",
  visible: true,
  enabled: true,
  point1: { mode: "reference", pointId: "a" },
  point2: { mode: "coordinate", x: 0, y: -10 },
  point3: { mode: "coordinate", x: -10, y: 0 },
  startAngleDeg: 0,
  endAngleDeg: 90
};

const bezierCurve: CadElement = {
  id: "curve",
  name: "曲線",
  type: "bezierCurve",
  visible: true,
  enabled: true,
  startPoint: { mode: "reference", pointId: "a" },
  startHandleAngleDeg: 0,
  startHandleLength: 0,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: "b" },
  endHandleAngleDeg: 180,
  endHandleLength: 0
};

const offsetLine: CadElement = {
  id: "offset",
  name: "オフセット",
  type: "offsetLine",
  visible: true,
  enabled: true,
  baseLineIds: ["line"],
  offset: 10,
  side: "right",
  closed: false
};

const splitLine: CadElement = {
  id: "split",
  name: "分割線",
  type: "splitLine",
  visible: true,
  enabled: true,
  baseLineId: "line",
  splitPoint: { mode: "reference", pointId: "a" }
};

const edge = (line1Id: string, line2Id: string): CadElement => ({
  id: `edge-${line1Id}-${line2Id}`,
  name: "エッジ",
  type: "edge",
  visible: true,
  enabled: true,
  endpoint1: { lineId: line1Id, endpointKey: "end" },
  endpoint2: { lineId: line2Id, endpointKey: "start" },
  intersectionIndex: 0
});

const extendTrim = (lineId: string): CadElement => ({
  id: `extend-${lineId}`,
  name: "延長短縮",
  type: "extendTrim",
  visible: true,
  enabled: true,
  endpoint: { lineId, endpointKey: "end" },
  point: { mode: "reference", pointId: "a" }
});

const cornerRadiusArcLine = (line1Id: string, line2Id: string): CadElement => ({
  id: `corner-${line1Id}-${line2Id}`,
  name: "角R",
  type: "cornerRadiusArcLine",
  visible: true,
  enabled: true,
  endpoint1: { lineId: line1Id, endpointKey: "end" },
  endpoint2: { lineId: line2Id, endpointKey: "start" },
  radius: 10,
  intersectionIndex: 0
});

const lineDivisionPoint = (lineId: string): CadElement => ({
  id: `division-${lineId}`,
  name: "線上分点",
  type: "lineDivisionPoint",
  visible: true,
  enabled: true,
  endpoint: { lineId, endpointKey: "start" },
  placementMode: "ratio",
  distance: 0,
  ratio: 0.5
});

const lineTangentOffsetPoint = (lineId: string): CadElement => ({
  id: `tangent-offset-${lineId}`,
  name: "線上オフセット点",
  type: "lineTangentOffsetPoint",
  visible: true,
  enabled: true,
  baseLineId: lineId,
  basePoint: { mode: "reference", pointId: "a" },
  tangentAngleDeg: 90,
  distance: 10
});

const intersectionPoint = (line1Id: string, line2Id: string): CadElement => ({
  id: `intersection-${line1Id}-${line2Id}`,
  name: "交点",
  type: "intersectionPoint",
  visible: true,
  enabled: true,
  line1Id,
  line2Id,
  intersectionIndex: 0,
  useExtensions: false
});

const copyLine = (baseLineIds: string[]): CadElement => ({
  id: `copy-${baseLineIds.join("-")}`,
  name: "コピー",
  type: "copyLine",
  visible: true,
  enabled: true,
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" },
  angleDeg: 0,
  mirrorX: false,
  baseLineIds
});

const symmetricCopyLine = (baseLineIds: string[]): CadElement => ({
  id: `symmetric-copy-${baseLineIds.join("-")}`,
  name: "対称コピー",
  type: "symmetricCopyLine",
  visible: true,
  enabled: true,
  axisPoint1: { mode: "reference", pointId: "a" },
  axisPoint2: { mode: "reference", pointId: "b" },
  baseLineIds
});

const move = (baseLineIds: string[]): CadElement => ({
  id: `move-${baseLineIds.join("-")}`,
  name: "移動",
  type: "move",
  visible: true,
  enabled: true,
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" },
  angleDeg: 0,
  mirrorX: false,
  baseLineIds
});

const symmetricMove = (baseLineIds: string[]): CadElement => ({
  id: `symmetric-move-${baseLineIds.join("-")}`,
  name: "対称移動",
  type: "symmetricMove",
  visible: true,
  enabled: true,
  axisPoint1: { mode: "reference", pointId: "a" },
  axisPoint2: { mode: "reference", pointId: "b" },
  baseLineIds
});

const unsupportedElement = {
  id: "unsupported",
  name: "未対応",
  type: "unsupportedElement",
  visible: true,
  enabled: true
} as unknown as CadElement;

describe("canUseRustEvaluationForElements", () => {
  it("allows lineDivisionPoint when it references a supported line type", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, line, lineDivisionPoint("line")])).toBe(
      true
    );
    expect(canUseRustEvaluationForElements([pointA, arcLine, lineDivisionPoint("arc")])).toBe(
      true
    );
  });

  it("keeps lineDivisionPoint on the TypeScript path for unsupported or missing line references", () => {
    expect(canUseRustEvaluationForElements([pointA, lineDivisionPoint("missing")])).toBe(false);
  });

  it("allows lineTangentOffsetPoint when it references a supported line type", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, lineTangentOffsetPoint("line")])
    ).toBe(true);
    expect(canUseRustEvaluationForElements([pointA, arcLine, lineTangentOffsetPoint("arc")])).toBe(
      true
    );
  });

  it("keeps lineTangentOffsetPoint on the TypeScript path for unsupported or missing line references", () => {
    expect(canUseRustEvaluationForElements([pointA, lineTangentOffsetPoint("missing")])).toBe(
      false
    );
  });

  it("allows intersectionPoint when both references are supported line types", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, arcLine, intersectionPoint("line", "arc")])
    ).toBe(true);
  });

  it("keeps intersectionPoint on the TypeScript path for unsupported or missing line references", () => {
    expect(canUseRustEvaluationForElements([pointA, line, intersectionPoint("line", "missing")])).toBe(
      false
    );
  });

  it("allows threePointArcLine and supported point elements that reference it", () => {
    expect(canUseRustEvaluationForElements([pointA, threePointArcLine])).toBe(true);
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        threePointArcLine,
        lineDivisionPoint("three-point-arc"),
        lineTangentOffsetPoint("three-point-arc"),
        intersectionPoint("line", "three-point-arc")
      ])
    ).toBe(true);
  });

  it("allows bezierCurve and supported point elements that reference it", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, bezierCurve])).toBe(true);
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        bezierCurve,
        lineDivisionPoint("curve"),
        lineTangentOffsetPoint("curve"),
        intersectionPoint("line", "curve")
      ])
    ).toBe(true);
  });

  it("allows offsetLine and supported point elements that reference it", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, line, offsetLine])).toBe(true);
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        offsetLine,
        lineDivisionPoint("offset"),
        lineTangentOffsetPoint("offset"),
        intersectionPoint("line", "offset")
      ])
    ).toBe(true);
  });

  it("keeps offsetLine on the TypeScript path when a base reference is missing", () => {
    expect(
      canUseRustEvaluationForElements([
        {
          ...offsetLine,
          baseLineIds: ["missing"]
        }
      ])
    ).toBe(false);
  });

  it("allows splitLine and supported elements that reference it", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, line, splitLine])).toBe(true);
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        splitLine,
        lineDivisionPoint("split"),
        lineTangentOffsetPoint("split"),
        intersectionPoint("line", "split"),
        { ...offsetLine, baseLineIds: ["split"] }
      ])
    ).toBe(true);
  });

  it("keeps splitLine on the TypeScript path when its base reference is missing", () => {
    expect(
      canUseRustEvaluationForElements([
        {
          ...splitLine,
          baseLineId: "missing"
        }
      ])
    ).toBe(false);
  });

  it("allows edge and extendTrim when they reference supported line types", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, line, arcLine, edge("line", "arc")])).toBe(
      true
    );
    expect(canUseRustEvaluationForElements([pointA, pointB, line, extendTrim("line")])).toBe(
      true
    );
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        splitLine,
        edge("line", "split"),
        extendTrim("split")
      ])
    ).toBe(true);
  });

  it("keeps edge and extendTrim on the TypeScript path when references are missing", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, line, edge("line", "missing")])).toBe(
      false
    );
    expect(canUseRustEvaluationForElements([pointA, extendTrim("missing")])).toBe(false);
  });

  it("allows cornerRadiusArcLine and supported elements that reference it", () => {
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        arcLine,
        cornerRadiusArcLine("line", "arc"),
        lineDivisionPoint("corner-line-arc"),
        intersectionPoint("line", "corner-line-arc")
      ])
    ).toBe(true);
  });

  it("keeps cornerRadiusArcLine on the TypeScript path when references are missing", () => {
    expect(
      canUseRustEvaluationForElements([pointA, pointB, line, cornerRadiusArcLine("line", "missing")])
    ).toBe(false);
  });

  it("allows copy and move elements when all base lines are supported", () => {
    expect(
      canUseRustEvaluationForElements([
        pointA,
        pointB,
        line,
        arcLine,
        bezierCurve,
        offsetLine,
        splitLine,
        copyLine(["line", "arc", "curve", "offset", "split"]),
        symmetricCopyLine(["line", "curve"]),
        move(["line", "offset"]),
        symmetricMove(["arc", "split"])
      ])
    ).toBe(true);
  });

  it("keeps copy and move elements on the TypeScript path when base references are missing", () => {
    expect(canUseRustEvaluationForElements([pointA, pointB, copyLine(["missing"])])).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, pointB, symmetricCopyLine(["missing"])])).toBe(
      false
    );
    expect(canUseRustEvaluationForElements([pointA, pointB, move(["missing"])])).toBe(false);
    expect(canUseRustEvaluationForElements([pointA, pointB, symmetricMove(["missing"])])).toBe(
      false
    );
  });

  it("keeps elements with unsupported point-anchor dependencies on the TypeScript path", () => {
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
});

describe("resolveEvaluationEngineMode", () => {
  it("uses the TypeScript reference evaluator outside Tauri by default", () => {
    expect(
      resolveEvaluationEngineMode({
        tauriRuntime: false,
        dev: false
      })
    ).toBe("reference");
  });

  it("uses Rust mode in Tauri dev and production by default", () => {
    expect(
      resolveEvaluationEngineMode({
        tauriRuntime: true,
        dev: true
      })
    ).toBe("rust");
    expect(
      resolveEvaluationEngineMode({
        tauriRuntime: true,
        dev: false
      })
    ).toBe("rust");
  });

  it("allows VITE_EVALUATION_ENGINE to override the default mode", () => {
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "reference",
        tauriRuntime: true,
        dev: false
      })
    ).toBe("reference");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "parity",
        tauriRuntime: false,
        dev: false
      })
    ).toBe("parity");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "shadow",
        tauriRuntime: false,
        dev: false
      })
    ).toBe("shadow");
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "rust",
        tauriRuntime: false,
        dev: true
      })
    ).toBe("rust");
  });

  it("ignores invalid VITE_EVALUATION_ENGINE values", () => {
    expect(
      resolveEvaluationEngineMode({
        configuredMode: "invalid",
        tauriRuntime: true,
        dev: false
      })
    ).toBe("rust");
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
});
