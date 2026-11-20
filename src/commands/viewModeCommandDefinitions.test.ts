import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument, DEFAULT_SOURCE_LAYER_ID } from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { pickModeSessionForTarget } from "../model/pickModeSession";
import type { CanvasLayerPresentation } from "../model/canvasLayerPresentation";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT, initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { viewModeCommandDefinitions } from "./viewModeCommandDefinitions";

const pointElement = (id: string, x: number, y: number): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const pointGeometry = (elementId: string, x: number, y: number): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const lineElement = (
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  activity: CadElement["activity"] = "visible",
  parentGroupId?: string
): CadElement => ({
  id,
  name: id,
  type: "line",
  activity,
  ...(parentGroupId ? { parentGroupId } : {}),
  startPoint: { mode: "coordinate", ...start },
  endPoint: { mode: "coordinate", ...end }
});

const lineGeometry = (
  elementId: string,
  start: { x: number; y: number },
  end: { x: number; y: number }
): ComputedGeometry => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: null,
  endPointId: null,
  start: { kind: "point", elementId: `${elementId}:start`, name: `${elementId}:start`, ...start },
  end: { kind: "point", elementId: `${elementId}:end`, name: `${elementId}:end`, ...end },
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startAngleDeg: null,
  endAngleDeg: null,
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

const textElement = (id = "text", text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"): CadElement => ({
  id,
  name: id,
  type: "text",
  activity: "visible",
  text,
  anchor: { mode: "coordinate", x: 10, y: 20 },
  fontSize: 5
});

const textGeometry = (elementId = "text", text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"): ComputedGeometry => ({
  kind: "text",
  elementId,
  name: elementId,
  text,
  anchor: { kind: "point", elementId: `${elementId}-anchor`, name: `${elementId}-anchor`, x: 10, y: 20 },
  fontSize: 5
});

const evaluationFor = (
  geometry: ComputedGeometry[],
  visibleIds: string[],
  options: { evaluatedIds?: string[]; enabledIds?: string[]; conditionInactiveIds?: string[] } = {}
): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: [],
  effectiveVisibleElementIds: new Set(visibleIds),
  evaluatedElementIds: new Set(options.evaluatedIds ?? visibleIds),
  effectiveEnabledElementIds: new Set(options.enabledIds ?? visibleIds),
  conditionInactiveElementIds: new Set(options.conditionInactiveIds ?? [])
});

const emptySelection = {
  selectedElementId: null,
  selectedElementIds: [],
  selectionAnchorElementId: null
};

const prepareDocumentHistory = () => {
  const beforeSourceText = useCadDocumentStore.getState().sourceText;
  useCadDocumentStore.getState().commitText(`${beforeSourceText}\n// document history`, "test");
  publishTestCanvasSelectionEligibility();
  const secondElement = useCadDocumentStore.getState().elements[1];
  if (!secondElement) throw new Error("Expected the fixture document to contain two elements");
  return {
    beforeSourceText,
    changedSourceText: useCadDocumentStore.getState().sourceText,
    secondElementId: secondElement.id
  };
};

describe("fitDrawing", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("centers visible geometry with 32px edge padding", () => {
    const elements = [pointElement("left", 0, 0), pointElement("right", 100, 50)];
    useCadDocumentStore.setState({ elements });
    const evaluation = evaluationFor([
      pointGeometry("left", 0, 0),
      pointGeometry("right", 100, 50)
    ], ["left", "right"]);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 3.36,
      panX: -168,
      panY: 84
    });
  });

  it("fits root-only geometry from a Canvas presentation", () => {
    const elements = [lineElement("root-line", { x: 0, y: 0 }, { x: 100, y: 50 })];

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([lineGeometry("root-line", { x: 0, y: 0 }, { x: 100, y: 50 })], ["root-line"]),
      getCanvasFitDrawingPresentation: () => ({
        elements,
        visibilityProfiles: [],
        activeVisibilityProfileId: null
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 3.36, panX: -168, panY: 84 });
  });

  it("fits a non-imported Module instance as the inline-module control", () => {
    const source = `nui 1
module Mark() {
  line L = segment(start: (0, 0), end: (400, 200))
}
instance M = Mark()
`;
    const result = compileDslDocument(source);
    if (!result.document || !result.statementMap || !result.majorVersion) {
      throw new Error("inline Module control did not compile");
    }
    const compiled = result as LastGoodDslDocument;
    const elements = compiled.document.elements;
    const moduleLine = elements.find((element) => element.name === "L");
    if (!moduleLine) throw new Error("inline Module line was not materialized");
    const evaluation = evaluateElements(elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    }));
    expect(evaluation.computedGeometry.get(moduleLine.id)).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 400, y: 200 }
    });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasFitDrawingPresentation: () => ({
        elements,
        visibilityProfiles: compiled.document.visibilityProfiles,
        activeVisibilityProfileId: compiled.document.activeVisibilityProfileId
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 0.84, panX: -168, panY: 84 });
  });

  it("fits the visible union of root and external Module geometry", () => {
    const elements = [
      pointElement("root-left", -100, 100),
      lineElement("imported-line", { x: 0, y: 0 }, { x: 400, y: 200 })
    ];
    const evaluation = evaluationFor([
      pointGeometry("root-left", -100, 100),
      lineGeometry("imported-line", { x: 0, y: 0 }, { x: 400, y: 200 })
    ], ["root-left", "imported-line"]);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasFitDrawingPresentation: () => ({
        elements,
        visibilityProfiles: [],
        activeVisibilityProfileId: null,
        canvasLayerPresentation: {
          layers: [],
          hiddenLayerIds: new Set(),
          layerIdByElementId: new Map(),
          unmappedModuleDrawableIds: new Set()
        }
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    const viewport = useCadUiStore.getState().canvasViewport;
    expect(viewport.zoom).toBeCloseTo(0.672, 12);
    expect(viewport.panX).toBeCloseTo(-100.8, 12);
    expect(viewport.panY).toBeCloseTo(67.2, 12);
  });

  it("does not expand Fit bounds for a hidden Canvas layer", () => {
    const elements = [
      lineElement("root-line", { x: 0, y: 0 }, { x: 100, y: 0 }),
      lineElement("hidden-layer-line", { x: 1000, y: 0 }, { x: 1100, y: 0 })
    ];
    const evaluation = evaluationFor([
      lineGeometry("root-line", { x: 0, y: 0 }, { x: 100, y: 0 }),
      lineGeometry("hidden-layer-line", { x: 1000, y: 0 }, { x: 1100, y: 0 })
    ], ["root-line", "hidden-layer-line"]);
    const canvasLayerPresentation: CanvasLayerPresentation = {
      layers: [
        { id: DEFAULT_SOURCE_LAYER_ID, name: "default", label: "default", isDefault: true },
        { id: "canvas-layer-name:hidden", name: "hidden", label: "hidden", isDefault: false }
      ],
      hiddenLayerIds: new Set(["canvas-layer-name:hidden"]),
      layerIdByElementId: new Map([["hidden-layer-line", "canvas-layer-name:hidden"]]),
      unmappedModuleDrawableIds: new Set()
    };

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasFitDrawingPresentation: () => ({
        elements,
        visibilityProfiles: [],
        activeVisibilityProfileId: null,
        canvasLayerPresentation
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 3.36, panX: -168, panY: 0 });
  });

  it("does not expand Fit bounds for hidden or disabled Module geometry", () => {
    const visibleLine = lineElement("root-line", { x: 0, y: 0 }, { x: 100, y: 0 });
    const hiddenModuleLine = lineElement("hidden-module-line", { x: 1000, y: 0 }, { x: 1100, y: 0 }, "hidden");
    const disabledModuleLine = lineElement("disabled-module-line", { x: 2000, y: 0 }, { x: 2100, y: 0 }, "disabled");
    const elements = [visibleLine, hiddenModuleLine, disabledModuleLine];
    const evaluation = evaluationFor([
      lineGeometry("root-line", { x: 0, y: 0 }, { x: 100, y: 0 }),
      lineGeometry("hidden-module-line", { x: 1000, y: 0 }, { x: 1100, y: 0 }),
      lineGeometry("disabled-module-line", { x: 2000, y: 0 }, { x: 2100, y: 0 })
    ], ["root-line", "hidden-module-line", "disabled-module-line"], {
      enabledIds: ["root-line", "hidden-module-line"]
    });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasFitDrawingPresentation: () => ({
        elements,
        visibilityProfiles: [],
        activeVisibilityProfileId: null,
        canvasLayerPresentation: {
          layers: [],
          hiddenLayerIds: new Set(),
          layerIdByElementId: new Map(),
          unmappedModuleDrawableIds: new Set()
        }
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 3.36, panX: -168, panY: 0 });
  });

  it("does not expand Fit bounds for a Module hidden by the active Visibility Profile", () => {
    const rootLine = lineElement("root-line", { x: 0, y: 0 }, { x: 100, y: 0 });
    const visibilityGroup: CadElement = {
      id: "construction-group",
      name: "Construction",
      type: "group",
      activity: "visible",
      visibilityRoleIds: ["construction"]
    };
    const moduleLine = lineElement("profile-hidden-module-line", { x: 1000, y: 0 }, { x: 1100, y: 0 }, "visible", visibilityGroup.id);
    const elements = [rootLine, visibilityGroup, moduleLine];
    const evaluation = evaluationFor([
      lineGeometry("root-line", { x: 0, y: 0 }, { x: 100, y: 0 }),
      lineGeometry("profile-hidden-module-line", { x: 1000, y: 0 }, { x: 1100, y: 0 })
    ], ["root-line", "construction-group", "profile-hidden-module-line"]);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasFitDrawingPresentation: () => ({
        elements,
        visibilityProfiles: [{
          id: "pattern",
          name: "Pattern",
          defaultRoleVisible: true,
          roleVisibility: { construction: false }
        }],
        activeVisibilityProfileId: "pattern"
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 3.36, panX: -168, panY: 0 });
  });

  it("preserves Reference Pick candidate elements and evaluation for Fit", () => {
    useCadDocumentStore.setState({
      elements: [pointElement("document-left", -1000, -1000), pointElement("document-right", -900, -950)]
    });
    const candidateElements = [pointElement("pick-left", 0, 0), pointElement("pick-right", 100, 50)];
    const candidateEvaluation = evaluationFor([
      pointGeometry("pick-left", 0, 0),
      pointGeometry("pick-right", 100, 50)
    ], ["pick-left", "pick-right"]);
    const getCanvasFitDrawingPresentation = vi.fn(() => ({
      elements: candidateElements,
      visibilityProfiles: [],
      activeVisibilityProfileId: null
    }));

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: candidateEvaluation,
      getCanvasFitDrawingPresentation,
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(getCanvasFitDrawingPresentation).toHaveBeenCalledOnce();
    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 3.36, panX: -168, panY: 84 });
  });

  it("retains Document Store fallback for hosts such as Module Preview", () => {
    const elements = [pointElement("preview-left", 0, 0), pointElement("preview-right", 100, 50)];
    useCadDocumentStore.setState({ elements });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([
        pointGeometry("preview-left", 0, 0),
        pointGeometry("preview-right", 100, 50)
      ], ["preview-left", "preview-right"]),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 3.36, panX: -168, panY: 84 });
  });

  it("keeps Canvas Reset behavior unchanged", () => {
    useCadUiStore.getState().setCanvasViewport({ panX: 88, panY: -42, zoom: 6 });

    viewModeCommandDefinitions.resetCanvasView.run();

    expect(useCadUiStore.getState().canvasViewport).toEqual(DEFAULT_CANVAS_VIEWPORT);
  });

  it("prefers an explicit host presentation over unrelated global document elements", () => {
    useCadDocumentStore.setState({
      elements: [pointElement("global-left", -1000, -1000), pointElement("global-right", -900, -950)]
    });
    const hostElements = [pointElement("host-left", 0, 0), pointElement("host-right", 100, 50)];
    const getCanvasFitDrawingPresentation = vi.fn(() => ({
      elements: hostElements,
      visibilityProfiles: [],
      activeVisibilityProfileId: null
    }));

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([
        pointGeometry("host-left", 0, 0),
        pointGeometry("host-right", 100, 50)
      ], ["host-left", "host-right"]),
      getCanvasFitDrawingPresentation,
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(getCanvasFitDrawingPresentation).toHaveBeenCalledOnce();
    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 3.36,
      panX: -168,
      panY: 84
    });
  });

  it("no-ops when there is no visible drawing target or usable viewport", () => {
    const initialViewport = { panX: 12, panY: -8, zoom: 7 };
    useCadUiStore.getState().setCanvasViewport(initialViewport);
    const evaluation = evaluationFor([], []);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasViewportRect: () => ({ width: 64, height: 200 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual(initialViewport);
  });

  it("handles a zero-size target without producing non-finite zoom or pan", () => {
    const element = pointElement("point", 12, -8);
    useCadDocumentStore.setState({ elements: [element] });
    useCadUiStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: 7 });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([pointGeometry("point", 12, -8)], ["point"]),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ panX: -84, panY: -56, zoom: 7 });
  });

  it("fits a text-only drawing using measured width and 32px safe padding", () => {
    useCadDocumentStore.setState({ elements: [textElement()] });
    useCadUiStore.getState().setCanvasViewport({ panX: 12, panY: -8, zoom: 7 });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([textGeometry()], ["text"]),
      getCanvasFitDrawingPresentation: () => ({
        elements: [textElement()],
        visibilityProfiles: [],
        activeVisibilityProfileId: null
      }),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect),
      measureCanvasTextWidth: (line, fontSize) => {
        expect(line).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        expect(fontSize).toBe(5);
        return 40;
      }
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({
      panX: -252,
      panY: 147,
      zoom: 8.4
    });
  });

  it.each([null, Number.NaN, -1])("does not change the viewport when text measurement returns %s", (measuredWidth) => {
    const initialViewport = { panX: 12, panY: -8, zoom: 7 };
    useCadDocumentStore.setState({ elements: [textElement()] });
    useCadUiStore.getState().setCanvasViewport(initialViewport);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([textGeometry()], ["text"]),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect),
      measureCanvasTextWidth: () => measuredWidth
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual(initialViewport);
  });
});

describe("Canvas identity-label visibility commands", () => {
  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
  });

  it("uses independent Point Names and Geometry Names defaults and keeps the alias on Point Names", () => {
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(false);
    expect(useCadUiStore.getState().showCanvasPoints).toBe(true);

    viewModeCommandDefinitions.toggleCanvasGeometryNames.run();
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(true);

    viewModeCommandDefinitions.toggleCanvasElementNames.run();
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(false);
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasPoints).toBe(true);
  });

  it("toggles path direction arrows independently and starts with them disabled", () => {
    expect(useCadUiStore.getState().showCanvasDirectionArrows).toBe(false);
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(false);
    expect(useCadUiStore.getState().showCanvasPoints).toBe(true);

    viewModeCommandDefinitions.toggleCanvasDirectionArrows.run();
    expect(useCadUiStore.getState().showCanvasDirectionArrows).toBe(true);
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(false);
    expect(useCadUiStore.getState().showCanvasPoints).toBe(true);

    viewModeCommandDefinitions.toggleCanvasDirectionArrows.run();
    expect(useCadUiStore.getState().showCanvasDirectionArrows).toBe(false);
  });

  it("uses the exact English labels shared with the VS Code Ribbon", () => {
    expect(viewModeCommandDefinitions.toggleCanvasPointNames.label).toBe("Toggle Point Names");
    expect(viewModeCommandDefinitions.toggleCanvasGeometryNames.label).toBe("Toggle Geometry Names");
    expect(viewModeCommandDefinitions.toggleCanvasDirectionArrows.label).toBe("Toggle Canvas Direction Arrows");
    expect(viewModeCommandDefinitions.toggleCanvasElementNames.label)
      .toBe("Toggle Canvas Element Names (Legacy)");
  });
});

describe("Canvas history fallback commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("consumes local Canvas selection history before document history for Undo", () => {
    const { beforeSourceText, changedSourceText, secondElementId } = prepareDocumentHistory();
    useCadUiStore.getState().setSelectedElementId(secondElementId);
    useCadDocumentStore.getState().recordCanvasSelection(emptySelection);
    const finalizeCanvasInteraction = vi.fn();

    viewModeCommandDefinitions.undo.run({ finalizeCanvasInteraction });

    expect(finalizeCanvasInteraction).toHaveBeenCalledOnce();
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).toBe(changedSourceText);
    expect(useCadDocumentStore.getState().past).toHaveLength(1);

    viewModeCommandDefinitions.undo.run(undefined);

    expect(useCadDocumentStore.getState().sourceText).toBe(beforeSourceText);
  });

  it("consumes local Canvas selection history before document history for Redo", () => {
    const { beforeSourceText, changedSourceText, secondElementId } = prepareDocumentHistory();
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(beforeSourceText);

    publishTestCanvasSelectionEligibility();
    useCadUiStore.getState().setSelectedElementId(secondElementId);
    useCadDocumentStore.getState().recordCanvasSelection(emptySelection);
    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    const finalizeCanvasInteraction = vi.fn();

    viewModeCommandDefinitions.redo.run({ finalizeCanvasInteraction });

    expect(finalizeCanvasInteraction).toHaveBeenCalledOnce();
    expect(useCadUiStore.getState().selectedElementId).toBe(secondElementId);
    expect(useCadDocumentStore.getState().sourceText).toBe(beforeSourceText);
    expect(useCadDocumentStore.getState().future).toHaveLength(1);

    viewModeCommandDefinitions.redo.run(undefined);

    expect(useCadDocumentStore.getState().sourceText).toBe(changedSourceText);
  });

  it("suppresses Canvas Undo and Redo while Pick is active", () => {
    const target = { elementId: "target", parameterKey: "point" };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target)
    });
    const canvasHistory = vi.fn();
    const finalizeCanvasInteraction = vi.fn();

    expect(viewModeCommandDefinitions.undo.run({ canvasHistory, finalizeCanvasInteraction })).toBe(false);
    expect(viewModeCommandDefinitions.redo.run({ canvasHistory, finalizeCanvasInteraction })).toBe(false);
    expect(canvasHistory).not.toHaveBeenCalled();
    expect(finalizeCanvasInteraction).not.toHaveBeenCalled();
  });
});
