import { describe, expect, it } from "vitest";

import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ComputedPolyline } from "../types/geometry";
import { isFillEligibleClosedPath } from "./linePaths";
import { evaluateElements } from "./evaluate";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { evaluateElementsReference } from "./evaluationEngine";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const point = (id: string, x: number, y: number): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const polyline = (id: string, points: string[], closed: boolean): CadElement => ({
  id,
  name: id,
  type: "polyline",
  activity: "visible",
  points: points.map(referenceAnchor),
  closed
});

const fillModifier = {
  name: "Fill",
  fill: { kind: "fixed" as const, hex: "#123456" },
  fillOpacity: 0.4
};

describe("closed path fill semantics", () => {
  it("uses the semantic closed flag instead of endpoint coincidence", () => {
    const result = evaluateElements([
      point("a", 0, 0),
      point("b", 10, 0),
      point("c", 10, 10),
      { ...polyline("open", ["a", "b", "a"], false), modifierNames: ["Fill"] },
      { ...polyline("closed", ["a", "b", "c"], true), modifierNames: ["Fill"] }
    ], {
      drawingModifiers: [fillModifier]
    });
    const open = result.computedGeometry.get("open");
    const closed = result.computedGeometry.get("closed");

    expect(isFillEligibleClosedPath(open)).toBe(false);
    expect(isFillEligibleClosedPath(closed)).toBe(true);
    expect(result.effectiveDrawingModifierResolutions?.get("open")?.fill.value).toEqual(fillModifier.fill);
    expect(result.warnings).toEqual([]);
  });

  it("keeps a self-intersecting path and stroke while warning and suppressing fill later", () => {
    const result = evaluateElements([
      point("a", 0, 0),
      point("b", 10, 10),
      point("c", 0, 10),
      point("d", 10, 0),
      {
        ...polyline("crossing", ["a", "b", "c", "d"], true),
        modifierNames: ["Fill"]
      }
    ], {
      drawingModifiers: [fillModifier]
    });

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("crossing")?.kind).toBe("polyline");
    expect(result.effectiveDrawingModifierStrokes?.get("crossing")).toBeDefined();
    expect(result.warnings).toEqual([
      expect.objectContaining({ elementId: "crossing", message: expect.stringContaining("自己交差") })
    ]);
  });

  it("does not warn for a zero-area path with no traversed boundary", () => {
    const result = evaluateElements([
      point("a", 0, 0),
      {
        ...polyline("zero", ["a", "a", "a"], true),
        modifierNames: ["Fill"]
      }
    ], {
      drawingModifiers: [fillModifier]
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect((result.computedGeometry.get("zero") as ComputedPolyline).closed).toBe(true);
  });

  it("keeps fill eligibility limited to closed join, offset, and polyline geometry", () => {
    const compiled = compileFreshCanonicalText([
      "nui 1",
      "style Fill {",
      "  fill: #123456,",
      "  fillOpacity: 0.4,",
      "}",
      "style Hidden {",
      "  visible: false,",
      "}",
      "group G {",
      "  line A [Hidden] = segment(start: (0, 0), end: (10, 0))",
      "  line B [Hidden] = segment(start: (10, 0), end: (10, 10))",
      "  line C [Hidden] = segment(start: (10, 10), end: (0, 10))",
      "  line D [Hidden] = segment(start: (0, 10), end: (0, 0))",
      "  line Joined [Fill] = join(paths: [A, B, C, D], closed: true)",
      "  line Poly [Fill] = polyline(points: [(20, 0), (30, 0), (30, 10)], closed: true)",
      "  line Base [Hidden] = polyline(points: [(40, 0), (50, 0), (50, 10)], closed: true)",
      "  line Offset [Fill] = offset(sources: [Base], distance: 1, side: @right, closed: true, suppressTrimWarnings: false)",
      "  line Open [Fill] = polyline(points: [(60, 0), (70, 0), (70, 10)], closed: false)",
      "  line Ordinary [Fill] = segment(start: (80, 0), end: (90, 0))",
      "}"
    ].join("\n"));
    if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
    const evaluation = evaluateElementsReference(
      compiled.doc.document.elements,
      buildEvaluationOptions({
        compiledDocument: compiled.doc,
        evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex
      })
    );
    const element = (name: string) => {
      const found = compiled.doc.document.elements.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`missing element ${name}`);
      return found;
    };

    for (const name of ["Joined", "Poly", "Offset"]) {
      expect(isFillEligibleClosedPath(evaluation.computedGeometry.get(element(name).id))).toBe(true);
      expect(evaluation.effectiveDrawingModifierResolutions?.get(element(name).id)?.fill.value).toEqual({
        kind: "fixed",
        hex: "#123456"
      });
      expect(evaluation.effectiveDrawingModifierResolutions?.get(element(name).id)?.fillOpacity.value).toBe(0.4);
    }
    expect(isFillEligibleClosedPath(evaluation.computedGeometry.get(element("Open").id))).toBe(false);
    expect(isFillEligibleClosedPath(evaluation.computedGeometry.get(element("Ordinary").id))).toBe(false);
    expect(evaluation.warnings).toEqual([]);
  });
});
