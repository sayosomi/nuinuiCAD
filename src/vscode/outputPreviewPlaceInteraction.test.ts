import { describe, expect, it } from "vitest";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import {
  normalizedRangeForOutputPlaceValue,
  outputPreviewPlaceCandidatesAtScreen,
  outputPreviewPlaceDragReason,
  outputPreviewPlaceHandlesFor,
  outputPreviewPlacePropertyRows
} from "./outputPreviewPlaceInteraction";

const projection = ({
  placeId,
  x,
  y,
  draggable = true
}: {
  placeId: string;
  x: number;
  y: number;
  draggable?: boolean;
}) => ({
  placeId,
  sourceRevision: 3,
  layoutId: "layout",
  layoutName: "Layout",
  groupId: `group-${placeId}`,
  groupName: `Group ${placeId}`,
  transformedOrigin: { x, y },
  drawables: [],
  statementRange: { from: 2, to: 40 },
  authored: {
    group: {
      text: `@Group${placeId}`,
      sourceSpan: { sourceRevision: 3, segments: [{ from: 2, to: 9 }] },
      references: [],
      targetRange: { from: 50, to: 56 }
    },
    at: {
      text: draggable ? "(10, 20)" : "(@x, 20)",
      sourceSpan: { sourceRevision: 3, segments: [{ from: 12, to: 20 }] },
      references: draggable ? [] : [{ sourceRange: { from: 13, to: 14 }, targetRange: { from: 60, to: 61 } }],
      x: null,
      y: null
    }
  },
  dragability: draggable
    ? { draggable: true, literals: { x: 10, y: 20 } }
    : {
        draggable: false,
        reason: {
          code: "at-not-direct-finite-numeric-literals",
          issues: [{ axis: "x", reason: "not-direct-numeric-literal" }]
        }
      }
}) as unknown as OutputPlaceProjection;

describe("Output Preview place interaction model", () => {
  it("projects handle positions and exposes grab only for draggable places", () => {
    const handles = outputPreviewPlaceHandlesFor(
      [projection({ placeId: "a", x: 10, y: 20 }), projection({ placeId: "b", x: 0, y: 0, draggable: false })],
      { width: 400, height: 300 },
      { panX: 5, panY: -5, zoom: 2 }
    );

    expect(handles.map(({ placeId, screen, cursor }) => ({ placeId, screen, cursor }))).toEqual([
      { placeId: "a", screen: { x: 225, y: 105 }, cursor: "grab" },
      { placeId: "b", screen: { x: 205, y: 145 }, cursor: "default" }
    ]);
  });

  it("detects overlapping handle hit candidates in stable projection order", () => {
    const handles = outputPreviewPlaceHandlesFor(
      [
        projection({ placeId: "a", x: 0, y: 0 }),
        projection({ placeId: "b", x: 5, y: 0 }),
        projection({ placeId: "c", x: 30, y: 0 })
      ],
      { width: 400, height: 300 },
      { panX: 0, panY: 0, zoom: 1 }
    );

    expect(outputPreviewPlaceCandidatesAtScreen(handles, { x: 200, y: 150 }).map(({ placeId }) => placeId)).toEqual(["a", "b"]);
  });

  it("fails closed for non-contiguous authored spans and preserves exact reference navigation", () => {
    const sourceText = "............(@x, 20).......................................x";
    const nonDraggable = projection({ placeId: "a", x: 0, y: 0, draggable: false });
    const rows = outputPreviewPlacePropertyRows(nonDraggable, sourceText);

    expect(rows[0]).toMatchObject({
      key: "at",
      sourceRange: { from: 12, to: 20 },
      referenceTargets: [{ label: "@x", range: { from: 60, to: 61 } }]
    });
    expect(outputPreviewPlaceDragReason(nonDraggable)).toContain("X in at");

    const value = {
      text: "multi",
      sourceSpan: { sourceRevision: 3, segments: [{ from: 1, to: 2 }, { from: 4, to: 5 }] },
      references: []
    };
    expect(normalizedRangeForOutputPlaceValue(value, 3, 10)).toBeNull();
  });
});
