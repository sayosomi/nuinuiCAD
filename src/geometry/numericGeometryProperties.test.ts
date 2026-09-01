import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  NUMERIC_COMPUTED_GEOMETRY_PROPERTIES,
  NUMERIC_COMPUTED_GEOMETRY_PROPERTY_UNITS,
  numericGeometryPropertiesForStaticTarget,
  numericGeometryPropertySupportedByStaticTarget,
  numericGeometryPropertyUnitFor,
  numericGeometryStaticTargetForConstruction,
  numericGeometryStaticTargetForElementInDocument,
  numericGeometryStaticTargetForModuleInterface
} from "./numericGeometryProperties";

const commonPath = [
  "length",
  "startAngleDeg",
  "endAngleDeg",
  "startPoint.x",
  "startPoint.y",
  "endPoint.x",
  "endPoint.y"
];

describe("numeric geometry property contract", () => {
  it("classifies canonical properties by presentation unit and fails closed", () => {
    expect(NUMERIC_COMPUTED_GEOMETRY_PROPERTIES).toHaveLength(
      Object.keys(NUMERIC_COMPUTED_GEOMETRY_PROPERTY_UNITS).length
    );
    expect(numericGeometryPropertyUnitFor("length")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("radius")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("startHandleLength")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("endHandleLength")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("widthMm")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("heightMm")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("fontSize")).toBe("mm");
    expect(numericGeometryPropertyUnitFor("startAngleDeg")).toBe("°");
    expect(numericGeometryPropertyUnitFor("sweepAngleDeg")).toBe("°");
    expect(numericGeometryPropertyUnitFor("angleDeg")).toBe("°");
    expect(numericGeometryPropertyUnitFor("naturalWidthPx")).toBe("px");
    expect(numericGeometryPropertyUnitFor("naturalHeightPx")).toBe("px");
    expect(numericGeometryPropertyUnitFor("sourceDpi")).toBe("dpi");
    expect(numericGeometryPropertyUnitFor("targetPixelsPerMm")).toBe("px/mm");
    expect(numericGeometryPropertyUnitFor("scale")).toBe("bare");
    expect(numericGeometryPropertyUnitFor("x")).toBe("bare");
    expect(numericGeometryPropertyUnitFor("startPoint.x")).toBe("bare");
    expect(numericGeometryPropertyUnitFor("intermediatePoints[4].y")).toBe("bare");
    expect(numericGeometryPropertyUnitFor("unknownProperty")).toBe("bare");
    expect(numericGeometryPropertyUnitFor("unknownPoint.x")).toBe("bare");
  });

  it("exposes exact target-aware public surfaces", () => {
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "segment")
    )).toEqual(commonPath);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("arc", "arc")
    )).toEqual([
      ...commonPath,
      "radius",
      "sweepAngleDeg",
      "startRadiusAngleDeg",
      "endRadiusAngleDeg",
      "centerPoint.x",
      "centerPoint.y"
    ]);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("curve", "bezier", {
        intermediatePointCount: 2
      })
    )).toEqual([
      ...commonPath,
      "startHandleAngleDeg",
      "startHandleLength",
      "endHandleAngleDeg",
      "endHandleLength",
      "intermediatePoints[1].x",
      "intermediatePoints[1].y",
      "intermediatePoints[2].x",
      "intermediatePoints[2].y"
    ]);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "offset")
    )).toEqual(commonPath);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "polyline")
    )).toEqual(commonPath);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForModuleInterface("point")
    )).toEqual(["x", "y"]);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("image", "image")
    )).toEqual([
      "originPoint.x",
      "originPoint.y",
      "widthMm",
      "heightMm",
      "scale",
      "angleDeg",
      "naturalWidthPx",
      "naturalHeightPx",
      "sourceDpi",
      "targetPixelsPerMm"
    ]);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("text", "label")
    )).toEqual(["anchorPoint.x", "anchorPoint.y", "fontSize"]);
  });

  it("maps fixed-output constructions and preserves proven split families", () => {
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "polar")
    )).toEqual(commonPath);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "commonTangent")
    )).toEqual(commonPath);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("arc", "through")
    )).toEqual(expect.arrayContaining(["radius", "startRadiusAngleDeg"]));
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("arc", "corner")
    )).toEqual(expect.arrayContaining(["centerPoint.x", "endRadiusAngleDeg"]));

    const arcTarget = numericGeometryStaticTargetForConstruction("arc", "arc");
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "split", { baseTarget: arcTarget })
    )).toEqual(numericGeometryPropertiesForStaticTarget(arcTarget));
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "split")
    )).toEqual(commonPath);
    expect(numericGeometryPropertiesForStaticTarget(
      numericGeometryStaticTargetForModuleInterface("path")
    )).toEqual(commonPath);
    expect(numericGeometryPropertySupportedByStaticTarget(
      numericGeometryStaticTargetForModuleInterface("path"),
      "radius"
    )).toBe(false);
  });

  it("proves a direct Bezier's intermediate indices and keeps split output broad without a source", () => {
    const bezier = {
      id: "bezier",
      name: "B",
      type: "bezierCurve",
      activity: "visible",
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      startHandleAngleDeg: 0,
      startHandleLength: 1,
      intermediatePoints: [{
        id: "mid",
        point: { mode: "coordinate", x: 5, y: 5 },
        handleAngleDeg: 0,
        incomingHandleLength: 1,
        outgoingHandleLength: 1
      }],
      endPoint: { mode: "coordinate", x: 10, y: 0 },
      endHandleAngleDeg: 180,
      endHandleLength: 1
    } as CadElement;
    const split = {
      id: "split",
      name: "S",
      type: "splitLine",
      activity: "visible",
      baseLineId: "bezier",
      splitPoint: { mode: "coordinate", x: 5, y: 2 }
    } as CadElement;
    const target = numericGeometryStaticTargetForElementInDocument(bezier, [bezier, split]);
    expect(numericGeometryPropertySupportedByStaticTarget(target, "intermediatePoints[1].x")).toBe(true);
    expect(numericGeometryPropertySupportedByStaticTarget(
      numericGeometryStaticTargetForElementInDocument(split, [bezier, split]),
      "intermediatePoints[1].x"
    )).toBe(false);
  });

  it("does not expose removed tangent keys as canonical properties", () => {
    expect(numericGeometryPropertySupportedByStaticTarget(
      numericGeometryStaticTargetForConstruction("line", "segment"),
      "startTangentAngleDeg"
    )).toBe(false);
    expect(numericGeometryPropertySupportedByStaticTarget(
      numericGeometryStaticTargetForConstruction("curve", "bezier"),
      "endTangentAngleDeg"
    )).toBe(false);
  });
});
