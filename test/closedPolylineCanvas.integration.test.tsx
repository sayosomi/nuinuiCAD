import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { renderCanvasGeometry } from "../src/components/canvasRenderer";
import { DEFAULT_CANVAS_GRID_SETTINGS } from "../src/components/canvasGrid";
import { hitTestCanvasGeometry } from "../src/components/DrawingCanvasHitTest";
import { useCanvasOverlayData } from "../src/components/useCanvasOverlayData";
import { worldToScreen } from "../src/components/canvasViewport";
import { projectCanvasLayerPresentation, canvasLayerVisibilityKeyForName } from "../src/model/canvasLayerPresentation";
import { createRustStdioParityClient, fixtureFromSource, optionsFor } from "./evaluationParitySupport";

const readFixture = (name: string) => readFileSync(join(process.cwd(), "test/fixtures/evaluation", name), "utf8");
const shortSource = readFixture("nui1-issue-1583-closed-polyline.nui");
const handSource = readFixture("nui1-issue-1583-hand-polyline.nui");
const vertices = [
  { x: Number("138.87235478117314"), y: -34.11916140334289 },
  { x: 161.4297012951825, y: -34.11916140334289 },
  { x: 161.4297012951825, y: -66.44220323023001 },
  { x: Number("138.87235478117314"), y: -66.44220323023001 }
];
const pointNames = ["left_top", "right_top", "right_bottom", "left_bottom"];
const comparator = pointNames.map((name, index) =>
  `    line border_${index} in @boxLayer = segment(start: @${name}, end: @${pointNames[(index + 1) % 4]})`
).join("\n");
const comparatorSource = shortSource.replace(/ {4}line border in[\s\S]+? {4}\)/, comparator);
const viewportSize = { width: 500, height: 400 };
const canvasViewport = { panX: 0, panY: 0, zoom: 1 };

const expectPoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
};

describe("Issue 1583 production Rust and Canvas reproduction controls", () => {
  let rust: ReturnType<typeof createRustStdioParityClient>;
  beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 60000);
  afterAll(() => { rust?.dispose(); });

  it.each([
    { name: "four-point nested groups", source: shortSource, layerName: "boxLayer", closed: true, segments: 4 },
    { name: "parent points, record values and Bezier", source: handSource, layerName: "box_layer", closed: true, segments: 4 },
    { name: "open polyline control", source: shortSource.replace("closed: true", "closed: false"), layerName: "boxLayer", closed: false, segments: 3 },
    { name: "four-segment comparator", source: comparatorSource, layerName: "boxLayer", closed: false, segments: 4 }
  ])("$name preserves evaluated boundaries, draw, hit testing and layer toggles", async ({ source, layerName, closed, segments }) => {
    const fixture = fixtureFromSource(source);
    const compiledDocument = fixture.compiled!.doc;
    expect(fixture.compiled!.diagnostics).toEqual([]);
    const elements = fixture.elements;
    const borders = elements.filter(element => element.name.startsWith("border"));
    const pointIds = pointNames.map(name => elements.find(element => element.name === name)!.id);
    const evaluation = evaluationPayloadToResult(await rust.evaluate(elements, optionsFor(fixture)));
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.warnings).toEqual([]);
    const evaluatedSegments = borders.flatMap(element => {
      const geometry = evaluation.computedGeometry.get(element.id)!;
      expect(geometry.elementId).toBe(element.id);
      expect(geometry.name).toBe(element.name);
      expect(evaluation.effectiveVisibleElementIds!.has(element.id)).toBe(true);
      if (geometry.kind === "line") return [geometry];
      expect(geometry.kind).toBe("polyline");
      if (geometry.kind !== "polyline") throw new Error("expected polyline geometry");
      expect(geometry.closed).toBe(closed);
      expect(geometry.segments).toHaveLength(segments);
      return geometry.segments;
    });
    expect(evaluatedSegments).toHaveLength(segments);
    evaluatedSegments.forEach((segment, index) => {
      expect(segment.kind).toBe("line");
      expectPoint(segment.start, vertices[index]!);
      expectPoint(segment.end, vertices[(index + 1) % 4]!);
      expect(segment.start.elementId).toBe(pointIds[index]);
      expect(segment.end.elementId).toBe(pointIds[(index + 1) % 4]);
    });
    const layerId = canvasLayerVisibilityKeyForName(layerName);
    const presentation = (hidden: boolean) => projectCanvasLayerPresentation({
      compiledDocument, elements, evaluation, hiddenLayerIds: new Set(hidden ? [layerId] : [])
    });
    const { result, rerender, unmount } = renderHook(({ hidden }) => useCanvasOverlayData({
      compiledDocument, evaluation, elements, selectedElementId: borders[0]!.id,
      pointPickCandidates: [], viewportSize, canvasViewport,
      visibilityProfiles: [], activeVisibilityProfileId: null,
      canvasLayerPresentation: presentation(hidden), resolveImageSourceUrl: path => path
    }), { initialProps: { hidden: false } });
    for (const hidden of [false, true, false]) {
      rerender({ hidden });
      const overlay = result.current;
      for (const border of borders) {
        expect(presentation(hidden).layerIdByElementId.get(border.id)).toBe(layerId);
        expect(overlay.visibleElementIds.has(border.id)).toBe(!hidden);
        expect(overlay.selectionEligibleElementIds.has(border.id)).toBe(!hidden);
      }
      const borderIds = new Set(borders.map(element => element.id));
      const polylines = overlay.polylines.filter(geometry => borderIds.has(geometry.elementId));
      const lines = overlay.lines.filter(geometry => borderIds.has(geometry.elementId));
      const ctx = {
        clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
        lineTo: vi.fn(), setLineDash: vi.fn(), stroke: vi.fn()
      } as unknown as CanvasRenderingContext2D;
      renderCanvasGeometry({
        ctx, size: viewportSize, viewport: canvasViewport,
        lines, arcs: [], curves: [], offsetLines: [], polylines, points: [],
        visibleElementIds: overlay.visibleElementIds,
        selectedElementIdSet: new Set([borders[0]!.id]), selectedElementId: borders[0]!.id,
        effectiveDrawingModifierStrokes: evaluation.effectiveDrawingModifierStrokes,
        canvasGridSettings: { ...DEFAULT_CANVAS_GRID_SETTINGS, enabled: false },
        showCanvasPoints: false, isPointPickActive: false,
        isLinePickActive: false, isNumericReferencePickActive: false
      });
      expect(ctx.lineTo).toHaveBeenCalledTimes(hidden ? 0 : segments);
      evaluatedSegments.forEach((segment, index) => {
        const screen = worldToScreen({
          x: (segment.start.x + segment.end.x) / 2,
          y: (segment.start.y + segment.end.y) / 2
        }, viewportSize, canvasViewport);
        const hit = hitTestCanvasGeometry({
          screen, points: [],
          lines: overlay.overlayLines.filter(item => borderIds.has(item.line.elementId)),
          polylines: overlay.overlayPolylines.filter(item => borderIds.has(item.polyline.elementId))
        });
        expect(hit).toBe(hidden ? null : borders.length === 1 ? borders[0]!.id : borders[index]!.id);
      });
    }
    unmount();
    // Canvas toggles must leave the authoritative evaluated geometry intact.
    expect(borders.every(border => evaluation.computedGeometry.has(border.id))).toBe(true);
  }, 60000);

  it("rejects an unresolved explicit layer before producing Canvas geometry", () => {
    expect(() => fixtureFromSource(shortSource.replace("layer boxLayer", "")))
      .toThrow("layer-membership-undefined");
  });
});
