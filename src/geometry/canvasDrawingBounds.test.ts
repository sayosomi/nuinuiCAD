import { describe, expect, it } from "vitest";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { visibleCanvasDrawingBounds } from "./canvasDrawingBounds";

const element = (id: string, type: CadElement["type"], activity: CadElement["activity"] = "visible") => ({
  id,
  name: id,
  type,
  activity
} as CadElement);

const evaluationFor = (geometry: ComputedGeometry[], visibleIds: string[]): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: [],
  effectiveVisibleElementIds: new Set(visibleIds)
});

describe("visibleCanvasDrawingBounds", () => {
  it("uses actual cubic extrema and excludes hidden, disabled, and image geometry", () => {
    const curve: ComputedGeometry = {
      kind: "bezierCurve",
      elementId: "curve",
      name: "curve",
      startPointId: null,
      endPointId: null,
      intermediatePointIds: [],
      segments: [{
        startPointId: null,
        endPointId: null,
        start: { kind: "point", elementId: "start", name: "start", x: 0, y: 0 },
        control1: { x: 0, y: 100 },
        control2: { x: 100, y: 100 },
        end: { kind: "point", elementId: "end", name: "end", x: 100, y: 0 }
      }],
      length: 0,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null,
      startHandleAngleDeg: 0,
      startHandleLength: 0,
      endHandleAngleDeg: 0,
      endHandleLength: 0
    };
    const hiddenPoint: ComputedGeometry = {
      kind: "point",
      elementId: "hidden",
      name: "hidden",
      x: -100,
      y: -100
    };
    const disabledPoint: ComputedGeometry = {
      kind: "point",
      elementId: "disabled",
      name: "disabled",
      x: 200,
      y: 200
    };
    const image: ComputedGeometry = {
      kind: "image",
      elementId: "image",
      name: "image",
      sourcePath: "reference.png",
      origin: { kind: "point", elementId: "image-origin", name: "image-origin", x: -500, y: -500 },
      naturalWidthPx: 100,
      naturalHeightPx: 100,
      sourceDpi: 96,
      targetPixelsPerMm: 1,
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      widthMm: 1000,
      heightMm: 1000
    };
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [
        element("curve", "bezierCurve"),
        element("hidden", "freePoint", "hidden"),
        element("disabled", "freePoint", "disabled"),
        element("image", "image")
      ],
      evaluation: evaluationFor([curve, hiddenPoint, disabledPoint, image], ["curve", "hidden", "disabled", "image"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    });

    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 75 });
  });

  it("includes cardinal extrema reached by a visible arc", () => {
    const arc: ComputedGeometry = {
      kind: "arcLine",
      elementId: "arc",
      name: "arc",
      centerPointId: null,
      center: { kind: "point", elementId: "center", name: "center", x: 0, y: 0 },
      start: { kind: "point", elementId: "start", name: "start", x: 10, y: 0 },
      end: { kind: "point", elementId: "end", name: "end", x: 0, y: 10 },
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 90,
      sweepAngleDeg: 90,
      length: 0
    };
    const profiles = [defaultVisibilityProfile()];

    expect(visibleCanvasDrawingBounds({
      elements: [element("arc", "arcLine")],
      evaluation: evaluationFor([arc], ["arc"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    })).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});
