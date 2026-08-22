import { describe, expect, it } from "vitest";
import type { CanvasGeometryHitCandidate } from "../components/DrawingCanvasHitTest";
import type { ReferencePickCandidate } from "./referencePickCandidates";
import {
  filterReferencePickGeometryHits,
  hitTestReferencePickPoints
} from "./referencePickHitTest";

const pointCandidate = (elementId: string, x: number, y: number): ReferencePickCandidate => ({
  elementId,
  actualGeometryInterface: "point",
  options: [{
    kind: "point",
    label: elementId,
    anchor: { mode: "reference", pointId: elementId },
    point: { kind: "point", elementId, name: elementId, x, y },
    reference: { base: elementId }
  }]
});

const geometryCandidate = (elementId: string): ReferencePickCandidate => ({
  elementId,
  actualGeometryInterface: "path",
  options: [{ kind: "geometry", label: elementId, reference: { base: elementId } }]
});

describe("referencePickHitTest", () => {
  it("reuses point-pick screen distance and keeps its topmost ordering", () => {
    const candidates = [pointCandidate("first", 10, 10), pointCandidate("second", 11, 10)];
    const hits = hitTestReferencePickPoints({
      screen: { x: 10, y: 10 },
      candidates,
      worldToScreen: (point) => point,
      hitRadiusPx: 4
    });

    expect(hits.map((hit) => hit.candidateElementId)).toEqual(["second", "first"]);
  });

  it("preserves Canvas geometry-hit ranking while removing non-candidates", () => {
    const hits: CanvasGeometryHitCandidate[] = [
      { elementId: "curve", kind: "bezierCurve", name: "curve" },
      { elementId: "line", kind: "line", name: "line" },
      { elementId: "image", kind: "image", name: "image" }
    ];
    expect(filterReferencePickGeometryHits(
      hits,
      [geometryCandidate("line"), geometryCandidate("curve")]
    )).toEqual(hits.slice(0, 2));
  });
});
