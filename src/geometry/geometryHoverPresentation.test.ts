import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ComputedGeometry,
  ComputedOffsetLine,
  EvaluationResult
} from "../types/geometry";
import {
  geometryHoverMarkdown,
  geometryHoverPresentation
} from "./geometryHoverPresentation";

const elementFor = (activity: CadElement["activity"] = "visible"): CadElement => ({
  id: "point-a",
  name: "A",
  type: "freePoint",
  activity,
  x: 1,
  y: 2
});

const namedElement = (
  id: string,
  name: string,
  type: CadElement["type"],
  activity: CadElement["activity"] = "visible"
): CadElement => ({ id, name, type, activity } as unknown as CadElement);

const evaluationFor = ({
  geometry = true,
  evaluated = true,
  enabled = true,
  visible = true,
  inactive = false,
  error = false,
  warning = false
}: {
  geometry?: boolean;
  evaluated?: boolean;
  enabled?: boolean;
  visible?: boolean;
  inactive?: boolean;
  error?: boolean;
  warning?: boolean;
} = {}): EvaluationResult => ({
  computedGeometry: new Map(geometry ? [["point-a", {
    kind: "point" as const,
    elementId: "point-a",
    name: "A",
    x: 1,
    y: 2
  }]] : []),
  errors: error ? [{
    elementId: "point-a",
    elementName: "A",
    missingDependencyId: "missing",
    message: "failed"
  }] : [],
  warnings: warning ? [{
    elementId: "point-a",
    elementName: "A",
    message: "warning"
  }] : [],
  evaluatedElementIds: new Set(evaluated ? ["point-a"] : []),
  effectiveEnabledElementIds: new Set(enabled ? ["point-a"] : []),
  effectiveVisibleElementIds: new Set(visible ? ["point-a"] : []),
  conditionInactiveElementIds: new Set(inactive ? ["point-a"] : [])
});

const evaluationWith = (
  targetId: string,
  geometries: ComputedGeometry[]
): EvaluationResult => ({
  computedGeometry: new Map(geometries.map((geometry) => [geometry.elementId, geometry])),
  errors: [],
  warnings: [],
  evaluatedElementIds: new Set([targetId]),
  effectiveEnabledElementIds: new Set([targetId]),
  effectiveVisibleElementIds: new Set([targetId]),
  conditionInactiveElementIds: new Set()
});

describe("geometry Hover runtime presentation", () => {
  it("shows the compact point coordinate for a visible evaluated element", () => {
    const presentation = geometryHoverPresentation(elementFor(), evaluationFor());

    expect(presentation).toEqual({
      heading: "A · free point",
      statuses: [],
      availability: {
        kind: "geometry",
        rows: [{ kind: "value", label: "座標", value: "(1, 2)" }]
      }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("**座標:** \\(1, 2\\)");
  });

  it("shows line length, start-to-end angle and endpoints without duplicate tangent rows", () => {
    const geometry: ComputedGeometry = {
      kind: "line",
      elementId: "base",
      name: "Base",
      startPointId: null,
      endPointId: null,
      start: { kind: "point", elementId: "s", name: "s", x: 0, y: 0 },
      end: { kind: "point", elementId: "e", name: "e", x: 0, y: 150 },
      length: 150,
      startAngleDeg: 90,
      endAngleDeg: 270,
      startTangentAngleDeg: 90,
      endTangentAngleDeg: 270
    };
    const presentation = geometryHoverPresentation(
      namedElement("base", "Base", "line"),
      evaluationWith("base", [geometry])
    );

    expect(presentation.availability).toEqual({
      kind: "geometry",
      rows: [
        { kind: "value", label: "長さ", value: "150 mm" },
        { kind: "value", label: "角度", value: "90°" },
        { kind: "value", label: "始点", value: "(0, 0)" },
        { kind: "value", label: "終点", value: "(0, 150)" }
      ]
    });
    const markdown = geometryHoverMarkdown(presentation);
    expect(markdown).not.toContain("始接線角度");
    expect(markdown).not.toContain("終接線角度");
  });

  it("shows arc inspection values including signed sweep without tangent rows", () => {
    const geometry: ComputedGeometry = {
      kind: "arcLine",
      elementId: "arc",
      name: "Arc",
      centerPointId: null,
      center: { kind: "point", elementId: "c", name: "c", x: 0, y: 0 },
      start: { kind: "point", elementId: "s", name: "s", x: 50, y: 0 },
      end: { kind: "point", elementId: "e", name: "e", x: 0, y: -50 },
      radius: 50,
      startAngleDeg: 0,
      endAngleDeg: 270,
      startTangentAngleDeg: 270,
      endTangentAngleDeg: 180,
      sweepAngleDeg: -90,
      length: Math.PI * 25
    };
    const presentation = geometryHoverPresentation(
      namedElement("arc", "Arc", "arcLine"),
      evaluationWith("arc", [geometry])
    );

    expect(presentation.availability).toMatchObject({
      kind: "geometry",
      rows: [
        { label: "中心点", value: "(0, 0)" },
        { label: "半径", value: "50 mm" },
        { label: "始角度", value: "0°" },
        { label: "終角度", value: "270°" },
        { label: "スイープ", value: "-90°" },
        { label: "長さ", value: "78.54 mm" },
        { label: "始点", value: "(50, 0)" },
        { label: "終点", value: "(0, -50)" }
      ]
    });
    expect(geometryHoverMarkdown(presentation)).not.toContain("接線");
  });

  it("shows every Bezier anchor with evaluated handle lengths and axis angle", () => {
    const start = { kind: "point" as const, elementId: "start", name: "start", x: 0, y: 0 };
    const middle = { kind: "point" as const, elementId: "middle", name: "middle", x: 30, y: 20 };
    const end = { kind: "point" as const, elementId: "end", name: "end", x: 60, y: 0 };
    const geometry: ComputedGeometry = {
      kind: "bezierCurve",
      elementId: "curve",
      name: "Curve",
      startPointId: "start",
      endPointId: "end",
      intermediatePointIds: ["middle"],
      segments: [
        {
          startPointId: "start",
          endPointId: "middle",
          start,
          control1: { x: 10, y: 0 },
          control2: { x: 20, y: 20 },
          end: middle
        },
        {
          startPointId: "middle",
          endPointId: "end",
          start: middle,
          control1: { x: 40, y: 20 },
          control2: { x: 50, y: 0 },
          end
        }
      ],
      length: 70,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 180,
      startHandleAngleDeg: 0,
      startHandleLength: 10,
      endHandleAngleDeg: 0,
      endHandleLength: 10
    };
    const presentation = geometryHoverPresentation(
      namedElement("curve", "Curve", "bezierCurve"),
      evaluationWith("curve", [geometry])
    );

    expect(presentation.availability).toEqual({
      kind: "geometry",
      rows: [{ kind: "value", label: "長さ", value: "70 mm" }],
      table: {
        headers: ["Anchor", "Position", "← In", "Angle", "Out →"],
        rows: [
          ["Start", "(0, 0)", "—", "0°", "10 mm"],
          ["P1", "(30, 20)", "10 mm", "0°", "10 mm"],
          ["End", "(60, 0)", "10 mm", "0°", "—"]
        ]
      }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("| Anchor | Position | ← In | Angle | Out → |");
  });

  it("shows offset result and operation context with a structured source reference", () => {
    const base: ComputedGeometry = {
      kind: "line",
      elementId: "base",
      name: "Base",
      startPointId: null,
      endPointId: null,
      start: { kind: "point", elementId: "bs", name: "bs", x: 0, y: 0 },
      end: { kind: "point", elementId: "be", name: "be", x: 100, y: 0 },
      length: 100,
      startAngleDeg: 0,
      endAngleDeg: 180,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 180
    };
    const offset = {
      kind: "offsetLine" as const,
      elementId: "offset",
      name: "Seam",
      baseLineIds: ["base"],
      start: { kind: "point" as const, elementId: "os", name: "os", x: 0, y: 10 },
      end: { kind: "point" as const, elementId: "oe", name: "oe", x: 100, y: 10 },
      segments: [],
      closed: false,
      length: 100,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 180,
      offsetDistance: 10,
      offsetSide: "left" as const
    } as ComputedOffsetLine & { offsetDistance: number; offsetSide: "left" };
    const presentation = geometryHoverPresentation(
      namedElement("offset", "Seam", "offsetLine"),
      evaluationWith("offset", [base, offset])
    );

    expect(presentation.availability).toEqual({
      kind: "geometry",
      rows: [
        { kind: "value", label: "長さ", value: "100 mm" },
        { kind: "value", label: "始点", value: "(0, 10)" },
        { kind: "value", label: "終点", value: "(100, 10)" },
        { kind: "value", label: "距離", value: "10 mm" },
        { kind: "value", label: "方向", value: "left" },
        {
          kind: "references",
          label: "Source",
          references: [{ elementId: "base", label: "Base" }]
        }
      ]
    });
    expect(geometryHoverMarkdown(
      presentation,
      (reference) => `command:nuinuiCAD.hover.revealSourceReference?${reference.elementId}`
    )).toContain("[Base](command:nuinuiCAD.hover.revealSourceReference?base)");
  });

  it("keeps current geometry while surfacing hidden and issue states", () => {
    const presentation = geometryHoverPresentation(
      elementFor("hidden"),
      evaluationFor({ visible: false, error: true, warning: true })
    );

    expect(presentation.statuses).toEqual(["Hidden", "Error", "Warning"]);
    expect(presentation.availability.kind).toBe("geometry");
  });

  it("shows disabled and inactive elements as not evaluated without geometry", () => {
    expect(geometryHoverPresentation(
      elementFor("disabled"),
      evaluationFor({ enabled: false })
    )).toMatchObject({
      statuses: ["Disabled"],
      availability: { kind: "not-evaluated" }
    });

    expect(geometryHoverPresentation(
      elementFor(),
      evaluationFor({ inactive: true })
    )).toMatchObject({
      statuses: ["Inactive"],
      availability: { kind: "not-evaluated" }
    });
  });

  it("shows an evaluated-limit miss as not evaluated", () => {
    const presentation = geometryHoverPresentation(
      elementFor(),
      evaluationFor({ evaluated: false, geometry: false })
    );

    expect(presentation).toMatchObject({
      statuses: [],
      availability: { kind: "not-evaluated" }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("Not evaluated");
  });

  it("does not invent geometry when current evaluation has none", () => {
    const presentation = geometryHoverPresentation(
      elementFor(),
      evaluationFor({ geometry: false, error: true })
    );

    expect(presentation).toMatchObject({
      statuses: ["Error"],
      availability: { kind: "unavailable" }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("Geometry unavailable");
  });
});
