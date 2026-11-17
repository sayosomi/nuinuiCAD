import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import {
  compileDslDocument,
  parseDsl,
  type CanvasModuleMaterialization,
  type ModuleMaterialization
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { pickModeSessionForTarget } from "../model/pickModeSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { documentIdFromHost } from "@nuinuicad/nui-language/workspace";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import type { VscodeCanvasRibbonPositions } from "./vscodeCanvasRibbonConfig";
import { canvasLayerSourceDocumentFor, canvasLayerVisibleElementIds } from "../model/canvasLayerPresentation";
import type { VscodeMultiDocumentCanvasRuntimePresentation } from "./multiDocumentRuntimeTransport";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn(),
  commitCanvasRectangleSelection: vi.fn(),
  hostAdapter: null as CanvasHostAdapter | null,
  canvasFocusRef: null as { current: HTMLDivElement | null } | null,
  nativePointerBoundaryFallback: false
}));

vi.mock("../commands/commands", () => ({
  dispatchCommand: mocks.dispatchCommand
}));

vi.mock("../commands/canvasRectangleSelectionCommands", () => ({
  commitCanvasRectangleSelection: mocks.commitCanvasRectangleSelection
}));

vi.mock("../components/DrawingCanvas", async () => {
  const React = await import("react");
  return {
    DrawingCanvas: React.forwardRef((_props: {
      hostAdapter: CanvasHostAdapter;
      canvasFocusRef: { current: HTMLDivElement | null };
      nativePointerBoundaryFallback?: boolean;
    }, ref) => {
      void ref;
      const props = _props;
      mocks.hostAdapter = props.hostAdapter;
      mocks.canvasFocusRef = props.canvasFocusRef;
      mocks.nativePointerBoundaryFallback = props.nativePointerBoundaryFallback ?? false;
      return React.createElement("div", {
        "data-testid": "drawing-canvas",
        ref: props.canvasFocusRef,
        "data-vscode-context": props.hostAdapter.canvasContextMenuData
      });
    })
  };
});

afterEach(() => {
  mocks.dispatchCommand.mockReset();
  mocks.commitCanvasRectangleSelection.mockReset();
  mocks.hostAdapter = null;
  mocks.canvasFocusRef = null;
  mocks.nativePointerBoundaryFallback = false;
  useCadUiStore.setState(initialCadUiState());
  useCadDocumentStore.setState(initialCadDocumentState());
  vi.restoreAllMocks();
});

const makeEvaluationState = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationRequestRevision: number,
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation,
  evaluationRevision: evaluationRequestRevision,
  evaluationRequestRevision,
  mode: "rust" as EvaluationEngineState["mode"],
  source: "rust",
  status: "evaluating",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const compileMaterializedModuleDocument = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `live:${index}`] as const))
  });
};

const domRect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  toJSON: () => ({})
});

const renderCanvas = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationState: EvaluationEngineState | undefined,
  postCanonicalSourceText = vi.fn(),
  postCanvasPointerPosition = vi.fn(),
  canvasGridSettings?: { enabled: boolean; spacingMm: number; majorEvery: number; snapEnabled: boolean },
  onToggleCanvasGridSnap = vi.fn(),
  onToggleCanvasGrid = vi.fn(),
  onConfigureCanvasGrid = vi.fn(),
  canvasRibbonPositions: VscodeCanvasRibbonPositions = {}
) => {
  const view = render(
    <VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={evaluationState}
      canvasFocusRef={createRef()}
      postCanonicalSourceText={postCanonicalSourceText}
      postCanvasPointerPosition={postCanvasPointerPosition}
      currentReferencePickAuthorityFor={() => null}
      canvasRibbonPositions={canvasRibbonPositions}
      onToggleCanvasGrid={onToggleCanvasGrid}
      onConfigureCanvasGrid={onConfigureCanvasGrid}
      onToggleCanvasGridSnap={onToggleCanvasGridSnap}
      canvasGridSettings={canvasGridSettings}
    />
  );
  const adapter = mocks.hostAdapter;
  if (!adapter) throw new Error("Canvas host adapter was not captured");
  return { view, adapter, postCanonicalSourceText };
};

describe("VSCodeDrawingCanvas adapter", () => {
  it("pins image URL authority with last-good geometry during source errors", () => {
    const source = 'nui 1\nimage Ref = image(source: "a.png", origin: (0, 0))';
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const revision = useCadDocumentStore.getState().compiledDocumentRevision;
    const props = {
      evaluation, evaluationState: makeEvaluationState(evaluation, revision, { status: "ready" }),
      canvasFocusRef: createRef<HTMLDivElement>(), postCanonicalSourceText: vi.fn(), currentReferencePickAuthorityFor: () => null
    };
    const view = render(<VSCodeDrawingCanvas {...props} imageResources={{ "a.png": "https://resource/last-good.png" }} />);
    expect(mocks.hostAdapter?.resolveImageSourceUrl("a.png")).toBe("https://resource/last-good.png");
    act(() => useCadDocumentStore.getState().commitText(source + "\nimage Broken = image(", "editor", { cursorLineAtBurstStart: null }));
    view.rerender(<VSCodeDrawingCanvas {...props} imageResources={{ "a.png": "https://resource/new.png" }} />);
    expect(mocks.hostAdapter?.resolveImageSourceUrl("a.png")).toBe("https://resource/last-good.png");
  });

  it("uses host image URLs and fails closed for unmapped paths", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const props = { evaluation, canvasFocusRef: createRef<HTMLDivElement>(), postCanonicalSourceText: vi.fn(), currentReferencePickAuthorityFor: () => null };
    const view = render(<VSCodeDrawingCanvas {...props} imageResources={{ "a.png": "https://resource/a.png" }} />);
    expect(mocks.hostAdapter?.resolveImageSourceUrl("a.png")).toBe("https://resource/a.png");
    expect(mocks.hostAdapter?.resolveImageSourceUrl("../unapproved.png")).toBe("data:,");
    view.rerender(<VSCodeDrawingCanvas {...props} imageResources={{ "a.png": "https://other/a.png" }} />);
    expect(mocks.hostAdapter?.resolveImageSourceUrl("a.png")).toBe("https://other/a.png");
  });

  it("passes the measured Canvas mode chrome inset to initial Layers placement", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains("canvas-viewport")) return domRect(0, 0, 400, 300);
      if (this.classList.contains("canvas-layer-panel")) {
        return domRect(
          Number.parseFloat(this.style.left) || 0,
          Number.parseFloat(this.style.top) || 0,
          160,
          120
        );
      }
      return domRect(0, 0, 0, 0);
    });
    const overlay = adapter.renderHostOverlay?.({ width: 400, height: 300 }, { canvasModeChromeHeight: 52 });
    if (!overlay) throw new Error("Canvas UI overlay was not rendered");
    const view = render(<div className="canvas-viewport">{overlay}</div>);

    expect(view.container.querySelector<HTMLElement>(".canvas-layer-panel")?.style.top).toBe("56px");
    getBoundingClientRect.mockRestore();
  });

  it("mounts Fixture A with the graph root Layer despite a fatal standalone compile and stale last-good doc", () => {
    const rootDocumentId = "file:///workspace/patterns/f12-mini.nui";
    const importedDocumentId = documentIdFromHost("file:///workspace/modules/layer_probe.nui");
    const rootGraphDocument = compileMaterializedModuleDocument("nui 1\n\nlayer seam_layer\n");
    const importedGraphDocument = compileMaterializedModuleDocument(`nui 1

export module Probe(x: number) {
  point marker = coordinate(x: @x, y: 0)
}
`);
    const rootLayerSource = canvasLayerSourceDocumentFor({
      documentId: rootDocumentId,
      sourceLexicalNamespace: rootGraphDocument.sourceLexicalNamespace!,
      statements: rootGraphDocument.statements,
      document: rootGraphDocument.document
    });
    const importedMarkerIndex = importedGraphDocument.statements.findIndex((statement) =>
      statement.kind === "element" && statement.name === "marker"
    );
    const importedMarkerStatementId = `live:${importedMarkerIndex}`;
    const importedLayerSource = canvasLayerSourceDocumentFor({
      documentId: importedDocumentId,
      sourceLexicalNamespace: importedGraphDocument.sourceLexicalNamespace!,
      statements: importedGraphDocument.statements
    });
    const importedMarker = {
      id: "runtime-imported-marker",
      name: "marker",
      type: "freePoint" as const,
      activity: "visible" as const,
      x: 10,
      y: 0
    };
    const moduleDefinitionIndex = importedGraphDocument.statements.findIndex((statement) => statement.kind === "moduleDefinition");
    const moduleOrigin = {
      kind: "moduleBody" as const,
      instancePath: ["fixture-instance"],
      sourceDocumentId: importedDocumentId,
      sourceStatementId: importedMarkerStatementId,
      sourceStatementIndex: importedMarkerIndex,
      moduleDefinitionStatementId: `live:${moduleDefinitionIndex}`,
      callerModuleDefinitionStatementId: null
    };
    const moduleMaterialization: CanvasModuleMaterialization = {
      instanceBaseGeometrySnapshots: [],
      originByRuntimeElementId: new Map([[importedMarker.id, moduleOrigin]])
    };
    const revealMaterialization = {
      executionStatements: [],
      sourceExecutionUnits: [],
      elementIdBySourceStatementIndex: new Map(),
      sourceExecutionPositionByRuntimeElementId: new Map(),
      originByRuntimeElementId: new Map([[importedMarker.id, moduleOrigin]]),
      runtimeIdentityByElementId: new Map(),
      instanceBaseGeometrySnapshots: [],
      evaluationLimitIndex: undefined
    } satisfies ModuleMaterialization;
    const graphPresentation = {
      graphRevision: 42,
      rootDocumentId,
      rootSourceRevision: 7,
      elements: [importedMarker],
      evaluationLimitIndex: undefined,
      visibilityProfiles: rootGraphDocument.document!.visibilityProfiles,
      activeVisibilityProfileId: rootGraphDocument.document!.activeVisibilityProfileId,
      moduleMaterialization,
      revealMaterialization,
      layerSourceDocuments: [rootLayerSource, importedLayerSource]
    } satisfies VscodeMultiDocumentCanvasRuntimePresentation;

    const previousLastGoodSource = "nui 1\nlayer previous_last_good\npoint Old = coordinate(x: 0, y: 0)";
    const activeFixtureRoot = `nui 1

import "../modules/layer_probe.nui" as probe

layer seam_layer

instance N = probe::Probe(x: 10)
`;
    const previousLastGood = compileMaterializedModuleDocument(previousLastGoodSource);
    const standaloneFatal = compileMaterializedModuleDocument(activeFixtureRoot);
    expect(previousLastGood.document).not.toBeNull();
    expect(standaloneFatal.document).toBeNull();
    const staleDocument = previousLastGood as LastGoodDslDocument;
    act(() => useCadDocumentStore.setState((state) => ({
      ...state,
      sourceText: activeFixtureRoot,
      currentCompiled: standaloneFatal,
      currentSourceRevision: standaloneFatal.spans.sourceMap.sourceRevision,
      sourceRevision: state.sourceRevision + 1,
      compiledDocumentRevision: state.compiledDocumentRevision + 1,
      doc: staleDocument,
      docText: previousLastGoodSource,
      diagnostics: standaloneFatal.diagnostics,
      bindingIssueDiagnostics: standaloneFatal.bindingIssueDiagnostics ?? [],
      typedDependencyGraph: standaloneFatal.typedDependencyGraph,
      elements: staleDocument.document.elements,
      transformationRecipes: staleDocument.document.transformationRecipes ?? [],
      modifiers: staleDocument.document.modifiers ?? [],
      visibilityRoles: staleDocument.document.visibilityRoles ?? [],
      visibilityProfiles: staleDocument.document.visibilityProfiles,
      activeVisibilityProfileId: staleDocument.document.activeVisibilityProfileId,
      layouts: staleDocument.document.layouts ?? [],
      printOutputs: staleDocument.document.printOutputs ?? [],
      svgOutputs: staleDocument.document.svgOutputs ?? [],
      evaluationLimitIndex: staleDocument.document.evaluationLimitIndex
    })));
    const documentState = useCadDocumentStore.getState();
    expect(documentState.currentCompiled.document).toBeNull();
    expect(documentState.docText).toBe(previousLastGoodSource);
    expect(documentState.doc.document.sourceLayerDeclarations?.map((declaration) => declaration.name))
      .toContain("previous_last_good");

    const evaluation = emptyEvaluationResult(graphPresentation.elements);
    const props = {
      evaluation,
      evaluationState: makeEvaluationState(evaluation, graphPresentation.graphRevision, { status: "ready" }),
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null,
      multiDocumentRuntimePresentation: graphPresentation
    };
    for (let mount = 0; mount < 2; mount++) {
      const canvasView = render(<VSCodeDrawingCanvas {...props} />);
      const adapter = mocks.hostAdapter;
      if (!adapter) throw new Error("Canvas host adapter was not captured");
      expect(adapter.elements).toContainEqual(importedMarker);
      expect(adapter.canvasLayerPresentation?.layers.map((layer) => layer.name)).toEqual(["default", "seam_layer"]);
      expect(canvasLayerVisibleElementIds(new Set([importedMarker.id]), adapter.canvasLayerPresentation)).toEqual(
        new Set([importedMarker.id])
      );
      const defaultLayer = adapter.canvasLayerPresentation!.layers.find((layer) => layer.name === "default")!;
      expect(canvasLayerVisibleElementIds(new Set([importedMarker.id]), {
        ...adapter.canvasLayerPresentation!,
        hiddenLayerIds: new Set([defaultLayer.id])
      })).toEqual(new Set());

      const overlay = adapter.renderHostOverlay?.({ width: 640, height: 480 });
      if (!overlay) throw new Error("Canvas Layers overlay was not rendered");
      const overlayView = render(<div className="canvas-viewport">{overlay}</div>);
      const layerList = overlayView.container.querySelector(".canvas-layer-list");
      expect([...layerList!.querySelectorAll(".canvas-layer-row span")].map((row) => row.textContent)).toEqual([
        "default",
        "seam_layer"
      ]);
      expect(screen.getAllByRole("checkbox", { name: "Show layer seam_layer" })).toHaveLength(1);
      overlayView.unmount();
      canvasView.unmount();
    }
  });

  it("passes Canvas grid configuration through the shared DrawingCanvas boundary", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined, vi.fn(), vi.fn(), {
      enabled: false,
      spacingMm: 2.5,
      majorEvery: 1,
      snapEnabled: false
    });

    expect(adapter.canvasGridSettings).toEqual({ enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: false });
  });

  it("renders the fixed Grid Ribbon and routes its existing Extension Host actions", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const onToggleCanvasGrid = vi.fn();
    const onConfigureCanvasGrid = vi.fn();
    const onToggleCanvasGridSnap = vi.fn();
    const { adapter } = renderCanvas(
      evaluation,
      undefined,
      vi.fn(),
      vi.fn(),
      { enabled: false, spacingMm: 10, majorEvery: 5, snapEnabled: true },
      onToggleCanvasGridSnap,
      onToggleCanvasGrid,
      onConfigureCanvasGrid
    );
    const overlay = adapter.renderHostOverlay?.({ width: 400, height: 300 });
    if (!overlay) throw new Error("Canvas Ribbon overlay was not rendered");
    const view = render(overlay);

    const buttons = [...view.container.querySelectorAll<HTMLButtonElement>(
      "[data-ribbon-id='grid'] button[data-command-id]"
    )];
    expect(buttons.map((button) => button.dataset.commandId)).toEqual([
      "toggleCanvasGrid",
      "configureCanvasGrid",
      "toggleCanvasGridSnap"
    ]);
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Grid Settings: 10 mm · ×5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid Settings: 10 mm · ×5" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid Snap" }));

    expect(onToggleCanvasGrid).toHaveBeenCalledTimes(1);
    expect(onConfigureCanvasGrid).toHaveBeenCalledTimes(1);
    expect(onToggleCanvasGridSnap).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand).not.toHaveBeenCalled();
  });

  it("enables Space-primary pan only in the production Canvas adapter", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);

    expect(adapter.spacePrimaryPanEnabled).toBe(true);
    expect(mocks.nativePointerBoundaryFallback).toBe(true);
  });

  it("includes viewport controls and Canvas Status in the fixed Viewport Ribbon", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const overlay = adapter.renderHostOverlay?.({ width: 400, height: 300 }, { canvasModeChromeHeight: 52 });
    if (!overlay) throw new Error("Canvas UI overlay was not rendered");
    const view = render(overlay);
    const ribbons = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon")];

    expect(ribbons.map((ribbon) => ribbon.dataset.ribbonId)).toEqual(["viewport", "display", "grid"]);
    expect(ribbons[0]?.querySelectorAll(".command-ribbon-button")).toHaveLength(4);
    expect(ribbons[0]?.querySelector("[data-command-id='zoomOutCanvas']")).toBeInTheDocument();
    expect(ribbons[0]?.querySelector("[data-command-id='zoomInCanvas']")).toBeInTheDocument();
    expect(ribbons[0]?.querySelector("[data-command-id='resetCanvasView']")).toBeInTheDocument();
    expect(ribbons[0]?.querySelector("[data-command-id='fitDrawing']")).toBeInTheDocument();
    expect(ribbons[0]?.querySelector("[role='status']")).toHaveTextContent("ZOOM100%");
    expect(view.container.querySelector("[data-canvas-viewport-controls]")).toBeNull();
    expect(ribbons[0]?.parentElement).toHaveStyle({ top: "60px", left: "8px" });
    fireEvent.click(ribbons[0]?.querySelector("[data-command-id='zoomOutCanvas']") as HTMLElement);
    fireEvent.click(ribbons[0]?.querySelector("[data-command-id='zoomInCanvas']") as HTMLElement);
    fireEvent.click(ribbons[0]?.querySelector("[data-command-id='resetCanvasView']") as HTMLElement);
    fireEvent.click(ribbons[0]?.querySelector("[data-command-id='fitDrawing']") as HTMLElement);
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("zoomOutCanvas", expect.anything());
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("zoomInCanvas", expect.anything());
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("resetCanvasView", expect.anything());
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("fitDrawing", expect.anything());
  });

  it("blocks ordinary Canvas selection, rectangle selection, and drag mutation during Pick", () => {
    const target = { elementId: "target", parameterKey: "point" };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target)
    });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const baseElements = useCadDocumentStore.getState().elements;
    const pointDrag = {
      elementId: baseElements[0]?.id ?? "point",
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const bezierDrag = {
      ...pointDrag,
      bezierHandleRole: "start" as const
    };

    expect(adapter.selectElement("element", "replace")).toBe(false);
    expect(adapter.previewCanvasSelection({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    }, "element", "replace")).toBe(false);
    expect(adapter.finalizeCanvasSelectionSession({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    })).toBe(false);
    expect(adapter.commitCanvasRectangleSelection(["element"], "replace")).toBe(false);
    expect(adapter.clearCanvasSelection()).toBe(false);
    expect(adapter.movePointElementByDelta(pointDrag)).toBe(false);
    expect(adapter.moveBezierHandleByDelta(bezierDrag)).toBe(false);
    expect(mocks.dispatchCommand).not.toHaveBeenCalled();
    expect(mocks.commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });

  it("projects ordinary Pick Mode status into the shared chrome slot", () => {
    const target = { elementId: "target", parameterKey: "point" };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target)
    });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const chrome = adapter.renderCanvasModeChrome?.();
    if (!chrome) throw new Error("Pick Mode chrome was not rendered");
    render(chrome);

    expect(screen.getByText("PICK MODE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "選択を完了" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "その他の参照操作" })).toBeNull();
    expect(document.querySelector(".canvas-mode-status.is-reference-pick-compact")).toBeNull();
    const uiOverlay = adapter.renderHostOverlay?.({ width: 400, height: 300 }, { canvasModeChromeHeight: 52 });
    if (!uiOverlay) throw new Error("Canvas UI overlay was not rendered");
    const uiView = render(uiOverlay);
    expect(uiView.container.querySelector(".canvas-mode-status")).toBeNull();
  });

  it("keeps fixed view and presentation Ribbon operations available during Pick", () => {
    const target = { elementId: "target", parameterKey: "point" };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target),
      selectedElementIds: ["selected"]
    });
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const overlay = adapter.renderHostOverlay?.({ width: 400, height: 300 }, { canvasModeChromeHeight: 60 });
    if (!overlay) throw new Error("Ribbon overlay was not rendered");
    render(overlay);
    fireEvent.click(document.querySelector("[data-command-id='resetCanvasView']")!);
    fireEvent.click(document.querySelector("[data-command-id='fitDrawing']")!);
    fireEvent.click(document.querySelector("[data-command-id='toggleCanvasPointNames']")!);
    fireEvent.click(document.querySelector("[data-command-id='toggleCanvasDirectionArrows']")!);

    expect(mocks.dispatchCommand).toHaveBeenCalledWith("resetCanvasView", expect.anything());
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("fitDrawing", expect.anything());
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("toggleCanvasPointNames", expect.anything());
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("toggleCanvasDirectionArrows", expect.anything());
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("clearCanvasSelection", expect.anything());
  });

  it("commits rectangle selection through the shared command owner with history enabled", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);

    adapter.commitCanvasRectangleSelection(["selected"], "toggle");

    expect(mocks.commitCanvasRectangleSelection).toHaveBeenCalledWith(["selected"], "toggle", true);
  });

  it.each([
    ["blank", false],
    ["blank", true],
    ["element", false],
    ["element", true]
  ] as const)("projects %s Canvas context with selection=%s", (kind, hasSelection) => {
    useCadUiStore.setState({ selectedElementIds: hasSelection ? ["selected"] : [] });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const viewport = screen.getByTestId("drawing-canvas");

    adapter.publishCanvasContextMenu?.({ kind });

    expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).toEqual({
      webviewSection: kind,
      "nuinuiCAD.canvasHasSelection": hasSelection,
      "nuinuiCAD.canvasCanSelectInstance": false,
      "nuinuiCAD.showCanvasPointNames": true,
      "nuinuiCAD.showCanvasGeometryNames": false,
      "nuinuiCAD.showCanvasPoints": true,
      "nuinuiCAD.showCanvasDirectionArrows": false,
      "nuinuiCAD.canvasGridEnabled": true,
      "nuinuiCAD.canvasGridSnapEnabled": false,
      preventDefaultContextMenuItems: true
    });
  });

  it("projects current Canvas display state into initial and refreshed context data", () => {
    useCadUiStore.setState({
      showCanvasPointNames: false,
      showCanvasGeometryNames: true,
      showCanvasPoints: false,
      showCanvasDirectionArrows: true
    });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined, vi.fn(), vi.fn(), {
      enabled: false,
      spacingMm: 10,
      majorEvery: 5,
      snapEnabled: true
    });
    const viewport = screen.getByTestId("drawing-canvas");
    const context = () => JSON.parse(viewport.getAttribute("data-vscode-context")!);

    expect(JSON.parse(adapter.canvasContextMenuData!)).toMatchObject({
      "nuinuiCAD.showCanvasPointNames": false,
      "nuinuiCAD.showCanvasGeometryNames": true,
      "nuinuiCAD.showCanvasPoints": false,
      "nuinuiCAD.showCanvasDirectionArrows": true,
      "nuinuiCAD.canvasGridEnabled": false,
      "nuinuiCAD.canvasGridSnapEnabled": true
    });

    useCadUiStore.setState({
      showCanvasPointNames: true,
      showCanvasGeometryNames: false,
      showCanvasPoints: true,
      showCanvasDirectionArrows: false
    });
    adapter.publishCanvasContextMenu?.({ kind: "blank" });
    expect(context()).toMatchObject({
      "nuinuiCAD.showCanvasPointNames": true,
      "nuinuiCAD.showCanvasGeometryNames": false,
      "nuinuiCAD.showCanvasPoints": true,
      "nuinuiCAD.showCanvasDirectionArrows": false,
      "nuinuiCAD.canvasGridEnabled": false,
      "nuinuiCAD.canvasGridSnapEnabled": true
    });
  });

  it("refreshes Canvas context from current selection across blank and element transitions", () => {
    useCadUiStore.setState({ selectedElementIds: [] });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const viewport = screen.getByTestId("drawing-canvas");
    const context = () => JSON.parse(viewport.getAttribute("data-vscode-context")!);

    adapter.publishCanvasContextMenu?.({ kind: "blank" });
    expect(context()).toMatchObject({ webviewSection: "blank", "nuinuiCAD.canvasHasSelection": false });

    useCadUiStore.setState({ selectedElementIds: ["selected"] });
    adapter.publishCanvasContextMenu?.({ kind: "element" });
    expect(context()).toMatchObject({ webviewSection: "element", "nuinuiCAD.canvasHasSelection": true });

    useCadUiStore.setState({ selectedElementIds: [] });
    adapter.publishCanvasContextMenu?.({ kind: "blank" });
    expect(context()).toMatchObject({ webviewSection: "blank", "nuinuiCAD.canvasHasSelection": false });
  });

  it("publishes Select Instance only for the current primary materialized Module body", () => {
    const previousDocument = useCadDocumentStore.getState();
    const previousUi = useCadUiStore.getState();
    try {
      const compiled = compileMaterializedModuleDocument([
        "nui 1",
        "module M() {",
        "  point P = coordinate(x: 1, y: 2)",
        "}",
        "instance First = M()",
        "point Outside = coordinate(x: 3, y: 4)"
      ].join("\n"));
      expect(compiled.document).not.toBeNull();
      const owner = compiled.document!.elements.find((element) => element.name === "First")!;
      const body = compiled.document!.elements.find((element) =>
        element.name === "P" && element.parentGroupId === owner.id
      )!;
      const ordinary = compiled.document!.elements.find((element) => element.name === "Outside")!;
      useCadDocumentStore.setState({
        elements: compiled.document!.elements,
        doc: {
          ...previousDocument.doc,
          moduleMaterialization: compiled.moduleMaterialization
        }
      });
      useCadUiStore.setState({
        selectedElementId: body.id,
        selectedElementIds: [body.id, ordinary.id]
      });
      const { adapter } = renderCanvas(emptyEvaluationResult(compiled.document!.elements), undefined);
      const viewport = screen.getByTestId("drawing-canvas");

      adapter.publishCanvasContextMenu?.({ kind: "element" });
      expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).toMatchObject({
        webviewSection: "element",
        "nuinuiCAD.canvasCanSelectInstance": true
      });

      useCadUiStore.setState({ selectedElementId: ordinary.id });
      adapter.publishCanvasContextMenu?.({ kind: "element" });
      expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).toMatchObject({
        webviewSection: "element",
        "nuinuiCAD.canvasCanSelectInstance": false
      });

      adapter.publishCanvasContextMenu?.({ kind: "blank" });
      expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).toMatchObject({
        webviewSection: "blank",
        "nuinuiCAD.canvasCanSelectInstance": false
      });
    } finally {
      useCadDocumentStore.setState(previousDocument);
      useCadUiStore.setState(previousUi);
    }
  });

  it("projects only the exact blank-context pointer into VS Code context data", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const viewport = screen.getByTestId("drawing-canvas");

    adapter.publishCanvasContextMenu?.({ kind: "blank", pointer: { x: 12.5, y: -8 } });
    expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).toMatchObject({
      webviewSection: "blank",
      "nuinuiCAD.canvasPointerWorldX": 12.5,
      "nuinuiCAD.canvasPointerWorldY": -8
    });

    adapter.publishCanvasContextMenu?.({ kind: "element", pointer: { x: 1, y: 2 } });
    expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).not.toHaveProperty("nuinuiCAD.canvasPointerWorldX");
  });

  it("forwards the latest finite world pointer through the Canvas host boundary", () => {
    const postCanvasPointerPosition = vi.fn();
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined, vi.fn(), postCanvasPointerPosition);

    adapter.publishCanvasPointerPosition?.({ x: 25, y: -4 });
    expect(postCanvasPointerPosition).toHaveBeenCalledWith({ x: 25, y: -4 });
  });

  it("keeps preview mutations in the Webview and sends one canonical source after each commit", () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const postCanonicalSourceText = vi.fn();
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const { adapter } = renderCanvas(evaluation, undefined, postCanonicalSourceText);
    const basePointAction = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    adapter.movePointElementByDelta(basePointAction);
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("movePointElementByDelta", basePointAction);
    expect(mocks.dispatchCommand.mock.calls[0]![1].baseElements).toBe(baseElements);

    const pointCommit = { ...basePointAction, commitMode: "commit" as const };
    adapter.movePointElementByDelta(pointCommit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);
    expect(postCanonicalSourceText).toHaveBeenCalledWith(useCadDocumentStore.getState().sourceText);

    const bezierCommit = {
      elementId: baseElements[0]!.id,
      bezierHandleRole: "start" as const,
      dx: 1,
      dy: 2,
      angleLocked: true,
      distanceLocked: false,
      commitMode: "commit" as const,
      baseElements
    };
    adapter.moveBezierHandleByDelta(bezierCommit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("moveBezierHandleByDelta", bezierCommit);
    expect(mocks.dispatchCommand.mock.calls[2]![1].baseElements).toBe(baseElements);
  });

  it("coalesces preview actions until the current evaluation settles", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const evaluating = makeEvaluationState(evaluation, 1);
    const { view, adapter } = renderCanvas(evaluation, evaluating);
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const intermediate = { ...first, dx: 2 };
    const latest = { ...first, dx: 3 };

    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(intermediate);
    adapter.movePointElementByDelta(latest);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
          currentReferencePickAuthorityFor={() => null}
        />
      );
      await Promise.resolve();
    });

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", latest);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("movePointElementByDelta", intermediate);
  });

  it("does not flush for stale evaluation and flushes the latest action after current settlement", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const { view, adapter } = renderCanvas(evaluation, makeEvaluationState(evaluation, 1));
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const latest = { ...first, dx: 4 };
    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(latest);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready", isStale: true })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
          currentReferencePickAuthorityFor={() => null}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 3, { status: "failed" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
          currentReferencePickAuthorityFor={() => null}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", latest);
  });

  it("bypasses the scheduler for canonical commits and drops pending preview", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const postCanonicalSourceText = vi.fn();
    const { view, adapter } = renderCanvas(
      evaluation,
      makeEvaluationState(evaluation, 1),
      postCanonicalSourceText
    );
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const pending = { ...first, dx: 2 };
    const commit = { ...first, dx: 3, commitMode: "commit" as const };
    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(pending);
    adapter.movePointElementByDelta(commit);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", commit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={postCanonicalSourceText}
          currentReferencePickAuthorityFor={() => null}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("movePointElementByDelta", pending);
  });

  it("does not hand off source text for a rejected canonical commit", () => {
    mocks.dispatchCommand
      .mockReturnValueOnce({ status: "applied" })
      .mockReturnValueOnce({ status: "rejected" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const postCanonicalSourceText = vi.fn();
    const { adapter } = renderCanvas(evaluation, undefined, postCanonicalSourceText);
    const preview = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    adapter.movePointElementByDelta(preview);
    adapter.movePointElementByDelta({ ...preview, commitMode: "commit" });
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
  });
});

const importedCanvasCases = (["A", "B", "C", "D", "E", "F"] as const).flatMap(relation =>
  (relation === "B" || relation === "E" ? [false, true] : [false]).map(empty => ({ relation, empty })));
it.each(importedCanvasCases)("#1623 $relation empty=$empty starts target and Browse after a fresh Canvas mount", async ({ relation, empty }) => {
  const { importedPickFixture } = await import("./importedReferencePickFixture");
  const { projectVscodeMultiDocumentCanvasRuntime, canvasRuntimePresentationFor } = await import("./multiDocumentRuntimeTransport");
  const { projectReferencePickGraphSnapshot } = await import("./referencePickGraphSnapshot");
  const { evaluateElements } = await import("../geometry/evaluate");
  const { buildEvaluationOptions } = await import("../geometry/productionEvaluationContext");
  const f = await importedPickFixture(relation, empty);
  const runtime = projectVscodeMultiDocumentCanvasRuntime({ ...f, graphRevision: 41 });
  const presentation = runtime ? canvasRuntimePresentationFor(JSON.parse(JSON.stringify(runtime))) : null;
  act(() => useCadDocumentStore.getState().replaceTextDocument(f.source.normalizedSource, { currentFilePath: null, dirtySinceSave: false }));
  const state = useCadDocumentStore.getState();
  expect(state.currentCompiled.document === null).toBe(relation === "C" || relation === "F");
  const evaluation = runtime ? f.evaluation : evaluateElements(state.doc.document.elements,
    buildEvaluationOptions({ compiledDocument: state.doc, evaluationLimitIndex: undefined }));
  const api = { postMessage: vi.fn() };
  vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
  const props = {
    evaluation, evaluationState: makeEvaluationState(evaluation, runtime ? 41 : state.compiledDocumentRevision, { status: "ready" }),
    multiDocumentRuntimePresentation: presentation, canvasFocusRef: createRef<HTMLDivElement>(), postCanonicalSourceText: vi.fn(),
    currentReferencePickAuthorityFor: () => ({ documentVersion: 7, normalizedSource: f.source.normalizedSource })
  };
  for (let mount = 0; mount < 2; mount++) {
    const view = render(<VSCodeDrawingCanvas {...props} />);
    for (const [index, mode] of ["target-bound", "browse"].entries()) {
      const request = { ...f.request, requestId: index + 1, mode: mode as "target-bound" | "browse",
        ...(mode === "browse" ? { targetProof: null, normalizedSourceOffset: f.source.normalizedSource.length } : {}) };
      const graphSnapshot = runtime ? projectReferencePickGraphSnapshot({ request, evaluation: f.evaluation,
        semantic: { sourceDocumentUri: request.documentUri, rootDocumentId: request.documentUri, documentVersion: 7, graphRevision: 41,
          sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled } })! : undefined;
      await act(async () => window.dispatchEvent(new MessageEvent("message", { data: JSON.parse(JSON.stringify({ ...request, graphSnapshot })) })));
      const result = api.postMessage.mock.calls.map(([m]) => m).filter(m => m.type === "referencePickResult").at(-1);
      expect(result).toMatchObject({ status: "started", sessionMode: mode });
      expect(result?.status === "started" ? [...result.candidateReferences, ...result.browseReferences ?? []] : []).toContainEqual({ base: "A" });
      await act(async () => window.dispatchEvent(new MessageEvent("message", { data: {
        type: "referencePickCancelRequest", requestId: request.requestId, documentUri: request.documentUri, documentVersion: request.documentVersion
      } })));
    }
    expect((presentation?.elements ?? state.doc.document.elements).map(e => e.name)).toEqual(expect.arrayContaining(["A", "B"]));
    view.unmount();
  }
});

it("#1621 keeps graph Pick visuals aligned with live Layer toggles", async () => {
  const { importedPickFixture } = await import("./importedReferencePickFixture");
  const { projectVscodeMultiDocumentCanvasRuntime, canvasRuntimePresentationFor } = await import("./multiDocumentRuntimeTransport");
  const { projectReferencePickGraphSnapshot } = await import("./referencePickGraphSnapshot");
  const { DEFAULT_SOURCE_LAYER_ID } = await import("@nuinuicad/nui-language");
  const fixture = await importedPickFixture("C");
  const runtime = projectVscodeMultiDocumentCanvasRuntime({ ...fixture, graphRevision: 41 });
  if (!runtime) throw new Error("graph runtime was not projected");
  const presentation = canvasRuntimePresentationFor(JSON.parse(JSON.stringify(runtime)));
  act(() => useCadDocumentStore.getState().replaceTextDocument(fixture.source.normalizedSource, { currentFilePath: null, dirtySinceSave: false }));
  act(() => useCadUiStore.setState({ hiddenCanvasLayerIds: new Set([DEFAULT_SOURCE_LAYER_ID]) }));
  const evaluation = fixture.evaluation;
  const api = { postMessage: vi.fn() };
  vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
  const props = {
    evaluation,
    evaluationState: makeEvaluationState(evaluation, 41, { status: "ready" }),
    multiDocumentRuntimePresentation: presentation,
    canvasFocusRef: createRef<HTMLDivElement>(),
    postCanonicalSourceText: vi.fn(),
    currentReferencePickAuthorityFor: () => ({ documentVersion: 7, normalizedSource: fixture.source.normalizedSource })
  };
  const view = render(<VSCodeDrawingCanvas {...props} />);
  const request = { ...fixture.request, requestId: 61 };
  const graphSnapshot = projectReferencePickGraphSnapshot({ request, evaluation: fixture.evaluation,
    semantic: { sourceDocumentUri: request.documentUri, rootDocumentId: request.documentUri, documentVersion: 7,
      graphRevision: 41, sourceRevision: fixture.source.sourceRevision, sourceText: fixture.source.normalizedSource,
      compiled: fixture.compiled } })!;
  await act(async () => window.dispatchEvent(new MessageEvent("message", {
    data: JSON.parse(JSON.stringify({ ...request, graphSnapshot }))
  })));
  expect(api.postMessage.mock.calls.map(([message]) => message).filter(message => message.type === "referencePickResult").at(-1))
    .toMatchObject({ status: "started" });

  const hiddenOverlay = mocks.hostAdapter?.renderHostDrawingOverlay?.({ width: 640, height: 480 });
  if (!hiddenOverlay) throw new Error("Pick overlay was not rendered");
  const hiddenView = render(<div>{hiddenOverlay}</div>);
  expect(hiddenView.container.querySelectorAll("[data-reference-pick-visuals] circle")).toHaveLength(0);
  hiddenView.unmount();

  act(() => useCadUiStore.getState().toggleCanvasLayerVisibility(DEFAULT_SOURCE_LAYER_ID));
  const visibleOverlay = mocks.hostAdapter?.renderHostDrawingOverlay?.({ width: 640, height: 480 });
  if (!visibleOverlay) throw new Error("Pick overlay was not rendered after showing the Layer");
  const visibleView = render(<div>{visibleOverlay}</div>);
  expect(visibleView.container.querySelectorAll("[data-reference-pick-visuals] circle").length).toBeGreaterThan(0);
  visibleView.unmount();
  view.unmount();
});
