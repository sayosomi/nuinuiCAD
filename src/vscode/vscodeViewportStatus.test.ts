import { describe, expect, it } from "vitest";
import { vscodeCanvasStatusFields } from "./vscodeCanvasRibbonStatus";
import {
  formatVscodeViewportCoordinate,
  formatVscodeViewportZoom,
  vscodeViewportCoordinateFields,
  vscodeViewportCoordinatesPresentationFor,
  vscodeViewportStatusFields,
  vscodeViewportZoomPresentationFor
} from "./vscodeViewportStatus";

describe("VS Code viewport status", () => {
  it("formats zoom with integer-percent Canvas semantics and coordinates to one decimal", () => {
    expect(formatVscodeViewportZoom(1.234)).toBe("123%");
    expect(formatVscodeViewportCoordinate(12.345)).toBe("12.3");
    expect(formatVscodeViewportCoordinate(-6.75)).toBe("-6.8");
    expect(formatVscodeViewportCoordinate(null)).toBe("—");
  });

  it("builds the shared ZOOM/X/Y fields and keeps Canvas on that owner", () => {
    const viewport = { panX: 20, panY: -10, zoom: 2 };
    const pointer = { x: -35.04, y: 20.06 };
    const expected = [
      { label: "ZOOM", value: "200%" },
      { label: "X", value: "-35.0" },
      { label: "Y", value: "20.1" }
    ];

    expect(vscodeViewportStatusFields(viewport, pointer)).toEqual(expected);
    expect(vscodeCanvasStatusFields(viewport, pointer)).toEqual(expected);
    expect(vscodeViewportStatusFields(viewport, null)).toEqual([
      { label: "ZOOM", value: "200%" },
      { label: "X", value: "—" },
      { label: "Y", value: "—" }
    ]);
  });

  it("builds coordinate-only X/Y fields and presentation without a zoom field", () => {
    const pointer = { x: -35.04, y: 20.06 };
    const expected = [
      { label: "X", value: "-35.0" },
      { label: "Y", value: "20.1" }
    ];

    expect(vscodeViewportCoordinateFields(pointer)).toEqual(expected);
    expect(vscodeViewportCoordinatesPresentationFor(
      "coordinates",
      pointer,
      "Output Preview status",
      "Current Output Preview pointer position."
    )).toMatchObject({
      id: "coordinates",
      type: "value",
      label: "Output Preview status",
      description: "Current Output Preview pointer position.",
      fields: expected
    });
    expect(vscodeViewportCoordinatesPresentationFor("coordinates", null).fields).toEqual([
      { label: "X", value: "—" },
      { label: "Y", value: "—" }
    ]);
  });

  it("builds a compact zoom-only presentation from the shared formatter", () => {
    expect(vscodeViewportZoomPresentationFor(
      "zoom",
      { zoom: 1.1 },
      "Canvas zoom",
      "Current Canvas zoom."
    )).toMatchObject({
      id: "zoom",
      type: "value",
      label: "Canvas zoom",
      fields: [{ label: "", value: "110%" }]
    });
  });
});
