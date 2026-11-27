import { createRef, type ComponentProps } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { evaluateElements } from "../geometry/evaluate";
import {
  compileDslDocument,
  createModuleRuntimeContext,
  parseDsl,
  sourceOwnerForRuntimeElementId,
  type CanvasModuleOrigin,
  type CanvasModuleMaterialization,
  type ModuleMaterialization
} from "@nuinuicad/nui-language";
import type { CadElement, ElementId } from "../types/geometry";
import type { CommandContext } from "../commands/commandTypes";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { pickModeSessionForTarget } from "../model/pickModeSession";
import { effectiveCompiledDocument, effectiveElements, initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT, initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import { VSCodeDrawingCanvas, type VSCodeDrawingCanvasHandle } from "./VSCodeDrawingCanvas";
import type { VscodeCanvasGraphCommitAuthority } from "./protocol";
import { moveBezierHandleByDelta, movePointElementByDelta } from "../commands/geometryEditCommands";
import type { VscodeCanvasRibbonPositions } from "./vscodeCanvasRibbonConfig";
import { canvasLayerSourceDocumentFor, canvasLayerVisibleElementIds } from "../model/canvasLayerPresentation";
import {
  canvasRuntimePresentationFor,
  projectVscodeMultiDocumentCanvasRuntime,
  type VscodeMultiDocumentCanvasRuntimePresentation
} from "./multiDocumentRuntimeTransport";
import {
  buildIssue1651ImportedModuleCanvasEditFixture,
  issue1651RootSourceFor
} from "./testSupport/issue1651ImportedModuleCanvasEditFixture";
import { useCanvasOverlayData } from "../components/useCanvasOverlayData";
import { DEFAULT_CANVAS_GRID_SETTINGS } from "../components/canvasGrid";
import { viewModeCommandDefinitions } from "../commands/viewModeCommandDefinitions";
import { buildIssue1673FitImportFixture, issue1673FitRootSource } from "./testSupport/issue1673FitImportFixture";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn(),
  commitCanvasRectangleSelection: vi.fn(),
  hostAdapter: null as CanvasHostAdapter | null,
  postCanonicalSourceText: null as ((sourceText: string, operationId?: number, graphAuthority?: VscodeCanvasGraphCommitAuthority) => void) | null,
  canvasFocusRef: null as { current: HTMLDivElement | null } | null,
  nativePointerBoundaryFallback: false,
  renderRealCanvas: false,
  retainedImageSourceUrl: undefined as CanvasHostAdapter["resolveImageSourceUrl"] | undefined,
  suppressEvaluationCountOverlay: false,
  onProductionDrawCompleted: null as ((draw: { drawablePrimitiveCount: number; isCurrentDraw: boolean; isProjectedDraw: boolean }) => void) | null,
  onCanvasFrameDrawn: null as (() => void) | null
}));

type CanvasFrameTestMessage = {
  type?: string;
  surface?: string;
  documentVersion?: number;
  updateGeneration?: number;
  sourceRevision?: number;
  graphIdentity?: { hostDocumentUri: string; graphRevision: number; sourceRevision: number };
  evaluationRevision?: number;
  evaluationRequestRevision?: number;
  canvasUpdate?: { generation?: number; frameIdentity?: Record<string, unknown> | null };
};

vi.mock("../commands/commands", () => ({
  dispatchCommand: mocks.dispatchCommand
}));

vi.mock("../commands/canvasRectangleSelectionCommands", () => ({
  commitCanvasRectangleSelection: mocks.commitCanvasRectangleSelection
}));

vi.mock("../components/DrawingCanvas", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("../components/DrawingCanvas")>();
  return {
    DrawingCanvas: React.forwardRef((_props: {
      hostAdapter: CanvasHostAdapter;
      postCanonicalSourceText: (sourceText: string, operationId?: number, graphAuthority?: VscodeCanvasGraphCommitAuthority) => void;
      canvasFocusRef: { current: HTMLDivElement | null };
      nativePointerBoundaryFallback?: boolean;
      retainedImageSourceUrl?: CanvasHostAdapter["resolveImageSourceUrl"];
      suppressEvaluationCountOverlay?: boolean;
      onProductionDrawCompleted?: (draw: { drawablePrimitiveCount: number; isCurrentDraw: boolean; isProjectedDraw: boolean }) => void;
      onCanvasFrameDrawn?: () => void;
    }, ref) => {
      void ref;
      const props = _props;
      mocks.hostAdapter = props.hostAdapter;
      mocks.postCanonicalSourceText = props.postCanonicalSourceText;
      mocks.canvasFocusRef = props.canvasFocusRef;
      mocks.nativePointerBoundaryFallback = props.nativePointerBoundaryFallback ?? false;
      mocks.retainedImageSourceUrl = props.retainedImageSourceUrl;
      mocks.suppressEvaluationCountOverlay = props.suppressEvaluationCountOverlay ?? false;
      mocks.onProductionDrawCompleted = props.onProductionDrawCompleted ?? null;
      mocks.onCanvasFrameDrawn = props.onCanvasFrameDrawn ?? null;
      if (mocks.renderRealCanvas) {
        return React.createElement(actual.DrawingCanvas, { ...props, ref } as unknown as ComponentProps<typeof actual.DrawingCanvas>);
      }
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
  mocks.postCanonicalSourceText = null;
  mocks.canvasFocusRef = null;
  mocks.nativePointerBoundaryFallback = false;
  mocks.renderRealCanvas = false;
  mocks.retainedImageSourceUrl = undefined;
  mocks.suppressEvaluationCountOverlay = false;
  mocks.onProductionDrawCompleted = null;
  mocks.onCanvasFrameDrawn = null;
  act(() => {
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
  });
  vi.unstubAllGlobals();
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

const issue1609CanvasRootOnlyFixture = async () => {
  const rootDocumentUri = "file:///workspace/issue-1609-canvas-root.nui";
  const dependencyDocumentUri = "file:///workspace/record-settings-lib.nui";
  const source = [
    "nui 1",
    'import "./record-settings-lib.nui" as lib',
    "const settings: lib::SeamSettings = lib::SeamSettings(width: 5, cornerAngle: 45)",
    "const seam_width: number = settings.width",
    "line Seam = segment(start: (0, 0), end: (seam_width, 0))",
    'text = label(text: "seam width = ${seam_width}", anchor: (0, 20), size: 6)'
  ].join("\n");
  const librarySource = [
    "nui 1",
    "export record SeamSettings(width: number, cornerAngle: number)"
  ].join("\n");
  const rootDocumentId = documentIdFromHost(rootDocumentUri);
  const dependencyDocumentId = documentIdFromHost(dependencyDocumentUri);
  const sourceRevision = 13;
  const graphRevision = 29;
  const root = {
    kind: "root-current" as const,
    documentId: rootDocumentId,
    normalizedSource: source,
    sourceRevision
  };
  const dependency = {
    kind: "dependency-saved" as const,
    documentId: dependencyDocumentId,
    savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:issue-1609-canvas-library"),
    normalizedSource: librarySource
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    declarationContributors: [moduleDeclarationContributor],
    loader: {
      async loadSavedDependency(importerDocumentId, relativePath) {
        return importerDocumentId === rootDocumentId && relativePath === "./record-settings-lib.nui"
          ? { status: "loaded" as const, snapshot: dependency }
          : { status: "failed" as const, reason: "missing" as const };
      }
    }
  });
  const semanticAnalysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleRuntimeContext = createModuleRuntimeContext(graph, semanticAnalysis);
  const rootNode = graph.nodes.get(rootDocumentId);
  if (!graph.valid || !semanticAnalysis.valid || !moduleRuntimeContext.valid || !rootNode) {
    throw new Error("Issue 1609 Canvas graph could not be built from its saved dependency");
  }
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  const runtime = projectVscodeMultiDocumentCanvasRuntime({ graph, compiled, graphRevision });
  if (!runtime?.rootOnly || runtime.identityOnly) throw new Error("Issue 1609 root-only Canvas runtime was not projected");
  return {
    compiled,
    graphRevision,
    rootDocumentId: String(rootDocumentId),
    runtime,
    source,
    sourceRevision,
    presentation: canvasRuntimePresentationFor(JSON.parse(JSON.stringify(runtime)))
  };
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

const graphForGroupImageFixture = () => {
  const sourcePath = "./reference.png";
  const rootDocumentId = documentIdFromHost("file:///patterns/front.nui");
  const importedDocumentId = documentIdFromHost("file:///patterns/modules/probe.nui");
  const imageElement = (id: string, name: string, parentGroupId?: string): CadElement => ({
    id,
    name,
    type: "image",
    activity: "visible",
    ...(parentGroupId ? { parentGroupId } : {}),
    sourcePath,
    originPoint: { mode: "coordinate", x: 0, y: 0 },
    naturalWidthPx: 600,
    naturalHeightPx: 400,
    sourceDpi: 150,
    targetPixelsPerMm: 5.905511811,
    scale: 1,
    angleDeg: 0,
    mirrorX: false
  });
  const forGroup = (id: string, name: string, parentGroupId?: string): CadElement => ({
    id,
    name,
    type: "forGroup",
    activity: "visible",
    ...(parentGroupId ? { parentGroupId } : {}),
    variableName: name === "Outer" ? "i" : "j",
    min: 0,
    max: 0,
    step: 1,
    showGenerated: true
  });
  const importedOrigin = (sourceDocumentId: string): CanvasModuleOrigin => ({
    kind: "moduleBody",
    instancePath: ["external-module-instance"],
    sourceDocumentId
  });

  const moduleInstance: CadElement = {
    id: "external-module-instance",
    name: "Probe instance",
    type: "moduleInstance",
    activity: "visible"
  };
  const rootImage = imageElement("root-image", "Root image");
  const rootModuleImage = imageElement("root-module-image", "Root-owned Module image");
  const rootOuter = forGroup("root-outer", "Outer");
  const rootInner = forGroup("root-inner", "Inner", rootOuter.id);
  const rootTemplateImage = imageElement("root-loop-image", "Root loop image", rootInner.id);
  const importedBody = {
    id: "imported-body",
    name: "Probe body",
    type: "group",
    activity: "visible"
  } satisfies CadElement;
  const importedOuter = forGroup("imported-outer", "Outer", importedBody.id);
  const importedInner = forGroup("imported-inner", "Inner", importedOuter.id);
  const importedTemplateImage = imageElement("imported-loop-image", "Imported loop image", importedInner.id);
  const elements = [
    moduleInstance,
    rootImage,
    rootModuleImage,
    rootOuter,
    rootInner,
    rootTemplateImage,
    importedBody,
    importedOuter,
    importedInner,
    importedTemplateImage
  ];
  const graphPresentation = {
    graphRevision: 42,
    rootDocumentId,
    rootSourceRevision: 7,
    elements,
    evaluationLimitIndex: undefined,
    visibilityProfiles: [],
    activeVisibilityProfileId: "default",
    moduleMaterialization: {
      instanceBaseGeometrySnapshots: [],
      originByRuntimeElementId: new Map<ElementId, CanvasModuleOrigin>([
        [rootModuleImage.id, importedOrigin(rootDocumentId)],
        [importedBody.id, importedOrigin(importedDocumentId)],
        [importedOuter.id, importedOrigin(importedDocumentId)],
        [importedInner.id, importedOrigin(importedDocumentId)],
        [importedTemplateImage.id, importedOrigin(importedDocumentId)]
      ])
    },
    layerSourceDocuments: []
  } satisfies VscodeMultiDocumentCanvasRuntimePresentation;
  const evaluation = evaluateElements(elements);
  const generatedRowFor = (templateElementId: string) =>
    evaluation.forGroupGeneratedRows?.find((row) => row.templateElementId === templateElementId);

  return {
    sourcePath,
    rootUrl: "https://resource/patterns/reference.png",
    elements,
    rootImage,
    rootModuleImage,
    rootTemplateImage,
    importedTemplateImage,
    graphPresentation,
    evaluation,
    generatedRowFor
  };
};

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
  it("passes passive production draw evidence through to the shared DrawingCanvas", () => {
    const onProductionDrawCompleted = vi.fn();
    render(<VSCodeDrawingCanvas
      evaluation={emptyEvaluationResult([])}
      canvasFocusRef={createRef<HTMLDivElement>()}
      postCanonicalSourceText={vi.fn()}
      currentReferencePickAuthorityFor={() => null}
      onProductionDrawCompleted={onProductionDrawCompleted}
    />);

    expect(mocks.onProductionDrawCompleted).toBe(onProductionDrawCompleted);
  });

  it("publishes stale geometry as a surface problem, clears it while evaluation is pending, and suppresses Canvas overlays", async () => {
    const api = { postMessage: vi.fn() };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    const evaluation = {
      ...emptyEvaluationResult([]),
      warnings: [{ elementId: "P", elementName: "P", message: "current evaluation warning" }]
    };
    const compiledRevision = useCadDocumentStore.getState().compiledDocumentRevision;
    const graphIdentity = { hostDocumentUri: "file:///pattern.nui", graphRevision: 5, sourceRevision: 8 };
    const props = {
      evaluation,
      evaluationState: makeEvaluationState(evaluation, compiledRevision, { status: "ready" }),
      documentVersion: 12,
      feedbackGraphIdentity: graphIdentity,
      staleCanvasPresentation: {
        status: "ready" as const,
        currentGraphRevision: 5,
        currentSourceRevision: 8,
        lastGoodGraphRevision: 4,
        lastGoodSourceRevision: 7
      },
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null
    };
    const view = render(<VSCodeDrawingCanvas {...props} />);
    const publications = () => api.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message.type === "surfaceDiagnosticsPublication");
    expect(publications().at(-1)).toMatchObject({
      type: "surfaceDiagnosticsPublication",
      surface: "canvas",
      documentVersion: 12,
      graphIdentity,
      diagnostics: [expect.objectContaining({ severity: "warning", id: "canvas-stale-geometry" })]
    });
    expect(screen.queryByTestId("stale-canvas-status")).toBeNull();
    expect(mocks.suppressEvaluationCountOverlay).toBe(true);

    view.rerender(<VSCodeDrawingCanvas {...props} staleCanvasPresentation={null} evaluationState={makeEvaluationState(
      evaluation,
      compiledRevision,
      { status: "evaluating" }
    )} />);
    expect(publications().at(-1)).toMatchObject({ diagnostics: [] });
    expect(publications().at(-1)).not.toMatchObject({ diagnostics: [expect.objectContaining({ severity: "error" })] });

    view.rerender(<VSCodeDrawingCanvas {...props} staleCanvasPresentation={null} />);
    expect(publications().at(-1)).toMatchObject({
      diagnostics: [expect.objectContaining({ message: "current evaluation warning", severity: "warning" })]
    });
  });

  it("ends update progress on invalid current Source while retaining an explicit stale-frame diagnostic", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const initial = useCadDocumentStore.getState();
    const evaluation = emptyEvaluationResult(initial.elements);
    const api = { postMessage: vi.fn() };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    const props = {
      evaluation,
      evaluationState: makeEvaluationState(evaluation, initial.compiledDocumentRevision, { status: "ready" }),
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null,
      documentVersion: 12,
      canvasUpdateProgress: { documentVersion: 12, generation: 6 }
    };
    const view = render(<VSCodeDrawingCanvas {...props} />);
    act(() => useCadDocumentStore.getState().commitText("nui 1\npoint A = ", "editor"));
    expect(useCadDocumentStore.getState().diagnostics.some(item => item.severity === "error")).toBe(true);

    const publication = api.postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter(message => message.type === "surfaceDiagnosticsPublication")
      .at(-1);
    expect(publication).toMatchObject({
      documentVersion: 12,
      canvasUpdate: { generation: 6, outcome: "terminal" },
      diagnostics: [expect.objectContaining({ id: "canvas-update-stale", severity: "warning" })]
    });
    expect(mocks.onCanvasFrameDrawn).toBeNull();
    view.unmount();
  });

  it("ends update progress on terminal evaluation failure or graph unavailability without drawing it", async () => {
    const api = { postMessage: vi.fn() };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const revision = useCadDocumentStore.getState().compiledDocumentRevision;
    const commonProps = {
      evaluation,
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null,
      documentVersion: 12,
      canvasUpdateProgress: { documentVersion: 12, generation: 6 }
    };
    const view = render(<VSCodeDrawingCanvas
      {...commonProps}
      evaluationState={makeEvaluationState(evaluation, revision, {
        status: "failed",
        error: new Error("Rust evaluation unavailable")
      })}
    />);
    const publications = () => api.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
      .filter(message => message.type === "surfaceDiagnosticsPublication");
    expect(publications().at(-1)).toMatchObject({
      canvasUpdate: { generation: 6, outcome: "terminal" },
      diagnostics: [expect.objectContaining({ id: "canvas-evaluation-failed", severity: "error" })]
    });
    expect(mocks.onCanvasFrameDrawn).toBeNull();

    api.postMessage.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...commonProps}
      evaluationState={makeEvaluationState(evaluation, revision, { status: "ready" })}
      canvasUpdateTerminal="unavailable"
    />);
    expect(publications().at(-1)).toMatchObject({
      canvasUpdate: { generation: 6, outcome: "terminal" },
      diagnostics: [expect.objectContaining({ id: "canvas-update-unavailable", severity: "error" })]
    });
    expect(mocks.onCanvasFrameDrawn).toBeNull();

    api.postMessage.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...commonProps}
      evaluationState={makeEvaluationState(evaluation, revision, { status: "evaluating" })}
      canvasUpdateTerminal="unavailable"
      staleCanvasPresentation={{
        status: "ready",
        currentGraphRevision: 9,
        currentSourceRevision: 12,
        lastGoodGraphRevision: 8,
        lastGoodSourceRevision: 11
      }}
    />);
    expect(publications().at(-1)).toMatchObject({
      canvasUpdate: { generation: 6, outcome: "terminal" },
      diagnostics: [expect.objectContaining({ id: "canvas-stale-geometry", severity: "warning" })]
    });
    expect(publications().at(-1)).not.toMatchObject({
      diagnostics: [expect.objectContaining({ id: "canvas-update-unavailable" })]
    });
    expect(mocks.onCanvasFrameDrawn).toBeNull();
  });

  it("#1673 fits the graph-backed imported Module through the Canvas-owned Fit operation", async () => {
    const fixture = await buildIssue1673FitImportFixture();
    const importedLine = fixture.runtimePresentation.elements.find((element) => element.name === "L");
    expect(fixture.graph.valid).toBe(true);
    expect(importedLine).toBeDefined();
    if (!importedLine) throw new Error("the imported Module line was not projected into Canvas");
    expect(fixture.evaluation.computedGeometry.get(importedLine.id)).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 400, y: 200 }
    });

    act(() => useCadDocumentStore.getState().replaceTextDocument(issue1673FitRootSource, {
      currentFilePath: null,
      dirtySinceSave: false
    }));
    expect(effectiveElements(useCadDocumentStore.getState()).some((element) => element.id === importedLine.id)).toBe(false);

    const initialViewport = { panX: 11, panY: -7, zoom: 2 };
    act(() => useCadUiStore.getState().setCanvasViewport(initialViewport));
    let fitContext: CommandContext | undefined;
    mocks.dispatchCommand.mockImplementation((commandId, context) => {
      if (commandId === "fitDrawing") fitContext = context;
      if (commandId === "fitDrawing") viewModeCommandDefinitions.fitDrawing.run(context);
    });
    const canvasFocusRef = createRef<HTMLDivElement>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      return this.dataset.testid === "drawing-canvas"
        ? domRect(0, 0, 400, 300)
        : domRect(0, 0, 0, 0);
    });
    const initialProps = {
      evaluation: fixture.evaluation,
      evaluationState: makeEvaluationState(fixture.evaluation, fixture.runtimePresentation.graphRevision, { status: "ready" }),
      canvasFocusRef,
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null,
      multiDocumentRuntimePresentation: fixture.runtimePresentation
    };
    const canvasHandle = createRef<VSCodeDrawingCanvasHandle>();
    const canvasView = render(
      <VSCodeDrawingCanvas
        ref={canvasHandle}
        {...initialProps}
      />
    );
    const unrelatedEvaluation = {
      ...fixture.evaluation,
      computedGeometry: new Map([...fixture.evaluation.computedGeometry].map(([elementId, geometry]) =>
        elementId === importedLine.id && geometry.kind === "line"
          ? [elementId, {
              ...geometry,
              start: { ...geometry.start, x: 1000 },
              end: { ...geometry.end, x: 1400 }
            }] as const
          : [elementId, geometry] as const
      ))
    };
    canvasView.rerender(
      <VSCodeDrawingCanvas
        ref={canvasHandle}
        {...initialProps}
        evaluation={unrelatedEvaluation}
        evaluationState={makeEvaluationState(unrelatedEvaluation, fixture.runtimePresentation.graphRevision + 1, { status: "evaluating" })}
      />
    );
    expect(canvasHandle.current?.fitDrawing).toBeTypeOf("function");
    act(() => canvasHandle.current?.fitDrawing());

    expect(mocks.dispatchCommand).toHaveBeenCalledWith("fitDrawing", expect.anything());
    expect(fitContext?.evaluation).toBe(fixture.evaluation);
    expect(fitContext?.evaluation).not.toBe(unrelatedEvaluation);
    expect(fitContext?.getCanvasFitDrawingPresentation?.()?.elements).toBe(fixture.runtimePresentation.elements);
    expect(fitContext?.getCanvasFitDrawingPresentation?.()?.canvasLayerPresentation).toBeDefined();
    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 0.84,
      panX: -168,
      panY: 84
    });
    canvasView.unmount();
  });

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

  it("resolves colliding Graph image paths only for root-owned IDs in the real overlay", () => {
    const sourcePath = "./reference.png";
    const rootDocumentId = documentIdFromHost("file:///patterns/front.nui");
    const importedDocumentId = documentIdFromHost("file:///patterns/modules/probe.nui");
    const imageElement = (id: string, name: string): CadElement => ({
      id,
      name,
      type: "image",
      activity: "visible",
      sourcePath,
      originPoint: { mode: "coordinate", x: 0, y: 0 },
      naturalWidthPx: 600,
      naturalHeightPx: 400,
      sourceDpi: 150,
      targetPixelsPerMm: 5.905511811,
      scale: 1,
      angleDeg: 0,
      mirrorX: false
    });
    const rootImage = imageElement("graph-root-image", "Root image");
    const rootModuleImage = imageElement("graph-root-module-image", "Root module image");
    const importedImage = imageElement("graph-imported-image", "Imported image");
    const unknownOwnerImage = imageElement("graph-unknown-owner-image", "Unknown owner image");
    const elements = [rootImage, rootModuleImage, importedImage, unknownOwnerImage];
    const moduleOrigin = (sourceDocumentId?: string): CanvasModuleOrigin => ({
      kind: "moduleBody",
      instancePath: ["fixture-instance"],
      ...(sourceDocumentId ? { sourceDocumentId } : {})
    });
    const graphPresentation = {
      graphRevision: 42,
      rootDocumentId,
      rootSourceRevision: 7,
      elements,
      evaluationLimitIndex: undefined,
      visibilityProfiles: [],
      activeVisibilityProfileId: "default",
      moduleMaterialization: {
        instanceBaseGeometrySnapshots: [],
        originByRuntimeElementId: new Map<ElementId, CanvasModuleOrigin>([
          [rootModuleImage.id, moduleOrigin(rootDocumentId)],
          [importedImage.id, moduleOrigin(importedDocumentId)],
          [unknownOwnerImage.id, moduleOrigin()]
        ])
      },
      layerSourceDocuments: []
    } satisfies VscodeMultiDocumentCanvasRuntimePresentation;
    const evaluation = evaluateElements(elements);
    const rootUrl = "https://resource/patterns/reference.png";
    render(
      <VSCodeDrawingCanvas
        evaluation={evaluation}
        evaluationState={makeEvaluationState(evaluation, graphPresentation.graphRevision, { status: "ready" })}
        canvasFocusRef={createRef<HTMLDivElement>()}
        postCanonicalSourceText={vi.fn()}
        currentReferencePickAuthorityFor={() => null}
        imageResources={{ [sourcePath]: rootUrl }}
        multiDocumentRuntimePresentation={graphPresentation}
      />
    );
    const adapter = mocks.hostAdapter;
    if (!adapter) throw new Error("Canvas host adapter was not captured");

    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      pointPickCandidates: [],
      viewportSize: { width: 640, height: 480 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      visibilityProfiles: graphPresentation.visibilityProfiles,
      activeVisibilityProfileId: graphPresentation.activeVisibilityProfileId,
      resolveImageSourceUrl: adapter.resolveImageSourceUrl
    }));

    expect(Object.fromEntries(result.current.overlayImages.map(({ image, sourceUrl }) => [image.elementId, sourceUrl]))).toEqual({
      [rootImage.id]: rootUrl,
      [rootModuleImage.id]: rootUrl,
      [importedImage.id]: "data:,",
      [unknownOwnerImage.id]: "data:,"
    });
    expect(adapter.resolveImageSourceUrl(sourcePath)).toBe("data:,");
    expect(adapter.resolveImageSourceUrl(sourcePath, "unknown-graph-image")).toBe("data:,");
    expect(adapter.resolveImageSourceUrl("data:image/png;base64,AAAA", importedImage.id)).toBe("data:image/png;base64,AAAA");
  });

  it("resolves nested forGroup image rows to their root-owned Graph template in the real overlay", () => {
    const fixture = graphForGroupImageFixture();
    const rootRow = fixture.generatedRowFor(fixture.rootTemplateImage.id);
    const importedRow = fixture.generatedRowFor(fixture.importedTemplateImage.id);
    const graphInputIds = new Set(fixture.graphPresentation.elements.map((element) => element.id));
    const imageResources = { [fixture.sourcePath]: fixture.rootUrl };

    expect(fixture.evaluation.errors).toEqual([]);
    expect(rootRow?.elementType).toBe("image");
    expect(rootRow?.occurrencePath).toHaveLength(2);
    expect(importedRow?.elementType).toBe("image");
    expect(importedRow?.occurrencePath).toHaveLength(2);
    expect(graphInputIds.has(rootRow?.generatedElementId ?? "")).toBe(false);
    expect(graphInputIds.has(importedRow?.generatedElementId ?? "")).toBe(false);
    expect(Object.keys(imageResources)).toEqual([fixture.sourcePath]);

    render(
      <VSCodeDrawingCanvas
        evaluation={fixture.evaluation}
        evaluationState={makeEvaluationState(fixture.evaluation, fixture.graphPresentation.graphRevision, { status: "ready" })}
        canvasFocusRef={createRef<HTMLDivElement>()}
        postCanonicalSourceText={vi.fn()}
        currentReferencePickAuthorityFor={() => null}
        imageResources={imageResources}
        multiDocumentRuntimePresentation={fixture.graphPresentation}
      />
    );
    const adapter = mocks.hostAdapter;
    if (!adapter) throw new Error("Canvas host adapter was not captured");
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation: fixture.evaluation,
      elements: fixture.elements,
      selectedElementId: null,
      pointPickCandidates: [],
      viewportSize: { width: 640, height: 480 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      visibilityProfiles: fixture.graphPresentation.visibilityProfiles,
      activeVisibilityProfileId: fixture.graphPresentation.activeVisibilityProfileId,
      resolveImageSourceUrl: adapter.resolveImageSourceUrl
    }));
    const overlayUrls = Object.fromEntries(
      result.current.overlayImages.map(({ image, sourceUrl }) => [image.elementId, sourceUrl])
    );

    expect(overlayUrls[fixture.rootImage.id]).toBe(fixture.rootUrl);
    expect(overlayUrls[fixture.rootModuleImage.id]).toBe(fixture.rootUrl);
    expect(overlayUrls[rootRow!.generatedElementId]).toBe(fixture.rootUrl);
    expect(overlayUrls[importedRow!.generatedElementId]).toBe("data:,");
    expect(adapter.resolveImageSourceUrl(fixture.sourcePath)).toBe("data:,");
    expect(adapter.resolveImageSourceUrl(fixture.sourcePath, "unknown-graph-image")).toBe("data:,");
    expect(adapter.resolveImageSourceUrl("data:image/png;base64,AAAA", importedRow!.generatedElementId)).toBe("data:image/png;base64,AAAA");
  });

  it("fails closed for invalid, ambiguous, cyclic, unknown, or stale forGroup image ancestry", () => {
    const fixture = graphForGroupImageFixture();
    const rootRow = fixture.generatedRowFor(fixture.rootTemplateImage.id);
    if (!rootRow) throw new Error("Root generated image row was not evaluated");
    const generatedImageId = rootRow.generatedElementId;
    const renderProps = (evaluation: typeof fixture.evaluation, evaluationRevision = fixture.graphPresentation.graphRevision) => ({
      evaluation,
      evaluationState: makeEvaluationState(evaluation, evaluationRevision, { status: "ready" }),
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null,
      imageResources: { [fixture.sourcePath]: fixture.rootUrl },
      multiDocumentRuntimePresentation: fixture.graphPresentation
    });
    const firstProps = renderProps(fixture.evaluation);
    const view = render(<VSCodeDrawingCanvas {...firstProps} />);
    const resolve = () => mocks.hostAdapter?.resolveImageSourceUrl(fixture.sourcePath, generatedImageId);

    expect(resolve()).toBe(fixture.rootUrl);

    const originalRows = fixture.evaluation.forGroupGeneratedRows ?? [];
    const rootRows = originalRows.filter((row) => row.generatedElementId !== generatedImageId);
    const variants: Array<{ name: string; rows: NonNullable<typeof fixture.evaluation.forGroupGeneratedRows> }> = [
      { name: "missing", rows: rootRows },
      { name: "ambiguous", rows: [...originalRows, rootRow] },
      {
        name: "cyclic",
        rows: originalRows.map((row) => row.generatedElementId === generatedImageId
          ? { ...row, templateElementId: generatedImageId }
          : row)
      },
      {
        name: "unknown terminal",
        rows: originalRows.map((row) => row.generatedElementId === generatedImageId
          ? { ...row, templateElementId: "unknown-graph-template-image" }
          : row)
      },
      {
        name: "invalid image row type",
        rows: originalRows.map((row) => row.generatedElementId === generatedImageId
          ? { ...row, elementType: "line" as const }
          : row)
      }
    ];

    for (const variant of variants) {
      const evaluation = { ...fixture.evaluation, forGroupGeneratedRows: variant.rows };
      view.rerender(<VSCodeDrawingCanvas {...renderProps(evaluation)} />);
      expect(resolve(), variant.name).toBe("data:,");
      expect(mocks.hostAdapter?.resolveImageSourceUrl(fixture.sourcePath, fixture.rootImage.id)).toBe(fixture.rootUrl);
    }

    const intermediateGeneratedId = "intermediate-generated-image";
    const chainedRows = [
      ...rootRows,
      { ...rootRow, templateElementId: intermediateGeneratedId },
      { ...rootRow, generatedElementId: intermediateGeneratedId, templateElementId: fixture.rootTemplateImage.id }
    ];
    const chainedEvaluation = { ...fixture.evaluation, forGroupGeneratedRows: chainedRows };
    view.rerender(<VSCodeDrawingCanvas {...renderProps(chainedEvaluation)} />);
    expect(resolve()).toBe(fixture.rootUrl);

    view.rerender(<VSCodeDrawingCanvas {...renderProps(fixture.evaluation, fixture.graphPresentation.graphRevision - 1)} />);
    expect(resolve()).toBe("data:,");
    view.rerender(
      <VSCodeDrawingCanvas
        {...firstProps}
        evaluationState={undefined}
      />
    );
    expect(resolve()).toBe("data:,");
    view.rerender(
      <VSCodeDrawingCanvas
        {...firstProps}
        evaluationState={makeEvaluationState({ ...fixture.evaluation }, fixture.graphPresentation.graphRevision, { status: "ready" })}
      />
    );
    expect(resolve()).toBe("data:,");
  });

  it("keeps underlay URLs paired with the retained graph frame without giving current commands its grants", () => {
    const fixture = graphForGroupImageFixture();
    const root = fixture.graphPresentation.rootDocumentId;
    const props = {
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText: vi.fn(),
      currentReferencePickAuthorityFor: () => null,
      hostRootDocumentId: root
    };
    const view = render(<VSCodeDrawingCanvas
      {...props}
      evaluation={fixture.evaluation}
      evaluationState={makeEvaluationState(fixture.evaluation, fixture.graphPresentation.graphRevision, { status: "ready" })}
      multiDocumentRuntimePresentation={fixture.graphPresentation}
      imageResources={{ [fixture.sourcePath]: fixture.rootUrl }}
    />);
    const pending = emptyEvaluationResult([]);
    const gap = <VSCodeDrawingCanvas
      {...props}
      evaluation={pending}
      evaluationState={makeEvaluationState(pending, useCadDocumentStore.getState().compiledDocumentRevision)}
      imageResources={{ [fixture.sourcePath]: "https://resource/new.png" }}
      awaitingHostGraph
    />;
    view.rerender(gap);
    expect(mocks.retainedImageSourceUrl?.(fixture.sourcePath, fixture.rootTemplateImage.id)).toBe(fixture.rootUrl);
    expect(mocks.retainedImageSourceUrl?.(fixture.sourcePath, fixture.importedTemplateImage.id)).toBe("data:,");
    expect(mocks.hostAdapter?.resolveImageSourceUrl(fixture.sourcePath, fixture.rootTemplateImage.id)).toBe("data:,");

    view.rerender(<VSCodeDrawingCanvas {...gap.props} hostRootDocumentId="file:///patterns/back.nui" />);
    expect(mocks.retainedImageSourceUrl).toBeUndefined();
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
  point marker = coordinate(x: x, y: 0)
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

  it("uses the exact Host compiled root and elements for root-only imported-record Canvas", async () => {
    const fixture = await issue1609CanvasRootOnlyFixture();
    const sourceEditing = fixture.presentation.sourceEditing;
    expect(sourceEditing).toBeDefined();
    if (!sourceEditing) return;

    act(() => useCadDocumentStore.getState().replaceTextDocument(fixture.source, {
      currentFilePath: fixture.rootDocumentId,
      dirtySinceSave: false
    }));
    const localState = useCadDocumentStore.getState();
    expect(localState.sourceText).toBe(fixture.source);
    expect(localState.currentCompiled.document).toBeNull();
    const localCompiled = effectiveCompiledDocument(localState);
    expect(localCompiled.spans.sourceMap.source).not.toBe(fixture.source);

    const evaluation = emptyEvaluationResult(fixture.runtime.preparedRustEvaluation.input.elements);
    const postCanonicalSourceText = vi.fn();
    const props = {
      evaluation,
      evaluationState: makeEvaluationState(evaluation, fixture.graphRevision, { status: "ready" }),
      canvasFocusRef: createRef<HTMLDivElement>(),
      postCanonicalSourceText,
      currentReferencePickAuthorityFor: () => null,
      multiDocumentRuntimePresentation: fixture.presentation,
      hostRootDocumentId: fixture.rootDocumentId
    };
    const canvasView = render(<VSCodeDrawingCanvas {...props} />);
    const adapter = mocks.hostAdapter;
    if (!adapter) throw new Error("Canvas host adapter was not captured");

    expect(adapter.elements).toEqual(fixture.runtime.preparedRustEvaluation.input.elements);
    expect(adapter.compiledDocument).toBe(sourceEditing.compiled);
    expect(adapter.compiledDocument?.spans.sourceMap.source).toBe(fixture.source);
    expect(adapter.compiledDocument?.spans.sourceMap.sourceRevision).toBe(fixture.sourceRevision);
    expect(adapter.compiledDocument?.statementMap?.sourceRevision).toBe(fixture.sourceRevision);
    expect(adapter.canvasLayerPresentation?.layers.map((layer) => layer.name)).toContain("default");

    act(() => useCadDocumentStore.getState().replaceTextDocument(`${fixture.source}\n// newer Source`, {
      currentFilePath: fixture.rootDocumentId,
      dirtySinceSave: false
    }));
    canvasView.rerender(<VSCodeDrawingCanvas {...props} />);
    const staleAdapter = mocks.hostAdapter;
    if (!staleAdapter) throw new Error("Canvas host adapter was not captured after Source changed");
    expect(staleAdapter.elements).toEqual([]);
    expect(staleAdapter.compiledDocument).toBeUndefined();
    mocks.postCanonicalSourceText?.("nui 1\n");
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
    canvasView.unmount();
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

  it.each(["A", "B", "C"] as const)("#1651 exact-Base drag control %s dispatches the root point", (testCase) => {
    const source = issue1651RootSourceFor(testCase);
    act(() => useCadDocumentStore.getState().replaceTextDocument(source, {
      currentFilePath: null,
      dirtySinceSave: false
    }));
    const state = useCadDocumentStore.getState();
    const rootPoint = state.elements.find(element => element.name === "A");
    expect(rootPoint).toBeDefined();
    if (!rootPoint) return;
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const postCanonicalSourceText = vi.fn();
    const evaluation = emptyEvaluationResult(state.elements);
    const { adapter } = renderCanvas(
      evaluation,
      makeEvaluationState(evaluation, state.compiledDocumentRevision, { status: "ready" }),
      postCanonicalSourceText
    );
    const baseElements = state.elements;
    const action = {
      elementId: rootPoint.id,
      dx: 4,
      dy: -3,
      angleLocked: false,
      distanceLocked: false,
      baseElements
    };

    let previewResult: unknown;
    let commitResult: unknown;
    act(() => {
      previewResult = adapter.movePointElementByDelta({ ...action, commitMode: "preview" });
      commitResult = adapter.movePointElementByDelta({ ...action, commitMode: "commit" });
    });
    expect(previewResult).toMatchObject({ status: "applied" });
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("movePointElementByDelta", {
      ...action,
      commitMode: "preview"
    });
    expect(commitResult).toMatchObject({ status: "applied" });
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", {
      ...action,
      commitMode: "commit"
    });
    expect(postCanonicalSourceText).toHaveBeenCalledWith(state.sourceText);
  });

  it.each([false, true])("#1651 exact-Base imported graph keeps root and imported edit ownership (geometry=%s)", async (withGeometry) => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(withGeometry);
    mocks.dispatchCommand.mockImplementation((commandId, commandContext) =>
      commandId === "movePointElementByDelta"
        ? movePointElementByDelta(commandContext)
        : undefined
    );
    act(() => useCadDocumentStore.getState().replaceTextDocument(fixture.source, {
      currentFilePath: null,
      dirtySinceSave: false
    }));
    const state = useCadDocumentStore.getState();
    const graphRootPoint = fixture.runtimePresentation.elements.find(element => element.name === "A");
    expect(graphRootPoint).toBeDefined();
    if (!graphRootPoint) return;
    const rootOwner = sourceOwnerForRuntimeElementId(fixture.compiled, graphRootPoint.id);
    expect(rootOwner?.kind).toBe("ordinary");
    expect(rootOwner?.sourceStatementIndex).toBe(fixture.compiled.statements.findIndex(statement =>
      statement.kind === "element" && statement.name === "A"
    ));
    const localRootPoint = state.currentCompiled.sourceElementsByStatementIndex.get(rootOwner!.sourceStatementIndex);
    expect(localRootPoint?.name).toBe("A");
    expect(localRootPoint?.id).not.toBe(graphRootPoint.id);

    const importedPoint = fixture.runtimePresentation.elements.find(element => element.name === "Imported");
    if (withGeometry) {
      expect(importedPoint).toBeDefined();
      if (!importedPoint) return;
      expect(sourceOwnerForRuntimeElementId(fixture.compiled, importedPoint.id)).toMatchObject({
        kind: "moduleBody",
        sourceDocumentId: expect.anything()
      });
    } else {
      expect(importedPoint).toBeUndefined();
    }

    const evaluation = emptyEvaluationResult(fixture.runtimePresentation.elements);
    const postCanonicalSourceText = vi.fn();
    render(
      <VSCodeDrawingCanvas
        evaluation={evaluation}
        evaluationState={makeEvaluationState(evaluation, fixture.runtimePresentation.graphRevision, { status: "ready" })}
        canvasFocusRef={createRef()}
        postCanonicalSourceText={postCanonicalSourceText}
        currentReferencePickAuthorityFor={() => ({ documentVersion: 7, normalizedSource: fixture.source })}
        multiDocumentRuntimePresentation={fixture.runtimePresentation}
      />
    );
    const adapter = mocks.hostAdapter;
    if (!adapter) throw new Error("Canvas host adapter was not captured");
    expect(adapter.runtimeElementIds).not.toContain(graphRootPoint.id);
    const baseElements = fixture.runtimePresentation.elements;
    const rootAction = {
      elementId: graphRootPoint.id,
      dx: 4,
      dy: -3,
      angleLocked: false,
      distanceLocked: false,
      baseElements,
      baseEvaluation: evaluation
    };

    let rootPreviewResult: unknown;
    let rootCommitResult: unknown;
    let importedCommitResult: unknown;
    act(() => {
      rootPreviewResult = adapter.movePointElementByDelta({ ...rootAction, commitMode: "preview" });
      rootCommitResult = adapter.movePointElementByDelta({ ...rootAction, commitMode: "commit" });
      if (importedPoint) {
        expect(adapter.runtimeElementIds).toContain(importedPoint.id);
        importedCommitResult = adapter.movePointElementByDelta({
          ...rootAction,
          elementId: importedPoint.id,
          commitMode: "commit"
        });
      }
    });
    expect(rootPreviewResult).toMatchObject({ status: "applied" });
    expect(rootCommitResult).toMatchObject({ status: "applied" });
    if (importedPoint) expect(importedCommitResult).toBe(false);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenNthCalledWith(1, "movePointElementByDelta", expect.objectContaining({
      ...rootAction,
      commitMode: "preview",
      commitCanvasSourceElements: expect.any(Function)
    }));
    expect(mocks.dispatchCommand).toHaveBeenNthCalledWith(2, "movePointElementByDelta", expect.objectContaining({
      ...rootAction,
      commitMode: "commit",
      commitCanvasSourceElements: expect.any(Function)
    }));
    const after = useCadDocumentStore.getState();
    expect(after.sourceText).toBe(fixture.source.replace(
      "point A = coordinate(x: 0, y: 0)",
      "point A = coordinate(x: 4, y: -3)"
    ));
    expect(after.sourceUpdate.kind).toBe("model-patch");
    expect(after.currentCompiled.document).toBeNull();
    expect(postCanonicalSourceText).toHaveBeenCalledWith(after.sourceText, expect.any(Number), {
      rootDocumentId: fixture.runtimePresentation.rootDocumentId,
      graphRevision: fixture.runtimePresentation.graphRevision
    });
  });

  it("#1651 keeps last-good geometry read-only when the current imported graph is unavailable", () => {
    const source = [
      "nui 1",
      "import \"./module_test_lib.nui\" as lib",
      "instance S = lib::Sample()"
    ].join("\n");
    act(() => {
      useCadDocumentStore.getState().replaceTextDocument("nui 1\npoint Existing = coordinate(x: 0, y: 0)", {
        currentFilePath: null,
        dirtySinceSave: false
      });
      useCadDocumentStore.getState().commitText(source, "editor");
    });
    const state = useCadDocumentStore.getState();
    expect(state.currentCompiled.document).toBeNull();
    expect(state.docText).not.toBe(source);
    const evaluation = emptyEvaluationResult(state.elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const target = state.elements[0];
    if (!target) throw new Error("missing last-good geometry fixture");
    expect(adapter.runtimeElementIds).toContain(target.id);

    const result = adapter.movePointElementByDelta({
      elementId: target.id,
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "commit",
      baseElements: state.elements,
      baseEvaluation: evaluation
    });
    expect(result).toBe(false);
    expect(mocks.dispatchCommand).not.toHaveBeenCalled();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
  });

  it("#1651 rejects an authoritative Source patch after the store revision changes", () => {
    const source = [
      "nui 1",
      "import \"./module_test_lib.nui\" as lib",
      "instance S = lib::Sample()",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    act(() => useCadDocumentStore.getState().replaceTextDocument(source, {
      currentFilePath: null,
      dirtySinceSave: false
    }));
    const before = useCadDocumentStore.getState();
    const expected = { sourceText: before.sourceText, sourceRevision: before.sourceRevision };
    const newerSource = `${source}\n// newer Source revision`;
    act(() => useCadDocumentStore.getState().commitText(newerSource, "editor"));

    const result = useCadDocumentStore.getState().commitAuthoritativeSourceSplices(expected, [{
      startLine: 4,
      endLine: 4,
      replacementLines: ["point A = coordinate(x: 5, y: 0)"]
    }]);
    expect(result).toEqual({ status: "rejected", reason: "invalid-change" });
    expect(useCadDocumentStore.getState().sourceText).toBe(newerSource);
  });

  it("#1651 reports the source-owner reason for an unsafe Module instance edit", async () => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    act(() => useCadDocumentStore.getState().replaceTextDocument(fixture.source, {
      currentFilePath: null,
      dirtySinceSave: false
    }));
    const rootPoint = fixture.runtimePresentation.elements.find((element) => element.name === "A");
    const instance = fixture.runtimePresentation.elements.find((element) => element.name === "S");
    if (rootPoint?.type !== "freePoint" || instance?.type !== "moduleInstance") {
      throw new Error("Expected graph root point A and Module instance S");
    }
    mocks.dispatchCommand.mockImplementation((commandId, commandContext) => {
      if (commandId !== "movePointElementByDelta") return undefined;
      const changedElements = commandContext.baseElements.map((element: CadElement) =>
        element.id === instance.id
          ? { ...element, visible: false, activity: "hidden" as const }
          : element
      );
      return commandContext.commitCanvasSourceElements?.(changedElements);
    });
    const evaluation = emptyEvaluationResult(fixture.runtimePresentation.elements);
    render(
      <VSCodeDrawingCanvas
        evaluation={evaluation}
        evaluationState={makeEvaluationState(evaluation, fixture.runtimePresentation.graphRevision, { status: "ready" })}
        canvasFocusRef={createRef<HTMLDivElement>()}
        postCanonicalSourceText={vi.fn()}
        currentReferencePickAuthorityFor={() => null}
        multiDocumentRuntimePresentation={fixture.runtimePresentation}
      />
    );
    const adapter = mocks.hostAdapter;
    if (!adapter) throw new Error("Canvas host adapter was not captured");

    let result: unknown;
    act(() => {
      result = adapter.movePointElementByDelta({
        elementId: rootPoint.id,
        dx: 4,
        dy: 0,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "commit",
        baseElements: fixture.runtimePresentation.elements,
        baseEvaluation: evaluation
      });
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "invalid-change",
      feedbackMessage: "要素 S のsource ownerを解決できません。"
    });
    expect(useCadUiStore.getState().commandErrorMessage).toBe("要素 S のsource ownerを解決できません。");
    expect(useCadDocumentStore.getState().sourceText).toBe(fixture.source);
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

describe("Canvas drag frame continuity", () => {
  const dragSource = [
    "nui 1",
    "point A = coordinate(x: 0, y: 0)",
    "point B = coordinate(x: 100, y: 0)",
    "line Walk = segment(start: A, end: B)",
    "curve Bend = bezier(start: A, startAngle: 0, startLength: 25, end: B, endAngle: 0, endLength: 20)"
  ].join("\n");

  const preparePointerCapture = (viewport: HTMLDivElement) => {
    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = vi.fn(() => true);
    viewport.releasePointerCapture = vi.fn();
    return viewport;
  };

  const useRealCanvas = () => {
    mocks.renderRealCanvas = true;
    mocks.dispatchCommand.mockImplementation((command, context) => {
      if (command === "movePointElementByDelta") return movePointElementByDelta(context);
      if (command === "moveBezierHandleByDelta") return moveBezierHandleByDelta(context);
    });
    const drawingContext = {
      arc: vi.fn(),
      bezierCurveTo: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn()
    };
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(0, 0, 500, 400));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      drawingContext as unknown as CanvasRenderingContext2D
    );
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    return drawingContext;
  };

  it.each(["point", "handle"] as const)("draws successive %s positions before evaluation settles", async (dragType) => {
    const drawing = useRealCanvas();
    const source = dragSource;
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const { elements, compiledDocumentRevision } = useCadDocumentStore.getState();
    const curve = elements.find((element) => element.name === "Bend");
    if (!curve) throw new Error("Missing curve");
    const evaluation = evaluateElements(elements);
    expect(evaluation.errors).toEqual([]);
    const drawEvents: Array<"current" | "projected" | "frame"> = [];
    const api = { postMessage: vi.fn((message: { type?: string }) => {
      if (message.type === "canvasFrameDrawn") drawEvents.push("frame");
    }) };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    const postCanonicalSourceText = vi.fn();
    const canvasFocusRef = createRef<HTMLDivElement>();
    render(<VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, compiledDocumentRevision, { status: "ready" })}
      canvasFocusRef={canvasFocusRef}
      postCanonicalSourceText={postCanonicalSourceText}
      currentReferencePickAuthorityFor={() => null}
      documentVersion={9}
      canvasUpdateProgress={{ documentVersion: 9, generation: 4 }}
      onProductionDrawCompleted={({ isProjectedDraw }) => drawEvents.push(isProjectedDraw ? "projected" : "current")}
    />);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFrameDrawn",
      documentVersion: 9,
      updateGeneration: 4
    }));
    api.postMessage.mockClear();
    drawEvents.length = 0;
    const expectAcksToFollowCurrentDraws = () => {
      let previousDraw: "current" | "projected" | null = null;
      for (const event of drawEvents) {
        if (event === "frame") expect(previousDraw).toBe("current");
        else previousDraw = event;
      }
    };
    const viewport = preparePointerCapture(canvasFocusRef.current!);
    if (dragType === "handle") {
      act(() => useCadUiStore.getState().setSelectedElementId(curve.id));
      expect(viewport.querySelector(".overlay-bezier-handle-point")).toHaveAttribute("cx", "275");
    }
    const startX = dragType === "point" ? 250 : 275;
    if (dragType === "point") {
      expect(drawing.arc.mock.calls.some(([x, y]) => x === 250 && y === 200)).toBe(true);
    } else {
      expect(drawing.bezierCurveTo.mock.calls.some(([x, y]) => x === 275 && y === 200)).toBe(true);
    }
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: startX, clientY: 200, pointerId: 1 });
    expect(viewport).toHaveClass(dragType === "point" ? "is-point-dragging" : "is-bezier-handle-dragging");
    const positions = [10, 20].map((dx) => {
      drawing.arc.mockClear();
      drawing.moveTo.mockClear();
      drawing.lineTo.mockClear();
      drawing.bezierCurveTo.mockClear();
      fireEvent.pointerMove(viewport, { buttons: 1, clientX: startX + dx, clientY: 190, pointerId: 1 });
      return {
        target: (dragType === "point" ? drawing.arc : drawing.bezierCurveTo).mock.calls
          .some(([x, y]) => Math.abs(x - startX - dx) < 0.001 && Math.abs(y - 190) < 0.001),
        handle: dragType === "point" || Array.from(viewport.querySelectorAll(".overlay-bezier-handle-point"))
          .some((handle) => Math.abs(Number(handle.getAttribute("cx")) - startX - dx) < 0.001 &&
            Math.abs(Number(handle.getAttribute("cy")) - 190) < 0.001),
        edge: dragType === "handle" || drawing.moveTo.mock.calls.some(([x, y]) => x === startX + dx && y === 190),
        unaffected: drawing.arc.mock.calls.some(([x, y]) => x === 350 && y === 200)
      };
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
    expect(positions).toEqual(Array.from({ length: 2 }, () => ({ target: true, handle: true, edge: true, unaffected: true })));
    expectAcksToFollowCurrentDraws();

    drawing.arc.mockClear();
    drawing.bezierCurveTo.mockClear();
    fireEvent.keyDown(viewport, { key: "Shift", shiftKey: true });
    expect((dragType === "point" ? drawing.arc : drawing.bezierCurveTo).mock.calls
      .some(([x, y]) => x === startX + 20 && y === 200)).toBe(true);
    expectAcksToFollowCurrentDraws();
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: startX + 20, clientY: 190, pointerId: 1, shiftKey: true });
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);
    const committed = evaluateElements(useCadDocumentStore.getState().elements);
    const target = committed.computedGeometry.get(dragType === "point"
      ? elements.find((element) => element.name === "A")!.id
      : curve.id);
    if (dragType === "point") {
      expect(target).toMatchObject({ kind: "point", x: 20, y: 0 });
    } else {
      expect(target).toMatchObject({ kind: "bezierCurve", segments: [{ control1: { x: 45, y: 0 } }] });
    }
  });

  it("acknowledges a current Canvas frame only after the real renderer draws it", async () => {
    useRealCanvas();
    const source = "nui 1\npoint A = coordinate(x: 12, y: 8)";
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    expect(evaluation.errors).toEqual([]);
    const api = { postMessage: vi.fn() };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    render(<VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, state.compiledDocumentRevision, { status: "ready" })}
      canvasFocusRef={createRef<HTMLDivElement>()}
      postCanonicalSourceText={vi.fn()}
      currentReferencePickAuthorityFor={() => null}
      documentVersion={9}
      canvasUpdateProgress={{ documentVersion: 9, generation: 4 }}
    />);

    const messages = api.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    const frameDrawn = messages.find(message => message.type === "canvasFrameDrawn");
    expect(frameDrawn).toMatchObject({
      type: "canvasFrameDrawn",
      documentVersion: 9,
      updateGeneration: 4,
      sourceRevision: state.sourceRevision,
      evaluationRevision: state.compiledDocumentRevision,
      evaluationRequestRevision: state.compiledDocumentRevision
    });
    const publication = messages.find(message => message.type === "surfaceDiagnosticsPublication");
    expect(publication).toMatchObject({
      documentVersion: 9,
      canvasUpdate: {
        generation: 4,
        frameIdentity: {
          documentVersion: 9,
          updateGeneration: 4,
          sourceRevision: state.sourceRevision,
          evaluationRevision: state.compiledDocumentRevision,
          evaluationRequestRevision: state.compiledDocumentRevision
        }
      }
    });
    expect(mocks.onCanvasFrameDrawn).not.toBeNull();
    expect(mocks.onProductionDrawCompleted).toBeNull();
  });

  it.each(["root-only", "imported-runtime"] as const)(
    "keeps graph-owned %s frame evidence strict after the real renderer draws it",
    async kind => {
      useRealCanvas();
      let source: string;
      let runtimePresentation: VscodeMultiDocumentCanvasRuntimePresentation;
      let rootDocumentId: string;
      let graphRevision: number;
      let sourceRevision: number;
      if (kind === "root-only") {
        const fixture = await issue1609CanvasRootOnlyFixture();
        source = fixture.source;
        runtimePresentation = fixture.presentation;
        rootDocumentId = fixture.rootDocumentId;
        graphRevision = fixture.graphRevision;
        sourceRevision = fixture.sourceRevision;
      } else {
        const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
        source = fixture.source;
        runtimePresentation = fixture.runtimePresentation;
        rootDocumentId = runtimePresentation.rootDocumentId;
        graphRevision = runtimePresentation.graphRevision;
        sourceRevision = runtimePresentation.rootSourceRevision;
      }
      useCadDocumentStore.getState().replaceTextDocument(source, {
        currentFilePath: rootDocumentId,
        dirtySinceSave: false
      });
      const evaluation = emptyEvaluationResult(runtimePresentation.elements);
      const api = { postMessage: vi.fn() };
      vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
      render(<VSCodeDrawingCanvas
        evaluation={evaluation}
        evaluationState={makeEvaluationState(evaluation, graphRevision, { status: "ready" })}
        canvasFocusRef={createRef<HTMLDivElement>()}
        postCanonicalSourceText={vi.fn()}
        currentReferencePickAuthorityFor={() => null}
        documentVersion={9}
        canvasUpdateProgress={{ documentVersion: 9, generation: 10 }}
        feedbackGraphIdentity={{
          hostDocumentUri: rootDocumentId,
          graphRevision,
          sourceRevision
        }}
        hostRootDocumentId={rootDocumentId}
        multiDocumentRuntimePresentation={runtimePresentation}
      />);

      const messages = api.postMessage.mock.calls.map(([message]) => message as CanvasFrameTestMessage);
      const completion = messages.find(message => message.type === "canvasFrameDrawn");
      const readyPublication = messages.find(message => message.type === "surfaceDiagnosticsPublication");
      expect(completion).toMatchObject({
        type: "canvasFrameDrawn",
        documentVersion: 9,
        updateGeneration: 10,
        sourceRevision,
        graphIdentity: { hostDocumentUri: rootDocumentId, graphRevision, sourceRevision }
      });
      expect(readyPublication?.canvasUpdate?.frameIdentity).toEqual({
        documentVersion: 9,
        updateGeneration: 10,
        sourceRevision,
        graphIdentity: { hostDocumentUri: rootDocumentId, graphRevision, sourceRevision },
        evaluationRevision: graphRevision,
        evaluationRequestRevision: graphRevision
      });
      expect(mocks.onProductionDrawCompleted).toBeNull();
    }
  );

  it("does not associate a local frame when equal source revisions have different normalized Source", async () => {
    const source = "nui 1\npoint A = coordinate(x: 12, y: 8)";
    const mismatchedSource = "nui 1\npoint A = coordinate(x: 13, y: 8)";
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    expect(evaluation.errors).toEqual([]);
    const graphIdentity = {
      hostDocumentUri: "file:///pattern.nui",
      graphRevision: 14,
      sourceRevision: state.sourceRevision
    };
    const api = { postMessage: vi.fn() };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    render(<VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, state.compiledDocumentRevision, { status: "ready" })}
      canvasFocusRef={createRef<HTMLDivElement>()}
      postCanonicalSourceText={vi.fn()}
      currentReferencePickAuthorityFor={() => null}
      documentVersion={9}
      canvasUpdateProgress={{ documentVersion: 9, generation: 5 }}
      feedbackGraphIdentity={graphIdentity}
      verifiedLocalFrameGraphAssociation={{ normalizedSource: mismatchedSource, graphIdentity }}
    />);

    const messages = api.postMessage.mock.calls.map(([message]) => message as CanvasFrameTestMessage);
    const publication = messages.find(message => message.type === "surfaceDiagnosticsPublication");
    expect(graphIdentity.sourceRevision).toBe(state.sourceRevision);
    expect(publication).toMatchObject({
      canvasUpdate: {
        generation: 5,
        frameIdentity: {
          documentVersion: 9,
          updateGeneration: 5,
          sourceRevision: state.sourceRevision,
          evaluationRevision: state.compiledDocumentRevision,
          evaluationRequestRevision: state.compiledDocumentRevision
        }
      }
    });
    expect(publication?.canvasUpdate?.frameIdentity).not.toHaveProperty("graphIdentity");
  });

  it("keeps a ready update pending when the real Canvas has no drawable viewport", async () => {
    useRealCanvas();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
    const source = "nui 1\npoint A = coordinate(x: 12, y: 8)";
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const api = { postMessage: vi.fn() };
    vi.spyOn(await import("./vscodeWebviewApiContext"), "vscodeWebviewApi").mockReturnValue(api);
    render(<VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, state.compiledDocumentRevision, { status: "ready" })}
      canvasFocusRef={createRef<HTMLDivElement>()}
      postCanonicalSourceText={vi.fn()}
      currentReferencePickAuthorityFor={() => null}
      documentVersion={9}
      canvasUpdateProgress={{ documentVersion: 9, generation: 4 }}
    />);

    const messages = api.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(messages.find(message => message.type === "surfaceDiagnosticsPublication")).toMatchObject({
      canvasUpdate: {
        generation: 4,
        frameIdentity: {
          documentVersion: 9,
          updateGeneration: 4,
          sourceRevision: state.sourceRevision,
          evaluationRevision: state.compiledDocumentRevision
        }
      }
    });
    expect(messages.some(message => message.type === "canvasFrameDrawn")).toBe(false);
  });

  it.each([
    { dragType: "point", end: "pointercancel" },
    { dragType: "handle", end: "lostpointercapture" },
    { dragType: "point", end: "Escape" },
    { dragType: "handle", end: "Source edit" }
  ])("discards $dragType projection and a late release after $end", ({ dragType, end }) => {
    const drawing = useRealCanvas();
    useCadDocumentStore.getState().replaceTextDocument(dragSource, { currentFilePath: null, dirtySinceSave: false });
    const { elements, compiledDocumentRevision } = useCadDocumentStore.getState();
    const evaluation = evaluateElements(elements);
    const postCanonicalSourceText = vi.fn();
    const canvasFocusRef = createRef<HTMLDivElement>();
    render(<VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, compiledDocumentRevision, { status: "ready" })}
      canvasFocusRef={canvasFocusRef}
      postCanonicalSourceText={postCanonicalSourceText}
      currentReferencePickAuthorityFor={() => null}
      canvasGridSettings={{ ...DEFAULT_CANVAS_GRID_SETTINGS, snapEnabled: true, spacingMm: 10 }}
    />);
    const viewport = preparePointerCapture(canvasFocusRef.current!);
    if (dragType === "handle") {
      const curve = elements.find((element) => element.name === "Bend")!;
      act(() => useCadUiStore.getState().setSelectedElementId(curve.id));
    }
    const startX = dragType === "point" ? 250 : 275;
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: startX, clientY: 200, pointerId: 1 });
    const moved = { clientX: startX + 13, clientY: 205, pointerId: 1 };
    drawing.arc.mockClear();
    fireEvent.pointerMove(viewport, { ...moved, buttons: 1 });
    if (dragType === "point") {
      expect(drawing.arc.mock.calls.some(([x, y]) => x === 260 && y === 210)).toBe(true);
    }
    const expectedSource = end === "Source edit" ? dragSource.replace("endLength: 20", "endLength: 30") : dragSource;
    if (end === "Source edit") {
      act(() => useCadDocumentStore.getState().commitText(expectedSource, "editor", { cursorLineAtBurstStart: null }));
    } else if (end === "Escape") {
      fireEvent.keyDown(viewport, { key: "Escape" });
    } else if (end === "pointercancel") {
      fireEvent.pointerCancel(viewport, moved);
    } else {
      fireEvent.lostPointerCapture(viewport, moved);
    }
    expect(viewport).not.toHaveClass("is-point-dragging");
    expect(viewport).not.toHaveClass("is-bezier-handle-dragging");
    fireEvent.pointerUp(viewport, { ...moved, buttons: 0 });
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
    expect(useCadDocumentStore.getState().sourceText).toBe(expectedSource);
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
  });

  it("retains the previous root-only drawing after a committed point drag", () => {
    const drawing = useRealCanvas();
    const source = [
      "nui 1",
      "",
      "// A and B",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point B = coordinate(x: 100, y: 0)"
    ].join("\n");
    useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: null, dirtySinceSave: false });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    expect(evaluation.errors).toEqual([]);
    const canvasFocusRef = createRef<HTMLDivElement>();
    const postCanonicalSourceText = vi.fn();
    const props = { canvasFocusRef, postCanonicalSourceText, currentReferencePickAuthorityFor: () => null };
    const view = render(<VSCodeDrawingCanvas
      {...props}
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, state.compiledDocumentRevision, { status: "ready" })}
    />);
    expect(drawing.arc.mock.calls.some(([x, y]) => x === 350 && y === 200)).toBe(true);
    const viewport = preparePointerCapture(canvasFocusRef.current!);
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 250, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 265, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 265, clientY: 200, pointerId: 1 });
    const committed = useCadDocumentStore.getState();
    expect(committed.sourceText).toBe(source.replace("x: 0", "x: 15"));
    expect(postCanonicalSourceText).toHaveBeenCalledExactlyOnceWith(committed.sourceText);

    const pending = emptyEvaluationResult([]);
    drawing.arc.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...props}
      evaluation={pending}
      evaluationState={makeEvaluationState(pending, committed.compiledDocumentRevision)}
    />);
    expect(drawing.arc.mock.calls.some(([x, y]) => x === 350 && y === 200)).toBe(true);

    const completed = evaluateElements(committed.elements);
    drawing.arc.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...props}
      evaluation={completed}
      evaluationState={makeEvaluationState(completed, committed.compiledDocumentRevision, { status: "ready" })}
    />);
    expect(drawing.arc.mock.calls.some(([x, y]) => x === 265 && y === 200)).toBe(true);
  });

  it("draws the previous imported-Module frame while the next graph evaluation is pending after release", async () => {
    const drawing = useRealCanvas();
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
    useCadDocumentStore.getState().replaceTextDocument(fixture.source, { currentFilePath: null, dirtySinceSave: false });
    const graph = fixture.runtimePresentation;
    const evaluation = evaluateElements(graph.elements);
    expect(evaluation.errors).toEqual([]);
    const canvasFocusRef = createRef<HTMLDivElement>();
    const postCanonicalSourceText = vi.fn();
    const props = {
      canvasFocusRef,
      postCanonicalSourceText,
      currentReferencePickAuthorityFor: () => null,
      hostRootDocumentId: graph.rootDocumentId
    };
    const view = render(<VSCodeDrawingCanvas
      {...props}
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, graph.graphRevision, { status: "ready" })}
      multiDocumentRuntimePresentation={graph}
    />);
    expect(drawing.arc.mock.calls.some(([x, y]) => x === 300 && y === 200)).toBe(true);
    const viewport = preparePointerCapture(canvasFocusRef.current!);
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 250, clientY: 200, pointerId: 2 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 265, clientY: 200, pointerId: 2 });
    expect(useCadDocumentStore.getState().previewElements).not.toBeNull();
    fireEvent.pointerCancel(viewport, { clientX: 265, clientY: 200, pointerId: 2 });
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).toBe(fixture.source);
    expect(postCanonicalSourceText).not.toHaveBeenCalled();

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 250, clientY: 200, pointerId: 1 });
    for (const x of [260, 265]) {
      drawing.arc.mockClear();
      fireEvent.pointerMove(viewport, { buttons: 1, clientX: x, clientY: 200, pointerId: 1 });
      expect(drawing.arc.mock.calls.some(([px, y]) => px === x && y === 200)).toBe(true);
      expect(drawing.arc.mock.calls.some(([px, y]) => px === 300 && y === 200)).toBe(true);
    }
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 265, clientY: 200, pointerId: 1 });
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);

    const pending = emptyEvaluationResult([]);
    drawing.arc.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...props}
      evaluation={pending}
      evaluationState={makeEvaluationState(pending, useCadDocumentStore.getState().compiledDocumentRevision, { status: "ready" })}
      awaitingHostGraph
    />);
    expect(drawing.arc.mock.calls.some(([x, y]) => x === 300 && y === 200)).toBe(true);
    const imported = graph.elements.find((element) => element.name === "Imported");
    expect(imported).toBeDefined();
    expect(mocks.hostAdapter?.selectElement(imported!.id, "replace")).toBe(false);

    const next = { ...graph, graphRevision: graph.graphRevision + 1 };
    drawing.arc.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...props}
      evaluation={pending}
      evaluationState={makeEvaluationState(pending, next.graphRevision)}
      multiDocumentRuntimePresentation={next}
    />);
    expect(drawing.arc.mock.calls.some(([x, y]) => x === 300 && y === 200)).toBe(true);

    drawing.arc.mockClear();
    view.rerender(<VSCodeDrawingCanvas
      {...props}
      hostRootDocumentId="file:///workspace/another.nui"
      evaluation={evaluation}
      evaluationState={makeEvaluationState(evaluation, graph.graphRevision, { status: "ready" })}
      multiDocumentRuntimePresentation={graph}
    />);
    expect(drawing.arc).not.toHaveBeenCalled();
  });
});
