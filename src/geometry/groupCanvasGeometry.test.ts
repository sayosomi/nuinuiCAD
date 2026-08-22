import { describe, expect, it } from "vitest";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { groupCanvasGeometry } from "./groupCanvasGeometry";

const element = (
  id: string,
  type: CadElement["type"],
  parentGroupId?: string,
  activity: CadElement["activity"] = "visible"
) => ({ id, name: id, type, activity, parentGroupId } as CadElement);

const evaluationFor = (geometry: readonly ComputedGeometry[]): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: []
});

const point = (elementId: string, x: number, y: number): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const line = (elementId: string, x = 10, y = 10): ComputedGeometry => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: null,
  endPointId: null,
  start: { kind: "point", elementId: `${elementId}-start`, name: "start", x: 0, y: 0 },
  end: { kind: "point", elementId: `${elementId}-end`, name: "end", x, y },
  length: Math.hypot(x, y),
  startAngleDeg: 45,
  endAngleDeg: 45,
  startTangentAngleDeg: 45,
  endTangentAngleDeg: 45
});

const image = (elementId: string): ComputedGeometry => ({
  kind: "image",
  elementId,
  name: elementId,
  sourcePath: "reference.png",
  origin: { kind: "point", elementId: `${elementId}-origin`, name: "origin", x: 20, y: 20 },
  naturalWidthPx: 5,
  naturalHeightPx: 10,
  sourceDpi: 96,
  targetPixelsPerMm: 1,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
  widthMm: 5,
  heightMm: 10
});

const profile = defaultVisibilityProfile();
const geometryFor = ({
  groupId = "group",
  elements,
  evaluation,
  measureCanvasTextWidth
}: {
  groupId?: string;
  elements: CadElement[];
  evaluation: EvaluationResult;
  measureCanvasTextWidth?: (text: string, fontSize: number) => number | null;
}) => groupCanvasGeometry({
  groupId,
  elements,
  evaluation,
  visibilityProfiles: [profile],
  activeVisibilityProfileId: profile.id,
  measureCanvasTextWidth
});

describe("groupCanvasGeometry", () => {
  it("aggregates recursive descendants and includes reference image bounds", () => {
    const result = geometryFor({
      elements: [
        element("group", "group"),
        element("inner", "group", "group"),
        element("line", "line", "inner"),
        element("image", "image", "group")
      ],
      evaluation: evaluationFor([line("line"), image("image")])
    });

    expect(result?.descendantIds).toEqual(["inner", "line", "image"]);
    expect(result?.renderableDescendantIds).toEqual(["line", "image"]);
    expect(result?.bounds).toEqual({ minX: 0, minY: 0, maxX: 25, maxY: 20 });
  });

  it("excludes hidden, disabled, and unevaluated descendants", () => {
    const result = geometryFor({
      elements: [
        element("group", "group"),
        element("visible", "freePoint", "group"),
        element("hidden", "freePoint", "group", "hidden"),
        element("disabled", "freePoint", "group", "disabled"),
        element("missing", "freePoint", "group")
      ],
      evaluation: evaluationFor([
        point("visible", 3, 4),
        point("hidden", -100, -100),
        point("disabled", 100, 100)
      ])
    });

    expect(result?.renderableDescendantIds).toEqual(["visible"]);
    expect(result?.bounds).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it("includes visible for-group generated rows owned by a descendant template", () => {
    const evaluation: EvaluationResult = {
      ...evaluationFor([point("generated", 50, 60)]),
      effectiveVisibleElementIds: new Set(["generated"]),
      forGroupGeneratedRows: [{
        forGroupId: "for-group",
        templateElementId: "template",
        generatedElementId: "generated",
        iterationIndex: 0,
        variableName: "i",
        variableValue: 0,
        elementName: "generated",
        elementType: "freePoint"
      }]
    };
    const result = geometryFor({
      elements: [
        element("group", "group"),
        element("for-group", "forGroup", "group"),
        element("template", "freePoint", "for-group")
      ],
      evaluation
    });

    expect(result?.descendantIds).toEqual(["for-group", "template", "generated"]);
    expect(result?.renderableDescendantIds).toEqual(["generated"]);
    expect(result?.bounds).toEqual({ minX: 50, minY: 60, maxX: 50, maxY: 60 });
  });

  it("supports conditionalGroup and forGroup as direct container identities", () => {
    const elements = [
      element("conditional", "conditionalGroup"),
      element("conditional-child", "freePoint", "conditional"),
      element("for", "forGroup"),
      element("for-child", "freePoint", "for")
    ];
    const evaluation = evaluationFor([
      point("conditional-child", 1, 2),
      point("for-child", 3, 4)
    ]);

    expect(geometryFor({ groupId: "conditional", elements, evaluation })?.bounds).toEqual({
      minX: 1,
      minY: 2,
      maxX: 1,
      maxY: 2
    });
    expect(geometryFor({ groupId: "for", elements, evaluation })?.bounds).toEqual({
      minX: 3,
      minY: 4,
      maxX: 3,
      maxY: 4
    });
  });

  it("fails bounds closed when a visible text descendant cannot be measured", () => {
    const text: ComputedGeometry = {
      kind: "text",
      elementId: "text",
      name: "text",
      text: "group label",
      anchor: { kind: "point", elementId: "anchor", name: "anchor", x: 1, y: 2 },
      fontSize: 5
    };
    const result = geometryFor({
      elements: [element("group", "group"), element("text", "text", "group")],
      evaluation: evaluationFor([text])
    });

    expect(result?.renderableDescendantIds).toEqual(["text"]);
    expect(result?.bounds).toBeNull();
  });

  it("returns null for an ordinary geometry identity", () => {
    expect(geometryFor({
      groupId: "point",
      elements: [element("point", "freePoint")],
      evaluation: evaluationFor([point("point", 0, 0)])
    })).toBeNull();
  });
});
